import assert from 'node:assert/strict';
import {test} from 'node:test';
import {refineDropPreparations} from '../src/analysis/entries.ts';
import type {Hit, Section} from '../src/types.ts';

// An independently specified arrangement: vocal refrain, rising snare roll, then
// a half-time bass release. The coarse classifier may subdivide either phrase.
function arrangement(release=32, split=40) {
  const fps=100, duration=64;
  const sections:Section[]=[
    {start:0,end:8,label:'verse',energy:.35,group:0,vocal:true},
    {start:8,end:20,label:'chorus',energy:.6,group:1,vocal:true},
    {start:20,end:split,label:'drop',energy:.9,group:2,vocal:false},
    {start:split,end:52,label:'drop',energy:1,group:2,vocal:false},
    {start:52,end:duration,label:'outro',energy:.2,group:3,vocal:false},
  ];
  const low=new Float32Array(duration*fps),high=new Float32Array(duration*fps),rms=new Float32Array(duration*fps);
  for(let f=0;f<low.length;f++) {
    const t=f/fps;
    low[f]=.00003;high[f]=.001;rms[f]=.22;
    if(t>=8&&t<20)rms[f]=.43+.03*Math.sin(t*3);
    if(t>=20&&t<release) {
      // A loud voice/roll is allowed substantial treble and overall energy,
      // while it has no returning low-frequency instrumental phrase yet.
      const rise=(t-20)/Math.max(1,release-20);
      high[f]=.002+.009*rise;rms[f]=.36+.08*rise;
    }
    if(t>=release&&t<52) {
      const phase=(t-release)%.5;
      low[f]=phase<.28?.26*Math.exp(-phase*3):.003;
      high[f]=.035+.008*Math.sin(t*7)**2;rms[f]=phase<.3?.86:.67;
    }
  }
  const kicks:Hit[]=[];
  for(let t=release;t<52;t+=.5)kicks.push([t+.025,.9]);
  // This refrain is independently known to be one sparse repeated pickup;
  // orchestration supplies that lyric evidence separately from acoustic levels.
  const canExtendBuild=(()=>true) as ((section:Section)=>boolean)|undefined;
  return {sections,beats:Array.from({length:duration*2},(_,i)=>i*.5),fps,low,high,rms,kicks,canExtendBuild};
}

function assertTimeline(sections:Section[]) {
  assert.equal(sections[0].start,0);assert.equal(sections[sections.length-1].end,64);
  for(let i=0;i<sections.length;i++) {
    assert.ok(sections[i].end>sections[i].start,'all sections have positive duration');
    if(i)assert.equal(sections[i-1].end,sections[i].start,'no gaps or overlaps');
  }
}
const at=(sections:Section[],time:number)=>sections.find(s=>s.start<=time&&time<s.end)!;

test('a loud vocal pickup and rising snare roll stay build until a sustained full-band release',()=>{
  const x=arrangement(),beats=[...x.beats],kicks=structuredClone(x.kicks);
  assert.equal(refineDropPreparations(x),true);
  for(const t of [10,20,27,31.8])assert.equal(at(x.sections,t).label,'build',String(t));
  for(const t of [32.1,38,45,51])assert.equal(at(x.sections,t).label,'drop',String(t));
  const entry=x.sections.find(s=>s.label==='drop')!.start;
  assert.ok(Math.abs(entry-32)<.06,`entry follows the actual bass attack (got ${entry})`);
  assert.deepEqual(x.beats,beats);assert.deepEqual(x.kicks,kicks);
  assertTimeline(x.sections);
  const once=structuredClone(x.sections);
  assert.equal(refineDropPreparations(x),false);assert.deepEqual(x.sections,once,'replaying is idempotent');
});

test('coarse adjacent Drop subdivisions cannot hide preparation before a release in the later subdivision',()=>{
  const x=arrangement(32,28);
  assert.equal(refineDropPreparations(x),true);
  for(const t of [20,27.5,28.5,31.8])assert.equal(at(x.sections,t).label,'build',String(t));
  for(const t of [32.1,40,51])assert.equal(at(x.sections,t).label,'drop',String(t));
  assertTimeline(x.sections);
  const once=structuredClone(x.sections);
  refineDropPreparations(x);assert.deepEqual(x.sections,once);
});

test('a coarse Drop boundary after the attack is pulled back to the sustained release',()=>{
  const x=arrangement(32,40);
  x.sections[2]={...x.sections[2],end:33.6,label:'build'};
  x.sections[3]={...x.sections[3],start:33.6,end:52,label:'drop'};
  assert.equal(refineDropPreparations(x),true);
  assert.equal(at(x.sections,31.8).label,'build');
  assert.equal(at(x.sections,32.1).label,'drop');
  const entry=x.sections.find(s=>s.label==='drop')!.start;
  assert.ok(Math.abs(entry-32)<.06,`late coarse boundary must move back to the bass release (got ${entry})`);
  assertTimeline(x.sections);
  const once=structuredClone(x.sections);
  assert.equal(refineDropPreparations(x),false);assert.deepEqual(x.sections,once,'backward correction is idempotent');
});

test('a late boundary is recovered from sustained bands when the hit detector missed the kick',()=>{
  const x=arrangement(32,40);
  x.sections[2]={...x.sections[2],end:33.6,label:'build'};
  x.sections[3]={...x.sections[3],start:33.6,end:52,label:'drop'};
  x.kicks=[];
  assert.equal(refineDropPreparations(x),true);
  assert.equal(at(x.sections,31.8).label,'build');assert.equal(at(x.sections,32.1).label,'drop');
  const entry=x.sections.find(s=>s.label==='drop')!.start;
  assert.ok(Math.abs(entry-32)<.06,`envelope-only backscan must recover the release (got ${entry})`);
  assertTimeline(x.sections);
  const once=structuredClone(x.sections);
  assert.equal(refineDropPreparations(x),false);assert.deepEqual(x.sections,once,'envelope-only correction is idempotent');
});

test('entry diagnostics identify the coarse cut and the envelope-only recovery',()=>{
  const x=arrangement(32,40);
  x.sections[2]={...x.sections[2],end:33.6,label:'build'};
  x.sections[3]={...x.sections[3],start:33.6,end:52,label:'drop'};
  x.kicks=[];
  const host=globalThis as typeof globalThis & {__bmvDropEntryDebug?:(record:Record<string,unknown>)=>void};
  const previous=host.__bmvDropEntryDebug,records:Record<string,unknown>[]=[];
  try{
    host.__bmvDropEntryDebug=record=>records.push(record);
    assert.equal(refineDropPreparations(x),true);
  }finally{
    if(previous)host.__bmvDropEntryDebug=previous;else delete host.__bmvDropEntryDebug;
  }
  const record=records.find(item=>item.status==='entry-refined');
  assert.ok(record,'successful recovery is included in the trace');
  assert.equal(record.coarseStart,33.6);
  assert.equal(record.selectedMethod,'envelope-backscan');
  assert.ok(Math.abs(Number(record.finalEntry)-32)<.06);
  assert.equal(record.alreadySupported,false);
  assert.ok(Number(record.backscanFrames)>0);
});

test('a release at the end of a coarse subdivision preserves sequential coverage',()=>{
  const x=arrangement(32,32.1);
  assert.equal(refineDropPreparations(x),true);
  assert.equal(at(x.sections,31.8).label,'build');assert.equal(at(x.sections,32.2).label,'drop');
  assertTimeline(x.sections);
});

test('a weak false kick on the vocal pickup cannot protect a bass-free preparation',()=>{
  const x=arrangement();x.kicks.unshift([20,.5]);
  assert.equal(refineDropPreparations(x),true);
  assert.equal(at(x.sections,25).label,'build');assert.equal(at(x.sections,33).label,'drop');
  assertTimeline(x.sections);
  const once=structuredClone(x.sections);
  assert.equal(refineDropPreparations(x),false);assert.deepEqual(x.sections,once);
});

test('an established full-band sung chorus before the preparation remains a chorus',()=>{
  const x=arrangement();
  x.low.fill(.12,800,2000);x.high.fill(.04,800,2000);x.rms.fill(.78,800,2000);
  assert.equal(refineDropPreparations(x),true);
  assert.equal(at(x.sections,12).label,'chorus');assert.equal(at(x.sections,25).label,'build');
  assertTimeline(x.sections);
});

test('quiet established sung choruses remain choruses without positive sparse-pickup evidence',()=>{
  for(const provideEvidence of [true,false]) {
    const x=arrangement();
    x.canExtendBuild=provideEvidence?()=>false:undefined;
    const chorus=structuredClone(x.sections[1]);
    assert.equal(refineDropPreparations(x),true);
    assert.deepEqual(x.sections[1],chorus,'quiet accompaniment alone cannot erase a chorus');
    assert.equal(at(x.sections,25).label,'build');assert.equal(at(x.sections,33).label,'drop');
    assertTimeline(x.sections);
  }
});

test('the same physical preparation and release survive different beat-grid octaves',()=>{
  for(const beat of [.25,.5,1]) {
    const x=arrangement();x.beats=Array.from({length:64/beat},(_,i)=>i*beat);
    assert.equal(refineDropPreparations(x),true,String(beat));
    assert.equal(at(x.sections,31.8).label,'build');assert.equal(at(x.sections,32.2).label,'drop');
    assertTimeline(x.sections);
  }
});

test('an established first kick is retained when later accents are stronger',()=>{
  for(const strength of [.6,.95]) {
    const x=arrangement(20);
    x.kicks[0]=[20,strength];
    for(let f=3200;f<3500;f++){x.low[f]*=1.5;x.rms[f]*=1.1;}
    x.kicks.push([32,1]);x.kicks.sort((a,b)=>a[0]-b[0]);
    const original=structuredClone(x.sections);
    assert.equal(refineDropPreparations(x),false);assert.deepEqual(x.sections,original);
  }
});

test('one isolated fill cannot substitute for a sustained returning bass phrase',()=>{
  const x=arrangement(40);
  x.kicks=[[24,.95]];
  x.low.fill(.3,2400,2415);x.high.fill(.05,2400,2415);x.rms.fill(.9,2400,2415);
  const original=structuredClone(x.sections);
  assert.equal(refineDropPreparations(x),false);assert.deepEqual(x.sections,original);
});

test('sustained bass, absent drums or treble, missing bands and silence leave the coarse form alone',()=>{
  for(const mode of ['sustained','no-drums','no-high','missing-low','missing-high','silence']) {
    const x=arrangement();
    if(mode==='sustained')x.low.fill(.2,2000,5200);
    if(mode==='no-drums')x.kicks=[];
    if(mode==='no-high')x.high.fill(0);
    if(mode==='missing-low')x.low=new Float32Array();
    if(mode==='missing-high')x.high=new Float32Array();
    if(mode==='silence'){x.low.fill(0);x.high.fill(0);x.rms.fill(0);}
    const original=structuredClone(x.sections);
    assert.equal(refineDropPreparations(x),false,mode);assert.deepEqual(x.sections,original,mode);
  }
});
