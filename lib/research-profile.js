/* Research output candidate. Pure geometry and local export; no patient data/network. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FmaResearch = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.0.0-candidate', SCHEMA = 'fma_research_profile_v1';
  const REGIONS = {PROX:[0,33],MID:[34,66],DIST:[67,100]};
  const EPS = 1e-7, sides = ['MED','LAT'];
  const copy = x => JSON.parse(JSON.stringify(x));
  const finite = Number.isFinite;
  const point = p => p && finite(p.x) && finite(p.y);
  const text = x => typeof x === 'string' && x.trim().length > 0;
  const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
  function dateOK(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s||'') && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s; }
  function validateSettings(s) {
    if (!s || s.schema!=='fma_research_settings_v1') throw Error('研究設定の形式が不正です');
    if (s.proximal!=null && !point(s.proximal)) throw Error('近位0%点が不正です');
    if (!Array.isArray(s.exclusions) || s.exclusions.length>1000) throw Error('欠測区間が不正です');
    for (const r of s.exclusions) if (!point(r.from) || !point(r.to) || !['ALL',...sides].includes(r.side) || !['ALL','outer','inner','stem'].includes(r.boundary||'ALL') || !text(r.reason)) throw Error('欠測区間の点・側・理由が不正です');
    if (!s.fields || typeof s.fields!=='object' || Array.isArray(s.fields) || Object.values(s.fields).some(v=>typeof v!=='string')) throw Error('研究設定の文字列項目が不正です');
    if (s.confirmation!=null && (!text(s.confirmation.key) || !dateOK(s.confirmation.date))) throw Error('研究設定の確認記録が不正です');
    return true;
  }
  function validate(input, requireReview=true) {
    if (!input || input.direction!=='AP') throw Error('軸位の計測規約は未確定です。研究出力はAPのみ対応します');
    if (!['R','L'].includes(input.side)) throw Error('左右が未設定です');
    const a=input.axis,g=a?.geometry;
    if (a?.status!=='ok' || a.quality_status!=='confirmed' || a.lt_confirmed!==true || !text(a.method) || !text(a.version)) throw Error('骨軸・LTを確認してください');
    if (!point(g?.lt) || ![g.vx,g.vy,g.mmPerPx].every(finite) || g.mmPerPx<=0 || Math.abs(Math.hypot(g.vx,g.vy)-1)>1e-6) throw Error('骨軸または校正が不正です');
    if (a.levels?.proximalMm!==10 || ![80,90,100].includes(a.levels?.distalMm)) throw Error('AP骨軸の高さが不正です');
    if (!point(input.range?.proximal) || !point(input.range?.tip)) throw Error('近位0%点とステム先端を指定してください');
    if (requireReview && input.reviewed!==true) throw Error('区間・輪郭・欠測範囲を確認してください');
    if (!input.contours || typeof input.contours!=='object') throw Error('輪郭がありません');
    for (const s of sides) for (const key of ['outer','inner','stem']) {
      const p=input.contours[s]?.[key];
      if (!Array.isArray(p) || !p.every(point)) throw Error('輪郭座標が不正です: '+s+'/'+key);
    }
    if (!Array.isArray(input.exclusions)) throw Error('欠測区間が不正です');
    for (const r of input.exclusions) if (![r.from_mm,r.to_mm].every(finite) || r.from_mm>r.to_mm || !['ALL',...sides].includes(r.side) || !['ALL','outer','inner','stem'].includes(r.boundary||'ALL') || !text(r.reason)) throw Error('欠測区間が不正です');
    const start=boneMm(input,input.range.proximal),end=boneMm(input,input.range.tip);
    if (!finite(start)||!finite(end)||!finite(end-start)||end-start<=EPS) throw Error('近位点から先端への区間が不正です');
    if(input.calibration && (!finite(input.calibration.known_mm)||input.calibration.known_mm<=0||!finite(input.calibration.mm_per_px)||Math.abs(input.calibration.mm_per_px-g.mmPerPx)>1e-10)) throw Error('骨軸と校正の尺度が一致しません');
    return {start,end};
  }
  function boneMm(input,p) { const g=input.axis.geometry; return ((p.x-g.lt.x)*g.vx+(p.y-g.lt.y)*g.vy)*g.mmPerPx; }
  function frame(input,p) {
    const g=input.axis.geometry, sign=input.side==='R'?1:-1;
    return {t:boneMm(input,p),s:((p.x-g.lt.x)*(-g.vy)+(p.y-g.lt.y)*g.vx)*g.mmPerPx*sign};
  }
  function crossing(input,path,level) {
    const hits=[];
    for (let i=1;i<path.length;i++) {
      const a=frame(input,path[i-1]),b=frame(input,path[i]),da=a.t-level,db=b.t-level;
      if(![a.t,a.s,b.t,b.s,da,db].every(finite))return {value:null,point:null,reason:'numerical_input_failure'};
      if (Math.abs(da)<EPS && Math.abs(db)<EPS) {
        if (Math.abs(a.s-b.s)>EPS) return {value:null,point:null,reason:'collinear_boundary'};
        if (!hits.some(x=>Math.abs(x.value-a.s)<EPS)) hits.push({value:a.s,point:copy(path[i-1])});
        continue;
      }
      if ((da>EPS&&db>EPS)||(da< -EPS&&db< -EPS)) continue;
      const den=da-db;if (Math.abs(den)<Number.EPSILON) continue;
      const u=da/den;if(u< -EPS||u>1+EPS)continue;
      const f=Math.max(0,Math.min(1,u)),v=a.s+(b.s-a.s)*f;
      const p={x:path[i-1].x+(path[i].x-path[i-1].x)*f,y:path[i-1].y+(path[i].y-path[i-1].y)*f};
      if(!hits.some(x=>Math.abs(x.value-v)<EPS))hits.push({value:v,point:p});
    }
    return hits.length===1 ? {...hits[0],reason:null} : {value:null,point:null,reason:hits.length?'multiple_crossings':'no_crossing'};
  }
  function sampleAt(input,level,pct) {
    const hit={},reasons={},values={},warnings=[];
    for (const side of sides) {
      hit[side]={};
      const ex=input.exclusions.filter(r=>(r.side===side||r.side==='ALL')&&level>=r.from_mm-EPS&&level<=r.to_mm+EPS);
      for (const key of ['outer','inner','stem']) {
        const missing=ex.filter(x=>!x.boundary||x.boundary==='ALL'||x.boundary===key);
        hit[side][key]=missing.length ? {value:null,point:null,reason:'excluded:'+missing.map(x=>x.reason).join('|')} : crossing(input,input.contours[side][key],level);
      }
      const o=hit[side].outer,i=hit[side].inner,s=hit[side].stem,sgn=side==='MED'?-1:1;
      const ct=(o.value-i.value)*sgn,gap=(i.value-s.value)*sgn;
      const r=o.reason||i.reason||(ct< -EPS?'outer_inner_order':null);
      values[side+'_cortex_mm']=r?null:Math.max(0,ct); reasons[side+'_cortex_mm']=r;
      reasons[side+'_gap_mm']=i.reason||s.reason;
      values[side+'_gap_mm']=reasons[side+'_gap_mm']?null:gap;
      if(!reasons[side+'_gap_mm']&&gap< -EPS)warnings.push(side+'_stem_outside_endosteal_boundary');
    }
    for (const [name,key]of [['canal_width_mm','inner'],['outer_width_mm','outer'],['stem_width_mm','stem']]) {
      const a=hit.MED[key],b=hit.LAT[key],w=b.value-a.value;
      const bad=key==='stem'?w< -EPS:w<=EPS;
      reasons[name]=a.reason||b.reason||(bad?'medial_lateral_order_or_zero_width':null);
      values[name]=reasons[name]?null:Math.max(0,w);
    }
    reasons.cfr_pct=reasons.canal_width_mm||reasons.stem_width_mm;
    values.cfr_pct=reasons.cfr_pct?null:100*values.stem_width_mm/values.canal_width_mm;
    if(!reasons.cfr_pct&&!finite(values.cfr_pct)){values.cfr_pct=null;reasons.cfr_pct='numerical_ratio_failure';}
    reasons.cti=reasons.outer_width_mm||reasons.canal_width_mm||reasons.MED_cortex_mm||reasons.LAT_cortex_mm;
    values.cti=reasons.cti?null:(values.outer_width_mm-values.canal_width_mm)/values.outer_width_mm;
    const g=input.axis.geometry;
    return {s_pct:pct,bone_mm:level,axis_point_px:{x:g.lt.x+g.vx*level/g.mmPerPx,y:g.lt.y+g.vy*level/g.mmPerPx},...values,missing_reasons:reasons,warnings,intersections:hit};
  }
  function summarize(samples,key,side,region,code,unit) {
    const [a,b]=REGIONS[region],rows=samples.filter(x=>x.s_pct>=a&&x.s_pct<=b),n=b-a+1;
    const valid=rows.filter(x=>finite(x[key])),needed=Math.ceil(n*.9),ok=valid.length>=needed;
    return {code,side,region,unit,value:ok?mean(valid.map(x=>x[key])):null,valid_n:valid.length,expected_n:n,coverage:valid.length/n,complete:valid.length===n,status:ok?'SINGLE_OK':'UNMEASURABLE',reason:ok?null:'coverage_below_90_percent'};
  }
  function profile(input) {
    const {start,end}=validate(input),samples=Array.from({length:101},(_,i)=>sampleAt(input,start+(end-start)*i/100,i)),summaries=[];
    for(const region of Object.keys(REGIONS))summaries.push(summarize(samples,'cfr_pct','ALL',region,'cfr_mean','%'));
    const p=summaries[0],d=summaries[2],ok=p.value!==null&&d.value!==null;
    summaries.push({code:'cfr_dist_minus_prox',side:'ALL',region:'ALL',unit:'pp',value:ok?d.value-p.value:null,valid_n:p.valid_n+d.valid_n,expected_n:68,coverage:(p.valid_n+d.valid_n)/68,complete:p.complete&&d.complete,status:ok?'SINGLE_OK':'UNMEASURABLE',reason:ok?null:'proximal_or_distal_coverage_below_90_percent'});
    for(const side of sides)for(const region of Object.keys(REGIONS))summaries.push(summarize(samples,side+'_cortex_mm',side,region,'cortex_mean_mm','mm'));
    return {schema:SCHEMA,version:VERSION,accuracy_validated:false,direction:'AP',sampling_step_pct:1,point_count:101,range_mm:{start,end},units:{cfr:'%',cortex:'mm',gap:'mm',cti:'ratio',bone_position:'mm'},input:copy(input),samples,summaries};
  }
  function identityErrors(m) {
    const errors=[];
    for(const k of ['record_id','research_id','surgery_key','image_id','observer_id','boundary_rule_version','source_image_ref','annotation_ref','output_ref'])if(!text(m?.[k]))errors.push(k);
    if(!Number.isInteger(m?.repeat_index)||m.repeat_index<1)errors.push('repeat_index');
    if(!['EARLY','M3','M12'].includes(m?.timepoint))errors.push('timepoint');
    if(!dateOK(m?.acquisition_date))errors.push('acquisition_date');
    if(!dateOK(m?.confirmed_date))errors.push('confirmed_date');
    if(dateOK(m?.acquisition_date)&&dateOK(m?.confirmed_date)&&m.confirmed_date<m.acquisition_date)errors.push('confirmed_date_before_image');
    return errors;
  }
  function current(p) {
    if(p?.schema!==SCHEMA||p.version!==VERSION)throw Error('同じ研究計算版のJSONを選択してください');
    // Recompute from stored geometry; never trust editable stored summaries.
    const r=profile(p.input),errors=identityErrors(r.input.metadata);
    if(errors.length)throw Error('記録情報が不足または不正です: '+errors.join(', '));
    return r;
  }
  function compare(baseline,followup,options) {
    const a=current(baseline),b=current(followup),x=a.input.metadata,y=b.input.metadata;
    if(options?.pairConfirmed!==true)throw Error('同じ骨位置・左右・撮影肢位・比較可能範囲を確認してください');
    if(x.record_id===y.record_id || x.research_id!==y.research_id||x.surgery_key!==y.surgery_key||a.input.side!==b.input.side)throw Error('研究ID・手術キー・左右・記録IDを確認してください');
    if(x.timepoint!=='EARLY'||y.timepoint!=='M12'||y.acquisition_date<=x.acquisition_date)throw Error('早期APと後日の12か月APを指定してください');
    const aa=a.input.axis,bb=b.input.axis;
    if(aa.method!==bb.method||aa.version!==bb.version||aa.levels.proximalMm!==bb.levels.proximalMm||aa.levels.distalMm!==bb.levels.distalMm||x.boundary_rule_version!==y.boundary_rule_version)throw Error('骨軸の方式・版・高さまたは境界規約版が一致しません');
    const samples=a.samples.map(s=>{
      const t=sampleAt(b.input,s.bone_mm,s.s_pct),out={s_pct:s.s_pct,bone_mm:s.bone_mm,baseline:s,followup:t,missing_reasons:{}};
      for(const side of sides){const key=side+'_cortex_mm',r=s.missing_reasons[key]||t.missing_reasons[key];out[side+'_delta_mm']=r?null:t[key]-s[key];out.missing_reasons[side+'_delta_mm']=r;}
      return out;
    }),summaries=[];
    for(const side of sides)for(const region of Object.keys(REGIONS)){
      const s=summarize(samples,side+'_delta_mm',side,region,'cortex_delta_mm','mm');if(s.status==='SINGLE_OK')s.status='LONG_OK';summaries.push(s);
      const [lo,hi]=REGIONS[region],paired=samples.filter(r=>r.s_pct>=lo&&r.s_pct<=hi&&finite(r[side+'_delta_mm']));
      const base=mean(paired.map(r=>r.baseline[side+'_cortex_mm'])),follow=mean(paired.map(r=>r.followup[side+'_cortex_mm']));
      const ok=s.value!==null&&options.relativeBaselineConfirmed===true&&base>0;
      summaries.push({...s,code:'cortex_delta_pct',unit:'%',value:ok?100*(follow-base)/base:null,status:ok?'LONG_OK':'UNMEASURABLE',reason:ok?null:s.reason||(options.relativeBaselineConfirmed!==true?'baseline_relative_change_not_confirmed':'baseline_not_positive'),paired_baseline_mean_mm:base,paired_followup_mean_mm:follow});
    }
    return {schema:'fma_research_cortex_pair_v1',version:VERSION,accuracy_validated:false,reference:'baseline_LT_bone_mm',pair_confirmed:true,relative_baseline_confirmed:options.relativeBaselineConfirmed===true,baseline:a,followup:b,samples,summaries};
  }
  const IMAGE_HEADERS=['計測記録ID','研究ID','手術キー','画像ID','方向','時点','撮影日','画像状態','原画像参照','注釈・確定輪郭参照','FMA出力参照','計算版','境界規約版','AI初期候補版','測定者','確定日','反復番号','採用状態','確認事項'];
  const METRIC_HEADERS=['指標記録ID','研究ID','手術キー','基準計測記録ID','追跡計測記録ID','方向','指標コード','側','区間','数値','判定','単位','評価状態','有効点数','規定点数','被覆率','理由','出力参照','計算版','反復番号','採用状態','確認日','骨軸区分'];
  function imageRow(p) {
    const m=p.input.metadata;
    return [m.record_id,m.research_id,m.surgery_key,m.image_id,'AP',m.timepoint,m.acquisition_date,'PRESENT',m.source_image_ref,m.annotation_ref,m.output_ref,VERSION,m.boundary_rule_version,m.ai_model_version||'UNKNOWN',m.observer_id,m.confirmed_date,m.repeat_index,'PENDING','研究出力候補・画像採用と臨床精度は別途確認'];
  }
  function metricRows(summaries,a,b,ref) {
    const m=a.input.metadata,n=b?.input.metadata;
    if(n&&m.repeat_index!==n.repeat_index)throw Error('ペアの反復番号が一致しません');
    return summaries.map(s=>[[m.record_id,n?.record_id||'single',s.code,s.side,s.region].map(encodeURIComponent).join('__'),m.research_id,m.surgery_key,m.record_id,n?.record_id||'','AP',s.code,s.side,s.region,s.value??'', '',s.unit,s.status,s.valid_n,s.expected_n,s.coverage,s.reason||'',ref,VERSION,m.repeat_index,'PENDING',n?.confirmed_date||m.confirmed_date,'AP_10_'+a.input.axis.levels.distalMm]);
  }
  function registry(p,options={}) {
    if(p?.schema==='fma_research_cortex_pair_v1'){
      const r=compare(p.baseline,p.followup,{pairConfirmed:p.pair_confirmed,relativeBaselineConfirmed:p.relative_baseline_confirmed});
      if(!text(options.outputRef))throw Error('経時比較出力の保存先参照が必要です');
      return {images:[IMAGE_HEADERS,imageRow(r.baseline),imageRow(r.followup)],metrics:[METRIC_HEADERS,...metricRows(r.summaries,r.baseline,r.followup,options.outputRef)]};
    }
    const r=current(p);
    return {images:[IMAGE_HEADERS,imageRow(r)],metrics:[METRIC_HEADERS,...metricRows(r.summaries,r,null,r.input.metadata.output_ref)]};
  }
  function csv(rows) {
    // All strings are literal; prevent spreadsheet formula interpretation. Numeric values stay numeric.
    const cell=v=>{let s=v==null?'':String(v);if(typeof v==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
  }
  function profileCsv(p) {
    const r=current(p),m=r.input.metadata;
    const heads=['record_id','research_id','surgery_key','image_id','direction','timepoint','acquisition_date','side','calculation_version','s_pct','bone_mm','cfr_pct','MED_cortex_mm','LAT_cortex_mm','MED_gap_mm','LAT_gap_mm','outer_width_mm','canal_width_mm','stem_width_mm','cti_ratio','missing_reasons_json','warnings_json'];
    return csv([heads,...r.samples.map(s=>[m.record_id,m.research_id,m.surgery_key,m.image_id,'AP',m.timepoint,m.acquisition_date,r.input.side,VERSION,s.s_pct,s.bone_mm,s.cfr_pct,s.MED_cortex_mm,s.LAT_cortex_mm,s.MED_gap_mm,s.LAT_gap_mm,s.outer_width_mm,s.canal_width_mm,s.stem_width_mm,s.cti,JSON.stringify(s.missing_reasons),JSON.stringify(s.warnings)])]);
  }
  return {version:VERSION,schema:SCHEMA,regions:REGIONS,validate,validateSettings,boneMm,sampleAt,profile,compare,registry,csv,profileCsv,identityErrors,dateOK};
}));
