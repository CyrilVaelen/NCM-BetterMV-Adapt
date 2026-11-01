import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import ffmpeg from 'ffmpeg-static';
import {PROJECT} from '../exporter/server.mjs';
import {analyzeLead} from '../src/analysis/lead.ts';
import {analyzeLead as previousLead} from './fixtures/lead-v3.ts';
import {computeSpectra} from '../src/analysis/spectrum.ts';
import {Slicer,quantile} from '../src/analysis/util.ts';
import {pictureDelayMs} from '../src/plugin/playback-sync.ts';

const root=path.resolve(PROJECT,'..'),out=path.join(root,'exports/Sunshine-keyboard-response');
const fixture=path.join(root,'BetterNCM/export-jobs/741d3da3-67d0-405d-8b1f-9c06bce5230d');
const input=JSON.parse(await fs.readFile(path.join(fixture,'input.json'),'utf8'));
const pcmPath=path.join(out,'homura-regression.f32');
const p=spawn(ffmpeg,['-y','-v','error','-i',path.join(fixture,'audio.bin'),'-ac','1','-ar','22050','-f','f32le',pcmPath],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let error='';p.stderr.on('data',x=>error+=x);assert.equal((await once(p,'close'))[0],0,error);
const bytes=await fs.readFile(pcmPath),pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
const steps=computeSpectra(pcm,22050,new Slicer(Infinity),0,1);let spec;
for(;;){const n=steps.next();if(n.done){spec=n.value;break;}}
const before=previousLead(spec),after=analyzeLead(spec),windows=[];
for(const [start,end] of [[16,23],[45,70],[165,190]]){
  const stats=cue=>{const level=cue.level.slice(start*100,end*100),attack=cue.attack.slice(start*100,end*100);return {median:quantile(level,.5),range:quantile(level,.9)-quantile(level,.1),attackPeak:Math.max(...attack),saturation:level.filter(x=>x>.98).length/level.length};};
  const b=stats(before),a=stats(after);assert.ok(a.median>.25);assert.ok(a.saturation<.1);assert.ok(a.range>.05);assert.ok(a.attackPeak>.35);
  // Match attack envelopes within +/- 200 ms, independently from the live offset.
  let best={lag:0,correlation:-Infinity};
  for(let lag=-20;lag<=20;lag++){
    let dot=0,x2=0,y2=0;
    for(let i=start*100+20;i<end*100-20;i++){const x=before.attack[i],y=after.attack[i+lag];dot+=x*y;x2+=x*x;y2+=y*y;}
    const correlation=dot/Math.sqrt(x2*y2);if(correlation>best.correlation)best={lag,correlation};
  }
  assert.ok(Math.abs(best.lag)<=5,'new lead envelope shifted by more than 50 ms');
  windows.push({start,end,before:b,after:a,attackLagMs:best.lag*10,attackCorrelation:best.correlation});
}
const correction=pictureDelayMs({latencyMs:0,songVisualDelays:{'17285341':1500}},input.song.id);
assert.equal(correction,0);
const report={song:input.song.name,id:input.song.id,duration:pcm.length/22050,liveExtraPictureDelayMs:correction,windows};
await fs.writeFile(path.join(out,'homura-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
