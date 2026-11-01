import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Music} from '../src/director/music.ts';
import type {Analysis} from '../src/types.ts';

function music():Music {
  const zero=new Float32Array(601),lead=new Float32Array(601).fill(.7);
  const a:Analysis={version:4,duration:6,bpm:120,meter:4,beats:[0,.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5],beatInBar:[0,1,2,3,0,1,2,3,0,1,2,3],tempo:Array(12).fill(120),downbeats:[0,2,4],
    sections:[{start:0,end:2,label:'verse',energy:.6,group:0,vocal:true},{start:2,end:4,label:'drop',energy:1,group:1,vocal:false},{start:4,end:6,label:'outro',energy:.2,group:2,vocal:false}],
    env:{fps:100,rms:zero,low:zero,mid:zero,high:zero,onset:zero,lead,leadAttack:lead,leadBrightness:lead},hits:{kick:[],snare:[],hat:[],accent:[]}};
  return new Music(a);
}
test('Drop geometry boost stays inside actual Drop boundaries and remains seekable',()=>{
  const m=music();
  for(const t of [-1,0,1.99,2,4,4.1,6])assert.equal(m.dropIntensity(t),0);
  assert.equal(m.dropIntensity(2.2),1);assert.equal(m.dropIntensity(3),1);
  assert.ok(m.dropIntensity(2.00001)<1e-6);assert.ok(m.dropIntensity(3.99999)<1e-6);
  const first=m.dropIntensity(2.07);m.dropIntensity(3.8);assert.equal(m.dropIntensity(2.07),first);
  const cue=m.leadAt(3);m.dropIntensity(3);assert.deepEqual(m.leadAt(3),cue);
});
