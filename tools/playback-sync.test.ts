import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProgressClock } from '../src/plugin/clock.ts';
import { parseVisualDelays, pictureDelayMs, importPictureCalibration } from '../src/plugin/playback-sync.ts';

test('jittered progress stays close to media time and stops coasting after 200 ms',()=>{
  let wall=0;
  const clock=new ProgressClock(()=>wall);
  clock.onProgress('17285341_a',0);
  for(let i=1;i<=300;i++){
    wall=i*31;
    const delayed=(i%5)*0.004;
    clock.onProgress('17285341_a',Math.floor((wall/1000-delayed)*100)/100);
    assert.ok(Math.abs(clock.time()-wall/1000)<0.04,'clock drifted away from progress events');
  }
  wall+=200;const stopped=clock.time();wall+=2000;
  assert.equal(clock.time(),stopped,'picture kept running while player events stopped');
  assert.equal(clock.playing,false);
});

test('pause, resume, seeks and track changes preserve the media clock',()=>{
  let wall=1000;
  const clock=new ProgressClock(()=>wall);
  clock.onProgress('17285341_a',20);wall+=50;
  clock.onState('17285341_a','',0);const held=clock.time();
  wall+=5000;assert.equal(clock.time(),held);
  clock.seek(80);assert.equal(clock.time(),80);
  clock.onState('17285341_a','',1);wall+=40;
  assert.ok(Math.abs(clock.time()-80.04)<1e-9);
  clock.onProgress('17285341_a',80.04);clock.seek(100);assert.equal(clock.time(),100);
  clock.onProgress('999_b',2);assert.equal(clock.songId,999);
  assert.ok(Math.abs(clock.time()-2.005)<1e-9);
});

test('per-song picture calibration shifts all visual time without changing media time',()=>{
  const config={latencyMs:0,songVisualDelays:{'17285341':1500}};
  const clock=new ProgressClock(()=>1000);
  clock.onProgress('17285341_a',60);
  clock.offset=pictureDelayMs(config,clock.songId)/1000;
  assert.equal(clock.time()-clock.now(),1.5);
  clock.onProgress('999_homura',60);
  clock.offset=pictureDelayMs(config,clock.songId)/1000;
  assert.equal(clock.time(),clock.now(),'Sunshine correction leaked into another song');
  config.songVisualDelays['17285341']=0;
  assert.equal(pictureDelayMs(config,17285341),0,'explicit reset failed');
  assert.equal(pictureDelayMs({...config,latencyMs:3000,songVisualDelays:{'17285341':4000}},17285341),5000);
  assert.deepEqual(parseVisualDelays('{"17285341":1500,"2":0,"3":-50,"4":6000,"5":"300","__proto__":100,"0":10}'),{'17285341':1500,'2':0,'3':-50});
  assert.deepEqual(parseVisualDelays('invalid'),{});
  assert.deepEqual(parseVisualDelays([1,2]),{});
});

test('local calibration imports only missing songs and preserves a saved zero',async()=>{
  const globals=globalThis as typeof globalThis & {betterncm:unknown;plugin:unknown};
  const saved={betterncm:globals.betterncm,plugin:globals.plugin},writes:string[]=[];
  const hasOwn=Object.hasOwn;
  try{
    Object.assign(globals,{betterncm:{app:{getDataPath:async()=> 'D:/test'},fs:{readFileText:async()=>JSON.stringify({version:1,delaysMs:{'17285341':1500,'9':400}})}},plugin:{setConfig:(key:string,value:string)=>writes.push(`${key}:${value}`)}});
    Object.hasOwn=undefined as unknown as typeof Object.hasOwn;
    const config={latencyMs:0,songVisualDelays:{'17285341':0}};
    await importPictureCalibration(config);await importPictureCalibration(config);
    assert.deepEqual(config.songVisualDelays,{'17285341':0,'9':400});
    assert.equal(writes.length,1,'existing calibration was reapplied');
  }finally{Object.hasOwn=hasOwn;Object.assign(globals,saved);}
});

test('withdraw an imported estimate once, without erasing subsequent manual choices',async()=>{
  const globals=globalThis as typeof globalThis & {betterncm:unknown;plugin:unknown},saved={betterncm:globals.betterncm,plugin:globals.plugin};
  const store:Record<string,string>={};
  try{
    Object.assign(globals,{betterncm:{app:{getDataPath:async()=> 'D:/test'},fs:{readFileText:async()=>JSON.stringify({version:1,revision:'structure-fix',delaysMs:{'17285341':0},resetEstimatedMs:{'17285341':1500}})}},plugin:{getConfig:(key:string,fallback:string)=>store[key]??fallback,setConfig:(key:string,value:string)=>store[key]=value}});
    const config={latencyMs:0,songVisualDelays:{'17285341':1500}};
    await importPictureCalibration(config);assert.equal(config.songVisualDelays['17285341'],0);
    config.songVisualDelays['17285341']=200;await importPictureCalibration(config);assert.equal(config.songVisualDelays['17285341'],200);
    assert.equal(store.pictureCalibrationRevision,'structure-fix');
  }finally{Object.assign(globals,saved);}
});
