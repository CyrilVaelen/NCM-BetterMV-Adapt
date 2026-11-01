import fs from 'node:fs/promises';
import path from 'node:path';
import { deserialize } from 'node:v8';
import assert from 'node:assert/strict';
import { analyze } from '../src/analysis/index.ts';
const out=path.resolve('../exports/Melodic-structure-20261018'), rows=[];
for(const [name,pcmPath]of [['love-live',path.join(out,'love-mono.f32')],['sunshine',path.resolve('../exports/Sunshine-keyboard-response/sunshine-mono.f32')],['homura-live',path.resolve('../exports/Sunshine-keyboard-response/homura-regression.f32')]]) {
  const bytes=await fs.readFile(pcmPath), pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  const input=deserialize(await fs.readFile(path.join(out,name+'-input.bin'))),before=deserialize(await fs.readFile(path.join(out,name+'-analysis-before.bin')));
  const after=analyze(pcm,22050,{lyrics:input.lyrics,chorusHint:input.chorus,bpmHint:name==='love-live'?125:undefined});
  assert.equal(after.version,5);
  for(const key of ['duration','bpm','namedBpm','meter','beats','tempo','hits','env']) assert.deepEqual(after[key],before[key],name+' '+key);
  if(name!=='love-live') assert.deepEqual({...after,version:before.version},before,name+' full analysis');
  else {
    for(const [t,label]of [[22,'pre'],[68,'build'],[133,'verse'],[148,'pre'],[100,'drop'],[195,'drop']])assert.equal(after.sections.find(s=>t>=s.start&&t<s.end).label,label);
  }
  rows.push({name,version:after.version,beatTimesAndHitsAndEnvelopesUnchanged:true,wholeAnalysisUnchangedExceptVersion:name!=='love-live'});
  console.log(JSON.stringify(rows.at(-1)));
}
await fs.writeFile(path.join(out,'pipeline-regression.json'),JSON.stringify(rows,null,2));
