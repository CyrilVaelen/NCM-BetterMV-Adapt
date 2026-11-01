import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const project=process.cwd(),root=path.resolve('..');
const backup=path.join(root,'state/before-lead-priority-20261018');
const installed='D:/NCM/BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin';
const runtime='D:/NCM/BetterNCM/plugins_runtime/ncm-better-mv/bettermv.js';
const evidence=path.join(root,'exports/Lights-Out-lead-priority-20261018/render-verification.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseline=JSON.parse(await fs.readFile(path.join(backup,'baseline.json'),'utf8'));
assert.equal(baseline.version,'0.9.0-local-export.11');
assert.equal(hash(await fs.readFile(installed)),baseline.installedPluginSha256,'Installed plugin changed from the .11 baseline');
assert.equal(hash(await fs.readFile(runtime)),baseline.installedRuntimeSha256,'Installed runtime changed from the .11 baseline');

const changed=new Set(['src/director/music.ts','src/scenes/channel.ts','src/scenes/drive.ts','src/scenes/tunnel.ts']);
async function files(dir,relative='') {
  const out=[];
  for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    const name=relative?relative+'/'+entry.name:entry.name,full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...await files(full,name));else out.push(name.replace(/\\/g,'/'));
  }
  return out;
}
const before=(await files(path.join(backup,'source/src'))).sort(),after=(await files(path.join(project,'src'))).sort();
assert.deepEqual(after,before,'Source file set changed');
for(const file of before)if(!changed.has('src/'+file))
  assert.equal(hash(await fs.readFile(path.join(project,'src',file))),hash(await fs.readFile(path.join(backup,'source/src',file))),'Unexpected source change: '+file);

const rendered=JSON.parse(await fs.readFile(evidence,'utf8'));
assert.deepEqual(rendered.errors,[],'Browser render reported errors');
assert.deepEqual(rendered.summary.priorityStats.map(s=>[s.bassEvents,s.leadPrioritySuppressed,s.bassOnlyEvents]),[[66,60,6],[114,93,21]]);
for(const scene of ['tunnel','drive'])for(const t of [67.933,202.433]) {
  const frame=rendered.checks.find(x=>x.scene===scene&&x.t===t);
  assert.ok(frame&&frame.foreground.level>.15&&frame.foreground.attack>.2&&frame.bassEvents.length===0&&frame.leadEvents.length>0,scene+' overlap evidence failed at '+t);
}
assert.ok(rendered.checks.some(x=>x.scene==='tunnel'&&x.t===rendered.summary.bassOnly&&x.bassEvents.length>0),'Bass-only tunnel response was lost');

const candidate=await fs.readFile(path.join(root,'BetterMV-0.9.0-local-export.plugin'));
const zip=await JSZip.loadAsync(candidate,{checkCRC32:true});
const js=await zip.file('bettermv.js').async('nodebuffer');
assert.equal(hash(js),hash(await fs.readFile('dist/plugin/bettermv.js')),'Plugin archive differs from the built bundle');
for(const token of ['0.9.0-local-export.12','prefersLeadOverBass','roleHits','leadBrightness'])assert.ok(js.includes(Buffer.from(token)),'Built plugin is missing '+token);

await fs.writeFile(installed,candidate);
await fs.writeFile(runtime,js);
const pluginHash=hash(await fs.readFile(installed)),runtimeHash=hash(await fs.readFile(runtime));
assert.equal(pluginHash,hash(candidate));assert.equal(runtimeHash,hash(js));

const sourceHashes={};
for(const file of after)sourceHashes['src/'+file]=hash(await fs.readFile(path.join(project,'src',file)));
for(const file of ['exporter/build-plugin.mjs','tools/package-complete.mjs','tools/install-lead-priority.mjs','tools/timbre.test.ts'])
  sourceHashes[file]=hash(await fs.readFile(file));
const audio='D:/野葱视频转换器/音频转换/Blanke,RUNN - Lights Out.mp3';
const lyric='D:/CloudMusic/VipSongsDownload/Blanke,RUNN - Lights Out.lrc';
const report={
  version:'0.9.0-local-export.12',analysisVersion:6,installed,sha256:pluginHash,runtime,runtimeSha256:runtimeHash,
  previousSha256:baseline.installedPluginSha256,sourceHashes,backup,changedFiles:[...changed],
  audio:{path:audio,bytes:(await fs.stat(audio)).size,sha256:hash(await fs.readFile(audio))},
  lyric:{path:lyric,bytes:(await fs.stat(lyric)).size,sha256:hash(await fs.readFile(lyric))},
  validation:{unitTests:'tools/timbre.test.ts: 10 passed',typecheck:'npm run typecheck: passed',browser:rendered.summary,scenes:['tunnel','drive'],errors:[]},
  scope:'When a bright lead and bass stab overlap, foreground envelope, attack, brightness and shared event hits prioritize the lead; bass-only events remain. Timbre roles remain estimates from the stereo mix.',
  activation:'Completely quit and restart NetEase, then reopen the MV so the track is analysed again.',
  installedAt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date())+' +08:00',
};
await fs.writeFile(path.join(root,'BetterNCM/setup/lead-priority-20261018.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({version:report.version,installed,sha256:pluginHash,runtimeSha256:runtimeHash,changedFiles:changed.size}));
