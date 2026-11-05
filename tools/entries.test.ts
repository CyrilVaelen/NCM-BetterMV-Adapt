import assert from 'node:assert/strict';
import {test} from 'node:test';
import {refineDropEntries,refineDropPreparations,alignDropBars} from '../src/analysis/entries.ts';
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
test('低通闷音滚奏接临门留白谷不会提前消耗 Drop 起点，且不误伤已全频段开启的真 Drop',()=>{
  const fps=100,total=38*fps,beats=Array.from({length:76},(_,i)=>i*.5);
  const makeCase=(muffledRoll:boolean)=>{
    const sections:Section[]=[
      {start:0,end:6,label:'build',energy:.5,group:0,vocal:false},
      {start:6,end:14,label:'drop',energy:.96,group:1,vocal:false},
      {start:14,end:32,label:'drop',energy:1,group:1,vocal:false},
      {start:32,end:38,label:'outro',energy:.2,group:2,vocal:false},
    ];
    const low=new Float32Array(total),high=new Float32Array(total),rms=new Float32Array(total),kicks:Hit[]=[];
    for(let i=0;i<total;i++){
      const t=i/fps;
      if(t<6){low[i]=.02;high[i]=.02;rms[i]=.25;}
      else if(t<12.2){
        // 6..12.2s：若为闷音滚奏则高频被低通压暗；若为已开启真 Drop 则高频全开
        low[i]=i%50<22?.34:.02;
        high[i]=muffledRoll?.035:.45;
        rms[i]=.82;
      }else if(t<14){
        // 12.2..14s：临门留白谷（或真 Drop 段内短暂切分停顿）
        low[i]=.0001;high[i]=.04;rms[i]=.14;
      }else if(t<32){
        low[i]=i%100<45?.38:.02;high[i]=.46;rms[i]=.88;
      }else{low[i]=.01;high[i]=.02;rms[i]=.12;}
    }
    for(let t=6;t<12;t+=.5)kicks.push([t,.85]);
    for(let t=14;t<32;t+=1)kicks.push([t,.95]);
    return {sections,beats,fps,low,high,rms,kicks};
  };

  // 1) 低通闷音滚奏 + 临门留白谷 -> 6..14s 归为 build，真 Drop 从 14.0s 全频段冲击开始
  const roll=makeCase(true);
  assert.equal(refineDropPreparations(roll),true);
  const firstDrop=roll.sections.find(s=>s.label==='drop');
  assert.ok(firstDrop&&Math.abs(firstDrop.start-14)<.03,`期望真 Drop 在 14s 开启，实际为 ${firstDrop?.start}`);
  for(const t of [7,11,13]){
    assert.equal(roll.sections.find(s=>t>=s.start&&t<s.end)?.label,'build',`${t}s 应归为 build`);
  }

  // 2) 对照保护：6s 起已全频段打开的真 Drop，不得因后续段内停顿被推迟起点
  const openDrop=makeCase(false),original=structuredClone(openDrop.sections);
  assert.equal(refineDropPreparations(openDrop),false);
  assert.deepEqual(openDrop.sections,original);
});
