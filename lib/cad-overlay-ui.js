// A private, display-only canvas: it never writes annotation or measurement state.
(()=>{
  const M=FmaCadOverlay,panel=$('cadView'),view=$('cadViewCanvas'),ctx=view.getContext('2d');
  const kinds={bone:['大腿骨','#39e5ff'],stem:['ステム','#ffd269'],cup:['カップ','#da96ff']};
  const fields={cadViewRX:'rx',cadViewRY:'ry',cadViewRZ:'rz',cadViewDX:'dx',cadViewDY:'dy',cadViewScale:'scale',cadViewOpacity:'opacity'};
  let bound=null,epoch=0,items={},tokens={},notice='',queued=false;
  const source=()=>img&&!imageLoading&&!imageLoadFailed&&$('peProjection').value==='AP'&&$('rpDirection').value==='AP'?
    M.sourceKey(peHash,$('side').value,'AP'):null;
  const kind=()=>$('cadViewKind').value;
  const selected=()=>items[kind()];
  function clear(){
    bound=null;epoch++;items={};tokens={};notice='';
    ctx.clearRect(0,0,view.width,view.height);
  }
  function binding(){const now=source();if(now!==bound){clear();bound=now;}return bound;}
  function paintLayer(item,color,w,h){
    const p=item.pose,key=JSON.stringify([w,h,p.rx,p.ry,p.rz,p.dx,p.dy,p.scale]);
    if(!item.canvas){item.canvas=document.createElement('canvas');item.canvas.width=w;item.canvas.height=h;}
    const canvas=item.canvas;
    if(item.maskKey===key)return canvas;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const c=canvas.getContext('2d');c.clearRect(0,0,w,h);c.fillStyle=color;
    const project=M.projection(p,w,h),v=item.mesh.xyz;
    for(let i=0;i<v.length;i+=9){
      const [x0,y0]=project(v[i],v[i+1],v[i+2]),[x1,y1]=project(v[i+3],v[i+4],v[i+5]),[x2,y2]=project(v[i+6],v[i+7],v[i+8]);
      c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.lineTo(x2,y2);c.closePath();c.fill();
    }
    item.maskKey=key;return canvas;
  }
  function render(){
    if(!panel.open)return;
    const key=binding(),item=selected(),p=item?.pose||M.defaultPose(),status=$('cadViewStatus');
    for(const [id,name] of Object.entries(fields)){
      const e=$(id);e.disabled=!item;e.value=String(p[name]);const o=$(id+'Val');
      o.textContent=['dx','dy','opacity'].includes(name)?(100*p[name]).toFixed(0)+'%':name==='scale'?p[name].toFixed(2)+'×':p[name].toFixed(0)+'°';
    }
    $('cadViewVisible').disabled=!item;$('cadViewVisible').checked=p.visible;
    $('cadViewFile').disabled=!key;
    for(const id of ['cadViewReset','cadViewSave','cadViewRemove','cadViewForget'])$(id).disabled=!item;
    const w=cv.width,h=cv.height;if(view.width!==w||view.height!==h){view.width=w;view.height=h;}
    ctx.clearRect(0,0,w,h);
    if(!key){status.textContent='正面（AP）画像の読込完了を確認してください。画像照合ができない環境では利用できません。';return;}
    ctx.drawImage(img,0,0,w,h);
    if($('cadViewMaster').checked)for(const id of M.KINDS){const a=items[id];if(!a?.pose.visible||a.pose.opacity===0)continue;
      ctx.save();ctx.globalAlpha=a.pose.opacity;ctx.drawImage(paintLayer(a,kinds[id][1],w,h),0,0);ctx.restore();
    }
    const available=M.KINDS.filter(id=>items[id]).map(id=>kinds[id][0]);
    status.textContent=notice||(!available.length?'大腿骨・ステム・カップから対象を選び、STL/OBJを開きます。':'読込済：'+available.join('／')+(item?'（選択 '+item.mesh.triangles.toLocaleString()+'三角形）':''));
  }
  function later(){if(queued||!panel.open)return;queued=true;requestAnimationFrame(()=>{queued=false;render();});}
  function persist(item,id,key){return M.storageKey(key,id,item.digest);}
  $('cadViewFile').onchange=async e=>{
    const f=e.target.files?.[0],key=binding(),id=kind(),gen=epoch,request=(tokens[id]||0)+1;e.target.value='';if(!f)return;
    tokens[id]=request;const current=()=>gen===epoch&&request===tokens[id]&&key===binding();
    try{
      if(!key)throw Error('先に正面（AP）画像を選んでください。');
      if(f.size>M.LIMIT_BYTES)throw Error('CADは25 MB以下のSTLまたはOBJを選んでください。');
      const bytes=await f.arrayBuffer();
      if(!current())return;
      const mesh=M.parse(f.name,bytes),hash=await crypto.subtle.digest('SHA-256',bytes);
      if(!current())return;
      const digest=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
      const next={mesh,digest,pose:M.defaultPose()};let restored=false;
      try{const q=JSON.parse(localStorage.getItem(persist(next,id,key))||'null');if(q?.version===1&&q.pose){next.pose=M.normalise(q.pose);restored=true;}}catch(e){}
      items[id]=next;notice=kinds[id][0]+'を読み込みました。'+(restored?'端末内の表示設定を復元しました。':'');
    }catch(e){if(current())notice=e.message||'読込に失敗しました。';}later();
  };
  for(const [id,name] of Object.entries(fields))$(id).oninput=e=>{const q=selected();if(!binding()||!q||q!==selected())return;q.pose=M.normalise({...q.pose,[name]:Number(e.target.value)});notice='';later();};
  $('cadViewVisible').onchange=e=>{if(binding()&&selected())selected().pose.visible=e.target.checked;later();};
  $('cadViewMaster').onchange=later;
  $('cadViewKind').onchange=()=>{notice='';render();};
  $('cadViewReset').onclick=()=>{if(!binding()||!selected())return;const p=selected().pose;selected().pose={...M.defaultPose(),opacity:p.opacity,visible:p.visible};notice='回転・位置・倍率をリセットしました。';later();};
  $('cadViewSave').onclick=()=>{const key=binding(),id=kind(),q=selected();if(!key||!q)return;try{
    localStorage.setItem(persist(q,id,key),JSON.stringify({version:1,pose:q.pose}));notice='この画像・CADの表示設定だけを端末内に保存しました。';
  }catch(e){notice='端末内に保存できませんでした。';}later();};
  $('cadViewForget').onclick=()=>{const key=binding(),id=kind(),q=selected();if(!key||!q)return;try{
    localStorage.removeItem(persist(q,id,key));notice='端末内の表示設定を削除しました。現在の表示はそのままです。';
  }catch(e){notice='端末内の表示設定を削除できませんでした。';}later();};
  $('cadViewRemove').onclick=()=>{if(!binding()||!selected())return;const id=kind();tokens[id]=(tokens[id]||0)+1;delete items[id];notice='この重ね合わせ表示を外しました。';later();};
  panel.addEventListener('toggle',render);
  const beforeFile=$('file').onchange;$('file').onchange=function(e){if(e.target.files?.[0]){clear();later();}return beforeFile.call(this,e);};
  const before=draw;draw=function(){before();binding();later();};
  for(const id of ['side','peProjection','rpDirection'])$(id).addEventListener('change',()=>{binding();later();});
})();
