const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(process.argv[2]||'dev/index.html','utf8');
const parser=html.slice(html.indexOf('function parseRecordText('),html.indexOf('function validateRecordImport('));
const ctx={};vm.createContext(ctx);vm.runInContext(parser,ctx);
const parse=ctx.parseRecordText;
for(const text of ['{"canal_medial":[],"canal_lateral":[]}', '\ufeff{"a":1}', ' \n{"a":1}', 'FMA-CONTOUR-EVIDENCE-V1\n{"a":1}', '\ufeffFMA-CONTOUR-EVIDENCE-V1\r\n{"a":1}']) assert.ok(parse(text));
for(const text of ['', 'FMA-CONTOUR-EVIDENCE-V2\n{}', 'FMA-CONTOUR-EVIDENCE-V1{}', 'prefix\n{}', 'FMA-CONTOUR-EVIDENCE-V1\n{', 'FMA-CONTOUR-EVIDENCE-V1\n{} trailing']) assert.throws(()=>parse(text));
assert.match(html,/const record=parseRecordText\(await file.text\(\)\)/);
assert.match(html,/const r=parseRecordText\(await file.text\(\)\)/);
for(const p of process.argv.slice(3)){const s=fs.readFileSync(p,'utf8');const r=parse(s);assert.ok(r.canal_medial||r.raw_annotations?.canal_medial);assert.equal(JSON.stringify(r),JSON.stringify(JSON.parse(s.slice(s.indexOf('{')))));}
console.log('record-text: 5 valid, 6 malformed/version cases; both import paths; real files '+process.argv.slice(3).length+' PASS');
