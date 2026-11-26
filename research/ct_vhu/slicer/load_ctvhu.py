# -*- coding: utf-8 -*-
"""3D Slicer の Python コンソールで実行：CT-vHU 一式を統一カラースケールで表示する。

  CT_PATH = r"D:\\磐田CDデータ\\1735623\\ct.nrrd"        # 元CT（読み込みのみ）
  OUT_DIR = r"D:\\磐田CDデータ\\1735623\\ct_vhu_v0.1"    # run_ctvhu.py の出力
  exec(open(r"<このファイルのパス>", encoding="utf-8").read())

その後:
  show("vhu_mean_r2")          # 前景マップ切替（数値はデータプローブに表示される）
  set_range("grad_mag", 0, 1500)
  set_opacity(0.6)
  jump(3)                      # 確認点 R3 へ 3断面を移動
  compare_cad(r"...\\HU450_all_LPS_mm.stl", "GPT_CAD")   # 既存CADを重ねる
表示範囲は display_ranges.json（症例間で共通）。変更は set_range で行い、元データは変更しない。
"""
import json
import os

import slicer

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else None
_ranges_path = None
for cand in [os.path.join(OUT_DIR, "display_ranges.json"),
             os.path.join(HERE or "", "display_ranges.json")]:
    if os.path.exists(cand):
        _ranges_path = cand
        break
RANGES = json.load(open(_ranges_path, encoding="utf-8")) if _ranges_path else {}
COLOR_DIR = next((d for d in [os.path.join(OUT_DIR, "colors"), os.path.join(HERE or "", "colors")] if os.path.isdir(d)), None)

ct = slicer.util.loadVolume(CT_PATH, {"name": "CT_original"})
ct.GetDisplayNode().SetAutoWindowLevel(False)
ct.GetDisplayNode().SetWindowLevel(1800, 400)

nodes = {}
for name, cfg in RANGES.items():
    pth = os.path.join(OUT_DIR, f"ctvhu_{name}.nrrd")
    if not os.path.exists(pth):
        continue
    if name == "labels":
        n = slicer.util.loadLabelVolume(pth, {"name": "ctvhu_labels"})
        if COLOR_DIR and os.path.exists(os.path.join(COLOR_DIR, "ctvhu_labels.ctbl")):
            ct_node = slicer.util.loadColorTable(os.path.join(COLOR_DIR, "ctvhu_labels.ctbl"))
            n.GetDisplayNode().SetAndObserveColorNodeID(ct_node.GetID())
    else:
        n = slicer.util.loadVolume(pth, {"name": f"ctvhu_{name}"})
        d = n.GetDisplayNode()
        if COLOR_DIR and os.path.exists(os.path.join(COLOR_DIR, cfg["cmap"] + ".ctbl")):
            cnode = slicer.mrmlScene.GetFirstNodeByName(cfg["cmap"]) or \
                slicer.util.loadColorTable(os.path.join(COLOR_DIR, cfg["cmap"] + ".ctbl"))
            d.SetAndObserveColorNodeID(cnode.GetID())
        d.SetAutoWindowLevel(False)
        d.SetWindowLevelMinMax(cfg["min"], cfg["max"])
        if cfg.get("threshold_below") is not None:
            d.SetApplyThreshold(True)
            d.SetLowerThreshold(cfg["threshold_below"])
            d.SetUpperThreshold(1e9)
    nodes[name] = n

for stl, label, color in [("ctvhu_outer_LPS.stl", "CT-vHU_outer", (0.1, 0.8, 0.8)),
                          ("ctvhu_shell_LPS.stl", "CT-vHU_shell", (1.0, 0.6, 0.1))]:
    p = os.path.join(OUT_DIR, stl)
    if os.path.exists(p):
        m = slicer.util.loadModel(p, {"coordinateSystem": "LPS"})
        m.SetName(label)
        m.GetDisplayNode().SetColor(*color)
        m.GetDisplayNode().SetSliceIntersectionVisibility(True)
        m.GetDisplayNode().SetSliceIntersectionThickness(2)
        m.GetDisplayNode().SetOpacity(0.5)

review = None
rp = os.path.join(OUT_DIR, "ctvhu_review_points.mrk.json")
if os.path.exists(rp):
    review = slicer.util.loadMarkups(rp)
    review.SetName("CT-vHU_review")


def show(name, opacity=0.5):
    n = nodes[name]
    lab = name == "labels"
    slicer.util.setSliceViewerLayers(background=ct, foreground=None if lab else n, label=n if lab else None,
                                     foregroundOpacity=opacity, labelOpacity=opacity)


def set_range(name, lo, hi):
    nodes[name].GetDisplayNode().SetWindowLevelMinMax(lo, hi)


def set_opacity(op):
    for comp in ["Red", "Yellow", "Green"]:
        slicer.app.layoutManager().sliceWidget(comp).sliceLogic().GetSliceCompositeNode().SetForegroundOpacity(op)


def jump(i):
    if review is None:
        return
    pos = [0, 0, 0]
    review.GetNthControlPointPositionWorld(i - 1, pos)
    slicer.modules.markups.logic().JumpSlicesToLocation(pos[0], pos[1], pos[2], True)
    print(review.GetNthControlPointLabel(i - 1), review.GetNthControlPointDescription(i - 1))


def compare_cad(path, label, color=(0.9, 0.2, 0.6)):
    m = slicer.util.loadModel(path, {"coordinateSystem": "LPS"})
    m.SetName(label)
    m.GetDisplayNode().SetColor(*color)
    m.GetDisplayNode().SetSliceIntersectionVisibility(True)
    m.GetDisplayNode().SetSliceIntersectionThickness(2)
    return m


slicer.app.layoutManager().setLayout(slicer.vtkMRMLLayoutNode.SlicerLayoutFourUpView)
show("vhu_mean_r2" if "vhu_mean_r2" in nodes else next(iter(nodes)))
print("CT-vHU loaded:", ", ".join(nodes))
