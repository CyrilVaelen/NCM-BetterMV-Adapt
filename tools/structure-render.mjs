import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {PROJECT,loadSettings,startServer} from '../exporter/server.mjs';
const output=path.resolve(PROJECT,'../exports/Sunshine-structure-response'),id='17285341-0000-4000-8000-000000000004';
const settings=await loadSettings(),jobDir=path.resolve(PROJECT,'../exports/Sunshine-keyboard-response/fixture');
const app=await startServer({settings:{...settings,port:5198,jobDir,outputDir:output}});
let browser,encoder;const errors=[],checks=[];
async function run(exe,args){
  const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);
  assert.equal((await once(p,'close'))[0],0,err);return {out,err};
}
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync']});
  const context=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:1});
  await context.route('**/*',r=>new URL(r.request().url()).origin===app.baseUrl?r.continue():r.abort());
  await context.route('**/@vite/client',r=>r.fulfill({contentType:'application/javascript',body:'export function createHotContext(){return {accept(){},dispose(){},on(){},send(){}}} export function injectQuery(u){return u}'}));
  await context.request.get(`${app.baseUrl}/api/health`,{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${app.baseUrl}/tools/lead-preview.html`);console.log('Preparing actual before/after automatic arrangements.');
  const summary=await page.evaluate(async id=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{loadFonts},{analyze:oldAnalyze}]=await Promise.all([import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/src/render/text.ts'),import('/tools/fixtures/analysis-v4.ts')]);
    const input=await(await fetch(`/api/jobs/${id}/input.json`)).json(),cover=new Image();cover.src=input.coverUrl;await cover.decode();
    const [audio]=await Promise.all([fetch(input.audioUrl).then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const song=await prepareSong({id:input.song.id,name:input.song.name,artists:input.song.artists,audio,cover,lyric:null},{pause:yieldToPage});
    const decoded=await new OfflineAudioContext(1,1,22050).decodeAudioData(audio.slice(0)),mono=new Float32Array(decoded.length);
    for(let c=0;c<decoded.numberOfChannels;c++){const channel=decoded.getChannelData(c);for(let i=0;i<mono.length;i++)mono[i]+=channel[i]/decoded.numberOfChannels;}
    const analyses={before:oldAnalyze(mono,22050),after:song.analysis};
    const player=new MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
    window.STRUCT={player,song,load({side,from,to}){
      song.analysis=analyses[side];
      player.load(song,styleFor(song,input.config.style),new Set(input.config.off),undefined,undefined,0,input.config.seed,shots=>shots.filter(s=>s.end>from-.6&&s.start<to+.6));
      const frame=player.director.frame.bind(player.director);player.director.frame=(...args)=>{const result=frame(...args);this.last=result;return result;};
    },frame(t){
      const shot=player.frame(t,1/30),gl=player.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw new Error('Lost WebGL context');
      return {png:player.engine.renderer.domElement.toDataURL('image/png').split(',')[1],scene:shot.scene,label:shot.section.label,sectionStart:shot.section.start,cutStart:shot.start,zoom:this.last.fx.zoom,impact:this.last.fx.impact};
    }};
    return {seed:input.config.seed,versions:{before:analyses.before.version,after:analyses.after.version},before:analyses.before.sections,after:analyses.after.sections,duration:song.duration};
  },id);
  const entries=summary.after.filter((s,i)=>s.label==='drop'&&summary.before[i].start!==s.start).map(s=>s.start);
  assert.equal(entries.length,4);console.log(JSON.stringify({entries,versions:summary.versions}));
  async function load(side,from,to){
    await page.evaluate(c=>window.STRUCT.load(c),{side,from,to});
    for(let n=8;n>0;n--)await page.evaluate(t=>window.STRUCT.player.frame(t,1/30)?.scene,from-n/30);
  }
  async function capture(label,side,t){
    const frame=await page.evaluate(t=>window.STRUCT.frame(t),t);
    await fs.writeFile(path.join(output,`${label}-${side}.png`),Buffer.from(frame.png,'base64'));const {png,...info}=frame;return info;
  }
  // Inspect every affected entry under the automatic plan, with no forced scene.
  for(const entry of entries){
    const label=`entry-${entry.toFixed(3)}`,pair={entry};
    for(const side of ['before','after']){
      await load(side,entry-.2,entry+.2);
      pair[side]={pre:await capture(`${label}-pre`,side,entry-.1),attack:await capture(`${label}-attack`,side,entry+.025)};
    }
    assert.notEqual(pair.after.pre.label,'drop');assert.equal(pair.after.attack.label,'drop');assert.ok(pair.after.attack.zoom>.75);
    checks.push(pair);console.log(JSON.stringify(pair));
  }
  if(!process.argv.includes('--stills-only')){
    for(const side of ['before','after']){
      await load(side,128,136);
      encoder=spawn(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-framerate','30','-i','pipe:0','-ss','128','-i',path.join(jobDir,id,'audio.bin'),'-map','0:v:0','-map','1:a:0','-t','8','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',path.join(output,`drop-211-${side}.mp4`)],{windowsHide:true,stdio:['pipe','ignore','pipe']});
      let err='';encoder.stderr.on('data',x=>err+=x);const ended=once(encoder,'close');
      for(let n=0;n<240;n++){
        const frame=await page.evaluate(t=>window.STRUCT.frame(t),128+n/30);
        if(!encoder.stdin.write(Buffer.from(frame.png,'base64')))await once(encoder.stdin,'drain');
        if(n%30===29)console.log(`${side}: ${n+1}/240`);
      }
      encoder.stdin.end();assert.equal((await ended)[0],0,err);
    }
    const video=path.join(output,'Sunshine-2m11-structure-comparison.mp4');
    await run(ffmpeg,['-y','-loglevel','error','-i',path.join(output,'drop-211-before.mp4'),'-i',path.join(output,'drop-211-after.mp4'),'-filter_complex',"[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='BEFORE - ORIGINAL TIMING':x=12:y=12:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.65[a];[1:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='AFTER - AUDIO-BASED ENTRY':x=12:y=12:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.65[b];[a][b]hstack[v]",'-map','[v]','-map','1:a:0','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',video]);
    const probe=JSON.parse((await run(ffprobe.path,['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,nb_frames','-of','json',video])).out);
    const volume=(await run(ffmpeg,['-hide_banner','-i',video,'-vn','-af','volumedetect','-f','null','-'])).err,meanDbFS=Number(volume.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
    assert.equal(probe.streams.find(s=>s.codec_type==='video').nb_frames,'240');assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');assert.ok(meanDbFS>-60);
    await fs.writeFile(path.join(output,'video-validation.json'),JSON.stringify({probe,meanDbFS,sourceInterval:[128,136],forcedScene:false,pictureOffsetMs:0},null,2));
  }
  const calibration=JSON.parse(await fs.readFile(path.resolve(PROJECT,'../BetterNCM/BetterMV/playback-sync.json'),'utf8'));
  const migration=await page.evaluate(async calibration=>{
    const store={songVisualDelays:JSON.stringify({'17285341':1500})};
    window.plugin={getConfig:(k,d)=>store[k]??d,setConfig:(k,v)=>store[k]=v};
    window.betterncm={app:{getDataPath:async()=> 'D:/fixture'},fs:{readFileText:async()=>JSON.stringify(calibration)}};
    const {importPictureCalibration,pictureDelayMs}=await import('/src/plugin/playback-sync.ts');
    const config={latencyMs:0,songVisualDelays:{'17285341':1500}};await importPictureCalibration(config);
    return {sunshineMs:pictureDelayMs(config,17285341),homuraMs:pictureDelayMs(config,2639944165),persisted:JSON.parse(store.songVisualDelays),revision:store.pictureCalibrationRevision};
  },calibration);
  assert.equal(migration.sunshineMs,0);assert.equal(migration.homuraMs,0);assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,process.argv.includes('--stills-only')?'stills-verification.json':'verification.json'),JSON.stringify({summary,checks,migration,errors,forcedScene:false,pictureOffsetMs:0},null,2));
  console.log('Automatic arrangement, attacks and zero-offset migration verified.');
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await app.close();}
