import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { PROJECT,loadSettings,startServer } from '../exporter/server.mjs';
import { parseWiki } from '../src/meta/wiki.ts';
import { parseChorus } from '../src/plugin/source.ts';
const out=path.resolve('../exports/Timbre-highlights-20261018');
const audioPath='D:/野葱视频转换器/音频转换/NURKO,Neriah - Love Is A Highway.mp3';
const [audio,cover,lrc,metadata]=await Promise.all([fs.readFile(audioPath),fs.readFile('plugin/preview.jpg'),fs.readFile('D:/CloudMusic/VipSongsDownload/NURKO,Neriah - Love Is A Highway.lrc','utf8'),fs.readFile('../exports/Melodic-structure-20261018/love-metadata.json','utf8').then(JSON.parse)]);
const settings=await loadSettings(),app=await startServer({settings:{...settings,port:5208,jobDir:path.join(out,'jobs'),outputDir:out}});
let browser,encoder;const errors=[];
const run=async(exe,args)=>{const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',err='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>err+=b);assert.equal((await once(p,'close'))[0],0,err);return output;};
try {
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:1});
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==app.baseUrl)return r.abort();if(u.pathname==='/timbre-audio')return r.fulfill({body:audio,contentType:'audio/mpeg'});if(u.pathname==='/timbre-cover')return r.fulfill({body:cover,contentType:'image/jpeg'});return r.continue();});
  await context.request.get(app.baseUrl+'/api/health',{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('BROWSER ERROR: '+m.text());}});
  await page.goto(app.baseUrl+'/tools/lead-preview.html');
  console.log('Preparing actual song and frozen .9 renderer');
  const summary=await page.evaluate(async ({lrc,wiki,chorus,particleVariant})=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{MvPlayer:BeforePlayer},{loadFonts},{Music}]=await Promise.all([import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/tools/.timbre-baseline/before-player.mjs'),import('/src/render/text.ts'),import('/src/director/music.ts')]);
    const cover=new Image();cover.src='/timbre-cover';await cover.decode();const [audio]=await Promise.all([fetch('/timbre-audio').then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const song=await prepareSong({id:2052331548,name:'Love Is A Highway',artists:['NURKO','Neriah'],audio,cover,lyric:{lrc:{lyric:lrc}},wiki,chorus},{pause:yieldToPage});
    const players={};
    for(const [name,Player]of Object.entries({before:BeforePlayer,after:MvPlayer})) {const stage=document.createElement('div');stage.style.cssText='width:640px;height:360px;position:absolute;left:0;top:0';document.body.append(stage);players[name]=new Player(stage,1);players[name].hud.visible=false;}
    const music=new Music(song.analysis),off=new Set(['menger','sierpinski','cantor']);
    window.TPROBE={song,players,music,async load(side,scene){
      const player=players[side];this.current=player;
      const variants={particles:[particleVariant],channel:['axis'],kaleido:['petal'],ripple:['tilt'],shatter:['swarm-a']};
      player.load(song,styleFor(song,'pulse'),off,scene?{scene,variants:variants[scene]||['push']}:undefined,'none',0,2052331548,scene?undefined:shots=>shots.filter(s=>s.end>98&&s.start<108));
      const frame=player.director.frame.bind(player.director);player.director.frame=(...args)=>{const result=frame(...args);this.fx=result.fx;return result;};
      await player.warm(yieldToPage);
      return player.director.shots.map(s=>({start:s.start,end:s.end,scene:s.scene,variant:s.variant,label:s.section.label}));
    },frame(t){const player=this.current,shot=player.frame(t,1/30),gl=player.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw new Error('Lost WebGL context');return {t,scene:shot.scene,variant:shot.variant,label:shot.section.label,foreground:music.foregroundAt(t),roles:music.timbreAt(t),bloom:this.fx.bloom,png:player.engine.renderer.domElement.toDataURL('image/png').split(',')[1]};}};
    return {version:song.analysis.version,duration:song.duration,sections:song.analysis.sections,ms:song.ms,baseline:'Frozen .9 MvPlayer + scenes, rebuilt from the pre-change backup; same audio, analysis legacy fields, seed and cover',style:'pulse'};
  },{lrc,wiki:parseWiki(metadata.wiki),chorus:parseChorus(metadata.chorus,2052331548),particleVariant:process.argv.includes('--burst')?'burst':'hold'});
  assert.equal(summary.version,6);
  const particleRefresh=process.argv.includes('--particle-refresh');
  const refresh=process.argv.includes('--refresh-after')||particleRefresh;
  const previous=refresh?JSON.parse(await fs.readFile(path.join(out,'render-verification.json'),'utf8')):null;
  const checks=previous?previous.checks.filter(c=>particleRefresh?(c.side==='before'||c.scene!=='particles'&&c.forcedScene!=='particles'):c.side==='before'):[],plans={...(previous?.plans||{})};
  const stillScenes=process.argv.includes('--video-only')?[]:particleRefresh?['particles']:['particles','channel','kaleido','ripple','shatter','drive'];
  for(const scene of stillScenes) {
    for(const side of refresh?['after']:['before','after']) {
      await page.evaluate(({side,scene})=>TPROBE.load(side,scene),{side,scene});
      for(const t of [99.2,100.1,101.083333,102.6]) {
        for(let i=5;i>0;i--)await page.evaluate(t=>TPROBE.current.frame(t,1/30),t-i/30);
        const {png,...frame}=await page.evaluate(t=>TPROBE.frame(t),t);assert.equal(frame.label,'drop');
        const tag=scene==='particles'&&process.argv.includes('--burst')?'particles-burst':scene;
        await fs.writeFile(path.join(out,`${tag}-${t}-${side}.png`),Buffer.from(png,'base64'));checks.push({scene,side,...frame});
      }
      console.log(JSON.stringify({scene,side,stills:3}));
    }
  }
  if(!process.argv.includes('--stills-only')) for(const scene of particleRefresh?['particles']:['particles',null]) {
    const tag=scene||'automatic';
    for(const side of refresh?['after']:['before','after']) {
      plans[`${tag}-${side}`]=await page.evaluate(({side,scene})=>TPROBE.load(side,scene),{side,scene});
      for(let i=12;i>0;i--)await page.evaluate(t=>TPROBE.current.frame(t,1/30),99.1-i/30);
      encoder=spawn(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-framerate','30','-i','pipe:0','-ss','99.1','-i',audioPath,'-map','0:v:0','-map','1:a:0','-t','6','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',path.join(out,`${tag}-${side}.mp4`)],{windowsHide:true,stdio:['pipe','ignore','pipe']});let err='';encoder.stderr.on('data',b=>err+=b);const ended=once(encoder,'close');
      for(let n=0;n<180;n++) {
        const frame=await page.evaluate(t=>TPROBE.frame(t),99.1+n/30);
        if(!encoder.stdin.write(Buffer.from(frame.png,'base64')))await once(encoder.stdin,'drain');
        if(n%30===29)console.log(`${tag} ${side}: ${n+1}/180`);
      }
      encoder.stdin.end();assert.equal((await ended)[0],0,err);encoder=undefined;
    }
    const file=path.join(out,`Love-Is-A-Highway-1m39-${tag}-comparison.mp4`);
    await run(ffmpeg,['-y','-loglevel','error','-i',path.join(out,`${tag}-before.mp4`),'-i',path.join(out,`${tag}-after.mp4`),'-filter_complex',"[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='BEFORE - MIX-DRIVEN LIGHT':x=10:y=10:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.7[a];[1:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='AFTER - PITCHED FOREGROUND':x=10:y=10:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.7[b];[a][b]hstack[v]",'-map','[v]','-map','1:a:0','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',file]);
    const probe=JSON.parse(await run(ffprobe.path,['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,nb_frames','-of','json',file]));assert.equal(probe.streams.find(s=>s.codec_type==='video').nb_frames,'180');assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
    checks.push({video:file,probe,forcedScene:scene,sourceInterval:[99.1,105.1]});
  }
  if(plans['automatic-before'])assert.deepEqual(plans['automatic-before'],plans['automatic-after'],'automatic scene plan changed');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,process.argv.includes('--stills-only')?'stills-verification.json':process.argv.includes('--video-only')?'video-verification.json':'render-verification.json'),JSON.stringify({summary,checks,plans,errors,beforeArtifactsReused:refresh,limit:'Actual headless Edge renderer and full local audio; running NetEase window was not operated'},null,2));
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await app.close();}
