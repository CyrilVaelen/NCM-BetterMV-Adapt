import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrastForm, releaseShare, type ContrastInput } from '../src/analysis/contrast.ts';

function fixture(): ContrastInput {
  const n=40, fps=100, time=Array.from({length:n},(_,i)=>i*2), low=new Float32Array(n*2*fps);
  const bass=new Float64Array(n).fill(-25), treble=new Float64Array(n).fill(-40), db=new Float64Array(n).fill(-20), sung=new Float64Array(n);
  for(let j=0;j<n;j++) {
    const release=j>=12&&j<20||j>=28&&j<36;
    const sustained=j>=4&&j<12||j>=20&&j<28;
    for(let f=j*200;f<(j+1)*200;f++) low[f]=release?(f%100<45?.2:.00001):sustained?.1:.0001;
    if(release||sustained) { bass[j]=-10; db[j]=-5; treble[j]=release?-18:-25; sung[j]=release?0:.8; }
  }
  const similarity=new Float64Array(n*n);
  for(let a=0;a<n;a++) for(let b=0;b<n;b++) similarity[a*n+b]=a%16===b%16?.95:0;
  return {fps,time,end:80,low,bass,treble,db,sung,similarity,drive:new Float64Array(n).fill(1.4)};
}
test('returning articulated bass releases are distinguished from equally loud sustained bass',()=>{
  const x=fixture(), form=contrastForm(x);
  assert.deepEqual(form.releases,[[12,20],[28,36]]);
  assert.equal(releaseShare(form,4,12),0); assert.equal(releaseShare(form,12,20),1);
  assert.deepEqual(contrastForm(x).releases,form.releases);
});
test('missing bands, silence, one-off fills and unrelated energetic passages keep the original form',()=>{
  for(const mode of ['missing','silent','one-release','unrelated','continuous','no-drums']) {
    const x=fixture();
    if(mode==='missing') x.low=undefined;
    if(mode==='silent') {x.low?.fill(0);x.bass.fill(-100);x.treble.fill(-100);x.db.fill(-100);}
    if(mode==='one-release') x.sung.fill(.8,28,36);
    if(mode==='unrelated') x.similarity.fill(0);
    if(mode==='continuous') x.low?.fill(.1);
    if(mode==='no-drums') x.drive.fill(0);
    assert.deepEqual(contrastForm(x).releases,[],mode);
  }
});
test('loud repeated vocal refrains are not reclassified as instrumental releases',()=>{
  const x=fixture();x.sung.fill(.85);
  assert.deepEqual(contrastForm(x).releases,[]);
});
test('an alternate beat octave preserves the same audible release regions',()=>{
  const x=fixture(), n=x.time.length*2;
  const duplicate=(a:Float64Array)=>Float64Array.from({length:n},(_,i)=>a[i>>1]);
  const similarity=new Float64Array(n*n);
  for(let a=0;a<n;a++)for(let b=0;b<n;b++)similarity[a*n+b]=x.similarity[(a>>1)*x.time.length+(b>>1)];
  const doubled={...x,time:Array.from({length:n},(_,i)=>i),bass:duplicate(x.bass),treble:duplicate(x.treble),db:duplicate(x.db),sung:duplicate(x.sung),drive:duplicate(x.drive),similarity};
  const regions=(v:ContrastInput)=>contrastForm(v).releases.map(([a,b])=>[v.time[a],v.time[b]??v.end]);
  assert.deepEqual(regions(doubled),regions(x));
});
