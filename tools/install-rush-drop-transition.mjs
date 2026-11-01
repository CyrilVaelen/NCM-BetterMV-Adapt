import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';

const project=process.cwd(),root=path.resolve(project,'..'),version='0.9.0-local-export.28';
const state=path.join(root,'state/rush-drop-transition-20261021');
const out=path.join(root,'exports/Rush-drop-transition-20261021');
const sha=b=>createHash('sha256').update(b).digest('hex');
const baseline=JSON.parse(await fs.readFile(path.join(state,'baseline.json'),'utf8'));
const verification=JSON.parse(await fs.readFile(path.join(out,'verification.json'),'utf8'));
assert.equal(verification.prepared.entry,192.01);
assert.equal(verification.fps,60);assert.ok(verification.frameCountPerSide>=72);
assert.ok(verification.summary.before.blackoutFrames>0);
assert.equal(verification.summary.after.blackoutFrames,0);assert.equal(verification.summary.after.impactFrames,0);assert.equal(verification.summary.after.flatDarkFrames,0);
assert.deepEqual(verification.errors,[]);
const walk=async dir=>(await Promise.all((await fs.readdir(dir,{withFileTypes:true})).map(item=>item.isDirectory()?walk(path.join(dir,item.name)):[path.join(dir,item.name)]))).flat();
const sourceHashes={},changed=[];
for(const file of await walk(path.join(project,'src'))){
  const relative=path.relative(project,file).replaceAll('\\','/'),hash=sha(await fs.readFile(file));sourceHashes[relative]=hash;
  if(hash!==sha(await fs.readFile(path.join(state,'baseline',relative))))changed.push(relative);
}
assert.deepEqual(changed.sort(),['src/director/director.ts','src/render/shots.ts','src/style/style.ts'].sort(),'Unexpected concurrent production edit: inspect before installing');
for(const rel of changed)assert.equal(sourceHashes[rel],verification.renderedSourceHashes[rel],`Source changed since visual verification: ${rel}`);
const candidate=await fs.readFile(path.join(root,'BetterMV-0.9.0-local-export.plugin')),archive=await JSZip.loadAsync(candidate);
const js=await archive.file('bettermv.js').async('nodebuffer'),manifestBytes=await archive.file('manifest.json').async('nodebuffer');
const manifest=JSON.parse(manifestBytes.toString('utf8'));
assert.equal(manifest.version,version);assert.equal(manifest.require_restart,true);
assert.equal(sha(js),sha(await fs.readFile(path.join(project,'dist/plugin/bettermv.js'))));
assert.ok(js.includes(Buffer.from(version)));
for(const file of baseline.installed){
  assert.equal(sha(await fs.readFile(file.file)),file.sha256,`Active .27 changed since snapshot: ${file.file}`);
  assert.equal(sha(await fs.readFile(path.join(state,'installed-before',path.basename(file.file)))),file.sha256,'Backup differs from .27');
}
const standalone=path.join(root,'BetterMV-0.9.0-local-export.28-drop-transition.plugin');
await fs.writeFile(standalone,candidate,{flag:'wx'});
const replacements=[candidate,js,manifestBytes],old=new Map();
try{
  for(let i=0;i<baseline.installed.length;i++){
    const file=baseline.installed[i].file;old.set(file,await fs.readFile(file));await fs.writeFile(file,replacements[i]);
    assert.equal(sha(await fs.readFile(file)),sha(replacements[i]),`Installed read-back mismatch: ${file}`);
  }
}catch(error){for(const [file,bytes] of old)await fs.writeFile(file,bytes);throw error;}
const installed=await Promise.all(baseline.installed.map(async item=>({file:item.file,sha256:sha(await fs.readFile(item.file))})));
const report={version,installedAt:new Date().toISOString(),standalone,installed,pluginSha256:sha(candidate),runtimeBundleSha256:sha(js),manifestSha256:sha(manifestBytes),backupDirectory:path.join(state,'installed-before'),sourceHashes,changedProductionFiles:changed,analysisAndLyricsSourceUnchanged:true,sectionBoundary:verification.prepared.entry,renderVerification:path.join(out,'verification.json'),visualSummary:verification.summary,tests:{related:35,failed:0,typecheck:'passed'},requiresRestart:true,liveProcessLoaded:false,activation:'Fully close and reopen NetEase after this .28 disk deployment; the prior confirmed live build was .27.'};
await fs.writeFile(path.join(state,'delivery.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({version,installed,backupDirectory:report.backupDirectory,visualSummary:report.visualSummary}));
