"""Synthetic-cloud tests for the volume pipeline (pure numpy, no OpenSfM)."""

import numpy as np
import pytest

from volume import (
    VolumeError,
    fit_ground_plane,
    heightmap_volume,
    marker_scale,
    pile_volume_cum,
)

RNG = np.random.default_rng(42)


def make_ground(extent_m: float = 6.0, n: int = 20000, noise: float = 0.005) -> np.ndarray:
    xy = RNG.uniform(-extent_m / 2, extent_m / 2, size=(n, 2))
    z = RNG.normal(0, noise, size=(n, 1))
    return np.hstack([xy, z])


def make_cone(radius_m: float, height_m: float, n: int = 60000) -> np.ndarray:
    """Points on the surface of a cone sitting at origin (analytic V = πr²h/3)."""
    # sample radius proportional to circumference for even surface coverage
    r = radius_m * np.sqrt(RNG.uniform(0, 1, n))
    theta = RNG.uniform(0, 2 * np.pi, n)
    z = height_m * (1 - r / radius_m)
    x = r * np.cos(theta)
    y = r * np.sin(theta)
    return np.column_stack([x, y, z])


def make_box(l: float, w: float, h: float, n: int = 60000) -> np.ndarray:
    """Points on the top surface + sides of a rectangular stack (V = l·w·h)."""
    top = np.column_stack(
        [
            RNG.uniform(-l / 2, l / 2, n),
            RNG.uniform(-w / 2, w / 2, n),
            np.full(n, h),
        ]
    )
    return top


class TestPlaneFit:
    def test_recovers_horizontal_ground(self):
        points = make_ground()
        normal, d = fit_ground_plane(points)
        assert abs(abs(normal[2]) - 1.0) < 0.01  # normal ≈ ±z
        assert abs(d) < 0.02

    def test_recovers_tilted_ground(self):
        points = make_ground()
        # tilt by 10 degrees about x
        angle = np.deg2rad(10)
        rot = np.array(
            [
                [1, 0, 0],
                [0, np.cos(angle), -np.sin(angle)],
                [0, np.sin(angle), np.cos(angle)],
            ]
        )
        tilted = points @ rot.T
        normal, _ = fit_ground_plane(tilted)
        expected = rot @ np.array([0, 0, 1.0])
        assert abs(abs(normal.dot(expected)) - 1.0) < 0.01

    def test_too_few_points(self):
        with pytest.raises(VolumeError):
            fit_ground_plane(np.zeros((10, 3)))


class TestVolume:
    def test_cone_volume_within_2pct(self):
        radius, height = 2.0, 1.5
        analytic = np.pi * radius**2 * height / 3
        cloud = np.vstack([make_ground(extent_m=8.0), make_cone(radius, height)])
        volume, stats = pile_volume_cum(cloud, scale=1.0)
        assert abs(volume - analytic) / analytic < 0.02, f"{volume} vs {analytic}"
        assert abs(stats["max_height_m"] - height) < 0.05

    def test_box_volume_within_2pct(self):
        l, w, h = 3.0, 2.0, 1.2
        analytic = l * w * h
        cloud = np.vstack([make_ground(extent_m=8.0), make_box(l, w, h)])
        volume, _ = pile_volume_cum(cloud, scale=1.0)
        assert abs(volume - analytic) / analytic < 0.02, f"{volume} vs {analytic}"

    def test_scale_applies_cubically(self):
        # Same cloud in "model units" at half scale must give the same volume
        # once the scale factor is applied.
        radius, height = 2.0, 1.5
        analytic = np.pi * radius**2 * height / 3
        cloud = np.vstack([make_ground(extent_m=8.0), make_cone(radius, height)])
        volume, _ = pile_volume_cum(cloud * 0.5, scale=2.0)
        assert abs(volume - analytic) / analytic < 0.02

    def test_flat_ground_only_fails(self):
        with pytest.raises(VolumeError):
            volume, _ = pile_volume_cum(make_ground(), scale=1.0)


class TestMarkerScale:
    def test_square_marker(self):
        # 0.4 m marker reconstructed at edge length 0.1 model units → scale 4
        corners = np.array(
            [[0, 0, 0], [0.1, 0, 0], [0.1, 0.1, 0], [0, 0.1, 0]], dtype=float
        )
        assert abs(marker_scale(corners, 0.4) - 4.0) < 1e-9

    def test_inconsistent_corners_rejected(self):
        corners = np.array([[0, 0, 0], [0.1, 0, 0], [0.3, 0.3, 0], [0, 0.1, 0]], dtype=float)
        with pytest.raises(VolumeError):
            marker_scale(corners, 0.4)
