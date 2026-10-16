'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

// Executes the shipped inline application, with a deterministic canvas command
// recorder. Mask assertions compare drawing-command bytes, not browser PNG pixels.
function harness(end=120){
  const elements=new Map(),storage=new Map();
  function element(){
    const commands=[];
    const context=new Proxy({}, {get:(o,k)=>k in o?o[k]:(...args)=>{commands.push([k,...args]);},set:(o,k,v)=>{o[k]=v;commands.push(['set',k,v]);return true;}});
    return {value:'',textContent:'',innerHTML:'',style:{},width:256,height:256,checked:false,hidden:false,
      addEventListener(){},focus(){},click(){},remove(){},getContext:()=>context,
      toBlob:cb=>cb(Buffer.from(JSON.stringify(commands))),getBoundingClientRect:()=>({left:0,top:0,width:256,height:256})};
  }
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  Object.entries({scale:'1',calMode:'manual',headSize:'32',ltVisibility:'visible',side:'R',imageType:'postop_THA',studyId:'SYNTHETIC',workMode:'annotation',annotationTarget:'head'}).forEach(([k,v])=>get(k).value=v);
  const context=vm.createContext({document:{getElementById:get,createElement:element,body:{appendChild(){}}},window:{addEventListener(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},console,Blob,Buffer,setTimeout(){},alert(){},confirm:()=>true,URL:{createObjectURL:()=>'',revokeObjectURL(){}},Image:function(){}});
  const run=src=>vm.runInContext(src,context);
  run(fs.readFileSync(path.join(__dirname,'../dev/femoral-axis.js'),'utf8'));
  const html=fs.readFileSync(path.join(__dirname,'../dev/index.html'),'utf8');
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
    const page=await browser.newPage();await page.goto('file://'+path.join(__dirname,'../dev/index.html'));
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

test('every common save guard protects the legacy source Research ID',async()=>{
  const h=harness();h.run("legacySourceId='SYNTHETIC'");
  assert.equal(h.run("confirmMissingBeforeSave('test')"),false);
  const result=await h.run("saveCaseFilesToFolder('SYNTHETIC')");assert.equal(result.ok,false);assert.equal(result.reason,'legacy_source_protected');
  await h.get('saveCloud').onclick(); // Must return before any network or download tools.
});

test('invalid geometry exports null LDR values and degenerate STEM metadata is unavailable',()=>{
  const h=harness();const record=h.json('buildDataDictionaryV11Record()');
  assert.equal(record.discrete_parameters.ldr_alpha,null);assert.equal(record.discrete_parameters.ldr_beta,null);
  h.run('pts.stem_dist={...pts.stem_prox}');assert.equal(h.json('axisMetadata()').stem.status,'unavailable');
});
