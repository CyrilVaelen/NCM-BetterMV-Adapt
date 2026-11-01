import fs from 'node:fs';
import path from 'node:path';
import {computeSpectra} from '../src/analysis/spectrum.ts';
import {Slicer,quantile} from '../src/analysis/util.ts';
import {analyzeLead} from '../src/analysis/lead.ts';
import {analyze} from '../src/analysis/index.ts';
import {Music} from '../src/director/music.ts';

const dir=path.resolve('../exports/Sunshine-keyboard-response');
const bytes=fs.readFileSync(path.join(dir,'sunshine-mono.f32'));
const pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),sr=22050;
const steps=computeSpectra(pcm,sr,new Slicer(Infinity),0,1);
let spec;
for(;;){const n=steps.next();if(n.done){spec=n.value;break;}}
const cues=analyzeLead(spec),a=analyze(pcm,sr),music=new Music(a);
const stats=(array:ArrayLike<number>,from:number,to:number)=>{
  const x=Float32Array.from({length:Math.max(0,Math.round((to-from)*100))},(_,n)=>array[Math.round(from*100)+n]??0);
  const mean=x.reduce((s,v)=>s+v,0)/x.length;
  return {mean,p10:quantile(x,0.1),p50:quantile(x,0.5),p90:quantile(x,0.9),max:Math.max(...x)};
};
const windows=[];
for(let t=0;t<pcm.length/sr-10;t+=15){
  const frames=Array.from({length:1500},(_,i)=>music.leadAt(t+i/100));
  windows.push({start:t,end:t+15,section:music.section(t+7.5).label,level:stats(cues.level,t,t+15),attack:stats(cues.attack,t,t+15),
    renderedLevel:stats(Float32Array.from(frames,c=>c.level),0,15),renderedAttack:stats(Float32Array.from(frames,c=>c.attack),0,15)});
}
const energyBands=[];
for(const [low,high] of [[100,180],[180,350],[350,800],[800,1600],[1600,6200]] as const){
  let energy=0;for(let i=0;i<spec.nFrames;i++)for(let b=0;b<spec.nMel;b++)if(spec.melHz[b]>=low&&spec.melHz[b]<high)energy+=spec.melAmp[i*spec.nMel+b]**2;
  energyBands.push({low,high,energy});
}
const report={duration:pcm.length/sr,bpm:a.bpm,sections:a.sections,energyBands,windows,
  points:Array.from({length:Math.floor(pcm.length/sr*100)},(_,i)=>({t:i/100,level:cues.level[i],attack:cues.attack[i],brightness:cues.brightness[i]}))};
fs.writeFileSync(path.join(dir,process.argv.includes('--after')?'updated-analysis.json':'baseline-analysis.json'),JSON.stringify(report));
console.log(JSON.stringify({duration:report.duration,bpm:report.bpm,windows:windows.map(w=>({t:w.start,section:w.section,level:w.renderedLevel.p50,attack:w.renderedAttack.p50,levelRange:w.renderedLevel.p90-w.renderedLevel.p10}))}));
