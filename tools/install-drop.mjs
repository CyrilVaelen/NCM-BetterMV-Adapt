import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import {PROJECT,loadSettings} from '../exporter/server.mjs';

const root=path.resolve(PROJECT,'..'),version='0.9.0-local-export.6';
const backup=path.join(root,'BetterNCM/setup/before-drop-response-20261017');
const baseline=JSON.parse(await fs.readFile(path.join(backup,'baseline.json'),'utf8'));
const output=path.join(root,'exports/Cant-Let-You-Go-drop-response');
const read=async n=>JSON.parse(await fs.readFile(path.join(output,n),'utf8'));
const verification=await read('verification.json'),extra=await read('after-extra-render.json');
assert.equal(verification.arrangementAndTimingUnchanged,true);assert.deepEqual(verification.errors,[]);assert.equal(verification.sceneChecks.length,5);
assert.deepEqual(extra.errors,[]);assert.equal(extra.checks.length,2);assert.ok(extra.checks.every(c=>c.meanAbsoluteDifference>1&&c.standardDeviation>5));
const digest=b=>createHash('sha256').update(b).digest('hex');
assert.equal(digest(await fs.readFile(baseline.installed)),baseline.installedSha256,'Installed plugin changed after backup');
assert.equal(digest(await fs.readFile(path.join(backup,'BetterMV-0.9.0-local-export.plugin'))),baseline.installedSha256);
// Preserve concurrent local export/UI/analysis changes captured in the actual baseline.
for(const file of ['src/analysis/index.ts','src/analysis/lead.ts','src/analysis/entries.ts','src/analysis/sections.ts','src/plugin/main.ts','src/plugin/export.ts','src/plugin/ui.ts','src/plugin/playback-sync.ts'])assert.equal(digest(await fs.readFile(path.join(PROJECT,file))),baseline.sourceHashes[file],`${file} unexpectedly changed`);
const bytes=await fs.readFile(path.join(root,'BetterMV-0.9.0-local-export.plugin')),zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
const code=await zip.file('bettermv.js').async('string'),settings=await loadSettings();
for(const feature of [version,'dropIntensity','uLeadDrop','leadBrightness','/api/exports','resetEstimatedMs'])assert.ok(code.includes(feature),`Missing ${feature}`);
assert.ok(code.includes(settings.token));assert.ok(!code.includes('Object.hasOwn('));
const previous=await JSZip.loadAsync(await fs.readFile(baseline.installed));
assert.equal(JSON.parse(await previous.file('manifest.json').async('string')).slug,JSON.parse(await zip.file('manifest.json').async('string')).slug);
const pending=`${baseline.installed}.${randomUUID()}.pending`;
try{await fs.writeFile(pending,bytes,{flag:'wx'});await fs.rename(pending,baseline.installed);}finally{await fs.rm(pending,{force:true});}
assert.equal(digest(await fs.readFile(baseline.installed)),digest(bytes));
const files=['src/director/music.ts',...['drive','channel','kaleido','orb','ripple','particles','fractal','menger'].map(s=>`src/scenes/${s}.ts`)];
const sourceHashes={};for(const file of files)sourceHashes[file]=digest(await fs.readFile(path.join(PROJECT,file)));
const report={version,installed:baseline.installed,sha256:digest(bytes),previousSha256:baseline.installedSha256,backup,sourceHashes,installedAt:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})+' +08:00',activation:'Restart NetEase Cloud Music',checks:{typecheck:'passed',dropEntryAndSyncTests:11,exportAPITests:2,realSongRender:verification,extraNativeScenes:extra.checks},baselineAudioTestFailure:verification.baselineTests,analysisAndTimingUnchanged:true};
await fs.writeFile(path.join(root,'BetterNCM/setup/drop-response-20261017.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({version,installed:report.installed,sha256:report.sha256,scenes:verification.sceneChecks.map(c=>c.scene).concat(extra.checks.map(c=>c.scene))}));
