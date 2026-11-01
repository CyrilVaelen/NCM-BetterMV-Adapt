import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import {PROJECT,loadSettings} from '../exporter/server.mjs';

const root=path.resolve(PROJECT,'..'),version='0.9.0-local-export.5',name='BetterMV-0.9.0-local-export.plugin';
const backup=path.join(root,'BetterNCM/setup/before-structure-20261016'),installed=path.join(root,'BetterNCM/plugins',name);
const digest=data=>createHash('sha256').update(data).digest('hex');
const baseline=JSON.parse(await fs.readFile(path.join(backup,'baseline.json'),'utf8')),oldHash=baseline['../BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin'];
assert.equal(digest(await fs.readFile(installed)),oldHash,'Installed package changed since backup');
assert.equal(digest(await fs.readFile(path.join(backup,name))),oldHash,'Backup mismatch');
const output=path.join(root,'exports/Sunshine-structure-response'),read=async name=>JSON.parse(await fs.readFile(path.join(output,name),'utf8'));
const verification=await read('verification.json'),regression=await read('regression.json'),plans=await read('plan-regression.json'),video=await read('video-validation.json');
assert.deepEqual(verification.errors,[]);assert.equal(verification.forcedScene,false);assert.equal(verification.pictureOffsetMs,0);
assert.equal(verification.checks.length,4);assert.ok(verification.checks.every(c=>c.after.pre.label!=='drop'&&c.after.attack.label==='drop'&&c.after.attack.zoom>.75));
assert.equal(verification.migration.sunshineMs,0);assert.equal(verification.migration.persisted['17285341'],0);
assert.equal(regression.find(r=>r.name==='Sunshine').changed.length,4);assert.deepEqual(regression.find(r=>r.name==='Homura').changed,[]);
assert.ok(regression.every(r=>r.beatTimesUnchanged&&r.hitTimesUnchanged&&r.envelopesUnchanged));assert.equal(plans.length,4);
assert.equal(video.probe.streams.find(s=>s.codec_type==='video').nb_frames,'240');assert.equal(video.probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');assert.ok(video.meanDbFS>-60);assert.equal(video.pictureOffsetMs,0);
const calibration=path.join(root,'BetterNCM/BetterMV/playback-sync.json'),cal=JSON.parse(await fs.readFile(calibration,'utf8'));
assert.equal(cal.delaysMs['17285341'],0);assert.equal(cal.resetEstimatedMs['17285341'],1500);assert.equal(cal.revision,verification.migration.revision);
const bytes=await fs.readFile(path.join(root,name)),zip=await JSZip.loadAsync(bytes),code=await zip.file('bettermv.js').async('string'),settings=await loadSettings();
for(const feature of [version,'resetEstimatedMs','pictureCalibrationRevision','uLeadSwell','leadBrightness','/api/exports'])assert.ok(code.includes(feature),`Missing ${feature}`);
assert.ok(code.includes(settings.token));assert.ok(!code.includes('Object.hasOwn('));
const manifest=JSON.parse(await zip.file('manifest.json').async('string')),previous=await JSZip.loadAsync(await fs.readFile(installed));
assert.equal(manifest.slug,JSON.parse(await previous.file('manifest.json').async('string')).slug);
const pending=`${installed}.${randomUUID()}.pending`;
try{await fs.writeFile(pending,bytes,{flag:'wx'});await fs.rename(pending,installed);}finally{await fs.rm(pending,{force:true});}
assert.equal(digest(await fs.readFile(installed)),digest(bytes));
const sourceHashes={};
for(const file of ['src/analysis/entries.ts','src/analysis/sections.ts','src/analysis/index.ts','src/plugin/playback-sync.ts','src/plugin/clock.ts','src/director/director.ts'])sourceHashes[file]=digest(await fs.readFile(path.join(PROJECT,file)));
const report=path.join(root,'BetterNCM/setup/structure-response-20261016.json');
await fs.writeFile(report,JSON.stringify({version,installed,sha256:digest(bytes),previousSha256:oldHash,backup,sourceHashes,
  installedAt:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})+' +08:00',activation:'Restart NetEase Cloud Music',
  change:'Audio-confirmed instrumental entries and local Drop bar phase; no media time offset',
  calibration:{file:calibration,initialSunshineMs:0,withdrawOldEstimateMs:1500,migrationVerified:true},
  checks:{typecheck:'passed',unitTests:17,exportAPITests:2,verification,regression,plans,video},
  comparison:{path:path.join(output,'Sunshine-2m11-structure-comparison.mp4'),sha256:digest(await fs.readFile(path.join(output,'Sunshine-2m11-structure-comparison.mp4')))}},null,2));
console.log(JSON.stringify({version,installed,sha256:digest(bytes),report,SunshinePictureOffsetMs:0,withdrawOldEstimate:true}));
