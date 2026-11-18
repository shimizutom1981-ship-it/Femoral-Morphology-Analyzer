// Calibrated weak-perspective projection of a registered LPS stem mesh.
const FmaStemCad=(()=>{
  const keys=['stem_prox','stem_dist','stem_shoulder','stem_tip'];
  const vec=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
  function parse(data,buffer){
    if(!data||data.schema!=='fma-stem-cad-v1'||data.frame!=='LPS_mm'||!['R','L'].includes(data.side)||
      ![data.model,data.version].every(v=>typeof v==='string'&&v.trim())||!['prototype','dimension_verified'].includes(data.status)||
      !/^[a-f\d]{64}$/i.test(data.cad_sha256)||!vec(data.head_center_mm)||!keys.every(k=>vec(data.landmarks_mm?.[k])))throw Error('軸・肩・先端を定義したステムCADを選んでください。');
    const v=new DataView(buffer), n=buffer.byteLength>=84?v.getUint32(80,true):0;
    if(!n||n>500000||buffer.byteLength!==84+50*n)throw Error('三角形の数またはバイナリSTLの形式が不正です。');
    const xyz=new Float32Array(n*9);
    for(let i=0;i<n;i++)for(let j=0;j<9;j++){
      const coord=v.getFloat32(96+50*i+4*j,true)-data.head_center_mm[j%3];
      if(!Number.isFinite(coord)||Math.abs(coord)>500)throw Error('STLの単位・原点を確認してください。');
      xyz[9*i+j]=coord;
    }
    if(Math.hypot(...data.landmarks_mm.stem_prox.map((v,i)=>v-data.landmarks_mm.stem_dist[i]))<1)throw Error('軸の2点が重なっています。');
    return {xyz,meta:{model:data.model,version:data.version,status:data.status,side:data.side,cad_sha256:data.cad_sha256},
      landmarks:Object.fromEntries(keys.map(k=>[k,data.landmarks_mm[k].map((v,i)=>v-data.head_center_mm[i])]))};
  }
  function project(mesh,angles,center,mm,width,height){
    if(!(mm>0)||!Number.isFinite(mm)||!angles.every(Number.isFinite)||!Number.isFinite(center.x)||!Number.isFinite(center.y))throw Error('骨頭中心と倍率が必要です。');
    const [a,b,c]=angles.map(x=>x*Math.PI/180);
    const ca=Math.cos(a),sa=Math.sin(a),sb=Math.sin(b),cb=Math.cos(b),sc=Math.sin(c),cc=Math.cos(c);
    const u=[cc*ca+sc*sb*sa,-cc*sa+sc*sb*ca,sc*cb];
    const v=[sc*ca-cc*sb*sa,-sc*sa-cc*sb*ca,-cc*cb];
    function point(x,y,z){return {x:center.x+(u[0]*x+u[1]*y+u[2]*z)/mm,y:center.y+(v[0]*x+v[1]*y+v[2]*z)/mm};}
    const points=Object.fromEntries(keys.map(k=>[k,point(...mesh.landmarks[k])]));
    const left=new Float64Array(height).fill(Infinity),right=new Float64Array(height).fill(-Infinity);
    for(let i=0;i<mesh.xyz.length;i+=9){
      const tri=[0,3,6].map(j=>point(mesh.xyz[i+j],mesh.xyz[i+j+1],mesh.xyz[i+j+2]));
      for(let j=0;j<3;j++){
        const a=tri[j],b=tri[(j+1)%3];
        const start=Math.max(0,Math.ceil(Math.min(a.y,b.y))),stop=Math.min(height,Math.ceil(Math.max(a.y,b.y)));
        for(let y=start;y<stop;y++){
          const x=a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y);
          left[y]=Math.min(left[y],x);right[y]=Math.max(right[y],x);
        }
      }
    }
    const rows=[];
    for(let y=0;y<height;y++)if(Number.isFinite(left[y]))rows.push([y,left[y],right[y]]);
    const inside=Object.values(points).every(p=>p.x>=0&&p.x<width&&p.y>=0&&p.y<height);
    return {points,rows,inside};
  }
  return {keys,parse,project};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=FmaStemCad;
