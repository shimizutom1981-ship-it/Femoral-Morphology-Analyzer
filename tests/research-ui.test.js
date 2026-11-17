'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../dev/index.html'),'utf8');
// Reuse only the existing deterministic DOM/canvas harness declaration, not its tests.
const existing=fs.readFileSync(path.join(__dirname,'integration.test.js'),'utf8');
const harnessSource=existing.slice(0,existing.indexOf("test('LT confirmation"))+'\nmodule.exports=harness;';
const host={require,module:{exports:{}},__dirname,Buffer,Blob};vm.runInNewContext(harnessSource,host);const harness=host.module.exports;
function setup(){
  const h=harness();h.run(`img={width:256,height:256};window._fmaFile={name:'SYNTHETIC.png',size:123};
    pts.ltm={x:105,y:30};annotation.lt_midpoint={...pts.ltm};
    for(const [name,x]of [['canal_medial',105],['canal_lateral',95],['femur_medial',110],['femur_lateral',90],['stem_medial',103],['stem_lateral',97]])annotation[name]=[{x,y:0},{x,y:70},{x,y:180}];
    annotation.longitudinal_landmarks={schema:'fma_longitudinal_landmarks_v1',points:{gt_apex:{x:110,y:10},stem_shoulder:{x:100,y:20},stem_tip:{x:100,y:140}},acquisition_date:'2026-10-07'};
    annotation.research_settings={schema:'fma_research_settings_v1',proximal:{x:100,y:20},exclusions:[],fields:{rpDirection:'AP',rpTimepoint:'EARLY',rpSurgery:'SYN_R_2026-10-01',rpRule:'TEST-RULE',rpSource:'test/source.png',rpStorage:'test/outputs'},confirmation:null};`);
  for(const [k,v]of [['studyId','0001'],['observerId','TEST'],['imageId','SYN-AP'],['repeatIndex','1']])h.get(k).value=v;
  h.confirm();h.get('rpConfirm').onclick();return h;
}
test('embedded core/UI exactly match their maintained sources',()=>{
  for(const [file,start,end]of [['research-profile.js','// BEGIN GENERATED RESEARCH PROFILE (lib/research-profile.js)\n','// END GENERATED RESEARCH PROFILE'],['research-ui.js','// BEGIN RESEARCH UI (lib/research-ui.js)\n','// END RESEARCH UI']])assert.equal(html.split(start)[1].split(end)[0],fs.readFileSync(path.join(__dirname,'../lib',file),'utf8'));
});
test('research save creates matching JSON, 101-point CSV and 19/23-column Registry tables',()=>{
  const h=setup();assert.equal(h.get('rpSave').disabled,false,h.get('rpStatus').textContent);
  const files=h.json('rpExportFiles()');assert.equal(files.length,4);
  const record=JSON.parse(files[0][1]),p=record.research_profile;
  assert.equal(p.samples.length,101);assert.equal(p.samples[50].cfr_pct,60);assert.equal(p.input.metadata.research_id,'0001');assert.equal(p.input.metadata.record_id,record.provenance_and_split.record_key);
  assert.ok(record.raw_annotations.research_settings);assert.equal(p.input.calibration.known_mm,32);
  assert.equal(record.registry_export.value_input_option,'RAW');assert.equal(record.registry_export.images[1][1],'0001');
  assert.equal(files[1][1].split('\r\n').length,102);assert.ok(files[2][1].includes(p.input.metadata.record_id));assert.ok(files[3][1].includes('cfr_dist_minus_prox'));
  const second=JSON.parse(h.json('rpExportFiles()')[0][1]);assert.notEqual(second.provenance_and_split.record_key,record.provenance_and_split.record_key);
});
test('research JSON reimport keeps endpoints/exclusions/metadata and reproduces values after LT review',async()=>{
  const h=setup();h.run("annotation.research_settings.exclusions=[{from:{x:100,y:40},to:{x:100,y:42},side:'MED',reason:'unreadable'}]");h.get('rpConfirm').onclick();
  const file=h.json('rpExportFiles()')[0],a=JSON.parse(file[1]);
  await h.get('recordFile').onchange({target:{value:'x',files:[{name:file[0],text:async()=>file[1]}]}});
  assert.equal(h.run('confirmedLTKey'),null);h.confirm();
  // Research review is bound to the exact inputs; it may be renewed explicitly after import.
  h.get('rpConfirm').onclick();const b=JSON.parse(h.json('rpExportFiles()')[0][1]);
  assert.deepEqual(b.research_profile.samples,a.research_profile.samples);
  assert.deepEqual(b.research_profile.summaries,a.research_profile.summaries);
  assert.deepEqual(b.raw_annotations.research_settings.proximal,a.raw_annotations.research_settings.proximal);
  assert.equal(b.research_profile.input.metadata.surgery_key,a.research_profile.input.metadata.surgery_key);
});
test('work cache preserves settings and numerical results; edits invalidate confirmation and stale export',()=>{
  const h=setup(),a=h.json('rpResult.samples');h.run('saveWork()');const saved=JSON.parse(h.storage.get(h.run('imageWorkKey(window._fmaFile)')));
  h.run('restoreWorkData('+JSON.stringify(saved)+');draw()');assert.deepEqual(h.json('rpResult.samples'),a);
  for(const edit of ['annotation.stem_medial[1].x+=.1','annotation.research_settings.proximal.y+=.1',"annotation.longitudinal_landmarks.acquisition_date='2026-10-08'"]){h.get('rpConfirm').onclick();h.run(edit+';draw()');assert.equal(h.get('rpSave').disabled,true);assert.throws(()=>h.run('rpExportFiles()'));}
});
test('research metadata is never guessed; AXIAL/preop/unknown key and malformed settings cannot export',async()=>{
  const h=setup();h.get('rpSurgery').value='';h.get('rpSurgery').onchange();h.get('rpConfirm').onclick();assert.equal(h.get('rpSave').disabled,true);assert.throws(()=>h.run('rpExportFiles()'));
  h.get('rpDirection').value='AXIAL';h.get('rpDirection').onchange();h.get('rpConfirm').onclick();assert.equal(h.get('rpSave').disabled,true);
  const raw=h.json('annotationPayload()');raw.research_settings.proximal={x:'bad',y:0};const before=h.json('annotation');
  await h.get('recordFile').onchange({target:{value:'',files:[{name:'bad.json',text:async()=>JSON.stringify(raw)}]}});assert.deepEqual(h.json('annotation'),before);
});
test('pair UI exports early/M12 bone-fixed deltas and resets stale pair after file changes',async()=>{
  const h=setup(),a=h.json('rpExportFiles()')[0];
  h.run("rpDate=()=> '2027-10-07';annotation.research_settings.fields.rpTimepoint='M12';annotation.longitudinal_landmarks.acquisition_date='2027-10-06';annotation.longitudinal_landmarks.points.stem_tip.y+=20;annotation.femur_medial.forEach(p=>p.x+=1)");h.get('imageId').value='SYN-AP12';h.confirm();h.get('rpConfirm').onclick();const b=h.json('rpExportFiles()')[0];
  for(const [n,f]of [[0,a],[1,b]])await h.get('rpPairFile'+n).onchange({target:{value:'',files:[{name:f[0],text:async()=>f[1]}]}});
  h.get('rpPairConfirm').checked=true;h.get('rpPairRelative').checked=true;h.get('rpPairCompute').onclick();assert.equal(h.get('rpPairSave').disabled,false,h.get('rpPairSummary').textContent);
  const result=h.json('rpPairResult');assert.ok(Math.abs(result.summaries[0].value-1)<1e-9);h.get('rpPairStorage').value='test/pairs';assert.equal(h.json('rpPairExportFiles()').length,3);
  await h.get('rpPairFile1').onchange({target:{value:'',files:[]}});assert.equal(h.get('rpPairSave').disabled,true);assert.equal(h.run('rpPairResult'),null);
});
test('research file retains non-rounded calibration through actual JSON import path',async()=>{
  const h=setup();h.get('scale').value='0.731234567891';h.run('calc()');h.confirm();h.get('rpConfirm').onclick();
  const f=h.json('rpExportFiles()')[0],a=JSON.parse(f[1]);assert.equal(a.calibration_metrics.calibrated_mm_per_px,.731234567891);
  await h.get('recordFile').onchange({target:{value:'',files:[{name:f[0],text:async()=>f[1]}]}});h.confirm();h.get('rpConfirm').onclick();
  const b=JSON.parse(h.json('rpExportFiles()')[0][1]);assert.deepEqual(b.research_profile.samples,a.research_profile.samples);
});
test('overlay export uses full-image view, includes stem contours and restores view even on PNG failure',()=>{
  const h=setup(),before=h.json('annotation');
  h.run("zoom=2;panX=31;panY=-8;$('annotationTarget').value='stem_interface_anchors';cv.toDataURL=()=>JSON.stringify([zoom,panX,panY,$('annotationTarget').value])");
  assert.deepEqual(JSON.parse(h.run('rpOverlayPng()')),[1,0,0,'head']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.json("[zoom,panX,panY,$('annotationTarget').value]"))),[2,31,-8,'stem_interface_anchors']);assert.deepEqual(h.json('annotation'),before);
  h.run("cv.toDataURL=()=>{throw Error('PNG_FAILED')}");assert.throws(()=>h.run('rpOverlayPng()'),/PNG_FAILED/);
  assert.deepEqual(JSON.parse(JSON.stringify(h.json("[zoom,panX,panY,$('annotationTarget').value]"))),[2,31,-8,'stem_interface_anchors']);
});
test('five individually saveable artifacts share one record ID; editing clears old download links',()=>{
  const h=setup();h.run("$('rpDownloads').links=[];$('rpDownloads').appendChild=a=>$('rpDownloads').links.push(a);cv.toDataURL=()=> 'data:image/png;base64,TEST'");
  h.get('rpSave').onclick();const links=h.json("$('rpDownloads').links.map(a=>({name:a.download,url:a.href}))");
  assert.equal(links.length,5);const prefix=links[0].name.replace('_research.json','');assert.ok(links.every(a=>a.name.startsWith(prefix)));
  assert.equal(links[4].url,'data:image/png;base64,TEST');assert.match(h.get('rpStatus').textContent,/保存先で5ファイル/);
  h.run('annotation.stem_medial[1].x+=.1;draw()');assert.equal(h.get('rpSave').disabled,true);assert.equal(h.get('rpDownloads').textContent,'');assert.equal(h.run('rpDownloadKey'),null);
});
