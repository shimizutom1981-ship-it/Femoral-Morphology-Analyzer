'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../lib/research-profile');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
  const wall=(x)=>[{x:x(0),y:-20},{x:x(200),y:180}];
  // The LT reference is at y=0. Deliberately fractional endpoints exercise direct intersections.
  return {direction:'AP',side:'R',reviewed:true,
    axis:{status:'ok',quality_status:'confirmed',lt_confirmed:true,method:'endosteal_midpoint_10_to_100_90_80',version:'1.1.0',levels:{proximalMm:10,distalMm:100},geometry:{lt:{x:100,y:0},vx:0,vy:1,mmPerPx:1}},
    range:{proximal:{x:100,y:.3},tip:{x:100,y:100.7}},exclusions:[],
    contours:{MED:{outer:wall(t=>110+t*.01),inner:wall(()=>105),stem:wall(()=>103)},LAT:{outer:wall(t=>90-t*.01),inner:wall(()=>95),stem:wall(()=>97)}},
    metadata:{record_id:'record-1',research_id:'0001',surgery_key:'0001_R_2026-10-01',image_id:'IMG1',observer_id:'TS',repeat_index:1,boundary_rule_version:'TEST-RULE',timepoint:'EARLY',acquisition_date:'2026-10-07',confirmed_date:'2026-11-17',source_image_ref:'test/source.png',annotation_ref:'test/record-1.json#raw',output_ref:'test/record-1.json'}};
}
test('101 direct fractional positions, % units, full curves and exact thirds',()=>{
  const p=R.profile(fixture());assert.equal(p.samples.length,101);assert.equal(p.sampling_step_pct,1);
  assert.equal(p.samples[1].bone_mm,.3+100.4/100);assert.equal(p.samples[50].cfr_pct,60);
  assert.deepEqual(p.summaries.slice(0,3).map(s=>s.expected_n),[34,33,34]);
  assert.deepEqual(p.summaries.slice(0,3).map(s=>s.value),[60,60,60]);
  assert.ok(Math.abs(p.samples[1].MED_cortex_mm-(5+(.3+1.004+20)*.01))<1e-10);
});
test('endpoint missingness never moves range; no interpolation across explicit missing interval',()=>{
  const i=fixture();i.exclusions=[{from_mm:0,to_mm:5,side:'ALL',reason:'unreadable'},{from_mm:99,to_mm:110,side:'ALL',reason:'unreadable'}];
  const p=R.profile(i);assert.deepEqual(p.range_mm,{start:.3,end:100.7});assert.equal(p.samples[0].cfr_pct,null);assert.equal(p.samples.at(-1).cfr_pct,null);assert.equal(p.samples.length,101);assert.match(p.samples[0].missing_reasons.cfr_pct,/unreadable/);
  assert.equal(p.summaries[0].value,null);assert.equal(p.summaries[0].valid_n,29);
});
test('coverage thresholds 31/34, 30/33 and 31/34, missing is not zero',()=>{
  for(const [region,nMissing,ok]of [['PROX',3,true],['PROX',4,false],['MID',3,true],['MID',4,false],['DIST',3,true],['DIST',4,false]]){
    const i=fixture(),lo=R.regions[region][0],at=k=>.3+100.4*k/100;
    i.exclusions=[{from_mm:at(lo)-1e-5,to_mm:at(lo+nMissing-1)+1e-5,side:'MED',reason:'qc'}];
    const p=R.profile(i),s=p.summaries.find(x=>x.code==='cfr_mean'&&x.region===region);
    assert.equal(s.value!==null,ok);assert.equal(s.valid_n,s.expected_n-nMissing);assert.equal(s.complete,false);
    assert.ok(p.summaries.find(x=>x.code==='cortex_mean_mm'&&x.region===region&&x.side==='LAT').complete);
  }
});
test('boundary-specific missingness removes only dependent metrics',()=>{
  for(const boundary of ['outer','inner','stem']){
    const i=fixture();i.exclusions=[{from_mm:0,to_mm:110,side:'MED',boundary,reason:'unreadable'}];
    const p=R.profile(i),s=p.samples[50];
    assert.equal(s.cfr_pct===null,boundary!=='outer');
    assert.equal(s.MED_cortex_mm===null,boundary!=='stem');
    assert.equal(s.MED_gap_mm===null,boundary!=='outer');
    assert.ok(Number.isFinite(s.LAT_cortex_mm));
  }
});
test('ambiguous, absent and reversed boundaries have explicit missing reasons; stem absence does not erase cortex',()=>{
  const i=fixture();i.contours.MED.stem=[];
  let p=R.profile(i);assert.equal(p.samples[50].cfr_pct,null);assert.ok(p.samples[50].MED_cortex_mm>0);
  i.contours.MED.outer=[{x:104,y:-20},{x:104,y:180}];p=R.profile(i);assert.equal(p.samples[50].MED_cortex_mm,null);assert.equal(p.samples[50].missing_reasons.MED_cortex_mm,'outer_inner_order');
  i.contours.MED.inner=[{x:105,y:-20},{x:105,y:180},{x:106,y:-20}];p=R.profile(i);assert.equal(p.samples[50].cfr_pct,null);assert.equal(p.samples[50].missing_reasons.cfr_pct,'multiple_crossings');
});
test('true zero stem width is retained; contact is not inferred and negative gaps are not clamped',()=>{
  const i=fixture();i.contours.MED.stem=[{x:103,y:-20},{x:100,y:100.7}];i.contours.LAT.stem=[{x:97,y:-20},{x:100,y:100.7}];
  let p=R.profile(i);assert.equal(p.samples[100].cfr_pct,0);assert.equal(p.samples[100].missing_reasons.cfr_pct,null);
  i.contours.MED.stem=[{x:106,y:-20},{x:106,y:180}];p=R.profile(i);assert.equal(p.samples[50].MED_gap_mm,-1);assert.ok(p.samples[50].warnings.length);assert.equal(p.samples[50].tip_contact,undefined);
});
function transform(i,angle,scale,flip){
  const j=clone(i),c=Math.cos(angle),s=Math.sin(angle),f=flip?-1:1;
  const point=p=>({x:50+scale*(c*f*p.x-s*p.y),y:-37+scale*(s*f*p.x+c*p.y)});
  for(const a of Object.values(j.contours))for(const k of Object.keys(a))a[k]=a[k].map(point);
  j.range.proximal=point(j.range.proximal);j.range.tip=point(j.range.tip);j.axis.geometry.lt=point(j.axis.geometry.lt);
  const g=i.axis.geometry;j.axis.geometry.vx=c*f*g.vx-s*g.vy;j.axis.geometry.vy=s*f*g.vx+c*g.vy;j.axis.geometry.mmPerPx/=scale;
  if(flip)j.side='L';return j;
}
test('rotation, translation, scale and R/L reflection preserve sampled metric values',()=>{
  const i=fixture(),a=R.profile(i);
  for(const j of [transform(i,.7,2,false),transform(i,1.4,.4,true)]){
    const b=R.profile(j);for(let k=0;k<101;k++)for(const key of ['bone_mm','cfr_pct','MED_cortex_mm','LAT_cortex_mm'])assert.ok(Math.abs(a.samples[k][key]-b.samples[k][key])<1e-8,key);
  }
});
function pair(){const a=fixture(),b=fixture();b.range.tip.y+=20;b.metadata={...b.metadata,record_id:'record-2',image_id:'IMG2',timepoint:'M12',acquisition_date:'2027-10-04',confirmed_date:'2027-10-05',output_ref:'test/record-2.json'};for(const p of b.contours.MED.outer)p.x+=1;for(const p of b.contours.LAT.outer)p.x-=2;return [R.profile(a),R.profile(b)];}
test('cortex comparison uses baseline LT-mm despite stem subsidence, with separate sides',()=>{
  const [a,b]=pair(),r=R.compare(a,b,{pairConfirmed:true,relativeBaselineConfirmed:true});
  assert.deepEqual(r.samples.map(x=>x.bone_mm),a.samples.map(x=>x.bone_mm));
  for(const s of r.summaries.filter(s=>s.code==='cortex_delta_mm'))assert.ok(Math.abs(s.value-(s.side==='MED'?1:2))<1e-10);
  assert.ok(r.samples.at(-1).followup.bone_mm!==b.samples.at(-1).bone_mm);
});
test('paired coverage uses same point set in both visits; delta % uses ratio of paired means',()=>{
  const [a,b]=pair();b.input.exclusions=[{from_mm:0,to_mm:2.5,side:'MED',reason:'projection'}];
  const r=R.compare(a,b,{pairConfirmed:true,relativeBaselineConfirmed:true}),s=r.summaries.find(s=>s.code==='cortex_delta_pct'&&s.side==='MED'&&s.region==='PROX');
  assert.equal(s.valid_n,31);assert.ok(Math.abs(s.value-100*(s.paired_followup_mean_mm-s.paired_baseline_mean_mm)/s.paired_baseline_mean_mm)<1e-10);
  const q=R.compare(a,b,{pairConfirmed:true});assert.equal(q.summaries.find(s=>s.code==='cortex_delta_pct').value,null);
});
test('pair comparison rejects identity/date/axis/definition mismatch and wrong time points',()=>{
  const [a,b]=pair();assert.throws(()=>R.compare(a,b,{}));
  for(const mutate of [x=>x.input.metadata.surgery_key='other',x=>x.input.side='L',x=>x.input.metadata.acquisition_date='2027-02-30',x=>x.input.metadata.timepoint='M3',x=>x.input.axis.levels.distalMm=90,x=>x.input.metadata.boundary_rule_version='different']){const c=clone(b);mutate(c);assert.throws(()=>R.compare(a,c,{pairConfirmed:true}));}
});
test('saved JSON recomputation ignores tampered derived values, preserving raw geometry and counts',()=>{
  const p=R.profile(fixture()),q=JSON.parse(JSON.stringify(p));q.samples[0].cfr_pct=999;q.summaries[0].value=999;
  const rows=R.registry(q);assert.equal(rows.metrics[1][9],60);assert.equal(rows.metrics[1][13],34);assert.equal(rows.metrics[1][14],34);assert.equal(rows.metrics[1][15],1);assert.equal(rows.images[1][1],'0001');assert.equal(rows.images[0].length,19);assert.equal(rows.metrics[0].length,23);
  assert.equal(R.registry(p).metrics[1][0],rows.metrics[1][0]);
});
test('registry maps only reviewed, identified outputs; pending adoption and formula-safe CSV',()=>{
  const p=R.profile(fixture());p.input.metadata.research_id='=DANGEROUS()';
  const r=R.registry(p);assert.equal(r.images[1][17],'PENDING');assert.equal(r.metrics[1][20],'PENDING');assert.ok(R.csv(r.images).includes("'=DANGEROUS()"));assert.ok(R.profileCsv(p).includes('cfr_pct'));
  delete p.input.metadata.surgery_key;assert.throws(()=>R.registry(p));
});
test('pair registry carries both measurement IDs, mm/% units and output references',()=>{
  const [a,b]=pair(),p=R.compare(a,b,{pairConfirmed:true,relativeBaselineConfirmed:true}),r=R.registry(p,{outputRef:'test/pair.json'});
  assert.equal(r.images.length,3);assert.equal(r.metrics.length,13);assert.equal(r.metrics[1][3],'record-1');assert.equal(r.metrics[1][4],'record-2');assert.equal(r.metrics[1][11],'mm');assert.equal(r.metrics[2][11],'%');assert.equal(r.metrics[1][17],'test/pair.json');assert.equal(r.metrics[1][12],'LONG_OK');
});
test('AXIAL and unconfirmed or invalid geometry fail closed',()=>{
  for(const mutate of [x=>x.direction='AXIAL',x=>x.reviewed=false,x=>x.axis.quality_status='review_required',x=>x.axis.geometry.mmPerPx=0,x=>x.range.tip=x.range.proximal,x=>x.contours.MED.inner[0].x=NaN,x=>x.calibration={known_mm:32,mm_per_px:.5}]){const i=fixture();mutate(i);assert.throws(()=>R.profile(i));}
  const i=fixture();i.metadata.confirmed_date='2026-10-06';assert.throws(()=>R.registry(R.profile(i)),/confirmed_date_before_image/);
});
module.exports={fixture,pair};
