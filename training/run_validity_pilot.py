"""Fixed-epoch development smoke trial; not validation or final-test evaluation.
Uses the existing ResNet34 U-Net architecture, corrected letterbox coordinates
and validity-masked CE/Dice. All specified teacher images train the model.
No case or patient IDs are hard-coded. Keep data/weights out of GitHub.
"""
import argparse, hashlib, json, random, time
from pathlib import Path
import cv2, numpy as np, torch
import torch.nn.functional as F
from PIL import Image,ImageDraw
from train_fma_jang_ap import ResNet34UNet

def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def preprocess(path):
 im=np.asarray(Image.open(path).convert('L'));h,w=im.shape
 s=min(512/w,512/h);nw,nh=round(w*s),round(h*s);ox,oy=(512-nw)//2,(512-nh)//2
 out=np.zeros((512,512),np.uint8);out[oy:oy+nh,ox:ox+nw]=cv2.createCLAHE(2.,(8,8)).apply(cv2.resize(im,(nw,nh),interpolation=cv2.INTER_LINEAR))
 return out,{'x':ox,'y':oy,'width':nw,'height':nh,'source_width':w,'source_height':h}
def tensor(im):
 x=np.repeat(im[None],3,axis=0).astype(np.float32)/255
 return torch.from_numpy((x-np.array([.485,.456,.406],np.float32)[:,None,None])/np.array([.229,.224,.225],np.float32)[:,None,None])
def loss_fn(o,y,v):
 if not v.any(): raise ValueError('all-invalid batch')
 w=o.new_tensor([.15,1.,1.5,1.2]);ce=F.cross_entropy(o,y,weight=w,reduction='none')
 ce=(ce*v).sum()/(w[y]*v).sum();p=o.softmax(1);oh=F.one_hot(y,4).permute(0,3,1,2).float();valid=v[:,None]
 p=p*valid;oh=oh*valid;inter=(p*oh).sum((0,2,3));den=(p+oh).sum((0,2,3));d=((2*inter+1)/(den+1))[1:].mean()
 return .55*ce+.45*(1-d)
def augment(im,y,v):
 if random.random()<.5:im,y,v=[np.fliplr(a).copy() for a in (im,y,v)]
 angle=random.uniform(-10,10);scale=random.uniform(.9,1.);A=cv2.getRotationMatrix2D((255.5,255.5),angle,1/scale)
 im=cv2.warpAffine(im,A,(512,512),flags=cv2.INTER_LINEAR,borderValue=0)
 y=cv2.warpAffine(y,A,(512,512),flags=cv2.INTER_NEAREST,borderValue=0)
 v=cv2.warpAffine(v,A,(512,512),flags=cv2.INTER_NEAREST,borderValue=0)
 im=np.clip(im.astype(float)*random.uniform(.85,1.15),0,255).astype(np.uint8)
 return tensor(im),torch.from_numpy(y.astype(np.int64)),torch.from_numpy(v>0)
def dice(pred,y,v):
 return [float(2*((pred==k)&(y==k)&v).sum()/max(1,((pred==k)&v).sum()+((y==k)&v).sum())) for k in (1,2,3)]
def overlay(im,pred):
 rgb=np.repeat(im[:,:,None],3,axis=2);out=rgb.copy()
 for k,col in [(1,(40,210,240)),(2,(250,130,30)),(3,(50,220,80))]:
  b=(pred==k).astype(np.uint8);edges=b-cv2.erode(b,np.ones((3,3),np.uint8));out[edges>0]=col
 return Image.fromarray(out)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--data',required=True);ap.add_argument('--out',required=True);ap.add_argument('--epochs',type=int,default=12);a=ap.parse_args()
 root,out=Path(a.data),Path(a.out);out.mkdir(parents=True,exist_ok=False)
 torch.set_num_threads(4);random.seed(20261021);np.random.seed(20261021);torch.manual_seed(20261021)
 cases=[];manifest=[]
 for f in sorted(root.glob('*_annotation.json')):
  key=f.name.removesuffix('_annotation.json');an=json.loads(f.read_text());t=an['label_transform'];src=root/(key+'_source.jpg');ma=root/(key+'_mask512.png');va=root/(key+'_validity512.png')
  assert an['label_status']['ok'] and an['label_exclusion']['state']=='confirmed'
  im,tr=preprocess(src);assert abs(tr['source_width']/tr['source_height']-t['canvas_width']/t['canvas_height'])<1e-8
  y=np.array(Image.open(ma).convert('RGB'))[:,:,0];v=np.array(Image.open(va).convert('RGB'))[:,:,0]
  assert y.shape==v.shape==(512,512) and set(np.unique(y))<={0,1,2,3} and set(np.unique(v))<={0,255}
  assert np.array_equal(y,np.fromfile(root/(key+'_mask.raw'),np.uint8).reshape(512,512))
  assert np.array_equal(v,np.fromfile(root/(key+'_validity.raw'),np.uint8).reshape(512,512))
  cases.append((key,im,y,v));manifest.append({'case':key,'hashes':{p.name:sha(p) for p in [f,src,ma,va]},'snapshot_uuid':an['snapshot_uuid'],'transform':tr,'valid_pixels':int((v>0).sum())})
 ui,ut=preprocess(root/'untrained_source.jpg');uh=sha(root/'untrained_source.jpg')
 assert uh not in [m['hashes'][m['case']+'_source.jpg'] for m in manifest]
 # Pixel equality check after common preprocessing, in addition to source hashes.
 assert not any(np.array_equal(ui,x[1]) for x in cases)
 config={'scope':'fixed_epoch_smoke_training_all_teachers_no_validation','n_images':len(cases),'epochs':a.epochs,'batch_size':4,'seed':20261021,'architecture':'existing_ResNet34UNet','pretrained':'ImageNet ResNet34 DEFAULT','input_size':512,'device':'cpu','preprocess':'grayscale; aspect-preserving letterbox; CLAHE within content; ImageNet normalization','loss':'0.55 weighted CE + 0.45 foreground soft Dice, validity masked in both','augmentation':'paired flip, rotate +/-10, scale crop .90-1, contrast .85-1.15; new borders invalid','checkpoint':'last fixed epoch, no selection','patient_grouping':'not fully verified; no independent performance claim','inference_source_sha256':uh,'inference_role':'development demonstration, absent from this training input set; prior history/patient overlap not established','inputs':manifest,'source_code_sha256':sha(__file__)}
 (out/'run_manifest.json').write_text(json.dumps(config,indent=2))
 m=ResNet34UNet(pretrained=True);opt=torch.optim.AdamW(m.parameters(),lr=3e-4,weight_decay=1e-4)
 # Verify ignored pixels have zero logit gradient and loss ignores their labels.
 o=torch.randn(1,4,8,8,requires_grad=True);y=torch.randint(0,4,(1,8,8));v=torch.ones_like(y,dtype=torch.bool);v[:,:2]=False
 l=loss_fn(o,y,v);l.backward();assert o.grad.permute(0,2,3,1)[~v].abs().sum()==0
 yy=y.clone();yy[~v]=(yy[~v]+1)%4;assert torch.allclose(l,loss_fn(o.detach(),yy,v))
 hist=[];t0=time.time()
 for ep in range(1,a.epochs+1):
  m.train();order=list(range(len(cases)));random.shuffle(order);ls=[]
  for start in range(0,len(order),4):
   batch=[augment(*cases[i][1:]) for i in order[start:start+4]];x,y,v=[torch.stack(z) for z in zip(*batch)]
   opt.zero_grad();loss=loss_fn(m(x),y,v);assert torch.isfinite(loss);loss.backward();opt.step();ls.append(loss.item())
  row={'epoch':ep,'train_loss':float(np.mean(ls)),'elapsed_seconds':round(time.time()-t0,1)};hist.append(row);(out/'history.json').write_text(json.dumps(hist,indent=2));print(json.dumps(row),flush=True)
 torch.save({'model_state':m.state_dict(),'config':config},out/'model_last.pt');m.eval();scores=[]
 with torch.inference_mode():
  for key,im,y,v in cases:
   p=m(tensor(im)[None]).argmax(1)[0].numpy().astype(np.uint8);scores.append({'case':key,'resubstitution_dice':dice(p,y,v>0)})
  p=m(tensor(ui)[None]).argmax(1)[0].numpy().astype(np.uint8)
 Image.fromarray(p).save(out/'development_pred_mask512.png');overlay(ui,p).save(out/'development_overlay.png')
 canvas=Image.new('RGB',(1024,550),'#101827');canvas.paste(Image.fromarray(ui).convert('RGB'),(0,38));canvas.paste(overlay(ui,p),(512,38));draw=ImageDraw.Draw(canvas);draw.text((18,12),'Source (not used in this run)',fill='white');draw.text((530,12),'12-epoch pilot prediction | NOT validated',fill='white');canvas.save(out/'preview.png')
 (out/'resubstitution_qa.json').write_text(json.dumps(scores,indent=2));(out/'inference_transform.json').write_text(json.dumps(ut,indent=2));print('COMPLETE',json.dumps(scores),flush=True)
if __name__=='__main__':main()
