"""Conservative, reversible lateral shaft candidate correction on 512 class masks.
Not an anatomical normality detector. Requires known AP side and explicit normal-
shaft eligibility. Proximal exclusion is a prediction-based heuristic, not an LT
landmark. Never changes canal/stem pixels or teacher data. No clinical auto-apply.
"""
import numpy as np
import cv2
from scipy.ndimage import grey_opening

PARAMS=dict(min_length=3,max_length_fraction=.20,min_height_px=3.,max_height_width_fraction=.75,shaft_start_fraction=.45,shaft_end_fraction=1.45)

def largest(binary):
 n,l,stats,_=cv2.connectedComponentsWithStats(binary.astype(np.uint8),8)
 if n<2:return np.zeros_like(binary,dtype=bool)
 return l==1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))

def bone_component(mask):
 _,labels,_,_=cv2.connectedComponentsWithStats((mask>0).astype(np.uint8),8)
 stem=largest(mask==3);ids,counts=np.unique(labels[stem],return_counts=True)
 if not len(ids):return np.zeros_like(mask,dtype=bool)
 return labels==ids[np.argmax(counts)]

def frame(mask,side):
 if side not in ('R','L'):raise ValueError('Known R/L and conventional non-mirrored AP orientation required')
 ys,xs=np.nonzero(largest(mask==3))
 if len(xs)<100:raise ValueError('Insufficient connected stem prediction')
 xy=np.column_stack((xs,ys));q=xy[ys>=np.quantile(ys,.35)]
 center=q.mean(0);ev,vec=np.linalg.eigh(np.cov(q.T));v=vec[:,-1]
 if v[1]<0:v=-v
 if v[1]<.7:raise ValueError('Oblique or unreliable stem direction; manual review required')
 n=np.array([v[1],-v[0]])*(1 if side=='L' else -1)
 t=(xy-center)@v;lo,hi=np.quantile(t,[.02,.98]);length=hi-lo
 if length<80:raise ValueError('Stem length too short for heuristic shaft ROI')
 yy,xx=np.indices(mask.shape);coords=np.stack((xx-center[0],yy-center[1]),-1)
 rows=np.rint(coords@v-lo).astype(int);u=coords@n
 start=int(np.ceil(length*PARAMS['shaft_start_fraction']));end=int(np.floor(length*PARAMS['shaft_end_fraction']))
 return dict(center=center.tolist(),v=v.tolist(),n=n.tolist(),lo=float(lo),length=float(length),start=start,end=end),rows,u

def shaft_component(binary,rows,u,start,end):
 out=np.zeros_like(binary,dtype=bool)
 for row in range(start,end+1):
  yy,xx=np.nonzero(binary&(rows==row))
  if not len(xx):continue
  order=np.argsort(u[yy,xx]);yy,xx=yy[order],xx[order];values=u[yy,xx]
  cuts=np.r_[0,np.flatnonzero(np.diff(values)>2)+1,len(values)]
  intervals=list(zip(cuts[:-1],cuts[1:]))
  a,b=min(intervals,key=lambda ab:np.min(np.abs(values[ab[0]:ab[1]])))
  out[yy[a:b],xx[a:b]]=True
 return out

def profile(binary,rows,u,start,end,valid=None):
 p=np.full(end-start+1,np.nan)
 for i,r in enumerate(range(start,end+1)):
  z=binary&(rows==r)
  if valid is not None:z &= valid
  if z.any():p[i]=np.max(u[z])
 return p

def runs(a):
 d=np.diff(np.r_[False,a,False].astype(int));return list(zip(np.flatnonzero(d==1),np.flatnonzero(d==-1)))

def propose(mask,side,normal_shaft_eligible=False):
 if not normal_shaft_eligible:raise ValueError('Normal-shaft eligibility must be explicitly selected; no pathology inference')
 if mask.shape!=(512,512) or not set(np.unique(mask))<={0,1,2,3}:raise ValueError('Expected 512x512 integer class mask 0..3')
 f,r,u=frame(mask,side);main=shaft_component(bone_component(mask),r,u,f['start'],f['end']);p=profile(main,r,u,f['start'],f['end'])
 out=mask.copy();report={'algorithm':'lateral_shaft_candidate_v1','params':PARAMS,'frame':f,'side':side,'normal_shaft_eligibility':'caller_selected_for_development_candidate_review','auto_apply':False,'segments':[],'rejected':[]}
 maxlen=max(5,int(round(PARAMS['max_length_fraction']*f['length'])));w=maxlen+1
 if w%2==0:w+=1
 for a,b in runs(np.isfinite(p)):
  if b-a<2*w:continue
  z=p[a:b];baseline=grey_opening(z,size=w,mode='nearest');res=z-baseline
  for aa,bb in runs(res>=PARAMS['min_height_px']):
   # Include the whole positive protrusion down to the baseline, not just its crest.
   while aa>0 and res[aa-1]>.25:aa-=1
   while bb<len(z) and res[bb]>.25:bb+=1
   if any(s['start_row']==f['start']+a+aa for s in report['segments']):continue
   height=float(res[aa:bb].max())
   widths=[np.ptp(u[main&(r==row)]) for row in range(f['start']+a+aa,f['start']+a+bb) if np.any(main&(r==row))]
   width=float(np.median(widths))
   reason=None
   if aa<2 or bb>len(z)-2:reason='no_two_sided_anchor'
   elif not PARAMS['min_length']<=bb-aa<=maxlen:reason='not_short_local_protrusion'
   elif height>max(6,width*PARAMS['max_height_width_fraction']):reason='large_uncertain_change'
   if reason:report['rejected'].append({'start_row':f['start']+a+aa,'length':bb-aa,'reason':reason});continue
   # Opening supplies a conservative lower envelope; retain 1px tolerance.
   changed=0
   for i in range(aa,bb):
    row=f['start']+a+i;remove=(r==row)&main&(mask==1)&(u>baseline[i]+1.)
    changed+=int(remove.sum());out[remove]=0
   report['segments'].append({'start_row':f['start']+a+aa,'end_row':f['start']+a+bb-1,'peak_height_px':height,'removed_pixels':changed})
 report['changed_pixels']=int((out!=mask).sum())
 assert np.array_equal(out[mask>=2],mask[mask>=2])
 assert np.array_equal(out[r<f['start']],mask[r<f['start']])
 assert np.array_equal(out[r>f['end']],mask[r>f['end']])
 return out,report
