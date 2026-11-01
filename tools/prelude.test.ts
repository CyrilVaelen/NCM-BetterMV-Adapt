import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findPrelude,refinePreludeDropExits,refinePreludeEntry,refinePreludeRhythmEntries,type PreludeInput} from '../src/analysis/prelude.ts';
import type {Section,Hit} from '../src/types.ts';

// Known arrangement, independent of the detector: an edge groove surrounds two
// distinct returns of a main theme. Similarity comes from these timbral vectors,
// not from the detector's own labels or a desired boundary mask.
function arrangement(step=2):PreludeInput {
  const n=100,db=new Float64Array(n).fill(-19),bass=new Float64Array(n).fill(-35),drive=new Float64Array(n),voices:number[][]=[];
  for(let j=0;j<n;j++){
    const edge=j<24||j>=84,core=j>=44&&j<52||j>=60&&j<76;
    voices.push(edge?[1,.12,.03,.07]:core?[.02,.1,1,.05]:[.04,1,.08,.2]);
    if(j>=12&&j<24||j>=84){db[j]=-8;bass[j]=-9;drive[j]=2.5;}
    if(core){db[j]=-7;bass[j]=-10;drive[j]=2.3;}
    if(j>=24&&j<28){db[j]=-15;bass[j]=-25;drive[j]=.3;}
    if(j>=28&&j<30){db[j]=-34;bass[j]=-55;}
    if(j>=38&&j<44){db[j]=-15;bass[j]=-24;drive[j]=.3;}
  }
  const similarity=new Float64Array(n*n);
  for(let a=0;a<n;a++)for(let b=0;b<n;b++){
    const p=voices[a],q=voices[b];let dot=0,p2=0,q2=0;
    for(let k=0;k<p.length;k++){dot+=p[k]*q[k];p2+=p[k]**2;q2+=q[k]**2;}
    similarity[a*n+b]=dot/Math.sqrt(p2*q2);
  }
  return {time:Array.from({length:n},(_,j)=>j*step),end:n*step,db,bass,drive,similarity};
}

test('a loud DJ opening remains intro until the independently specified thematic restart',()=>{
  for(const step of [1.6,2,2.8]){const x=arrangement(step),p=findPrelude(x);assert.ok(p);assert.equal(p.endBar,30);assert.deepEqual(p.releases,[[44,52],[60,76]]);}
});
test('the same physical arrangement survives a half-tempo summary',()=>{
  const x=arrangement(),n=x.time.length/2;
  const avg=(a:Float64Array)=>Float64Array.from({length:n},(_,j)=>(a[2*j]+a[2*j+1])/2);
  const similarity=new Float64Array(n*n);
  for(let a=0;a<n;a++)for(let b=0;b<n;b++)similarity[a*n+b]=x.similarity[(a*2)*x.time.length+b*2];
  const y={...x,time:x.time.filter((_,i)=>i%2===0),db:avg(x.db),bass:avg(x.bass),drive:avg(x.drive),similarity};
  assert.equal(y.time[findPrelude(y)!.endBar],x.time[findPrelude(x)!.endBar]);
});
test('a genuine first release, missing returns, missing edge correspondence, no reset, and silence cannot activate the prelude model',()=>{
  for(const mode of ['first-is-main','no-return','different-outro','no-reset','silence']){
    const x=arrangement(),n=x.time.length;
    if(mode==='first-is-main')for(let a=12;a<24;a++)for(let b=44;b<76;b++)x.similarity[a*n+b]=x.similarity[b*n+a]=.98;
    if(mode==='no-return')for(let a=44;a<52;a++)for(let b=60;b<76;b++)x.similarity[a*n+b]=x.similarity[b*n+a]=0;
    if(mode==='different-outro')for(let a=0;a<84;a++)for(let b=84;b<n;b++)x.similarity[a*n+b]=x.similarity[b*n+a]=0;
    if(mode==='no-reset')x.db.fill(-18,24,44);
    if(mode==='silence'){x.db.fill(-100);x.bass.fill(-100);x.drive.fill(0);}
    assert.equal(findPrelude(x),undefined,mode);
  }
});
const sections=(a:number,b:number):Section[]=>[{start:0,end:a,label:'intro',energy:.5,group:0,vocal:false},{start:a,end:b,label:'verse',energy:.4,group:1,vocal:false}];
test('thematic entry follows an actual note attack rather than the nearest bar or a broadband rise',()=>{
  const beats=Array.from({length:32},(_,j)=>j*.5),low=new Float32Array(1600).fill(.00001),rms=new Float32Array(1600).fill(.03);
  low.fill(.2,473);rms.fill(.5,473);
  const s=sections(4.5,16);refinePreludeEntry(s,beats,low,rms,100);assert.equal(s[0].end,4.73);assert.equal(s[1].start,4.73);
  const noise=sections(4.5,16);low.fill(.00001);refinePreludeEntry(noise,beats,low,rms,100);assert.equal(noise[0].end,4.5);
});
function exitFixture(){
  const s:Section[]=[{start:4,end:12,label:'drop',energy:1,group:0,vocal:false},{start:12,end:20,label:'break',energy:.4,group:1,vocal:false}];
  const beats=Array.from({length:40},(_,j)=>j*.5),kicks:Hit[]=beats.filter(t=>t>=4&&t<11).map(t=>[t,.9]),low=Float32Array.from({length:2000},(_,j)=>j<1100?.4:.005);
  return {s,beats,kicks,low};
}
test('an outgoing release follows the first missing regular kick, including a coarse half-tempo grid',()=>{
  for(const half of [false,true]){const x=exitFixture(),beats=half?x.beats.filter((_,j)=>j%2===0):x.beats,original=[...beats];refinePreludeDropExits(x.s,beats,x.kicks,x.low,100,2);assert.equal(x.s[0].end,11);assert.equal(x.s[1].start,11);assert.deepEqual(beats,original);}
});
test('one omitted kick or a continuing bass line cannot move a release exit',()=>{
  for(const mode of ['one-missed','bass-continues']){const x=exitFixture();if(mode==='one-missed')x.kicks.push([11.5,.9],[12,.9],[12.5,.9]);else x.low.fill(.4);refinePreludeDropExits(x.s,x.beats,x.kicks,x.low,100,2);assert.equal(x.s[0].end,12,mode);}
});
test('a coarse entry is corrected to the first returning bass attack even when a later kick lies on its bar',()=>{
  const s=sections(5.5,16);s[1].label='drop';const low=Float32Array.from({length:1600},(_,j)=>j<450?.00001:.3),rms=Float32Array.from({length:1600},(_,j)=>j<450?.03:.6),beats=Array.from({length:32},(_,j)=>j*.5),kicks:Hit[]=[[4.5,.9],[5,.9],[5.5,.9],[6,.9]];
  refinePreludeRhythmEntries(s,beats,kicks,low,rms,100,2);assert.equal(s[1].start,4.5);assert.equal(s[0].end,4.5);
});
test('ordinary deep between-kick troughs in a continuing groove cannot pull a legitimate entry earlier',()=>{
  const s=sections(5.5,16);s[1].label='drop';
  const beats=Array.from({length:32},(_,j)=>j*.5),kicks:Hit[]=beats.map(t=>[t,.9]);
  const low=Float32Array.from({length:1600},(_,j)=>j%50<15?.3:.0001),rms=new Float32Array(1600).fill(.5);
  refinePreludeRhythmEntries(s,beats,kicks,low,rms,100,2);assert.equal(s[0].end,5.5);assert.equal(s[1].start,5.5);
});
