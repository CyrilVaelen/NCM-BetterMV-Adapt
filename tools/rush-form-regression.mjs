import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {analyze} from '../src/analysis/index.ts';
import {analyze as baselineAnalyze} from '../../state/rush-form-20261020/baseline/src/analysis/index.ts';
import {parseLocalLrc} from '../src/lyrics/local.ts';
import {Music} from '../src/director/music.ts';
import {planShots} from '../src/director/director.ts';
import {underwaterDiveEntryProgress} from '../src/scenes/underwater.ts';
import {PULSE,STYLES} from '../src/style/style.ts';
import {createHash} from 'node:crypto';
import {refineDropPreparations} from '../src/analysis/entries.ts';
const out=path.resolve('../exports/Rush-form-20261020');
const baseline={analyze:baselineAnalyze};
const bytes=await fs.readFile(path.join(out,'rush-mono.f32')),pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
const text=await fs.readFile('D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.lrc','utf8');
const lyrics=parseLocalLrc(text,pcm.length/22050),results=[];
await fs.writeFile(path.join(out,'tested-lyrics.lrc'),text);
const lrcSha256=createHash('sha256').update(text).digest('hex');
for(const [name,opts]of [
  ['local',{lyrics}],['local-70',{lyrics,bpmHint:70}],['local-140',{lyrics,bpmHint:140}],
  ['no-lyrics',{}],
  ['early-highlight',{lyrics,bpmHint:140,chorusHint:[175,191]}],
]){
  const before=baseline.analyze(pcm,22050,structuredClone(opts));
  await fs.writeFile(path.join(out,name+'-fresh-analysis-before.bin'),serialize(before));
  const after=analyze(pcm,22050,opts);
  await fs.writeFile(path.join(out,name+'-analysis-after.bin'),serialize(after));
  const at=t=>after.sections.find(s=>t>=s.start&&t<s.end)?.label;
  const beforeAt=t=>before.sections.find(s=>t>=s.start&&t<s.end)?.label;
  let closingOutroStart=null,sceneChecks=[],dropVisualCheck=null;
  for(const t of [100.82,101,102,102.8,175.8,180,185,189.8,191.7])assert.equal(at(t),'build',`${name} ${t}`);
  for(const t of [103.3,110,120,192.2,200,215])assert.equal(at(t),'drop',`${name} ${t}`);
  assert.equal(after.sections[0].start,0);assert.equal(after.sections.at(-1).end,after.duration);
  const hasLyrics=name.startsWith('local')||name==='early-highlight';
  let lateCutRecovery=null;
  if(name==='local'){
    // Reproduce the live .25 diagnosis: its coarse Drop 2 boundary landed at
    // 194.9 s, after the actual release near 192 s. Reuse the feature bands
    // extracted from the user's D:\CloudMusic MP3 and verify the late cut can
    // be recovered from the signal itself.
    const input=deserialize(await fs.readFile(path.join(out,'local-input.bin')));
    const coarseStart=194.9;
    const detect=(kicks)=>{
      const shifted=structuredClone(after.sections);
      const dropIndex=shifted.findIndex(s=>s.label==='drop'&&s.start>180);
      assert.ok(dropIndex>0&&shifted[dropIndex-1].label==='build','late-cut fixture requires a build into Drop 2');
      assert.ok(coarseStart>shifted[dropIndex].start&&coarseStart<shifted[dropIndex].end,'live coarse boundary lies inside Drop 2');
      shifted[dropIndex].start=coarseStart;
      shifted[dropIndex-1].end=coarseStart;
      const recovered=refineDropPreparations({sections:shifted,beats:after.beats,fps:input.fps,low:input.low,high:input.high,rms:input.rms,kicks});
      assert.equal(recovered,true,'late coarse Drop 2 boundary should be corrected from the D: audio');
      const detected=shifted[dropIndex].start;
      assert.ok(Math.abs(detected-192)<.08,`D: audio release expected near 192 s after 194.9 s coarse cut (got ${detected})`);
      assert.equal(shifted[dropIndex-1].end,detected,'preceding build ends exactly at the recovered release');
      return detected;
    };
    const detected=detect(input.hits.kick),withoutDetectedKicks=detect([]);
    lateCutRecovery={coarseStart,detected,withoutDetectedKicks,sourceAudio:JSON.parse(await fs.readFile(path.join(out,'input-manifest.json'),'utf8')).audio};
  }
  if(hasLyrics){
    const lastLyric=lyrics.reduce((best,line)=>line.end>best.end?line:best,lyrics[0]);
    const outro=after.sections.find(s=>s.label==='outro');
    assert.ok(outro,`${name}: closing outro missing`);
    assert.equal(beforeAt(221),'drop',`${name}: frozen pre-fix baseline changed`);
    assert.ok(Math.abs(outro.start-lastLyric.end)<.02,`${name}: outro should hand off after final sung tag`);
    closingOutroStart=outro.start;
    for(const t of [221,230,240])assert.equal(at(t),'outro',`${name} ${t}`);
  }else if(name==='no-lyrics')assert.equal(at(252),'outro','no-lyrics terminal fade');
  for(let j=0;j<after.sections.length;j++){
    const s=after.sections[j];assert.ok(s.end>s.start);
    if(j)assert.equal(after.sections[j-1].end,s.start);
  }
  for(const key of ['duration','bpm','namedBpm','meter','beats','tempo','env','hits','timbre'])assert.deepEqual(after[key],before[key],`${name}: ${key} changed`);
  const music=new Music(after);
  const shots=planShots(music,PULSE,20261020,{graphic:false,lyrics:true});
  const drop2=shots.find(s=>s.section.label==='drop'&&s.start>180);
  const drop2Section=after.sections.find(s=>s.label==='drop'&&s.start>180);
  assert.ok(drop2&&drop2Section,`${name}: Drop 2 shot missing`);
  assert.ok(Math.abs(drop2.start-drop2Section.start)<1e-6,`${name}: Drop 2 scene must switch on its detected section boundary`);
  const entryProgress=drop2.scene==='underwater'&&drop2.variant==='dive'
    ? underwaterDiveEntryProgress(0,drop2.section.label==='drop') : null;
  if(entryProgress!==null)assert.equal(entryProgress,1,`${name}: underwater Dive must be at full depth on the first Drop frame`);
  dropVisualCheck={start:drop2.start,scene:drop2.scene,variant:drop2.variant,diveProgressAtEntry:entryProgress};
  for(const t of [100.82,175.8,189.8])assert.equal(shots.find(s=>s.start<=t&&s.end>t).section.label,'build');
  for(const t of [103.3,192.2])assert.equal(shots.find(s=>s.start<=t&&s.end>t).section.label,'drop');
  if(hasLyrics){
    const outro=after.sections.find(s=>s.label==='outro');
    const priorDrop=after.sections.slice(0,after.sections.indexOf(outro)).reverse().find(s=>s.label==='drop');
    assert.ok(priorDrop);
    const finalDropShots=shots.filter(s=>s.section.label==='drop'&&s.start<priorDrop.end&&s.end>priorDrop.start);
    const outroShots=shots.filter(s=>s.section.label==='outro'&&s.start<after.duration&&s.end>outro.start);
    assert.ok(finalDropShots.length&&outroShots.length);
    assert.ok(!outroShots.some(s=>finalDropShots.some(d=>d.scene===s.scene)),`${name}: outro reused a Drop 2 scene`);
    for(const style of Object.values(STYLES))for(const seed of Array.from({length:32},(_,i)=>i)){
      const planned=planShots(music,style,seed,{graphic:false,lyrics:true});
      const dropScenes=new Set(planned.filter(s=>s.section.label==='drop'&&s.start<priorDrop.end&&s.end>priorDrop.start).map(s=>s.scene));
      const endScenes=planned.filter(s=>s.section.label==='outro'&&s.start<after.duration&&s.end>outro.start).map(s=>s.scene);
      assert.ok(endScenes.length,`${name}/${style.id}/${seed}: no outro shot`);
      assert.ok(!endScenes.some(scene=>dropScenes.has(scene)),`${name}/${style.id}/${seed}: closing outro reused Drop 2 scene`);
      sceneChecks.push({style:style.id,seed,dropScenes:[...dropScenes],outroScenes:[...new Set(endScenes)],disjoint:true});
    }
  }
  await fs.writeFile(path.join(out,name+'-analysis-after.bin'),serialize(after));
  const result={name,lrcSha256,version:after.version,entries:after.sections.filter((s,i,a)=>s.label==='drop'&&(i===0||a[i-1].label!=='drop')&&s.start>80).map(s=>s.start),checks:[100.82,175.8,189.8,191.7,192.2].map(t=>[t,at(t)]),lateCutRecovery,dropVisualCheck,closingOutroStart,sceneChecks,unaffectedSignalsEqual:true,sections:after.sections};
  results.push(result);console.log(JSON.stringify({name,entries:result.entries,checks:result.checks}));
}
await fs.writeFile(path.join(out,'regression.json'),JSON.stringify({results,recording:(JSON.parse(await fs.readFile(path.join(out,'input-manifest.json'),'utf8')))},null,2));
