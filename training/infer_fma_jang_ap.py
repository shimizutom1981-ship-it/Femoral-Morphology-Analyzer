"""Inference for the Jang-based FMA AP ResNet34-U-Net checkpoint."""
import argparse
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from train_fma_jang_ap import ResNet34UNet,clahe_pil
def main():
    ap=argparse.ArgumentParser();ap.add_argument("image");ap.add_argument("output");ap.add_argument("model");a=ap.parse_args()
    ck=torch.load(a.model,map_location="cpu");size=int(ck.get("input_size",512));m=ResNet34UNet(pretrained=False);m.load_state_dict(ck["model_state"]);m.eval()
    im=Image.open(a.image).convert("L").resize((size,size),Image.Resampling.BILINEAR);im=clahe_pil(im)
    x=np.asarray(im,dtype=np.float32)/255.;x=np.repeat(x[None],3,axis=0);mean=np.array([.485,.456,.406],np.float32)[:,None,None];std=np.array([.229,.224,.225],np.float32)[:,None,None];x=(x-mean)/std
    with torch.no_grad():p=m(torch.from_numpy(x[None])).argmax(1)[0].numpy().astype(np.uint8)
    Image.fromarray(p).resize((512,512),Image.Resampling.NEAREST).save(Path(a.output))
if __name__=="__main__":main()
