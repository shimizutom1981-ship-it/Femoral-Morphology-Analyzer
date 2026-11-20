// A private, display-only canvas: it never writes annotation or measurement state.
(()=>{
  const M=FmaCadOverlay,panel=$('cadView'),view=$('cadViewCanvas'),ctx=view.getContext('2d');
  const kinds={bone:['大腿骨','#39e5ff'],stem:['ステム','#ffd269'],cup:['カップ','#da96ff'],head:['ヘッド','#80acff']};
  const fields={cadViewRX:'rx',cadViewRY:'ry',cadViewRZ:'rz',cadViewDX:'dx',cadViewDY:'dy',cadViewScale:'scale',cadViewOpacity:'opacity'};
  let bound=null,epoch=0,items={},tokens={},notice='',queued=false;
  let shared=false;
  const source=()=>img&&!imageLoading&&!imageLoadFailed&&$('peProjection').value==='AP'&&$('rpDirection').value==='AP'?
    M.sourceKey(peHash,$('side').value,'AP'):null;
  const kind=()=>$('cadViewKind').value;
  const selected=()=>items[kind()];
  function clear(){
    drag=null;setViewport(1,0,0);
    shared=false;bound=null;epoch++;items={};tokens={};notice='';
    ctx.clearRect(0,0,view.width,view.height);
  }
  function binding(){const now=source();if(now!==bound){clear();bound=now;}return bound;}
  function canvasPixelsPerMm(){
    return .62*Math.min(cv.width,cv.height)*items.cup.pose.scale/items.cup.mesh.extentMm;
  }
  function paintLayer(item,color,w,h){
    const span=shared?canvasPixelsPerMm()*item.mesh.extentMm:null;
    const p=item.pose,key=JSON.stringify([w,h,p.rx,p.ry,p.rz,p.dx,p.dy,p.scale,span]);
    if(!item.canvas){item.canvas=document.createElement('canvas');item.canvas.width=w;item.canvas.height=h;}
    const canvas=item.canvas;
    if(item.maskKey===key)return canvas;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const c=canvas.getContext('2d');c.clearRect(0,0,w,h);c.fillStyle=color;
    const project=M.projection(p,w,h,span),v=item.mesh.xyz;
    if(item.mesh.sphere){
      const [cx,cy]=project(0,0,0),radius=(span??(.62*Math.min(w,h)*p.scale))/2;
      c.strokeStyle=color;c.lineWidth=2;c.beginPath();c.arc(cx,cy,radius,0,Math.PI*2);c.stroke();
    }else for(let i=0;i<v.length;i+=9){
      const [x0,y0]=project(v[i],v[i+1],v[i+2]),[x1,y1]=project(v[i+3],v[i+4],v[i+5]),[x2,y2]=project(v[i+6],v[i+7],v[i+8]);
      c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.lineTo(x2,y2);c.closePath();c.fill();
    }
    item.maskKey=key;return canvas;
  }
  function render(){
    if(!panel.open)return;
    const key=binding(),item=selected(),p=item?.pose||M.defaultPose(),status=$('cadViewStatus');
    for(const [id,name] of Object.entries(fields)){
      const e=$(id);e.disabled=!item||(shared&&name==='scale');e.value=String(p[name]);const o=$(id+'Val');
      o.textContent=['dx','dy','opacity'].includes(name)?(100*p[name]).toFixed(0)+'%':name==='scale'?(shared?'共通':p[name].toFixed(2)+'×'):p[name].toFixed(0)+'°';
    }
    for(const id of M.KINDS){
      const button=$('cadPick-'+id);
      button.disabled=!items[id];
      button.setAttribute('aria-pressed',String(!!items[id] && id===kind()));
    }
    for(const id of Object.keys(moves))$(id).disabled=!movable();
    $('cadViewLock').disabled=!items.cup;
    $('cadViewLock').textContent=shared?'共通倍率を解除':'カップの倍率を全CADに固定';
    $('cadViewCalibration').textContent=shared?'共通倍率 '+(canvasPixelsPerMm()*(img.naturalWidth||img.width)/cv.width).toFixed(3)+' px/mm（元画像）':'';
    $('cadViewHead').disabled=!key||!!items.head;
    $('cadViewVisible').disabled=!item;$('cadViewVisible').checked=p.visible;
    $('cadViewFile').disabled=!key;
    for(const id of ['cadViewReset','cadViewSave','cadViewRemove','cadViewForget'])$(id).disabled=!item;
    const w=cv.width,h=cv.height;if(view.width!==w||view.height!==h){view.width=w;view.height=h;}
    ctx.clearRect(0,0,w,h);
    if(!key){status.textContent='正面（AP）画像の読込完了を確認してください。画像照合ができない環境では利用できません。';return;}
    ctx.save();ctx.setTransform(zoom,0,0,zoom,-left*w*zoom,-top*h*zoom);
    ctx.drawImage(img,0,0,w,h);
    if($('cadViewMaster').checked)for(const id of M.KINDS){const a=items[id];if(!a?.pose.visible||a.pose.opacity===0)continue;
      ctx.save();ctx.globalAlpha=a.pose.opacity;ctx.drawImage(paintLayer(a,kinds[id][1],w,h),0,0);ctx.restore();
    }
    ctx.restore();
    const available=M.KINDS.filter(id=>items[id]).map(id=>kinds[id][0]);
    status.textContent=notice||(!available.length?'大腿骨・ステム・カップ・ヘッドから対象を選び、STL/OBJを開きます。':'読込済：'+available.join('／')+(item?.mesh.sphere?'（32 mm球）':item?'（選択 '+item.mesh.triangles.toLocaleString()+'三角形）':''));
  }
  function later(){if(queued||!panel.open)return;queued=true;requestAnimationFrame(()=>{queued=false;render();});}
  function persist(item,id,key){return item.mesh.sphere?'FMA_cad_display_v1:'+key+':head:nominal-32mm':M.storageKey(key,id,item.digest);}
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
      const next={mesh,digest,pose:M.defaultPose()};let restored=false,restoreLock=false;
      try{const q=JSON.parse(localStorage.getItem(persist(next,id,key))||'null');if(q?.version===1&&q.pose){next.pose=M.normalise(q.pose);restored=true;restoreLock=q.shared===true;}}catch(e){}
      if(id==='cup')shared=restoreLock;
      items[id]=next;notice=kinds[id][0]+'を読み込みました。'+(restored?'端末内の表示設定を復元しました。':'');
    }catch(e){if(current())notice=e.message||'読込に失敗しました。';}later();
  };
  for(const [id,name] of Object.entries(fields))$(id).oninput=e=>{const q=selected();if(!binding()||!q||q!==selected()||(shared&&name==='scale'))return;q.pose=M.normalise({...q.pose,[name]:Number(e.target.value)});notice='';later();};
  $('cadViewVisible').onchange=e=>{if(binding()&&selected())selected().pose.visible=e.target.checked;later();};
  $('cadViewLock').onclick=()=>{if(!binding()||!items.cup)return;shared=!shared;notice='';render();};
  $('cadViewHead').onclick=()=>{
    if(!binding()||items.head)return;
    const pose=M.defaultPose(),cup=items.cup;
    if(cup){pose.dx=cup.pose.dx;pose.dy=cup.pose.dy;pose.scale=M.normalise({scale:cup.pose.scale*32/cup.mesh.extentMm}).scale;}
    const head={mesh:{sphere:true,extentMm:32,triangles:0},digest:'nominal-32mm',pose};
    try{const saved=JSON.parse(localStorage.getItem(persist(head,'head',bound)));if(saved?.version===1)head.pose=M.normalise(saved.pose);}catch(e){}
    items.head=head;$('cadViewKind').value='head';notice='32 mmヘッドの中心をX線に合わせてください。';render();
  };
  const moves={cadLeft:[-1,0],cadRight:[1,0],cadUp:[0,-1],cadDown:[0,1]};
  function movable(){
    return binding() && $('cadViewMaster').checked && selected()?.pose.visible && selected().pose.opacity>0;
  }
  function translate(item,dx,dy){
    item.pose=M.normalise({...item.pose,dx:item.pose.dx+dx,dy:item.pose.dy+dy});
    notice='';later();
  }
  for(const [id,[x,y]] of Object.entries(moves)){
    $(id).onclick=()=>{
      if(movable())translate(selected(),x/img.naturalWidth,y/img.naturalHeight);
    };
  }
  let zoom=1, left=0, top=0, drag=null;
  function setViewport(scale,x,y){
    zoom=scale;
    left=Math.max(0,Math.min(1-1/zoom,x));
    top=Math.max(0,Math.min(1-1/zoom,y));
    $('cadZoomLevel').textContent=Math.round(zoom*100)+'%';
    later();
  }
  function zoomAt(scale,x=.5,y=.5){
    const next=Math.min(8,Math.max(1,scale));
    setViewport(next,left+x*(1/zoom-1/next),top+y*(1/zoom-1/next));
  }
  $('cadZoomIn').onclick=()=>zoomAt(zoom*1.25);
  $('cadZoomOut').onclick=()=>zoomAt(zoom/1.25);
  $('cadZoomReset').onclick=()=>setViewport(1,0,0);
  view.addEventListener('wheel',event=>{
    if(!binding() || !event.deltaY)return;
    event.preventDefault();
    const rect=view.getBoundingClientRect();
    zoomAt(zoom*(event.deltaY<0?1.15:1/1.15),(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);
  },{passive:false});
  function pickAtPointer(event){
    if(!$('cadViewMaster').checked)return;
    const rect=view.getBoundingClientRect();
    const x=Math.floor((left+(event.clientX-rect.left)/rect.width/zoom)*view.width);
    const y=Math.floor((top+(event.clientY-rect.top)/rect.height/zoom)*view.height);
    if(x<0 || y<0 || x>=view.width || y>=view.height)return;
    const order=[kind(),...M.KINDS.slice().reverse().filter(id=>id!==kind())];
    for(const id of order){
      const item=items[id];
      if(!item?.pose.visible || !item.pose.opacity || !item.canvas)continue;
      if(item.canvas.getContext('2d').getImageData(x,y,1,1).data[3]){
        $('cadViewKind').value=id;
        notice='';
        later();
        return;
      }
    }
  }
  for(const id of M.KINDS){
    $('cadPick-'+id).onclick=()=>{
      if(!binding() || !items[id])return;
      $('cadViewKind').value=id;
      $('cadViewMaster').checked=true;
      items[id].pose.visible=true;
      if(!items[id].pose.opacity)items[id].pose.opacity=M.defaultPose().opacity;
      notice='';render();
    };
  }
  view.addEventListener('pointerdown',event=>{
    if(drag || event.button!==0 || !binding())return;
    if(event.shiftKey)pickAtPointer(event);
    if(event.shiftKey ? !movable() : zoom===1)return;
    drag={pointer:event.pointerId,item:event.shiftKey?selected():null,x:event.clientX,y:event.clientY};
    view.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  function track(event){
    if(!drag || drag.pointer!==event.pointerId)return;
    const dx=(event.clientX-drag.x)/(view.clientWidth*zoom);
    const dy=(event.clientY-drag.y)/(view.clientHeight*zoom);
    if(!Number.isFinite(dx)||!Number.isFinite(dy))return;
    if(drag.item){
      if(!movable() || selected()!==drag.item){drag=null;return;}
      translate(drag.item,dx,dy);
    }else setViewport(zoom,left-dx,top-dy);
    drag.x=event.clientX;drag.y=event.clientY;
  }
  view.addEventListener('pointermove',track);
  view.addEventListener('pointerup',event=>{
    track(event);
    if(drag?.pointer===event.pointerId)drag=null;
  });
  for(const name of ['pointercancel','lostpointercapture']){
    view.addEventListener(name,event=>{if(drag?.pointer===event.pointerId)drag=null;});
  }
  $('cadViewMaster').onchange=later;
  $('cadViewKind').onchange=()=>{notice='';render();};
  $('cadViewReset').onclick=()=>{if(!binding()||!selected())return;const p=selected().pose;selected().pose={...M.defaultPose(),scale:shared?p.scale:1,opacity:p.opacity,visible:p.visible};notice=shared?'位置と回転をリセットしました。':'回転・位置・倍率をリセットしました。';later();};
  $('cadViewSave').onclick=()=>{const key=binding(),id=kind(),q=selected();if(!key||!q)return;try{
    localStorage.setItem(persist(q,id,key),JSON.stringify({version:1,pose:q.pose,shared:id==='cup'&&shared}));notice='この画像・CADの表示設定だけを端末内に保存しました。';
  }catch(e){notice='端末内に保存できませんでした。';}later();};
  $('cadViewForget').onclick=()=>{const key=binding(),id=kind(),q=selected();if(!key||!q)return;try{
    localStorage.removeItem(persist(q,id,key));notice='端末内の表示設定を削除しました。現在の表示はそのままです。';
  }catch(e){notice='端末内の表示設定を削除できませんでした。';}later();};
  $('cadViewRemove').onclick=()=>{if(!binding()||!selected())return;const id=kind();tokens[id]=(tokens[id]||0)+1;if(id==='cup')shared=false;delete items[id];notice='この重ね合わせ表示を外しました。';later();};
  panel.addEventListener('toggle',render);
  const beforeFile=$('file').onchange;$('file').onchange=function(e){if(e.target.files?.[0]){clear();later();}return beforeFile.call(this,e);};
  const before=draw;draw=function(){before();binding();later();};
  for(const id of ['side','peProjection','rpDirection'])$(id).addEventListener('change',()=>{binding();later();});
})();
