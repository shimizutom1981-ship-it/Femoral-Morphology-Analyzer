"""ファントムv2で全手法を比較する。python -m phantom.evaluate --out results"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import pandas as pd
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ct_vhu import features as F  # noqa: E402
from ct_vhu import pipeline as P  # noqa: E402
from phantom.phantom_v2 import PHANTOMS, make_phantom  # noqa: E402

DS = 0.05


def ray_profiles(field, gt, z_idx, thetas, smax=21.0):
    sz, sy, sx = gt["spacing"]
    fov = gt["fov"]
    s = np.arange(0, smax, DS)
    TH, S = np.meshgrid(thetas, s, indexing="ij")
    x = S * np.cos(TH)
    y = S * np.sin(TH)
    ix = (x + fov) / sx - 0.5
    iy = (y + fov) / sy - 0.5
    iz = np.full_like(ix, float(z_idx))
    vals = ndi.map_coordinates(field, [iz, iy, ix], order=1, mode="nearest")
    return s, vals


def runs_from_profile(s, v):
    """骨（v≥0）の区間 [(start,end)]、線形補間で亜サンプル位置。"""
    b = v >= 0
    out = []
    i = 0
    n = len(v)
    while i < n:
        if b[i]:
            j = i
            while j + 1 < n and b[j + 1]:
                j += 1
            st = s[i] if i == 0 else s[i - 1] + DS * (0 - v[i - 1]) / (v[i] - v[i - 1] + 1e-9)
            en = s[j] if j == n - 1 else s[j] + DS * (0 - v[j]) / (v[j + 1] - v[j] + 1e-9)
            out.append((st, en))
            i = j + 1
        else:
            i += 1
    return out


def evaluate(field, gt, ct_shape, seconds):
    sz = gt["spacing"][0]
    thetas = np.deg2rad(np.arange(0, 360, 3.0))
    rows = []
    for zi in range(2, ct_shape[0] - 2):
        zmm = (zi + 0.5) * sz
        s, prof = ray_profiles(field, gt, zi, thetas)
        for k, th in enumerate(thetas):
            ro = float(gt["r_out"](th, zmm))
            t = float(gt["thick"](th, zmm))
            ri = ro - t
            dc = abs(np.angle(np.exp(1j * (th - gt["th_calcar"]))))
            in_calcar = dc < np.deg2rad(25)
            in_scl = gt["sclerosis"] is not None and abs(np.angle(np.exp(1j * (th - gt["th_scl"])))) < np.deg2rad(35)
            runs = runs_from_profile(s, prof[k])
            # 外縁：真の外縁 ±1.5 mm にかかる最も外側の骨区間
            cand = [r for r in runs if r[1] > ro - 1.5 and r[0] < ro + 1.5]
            rec = dict(z=zi, theta=np.rad2deg(th), gt_out=ro, gt_in=ri, gt_t=t, calcar=in_calcar, scl=in_scl)
            if gt["metal"] and ri - gt["transition"] / 2 < 7.0:
                rec["near_metal"] = True
            else:
                rec["near_metal"] = False
            if not cand:
                rec.update(found=False)
                rows.append(rec)
                continue
            run = max(cand, key=lambda r: r[1])
            rec.update(found=True, out=run[1], inn=run[0], err_out=run[1] - ro, err_in=run[0] - ri,
                       t_meas=run[1] - run[0])
            inner_runs = [r for r in runs if r[1] < run[0] - 1e-6]
            if in_calcar:
                cg = gt["calcar_gap"]
                c_out = ri - gt["transition"] / 2 - cg
                c_in = c_out - 1.2
                hit = [r for r in inner_runs if r[1] > c_in - 0.75 and r[0] < c_out + 0.75]
                rec["calcar_separated"] = bool(hit) and abs(run[0] - ri) < 0.75
                rec["calcar_med_err"] = (hit[-1][0] - c_in) if hit else np.nan
                rec["calcar_c_out"] = c_out
            rows.append(rec)
    df = pd.DataFrame(rows)
    res = {}
    ok = df[~df.near_metal & ~df.calcar & ~df.scl]
    found = ok[ok.found]
    res["outer_MAE_mm"] = found.err_out.abs().mean()
    res["outer_bias_mm"] = found.err_out.mean()
    res["inner_MAE_mm"] = found.err_in.abs().mean()
    res["inner_bias_mm"] = found.err_in.mean()
    res["thick_MAE_mm"] = (found.t_meas - found.gt_t).abs().mean()
    res["found_rate"] = ok.found.astype(float).mean()
    thin = ok[ok.gt_t < 1.0]
    res["thin_retained"] = (thin.found.astype(bool) & (thin["err_out"].astype(float).abs() < 1.0)).astype(float).mean() if len(thin) else np.nan
    thick = found[found.gt_t > 3.0]
    res["thick_split"] = (thick.err_in.astype(float) > 0.75).astype(float).mean() if len(thick) else np.nan
    # 凹凸：外縁誤差の高周波成分（隣接レイとの差の標準偏差）
    rough = []
    for _, g in found.sort_values("theta").groupby("z"):
        e = g.err_out.values
        if len(e) > 10:
            rough.append(np.std(np.diff(e)))
    res["outer_roughness_mm"] = float(np.mean(rough)) if rough else np.nan
    cal = df[df.calcar & ~df.near_metal & df.found]
    if len(cal) and "calcar_separated" in cal:
        res["calcar_sep_rate"] = cal.calcar_separated.astype(float).mean()
        res["calcar_med_MAE"] = cal.calcar_med_err.astype(float).abs().mean()
    if gt["metal"]:
        nm = df[df.near_metal & ~df.calcar & ~df.scl]
        nf = nm[nm.found]
        res["metal_found"] = nm.found.astype(float).mean() if len(nm) else np.nan
        res["metal_inner_MAE"] = nf.err_in.abs().mean() if len(nf) else np.nan
        res["metal_outer_MAE"] = nf.err_out.abs().mean() if len(nf) else np.nan
    # 孤立点：高密度微小球（中心値）と単一ボクセルスパイク（そのボクセル）を別集計
    sz_, sy, sx = gt["spacing"]
    fov = gt["fov"]
    def hit(pz, py, px):
        iz, iy, ix = int(pz / sz_), int((py + fov) / sy), int((px + fov) / sx)
        return field[iz, iy, ix] >= 0
    raw_hi = 0
    fp = 0
    for pz, py, px, rad, val in gt["isolated"]:
        fp += hit(pz, py, px)
    res["isolated_speck_FP_rate"] = fp / max(len(gt["isolated"]), 1)
    fs = sum(hit(*c) for c in gt["spikes"])
    res["isolated_spike_FP_rate"] = fs / max(len(gt["spikes"]), 1)
    res["isolated_FP_rate"] = (fp + fs) / max(len(gt["isolated"]) + len(gt["spikes"]), 1)
    if gt["sclerosis"] is not None:
        res["sclerosis_retained"] = float((field[gt["sclerosis"]] >= 0).mean())
    # 皮質 Dice / HD95（calcar・硬化・金属近傍を除いた環状帯）
    band = ndi.binary_dilation(gt["cortex"], iterations=4)
    excl = ndi.binary_dilation(gt["calcar"], iterations=2)
    if gt["sclerosis"] is not None:
        excl |= ndi.binary_dilation(gt["sclerosis"], iterations=2)
    if gt["stem"] is not None:
        excl |= ndi.binary_dilation(gt["stem"], iterations=3)
    roi = band & ~excl
    roi[:2] = False
    roi[-2:] = False
    pred = (field >= 0) & roi
    ref = gt["cortex"] & roi
    res["dice_cortex"] = 2 * (pred & ref).sum() / max(pred.sum() + ref.sum(), 1)
    res["hd95_mm"] = hd95(pred, ref, gt["spacing"])
    res["seconds"] = seconds
    return res, df


def hd95(a, b, spacing):
    if not a.any() or not b.any():
        return np.nan
    sa = a & ~ndi.binary_erosion(a)
    sb = b & ~ndi.binary_erosion(b)
    da = ndi.distance_transform_edt(~sb, sampling=spacing)[sa]
    db = ndi.distance_transform_edt(~sa, sampling=spacing)[sb]
    return float(np.percentile(np.concatenate([da, db]), 95))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="results")
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    allrows = []
    for name, kw in PHANTOMS:
        if args.only and name not in args.only:
            continue
        t0 = time.perf_counter()
        ct, gt = make_phantom(**kw)
        metal = F.metal_mask(ct, gt["spacing"]) if gt["metal"] else None
        fields = P.method_fields(ct, gt["spacing"], metal=metal)
        for mname, (field, sec, meta) in fields.items():
            res, _ = evaluate(field, gt, ct.shape, sec)
            res.update(phantom=name, method=mname, **{f"meta_{k}": v for k, v in meta.items()})
            allrows.append(res)
        print(f"{name}: {len(fields)} methods, {time.perf_counter() - t0:.1f}s", flush=True)
    df = pd.DataFrame(allrows)
    df.to_csv(os.path.join(args.out, "phantom_v2_all.csv"), index=False)
    print("saved", len(df))


if __name__ == "__main__":
    main()
