import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {analyze} from '../src/analysis/index.ts';
import {Music} from '../src/director/music.ts';
import {planShots} from '../src/director/director.ts';
import {STYLES} from '../src/style/style.ts';

const out=path.resolve('../exports/Sunshine-structure-response');
// Frozen previous analyser, with only its module locations adapted for tests.
const backup=path.resolve('../BetterNCM/setup/before-structure-20261016/source/src/analysis');
for(const [name,target] of [['index.ts','analysis-v4.ts'],['sections.ts','sections-v4.ts']]){
  let code=await fs.readFile(path.join(backup,name),'utf8');
  code=code.replaceAll("from '../types.ts'","from '../../src/types.ts'")
    .replace(/from '\.\/([^']+)'/g,(_,file)=>`from '${file==='sections.ts'?'./sections-v4.ts':`../../src/analysis/${file}`}'`);
  await fs.writeFile(path.resolve('tools/fixtures',target),code);
}
const {analyze:oldAnalyze}=await import('./fixtures/analysis-v4.ts');
const reports=[];
for(const [name,file] of [['Sunshine','sunshine-mono.f32'],['Homura','homura-regression.f32']]){
  const bytes=await fs.readFile(path.resolve('../exports/Sunshine-keyboard-response',file));
  const pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  const input=name==='Homura'?JSON.parse(await fs.readFile('../BetterNCM/export-jobs/741d3da3-67d0-405d-8b1f-9c06bce5230d/input.json','utf8')):null;
  const opts=input?{lyrics:input.lines,bpmHint:input.wiki?.bpm,chorusHint:input.chorus}:{};
  const before=oldAnalyze(pcm,22050,opts),after=analyze(pcm,22050,opts);
  assert.deepEqual(after.beats,before.beats,'beat timestamps moved');assert.deepEqual(after.hits,before.hits,'note/drum timestamps moved');assert.deepEqual(after.env,before.env,'audio envelopes changed');
  assert.equal(after.sections.length,before.sections.length);
  const changed=after.sections.flatMap((s,i)=>s.start===before.sections[i].start?[]:[{index:i,before:before.sections[i].start,after:s.start,shift:s.start-before.sections[i].start}]);
  for(const edge of changed){
    const {index:i,after:t}=edge;assert.equal(after.sections[i].label,'drop');assert.notEqual(before.sections[i-1].label,'drop');
    assert.equal(after.sections[i-1].end,t);assert.ok(after.hits.kick.some(h=>h[0]===t&&h[1]>=.45));
  }
  for(let i=0;i<after.sections.length;i++){
    assert.equal(after.sections[i].label,before.sections[i].label);
    if(!changed.some(c=>c.index===i+1))assert.equal(after.sections[i].end,before.sections[i].end);
    if(i>0)assert.equal(after.sections[i].start,after.sections[i-1].end);
  }
  if(name==='Sunshine'){
    assert.equal(changed.length,4);assert.ok(changed.some(e=>Math.abs(e.after-131.261)<.001));
    const music=new Music(after),planChecks=[];
    for(const seed of [17285341,1,3420076994,987654321]){
      const shots=planShots(music,STYLES.pulse,seed,{graphic:false,lyrics:false},new Set(['menger','sierpinski','cantor']));
      const at=t=>shots.find(s=>s.start<=t&&s.end>t);
      assert.notEqual(at(131.1).section.label,'drop');assert.equal(at(131.27).section.label,'drop');
      for(const edge of changed){const shot=at(edge.after+.02);assert.equal(shot.section.start,edge.after);assert.ok(['drive','channel'].includes(shot.scene));}
      planChecks.push({seed,beforeEntry:at(131.1).scene,entry:at(131.27).scene,entryTime:at(131.27).start});
    }
    await fs.writeFile(path.join(out,'plan-regression.json'),JSON.stringify(planChecks,null,2));
  }else{assert.deepEqual(after.sections,before.sections,'Homura section mapping changed');assert.deepEqual(after.beatInBar,before.beatInBar);}
  reports.push({name,changed,beatTimesUnchanged:true,hitTimesUnchanged:true,envelopesUnchanged:true,sectionCount:after.sections.length});
}
await fs.writeFile(path.join(out,'regression.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
