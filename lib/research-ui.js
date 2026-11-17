// Browser adapter for the existing FMA app. Inlined after lib/research-profile.js.
const rpFieldIds=['rpDirection','rpTimepoint','rpSurgery','rpRule','rpSource','rpStorage'];
let rpMode=null,rpGapStart=null,rpResult=null,rpResultKey=null,rpPairInputs=[null,null],rpPairSequence=[0,0],rpPairResult=null;
const rpDownloadUrls={};let rpDownloadKey=null;
function rpClearDownloads(id){
  for(const url of rpDownloadUrls[id]||[])URL.revokeObjectURL(url);
  rpDownloadUrls[id]=[];$(id).textContent='';
}
function rpShowDownloads(id,files,overlay){
  rpClearDownloads(id);
  for(const [name,data,type]of files){
    const url=URL.createObjectURL(new Blob([data],{type}));rpDownloadUrls[id].push(url);
    const a=document.createElement('a');a.href=url;a.download=name;a.textContent=name;a.style.display='block';$(id).appendChild(a);
  }
  if(overlay){const a=document.createElement('a');a.href=overlay.url;a.download=overlay.name;a.textContent=overlay.name;a.style.display='block';$(id).appendChild(a);}
}
function rpOverlayPng(){
  const view={zoom,panX,panY,target:$('annotationTarget').value};
  try{zoom=1;panX=0;panY=0;$('annotationTarget').value='head';draw();return cv.toDataURL('image/png');}
  finally{zoom=view.zoom;panX=view.panX;panY=view.panY;$('annotationTarget').value=view.target;draw();}
}
function rpSettings(create=true){
  if(!annotation.research_settings&&create)annotation.research_settings={schema:'fma_research_settings_v1',proximal:null,exclusions:[],fields:{rpDirection:'AP',rpTimepoint:'',rpSurgery:'',rpRule:'',rpSource:'',rpStorage:''},confirmation:null};
  return annotation.research_settings;
}
function rpDate(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());}
function rpInput(){
  const s=rpSettings(false);if(!s)throw Error('研究用の近位0%点を指定してください');
  if($('imageType').value!=='postop_THA')throw Error('術後AP画像を指定してください');
  if(!img||imageLoading||imageLoadFailed)throw Error('元画像の読込完了を待ってください');
  const a=axisMetadata().femoral;if(!measurementGeometry())throw Error('骨軸・LTを確認してください');
  const dir=s.fields.rpDirection||'AP',tip=annotation.longitudinal_landmarks?.points?.stem_tip;
  const identity=measurementIdentity(),fields=s.fields;
  const contours={};
  for(const [side,suffix]of [['MED','medial'],['LAT','lateral']])contours[side]={outer:getRenderedContour('femur_'+suffix),inner:getRenderedContour('canal_'+suffix),stem:getRenderedContour('stem_'+suffix)};
  const input={direction:dir,side:$('side').value,reviewed:false,axis:a,calibration:{known_mm:positiveValue('headSize'),mm_per_px:calibrationScale(),method:$('calMode').value},image_size_px:{width:cv.width,height:cv.height},range:{proximal:s.proximal,tip},contours,exclusions:[],
    metadata:{record_id:null,research_id:identity.research_id,surgery_key:fields.rpSurgery||'',image_id:identity.image_id,observer_id:identity.observer_id,repeat_index:identity.repeat_index,boundary_rule_version:fields.rpRule||'',timepoint:fields.rpTimepoint||'',acquisition_date:annotation.longitudinal_landmarks?.acquisition_date||'',confirmed_date:s.confirmation?.date||'',source_image_ref:fields.rpSource||'',annotation_ref:null,output_ref:null,ai_model_version:aiLoaded?(aiProvenanceKnown?$('modelVersion').value||'UNKNOWN':'UNKNOWN'):'NOT_APPLICABLE'}};
  input.exclusions=s.exclusions.map(r=>{const x=FmaResearch.boneMm(input,r.from),y=FmaResearch.boneMm(input,r.to);return {from_mm:Math.min(x,y),to_mm:Math.max(x,y),side:r.side,boundary:r.boundary||'ALL',reason:r.reason};});
  input.reviewed=s.confirmation?.key===rpSignature(input);
  return input;
}
function rpSignature(input){
  const m={...input.metadata};delete m.record_id;delete m.output_ref;delete m.annotation_ref;delete m.confirmed_date;
  return JSON.stringify([FmaResearch.version,input.direction,input.side,input.axis.method,input.axis.version,input.axis.levels,input.axis.geometry,input.calibration,input.range,input.contours,input.exclusions,m,positiveValue('headSize'),cv.width,cv.height,window._fmaFile?.name||'',window._fmaFile?.size??null]);
}
function rpRender(){
  const s=rpSettings(false);for(const id of rpFieldIds)if(document.activeElement!==$(id))$(id).value=s?.fields?.[id]||(id==='rpDirection'?'AP':'');
  $('rpMarkStatus').textContent=rpMode==='proximal'?'次：髄腔幅を定義できる最も近位の高さをクリック':rpMode==='gap'?(rpGapStart?'次：欠測区間のもう一方の端をクリック':'次：欠測区間の一方の端をクリック'):(s?.proximal?'近位点 指定済':'近位点 未指定')+' ／ 欠測区間 '+(s?.exclusions?.length||0);
  if(!s){rpClearDownloads('rpDownloads');rpDownloadKey=null;rpResult=null;rpResultKey=null;$('rpStatus').textContent='研究出力は未設定です。';$('rpSave').disabled=true;$('rpSummary').textContent='';return;}
  try{
    const input=rpInput(),key=rpSignature(input);
    if(rpDownloadKey&&(!input.reviewed||key!==rpDownloadKey)){rpClearDownloads('rpDownloads');rpDownloadKey=null;}
    if(!input.reviewed){rpResult=null;rpResultKey=null;$('rpStatus').textContent='区間・全輪郭・欠測範囲を確認してください。';$('rpSave').disabled=true;$('rpSummary').textContent='';return;}
    if(key!==rpResultKey){rpResult=FmaResearch.profile(input);rpResultKey=key;}
    $('rpStatus').textContent='101点・1%刻み／CFRは%／被覆率90%以上の区間を要約。';
    const required=FmaResearch.identityErrors({...input.metadata,record_id:'preview',annotation_ref:'preview',output_ref:'preview'});
    if(!s.fields.rpStorage)required.push('保存先の参照');
    $('rpSave').disabled=required.length>0;
    $('rpSummary').textContent=rpResult.summaries.map(x=>`${x.code} ${x.side} ${x.region}: ${x.value===null?'欠測':x.value.toFixed(3)+' '+x.unit} (${x.valid_n}/${x.expected_n})`).join('\n')+(required.length?'\n保存に必要な項目：'+required.join('、'):'');
  }catch(err){rpClearDownloads('rpDownloads');rpDownloadKey=null;rpResult=null;rpResultKey=null;$('rpStatus').textContent=err.message;$('rpSummary').textContent='';$('rpSave').disabled=true;}
}
function rpCancel(){rpMode=null;rpGapStart=null;rpRender();}
function rpStart(mode){if(!img||imageLoading||imageLoadFailed){alert('元画像を読み込んでください');return;}lmStop();rpSettings();rpMode=mode;rpGapStart=null;drag=null;annotationDrag=null;rpRender();}
$('rpProximal').onclick=()=>rpStart('proximal');
$('rpGap').onclick=()=>rpStart('gap');
$('rpCancel').onclick=rpCancel;
$('rpUndoGap').onclick=()=>{const s=rpSettings();s.exclusions.pop();s.confirmation=null;draw();saveWork();};
$('rpConfirm').onclick=()=>{
  try{const input=rpInput();FmaResearch.validate(input,false);const s=rpSettings();s.confirmation={key:rpSignature(input),date:rpDate()};rpResultKey=null;draw();saveWork();}
  catch(err){$('rpStatus').textContent=err.message;}
};
for(const id of rpFieldIds)$(id).onchange=()=>{const s=rpSettings();s.fields[id]=$(id).value;s.confirmation=null;rpResultKey=null;rpRender();saveWork();};
for(const id of ['studyId','imageId','observerId','repeatIndex','side','imageType','modelVersion','headSize','calMode','scale','lmDate'])$(id).addEventListener('change',rpRender);
cv.addEventListener('pointerdown',e=>{
  if(!rpMode||e.button===1||e.altKey)return;e.stopImmediatePropagation();e.preventDefault();
  if(e.button!==0||!img||imageLoading||imageLoadFailed)return;
  const p=pos(e);if(p.x<0||p.y<0||p.x>cv.width||p.y>cv.height)return;
  const s=rpSettings();
  if(rpMode==='proximal'){s.proximal={x:p.x,y:p.y};rpMode=null;}
  else if(!rpGapStart)rpGapStart={x:p.x,y:p.y};
  else{const reason=$('rpGapReason').value.trim();if(!reason){$('rpStatus').textContent='欠測理由を記入してください';return;}s.exclusions.push({from:rpGapStart,to:{x:p.x,y:p.y},side:$('rpGapSide').value,boundary:$('rpGapBoundary').value||'ALL',reason});rpMode=null;rpGapStart=null;}
  s.confirmation=null;rpResultKey=null;draw();saveWork();
},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')rpCancel();});
document.addEventListener('click',e=>{if(rpMode&&e.target!==cv&&!e.target.closest('#rpPanel'))rpCancel();},true);
const rpDrawBefore=draw;
draw=function(){rpDrawBefore();rpRender();const s=rpSettings(false);if(!img||!s?.proximal)return;
  const g=femoralPreviewGeometry();if(!g)return;ctx.save();ctx.setTransform(zoom,0,0,zoom,panX,panY);ctx.strokeStyle='#fb7185';ctx.fillStyle='#fb7185';ctx.lineWidth=2/zoom;
  for(const [label,p]of [['0%',s.proximal],['100%',annotation.longitudinal_landmarks?.points?.stem_tip]])if(p){ctx.beginPath();ctx.moveTo(p.x-g.vy*50,p.y+g.vx*50);ctx.lineTo(p.x+g.vy*50,p.y-g.vx*50);ctx.stroke();ctx.font=(14/zoom)+'px sans-serif';ctx.fillText(label,p.x+8/zoom,p.y-8/zoom);}
  for(const r of s.exclusions){ctx.beginPath();ctx.moveTo(r.from.x,r.from.y);ctx.lineTo(r.to.x,r.to.y);ctx.stroke();ctx.fillText('欠測 '+r.side,r.from.x+8/zoom,r.from.y);}
  ctx.restore();
};
const rpRestoreBefore=restoreWorkData;
restoreWorkData=function(data){rpMode=null;rpGapStart=null;rpResult=null;rpResultKey=null;rpRestoreBefore(data);rpRender();};
const rpImageChangeBefore=$('file').onchange;
$('file').onchange=function(e){rpMode=null;rpGapStart=null;rpResult=null;rpResultKey=null;return rpImageChangeBefore(e);};
const rpRecordBefore=buildDataDictionaryV11Record;
buildDataDictionaryV11Record=function(){
  const r=rpRecordBefore();if(!rpSettings(false))return r;
  try{r.research_profile=FmaResearch.profile(rpInput());r.research_profile_status='candidate_without_registry_export_identity';}
  catch(err){r.research_profile=null;r.research_profile_status='review_required';r.research_profile_reason=err.message;}
  return r;
};
function rpRef(storage,file){return storage+' :: '+file;}
function rpExportFiles(){
  const input=rpInput(),s=rpSettings(false);if(!input.reviewed)throw Error('区間・輪郭の確認が必要です');
  if(!textStorage(s.fields.rpStorage))throw Error('保存先の参照を入力してください');
  const id='rp_'+crypto.randomUUID(),name='FMA_'+id+'_research.json',storage=s.fields.rpStorage;
  input.metadata={...input.metadata,record_id:id,output_ref:rpRef(storage,name),annotation_ref:rpRef(storage,name)+'#raw_annotations'};
  const p=FmaResearch.profile(input),registry=FmaResearch.registry(p),record=rpRecordBefore();
  record.research_profile=p;record.research_profile_status='candidate_registry_export';record.provenance_and_split.record_key=id;record.raw_annotations.record_key=id;
  // Preserve the exact calibrated scale in this new export, not the legacy six-decimal display rounding.
  record.calibration_metrics.calibrated_mm_per_px=input.axis.geometry.mmPerPx;
  record.raw_annotations.calibration.mm_per_px=input.axis.geometry.mmPerPx;
  record.registry_export={schema:'fma_registry_rows_v1',value_input_option:'RAW',...registry};
  record.research_artifacts={annotation_png_ref:rpRef(storage,name.replace('_research.json','_overlay.png'))};
  return [[name,JSON.stringify(record,null,2),'application/json'],['FMA_'+id+'_profile101.csv',FmaResearch.profileCsv(p),'text/csv;charset=utf-8'],['FMA_'+id+'_FMA_images.csv',FmaResearch.csv(registry.images),'text/csv;charset=utf-8'],['FMA_'+id+'_FMA_metrics.csv',FmaResearch.csv(registry.metrics),'text/csv;charset=utf-8']];
}
function textStorage(v){return typeof v==='string'&&v.trim().length>0;}
$('rpSave').onclick=()=>{try{const files=rpExportFiles(),overlay={name:files[0][0].replace('_research.json','_overlay.png'),url:rpOverlayPng()};rpShowDownloads('rpDownloads',files,overlay);rpDownloadKey=rpSignature(rpInput());$('rpStatus').textContent='5ファイルを作成しました。下のリンクをそれぞれクリックして保存し、保存先で5ファイルを確認してください。採用状態はPENDINGです。';}catch(err){rpClearDownloads('rpDownloads');rpDownloadKey=null;$('rpStatus').textContent=err.message;}};
function rpClearPair(){rpClearDownloads('rpPairDownloads');rpPairResult=null;$('rpPairSave').disabled=true;$('rpPairSummary').textContent='';}
for(let n=0;n<2;n++)$('rpPairFile'+n).onchange=async e=>{
  const file=e.target.files?.[0],seq=++rpPairSequence[n];e.target.value='';rpPairInputs[n]=null;rpClearPair();$('rpPairConfirm').checked=false;$('rpPairRelative').checked=false;
  if(!file){$('rpPairStatus'+n).textContent='未選択';return;}
  try{const r=JSON.parse(await file.text());if(seq!==rpPairSequence[n])return;const p=r.research_profile||r;FmaResearch.registry(p);rpPairInputs[n]=p;$('rpPairStatus'+n).textContent='読込済：'+p.input.metadata.acquisition_date;}
  catch(err){if(seq!==rpPairSequence[n])return;$('rpPairStatus'+n).textContent='読込不可：'+err.message;}
};
$('rpPairConfirm').onchange=rpClearPair;$('rpPairRelative').onchange=rpClearPair;
$('rpPairCompute').onclick=()=>{
  rpClearPair();try{if(rpPairInputs.some(x=>!x))throw Error('早期・12か月の研究JSONを選んでください');rpPairResult=FmaResearch.compare(...rpPairInputs,{pairConfirmed:$('rpPairConfirm').checked,relativeBaselineConfirmed:$('rpPairRelative').checked});
    $('rpPairSummary').textContent=rpPairResult.summaries.map(s=>s.code+' '+s.side+' '+s.region+': '+(s.value===null?'欠測':s.value.toFixed(3)+' '+s.unit)+' ('+s.valid_n+'/'+s.expected_n+')').join('\n');$('rpPairSave').disabled=false;}
  catch(err){$('rpPairSummary').textContent=err.message;}
};
function rpPairExportFiles(){
  if(!rpPairResult||!$('rpPairConfirm').checked)throw Error('比較可能性を確認して再計算してください');
  const storage=$('rpPairStorage').value;if(!textStorage(storage))throw Error('経時比較の保存先参照を入力してください');
  const name='FMA_cortex_pair_'+crypto.randomUUID()+'.json',ref=rpRef(storage,name),r=FmaResearch.registry(rpPairResult,{outputRef:ref});
  return [[name,JSON.stringify({...rpPairResult,output_ref:ref,registry_export:{schema:'fma_registry_rows_v1',value_input_option:'RAW',...r}},null,2),'application/json'],[name.replace('.json','_FMA_images.csv'),FmaResearch.csv(r.images),'text/csv;charset=utf-8'],[name.replace('.json','_FMA_metrics.csv'),FmaResearch.csv(r.metrics),'text/csv;charset=utf-8']];
}
$('rpPairStorage').addEventListener('change',()=>rpClearDownloads('rpPairDownloads'));
$('rpPairSave').onclick=()=>{try{rpShowDownloads('rpPairDownloads',rpPairExportFiles());}catch(err){rpClearDownloads('rpPairDownloads');$('rpPairSummary').textContent=err.message;}};
rpRender();
