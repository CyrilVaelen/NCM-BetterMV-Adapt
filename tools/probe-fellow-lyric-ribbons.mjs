import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {PROJECT,loadSettings,startServer} from '../exporter/server.mjs';

const output=path.resolve(PROJECT,'../exports/Fellow-Feeling-lyric-probe');
const fixture=JSON.parse(await fs.readFile(path.join(output,'fixture.json'),'utf8'));
const metadata=JSON.parse(await fs.readFile(path.join(output,'metadata.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=['src/app/player.ts','src/director/director.ts','src/director/music.ts','src/director/overlay.ts','src/render/lead-motion.ts','src/plugin/main.ts','src/plugin/ui.ts','../BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin'];
const sourceHashes={};for(const f of files)sourceHashes[f]=hash(await fs.readFile(path.resolve(PROJECT,f)));
const settings=await loadSettings();
const app=await startServer({settings:{...settings,port:5201,jobDir:path.join(output,'fixture'),outputDir:output}});
let browser,encoder;const errors=[],checks=[];
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync']});
  const context=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:1});
  await context.route('**/*',r=>new URL(r.request().url()).origin===app.baseUrl?r.continue():r.abort());
  await context.request.get(`${app.baseUrl}/api/health`,{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();page.setDefaultTimeout(180000);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)console.log(JSON.stringify({status:r.status(),path:new URL(r.url()).pathname}));});
  page.on('requestfailed',r=>console.log(JSON.stringify({failed:new URL(r.url()).pathname,error:r.failure()?.errorText})));
  await page.goto(`${app.baseUrl}/tools/lead-preview.html`);
  const summary=await page.evaluate(async({id,metadata})=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{loadFonts},{parseWiki},{LyricTrack},{LineBatch},{drawLeadRibbons}]=await Promise.all([
      import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/src/render/text.ts'),import('/src/meta/wiki.ts'),import('/src/director/lyrics.ts'),import('/src/render/lines.ts'),import('/src/render/lead-motion.ts')]);
    const input=await(await fetch(`/api/jobs/${id}/input.json`)).json(),cover=new Image();cover.src=input.coverUrl;await cover.decode();
    const [audio]=await Promise.all([fetch(input.audioUrl).then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const mark=metadata.chorus.chorus?.find(c=>c.id===input.song.id);
    const song=await prepareSong({...input.song,audio,cover,lyric:metadata.lyric,wiki:parseWiki(metadata.wiki),chorus:mark?[mark.startTime/1000,mark.endTime/1000]:undefined},{pause:yieldToPage});
    const style=styleFor(song,'auto'),player=new MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
    if(style.id!=='pulse')throw new Error(`Expected the visible pulse ribbons; auto style was ${style.id}`);
    async function geometryHash(batch,count=batch.count){
      const g=batch.mesh.geometry,parts=['aStart','aEnd','aColor','aWidth'].map(n=>{const a=g.attributes[n];return new Uint8Array(a.array.buffer,a.array.byteOffset,count*a.itemSize*4)});
      const bytes=new Uint8Array(parts.reduce((s,b)=>s+b.length,0));let off=0;for(const p of parts){bytes.set(p,off);off+=p.length;}
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    }
    window.LYRIC_PROBE={song,player,load(delay){
      player.load(song,style,new Set(),undefined,'none',delay,28912014,shots=>shots.filter(s=>s.end>129&&s.start<159));
      this.delay=delay;this.lyrics=new LyricTrack(player.lines);this.trace=null;
      const m=player.music,lead=m.leadAt.bind(m),overlay=player.director.overlay,update=overlay.update.bind(overlay);
      let inOverlay=false;
      m.leadAt=t=>{const c=lead(t);if(inOverlay)this.trace.cueCalls.push({t,cue:c});return c;};
      overlay.update=(t,shot,fx,light)=>{this.trace={t,light:!!light,fade:fx.fade,cueCalls:[]};inOverlay=true;try{return update(t,shot,fx,light)}finally{inOverlay=false}};
      this.ribbonBatch=new LineBatch(500);
      const Scene=overlay.scene.constructor;this.ribbonScene=new Scene();
      this.ribbonScene.add(this.ribbonBatch.mesh);
      this.ribbonBatch.mesh.material.depthTest=false;
      return {delay,firstLineStart:player.lines[0]?.start,firstWordStart:player.lines[0]?.words[0]?.start,shiftedEveryLine:player.lines.every((l,i)=>l.start===song.lines[i].start+delay&&l.end===song.lines[i].end+delay&&l.words.every((w,j)=>w.start===song.lines[i].words[j].start+delay&&w.end===song.lines[i].words[j].end+delay)),shots:player.shots.map(s=>({scene:s.scene,start:s.start,end:s.end,variant:s.variant}))};
    },async inspect(t,{images=false}={}){
      const shot=player.frame(t,1/30),m=player.music,overlay=player.director.overlay,trace=this.trace;
      const batch=this.ribbonBatch;batch.clear();
      const cue=m.leadAt(t),pos=m.at(t).pos,vis=(1-trace.fade)*(trace.light?0:1);
      drawLeadRibbons(batch,player.engine.aspect,pos,cue,song.palette.signal,vis);
      const isolatedHash=await geometryHash(batch),actualHash=await geometryHash(overlay.lines,batch.count);
      if(actualHash!==isolatedHash)throw new Error('Actual overlay prefix differs from the independently identified side ribbons');
      const result={t,delay:this.delay,scene:shot.scene,section:shot.section.label,cue,overlayTime:trace.t,overlayLight:trace.light,overlayFade:trace.fade,overlayLeadCalls:trace.cueCalls,ribbonCount:batch.count,ribbonHash:actualHash,allOverlayLinesHash:await geometryHash(overlay.lines),lyric:this.lyrics.current(t)?{index:this.lyrics.current(t).index,start:this.lyrics.current(t).line.start,age:this.lyrics.current(t).age,wordProgress:this.lyrics.current(t).words.map(w=>w.progress)}:null};
      if(images){
        const renderer=player.engine.renderer,gl=renderer.getContext();gl.finish();if(gl.isContextLost())throw new Error('Lost WebGL context');
        result.framePng=renderer.domElement.toDataURL('image/png').split(',')[1];
        batch.commit(overlay.lines.mesh.material.uniforms.uResolution.value,1);
        renderer.setRenderTarget(null);renderer.setClearColor(0x000000,1);renderer.clear();renderer.render(this.ribbonScene,overlay.camera);gl.finish();
        result.ribbonsPng=renderer.domElement.toDataURL('image/png').split(',')[1];
      }
      return result;
    }};
    return {song:input.song,duration:song.duration,style:style.id,lyrics:song.lines.map(l=>({start:l.start,end:l.end,words:l.words.length})),seed:28912014};
  },{id:fixture.job,metadata});
  assert.equal(summary.song.name,'Fellow Feeling');
  const times=[130.6,132.6,133.6,134.6,137.2,141.2,146.2,151.2,156.2];
  for(const delay of [0,2,-2,30,-30]){
    const load=await page.evaluate(d=>window.LYRIC_PROBE.load(d),delay);assert.ok(load.shiftedEveryLine);
    for(let n=6;n>0;n--)await page.evaluate(t=>window.LYRIC_PROBE.player.frame(t,1/30)?.scene,130.6-n/30);
    const frames=[];
    for(const t of times){
      const result=await page.evaluate(async t=>window.LYRIC_PROBE.inspect(t,{images:t===132.6}),t);
      for(const key of ['framePng','ribbonsPng'])if(result[key]){await fs.writeFile(path.join(output,`${key==='framePng'?'frame':'ribbons'}-delay-${delay}.png`),Buffer.from(result[key],'base64'));delete result[key];}
      assert.equal(result.overlayTime,t);assert.ok(result.overlayLeadCalls.length>0);assert.ok(result.overlayLeadCalls.every(c=>c.t===t));frames.push(result);
      if(delay===0)console.log(JSON.stringify({t,scene:result.scene,cue:result.cue,count:result.ribbonCount,light:result.overlayLight,fade:result.overlayFade}));
    }
    checks.push({load,frames});console.log(JSON.stringify({delay,samples:frames.length,ribbonSegments:frames[1].ribbonCount,firstLineStart:load.firstLineStart}));
  }
  const reference=checks[0];
  assert.ok(reference.frames.filter(f=>f.ribbonCount>100).length>=3,'Too few visible ribbons to prove timing');
  for(const c of checks.slice(1)){
    assert.deepEqual(c.load.shots,reference.load.shots);
    for(let i=0;i<times.length;i++){
      assert.equal(c.frames[i].ribbonHash,reference.frames[i].ribbonHash);
      assert.equal(c.frames[i].allOverlayLinesHash,reference.frames[i].allOverlayLinesHash);
      assert.deepEqual(c.frames[i].cue,reference.frames[i].cue);
    }
  }
  assert.notEqual(reference.frames[0].ribbonHash,reference.frames[1].ribbonHash,'Positive control: audio time did not change the ribbons');
  assert.notDeepEqual(reference.frames[1].lyric,checks[1].frames[1].lyric,'Lyric delay had no visible lyric state effect');
  assert.equal(hash(await fs.readFile(path.join(output,'ribbons-delay-0.png'))),hash(await fs.readFile(path.join(output,'ribbons-delay-2.png'))));
  const clipStart=131.5,duration=4,frames=120;
  for(const delay of [0,2]){
    await page.evaluate(d=>window.LYRIC_PROBE.load(d),delay);
    for(let n=6;n>0;n--)await page.evaluate(t=>window.LYRIC_PROBE.player.frame(t,1/30)?.scene,clipStart-n/30);
    const video=path.join(output,`delay-${delay}.mp4`);
    encoder=spawn(ffmpeg,['-y','-v','error','-f','image2pipe','-framerate','30','-i','pipe:0','-ss',String(clipStart),'-i',path.join(fixture.fixture,'audio.bin'),'-map','0:v:0','-map','1:a:0','-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',video],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let err='';encoder.stderr.on('data',b=>err+=b);const ended=once(encoder,'close');
    for(let n=0;n<frames;n++){
      const png=await page.evaluate(t=>{const p=window.LYRIC_PROBE.player;p.frame(t,1/30);p.engine.renderer.getContext().finish();return p.engine.renderer.domElement.toDataURL('image/png').split(',')[1]},clipStart+n/30);
      if(!encoder.stdin.write(Buffer.from(png,'base64')))await once(encoder.stdin,'drain');
    }
    encoder.stdin.end();assert.equal((await ended)[0],0,err);encoder=null;console.log(`delay ${delay}: ${frames} frames`);
  }
  async function run(exe,args){const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);assert.equal((await once(p,'close'))[0],0,err);return out;}
  const video=path.join(output,'Fellow-Feeling-lyric-delay-comparison.mp4'),font='C\\:/Windows/Fonts/arial.ttf';
  await run(ffmpeg,['-y','-v','error','-i',path.join(output,'delay-0.mp4'),'-i',path.join(output,'delay-2.mp4'),'-filter_complex',`[0:v]drawtext=fontfile='${font}':text='LYRICS 0 ms':x=12:y=12:fontsize=19:fontcolor=white:box=1:boxcolor=black@0.7[a];[1:v]drawtext=fontfile='${font}':text='LYRICS +2000 ms':x=12:y=12:fontsize=19:fontcolor=white:box=1:boxcolor=black@0.7[b];[a][b]hstack[v]`,'-map','[v]','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',video]);
  const probe=JSON.parse(await run(ffprobe.path,['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,nb_frames','-of','json',video]));
  assert.equal(probe.streams.find(s=>s.codec_type==='video').nb_frames,'120');assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
  await run(ffmpeg,['-y','-v','error','-ss','1.1','-i',video,'-frames:v','1',path.join(output,'comparison-frame.png')]);
  for(const [f,expected] of Object.entries(sourceHashes))assert.equal(hash(await fs.readFile(path.resolve(PROJECT,f))),expected,`${f} changed during this read-only probe`);
  assert.deepEqual(errors,[]);
  const result={summary,source:fixture.source,delaysSeconds:checks.map(c=>c.load.delay),sampleTimes:times,totalSamples:checks.reduce((n,c)=>n+c.frames.length,0),conclusion:{lyricsShifted:true,sideRibbonsShifted:false,everyRibbonGeometryHashIdenticalAtSameAudioTime:true,ribbonOnlyPngIdentical:true,audioTimePositiveControlChangedRibbons:true,sourceAndInstalledPluginUnchanged:true},sourceHashes,checks,video,probe,errors,limits:'Independent browser probe of installed-source behavior; no changes to NetEase playback or saved user settings.'};
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({video,totalSamples:result.totalSamples,conclusion:result.conclusion,report:path.join(output,'verification.json')}));
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await app.close();}
