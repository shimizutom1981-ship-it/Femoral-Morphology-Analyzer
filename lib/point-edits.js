(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FmaPointEdits=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SCHEMA='fma_point_edits_v1';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  function source(s){
    if(!s||!['width','height','canvas_width','canvas_height'].every(k=>Number.isSafeInteger(s[k])&&s[k]>0)||!/^\w{64}$/.test(s.sha256||'')||!/^[a-f0-9]+$/i.test(s.sha256))throw Error('元画像の照合情報が不足しています');
    return s;
  }
  function original(p,s){source(s);if(!point(p))throw Error('点座標が不正です');return{x:p.x*s.width/s.canvas_width,y:p.y*s.height/s.canvas_height};}
  function canvas(p,s){source(s);if(!point(p))throw Error('点座標が不正です');return{x:p.x*s.canvas_width/s.width,y:p.y*s.canvas_height/s.height};}
  function assertSame(a,b){source(a);source(b);for(const k of ['sha256','width','height','canvas_width','canvas_height'])if(a[k]!==b[k])throw Error('元画像が一致しません。点修正は適用していません');}
  function create(s,id){source(s);return{schema:SCHEMA,record_id:id,revision:0,source:clone(s),projection:'AP',reviews:{},events:[],scientific_repeat_incremented:false};}
  function validate(s){
    if(!s||s.schema!==SCHEMA||typeof s.record_id!=='string'||!s.record_id||!Number.isSafeInteger(s.revision)||s.revision<0||!['AP','LAUENSTEIN','AXIAL'].includes(s.projection)||!Array.isArray(s.events)||!s.reviews||typeof s.reviews!=='object'||Array.isArray(s.reviews))throw Error('点修正記録の形式が不正です');
    source(s.source);
    for(const e of s.events)if(!e||!Number.isSafeInteger(e.revision)||e.revision<1||e.revision>s.revision||typeof e.action!=='string'||typeof e.timestamp!=='string'||(e.before_original!=null&&!point(e.before_original))||(e.after_original!=null&&!point(e.after_original)))throw Error('点修正履歴が不正です');
    for(const r of Object.values(s.reviews))if(!r||typeof r.key!=='string'||typeof r.timestamp!=='string')throw Error('確認記録が不正です');
    return s;
  }
  function append(s,event){validate(s);s.revision++;s.events.push({...clone(event),revision:s.revision});return s;}
  function review(s,scope,value,actor,time){s.reviews[scope]={key:JSON.stringify(value),actor:actor||null,timestamp:time};}
  function reviewed(s,scope,value){return !!s?.reviews?.[scope]&&s.reviews[scope].key===JSON.stringify(value);}
  function impact(key){
    if(key==='ltm')return['骨軸・断面位置','CFR・皮質厚','経時比較'];
    if(key.startsWith('head'))return['倍率','骨軸・断面位置','距離・CFR・皮質厚'];
    if(key==='rp_proximal'||key==='stem_tip')return['101点の計測範囲','CFR・皮質厚の区間要約'];
    if(key==='stem_prox'||key==='stem_dist')return['ステム軸・アライメント'];
    return['経時比較'];
  }
  return{schema:SCHEMA,clone,point,source,original,canvas,assertSame,create,validate,append,review,reviewed,impact};
});
