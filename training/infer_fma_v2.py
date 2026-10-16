"""Run FMA 4-class segmentation on one AP radiograph."""
import argparse
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from train_fma_v2 import UNet

def main():
    ap=argparse.ArgumentParser();ap.add_argument("image");ap.add_argument("output");ap.add_argument("model");a=ap.parse_args()
    ck=torch.load(a.model,map_location="cpu");size=int(ck.get("input_size",128));m=UNet();m.load_state_dict(ck["model_state"]);m.eval()
    im=Image.open(a.image).convert("L").resize((size,size),Image.Resampling.BILINEAR);x=np.asarray(im,dtype=np.float32)/255.;x=(x-x.mean())/(x.std()+1e-6)
    with torch.no_grad(): p=m(torch.from_numpy(x[None,None])).argmax(1)[0].numpy().astype(np.uint8)
    Image.fromarray(p).resize((512,512),Image.Resampling.NEAREST).save(Path(a.output))
if __name__=="__main__": main()
