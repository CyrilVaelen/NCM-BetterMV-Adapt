import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {Director} from '../src/director/director.ts';
import {PULSE, WORD} from '../src/style/style.ts';
import type {Style} from '../src/style/style.ts';
import type {Section} from '../src/types.ts';

// Exercise the real frame/transition planner with scene doubles. No WebGL or text canvas is needed for the
// director's observable contract: continuous picture, a full new scene on the beat and stable musical timing.
function fixture(style:Style=PULSE,sameScene=false,firstLabel:Section['label']='build',nextLabel:Section['label']='drop',pure=false){
  const sections:Section[]=[{start:0,end:8,label:firstLabel,energy:.4,group:0,vocal:false},{start:8,end:16,label:nextLabel,energy:1,group:1,vocal:false}];
  const calls:{scene:string;t:number;shotT:number}[]=[];
  const plate=(id:string)=>({scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),update(ctx:{t:number;shotT:number}){calls.push({scene:id,t:ctx.t,shotT:ctx.shotT});}});
  const scenes={ridges:plate('ridges'),underwater:plate('underwater')};
  const shots=[{start:0,end:8,scene:'ridges',section:sections[0],sectionIndex:0,seed:1},{start:8,end:16,scene:sameScene?'ridges':'underwater',section:sections[1],sectionIndex:1,seed:2}];
  const director=Object.create(Director.prototype);
  Object.assign(director,{style,shots,scenes,music:{a:{sections,duration:16},meter:4,at:(t:number)=>({bpm:120,pos:t*2%1,inBar:t*2%4}),selectiveAt:()=>false},lyrics:{lines:[],visible:()=>[]},palette:{ink:new THREE.Color(.002,.004,.008),signal:new THREE.Color(.8,.4,.2),light:false},pure,looks:[],starts:Float64Array.from([0,8]),boxes:[],stutters:[],remembered:-1,overlay:{update(){}}});
  director.cuts=director.planCuts();
  return {director:director as Director,calls,sections,shots};
}

test('Pulse and Word retain a visible image throughout the lead-in and the first Drop frames',()=>{
  for(const style of [PULSE,WORD]){
    const {director}=fixture(style);
    for(let i=0;i<=60;i++){
      const t=7.5+i/60,frame=director.frame(t,1/60,16/9);
      assert.equal(frame.fx.fade,0,`${style.id}: fade at ${t}`);
      assert.equal(frame.fx.impact,0,`${style.id}: two-colour impact at ${t}`);
      assert.equal(frame.fx.glitch,0,`${style.id}: glitch at ${t}`);
    }
  }
});

test('a short pre-entry blend reaches the full Drop exactly on the detected musical boundary',()=>{
  const {director,calls,sections}=fixture();
  const first=director.frame(7.95,1/60,16/9),last=director.frame(7.999,1/60,16/9);
  assert.ok(first.transition&&last.transition,'both scenes overlap briefly before the beat');
  assert.ok(first.transition.progress>0&&last.transition.progress>first.transition.progress);
  assert.ok(last.transition.progress<1);
  assert.equal(first.shot.section.label,'build');
  assert.ok(calls.filter(call=>call.scene==='underwater').every(call=>call.t===8&&call.shotT===0),'incoming scene is held at its first frame before the beat');
  const entry=director.frame(8,1/60,16/9);
  assert.equal(entry.transition,null,'the blend has finished on the beat');
  assert.equal(entry.shot.section.label,'drop');assert.equal(entry.shot.start,8);
  assert.equal(entry.scene,director.scenes.underwater);
  assert.equal(sections[0].end,8);assert.equal(sections[1].start,8);
});

test('same-scene Drop entries cannot introduce a fade or an impact frame',()=>{
  const {director}=fixture(PULSE,true);
  for(const t of [7.8,7.99,8,8.016,8.05]){
    const frame=director.frame(t,1/60,16/9);
    assert.equal(frame.fx.fade,0,String(t));assert.equal(frame.fx.impact,0,String(t));assert.equal(frame.fx.glitch,0,String(t));
  }
});

test('the outgoing screen treatment fades with the picture instead of snapping off on entry',()=>{
  const {director}=fixture();director.looks[0]='ascii';
  const early=director.frame(7.9,1/60,16/9),late=director.frame(7.999,1/60,16/9),entry=director.frame(8,1/60,16/9);
  assert.ok(early.fx.ascii>late.fx.ascii&&early.fx.crt>late.fx.crt);
  assert.ok(late.fx.ascii<.001&&late.fx.crt<.001);
  assert.ok(late.fx.film>early.fx.film);
  assert.equal(entry.fx.ascii,0);assert.equal(entry.fx.crt,0);
});

test('adjacent Drop ranges never black out their continuous picture',()=>{
  const {director}=fixture(PULSE,false,'drop','drop');
  for(const t of [7.8,7.99,8])assert.equal(director.frame(t,1/60,16/9).fx.fade,0,String(t));
});

test('a style dip still applies to other section changes while Drop entries stay visible',()=>{
  const style={...PULSE,transitions:{...PULSE.transitions,dip:.1}};
  const drop=fixture(style).director;
  assert.equal(drop.frame(7.99,1/60,16/9).fx.fade,0);
  assert.equal(drop.frame(8,1/60,16/9).fx.fade,0);
  const chorus=fixture(style,false,'verse','chorus').director;
  assert.ok(chorus.frame(8,1/60,16/9).fx.fade>0,'existing non-Drop style dip is retained');
});

test('seeking back into an entry reproduces its planned blend and never alters section timings',()=>{
  const {director,sections}=fixture(),before=structuredClone(sections);
  const signature=(t:number)=>{const f=director.frame(t,1/60,16/9);return {start:f.shot.start,fade:f.fx.fade,impact:f.fx.impact,transition:f.transition?{kind:f.transition.kind,progress:f.transition.progress}:null};};
  const first=signature(7.97);signature(10);
  assert.deepEqual(signature(7.97),first);assert.deepEqual(sections,before);
  const pure=fixture(PULSE,false,'build','drop',true).director;
  assert.equal(pure.frame(7.97,1/60,16/9).transition,null,'pure oscilloscope playback keeps its unadorned cut');
});
