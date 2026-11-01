// Fresh local recording -> frozen analysis inputs -> current section replay.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { serialize, deserialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { parseLocalLrc } from '../src/lyrics/local.ts';
import { findSections } from '../src/analysis/sections.ts';

const root = path.resolve('..'), state = path.join(root, 'state/rush-form-20261020');
const out = path.join(root, 'exports/Rush-form-20261020');
await fs.mkdir(out, {recursive:true});
const audio = 'D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3';
const lrc = audio.replace(/mp3$/, 'lrc');
const baselineIndex = path.join(state, 'baseline/src/analysis/index.ts');
let source = await fs.readFile(baselineIndex, 'utf8');
source = source.replace('const sections = findSections({', 'const sections = captureSections({');
source += '\nfunction captureSections(input: any) { (globalThis as any).__captureSections?.(input); return findSections(input); }\n';
const capture = path.join(state, 'baseline/src/analysis/capture-index.ts');
await fs.writeFile(capture, source);
const baseline = await import(pathToFileURL(capture).href);
const ffmpeg = (await import('ffmpeg-static')).default;
const pcmPath = path.join(out, 'rush-mono.f32');
try { await fs.access(pcmPath); } catch {
  const r = spawnSync(ffmpeg, ['-v','error','-y','-i',audio,'-ac','1','-ar','22050','-f','f32le',pcmPath]);
  if (r.status) throw new Error(r.stderr.toString());
}
const bytes = await fs.readFile(pcmPath), pcm = new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
await fs.writeFile(path.join(out,'input-manifest.json'),JSON.stringify({audio,lrc,duration:pcm.length/22050,audioSha256:createHash('sha256').update(await fs.readFile(audio)).digest('hex'),lrcSha256:createHash('sha256').update(await fs.readFile(lrc)).digest('hex')},null,2));
const requested = process.argv.slice(2).filter(a=>!a.startsWith('--'));
for (const name of requested.length ? requested : ['local','no-lyrics']) {
  const cache = path.join(out, name+'-input.bin');
  let input;
  try { input = deserialize(await fs.readFile(cache)); } catch {
    const opts = name==='no-lyrics' ? {} : {lyrics:parseLocalLrc(await fs.readFile(lrc,'utf8'),pcm.length/22050)};
    if (name==='local-140') opts.bpmHint=140;
    if (name==='local-70') opts.bpmHint=70;
    globalThis.__captureSections = x=>input=x;
    console.log('Fresh baseline analysis: '+name);
    const analysis = baseline.analyze(pcm,22050,opts);
    delete globalThis.__captureSections;
    await fs.writeFile(cache,serialize(input));
    await fs.writeFile(path.join(out,name+'-analysis-before.bin'),serialize(analysis));
  }
  let debug,info;
  globalThis.__bmvSectionDebug=x=>debug=x;
  globalThis.__bmvSectionInfo=x=>info=x;
  const sections=findSections(input);
  delete globalThis.__bmvSectionDebug;delete globalThis.__bmvSectionInfo;
  const avg=(arr,a,b)=>{let s=0;for(let i=a;i<b;i++)s+=arr[i]||0;return s/Math.max(1,b-a);};
  const report={name,sections,info,releases: Array.from(debug.releases),bars:debug.time.map((t,j)=>{
    const end=debug.time[j+1]??input.duration,a=input.bars.start[j],b=input.bars.start[j+1]??input.features.n;
    const hits=h=>input.hits[h].filter(([at,strength])=>at>=t&&at<end&&strength>=.25);
    return {j,t,end,db:avg(input.features.db,a,b),bass:debug.lowDb[j],treble:10*Math.log10(avg(input.high,Math.floor(t*input.fps),Math.floor(end*input.fps))+1e-12),art:debug.articulation[j],sung:debug.sung[j],nov:debug.nov[j],kick:hits('kick'),snare:hits('snare')};
  })};
  const phase=process.argv.includes('--after')?'after':'before';
  await fs.writeFile(path.join(out,`${name}-${phase}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify({name,sections:sections.map(s=>[s.start,s.end,s.label]),releases:report.releases}));
}
