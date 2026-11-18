'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const src=fs.readFileSync(path.join(__dirname,'integration.test.js'),'utf8');
const host={require,module:{exports:{}},__dirname,Buffer,Blob};
vm.runInNewContext(src.slice(0,src.indexOf("test('LT confirmation"))+'\nmodule.exports=harness;',host);
function start(){
  const h=host.module.exports();
  const read=h.json;h.json=expression=>JSON.parse(JSON.stringify(read(expression)));
  h.run("img={width:256,height:256};peHash='a'.repeat(64);window._fmaFile={name:'synthetic.png',size:128};globalThis.atob=s=>Buffer.from(s,'base64').toString('binary');annotation.head={center:{x:100,y:55},radius_px:16};");
  h.get('rpDirection').value='AP';h.get('peProjection').value='AP';
  return h;
}
function file(data){return {target:{value:'',files:[{size:100,text:async()=>JSON.stringify(data)}]}};}
test('cup UI records calibrated fit, rejects stale calibration and preserves legacy input',async()=>{
  const h=start(),c=require('../lib/cup-cad');h.get('cupCadPanel').open=true;
  await h.get('cupModel').onchange(file({schema:'fma-cup-cad-rim-v1',model:'test',version:'1',source:'synthetic',status:'prototype',opening_diameter_mm:50,cad_sha256:'0'.repeat(64)}));
  const click=([x,y])=>h.get('cupCanvas').onclick({clientX:x,clientY:y});
  click([20,200]);click([200,200]);click([100,55]);
  for(const p of c.project([100,55,40,25],25).filter((p,i)=>i%9===0))click(p);
  h.get('cupFit').onclick();assert.equal(h.get('cupConfirm').disabled,false,h.get('cupHint').textContent);
  h.get('cupConfirm').onclick();const raw=h.json('annotationPayload()');
  assert.equal(raw.cup_cad.checked,true);assert.ok(Math.abs(raw.cup_cad.angles.ri_deg-40)<.2);assert.equal(raw.cup_cad.angles.ra_signed_deg,null);
  h.get('scale').value='2';h.run('draw()');assert.equal(h.get('cupSave').disabled,true);assert.equal(h.json('annotationPayload()').cup_cad.fit,null);
  h.get('side').value='L';h.run('draw()');assert.equal(h.json('annotationPayload()').cup_cad,null);
});
function syntheticModel(){
  const tris=[[[0,0,0],[12,0,-5],[5,0,-70]],[[0,0,0],[5,0,-70],[0,0,-68]]];
  const buf=Buffer.alloc(84+50*tris.length);buf.writeUInt32LE(tris.length,80);
  tris.forEach((t,i)=>t.flat().forEach((x,j)=>buf.writeFloatLE(x,96+i*50+j*4)));
  return {schema:'fma-stem-cad-v1',model:'synthetic',version:'1',frame:'LPS_mm',side:'R',status:'prototype',
    cad_sha256:crypto.createHash('sha256').update(buf).digest('hex'),stl_base64:buf.toString('base64'),head_center_mm:[0,0,0],
    landmarks_mm:{stem_prox:[4,0,-10],stem_dist:[5,0,-60],stem_shoulder:[12,0,-5],stem_tip:[5,0,-70]}};
}
test('stem CAD sends 4 landmarks through FMA, preserves bone points, rolls back, invalidates changed scale',async()=>{
  const h=start();h.get('stemCadPanel').open=true;
  h.run('lmData().points.gt_apex={x:115,y:51};');
  for(const id of ['stemCadAxial','stemCadFlex','stemCadCoronal'])h.get(id).value='0';
  const previous=h.json('pts.stem_prox');
  await h.get('stemCadFile').onchange(file(syntheticModel()));
  assert.equal(h.get('stemCadApply').disabled,false,h.get('stemCadStatus').textContent);
  h.get('stemCadApply').onclick();assert.equal(h.run("axisMetadata().stem.method"),'cad_projected_axis',h.get('stemCadStatus').textContent);
  assert.deepEqual(h.json('lmData().points.stem_tip'),{x:105,y:125});
  assert.deepEqual(h.json('lmData().points.gt_apex'),{x:115,y:51});
  assert.equal(h.json('peState().events').filter(e=>e.action==='cad_projection').length,4);
  h.get('stemCadUndo').onclick();assert.deepEqual(h.json('pts.stem_prox'),previous);
  h.get('stemCadApply').onclick();h.get('scale').value='2';h.run('draw()');
  assert.equal(h.run('annotation.stem_cad.invalidated'),true);
  assert.equal(h.run('!!lmData().points.stem_tip'),false);assert.equal(h.run('!!lmData().points.gt_apex'),true);
  h.get('side').value='L';await h.get('stemCadFile').onchange(file(syntheticModel()));assert.equal(h.get('stemCadApply').disabled,true);
});
