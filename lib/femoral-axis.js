/* Bone-only, open-polyline endosteal midpoint axis. No image-y or implant seed. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FemoralAxis = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.0.0';
  const EPS = 1e-7; // millimeters, after translation and calibration
  const add = (a,b) => ({x:a.x+b.x,y:a.y+b.y});
  const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
  const mul = (a,s) => ({x:a.x*s,y:a.y*s});
  const dot = (a,b) => a.x*b.x+a.y*b.y;
  const norm = a => Math.hypot(a.x,a.y);
  const unit = a => norm(a)>EPS ? mul(a,1/norm(a)) : null;
  const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const midpoint = (a,b) => mul(add(a,b),0.5);
  function crossing(path,v,level) {
    const hits=[];
    for(let i=1;i<path.length;i++) {
      const a=path[i-1],b=path[i],u=dot(a,v)-level,w=dot(b,v)-level;
      if(Math.abs(u)<=EPS && Math.abs(w)<=EPS) {
        if(norm(sub(a,b))>EPS) return {reason:'collinear_segment'};
        if(!hits.some(p=>norm(sub(p,a))<=EPS)) hits.push(a);
        continue;
      }
      if((u>EPS && w>EPS)||(u< -EPS && w< -EPS)) continue;
      const den=u-w;
      if(Math.abs(den)<Number.EPSILON) return {reason:'numerical_intersection_failure'};
      const t=u/den;
      if(t< -1e-10 || t>1+1e-10) continue;
      const p=add(a,mul(sub(b,a),Math.max(0,Math.min(1,t))));
      if(!finitePoint(p)) return {reason:'numerical_intersection_failure'};
      if(!hits.some(q=>norm(sub(p,q))<=EPS)) hits.push(p);
    }
    return hits.length===1 ? {point:hits[0]} : {reason:hits.length?'multiple_crossings':'no_crossing'};
  }
  function section(paths,v,level) {
    const hits=paths.map(p=>crossing(p,v,level));
    // Ambiguity/numerical failure always wins over absence on the other wall.
    const fatal=hits.find(h=>h.reason && h.reason!=='no_crossing');
    if(fatal) return {reason:fatal.reason};
    if(hits.some(h=>h.reason)) return {reason:'no_crossing',missingWalls:hits.map((h,i)=>h.reason?i:-1).filter(i=>i>=0)};
    if(norm(sub(hits[0].point,hits[1].point))<=EPS) return {reason:'zero_width'};
    return {mid:midpoint(hits[0].point,hits[1].point),medial:hits[0].point,lateral:hits[1].point};
  }
  function solve(input, options) {
    const result={schema:'femoral-axis/v1',method:'endosteal_midpoint_10_to_100_90_80',version:VERSION,
      status:'error',reason:null,fallbackReasons:[],endpoints:null,levels:null,geometry:null,
      source:{contours:'rendered_open_polylines',ordering:'proximal_to_distal',landmark:'confirmed_LT_required_by_caller',initializer:'paired_endpoint_longitudinal_direction'},iterations:0,residualRadians:null};
    const fail=reason=>{result.reason=reason;return result;};
    if(!input || !Number.isFinite(input.mmPerPx) || input.mmPerPx<=0 || !Number.isFinite(1/input.mmPerPx)) return fail('invalid_scale');
    if(!finitePoint(input.lt) || ![input.medial,input.lateral].every(p=>Array.isArray(p)&&p.length>=2&&p.every(finitePoint))) return fail('invalid_input');
    const s=input.mmPerPx,origin={x:input.lt.x,y:input.lt.y};
    const paths=[input.medial,input.lateral].map(path=>path.map(p=>mul(sub(p,origin),s)));
    if(!paths.every(p=>p.every(finitePoint))) return fail('numerical_input_failure');
    const longitudinal=paths.map(p=>sub(p[p.length-1],p[0]));
    let initial=unit(add(longitudinal[0],longitudinal[1]));
    if(!initial || longitudinal.some(d=>!unit(d)||dot(d,initial)<=EPS)) return fail('degenerate_initial_direction');
    const maxIterations=options && options.maxIterations!==undefined ? options.maxIterations : 400;
    if(!Number.isInteger(maxIterations)||maxIterations<1||maxIterations>10000) return fail('invalid_options');
    const world=p=>add(origin,mul(p,1/s));
    const evidence=q=>({midpoint:world(q.mid),medial:world(q.medial),lateral:world(q.lateral)});
    for(const level of [100,90,80]) {
      let v=initial,missing=false;
      for(let i=0;i<maxIterations;i++) {
        result.iterations++;
        const a=section(paths,v,10);
        if(a.reason) return fail('proximal_10_'+a.reason);
        const b=section(paths,v,level);
        if(b.reason) {
          if(b.reason!=='no_crossing') return fail('distal_'+level+'_'+b.reason);
          // A radial bound is direction-independent: even a different initializer
          // cannot produce a crossing if one complete wall is inside this ball.
          // This deliberately rejects inconclusive truncation rather than treating
          // a poor current direction or numerical failure as permission to fallback.
          const proven=b.missingWalls.filter(k=>paths[k].every(p=>norm(p)<level-EPS));
          if(!proven.length) return fail('distal_'+level+'_coverage_unproven');
          result.fallbackReasons.push({levelMm:level,reason:'true_distal_coverage_missing',wall:proven.map(k=>k===0?'medial':'lateral'),certificate:'entire_wall_radius_from_LT_less_than_level'});
          missing=true;break;
        }
        const next=unit(sub(b.mid,a.mid));
        if(!next || dot(next,v)<=0) return fail('degenerate_midpoint_direction');
        const residual=Math.abs(Math.atan2(v.x*next.y-v.y*next.x,dot(v,next)));
        if(!Number.isFinite(residual)) return fail('numerical_iteration_failure');
        result.residualRadians=residual;
        if(residual<1e-9) {
          // Use the converged section direction so endpoint levels remain exact.
          const reference=sub(a.mid,mul(v,dot(a.mid,v)));
          result.status='ok'; result.reason=null;
          result.endpoints={proximal:world(a.mid),distal:world(b.mid)};
          result.levels={proximalMm:10,distalMm:level};
          result.sections={proximal:evidence(a),distal:evidence(b)};
          result.geometry={lt:world(reference),ltMedial:origin,vx:v.x,vy:v.y,pxPerMm:1/s,mmPerPx:s};
          return result;
        }
        v=unit(add(v,next));
        if(!v) return fail('degenerate_iteration');
      }
      if(!missing) return fail('nonconvergence');
      if(level===80) return fail('distal_80_coverage_missing');
    }
    return fail('internal_failure');
  }
  return {solve,version:VERSION};
}));
