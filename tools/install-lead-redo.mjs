import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const project=process.cwd(),root=path.resolve('..'),version='0.9.0-local-export.13';
const backup=path.join(root,'state/redo-lead-priority-20261018/baseline');
const installed=path.join(root,'BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin');
const runtime=path.join(root,'BetterNCM/plugins_runtime/ncm-better-mv/bettermv.js');
const hash=b=>createHash('sha256').update(b).digest('hex');
const baseline=JSON.parse(await fs.readFile(path.join(backup,'baseline.json'),'utf8'));
assert.equal(baseline.version,'0.9.0-local-export.12');
assert.equal(hash(await fs.readFile(installed)),baseline.pluginSha256,'Installed plugin changed after backup');
assert.equal(hash(await fs.readFile(runtime)),baseline.runtimeSha256,'Installed runtime changed after backup');
assert.equal(hash(await fs.readFile(path.join(backup,'installed.plugin'))),baseline.pluginSha256);
assert.equal(hash(await fs.readFile(path.join(backup,'runtime.js'))),baseline.runtimeSha256);

const oldSource=JSON.parse(await fs.readFile('tools/.lead-redo-baseline/frozen-source.json','utf8'));
assert.equal(oldSource.version,'0.9.0-local-export.12');
const expectedChanges=new Set(['src/analysis/timbre.ts','src/analysis/index.ts','src/director/music.ts','src/director/director.ts','src/scenes/tunnel.ts','src/scenes/drive.ts']);
const sourceHashes={},changed=[];
for(const old of oldSource.files){
  const file='src/'+old.path,digest=hash(await fs.readFile(file));sourceHashes[file]=digest;
  if(digest!==old.sha256){assert.ok(expectedChanges.has(file),'Unexpected production change: '+file);changed.push(file);}
}
assert.deepEqual(changed.sort(),[...expectedChanges].sort());
const renderedSource=JSON.parse(await fs.readFile(path.join(root,'state/redo-lead-priority-20261018/visual/after-source.json'),'utf8'));
for(const file of renderedSource.files)assert.equal(sourceHashes['src/'+file.path],file.sha256,'Source changed after visual rendering: '+file.path);

const visual=[];
for(const scene of ['tunnel','drive'])for(const clip of ['drop1','drop2']){
  const base=path.join(root,'exports/Lights-Out-redo-20261018',`${scene}-${clip}`);
  const r=JSON.parse(await fs.readFile(base+'-after-frames.json','utf8'));
  assert.deepEqual(r.errors,[]);assert.equal(r.quality.emptyFrames,0);assert.equal(r.quality.fullyFadedFrames,0);
  assert.equal(r.frames.length,r.clip.count);assert.equal(r.quality.identicalConsecutiveFrames,0);
  assert.equal(r.bundle.sourceSha256,renderedSource.sourceSha256);
  assert.ok((await fs.stat(base+'-comparison.mp4')).size>100000,'Missing full original-audio comparison');
  visual.push({scene,clip,frames:r.frames.length,quality:r.quality,comparison:base+'-comparison.mp4',candidateSha256:r.sha256});
}
const director=JSON.parse(await fs.readFile(path.join(root,'state/redo-lead-priority-20261018/stable-drop/lights-out-browser-director-acceptance.json'),'utf8'));
const automated=JSON.parse((await fs.readFile(path.join(root,'state/redo-lead-priority-20261018/final-validation.json'),'utf8')).replace(/^\uFEFF/,''));
assert.equal(automated.relatedTests,50);assert.equal(automated.failures,0);assert.equal(automated.typecheck,'passed');
const candidate=await fs.readFile(path.join(root,'BetterMV-0.9.0-local-export.plugin'));
const zip=await JSZip.loadAsync(candidate,{checkCRC32:true}),js=await zip.file('bettermv.js').async('nodebuffer');
assert.equal(hash(js),hash(await fs.readFile('dist/plugin/bettermv.js')));
for(const token of [version,'melodyAttack','leadPresence','leadOwnership'])assert.ok(js.includes(Buffer.from(token)),'Missing candidate code: '+token);
for(const file of ['exporter/build-plugin.mjs','tools/package-complete.mjs','tools/install-lead-redo.mjs','tools/lead-ownership.test.ts','tools/lead-onset-overlap.test.ts','tools/stable-drop.test.ts','tools/timbre.test.ts'])sourceHashes[file]=hash(await fs.readFile(file));

await fs.writeFile(installed,candidate);await fs.writeFile(runtime,js);
assert.equal(hash(await fs.readFile(installed)),hash(candidate));assert.equal(hash(await fs.readFile(runtime)),hash(js));
const report={version,analysisVersion:7,installed,sha256:hash(candidate),runtime,runtimeSha256:hash(js),previousSha256:baseline.pluginSha256,backup,changedFiles:changed,sourceHashes,
  validation:{automated,visual,director},
  limits:['Real mixed-audio instrument identity is an acoustic estimate, not independently labelled stems.','Known-source tests establish causal routing; complete original-audio comparisons establish reproducible rendering, not final human listening acceptance.','No running NetEase client audition was performed.'],
  activation:'Completely quit and restart NetEase; reopen MV. Analysis version 7 invalidates old analysis caches.',
  installedAt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date())+' +08:00'};
await fs.writeFile(path.join(root,'BetterNCM/setup/lead-redo-20261018.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({version,installed,sha256:report.sha256,runtimeSha256:report.runtimeSha256,changedFiles:changed}));
