"""phantom_v2_all.csv を集約して表・図を作る。"""
import os
import sys

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

plt.rcParams["font.family"] = ["Noto Sans CJK JP", "DejaVu Sans"]

res = sys.argv[1] if len(sys.argv) > 1 else "results"
d = pd.read_csv(os.path.join(res, "phantom_v2_all.csv"))
d["group"] = d.phantom.str[0].map({"N": "正常型", "O": "骨粗鬆症型", "H": "皮質内不均一", "S": "骨硬化", "M": "金属"})
cols = ["outer_MAE_mm", "outer_bias_mm", "inner_MAE_mm", "inner_bias_mm", "thick_MAE_mm", "found_rate",
        "thin_retained", "thick_split", "outer_roughness_mm", "calcar_sep_rate", "calcar_med_MAE",
        "isolated_speck_FP_rate", "isolated_spike_FP_rate", "sclerosis_retained", "dice_cortex", "hd95_mm", "seconds"]
nonmetal = d[d.group != "金属"]
agg = nonmetal.groupby("method")[cols].mean()
metal = d[d.group == "金属"].groupby("method")[["metal_found", "metal_inner_MAE", "metal_outer_MAE", "outer_MAE_mm",
                                                 "inner_MAE_mm", "thin_retained", "isolated_FP_rate"]].mean()
metal.columns = ["metal_" + c if not c.startswith("metal") else c for c in metal.columns]
full = agg.join(metal)
full.to_csv(os.path.join(res, "phantom_v2_by_method.csv"))

# 統合スコア（低いほど良い）：境界誤差＋薄皮質喪失＋孤立点＋厚皮質の割れ＋HD95
full["score"] = (full.outer_MAE_mm + full.inner_MAE_mm + (1 - full.thin_retained) + full.isolated_speck_FP_rate
                 + full.isolated_spike_FP_rate + full.thick_split + 0.25 * full.hd95_mm)
full.sort_values("score").to_csv(os.path.join(res, "phantom_v2_ranked.csv"))

# 群別（主要手法）
key = ["M1_fixed450", "M4_mean_sph_r1.0", "M4_mean_sph_r2.0", "M4_median_sph_r1.5", "M4_gauss_r1.0", "M4_mean_axial_r1.5",
       "M4_oriented_r1.5", "M5_grad_continuity", "M6_multiscale", "M6_adaptive", "M6_adaptive_v20", "M6_or_capnone"]
grp = d[d.method.isin(key)].groupby(["group", "method"])[["outer_MAE_mm", "inner_MAE_mm", "thin_retained",
                                                          "calcar_sep_rate", "isolated_FP_rate", "sclerosis_retained",
                                                          "dice_cortex"]].mean()
grp.to_csv(os.path.join(res, "phantom_v2_by_group.csv"))

# calcar 間隙別
d["gap"] = d.phantom.str.extract(r"gap([\d.]+)").astype(float)
gap = d[d.method.isin(key) & (d.group != "金属")].groupby(["method", "gap"]).calcar_sep_rate.mean().unstack()
gap.to_csv(os.path.join(res, "phantom_v2_calcar_by_gap.csv"))

# 図1：半径別（球平均・中央値・Gauss・骨軸楕円体・表面方向）
fig, ax = plt.subplots(1, 4, figsize=(17, 3.8))
fam = {"M4_mean_sph_r": "球平均", "M4_median_sph_r": "球中央値", "M4_gauss_r": "Gauss重み", "M4_mean_axial_r": "骨軸楕円体",
       "M4_oriented_r": "表面方向楕円体"}
for pre, lab in fam.items():
    sub = agg[agg.index.str.startswith(pre)].copy()
    sub["r"] = sub.index.str.replace(pre, "").astype(float)
    sub = sub.sort_values("r")
    ax[0].plot(sub.r, sub.inner_bias_mm, "o-", label=lab)
    ax[1].plot(sub.r, sub.thin_retained, "o-", label=lab)
    ax[2].plot(sub.r, sub.isolated_speck_FP_rate, "o-", label=lab)
    ax[3].plot(sub.r, sub.calcar_sep_rate, "o-", label=lab)
for a, t in zip(ax, ["内縁の偏り mm（負＝髄腔側）", "薄い皮質(<1 mm)の保持率", "孤立高密度点の誤検出率", "calcar分離率（全間隙）"]):
    a.set_title(t, fontsize=10)
    a.set_xlabel("半径 mm")
    a.axhline(agg.loc["M1_fixed450", {0: "inner_bias_mm", 1: "thin_retained", 2: "isolated_speck_FP_rate", 3: "calcar_sep_rate"}[list(ax).index(a)]],
              color="k", ls=":", lw=1, label="固定450 HU")
    for m, c in [("M6_adaptive_v20", "crimson")]:
        a.axhline(agg.loc[m, {0: "inner_bias_mm", 1: "thin_retained", 2: "isolated_speck_FP_rate", 3: "calcar_sep_rate"}[list(ax).index(a)]],
                  color=c, ls="--", lw=1.2, label="推奨M6適応型")
ax[0].legend(fontsize=7)
plt.tight_layout()
plt.savefig(os.path.join(res, "fig_radius_tradeoff.png"), dpi=110)

pd.set_option("display.width", 250)
show = ["outer_MAE_mm", "inner_MAE_mm", "inner_bias_mm", "thin_retained", "thick_split", "outer_roughness_mm",
        "calcar_sep_rate", "isolated_speck_FP_rate", "isolated_spike_FP_rate", "sclerosis_retained", "dice_cortex", "hd95_mm",
        "metal_found", "metal_inner_MAE", "seconds", "score"]
print(full.sort_values("score")[show].round(3).to_string())
print()
print(gap.round(2).to_string())
print()
print(grp.round(3).to_string())
