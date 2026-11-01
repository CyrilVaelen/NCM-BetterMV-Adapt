import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import crc32 from 'jszip/lib/crc32.js';

const root=path.resolve('..'),build=JSON.parse(await fs.readFile(path.join(root,'state/full-package-build.json'),'utf8'));
const zipBytes=await fs.readFile(build.output),hash=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(hash(zipBytes),build.sha256);
const zip=await JSZip.loadAsync(zipBytes),testRoot=await fs.mkdtemp(path.join(root,'state/full-package-verify-'));
assert.ok(path.resolve(testRoot).startsWith(path.join(root,'state')+path.sep));
let count=0;
for(const entry of Object.values(zip.files)){
  if(entry.dir)continue;
  const target=path.resolve(testRoot,entry.name),relative=path.relative(testRoot,target);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  const bytes=await entry.async('nodebuffer');assert.equal(crc32(bytes)|0,entry._data.crc32|0,entry.name);
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);count++;
}
assert.equal(count,build.fileCount);
const bundle=path.join(testRoot,'BetterMV-Full'),release=JSON.parse(await fs.readFile(path.join(bundle,'release.json'),'utf8'));
assert.equal(hash(await fs.readFile(path.join(bundle,'BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin'))),release.pluginSha256);
for(const [file,digest] of Object.entries(release.sourceHashes))assert.equal(hash(await fs.readFile(path.join(bundle,'NCM-BetterMV-0.9.0',file))),digest);
const run=async args=>{
  const child=spawn(path.join(bundle,'runtime/node.exe'),args,{cwd:bundle,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',x=>{out+=x;process.stdout.write(x);});child.stderr.on('data',x=>{err+=x;process.stderr.write(x);});
  assert.equal((await once(child,'close'))[0],0,err);return out;
};
console.log(JSON.stringify({extractedFiles:count,bundle}));
await run(['start-service.mjs','--check']);await run(['self-test.mjs']);
const result=JSON.parse(await fs.readFile(path.join(bundle,'verification/full-package-test.json'),'utf8'));
const evidence={...build,extractedFiles:count,allFileCRCsVerified:true,pluginAndSourceHashesVerified:true,bundle,test:result};
await fs.writeFile(path.join(root,'state/full-package-verification.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({verified:true,archive:build.output,bytes:build.bytes,report:path.join(root,'state/full-package-verification.json'),testVideo:result.export.outputPath}));
