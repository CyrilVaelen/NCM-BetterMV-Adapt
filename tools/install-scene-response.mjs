import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const project=process.cwd(),root=path.dirname(project),version='0.9.0-local-export.15';
const state=path.join(root,'state/all-scene-response-20261018'),backup=path.join(state,'baseline');
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const hash=b=>createHash('sha256').update(b).digest('hex');
const installed=path.join(root,'BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin');
const runtime=path.join(root,'BetterNCM/plugins_runtime/ncm-better-mv/bettermv.js');
const baseline=await read(path.join(backup,'baseline.json'));
assert.equal(baseline.version,'0.9.0-local-export.14');
assert.equal(hash(await fs.readFile(installed)),baseline.pluginSha256,'Installed plugin changed since backup');
assert.equal(hash(await fs.readFile(runtime)),baseline.runtimeSha256,'Runtime changed since backup');
assert.equal(hash(await fs.readFile(path.join(backup,'BetterMV-0.9.0-local-export.plugin'))),baseline.pluginSha256);
assert.equal(hash(await fs.readFile(path.join(backup,'bettermv.js'))),baseline.runtimeSha256);
const acceptance=await read(path.join(state,'acceptance.json'));
assert.equal(acceptance.complete,true);assert.equal(acceptance.automated.typecheck,'passed');
assert.equal(acceptance.automated.failures,0);assert.equal(acceptance.automated.relatedTests,69);
const gpu=await read(path.join(state,'gpu-final/report.json'));
assert.equal(gpu.passed,true);assert.equal(gpu.registeredScenes,37);assert.ok(gpu.cases>=106);
assert.equal(gpu.errors.length,0);assert.equal(gpu.failures.length,0);
const rendered=await read(path.join(state,'gpu-final/source.json'));
const sourceHashes={},changes=[];
for(const f of rendered.files){
 const file='src/'+f.path,digest=hash(await fs.readFile(file));assert.equal(digest,f.sha256,'Source changed after GPU render: '+file);
 sourceHashes[file]=digest;if(baseline.files.find(b=>b.path===f.path)?.sha256!==digest)changes.push(file);
}
assert.ok(changes.every(f=>f.startsWith('src/scenes/')),'Unexpected change to analysis/lyrics/time/export');
assert.deepEqual(changes.sort(),acceptance.reviewedSourceChanges.slice().sort());
for(const f of baseline.files)assert.ok(sourceHashes['src/'+f.path],'Production file removed: '+f.path);
for(const f of acceptance.reviewedSupportFiles)sourceHashes[f]=hash(await fs.readFile(f));
const candidate=await fs.readFile(path.join(root,'BetterMV-0.9.0-local-export.plugin'));
const zip=await JSZip.loadAsync(candidate,{checkCRC32:true}),js=await zip.file('bettermv.js').async('nodebuffer');
assert.equal(hash(js),hash(await fs.readFile('dist/plugin/bettermv.js')));assert.ok(js.includes(Buffer.from(version)));
await fs.writeFile(installed,candidate);await fs.writeFile(runtime,js);
assert.equal(hash(await fs.readFile(installed)),hash(candidate));assert.equal(hash(await fs.readFile(runtime)),hash(js));
const report={version,analysisVersion:8,installed,sha256:hash(candidate),runtime,runtimeSha256:hash(js),previousSha256:baseline.pluginSha256,backup,sourceHashes,changedFiles:changes,
 validation:{automated:acceptance.automated,visual:gpu.results.map(r=>({scene:r.scene,clip:r.style+'-'+r.look+(r.lyrics===false?'-no-lyrics':''),frames:r.frames.on.length+r.frames.off.length,quality:{meanPixelMAE:r.meanPixelMAE,visibleContribution:r.visibleContribution,emptyOnFrames:r.emptyOnFrames}})),allSceneGpu:{cases:gpu.cases,totalFrames:gpu.totalFrames,sourceSha256:gpu.sourceSha256}},
 limits:gpu.limits,activation:'Completely quit and restart NetEase; analysis cache need not be cleared.',
 installedAt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date())+' +08:00'};
await fs.writeFile(path.join(root,'BetterNCM/setup/all-scene-response-20261018.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({version,installed,sha256:report.sha256,runtimeSha256:report.runtimeSha256,productionSourceFiles:rendered.files.length,changedSourceFiles:changes.length}));
