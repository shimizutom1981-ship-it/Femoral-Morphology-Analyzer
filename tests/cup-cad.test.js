const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const cad=require('../lib/cup-cad');
const approx=(value,expected,tol)=>assert.ok(Math.abs(value-expected)<tol,JSON.stringify({value,expected,tol}));
test('known CAD radius recovers AP rotation under image roll, mirror and point reordering',()=>{
  for(const [phi,ra,base] of [[-37,19,7],[47,32,8],[120,11,-9]]){
    const ring=cad.project([113,86,phi,ra],37), pts=ring.filter((p,i)=>i%6===0).reverse();
    const f=cad.fitPoints(pts,37), measured=cad.measure(f.pose,[[5,20],[105,20+100*Math.tan(base*Math.PI/180)]],37);
    const a=Math.abs(phi-base)%180;
    approx(measured.ri_deg,Math.min(a,180-a),.2);approx(measured.ra_abs_deg,ra,.15);
    assert.equal(measured.ra_signed_deg,null);
  }
});
test('gradient detector fits a calibrated shell edge without supplied rim points',()=>{
  const w=200,h=160,r=43,phi=-37*Math.PI/180,k=Math.sin(25*Math.PI/180),g=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const u=(x-102)*Math.cos(phi)+(y-78)*Math.sin(phi),v=-(x-102)*Math.sin(phi)+(y-78)*Math.cos(phi);
    g[y*w+x]=Math.round(36+145/(1+Math.exp(2*(Math.hypot(u,v/k)-r))));
  }
  const f=cad.detect(g,w,h,[99,80],r),a=cad.measure(f.pose,[[0,0],[55,0]],r);
  approx(a.ri_deg,37,2);approx(a.ra_abs_deg,25,2);assert.equal(f.method,'cad_rim_image_gradient');
  assert.throws(()=>cad.detect(new Uint8Array(w*h),w,h,[99,80],r));
});
test('missing scale, short arcs, circle orientation and missing baseline',()=>{
  const ring=cad.project([100,100,20,30],40);
  assert.throws(()=>cad.fitPoints(ring.slice(0,8),40));
  assert.throws(()=>cad.fitPoints(ring.slice(0,8),0));
  assert.throws(()=>cad.measure([0,0,20,23],[[1,1],[1,1]],40));
  assert.equal(cad.measure([0,0,40,90],[[1,1],[20,1]],40).ri_deg,null);
  assert.throws(()=>cad.model({opening_diameter_mm:48}));
});
test('standalone build embeds cup modules',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../dev/index.html'),'utf8');
  for(const name of ['cup-cad','cup-cad-ui'])assert.ok(app.includes(fs.readFileSync(path.join(__dirname,'../lib',name+'.js'),'utf8')));
});
