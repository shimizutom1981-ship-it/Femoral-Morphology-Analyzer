// App-side Gruen zone glue: runs the embedded library and glue blocks from dev/index.html against mocked app state.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../dev/index.html'),'utf8');
const lib=fs.readFileSync(path.join(__dirname,'../lib/gruen-zones.js'),'utf8');
const between=(a,b)=>{assert.equal(html.split(a).length,2,a);assert.equal(html.split(b).length,2,b);return html.split(a)[1].split(b)[0];};
const embedded=between('// BEGIN GENERATED GRUEN ZONES (lib/gruen-zones.js)','// END GENERATED GRUEN ZONES');
assert.equal(embedded.trim(),lib.trim(),'embedded library must match lib/gruen-zones.js exactly');
const glue=between('// BEGIN GRUEN ZONES APP','// END GRUEN ZONES APP');
assert.equal([...html.matchAll(/<script(?:\s[^>]*)?>/g)].length,1,'page must stay single-script');
for(const id of ['gzPanel','gzZone4','gzCompute','gzOverlay','gzSave','gzStatus','gzTable'])assert(html.includes('id="'+id+'"'),id);

function app(mirror){
  const X=x=>mirror*x+500; // mirror=-1 puts lateral on image-left
  const line=(x,y0,y1)=>[{x:X(x),y:y0},{x:X(x),y:(y0+y1)/2},{x:X(x),y:y1}];
  const els={},noop=()=>{};let draws=0,saved=null;
  const context={console,JSON,Math,Number,Object,Array,String,img:true,zoom:1,panX:0,panY:0,
    ctx:new Proxy({},{get:()=>noop,set:()=>true}),
    $:id=>els[id]||(els[id]={value:'',checked:false,textContent:'',innerHTML:'',disabled:false}),
    pts:{stem_prox:{x:X(0),y:-30},stem_dist:{x:X(0),y:200}},
    annotation:{longitudinal_landmarks:{schema:'fma_longitudinal_landmarks_v1',points:{gt_apex:{x:X(30),y:-20},stem_shoulder:{x:X(5),y:0},stem_tip:{x:X(0),y:120}}},
      osteotomy_line:[{x:X(-9),y:10},{x:X(2),y:4},{x:X(12),y:-6}],
      stem_medial:line(-6,0,120),stem_lateral:line(6,0,120),canal_medial:line(-8,-10,160),canal_lateral:line(8,-10,160),femur_medial:line(-12,-10,160),femur_lateral:line(13,-10,160)},
    calibrationScale:()=>1,downloadBlob:(text,type,name)=>{saved={text,name};},draw:()=>{draws++;}};
  context.getRenderedContour=n=>context.annotation[n]||[];
  vm.createContext(context);
  context.$('gzZone4').value='20';context.$('gzOverlay').checked=true;context.$('implantCollar').value='yes';
  vm.runInContext(embedded,context);vm.runInContext(glue,context);
  return {context,els,run:s=>vm.runInContext(s,context),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',context)),saved:()=>saved,draws:()=>draws};
}
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,a+' != '+b);
for(const mirror of [1,-1]){
  const a=app(mirror),r=a.json('computeGruenZones()');
  assert.equal(r.status,'ok',JSON.stringify(r).slice(0,300));assert.equal(r.accuracy_validated,false);
  near(r.partition.stemLengthMm,120);near(r.partition.medialTopMm,10);assert.equal(r.partition.source.zone7Top,'collar_underside');
  for(const z of [1,2,3]){near(r.measure.zones[z].gap.meanMm,2);near(r.measure.zones[z].cortex.meanMm,5);}
  for(const z of [5,6,7]){near(r.measure.zones[z].gap.meanMm,2);near(r.measure.zones[z].cortex.meanMm,4);}
  near(r.measure.zones[4].lateral.cortex.meanMm,5);near(r.measure.zones[4].medial.cortex.meanMm,4);
  // osteotomy line drawn in the opposite order gives the same zone 7 top
  a.run('annotation.osteotomy_line.reverse()');near(a.json('computeGruenZones()').partition.medialTopMm,10);
}
{ // button: table, save, overlay redraw
  const a=app(1);a.els.gzCompute.onclick();
  assert.equal(a.els.gzSave.disabled,false);assert.equal((a.els.gzTable.innerHTML.match(/<tr>/g)||[]).length,8);
  assert(a.els.gzTable.innerHTML.includes('<td>2.00</td><td>5.00</td><td>40 / 40</td>'));
  a.els.gzSave.onclick();assert.equal(a.saved().name,'FMA_gruen_zones.json');assert.equal(JSON.parse(a.saved().text).schema,'fma_gruen_zones_v1');
  // changing any input invalidates the shown result instead of leaving a stale overlay
  a.run('annotation.longitudinal_landmarks.points.stem_tip.y=110;draw()');
  assert.equal(a.json('gruenResult'),null);assert.equal(a.els.gzSave.disabled,true);assert.equal(a.els.gzTable.innerHTML,'');assert(a.els.gzStatus.textContent.includes('もう一度'));
  // zone 4 length is taken from the input box
  a.els.gzZone4.value='30';a.els.gzCompute.onclick();near(a.json('gruenResult').partition.levelsMm.zone4End,140);
}
{ // missing inputs are reported, never guessed
  const cases=[['annotation.longitudinal_landmarks=null','landmark_missing_gt_apex'],['delete annotation.longitudinal_landmarks.points.stem_tip','landmark_missing_stem_tip'],
    ['annotation.osteotomy_line=[]','osteotomy_line_missing'],['delete pts.stem_dist','stem_axis_missing'],['calibrationScale=()=>null','calibration_missing'],
    ['annotation.osteotomy_line=[{x:505,y:10},{x:512,y:-6}]','medial_top_on_lateral_side']];
  for(const [mutation,reason] of cases){const a=app(1);a.run(mutation);const r=a.json('computeGruenZones()');assert.equal(r.status,'error');assert.equal(r.reason,reason,mutation);
    a.els.gzCompute.onclick();assert.equal(a.els.gzSave.disabled,true);assert(a.els.gzStatus.textContent.startsWith('計算できません'));}
  const a=app(1);a.els.implantCollar.value='no';assert.equal(a.json('computeGruenZones()').partition.source.zone7Top,'medial_resection_end');
  a.run('annotation.femur_lateral=[]');const r=a.json('computeGruenZones()');assert.equal(r.status,'ok');assert.equal(r.measure.zones[1].cortex.n,0);assert.equal(r.measure.zones[1].skipped.missing,40);
}
console.log('PASS: embedded library matches, R/L mirrored zones and values, osteotomy order, table/save, stale-result invalidation, zone 4 input, missing inputs reported, collarless, missing contour counted.');
