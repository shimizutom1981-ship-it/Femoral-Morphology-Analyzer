"""実CTで CT-vHU 一式を作る（PCで実行）。

例（匿名化済みCT、研究IDフォルダ内に出力）:
  python run_ctvhu.py --ct "D:\\磐田CDデータ\\1735623\\ct.nrrd" ^
      --roi "D:\\磐田CDデータ\\1735623\\uemura_femur_R.nrrd" ^
      --out "D:\\磐田CDデータ\\1735623\\ct_vhu_v0.1" ^
      --compare uemura="...\\uemura_femur_R.nrrd" gpt_cad="...\\HU450_all.nrrd"

--ct は NRRD/NIfTI/DICOMフォルダ。元ファイルは読むだけで書き換えない。
--roi は大腿骨の大まかなマスク（上村AIの外形など）。指定時はその外接箱＋余白だけを処理する。
出力：連続値マップ（NRRD＋来歴JSON）、ラベル、STL（LPS）、確認点（.mrk.json）、比較表、params.json。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ct_vhu import features as F  # noqa: E402
from ct_vhu import io as IO  # noqa: E402
from ct_vhu import mesh_compare as MC  # noqa: E402
from ct_vhu import pipeline as P  # noqa: E402


def bbox_from_mask(mask, margin_vox):
    idx = np.argwhere(mask)
    lo = np.maximum(idx.min(0) - margin_vox, 0)
    hi = np.minimum(idx.max(0) + margin_vox + 1, mask.shape)
    return tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))


def resample_like(mask_vol, ref):
    """比較マスクを CT 格子へ（最近傍）。同一格子ならそのまま。"""
    if mask_vol.data.shape == ref.data.shape and np.allclose(mask_vol.spacing, ref.spacing) and \
            np.allclose(mask_vol.origin, ref.origin, atol=1e-3):
        return mask_vol.data > 0
    import SimpleITK as sitk
    img = sitk.GetImageFromArray((mask_vol.data > 0).astype(np.uint8))
    img.SetSpacing(mask_vol.spacing[::-1]); img.SetOrigin(mask_vol.origin); img.SetDirection(mask_vol.direction)
    refimg = sitk.GetImageFromArray(np.zeros(ref.data.shape, np.uint8))
    refimg.SetSpacing(ref.spacing[::-1]); refimg.SetOrigin(ref.origin); refimg.SetDirection(ref.direction)
    out = sitk.Resample(img, refimg, sitk.Transform(), sitk.sitkNearestNeighbor, 0)
    return sitk.GetArrayFromImage(out) > 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ct", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--roi")
    ap.add_argument("--roi-label", type=int, default=None, help="ROIマスクのラベル値（左右別ラベル時）")
    ap.add_argument("--margin-mm", type=float, default=8.0)
    ap.add_argument("--presence", default="adaptive", choices=["adaptive", "or", "single", "none"])
    ap.add_argument("--use-roi-as-outer", action="store_true",
                    help="ROIマスク（上村AI外形など）を骨膜側エンベロープに併用（薄い皮質が写らない部位の補助）")
    ap.add_argument("--compare", nargs="*", default=[], help="name=path のマスク（NRRD等）")
    ap.add_argument("--with-median", action="store_true")
    ap.add_argument("--with-oriented", action="store_true")
    ap.add_argument("--review-points", type=int, default=20)
    a = ap.parse_args()

    t0 = time.perf_counter()
    if os.path.abspath(a.out).startswith(os.path.abspath(a.ct)) and os.path.isdir(a.ct):
        raise SystemExit("出力先をDICOMフォルダの中にしないでください（元データ保護）")
    os.makedirs(a.out, exist_ok=True)
    ct = IO.load_volume(a.ct)
    roi_full = None
    if a.roi:
        rv = IO.load_volume(a.roi)
        if a.roi_label is not None:
            rv.data = (rv.data == a.roi_label).astype(np.uint8)
        roi_full = resample_like(rv, ct)
        margin = np.ceil(a.margin_mm / np.asarray(ct.spacing)).astype(int)
        sl = bbox_from_mask(roi_full, margin)
        work = ct.crop(*sl)
        roi = roi_full[sl]
    else:
        sl = tuple(slice(0, n) for n in ct.data.shape)
        work, roi = ct, None

    params = dict(P.RECOMMENDED)
    params["presence"] = a.presence
    maps, aux = P.compute_maps(work, params, with_median=a.with_median, with_oriented=a.with_oriented,
                               presence=a.presence, outer_mask=roi if a.use_roi_as_outer else None)
    field, bone, env, shell, canal = aux["field"], aux["bone"], aux["envelope"], aux["shell"], aux["canal"]
    internal = aux["internal"]

    prov = IO.provenance(params, work, dict(crop_zyx=[[s.start, s.stop] for s in sl],
                                            roi=os.path.abspath(a.roi) if a.roi else None))
    written = {}
    for name, (arr, desc) in maps.items():
        pth = os.path.join(a.out, f"ctvhu_{name}.nrrd")
        IO.save_volume(arr, work, pth, {**prov, "map": name, "description": desc},
                       dtype=np.uint8 if name == "labels" else np.float32)
        written[name] = pth

    # CAD（連続値の境界場から派生）
    v, f = MC.surface_from_field(MC.outer_field(field, canal), work, 0.0)
    IO.write_stl(os.path.join(a.out, "ctvhu_outer_LPS.stl"), v, f, "CT-vHU outer")
    v2, f2 = MC.surface_from_field(shell.astype(np.float32), work, 0.5, keep_largest=False, smooth_sigma_mm=0.35)
    IO.write_stl(os.path.join(a.out, "ctvhu_shell_LPS.stl"), v2, f2, "CT-vHU cortical shell")

    # 手法間の不一致 → 確認点
    meth = P.method_fields(work.data, work.spacing, metal=aux["metal"],
                           which=["M1_fixed450", "M4_mean_sph_r2.0", "M5_grad_continuity", "M6_multiscale", "M6_adaptive"],
                           extra_caps=False)
    pts = MC.disagreement_points({k: v[0] for k, v in meth.items()}, env, work, a.review_points)
    for p in pts:
        p["desc"] = f"骨判定: {', '.join(p['bone_by']) or 'なし'} / 不一致体積 {p['vol_mm3']:.1f} mm³"
    MC.write_markups(os.path.join(a.out, "ctvhu_review_points.mrk.json"), pts)

    # 既存モデルとの一致度（真値ではない）
    comp = {}
    for item in a.compare:
        name, pth = item.split("=", 1)
        other = resample_like(IO.load_volume(pth), ct)[sl]
        comp[name] = {"vs_envelope": MC.compare_masks(env, other, work.spacing),
                      "vs_shell": MC.compare_masks(shell, other, work.spacing),
                      "vs_bone": MC.compare_masks(bone, other, work.spacing)}
    if roi is not None:
        comp["roi_input"] = {"vs_envelope": MC.compare_masks(env, roi, work.spacing)}
    timing = {k: v[1] for k, v in meth.items()}
    summary = dict(provenance=prov, outputs=written, n_review_points=len(pts), agreement_not_accuracy=comp,
                   method_seconds=timing, total_seconds=time.perf_counter() - t0,
                   volumes_ml=dict(envelope=float(env.sum() * np.prod(work.spacing) / 1000),
                                   shell=float(shell.sum() * np.prod(work.spacing) / 1000),
                                   internal_high_density=float(internal.sum() * np.prod(work.spacing) / 1000)))
    with open(os.path.join(a.out, "ctvhu_summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=2, default=float)
    with open(os.path.join(a.out, "params.json"), "w", encoding="utf-8") as fh:
        json.dump(params, fh, ensure_ascii=False, indent=2, default=str)
    print(json.dumps(dict(out=a.out, seconds=round(summary["total_seconds"], 1), review_points=len(pts)), ensure_ascii=False))


if __name__ == "__main__":
    main()
