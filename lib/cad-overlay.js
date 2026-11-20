// Local-only FMA CAD preview. No network, calibration or clinical measurements.
const FmaCadOverlay=(()=>{
  const LIMIT_BYTES=25_000_000, LIMIT_TRIANGLES=180_000, KINDS=['bone','stem','cup','head'];
  const defaultPose=()=>({rx:0,ry:0,rz:0,dx:0,dy:0,scale:1,opacity:.42,visible:true});
  const decimal=(v,min,max,otherwise)=>Number.isFinite(v)?Math.min(max,Math.max(min,v)):otherwise;
  const normalise=(p={})=>({rx:decimal(p.rx,-180,180,0),ry:decimal(p.ry,-180,180,0),rz:decimal(p.rz,-180,180,0),
    dx:decimal(p.dx,-1,1,0),dy:decimal(p.dy,-1,1,0),scale:decimal(p.scale,.05,4,1),opacity:decimal(p.opacity,0,1,.42),
    visible:typeof p.visible==='boolean'?p.visible:true});
  const sha=v=>typeof v==='string'&&/^[a-f\d]{64}$/i.test(v);
  function sourceKey(hash,side,projection){
    return sha(hash)&&['L','R'].includes(side)&&['AP','AXIAL','LAUENSTEIN'].includes(projection)?
      [hash.toLowerCase(),side,projection].join(':'):null;
  }
  function storageKey(source,kind,hash){
    if(typeof source!=='string'||!KINDS.includes(kind)||!sha(hash))return null;
    const [s,side,projection,extra]=source.split(':');
    if(extra!==undefined||sourceKey(s,side,projection)!==source)return null;
    return 'FMA_cad_display_v1:'+source+':'+kind+':'+hash.toLowerCase();
  }
  function parse(extension,buffer){
    if(!(buffer instanceof ArrayBuffer)||buffer.byteLength===0||buffer.byteLength>LIMIT_BYTES)throw Error('CADは25 MB以下のSTLまたはOBJを選んでください。');
    const fmt=String(extension).toLowerCase().replace(/^.*\./,'');
    if(!['stl','obj'].includes(fmt))throw Error('対応形式はSTLとOBJです。');
    const v=new DataView(buffer), count=fmt==='stl'&&v.byteLength>=84?v.getUint32(80,true):0;
    const binary=fmt==='stl'&&count>0&&84+count*50===v.byteLength;
    let raw;
    const n=x=>{
      const a=Number(x);
      if(!Number.isFinite(a)||Math.abs(a)>1e7)throw Error('CADの座標が不正です。');
      return a;
    };
    if(binary){
      if(count>LIMIT_TRIANGLES)throw Error('CADは18万三角形以下に簡略化してください。');
      raw=new Float64Array(count*9);
      for(let i=0;i<count;i++)for(let j=0;j<9;j++)raw[9*i+j]=n(v.getFloat32(96+50*i+4*j,true));
    }else{
      const txt=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
      const verts=[],coords=[];
      for(const line of txt.split(/\r?\n/)){
        const fields=line.replace(/#.*/,'').trim().split(/\s+/);
        if(fmt==='stl'&&fields[0]==='vertex'){
          if(fields.length!==4)throw Error('ASCII STLの頂点が不正です。');
          coords.push(...fields.slice(1).map(n));
        }
        if(fmt==='obj'&&fields[0]==='v'){
          if(fields.length<4||verts.length>LIMIT_TRIANGLES*3)throw Error('OBJの頂点が不正か、多すぎます。');
          verts.push(fields.slice(1,4).map(n));
        }
        if(fmt==='obj'&&fields[0]==='f'){
          if(fields.length<4||fields.length>33)throw Error('OBJの面が不正です。複雑な面は三角形化してください。');
          const face=fields.slice(1).map(v=>{
            const i=v.split('/')[0];
            if(!/^-?\d+$/.test(i))throw Error('OBJの頂点参照が不正です。');
            const j=Number(i),k=j>0?j-1:verts.length+j;
            if(!j||!verts[k])throw Error('OBJの頂点参照が範囲外です。');
            return verts[k];
          });
          for(let j=1;j+1<face.length;j++)coords.push(...face[0],...face[j],...face[j+1]);
        }
        if(coords.length>LIMIT_TRIANGLES*9)throw Error('CADは18万三角形以下に簡略化してください。');
      }
      if(fmt==='stl'&&(!/^\s*solid(?:\s|$)/i.test(txt)||!/^\s*endsolid(?:\s|$)/im.test(txt)))throw Error('STL形式が不正です。');
      raw=coords;
    }
    if(raw.length<9||raw.length%9)throw Error('表示できる三角形がありません。');
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<raw.length;i++){const j=i%3;lo[j]=Math.min(lo[j],raw[i]);hi[j]=Math.max(hi[j],raw[i]);}
    const center=lo.map((a,i)=>(a+hi[i])/2), extent=Math.max(...hi.map((a,i)=>a-lo[i]));
    if(!(extent>0))throw Error('CADの大きさが不正です。');
    return {xyz:Float32Array.from(raw,(a,i)=>(a-center[i%3])/extent),extentMm:extent,triangles:raw.length/9};
  }
  function projection(pose,width,height,spanPixels=null){
    const p=normalise(pose),[a,b,c]=[p.rx,p.ry,p.rz].map(v=>v*Math.PI/180);
    const [ca,sa,cb,sb,cc,sc]=[Math.cos(a),Math.sin(a),Math.cos(b),Math.sin(b),Math.cos(c),Math.sin(c)];
    // Rz * Ry * Rx, front-facing (X horizontal / Z up); depth Y is not inferred.
    const u=[cc*cb,cc*sb*sa-sc*ca,cc*sb*ca+sc*sa], v=[sb,-cb*sa,-cb*ca];
    const ox=width*(.5+p.dx),oy=height*(.5+p.dy),s=spanPixels??(.62*Math.min(width,height)*p.scale);
    return (x,y,z)=>[ox+s*(u[0]*x+u[1]*y+u[2]*z),oy+s*(v[0]*x+v[1]*y+v[2]*z)];
  }
  return {LIMIT_BYTES,LIMIT_TRIANGLES,KINDS,defaultPose,normalise,sourceKey,storageKey,parse,projection};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=FmaCadOverlay;
