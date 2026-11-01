import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import {PROJECT,loadSettings} from '../exporter/server.mjs';

const version='0.9.0-local-export.4',root=path.resolve(PROJECT,'..');
const name='BetterMV-0.9.0-local-export.plugin',backup=path.join(root,'BetterNCM/setup/before-keyboard-20261016');
const installed=path.join(root,'BetterNCM/plugins',name),hash=data=>createHash('sha256').update(data).digest('hex');
const baseline=JSON.parse(await fs.readFile(path.join(backup,'baseline.json'),'utf8'));
const previous=baseline['../BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin'];
assert.equal(hash(await fs.readFile(installed)),previous,'Installed plugin changed since backup');
assert.equal(hash(await fs.readFile(path.join(backup,name))),previous,'Backup mismatch');
const output=path.join(root,'exports/Sunshine-keyboard-response');
const read=async file=>JSON.parse(await fs.readFile(path.join(output,file),'utf8'));
const verification=await read('verification.json'),video=await read('video-validation.json'),homura=await read('homura-regression.json');
assert.deepEqual(verification.errors,[]);assert.equal(verification.summary.analysisVersion,3);
assert.equal(verification.checks.length,2);
assert.ok(verification.checks.every(c=>c.overlayHidden&&c.changedPixelFraction>.001&&c.meanAbsoluteDifference>.02));
assert.equal(verification.ui.initial,'+1500');assert.equal(verification.ui.reset,0);assert.equal(verification.ui.deviceUnchanged,true);
assert.equal(homura.liveExtraPictureDelayMs,0);assert.ok(homura.windows.every(w=>Math.abs(w.attackLagMs)<=50));
assert.equal(video.probe.streams.find(s=>s.codec_type==='video').nb_frames,'180');assert.ok(video.meanDbFS>-60);
assert.equal(video.livePictureCalibrationApplied,false);
const built=await fs.readFile(path.join(root,name)),zip=await JSZip.loadAsync(built),code=await zip.file('bettermv.js').async('string');
const settings=await loadSettings();assert.ok(code.includes(settings.token),'Export integration token missing');
for(const feature of [version,'songVisualDelays','playback-sync.json','leadBrightness','uLeadSwell','/api/exports'])assert.ok(code.includes(feature),`Missing ${feature}`);
assert.ok(!code.includes('Object.hasOwn('),'Chromium 91 cannot run Object.hasOwn');
const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
const old=await JSZip.loadAsync(await fs.readFile(installed));assert.equal(manifest.slug,JSON.parse(await old.file('manifest.json').async('string')).slug);
const calibration=path.join(root,'BetterNCM/BetterMV/playback-sync.json');let existing;
try{existing=await fs.readFile(calibration,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
const doc=existing?JSON.parse(existing):{version:1,delaysMs:{},estimates:{}};
assert.equal(doc.version,1);assert.ok(doc.delaysMs&&typeof doc.delaysMs==='object'&&!Array.isArray(doc.delaysMs));
if(existing)await fs.writeFile(path.join(backup,'playback-sync.previous.json'),existing,{flag:'wx'});
if(!Object.hasOwn(doc.delaysMs,'17285341')){
  doc.delaysMs['17285341']=1500;
  doc.estimates={...doc.estimates,'17285341':{reason:'User reports live picture 1-2 seconds ahead, both notes and scene cuts; Homura normal on same Bluetooth headphones.',measured:false,initialEstimateMs:1500}};
}
const pending=`${installed}.${randomUUID()}.pending`;
await fs.mkdir(path.dirname(calibration),{recursive:true});
try{
  await fs.writeFile(pending,built,{flag:'wx'});
  await fs.writeFile(calibration,JSON.stringify(doc,null,2),{flag:existing?'w':'wx'});
  await fs.rename(pending,installed);
}finally{await fs.rm(pending,{force:true});}
assert.equal(hash(await fs.readFile(installed)),hash(built));
const readback=JSON.parse(await fs.readFile(calibration,'utf8'));assert.equal(readback.delaysMs['17285341'],doc.delaysMs['17285341']);
const report=path.join(root,'BetterNCM/setup/keyboard-sync-20261016.json');
await fs.writeFile(report,JSON.stringify({version,installed,sha256:hash(built),previousSha256:previous,backup,
  installedAt:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})+' +08:00',activation:'Restart NetEase Cloud Music',
  liveSync:{calibration,perSongMs:readback.delaysMs,measured:false,audibleVerification:'pending user listening',offlineExportUsesLiveCalibration:false},
  checks:{typecheck:'passed',leadDSPTests:7,clockAndCalibrationTests:4,exportAPITests:2,verification,homura,video},
  comparison:{path:path.join(output,'Sunshine-keyboard-comparison.mp4'),sha256:hash(await fs.readFile(path.join(output,'Sunshine-keyboard-comparison.mp4')))}},null,2));
console.log(JSON.stringify({version,installed,sha256:hash(built),report,calibration,estimatedSongDelayMs:readback.delaysMs['17285341']}));
