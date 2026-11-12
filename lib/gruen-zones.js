/* Gruen zone partition for AP radiographs (7 zones), implant-referenced.
 * Spec adopted 2026-11-12 (FMA progress log, vol. 2, section 8):
 *  - proximal origin = stem shoulder; shoulder-to-tip length is split into thirds
 *  - boundaries are perpendicular to the stem axis
 *  - zone 4 = from the tip to zone4LengthMm distal (default 20 mm; a proposed value, not a standard)
 *  - zone 7 upper end (revised 2026-11-12): one rule for collared and collarless stems.
 *      baseline image : the medial end of the osteotomy line (input.medialTop)
 *      follow-up image: the baseline level, carried over as options.zone7TopMm (mm distal to the shoulder),
 *                       so zone 7 covers the same stem-referenced range at every time point.
 *    When both are given, calcarShiftMm = current bone end - baseline level (positive = distal).
 * Pure geometry: no image access, no DOM. Brightness per zone is computed by the caller.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GruenZones = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '0.2.0';
  const EPS = 1e-7; // millimeters
  const DEFAULT_ZONE4_MM = 20;
  const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
  const dot = (a,b) => a.x*b.x+a.y*b.y;
  const norm = a => Math.hypot(a.x,a.y);
  const finitePoint = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

  function partition(input, options) {
    const result={schema:'gruen-zones/v1',version:VERSION,status:'error',reason:null,
      params:null,frame:null,stemLengthMm:null,levelsMm:null,medialTopMm:null,boneMedialEndMm:null,calcarShiftMm:null,
      source:{origin:'stem_shoulder_projected_on_stem_axis',thirds:'shoulder_to_tip',zone7Top:null}};
    const fail=reason=>{result.reason=reason;return result;};
    if(!input || !Number.isFinite(input.mmPerPx) || input.mmPerPx<=0) return fail('invalid_scale');
    const ax=input.stemAxis;
    if(!ax || ![ax.proximal,ax.distal,input.shoulder,input.tip,input.lateralRef].every(finitePoint)) return fail('invalid_input');
    const baseline=options && options.zone7TopMm!==undefined && options.zone7TopMm!==null ? options.zone7TopMm : null;
    if(baseline!==null && !Number.isFinite(baseline)) return fail('invalid_options');
    const hasBoneEnd=input.medialTop!==undefined && input.medialTop!==null;
    if(hasBoneEnd ? !finitePoint(input.medialTop) : baseline===null) return fail('invalid_input');
    const zone4=options && options.zone4LengthMm!==undefined ? options.zone4LengthMm : DEFAULT_ZONE4_MM;
    if(!Number.isFinite(zone4) || zone4<=0) return fail('invalid_options');
    const collar=input.collarStatus===undefined ? 'unknown' : input.collarStatus;
    if(!['collared','collarless','unknown'].includes(collar)) return fail('invalid_collar_status');
    const s=input.mmPerPx;
    const d=sub(ax.distal,ax.proximal);
    if(norm(d)*s<=EPS) return fail('degenerate_stem_axis');
    let v={x:d.x/norm(d),y:d.y/norm(d)};
    if(dot(sub(input.tip,input.shoulder),v)<0) v={x:-v.x,y:-v.y}; // v always points distally
    const k=dot(sub(input.shoulder,ax.proximal),v);
    const origin={x:ax.proximal.x+v.x*k,y:ax.proximal.y+v.y*k};
    let n={x:-v.y,y:v.x};
    const lat=dot(sub(input.lateralRef,origin),n)*s;
    if(Math.abs(lat)<=EPS) return fail('lateral_reference_on_axis');
    if(lat<0) n={x:-n.x,y:-n.y}; // n always points laterally
    const L=dot(sub(input.tip,origin),v)*s;
    if(!(L>EPS)) return fail('degenerate_stem_length');
    let boneEnd=null;
    if(hasBoneEnd) {
      if(dot(sub(input.medialTop,origin),n)*s>EPS) return fail('medial_top_on_lateral_side');
      boneEnd=dot(sub(input.medialTop,origin),v)*s;
    }
    const medTop=baseline!==null ? baseline : boneEnd;
    if(!(medTop<L/3-EPS)) return fail(baseline!==null ? 'baseline_zone7_top_distal_to_zone7' : 'medial_top_distal_to_zone7');
    result.status='ok';
    result.params={zone4LengthMm:zone4,collarStatus:collar,zone7TopMm:baseline};
    result.frame={origin,vx:v.x+0,vy:v.y+0,nx:n.x+0,ny:n.y+0,mmPerPx:s,pxPerMm:1/s}; // +0 normalises -0 so the record survives JSON round-trips
    result.stemLengthMm=L;
    result.levelsMm={shoulder:0,third1:L/3,third2:2*L/3,tip:L,zone4End:L+zone4};
    result.medialTopMm=medTop;
    result.boneMedialEndMm=boneEnd;
    result.calcarShiftMm=baseline!==null && boneEnd!==null ? boneEnd-baseline : null;
    result.source.zone7Top=baseline!==null?'baseline_level_carried_over':'medial_end_of_osteotomy_line';
    return result;
  }

  /* Image point -> stem frame in mm: t = distance distal to the shoulder, s = distance lateral to the axis. */
  function toFrame(p, point) {
    const f=p.frame,q={x:point.x-f.origin.x,y:point.y-f.origin.y};
    return {t:(q.x*f.vx+q.y*f.vy)*f.mmPerPx,s:(q.x*f.nx+q.y*f.ny)*f.mmPerPx};
  }

  function zoneOf(p, t, s) {
    const lv=p.levelsMm;
    if(t>lv.tip+EPS) return t<=lv.zone4End+EPS ? 4 : null;
    if(Math.abs(s)<=EPS) return null; // exactly on the axis: neither medial nor lateral
    const third=t<lv.third1 ? 0 : (t<lv.third2 ? 1 : 2);
    if(s>0) return t< -EPS ? null : [1,2,3][third];
    return t<p.medialTopMm-EPS ? null : [7,6,5][third];
  }

  function classify(p, point) {
    if(!p || p.status!=='ok' || !finitePoint(point)) return null;
    const c=toFrame(p,point);
    return zoneOf(p,c.t,c.s);
  }

  function sideCrossings(paths, t) {
    const out={lateral:[],medial:[]};
    for(const path of paths) for(let i=1;i<path.length;i++) {
      const a=path[i-1],b=path[i],u=a.t-t,w=b.t-t;
      if((u>0&&w>0)||(u<0&&w<0)) continue;
      if(u===0&&w===0) continue; // segment lying on the section line carries no single crossing
      const sv=a.s+(b.s-a.s)*(u/(u-w));
      const list=sv>0?out.lateral:out.medial;
      if(Math.abs(sv)>EPS && !list.some(x=>Math.abs(x-sv)<=1e-6)) list.push(sv);
    }
    return out;
  }
  const single=list=>list.length===1?{value:Math.abs(list[0])}:{reason:list.length?'ambiguous':'missing'};

  /* Per-zone stem-to-endosteum gap and cortical thickness (mm), sampled on sections perpendicular to the stem axis.
   * contours = {stem:[polyline...], endosteal:[polyline...], outer:[polyline...]} in image pixels.
   * A section is skipped (and counted) when a needed contour is missing or crosses more than once on that side. */
  function measure(p, contours, options) {
    const out={schema:'gruen-zones-measure/v1',version:VERSION,status:'error',reason:null,stepMm:null,zones:null};
    if(!p || p.status!=='ok') {out.reason='invalid_partition';return out;}
    const step=options && options.stepMm!==undefined ? options.stepMm : 1;
    if(!Number.isFinite(step) || step<=0) {out.reason='invalid_options';return out;}
    const names=['stem','endosteal','outer'];
    if(!contours || !names.every(k=>Array.isArray(contours[k]) && contours[k].every(path=>Array.isArray(path)&&path.every(finitePoint)))) {out.reason='invalid_contours';return out;}
    const F={};for(const k of names) F[k]=contours[k].map(path=>path.map(q=>toFrame(p,q)));
    const lv=p.levelsMm;
    const ranges={1:['lateral',0,lv.third1],2:['lateral',lv.third1,lv.third2],3:['lateral',lv.third2,lv.tip],
      4:['both',lv.tip,lv.zone4End],5:['medial',lv.third2,lv.tip],6:['medial',lv.third1,lv.third2],7:['medial',p.medialTopMm,lv.third1]};
    const stat=()=>({n:0,sum:0,min:null,max:null});
    const push=(st,x)=>{st.n++;st.sum+=x;st.min=st.min===null?x:Math.min(st.min,x);st.max=st.max===null?x:Math.max(st.max,x);};
    const fin=st=>st.n?{n:st.n,meanMm:st.sum/st.n,minMm:st.min,maxMm:st.max}:{n:0,meanMm:null,minMm:null,maxMm:null};
    const zones={};
    for(const z of [1,2,3,4,5,6,7]) {
      const [side,a,b]=ranges[z],count=Math.max(1,Math.floor((b-a)/step+1e-9));
      const sides=side==='both'?['lateral','medial']:[side];
      const acc={};for(const sd of sides) acc[sd]={gap:stat(),cortex:stat(),skipped:{missing:0,ambiguous:0}};
      for(let i=0;i<count;i++) {
        const t=a+(i+0.5)*(b-a)/count;
        const c={};for(const k of names) c[k]=sideCrossings(F[k],t);
        for(const sd of sides) {
          const e=single(c.endosteal[sd]),o=single(c.outer[sd]);
          if(e.reason||o.reason) {acc[sd].skipped[e.reason||o.reason]++;continue;}
          if(z!==4) {
            const st=single(c.stem[sd]);
            if(st.reason) {acc[sd].skipped[st.reason]++;continue;}
            push(acc[sd].gap,e.value-st.value); // negative = stem edge drawn beyond the endosteal line
          }
          push(acc[sd].cortex,o.value-e.value);
        }
      }
      const pack=sd=>({sections:count,gap:z===4?null:fin(acc[sd].gap),cortex:fin(acc[sd].cortex),skipped:acc[sd].skipped});
      zones[z]=side==='both'?{side,fromMm:a,toMm:b,lateral:pack('lateral'),medial:pack('medial')}:Object.assign({side,fromMm:a,toMm:b},pack(side));
    }
    out.status='ok';out.stepMm=step;out.zones=zones;
    return out;
  }

  return {partition,classify,toFrame,measure,version:VERSION,DEFAULT_ZONE4_MM};
}));
