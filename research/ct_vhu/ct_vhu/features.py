"""局所HU分布の指標。すべて物理距離（mm）で指定し、ボクセル異方性を考慮する。

定義（中心包含則）：領域 R(x) は、中心が x からの物理距離条件を満たすネイティブボクセルの集合。
ボクセルが粗い場合、小さい領域は単一ボクセルに退化する（0.72×0.72×1.0 mm では半径0.5 mm球＝1ボクセル）。
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi
from scipy.signal import fftconvolve


# ---------------------------------------------------------------- kernels
def ellipsoid_footprint(semi_axes_mm, spacing) -> np.ndarray:
    """軸並行楕円体（z,y,x の半径 mm）。中心包含則。"""
    a = np.asarray(semi_axes_mm, float)
    sp = np.asarray(spacing, float)
    half = np.floor(a / sp + 1e-9).astype(int)
    g = np.meshgrid(*[np.arange(-h, h + 1) * s for h, s in zip(half, sp)], indexing="ij")
    q = sum((gi / max(ai, 1e-9)) ** 2 for gi, ai in zip(g, a))
    fp = q <= 1.0 + 1e-9
    return fp


def sphere_footprint(radius_mm, spacing) -> np.ndarray:
    return ellipsoid_footprint((radius_mm,) * 3, spacing)


def _correlate_mean(x: np.ndarray, fp: np.ndarray) -> np.ndarray:
    """境界で有効ボクセルのみ平均（端の外挿なし）。"""
    w = fp.astype(np.float32)
    if fp.sum() == 1:
        return x.astype(np.float32, copy=True)
    if fp.size <= 125:
        num = ndi.correlate(x.astype(np.float32), w, mode="constant", cval=0.0)
        den = ndi.correlate(np.ones_like(x, np.float32), w, mode="constant", cval=0.0)
    else:
        num = fftconvolve(x.astype(np.float32), w[::-1, ::-1, ::-1], mode="same")
        den = fftconvolve(np.ones_like(x, np.float32), w[::-1, ::-1, ::-1], mode="same")
    return (num / np.maximum(den, 1e-6)).astype(np.float32)


# ---------------------------------------------------------------- local statistics
def local_mean(hu, spacing, radius_mm=2.0, shape="sphere", axis_ratio=(1.0, 1.0, 1.0)):
    """shape: sphere / ellipsoid（axis_ratio は z,y,x の倍率）。"""
    if shape == "sphere":
        fp = sphere_footprint(radius_mm, spacing)
    else:
        fp = ellipsoid_footprint(np.asarray(axis_ratio) * radius_mm, spacing)
    return _correlate_mean(hu, fp)


def local_gaussian_mean(hu, spacing, sigma_mm=1.0):
    sig = np.asarray(sigma_mm, float) / np.asarray(spacing, float)
    return ndi.gaussian_filter(hu.astype(np.float32), sig, mode="nearest")


def local_percentile(hu, spacing, radius_mm=2.0, q=50.0):
    fp = sphere_footprint(radius_mm, spacing)
    if fp.sum() == 1:
        return hu.astype(np.float32, copy=True)
    return ndi.percentile_filter(hu.astype(np.float32), q, footprint=fp, mode="nearest")


def local_sd(hu, spacing, radius_mm=2.0):
    fp = sphere_footprint(radius_mm, spacing)
    m = _correlate_mean(hu, fp)
    m2 = _correlate_mean(hu.astype(np.float32) ** 2, fp)
    return np.sqrt(np.maximum(m2 - m * m, 0)).astype(np.float32)


def occupancy(hu, spacing, radius_mm=2.0, threshold=450.0):
    """領域内で閾値以上のボクセル占有率（0–1）。"""
    fp = sphere_footprint(radius_mm, spacing)
    return _correlate_mean((hu >= threshold).astype(np.float32), fp)


def gradient_magnitude(hu, spacing, sigma_mm=0.5):
    """HU/mm 単位の勾配強度。"""
    hu = hu.astype(np.float32)
    sig = sigma_mm / np.asarray(spacing, float)
    gs = [ndi.gaussian_filter(hu, sig, order=o, mode="nearest") / s
          for o, s in zip(np.eye(3, dtype=int), spacing)]
    return np.sqrt(sum(g * g for g in gs)).astype(np.float32)


def gradient_vectors(hu, spacing, sigma_mm=1.0):
    hu = hu.astype(np.float32)
    sig = sigma_mm / np.asarray(spacing, float)
    return [ndi.gaussian_filter(hu, sig, order=tuple(o), mode="nearest") / s
            for o, s in zip(np.eye(3, dtype=int), spacing)]


# ---------------------------------------------------------------- 3D continuity
def component_volume_map(mask, spacing, connectivity=26):
    """mask の各ボクセルが属する連結成分の体積（mm³）。mask外は0。"""
    st = ndi.generate_binary_structure(3, 1 if connectivity == 6 else (2 if connectivity == 18 else 3))
    lab, n = ndi.label(mask, structure=st)
    if n == 0:
        return np.zeros(mask.shape, np.float32), lab
    vox = float(np.prod(spacing))
    counts = np.bincount(lab.ravel()).astype(np.float32) * vox
    counts[0] = 0
    return counts[lab], lab


def continuity_map(hu, spacing, threshold=450.0, metal_mask=None, connectivity=26):
    """log10(連結成分体積 mm³)。孤立高HU点は小さく、立体的に連続した骨は大きい。"""
    m = hu >= threshold
    if metal_mask is not None:
        m &= ~metal_mask
    vol, _ = component_volume_map(m, spacing, connectivity)
    out = np.zeros(hu.shape, np.float32)
    out[m] = np.log10(np.maximum(vol[m], 1e-3))
    return out


# ---------------------------------------------------------------- oriented (surface-following) mean
def oriented_mean(hu, spacing, tangential_mm=2.0, normal_mm=1.0, sigma_mm=1.0, n_t=5, n_n=3, mask=None):
    """局所の勾配方向を法線とし、皮質面に沿った楕円体（接線半径 tangential、法線半径 normal）で平均。

    低勾配域（髄腔・軟部の平坦部）は球平均へ自然に近づくよう、勾配が弱い所は z 軸を法線と仮定せず
    等方サンプルを用いる。mask があればその範囲のみ計算（範囲外は等方平均）。
    """
    hu = hu.astype(np.float32)
    sp = np.asarray(spacing, float)
    gz, gy, gx = gradient_vectors(hu, spacing, sigma_mm)
    gmag = np.sqrt(gz * gz + gy * gy + gx * gx) + 1e-6
    n = np.stack([gz / gmag, gy / gmag, gx / gmag], -1)  # 物理方向 (z,y,x)
    # 接線基底
    ref = np.zeros_like(n)
    ref[..., 0] = 1.0
    para = np.abs(n[..., 0]) > 0.9
    ref[para] = (0.0, 0.0, 1.0)
    u = np.cross(n, ref)
    u /= np.linalg.norm(u, axis=-1, keepdims=True) + 1e-9
    v = np.cross(n, u)
    ts = np.linspace(-tangential_mm, tangential_mm, n_t)
    ns = np.linspace(-normal_mm, normal_mm, n_n)
    offs = [(a, b, c) for a in ts for b in ts for c in ns
            if (a / tangential_mm) ** 2 + (b / tangential_mm) ** 2 + (c / max(normal_mm, 1e-9)) ** 2 <= 1 + 1e-9]
    idx = np.indices(hu.shape).astype(np.float32)
    if mask is None:
        mask = np.ones(hu.shape, bool)
    pts = np.nonzero(mask)
    acc = np.zeros(len(pts[0]), np.float32)
    nn = n[pts]
    uu = u[pts]
    vv = v[pts]
    base = np.stack([idx[0][pts], idx[1][pts], idx[2][pts]], 0)
    for a, b, c in offs:
        d_phys = a * uu + b * vv + c * nn  # (N,3) mm in z,y,x
        coords = base + (d_phys / sp).T
        acc += ndi.map_coordinates(hu, coords, order=1, mode="nearest")
    out = local_mean(hu, spacing, radius_mm=normal_mm, shape="sphere")
    out[pts] = acc / len(offs)
    return out, len(offs)


# ---------------------------------------------------------------- local thickness
def local_thickness(mask, spacing, step_mm=0.1, max_mm=10.0, half_voxel_correction=True):
    """最大内接球直径による局所厚（Hildebrand & Rüegsegger 型の近似, mm）。

    EDT はボクセル中心から最近傍の背景ボクセル中心までの距離なので、境界はその半ボクセル手前にある。
    half_voxel_correction=True で球半径から面内ボクセルの半分を差し引く（ファントムで偏りを確認済み）。
    """
    dt = ndi.distance_transform_edt(mask, sampling=spacing).astype(np.float32)
    corr = 0.5 * float(np.mean(spacing[1:])) if half_voxel_correction else 0.0
    out = np.zeros(mask.shape, np.float32)
    rmax = min(float(dt.max()), max_mm / 2)
    if rmax <= 0:
        return out
    edges = np.arange(0.0, rmax + step_mm, step_mm)
    ridge = (dt >= ndi.maximum_filter(dt, size=3) - 1e-6) & mask
    for lo in edges[::-1]:
        centers = ridge & (dt >= lo) & (dt < lo + step_mm)
        if not centers.any():
            continue
        r = lo + step_mm / 2
        fp = sphere_footprint(max(r - corr, 1e-3), spacing)
        cov = ndi.binary_dilation(centers, structure=fp) & mask
        val = max(2 * (r - corr), 0.0)
        upd = cov & (out < val)
        out[upd] = val
    miss = mask & (out == 0)
    out[miss] = np.maximum(2 * (dt[miss] - corr), float(np.min(spacing[1:])) * 0.5)
    return out


def metal_mask(hu, spacing, threshold=2500.0, margin_mm=0.75):
    m = hu >= threshold
    if margin_mm > 0 and m.any():
        m = ndi.binary_dilation(m, structure=sphere_footprint(margin_mm, spacing))
    return m


def normal_thickness(field, shell, envelope, spacing, half_range_mm=7.0, step_mm=0.05, normal_sigma_mm=0.7,
                     chunk=400000):
    """法線方向プロファイルによる亜ボクセル皮質厚（mm）。

    法線＝骨外（エンベロープ外）からの距離場の勾配（骨膜面に直交、髄腔向き）。
    各殻ボクセルから ±法線方向に境界場 B を線形補間し、そのボクセルを含む B≥0 区間の
    両端（ゼロ交差、線形補間）間の距離を厚さとする。Cortical Bone Mapping の法線プロファイルの考え方。
    """
    sp = np.asarray(spacing, float)
    d_out = ndi.distance_transform_edt(envelope, sampling=spacing).astype(np.float32)
    d_out = ndi.gaussian_filter(d_out, normal_sigma_mm / sp, mode="nearest")
    g = [ndi.sobel(d_out, axis=a) / (8.0 * sp[a]) for a in range(3)]
    gm = np.sqrt(sum(x * x for x in g)) + 1e-9
    pts = np.argwhere(shell)
    out = np.zeros(shell.shape, np.float32)
    if len(pts) == 0:
        return out
    s = np.arange(-half_range_mm, half_range_mm + step_mm / 2, step_mm, dtype=np.float32)
    i0 = int(np.argmin(np.abs(s)))
    f = field.astype(np.float32)
    for k in range(0, len(pts), chunk):
        p = pts[k:k + chunk]
        n = np.stack([g[a][p[:, 0], p[:, 1], p[:, 2]] / gm[p[:, 0], p[:, 1], p[:, 2]] for a in range(3)], 1)
        coords = p[:, None, :].astype(np.float32) + s[None, :, None] * (n[:, None, :] / sp[None, None, :])
        v = ndi.map_coordinates(f, coords.reshape(-1, 3).T, order=1, mode="nearest").reshape(len(p), len(s))
        b = v >= 0
        # 中心近傍の骨サンプルを起点にする（殻マスクと B の僅かな食い違いを吸収）
        start = np.full(len(p), -1)
        for off in range(0, int(round(0.75 / step_mm)) + 1):
            for j in (i0 - off, i0 + off):
                if 0 <= j < len(s):
                    sel = (start < 0) & b[:, j]
                    start[sel] = j
        ok = start >= 0
        th = np.zeros(len(p), np.float32)
        idx = np.arange(len(s))
        for r in np.flatnonzero(ok):
            br = b[r]
            j = start[r]
            lo = j
            while lo > 0 and br[lo - 1]:
                lo -= 1
            hi = j
            while hi < len(s) - 1 and br[hi + 1]:
                hi += 1
            vr = v[r]
            a_ = s[lo] if lo == 0 else s[lo - 1] + step_mm * (-vr[lo - 1]) / (vr[lo] - vr[lo - 1] + 1e-9)
            b_ = s[hi] if hi == len(s) - 1 else s[hi] + step_mm * (-vr[hi]) / (vr[hi + 1] - vr[hi] + 1e-9)
            # 標本範囲の端に達した区間は厚さ不定（0＝未算出）とする
            th[r] = 0.0 if (lo == 0 or hi == len(s) - 1) else b_ - a_
        out[p[:, 0], p[:, 1], p[:, 2]] = th
    return out
