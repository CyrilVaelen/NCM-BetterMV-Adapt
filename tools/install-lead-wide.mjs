import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {PROJECT,loadSettings} from '../exporter/server.mjs';

const root=path.resolve(PROJECT,'..'),name='BetterMV-0.9.0-local-export.plugin';
const backup=path.join(root,'BetterNCM/setup/before-lead-wide-20261016');
const installed=path.join(root,'BetterNCM/plugins',name),built=await fs.readFile(path.join(root,name));
const hash=data=>createHash('sha256').update(data).digest('hex');
const baseline=JSON.parse(await fs.readFile(path.join(backup,'baseline.json'),'utf8'));
const previous=baseline['../BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin'];
assert.equal(hash(await fs.readFile(installed)),previous,'Installed plugin changed since backup.');
assert.equal(hash(await fs.readFile(path.join(backup,name))),previous,'Backup hash mismatch.');
const fixture=path.join(root,'exports/Homura-whole-song-lead');
const verification=JSON.parse(await fs.readFile(path.join(fixture,'verification.json'),'utf8'));
const video=JSON.parse(await fs.readFile(path.join(fixture,'video-validation.json'),'utf8'));
const paper=JSON.parse(await fs.readFile(path.join(fixture,'selected-verification.json'),'utf8'));
const audio=JSON.parse(await fs.readFile(path.join(fixture,'audio-validation.json'),'utf8'));
assert.deepEqual(verification.errors,[]);
assert.equal(new Set(verification.sceneChecks.map(c=>c.scene)).size,14);
assert.ok(verification.sceneChecks.every(c=>c.label!=='drop'&&c.overlayHidden&&c.meanAbsoluteDifference>0.02&&c.changedPixelFraction>0.001));
assert.equal(verification.clips.length,4);
assert.equal(video.streams.find(s=>s.codec_type==='video').nb_frames,'240');
assert.equal(video.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
assert.deepEqual(paper.errors,[]);
assert.ok(paper.sceneChecks.some(c=>c.scene==='ridges'&&c.style==='ink'&&c.overlayHidden&&c.meanAbsoluteDifference>0.02));
assert.ok(audio.meanDbFS>-70,'The comparison audio is silent.');
const zip=await JSZip.loadAsync(built),code=await zip.file('bettermv.js').async('string');
const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
const old=await JSZip.loadAsync(await fs.readFile(installed)),oldManifest=JSON.parse(await old.file('manifest.json').async('string'));
assert.equal(manifest.slug,oldManifest.slug);
const settings=await loadSettings();
assert.ok(code.includes(settings.token),'Export integration token was not preserved.');
for(const value of ['0.9.0-local-export.3','uLeadSwell','leadBrightness','/api/exports'])assert.ok(code.includes(value),`Missing ${value}`);
const evidence={version:'0.9.0-local-export.3',installed,sha256:hash(built),previousSha256:previous,backup,
  installedAt:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})+' +08:00',
  activation:'Restart NetEase Cloud Music',checks:{typecheck:'passed',leadDSPTests:5,exportAPITests:2,verification,paper,video,audio}};
const temp=`${installed}.${randomUUID()}.pending`;
try{await fs.writeFile(temp,built,{flag:'wx'});await fs.rename(temp,installed);}finally{await fs.rm(temp,{force:true});}
assert.equal(hash(await fs.readFile(installed)),evidence.sha256);
const report=path.join(root,'BetterNCM/setup/lead-whole-song-20261016.json');
await fs.writeFile(report,JSON.stringify(evidence,null,2));
console.log(JSON.stringify({version:evidence.version,installed,sha256:evidence.sha256,report}));
