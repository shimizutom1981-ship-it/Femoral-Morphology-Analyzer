'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto');

// Executes the shipped inline application, with a deterministic canvas command
// recorder. Mask assertions compare drawing-command bytes, not browser PNG pixels.
function harness(end=120){
  const elements=new Map(),storage=new Map();
  function element(){
    const commands=[],listeners={};
    const context=new Proxy({}, {get:(o,k)=>k in o?o[k]:(...args)=>{commands.push([k,...args]);},set:(o,k,v)=>{o[k]=v;commands.push(['set',k,v]);return true;}});
    return {value:'',textContent:'',innerHTML:'',style:{},width:256,height:256,checked:false,hidden:false,
      addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatch(type,e={}){for(const fn of listeners[type]||[])fn(e);},setPointerCapture(){},focus(){},click(){},remove(){},getContext:()=>context,
      toBlob:cb=>cb(Buffer.from(JSON.stringify(commands))),getBoundingClientRect:()=>({left:0,top:0,width:256,height:256})};
  }
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  Object.entries({scale:'1',calMode:'manual',headSize:'32',ltVisibility:'visible',side:'R',imageType:'postop_THA',studyId:'SYNTHETIC',workMode:'annotation',annotationTarget:'head'}).forEach(([k,v])=>get(k).value=v);
  const context=vm.createContext({document:{getElementById:get,createElement:element,body:{appendChild(){}}},window:{addEventListener(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},console,crypto,Blob,Buffer,setTimeout(){},alert(){},confirm:()=>true,URL:{createObjectURL:()=>'',revokeObjectURL(){}},Image:function(){}});
  const run=src=>vm.runInContext(src,context);
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())run(match[1]);
  run(`pts={ltm:{x:95,y:30},stem_prox:{x:100,y:40},stem_dist:{x:100,y:120}};
    annotation.lt_midpoint={...pts.ltm};
    for(const [name,x] of [['canal_medial',95],['canal_lateral',105],['femur_medial',90],['femur_lateral',110],['stem_medial',97],['stem_lateral',103]]) annotation[name]=[{x,y:0},{x,y:70},{x,y:${30+end}}];calc();`);
  const json=src=>JSON.parse(run(`JSON.stringify(${src})`));
  return {run,json,get,storage,confirm:()=>get('confirmLT').onclick()};
}

test('LT confirmation gates measurements and exports',()=>{
  const h=harness();assert.equal(h.json('refreshFemoralAxis()').status,'ok');
  assert.equal(h.run('measurementGeometry()'),null);assert.equal(h.json('profileRows').length,0);
  assert.equal(h.json('axisMetadata()').femoral.reason,'lt_confirmation_required');
  h.confirm();assert.ok(h.run('measurementGeometry()'));assert.equal(h.json('profileRows').length,141);
  assert.equal(h.get('cti').textContent,'0.500');
});

test('manual STEM point edits change alignment only; geometry, profiles and mask command bytes are invariant',async()=>{
  const h=harness();h.confirm();
  const geometry=h.json('measurementGeometry()'),profiles=h.json('profileRows'),summary=h.json('continuousSummary'),contours=h.json("getRenderedContour('canal_medial')");
  const before=await h.run('trainingMaskPngBlob()');const angle=h.get('alignVal').textContent;
  h.run('pts.stem_dist={x:120,y:120};draw()');
  assert.notEqual(h.get('alignVal').textContent,angle);
  assert.deepEqual(h.json('measurementGeometry()'),geometry);assert.deepEqual(h.json('profileRows'),profiles);
  assert.deepEqual(h.json('continuousSummary'),summary);assert.deepEqual(h.json("getRenderedContour('canal_medial')"),contours);
  assert.deepEqual(await h.run('trainingMaskPngBlob()'),before);assert.equal(h.json('axisMetadata()').femoral.lt_confirmed,true);
});

for(const [label,edit] of [
  ['canal','annotation.canal_medial[1].x-=1'],['outer cortex','annotation.femur_medial[1].x-=1'],
  ['LT','pts.ltm.y+=1'],['calibration',"$('scale').value='1.01'"],
  ['visibility',"$('ltVisibility').value='occluded_unidentifiable'"],['head size',"$('headSize').value='36'"]]){
  test(`${label} edit invalidates confirmation and clears every stale derived result`,()=>{
    const h=harness();h.confirm();assert.ok(h.json('profileRows').length);h.run(`${edit};refreshFemoralAxis()`);
    assert.equal(h.run('confirmedLTKey'),null);assert.deepEqual(h.json('profileRows'),[]);assert.deepEqual(h.json('continuousSlices'),[]);assert.deepEqual(h.json('continuousSummary'),{});
    h.run('calc()');assert.equal(h.get('cti').textContent,'--');assert.equal(h.get('alignVal').textContent,'--');
    const record=h.json('buildDataDictionaryV11Record()');assert.equal(record.discrete_parameters.cti_minus100,null);assert.equal(record.axes.femoral.lt_confirmed,false);
  });
}

for(const [end,distal] of [[95,90],[85,80]])test(`fallback ${distal} retains fixed-100 missing in screen, JSON and CSV`,()=>{
  const h=harness(end);h.confirm();assert.equal(h.json('axisMetadata()').femoral.levels.distalMm,distal);
  const record=h.json('buildDataDictionaryV11Record()');assert.equal(record.discrete_parameters.cti_minus100,null);assert.equal(record.discrete_parameters.ew_minus100_lt_mm,null);assert.ok(record.missing_reasons.fixed_100mm);
  assert.equal(h.get('cti').textContent,'--');assert.equal(h.get('cfiVal').textContent,'--');
  const rows=h.run('profileCsvText()').split('\n').map(x=>x.split(',')),at100=rows.find(r=>r[0]==='100');
  assert.equal(at100[5],'');assert.equal(at100[7],'');assert.ok(at100[9]);assert.equal(at100[11],String(distal));
  assert.match(h.run('measurementCsvText()'),new RegExp('"confirmed","'+distal+'"'));
});

test('confirmed full-coverage display, JSON, profile CSV and measurement CSV agree',()=>{
  const h=harness();h.confirm();const record=h.json('buildDataDictionaryV11Record()');
  const row=h.run('profileCsvText()').split('\n').find(r=>r.startsWith('100,')).split(',');
  assert.equal(Number(row[7]),record.discrete_parameters.cti_minus100);assert.equal(Number(h.get('cti').textContent),record.discrete_parameters.cti_minus100);
  assert.equal(record.discrete_parameters.ew_minus100_lt_mm,10);assert.equal(record.discrete_parameters.cw_minus100_lt_mm,20);
  assert.equal(record.missing_reasons.fixed_100mm,null);assert.match(h.run('measurementCsvText()'),/"0.500"/);
});

test('save/reload recomputes metrics and preserves only exact modern confirmation',()=>{
  const h=harness();h.confirm();h.run("window._fmaFile={name:'synthetic.png',size:123};saveWork()");
  const key=h.run('imageWorkKey(window._fmaFile)'),saved=JSON.parse(h.storage.get(key));
  assert.equal(saved.axes.schema,'fma_axes_v1');assert.equal(saved.appVersion,'v2.2-axis-split');assert.equal(saved.profileRows,undefined);
  saved.profileRows=[{CTI:999}];saved.continuousSummary={bogus:true};h.run(`restoreWorkData(${JSON.stringify(saved)})`);
  assert.deepEqual(h.json('profileRows'),[]);assert.deepEqual(h.json('continuousSummary'),{});assert.ok(h.run('measurementGeometry()'));
  h.run('calc()');assert.equal(h.get('cti').textContent,'0.500');
  saved.fields.scale='1.01';h.run(`restoreWorkData(${JSON.stringify(saved)})`);assert.equal(h.run('confirmedLTKey'),null);
});

test('legacy resume preserves source bytes, freezes ordering once and requires explicit manual STEM adoption',()=>{
  const h=harness();h.confirm();
  const legacy={pts:h.json('pts'),annotation:h.json('annotation'),fields:{studyId:'LEGACY',scale:'1',calMode:'manual'},appVersion:'v2.1.2-cloud',profileRows:[{CTI:99}]};
  legacy.pts.sap=legacy.pts.stem_prox;legacy.pts.sad=legacy.pts.stem_dist;delete legacy.pts.stem_prox;delete legacy.pts.stem_dist;
  for(const key of ['canal_medial','canal_lateral'])legacy.annotation[key].reverse();
  const bytes=JSON.stringify(legacy);h.storage.set('FMA_work_v21_synthetic.png_123',bytes);
  h.run("window._fmaFile={name:'synthetic.png',size:123}");assert.equal(h.run('restoreSavedWork()'),true);
  assert.equal(h.run('confirmedLTKey'),null);assert.deepEqual(h.json('profileRows'),[]);assert.equal(h.run('pts.stem_prox'),undefined);
  assert.equal(h.json('axisMetadata()').legacy_source_version,'v2.1.2-cloud');assert.equal(h.get('confirmLegacyStem').hidden,false);
  const frozen=h.json("getRenderedContour('canal_medial')");h.get('confirmLegacyStem').onclick();
  assert.deepEqual(h.json('pts.stem_prox'),legacy.pts.sap);assert.equal(h.run('legacyStemCandidate'),null);
  assert.equal(h.storage.get('FMA_work_v21_synthetic.png_123'),bytes);
  h.run('pts.stem_dist={x:180,y:50};draw()');assert.deepEqual(h.json("getRenderedContour('canal_medial')"),frozen);
  assert.equal(h.storage.get('FMA_work_v21_synthetic.png_123'),bytes);
});

test('record import rejects missing image and malformed JSON without changing geometry',async()=>{
  const h=harness(),original=h.json('annotation');
  await h.get('recordFile').onchange({target:{files:[]}});
  await h.get('recordFile').onchange({target:{files:[{text:async()=>'{'}]}});
  assert.deepEqual(h.json('annotation'),original);
  h.run('img={width:256,height:256}');await h.get('recordFile').onchange({target:{files:[{text:async()=>'{'}]}});
  assert.deepEqual(h.json('annotation'),original);
});

let chromium;try{chromium=require('playwright').chromium;}catch{}
test('real Chromium mask PNG pixels are invariant under manual STEM endpoint changes',{skip:process.env.FMA_BROWSER_TESTS!=='1'||!chromium||!fs.existsSync('/usr/bin/chromium')},async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage();await page.goto('file://'+path.join(__dirname,'../index.html'));
    const result=await page.evaluate(async()=>{
      $('calMode').value='manual';$('scale').value='1';pts={ltm:{x:95,y:30},stem_prox:{x:100,y:40},stem_dist:{x:100,y:120}};annotation.lt_midpoint={...pts.ltm};
      for(const[name,x]of [['canal_medial',95],['canal_lateral',105],['femur_medial',90],['femur_lateral',110],['stem_medial',97],['stem_lateral',103]])annotation[name]=[{x,y:0},{x,y:70},{x,y:150}];
      draw();$('confirmLT').click();
      const bytes=async()=>Array.from(new Uint8Array(await (await trainingMaskPngBlob()).arrayBuffer()));
      const before=await bytes(),angle=$('alignVal').textContent;pts.stem_dist={x:120,y:120};draw();
      return {before,after:await bytes(),angle,newAngle:$('alignVal').textContent,status:axisMetadata().femoral.quality_status};
    });
    assert.equal(result.status,'confirmed');assert.notEqual(result.angle,result.newAngle);assert.ok(result.before.length>100);assert.deepEqual(result.before,result.after);
  }finally{await browser.close();}
});

test('repeated partial record imports clear unrelated contours and require fresh LT review',async()=>{
  const h=harness();h.confirm();h.run('img={width:256,height:256}');
  const raw={annotation_version:'2.1-training',study_id:'SYNTHETIC_IMPORT',image_type:'postop_THA',measurement_points:{ltm:{x:95,y:30}},canal_medial:h.json('annotation.canal_medial'),canal_lateral:h.json('annotation.canal_lateral')};
  for(let i=0;i<2;i++){
    await h.get('recordFile').onchange({target:{files:[{text:async()=>JSON.stringify(raw)}]}});
    assert.equal(h.run('confirmedLTKey'),null);assert.deepEqual(h.json('annotation.femur_medial'),[]);assert.deepEqual(h.json('annotation.stem_medial'),[]);
    assert.deepEqual(h.json('profileRows'),[]);assert.equal(h.get('cti').textContent,'--');
  }
});

test('record calibration is exact, manual, and never inherited when absent',async()=>{
  const h=harness();h.run("img={width:256,height:256};$('calMode').value='head'");
  const raw={study_id:'SYNTHETIC',measurement_points:{ltm:{x:95,y:30}},canal_medial:h.json('annotation.canal_medial'),canal_lateral:h.json('annotation.canal_lateral')};
  let record={raw_annotations:raw,calibration_metrics:{calibrated_mm_per_px:1.23456789,calib_known_mm:32}};
  await h.get('recordFile').onchange({target:{files:[{text:async()=>JSON.stringify(record)}]}});
  assert.equal(h.get('calMode').value,'manual');assert.equal(Number(h.get('scale').value),1.23456789);
  await h.get('recordFile').onchange({target:{files:[{text:async()=>JSON.stringify(raw)}]}});
  assert.equal(h.get('scale').value,'');assert.equal(h.json('axisMetadata()').femoral.reason,'invalid_scale');
});

test('AI STEM points require explicit manual adoption and cannot overwrite manual endpoints',()=>{
  const h=harness();h.confirm();const before=h.json('[pts.stem_prox,pts.stem_dist]');
  h.run('applyFullPrediction({measurement_points:{stem_prox:{x:200,y:10},stem_dist:{x:200,y:100}}})');
  assert.deepEqual(h.json('[pts.stem_prox,pts.stem_dist]'),before);assert.deepEqual(h.json('legacyStemCandidate.proximal'),{x:200,y:10});
  h.get('confirmLegacyStem').onclick();assert.equal(h.run('pts.stem_prox.x'),200);
});

test('legacy source file keys are protected while same-Research-ID new snapshots remain allowed',async()=>{
  const h=harness();h.run("legacySourceId='SYNTHETIC';legacySourceRecordKey='OLD_SNAPSHOT';$('observerId').value='TEST';$('repeatIndex').value='1';$('imageId').value='IMG'");
  assert.equal(h.run("confirmMissingBeforeSave('test')"),true);
  assert.equal(h.run('isProtectedSourceKey(newSaveKey())'),false);
  for(const key of ['SYNTHETIC','OLD_SNAPSHOT']){
    assert.equal(h.run(`isProtectedSourceKey('${key}')`),true);
    const result=await h.run(`saveCaseFilesToFolder('${key}')`);assert.equal(result.ok,false);assert.equal(result.reason,'legacy_source_protected');
  }
});

test('invalid geometry exports null LDR values and degenerate STEM metadata is unavailable',()=>{
  const h=harness();const record=h.json('buildDataDictionaryV11Record()');
  assert.equal(record.discrete_parameters.ldr_alpha,null);assert.equal(record.discrete_parameters.ldr_beta,null);
  h.run('pts.stem_dist={...pts.stem_prox}');assert.equal(h.json('axisMetadata()').stem.status,'unavailable');
});

test('Apps Script single inline solver exactly matches the canonical library',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const lib=fs.readFileSync(path.join(__dirname,'../lib/femoral-axis.js'),'utf8');
  const begin='// BEGIN GENERATED FEMORAL AXIS SOLVER (lib/femoral-axis.js)';
  const end='// END GENERATED FEMORAL AXIS SOLVER';
  assert.equal(html.split(begin).length,2);assert.equal(html.split(end).length,2);
  assert.equal(html.split(begin)[1].split(end)[0].trim(),lib.trim());
  assert.equal([...html.matchAll(/<script(?:\s[^>]*)?>/g)].length,1,'GAS page must remain self-contained');
  assert.doesNotMatch(html,/<script[^>]*src=/);
});

test('AI work provenance survives save/resume and never leaks into manual or unknown legacy work',()=>{
  const h=harness();h.run("window._fmaFile={name:'ai-synthetic.png',size:456};aiLoaded=true;aiProvenanceKnown=true;aiInitial={synthetic:true};$('modelVersion').value='TEST_MODEL';saveWork()");
  const data=JSON.parse(h.storage.get(h.run('imageWorkKey(window._fmaFile)')));
  h.run(`restoreWorkData(${JSON.stringify(data)})`);
  assert.equal(h.run('aiLoaded'),true);assert.deepEqual(h.json('aiInitial'),{synthetic:true});
  assert.equal(h.json('buildDataDictionaryV11Record()').provenance_and_split.mask_source_type,'ai_raw');
  const manual={...data,aiLoaded:false,aiInitial:{shouldNotLeak:true}};h.run(`restoreWorkData(${JSON.stringify(manual)})`);
  assert.deepEqual(h.json('aiInitial'),{});assert.equal(h.json('buildDataDictionaryV11Record()').provenance_and_split.mask_source_type,'teacher_gt');
  delete data.aiLoaded;delete data.aiProvenanceKnown;delete data.axes;data.appVersion='v2.1.3-cloud';
  h.run(`restoreWorkData(${JSON.stringify(data)})`);
  assert.equal(h.run('aiLoaded'),false);assert.deepEqual(h.json('aiInitial'),{});assert.equal(h.run('aiProvenanceKnown'),false);
  const provenance=h.json('buildDataDictionaryV11Record()').provenance_and_split;assert.equal(provenance.mask_source_type,'unknown');assert.equal(provenance.model_version,null);
});

test('standalone annotation import roundtrips identity and AI provenance without prior-case leakage',async()=>{
  const h=harness();h.run("img={width:256,height:256};$('observerId').value='OBSERVER';$('repeatIndex').value='3';$('imageId').value='SYNTH_IMG';aiLoaded=true;aiProvenanceKnown=true;aiInitial={synthetic:true};$('modelVersion').value='TEST_MODEL'");
  const raw=h.json('annotationPayload()'),identity=h.json('measurementIdentity()');
  h.run("$('observerId').value='WRONG';$('repeatIndex').value='9';$('imageId').value='WRONG';aiInitial={leak:true}");
  await h.get('recordFile').onchange({target:{files:[{text:async()=>JSON.stringify(raw)}]}});
  assert.deepEqual(h.json('measurementIdentity()'),identity);assert.equal(h.run('aiLoaded'),true);assert.deepEqual(h.json('aiInitial'),{synthetic:true});
  delete raw.ai_loaded;delete raw.ai_initial_prediction;delete raw.ai_provenance_known;delete raw.model_version;
  await h.get('recordFile').onchange({target:{files:[{text:async()=>JSON.stringify(raw)}]}});
  assert.equal(h.run('aiProvenanceKnown'),false);assert.deepEqual(h.json('aiInitial'),{});assert.equal(h.get('modelVersion').value,'');
});

for(const [version,headSize,headPoints,expectAxis] of [
  ['v2.1.3-cloud','',false,false],['v2.1.3-cloud','32',false,true],
  ['v2.1.3-cloud','32',true,true],['v2.1.2-cloud','',false,true]
])test(`legacy connectivity matches ${version}, diameter '${headSize}', circle landmarks ${headPoints}`,()=>{
  const h=harness();const points=[{x:30,y:10},{x:10,y:30},{x:20,y:20}];
  const data={appVersion:version,pts:{sap:{x:0,y:0},sad:{x:100,y:0},ltm:{x:0,y:0}},annotation:{canal_medial:points,canal_lateral:points.map(p=>({x:p.x,y:p.y+5})),head:headPoints?null:{radius_px:16}},fields:{calMode:'head',headSize,scale:'1',ltVisibility:'clear'}};
  if(headPoints)Object.assign(data.pts,{head1:{x:0,y:16},head2:{x:16,y:0},head3:{x:0,y:-16}});
  h.run(`restoreWorkData(${JSON.stringify(data)})`);
  const expected=points.slice().sort((a,b)=>expectAxis?a.x-b.x:a.y-b.y);
  assert.deepEqual(h.json('annotation.canal_medial'),expected);assert.equal(h.run('confirmedLTKey'),null);
});


function pointer(h,type,x,y,shiftKey=false){
  h.get('cv').dispatch(type,{clientX:x,clientY:y,button:0,pointerId:1,shiftKey});
}

for(const target of ['head','stem_interface_anchors'])test('Measurement Shift miss is edit-only with target '+target,()=>{
  const h=harness();h.confirm();h.get('workMode').value='measurement';h.get('annotationTarget').value=target;
  h.run('step=0;accepted=true');
  const points=h.json('pts'),annotation=h.json('annotation'),geometry=h.json('measurementGeometry()'),profiles=h.json('profileRows');
  pointer(h,'pointerdown',240,240,true);pointer(h,'pointermove',245,245,true);pointer(h,'pointerup',245,245,true);
  assert.deepEqual(h.json('pts'),points);assert.deepEqual(h.json('annotation'),annotation);
  assert.equal(h.run('step'),0);assert.equal(h.run('drag'),null);assert.equal(h.run('accepted'),true);assert.equal(h.run('correctionCount'),0);
  assert.deepEqual(h.json('measurementGeometry()'),geometry);assert.deepEqual(h.json('profileRows'),profiles);
});

test('Measurement endpoint Shift drag changes only STEM alignment and ends on pointerup',()=>{
  const h=harness();h.confirm();h.get('workMode').value='measurement';
  const geometry=h.json('measurementGeometry()'),profiles=h.json('profileRows'),angle=h.get('alignVal').textContent;
  pointer(h,'pointerdown',100,120,true);pointer(h,'pointermove',120,120,true);pointer(h,'pointerup',120,120,true);
  assert.deepEqual(h.json('pts.stem_dist'),{x:120,y:120});assert.equal(h.run('drag'),null);assert.equal(h.run('step'),0);
  assert.notEqual(h.get('alignVal').textContent,angle);assert.deepEqual(h.json('measurementGeometry()'),geometry);assert.deepEqual(h.json('profileRows'),profiles);
  pointer(h,'pointermove',200,200);assert.deepEqual(h.json('pts.stem_dist'),{x:120,y:120});
});

test('Measurement LT Shift drag still invalidates confirmation and derived results',()=>{
  const h=harness();h.confirm();h.get('workMode').value='measurement';
  pointer(h,'pointerdown',95,30,true);pointer(h,'pointermove',95,32,true);pointer(h,'pointerup',95,32,true);
  assert.deepEqual(h.json('pts.ltm'),{x:95,y:32});assert.equal(h.run('confirmedLTKey'),null);assert.deepEqual(h.json('profileRows'),[]);
});

test('Measurement plain click still adds the current point',()=>{
  const h=harness();h.get('workMode').value='measurement';h.run('step=0');
  pointer(h,'pointerdown',230,230);pointer(h,'pointerup',230,230);
  assert.deepEqual(h.json('pts.head1'),{x:230,y:230});assert.equal(h.run('step'),1);
});

test('Annotation Step 8 Shift click retains existing LT placement behavior',()=>{
  const h=harness();h.get('annotationTarget').value='lt_midpoint';
  pointer(h,'pointerdown',110,35,true);pointer(h,'pointerup',110,35,true);
  assert.deepEqual(h.json('pts.ltm'),{x:110,y:35});assert.deepEqual(h.json('annotation.lt_midpoint'),{x:110,y:35});
});

test('Local rescue needs only Research ID; missing provenance stays null and cloud remains strict',()=>{
  const h=harness();assert.equal(h.run('validateLocalIdentity()'),true);assert.equal(h.run('validateIdentity()'),false);
  const r=h.json('buildDataDictionaryV11Record()');
  for(const k of ['patient_id','observer_id','repeat_index','image_id'])assert.equal(r.provenance_and_split[k],null,k);
  assert.equal(r.provenance_and_split.metadata_completeness,'incomplete');
  assert.equal(r.provenance_and_split.independent_repeat_status,'not_declared');
  assert.equal(r.raw_annotations.patient_id,null);
  h.get('studyId').value='';assert.equal(h.run('validateLocalIdentity()'),false);
  h.get('studyId').value='X';h.get('repeatIndex').value='1.5';assert.equal(h.run('validateLocalIdentity()'),false);
});

test('Local revisions increment by Research ID without changing declared repeat or image',()=>{
  const h=harness();h.get('repeatIndex').value='2';h.get('observerId').value='OBS';h.get('imageId').value='AP_A';
  const a=h.run('newLocalSaveKey()'),first=h.json('buildDataDictionaryV11Record()');
  const b=h.run('newLocalSaveKey()'),second=h.json('buildDataDictionaryV11Record()');
  assert.notEqual(a,b);assert.equal(first.provenance_and_split.save_revision,1);assert.equal(second.provenance_and_split.save_revision,2);
  assert.equal(second.provenance_and_split.repeat_index,2);assert.equal(h.get('repeatIndex').value,'2');
  h.get('imageId').value='AP_B';h.get('observerId').value='OTHER';h.run('newLocalSaveKey()');
  assert.equal(h.json('localSaveMetadata()').save_revision,3);assert.equal(h.json('measurementIdentity()').image_id,'AP_B');
  h.get('studyId').value='OTHER';h.run('newLocalSaveKey()');assert.equal(h.json('localSaveMetadata()').save_revision,1);
  assert.equal(first.provenance_and_split.save_revision,1,'prior payload immutable');
  const csv=h.run('measurementCsvText()');assert.match(csv,/Save_revision/);assert.match(csv,/Independent_repeat_status/);
});

test('Revision uses imported high-water and stored maximum; storage failure still gives unique UUID keys',()=>{
  const h=harness();h.storage.set('FMA_save_revision_v1_SYNTHETIC','12');h.run("importLocalRevision('SYNTHETIC',{save_revision:8});newLocalSaveKey()");
  assert.equal(h.json('localSaveMetadata()').save_revision,13);
  h.run("importLocalRevision('SYNTHETIC',{save_revision:20});newLocalSaveKey()");assert.equal(h.json('localSaveMetadata()').save_revision,21);
  h.run("localStorage.getItem=()=>{throw Error('blocked')};localStorage.setItem=()=>{throw Error('blocked')}");
  const a=h.run('newLocalSaveKey()'),b=h.run('newLocalSaveKey()');assert.notEqual(a,b);assert.equal(h.json('localSaveMetadata()').save_revision,23);
  const fresh=harness();fresh.run("localStorage.getItem=()=>{throw Error('blocked')};localStorage.setItem=()=>{throw Error('blocked')}");
  const c=fresh.run('newLocalSaveKey()');assert.notEqual(a,c);assert.equal(fresh.json('localSaveMetadata()').save_revision,1);
});

test('Annotation and full-record imports preserve declared IDs, original source and revision',async()=>{
  for(const full of [false,true]){
    const h=harness();h.run('img={};window._fmaFile={name:"renamed_source.jpg",size:50}');
    const ann=h.json('annotationPayload()');Object.assign(ann,{study_id:'CASE',patient_id:'PATIENT',source_image_filename:'original.jpg',save_revision:7,measurement_identity:{research_id:'CASE',observer_id:'OBS',repeat_index:4,image_id:'AP_01',side:'R',image_stage:'postop_THA'}});
    const record=full?{raw_annotations:ann,provenance_and_split:{research_id:'CASE',save_revision:7}}:ann;
    const original=JSON.stringify(record);
    await h.get('recordFile').onchange({target:{files:[{text:async()=>original}]}});
    assert.equal(h.get('studyId').value,'CASE');assert.equal(String(h.get('repeatIndex').value),'4');assert.equal(h.get('imageId').value,'AP_01');assert.equal(h.get('patientId').value,'PATIENT');
    const key=h.run('newLocalSaveKey()');assert.match(key,/CASE__save008__/);
    const out=h.json('annotationPayload()');assert.equal(out.measurement_identity.observer_id,'OBS');assert.equal(out.source_image_filename,'original.jpg');assert.equal(out.loaded_image_filename,'renamed_source.jpg');assert.equal(JSON.stringify(record),original);
  }
});

test('Legacy import lacking IDs can be locally exported without inventing metadata',async()=>{
  const h=harness();h.run('img={}');
  const ann=h.json('annotationPayload()');delete ann.measurement_identity;delete ann.save_revision;ann.study_id='LEGACY';ann.patient_id='KNOWN_PATIENT';ann.app_version='v2.1.2-cloud';
  const source=JSON.stringify(ann);
  await h.get('recordFile').onchange({target:{files:[{text:async()=>source}]}});
  assert.equal(h.run('validateLocalIdentity()'),true);assert.equal(h.run('validateIdentity()'),false);
  h.run('newLocalSaveKey()');const record=h.json('buildDataDictionaryV11Record()');
  assert.equal(record.provenance_and_split.save_revision,1);assert.equal(record.provenance_and_split.repeat_index,null);assert.equal(record.provenance_and_split.patient_id,'KNOWN_PATIENT');
  assert.equal(JSON.stringify(ann),source);
  const before=h.json('pts');await h.get('saveCase').onclick();assert.deepEqual(h.json('pts'),before);
});

test('Deferred PNG and concurrent edits cannot mutate snapshot JSON, CSV or source',async()=>{
  const h=harness();
  h.run(`window._fmaFile={name:'original.jpg',type:'image/jpeg'};
    globalThis.exports=[];globalThis.resolveMask=null;
    trainingMaskPngBlob=()=>new Promise(resolve=>{resolveMask=resolve});
    downloadBlob=(content,type,name)=>exports.push({content,type,name});
    globalThis.firstKey=newLocalSaveKey();globalThis.pendingSave=saveCaseFilesToFolder(firstKey);`);
  const original=h.json('pts');
  h.run(`pts.ltm.x=777;annotation.canal_medial[0].x=888;
    window._fmaFile={name:'other.jpg',type:'image/jpeg'};
    newLocalSaveKey();resolveMask(new Blob(['mask']));`);
  await h.run('pendingSave');
  const outputs=h.json('exports'),record=JSON.parse(outputs.find(x=>x.name.endsWith('_fma_record.json')).content);
  assert.deepEqual(record.raw_annotations.measurement_points,original);assert.equal(record.raw_annotations.canal_medial[0].x,95);
  assert.equal(record.provenance_and_split.save_revision,1);assert.equal(record.raw_annotations.save_revision,1);
  assert.equal(record.raw_annotations.record_key,h.run('firstKey'));
  assert.equal(outputs.find(x=>x.name.endsWith('_source.jpg')).content.name,'original.jpg');
  assert.match(outputs.find(x=>x.name.startsWith('FMA_')).content,/"95.000"/);
  assert.ok(outputs.every(x=>x.name.includes(h.run('firstKey'))));
});
