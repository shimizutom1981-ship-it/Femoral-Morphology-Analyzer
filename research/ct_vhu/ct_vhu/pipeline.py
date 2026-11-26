"""CT-vHU の推奨定義と比較手法。

各手法は連続場 F(x) を返す（F ≥ 0 を骨構造とみなす）。境界は F のゼロ等値面。
推奨（M6, multiscale）:
  存在層   P(x) = mean_{球 r_p}(HU) ≥ T_p                 （骨が立体的に存在するか）
  局所閾値 T(x) = clip( (max_w(HUs) + min_w(HUs)) / 2, T_lo, T_hi )   （元HUの局所半値）
  境界場   B(x) = HUs(x) − T(x)                           （連続値、ゼロ＝境界）
  連続性   成分体積 V(x) ≥ V_min                           （孤立高HU点を除外）
  骨       = P ∧ (B ≥ 0) ∧ (V ≥ V_min) ∧ ¬金属
HUs は σ=0.35 mm の軽いガウス平滑。r_p=3 mm, T_p=300, 窓半径1.5 mm, T_lo=400, T_hi=800, V_min=4 mm³。
"""
from __future__ import annotations

import time

import numpy as np
from scipy import ndimage as ndi

from . import features as F

DEFAULT = dict(
    smooth_sigma_mm=0.35,
    presence_radius_mm=3.0,
    presence_threshold=300.0,
    halfmax_window_mm=1.5,
    t_lo=400.0,
    t_hi=800.0,
    v_min_mm3=4.0,
    fixed_threshold=450.0,
    metal_threshold=2500.0,
    metal_margin_mm=0.75,
    adaptive_radii_mm=(1.0, 1.5, 2.0, 3.0),
)


# 推奨設定（ファントムv2, 2026-11-26）：存在判定は局所厚に応じた適応半径、連続性の最小体積20 mm³
RECOMMENDED = {**DEFAULT, "v_min_mm3": 20.0, "presence": "adaptive"}


def _gate(field, keep, floor=-1.0):
    """keep 外は境界にならないよう負値に落とす（連続性を保つため min を取る）。"""
    out = field.copy()
    out[~keep] = np.minimum(out[~keep], floor)
    return out


def remove_small(field, spacing, v_min):
    m = field >= 0
    vol, _ = F.component_volume_map(m, spacing, 26)
    small = m & (vol < v_min)
    out = field.copy()
    out[small] = -1.0
    return out, small


def local_halfmax_threshold(hus, spacing, window_mm, t_lo, t_hi):
    fp = F.sphere_footprint(window_mm, spacing)
    mx = ndi.maximum_filter(hus, footprint=fp, mode="nearest")
    mn = ndi.minimum_filter(hus, footprint=fp, mode="nearest")
    t = 0.5 * (mx + mn)
    if t_hi is None:
        return np.maximum(t, t_lo).astype(np.float32)
    return np.clip(t, t_lo, t_hi).astype(np.float32)


def presence_layer(hu, spacing, p, mode="single"):
    """骨の存在判定層。mode:
    single   : 球 r_p の局所平均 ≥ T_p（2026-11-26 v1案）
    or       : 球 1/1.5/2/3 mm のいずれかで局所平均 ≥ T_p（薄い皮質は小さい球で拾う）
    adaptive : 予備マスク（固定450＋連続性）の局所厚に応じて球半径を選ぶ（薄→1 mm、厚→3 mm）
    none     : 存在判定なし（局所半値と連続性のみ）
    戻り値：(存在マスク, 存在判定に使った局所平均)
    """
    if mode == "none":
        return np.ones(hu.shape, bool), F.local_mean(hu, spacing, p["presence_radius_mm"])
    radii = np.asarray(p["adaptive_radii_mm"], float)
    if mode == "single":
        m = F.local_mean(hu, spacing, p["presence_radius_mm"])
        pres = m >= p["presence_threshold"]
    elif mode == "or":
        stack = np.stack([F.local_mean(hu, spacing, r) for r in radii], 0)
        m = stack.max(0)
        pres = m >= p["presence_threshold"]
    elif mode == "adaptive":
        hus = F.local_gaussian_mean(hu, spacing, p["smooth_sigma_mm"])
        prelim, _ = remove_small(hus - p["fixed_threshold"], spacing, p["v_min_mm3"])
        th = F.local_thickness(prelim >= 0, spacing)
        th = ndi.maximum_filter(th, footprint=F.sphere_footprint(1.5, spacing))
        want = np.clip(th, radii.min(), radii.max())
        want[th == 0] = radii.min()
        stack = np.stack([F.local_mean(hu, spacing, r) for r in radii], 0)
        k = np.abs(want[None] - radii[:, None, None, None]).argmin(0)
        m = np.take_along_axis(stack, k[None], 0)[0]
        pres = m >= p["presence_threshold"]
    else:
        raise ValueError(mode)
    pres = ndi.binary_dilation(pres, structure=F.sphere_footprint(1.0, spacing))
    return pres, m


def multiscale_field(hu, spacing, p=None, metal=None, presence="single", return_parts=False, adaptive=None):
    p = {**DEFAULT, **(p or {})}
    if adaptive:
        presence = "adaptive"
    hus = F.local_gaussian_mean(hu, spacing, p["smooth_sigma_mm"])
    pres, pres_mean = presence_layer(hu, spacing, p, presence)
    t = local_halfmax_threshold(hus, spacing, p["halfmax_window_mm"], p["t_lo"], p["t_hi"])
    b = (hus - t).astype(np.float32)
    field = _gate(b, pres)
    if metal is not None:
        field[metal] = -1000.0
    field, small = remove_small(field, spacing, p["v_min_mm3"])
    if return_parts:
        return field, dict(hus=hus, presence_mean=pres_mean, presence=pres, t_local=t, b=b, small=small)
    return field


def method_fields(hu, spacing, metal=None, radii=(0.5, 1.0, 1.5, 2.0, 3.0), which=None, extra_caps=True):
    """比較用の全手法。戻り値: name -> (field, seconds, meta)"""
    T = DEFAULT["fixed_threshold"]
    out = {}

    def add(name, fn, meta):
        if which and not any(name.startswith(w) for w in which):
            return
        t0 = time.perf_counter()
        f = fn()
        if metal is not None:
            f = f.copy()
            f[metal] = -1000.0
        out[name] = (f.astype(np.float32), time.perf_counter() - t0, meta)

    add("M1_fixed450", lambda: hu - T, dict(family="M1 固定閾値", r=0))
    for r in radii:
        add(f"M4_mean_sph_r{r}", lambda r=r: F.local_mean(hu, spacing, r) - T, dict(family="M4 局所平均", r=r, shape="球"))
        add(f"M4_mean_axial_r{r}", lambda r=r: F.local_mean(hu, spacing, r, "ellipsoid", (1.6, 0.6, 0.6)) - T,
            dict(family="M4 局所平均", r=r, shape="骨軸楕円体"))
        add(f"M4_gauss_r{r}", lambda r=r: F.local_gaussian_mean(hu, spacing, r / 2) - T,
            dict(family="M4 距離重み平均", r=r, shape="Gauss σ=r/2"))
        if r <= 2.0:
            add(f"M4_median_sph_r{r}", lambda r=r: F.local_percentile(hu, spacing, r, 50) - T,
                dict(family="M4 局所中央値", r=r, shape="球"))
        if r >= 1.0:
            add(f"M4_oriented_r{r}", lambda r=r: F.oriented_mean(hu, spacing, r, r / 2)[0] - T,
                dict(family="M4 表面方向楕円体", r=r, shape="接線r・法線r/2"))
    # M5: 勾配＋連続性（固定閾値の境界、3D連結で孤立点除去、境界は勾配最大＝軽い平滑の半値で近似）
    def m5():
        hus = F.local_gaussian_mean(hu, spacing, DEFAULT["smooth_sigma_mm"])
        f, _ = remove_small(hus - T, spacing, DEFAULT["v_min_mm3"])
        return f
    add("M5_grad_continuity", m5, dict(family="M5 勾配＋連続性", r=0.35))
    add("M6_multiscale", lambda: multiscale_field(hu, spacing, metal=metal), dict(family="M6 マルチスケール", r=3.0))
    add("M6_adaptive", lambda: multiscale_field(hu, spacing, metal=metal, presence="adaptive"),
        dict(family="M6 適応型", r="1–3", presence="adaptive"))
    add("M6_or", lambda: multiscale_field(hu, spacing, metal=metal, presence="or"),
        dict(family="M6 多重スケールOR", r="1–3", presence="or"))
    add("M6_nogate", lambda: multiscale_field(hu, spacing, metal=metal, presence="none"),
        dict(family="M6 存在判定なし", r=0, presence="none"))
    if extra_caps:
        for cap in (700.0, 900.0, 1200.0, None):
            add(f"M6_or_cap{int(cap) if cap else 'none'}",
                lambda cap=cap: multiscale_field(hu, spacing, dict(t_hi=cap), metal=metal, presence="or"),
                dict(family="M6 上限感度", r=3.0, t_hi=cap))
        for tlo in (300.0, 350.0):
            add(f"M6_or_tlo{int(tlo)}", lambda tlo=tlo: multiscale_field(hu, spacing, dict(t_lo=tlo), metal=metal, presence="or"),
                dict(family="M6 下限感度", r="1–3", t_lo=tlo))
        for vm in (10.0, 20.0):
            add(f"M6_adaptive_v{int(vm)}", lambda vm=vm: multiscale_field(hu, spacing, dict(v_min_mm3=vm), metal=metal, presence="adaptive"),
                dict(family="M6 適応型・連続性体積", r="1–3", v_min=vm))
        add("M6_or_vmin0", lambda: multiscale_field(hu, spacing, dict(v_min_mm3=0.0), metal=metal, presence="or"),
            dict(family="M6 連続性なし", r="1–3", v_min=0))
        add("M6_or_win2.5", lambda: multiscale_field(hu, spacing, dict(halfmax_window_mm=2.5), metal=metal, presence="or"),
            dict(family="M6 窓感度", r=3.0, window=2.5))
    return out


# ---------------------------------------------------------------- full map set for one CT
def _disk(r_mm, sy, sx):
    ry, rx = int(np.floor(r_mm / sy)), int(np.floor(r_mm / sx))
    yy, xx = np.meshgrid(np.arange(-ry, ry + 1) * sy, np.arange(-rx, rx + 1) * sx, indexing="ij")
    return (yy ** 2 + xx ** 2) <= r_mm ** 2 + 1e-9


def periosteal_envelope(bone, spacing, close_mm=1.5, outer_mask=None):
    """骨膜側エンベロープ（皮質＋髄腔）。軸位ごとに閉鎖→穴埋め。薄い皮質の途切れで穴埋めに
    失敗した断面は、上下断面の共通部分で補う（失敗断面の番号を返す）。"""
    sz, sy, sx = spacing
    disk = _disk(close_mm, sy, sx)
    sealed3 = ndi.binary_closing(bone, structure=F.sphere_footprint(1.0, spacing))
    env = np.zeros_like(bone)
    for z in range(bone.shape[0]):
        s = ndi.binary_closing(sealed3[z], structure=disk) | sealed3[z]
        env[z] = ndi.binary_fill_holes(s)
    area = env.reshape(env.shape[0], -1).sum(1).astype(float)
    bone_area = bone.reshape(bone.shape[0], -1).sum(1).astype(float)
    failed = []
    for z in range(env.shape[0]):
        nb = [area[k] for k in (z - 2, z - 1, z + 1, z + 2) if 0 <= k < len(area)]
        ref = np.median(nb) if nb else area[z]
        # 穴埋めで面積がほとんど増えない断面＝輪が閉じていない（薄い皮質の途切れ）
        if bone_area[z] > 20 and (area[z] < 1.25 * bone_area[z] or (ref > 0 and area[z] < 0.75 * ref)):
            failed.append(z)
    from skimage.morphology import convex_hull_image

    for z in failed:
        lo = next((k for k in range(z - 1, -1, -1) if k not in failed), None)
        hi = next((k for k in range(z + 1, env.shape[0]) if k not in failed), None)
        if lo is not None and hi is not None:
            env[z] |= env[lo] & env[hi]
        elif sealed3[z].sum() > 20:
            # 連続して失敗する区間（薄い皮質が広く写らない等）は断面の凸包で代替
            env[z] |= convex_hull_image(sealed3[z])
    if outer_mask is not None:
        # AI外形（上村モデル等）が与えられればそれを骨膜側の外形として併用
        om = outer_mask.astype(bool)
        for z in range(om.shape[0]):
            om[z] = ndi.binary_fill_holes(om[z])
        env |= om
    return env, failed


def shell_and_internal(bone, spacing, canal_open_mm=0.75, canal_close_mm=2.0, outer_mask=None):
    """骨膜側エンベロープ・皮質殻・殻内の高密度構造（calcar・骨梁・骨硬化）を分ける。"""
    env, _ = periosteal_envelope(bone, spacing, outer_mask=outer_mask)
    med = env & ~bone
    med = ndi.binary_opening(med, structure=F.sphere_footprint(canal_open_mm, spacing))
    lab, n = ndi.label(med)
    if n:
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        keep = sizes >= max(sizes.max() * 0.05, 1)
        med = keep[lab]
    canal = ndi.binary_closing(med, structure=F.sphere_footprint(canal_close_mm, spacing)) & env
    shell = env & ~canal & bone
    internal = bone & canal
    return env, shell, internal, canal


def compute_maps(vol, params=None, with_median=False, with_oriented=False, presence="adaptive", outer_mask=None):
    """1症例の CT-vHU 一式（連続値＋派生）。戻り値: name -> (array, description)"""
    p = {**RECOMMENDED, **(params or {})}
    hu = vol.data.astype(np.float32)
    sp = vol.spacing
    metal = F.metal_mask(hu, sp, p["metal_threshold"], p["metal_margin_mm"])
    field, parts = multiscale_field(hu, sp, p, metal=metal, presence=presence, return_parts=True)
    bone = field >= 0
    env, shell, internal, canal = shell_and_internal(bone, sp, outer_mask=outer_mask)
    maps = {}
    maps["vhu_mean_r1.5"] = (F.local_mean(hu, sp, 1.5), "球半径1.5 mm 局所平均HU")
    maps["vhu_mean_r2"] = (F.local_mean(hu, sp, 2.0), "球半径2 mm 局所平均HU")
    maps["vhu_mean_r3"] = (F.local_mean(hu, sp, 3.0), "球半径3 mm 局所平均HU")
    maps["vhu_presence"] = (parts["presence_mean"], f"存在判定に用いた局所平均HU（presence={presence}）")
    maps["vhu_sd_r2"] = (F.local_sd(hu, sp, 2.0), "球半径2 mm 局所SD")
    maps["vhu_occ450_r2"] = (F.occupancy(hu, sp, 2.0, 450.0), "球半径2 mm 内の450 HU以上占有率 0–1")
    if with_median:
        maps["vhu_median_r1.5"] = (F.local_percentile(hu, sp, 1.5, 50), "球半径1.5 mm 局所中央値")
    if with_oriented:
        maps["vhu_oriented_r2"] = (F.oriented_mean(hu, sp, 2.0, 1.0, mask=ndi.binary_dilation(env, iterations=2))[0],
                                   "表面方向楕円体（接線2・法線1 mm）局所平均")
    maps["grad_mag"] = (F.gradient_magnitude(hu, sp, 0.5), "HU勾配強度 HU/mm（σ0.5 mm）")
    maps["continuity_log10mm3"] = (F.continuity_map(hu, sp, 450.0, metal), "450 HU以上の連結成分体積 log10 mm³")
    maps["t_local"] = (parts["t_local"], "局所半値閾値 HU")
    maps["boundary_field"] = (field, f"境界場 B=HUs−T（ゼロ＝境界、正＝骨）presence={presence}")
    th = F.normal_thickness(field, shell, env, sp)
    maps["cortical_thickness_mm"] = (th, "皮質殻の局所厚 mm（法線方向プロファイル、境界場のゼロ交差間）")
    lab = np.zeros(hu.shape, np.uint8)
    lab[shell] = 1
    lab[internal] = 2
    lab[parts["small"]] = 3
    lab[metal] = 4
    maps["labels"] = (lab, "1皮質殻 2殻内高密度（calcar・骨梁・硬化） 3孤立高HU 4金属除外")
    return maps, dict(params=p, bone=bone, envelope=env, shell=shell, canal=canal, metal=metal, internal=internal,
                      field=field, parts=parts)
