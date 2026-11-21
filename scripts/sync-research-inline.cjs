// Keep standalone/GAS HTML self-contained; tests enforce exact module parity.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),file=path.join(root,'dev/index.html');
let text=fs.readFileSync(file,'utf8');
for(const [source,start,end]of [
  ['lib/cad-overlay.js','// BEGIN CAD OVERLAY (lib/cad-overlay.js)','// END CAD OVERLAY'],
  ['lib/cad-overlay-ui.js','// BEGIN CAD OVERLAY UI (lib/cad-overlay-ui.js)','// END CAD OVERLAY UI'],
  ['lib/stem-cad.js','// BEGIN STEM CAD (lib/stem-cad.js)','// END STEM CAD'],
  ['lib/stem-cad-ui.js','// BEGIN STEM CAD UI (lib/stem-cad-ui.js)','// END STEM CAD UI'],
  ['lib/cup-cad.js','// BEGIN CUP CAD (lib/cup-cad.js)','// END CUP CAD'],
  ['lib/cup-cad-ui.js','// BEGIN CUP UI (lib/cup-cad-ui.js)','// END CUP UI'],
  ['lib/research-profile.js','// BEGIN GENERATED RESEARCH PROFILE (lib/research-profile.js)','// END GENERATED RESEARCH PROFILE'],
  ['lib/research-ui.js','// BEGIN RESEARCH UI (lib/research-ui.js)','// END RESEARCH UI'],
  ['lib/point-edits.js','// BEGIN POINT EDITS (lib/point-edits.js)','// END POINT EDITS'],
  ['lib/point-editor-ui.js','// BEGIN POINT EDITOR UI (lib/point-editor-ui.js)','// END POINT EDITOR UI']]){
  const a=text.indexOf(start),b=text.indexOf(end,a);
  if(a<0||b<0)throw Error('Missing inline markers: '+source);
  text=text.slice(0,a)+start+'\n'+fs.readFileSync(path.join(root,source),'utf8')+text.slice(b);
}
fs.writeFileSync(file,text);
