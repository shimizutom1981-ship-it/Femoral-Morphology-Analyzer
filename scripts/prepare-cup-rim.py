"""Create a portable circular-opening CAD profile from ordered metal-rim points.

The CSV has x,y,z (millimetres) in the coordinate system of the supplied STL.
Points must be selected on the metal shell opening in CAD software, not on a liner.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np


def opening(points):
    if points.ndim != 2 or points.shape[1] != 3 or len(points) < 6 or not np.isfinite(points).all():
        raise ValueError("Supply at least six finite 3D rim points.")
    origin = points.mean(axis=0)
    centered = points - origin
    _, _, axes = np.linalg.svd(centered, full_matrices=False)
    xy = centered @ axes[:2].T
    design = np.column_stack([2 * xy, np.ones(len(xy))])
    coefficients, _, rank, _ = np.linalg.lstsq(design, (xy * xy).sum(axis=1), rcond=None)
    if rank < 3:
        raise ValueError("Rim points are collinear.")
    center = coefficients[:2]
    radii = np.linalg.norm(xy - center, axis=1)
    radius = radii.mean()
    phase = np.sort(np.arctan2(xy[:, 1] - center[1], xy[:, 0] - center[0]))
    if np.diff(np.r_[phase, phase[0] + 2 * np.pi]).max() >= np.pi:
        raise ValueError("Points must span the opening.")
    plane_error = np.max(abs(centered @ axes[2]))
    roundness_error = np.max(abs(radii - radius))
    if not 15 <= 2 * radius <= 100 or max(plane_error, roundness_error) > .05 * radius:
        raise ValueError("Check units, planarity and circularity of the marked rim.")
    return dict(opening_diameter_mm=float(2 * radius), center_mm=(origin + center @ axes[:2]).tolist(),
                plane_normal=axes[2].tolist(), max_radial_residual_mm=float(roundness_error),
                max_plane_residual_mm=float(plane_error), count=len(points))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("stl", "points", "model", "version", "source", "out"):
        parser.add_argument("--" + field, required=True)
    parser.add_argument("--status", choices=["prototype", "dimension_verified"], default="prototype")
    args = parser.parse_args()
    mesh = Path(args.stl)
    if not mesh.is_file() or mesh.stat().st_size == 0:
        raise ValueError("CAD source is empty.")
    points = np.loadtxt(args.points, delimiter=",", skiprows=1, ndmin=2)
    result = dict(schema="fma-cup-cad-rim-v1", model=args.model, version=args.version,
                  source=args.source, status=args.status,
                  cad_sha256=hashlib.sha256(mesh.read_bytes()).hexdigest(), **opening(points))
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
