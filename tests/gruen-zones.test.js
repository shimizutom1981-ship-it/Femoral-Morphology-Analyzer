'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../lib/gruen-zones.js');
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
// Synthetic left-like stem: axis along +y, lateral = +x. Stem length 120 mm, half-width 6; canal half-width 8; outer 13 (lateral) / 12 (medial).
function base() {
  return {mmPerPx:1,stemAxis:{proximal:{x:0,y:-30},distal:{x:0,y:200}},shoulder:{x:5,y:0},tip:{x:0,y:120},
    lateralRef:{x:30,y:-20},medialTop:{x:-9,y:10},collarStatus:'collared'};
}
function contours() {
  const line=(x,y0,y1)=>[{x,y:y0},{x,y:(y0+y1)/2},{x,y:y1}];
  return {stem:[[{x:6,y:0},{x:6,y:120},{x:-6,y:120},{x:-6,y:0}]],endosteal:[line(8,-10,160),line(-8,-10,160)],outer:[line(13,-10,160),line(-12,-10,160)]};
}
function tf(angle,mirror,scale,tx,ty) {return q=>({x:scale*(mirror*q.x*Math.cos(angle)-q.y*Math.sin(angle))+tx,y:scale*(mirror*q.x*Math.sin(angle)+q.y*Math.cos(angle))+ty});}
function transformInput(i,f,scale) {return {mmPerPx:i.mmPerPx/scale,stemAxis:{proximal:f(i.stemAxis.proximal),distal:f(i.stemAxis.distal)},shoulder:f(i.shoulder),tip:f(i.tip),lateralRef:f(i.lateralRef),medialTop:f(i.medialTop),collarStatus:i.collarStatus};}
const POINTS=[[10,20,1],[10,60,2],[10,100,3],[10,130,4],[-10,130,4],[0,135,4],[-10,100,5],[-10,60,6],[-10,20,7],[-10,5,null],[10,-5,null],[10,141,null],[0,60,null]];

test('levels, thirds and default zone 4 length',()=>{
  const p=G.partition(base());assert.equal(p.status,'ok');
  near(p.stemLengthMm,120);near(p.levelsMm.third1,40);near(p.levelsMm.third2,80);near(p.levelsMm.zone4End,140);
  near(p.medialTopMm,10);assert.equal(p.params.zone4LengthMm,20);assert.equal(p.source.zone7Top,'medial_end_of_osteotomy_line');near(p.boneMedialEndMm,10);assert.equal(p.calcarShiftMm,null);
  assert.deepEqual(JSON.parse(JSON.stringify(p)),p);
});
test('zone numbering: lateral 1-2-3, distal 4, medial 5-6-7',()=>{
  const p=G.partition(base());
  for(const [x,y,z] of POINTS) assert.equal(G.classify(p,{x,y}),z,`(${x},${y})`);
});
test('rotation, reflection, translation and calibration invariance',()=>{
  for(const angle of [0,0.7,2.3,Math.PI,4.8]) for(const mirror of [-1,1]) for(const scale of [0.2,1,4]) {
    const f=tf(angle,mirror,scale,1300,-721),p=G.partition(transformInput(base(),f,scale));
    assert.equal(p.status,'ok',JSON.stringify(p));near(p.stemLengthMm,120);near(p.medialTopMm,10);
    for(const [x,y,z] of POINTS) assert.equal(G.classify(p,f({x,y})),z,`(${x},${y}) a=${angle} m=${mirror} s=${scale}`);
  }
});
test('axis given distal-to-proximal still points distally',()=>{
  const i=base();i.stemAxis={proximal:{x:0,y:200},distal:{x:0,y:-30}};
  const p=G.partition(i);assert.equal(p.status,'ok');assert.equal(G.classify(p,{x:10,y:20}),1);assert.equal(G.classify(p,{x:-10,y:100}),5);
});
test('zone 4 length is a stored, changeable parameter',()=>{
  const p=G.partition(base(),{zone4LengthMm:30});near(p.levelsMm.zone4End,150);assert.equal(G.classify(p,{x:10,y:145}),4);
  assert.equal(G.partition(base(),{zone4LengthMm:0}).reason,'invalid_options');
});
test('one zone 7 rule for collared and collarless stems',()=>{
  const i=base();i.collarStatus='collarless';i.medialTop={x:-9,y:-4};
  const p=G.partition(i);assert.equal(p.source.zone7Top,'medial_end_of_osteotomy_line');assert.equal(p.params.collarStatus,'collarless');
  assert.equal(G.classify(p,{x:-10,y:-2}),7);assert.equal(G.classify(p,{x:10,y:-2}),null);
});
test('follow-up carries the baseline zone 7 top and reports calcar shift',()=>{
  const i=base();i.medialTop={x:-9,y:16}; // bone end now 6 mm more distal than the baseline level of 10 mm
  const p=G.partition(i,{zone7TopMm:10});assert.equal(p.status,'ok');
  near(p.medialTopMm,10);near(p.boneMedialEndMm,16);near(p.calcarShiftMm,6);assert.equal(p.source.zone7Top,'baseline_level_carried_over');assert.equal(p.params.zone7TopMm,10);
  assert.equal(G.classify(p,{x:-10,y:12}),7);              // still zone 7 although the bone end has moved distally
  assert.equal(G.measure(p,contours()).zones[7].sections,30); // same 10-40 mm range as at baseline
  const q=G.partition(Object.assign(base(),{medialTop:undefined}),{zone7TopMm:10});
  assert.equal(q.status,'ok');assert.equal(q.boneMedialEndMm,null);assert.equal(q.calcarShiftMm,null);near(q.medialTopMm,10);
  for(const angle of [0.7,2.3]) for(const mirror of [-1,1]) {const f=tf(angle,mirror,4,10,20),r=G.partition(transformInput(i,f,4),{zone7TopMm:10});near(r.calcarShiftMm,6);near(r.medialTopMm,10);}
  assert.equal(G.partition(base(),{zone7TopMm:45}).reason,'baseline_zone7_top_distal_to_zone7');
  assert.equal(G.partition(base(),{zone7TopMm:'10'}).reason,'invalid_options');
  assert.equal(G.partition(Object.assign(base(),{medialTop:undefined})).reason,'invalid_input');
});
test('invalid inputs fail with a reason',()=>{
  const bad=(m,r)=>{const i=base();m(i);const p=G.partition(i);assert.equal(p.status,'error');assert.equal(p.reason,r);};
  bad(i=>{i.mmPerPx=0;},'invalid_scale');bad(i=>{delete i.tip;},'invalid_input');
  bad(i=>{i.stemAxis.distal=i.stemAxis.proximal;},'degenerate_stem_axis');bad(i=>{i.lateralRef={x:0,y:50};},'lateral_reference_on_axis');
  bad(i=>{i.tip={x:0,y:0};},'degenerate_stem_length');bad(i=>{i.medialTop={x:9,y:10};},'medial_top_on_lateral_side');
  bad(i=>{i.medialTop={x:-9,y:45};},'medial_top_distal_to_zone7');bad(i=>{i.collarStatus='yes';},'invalid_collar_status');
  assert.equal(G.classify(G.partition({}),{x:0,y:0}),null);
});
test('per-zone gap and cortical thickness on known geometry, invariant under transforms',()=>{
  for(const [angle,mirror,scale] of [[0,1,1],[0.7,-1,4],[2.3,1,0.2]]) {
    const f=tf(angle,mirror,scale,50,60),p=G.partition(transformInput(base(),f,scale)),c=contours();
    const m=G.measure(p,{stem:c.stem.map(a=>a.map(f)),endosteal:c.endosteal.map(a=>a.map(f)),outer:c.outer.map(a=>a.map(f))});
    assert.equal(m.status,'ok');
    for(const z of [1,2,3]) {near(m.zones[z].gap.meanMm,2,1e-5);near(m.zones[z].cortex.meanMm,5,1e-5);assert.equal(m.zones[z].sections,40);assert.equal(m.zones[z].gap.n,40);}
    for(const z of [5,6]) {near(m.zones[z].gap.meanMm,2,1e-5);near(m.zones[z].cortex.meanMm,4,1e-5);}
    assert.equal(m.zones[7].sections,30);near(m.zones[7].cortex.meanMm,4,1e-5);
    assert.equal(m.zones[4].lateral.gap,null);near(m.zones[4].lateral.cortex.meanMm,5,1e-5);near(m.zones[4].medial.cortex.meanMm,4,1e-5);assert.equal(m.zones[4].lateral.sections,20);
    assert.deepEqual(JSON.parse(JSON.stringify(m)),m);
  }
});
test('missing or doubled contours are skipped and counted, never filled in',()=>{
  const p=G.partition(base()),c=contours();
  c.outer=[[{x:13,y:-10},{x:13,y:60}],c.outer[1]]; // lateral outer cortex stops at 60 mm
  c.endosteal.push([{x:-9,y:85},{x:-9,y:95}]);      // second medial endosteal line between 85 and 95 mm
  const m=G.measure(p,c);
  assert.equal(m.zones[2].cortex.n,20);assert.equal(m.zones[2].skipped.missing,20);
  assert.equal(m.zones[3].cortex.n,0);assert.equal(m.zones[3].cortex.meanMm,null);assert.equal(m.zones[3].skipped.missing,40);
  assert.equal(m.zones[5].skipped.ambiguous,10);assert.equal(m.zones[5].cortex.n,30);
  assert.equal(G.measure(p,{stem:[]}).reason,'invalid_contours');assert.equal(G.measure(G.partition({}),c).reason,'invalid_partition');
});
