// Guard installation against concurrent changes and read back every installed file.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
const root=path.resolve('..'),state=path.join(root,'state/rush-armillary-20261020');
const hash=b=>createHash('sha256').update(b).digest('hex');
const candidate=await fs.readFile(path.join(root,'BetterMV-0.9.0-local-export.plugin'));
const zip=await JSZip.loadAsync(candidate),js=await zip.file('bettermv.js').async('nodebuffer'),manifest=await zip.file('manifest.json').async('nodebuffer');
assert.equal(JSON.parse(manifest).version,'0.9.0-local-export.20');
assert.ok(js.includes(Buffer.from('首次 drop 前')));
const targets=[
  ['BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin','installed.plugin',candidate],
  ['BetterNCM/plugins_runtime/ncm-better-mv/bettermv.js','runtime-bettermv.js',js],
  ['BetterNCM/plugins_runtime/ncm-better-mv/manifest.json','runtime-manifest.json',manifest],
];
for(const [target,backup]of targets)assert.equal(hash(await fs.readFile(path.join(root,target))),hash(await fs.readFile(path.join(state,'baseline',backup))),target+' changed since backup');
const standalone=path.join(root,'BetterMV-0.9.0-local-export.20-rush-armillary.plugin');
await fs.writeFile(standalone,candidate);
const files=[];
for(const [target,,content]of targets){const file=path.join(root,target);await fs.writeFile(file,content);assert.equal(hash(await fs.readFile(file)),hash(content));files.push({file,sha256:hash(content)});}
const sources={};
async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else sources[path.relative(process.cwd(),file).replaceAll('\\','/')]=hash(await fs.readFile(file));}}
await walk(path.resolve('src'));
await fs.writeFile(path.join(state,'delivery.json'),JSON.stringify({version:'0.9.0-local-export.20',analysisVersion:9,standalone,pluginSha256:hash(candidate),files,sources,settingsChanged:false,originalAudioOrLrcWritten:false,requiresRestart:true},null,2));
console.log(JSON.stringify({version:'0.9.0-local-export.20',standalone,pluginSha256:hash(candidate),installedFilesVerified:files.length,sourceFiles:Object.keys(sources).length}));
