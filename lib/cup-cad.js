// Weak-perspective projection of a circular metal opening measured on a shell CAD.
const FmaCupCad = (() => {
  const rad = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angles = Array.from({length: 72}, (_, k) => [Math.cos(k * Math.PI / 36), Math.sin(k * Math.PI / 36)]);
  const bounded = (x, y) => Number.isFinite(x) && Number.isFinite(y);

  function model(data) {
    if (!data || data.schema !== 'fma-cup-cad-rim-v1' ||
        ![data.model, data.version, data.source].every(v => typeof v === 'string' && v.trim()) ||
        !['prototype', 'dimension_verified'].includes(data.status) ||
        !Number.isFinite(data.opening_diameter_mm) || data.opening_diameter_mm < 15 || data.opening_diameter_mm > 100 ||
        !/^[0-9a-f]{64}$/i.test(data.cad_sha256 || '')) throw Error('開口縁を登録したCADモデルJSONを選んでください。');
    const {schema, model, version, source, status, opening_diameter_mm, cad_sha256} = data;
    return {schema, model, version, source, status, opening_diameter_mm, cad_sha256};
  }
  function project(pose, radius, samples = angles) {
    const [cx, cy, phi, ra] = pose, cp = Math.cos(phi * rad), sp = Math.sin(phi * rad), k = Math.sin(ra * rad);
    return samples.map(([u, v]) => [cx + radius*(cp*u - sp*k*v), cy + radius*(sp*u + cp*k*v)]);
  }
  function optimize(seed, steps, cost) {
    let p = seed.slice(), score = cost(p);
    for (let level = 0; level < 8; level++) {
      let improved = true;
      for (let sweep = 0; improved && sweep < 14; sweep++) {
        improved = false;
        for (let j = 0; j < 4; j++) {
          let best = p;
          for (const sign of [-1, 1]) {
            const alt = p.slice();
            alt[j] += sign * steps[j] / (2**level);
            if (alt[3] < 0 || alt[3] > 90) continue;
            const v = cost(alt);
            if (v + 1e-8 < score) { score = v; best = alt; improved = true; }
          }
          p = best;
        }
      }
    }
    return {pose:p, score};
  }
  function distances(points, poly) {
    return points.map(([x,y]) => {
      let d2 = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a=poly[i], b=poly[(i+1)%poly.length], dx=b[0]-a[0], dy=b[1]-a[1];
        const t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy || 1),0,1);
        d2=Math.min(d2,(a[0]+t*dx-x)**2+(a[1]+t*dy-y)**2);
      }
      return Math.sqrt(d2);
    });
  }
  function fitPoints(points, radius) {
    if (!Number.isFinite(radius) || radius <= 0 || !Array.isArray(points) || points.length < 6 || points.length > 64 ||
        points.some(p => !Array.isArray(p) || !bounded(...p))) throw Error('開口縁の見える範囲に分散させて6点以上指定してください。');
    let length=0, endpoints;
    for (const a of points) for (const b of points) {
      const l=Math.hypot(a[0]-b[0],a[1]-b[1]);
      if(l>length){length=l;endpoints=[a,b];}
    }
    if(length<radius*1.45 || length>radius*2.35) throw Error('点の広がりとCAD径が合いません。倍率・製品・両端の位置を確認してください。');
    const [a,b]=endpoints, phi=Math.atan2(b[1]-a[1],b[0]-a[0])/rad;
    const cx=(a[0]+b[0])/2, cy=(a[1]+b[1])/2;
    const cost=p=>distances(points,project(p,radius)).reduce((sum,d)=>sum+d*d,0)/points.length;
    const candidates=[12,42,73].map(ra=>optimize([cx,cy,phi,ra],[radius/10,radius/10,10,10],cost));
    const best=candidates.sort((a,b)=>a.score-b.score)[0];
    const [x,y,theta,ra]=best.pose, cp=Math.cos(theta*rad),sp=Math.sin(theta*rad);
    const phases=points.map(([u,v])=>Math.atan2((-(u-x)*sp+(v-y)*cp)/Math.max(.02,Math.sin(ra*rad)),(u-x)*cp+(v-y)*sp)).sort((a,b)=>a-b);
    const gaps=phases.map((t,i)=>(i+1===phases.length?phases[0]+2*Math.PI:phases[i+1])-t);
    if (Math.max(...gaps)>Math.PI || Math.sqrt(best.score)>radius*.10) throw Error('開口縁全体の適合を確認できません。点の分布とCAD寸法を確認してください。');
    return {pose:best.pose, rms_px:Math.sqrt(best.score), method:'cad_rim_points'};
  }
  function detect(gray, width, height, center, radius) {
    if(!gray || gray.length!==width*height || !Number.isFinite(radius) || radius<5 ||
       !center || !bounded(...center)) throw Error('倍率とカップ中心付近の位置を確認してください。');
    function sample(x,y){
      const i=Math.floor(x),j=Math.floor(y);
      if(i<0||j<0||i>=width-1||j>=height-1)return NaN;
      const a=x-i,b=y-j,k=j*width+i;
      return (1-b)*((1-a)*gray[k]+a*gray[k+1])+b*((1-a)*gray[k+width]+a*gray[k+width+1]);
    }
    const delta=clamp(radius*.031,1,4);
    function score(p){
      if(Math.hypot(p[0]-center[0],p[1]-center[1])>radius*.34)return 1e4;
      const poly=project(p,radius), sector=Array(8).fill(0);
      for(let i=0;i<72;i++){
        const a=poly[(i+71)%72],b=poly[(i+1)%72], [x,y]=poly[i];
        let nx=b[1]-a[1],ny=a[0]-b[0];const l=Math.hypot(nx,ny)||1;nx*=delta/l;ny*=delta/l;
        const g=Math.abs(sample(x+nx,y+ny)-sample(x-nx,y-ny));
        if(!Number.isFinite(g))return 1e4;
        sector[Math.floor(i/9)]+=Math.min(100,g)/9;
      }
      sector.sort((a,b)=>a-b);
      return -sector.slice(1,7).reduce((s,v)=>s+v,0)/6;
    }
    const seeds=[];
    for(const x of [-.14,0,.14])for(const y of [-.14,0,.14])for(let phi=-90;phi<90;phi+=15)for(const ra of [4,15,30,45,60,75,88]){
      const p=[center[0]+x*radius,center[1]+y*radius,phi,ra];seeds.push({pose:p,score:score(p)});
    }
    seeds.sort((a,b)=>a.score-b.score);
    const contenders=seeds.slice(0,4).map(s=>optimize(s.pose,[radius*.045,radius*.045,4,4],score)).sort((a,b)=>a.score-b.score);
    if(contenders[0].score> -4) throw Error('開口縁を検出できません。見える縁を6点以上指定してください。');
    return {pose:contenders[0].pose, edge_contrast:-contenders[0].score, method:'cad_rim_image_gradient'};
  }
  function measure(pose, baseline, radius) {
    if(!Array.isArray(pose)||pose.length!==4||!pose.every(Number.isFinite)||pose[3]<0||pose[3]>90||!(radius>0))throw Error('CAD姿勢を確認してください。');
    if(baseline.length!==2 || baseline.some(p=>!bounded(...p)) || Math.hypot(baseline[1][0]-baseline[0][0],baseline[1][1]-baseline[0][1])<5)throw Error('左右の涙痕を指定してください。');
    const [a,b]=baseline, horizontal=Math.atan2(b[1]-a[1],b[0]-a[0])/rad;
    const angle=((pose[2]-horizontal)%180+180)%180;
    return {ri_deg:radius*(1-Math.sin(pose[3]*rad))<1?null:Math.min(angle,180-angle),
      ra_abs_deg:pose[3],ra_signed_deg:null,reference:'AP_teardrop_line',projection:'weak_perspective_circular_CAD_rim'};
  }
  return {model, project, fitPoints, detect, measure};
})();
if(typeof module!=='undefined' && module.exports) module.exports=FmaCupCad;
