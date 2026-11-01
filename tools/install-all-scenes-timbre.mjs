import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const project=process.cwd(),root=path.resolve('..'),backup=path.join(root,'state/before-all-scenes-timbre-20261018');
const installed='D:/NCM/BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin';
const runtime='D:/NCM/BetterNCM/plugins_runtime/ncm-better-mv/bettermv.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const oldPlugin=await fs.readFile(path.join(backup,'BetterMV-0.9.0-local-export.plugin'));
const oldRuntime=await fs.readFile(path.join(backup,'bettermv.js'));
assert.equal(hash(await fs.readFile(installed)),hash(oldPlugin),'Installed plugin changed from the .10 snapshot');
assert.equal(hash(await fs.readFile(runtime)),hash(oldRuntime),'Installed runtime changed from the .10 snapshot');

const changed=new Set([
  'src/director/music.ts','src/director/overlay.ts','src/director/director.ts',
  'src/scenes/aurora.ts','src/scenes/canvas.ts','src/scenes/channel.ts','src/scenes/city.ts','src/scenes/debug.ts',
  'src/scenes/drill.ts','src/scenes/drive.ts','src/scenes/fractal.ts','src/scenes/halftone.ts','src/scenes/kaleido.ts',
  'src/scenes/neon.ts','src/scenes/orb.ts','src/scenes/particles.ts','src/scenes/pillars.ts','src/scenes/relief.ts',
  'src/scenes/ridges.ts','src/scenes/ripple.ts','src/scenes/shatter.ts','src/scenes/subdivide.ts','src/scenes/tunnel.ts',
  'src/scenes/typewall.ts','exporter/build-plugin.mjs','tools/package-complete.mjs',
]);
async function files(dir,relative='') {
  const out=[];
  for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    const name=relative?relative+'/'+entry.name:entry.name,full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...await files(full,name));else out.push(name.replace(/\\/g,'/'));
  }
  return out;
}
const baselineSrc=path.join(backup,'src'),sourceSrc=path.join(project,'src');
const before=await files(baselineSrc),after=await files(sourceSrc);
assert.deepEqual(after.slice().sort(),before.slice().sort(),'Source file set changed');
for(const file of before) if(!changed.has('src/'+file)) {
  assert.equal(hash(await fs.readFile(path.join(sourceSrc,file))),hash(await fs.readFile(path.join(baselineSrc,file))),'Unexpected source change: '+file);
}

const candidate=await fs.readFile(path.join(root,'BetterMV-0.9.0-local-export.plugin'));
const zip=await JSZip.loadAsync(candidate,{checkCRC32:true});
const js=await zip.file('bettermv.js').async('nodebuffer');
assert.equal(hash(js),hash(await fs.readFile('dist/plugin/bettermv.js')),'Bundle and plugin archive differ');
for(const text of ['0.9.0-local-export.11','roleHits','synthStab','bassStab','foregroundAt','openFileDialog']) assert.ok(js.includes(Buffer.from(text)),'Plugin missing '+text);

await fs.writeFile(installed,candidate);
await fs.writeFile(runtime,js);
const pluginHash=hash(await fs.readFile(installed)),runtimeHash=hash(await fs.readFile(runtime));
assert.equal(pluginHash,hash(candidate));assert.equal(runtimeHash,hash(js));

const sourceHashes={};
for(const file of await files(sourceSrc)) sourceHashes['src/'+file]=hash(await fs.readFile(path.join(sourceSrc,file)));
for(const file of ['exporter/build-plugin.mjs','tools/package-complete.mjs']) sourceHashes[file]=hash(await fs.readFile(file));
const report={
  version:'0.9.0-local-export.11',analysisVersion:6,installed,sha256:pluginHash,runtime,runtimeSha256:runtimeHash,
  previousSha256:hash(oldPlugin),sourceHashes,backup,changedFiles:[...changed],
  scope:'All scene and visual pulse inputs use the available synth stab, bass stab and lead role estimates throughout the song. Drum pulse remains a low rhythm bed; older analyses retain legacy behavior.',
  validation:{sourceBundleHashesMatch:true,zipCrc32Checked:true,releaseTestsRun:false,reason:'No functional test or client-render check was requested in this turn.'},
  activation:'Completely quit and restart NetEase, then reopen the MV so the whole song is analysed again.',
  installedAt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date())+' +08:00',
};
await fs.writeFile(path.join(root,'BetterNCM/setup/all-scenes-timbre-20261018.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({version:report.version,installed,sha256:pluginHash,runtimeSha256:runtimeHash,changedFiles:changed.size}));
