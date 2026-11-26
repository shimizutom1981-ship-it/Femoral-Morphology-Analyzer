"""皮質厚マップ（推奨パイプライン）の真値比較。python -m phantom.thickness_check"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ct_vhu import pipeline as P  # noqa: E402
from ct_vhu.io import Volume  # noqa: E402
from phantom.phantom_v2 import PHANTOMS, make_phantom  # noqa: E402

rows = []
for name in ["N2_gap1_tr1.0", "N4_gap3_tr1.5", "O2_gap1_tr1.5", "O4_gap3_tr0.5", "H1_hetero_gap1", "H2_hetero_gap2_trab"]:
    ct, gt = make_phantom(**dict(PHANTOMS)[name])
    v = Volume(ct, gt["spacing"], (-22.0, -22.0, 0.0))
    maps, _ = P.compute_maps(v, presence="adaptive")
    th = maps["cortical_thickness_mm"][0]
    for zi in range(3, ct.shape[0] - 3):
        zmm = zi + 0.5
        for tdeg in range(0, 360, 6):
            t = np.deg2rad(tdeg)
            if abs(np.angle(np.exp(1j * (t - gt["th_calcar"])))) < np.deg2rad(30):
                continue
            ro = gt["r_out"](t, zmm)
            T = gt["thick"](t, zmm)
            rm = ro - T / 2
            iy, ix = int((rm * np.sin(t) + 22) / 0.72), int((rm * np.cos(t) + 22) / 0.72)
            rows.append(dict(phantom=name, true_t=T, meas=float(th[zi, iy, ix])))
d = pd.DataFrame(rows)
d["bin"] = pd.cut(d.true_t, [0, 1, 2, 4, 8], labels=["<1", "1–2", "2–4", "4–8"])
d["det"] = d.meas > 0
d["err"] = np.where(d.det, d.meas - d.true_t, np.nan)
out = d.groupby("bin", observed=True).agg(n=("true_t", "size"), detected=("det", "mean"), bias=("err", "mean"),
                                          mae=("err", lambda x: np.nanmean(np.abs(x))))
print(out.round(2).to_string())
print(d.groupby(["phantom","bin"], observed=True).agg(det=("det","mean"), bias=("err","mean"), mae=("err", lambda x: np.nanmean(np.abs(x)))).round(2).to_string())
os.makedirs("results", exist_ok=True)
out.to_csv("results/thickness_map_check.csv")
