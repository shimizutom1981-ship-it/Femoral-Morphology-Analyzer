// Source-bound preview and atomic transfer of the four implant-side landmarks.
(()=>{
  const panel=$('stemCadPanel'),canvas=$('stemCadCanvas');
  const controls=['stemCadAxial','stemCadFlex','stemCadCoronal'];
  let mesh=null,sourceKey=null,renderKey=null,preview=null,revision=0,rollback=null,note='';
  function binding(){
    if(!img||!peHash||imageLoading||imageLoadFailed||$('imageType').value!=='postop_THA'||$('peProjection').value!=='AP'||$('rpDirection').value!=='AP')return null;
    return JSON.stringify([peSource(),$('side').value,$('studyId').value.trim(),$('imageId').value.trim()]);
  }
  function geometry(){
    const circle=circle3(pts.head1,pts.head2,pts.head3),center=circle||annotation.head?.center;
    const mm=calibrationScale(),angles=controls.map(id=>Number($(id).value));
    return center&&mm>0?{center:{x:center.x,y:center.y},mm,angles}:null;
  }
  function invalidateChangedRegistration(){
    const old=annotation.stem_cad;
    if(!old || old.invalidated || !img || imageLoading || !peHash)return;
    const g=geometry();
    const matches=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-6;
    if(old.key===binding()&&g&&matches(g.mm,old.geometry?.mm)&&matches(g.center.x,old.geometry?.center?.x)&&matches(g.center.y,old.geometry?.center?.y))return;
    old.invalidated=true;
    for(const key of FmaStemCad.keys){
      const p=old.points?.[key],q=peGet(key);
      if(p&&q&&matches(p.x,q.x)&&matches(p.y,q.y))peSet(key,null);
    }
    accepted=false;const rs=rpSettings(false);if(rs)rs.confirmation=null;
  }
  function render(){
    if(!panel.open)return;
    $('stemCadApply').disabled=true;$('stemCadUndo').disabled=!rollback||rollback.key!==binding();
    const ctx=canvas.getContext('2d');
    if(canvas.width!==cv.width||canvas.height!==cv.height){canvas.width=cv.width;canvas.height=cv.height;}
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const key=binding();if(!key){$('stemCadStatus').textContent='術後APを読み込んでください。';return;}
    ctx.drawImage(img,0,0,cv.width,cv.height);
    if(mesh&&sourceKey!==key){mesh=null;preview=null;renderKey=null;note='';}
    const g=geometry();if(!mesh||!g){$('stemCadStatus').textContent=note||'骨頭中心・倍率を確定し、対応するステムCADを選んでください。';return;}
    const pose=JSON.stringify([key,mesh.meta,revision,g]);
    if(pose!==renderKey){preview=FmaStemCad.project(mesh,g.angles,g.center,g.mm,cv.width,cv.height);renderKey=pose;}
    const rows=preview.rows;ctx.lineWidth=2;ctx.strokeStyle='#2ce5af';ctx.beginPath();
    rows.forEach(([y,l],i)=>i?ctx.lineTo(l,y):ctx.moveTo(l,y));
    for(let i=rows.length-1;i>=0;i--)ctx.lineTo(rows[i][2],rows[i][0]);ctx.closePath();ctx.stroke();
    const p=preview.points;ctx.strokeStyle='#ffb956';ctx.beginPath();ctx.moveTo(p.stem_prox.x,p.stem_prox.y);ctx.lineTo(p.stem_dist.x,p.stem_dist.y);ctx.stroke();
    for(const k of ['stem_shoulder','stem_tip']){ctx.beginPath();ctx.arc(p[k].x,p[k].y,4,0,2*Math.PI);ctx.stroke();}
    $('stemCadApply').disabled=!preview.inside||!rows.length;
    $('stemCadStatus').textContent=[mesh.meta.model,mesh.meta.version,mesh.meta.status==='prototype'?'試作':'寸法照合済み',g.angles.join('° ／ ')+'°',!preview.inside?'点が撮影範囲外':note||'軸と金属輪郭を確認'].join('　');
  }
  $('stemCadFile').onchange=async e=>{
    const file=e.target.files?.[0],key=binding(),token=++revision;e.target.value='';if(!file)return;
    mesh=null;preview=null;renderKey=null;
    try{
      if(!key)throw Error('先に術後AP画像を選んでください。');
      if(file.size>40e6)throw Error('40 MB以下のモデルを選んでください。');
      const d=JSON.parse(await file.text()), bytes=Uint8Array.from(atob(d.stl_base64),c=>c.charCodeAt(0));
      const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      if(d.cad_sha256!==sha||d.side!==$('side').value)throw Error('STLのハッシュまたは登録側が一致しません。');
      const candidate=FmaStemCad.parse(d,bytes.buffer);
      if(token!==revision||key!==binding())return;
      mesh=candidate;sourceKey=key;note='';controls.forEach(id=>$(id).value='0');
    }catch(err){if(token===revision)note=err.message;}render();
  };
  for(const id of controls)$(id).oninput=()=>{note='';render();};
  $('stemCadApply').onclick=()=>{
    try{
      render();if(!mesh||sourceKey!==binding()||!preview?.inside||$('stemCadApply').disabled)throw Error('現在の画像に対応するCADを確認してください。');
      peReady();peState(true);const prior=peSnapshot(),key=binding(),g=geometry();
      try{
        for(const [k,p] of Object.entries(preview.points)){
          const before=peGet(k);peSet(k,p);peRecord('cad_projection',k,before,p,{input_method:'CAD_PROJECTION',cad_sha256:mesh.meta.cad_sha256});
        }
        annotation.stem_cad={schema:'fma-stem-cad-projection-v1',key,model:mesh.meta,geometry:g,points:preview.points};
        accepted=false;const settings=rpSettings(false);if(settings)settings.confirmation=null;
        draw();saveWork();rollback={key,prior,fingerprint:peFingerprint()};note='4点をFMAに反映しました。';
      }catch(err){peRestore(prior);throw err;}
    }catch(err){note=err.message;}render();
  };
  $('stemCadUndo').onclick=()=>{
    if(!rollback||rollback.key!==binding()||rollback.fingerprint!==peFingerprint()){note='別の入力が編集されています。';render();return;}
    peRestore(rollback.prior);peRecord('undo_cad_projection',null,null,null);rollback=null;saveWork();note='反映前の点に戻しました。';render();
  };
  panel.addEventListener('toggle',render);const before=draw;draw=function(){invalidateChangedRegistration();before();render();};
  const payloadBefore=annotationPayload;
  annotationPayload=function(){invalidateChangedRegistration();return payloadBefore();};
  for(const id of ['studyId','imageId','side','headSize','imageType','calMode','scale','rpDirection','peProjection'])$(id).addEventListener('change',()=>{invalidateChangedRegistration();render();});
})();
