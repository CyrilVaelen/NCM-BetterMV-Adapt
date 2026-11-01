import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {PROJECT,loadSettings,startServer} from '../exporter/server.mjs';
const root=path.resolve('..'),out=path.join(root,'exports/Rush-armillary-20261020'),state=path.join(root,'state/rush-armillary-20261020');
await fs.mkdir(out,{recursive:true});
const oldSource=await fs.readFile(path.join(state,'baseline/src/director/director.ts'),'utf8');
const oldDir=path.resolve('tools/.rush-armillary-baseline');await fs.mkdir(oldDir,{recursive:true});
await fs.writeFile(path.join(oldDir,'director.ts'),oldSource.replace(/from '(\.[^']+)'/g,(_,specifier)=>`from '/${path.posix.normalize('src/director/'+specifier)}'`));
const audioPath='D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3';
const [audio,cover,lrc]=await Promise.all([fs.readFile(audioPath),fs.readFile('plugin/preview.jpg'),fs.readFile('../exports/Rush-form-20261020/tested-lyrics.lrc','utf8')]);
const settings=await loadSettings(),app=await startServer({settings:{...settings,port:5218,jobDir:path.join(out,'render-jobs'),outputDir:out}});
let browser,encoder;const errors=[],checks=[],clips=[];
async function run(exe,args){const r=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';r.stdout.on('data',b=>stdout+=b);r.stderr.on('data',b=>stderr+=b);assert.equal((await once(r,'close'))[0],0,stderr);return stdout;}
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:1});
  await context.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!==app.baseUrl)return r.abort();if(u.pathname==='/probe-audio')return r.fulfill({body:audio,contentType:'audio/mpeg'});if(u.pathname==='/probe-cover')return r.fulfill({body:cover,contentType:'image/jpeg'});return r.continue();});
  await context.request.get(app.baseUrl+'/api/health',{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.baseUrl+'/tools/lead-preview.html');
  const summary=await page.evaluate(async lrc=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{loadFonts},before]=await Promise.all([import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/src/render/text.ts'),import('/tools/.rush-armillary-baseline/director.ts')]);
    const cover=new Image();cover.src='/probe-cover';await cover.decode();
    const [audio]=await Promise.all([fetch('/probe-audio').then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const song=await prepareSong({id:20261020,name:'Rush Over Me',artists:['Seven Lions','Said The Sky','ILLENIUM'],audio,cover,lyric:{lrc:{lyric:lrc}},wiki:{bpm:140,genres:[],tags:[]}},{pause:yieldToPage});
    window.PROBE={song,async load(side){this.player?.dispose();const player=this.player=new MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
      player.load(song,styleFor(song,'pulse'),new Set(['menger','sierpinski','cantor']),undefined,undefined,0,20261020,side==='before'?(_,music)=>before.planShots(music,styleFor(song,'pulse'),20261020,{graphic:song.palette.graphic,lyrics:song.lines.length>0},new Set(['menger','sierpinski','cantor'])):undefined);
      await player.warm(yieldToPage);return player.shots.map(s=>({scene:s.scene,start:s.start,end:s.end,variant:s.variant,label:s.section.label,run:s.run}));},frame(t){const frame=this.player.director.frame(t,1/30,this.player.engine.aspect);const shot=this.player.frame(t,1/30),gl=this.player.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw new Error('Lost WebGL context');return {t,scene:shot.scene,label:shot.section.label,transition:frame.transition?.kind??null,fade:frame.fx.fade,png:this.player.engine.renderer.domElement.toDataURL('image/png').split(',')[1]};}};
    return {version:song.analysis.version,sections:song.analysis.sections};
  },lrc);
  const entry=summary.sections.find(s=>s.label==='drop'&&s.start>150).start;
  const plans={};
  for(const side of ['before','after']){
    plans[side]=await page.evaluate(side=>PROBE.load(side),side);
    for(const t of [189.8,191,191.7,entry,entry+1/30,entry+.3]){
      const {png,...frame}=await page.evaluate(t=>PROBE.frame(t),t);checks.push({side,...frame});
      await fs.writeFile(path.join(out,`${side}-${t.toFixed(3)}s.png`),Buffer.from(png,'base64'));
      if(side==='after'&&t<entry)assert.notEqual(frame.scene,'crystal');
      if(t>=entry){assert.equal(frame.label,'drop');assert.notEqual(frame.scene,'crystal');assert.equal(frame.transition,null);assert.equal(frame.fade,0);}
    }
    assert.ok(!plans[side].some(s=>s.scene==='crystal'&&s.start<entry&&s.end>entry));
    const output=path.join(out,`drop2-${side}.mp4`);
    encoder=spawn(ffmpeg,['-v','error','-y','-f','image2pipe','-framerate','30','-i','pipe:0','-ss','187','-i',audioPath,'-map','0:v:0','-map','1:a:0','-t','8','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let err='';encoder.stderr.on('data',b=>err+=b);const done=once(encoder,'close');
    for(let n=0;n<240;n++){const frame=await page.evaluate(t=>PROBE.frame(t),187+n/30);if(!encoder.stdin.write(Buffer.from(frame.png,'base64')))await once(encoder.stdin,'drain');}
    encoder.stdin.end();assert.equal((await done)[0],0,err);clips.push(output);console.log(side+' 240 frames rendered');
  }
  assert.ok(plans.before.some(s=>s.scene==='crystal'&&s.start>180&&s.end===entry));
  assert.ok(!plans.after.some(s=>s.scene==='crystal'&&s.end>180&&s.start<entry));
  const comparison=path.join(out,'Rush-Drop2-comparison.mp4');
  await run(ffmpeg,['-v','error','-y','-i',clips[0],'-i',clips[1],'-filter_complex',"[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='BEFORE':x=12:y=12:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65[a];[1:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='AFTER':x=12:y=12:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65[b];[a][b]hstack[v]",'-map','[v]','-map','1:a:0','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',comparison]);
  const video=JSON.parse(await run(ffprobe.path,['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,nb_frames','-of','json',comparison]));
  assert.equal(video.streams.find(s=>s.codec_type==='video').nb_frames,'240');assert.ok(video.streams.some(s=>s.codec_type==='audio'));
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'render-verification.json'),JSON.stringify({audioPath,audioSha256:createHash('sha256').update(audio).digest('hex'),entry,summary,plans,checks,clips,comparison,video,errors,host:'Headless Edge actual decoder + prepareSong + MvPlayer',scope:'Same original audio, fresh analysis, fixed seed. Baseline planner vs current automatic planner. No analysis/timeline/scene overrides. Diagnostic cover, not album art. Not live NetEase playback.'},null,2));
  console.log(JSON.stringify({entry,comparison,errors}));
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await app.close();}
