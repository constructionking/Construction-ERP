"""Pure-numpy stockpile volume estimation from a scaled point cloud.

Pipeline: fit the ground plane (RANSAC + SVD refinement), express points as
height above that plane, integrate a robust heightmap over an XY grid.
The grid method is deliberately chosen over surface meshing: it is robust to
the sparse, noisy clouds photogrammetry produces on real construction sites.
"""

from __future__ import annotations

import numpy as np

RANSAC_ITERATIONS = 300
PLANE_INLIER_THRESHOLD_M = 0.03
GRID_CELL_M = 0.05
MIN_POINTS_PER_CELL = 3
CELL_HEIGHT_PERCENTILE = 90


class VolumeError(Exception):
    pass


def fit_ground_plane(points: np.ndarray, seed: int = 7) -> tuple[np.ndarray, float]:
    """Find the GROUND plane: (unit normal, d) with n·p + d = 0, up = +normal.

    Two steps. RANSAC finds the dominant planar ORIENTATION (on a stockpile
    scene both the ground and a flat pile top share it, so inlier count alone
    cannot tell them apart). Then, along that axis, the ground is identified
    physically: the lowest strong planar mode that has essentially nothing
    beneath it and the pile mass above it.
    """
    if points.shape[0] < 50:
        raise VolumeError(f"too few points for plane fit: {points.shape[0]}")

    rng = np.random.default_rng(seed)
    best_normal: np.ndarray | None = None
    best_count = -1

    for _ in range(RANSAC_ITERATIONS):
        sample = points[rng.choice(points.shape[0], 3, replace=False)]
        v1, v2 = sample[1] - sample[0], sample[2] - sample[0]
        normal = np.cross(v1, v2)
        norm = np.linalg.norm(normal)
        if norm < 1e-9:
            continue
        normal = normal / norm
        d = -normal.dot(sample[0])
        count = int((np.abs(points @ normal + d) < PLANE_INLIER_THRESHOLD_M).sum())
        if count > best_count:
            best_count = count
            best_normal = normal

    if best_normal is None or best_count < 30:
        raise VolumeError("ground plane not found")

    # Along the dominant axis, pick the ground level among strong modes.
    bin_w = 2 * PLANE_INLIER_THRESHOLD_M
    margin = 3 * PLANE_INLIER_THRESHOLD_M

    best: tuple[float, np.ndarray, float] | None = None  # (above_mass, up, level)
    for up in (best_normal, -best_normal):
        t = points @ up
        edges = np.arange(t.min() - bin_w, t.max() + 2 * bin_w, bin_w)
        counts, _ = np.histogram(t, bins=edges)
        # A "strong" mode must rival the dominant planar mode — a thin slice
        # through a sloped pile must not qualify as a candidate ground level.
        min_strong = max(50, int(0.25 * counts.max()))
        strong = np.flatnonzero(counts >= min_strong)
        if strong.size == 0:
            continue
        level = float(edges[strong[0]] + bin_w / 2)  # lowest strong mode
        below = float(np.mean(t < level - margin))
        if below > 0.05:
            continue  # real mass beneath → this is a pile top, not the ground
        above = float(np.mean(t > level + margin))
        if best is None or above > best[0]:
            best = (above, up, level)

    if best is None:
        raise VolumeError("ground plane not found (no clean lowest mode)")

    _, up, level = best

    # SVD-refine on the ground inliers.
    t = points @ up
    inliers = np.abs(t - level) < PLANE_INLIER_THRESHOLD_M
    if int(inliers.sum()) < 30:
        raise VolumeError("ground plane not found (too few ground inliers)")
    inlier_points = points[inliers]
    centroid = inlier_points.mean(axis=0)
    _, _, vt = np.linalg.svd(inlier_points - centroid, full_matrices=False)
    normal = vt[2] / np.linalg.norm(vt[2])
    if normal.dot(up) < 0:
        normal = -normal
    d = -normal.dot(centroid)

    return normal, float(d)


def _plane_basis(normal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    helper = np.array([1.0, 0.0, 0.0])
    if abs(normal.dot(helper)) > 0.9:
        helper = np.array([0.0, 1.0, 0.0])
    u = np.cross(normal, helper)
    u = u / np.linalg.norm(u)
    v = np.cross(normal, u)
    return u, v


def heightmap_volume(
    points: np.ndarray,
    normal: np.ndarray,
    d: float,
    cell_m: float = GRID_CELL_M,
) -> float:
    """Integrate volume above the plane using a per-cell robust height."""
    heights = points @ normal + d
    above = heights > PLANE_INLIER_THRESHOLD_M
    pile = points[above]
    pile_heights = heights[above]
    if pile.shape[0] < 50:
        raise VolumeError("no pile above the ground plane")

    u, v = _plane_basis(normal)
    xs = pile @ u
    ys = pile @ v

    ix = np.floor(xs / cell_m).astype(np.int64)
    iy = np.floor(ys / cell_m).astype(np.int64)
    ix -= ix.min()
    iy -= iy.min()
    keys = ix * (iy.max() + 1) + iy

    order = np.argsort(keys)
    keys_sorted = keys[order]
    heights_sorted = pile_heights[order]
    boundaries = np.flatnonzero(np.diff(keys_sorted)) + 1
    groups = np.split(heights_sorted, boundaries)

    volume = 0.0
    cell_area = cell_m * cell_m
    for group in groups:
        if group.shape[0] < MIN_POINTS_PER_CELL:
            continue
        h = float(np.percentile(group, CELL_HEIGHT_PERCENTILE))
        if h > 0:
            volume += cell_area * h
    if volume <= 0:
        raise VolumeError("computed volume is zero")
    return volume


def marker_scale(corner_points_3d: np.ndarray, marker_size_m: float) -> float:
    """Scale factor from a square marker's 4 triangulated corners (model units → metres)."""
    if corner_points_3d.shape != (4, 3):
        raise VolumeError("marker needs exactly 4 corner points")
    edges = [
        np.linalg.norm(corner_points_3d[1] - corner_points_3d[0]),
        np.linalg.norm(corner_points_3d[2] - corner_points_3d[1]),
        np.linalg.norm(corner_points_3d[3] - corner_points_3d[2]),
        np.linalg.norm(corner_points_3d[0] - corner_points_3d[3]),
    ]
    mean_edge = float(np.mean(edges))
    if mean_edge <= 1e-9:
        raise VolumeError("degenerate marker edges")
    # Reject a badly-triangulated marker (edges should be near-equal).
    if float(np.std(edges)) / mean_edge > 0.15:
        raise VolumeError("marker corners inconsistent — bad triangulation")
    return marker_size_m / mean_edge


def pile_volume_cum(
    points_model_units: np.ndarray,
    scale: float,
    cell_m: float = GRID_CELL_M,
) -> tuple[float, dict]:
    """Full pipeline on a reconstruction: scale → plane → heightmap volume."""
    points = points_model_units * scale
    normal, d = fit_ground_plane(points)
    volume = heightmap_volume(points, normal, d, cell_m=cell_m)
    heights = points @ normal + d
    stats = {
        "point_count": int(points.shape[0]),
        "max_height_m": float(heights.max()),
        "volume_cum": float(volume),
    }
    return volume, stats
