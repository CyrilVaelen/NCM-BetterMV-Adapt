import fs from 'node:fs';
import path from 'node:path';
import {analyze} from '../src/analysis/index.ts';
import {parseNeteaseLyric} from '../src/lyrics/parse.ts';
import {parseWiki} from '../src/meta/wiki.ts';
import {Music} from '../src/director/music.ts';
import {planShots} from '../src/director/director.ts';
import {STYLES} from '../src/style/style.ts';
import {quantile} from '../src/analysis/util.ts';

const output=path.resolve('../exports/Cant-Let-You-Go-drop-response');
const meta=JSON.parse(fs.readFileSync(path.join(output,'metadata.json'),'utf8'));
const b=fs.readFileSync(path.join(output,'mono.f32')),pcm=new Float32Array(b.buffer,b.byteOffset,b.length/4);
const lines=parseNeteaseLyric(meta.lyric,pcm.length/22050),wiki=parseWiki(meta.wiki),c=meta.chorus.chorus?.find((s:any)=>s.id===1919116916);
const chorusHint=c?[c.startTime/1000,c.endTime/1000] as [number,number]:undefined;
const a=analyze(pcm,22050,{lyrics:lines,bpmHint:wiki.bpm,chorusHint});
const music=new Music(a),shots=planShots(music,STYLES.pulse,1919116916,{lines,wiki} as any);
const stats=(values:number[])=>({p10:quantile(values,.1),p50:quantile(values,.5),p90:quantile(values,.9),range:quantile(values,.9)-quantile(values,.1)});
const windows=a.sections.map(s=>{
  const ts=Array.from({length:Math.max(1,Math.floor((s.end-s.start)*100))},(_,i)=>s.start+i/100);
  const cue=ts.map(t=>music.leadAt(t));
  return {...s,level:stats(cue.map(c=>c.level)),attack:stats(cue.map(c=>c.attack)),leadHits:music.hitsBetween('leads',s.start,s.end).length,scenes:[...new Set(shots.filter(p=>p.start>=s.start&&p.start<s.end).map(p=>p.scene))]};
});
const side=process.argv.includes('--after')?'after':'before';
fs.writeFileSync(path.join(output,`${side}-analysis.json`),JSON.stringify(a));
fs.writeFileSync(path.join(output,`${side}-diagnostic.json`),JSON.stringify({duration:a.duration,bpm:a.bpm,wiki,chorusHint,lines:lines.length,windows,shots},null,2));
console.log(JSON.stringify({side,duration:a.duration,bpm:a.bpm,wiki,lines:lines.length,windows}));
