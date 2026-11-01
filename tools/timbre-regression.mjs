import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { deserialize,serialize } from 'node:v8';
import { pathToFileURL } from 'node:url';
import { analyze } from '../src/analysis/index.ts';
import { Music } from '../src/director/music.ts';
import { planShots } from '../src/director/director.ts';
import { STYLES } from '../src/style/style.ts';
const out=path.resolve('../exports/Timbre-highlights-20261018');await fs.mkdir(out,{recursive:true});
const before=await import(pathToFileURL(path.resolve('../state/before-timbre-highlights-20261018/source/src/analysis/index.ts')).href);
const oldMusic=await import(pathToFileURL(path.resolve('../state/before-timbre-highlights-20261018/source/src/director/music.ts')).href);
const rows=[];
const fixtures=[
  ['love-live','../exports/Melodic-structure-20261018/love-mono.f32',125],
  ['sunshine','../exports/Sunshine-keyboard-response/sunshine-mono.f32'],
  ['homura-live','../exports/Sunshine-keyboard-response/homura-regression.f32'],
  ['cant-live','../exports/Cant-Let-You-Go-drop-response/mono.f32',75],
  ['fellow-live','../exports/Melodic-structure-20261018/fellow-live-mono.f32'],
  ['timeflies','../exports/Melodic-structure-20261018/timeflies-mono.f32'],
  ['loveeasy','../exports/Melodic-structure-20261018/loveeasy-mono.f32'],
  ['already','../exports/Melodic-structure-20261018/already-mono.f32'],
  ['conan','../exports/Melodic-structure-20261018/conan-mono.f32'],
];
for(const [name,file,bpmHint]of fixtures) {
  const bytes=await fs.readFile(file),pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  const input=deserialize(await fs.readFile(`../exports/Melodic-structure-20261018/${name}-input.bin`));
  const options={lyrics:input.lyrics,chorusHint:input.chorus,bpmHint};
  const old=before.analyze(pcm,22050,options),now=analyze(pcm,22050,options);
  assert.equal(now.version,6);const {timbre,version,...legacy}=now;
  const {version:oldVersion,...oldLegacy}=old;assert.deepEqual(legacy,oldLegacy);
  const a=new oldMusic.Music(old),b=new Music(now);
  let unchanged=0;
  for(let t=.2;t<now.duration-.2;t+=.25) {
    assert.deepEqual(b.leadAt(t),a.leadAt(t),'existing lead envelopes changed');
    if(!b.selectiveAt(t)){assert.deepEqual(b.foregroundAt(t),a.leadAt(t));unchanged++;}
  }
  const off=new Set(['menger','sierpinski','cantor']);
  for(const seed of [2052331548,1,987654321])assert.deepEqual(planShots(b,STYLES.pulse,seed,{graphic:false,lyrics:!!input.lyrics?.length},off),planShots(a,STYLES.pulse,seed,{graphic:false,lyrics:!!input.lyrics?.length},off),'shot plan changed');
  const row={name,legacyAnalysisUnchanged:true,nonDropSamplesUnchanged:unchanged,shotPlansUnchanged:3,timbreMax:Object.fromEntries(['synthStab','bassStab','lead','leadAttack'].map(k=>[k,Math.max(...timbre[k])]))};rows.push(row);console.log(JSON.stringify(row));
  if(name==='love-live') {
    await fs.writeFile(path.join(out,'love-analysis-after.bin'),serialize(now));
    const frames=[];for(let t=99;t<129;t+=1/60)frames.push({t,old:a.leadAt(t),foreground:b.foregroundAt(t),roles:b.timbreAt(t)});
    await fs.writeFile(path.join(out,'love-foreground.json'),JSON.stringify(frames));
  }
}
await fs.writeFile(path.join(out,'regression.json'),JSON.stringify({recordings:rows.length,rows},null,2));
