import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeTimbre} from '../src/analysis/timbre.ts';
import {Music} from '../src/director/music.ts';
import type {Analysis} from '../src/types.ts';

const sr=22050,duration=7;
const pcm=(f:(t:number)=>number)=>Float32Array.from({length:sr*duration},(_,i)=>f(i/sr));
const lead=(t:number)=>.08*(Math.sin(2*Math.PI*659.25*t)+.35*Math.sin(2*Math.PI*1318.5*t)+.18*Math.sin(2*Math.PI*1977.75*t));
const bassTimes=[.8,1.45,2.3,3.15,4.65,5.45,6.2];
const bass=(t:number,gain=1)=>bassTimes.reduce((s,on)=>{const a=t-on;if(a<0||a>.5)return s;return s+gain*.26*Math.exp(-a*9)*[1,.5,.3,.2].reduce((n,w,h)=>n+w*Math.sin(2*Math.PI*65.4*(h+1)*a),0);},0);
const fixture=(samples:Float32Array)=>{
  const timbre=analyzeTimbre(samples,sr),env=new Float32Array(duration*100+1).fill(.8);
  const a:Analysis={version:7,duration,bpm:120,meter:4,beats:Array.from({length:14},(_,i)=>i*.5),beatInBar:Array.from({length:14},(_,i)=>i%4),tempo:Array(14).fill(120),downbeats:[0,2,4,6],sections:[{start:0,end:duration,label:'drop',energy:1,vocal:false,group:0}],env:{fps:100,rms:env,low:env,mid:env,high:env,onset:env,lead:env,leadAttack:env,leadBrightness:env},hits:{kick:bassTimes.map(t=>[t,1]),snare:[],hat:[],accent:[]},timbre};
  return {a,m:new Music(a)};
};
const max=(m:Music,t:number,field:'attack'|'level',width=.16)=>{let x=0;for(let s=t;s<t+width;s+=1/120)x=Math.max(x,m.foregroundAt(s)[field]);return x;};

test('known held upper voice rejects independent loud bass attacks, then returns bass after the lead ends',()=>{
  for(const gain of [1,2]) {
    const {m}=fixture(pcm(t=>(t>.35&&t<3.9?lead(t):0)+bass(t,gain)));
    for(const t of [1.45,2.3,3.15]) {
      assert.ok(m.leadOwnership(t)>.8,'lost held lead ownership at '+t);
      assert.ok(max(m,t,'attack')<.28,'independent bass attack became a lead flash at '+t);
      assert.equal(m.roleHits('bassStab',t-.05,t+.18).length,0,'bass event re-entered under held lead');
    }
    assert.ok(m.roleHits('bassStab',4.5,6.6).length>=2,'bass solo did not recover after the upper voice stopped');
    assert.ok(max(m,5.45,'attack')>.25,'bass-only accent disappeared');
  }
});

test('short bright melody notes keep their attacks and ownership bridges note gaps without using bass timing',()=>{
  const notes=[.5,1.1,1.7,2.3,2.9,3.5];
  const {a,m}=fixture(pcm(t=>notes.reduce((s,on)=>{const age=t-on;return s+(age>=0&&age<.18?lead(t)*Math.min(1,age/.01)*Math.min(1,(.18-age)/.02):0);},0)+bass(t,1.5)));
  for(const t of notes)assert.ok(max(m,t,'attack',.14)>.3,'short lead note was removed at '+t);
  assert.ok(Math.max(...a.timbre!.melodyAttack!)>.6);
  // Two separated seeks reproduce the exact same precomputed owner and visual cue.
  const expected=m.foregroundAt(2.35);m.foregroundAt(6);m.foregroundAt(.1);assert.deepEqual(m.foregroundAt(2.35),expected);
});

test('bass overtones alone do not invent bright lead ownership',()=>{
  const {m}=fixture(pcm(t=>bass(t,2)));
  for(let t=.1;t<duration;t+=.025)assert.ok(m.leadOwnership(t)<.05,'distorted low voice was treated as a second lead');
});

test('a previous bass event yields its pulse and travelling ring to a new lead without reversing camera travel',()=>{
  const {m}=fixture(pcm(t=>(t>=1.05&&t<3?.1*(Math.sin(2*Math.PI*880*t)+.3*Math.sin(2*Math.PI*1760*t)):0)+bass(t)));
  const early=m.highlightHits(.75,.88);assert.ok(early.length>0,'fixture must contain an accepted bass before the lead');
  for(const [event]of early)assert.ok(m.foregroundEventWeight(event,1.3)<.05,'old bass ring remained at full strength under lead');
  let previous=m.foregroundMotion(.7);
  for(let t=.705;t<1.4;t+=.005){const next=m.foregroundMotion(t);assert.ok(next>=previous,'ownership change reversed camera');previous=next;}
  const expected=m.foregroundMotion(1.04);m.foregroundMotion(6);m.foregroundMotion(.1);assert.equal(m.foregroundMotion(1.04),expected);
});
