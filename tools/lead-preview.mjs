// Local acceptance fixture: the real Homura material and renderer, same seed,
// with only the added melodic cues toggled. Never touches the running player.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { loadSettings, startServer, PROJECT } from '../exporter/server.mjs';

const id='741d3da3-67d0-405d-8b1f-9c06bce5230d';
const settings=await loadSettings();
const requestedStart=Number(process.argv.find(x=>x.startsWith('--start='))?.slice(8)??0);
const output=path.resolve(PROJECT,`../exports/Homura-lead-comparison${requestedStart>=100?'-drop2':''}`);
const jobDir=path.join(output,'fixture');
await fs.mkdir(path.join(jobDir,id),{recursive:true});
for(const file of ['audio.bin','cover.image','input.json','status.json'])await fs.copyFile(path.join(settings.jobDir,id,file),path.join(jobDir,id,file));
const app=await startServer({settings:{...settings,port:5198,jobDir,outputDir:output}});
let browser,currentEncoder;
const errors=[];
async function run(executable,args){
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const [code]=await once(child,'close');if(code!==0)throw new Error(stderr);return stdout;
}
try{
  browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync']});
  const context=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:1});
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.baseUrl?route.continue():route.abort());
  // The fixture never hot-reloads. Avoid connecting a second Vite client to
  // the running export service's development websocket on the default port.
  await context.route('**/@vite/client',route=>route.fulfill({contentType:'application/javascript',body:'export function createHotContext(){return {accept(){},dispose(){},on(){},send(){}}} export function injectQuery(u){return u}'}));
  await context.request.get(`${app.baseUrl}/api/health`,{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`${app.baseUrl}/tools/lead-preview.html`);
  const summary=await page.evaluate(async id=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{loadFonts},{Music}]=await Promise.all([
      import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/src/render/text.ts'),import('/src/director/music.ts')]);
    const input=await(await fetch(`/api/jobs/${id}/input.json`)).json();
    const cover=new Image();cover.src=input.coverUrl;await cover.decode();
    const [audio]=await Promise.all([fetch(input.audioUrl).then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const song=await prepareSong({id:input.song.id,name:input.song.name,artists:input.song.artists,audio,cover,lyric:{lrc:{lyric:'[00:00.000]preview'}},wiki:input.wiki,chorus:input.chorus},
      {pause:yieldToPage,refineLines:async lines=>lines.splice(0,lines.length,...structuredClone(input.lines))});
    const music=new Music(song.analysis);
    const player=new MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
    const cues={lead:song.analysis.env.lead,leadAttack:song.analysis.env.leadAttack,leadBrightness:song.analysis.env.leadBrightness};
    const style=styleFor(song,input.config.style),off=new Set([...(input.config.off??[]),...(input.config.offLooks??[])]);
    window.LEAD_PREVIEW={song,music,player,cues,async load(enabled){
      for(const key of Object.keys(cues)){if(enabled)song.analysis.env[key]=cues[key];else delete song.analysis.env[key];}
      // Compile only the visible shot on first frame. Warming all 30+ plates
      // twice is unnecessary for a four-second acceptance preview.
      player.load(song,style,off,undefined,undefined,0,input.config.seed);
    }};
    return {duration:song.duration,seed:input.config.seed,style:style.id,analysisMs:song.ms,sections:song.analysis.sections,
      cues:Array.from({length:Math.floor(song.duration*20)},(_,i)=>({t:i/20,...music.leadAt(i/20)}))};
  },id);
  console.log(JSON.stringify({...summary,cues:undefined}));
  await fs.writeFile(path.join(output,'analysis.json'),JSON.stringify(summary,null,2));
  if(!process.argv.includes('--analyse')){
    const drop=summary.sections.find(s=>s.label==='drop'&&s.end-s.start>8);assert.ok(drop,'No usable Drop detected');
    const start=Number(process.argv.find(x=>x.startsWith('--start='))?.slice(8)??(Math.ceil((drop.start+1)*30)/30));
    const seconds=4,fps=30,frames=seconds*fps;
    const shots=[];
    for(const [name,enabled] of [['before',false],['after',true]]){
      console.log(`${name}: loading`);
      await page.evaluate(enabled=>window.LEAD_PREVIEW.load(enabled),enabled);
      const plan=await page.evaluate(()=>window.LEAD_PREVIEW.player.shots.filter(s=>s.section.label==='drop').map(s=>({start:s.start,end:s.end,scene:s.scene,variant:s.variant})));
      await fs.writeFile(path.join(output,'drop-shots.json'),JSON.stringify(plan,null,2));
      // Identical one-second temporal run-up for each side, like a player seek.
      // Yield between renders: a synchronous 60-frame GPU burst can trip the
      // Windows display driver's watchdog on integrated graphics.
      for(let i=60;i>0;i--)await page.evaluate(t=>window.LEAD_PREVIEW.player.frame(t,1/60)?.scene,start-i/60);
      console.log(`${name}: rendering`);
      const child=currentEncoder=spawn(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-ss',String(start),'-i',path.join(jobDir,id,'audio.bin'),'-map','0:v:0','-map','1:a:0','-t',String(seconds),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',path.join(output,`${name}.mp4`)],{windowsHide:true,stdio:['pipe','ignore','pipe']});
      let stderr='';child.stderr.on('data',x=>stderr+=x);const ended=once(child,'close');
      for(let n=0;n<frames;n++){
        const data=await page.evaluate(({t,n})=>{
          const p=window.LEAD_PREVIEW.player;
          if(n)p.frame(t-1/60,1/60);
          const shot=p.frame(t,1/60);p.engine.renderer.getContext().finish();
          return {png:p.engine.renderer.domElement.toDataURL('image/png').split(',')[1],shot:shot?.scene,lost:p.engine.renderer.getContext().isContextLost()};
        },{t:start+n/fps,n});
        assert.equal(data.lost,false);
        const png=Buffer.from(data.png,'base64');
        if(!child.stdin.write(png))await once(child.stdin,'drain');
        if(n===60){await fs.writeFile(path.join(output,`${name}.png`),png);shots.push({name,t:start+n/fps,scene:data.shot});}
      }
      child.stdin.end();const [code]=await ended;if(code!==0)throw new Error(stderr);
      console.log(`${name}: ${frames} frames`);
    }
    const font='C\\:/Windows/Fonts/arial.ttf';
    await run(ffmpeg,['-y','-loglevel','error','-i',path.join(output,'before.mp4'),'-i',path.join(output,'after.mp4'),'-filter_complex',`[0:v]drawtext=fontfile='${font}':text='BEFORE':x=16:y=16:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65[a];[1:v]drawtext=fontfile='${font}':text='LEAD RESPONSE':x=16:y=16:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65[b];[a][b]hstack[v]`,'-map','[v]','-map','1:a:0','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',path.join(output,'Homura-before-after.mp4')]);
    const validation=JSON.parse(await run(ffprobe.path,['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,nb_frames','-of','json',path.join(output,'Homura-before-after.mp4')]));
    assert.equal(validation.streams.find(s=>s.codec_type==='video').nb_frames,String(frames));
    assert.equal(validation.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({start,seconds,fps,frames,shots,errors,validation},null,2));
    console.log(JSON.stringify({start,shots,validation}));
  }
}finally{if(currentEncoder?.exitCode===null)currentEncoder.kill();await browser?.close();await app.close();}
