// Point correction adapter. Native pixels are stored alongside legacy canvas pixels.
let peActive=false,peDrag=null,peSelected='ltm',peUndoStack=[],peHash=null,peLoadToken=0,peBusy=false,peLastMessage='';
const peLabels={ltm:'小転子',head1:'ヘッド外周1',head2:'ヘッド外周2',head3:'ヘッド外周3',head4:'ヘッド外周4',head5:'ヘッド外周5',head6:'ヘッド外周6',stem_tip:'ステム先端',gt_apex:'大転子頂部',stem_shoulder:'ステム肩',stem_prox:'ステム軸・近位',stem_dist:'ステム軸・遠位',rp_proximal:'研究範囲・近位0%'};
const peContours=['femur_medial','femur_lateral','canal_medial','canal_lateral','stem_medial','stem_lateral'];
function peSource(){return{sha256:peHash,width:img?.naturalWidth||img?.width,height:img?.naturalHeight||img?.height,canvas_width:cv.width,canvas_height:cv.height};}
function peState(create=false){
  if(!annotation.point_edits&&create)annotation.point_edits=FmaPointEdits.create(peSource(),crypto.randomUUID());
  return annotation.point_edits;
}
function peReady(){if(!img||imageLoading||imageLoadFailed)throw Error('元画像の読込完了を待ってください');FmaPointEdits.source(peSource());if(peState())FmaPointEdits.assertSame(peState().source,peSource());}
function peGet(k){
  if(k==='ltm')return pts.ltm||annotation.lt_midpoint||null;
  if(k==='rp_proximal')return rpSettings(false)?.proximal||null;
  if(k.startsWith('head'))return annotation._head_points?.[Number(k.slice(4))-1]||pts[k]||null;
  if(lmKeys.includes(k))return annotation.longitudinal_landmarks?.points?.[k]||null;
  return pts[k]||null;
}
function peSet(k,p){
  const q=p?{x:p.x,y:p.y}:null;
  if(k==='ltm'){annotation.lt_midpoint=q;if(q)pts.ltm={...q};else delete pts.ltm;}
  else if(k==='rp_proximal')rpSettings().proximal=q;
  else if(lmKeys.includes(k)){if(q)lmData().points[k]=q;else delete lmData().points[k];}
  else if(k.startsWith('head')){
    const i=Number(k.slice(4))-1;
    const hp=annotation._head_points||(annotation._head_points=['head1','head2','head3'].map(t=>pts[t]).filter(Boolean).map(t=>({...t})));
    if(i>hp.length)throw Error('ヘッド外周は番号順に指定してください');
    if(q)hp[i]=q;else hp.splice(i,1);
    const cc=hp.length>=3?fitCircleLeastSquares(hp):null;
    annotation.head=cc?{center:{x:cc.x,y:cc.y},radius_px:cc.r,rmse_px:cc.rmse||0,source:'point-editor-least-squares'}:null;
    // Legacy calibrationScale uses three points: represent the same fitted circle.
    for(const t of ['head1','head2','head3'])delete pts[t];
    if(cc){pts.head1={x:cc.x-cc.r,y:cc.y};pts.head2={x:cc.x,y:cc.y-cc.r};pts.head3={x:cc.x+cc.r,y:cc.y};}
  }else if(q)pts[k]=q;else delete pts[k];
}
function peValues(){
  const v={};for(const k of Object.keys(peLabels))v['point:'+k]=peGet(k);
  for(const k of peContours)v['contour:'+k]=[getRenderedContour(k),annotationClosed[k],$('side').value,peState()?.projection||'AP'];
  v.sides=[$('side').value,peState()?.projection||'AP'];v.diameter=positiveValue('headSize');return v;
}
function peFingerprint(){const a={...annotation};delete a.point_edits;return JSON.stringify([pts,a,annotationClosed,$('side').value,$('headSize').value,$('calMode').value,$('scale').value,$('ltVisibility').value,measurementIdentity(),peState()?.projection||'AP']);}
function peSnapshot(){const a=FmaPointEdits.clone(annotation);delete a.point_edits;return{pts:FmaPointEdits.clone(pts),annotation:a,closed:FmaPointEdits.clone(annotationClosed),reviews:FmaPointEdits.clone(peState()?.reviews||{}),confirmedLTKey,acquisitionReview:FmaPointEdits.clone(acquisitionReview),accepted};}
function peRestore(s){
  const audit=peState();pts=FmaPointEdits.clone(s.pts);annotation={...FmaPointEdits.clone(s.annotation),point_edits:audit};annotationClosed=FmaPointEdits.clone(s.closed);
  if(audit)audit.reviews=FmaPointEdits.clone(s.reviews);
  acquisitionReview={};acquisitionInputKey=null;axisInputKey=null;confirmedLTKey=null;refreshFemoralAxis();acquisitionReview=FmaPointEdits.clone(s.acquisitionReview);refreshFemoralAxis();
  if(s.confirmedLTKey===axisInputKey)confirmedLTKey=s.confirmedLTKey;accepted=s.accepted;draw();
}
function peActor(){return $('observerId').value.trim()||null;}
function peRecord(action,key,before,after,extra={}){
  const s=peState(true),src=peSource();FmaPointEdits.append(s,{action,point_id:key||null,before_original:before?FmaPointEdits.original(before,src):null,after_original:after?FmaPointEdits.original(after,src):null,timestamp:new Date().toISOString(),actor:peActor(),identity:measurementIdentity(),surgery_key:rpSettings(false)?.fields?.rpSurgery||null,boundary_rule_version:rpSettings(false)?.fields?.rpRule||null,input_method:'FMA_DIRECT',...extra});
}
function peCommit(key,before,snapshot){
  const after=peGet(key);if(JSON.stringify(before)===JSON.stringify(after))return;
  annotationCorrectionCount++;peRecord('move',key,before,after);
  draw();peUndoStack.push({key,before,snapshot,afterFingerprint:peFingerprint()});
  peLastMessage='更新対象：'+FmaPointEdits.impact(key).join('、')+'。点と計測結果の確認は別です。';saveWork();peRender();
}
function peMove(key,p){peReady();if(peBusy)throw Error('保存中です');if(!FmaPointEdits.point(p)||p.x<0||p.y<0||p.x>cv.width||p.y>cv.height)throw Error('画像範囲内を指定してください');peState(true);const before=FmaPointEdits.clone(peGet(key)),snap=peSnapshot();try{peSet(key,p);peCommit(key,before,snap);}catch(e){peRestore(snap);throw e;}}
function peUndo(){
  peReady();const last=peUndoStack.at(-1);if(!last)return;
  if(peFingerprint()!==last.afterFingerprint)throw Error('別の入力が変更されています。元に戻す操作は適用していません');
  const from=FmaPointEdits.clone(peGet(last.key));peUndoStack.pop();peRestore(last.snapshot);peRecord('undo',last.key,from,peGet(last.key));
  peLastMessage='修正前の点と確認状態へ戻しました。履歴は保持しています。';saveWork();peRender();
}
function peCancel(){if(peDrag){peRestore(peDrag.snapshot);peDrag=null;}peActive=false;drag=null;annotationDrag=null;cv.style.cursor='';peRender();}
function peStart(){peReady();peState(true);lmStop();rpCancel();drag=null;annotationDrag=null;peActive=true;peSelected=$('peTarget').value||'ltm';cv.style.cursor='crosshair';cv.focus();draw();}
function peConfirmPoints(){
  peReady();if(peDrag)throw Error('点の移動を終了してください');const s=peState(true),time=new Date().toISOString();
  for(const [scope,value]of Object.entries(peValues()))if(scope.startsWith('point:')&&value)FmaPointEdits.review(s,scope,value,peActor(),time);
  peRecord('review_points',null,null,null,{scope:'visible_landmarks_only'});saveWork();peRender();
}
function peReviewContours(){
  peReady();const s=peState(true),time=new Date().toISOString(),v=peValues();
  for(const k of peContours)if(getRenderedContour(k).length>=2)FmaPointEdits.review(s,'contour:'+k,v['contour:'+k],peActor(),time);
  peRecord('review_contours',null,null,null);saveWork();peRender();
}
function peRender(){
  const s=peState(),p=peGet(peSelected),v=peValues();
  $('peToggle').textContent=peActive?'点修正を終了':'点修正を開始';$('peUndo').disabled=!peUndoStack.length||peBusy;
  $('peSave').disabled=peBusy||!img||imageLoading||!peHash;
  if(document.activeElement!==$('peProjection'))$('peProjection').value=s?.projection||'AP';
  const q=p&&peHash?FmaPointEdits.original(p,peSource()):null;
  $('pePointStatus').textContent=(peLabels[peSelected]||peSelected)+(q?'：元画像 ('+q.x.toFixed(1)+', '+q.y.toFixed(1)+')':'：未指定')+(p?(FmaPointEdits.reviewed(s,'point:'+peSelected,p)?' ／ 確認済み':' ／ 要確認'):'');
  const reviewed=peContours.filter(k=>FmaPointEdits.reviewed(s,'contour:'+k,v['contour:'+k])).length;
  $('peStatus').textContent='輪郭確認 '+reviewed+'/6 ／ 修正版 '+(s?.revision||0)+'。'+peLastMessage;
}
function peSafe(fn){return(...args)=>{try{return fn(...args);}catch(e){peLastMessage=e.message;peRender();}};}
$('peToggle').onclick=peSafe(()=>peActive?peCancel():peStart());
$('peTarget').onchange=()=>{peSelected=$('peTarget').value;draw();};
$('peUndo').onclick=peSafe(peUndo);$('peReviewLines').onclick=peSafe(peReviewContours);
$('peProjection').onchange=peSafe(()=>{
  peReady();const s=peState(true),p=$('peProjection').value;if(!['AP','LAUENSTEIN','AXIAL'].includes(p))throw Error('撮影法が不正です');
  peCancel();s.projection=p;peUndoStack=[];rpSettings().fields.rpDirection=p==='AP'?'AP':'AXIAL';rpSettings().confirmation=null;axisInputKey=null;confirmedLTKey=null;
  peRecord('projection',null,null,null,{projection:p});peLastMessage=p==='AP'?'正面用の計測規約で確認してください。':'側面は点修正のみ。骨軸・計測値は未検証です。';draw();saveWork();
});
cv.tabIndex=0;
cv.addEventListener('pointerdown',e=>{
  if(!peActive||e.button===1||e.altKey)return;e.preventDefault();e.stopImmediatePropagation();if(e.button!==0||peBusy)return;
  peSafe(()=>{peReady();const p=pos(e),old=peGet(peSelected);if(old&&Math.hypot(p.x-old.x,p.y-old.y)*zoom<22){peDrag={key:peSelected,before:FmaPointEdits.clone(old),snapshot:peSnapshot()};cv.setPointerCapture(e.pointerId);}else peMove(peSelected,p);cv.focus();})()
},true);
cv.addEventListener('pointermove',e=>{if(!peDrag)return;e.preventDefault();e.stopImmediatePropagation();const p=pos(e);if(p.x>=0&&p.y>=0&&p.x<=cv.width&&p.y<=cv.height){peSet(peDrag.key,p);draw();}},true);
cv.addEventListener('pointerup',e=>{if(!peDrag)return;e.stopImmediatePropagation();const d=peDrag;peDrag=null;peSafe(()=>peCommit(d.key,d.before,d.snapshot))();},true);
cv.addEventListener('pointercancel',()=>{if(peDrag){peRestore(peDrag.snapshot);peDrag=null;draw();}},true);
document.addEventListener('keydown',e=>{
  if(!peActive||peBusy)return;const tag=e.target?.tagName?.toLowerCase();if(['input','textarea','select'].includes(tag)||e.target?.isContentEditable)return;
  if(e.key==='Escape'){e.preventDefault();peCancel();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();peSafe(peUndo)();return;}
  const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d)return;
  e.preventDefault();const p=peGet(peSelected);if(!p)return;const q=FmaPointEdits.original(p,peSource()),step=e.shiftKey?10:1;
  peSafe(()=>peMove(peSelected,FmaPointEdits.canvas({x:q.x+d[0]*step,y:q.y+d[1]*step},peSource())))();
},true);
// Side images are annotation-only until a lateral axis contract exists.
const peAxisBefore=refreshFemoralAxis;
refreshFemoralAxis=function(){if(peState()?.projection&&peState().projection!=='AP'){confirmedLTKey=null;accepted=false;profileRows=[];continuousSlices=[];continuousSummary={};femoralAxisResult={status:'error',reason:'側面：点修正のみ／骨軸・計測は未検証'};return femoralAxisResult;}return peAxisBefore();};
for(const id of ['accept','export','exportProfile','saveCase','saveCloud','saveAnnotation'])$(id).addEventListener('click',e=>{if(peState()?.projection&&peState().projection!=='AP'){e.preventDefault();e.stopImmediatePropagation();peLastMessage='側面は「点を確定して保存」を使用してください。APの計測・学習出力は作成しません。';peRender();}},true);
const peDrawBefore=draw;
draw=function(){peDrawBefore();if(img&&peState()){ctx.save();ctx.setTransform(zoom,0,0,zoom,panX,panY);for(const k of Object.keys(peLabels)){const p=peGet(k);if(!p)continue;ctx.strokeStyle=FmaPointEdits.reviewed(peState(),'point:'+k,p)?'#22c55e':'#fb7185';ctx.lineWidth=2/zoom;ctx.beginPath();ctx.arc(p.x,p.y,(k===peSelected?10:6)/zoom,0,Math.PI*2);ctx.stroke();if(k===peSelected){ctx.beginPath();ctx.moveTo(p.x-16/zoom,p.y);ctx.lineTo(p.x+16/zoom,p.y);ctx.moveTo(p.x,p.y-16/zoom);ctx.lineTo(p.x,p.y+16/zoom);ctx.stroke();ctx.font=(13/zoom)+'px sans-serif';ctx.fillStyle=ctx.strokeStyle;ctx.fillText(peLabels[k],p.x+14/zoom,p.y-12/zoom);}}ctx.restore();}peRender();};
const peEmptyBefore=emptyAnnotation;
emptyAnnotation=function(){return{...peEmptyBefore(),point_edits:null};};
const pePayloadBefore=annotationPayload;
annotationPayload=function(){const raw=pePayloadBefore();raw.point_edits=peState()?FmaPointEdits.clone(peState()):null;if(peState())raw._head_points=annotation._head_points;if(peState()?.projection&&peState().projection!=='AP')raw.training_schema='SIDE_landmarks_only_v1';return raw;};
const peValidateBefore=validateRecordImport;
validateRecordImport=function(record){const raw=peValidateBefore(record);if(raw.point_edits){FmaPointEdits.validate(raw.point_edits);if(img&&!imageLoading&&peHash)FmaPointEdits.assertSame(raw.point_edits.source,peSource());}return raw;};
const peImportBefore=applyRecordImport;
applyRecordImport=function(record,filename){const raw=validateRecordImport(record);if(raw.point_edits)FmaPointEdits.assertSame(raw.point_edits.source,peSource());const ok=peImportBefore(record,filename);if(ok&&raw.point_edits){annotation._head_points=FmaPointEdits.clone(raw._head_points||[]);draw();saveWork();}return ok;};
const peRestoreBefore=restoreWorkData;
restoreWorkData=function(data){if(data.annotation?.point_edits){FmaPointEdits.validate(data.annotation.point_edits);FmaPointEdits.assertSame(data.annotation.point_edits.source,peSource());}peActive=false;peDrag=null;peUndoStack=[];peRestoreBefore(data);peRender();};
const peSaveWorkBefore=saveWork;
saveWork=function(){peSaveWorkBefore();if(!window._fmaFile||!peState())return;try{const saved=JSON.parse(localStorage.getItem(imageWorkKey(window._fmaFile))||'null');$('peStorage').textContent=saved?.annotation?.point_edits?.revision===peState().revision?'この端末に作業保存済み／Drive未反映':'作業保存を確認できません。ファイル保存してください';}catch(e){$('peStorage').textContent='作業保存できません。ファイル保存してください';}};
const peFileBefore=$('file').onchange;
$('file').onchange=async function(e){
  const file=e.target.files?.[0],token=++peLoadToken;peCancel();peHash=null;peUndoStack=[];peLastMessage='';if(!file)return peFileBefore.call(this,e);
  imageLoading=true;peRender();
  try{if(file.arrayBuffer&&crypto.subtle){const bytes=await file.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',bytes);if(token!==peLoadToken)return;peHash=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');}}catch(err){peLastMessage='画像照合に失敗しました。点修正の保存は停止しています';}
  if(token!==peLoadToken)return;return peFileBefore.call(this,e);
};
function peBundle(){
  peReady();if(peDrag)throw Error('点の移動を終了してください');const s=peState(true),native={};for(const k of Object.keys(peLabels)){const p=peGet(k);if(p)native[k]=FmaPointEdits.original(p,peSource());}
  const view={zoom,panX,panY};let png;try{zoom=1;panX=0;panY=0;draw();png=cv.toDataURL('image/png');}finally{zoom=view.zoom;panX=view.panX;panY=view.panY;draw();}
  return{schema:'fma_point_correction_bundle_v1',record_id:s.record_id,revision:s.revision,projection:s.projection,source:s.source,original_pixel_points:native,raw_annotations:annotationPayload(),preview:{mime_type:'image/png',data_url:png,coordinate_space:'canvas_px'},clinical_measurements_status:'not_adopted',storage_status:'local_file_only',timestamp:new Date().toISOString()};
}
$('peSave').onclick=async()=>{
  if(peBusy)return;let picker;
  try{peReady();if(!ensureCaseId())throw Error('Research IDを入力してください');
    // Invoke the picker in the user's activation before any asynchronous rendering.
    const name='FMA_'+encodeURIComponent(ensureCaseId())+'_'+peState(true).record_id+'_points.json';
    if(window.showSaveFilePicker)picker=window.showSaveFilePicker({suggestedName:name,types:[{description:'FMA点修正記録',accept:{'application/json':['.json']}}]});
    peConfirmPoints();const bundle=peBundle(),body=JSON.stringify(bundle,null,2);peBusy=true;peRender();
    if(picker){const handle=await picker,w=await handle.createWritable();await w.write(new Blob([body],{type:'application/json'}));await w.close();$('peStorage').textContent='修正版 '+bundle.revision+' をファイル保存済み／Drive未反映';}
    else{downloadBlob(body,'application/json',name);$('peStorage').textContent='ダウンロードを開始しました。端末で保存を確認してください／Drive未反映';}
    peLastMessage='点・確認状態・注釈図・履歴を1ファイルにまとめました。計測結果の採用は別確認です。';
  }catch(e){if(picker)picker.catch(()=>{});$('peStorage').textContent=e.name==='AbortError'?'保存をキャンセルしました／作業はこの端末に保持':'ファイル保存失敗：'+e.message;}
  finally{peBusy=false;peRender();}
};
peRender();
