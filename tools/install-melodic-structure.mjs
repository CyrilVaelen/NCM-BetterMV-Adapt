import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
const root=path.resolve('..'),out=path.join(root,'exports/Melodic-structure-20261018'),backup=path.join(root,'state/before-melodic-structure-20261018');
const hash=b=>createHash('sha256').update(b).digest('hex');
const baseline=JSON.parse(await fs.readFile(path.join(backup,'baseline.json'),'utf8'));
const previous=JSON.parse(await fs.readFile(path.join(root,'BetterNCM/setup/local-lrc-read-20261018.json'),'utf8'));
const installed=previous.installed,runtime=previous.runtime;
assert.equal(hash(await fs.readFile(installed)),baseline['../BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin']);
assert.equal(hash(await fs.readFile(runtime)),baseline['../BetterNCM/plugins_runtime/ncm-better-mv/bettermv.js']);
const changed=new Set(['src/analysis/index.ts','src/analysis/sections.ts','exporter/build-plugin.mjs']);
const sourceHashes={...previous.sourceHashes};
for(const [file,digest]of Object.entries(previous.sourceHashes)) if(!changed.has(file)) assert.equal(hash(await fs.readFile(file)),digest,'Preserved feature changed: '+file);
async function verifyPreservedSource(directory,relative='src') {
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const file=relative+'/'+entry.name,old=path.join(directory,entry.name);
    // An early diagnostic run generated this extra adapter beside the frozen modules; it was not a source file.
    if(file==='src/analysis/capture.ts') {assert.ok((await fs.readFile(old,'utf8')).includes('__captureSections'));continue;}
    if(entry.isDirectory()) await verifyPreservedSource(old,file);
    else if(!changed.has(file)) assert.equal(hash(await fs.readFile(file)),hash(await fs.readFile(old)),'Unexpected source edit: '+file);
  }
}
await verifyPreservedSource(path.join(backup,'source/src'));
const regression=JSON.parse(await fs.readFile(path.join(out,'regression.json'),'utf8'));
const render=JSON.parse(await fs.readFile(path.join(out,'render-verification.json'),'utf8'));
const pipeline=JSON.parse(await fs.readFile(path.join(out,'pipeline-regression.json'),'utf8'));
const checks=JSON.parse(await fs.readFile(path.join(out,'checks.json'),'utf8'));
assert.equal(regression.target.length,3);assert.equal(regression.regressions.length,11);assert.ok(regression.regressions.every(r=>r.unchanged));
assert.equal(render.summary.version,5);assert.equal(render.checks.length,6);assert.deepEqual(render.errors,[]);
assert.equal(pipeline.length,3);assert.ok(pipeline.every(r=>r.beatTimesAndHitsAndEnvelopesUnchanged));
assert.equal(checks.length,3);assert.ok(checks.every(c=>c.code===0));
const lrc=render.lrcPath;assert.equal(hash(await fs.readFile(lrc)),'bd5f95f38e098b9e2ed94a4a07632dd1105bfe0267852d80e1f3926473ca71b6');
assert.equal(hash(await fs.readFile(render.audioPath)),'6de9d0204a15529bd43ec2a0df0428c8884c7d5c8dc39ae114a4bdb9cf044ffb');
const candidate=await fs.readFile(path.join(root,'BetterMV-0.9.0-local-export.plugin'));
const zip=await JSZip.loadAsync(candidate,{checkCRC32:true}),js=await zip.file('bettermv.js').async('nodebuffer');
assert.equal(hash(js),hash(await fs.readFile('dist/plugin/bettermv.js')));
for(const text of ['0.9.0-local-export.9','openFileDialog','utf-16be','local-locked-v1','analysisLines','articulation']) assert.ok(js.includes(Buffer.from(text)),text);
for(const file of [...changed,'src/analysis/contrast.ts','tools/contrast.test.ts','tools/melodic-structure-regression.mjs','tools/melodic-pipeline-regression.mjs','tools/melodic-structure-render.mjs','tools/melodic-structure-diagnose.mjs','tools/check-melodic-release.mjs'])sourceHashes[file]=hash(await fs.readFile(file));
await fs.writeFile(installed,candidate);await fs.writeFile(runtime,js);
assert.equal(hash(await fs.readFile(installed)),hash(candidate));assert.equal(hash(await fs.readFile(runtime)),hash(js));
const report={version:'0.9.0-local-export.9',analysisVersion:5,installed,sha256:hash(candidate),runtime,runtimeSha256:hash(js),previousSha256:previous.sha256,sourceHashes,backup,checks,regressionSummary:{targetInputs:3,unchangedInputs:11,unchangedOtherRecordings:8,annotatedTimeFlies:regression.annotatedTimeFlies},renderChecks:render.checks,recordingAndLrcUnchanged:true,activation:'Completely quit and restart NetEase, reopen MV to reanalyse',limits:render.limit,installedAt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date())+' +08:00'};
await fs.writeFile(path.join(root,'BetterNCM/setup/melodic-structure-20261018.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({installed,version:report.version,sha256:report.sha256}));
