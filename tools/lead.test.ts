import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeLead, analyzeLeadSteps, localReference } from '../src/analysis/lead.ts';
import { computeSpectra, type Spectra } from '../src/analysis/spectrum.ts';
import { Slicer } from '../src/analysis/util.ts';
import { Music } from '../src/director/music.ts';
import type { Analysis } from '../src/types.ts';

const sr = 22050;
function spectrum(signal: (t:number)=>number, seconds=4): Spectra {
  const pcm=Float32Array.from({length:Math.round(sr*seconds)},(_,i)=>signal(i/sr));
  const steps=computeSpectra(pcm,sr,new Slicer(Infinity),0,1);
  for(;;){const next=steps.next();if(next.done)return next.value;}
}
const average=(a:Float32Array,from:number,to:number)=>a.slice(Math.round(from*100),Math.round(to*100)).reduce((x,y)=>x+y,0)/Math.round((to-from)*100);
const peak=(a:Float32Array,from:number,to:number)=>Math.max(...a.slice(Math.round(from*100),Math.round(to*100)));
const tone=(t:number,hz:number)=>0.3*Math.sin(2*Math.PI*hz*t)+0.12*Math.sin(4*Math.PI*hz*t);

test('silence and sub bass do not become a melodic lead through normalization',()=>{
  for(const signal of [()=>0,(t:number)=>0.6*Math.sin(2*Math.PI*65*t)]){
    const cue=analyzeLead(spectrum(signal));
    assert.ok(Math.max(...cue.level)<0.01);
    assert.ok(Math.max(...cue.attack)<0.01);
  }
});

test('held harmonics stay visible between kicks and off-grid notes create their own attack',()=>{
  const cue=analyzeLead(spectrum(t=>{
    const kickAge=t%0.5;
    const kick=0.5*Math.exp(-kickAge*35)*Math.sin(2*Math.PI*70*t);
    const hz=t<1.17?660:t<2.33?1046.5:784;
    return kick+(t>=0.4&&t<3.2?tone(t,hz):0);
  }));
  assert.ok(average(cue.level,0.7,0.95)>0.35,'held note disappeared between drum hits');
  assert.ok(peak(cue.attack,1.16,1.29)>0.35,'off-grid note change was missed');
  assert.ok(peak(cue.attack,1.16,1.29)>2*average(cue.attack,0.8,1.05),'steady tone is as attack-heavy as a note change');
  assert.ok(average(cue.brightness,1.5,2)>average(cue.brightness,0.7,1),'higher notes should brighten the melodic cue');
  assert.ok(average(cue.level,3.8,4)<0.08,'release never settled');
  for(const series of Object.values(cue))assert.ok(series.every((v:number)=>Number.isFinite(v)&&v>=0&&v<=1));
});

test('flat broadband spectra are weaker than equally loud sustained harmonics',()=>{
  const spec=spectrum(t=>tone(t,880));
  const harmonic=analyzeLead(spec);
  const flat={...spec,melAmp:new Float32Array(spec.melAmp.length).fill(0.04)};
  const noise=analyzeLead(flat);
  assert.ok(average(harmonic.level,1,3)>4*average(noise.level,1,3));
});

test('chunked analysis gives the same cues as synchronous analysis',()=>{
  const spec=spectrum(t=>tone(t,t<2?660:1046.5));
  const expected=analyzeLead(spec),steps=analyzeLeadSteps(spec,new Slicer(0),0.991,0.999);
  let progress=0, count=0;
  for(;;){
    const next=steps.next();
    if(next.done){assert.deepEqual(next.value,expected);break;}
    assert.ok(next.value>=progress&&next.value<=0.999);
    progress=next.value;count++;
  }
  assert.ok(count>1,'whole-song work should yield back to the player');
});

test('quiet low-mid plucked keys remain distinct before a louder climax',()=>{
  const notes=[0.4,0.9,1.4,1.9,2.4,2.9];
  const cue=analyzeLead(spectrum(t=>{
    let sample=0;
    for(const [i,onset] of notes.entries()){
      const age=t-onset,hz=[220,293.66,349.23][i%3];
      if(age>=0&&age<0.48)sample+=0.09*Math.exp(-age*9)*(Math.sin(2*Math.PI*hz*age)+0.3*Math.sin(4*Math.PI*hz*age));
    }
    if(t>=4&&t<6)sample+=2*tone(t,880);
    return sample;
  },7));
  for(const onset of notes){
    assert.ok(peak(cue.level,onset,onset+0.14)>0.25,'quiet electric-piano note lost to the later climax');
    assert.ok(peak(cue.attack,onset,onset+0.1)>0.3,'plucked-key attack missing');
    assert.ok(average(cue.level,onset+0.36,onset+0.45)<peak(cue.level,onset,onset+0.14)*0.6,'notes merged into a constant swell');
    let at=0,best=-1;
    for(let frame=Math.round((onset-0.1)*100);frame<Math.round((onset+0.15)*100);frame++)if(cue.attack[frame]>best){best=cue.attack[frame];at=frame/100;}
    assert.ok(at>=onset-0.03&&at<=onset+0.09,`note attack shifted to ${at} for ${onset}`);
  }
  assert.ok(average(cue.level,6.8,7)<0.01,'adaptive gain amplified the silent tail');
});

test('local gain reference uses only the preceding four seconds',()=>{
  const prefix=Float32Array.from([0.1,0.2,0.1,0.15,0.12,0.1]);
  const withFuture=Float32Array.from([...prefix,10,10]);
  assert.deepEqual(localReference(withFuture,1,0.02).slice(0,prefix.length),localReference(prefix,1,0.02));
  const expired=localReference(Float32Array.from([1,0.1,0.1,0.1,0.1]),1,0.02);
  assert.ok(expired[4]<expired[3]*0.2,'old climax never leaves the local window');
});

test('whole-song response is gentler outside Drops, continuous at boundaries and seekable',()=>{
  const series=new Float32Array(401).fill(0.8),zero=new Float32Array(401);
  const a:Analysis={version:2,duration:4,bpm:120,meter:4,beats:[0,0.5,1,1.5,2,2.5,3,3.5],beatInBar:[0,1,2,3,0,1,2,3],tempo:Array(8).fill(120),downbeats:[0,2],
    sections:[{start:0,end:1,label:'verse',energy:0.4,group:0,vocal:true},{start:1,end:3,label:'drop',energy:1,group:1,vocal:false},{start:3,end:4,label:'outro',energy:0.4,group:2,vocal:false}],
    env:{fps:100,rms:zero,low:zero,mid:zero,high:zero,onset:zero,lead:series,leadAttack:series,leadBrightness:series},hits:{kick:[],snare:[],hat:[],accent:[]}};
  const music=new Music(a);
  assert.ok(music.leadAt(0.5).level>0,'verse has no melodic response');
  assert.ok(music.leadAt(0.5).level<music.leadAt(2).level,'verse should be softer than Drop');
  assert.equal(music.leadAt(0).level,0);
  assert.ok(music.leadAt(1).level>0,'held note reset to zero at the boundary');
  for(const boundary of [1,3])assert.ok(Math.abs(music.leadAt(boundary-1e-5).level-music.leadAt(boundary+1e-5).level)<1e-4,'section gain jumped at a boundary');
  const first=music.leadAt(1.75);music.leadAt(2.9);assert.deepEqual(music.leadAt(1.75),first);
  assert.ok(music.leadAt(3.5).level>0,'outro has no melodic response');
  assert.ok(music.leadAt(3.99).level<music.leadAt(3.5).level,'song ending should fade');
  assert.equal(music.leadAt(4).level,0);
  assert.equal(music.leadAt(-0.1).level,0);
  delete a.env.lead;delete a.env.leadAttack;delete a.env.leadBrightness;
  assert.equal(music.leadAt(2).level,0);
  assert.equal(music.leadAt(2).attack,0);
  assert.equal(music.leadAt(2).brightness,0.5);
});
