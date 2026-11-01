import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const project=process.cwd(),root=path.dirname(project),version='0.9.0-local-export.14';
const state=path.join(root,'state/sunshine-form-keys-20261018'),backup=path.join(state,'baseline');
const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const hash=b=>createHash('sha256').update(b).digest('hex');
const installed=path.join(root,'BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin');
const runtime=path.join(root,'BetterNCM/plugins_runtime/ncm-better-mv/bettermv.js');
const baseline=await read(path.join(backup,'baseline.json'));
assert.equal(baseline.version,'0.9.0-local-export.13');
assert.equal(hash(await fs.readFile(installed)),baseline.pluginSha256,'Installed plugin changed since backup');
assert.equal(hash(await fs.readFile(runtime)),baseline.runtimeSha256,'Runtime changed since backup');
assert.equal(hash(await fs.readFile(path.join(backup,'installed.plugin'))),baseline.pluginSha256);
assert.equal(hash(await fs.readFile(path.join(backup,'runtime.js'))),baseline.runtimeSha256);

const acceptance=await read(path.join(state,'acceptance.json'));
assert.equal(acceptance.complete,true);assert.equal(acceptance.automated.typecheck,'passed');
assert.equal(acceptance.automated.failures,0);assert.ok(acceptance.automated.relatedTests>=50);
assert.equal(acceptance.structure.humanIntroAnchorSatisfied,true);
assert.equal(acceptance.structure.clockAndNoteTimesUnchanged,true);
const rendered=await read(path.join(state,'visual/after-source.json'));
const before=await read('tools/.sunshine-redo-baseline/frozen-source.json');
const sourceHashes={},changes=[];
for(const f of rendered.files){
  const file='src/'+f.path,digest=hash(await fs.readFile(file));assert.equal(digest,f.sha256,'Source changed since render: '+file);
  sourceHashes[file]=digest;
  if(before.files.find(b=>b.path===f.path)?.sha256!==digest)changes.push(file);
}
for(const f of before.files)assert.ok(sourceHashes['src/'+f.path],'Production source removed: '+f.path);
assert.deepEqual(changes.sort(),acceptance.reviewedSourceChanges.slice().sort());
const productionText=(await Promise.all(changes.map(f=>fs.readFile(f,'utf8')))).join('\n');
for(const forbidden of ['17285341','Sunshine','sunshine','67.493','67.5','67.49'])assert.ok(!productionText.includes(forbidden),'Single-song rule in production: '+forbidden);

const visual=acceptance.visual;
assert.ok(visual.length>=4);assert.ok(visual.some(v=>v.automatic),'Missing actual automatic-plan rendering');
for(const v of visual){
  const r=await read(v.report);
  assert.deepEqual(r.errors,[]);assert.equal(r.quality.emptyFrames,0);assert.equal(r.quality.identicalConsecutiveFrames,0);
  assert.equal(r.bundle.sourceSha256,rendered.sourceSha256);assert.equal(hash(await fs.readFile(r.file)),r.sha256);
  assert.equal(r.frames.length,r.clip.count);assert.ok((await fs.stat(v.comparison)).size>100000);
}
assert.equal(acceptance.visualKnockout.validated,true);
const candidate=await fs.readFile(path.join(root,'BetterMV-0.9.0-local-export.plugin'));
const zip=await JSZip.loadAsync(candidate,{checkCRC32:true}),js=await zip.file('bettermv.js').async('nodebuffer');
assert.equal(hash(js),hash(await fs.readFile('dist/plugin/bettermv.js')));
assert.ok(js.includes(Buffer.from(version)));
for(const f of acceptance.reviewedSupportFiles)sourceHashes[f]=hash(await fs.readFile(f));

await fs.writeFile(installed,candidate);await fs.writeFile(runtime,js);
assert.equal(hash(await fs.readFile(installed)),hash(candidate));assert.equal(hash(await fs.readFile(runtime)),hash(js));
const report={version,analysisVersion:8,installed,sha256:hash(candidate),runtime,runtimeSha256:hash(js),previousSha256:baseline.pluginSha256,backup,sourceHashes,changedFiles:changes,
  validation:{automated:acceptance.automated,visual:visual.map(v=>({scene:v.scene,clip:v.clip,frames:v.frames,quality:v.quality})),structure:acceptance.structure,visualKnockout:acceptance.visualKnockout},
  limits:['Instrument roles are acoustic estimates from the mix, not isolated stems or a trained instrument classifier.','Fixed-shot comparisons isolate response; automatic scene and section acceptance is recorded separately.','No running NetEase client listening acceptance is claimed.'],
  activation:'Completely quit and restart NetEase and reopen MV. Analysis version 8 recomputes prior analyses.',
  installedAt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date())+' +08:00'};
await fs.writeFile(path.join(root,'BetterNCM/setup/sunshine-form-keys-20261018.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({version,installed,sha256:report.sha256,runtimeSha256:report.runtimeSha256,changedFiles:changes}));
