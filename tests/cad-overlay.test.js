const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path');
const CAD=require('../lib/cad-overlay.js');
const from=s=>new TextEncoder().encode(s).buffer;
const triangle='v 1 2 3\nv 2 2 3\nv 1 2 4\nf 1 2 3\n';
test('accepts external-local OBJ with negative indices, ignores material links',()=>{
  const model=CAD.parse('shape.OBJ',from('mtllib remote.mtl\n'+triangle.replace('f 1 2 3','f -3/-1 -2/-1 -1/-1')));
  assert.equal(model.triangles,1);
  assert.deepEqual([...model.xyz],[-.5,0,-.5,.5,0,-.5,-.5,0,.5]);
});
test('reads binary and ASCII STL including binary with solid header',()=>{
  const bytes=new ArrayBuffer(134),v=new DataView(bytes);
  new Uint8Array(bytes).set(new TextEncoder().encode('solid IsStillBinary'));
  v.setUint32(80,1,true);[1,2,3,2,2,3,1,2,4].forEach((x,i)=>v.setFloat32(96+i*4,x,true));
  const ascii=from('solid tri\nfacet normal 0 1 0\nouter loop\nvertex 1 2 3\nvertex 2 2 3\nvertex 1 2 4\nendloop\nendfacet\nendsolid tri');
  assert.deepEqual(CAD.parse('stl',ascii),CAD.parse('stl',bytes));
});
test('rejects missing triangles, unknown type, invalid coordinates and index',()=>{
  assert.throws(()=>CAD.parse('obj',from('v 1 2 3\nv 1 2 4\nf 1 2 3')),/範囲外/);
  assert.throws(()=>CAD.parse('obj',from(triangle.replace('1 2 3','NaN 2 3'))),/座標/);
  assert.throws(()=>CAD.parse('stl',from('non-mesh vertex 1 2 3')),/形式/);
  assert.throws(()=>CAD.parse('js',from(triangle)),/形式/);
  assert.throws(()=>CAD.parse('obj',from('v 1 2 3')),/三角形/);
});
test('front-facing neutral projection and three finite independent rotations',()=>{
  const d=CAD.defaultPose(),P=CAD.projection(d,640,480),x=P(.5,0,0),z=P(0,0,.5);
  assert.deepEqual(P(0,0,0),[320,240]);assert.deepEqual(P(0,.5,0),[320,240]);
  assert.ok(x[0]>320&&x[1]===240&&z[0]===320&&z[1]<240);
  for(const k of ['rx','ry','rz'])assert.notDeepEqual(CAD.projection({...d,[k]:63},640,480)(.11,.2,.323),P(.11,.2,.323));
  assert.deepEqual(CAD.projection({...d,dx:.1,dy:-.1},640,480)(0,0,0),[384,192]);
  assert.ok(CAD.projection({...d,scale:2},640,480)(.5,0,0)[0]>x[0]);
  assert.deepEqual(CAD.normalise({scale:10000,rx:-900,opacity:-1,dx:NaN,visible:false}),{rx:-180,ry:0,rz:0,dx:0,dy:0,scale:4,opacity:0,visible:false});
});
test('settings key is image, side, view, layer and mesh SHA scoped',()=>{
  const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),key=CAD.sourceKey(a,'R','AP');
  let keys=[CAD.storageKey(key,'bone',b), CAD.storageKey(key,'bone',c), CAD.storageKey(key,'stem',b),
    CAD.storageKey(CAD.sourceKey(a,'L','AP'),'bone',b),CAD.storageKey(CAD.sourceKey(c,'R','AP'),'bone',b)];
  assert.equal(new Set(keys).size,5);assert.ok(keys.every(Boolean));
  assert.equal(CAD.storageKey(key,'bone','bad'),null);assert.equal(CAD.sourceKey(a,'R','invalid'),null);
});
test('standalone dev HTML inlines exact CAD modules and excludes CAD from app exports',()=>{
  const inlined=fs.readFileSync(path.join(__dirname,'../dev/index.html'),'utf8');
  for(const [tag,filename] of [['CAD OVERLAY','cad-overlay.js'],['CAD OVERLAY UI','cad-overlay-ui.js']]){
    const start='// BEGIN '+tag+' (lib/'+filename+')\n',end='// END '+tag;
    const a=inlined.indexOf(start);assert.ok(a>=0);const b=inlined.indexOf(end,a+start.length);assert.ok(b>=0);
    const body=inlined.slice(a+start.length,b);assert.equal(body,fs.readFileSync(path.join(__dirname,'../lib',filename),'utf8'));
    assert.doesNotMatch(body,/\b(fetch\s*\(|XMLHttpRequest|annotationPayload|saveFmaRecordToCloud|saveWork\s*\()/);
  }
});

test('display lifecycle leaves the app records intact; same image+CAD can opt back into saved pose',async()=>{
  const vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'integration.test.js'),'utf8'),host={require,__dirname,module:{exports:{}},Buffer,Blob};
  vm.runInNewContext(source.slice(0,source.indexOf("test('LT confirmation"))+'\nmodule.exports=harness;',host);
  const h=host.module.exports(),get=h.get;
  const record=()=>h.json('(()=>{const {timestamp,...raw}=annotationPayload();return raw})()');
  const old=record();
  h.run("globalThis.requestAnimationFrame=fn=>fn();img={width:256,height:256};peHash='a'.repeat(64);");
  get('cadView').open=true;get('cadViewKind').value='bone';get('cadViewMaster').checked=true;
  get('peProjection').value='AP';get('rpDirection').value='AP';
  const file=()=>({target:{value:'',files:[{name:'synthetic.obj',size:70,arrayBuffer:async()=>{
    h.run("globalThis.TextDecoder=class {decode(buf){return Buffer.from(buf).toString('utf8');}};");
    return h.run("Uint8Array.from("+JSON.stringify([...new TextEncoder().encode(triangle)])+").buffer");
  }}]}});
  h.run('draw()');const clean=await h.run('trainingMaskPngBlob()');
  await get('cadViewFile').onchange(file());
  assert.match(get('cadViewStatus').textContent,/大腿骨を読み込み/);
  const beforeResize=await new Promise(r=>get('cadViewCanvas').toBlob(r));
  for(const [id,v] of Object.entries({cadViewRX:'16',cadViewRY:'26',cadViewRZ:'36',cadViewDX:'.18',cadViewDY:'.12',cadViewScale:'1.3',cadViewOpacity:'.6'})){
    get(id).value=v;get(id).oninput({target:get(id)});
  }
  assert.notDeepEqual(await new Promise(r=>get('cadViewCanvas').toBlob(r)),beforeResize);
  assert.equal(h.storage.size,0,'opt-in only');
  get('cadViewSave').onclick();
  const [key]=h.storage.keys();
  assert.match(key,/^FMA_cad_display_v1:a{64}:R:AP:bone:[a-f\d]{64}$/);
  assert.doesNotMatch(h.storage.get(key),/synthetic|\.obj|vertex/);
  get('cadViewReset').onclick();assert.equal(get('cadViewRX').value,'0');assert.equal(get('cadViewOpacity').value,'0.6');
  get('cadViewMaster').checked=false;get('cadViewMaster').onchange();
  assert.deepEqual(record(),old);
  assert.deepEqual(await h.run('trainingMaskPngBlob()'),clean);
  h.run("peHash='b'.repeat(64);draw();");assert.equal(get('cadViewReset').disabled,true);
  await get('cadViewFile').onchange(file());assert.equal(get('cadViewRX').value,'0');
  get('cadViewMaster').checked=true;get('cadViewMaster').onchange();
  h.run("peHash='a'.repeat(64);draw();");assert.equal(get('cadViewReset').disabled,true);
  await get('cadViewFile').onchange(file());assert.equal(get('cadViewRX').value,'16');assert.equal(get('cadViewDX').value,'0.18');
  get('cadViewForget').onclick();assert.equal(h.storage.has(key),false);
  get('cadViewKind').value='cup';get('cadViewKind').onchange();
  await get('cadViewFile').onchange(file());
  get('cadViewLock').onclick();
  assert.ok(get('cadViewScale').disabled);
  assert.match(get('cadViewCalibration').textContent,/px\/mm/);
  get('cadViewHead').onclick();assert.equal(get('cadViewKind').value,'head');
  assert.equal(get('cadViewScale').disabled,true);
  assert.equal(get('cadViewDX').disabled,false);
  get('cadViewKind').value='bone';get('cadViewKind').onchange();
  assert.equal(get('cadViewScale').disabled,true);
  assert.deepEqual(record(),old);
  let finish;const pending=file(), bytes=await pending.target.files[0].arrayBuffer();
  pending.target.files[0].arrayBuffer=()=>new Promise(r=>{finish=r});
  const task=get('cadViewFile').onchange(pending);h.run("peHash='c'.repeat(64);draw();");finish(bytes);await task;
  assert.equal(get('cadViewReset').disabled,true,'in-flight old file cannot bind to new image');
  get('peProjection').value='LAUENSTEIN';get('peProjection').dispatch('change');assert.equal(get('cadViewFile').disabled,true);
});

test('common cup calibration projects physical lengths without clamping long femora',()=>{
  const width=1200,height=900, sourceWidth=940, pxPerMm=2.5;
  for(const extent of [32,50,178.5,450]){
    const model=CAD.parse('mm.obj',from('v 0 0 0\nv '+extent+' 0 0\nv 0 0 1\nf 1 2 3'));
    assert.equal(model.extentMm,extent);
    const span=pxPerMm*width/sourceWidth*model.extentMm;
    const proj=CAD.projection(CAD.defaultPose(),width,height,span);
    const nativeWidth=(proj(.5,0,0)[0]-proj(-.5,0,0)[0])*sourceWidth/width;
    assert.ok(Math.abs(nativeWidth-extent*pxPerMm)<1e-9);
  }
});
