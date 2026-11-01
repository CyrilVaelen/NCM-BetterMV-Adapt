import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import {PROJECT,loadSettings,startServer} from '../exporter/server.mjs';

const output=path.resolve(PROJECT,'../exports/Cant-Let-You-Go-drop-response');
const fixture=JSON.parse(await fs.readFile(path.join(output,'fixture.json'),'utf8'));
const metadata=JSON.parse(await fs.readFile(path.join(output,'metadata.json'),'utf8'));
const side=process.argv.includes('--after')?'after':'before',settings=await loadSettings();
const app=await startServer({settings:{...settings,port:5198,jobDir:path.join(output,'fixture'),outputDir:output}});
let browser,encoder;const errors=[],checks=[],clips=[];
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync']});
  const context=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:1});
  await context.route('**/*',r=>new URL(r.request().url()).origin===app.baseUrl?r.continue():r.abort());
  await context.request.get(`${app.baseUrl}/api/health`,{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();page.setDefaultTimeout(180000);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`${app.baseUrl}/tools/lead-preview.html`);
  const summary=await page.evaluate(async({id,metadata})=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{loadFonts},{parseWiki},{planShots},{Music}]=await Promise.all([
      import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/src/render/text.ts'),import('/src/meta/wiki.ts'),import('/src/director/director.ts'),import('/src/director/music.ts')]);
    const input=await(await fetch(`/api/jobs/${id}/input.json`)).json(),cover=new Image();cover.src=input.coverUrl;await cover.decode();
    const [audio]=await Promise.all([fetch(input.audioUrl).then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const chorus=metadata.chorus.chorus.find(c=>c.id===input.song.id),wiki=parseWiki(metadata.wiki);
    const song=await prepareSong({...input.song,audio,cover,lyric:metadata.lyric,wiki,chorus:chorus?[chorus.startTime/1000,chorus.endTime/1000]:undefined},{pause:yieldToPage});
    const style=styleFor(song,'pulse'),shots=planShots(new Music(song.analysis),style,input.config.seed,{graphic:song.palette.graphic,lyrics:song.lines.length>0},new Set(input.config.off));
    const drops=shots.filter(s=>s.section.label==='drop');
    const player=new MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
    window.DROP={player,song,load({from,to,native=false,scene,variant}){
      player.load(song,style,new Set(input.config.off),scene?{scene,variants:[variant]}:undefined,native?'none':undefined,0,input.config.seed,shots=>shots.filter(s=>s.end>from&&s.start<to));
      if(native)player.director.overlay.quiet=true;
      this.lead=player.music.leadAt.bind(player.music);
    },frame(t,native=false,lead=true){
      player.music.leadAt=lead?this.lead:()=>({level:0,attack:0,brightness:.5});
      const shot=player.frame(t,1/30),renderer=player.engine.renderer;
      if(native){const scene=player.scenes[shot.scene];renderer.setRenderTarget(null);renderer.clear();renderer.render(scene.scene,scene.camera);}
      const gl=renderer.getContext();gl.finish();if(gl.isContextLost())throw new Error('Lost WebGL context');
      return {png:renderer.domElement.toDataURL('image/png').split(',')[1],scene:shot.scene,label:shot.section.label,cue:this.lead(t)};
    }};
    return {duration:song.duration,bpm:song.analysis.bpm,style:style.id,lines:song.lines.length,drops,sections:song.analysis.sections};
  },{id:fixture.id,metadata});
  await fs.writeFile(path.join(output,`${side}-browser-plan.json`),JSON.stringify(summary,null,2));
  const unique=process.argv.includes('--extra')
    ? ['particles','menger'].map(scene=>({...summary.drops[0],scene,variant:scene==='particles'?'hold':'glide'}))
    : summary.drops.filter((s,i,a)=>a.findIndex(p=>p.scene===s.scene)===i);
  for(const shot of unique){
    const start=shot.start+1,to=Math.min(shot.end-.2,start+2);
    if(to-start<1)continue;
    const config={from:shot.start,to:shot.end,scene:shot.scene,variant:shot.variant,native:true};
    await page.evaluate(c=>window.DROP.load(c),config);
    for(let n=8;n>0;n--)await page.evaluate(t=>window.DROP.player.frame(t,1/30)?.scene,start-n/30);
    const at=await page.evaluate(({start,to})=>{let best=start,v=-1;for(let t=start;t<to;t+=.01){const c=window.DROP.lead(t);if(c.attack>v){best=t;v=c.attack}}return best},{start,to});
    const off=await page.evaluate(t=>window.DROP.frame(t,true,false),at),on=await page.evaluate(t=>window.DROP.frame(t,true,true),at);
    const stats=await page.evaluate(async({a,b})=>{
      async function pixels(s){const i=new Image();i.src='data:image/png;base64,'+s;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return x.getImageData(0,0,c.width,c.height).data;}
      const x=await pixels(a),y=await pixels(b);let diff=0,changed=0,mean=0,sq=0;
      for(let i=0;i<x.length;i+=4){const d=Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2]);diff+=d;if(d>6)changed++;const l=(y[i]+y[i+1]+y[i+2])/3;mean+=l;sq+=l*l;}
      const n=x.length/4;mean/=n;return {meanAbsoluteDifference:diff/(3*n),changedPixelFraction:changed/n,standardDeviation:Math.sqrt(sq/n-mean*mean)};
    },{a:off.png,b:on.png});
    await fs.writeFile(path.join(output,`${shot.scene}-${side}-native.png`),Buffer.from(on.png,'base64'));
    checks.push({scene:shot.scene,variant:shot.variant,t:at,cue:on.cue,postProcessing:false,overlay:false,...stats});
    console.log(JSON.stringify({side,scene:shot.scene,...stats}));
    if(process.argv.includes('--stills-only'))continue;
    await page.evaluate(c=>window.DROP.load(c),{from:start-.3,to:to+.3});
    for(let n=8;n>0;n--)await page.evaluate(t=>window.DROP.player.frame(t,1/30)?.scene,start-n/30);
    const file=path.join(output,`${shot.scene}-${side}.mp4`),frames=Math.round((to-start)*30);
    encoder=spawn(ffmpeg,['-y','-v','error','-f','image2pipe','-framerate','30','-i','pipe:0','-ss',String(start),'-i',path.join(fixture.fixture,'audio.bin'),'-map','0:v:0','-map','1:a:0','-t',String(to-start),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',file],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let err='';encoder.stderr.on('data',b=>err+=b);const ended=once(encoder,'close');
    for(let n=0;n<frames;n++){const f=await page.evaluate(t=>window.DROP.frame(t),start+n/30);assert.equal(f.scene,shot.scene);if(!encoder.stdin.write(Buffer.from(f.png,'base64')))await once(encoder.stdin,'drain');}
    encoder.stdin.end();assert.equal((await ended)[0],0,err);encoder=null;clips.push({scene:shot.scene,start,end:to,frames,file,forcedScene:false});
    console.log(`${side}: ${shot.scene}, ${frames} frames`);
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,`${side}${process.argv.includes('--extra')?'-extra':''}-render.json`),JSON.stringify({summary,checks,clips,errors},null,2));
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await app.close();}
