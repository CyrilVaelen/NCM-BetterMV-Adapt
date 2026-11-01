import fs from 'node:fs/promises';
import path from 'node:path';
import { serialize } from 'node:v8';
import { analyzeTimbre } from '../src/analysis/timbre.ts';
import { quantile } from '../src/analysis/util.ts';
const sr=22050,out=path.resolve('../exports/Timbre-highlights-20261018');await fs.mkdir(out,{recursive:true});
const stats=a=>({mean:a.reduce((x,y)=>x+y,0)/a.length,p90:quantile(a,.9),max:Math.max(...a)});
let seed=917;const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return ((seed>>>0)/2**32-.5)*2;};
const notes=[.4,1.13,1.9,2.7];
const sources={
  silence:()=>0,
  noise:()=>noise()*.3,
  drums:t=>{const k=t%.5,h=t%.125,s=(t+.25)%.5;return .8*Math.exp(-k*32)*Math.sin(2*Math.PI*(55*k+2.5*(1-Math.exp(-k*35))))+.4*Math.exp(-s*24)*noise()+.15*Math.exp(-h*70)*noise();},
  synth:t=>notes.reduce((sum,onset)=>{let age=t-onset;if(age<0||age>.3)return sum;const f=440*(onset===1.13?1.5:1);return sum+.1*Math.exp(-age*9)*(Math.sin(2*Math.PI*f*age)+.6*Math.sin(4*Math.PI*f*age)+.3*Math.sin(6*Math.PI*f*age)+.2*Math.sin(8*Math.PI*f*age));},0),
  bass:t=>notes.reduce((sum,onset)=>{let age=t-onset;if(age<0||age>.4)return sum;return sum+.3*Math.exp(-age*9)*(Math.sin(2*Math.PI*65.4*age)+.5*Math.sin(4*Math.PI*65.4*age)+.4*Math.sin(6*Math.PI*65.4*age)+.3*Math.sin(8*Math.PI*65.4*age)+.2*Math.sin(10*Math.PI*65.4*age));},0),
  lead:t=>t>.4&&t<3.2?.15*(Math.sin(2*Math.PI*(t<1.6?660:880)*t)+.3*Math.sin(4*Math.PI*(t<1.6?660:880)*t)):0,
};
sources.mixed=t=>sources.synth(t)+sources.drums(t);
for(const [name,signal]of Object.entries(sources)) {
  seed=917;const pcm=Float32Array.from({length:sr*4},(_,i)=>signal(i/sr)),start=performance.now(),v=analyzeTimbre(pcm,sr);
  const report={name,ms:performance.now()-start,...Object.fromEntries(['synthStab','bassStab','lead','leadAttack','confidence'].map(k=>[k,stats(v[k])]))};
  await fs.writeFile(path.join(out,'synthetic-'+name+'.bin'),serialize(v));console.log(JSON.stringify(report));
}
if(process.argv.includes('--real')) {
  const bytes=await fs.readFile('../exports/Melodic-structure-20261018/love-mono.f32'),pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),start=performance.now();
  const v=analyzeTimbre(pcm,sr);await fs.writeFile(path.join(out,'love-timbre.bin'),serialize(v));
  const rows=[];for(let t=99;t<129;t+=.5) rows.push({t,...Object.fromEntries(['synthStab','bassStab','lead','leadAttack','confidence'].map(k=>[k,stats(v[k].slice(Math.floor(t*v.fps),Math.floor((t+.5)*v.fps)))]))});
  await fs.writeFile(path.join(out,'love-diagnose.json'),JSON.stringify({ms:performance.now()-start,rows},null,2));
  console.log(JSON.stringify({realMs:performance.now()-start,drop:rows.slice(0,8)}));
}
