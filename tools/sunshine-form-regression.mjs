import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {deserialize} from 'node:v8';
import {findSections} from '../src/analysis/sections.ts';
import {findSections as baseline} from '../../state/sunshine-form-keys-20261018/baseline/src/analysis/sections.ts';
const dir=path.resolve('../state/sunshine-form-keys-20261018/form'),cases=[],regressions=[];
for(const [name,file] of [['fresh-no-hint','sunshine-fresh-input.bin'],['fresh-64','hint-64-input.bin'],['fresh-128','hint-128-input.bin']]){
  const input=deserialize(await fs.readFile(path.join(dir,file))),before=baseline(input);
  for(const hint of [undefined,[30,52],[130,170]]){
    const x={...input,chorus:hint},after=findSections(x);
    assert.equal(after[0].label,'intro');assert.equal(after[0].start,0);assert.ok(Math.abs(after[0].end-67.49)<.02);
    assert.equal(after.find(s=>s.start<=30&&s.end>30)?.label,'intro');
    const drops=after.filter(s=>s.label==='drop');assert.equal(drops.length,3);
    for(const [i,start,end] of [[0,97.5,112.5],[1,131.25,168.75],[2,255,292.5]]){
      assert.ok(Math.abs(drops[i].start-start)<.03,name+' entry '+i);assert.ok(Math.abs(drops[i].end-end)<.03,name+' exit '+i);
    }
    assert.ok(Math.abs(after.find(s=>s.label==='outro').start-300)<.03);
    for(let i=0;i<after.length;i++){assert.ok(after[i].end>after[i].start);if(i)assert.equal(after[i-1].end,after[i].start);}
    cases.push({name,chorusHint:hint??null,before,after});
  }
  // Exercise the old highlight fallback's promotion condition deliberately;
  // the acoustic form stays authoritative even when the opening is louder.
  const x={...input,chorus:[30,52],rms:input.rms.slice()};
  for(let i=0;i<67*x.fps;i++)x.rms[i]*=1.25;
  const after=findSections(x);assert.equal(after[0].label,'intro');assert.ok(after[0].energy>=.5);
  cases.push({name:name+'-louder-opening-adversarial-hint',chorusHint:x.chorus,after});
}
const oldInputs=path.resolve('../exports/Melodic-structure-20261018');
for(const file of (await fs.readdir(oldInputs)).filter(x=>x.endsWith('-input.bin')&&!x.startsWith('sunshine'))){
  const input=deserialize(await fs.readFile(path.join(oldInputs,file))),before=baseline(input),after=findSections(input);
  assert.deepEqual(after,before,file);regressions.push({name:file,sections:after.length,unchanged:true,lyrics:input.lyrics?.length??0});
}
const report={source:'D:/野葱视频转换器/音频转换/David Guetta,Avicii - Sunshine_1.mp3',freshInput:true,pcmDownmix:'arithmetic stereo mean, 22050Hz float32',cases,regressions,limits:'User specifies the intro semantic boundary. The onset and recurring rhythmic entry/exit anchors are independently confirmed from source envelopes and drum trains. Other semantic labels remain estimates; unchanged older recordings are regression evidence, not new manual ground truth.'};
await fs.writeFile(path.join(dir,'form-regression.json'),JSON.stringify(report,null,2));
await fs.writeFile(path.join(dir,'sunshine-sections-final.json'),JSON.stringify(cases[0].after,null,2));
console.log(JSON.stringify({source:report.source,freshCases:cases.length,otherInputsUnchanged:regressions.length,sections:cases[0].after.map(s=>[+s.start.toFixed(3),+s.end.toFixed(3),s.label])}));
