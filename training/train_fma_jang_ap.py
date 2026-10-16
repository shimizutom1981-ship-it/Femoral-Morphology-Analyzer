"""Jang-based FMA AP segmentation training pipeline (development).

Reference-method alignment:
- 512x512 input
- adaptive histogram equalization (CLAHE)
- crop/translation, rotation, horizontal flip, contrast augmentation
- pretrained ResNet-34 encoder + U-Net decoder
- batch size 4, 150 epochs
- validation Dice used for best-checkpoint selection

FMA-specific choices (explicit deviations): 4 classes and weighted CE + multiclass
Dice loss. Patient-derived data/model weights must not be committed to GitHub.
Split at Research-ID/patient level only.
"""
import argparse,csv,json,random,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageEnhance
import torch,torch.nn as nn,torch.nn.functional as F
from torch.utils.data import Dataset,DataLoader
from torchvision.models import resnet34,ResNet34_Weights
from torchvision.transforms import functional as TF
from torchvision.transforms.functional import InterpolationMode

CLASSES={0:"background",1:"femur",2:"canal",3:"stem"}
INPUT_SIZE=512

def clahe_pil(im):
    """CLAHE when OpenCV is available; fail loudly rather than silently change preprocessing."""
    try: import cv2
    except ImportError as e: raise RuntimeError("opencv-python is required for CLAHE") from e
    a=np.asarray(im,dtype=np.uint8)
    return Image.fromarray(cv2.createCLAHE(clipLimit=2.0,tileGridSize=(8,8)).apply(a))

def paired_aug(im,ma):
    # Mild FMA-specific ranges; operations mirror Jang augmentation categories.
    if random.random()<0.5:
        im=TF.hflip(im);ma=TF.hflip(ma)
    angle=random.uniform(-10,10)
    im=TF.rotate(im,angle,interpolation=InterpolationMode.BILINEAR,fill=0)
    ma=TF.rotate(ma,angle,interpolation=InterpolationMode.NEAREST,fill=0)
    # random resized crop = crop + translation/scale while preserving 512 output
    scale=random.uniform(.90,1.0); side=max(1,int(INPUT_SIZE*scale))
    top=random.randint(0,INPUT_SIZE-side);left=random.randint(0,INPUT_SIZE-side)
    im=TF.resized_crop(im,top,left,side,side,(INPUT_SIZE,INPUT_SIZE),InterpolationMode.BILINEAR)
    ma=TF.resized_crop(ma,top,left,side,side,(INPUT_SIZE,INPUT_SIZE),InterpolationMode.NEAREST)
    im=ImageEnhance.Contrast(im).enhance(random.uniform(.85,1.15))
    return im,ma

class DS(Dataset):
    def __init__(self,root,cases,augment):
        self.root=Path(root);self.cases=list(cases);self.augment=augment
    def __len__(self):return len(self.cases)
    def __getitem__(self,i):
        c=self.cases[i]
        im=Image.open(self.root/c/f"{c}_source.jpg").convert("L").resize((INPUT_SIZE,INPUT_SIZE),Image.Resampling.BILINEAR)
        ma=Image.open(self.root/c/f"{c}_mask512.png").convert("RGBA").getchannel("R").resize((INPUT_SIZE,INPUT_SIZE),Image.Resampling.NEAREST)
        im=clahe_pil(im)
        if self.augment:im,ma=paired_aug(im,ma)
        x=np.asarray(im,dtype=np.float32)/255.
        # ResNet-34 pretrained encoder expects ImageNet normalization; replicate grayscale to RGB.
        x=np.repeat(x[None],3,axis=0)
        mean=np.array([.485,.456,.406],dtype=np.float32)[:,None,None];std=np.array([.229,.224,.225],dtype=np.float32)[:,None,None]
        x=(x-mean)/std
        return torch.from_numpy(x),torch.from_numpy(np.asarray(ma,dtype=np.int64)),c

class Block(nn.Module):
    def __init__(self,a,b):
        super().__init__();self.m=nn.Sequential(nn.Conv2d(a,b,3,padding=1,bias=False),nn.BatchNorm2d(b),nn.ReLU(inplace=True),nn.Conv2d(b,b,3,padding=1,bias=False),nn.BatchNorm2d(b),nn.ReLU(inplace=True))
    def forward(self,x):return self.m(x)
class Up(nn.Module):
    def __init__(self,cin,skip,out):
        super().__init__();self.up=nn.ConvTranspose2d(cin,out,2,2);self.conv=Block(out+skip,out)
    def forward(self,x,s):
        x=self.up(x)
        if x.shape[-2:]!=s.shape[-2:]:x=F.interpolate(x,size=s.shape[-2:],mode="bilinear",align_corners=False)
        return self.conv(torch.cat([x,s],1))
class ResNet34UNet(nn.Module):
    def __init__(self,n=4,pretrained=True):
        super().__init__();r=resnet34(weights=ResNet34_Weights.DEFAULT if pretrained else None)
        self.stem=nn.Sequential(r.conv1,r.bn1,r.relu);self.pool=r.maxpool;self.e1=r.layer1;self.e2=r.layer2;self.e3=r.layer3;self.e4=r.layer4
        self.u3=Up(512,256,256);self.u2=Up(256,128,128);self.u1=Up(128,64,64);self.u0=Up(64,64,32)
        self.out=nn.Conv2d(32,n,1)
    def forward(self,x):
        s0=self.stem(x);s1=self.e1(self.pool(s0));s2=self.e2(s1);s3=self.e3(s2);z=self.e4(s3)
        z=self.u3(z,s3);z=self.u2(z,s2);z=self.u1(z,s1);z=self.u0(z,s0);z=F.interpolate(z,size=x.shape[-2:],mode="bilinear",align_corners=False);return self.out(z)

def soft_dice(logits,y):
    p=torch.softmax(logits,1);oh=F.one_hot(y,4).permute(0,3,1,2).float();vals=[]
    for k in (1,2,3):
        inter=(p[:,k]*oh[:,k]).sum((1,2));den=p[:,k].sum((1,2))+oh[:,k].sum((1,2));vals.append((2*inter+1)/(den+1))
    return torch.stack(vals).mean()
def parse_ids(s):return [x.strip() for x in s.split(",") if x.strip()]
def eval_epoch(m,dl,ce,dev):
    m.eval();ls=[];ds=[]
    with torch.no_grad():
        for x,y,_ in dl:
            x,y=x.to(dev),y.to(dev);o=m(x);d=soft_dice(o,y);ls.append((.55*ce(o,y)+.45*(1-d)).item());ds.append(d.item())
    return float(np.mean(ls)),float(np.mean(ds))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--dataset",required=True);ap.add_argument("--train-cases",required=True);ap.add_argument("--val-cases",required=True)
    ap.add_argument("--out",required=True);ap.add_argument("--epochs",type=int,default=150);ap.add_argument("--batch-size",type=int,default=4);ap.add_argument("--seed",type=int,default=20261013)
    a=ap.parse_args();tr=parse_ids(a.train_cases);va=parse_ids(a.val_cases)
    if set(tr)&set(va):raise ValueError("Research IDs overlap between train and validation")
    out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    random.seed(a.seed);np.random.seed(a.seed);torch.manual_seed(a.seed)
    dev=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    m=ResNet34UNet().to(dev);opt=torch.optim.AdamW(m.parameters(),lr=1e-3,weight_decay=1e-4)
    w=torch.tensor([.15,1.,1.5,1.2],device=dev);ce=nn.CrossEntropyLoss(weight=w)
    td=DataLoader(DS(a.dataset,tr,True),batch_size=a.batch_size,shuffle=True,num_workers=0)
    vd=DataLoader(DS(a.dataset,va,False),batch_size=a.batch_size,shuffle=False,num_workers=0)
    hist=[];best=-1.;t0=time.time()
    for ep in range(1,a.epochs+1):
        m.train();tl=[]
        for x,y,_ in td:
            x,y=x.to(dev),y.to(dev);opt.zero_grad();o=m(x);d=soft_dice(o,y);loss=.55*ce(o,y)+.45*(1-d);loss.backward();opt.step();tl.append(loss.item())
        vl,vdice=eval_epoch(m,vd,ce,dev);hist.append([ep,float(np.mean(tl)),vl,vdice])
        if vdice>best:
            best=vdice;torch.save({"model_state":m.state_dict(),"architecture":"ResNet34_UNet","classes":CLASSES,"input_size":INPUT_SIZE,"train_cases":tr,"val_cases":va,"seed":a.seed,"preprocess":"grayscale; resize 512; CLAHE clipLimit=2 tileGrid=8x8; RGB replicate; ImageNet normalization","augmentation":"random crop/scale 0.90-1.00; rotate +/-10 deg; horizontal flip p=0.5; contrast 0.85-1.15","epochs":a.epochs,"batch_size":a.batch_size,"best_val_dice":best},out/"FMA_ResNet34_UNet_best.pt")
    with open(out/"training_history.csv","w",newline="") as f:
        wri=csv.writer(f);wri.writerow(["epoch","train_loss","val_loss","val_multiclass_dice"]);wri.writerows(hist)
    card={"model_version":"FMA-AI-JangBased-AP","reference":"Jang et al., J Arthroplasty 2024;39:1191-1198","train_cases":tr,"val_cases":va,"input_size":512,"epochs":a.epochs,"batch_size":a.batch_size,"best_val_dice":best,"fma_specific_deviations":["4-class postoperative THA segmentation","weighted cross-entropy + multiclass Dice loss","explicit mild augmentation ranges"],"elapsed_sec":round(time.time()-t0,1)}
    (out/"model_card.json").write_text(json.dumps(card,ensure_ascii=False,indent=2),encoding="utf-8")
if __name__=="__main__":main()
