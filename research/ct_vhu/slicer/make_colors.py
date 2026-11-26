"""Slicer 用カラーテーブル（.ctbl）と症例共通の表示範囲（display_ranges.json）を作る。"""
import json
import os

import matplotlib

HERE = os.path.dirname(os.path.abspath(__file__))

RANGES = {
    "vhu_mean_r1.5": dict(min=-200, max=1600, cmap="ctvhu_turbo", unit="HU"),
    "vhu_mean_r2": dict(min=-200, max=1600, cmap="ctvhu_turbo", unit="HU"),
    "vhu_mean_r3": dict(min=-200, max=1600, cmap="ctvhu_turbo", unit="HU"),
    "vhu_presence": dict(min=-200, max=1600, cmap="ctvhu_turbo", unit="HU"),
    "vhu_median_r1.5": dict(min=-200, max=1600, cmap="ctvhu_turbo", unit="HU"),
    "vhu_oriented_r2": dict(min=-200, max=1600, cmap="ctvhu_turbo", unit="HU"),
    "vhu_sd_r2": dict(min=0, max=500, cmap="ctvhu_magma", unit="HU"),
    "vhu_occ450_r2": dict(min=0, max=1, cmap="ctvhu_viridis", unit="fraction"),
    "grad_mag": dict(min=0, max=1500, cmap="ctvhu_magma", unit="HU/mm"),
    "continuity_log10mm3": dict(min=0, max=5, cmap="ctvhu_viridis", unit="log10 mm3", threshold_below=0.01),
    "t_local": dict(min=400, max=800, cmap="ctvhu_plasma", unit="HU"),
    "boundary_field": dict(min=-600, max=600, cmap="ctvhu_coolwarm", unit="HU"),
    "cortical_thickness_mm": dict(min=0, max=8, cmap="ctvhu_plasma", unit="mm", threshold_below=0.05),
    "labels": dict(min=0, max=4, cmap="ctvhu_labels", unit="label"),
}

LABELS = [(0, "background", (0, 0, 0, 0)), (1, "cortical_shell", (30, 200, 200, 255)),
          (2, "internal_high_density", (255, 210, 0, 255)), (3, "isolated_high_HU", (255, 0, 200, 255)),
          (4, "metal_excluded", (120, 120, 120, 255))]


def write_ctbl(path, cmap_name):
    cm = matplotlib.colormaps[cmap_name]
    with open(path, "w") as f:
        f.write(f"# Color table {os.path.basename(path)} from matplotlib {cmap_name}\n")
        for i in range(256):
            r, g, b, _ = cm(i / 255)
            f.write(f"{i} c{i} {int(r * 255)} {int(g * 255)} {int(b * 255)} 255\n")


def main(out=HERE):
    cdir = os.path.join(out, "colors")
    os.makedirs(cdir, exist_ok=True)
    for name in ["turbo", "magma", "viridis", "plasma", "coolwarm"]:
        write_ctbl(os.path.join(cdir, f"ctvhu_{name}.ctbl"), name)
    with open(os.path.join(cdir, "ctvhu_labels.ctbl"), "w") as f:
        for i, n, (r, g, b, a) in LABELS:
            f.write(f"{i} {n} {r} {g} {b} {a}\n")
    with open(os.path.join(out, "display_ranges.json"), "w", encoding="utf-8") as f:
        json.dump(RANGES, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
