// Optional headless Chromium browser smoke on generated radiographs and CAD only.
// Usage: CHROMIUM=/usr/bin/chromium node scripts/cad-overlay-smoke.cjs
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fma-cad-smoke-'));
const home=path.join(__dirname,'../dev');
const server=http.createServer((q,r)=>{
  if(q.url==='/dev/index.html'){r.setHeader('Content-Type','text/html; charset=utf-8');return r.end(fs.readFileSync(path.join(home,'index.html')));}
  r.writeHead(404);r.end();
});
const ready=()=>new Promise((ok,fail)=>{server.on('error',fail);server.listen(0,'127.0.0.1',ok);});
let chrome,ws;
async function core(){
await ready();
const opts=['--headless','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'];
if(process.env.FMA_BROWSER_NO_SANDBOX==='1')opts.unshift('--no-sandbox');
chrome=spawn(process.env.CHROMIUM||'/usr/bin/chromium',opts,{stdio:['ignore','ignore','pipe']});
const port=await new Promise((res,rej)=>{
  let err='';const t=setTimeout(()=>rej(Error('Chromium startup: '+err.slice(0,1000))),9000);
  chrome.on('error',rej);chrome.on('exit',()=>{clearTimeout(t);rej(Error('Chromium startup: '+err.slice(0,1000)));});
  chrome.stderr.on('data',b=>{err+=b;const m=err.match(/DevTools listening on ws:\/\/127.0.0.1:(\d+)/);if(m){clearTimeout(t);res(+m[1]);}});
});
const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(),tab=tabs.find(t=>t.type==='page');
ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let seq=0;const waits=new Map();
ws.onmessage=e=>{const data=JSON.parse(e.data),pending=waits.get(data.id);if(pending){waits.delete(data.id);if(data.error)pending[1](Error(data.error.message));else pending[0](data.result);}};
const send=(method,params={})=>new Promise((ok,no)=>{const id=++seq;waits.set(id,[ok,no]);ws.send(JSON.stringify({id,method,params}));});
const go='http://127.0.0.1:'+server.address().port+'/dev/index.html';
await send('Page.navigate',{url:go});
for(let i=0;i<60;i++){const s=await send('Runtime.evaluate',{expression:'document.readyState==="complete" && !!document.getElementById("cadView")',returnByValue:true});if(s.result.value)break;if(i===59)throw Error('Application did not load');await delay(100);}
const result=await send('Runtime.evaluate',{expression:'('+browserTest.toString()+')()',awaitPromise:true,returnByValue:true});
if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
console.log(JSON.stringify(result.result.value));
}
async function browserTest(){
  const assert=(cond,label)=>{if(!cond)throw Error(label);}, $=id=>document.getElementById(id);
  const tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const wait=async(fn,label)=>{for(let i=0;i<90;i++){if(fn())return;await tick();}throw Error(label+' '+$('cadViewStatus').textContent);};
  async function image(name,tone){
    const c=document.createElement('canvas');c.width=160;c.height=120;const a=c.getContext('2d');
    a.fillStyle=tone;a.fillRect(0,0,160,120);a.strokeStyle='#000';a.strokeRect(20,10,110,90);
    return new File([await new Promise(r=>c.toBlob(r))],name,{type:'image/png'});
  }
  function file(id,f){
    const d=new DataTransfer();d.items.add(f);$(id).files=d.files;$(id).dispatchEvent(new Event('change',{bubbles:true}));
  }
  const change=(id,v,type='change')=>{const e=$(id);if(e.type==='checkbox')e.checked=v;else e.value=v;e.dispatchEvent(new Event(type,{bubbles:true}));};
  const mark=()=>$('cadViewCanvas').toDataURL();
  const wash=(x,y)=>$('cadViewCanvas').getContext('2d').getImageData(x,y,1,1).data;
  const a=await image('synthetic-a.png','#777'), b=await image('synthetic-b.png','#999');
  const model=new File(['v 1 2 3\nv 2 2 3\nv 1 2 4\nv 1.6 2.7 3.6\nf 1 2 3\nf 1 2 4\nf 1 3 4\nf 2 3 4\n'],'synthetic.obj');
  $('cadView').open=true;file('file',a);await wait(()=>!$('cadViewFile').disabled,'A ready');
  const raw=()=>JSON.stringify(window.eval('(()=>{const {timestamp,...raw}=annotationPayload();return raw})()'));
  const rawBefore=raw();
  const mainBefore=$('cv').toDataURL(), clean=mark();
  file('cadViewFile',model);await wait(()=>$('cadViewStatus').textContent.includes('読み込みました'),'bone ready');
  assert(mark()!==clean,'renderer painted a mask');assert(wash(0,0)[0]===119,'radiograph retained');
  const rotated=mark();for(const [id,v] of [['cadViewRX',18],['cadViewRY',29],['cadViewRZ',31],['cadViewDX',.12],['cadViewDY',.04],['cadViewScale',1.19],['cadViewOpacity',.79]]){
    const last=mark();change(id,String(v),'input');await tick();assert(mark()!==last,id+' affected silhouette');
  }
  assert(mark()!==rotated,'changed position');$('cadViewSave').click();await tick();
  assert($('cadViewStatus').textContent.includes('端末内に保存'),'explicit private save');
  const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(x=>x.startsWith('FMA_cad_display_v1'));
  assert(keys.length===1&&!keys[0].includes('synthetic')&&!localStorage.getItem(keys[0]).includes('synthetic'),'only hash+pose persisted');
  change('cadViewVisible',false);await tick();assert(mark()===clean,'individual off');change('cadViewVisible',true);await tick();
  change('cadViewKind','stem');file('cadViewFile',model);await wait(()=>$('cadViewStatus').textContent.includes('ステムを読み込み'), 'other layer ready');
  change('cadViewMaster',false);await tick();assert(mark()===clean,'master off restores radiograph');
  assert($('cv').toDataURL()===mainBefore,'main canvas untouched');
  assert(raw()===rawBefore,'annotation payload unchanged');
  change('cadViewMaster',true);change('cadViewKind','bone');$('cadViewReset').click();await tick();
  assert($('cadViewRX').value==='0'&&$('cadViewScale').value==='1'&&$('cadViewOpacity').value==='0.79','pose reset does not reset opacity');
  change('cadViewKind','cup');
  const cup=new File(['v -25 0 0\nv 25 0 0\nv 0 0 25\nf 1 2 3\n'],'cup-50mm.obj');
  file('cadViewFile',cup);await wait(()=>$('cadViewStatus').textContent.includes('カップを読み込み'),'cup ready');
  $('cadViewLock').click();await tick();
  const scale=Number($('cadViewCalibration').textContent.match(/[0-9.]+/)[0]);
  assert(Math.abs(scale-.62*120/50)<.001,'scale uses native image pixels');
  $('cadViewHead').click();await tick();
  assert($('cadViewKind').value==='head'&&$('cadViewScale').disabled,'head uses cup scale');
  assert(!$('cadViewDX').disabled,'head translation remains available');
  for(const id of ['stem','bone','cup']){
    change('cadViewKind',id);assert($('cadViewScale').disabled,'all layer scales locked');
  }
  $('cadViewReset').click();await tick();assert($('cadViewScale').disabled,'reset respects lock');
  $('cadViewLock').click();await tick();assert(!$('cadViewScale').disabled,'independent scale restored');
  change('cadViewKind','bone');
  file('file',b);await wait(()=>!$('cadViewFile').disabled&&wash(0,0)[0]===153,'B ready');
  assert($('cadViewReset').disabled,'B cannot see A model');
  file('cadViewFile',model);await wait(()=>$('cadViewStatus').textContent.includes('読み込みました'),'B CAD ready');assert($('cadViewRX').value==='0','B does not inherit A');
  file('file',a);await wait(()=>!$('cadViewFile').disabled&&wash(0,0)[0]===119,'A reloaded');
  assert($('cadViewReset').disabled,'A mesh bytes were never persisted');
  file('cadViewFile',model);await wait(()=>$('cadViewStatus').textContent.includes('復元'),'A pose restored');
  assert($('cadViewRX').value==='18'&&$('cadViewDX').value==='0.12','same A + model restores pose');
  change('side','L');await tick();assert($('cadViewReset').disabled,'side change clears');
  change('peProjection','AXIAL');await tick();assert($('cadViewFile').disabled,'non-AP disables');
  return {realChromium:true,syntheticOnly:true,XYZ:true,translationScaleOpacity:true,twoLayers:true,
    globalIndividualToggle:true,reset:true,imageOriginIsolation:true,privateRoundtrip:true,unchangedMeasurementCanvasAndPayload:true,nonAPGate:true};
}
core().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(ws)ws.close();if(chrome&&chrome.exitCode===null){chrome.kill();await Promise.race([new Promise(r=>chrome.once('exit',r)),delay(1200)]);}
  server.close();try{fs.rmSync(profile,{recursive:true,force:true});}catch(e){}
});
