"""入出力。配列は (z, y, x)、spacing は (sz, sy, sx) mm、座標は SimpleITK と同じ LPS。"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import time
from dataclasses import dataclass, field

import numpy as np

from . import __version__


@dataclass
class Volume:
    data: np.ndarray                 # (z, y, x)
    spacing: tuple                   # (sz, sy, sx) mm
    origin: tuple = (0.0, 0.0, 0.0)  # LPS mm, (x, y, z) 順
    direction: tuple = (1, 0, 0, 0, 1, 0, 0, 0, 1)  # 3x3 行優先, ITK と同じ
    meta: dict = field(default_factory=dict)

    def crop(self, zsl: slice, ysl: slice, xsl: slice) -> "Volume":
        d = np.asarray(self.direction, float).reshape(3, 3)
        start = np.array([xsl.start or 0, ysl.start or 0, zsl.start or 0], float)
        sp_xyz = np.array(self.spacing[::-1], float)
        new_origin = np.asarray(self.origin, float) + d @ (start * sp_xyz)
        return Volume(self.data[zsl, ysl, xsl], self.spacing, tuple(new_origin), self.direction, dict(self.meta))

    def index_to_lps(self, zyx: np.ndarray) -> np.ndarray:
        """(N,3) の (z,y,x) 連続インデックス → (N,3) LPS mm。"""
        zyx = np.atleast_2d(np.asarray(zyx, float))
        xyz = zyx[:, ::-1] * np.asarray(self.spacing[::-1], float)
        d = np.asarray(self.direction, float).reshape(3, 3)
        return np.asarray(self.origin, float) + xyz @ d.T


def load_volume(path: str) -> Volume:
    import SimpleITK as sitk

    if os.path.isdir(path):
        r = sitk.ImageSeriesReader()
        files = r.GetGDCMSeriesFileNames(path)
        if not files:
            raise FileNotFoundError(f"DICOMシリーズが見つかりません: {path}")
        r.SetFileNames(files)
        img = r.Execute()
    else:
        img = sitk.ReadImage(path)
    arr = sitk.GetArrayFromImage(img).astype(np.float32)
    return Volume(arr, tuple(img.GetSpacing()[::-1]), tuple(img.GetOrigin()), tuple(img.GetDirection()),
                  {"source": os.path.abspath(path)})


def save_volume(arr: np.ndarray, ref: Volume, path: str, provenance: dict | None = None, dtype=None) -> str:
    """派生マップを NRRD/NIfTI で保存し、同名 .json に来歴を書く。元ファイルには書き込まない。"""
    import SimpleITK as sitk

    src = ref.meta.get("source")
    if src and os.path.abspath(path) == os.path.abspath(src):
        raise ValueError("元データへの上書きは禁止")
    a = np.asarray(arr)
    if dtype is not None:
        a = a.astype(dtype)
    elif a.dtype == bool:
        a = a.astype(np.uint8)
    elif a.dtype == np.float64:
        a = a.astype(np.float32)
    img = sitk.GetImageFromArray(a)
    img.SetSpacing(tuple(float(s) for s in ref.spacing[::-1]))
    img.SetOrigin(tuple(float(o) for o in ref.origin))
    img.SetDirection(tuple(float(v) for v in ref.direction))
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    sitk.WriteImage(img, path, useCompression=True)
    if provenance is not None:
        with open(os.path.splitext(path)[0] + ".json", "w", encoding="utf-8") as f:
            json.dump(provenance, f, ensure_ascii=False, indent=2)
    return path


def code_version() -> dict:
    here = os.path.dirname(os.path.abspath(__file__))
    info = {"ct_vhu": __version__, "python": platform.python_version()}
    try:
        info["git_commit"] = subprocess.check_output(["git", "-C", here, "rev-parse", "HEAD"],
                                                     stderr=subprocess.DEVNULL).decode().strip()
        dirty = subprocess.check_output(["git", "-C", here, "status", "--porcelain", "."],
                                        stderr=subprocess.DEVNULL).decode().strip()
        info["git_dirty"] = bool(dirty)
    except Exception:
        info["git_commit"] = None
    h = hashlib.sha256()
    for fn in sorted(os.listdir(here)):
        if fn.endswith(".py"):
            with open(os.path.join(here, fn), "rb") as f:
                h.update(fn.encode() + f.read())
    info["package_sha256"] = h.hexdigest()
    return info


def provenance(params: dict, ref: Volume, extra: dict | None = None) -> dict:
    p = {
        "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "code": code_version(),
        "params": params,
        "input": {"source": ref.meta.get("source"), "spacing_zyx_mm": list(map(float, ref.spacing)),
                  "shape_zyx": list(ref.data.shape)},
        "note": "研究用DRAFT。元HUは変更していない。HUは未校正でBMDではない。",
    }
    if extra:
        p.update(extra)
    return p


def write_stl(path: str, verts_lps: np.ndarray, faces: np.ndarray, name: str = "ct_vhu") -> str:
    """バイナリSTL（LPS mm）。Slicer で読む際は座標系 LPS を指定する。"""
    v = np.asarray(verts_lps, np.float32)
    f = np.asarray(faces, np.int64)
    tri = v[f]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    rec = np.zeros(len(f), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"] = n
    rec["v"] = tri
    with open(path, "wb") as fh:
        header = f"{name} LPS mm".encode()[:80].ljust(80, b" ")
        fh.write(header)
        fh.write(np.uint32(len(f)).tobytes())
        fh.write(rec.tobytes())
    return path
