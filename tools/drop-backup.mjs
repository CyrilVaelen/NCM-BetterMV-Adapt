import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PROJECT} from '../exporter/server.mjs';

const root=path.resolve(PROJECT,'..'),backup=path.join(root,'BetterNCM/setup/before-drop-response-20261017');
const hash=b=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(backup,{recursive:true});
const hashes={};
async function copy(dir,relative){
  for(const item of await fs.readdir(dir,{withFileTypes:true})){
    const rel=path.posix.join(relative,item.name),source=path.join(dir,item.name);
    if(item.isDirectory())await copy(source,rel);
    else {const data=await fs.readFile(source),target=path.join(backup,'source',rel);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data,{flag:'wx'});hashes[rel]=hash(data);}
  }
}
await copy(path.join(PROJECT,'src'),'src');
for(const file of ['exporter/build-plugin.mjs','tools/lead.test.ts','tools/package-complete.mjs','tools/package-desktop.mjs']){
  const data=await fs.readFile(path.join(PROJECT,file)),target=path.join(backup,'source',file);
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data,{flag:'wx'});hashes[file]=hash(data);
}
const installed=path.join(root,'BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin'),data=await fs.readFile(installed);
await fs.writeFile(path.join(backup,'BetterMV-0.9.0-local-export.plugin'),data,{flag:'wx'});
await fs.writeFile(path.join(backup,'baseline.json'),JSON.stringify({installed,installedSha256:hash(data),sourceHashes:hashes,baselineTests:{passed:16,failed:1,failure:'flat broadband spectra are weaker than equally loud sustained harmonics'}},null,2),{flag:'wx'});
console.log(JSON.stringify({backup,installedSha256:hash(data),sourceFiles:Object.keys(hashes).length}));
