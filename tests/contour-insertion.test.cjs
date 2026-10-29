// Synthetic geometry only. Execute the production HTML and its real handlers.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function app(){
  const elements={},events={},saved={};
  const ctx=new Proxy({}, {get:(t,k)=>t[k]||(()=>{})});
  const document={getElementById(id){return elements[id]??={value:'',style:{},width:1200,height:1500,
    addEventListener(ev,fn){if(id==='cv')(events[ev]??=[]).push(fn)},getContext(){return ctx},
    getBoundingClientRect(){return {left:0,top:0,width:1200,height:1500}},setPointerCapture(){}}}};
  const env=vm.createContext({document,window:{addEventListener(){}},console,alert(){},setTimeout,
    localStorage:{setItem(k,v){saved[k]=v}}});
  const run=s=>vm.runInContext(s,env);
  run(html.split('<script>')[1].split('</script>')[0]);
  const plain=s=>JSON.parse(JSON.stringify(run(s)));
  const index=(a,p)=>{env.a=a;env.p=p;return run('nearestContourInsertIndex(a,p)')};
  return {run,plain,index,elements,saved,click(x,y){for(const fn of events.pointerdown)fn({button:0,clientX:x,clientY:y})}};
}
const point=(x,y)=>({x,y});
for(const [name,a,p,want] of [
  ['empty',[],point(1,0),0],['single',[point(0,0)],point(1,0),1],
  ['interior',[point(0,0),point(100,0),point(200,0)],point(50,10),1],
  ['prepend',[point(0,0),point(100,0)],point(-50,10),0],
  ['append',[point(0,0),point(100,0)],point(150,10),2],
  ['reversed',[point(100,0),point(0,0)],point(150,10),0],
  ['vertical',[point(0,0),point(0,100)],point(10,150),2],
  ['oblique',[point(0,0),point(100,100)],point(150,160),2],
  ['curved interior wins',[point(0,0),point(100,0),point(100,100),point(-100,100)],point(-20,90),3],
  ['coincident start',[point(0,0),point(0,0),point(100,0)],point(-50,0),0],
  ['coincident end',[point(0,0),point(100,0),point(100,0)],point(150,0),3],
  ['all coincident',[point(0,0),point(0,0)],point(150,0),1],
  ['perpendicular tie stays insertion',[point(0,0),point(100,0)],point(0,50),1]
])test(name,()=>{const f=app(),before=JSON.stringify(a);assert.equal(f.index(a,p),want);assert.equal(JSON.stringify(a),before)});

test('rotation/reflection/scale invariance for sequential extensions and interior insertion',()=>{
  const f=app();
  for(let angle=0;angle<360;angle+=15)for(const mirror of [-1,1])for(const scale of [.01,1,100]){
    const r=angle*Math.PI/180;
    const p=t=>point(700+scale*t*Math.cos(r)*mirror,300+scale*t*Math.sin(r));
    const a=[p(0),p(100)];
    for(const [t,want] of [[150,2],[-50,0],[200,4],[-100,0],[50,3]]){
      const idx=f.index(a,p(t));assert.equal(idx,want,`${angle}/${mirror}/${scale}/${t}`);a.splice(idx,0,p(t));
    }
  }
});

const names=['femur_medial','femur_lateral','canal_medial','canal_lateral','stem_medial','stem_lateral'];
for(const name of names)test(`${name}: real click, chronological IDs/history, save and undo`,()=>{
  const f=app();f.elements.workMode.value='annotation';f.elements.annotationTarget.value=name;
  f.run(`aiLoaded=true;annotation[${JSON.stringify(name)}]=[
    {x:100,y:300,_aiControl:true,id:'synthetic-a'},
    {x:200,y:300,_aiControl:true,id:'synthetic-b'},
    {x:300,y:300,_aiControl:true,id:'synthetic-c'}];
    annotation._nextManualId=40;annotation._manualAnchors={unrelated:[{id:9,x:1,y:2}]};
    annotation.edit_history=[{action:'synthetic-import',id:'history-1'}];
    window._fmaFile={name:'synthetic.png',size:1};`);
  const before=f.plain(`annotation[${JSON.stringify(name)}]`);
  for(const x of [350,50,400,0,150])f.click(x,300);
  const a=f.plain(`annotation[${JSON.stringify(name)}]`);
  assert.deepEqual(a.map(p=>p.x),[0,50,100,150,200,300,350,400]);
  assert.deepEqual(a.filter(p=>p._aiControl),before);
  assert.deepEqual(a.filter(p=>p._manual).map(p=>p._manualId),[44,42,45,41,43]);
  const history=f.plain(`annotation._manualAnchors[${JSON.stringify(name)}]`);
  assert.deepEqual(history.map(p=>p.id),[41,42,43,44,45]);
  assert.deepEqual(history.map(p=>p.x),[350,50,400,0,150]);
  assert.equal(f.run('annotationCorrectionCount'),5);
  const saved=JSON.parse(Object.values(f.saved).at(-1));
  assert.deepEqual(saved.annotation,f.plain('annotation'));
  assert.deepEqual(saved.annotation.edit_history,[{action:'synthetic-import',id:'history-1'}]);
  assert.deepEqual(saved.annotation._manualAnchors.unrelated,[{id:9,x:1,y:2}]);
  for(let i=0;i<5;i++)f.elements.undoAnnotation.onclick();
  assert.deepEqual(f.plain(`annotation[${JSON.stringify(name)}]`),before);
  assert.equal(f.run('annotation._nextManualId'),45);
});

test('manual-only sequential tracing remains unchanged',()=>{
  const f=app();f.elements.workMode.value='annotation';f.elements.annotationTarget.value='femur_medial';
  for(const x of [300,100,200])f.click(x,300);
  assert.deepEqual(f.plain('annotation.femur_medial').map(p=>p.x),[300,100,200]);
});
