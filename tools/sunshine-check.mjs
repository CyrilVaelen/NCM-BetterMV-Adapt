// Compare the previous and current DSP on the same decoded local song, seed and
// scene. Hide the overlay so a passing picture check requires body movement.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {PROJECT,loadSettings,startServer} from '../exporter/server.mjs';

const output=path.resolve(PROJECT,'../exports/Sunshine-keyboard-response');
const id='17285341-0000-4000-8000-000000000004',settings=await loadSettings();
const fixture=path.join(output,'fixture',id);
await fs.mkdir(fixture,{recursive:true});
for(const name of ['audio.bin','cover.image'])await fs.copyFile(path.join(output,'fixture/17285341',name),path.join(fixture,name));
const input=JSON.parse(await fs.readFile(path.join(output,'fixture/17285341/input.json'),'utf8'));
Object.assign(input,{audioUrl:`/api/jobs/${id}/audio.bin`,coverUrl:`/api/jobs/${id}/cover.image`});
await fs.writeFile(path.join(fixture,'input.json'),JSON.stringify(input));
await fs.writeFile(path.join(fixture,'status.json'),JSON.stringify({id,state:'completed',outputName:'fixture-only.mp4'}));
const app=await startServer({settings:{...settings,port:5198,jobDir:path.join(output,'fixture'),outputDir:output}});
let browser,encoder;
const errors=[],checks=[];
async function run(exe,args){
  const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
  p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);
  const [code]=await once(p,'close');assert.equal(code,0,err);return {out,err};
}
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync']});
  const context=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:1});
  await context.route('**/*',r=>new URL(r.request().url()).origin===app.baseUrl?r.continue():r.abort());
  await context.route('**/@vite/client',r=>r.fulfill({contentType:'application/javascript',body:'export function createHotContext(){return {accept(){},dispose(){},on(){},send(){}}} export function injectQuery(u){return u}'}));
  await context.request.get(`${app.baseUrl}/api/health`,{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();page.setDefaultTimeout(180000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${app.baseUrl}/tools/lead-preview.html`);
  console.log('Preparing Sunshine from local audio.');
  const summary=await page.evaluate(async id=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{loadFonts},{Music},{computeSpectra},{Slicer},{analyzeLead:oldLead}]=await Promise.all([
      import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/src/render/text.ts'),import('/src/director/music.ts'),import('/src/analysis/spectrum.ts'),import('/src/analysis/util.ts'),import('/tools/fixtures/lead-v3.ts')]);
    const input=await(await fetch(`/api/jobs/${id}/input.json`)).json(),cover=new Image();cover.src=input.coverUrl;await cover.decode();
    const [audio]=await Promise.all([fetch(input.audioUrl).then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const song=await prepareSong({id:input.song.id,name:input.song.name,artists:input.song.artists,audio,cover,lyric:null}, {pause:yieldToPage});
    const buffer=await new OfflineAudioContext(1,1,22050).decodeAudioData(audio.slice(0));
    const mono=new Float32Array(buffer.length);
    for(let c=0;c<buffer.numberOfChannels;c++){const ch=buffer.getChannelData(c);for(let i=0;i<mono.length;i++)mono[i]+=ch[i]/buffer.numberOfChannels;}
    const steps=computeSpectra(mono,22050,new Slicer(8),0,1);let spec;
    for(;;){const next=steps.next();if(next.done){spec=next.value;break;}await yieldToPage();}
    const old=oldLead(spec),now={level:song.analysis.env.lead,attack:song.analysis.env.leadAttack,brightness:song.analysis.env.leadBrightness};
    const music=new Music(song.analysis),player=new MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
    const use=side=>{const cue=side==='before'?old:now;Object.assign(song.analysis.env,{lead:cue.level,leadAttack:cue.attack,leadBrightness:cue.brightness});};
    window.KEYS={song,player,music,use,load({side,scene,variant}){
      use(side);player.load(song,styleFor(song,'pulse'),new Set(input.config.off),{scene,variants:[variant]},'none',0,input.config.seed);player.director.overlay.quiet=true;
    },frame(t){
      const shot=player.frame(t,1/30),gl=player.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw new Error('Lost WebGL context');
      return {png:player.engine.renderer.domElement.toDataURL('image/png').split(',')[1],cue:music.leadAt(t),scene:shot.scene,label:shot.section.label};
    }};
    const windows=[];
    for(const [start,end] of [[0,15],[15,30],[75,90],[180,195],[210,225],[315,330]]){
      const both={};
      for(const side of ['before','after']){
        use(side);const level=[],attack=[];
        for(let t=start;t<end;t+=0.01){const c=music.leadAt(t);level.push(c.level);attack.push(c.attack);}
        const stats=xs=>{xs.sort((a,b)=>a-b);return {p10:xs[Math.floor(xs.length*.1)],median:xs[Math.floor(xs.length*.5)],p90:xs[Math.floor(xs.length*.9)]};};
        both[side]={level:stats(level),attack:stats(attack)};
      }
      windows.push({start,end,...both});
    }
    use('after');return {duration:song.duration,analysisVersion:song.analysis.version,bpm:song.analysis.bpm,windows,sections:song.analysis.sections,comparison:'same browser decode; previous vs updated lead DSP; same beat and section analysis'};
  },id);
  console.log(JSON.stringify({duration:summary.duration,windows:summary.windows}));
  async function loadFrame(side,scene,variant,t){
    await page.evaluate(c=>window.KEYS.load(c),{side,scene,variant});
    for(let n=10;n>0;n--)await page.evaluate(t=>window.KEYS.player.frame(t,1/30)?.scene,t-n/30);
    return page.evaluate(t=>window.KEYS.frame(t),t);
  }
  async function diff(a,b){return page.evaluate(async({a,b})=>{
    const pixels=async png=>{const image=new Image();image.src=`data:image/png;base64,${png}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;};
    const x=await pixels(a),y=await pixels(b);let sum=0,changed=0,mean=0,squared=0;
    for(let i=0;i<x.length;i+=4){const d=Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2]);sum+=d;if(d>3)changed++;const lum=(y[i]+y[i+1]+y[i+2])/3;mean+=lum;squared+=lum*lum;}
    const n=x.length/4;mean/=n;return {meanAbsoluteDifference:sum/n/3,changedPixelFraction:changed/n,standardDeviation:Math.sqrt(squared/n-mean*mean)};
  },{a,b});}
  for(const {label,scene,variant,start} of [{label:'intro-keys',scene:'particles',variant:'hold',start:18},{label:'quiet-keys',scene:'rings',variant:'front',start:315}]){
    // Choose the strongest improvement inside this short excerpt for the still.
    const t=await page.evaluate(start=>{let best={t:start,delta:-Infinity};for(let t=start;t<start+2;t+=.01){window.KEYS.use('before');const a=window.KEYS.music.leadAt(t);window.KEYS.use('after');const b=window.KEYS.music.leadAt(t);const d=b.level-a.level+.3*(b.attack-a.attack);if(d>best.delta)best={t,delta:d};}return best.t;},start);
    const before=await loadFrame('before',scene,variant,t),after=await loadFrame('after',scene,variant,t),stats=await diff(before.png,after.png);
    for(const [side,data] of [['before',before],['after',after]])await fs.writeFile(path.join(output,`${label}-${side}.png`),Buffer.from(data.png,'base64'));
    assert.ok(stats.meanAbsoluteDifference>.02&&stats.changedPixelFraction>.001,'subject response unchanged');assert.ok(stats.standardDeviation>2,'blank picture');
    checks.push({label,scene,variant,t,overlayHidden:true,beforeCue:before.cue,afterCue:after.cue,...stats});console.log(JSON.stringify(checks.at(-1)));
    if(process.argv.includes('--stills-only')||process.argv.includes('--reuse-video'))continue;
    for(const side of ['before','after']){
      await loadFrame(side,scene,variant,start-1/30);
      encoder=spawn(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-framerate','30','-i','pipe:0','-ss',String(start),'-i',path.join(output,'fixture',id,'audio.bin'),'-map','0:v:0','-map','1:a:0','-t','3','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',path.join(output,`${label}-${side}.mp4`)],{windowsHide:true,stdio:['pipe','ignore','pipe']});
      let err='';encoder.stderr.on('data',x=>err+=x);const ended=once(encoder,'close');
      for(let n=0;n<90;n++){
        const frame=await page.evaluate(t=>window.KEYS.frame(t),start+n/30);
        if(!encoder.stdin.write(Buffer.from(frame.png,'base64')))await once(encoder.stdin,'drain');
        if(n%30===29)console.log(`${label}-${side}: ${n+1}/90`);
      }
      encoder.stdin.end();const [code]=await ended;assert.equal(code,0,err);
    }
    await run(ffmpeg,['-y','-loglevel','error','-i',path.join(output,`${label}-before.mp4`),'-i',path.join(output,`${label}-after.mp4`),'-filter_complex',"[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='BEFORE':x=16:y=16:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65[a];[1:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='AFTER':x=16:y=16:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65[b];[a][b]hstack[v]",'-map','[v]','-map','1:a:0','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',path.join(output,`${label}-comparison.mp4`)]);
  }
  if(!process.argv.includes('--stills-only')&&!process.argv.includes('--reuse-video')){
    await fs.writeFile(path.join(output,'clips.txt'),"file 'intro-keys-comparison.mp4'\nfile 'quiet-keys-comparison.mp4'\n");
    const video=path.join(output,'Sunshine-keyboard-comparison.mp4');
    await run(ffmpeg,['-y','-loglevel','error','-f','concat','-safe','0','-i',path.join(output,'clips.txt'),'-c','copy','-movflags','+faststart',video]);
    const probe=JSON.parse((await run(ffprobe.path,['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,nb_frames','-of','json',video])).out);
    const volume=(await run(ffmpeg,['-hide_banner','-i',video,'-vn','-af','volumedetect','-f','null','-'])).err;
    const meanDbFS=Number(volume.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
    assert.equal(probe.streams.find(x=>x.codec_type==='video').nb_frames,'180');assert.equal(probe.streams.find(x=>x.codec_type==='audio').codec_name,'aac');assert.ok(Math.abs(Number(probe.format.duration)-6)<.15);assert.ok(meanDbFS>-60);
    await fs.writeFile(path.join(output,'video-validation.json'),JSON.stringify({probe,meanDbFS,livePictureCalibrationApplied:false},null,2));
  }
  // Test the actual settings controls with an isolated in-memory config store.
  const ui=await page.evaluate(async()=>{
    const saved={songVisualDelays:JSON.stringify({'17285341':1500})},writes=[];
    window.plugin={getConfig:(k,d)=>saved[k]??d,setConfig:(k,v)=>{saved[k]=v;writes.push([k,v]);}};
    window.betterncm={app:{getDataPath:async()=> 'D:/fixture'},fs:{readFileText:async()=>{throw new Error('not installed');}}};
    const {loadConfig,settingsView}=await import('/src/plugin/ui.ts');const config=loadConfig();let changes=0;
    document.body.replaceChildren(settingsView(config,()=>changes++,async()=>null,true,{id:17285341,name:'Sunshine'}));document.body.style.overflow='auto';
    const rows=[...document.querySelectorAll('.bmv-row')],row=rows.find(el=>el.querySelector('.bmv-row-label')?.textContent==='本曲画面延迟');
    if(!row)throw new Error('Per-song control missing');const input=row.querySelector('input');
    const initial=input.value;input.value='2300';input.dispatchEvent(new Event('blur'));const edited=config.songVisualDelays['17285341'];
    input.value='9000';input.dispatchEvent(new Event('blur'));const clamped=config.songVisualDelays['17285341'];
    input.value='0';input.dispatchEvent(new Event('blur'));const reset=config.songVisualDelays['17285341'];
    return {initial,edited,clamped,reset,deviceUnchanged:config.latencyMs===0,changes,stored:JSON.parse(saved.songVisualDelays),writes:writes.length};
  });
  assert.equal(ui.initial,'+1500');assert.equal(ui.edited,2300);assert.equal(ui.clamped,5000);assert.equal(ui.reset,0);assert.equal(ui.deviceUnchanged,true);assert.equal(ui.stored['17285341'],0);
  await page.screenshot({path:path.join(output,'settings-verification.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,process.argv.includes('--stills-only')?'stills-verification.json':'verification.json'),JSON.stringify({summary,checks,ui,errors},null,2));
  console.log(`Verified Sunshine body response and per-song controls: ${output}`);
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await app.close();}
