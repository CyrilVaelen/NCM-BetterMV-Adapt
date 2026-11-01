import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeTimbre, analyzeTimbreSteps } from '../src/analysis/timbre.ts';
import { Slicer } from '../src/analysis/util.ts';
import { Music } from '../src/director/music.ts';
import { Director } from '../src/director/director.ts';
import { Spectrogram,SpecRing,COLS } from '../src/scenes/viz.ts';
import type { Analysis } from '../src/types.ts';
const sr=22050, notes=[.4,1.13,1.9,2.7];
const sample=(fn:(t:number)=>number)=>Float32Array.from({length:sr*4},(_,i)=>fn(i/sr));
const peak=(a:Float32Array,from=0,to=4)=>Math.max(...a.slice(Math.round(from*60),Math.round(to*60)));
function noise(){let seed=917;return()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return ((seed>>>0)/2**32-.5)*2;};}
const stab=(t:number,f=440)=>notes.reduce((sum,onset)=>{const age=t-onset;return age<0||age>.3?sum:sum+.12*Math.exp(-age*9)*[1,.6,.3,.2].reduce((s,g,h)=>s+g*Math.sin(2*Math.PI*f*(h+1)*age),0);},0);
const bass=(t:number)=>notes.reduce((sum,onset)=>{const age=t-onset;return age<0||age>.4?sum:sum+.3*Math.exp(-age*9)*[1,.5,.4,.3,.2].reduce((s,g,h)=>s+g*Math.sin(2*Math.PI*65.4*(h+1)*age),0);},0);
function drums(){const random=noise();return(t:number)=>{const k=t%.5,h=t%.125,s=(t+.25)%.5;return .8*Math.exp(-k*32)*Math.sin(2*Math.PI*(55*k+2.5*(1-Math.exp(-k*35))))+.4*Math.exp(-s*24)*random()+.15*Math.exp(-h*70)*random();};}

test('silence, broadband noise and a kick/snare/hat arrangement cannot become foreground light',()=>{
  const random=noise();
  for(const signal of [()=>0,()=>random()*.3,drums()]) {
    const v=analyzeTimbre(sample(signal),sr);
    for(const name of ['synthStab','bassStab','lead','leadAttack','spectrum'] as const)assert.ok(Math.max(...v[name])<.03,name+' falsely lit');
  }
});
test('upper synth stabs and harmonic bass stabs have distinct roles and keep off-grid timing',()=>{
  const upper=analyzeTimbre(sample(t=>stab(t)),sr),lower=analyzeTimbre(sample(bass),sr);
  for(const t of notes) {
    assert.ok(peak(upper.synthStab,t-.03,t+.12)>.5,'synth articulation missing');
    assert.ok(peak(lower.bassStab,t-.03,t+.12)>.35,'bass articulation missing');
    let frame=0,value=-1;
    for(let i=Math.round((t-.08)*60);i<Math.round((t+.15)*60);i++)if(upper.synthStab[i]>value){frame=i;value=upper.synthStab[i];}
    assert.ok(frame/60>=t-.03&&frame/60<=t+.09,`attack displaced from ${t} to ${frame/60}`);
  }
  assert.ok(peak(upper.bassStab)<.03,'synth subharmonic misidentified as a bass');
  assert.ok(peak(lower.synthStab)<.03,'bass overtones invented a second synth');
  assert.ok(peak(upper.synthStab,3.5,4)<.03);
});
test('a real pitched stab can still light up when it coincides with a drum',()=>{
  const drum=drums(),v=analyzeTimbre(sample(t=>stab(t)+drum(t)),sr);
  for(const t of notes) assert.ok(peak(v.synthStab,t-.03,t+.13)>.3,'mixed stab lost at '+t);
});
test('held leads remain visible, but a steady note does not flash every beat',()=>{
  const v=analyzeTimbre(sample(t=>t>.4&&t<3.2?.15*(Math.sin(2*Math.PI*(t<1.6?660:880)*t)+.3*Math.sin(4*Math.PI*(t<1.6?660:880)*t)):0),sr);
  assert.ok(peak(v.lead,.8,1.4)>.7);
  assert.ok(peak(v.leadAttack,.4,.52)>.6);assert.ok(peak(v.leadAttack,1.6,1.72)>.4);
  assert.ok(peak(v.leadAttack,.85,1.4)<.1);assert.ok(peak(v.synthStab)<.03);
  for(const arr of [v.lead,v.leadAttack,v.bassStab,v.synthStab,v.spectrum,v.confidence,v.brightness])assert.ok(arr.every(x=>Number.isFinite(x)&&x>=0&&x<=1));
});
test('adding loud drums under an uninterrupted lead does not invent new note attacks',()=>{
  const drum=drums(),v=analyzeTimbre(sample(t=>(t>.4&&t<3.2?.15*(Math.sin(2*Math.PI*660*t)+.3*Math.sin(4*Math.PI*660*t)):0)+drum(t)),sr);
  assert.ok(peak(v.lead,.9,2.8)>.6,'underlying held lead disappeared');
  assert.ok(peak(v.leadAttack,.9,2.8)<.15,'drum/confidence recovery invented a lead attack');
  assert.ok(peak(v.synthStab,.9,2.8)<.15,'drum/confidence recovery invented a synth stab');
  assert.ok(peak(v.bassStab,.9,2.8)<.15,'a kick stole the lead overtones');
});
test('chunking and repeated seeks reproduce the same foreground while silence still yields',()=>{
  for(const pcm of [sample(t=>stab(t)),new Float32Array(sr*4)]) {
    const expected=analyzeTimbre(pcm,sr),steps=analyzeTimbreSteps(pcm,sr,new Slicer(0),.6,.9);let progress=.6,count=0;
    for(;;){const next=steps.next();if(next.done){assert.deepEqual(next.value,expected);break;}assert.ok(next.value>=progress&&next.value<=.9);progress=next.value;count++;}
    assert.ok(count>1);
  }
});
function musicFixture():Analysis {
  const z=new Float32Array(401),lead=new Float32Array(401).fill(.9);
  return {version:6,duration:4,bpm:120,meter:4,beats:[0,.5,1,1.5,2,2.5,3,3.5],beatInBar:[0,1,2,3,0,1,2,3],tempo:Array(8).fill(120),downbeats:[0,2],sections:[{start:0,end:1,label:'verse',energy:.8,group:0,vocal:true},{start:1,end:3,label:'drop',energy:1,group:1,vocal:false},{start:3,end:4,label:'outro',energy:.4,group:2,vocal:false}],env:{fps:100,rms:lead,low:lead,mid:lead,high:lead,onset:lead,lead,leadAttack:lead,leadBrightness:lead},hits:{kick:[[1.13,1]],snare:[],hat:[],accent:[]}};
}
test('Drop highlights never fall back to broad mix onsets; other sections and old analyses retain their behavior',()=>{
  const a=musicFixture(),old=new Music(a);a.timbre=analyzeTimbre(sample(drums()),sr);const m=new Music(a);
  assert.equal(m.foregroundAt(2).attack,0);assert.ok(m.leadAt(2).attack>.8);
  // With .11's all-section timbre path, drum-only timbre stays dark outside the Drop too. Removing the role
  // analysis below is the compatibility check for old cached songs.
  for(const t of [.3,.8,3.5])assert.equal(m.foregroundAt(t).level,0);
  const first=m.foregroundAt(1.5);m.foregroundAt(2.8);assert.deepEqual(m.foregroundAt(1.5),first);
  a.timbre=analyzeTimbre(sample(t=>stab(t)),sr);const pitched=new Music(a);
  assert.ok(pitched.highlightHits(1.1,1.3).length,'a synth coincident with the kick was discarded');
  delete a.timbre;assert.deepEqual(new Music(a).foregroundAt(2),old.leadAt(2));
});
test('a bright lead owns simultaneous bass movement, while bass-only and dim-lead hits remain available',()=>{
  const make=(brightness:number)=>{
    const a=musicFixture(),n=401,zeros=()=>new Float32Array(n),lead=zeros(),bassStab=zeros(),leadAttack=zeros();
    lead.fill(.55,185,225);bassStab[199]=.4;bassStab[200]=.9;bassStab[201]=.3;
    leadAttack[199]=.12;leadAttack[200]=.42;leadAttack[201]=.08;
    a.hits.kick=[[2,1]];
    a.env.lead!.fill(.9);a.env.leadAttack!.fill(.1);a.env.leadBrightness!.fill(brightness);
    a.timbre={fps:100,bands:64,hz:new Float32Array(64),spectrum:new Float32Array(n*64),synthStab:zeros(),bassStab,lead,leadAttack,confidence:zeros(),brightness:new Float32Array(n).fill(.25)};
    return {a,m:new Music(a)};
  };
  const bright=make(.5),gain=1,foreground=bright.m.foregroundAt(2);
  assert.ok(Math.abs(foreground.level-.55*gain)<.01,'bass level won over the bright sustained lead');
  assert.ok(Math.abs(foreground.attack-.42*gain)<.01,'bass attack replaced the lead attack');
  assert.ok(Math.abs(foreground.brightness-.5)<.01,'bass spectrum replaced the lead brightness');
  assert.deepEqual(bright.m.roleHits('bassStab',1.9,2.1),[],'simultaneous bass stab still triggered a separate effect');
  assert.ok(bright.m.roleHits('lead',1.9,2.1).length,'lead event was removed with the bass');
  assert.ok(bright.m.highlightHits(1.9,2.1).some(h=>h[0]===2),'shared foreground highlight no longer follows the lead');
  assert.ok(bright.m.pulse('kick',2.01,.16)<.45,'kick pulse retained full bass impact over the lead');

  const dim=make(.2);
  assert.ok(dim.m.roleHits('bassStab',1.9,2.1).length,'bass-only priority path stopped responding');
  assert.ok(dim.m.foregroundAt(2).level>.65*.9*.6,'dim lead incorrectly took priority over the bass hit');
});
test('raw frequency geometry and foreground light occupy separate texture channels and survive seek order',()=>{
  const pcm=sample(drums()),left=Int16Array.from(pcm,v=>v*20000),st={left,right:left,rate:sr};
  const spec=Spectrogram.of(st,4,64,30),v=analyzeTimbre(pcm,sr),ring=new SpecRing(spec,32,v),c=Math.round(.52*COLS);
  ring.sync(c-2,c+2);const data=ring.texture.image.data as Uint8Array;
  let red=0,green=0;for(let b=0;b<64;b++){red+=data[((c%32)*64+b)*4];green+=data[((c%32)*64+b)*4+1];}
  assert.ok(red>100,'test drum had no visible raw spectrum');assert.equal(green,0,'raw spectrum leaked into foreground texture');
  const before=Array.from(data.slice((c%32)*64*4,((c%32)+1)*64*4));ring.sync(130,150);ring.sync(c-2,c+2);
  assert.deepEqual(Array.from(data.slice((c%32)*64*4,((c%32)+1)*64*4)),before);
});
test('neither snare nor foreground accents flip the entire Drop picture',()=>{
  const a=musicFixture();a.hits.snare=[[2.5,1]];a.timbre=analyzeTimbre(sample(drums()),sr);
  const m=new Music(a),shot={seed:42,scene:'particles',section:a.sections[1],sectionIndex:1};
  const fixture={music:m,style:{look:'pulse'},shots:[],lyrics:{visible:()=>[]},snares:Float64Array.of(2.5),foreground:new Float64Array()};
  const grade=(t:number)=>{const fx={echo:0,mirror:0,pixel:0,invert:0};(Director.prototype as any).grade.call(fixture,t,shot,fx,.5);return fx;};
  assert.equal(grade(2.52).invert,0);
  fixture.foreground=Float64Array.of(2.7);assert.equal(grade(2.72).invert,0,'foreground flash changed the full picture');
  delete a.timbre;assert.equal(grade(2.52).invert,0,'old analysis allowed a Drop-wide flash');
});
