const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const path=require('path');process.chdir(path.join(__dirname,'..'));
const html=fs.readFileSync('index.html','utf8');
const elements={};const ctx=new Proxy({}, {get:(t,k)=>t[k]||(()=>{})});
const document={getElementById(id){return elements[id]??={value:'',textContent:'',style:{},width:1200,height:1500,addEventListener(){},getContext(){return ctx}}}};
const front=vm.createContext({document,window:{addEventListener(){}},console,crypto,alert(){},setTimeout,localStorage:{setItem(){}}});
vm.runInContext(html.split('<script>')[1].split('</script>')[0],front);
const run=s=>vm.runInContext(s,front),set=(id,v)=>document.getElementById(id).value=String(v);
set('imageType','postop_THA');set('calMode','head');set('side','R');set('studyId','CASE14');set('observerId','TS');set('repeatIndex',1);set('imageId','AP01');
run('annotation.head={radius_px:100};pts.sap={x:300,y:300};pts.sad={x:300,y:900};pts.ltm={x:300,y:400}');
set('scale',0.16);assert.equal(run('calibrationScale()'),null,'blank diameter must invalidate stale scale');
set('headSize',32);assert.equal(run('calibrationScale()'),0.16);
set('headSize',36);assert.equal(run('calibrationScale()'),0.18,'edited diameter recalculates scale');
set('headSize','');run('continuousSummary={mean_stem_fill_total:0.8};profileRows=[{distance_from_LT_mm:100,CTI:0.5}]');
let record=run('buildDataDictionaryV11Record()');assert.equal(record.calibration_metrics.calib_known_mm,null);assert.equal(record.segmentation_qc.lt_visibility_status,null);assert.equal(record.discrete_parameters.cti_minus100,null);assert.equal(record.continuous_profile.profile_slices.length,0);
set('calMode','manual');set('scale',0.2);assert.equal(run('calibrationScale()'),0.2);
run('aiLoaded=true');record=run('buildDataDictionaryV11Record()');assert.equal(record.provenance_and_split.model_version,null);
set('modelVersion','weights-sha-123');record=run('buildDataDictionaryV11Record()');assert.equal(record.provenance_and_split.model_version,'weights-sha-123');
const first=run('measurementKey()');set('repeatIndex',2);assert.notEqual(run('measurementKey()'),first);set('repeatIndex',1);set('observerId','NK');assert.notEqual(run('measurementKey()'),first);set('observerId','TS');assert.notEqual(run('newSaveKey()'),run('newSaveKey()'));
const data=[['research_id','custom_note'],['CASE14','legacy preserved']];const files=new Map();let locked=false;
const sheet={getLastRow:()=>data.length,getLastColumn:()=>data[0].length,setFrozenRows(){},appendRow:r=>data.push(r),getRange(r,c,n,w){return {getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>data[r-1+i]?.[c-1+j]??'')),setValues(rows){rows.forEach((row,i)=>{data[r-1+i]??=[];row.forEach((v,j)=>data[r-1+i][c-1+j]=v)})}}}};
const folder={getFilesByName(name){const existing=files.get(name);let used=false;return {hasNext:()=>!!existing&&!used,next(){used=true;return existing}}},createFile(name,content){const f={content,getUrl:()=>name,setContent(v){this.content=v},setTrashed(){files.delete(name)}};files.set(name,f);return f}};
const server=vm.createContext({console,DriveApp:{getFolderById:()=>folder},SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet})},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);locked=true},releaseLock(){locked=false}})},MimeType:{PLAIN_TEXT:'text',CSV:'csv'}});
vm.runInContext(fs.readFileSync('Code.gs','utf8'),server);
function save(){const r=JSON.parse(JSON.stringify(run('buildDataDictionaryV11Record()')));r.provenance_and_split.record_key=run('newSaveKey()');server.payload=r;run('0');vm.runInContext('saveFmaRecordToCloud(payload)',server);return r}
const a=save();const b=save();set('observerId','NK');save();set('repeatIndex',2);save();assert.equal(data.length,6);assert.deepEqual(data[1],['CASE14','legacy preserved']);assert.equal(data[2][data[0].indexOf('calib_known_mm')],'');assert.equal(data[2][data[0].indexOf('lt_visibility_status')],'');assert.equal(data[2][data[0].indexOf('model_version')],'weights-sha-123');assert.notEqual(a.provenance_and_split.record_key,b.provenance_and_split.record_key);
server.payload=a;vm.runInContext('saveFmaRecordToCloud(payload)',server);assert.equal(data.length,6,'retry must not append duplicate');
server.payload={provenance_and_split:{research_id:'CASE14'}};assert.throws(()=>vm.runInContext('saveFmaRecordToCloud(payload)',server));assert.equal(locked,false);
assert.equal(files.size,8,'four snapshots each preserve record and annotation');
console.log('PASS: calibration missing/change/manual; stale measurement clearing; unknown/known model; observer/repeat keys; immutable saves; legacy preservation; header mapping; retry; old-client rejection');


// Synthetic segmentation-mask regressions (no patient images).
// Ensure the proximal medial neck-cut edge is discarded, the connected stem tip
// is retained, and isolated distal class-3 noise is not interpreted as the tip.
function syntheticMask(side='R',withTurn=true){
  const w=512,h=512,pixels=new Uint8ClampedArray(w*h*4);
  const mark=(x,y,k)=>{
    const xx=side==='R'?x:w-1-x;
    const idx=(y*w+xx)*4;pixels[idx]=k;pixels[idx+1]=k;pixels[idx+2]=k;pixels[idx+3]=255;
  };
  for(let y=30;y<=250;y++){
    const med=withTurn?(y<=90?Math.round(230+(y-30)*1.1):Math.round(296-(y-90)*.12)):290;
    const fR=withTurn?(y<=90?Math.round(260+(y-30)*.9):Math.round(314-(y-90)*.07)):330;
    const cR=withTurn?(y<=90?Math.round(245+(y-30)*1):Math.round(305-(y-90)*.08)):310;
    const stL=y>235?Math.round(185+(y-235)*1.1):185;
    const stR=y>235?Math.max(stL,Math.round(med-(y-235)*2)):med;
    for(let x=120;x<=fR;x++){
      let k=1;
      if(x>=155&&x<=cR)k=2;
      if(x>=stL&&x<=stR)k=3;
      mark(x,y,k);
    }
  }
  for(let y=290;y<304;y++)for(let x=475;x<479;x++)mark(x,y,3);
  return pixels;
}
for(const side of ['R','L']){
  front.syntheticData=syntheticMask(side);
  const c=run("fmaExtractMaskContours(syntheticData,512,512,"+(side==='R'?'true':'false')+")");
  const stMed=side==='R'?c.stmR:c.stmL,stLat=side==='R'?c.stmL:c.stmR;
  const caMed=side==='R'?c.canR:c.canL,feMed=side==='R'?c.femR:c.femL;
  assert.ok(stMed[0].y>=75 && stMed[0].y<=100,'stem medial must begin after neck-cut turn: '+side);
  assert.ok(caMed[0].y>=75 && feMed[0].y>=75,'canal/femur medial must omit neck-cut: '+side);
  assert.equal(stMed.at(-1).y,250,'stem tip retained: '+side);
  assert.equal(stLat.at(-1).y,250,'lateral stem tip retained: '+side);
  assert.equal(c.qc.stemComponents,2,'distal disconnected noise must be separated: '+side);
}
front.syntheticData=syntheticMask('R',false);
const straight=run('fmaExtractMaskContours(syntheticData,512,512,true)');
assert.equal(straight.qc.stemTurnDetected,false,'must not invent a calcar turn on a straight stem');
assert.equal(straight.stmR[0].y,30,'straight-sided stem proximal contour must be preserved');
console.log('PASS: mask contour right/left proximal medial, continuous stem tip, disconnected distal noise, straight-sided fallback');


// Canal-lateral regression: detached class-2 islands vs isolated noise.
// R/L mirror; preserve tip and do not fabricate a contour across long gaps.
function canalFixture(side,mode){
 const W=512,H=512,a=new Uint8ClampedArray(W*H*4);
 const put=(x,y,v)=>{const xx=side==='R'?x:W-1-x,idx=(y*W+xx)*4;a[idx]=a[idx+1]=a[idx+2]=v;a[idx+3]=255};
 for(let y=30;y<=250;y++){
  const medial=y<=90?Math.round(230+(y-30)*1.1):Math.round(296-(y-90)*.12);
  const fR=y<=90?Math.round(260+(y-30)*.9):Math.round(314-(y-90)*.07);
  const cR=y<=90?Math.round(245+(y-30)):Math.round(305-(y-90)*.08);
  const sl=y>235?Math.round(185+(y-235)*1.1):185;
  const sr=y>235?Math.max(sl,Math.round(medial-(y-235)*2)):medial;
  for(let x=120;x<=fR;x++){
   let k=x>=155&&x<=cR?2:1;
   if(x>=sl&&x<=sr)k=3;
   if(y>=108&&y<=154){
    if(x>=154&&x<=182)k=1;
    if(x>=185&&x<=sr)k=3;
    if(mode==='islands'&&x>=154&&x<=162)k=2;
    if(mode==='short'&&(y<124||y>129)&&x>=154&&x<=162)k=2;
    if(mode==='long'&&(y<111||y>151)&&x>=154&&x<=162)k=2;
    if(mode==='speck'&&y===125&&x>=154&&x<=155)k=2;
   }
   put(x,y,k);
  }
 }
 for(let y=290;y<304;y++)for(let x=475;x<479;x++)put(x,y,3);
 return a;
}
for(const side of ['R','L'])for(const mode of ['islands','short','long','speck']){
 front.maskFixture=canalFixture(side,mode);
 const c=run('fmaExtractMaskContours(maskFixture,512,512,'+(side==='R'?'true':'false')+')');
 const canLat=side==='R'?c.canL:c.canR;
 const stmLat=side==='R'?c.stmL:c.stmR;
 assert.equal(stmLat.at(-1).y,250,'stem tip retention '+side);
 assert.equal(c.qc.stemComponents,2,'disconnected distal stem noise '+side);
 if(mode==='islands')assert.ok(c.qc.recoveredCanalLateralRows>=40,'disconnected canal island '+side);
 if(mode==='short')assert.ok(c.qc.interpolatedCanalLateralRows>=5,'short hole interpolation '+side);
 if(mode==='long'){
  assert.ok(c.qc.unresolvedCanalLateralRows>=30,'long gap must be flagged '+side);
  assert.equal(c.qc.interpolatedCanalLateralRows,0,'no long-range cortex extrapolation '+side);
 }
 if(mode==='speck')assert.equal(c.qc.recoveredCanalLateralRows,0,'reject isolated class-2 speck '+side);
 if(mode==='islands'||mode==='short'){
   const edge=canLat.find(p=>p.y===125)?.x;
   assert.ok(side==='R'?edge<170:edge>341,'outer canal must be recovered '+side+': '+edge);
 }
}
console.log('PASS: R/L canal island recovery, short gap interpolation, long-gap abstention, isolated-noise rejection and stem-tip protection');


// Proximal lateral canal teacher rule: pure class 2 can start below the stem shoulder.
// The class>=2 union MUST NOT extend canal_lateral into stem-only proximal rows.
function proximalCanalFixture(side,mode){
 const W=256,H=256,px=new Uint8ClampedArray(W*H*4);
 const mark=(x,y,k)=>{const xx=side==='R'?x:W-1-x,i=(y*W+xx)*4;px[i]=px[i+1]=px[i+2]=k;px[i+3]=255};
 for(let y=20;y<=205;y++){
  const cutoff=mode==='pure-throughout'?20:mode==='no-lateral-pure'?999:mode==='single-noise'?110:115;
  for(let x=60;x<=205;x++){
   let k=1;if(x>=85&&x<=180)k=2;if(x>=95&&x<=165)k=3;
   if(y<cutoff&&x<95)k=1;
   if(mode==='single-noise'&&y===25&&x>=83&&x<=87)k=2;
   mark(x,y,k);
  }
 }
 return px;
}
for(const side of ['R','L'])for(const mode of ['base-cutoff','pure-throughout','no-lateral-pure','single-noise']){
 front.proximalCanalFixture=proximalCanalFixture(side,mode);
 const contours=run('fmaExtractMaskContours(proximalCanalFixture,256,256,'+(side==='R'?'true':'false')+')');
 const lat=side==='R'?contours.canL:contours.canR;
 const med=side==='R'?contours.canR:contours.canL;
 const start=mode==='base-cutoff'?115:mode==='pure-throughout'?20:mode==='single-noise'?110:null;
 assert.equal(contours.qc.canalLatStartY,start,'pure-class2 start '+side+' '+mode);
 assert.equal(lat.length>0?lat[0].y:null,start,'lateral contour must not extend proximally '+side+' '+mode);
 assert.ok(med.length>0&&med[0].y===20,'medial canal must preserve independent proximal limit '+side+' '+mode);
}
assert.ok(html.includes("fillBetweenRendered('canal_medial','canal_lateral','rgb(2,2,2)',true)"),'teacher class-2 raster must be clipped to shared proximal extent');
console.log('PASS: R/L pure-class2 proximal canal cutoff, noise rejection, and masked extent clipping');


// Distal image-crop regression: preserve natural shaft contours and stem tips.
// Correct only abrupt inward hooks of outer femur and canal near the frame edge.
function distalCropFixture(side,mode){
 const W=256,H=256,px=new Uint8ClampedArray(W*H*4);
 const put=(x,y,c)=>{const xx=side==='R'?x:W-1-x,i=(y*W+xx)*4;px[i]=px[i+1]=px[i+2]=c;px[i+3]=255;};
 const bottom=mode==='early-stop'?215:255;
 for(let y=16;y<=bottom;y++){
  const hook=mode==='hooked'&&y>241?Math.round((y-241)*1.5):mode==='smooth'&&y>170?Math.round((y-170)/50):0;
  for(let x=36+hook;x<=220-hook;x++){
   let c=1;if(x>=56+hook&&x<=200-hook)c=2;
   if(y<212&&x>=108&&x<=148)c=3;
   put(x,y,c);
  }
 }
 return px;
}
for(const side of ['R','L'])for(const mode of ['hooked','smooth','early-stop']){
 front.distalFixture=distalCropFixture(side,mode);
 const c=run('fmaExtractMaskContours(distalFixture,256,256,'+(side==='R'?'true':'false')+')');
 assert.equal(c.stmL.at(-1).y,211,'preserve lateral stem tip '+side+' '+mode);
 assert.equal(c.stmR.at(-1).y,211,'preserve medial stem tip '+side+' '+mode);
 if(mode==='hooked'){
  assert.ok(c.qc.distalOuterEdits>=10&&c.qc.distalCanalEdits>=10,'clip-induced hooks must be corrected '+side);
  assert.ok(c.femL.at(-1).x<48&&c.femR.at(-1).x>208,'femur contour remains open '+side);
  assert.ok(c.canL.at(-1).x<68&&c.canR.at(-1).x>188,'canal contour remains open '+side);
 }else{
  assert.equal(c.qc.distalOuterEdits,0,'no modification of genuine/non-border femur '+side+' '+mode);
  assert.equal(c.qc.distalCanalEdits,0,'no modification of genuine/non-border canal '+side+' '+mode);
 }
}
console.log('PASS: R/L distal inward-hook correction, natural taper preservation, no early-stop extrapolation, stem tip protection');


// Default calibration dimensions follow FMA Protocol: postoperative head 32 mm;
// preoperative iron-ball marker 25 mm. Defaults remain user-editable per case.
assert.match(html,/<input id="headSize"[^>]*value="32"/,'postoperative calibration default visible in UI');
assert.equal(run("defaultCalibrationDiameter('postop_THA')"),'32','default postoperative head diameter');
assert.equal(run("defaultCalibrationDiameter('native')"),'25','default preoperative marker diameter');
assert.equal(run("defaultCalibrationDiameter('other')"),'','unknown image types must not silently calibrate');
assert.match(html,/\$\('headSize'\)\.value=defaultCalibrationDiameter\(\$\('imageType'\)\.value\)/,'image load / mode changes must update default');
console.log('PASS: postoperative 32mm initial value, preop 25mm marker, dynamic per-image defaults');
