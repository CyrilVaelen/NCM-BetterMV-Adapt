import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {deserialize} from 'node:v8';
import {test} from 'node:test';
import {Music} from '../src/director/music.ts';
import {PULSE, WORD} from '../src/style/style.ts';
import type {Analysis, Section} from '../src/types.ts';
import type {Shot} from '../src/scenes/types.ts';

// Optional frozen director makes the same acceptance cases show the pre-fix failure.
const {planShots}=await import(process.env.ARMILLARY_BASELINE
  ? pathToFileURL(path.resolve(process.env.ARMILLARY_BASELINE)).href
  : '../src/director/director.ts');
const traits={graphic:false,lyrics:true}, noCardsOrCanvas=new Set(['cards','canvas']);
const orbit=(shots:Shot[])=>shots.filter(s=>s.scene==='crystal'&&s.variant==='orbit');
const gather=(shots:Shot[])=>shots.filter(s=>s.scene==='crystal'&&s.variant==='gather');

function recording():Analysis {
  const duration=80,fps=100,zero=new Float32Array(duration*fps),rms=new Float32Array(duration*fps).fill(.8);
  const section=(start:number,end:number,label:Section['label']):Section=>({start,end,label,energy:label==='drop'?1:label==='outro'?.3:.55,group:start,vocal:false});
  const sections=[section(0,8,'intro'),section(8,16,'build'),section(16,32,'drop'),section(32,40,'verse'),section(40,48,'build'),section(48,64,'drop'),section(64,80,'outro')];
  const beats=Array.from({length:duration*2},(_,i)=>i*.5);
  return {version:9,duration,bpm:120,meter:4,beats,beatInBar:beats.map((_,i)=>i%4),tempo:beats.map(()=>120),downbeats:beats.filter((_,i)=>i%4===0),sections,
    env:{fps,rms,low:new Float32Array(duration*fps).fill(.8),mid:zero,high:zero,onset:zero},hits:{kick:[],snare:[],hat:[],accent:[]}};
}

function assertCoverage(shots:Shot[],duration:number){
  assert.equal(shots[0].start,0);assert.equal(shots[shots.length-1].end,duration);
  for(let i=0;i<shots.length;i++){assert.ok(shots[i].end>shots[i].start);if(i)assert.ok(Math.abs(shots[i-1].end-shots[i].start)<1e-8,'no overlapping or missing frames');}
}

test('one pre-drop armillary is retained for the first actual Drop and never replayed before later Drops',()=>{
  for(const style of [PULSE,WORD])for(const seed of [1,42,20261020]){
    const a=recording(),original=structuredClone(a.sections);
    const shots:Shot[]=planShots(new Music(a),style,seed,traits,noCardsOrCanvas),run=orbit(shots);
    assert.equal(run.length,1,style.id+' '+seed);assert.equal(run[0].end,16);
    assert.ok(run[0].start>=8);assert.ok(shots.filter(s=>s.end>40&&s.start<48).every(s=>s.scene!=='crystal'));
    assert.deepEqual(a.sections,original,'decorative shot policy never shifts musical sections');assertCoverage(shots,a.duration);
  }
});

test('a song opening on Drop cannot defer its unavailable opening orbit to Drop2',()=>{
  const a=recording();a.sections[0].label='drop';
  const shots:Shot[]=planShots(new Music(a),PULSE,17,traits,noCardsOrCanvas);
  assert.equal(orbit(shots).length,0);assertCoverage(shots,a.duration);
});

test('an insufficient first build cannot cause the decorative introduction to reappear at a later Drop',()=>{
  const a=recording();a.sections[0].end=15;a.sections[1].start=15;
  const shots:Shot[]=planShots(new Music(a),PULSE,21,traits,noCardsOrCanvas);
  assert.equal(orbit(shots).length,0);assertCoverage(shots,a.duration);
});

test('disabling the armillary still disables both opening orbit and closing gather',()=>{
  const a=recording(),shots:Shot[]=planShots(new Music(a),PULSE,7,traits,new Set(['cards','canvas','crystal']));
  assert.equal(shots.filter(s=>s.scene==='crystal').length,0);assertCoverage(shots,a.duration);
});

test('the closing gather remains available and cannot intrude into a continuing Drop',()=>{
  const a=recording(),shots:Shot[]=planShots(new Music(a),PULSE,7,traits,noCardsOrCanvas);
  assert.equal(orbit(shots).length,1);assert.equal(gather(shots).length,1);assert.ok(gather(shots)[0].start>=64);
  const continuing=recording();continuing.sections[continuing.sections.length-1].label='drop';
  const noEnding:Shot[]=planShots(new Music(continuing),PULSE,7,traits,noCardsOrCanvas);
  assert.equal(gather(noEnding).length,0);assertCoverage(noEnding,continuing.duration);
});

test('Drop shots begin exactly at the musical entry, including immediately after the opening orbit',()=>{
  const a=recording(),shots:Shot[]=planShots(new Music(a),PULSE,13,traits,noCardsOrCanvas);
  for(const entry of [16,48]){
    const opening=shots.find(s=>s.start<=entry&&s.end>entry)!;
    assert.equal(opening.start,entry);assert.equal(opening.section.label,'drop');assert.notEqual(opening.scene,'crystal');
    assert.ok(shots.filter(s=>s.scene==='crystal'&&s.variant==='orbit').every(s=>s.end<=entry));
  }
});

test('saved Rush Over Me analysis has no repeated armillary around Drop2 and keeps its verified entry',()=>{
  const fixture=path.resolve('../exports/Rush-form-20261020/local-140-analysis-after.bin');
  const a=deserialize(fs.readFileSync(fixture)) as Analysis,original=structuredClone(a.sections);
  const entries=a.sections.filter((s,i)=>s.label==='drop'&&(i===0||a.sections[i-1].label!=='drop')).map(s=>s.start);
  assert.ok(entries.length>=2);const second=entries[1];
  for(const seed of [1,42,20261020]){
    const shots:Shot[]=planShots(new Music(a),PULSE,seed,traits,noCardsOrCanvas);
    assert.equal(orbit(shots).length,0,'its short first build skips orbit rather than deferring it to Drop2');
    assert.ok(shots.filter(s=>s.end>second-5&&s.start<second+1).every(s=>s.scene!=='crystal'));
    const opening=shots.find(s=>s.start<=second&&s.end>second)!;
    assert.equal(opening.start,second);assert.equal(opening.section.label,'drop');assert.notEqual(opening.scene,'crystal');
    const around=shots.filter(s=>s.end>second-5&&s.start<second+1);
    assert.ok(around[0].start<=second-5);assert.ok(around[around.length-1].end>=second+1);
    for(let i=1;i<around.length;i++)assert.ok(Math.abs(around[i-1].end-around[i].start)<1e-8,'Drop2 window has continuous coverage');
  }
  assert.deepEqual(a.sections,original);
});
