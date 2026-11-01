import assert from 'node:assert/strict';
import {test} from 'node:test';
import {refineDropEntries,alignDropBars} from '../src/analysis/entries.ts';
import type {Section,Hit} from '../src/types.ts';

function fixture(entry=4.5){
  const sections:Section[]=[{start:0,end:4,label:'build',energy:.4,group:0,vocal:false},{start:4,end:10,label:'drop',energy:1,group:1,vocal:false},{start:10,end:16,label:'verse',energy:.5,group:2,vocal:false}];
  const low=Float32Array.from({length:1600},(_,i)=>i/100<entry?.00001:.35);
  const rms=Float32Array.from({length:1600},(_,i)=>i/100<entry?.1:.8);
  const beats=Array.from({length:32},(_,i)=>i*.5),kicks:Hit[]=[[entry,.9],[entry+.5,1]];
  return {sections,low,rms,beats,kicks,fps:100};
}
test('a melodic pickup cannot spend the Drop impact before the first full kick',()=>{
  const input=fixture();refineDropEntries(input);
  assert.equal(input.sections[1].start,4.5);assert.equal(input.sections[0].end,4.5);
  assert.equal(input.sections[1].end,10);assert.equal(input.sections[2].start,10);
  const once=structuredClone(input.sections);refineDropEntries(input);assert.deepEqual(input.sections,once);
});
test('a tight existing entry stays put even if a later kick is louder',()=>{
  const input=fixture(4.02),original=structuredClone(input.sections);refineDropEntries(input);assert.deepEqual(input.sections,original);
});
test('weak bass, absent kicks, distant hits and silence cannot relocate an entry',()=>{
  for(const change of ['weak','absent','distant','silence']){
    const input=fixture();
    if(change==='weak'){input.low.fill(.00001,450,470);input.kicks=[[4.5,.9]];}
    if(change==='absent')input.kicks=[];
    if(change==='distant')input.kicks=[[6,.9]];
    if(change==='silence'){input.low.fill(0);input.rms.fill(0);}
    const original=structuredClone(input.sections);refineDropEntries(input);assert.deepEqual(input.sections,original,change);
  }
});
test('adjacent Drop subdivisions are not mistaken for another instrumental entry',()=>{
  const input=fixture();input.sections[0].label='drop';const original=structuredClone(input.sections);refineDropEntries(input);assert.deepEqual(input.sections,original);
});
test('phrase phase follows the corrected entry without moving any note or beat time',()=>{
  const input=fixture(),times=[...input.beats],phase=input.beats.map((_,i)=>i%4),previous=[...phase];refineDropEntries(input);
  alignDropBars(input.beats,phase,input.sections,4);
  assert.deepEqual(input.beats,times);assert.equal(phase[9],0);assert.equal(phase[13],0);
  assert.deepEqual(phase.slice(0,9),previous.slice(0,9));assert.deepEqual(phase.slice(20),previous.slice(20));
});
