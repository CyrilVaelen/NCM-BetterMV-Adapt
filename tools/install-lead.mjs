// One-time guarded update of the user's existing local plugin.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const name='BetterMV-0.9.0-local-export.plugin';
const source=path.join(root,name),installed=path.join(root,'BetterNCM/plugins',name);
const backup=path.join(root,'BetterNCM/setup/before-lead-20261016');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const baseline=JSON.parse(await fs.readFile(path.join(backup,'baseline.json'),'utf8'));
assert.equal(hash(await fs.readFile(installed)),baseline.installed_plugin,'The installed plugin changed since backup; inspect it before replacing.');
assert.equal(hash(await fs.readFile(path.join(backup,name))),baseline.installed_plugin,'Backup does not match the installed baseline.');
const built=await fs.readFile(source),zip=await JSZip.loadAsync(built);
const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
const code=await zip.file('bettermv.js').async('string');
assert.ok(manifest.name.includes('本地增强'));
assert.ok(code.includes('0.9.0-local-export.2'));
for(const feature of ['leadBrightness','leadAttack','/api/exports'])assert.ok(code.includes(feature),`Missing feature: ${feature}`);
const temp=`${installed}.${randomUUID()}.pending`;
try{await fs.writeFile(temp,built,{flag:'wx'});await fs.rename(temp,installed);}finally{await fs.rm(temp,{force:true});}
assert.equal(hash(await fs.readFile(installed)),hash(built));
const evidence={version:'0.9.0-local-export.2',installed,sha256:hash(built),backup,previousSha256:baseline.installed_plugin,
  installedAt:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})+' +08:00',activation:'Restart NetEase Cloud Music to load the new plugin',
  checks:{typecheck:'passed',leadDSPTests:5,exportAPITests:2,preview1:JSON.parse(await fs.readFile(path.join(root,'exports/Homura-lead-comparison/verification.json'),'utf8')),preview2:JSON.parse(await fs.readFile(path.join(root,'exports/Homura-lead-comparison-drop2/verification.json'),'utf8'))}};
const report=path.join(root,'BetterNCM/setup/lead-enhancement-20261016.json');
await fs.writeFile(report,JSON.stringify(evidence,null,2));
console.log(JSON.stringify({installed,sha256:evidence.sha256,report,activation:evidence.activation}));
