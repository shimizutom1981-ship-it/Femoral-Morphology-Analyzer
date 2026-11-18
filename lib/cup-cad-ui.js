// Independent AP workspace; all points are in the current FMA image canvas.
(() => {
  const panel=$('cupCadPanel'), canvas=$('cupCanvas');
  let mode='baseline', message='', modelRequest=0;
  function validDraft(s){
    const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
    if(!s||s.schema!=='fma-cup-ap-input-v1'||typeof s.key!=='string'||
       !Array.isArray(s.baseline)||s.baseline.length>2||!s.baseline.every(point)||
       !Array.isArray(s.points)||s.points.length>64||!s.points.every(point)||(s.seed&&!point(s.seed)))return false;
    if(s.model){try{FmaCupCad.model(s.model);}catch{return false;}}
    return !s.fit||(s.model&&Array.isArray(s.fit.pose)&&s.fit.pose.length===4&&s.fit.pose.every(Number.isFinite)&&
      s.fit.pose[3]>=0&&s.fit.pose[3]<=90&&typeof s.fit.input==='string');
  }
  const copy=v=>JSON.parse(JSON.stringify(v));
  function imageKey(){
    if(!img || imageLoading || imageLoadFailed || !peHash || $('imageType').value!=='postop_THA' ||
       $('peProjection').value!=='AP' || $('rpDirection').value!=='AP') return null;
    return JSON.stringify([peHash,cv.width,cv.height,$('side').value,$('studyId').value.trim(),$('imageId').value.trim()]);
  }
  function state(create=false){
    const key=imageKey(); if(!key)return null;
    if(annotation.cup_cad?.key===key && validDraft(annotation.cup_cad))return annotation.cup_cad;
    if(!create)return null;
    return annotation.cup_cad={schema:'fma-cup-ap-input-v1',key,baseline:[],points:[],seed:null,model:null,fit:null,checked:false};
  }
  function seed(s){
    if(s.seed)return s.seed;
    const h=circle3(pts.head1,pts.head2,pts.head3);
    const c=h || annotation.head?.center;
    return c && Number.isFinite(c.x) && Number.isFinite(c.y)?[c.x,c.y]:null;
  }
  function scale(){const value=calibrationScale();return Number.isFinite(value)&&value>0?value:null;}
  function signature(s){return JSON.stringify([s.key,s.model,s.baseline,s.points,seed(s),scale()]);}
  function usable(s){return s?.fit && s.fit.input===signature(s);}
  function radius(s){const mm=scale();if(!mm)throw Error('先にFMAで骨頭径による倍率またはmm/pxを設定してください。');return s.model.opening_diameter_mm/(2*mm);}
  function mark(ctx,p,color){
    ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(p[0]-5,p[1]);ctx.lineTo(p[0]+5,p[1]);ctx.moveTo(p[0],p[1]-5);ctx.lineTo(p[0],p[1]+5);ctx.stroke();
  }
  function render(){
    if(!panel.open)return;
    const key=imageKey(), s=state(), c=canvas.getContext('2d');
    if(canvas.width!==cv.width || canvas.height!==cv.height){canvas.width=cv.width;canvas.height=cv.height;}
    c.clearRect(0,0,canvas.width,canvas.height);
    $('cupOutput').textContent='';$('cupConfirm').disabled=true;$('cupSave').disabled=true;
    $('cupModelInfo').textContent=s?.model?[s.model.model,s.model.version,s.model.status==='prototype'?'CT試作':'寸法照合済み',s.model.opening_diameter_mm.toFixed(2)+' mm'].join(' ／ '):'CADモデル未選択';
    if(!key){$('cupHint').textContent='術後の正面像を読み込み、撮影法をAPにしてください。';return;}
    c.drawImage(img,0,0,canvas.width,canvas.height); c.lineWidth=2;
    const guide={baseline:'左右の涙痕を1点ずつ指定',seed:'カップのおおよその中心を指定',rim:'金属シェルの開口縁を全周に分散して6点以上指定'};
    $('cupHint').textContent=(message?message+'　':'')+guide[mode]+'　涙痕 '+(s?.baseline.length||0)+'/2・開口縁 '+(s?.points.length||0)+'点';
    if(!s)return;
    if(s.baseline.length===2){c.strokeStyle='#5ccafa';c.beginPath();c.moveTo(...s.baseline[0]);c.lineTo(...s.baseline[1]);c.stroke();}
    s.baseline.forEach(p=>mark(c,p,'#5ccafa'));s.points.forEach(p=>mark(c,p,'#ffae42'));
    if(seed(s))mark(c,seed(s),'#fff');
    if(!usable(s))return;
    const p=s.fit.pose,r=radius(s),poly=FmaCupCad.project(p,r);c.strokeStyle='#29e1a2';c.beginPath();poly.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.stroke();
    const a=FmaCupCad.measure(p,s.baseline,r),ri=a.ri_deg===null?'判定困難（開口縁がほぼ円形）':a.ri_deg.toFixed(1)+'°';
    const quality=s.fit.rms_px==null?'画像縁自動検出':'指定点へのRMS '+(s.fit.rms_px*scale()).toFixed(2)+' mm';
    $('cupOutput').textContent='RI '+ri+'　|RA| '+a.ra_abs_deg.toFixed(1)+'°（前後の符号不定）　'+quality+'　'+(s.checked?'重ね合わせ確認済み':'要確認');
    $('cupConfirm').disabled=false;$('cupSave').disabled=!s.checked;
  }
  function action(fn){return(...args)=>{try{
    if(!imageKey())throw Error('術後正面像の読込完了を確認してください。');
    fn(...args);
  }catch(e){message=e.message;}render();};}
  function invalidate(s){s.fit=null;s.checked=false;delete s.reviewed_at;message='';}
  function changeMode(m){mode=m;message='';render();}
  $('cupBaseline').onclick=()=>changeMode('baseline');$('cupSeed').onclick=()=>changeMode('seed');$('cupRim').onclick=()=>changeMode('rim');
  canvas.onclick=action(e=>{
    const rect=canvas.getBoundingClientRect();
    const p=[(e.clientX-rect.left)*cv.width/rect.width,(e.clientY-rect.top)*cv.height/rect.height];
    const s=state(true);
    if(mode==='rim' && s.points.length>=64)throw Error('開口縁は64点までです。');
    invalidate(s);
    if(mode==='baseline'){if(s.baseline.length===2)s.baseline=[];s.baseline.push(p);if(s.baseline.length===2)mode='seed';}
    else if(mode==='seed'){s.seed=p;mode='rim';}else s.points.push(p);
    saveWork();
  });
  $('cupUndo').onclick=action(()=>{const s=state(true);invalidate(s);if(mode==='rim')s.points.pop();else if(mode==='seed')s.seed=null;else s.baseline.pop();saveWork();});
  $('cupModel').onchange=async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    const key=imageKey(), token=++modelRequest;
    try{
      if(!key)throw Error('先に術後AP画像を開いてください。');
      if(file.size>65536)throw Error('CAD開口縁モデルJSONを選んでください。');
      const model=FmaCupCad.model(JSON.parse(await file.text()));
      if(token!==modelRequest || key!==imageKey())return;
      const s=state(true);invalidate(s);s.model=model;saveWork();
    }catch(err){if(token===modelRequest && key===imageKey())message=err.message;}render();
  };
  function fit(manual){
    const s=state(true);invalidate(s);
    if(!s.model)throw Error('シェルCADの開口縁モデルを選んでください。');
    if(s.baseline.length!==2)throw Error('左右の涙痕を指定してください。');
    const r=radius(s);FmaCupCad.measure([0,0,0,0],s.baseline,r);
    let result;
    if(manual)result=FmaCupCad.fitPoints(s.points,r);
    else{
      const temp=document.createElement('canvas');temp.width=cv.width;temp.height=cv.height;
      const c=temp.getContext('2d',{willReadFrequently:true});c.drawImage(img,0,0,temp.width,temp.height);
      const rgba=c.getImageData(0,0,temp.width,temp.height).data, gray=new Uint8Array(temp.width*temp.height);
      for(let i=0;i<gray.length;i++)gray[i]=Math.round(.299*rgba[4*i]+.587*rgba[4*i+1]+.114*rgba[4*i+2]);
      result=FmaCupCad.detect(gray,temp.width,temp.height,seed(s),r);
    }
    s.fit={...result,input:signature(s)};saveWork();
  }
  $('cupFit').onclick=action(()=>fit(true));$('cupDetect').onclick=action(()=>fit(false));
  $('cupConfirm').onclick=action(()=>{const s=state();if(!usable(s))throw Error('再計測してください。');s.checked=true;s.reviewed_at=new Date().toISOString();saveWork();});
  $('cupSave').onclick=action(()=>{
    const s=state();if(!usable(s)||!s.checked)throw Error('最新の重ね合わせを確認してください。');
    const out={schema:'fma-cup-ap-result-v1',source:peSource(),research_id:$('studyId').value.trim(),image_id:$('imageId').value.trim(),side:$('side').value,
      model:s.model,mm_per_canvas_px:scale(),baseline_canvas_px:s.baseline,seed_canvas_px:seed(s),rim_canvas_px:s.points,fit:copy(s.fit),
      angles:FmaCupCad.measure(s.fit.pose,s.baseline,radius(s)),reviewed:true,exploratory:s.model.status==='prototype',reviewed_at:s.reviewed_at||null};
    delete out.fit.input;
    downloadBlob(JSON.stringify(out,null,2),'application/json','FMA_cup_AP_'+(out.research_id||'case')+'_'+out.side+'.json');
  });
  panel.addEventListener('toggle',render);
  const previousPayload=annotationPayload;
  annotationPayload=function(){
    const payload=previousPayload(),s=state();
    payload.cup_cad=s?copy(s):null;
    if(s && !usable(s)){payload.cup_cad.fit=null;payload.cup_cad.checked=false;delete payload.cup_cad.reviewed_at;}
    if(s&&usable(s))payload.cup_cad.angles=FmaCupCad.measure(s.fit.pose,s.baseline,radius(s));
    return payload;
  };
  const before=draw;
  draw=function(){before();render();};
  for(const id of ['studyId','imageId','side','imageType','headSize','calMode','scale','rpDirection','peProjection'])
    $(id).addEventListener('change',()=>{message='';render();});
})();
