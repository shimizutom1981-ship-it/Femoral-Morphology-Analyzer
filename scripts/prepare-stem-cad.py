"""Pack a binary LPS-mm STL and once-defined stem landmarks for FMA."""
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
from struct import unpack_from
p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--stl", type=Path, required=True)
p.add_argument("--definition", type=Path, required=True)
p.add_argument("--out", type=Path, required=True)
args = p.parse_args()
data = json.loads(args.definition.read_text(encoding="utf-8"))
mesh = args.stl.read_bytes()
count = unpack_from("<I", mesh, 80)[0] if len(mesh) >= 84 else 0
if not 0 < count <= 500000 or len(mesh) != 84 + 50 * count:
    p.error("Expected a binary STL of up to 500,000 triangles.")
keys = ("stem_prox", "stem_dist", "stem_shoulder", "stem_tip")
points = [data["head_center_mm"], *(data["landmarks_mm"][key] for key in keys)]
if any(len(pt) != 3 or not all(math.isfinite(v) for v in pt) for pt in points):
    p.error("Each landmark must be a finite 3-vector in LPS mm.")
if data.get("frame") != "LPS_mm" or data.get("side") not in ("R", "L"):
    p.error("Define the image side and use the LPS mm frame.")
data.update(schema="fma-stem-cad-v1", cad_sha256=hashlib.sha256(mesh).hexdigest(),
            stl_base64=base64.b64encode(mesh).decode("ascii"))
args.out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
