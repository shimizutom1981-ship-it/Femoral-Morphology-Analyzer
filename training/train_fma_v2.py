"""FMA segmentation training pipeline.

Expected dataset layout:
DATASET_ROOT/
  <case_id>/
    <case_id>_source.jpg
    <case_id>_mask512.png

Mask labels (red channel / grayscale): 0 background, 1 femur, 2 canal, 3 stem.
Patient-derived data and model weights are intentionally NOT stored in GitHub.
"""
import argparse, csv, json, random, time
from pathlib import Path
import numpy as np
from PIL import Image, ImageEnhance
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

CLASSES={0:"background",1:"femur",2:"canal",3:"stem"}
INPUT_SIZE=128

class DS(Dataset):
    def __init__(self, root, cases, augment=True):
        self.root=Path(root); self.cases=cases; self.augment=augment
    def __len__(self): return len(self.cases)
    def __getitem__(self,i):
        c=self.cases[i]
        im=Image.open(self.root/c/f"{c}_source.jpg").convert("L").resize((INPUT_SIZE,INPUT_SIZE),Image.Resampling.BILINEAR)
        ma=Image.open(self.root/c/f"{c}_mask512.png").convert("RGBA").getchannel("R").resize((INPUT_SIZE,INPUT_SIZE),Image.Resampling.NEAREST)
        if self.augment:
            if random.random()<0.5:
                im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT); ma=ma.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            im=ImageEnhance.Contrast(im).enhance(random.uniform(.85,1.15))
            im=ImageEnhance.Brightness(im).enhance(random.uniform(.9,1.1))
        x=np.asarray(im,dtype=np.float32)/255.
        x=(x-x.mean())/(x.std()+1e-6)
        return torch.from_numpy(x[None]),torch.from_numpy(np.asarray(ma,dtype=np.int64)),c

class Conv(nn.Module):
    def __init__(self,a,b):
        super().__init__(); self.m=nn.Sequential(nn.Conv2d(a,b,3,padding=1),nn.BatchNorm2d(b),nn.ReLU(),nn.Conv2d(b,b,3,padding=1),nn.BatchNorm2d(b),nn.ReLU())
    def forward(self,x): return self.m(x)
class UNet(nn.Module):
    def __init__(self,n=4,b=6):
        super().__init__(); self.e1=Conv(1,b);self.e2=Conv(b,b*2);self.e3=Conv(b*2,b*4);self.bot=Conv(b*4,b*8);self.pool=nn.MaxPool2d(2)
        self.u3=nn.ConvTranspose2d(b*8,b*4,2,2);self.d3=Conv(b*8,b*4);self.u2=nn.ConvTranspose2d(b*4,b*2,2,2);self.d2=Conv(b*4,b*2);self.u1=nn.ConvTranspose2d(b*2,b,2,2);self.d1=Conv(b*2,b);self.out=nn.Conv2d(b,n,1)
    def forward(self,x):
        a=self.e1(x);b=self.e2(self.pool(a));c=self.e3(self.pool(b));z=self.bot(self.pool(c))
        z=self.d3(torch.cat([self.u3(z),c],1));z=self.d2(torch.cat([self.u2(z),b],1));z=self.d1(torch.cat([self.u1(z),a],1));return self.out(z)

def dice_loss(logits,y):
    p=torch.softmax(logits,1);oh=torch.nn.functional.one_hot(y,4).permute(0,3,1,2).float();ds=[]
    for k in (1,2,3):
        inter=(p[:,k]*oh[:,k]).sum((1,2));den=p[:,k].sum((1,2))+oh[:,k].sum((1,2));ds.append((2*inter+1)/(den+1))
    return 1-torch.stack(ds).mean()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--dataset",required=True);ap.add_argument("--cases",required=True,help="comma-separated case IDs")
    ap.add_argument("--out",required=True);ap.add_argument("--epochs",type=int,default=50);ap.add_argument("--seed",type=int,default=20261013)
    a=ap.parse_args();cases=[x.strip() for x in a.cases.split(",") if x.strip()];out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    random.seed(a.seed);np.random.seed(a.seed);torch.manual_seed(a.seed)
    model=UNet();opt=torch.optim.AdamW(model.parameters(),lr=1e-3,weight_decay=1e-4);ce=nn.CrossEntropyLoss(weight=torch.tensor([.15,1.,1.5,1.2]))
    dl=DataLoader(DS(a.dataset,cases,True),batch_size=min(5,len(cases)),shuffle=True,num_workers=0);hist=[];t0=time.time()
    for ep in range(1,a.epochs+1):
        model.train();ls=0
        for x,y,_ in dl:
            opt.zero_grad();o=model(x);loss=.55*ce(o,y)+.45*dice_loss(o,y);loss.backward();opt.step();ls+=loss.item()
        hist.append(ls/len(dl))
    ck={"model_state":model.state_dict(),"architecture":"small_UNet_base6","classes":CLASSES,"input_size":INPUT_SIZE,"cases":cases,"seed":a.seed,"preprocess":"grayscale; resize 128x128; per-image z-score","epochs":a.epochs}
    torch.save(ck,out/"FMA_UNet.pt")
    with open(out/"training_history.csv","w",newline="") as f:
        w=csv.writer(f);w.writerow(["epoch","loss"]);w.writerows(enumerate(hist,1))
    card={"model_version":"FMA-AI","training_cases":cases,"n_cases":len(cases),"seed":a.seed,"input_size":INPUT_SIZE,"evaluation_note":"Training-set metrics are resubstitution QA only. Generalization must be tested on untouched cases.","elapsed_sec":round(time.time()-t0,1)}
    (out/"model_card.json").write_text(json.dumps(card,ensure_ascii=False,indent=2),encoding="utf-8")
if __name__=="__main__": main()
