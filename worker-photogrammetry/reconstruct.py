"""OpenSfM wrapper: frames on disk -> sparse point cloud + camera projections.

Runs the OpenSfM CLI pipeline in a scratch directory and parses
reconstruction.json. If OpenSfM is not installed (local dev outside the
Docker image), ReconstructionUnavailable is raised and the job fails cleanly —
the app then offers the engineer the shape-template fallback.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile

import numpy as np


class ReconstructionUnavailable(Exception):
    pass


class ReconstructionFailed(Exception):
    pass


OPENSFM_CONFIG = """\
feature_process_size: 1600
feature_min_frames: 8000
matching_gps_distance: 0
triangulation_min_ray_angle: 1.0
retriangulation: yes
bundle_outlier_filtering_type: AUTO
"""


def _rotation_from_axis_angle(axis_angle: list[float]) -> np.ndarray:
    v = np.asarray(axis_angle, dtype=float)
    theta = float(np.linalg.norm(v))
    if theta < 1e-12:
        return np.eye(3)
    k = v / theta
    # Rodrigues' rotation formula
    K = np.array([[0.0, -k[2], k[1]], [k[2], 0.0, -k[0]], [-k[1], k[0], 0.0]])
    return np.eye(3) + np.sin(theta) * K + (1 - np.cos(theta)) * (K @ K)


def _camera_matrix(camera: dict, width: int, height: int) -> np.ndarray:
    # OpenSfM perspective intrinsics are normalized by max(width, height).
    scale = max(width, height)
    f = float(camera.get("focal", camera.get("focal_x", 0.85))) * scale
    cx = width / 2.0 + float(camera.get("c_x", 0.0)) * scale
    cy = height / 2.0 + float(camera.get("c_y", 0.0)) * scale
    return np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])


def run_reconstruction(image_paths: list[str]) -> dict:
    """Returns {points: Nx3, projections: {filename: 3x4}, registered: int, total: int}."""
    if shutil.which("opensfm") is None:
        raise ReconstructionUnavailable(
            "OpenSfM binary not found — run the worker via its Docker image"
        )

    with tempfile.TemporaryDirectory(prefix="scan-") as workdir:
        images_dir = os.path.join(workdir, "images")
        os.makedirs(images_dir)
        for path in image_paths:
            shutil.copy(path, os.path.join(images_dir, os.path.basename(path)))
        with open(os.path.join(workdir, "config.yaml"), "w") as fh:
            fh.write(OPENSFM_CONFIG)

        steps = [
            "extract_metadata",
            "detect_features",
            "match_features",
            "create_tracks",
            "reconstruct",
        ]
        for step in steps:
            result = subprocess.run(
                ["opensfm", step, workdir],
                capture_output=True,
                text=True,
                timeout=1200,
            )
            if result.returncode != 0:
                raise ReconstructionFailed(f"opensfm {step} failed: {result.stderr[-500:]}")

        reconstruction_file = os.path.join(workdir, "reconstruction.json")
        if not os.path.exists(reconstruction_file):
            raise ReconstructionFailed("no reconstruction produced")
        with open(reconstruction_file) as fh:
            reconstructions = json.load(fh)
        if not reconstructions:
            raise ReconstructionFailed("empty reconstruction")

        # Largest connected reconstruction wins.
        recon = max(reconstructions, key=lambda r: len(r.get("points", {})))

        points = np.array(
            [p["coordinates"] for p in recon.get("points", {}).values()], dtype=float
        )
        if points.shape[0] < 500:
            raise ReconstructionFailed(f"too sparse: {points.shape[0]} points")

        projections: dict[str, np.ndarray] = {}
        cameras = recon.get("cameras", {})
        for name, shot in recon.get("shots", {}).items():
            camera = cameras.get(shot.get("camera", ""), {})
            width = int(camera.get("width", 0)) or 1600
            height = int(camera.get("height", 0)) or 1200
            K = _camera_matrix(camera, width, height)
            R = _rotation_from_axis_angle(shot["rotation"])
            t = np.asarray(shot["translation"], dtype=float).reshape(3, 1)
            projections[name] = K @ np.hstack([R, t])

        return {
            "points": points,
            "projections": projections,
            "registered": len(projections),
            "total": len(image_paths),
        }
