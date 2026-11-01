import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deserialize } from 'node:v8';
import assert from 'node:assert/strict';
import { findSections } from '../src/analysis/sections.ts';
const out=path.resolve('../exports/Melodic-structure-20261018');
const baseline=await import(pathToFileURL(path.resolve('../state/before-melodic-structure-20261018/source/src/analysis/sections.ts')).href);
const result={target:[],regressions:[],limits:'Finite recordings; unchanged baseline is regression evidence, not a claim of perfect pre-existing labels or every genre.'};
for(const name of ['love','love-live','love-online','sunshine','homura','homura-live','cant','cant-live','fellow','fellow-live','conan','timeflies','loveeasy','already']) {
  const input=deserialize(await fs.readFile(path.join(out,name+'-input.bin'))), before=baseline.findSections(input), after=findSections(input);
  assert.ok(after.length && after[0].start===0 && after.at(-1).end===input.duration);
  for(let i=0;i<after.length;i++) {assert.ok(after[i].end>after[i].start);if(i)assert.equal(after[i-1].end,after[i].start);}
  if(name.startsWith('love') && name!=='loveeasy') {
    const at=t=>after.find(s=>t>=s.start&&t<s.end)?.label;
    assert.equal(at(22),'pre',name+' 22s');assert.equal(at(69),'build',name+' 1:08 vicinity');
    assert.equal(at(133),'verse',name+' 2:13');assert.equal(at(148),'pre',name+' 2:28');
    if(name!=='love-online') assert.equal(at(68),'build',name+' 68s with calibrated local LRC');
    for(const t of [100,110,120,195,205,215]) assert.equal(at(t),'drop',name+' true release '+t);
    result.target.push({name,checks:[[22,at(22)],[68,at(68)],[69,at(69)],[133,at(133)],[148,at(148)]],before,after});
  } else {
    assert.deepEqual(after,before,name+' segmentation changed');result.regressions.push({name,unchanged:true,sections:after.length,lyrics:input.lyrics?.length??0});
  }
}
const truth=JSON.parse(await fs.readFile('tools/truth/time-flies.json','utf8'));
const timeInput=deserialize(await fs.readFile(path.join(out,'timeflies-input.bin'))), sections=findSections(timeInput);
let correct=0,total=0;
for(let t=0;t<timeInput.duration;t+=.1) {
  const expected=truth.sections.find(s=>t>=s.start+.8&&t<s.end-.8);if(!expected)continue;total++;
  if(expected.name.split('|').includes(sections.find(s=>t>=s.start&&t<s.end).label))correct++;
}
assert.equal(correct,total);result.annotatedTimeFlies={correct,total,boundaryToleranceSeconds:.8};
await fs.writeFile(path.join(out,'regression.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({targetInputs:result.target.length,unchangedInputs:result.regressions.length,unchangedRecordings:new Set(result.regressions.map(r=>r.name.replace('-live',''))).size,annotatedTimeFlies:result.annotatedTimeFlies}));
