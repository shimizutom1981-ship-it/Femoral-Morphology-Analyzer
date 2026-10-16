'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {solve}=require('../dev/femoral-axis.js');
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function canal(end=120) {return {medial:[{x:-5,y:-10},{x:-5,y:30},{x:-5,y:end}],lateral:[{x:5,y:-10},{x:5,y:30},{x:5,y:end}],lt:{x:-5,y:0},mmPerPx:1};}
function transform(input,angle,mirror,scale,tx,ty) {
  const c=Math.cos(angle),s=Math.sin(angle);
  const p=q=>({x:scale*(mirror*q.x*c-q.y*s)+tx,y:scale*(mirror*q.x*s+q.y*c)+ty});
  return {medial:input.medial.map(p),lateral:input.lateral.map(p),lt:p(input.lt),mmPerPx:input.mmPerPx/scale};
}
test('full coverage uses 10/100; projected LT and exact endpoints',()=>{
  const r=solve(canal());assert.equal(r.status,'ok');assert.equal(r.levels.distalMm,100);
  near(r.geometry.lt.x,0);near(r.geometry.lt.y,0);near(r.geometry.ltMedial.x,-5);
  near(r.endpoints.proximal.y,10);near(r.endpoints.distal.y,100);assert.deepEqual(r.fallbackReasons,[]);
  assert.deepEqual(JSON.parse(JSON.stringify(r)),r);
});
test('rotation, reflection, translation and calibration covariance',()=>{
  for(const end of [120,95,85]) for(const angle of [0,0.7,2.3,Math.PI,4.8]) for(const mirror of [-1,1]) for(const scale of [0.2,1,4]) {
    const r=solve(transform(canal(end),angle,mirror,scale,1300,-721));
    assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(r.levels.distalMm,end===120?100:end===95?90:80);
    near(r.geometry.vx,-Math.sin(angle));near(r.geometry.vy,Math.cos(angle));
    near(r.geometry.lt.x,1300);near(r.geometry.lt.y,-721);
  }
});
test('true truncated coverage falls back in order; missing 80 fails',()=>{
  for(const [end,level,count] of [[95,90,1],[85,80,2]]) {const r=solve(canal(end));assert.equal(r.levels.distalMm,level);assert.equal(r.fallbackReasons.length,count);}
  const r=solve(canal(70));assert.equal(r.status,'error');assert.equal(r.reason,'distal_80_coverage_missing');assert.equal(r.fallbackReasons.length,3);
});
test('missing proximal 10 is a hard failure',()=>{
  const c=canal();c.medial=[{x:-5,y:20},{x:-5,y:120}];c.lateral=[{x:5,y:20},{x:5,y:120}];
  const r=solve(c);assert.equal(r.reason,'proximal_10_no_crossing');assert.deepEqual(r.fallbackReasons,[]);
});
test('invalid scale and invalid/degenerate contours fail without fallback',()=>{
  for(const s of [0,-1,NaN,Infinity,'1',Number.MIN_VALUE]) assert.equal(solve({...canal(),mmPerPx:s}).reason,'invalid_scale');
  assert.equal(solve({...canal(),lt:{x:NaN,y:0}}).reason,'invalid_input');
  assert.equal(solve({...canal(),medial:[{x:0,y:0}]}).reason,'invalid_input');
  const c=canal();c.lateral.reverse();assert.equal(solve(c).reason,'degenerate_initial_direction');
});
test('multiple crossings and collinear section never cause fallback',()=>{
  const c=canal();c.medial=[{x:-5,y:-10},{x:-8,y:110},{x:-3,y:90},{x:-5,y:120}];
  let r=solve(c);assert.equal(r.reason,'distal_100_multiple_crossings');assert.deepEqual(r.fallbackReasons,[]);
  c.medial=[{x:-5,y:-10},{x:-5,y:100},{x:-3,y:100},{x:-5,y:120}];
  r=solve(c);assert.equal(r.reason,'distal_100_collinear_segment');assert.deepEqual(r.fallbackReasons,[]);
});
test('a direction-dependent absence cannot justify fallback',()=>{
  const c=canal(95);c.lt={x:50,y:0};const r=solve(c);
  assert.equal(r.reason,'distal_100_coverage_unproven');assert.deepEqual(r.fallbackReasons,[]);
});
test('curved canal converges; iteration exhaustion is hard failure',()=>{
  const c=canal();c.medial=[{x:-5,y:-10},{x:5,y:60},{x:30,y:120}];c.lateral=c.medial.map(p=>({x:p.x+10,y:p.y}));
  const r=solve(c);assert.equal(r.status,'ok',r.reason);assert.ok(r.iterations>1);
  const exhausted=solve(c,{maxIterations:1});assert.equal(exhausted.reason,'nonconvergence');assert.deepEqual(exhausted.fallbackReasons,[]);
});
test('shared vertices count once and duplicate points do not invent crossings',()=>{
  const c=canal();c.medial.splice(1,0,{x:-5,y:10},{x:-5,y:10});assert.equal(solve(c).status,'ok');
});
test('zero width fails and every result is finite JSON',()=>{
  const c=canal();c.lateral=c.medial.map(p=>({...p}));const r=solve(c);assert.equal(r.reason,'proximal_10_zero_width');
  assert.deepEqual(JSON.parse(JSON.stringify(r)),r);
});
test('curved-axis solution is covariant and never mutates inputs',()=>{
  const c=canal();c.medial=[{x:-5,y:-10},{x:5,y:60},{x:30,y:120}];c.lateral=c.medial.map(p=>({x:p.x+10,y:p.y}));
  const original=JSON.stringify(c),base=solve(c),a=1.17;
  const r=solve(transform(c,a,-1,3,42,-85));assert.equal(r.status,'ok');
  near(r.geometry.vx,-base.geometry.vx*Math.cos(a)-base.geometry.vy*Math.sin(a));
  near(r.geometry.vy,-base.geometry.vx*Math.sin(a)+base.geometry.vy*Math.cos(a));
  assert.equal(JSON.stringify(c),original);
  const projected=r.geometry.lt,prox=r.endpoints.proximal;
  near(((prox.x-projected.x)*r.geometry.vx+(prox.y-projected.y)*r.geometry.vy)*r.geometry.mmPerPx,10);
});
test('exact distal endpoint coverage is accepted without fallback',()=>{
  for(const length of [100,90,80]) {const r=solve(canal(length));assert.equal(r.status,'ok',r.reason);assert.equal(r.levels.distalMm,length);}
});
