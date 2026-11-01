import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {analyzeTimbre} from '../src/analysis/timbre.ts';
import {computeSpectra} from '../src/analysis/spectrum.ts';
import {analyzeLead} from '../src/analysis/lead.ts';
import {Slicer} from '../src/analysis/util.ts';

const file=process.argv[2]??'D:/NCM/state/sunshine-form-keys-20261018/sunshine.f32';
const buffer=fs.readFileSync(file),pcm=new Float32Array(buffer.buffer,buffer.byteOffset,buffer.length/4),sr=22050;
const baseline=await import(pathToFileURL('D:/NCM/state/sunshine-form-keys-20261018/baseline/src/analysis/timbre.ts').href);
const baselineStart=performance.now(),old=baseline.analyzeTimbre(pcm,sr),baselineMs=performance.now()-baselineStart;
const currentStart=performance.now(),timbre=analyzeTimbre(pcm,sr),currentMs=performance.now()-currentStart;
const steps=computeSpectra(pcm,sr,new Slicer(Infinity),0,1);let spec;
for(;;){const s=steps.next();if(s.done){spec=s.value;break;}}
const env=analyzeLead(spec!);
const stats=(a:Float32Array,fps:number,from:number,to:number)=>{const v=Array.from(a.slice(Math.round(from*fps),Math.round(to*fps))).sort((a,b)=>a-b);return {mean:v.reduce((s,x)=>s+x,0)/v.length,p50:v[Math.floor(v.length*.5)],p90:v[Math.floor(v.length*.9)],max:v.at(-1),active:v.filter(x=>x>.2).length/v.length};};
const rows=[];
for(const [from,to]of [[0,30],[30,60],[60,67],[67,100],[100,130],[130,160],[160,200],[200,240],[240,280],[280,320],[320,360]]){
  const roles=(v:typeof timbre)=>({lead:stats(v.lead,60,from,to),attack:stats(v.melodyAttack!,60,from,to),presence:stats(v.leadPresence!,60,from,to),brightness:stats(v.leadBrightness!,60,from,to),bass:stats(v.bassStab,60,from,to)});
  rows.push({from,to,envLead:stats(env.level,spec!.fps,from,to),envAttack:stats(env.attack,spec!.fps,from,to),before:roles(old),after:roles(timbre)});
}
const output={file,bytes:buffer.length,pcmSHA256:createHash('sha256').update(buffer).digest('hex'),duration:pcm.length/sr,baselineMs,currentMs,rows};
console.log(JSON.stringify(output,null,2));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(output,null,2));
