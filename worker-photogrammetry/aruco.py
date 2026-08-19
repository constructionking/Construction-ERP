"""ArUco scale-marker detection + linear triangulation of its corners.

The engineer places a printed ArUco board of known size (markerSizeMm) against
the pile. The marker's corners are detected in the captured frames; using the
camera poses from the sparse reconstruction, each corner is triangulated to a
3D point in model units, from which the metric scale factor follows.
"""

from __future__ import annotations

import numpy as np

try:
    import cv2

    ARUCO_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only without OpenCV
    cv2 = None
    ARUCO_AVAILABLE = False


class MarkerNotFound(Exception):
    pass


def detect_marker_corners(image_bgr: "np.ndarray") -> np.ndarray | None:
    """Return the 4 corner pixels (4x2) of the first ArUco marker, or None."""
    if not ARUCO_AVAILABLE:
        return None
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    detector = cv2.aruco.ArucoDetector(dictionary, cv2.aruco.DetectorParameters())
    corners, ids, _ = detector.detectMarkers(image_bgr)
    if ids is None or len(corners) == 0:
        return None
    return corners[0].reshape(4, 2)


def triangulate_point(projections: list[tuple[np.ndarray, np.ndarray]]) -> np.ndarray:
    """DLT triangulation: projections = [(P 3x4, pixel xy), ...], >= 2 views."""
    if len(projections) < 2:
        raise MarkerNotFound("need the marker in at least 2 registered frames")
    rows = []
    for P, xy in projections:
        x, y = float(xy[0]), float(xy[1])
        rows.append(x * P[2] - P[0])
        rows.append(y * P[2] - P[1])
    A = np.stack(rows)
    _, _, vt = np.linalg.svd(A)
    X = vt[-1]
    if abs(X[3]) < 1e-12:
        raise MarkerNotFound("triangulation degenerate")
    return X[:3] / X[3]


def triangulate_marker_corners(
    detections: dict[str, np.ndarray],
    projection_matrices: dict[str, np.ndarray],
) -> np.ndarray:
    """Triangulate all 4 marker corners across frames.

    detections: frame name -> 4x2 pixel corners
    projection_matrices: frame name -> 3x4 P (K[R|t]) in model units
    Returns 4x3 corner points in model units.
    """
    frames = [f for f in detections if f in projection_matrices]
    if len(frames) < 2:
        raise MarkerNotFound(
            f"marker seen in {len(frames)} registered frame(s); need at least 2"
        )
    corners_3d = []
    for corner_index in range(4):
        projections = [
            (projection_matrices[f], detections[f][corner_index]) for f in frames
        ]
        corners_3d.append(triangulate_point(projections))
    return np.stack(corners_3d)
