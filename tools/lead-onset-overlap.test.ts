import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeTimbre } from '../src/analysis/timbre.ts';

// The labels here follow the independently generated sources, not the detector's role/brightness output.
const sampleRate=22050,duration=3.2;
const render=(signal:(t:number)=>number)=>Float32Array.from({length:Math.round(duration*sampleRate)},(_,i)=>signal(i/sampleRate));
const peak=(signal:Float32Array,from:number,to:number)=>Math.max(...signal.slice(Math.round(from*60),Math.round(to*60)));
const bass=(t:number,start:number)=>{
  const age=t-start;if(age<0||age>.6)return 0;
  return .5*Math.exp(-age*8)*[1,.6,.4,.2,.15].reduce((sum,gain,h)=>sum+gain*Math.sin(2*Math.PI*65.4*(h+1)*age),0);
};
const lead=(t:number,frequency:number)=>{
  const age=t-1;if(age<0||age>1.4)return 0;
  return .14*(1-Math.exp(-age*130))*[1,.3,.15].reduce((sum,gain,h)=>sum+gain*Math.sin(2*Math.PI*frequency*(h+1)*age),0);
};

for(const frequency of [660,880])for(const bassStart of [1,.9]) {
  test(`a known ${frequency} Hz lead keeps its first note with bass ${bassStart===1?'starting together':'starting 100 ms earlier'}`,()=>{
    const result=analyzeTimbre(render(t=>bass(t,bassStart)+lead(t,frequency)),sampleRate);
    assert.ok(peak(result.melodyAttack!,.98,1.12)>.45,'the real upper source lost its first attack to a bass harmonic');
    assert.ok(result.leadPresence![Math.round(1.1*60)]>.8,'upper ownership arrived after its first note');
    const attack=result.melodyAttack!;let first=-1;
    for(let i=Math.round(.95*60);i<Math.round(1.15*60);i++)if(attack[i]>.3){first=i/60;break;}
    assert.ok(first>=.97&&first<=1.08,`known upper onset at 1.000 was detected at ${first}`);
  });
}

test('a known bass with a long harmonic tail does not become an independent upper voice when made louder',()=>{
  for(const oddOnly of [false,true])for(const amplitude of [.08,.3,.8]) {
    const result=analyzeTimbre(render(t=>{
      const age=t-.4;if(age<0||age>2.2)return 0;
      let signal=0;
      for(let h=1;h<=48;h++)if(!oddOnly||h%2)signal+=Math.sin(2*Math.PI*65.4*h*age)/h;
      return amplitude*(1-Math.exp(-age*90))*(.6+.4*Math.cos(2*Math.PI*4.5*age))*signal;
    }),sampleRate);
    assert.ok(peak(result.leadPresence!,0,duration)<.05,`pure ${oddOnly?'odd':'all'} bass partials invented lead ownership at gain ${amplitude}`);
    assert.ok(peak(result.melodyAttack!,0,duration)<.1,'the bass tail invented a separate upper attack');
    assert.ok(peak(result.bassStab,0,duration)>.2,'rejecting the upper alias also removed the actual bass response');
  }
});

test('a single known lead onset survives silent padding and stays lit in the frequency texture',()=>{
  for(const seconds of [4,12,60]) {
    // The 60 s case places a 240 ms note in less than 1% of the entire input, below the former global quantiles.
    const noteLength=seconds===60?.24:2;
    const pcm=Float32Array.from({length:Math.round(seconds*sampleRate)},(_,i)=>{
      const t=i/sampleRate,age=t-1;
      return bass(t,1)+(age>=0&&age<noteLength?.14*(1-Math.exp(-age*130))*[1,.3,.15].reduce((sum,gain,h)=>sum+gain*Math.sin(2*Math.PI*880*(h+1)*age),0):0);
    });
    const result=analyzeTimbre(pcm,sampleRate);
    assert.ok(peak(result.melodyAttack!,.98,1.12)>.45,`single upper attack vanished after padding to ${seconds} s`);
    assert.ok(peak(result.lead,1.04,1.15)>.4,`single upper level vanished after padding to ${seconds} s`);
    const from=Math.round(1.04*60)*result.bands,to=Math.round(1.15*60)*result.bands;
    assert.ok(Math.max(...result.spectrum.slice(from,to))>.1,`single upper light vanished after padding to ${seconds} s`);
  }
});
