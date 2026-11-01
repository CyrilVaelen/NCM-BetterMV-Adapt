import fs from 'node:fs';
import {analyze} from '../src/analysis/index.ts';
import {computeSpectra} from '../src/analysis/spectrum.ts';
import {Slicer,quantile} from '../src/analysis/util.ts';
for(const name of ['sunshine','homura']){
  const file=name==='sunshine'?'sunshine-mono.f32':'homura-regression.f32',bytes=fs.readFileSync(`../exports/Sunshine-keyboard-response/${file}`),pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  const old=name==='sunshine'?JSON.parse(fs.readFileSync('../exports/Sunshine-structure-response/before.json','utf8')).analysis:analyze(pcm,22050,{bpmHint:75,chorusHint:[25,40.5]});
  const steps=computeSpectra(pcm,22050,new Slicer(Infinity),0,1);let spec;
  for(;;){const n=steps.next();if(n.done){spec=n.value;break;}}
  const db=(a,from,to)=>{let sum=0,n=0;for(let i=Math.max(0,Math.floor(from*100));i<Math.min(a.length,Math.ceil(to*100));i++){sum+=a[i];n++;}return 10*Math.log10(sum/Math.max(1,n)+1e-12);};
  const full=10*Math.log10(quantile(spec.low,.9)),rmsRef=10*Math.log10(quantile(spec.power,.9));
  const drops=old.sections.filter(s=>s.label==='drop').map(s=>{
    const begin=s.start,candidates=[];
    for(let t=begin-1;t<begin+1;t+=.01){
      const bassBefore=db(spec.low,t-.16,t-.03),bassAfter=db(spec.low,t+.01,t+.13),level=db(spec.power,t+.01,t+.13),rise=bassAfter-bassBefore;
      if(bassAfter>full-6&&level>rmsRef-6)candidates.push({t:+t.toFixed(3),rise:+rise.toFixed(2),bass:+bassAfter.toFixed(2),level:+level.toFixed(2)});
    }
    candidates.sort((a,b)=>b.rise-a.rise);const peaks=[];for(const c of candidates)if(!peaks.some(x=>Math.abs(x.t-c.t)<.15))peaks.push(c);
    return {begin,end:s.end,peaks:peaks.slice(0,4),beats:old.beats.filter(t=>t>begin-1&&t<begin+1),kicks:old.hits.kick.filter(h=>h[0]>begin-1&&h[0]<begin+1)};
  });
  console.log(JSON.stringify({name,full,rmsRef,drops}));
}
