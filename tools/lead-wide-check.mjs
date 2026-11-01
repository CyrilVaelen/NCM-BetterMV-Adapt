// Whole-song acceptance on real local audio. Scene comparisons hide the edge
// overlay so passing them requires a change in the scene's own picture.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {loadSettings,startServer,PROJECT} from '../exporter/server.mjs';

const id='741d3da3-67d0-405d-8b1f-9c06bce5230d',settings=await loadSettings();
const output=path.resolve(PROJECT,'../exports/Homura-whole-song-lead');
const jobDir=path.join(output,'fixture');
await fs.mkdir(path.join(jobDir,id),{recursive:true});
for(const file of ['audio.bin','cover.image','input.json','status.json'])await fs.copyFile(path.join(settings.jobDir,id,file),path.join(jobDir,id,file));
const app=await startServer({settings:{...settings,port:5198,jobDir,outputDir:output}});
let browser,encoder;
const errors=[],sceneChecks=[],clips=[];
async function run(executable,args){
  const p=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);
  const [code]=await once(p,'close');if(code!==0)throw new Error(err);return out;
}
try{
  browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync']});
  const context=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:1});
  await context.route('**/*',r=>new URL(r.request().url()).origin===app.baseUrl?r.continue():r.abort());
  await context.route('**/@vite/client',r=>r.fulfill({contentType:'application/javascript',body:'export function createHotContext(){return {accept(){},dispose(){},on(){},send(){}}} export function injectQuery(u){return u}'}));
  await context.request.get(`${app.baseUrl}/api/health`,{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`${app.baseUrl}/tools/lead-preview.html`);
  const summary=await page.evaluate(async id=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{loadFonts},{Music}]=await Promise.all([
      import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/src/render/text.ts'),import('/src/director/music.ts')]);
    const input=await(await fetch(`/api/jobs/${id}/input.json`)).json(),cover=new Image();
    cover.src=input.coverUrl;await cover.decode();
    const [audio]=await Promise.all([fetch(input.audioUrl).then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const song=await prepareSong({id:input.song.id,name:input.song.name,artists:input.song.artists,audio,cover,lyric:{lrc:{lyric:'[00:00.000]preview'}},wiki:input.wiki,chorus:input.chorus},
      {pause:yieldToPage,refineLines:async lines=>lines.splice(0,lines.length,...structuredClone(input.lines))});
    const music=new Music(song.analysis),player=new MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
    const cues={lead:song.analysis.env.lead,leadAttack:song.analysis.env.leadAttack,leadBrightness:song.analysis.env.leadBrightness};
    const off=new Set([...(input.config.off??[]),...(input.config.offLooks??[])]);
    window.WIDE={player,song,music,load({enabled,scene,variant,style='pulse',quiet=true}){
      for(const key of Object.keys(cues)){if(enabled)song.analysis.env[key]=cues[key];else delete song.analysis.env[key];}
      player.load(song,styleFor(song,style),off,scene?{scene,variants:[variant]}:undefined,scene?'none':undefined,0,input.config.seed);
      player.director.overlay.quiet=quiet;
    },frame(t){
      const shot=player.frame(t,1/60),gl=player.engine.renderer.getContext();gl.finish();
      if(gl.isContextLost())throw new Error('WebGL context lost');
      return {png:player.engine.renderer.domElement.toDataURL('image/png').split(',')[1],scene:shot.scene,label:shot.section.label,cue:music.leadAt(t)};
    }};
    let best={t:18,score:0};
    for(let t=16;t<23;t+=0.05){const c=music.leadAt(t),score=c.level+0.3*c.attack;if(score>best.score)best={t,score};}
    return {duration:song.duration,seed:input.config.seed,sections:song.analysis.sections,nonDropTime:best.t,nonDropCue:music.leadAt(best.t)};
  },id);
  assert.ok(summary.nonDropCue.level>0.02,'No verse lead response');
  console.log(JSON.stringify({nonDropTime:summary.nonDropTime,cue:summary.nonDropCue}));

  async function loadFrame(config,t,warm=8){
    await page.evaluate(c=>window.WIDE.load(c),config);
    for(let n=warm;n>0;n--)await page.evaluate(t=>window.WIDE.player.frame(t,1/60)?.scene,t-n/60);
    return page.evaluate(t=>window.WIDE.frame(t),t);
  }
  async function compare(a,b){
    return page.evaluate(async({a,b})=>{
      const draw=async data=>{const im=new Image();im.src=`data:image/png;base64,${data}`;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);return x.getImageData(0,0,c.width,c.height).data;};
      const x=await draw(a),y=await draw(b);let diff=0,changed=0,mean=0,sq=0;
      for(let i=0;i<x.length;i+=4){const d=Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2]);diff+=d;if(d>3)changed++;const l=(y[i]+y[i+1]+y[i+2])/3;mean+=l;sq+=l*l;}
      const n=x.length/4;mean/=n;return {meanAbsoluteDifference:diff/(n*3),changedPixelFraction:changed/n,standardDeviation:Math.sqrt(sq/n-mean*mean)};
    },{a:a.png,b:b.png});
  }
  const cases=[['drive','push'],['channel','axis'],['orb','orbit'],['ripple','tilt'],['shatter','wall'],['particles','hold'],['kaleido','petal'],['rings','front'],['tunnel','rush'],['relief','fly'],['pillars','top'],['bokeh','orbit'],['ridges','front'],['city','horizon'],['ridges','front','ballad'],['relief','rise','pulse',10],['ridges','front','ink']];
  const selected=process.argv.find(x=>x.startsWith('--cases='))?.slice(8).split(',');
  for(const [scene,variant,style='pulse',at] of cases){
    if(selected&&!selected.includes(scene)&&!selected.includes(`${scene}-${style}`))continue;
    const t=at??summary.nonDropTime,config={scene,variant,style,quiet:true};
    const before=await loadFrame({...config,enabled:false},t),after=await loadFrame({...config,enabled:true},t);
    const stats=await compare(before,after),name=`${scene}-${style}-${variant}`;
    for(const [side,data] of [['before',before],['after',after]])await fs.writeFile(path.join(output,`${name}-${side}.png`),Buffer.from(data.png,'base64'));
    console.log(`${name}: ${JSON.stringify(stats)}`);
    await fs.writeFile(path.join(output,'last-scene-check.json'),JSON.stringify({name,stats,cue:after.cue,errors},null,2));
    assert.notEqual(after.label,'drop');assert.ok(after.cue.level>0);
    assert.ok(stats.meanAbsoluteDifference>0.02&&stats.changedPixelFraction>0.001,`${name} subject did not react`);
    assert.ok(stats.standardDeviation>2,`${name} produced a blank frame`);
    sceneChecks.push({scene,variant,style,t,label:after.label,overlayHidden:true,...stats});
    console.log(`${name}: difference=${stats.meanAbsoluteDifference.toFixed(2)}, changed=${(stats.changedPixelFraction*100).toFixed(1)}%`);
  }
  if(!process.argv.includes('--stills-only')){
    for(const [label,start] of [['verse',18],['drop',59]]){
      for(const [side,enabled] of [['before',false],['after',true]]){
        await loadFrame({enabled,quiet:false},start-1/30,30);
        encoder=spawn(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-framerate','30','-i','pipe:0','-ss',String(start),'-i',path.join(jobDir,id,'audio.bin'),'-map','0:v:0','-map','1:a:0','-t','4','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',path.join(output,`${label}-${side}.mp4`)],{windowsHide:true,stdio:['pipe','ignore','pipe']});
        let err='';encoder.stderr.on('data',x=>err+=x);const ended=once(encoder,'close');
        for(let n=0;n<120;n++){
          const t=start+n/30;
          await page.evaluate(t=>window.WIDE.player.frame(t,1/60)?.scene,t-1/60);
          const frame=await page.evaluate(t=>window.WIDE.frame(t),t);
          if(!encoder.stdin.write(Buffer.from(frame.png,'base64')))await once(encoder.stdin,'drain');
          if(n===60)clips.push({label,side,t,scene:frame.scene,cue:frame.cue});
        }
        encoder.stdin.end();const [code]=await ended;assert.equal(code,0,err);
        console.log(`${label}-${side}: 120 frames`);
      }
      await run(ffmpeg,['-y','-loglevel','error','-i',path.join(output,`${label}-before.mp4`),'-i',path.join(output,`${label}-after.mp4`),'-filter_complex',"[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='MELODY OFF':x=16:y=16:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65[a];[1:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='MELODY ON':x=16:y=16:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65[b];[a][b]hstack[v]",'-map','[v]','-map','1:a:0','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',path.join(output,`${label}-comparison.mp4`)]);
    }
    await fs.writeFile(path.join(output,'clips.txt'),"file 'verse-comparison.mp4'\nfile 'drop-comparison.mp4'\n");
    await run(ffmpeg,['-y','-loglevel','error','-f','concat','-safe','0','-i',path.join(output,'clips.txt'),'-c','copy','-movflags','+faststart',path.join(output,'Homura-whole-song-comparison.mp4')]);
    const probe=JSON.parse(await run(ffprobe.path,['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,nb_frames','-of','json',path.join(output,'Homura-whole-song-comparison.mp4')]));
    assert.equal(probe.streams.find(s=>s.codec_type==='video').nb_frames,'240');
    assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
    assert.ok(Math.abs(Number(probe.format.duration)-8)<0.15);
    await fs.writeFile(path.join(output,'video-validation.json'),JSON.stringify(probe,null,2));
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,selected?'selected-verification.json':'verification.json'),JSON.stringify({summary,sceneChecks,clips,errors},null,2));
  console.log(`Verified ${sceneChecks.length} subject comparisons. ${output}`);
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await app.close();}
