import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const checks=[];
for(const [name,args,tests]of [
  ['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],
  ['unit',['--experimental-transform-types','--test','tools/contrast.test.ts','tools/entries.test.ts','tools/drop-motion.test.ts','tools/playback-sync.test.ts','tools/local-word-alignment.test.ts','tools/local-lrc-read.test.ts'],24],
  ['export-api',['--test','exporter/server.test.mjs'],2],
]) {
  const start=Date.now(),child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  const [code]=await once(child,'close');
  await fs.writeFile(`../exports/Melodic-structure-20261018/${name}.log`,output);
  assert.equal(code,0,output);
  if(tests) assert.match(output,new RegExp(`tests ${tests}\\b`));
  checks.push({name,code,tests:tests??null,ms:Date.now()-start});console.log(JSON.stringify(checks.at(-1)));
}
await fs.writeFile('../exports/Melodic-structure-20261018/checks.json',JSON.stringify(checks,null,2));
