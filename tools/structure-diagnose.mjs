import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {analyze} from '../src/analysis/index.ts';
import {Music} from '../src/director/music.ts';
import {planShots,planLooks} from '../src/director/director.ts';
import {STYLES,chooseStyle} from '../src/style/style.ts';
import {computeSpectra} from '../src/analysis/spectrum.ts';
import {Slicer} from '../src/analysis/util.ts';

const root=path.resolve('..'),out=path.join(root,'exports/Sunshine-structure-response');
await fs.mkdir(out,{recursive:true});
if(!process.argv.includes('--after')){
  const backup=path.join(root,'BetterNCM/setup/before-structure-20261016'),files=['src/analysis/sections.ts','src/analysis/index.ts','src/director/director.ts','src/style/style.ts','src/scenes/channel.ts','src/plugin/playback-sync.ts','src/plugin/main.ts','src/plugin/ui.ts','exporter/build-plugin.mjs','tools/playback-sync.test.ts','../BetterNCM/BetterMV/playback-sync.json','../BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin'];
  try{await fs.access(path.join(backup,'baseline.json'));}catch{
    const hashes={};
    for(const file of files){const bytes=await fs.readFile(file),dest=path.join(backup,file.startsWith('../')?path.basename(file):`source/${file}`);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes,{flag:'wx'});hashes[file]=createHash('sha256').update(bytes).digest('hex');}
    await fs.writeFile(path.join(backup,'baseline.json'),JSON.stringify(hashes,null,2),{flag:'wx'});
  }
}
const bytes=await fs.readFile(path.join(root,'exports/Sunshine-keyboard-response/sunshine-mono.f32'));
const pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);let debug;
globalThis.__bmvSectionDebug=d=>debug=Object.fromEntries(Object.entries(d).map(([k,v])=>[k,Array.from(v)]));
const analysis=analyze(pcm,22050);delete globalThis.__bmvSectionDebug;
const music=new Music(analysis),off=new Set(['menger','sierpinski','cantor']),plans=[];
for(const seed of [17285341,1,3420076994,987654321]){
  const shots=planShots(music,STYLES.pulse,seed,{graphic:false,lyrics:false},off);
  plans.push({seed,shots:shots.map(s=>({start:s.start,end:s.end,scene:s.scene,variant:s.variant,label:s.section.label,sectionStart:s.section.start,sectionIndex:s.sectionIndex})),looks:planLooks(analysis.sections,STYLES.pulse,seed)});
}
const s=computeSpectra(pcm,22050,new Slicer(Infinity),0,1);let spec;
for(;;){const n=s.next();if(n.done){spec=n.value;break;}}
const energy=[];
for(let t=120;t<142;t+=.25){let rms=0,low=0,mid=0,high=0;for(let i=Math.round(t*100);i<Math.round((t+.25)*100);i++){rms+=spec.power[i];low+=spec.low[i];mid+=spec.mid[i];high+=spec.high[i];}energy.push({t,db:10*Math.log10(rms/25+1e-12),low:10*Math.log10(low/25+1e-12),mid:10*Math.log10(mid/25+1e-12),high:10*Math.log10(high/25+1e-12)});}
const report={analysis:{...analysis,env:Object.fromEntries(Object.entries(analysis.env).map(([k,v])=>[k,typeof v==='number'?v:Array.from(v)]))},plans,debug,energy,choice:chooseStyle(analysis,undefined,false).style.id};
const name=process.argv.includes('--after')?'after.json':'before.json';await fs.writeFile(path.join(out,name),JSON.stringify(report));
console.log(JSON.stringify({choice:report.choice,sections:analysis.sections.filter(s=>s.end>110&&s.start<150),plans:plans.map(p=>({seed:p.seed,shots:p.shots.filter(s=>s.end>124&&s.start<143)})),bars:debug.time.map((t,i)=>({t,nov:debug.nov[i],low:debug.lowDb[i]})).filter(x=>x.t>120&&x.t<140),energy:energy.filter(x=>x.t>=127&&x.t<134)}));
