// Install the envelope-backed Drop boundary fix after validating the real D: Rush regression.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const project=process.cwd(),root=path.resolve(project,'..');
const version='0.9.0-local-export.27';
const state=path.join(root,'state/rush-drop-segmentation-20261020');
const candidatePath=path.join(root,'BetterMV-0.9.0-local-export.plugin');
const standalone=path.join(root,'BetterMV-0.9.0-local-export.27-rush-envelope-segmentation.plugin');
const active=path.join(root,'BetterNCM');
const previous=JSON.parse(await fs.readFile(path.join(root,'state/rush-drop-late-boundary-20261020/delivery.json'),'utf8'));
const targets=[
  {file:path.join(active,'plugins/BetterMV-0.9.0-local-export.plugin'),backup:'installed-before/plugin-.26.plugin',kind:'plugin'},
  {file:path.join(active,'plugins_runtime/ncm-better-mv/bettermv.js'),backup:'installed-before/bettermv-.26.js',kind:'javascript'},
  {file:path.join(active,'plugins_runtime/ncm-better-mv/manifest.json'),backup:'installed-before/manifest-.26.json',kind:'manifest'},
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const candidate=await fs.readFile(candidatePath);
const archive=await JSZip.loadAsync(candidate);
const manifestBytes=await archive.file('manifest.json').async('nodebuffer');
const jsBytes=await archive.file('bettermv.js').async('nodebuffer');
const manifest=JSON.parse(manifestBytes.toString('utf8'));
assert.equal(manifest.version,version,'Candidate package version mismatch');
assert.equal(manifest.require_restart,true,'Candidate must retain its restart requirement');
assert.equal(sha(jsBytes),sha(await fs.readFile(path.join(project,'dist/plugin/bettermv.js'))),'Package differs from the built runtime');
assert.ok(jsBytes.includes(Buffer.from(version)),'Runtime bundle is missing its version marker');

const regression=JSON.parse(await fs.readFile(path.join(root,'exports/Rush-form-20261020/regression.json'),'utf8'));
const rush=regression.results.find(item=>item.name==='local');
assert.ok(rush?.lateCutRecovery,'D: Rush late-cut regression did not complete');
assert.ok(Math.abs(rush.lateCutRecovery.detected-192.01)<.08,'D: Rush kick-backed entry is outside the accepted timing window');
assert.ok(Math.abs(rush.lateCutRecovery.withoutDetectedKicks-192.01)<.08,'D: Rush envelope-only backscan is outside the accepted timing window');

const priorManifest=JSON.parse(await fs.readFile(targets[2].file,'utf8'));
assert.equal(priorManifest.version,previous.version,'Active runtime is no longer the diagnosed .26 build');
for(const target of targets){
  const expected=previous.installed.find(item=>item.file===target.file);
  assert.ok(expected,`Missing .26 delivery record for ${target.file}`);
  assert.equal(sha(await fs.readFile(target.file)),expected.sha256,`Active file differs from the diagnosed .26 build: ${target.file}`);
}

await fs.writeFile(standalone,candidate,{flag:'wx'});
await fs.mkdir(path.join(state,'installed-before'),{recursive:true});
const oldFiles=new Map();
for(const target of targets){
  const bytes=await fs.readFile(target.file);
  oldFiles.set(target.file,bytes);
  await fs.writeFile(path.join(state,target.backup),bytes,{flag:'wx'});
}
const replacements=[candidate,jsBytes,manifestBytes];
try{
  for(let i=0;i<targets.length;i++){
    await fs.writeFile(targets[i].file,replacements[i]);
    assert.equal(sha(await fs.readFile(targets[i].file)),sha(replacements[i]),`Installed read-back mismatch: ${targets[i].file}`);
  }
}catch(error){
  for(const [file,bytes] of oldFiles)await fs.writeFile(file,bytes);
  throw error;
}

const installed=await Promise.all(targets.map(async target=>({file:target.file,kind:target.kind,bytes:(await fs.readFile(target.file)).length,sha256:sha(await fs.readFile(target.file))})));
const sourceHashes={};
for(const rel of ['src/analysis/entries.ts','src/analysis/sections.ts','src/plugin/main.ts','tools/drop-preparation.test.ts','tools/rush-form-regression.mjs','exporter/build-plugin.mjs'])sourceHashes[rel]=sha(await fs.readFile(path.join(project,rel)));
const audio='D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3';
const report={
  version,installedAt:new Date().toISOString(),
  rootCause:'The .26 correction depended on a strong kick event to discover the earlier entry. If that event was absent or below threshold, the later supported coarse boundary stayed in place.',
  fix:'Backscan the decoded bass, treble and RMS envelopes directly for a sustained attack; keep kick-based forward correction for early coarse cuts. Record the raw section cuts and per-candidate rejection metrics for Rush diagnostics.',
  standalone,pluginSha256:sha(candidate),runtimeBundleSha256:sha(jsBytes),manifestSha256:sha(manifestBytes),installed,
  activePaths:targets.map(target=>target.file),backupDirectory:path.join(state,'installed-before'),sourceHashes,
  inputAudio:audio,inputAudioSha256:sha(await fs.readFile(audio)),regression:{file:path.join(root,'exports/Rush-form-20261020/regression.json'),entryWithKicks:rush.lateCutRecovery.detected,entryWithoutDetectedKicks:rush.lateCutRecovery.withoutDetectedKicks},
  requiresRestart:true,liveProcessLoaded:false,liveStreamRecheck:'Pending a fresh Rush analysis; .26 diagnostic lacked raw envelopes and candidate rejection details.'
};
await fs.writeFile(path.join(state,'delivery.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({version,pluginSha256:report.pluginSha256,runtimeBundleSha256:report.runtimeBundleSha256,installed,standalone,backupDirectory:report.backupDirectory}));
