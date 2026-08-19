"""Scan job worker: polls scan_jobs with FOR UPDATE SKIP LOCKED, runs the
photogrammetry pipeline, writes scan_results. Cross-language boundary with the
Next.js app is the plain scan_jobs table — no queue library needed here.

Failure is a designed outcome, not an accident: a failed or low-confidence
reconstruction marks the scan failed, and the app offers the engineer the
shape-template fallback.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
import uuid

import numpy as np
import psycopg2
import psycopg2.extras

from reconstruct import run_reconstruction, ReconstructionFailed, ReconstructionUnavailable
from volume import pile_volume_cum, marker_scale, VolumeError
from aruco import detect_marker_corners, triangulate_marker_corners, MarkerNotFound, ARUCO_AVAILABLE

DATABASE_URL = os.environ["DATABASE_URL"]
STORAGE_DIR = os.environ.get("STORAGE_DIR", "./storage")
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "5"))
MAX_ATTEMPTS = 3
MIN_CONFIDENCE = 0.45


def claim_job(conn):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, "scanId", attempts FROM scan_jobs
            WHERE state = 'queued'
            ORDER BY "createdAt"
            FOR UPDATE SKIP LOCKED
            LIMIT 1
            """
        )
        job = cur.fetchone()
        if job is None:
            return None
        cur.execute(
            """
            UPDATE scan_jobs
            SET state = 'running', "lockedAt" = now(), attempts = attempts + 1,
                "updatedAt" = now()
            WHERE id = %s
            """,
            (job["id"],),
        )
        cur.execute(
            """UPDATE stockpile_scans SET status = 'processing' WHERE id = %s""",
            (job["scanId"],),
        )
    conn.commit()
    return job


def load_scan(conn, scan_id: str):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT s.id, s."siteId", s."materialId", s."markerSizeMm",
                   m.unit, m."densityKgPerCum", m."unitsPerCum", m.name AS material_name
            FROM stockpile_scans s JOIN materials m ON m.id = s."materialId"
            WHERE s.id = %s
            """,
            (scan_id,),
        )
        scan = cur.fetchone()
        cur.execute(
            """
            SELECT p."storageKey" FROM scan_frames f
            JOIN photos p ON p.id = f."photoId"
            WHERE f."scanId" = %s ORDER BY f.sequence
            """,
            (scan_id,),
        )
        frames = [row["storageKey"] for row in cur.fetchall()]
    return scan, frames


def volume_to_qty(volume_cum: float, unit: str, density, units_per_cum):
    if unit == "CUM":
        return volume_cum
    if unit in ("NOS", "BAG") and units_per_cum is not None:
        return volume_cum * float(units_per_cum)
    if unit == "KG" and density is not None:
        return volume_cum * float(density)
    if unit == "TON" and density is not None:
        return volume_cum * float(density) / 1000.0
    return None


def process(conn, job) -> None:
    scan_id = job["scanId"]
    scan, frame_keys = load_scan(conn, scan_id)
    if scan is None or not frame_keys:
        raise ReconstructionFailed("scan or frames missing")

    image_paths = [os.path.join(STORAGE_DIR, key) for key in frame_keys]
    missing = [p for p in image_paths if not os.path.exists(p)]
    if missing:
        raise ReconstructionFailed(f"{len(missing)} frame file(s) missing from storage")

    recon = run_reconstruction(image_paths)

    # Metric scale from the ArUco marker.
    marker_detected = False
    scale = 1.0
    if ARUCO_AVAILABLE and scan["markerSizeMm"]:
        import cv2

        detections = {}
        for path in image_paths:
            image = cv2.imread(path)
            if image is None:
                continue
            corners = detect_marker_corners(image)
            if corners is not None:
                detections[os.path.basename(path)] = corners
        try:
            corners_3d = triangulate_marker_corners(detections, recon["projections"])
            scale = marker_scale(corners_3d, float(scan["markerSizeMm"]) / 1000.0)
            marker_detected = True
        except MarkerNotFound:
            marker_detected = False

    if not marker_detected:
        raise VolumeError("scale marker not detected — place the printed marker against the pile")

    volume, stats = pile_volume_cum(recon["points"], scale)
    qty = volume_to_qty(volume, scan["unit"], scan["densityKgPerCum"], scan["unitsPerCum"])
    if qty is None:
        raise VolumeError(
            f"material {scan['material_name']} lacks a volume conversion factor"
        )

    frame_ratio = recon["registered"] / max(1, recon["total"])
    density_ok = min(1.0, stats["point_count"] / 20000.0)
    confidence = round(0.95 * frame_ratio * (0.6 + 0.4 * density_ok), 3)
    if confidence < MIN_CONFIDENCE:
        raise VolumeError(
            f"low confidence ({confidence}): only {recon['registered']}/{recon['total']} frames registered"
        )

    result = {
        "volume_cum": round(volume, 3),
        "qty": round(qty, 3),
        "confidence": confidence,
        "registered": recon["registered"],
        "total_frames": recon["total"],
        "scale": scale,
        **stats,
    }

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO scan_results
              (id, "scanId", "computedVolumeCum", "computedQty", "qtyUnit", confidence,
               "methodUsed", "markerDetected", "registeredFrames", "createdAt")
            VALUES (%s, %s, %s, %s, %s, %s, 'photogrammetry', %s, %s, now())
            """,
            (
                str(uuid.uuid4()),
                scan_id,
                result["volume_cum"],
                result["qty"],
                scan["unit"],
                confidence,
                marker_detected,
                recon["registered"],
            ),
        )
        cur.execute(
            """UPDATE stockpile_scans SET status = 'computed' WHERE id = %s""", (scan_id,)
        )
        cur.execute(
            """
            UPDATE scan_jobs SET state = 'done', result = %s, "updatedAt" = now()
            WHERE id = %s
            """,
            (json.dumps(result), job["id"]),
        )
    conn.commit()
    print(f"[scan] {scan_id}: {result['qty']} {scan['unit']} "
          f"({result['volume_cum']} cum, confidence {confidence})", flush=True)


def fail_job(conn, job, error: str, retryable: bool) -> None:
    conn.rollback()
    with conn.cursor() as cur:
        if retryable and job["attempts"] < MAX_ATTEMPTS:
            cur.execute(
                """UPDATE scan_jobs SET state = 'queued', error = %s, "updatedAt" = now()
                   WHERE id = %s""",
                (error[:500], job["id"]),
            )
            cur.execute(
                """UPDATE stockpile_scans SET status = 'queued' WHERE id = %s""",
                (job["scanId"],),
            )
        else:
            cur.execute(
                """UPDATE scan_jobs SET state = 'failed', error = %s, "updatedAt" = now()
                   WHERE id = %s""",
                (error[:500], job["id"]),
            )
            cur.execute(
                """UPDATE stockpile_scans SET status = 'failed' WHERE id = %s""",
                (job["scanId"],),
            )
    conn.commit()
    print(f"[scan] job {job['id']} failed: {error[:200]}", flush=True)


def main() -> None:
    print(f"[scan-worker] polling every {POLL_SECONDS}s; storage at {STORAGE_DIR}", flush=True)
    conn = psycopg2.connect(DATABASE_URL)
    while True:
        try:
            job = claim_job(conn)
            if job is None:
                time.sleep(POLL_SECONDS)
                continue
            try:
                process(conn, job)
            except (VolumeError, MarkerNotFound, ReconstructionFailed) as exc:
                # Deterministic pipeline verdicts: retrying identical inputs
                # cannot succeed — fail now so the engineer gets the fallback.
                fail_job(conn, job, str(exc), retryable=False)
            except ReconstructionUnavailable as exc:
                fail_job(conn, job, str(exc), retryable=False)
            except Exception as exc:  # infra errors: worth a retry
                traceback.print_exc()
                fail_job(conn, job, str(exc), retryable=True)
        except psycopg2.Error:
            traceback.print_exc()
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(POLL_SECONDS)
            conn = psycopg2.connect(DATABASE_URL)


if __name__ == "__main__":
    sys.exit(main())
