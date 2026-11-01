import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
const root=path.resolve('..'),out=path.join(root,'exports/Timbre-highlights-20261018'),backup=path.join(root,'state/before-timbre-highlights-20261018');
const hash=b=>createHash('sha256').update(b).digest('hex');
const previous=JSON.parse(await fs.readFile(path.join(backup,'previous-install.json'),'utf8')),baseline=JSON.parse(await fs.readFile(path.join(backup,'baseline.json'),'utf8'));
const installed=previous.installed,runtime=previous.runtime;
assert.equal(hash(await fs.readFile(installed)),baseline['../BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin']);
assert.equal(hash(await fs.readFile(runtime)),baseline['../BetterNCM/plugins_runtime/ncm-better-mv/bettermv.js']);
const scenes=['bokeh','channel','city','drive','fractal','kaleido','orb','particles','pillars','relief','ridges','rings','ripple','shatter','tunnel','viz'];
const changed=new Set(['src/analysis/index.ts','src/director/music.ts','src/director/director.ts','src/types.ts','exporter/build-plugin.mjs','tools/package-complete.mjs',...scenes.map(n=>'src/scenes/'+n+'.ts')]);
for(const [file,digest]of Object.entries(previous.sourceHashes))if(!changed.has(file))assert.equal(hash(await fs.readFile(file)),digest,'Preserved feature changed: '+file);
async function walk(directory,relative='src') {
  for(const e of await fs.readdir(directory,{withFileTypes:true})) {
    const file=relative+'/'+e.name,old=path.join(directory,e.name);
    if(e.isDirectory())await walk(old,file);else if(!changed.has(file))assert.equal(hash(await fs.readFile(file)),hash(await fs.readFile(old)),'Unexpected source edit: '+file);
  }
}
await walk(path.join(backup,'source/src'));
const checks=JSON.parse(await fs.readFile(path.join(out,'checks.json'),'utf8')),regression=JSON.parse(await fs.readFile(path.join(out,'regression.json'),'utf8'));
const render=JSON.parse(await fs.readFile(path.join(out,'render-verification.json'),'utf8')),burst=JSON.parse(await fs.readFile(path.join(out,'stills-verification.json'),'utf8')),image=JSON.parse(await fs.readFile(path.join(out,'image-verification.json'),'utf8'));
assert.ok(checks.every(c=>c.code===0));assert.equal(checks.find(c=>c.name==='unit').tests,33);
assert.equal(regression.recordings,9);assert.ok(regression.rows.every(r=>r.legacyAnalysisUnchanged&&r.nonDropSamplesUnchanged>0&&r.shotPlansUnchanged===3));
assert.equal(render.summary.version,6);assert.deepEqual(render.errors,[]);assert.deepEqual(burst.errors,[]);
for(const scene of ['particles','channel','kaleido','ripple','shatter','drive'])assert.ok(render.checks.some(c=>c.side==='after'&&c.scene===scene));
assert.equal(burst.checks.filter(c=>c.side==='after'&&c.variant==='burst').length,4);
assert.equal(render.checks.filter(c=>c.video).length,2);
for(const v of render.checks.filter(c=>c.video)){assert.ok((await fs.stat(v.video)).size>10000);assert.equal(v.probe.streams.find(s=>s.codec_type==='video').nb_frames,'180');assert.equal(v.probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');}
assert.ok(image.rows[1].brightPixels>5*image.rows[2].brightPixels+100);
assert.equal(hash(await fs.readFile('D:/CloudMusic/VipSongsDownload/NURKO,Neriah - Love Is A Highway.lrc')),'bd5f95f38e098b9e2ed94a4a07632dd1105bfe0267852d80e1f3926473ca71b6');
assert.equal(hash(await fs.readFile('D:/野葱视频转换器/音频转换/NURKO,Neriah - Love Is A Highway.mp3')),'6de9d0204a15529bd43ec2a0df0428c8884c7d5c8dc39ae114a4bdb9cf044ffb');
const candidate=await fs.readFile(path.join(root,'BetterMV-0.9.0-local-export.plugin')),zip=await JSZip.loadAsync(candidate,{checkCRC32:true}),js=await zip.file('bettermv.js').async('nodebuffer');
assert.equal(hash(js),hash(await fs.readFile('dist/plugin/bettermv.js')));
for(const text of ['0.9.0-local-export.10','synthStab','bassStab','foregroundAt','uHighlight','analysisLines','local-locked-v1','openFileDialog'])assert.ok(js.includes(Buffer.from(text)),text);
const sourceHashes={...previous.sourceHashes};for(const file of [...changed,'src/analysis/timbre.ts','tools/timbre.test.ts','tools/timbre-regression.mjs','tools/timbre-render.mjs','tools/timbre-image-check.mjs','tools/check-timbre-release.mjs','tools/install-timbre-highlights.mjs'])sourceHashes[file]=hash(await fs.readFile(file));
await fs.writeFile(installed,candidate);await fs.writeFile(runtime,js);
assert.equal(hash(await fs.readFile(installed)),hash(candidate));assert.equal(hash(await fs.readFile(runtime)),hash(js));
const report={version:'0.9.0-local-export.10',analysisVersion:6,installed,sha256:hash(candidate),runtime,runtimeSha256:hash(js),previousSha256:previous.sha256,sourceHashes,backup,checks,regression,render:{scenes:6,stills:render.checks.filter(c=>c.side).length,burstStills:4,videos:render.checks.filter(c=>c.video).map(c=>c.video),errors:[]},image,unchangedAudioAndLrc:true,limits:'Acoustic role estimates, not separated stems or exact instrument identification; headless browser verified, running NetEase window not operated',activation:'Completely quit and restart NetEase, reopen MV to reanalyse',installedAt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date())+' +08:00'};
await fs.writeFile(path.join(root,'BetterNCM/setup/timbre-highlights-20261018.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({version:report.version,installed,sha256:report.sha256}));
