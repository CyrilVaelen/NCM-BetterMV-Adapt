import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeTimbre} from '../src/analysis/timbre.ts';
import {Music} from '../src/director/music.ts';
import type {Analysis,SectionLabel} from '../src/types.ts';

const sr=22050,duration=5,notes=[.6,1.3,2,2.7,3.4,4.6];
const keyboard=(t:number)=>notes.reduce((sum,on)=>{
  const age=t-on;if(age<0||age>.4)return sum;
  const amp=.1*(1-Math.exp(-age*300))*Math.exp(-age*5);
  return sum+amp*[196,246.94,293.66].reduce((s,f)=>s+Math.sin(2*Math.PI*f*age)+.14*Math.sin(2*Math.PI*f*2*age),0);
},0);
function music(signal:(t:number)=>number,label:SectionLabel):Music{
  const timbre=analyzeTimbre(Float32Array.from({length:sr*duration},(_,i)=>signal(i/sr)),sr),z=new Float32Array(duration*100+1);
  const a:Analysis={version:8,duration,bpm:120,meter:4,beats:Array.from({length:10},(_,i)=>i/2),beatInBar:Array.from({length:10},(_,i)=>i%4),tempo:Array(10).fill(120),downbeats:[0,2,4],sections:[{start:0,end:duration,label,energy:.7,vocal:false,group:0}],env:{fps:100,rms:z,low:z,mid:z,high:z,onset:z,lead:z,leadAttack:z,leadBrightness:z},hits:{kick:[],snare:[],hat:[],accent:[]},timbre};
  return new Music(a);
}

test('the same independently generated piano phrase stays a primary motion source under intro and outro labels',()=>{
  const drop=music(keyboard,'drop');
  for(const label of ['intro','outro']as const){
    const m=new Music({...drop.a,sections:[{...drop.a.sections[0],label}]});
    for(const onset of notes){
      const t=onset+.1,reference=drop.foregroundAt(t),cue=m.foregroundAt(t);
      assert.ok(reference.level>.3&&reference.attack>.15,'known source must be active');
      assert.ok(cue.level>=reference.level*.78,`${label} nearly muted the piano body at ${t}`);
      assert.ok(cue.attack>=reference.attack*.78,`${label} nearly muted the piano note at ${t}`);
    }
    assert.equal(m.foregroundAt(0).level,0);assert.equal(m.foregroundAt(duration).level,0);
    assert.ok(m.timbreAt(duration-.01).lead>.05,'fade assertion must exercise an audible outgoing note');
    assert.ok(m.foregroundAt(duration-.01).level<.02,'outgoing fade was bypassed');
  }
});

test('the melodic visibility floor does not boost bass-only backgrounds or invent sound in silence',()=>{
  const bass=(t:number)=>{const age=t-1;if(age<0||age>.6)return 0;return .3*Math.exp(-age*7)*[1,.5,.3,.2].reduce((s,g,h)=>s+g*Math.sin(2*Math.PI*65.4*(h+1)*age),0);};
  const base=music(bass,'drop'),intro=new Music({...base.a,sections:[{...base.a.sections[0],label:'intro'}]});
  let active=false;
  for(let t=1;t<1.4;t+=.01){const a=base.foregroundAt(t),b=intro.foregroundAt(t);if(a.attack>.2){active=true;assert.ok(b.attack<a.attack*.65,'bass-only background was promoted to melody');}}
  assert.ok(active);
  for(const t of [0,.2,3,4])assert.equal(intro.foregroundAt(t).attack,0);
});
