// Keep standalone/GAS HTML self-contained; tests enforce exact module parity.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),file=path.join(root,'dev/index.html');
let text=fs.readFileSync(file,'utf8');
for(const [source,start,end]of [
  ['lib/research-profile.js','// BEGIN GENERATED RESEARCH PROFILE (lib/research-profile.js)','// END GENERATED RESEARCH PROFILE'],
  ['lib/research-ui.js','// BEGIN RESEARCH UI (lib/research-ui.js)','// END RESEARCH UI']]){
  const a=text.indexOf(start),b=text.indexOf(end,a);
  if(a<0||b<0)throw Error('Missing inline markers: '+source);
  text=text.slice(0,a)+start+'\n'+fs.readFileSync(path.join(root,source),'utf8')+text.slice(b);
}
fs.writeFileSync(file,text);
