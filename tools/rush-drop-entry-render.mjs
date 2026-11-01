import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import {PROJECT,loadSettings,startServer} from '../exporter/server.mjs';
const out=path.resolve('../exports/Rush-drop-entry-20261020');
const audioPath='D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3';
const [audio,cover,lrc]=await Promise.all([fs.readFile(audioPath),fs.readFile('plugin/preview.jpg'),fs.readFile(path.join(out,'tested-lyrics.lrc'),'utf8')]);
const settings=await loadSettings(),app=await startServer({settings:{...settings,port:5217,jobDir:path.join(out,'render-jobs'),outputDir:out}});
let browser,encoder;const errors=[];
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:1});
  await context.route('**/*',async r=>{
    const u=new URL(r.request().url());if(u.origin!==app.baseUrl)return r.abort();
    if(u.pathname==='/probe-audio')return r.fulfill({body:audio,contentType:'audio/mpeg'});
    if(u.pathname==='/probe-cover')return r.fulfill({body:cover,contentType:'image/jpeg'});
    return r.continue();
  });
  await context.request.get(app.baseUrl+'/api/health',{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.baseUrl+'/tools/lead-preview.html');
  const summary=await page.evaluate(async lrc=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{loadFonts}]=await Promise.all([import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/src/render/text.ts')]);
    const cover=new Image();cover.src='/probe-cover';await cover.decode();
    const [audio]=await Promise.all([fetch('/probe-audio').then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const song=await prepareSong({id:20261020,name:'Rush Over Me',artists:['Seven Lions','Said The Sky','ILLENIUM'],audio,cover,lyric:{lrc:{lyric:lrc}},wiki:{bpm:140,genres:[],tags:[]}},{pause:yieldToPage});
    const player=new MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
    player.load(song,styleFor(song,'pulse'),new Set(['menger','sierpinski','cantor']),undefined,undefined,0,0);await player.warm(yieldToPage);
    window.PROBE={song,player,frame(t){
      const shot=player.frame(t,1/24),gl=player.engine.renderer.getContext();gl.finish();
      if(gl.isContextLost())throw new Error('Lost WebGL context');
      return {t,scene:shot.scene,variant:shot.variant??null,label:shot.section.label,start:shot.section.start,end:shot.section.end,png:player.engine.renderer.domElement.toDataURL('image/png').split(',')[1]};
    }};
    return {version:song.analysis.version,duration:song.duration,sections:song.analysis.sections,style:'pulse',forcedScene:false,cover:'plugin diagnostic preview, not claimed to be album art'};
  },lrc);
  assert.equal(summary.version,10);const checks=[];
  for(const [t,label]of [[100.82,'build'],[102.8,'build'],[103.35,'drop'],[175.8,'build'],[189.8,'build'],[191.7,'build'],[192.01,'drop'],[192.3,'drop'],[193.3,'drop'],[194.3,'drop'],[220.58,'drop'],[220.62,'outro'],[221,'outro']]){
    const {png,...frame}=await page.evaluate(t=>PROBE.frame(t),t);assert.equal(frame.label,label,JSON.stringify(frame));
    await fs.writeFile(path.join(out,`actual-${t}s-${label}.png`),Buffer.from(png,'base64'));checks.push(frame);
  }
  const dropEdge=checks.find(s=>s.t===220.58),outroEdge=checks.find(s=>s.t===220.62);
  assert.ok(dropEdge&&outroEdge);assert.notEqual(dropEdge.scene,outroEdge.scene,'Drop 2 and Outro must switch scenes');
  console.log(JSON.stringify({stage:'browser fresh analysis',checks}));
  const clips=[];
  for(const [name,from,to]of [['drop1-verified',99,107],['drop2-verified',187,195],['outro-switch-verified',218.5,225]]){
    const output=path.join(out,name+'.mp4');
    encoder=spawn(ffmpeg,['-v','error','-y','-f','image2pipe','-framerate','24','-i','pipe:0','-ss',String(from),'-i',audioPath,'-map','0:v:0','-map','1:a:0','-t',String(to-from),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let err='';encoder.stderr.on('data',x=>err+=x);const done=once(encoder,'close');
    for(let n=0;n<(to-from)*24;n++){
      const frame=await page.evaluate(t=>PROBE.frame(t),from+n/24);
      if(!encoder.stdin.write(Buffer.from(frame.png,'base64')))await once(encoder.stdin,'drain');
    }
    encoder.stdin.end();assert.equal((await done)[0],0,err);clips.push({output,from,to,frames:(to-from)*24});console.log(name+' rendered');
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'drop-entry-render-verification.json'),JSON.stringify({summary,checks,clips,errors,host:'Headless Edge actual decoder + prepareSong + automatic MvPlayer',limit:'Not a playback test inside the running NetEase window'},null,2));
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await app.close();}
