import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeTimbre} from '../src/analysis/timbre.ts';
import {Music} from '../src/director/music.ts';
import type {Analysis} from '../src/types.ts';

// Independently specified source times/frequencies, not labels inferred from the detector under test.
const sr=22050,duration=6,notes=[.42,1.08,1.82,2.61,3.37,4.19];
const bassTimes=[.73,1.47,2.22,2.98,3.75,4.58,5.25];
const pcm=(signal:(t:number)=>number)=>Float32Array.from({length:sr*duration},(_,i)=>signal(i/sr));
const ep=(t:number,frequencies:number[],fm=false)=>notes.reduce((sum,start)=>{
  const age=t-start;if(age<0||age>.5)return sum;
  const amp=.10*(1-Math.exp(-age*300))*Math.exp(-age*7);
  return sum+amp*frequencies.reduce((s,f)=>s+(fm
    ?Math.sin(2*Math.PI*f*age+(.9*Math.exp(-age*9)+.18)*Math.sin(2*Math.PI*f*3.53*age))
    :[1,.16,.055].reduce((v,g,h)=>v+g*Math.sin(2*Math.PI*f*(h+1)*age),0)),0)/Math.sqrt(frequencies.length);
},0);
const bass=(t:number,gain=1)=>bassTimes.reduce((sum,start)=>{const a=t-start;if(a<0||a>.5)return sum;return sum+gain*.3*Math.exp(-a*9)*[1,.55,.3,.2,.12].reduce((s,g,h)=>s+g*Math.sin(2*Math.PI*65.4*(h+1)*a),0);},0);
function percussion(){let seed=9124;return(t:number)=>{seed=(Math.imul(seed,1664525)+1013904223)|0;const noise=((seed>>>0)/2**32-.5)*2,k=(t+.08)%.5,s=(t+.16)%.5,h=t%.125;return .4*Math.exp(-k*32)*Math.sin(2*Math.PI*(53*k+2.1*(1-Math.exp(-k*35))))+.2*Math.exp(-s*27)*noise+.08*Math.exp(-h*80)*noise;};}
const make=(samples:Float32Array)=>{
  const timbre=analyzeTimbre(samples,sr),z=new Float32Array(duration*100+1),a:Analysis={version:8,duration,bpm:120,meter:4,beats:Array.from({length:12},(_,i)=>i/2),beatInBar:Array.from({length:12},(_,i)=>i%4),downbeats:[0,2,4],tempo:Array(12).fill(120),sections:[{start:0,end:duration,label:'intro',energy:.5,vocal:false,group:0}],env:{fps:100,rms:z,low:z,mid:z,high:z,onset:z,lead:z,leadAttack:z,leadBrightness:z},hits:{kick:[],snare:[],hat:[],accent:[]},timbre};
  return {a,m:new Music(a),t:timbre};
};
const max=(a:Float32Array,from:number,to:number)=>Math.max(...a.slice(Math.floor(from*60),Math.ceil(to*60)));

for(const [label,frequencies,fm]of [
  ['dim electric-piano chord',[196,246.94,293.66],false],
  ['inharmonic FM chord',[146.83,220,277.18],true],
  ['low-mid FM single notes',[164.81],true],
]as const){
  test(`${label} retains actual note attacks over independently timed bass and percussion`,()=>{
    const drum=percussion(),{m,t}=make(pcm(s=>ep(s,[...frequencies],fm)+bass(s,1.4)+drum(s)));
    for(const onset of notes){
      assert.ok(max(t.melodyAttack!,onset-.02,onset+.14)>.3,`known keyboard attack missing at ${onset}; all peaks ${notes.map(s=>max(t.melodyAttack!,s-.02,s+.14).toFixed(3))}`);
      assert.ok(m.highlightHits(onset-.025,onset+.15).some(h=>h[1]>.22),`keyboard note never reached shared scene events at ${onset}`);
      const light=t.spectrum.slice(Math.floor((onset+.03)*60)*t.bands,Math.ceil((onset+.15)*60)*t.bands);
      assert.ok(Math.max(...light)>.1,`keyboard note never reached frequency-driven scene light at ${onset}`);
      let motion=0;for(let t=onset;t<onset+.2;t+=1/120)motion=Math.max(motion,m.foregroundAt(t).attack);
      assert.ok(motion>.16,`intro section removed keyboard movement at ${onset}`);
    }
    const expected=m.foregroundAt(2.68);m.foregroundAt(5.5);m.foregroundAt(.1);assert.deepEqual(m.foregroundAt(2.68),expected);
  });
}

test('a dark held keyboard keeps body motion without flashing on independently timed bass/drums',()=>{
  const drum=percussion(),{m,t}=make(pcm(s=>(s>.4&&s<4.5?.12*(Math.sin(2*Math.PI*261.63*s)+.1*Math.sin(2*Math.PI*523.26*s)):0)+bass(s,1.3)+drum(s)));
  for(const onset of [1.47,2.22,2.98,3.75]){
    assert.ok(m.leadOwnership(onset)>.8,'dark pitched keyboard lost ownership');
    assert.ok(m.foregroundAt(onset+.06).level>.24,`keyboard body movement vanished ${onset}: ${JSON.stringify(m.foregroundAt(onset+.06))}`);
    assert.ok(max(t.melodyAttack!,onset,onset+.16)<.3,`bass or drums invented a new keyboard attack at ${onset}: ${max(t.melodyAttack!,onset,onset+.16)}`);
    assert.equal(m.roleHits('bassStab',onset-.02,onset+.15).length,0,'bass events interrupted the keyboard');
  }
});

test('new persistent-partial keyboard detection rejects broadband drums and bass-only harmonics',()=>{
  for(const onlyBass of [false,true]){
    const drum=percussion(),{t}=make(pcm(s=>onlyBass?bass(s,2):drum(s)));
    assert.ok(max(t.lead,0,duration)<.04,`a non-keyboard input invented a melodic body ${onlyBass?'bass':'drums'}: ${max(t.lead,0,duration)}`);
    assert.ok(max(t.melodyAttack!,0,duration)<.04,'a non-keyboard input invented a melodic strike');
  }
});

for(const noteLength of [.12,.18]) {
  test(`a ${noteLength}s bright lead keeps every first attack over a held dark polyphonic pad`,()=>{
    const starts=[.7,1.38,2.09,2.77,3.44,4.13];
    const pad=(s:number)=>s>.35&&s<4.9?.075*(Math.sin(2*Math.PI*220*s)+.8*Math.sin(2*Math.PI*261.63*s)+.07*Math.sin(2*Math.PI*440*s)):0;
    const bright=(s:number)=>starts.reduce((sum,onset)=>{
      const age=s-onset;if(age<0||age>noteLength)return sum;
      const envelope=Math.min(1,age/.008)*Math.min(1,(noteLength-age)/.012);
      return sum+.10*envelope*(Math.sin(2*Math.PI*880*age)+.3*Math.sin(2*Math.PI*1760*age)+.13*Math.sin(2*Math.PI*2640*age));
    },0);
    const drums=percussion(),controlDrums=percussion();
    const {m,t}=make(pcm(s=>pad(s)+bright(s)+bass(s,1.2)+drums(s)));
    const {t:control}=make(pcm(s=>pad(s)+bass(s,1.2)+controlDrums(s)));
    for(const onset of starts){
      const attack=max(t.melodyAttack!,onset-.02,onset+.13);
      assert.ok(attack>.35,`held pad swallowed the short lead attack at ${onset}: ${attack}`);
      assert.ok(m.highlightHits(onset-.025,onset+.14).some(h=>h[1]>.25),`short lead never reached foreground events at ${onset}`);
      assert.ok(max(control.melodyAttack!,onset-.02,onset+.13)<.2,`the same bass/drums caused a false pad attack without lead at ${onset}; lead ${starts.map(s=>max(t.melodyAttack!,s-.02,s+.13).toFixed(3))}; control ${starts.map(s=>max(control.melodyAttack!,s-.02,s+.13).toFixed(3))}`);
      let first=-1;
      for(let i=Math.round((onset-.025)*60);i<Math.round((onset+.14)*60);i++)if(t.melodyAttack![i]>.3){first=i/60;break;}
      assert.ok(first>=onset-.035&&first<=onset+.09,`short lead onset ${onset} moved to ${first}`);
    }
  });
}
