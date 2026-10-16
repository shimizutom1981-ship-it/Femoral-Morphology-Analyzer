"""Convert a 512x512 FMA class mask to an editable FMA AI-candidate JSON.

Labels: 0 background, 1 femur, 2 canal, 3 stem.
The app displays images on a 1200-pixel-wide canvas while preserving aspect ratio.
This converter intentionally does not infer head/LT/shaft-axis landmarks.
"""
import argparse, json
from pathlib import Path
import numpy as np
from PIL import Image

def largest_component(binary):
    seen=np.zeros(binary.shape,bool); best=[]; h,w=binary.shape
    for y,x in zip(*np.where(binary & ~seen)):
        if seen[y,x]: continue
        st=[(int(y),int(x))];seen[y,x]=1;comp=[]
        while st:
            yy,xx=st.pop();comp.append((yy,xx))
            for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                ny,nx=yy+dy,xx+dx
                if 0<=ny<h and 0<=nx<w and binary[ny,nx] and not seen[ny,nx]:
                    seen[ny,nx]=1;st.append((ny,nx))
        if len(comp)>len(best): best=comp
    out=np.zeros_like(binary,bool)
    if best:
        yy,xx=zip(*best);out[np.array(yy),np.array(xx)]=1
    return out

def borders(mask,label,cw,ch,step=4):
    comp=largest_component(mask==label);ys=np.where(comp.any(1))[0];left=[];right=[]
    if not len(ys): return left,right
    rows=list(range(int(ys.min()),int(ys.max())+1,step))
    if rows[-1]!=int(ys.max()):rows.append(int(ys.max()))
    sx=cw/mask.shape[1];sy=ch/mask.shape[0]
    for y in rows:
        xs=np.where(comp[y])[0]
        if len(xs)>=2:
            left.append({"x":float(xs.min()*sx),"y":float(y*sy)})
            right.append({"x":float(xs.max()*sx),"y":float(y*sy)})
    return left,right

def main():
    ap=argparse.ArgumentParser();ap.add_argument("mask");ap.add_argument("output");ap.add_argument("--case-id",required=True)
    ap.add_argument("--aspect",type=float,default=4/3,help="source height/width; default 4:3")
    a=ap.parse_args();m=np.array(Image.open(a.mask).convert("L"));cw=1200;ch=round(cw*a.aspect)
    fl,fm=borders(m,1,cw,ch);cl,cm=borders(m,2,cw,ch);sl,sm=borders(m,3,cw,ch)
    p={"model":"FMA-AI","case_id":a.case_id,"coordinate_space":f"FMA_canvas_px_{cw}x{ch}","prediction":{"annotation":{
       "femur_lateral":fl,"femur_medial":fm,"canal_lateral":cl,"canal_medial":cm,"stem_lateral":sl,"stem_medial":sm}},
       "note":"AI candidate only; clinician must review/correct. Head, LT and shaft-axis landmarks are not inferred."}
    Path(a.output).write_text(json.dumps(p,ensure_ascii=False,indent=2),encoding="utf-8")
if __name__=="__main__":main()
