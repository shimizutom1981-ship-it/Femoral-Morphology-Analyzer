"""合成ファントム v2：真値既知の大腿骨骨幹〜近位断面モデル。

v1（2026-11-26 Claude, D:\\磐田CDデータ\\1735623\\local_vhu_claude_20261126）で不足していた
皮質内不均一（多孔・密度ゆらぎ）、骨内膜側の海綿骨化移行帯、骨硬化（高密度海綿骨）、
髄腔内骨梁、金属ステムのストリークを加えた。

高解像度格子で解析的に作成 → PSF（面内FWHM 0.9 mm, 体軸 1.2 mm）→ ボクセル積分 →
CT格子（0.72×0.72×1.0 mm）で標本化 → 相関ノイズ。
真値：外縁 R_out(θ,z)、内縁 R_in(θ,z)＝移行帯の中央、calcar板、骨硬化域、孤立点中心。
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi

HI_XY = 0.15
HI_Z = 0.25
CT_SP = (1.0, 0.72, 0.72)  # z, y, x
FOV = 22.0                 # ±mm
ZLEN = 24.0


def _smooth_noise(shape, sigma_vox, rng):
    n = rng.standard_normal(shape).astype(np.float32)
    n = ndi.gaussian_filter(n, sigma_vox)
    return n / (n.std() + 1e-9)


def make_phantom(kind="normal", seed=0, calcar_gap=1.0, transition_mm=1.0, metal=False,
                 n_isolated=40, noise_sd=30.0, trab_vf=0.0, sclerosis=False, porosity=0.06):
    rng = np.random.default_rng(seed)
    nx = int(round(2 * FOV / HI_XY))
    nz = int(round(ZLEN / HI_Z))
    x = (np.arange(nx) + 0.5) * HI_XY - FOV
    z = (np.arange(nz) + 0.5) * HI_Z
    Z, Y, X = np.meshgrid(z, x, x, indexing="ij")
    R = np.hypot(X, Y)
    TH = np.arctan2(Y, X)

    if kind == "osteoporotic":
        t_min, t_max, cort_hu, marrow_hu = 0.40, 3.0, 1050.0, -70.0
    elif kind == "heterogeneous":
        t_min, t_max, cort_hu, marrow_hu = 0.8, 6.5, 1400.0, -40.0
        porosity = max(porosity, 0.15)
    else:
        t_min, t_max, cort_hu, marrow_hu = 0.6, 6.5, 1500.0, -40.0

    def r_out_fn(th, zz):
        a, b = 14.0, 12.0
        r = a * b / np.sqrt((b * np.cos(th)) ** 2 + (a * np.sin(th)) ** 2)
        ridge = 1.8 * np.exp(-0.5 * (np.angle(np.exp(1j * (th - np.pi / 2))) / 0.25) ** 2)  # 粗線様の隆起
        return r + ridge + 0.4 * np.sin(2 * np.pi * zz / ZLEN + th)

    def thick_fn(th, zz):
        c = 0.5 + 0.5 * np.cos(th - 0.3)
        return t_min + (t_max - t_min) * c ** 1.5 * (1 + 0.08 * np.sin(2 * np.pi * zz / ZLEN))

    Ro = r_out_fn(TH, Z)
    T = thick_fn(TH, Z)
    Ri = Ro - T
    w = max(transition_mm, 1e-3)

    # 皮質密度：内縁側の移行帯で骨量分率が線形に低下（移行帯中央＝真値の内縁）
    frac = np.clip((R - (Ri - w / 2)) / w, 0, 1)  # 0=髄腔側, 1=緻密皮質
    in_cortex_env = R <= Ro
    het = 1.0 + 0.12 * _smooth_noise(R.shape, (1.0 / HI_Z, 1.0 / HI_XY, 1.0 / HI_XY), rng)
    cort = cort_hu * het
    # 多孔（Havers管様）：総体積分率≈porosity、内側ほど多い
    pores = np.zeros(R.shape, bool)
    cand = np.flatnonzero(in_cortex_env & (R >= Ri - w / 2))
    if porosity > 0 and cand.size:
        wts = np.clip(1.2 - frac.ravel()[cand], 0.2, 1.0)
        wts = wts / wts.sum()
        for rad in (0.15, 0.25, 0.35):
            vox = (4 / 3) * np.pi * rad ** 3 / (HI_XY * HI_XY * HI_Z)
            n_r = int(porosity * cand.size / 3 / vox)
            pick = rng.choice(cand, size=n_r, p=wts)
            seed_m = np.zeros(R.size, bool)
            seed_m[pick] = True
            seed_m = seed_m.reshape(R.shape)
            rz, rxy = int(np.ceil(rad / HI_Z)), int(np.ceil(rad / HI_XY))
            g = np.meshgrid(np.arange(-rz, rz + 1) * HI_Z, np.arange(-rxy, rxy + 1) * HI_XY,
                            np.arange(-rxy, rxy + 1) * HI_XY, indexing="ij")
            fp = (g[0] ** 2 + g[1] ** 2 + g[2] ** 2) <= rad ** 2
            pores |= ndi.binary_dilation(seed_m, structure=fp)

    # 髄腔内骨梁（細い板）
    trab = np.zeros(R.shape, bool)
    f = _smooth_noise(R.shape, (0.8 / HI_Z, 0.8 / HI_XY, 0.8 / HI_XY), rng)
    if trab_vf > 0:
        eps = np.quantile(np.abs(f), trab_vf)
        trab = np.abs(f) < eps
    # 骨硬化：内膜に接する高密度海綿骨（θ≈210°）
    scl = np.zeros(R.shape, bool)
    th_s = np.deg2rad(210)
    if sclerosis:
        ri_s = r_out_fn(th_s, Z) - thick_fn(th_s, Z)
        cxs, cys = (ri_s - 3.0) * np.cos(th_s), (ri_s - 3.0) * np.sin(th_s)
        region = (np.hypot(X - cxs, Y - cys) < 3.5) & (R < Ri)
        eps_s = np.quantile(np.abs(f), 0.40)
        scl = region & (np.abs(f) < eps_s)
        scl_region = region
    else:
        scl_region = scl
    # calcar 様の骨板（θ≈135°、内縁から gap 離れて平行、厚さ1.2 mm）
    th_c = np.deg2rad(135)
    dth = np.angle(np.exp(1j * (TH - th_c)))
    sector = np.abs(dth) < np.deg2rad(25)
    calcar = sector & (R <= Ri - w / 2 - calcar_gap) & (R > Ri - w / 2 - calcar_gap - 1.2) & (Z > 1.5) & (Z < ZLEN - 1.5)

    soft = np.where(R < Ro + 3.0, 45.0, -90.0)  # 筋→皮下脂肪
    hu = soft.astype(np.float32)
    hu[R < Ri] = marrow_hu
    mix = in_cortex_env & (R >= Ri - w / 2)
    hu[mix] = (marrow_hu + (cort[mix] - marrow_hu) * frac[mix])
    hu[mix & pores] = marrow_hu + 60.0
    hu[trab & (R < Ri - w / 2)] = 1100.0
    hu[scl] = 1300.0
    hu[calcar] = 1100.0 * (1 + 0.08 * _smooth_noise(R.shape, 3, rng))[calcar]

    stem = np.zeros(R.shape, bool)
    if metal:
        stem = (np.hypot(X / 5.0, Y / 4.0) <= 1.0)
        hu[stem] = 4000.0

    # 孤立高HU点（髄腔・軟部、皮質から2 mm以上）
    iso_centers = []
    tries = 0
    while len(iso_centers) < n_isolated and tries < 5000:
        tries += 1
        px, py, pz = rng.uniform(-FOV + 2, FOV - 2), rng.uniform(-FOV + 2, FOV - 2), rng.uniform(3, ZLEN - 3)
        rr, tt = np.hypot(px, py), np.arctan2(py, px)
        ro, ri = r_out_fn(tt, pz), r_out_fn(tt, pz) - thick_fn(tt, pz)
        if not (rr > ro + 2 or rr < ri - w / 2 - 2):
            continue
        if abs(np.angle(np.exp(1j * (tt - th_c)))) < np.deg2rad(32) and rr < ri:
            continue
        if sclerosis and np.hypot(px - (ri - 3) * np.cos(th_s), py - (ri - 3) * np.sin(th_s)) < 5.5:
            continue
        if metal and np.hypot(px / 5.0, py / 4.0) < 1.6:
            continue
        iso_centers.append((pz, py, px, rng.uniform(0.3, 0.9), rng.uniform(1500, 3000)))
    for pz, py, px, rad, val in iso_centers:
        m = ((Z - pz) ** 2 + (Y - py) ** 2 + (X - px) ** 2) <= rad ** 2
        hu[m] = val

    # PSF + ボクセル積分 + 標本化
    fwhm_xy, fwhm_z = 0.9, 1.2
    s = (fwhm_z / 2.355 / HI_Z, fwhm_xy / 2.355 / HI_XY, fwhm_xy / 2.355 / HI_XY)
    blurred = ndi.gaussian_filter(hu, s, mode="nearest")
    blurred = ndi.uniform_filter(blurred, (int(round(CT_SP[0] / HI_Z)), int(round(CT_SP[1] / HI_XY)),
                                           int(round(CT_SP[2] / HI_XY))), mode="nearest")
    ct_nz = int(ZLEN / CT_SP[0])
    ct_nx = int(2 * FOV / CT_SP[1])
    cz = (np.arange(ct_nz) + 0.5) * CT_SP[0]
    cx = (np.arange(ct_nx) + 0.5) * CT_SP[1] - FOV
    iz = cz / HI_Z - 0.5
    ix = (cx + FOV) / HI_XY - 0.5
    G = np.meshgrid(iz, ix, ix, indexing="ij")
    ct = ndi.map_coordinates(blurred, G, order=1, mode="nearest").astype(np.float32)
    if metal:
        # ストリーク：ステム長軸方向の暗帯と放射状の明暗縞（距離で減衰）
        CZ, CY, CX = np.meshgrid(cz, cx, cx, indexing="ij")
        rr = np.hypot(CX, CY)
        tt = np.arctan2(CY, CX)
        dec = np.exp(-np.maximum(rr - 4.5, 0) / 9.0) * (rr > 4.5)
        ct += (220 * np.cos(10 * tt) - 260 * np.exp(-0.5 * (np.sin(tt) / 0.18) ** 2)) * dec
    # 単一ボクセルの高HUスパイク（雑音・微小石灰化様）：髄腔・軟部に配置
    spikes = []
    CZ, CY, CX = np.meshgrid(cz, cx, cx, indexing="ij")
    rr_ = np.hypot(CX, CY)
    tt_ = np.arctan2(CY, CX)
    ro_ = r_out_fn(tt_, CZ)
    ri_ = ro_ - thick_fn(tt_, CZ)
    ok_ = ((rr_ > ro_ + 2) | (rr_ < ri_ - w / 2 - 2)) & (CZ > 3) & (CZ < ZLEN - 3)
    ok_ &= ~((np.abs(np.angle(np.exp(1j * (tt_ - th_c)))) < np.deg2rad(32)) & (rr_ < ri_))
    if metal:
        ok_ &= np.hypot(CX / 5.0, CY / 4.0) > 1.6
    if sclerosis:
        ok_ &= np.hypot(CX - (ri_ - 3) * np.cos(th_s), CY - (ri_ - 3) * np.sin(th_s)) > 5.5
    cand_s = np.flatnonzero(ok_)
    for i in rng.choice(cand_s, size=min(n_isolated, cand_s.size), replace=False):
        zz_, yy_, xx_ = np.unravel_index(i, ct.shape)
        ct[zz_, yy_, xx_] += rng.uniform(600, 1500)
        spikes.append((float(cz[zz_]), float(cx[yy_]), float(cx[xx_])))
    nz_ = rng.standard_normal(ct.shape).astype(np.float32)
    nz_ = ndi.gaussian_filter(nz_, 0.45)
    ct += noise_sd * nz_ / (nz_.std() + 1e-9)

    # 真値（CT格子）
    def down(mask):
        m = ndi.uniform_filter(mask.astype(np.float32), (int(round(CT_SP[0] / HI_Z)), int(round(CT_SP[1] / HI_XY)),
                                                       int(round(CT_SP[2] / HI_XY))), mode="nearest")
        return ndi.map_coordinates(m, G, order=1) >= 0.5

    gt = dict(
        r_out=r_out_fn, thick=thick_fn, transition=w, calcar_gap=calcar_gap, th_calcar=th_c, th_scl=th_s,
        cortex=down(in_cortex_env & (R >= Ri)), calcar=down(calcar), sclerosis=down(scl_region) if sclerosis else None,
        stem=down(stem) if metal else None, isolated=iso_centers, spikes=spikes,
        spacing=CT_SP, fov=FOV, kind=kind, metal=metal, trab_vf=trab_vf, porosity=porosity,
    )
    return ct, gt


PHANTOMS = [
    # name, kwargs
    ("N1_gap0_tr0.5", dict(kind="normal", seed=101, calcar_gap=0.0, transition_mm=0.5)),
    ("N2_gap1_tr1.0", dict(kind="normal", seed=102, calcar_gap=1.0, transition_mm=1.0)),
    ("N3_gap2_tr1.0_trab", dict(kind="normal", seed=103, calcar_gap=2.0, transition_mm=1.0, trab_vf=0.05)),
    ("N4_gap3_tr1.5", dict(kind="normal", seed=104, calcar_gap=3.0, transition_mm=1.5)),
    ("O1_gap0.5_tr1.0", dict(kind="osteoporotic", seed=201, calcar_gap=0.5, transition_mm=1.0)),
    ("O2_gap1_tr1.5", dict(kind="osteoporotic", seed=202, calcar_gap=1.0, transition_mm=1.5)),
    ("O3_gap2_tr1.0_noise45", dict(kind="osteoporotic", seed=203, calcar_gap=2.0, transition_mm=1.0, noise_sd=45.0)),
    ("O4_gap3_tr0.5", dict(kind="osteoporotic", seed=204, calcar_gap=3.0, transition_mm=0.5)),
    ("H1_hetero_gap1", dict(kind="heterogeneous", seed=301, calcar_gap=1.0, transition_mm=1.0)),
    ("H2_hetero_gap2_trab", dict(kind="heterogeneous", seed=302, calcar_gap=2.0, transition_mm=1.5, trab_vf=0.06)),
    ("S1_sclerosis_gap2", dict(kind="normal", seed=401, calcar_gap=2.0, transition_mm=1.0, sclerosis=True, trab_vf=0.04)),
    ("S2_sclerosis_osteo_gap1", dict(kind="osteoporotic", seed=402, calcar_gap=1.0, transition_mm=1.0, sclerosis=True)),
    ("M1_metal_normal", dict(kind="normal", seed=501, calcar_gap=2.0, transition_mm=1.0, metal=True)),
    ("M2_metal_osteo", dict(kind="osteoporotic", seed=502, calcar_gap=2.0, transition_mm=1.0, metal=True)),
    ("M3_metal_hetero", dict(kind="heterogeneous", seed=503, calcar_gap=1.0, transition_mm=1.5, metal=True)),
    ("M4_metal_normal_noise45", dict(kind="normal", seed=504, calcar_gap=3.0, transition_mm=0.5, metal=True, noise_sd=45.0)),
]
