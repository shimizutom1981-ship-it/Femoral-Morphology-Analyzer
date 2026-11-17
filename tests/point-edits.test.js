'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Core=require('../lib/point-edits.js');
const source={sha256:'a'.repeat(64),width:1154,height:868,canvas_width:1200,canvas_height:903};
test('native pixel mapping is reversible with independent X/Y scaling',()=>{
  const p={x:412,y:455},c=Core.canvas(p,source),back=Core.original(c,source);assert.ok(Math.abs(back.x-p.x)<1e-10);assert.ok(Math.abs(back.y-p.y)<1e-10);
  assert.throws(()=>Core.assertSame(source,{...source,sha256:'b'.repeat(64)}));assert.throws(()=>Core.assertSame(source,{...source,width:1153}));
});
test('point revisions and review scopes are separate from independent repeats',()=>{
  const s=Core.create(source,'id');Core.review(s,'contour:a',[1,2],'TS','2026-11-17');Core.review(s,'point:ltm',{x:4,y:5},'TS','2026-11-17');
  Core.append(s,{action:'move',timestamp:'2026-11-17',before_original:{x:4,y:5},after_original:{x:4,y:8}});
  assert.equal(s.revision,1);assert.equal(s.scientific_repeat_incremented,false);assert.equal(Core.reviewed(s,'contour:a',[1,2]),true);assert.equal(Core.reviewed(s,'point:ltm',{x:4,y:8}),false);assert.deepEqual(Core.validate(JSON.parse(JSON.stringify(s))),s);
});
const existing=fs.readFileSync(path.join(__dirname,'integration.test.js'),'utf8');
const host={require,module:{exports:{}},__dirname,Buffer,Blob};vm.runInNewContext(existing.slice(0,existing.indexOf("test('LT confirmation"))+'\nmodule.exports=harness;',host);const harness=host.module.exports;
function setup(){const h=harness(),json=h.json;h.json=src=>JSON.parse(JSON.stringify(json(src)));h.run(`img={width:256,height:256};window._fmaFile={name:'SYNTHETIC.png',size:123};peHash='${'a'.repeat(64)}';peState(true);`);h.get('imageId').value='SYN';h.get('observerId').value='TS';h.get('repeatIndex').value='2';h.confirm();h.run('peReviewContours();peConfirmPoints()');return h;}
test('point editor inline sources exactly match maintained files',()=>{const html=fs.readFileSync(path.join(__dirname,'../dev/index.html'),'utf8');for(const [file,start,end]of [['point-edits.js','// BEGIN POINT EDITS (lib/point-edits.js)\n','// END POINT EDITS'],['point-editor-ui.js','// BEGIN POINT EDITOR UI (lib/point-editor-ui.js)\n','// END POINT EDITOR UI']])assert.equal(html.split(start)[1].split(end)[0],fs.readFileSync(path.join(__dirname,'../lib',file),'utf8'));});
test('LT correction preserves six reviewed contours, invalidates axis and only edited point, and undo restores review',()=>{
  const h=setup(),before=h.json('pts.ltm'),reviews=h.json('peState().reviews'),axis=h.run('confirmedLTKey'),repeat=h.get('repeatIndex').value;
  h.run('peMove("ltm",{x:96,y:34})');assert.equal(h.run('confirmedLTKey'),null);assert.equal(h.run('measurementGeometry()'),null);
  assert.equal(h.run('FmaPointEdits.reviewed(peState(),"point:ltm",peGet("ltm"))'),false);
  for(const k of ['femur_medial','femur_lateral','canal_medial','canal_lateral','stem_medial','stem_lateral'])assert.equal(h.run(`FmaPointEdits.reviewed(peState(),'contour:${k}',peValues()['contour:${k}'])`),true);
  h.run('peUndo()');assert.deepEqual(h.json('pts.ltm'),before);assert.equal(h.run('confirmedLTKey'),axis);assert.deepEqual(h.json('peState().reviews'),reviews);assert.equal(h.get('repeatIndex').value,repeat);assert.equal(h.json('peState().events').at(-1).action,'undo');
});
test('unrelated edits block unsafe undo; mismatched images fail before any imported geometry changes',()=>{
  const h=setup();h.run('peMove("ltm",{x:96,y:34});annotation.canal_medial[1].x+=1');assert.throws(()=>h.run('peUndo()'),/別の入力/);
  const raw=h.json('annotationPayload()'),before=h.json('annotation');raw.point_edits.source.sha256='b'.repeat(64);assert.throws(()=>h.run('applyRecordImport('+JSON.stringify(raw)+',"mismatch.json")'),/元画像/);assert.deepEqual(h.json('annotation'),before);
});
test('zoomed canvas selection keeps native pixels and exports image/hash/history in one bundle',()=>{
  const h=setup();h.run("zoom=2;panX=31;panY=-8;cv.toDataURL=()=> 'data:image/png;base64,U1lOVEhFVElD'");
  const p=h.json('pos({clientX:231,clientY:92})');assert.deepEqual(p,{x:100,y:50});h.run('peMove("ltm",'+JSON.stringify(p)+');peConfirmPoints()');
  const b=h.json('peBundle()');assert.deepEqual(b.original_pixel_points.ltm,{x:100,y:50});assert.equal(b.source.sha256,'a'.repeat(64));assert.equal(b.raw_annotations.point_edits.events.at(-2).point_id,'ltm');assert.ok(b.preview.data_url);assert.equal(b.clinical_measurements_status,'not_adopted');assert.deepEqual(h.json('[zoom,panX,panY]'),[2,31,-8]);
});
test('correction bundle reimports points, head fit controls, revision and scope reviews',()=>{
  const h=setup();h.run('peMove("head1",{x:50,y:50});peMove("head2",{x:60,y:40});peMove("head3",{x:70,y:50});peMove("head4",{x:60,y:60});peMove("ltm",{x:96,y:34});peConfirmPoints();cv.toDataURL=()=>"data:image/png;base64,U1lO"');
  const b=h.json('peBundle()'),state=h.json('peState()'),hp=h.json('annotation._head_points');
  h.run('applyRecordImport('+JSON.stringify(b)+',"points.json")');assert.deepEqual(h.json('peState()'),state);assert.deepEqual(h.json('annotation._head_points'),hp);assert.deepEqual(h.json('pts.ltm'),{x:96,y:34});assert.equal(h.run('FmaPointEdits.reviewed(peState(),"point:ltm",peGet("ltm"))'),true);
});
test('Lauenstein is annotation-only and remains distinct after export/reload',()=>{
  const h=setup();h.get('peProjection').value='LAUENSTEIN';h.get('peProjection').onchange();h.run('peMove("ltm",{x:96,y:34});cv.toDataURL=()=>"data:image/png;base64,U1lO"');
  assert.equal(h.run('measurementGeometry()'),null);assert.equal(h.json('profileRows').length,0);assert.throws(()=>h.run('rpExportFiles()'));
  const b=h.json('peBundle()');assert.equal(b.projection,'LAUENSTEIN');assert.equal(b.raw_annotations.training_schema,'SIDE_landmarks_only_v1');h.run('applyRecordImport('+JSON.stringify(b)+',"side.json")');assert.equal(h.run('peState().projection'),'LAUENSTEIN');assert.equal(h.run('measurementGeometry()'),null);
});
test('out-of-bounds edits are atomic and storage failure is visible',()=>{
  const h=setup(),before=h.json('pts');assert.throws(()=>h.run('peMove("ltm",{x:999,y:20})'),/画像範囲/);assert.deepEqual(h.json('pts'),before);
  h.run('localStorage.setItem=()=>{throw Error("QUOTA")};peMove("ltm",{x:96,y:34})');assert.match(h.get('peStorage').textContent,/確認できません|できません/);
});
test('save cancellation and failed writes never show file-saved success',async()=>{
  const h=setup();h.run('cv.toDataURL=()=>"data:image/png;base64,U1lO";window.showSaveFilePicker=()=>Promise.reject(Object.assign(Error("cancel"),{name:"AbortError"}))');await h.get('peSave').onclick();assert.match(h.get('peStorage').textContent,/キャンセル/);
  h.run('window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async()=>{throw Error("disk full")},close:async()=>{}})})');await h.get('peSave').onclick();assert.match(h.get('peStorage').textContent,/失敗/);assert.equal(h.run('peBusy'),false);
});
