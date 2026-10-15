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
