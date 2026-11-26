"""CAD（STL）生成、マスク間比較、医師確認点（Slicer Markups）の抽出。"""
from __future__ import annotations

import json

import numpy as np
from scipy import ndimage as ndi
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components


def surface_from_field(field, vol, level=0.0, keep_largest=True, smooth_sigma_mm=0.0):
    from skimage.measure import marching_cubes

    f = field.astype(np.float32)
    if smooth_sigma_mm > 0:
        f = ndi.gaussian_filter(f, smooth_sigma_mm / np.asarray(vol.spacing, float))
    if not (f.min() < level < f.max()):
        return np.zeros((0, 3)), np.zeros((0, 3), int)
    verts, faces, _, _ = marching_cubes(f, level=level, spacing=(1.0, 1.0, 1.0))
    if keep_largest and len(faces):
        n = len(verts)
        e = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
        g = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
        _, lab = connected_components(g, directed=False)
        big = np.bincount(lab[faces[:, 0]]).argmax()
        keepf = lab[faces[:, 0]] == big
        faces = faces[keepf]
        used = np.unique(faces)
        remap = -np.ones(n, int)
        remap[used] = np.arange(len(used))
        verts = verts[used]
        faces = remap[faces]
    # marching_cubes は (z,y,x) インデックス → LPS
    return vol.index_to_lps(verts), faces


def outer_field(boundary_field, canal):
    """髄腔を骨側とみなし、外表面だけがゼロ等値面になる場。"""
    f = boundary_field.copy()
    f[canal] = np.maximum(f[canal], 50.0)
    return f


def hd95_assd(a, b, spacing):
    if not a.any() or not b.any():
        return np.nan, np.nan
    sa = a & ~ndi.binary_erosion(a)
    sb = b & ~ndi.binary_erosion(b)
    da = ndi.distance_transform_edt(~sb, sampling=spacing)[sa]
    db = ndi.distance_transform_edt(~sa, sampling=spacing)[sb]
    d = np.concatenate([da, db])
    return float(np.percentile(d, 95)), float(d.mean())


def compare_masks(a, b, spacing):
    """一致度（真値に対する精度ではない）。"""
    inter = (a & b).sum()
    dice = 2 * inter / max(a.sum() + b.sum(), 1)
    h, s = hd95_assd(a, b, spacing)
    vox = float(np.prod(spacing))
    return dict(dice=float(dice), hd95_mm=h, assd_mm=s, vol_a_ml=a.sum() * vox / 1000, vol_b_ml=b.sum() * vox / 1000,
                only_a_ml=(a & ~b).sum() * vox / 1000, only_b_ml=(b & ~a).sum() * vox / 1000)


def disagreement_points(fields: dict, envelope, vol, n_points=20, min_vox=4, near_mm=3.0):
    """手法間で骨／非骨の判定が割れる部位を大きい順に抽出（医師確認の優先候補）。"""
    names = list(fields)
    B = np.stack([fields[k] >= 0 for k in names], 0)
    votes = B.sum(0)
    split = (votes > 0) & (votes < len(names))
    band = ndi.binary_dilation(envelope, iterations=max(1, int(round(near_mm / min(vol.spacing))))) & \
        ~ndi.binary_erosion(envelope, iterations=max(1, int(round(near_mm / min(vol.spacing)))))
    split &= band
    lab, n = ndi.label(split, structure=np.ones((3, 3, 3)))
    if n == 0:
        return []
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    order = np.argsort(sizes)[::-1]
    pts = []
    for k in order:
        if sizes[k] < min_vox or len(pts) >= n_points:
            break
        idx = np.argwhere(lab == k)
        c = idx[np.argmin(((idx - idx.mean(0)) ** 2).sum(1))]  # 成分内で重心に最も近いボクセル
        who = [nm for nm, b in zip(names, B[:, c[0], c[1], c[2]]) if b]
        pts.append(dict(zyx=c.tolist(), lps=vol.index_to_lps(c)[0].tolist(), n_vox=int(sizes[k]),
                        vol_mm3=float(sizes[k] * np.prod(vol.spacing)), bone_by=who))
    return pts


def write_markups(path, points, name="CT-vHU review"):
    cps = []
    for i, p in enumerate(points, 1):
        cps.append(dict(id=str(i), label=f"R{i}", description=p.get("desc", ""), position=[float(v) for v in p["lps"]],
                        selected=True, locked=False, visibility=True, positionStatus="defined"))
    doc = {"@schema": "https://raw.githubusercontent.com/slicer/slicer/master/Modules/Loadable/Markups/Resources/Schema/markups-schema-v1.0.3.json#",
           "markups": [dict(type="Fiducial", coordinateSystem="LPS", coordinateUnits="mm", locked=False,
                            labelFormat="%N-%d", controlPoints=cps,
                            display=dict(visibility=True, opacity=1.0, color=[1.0, 0.5, 0.0], selectedColor=[1.0, 0.3, 0.0],
                                         glyphScale=2.0, textScale=2.5))]}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    return path
