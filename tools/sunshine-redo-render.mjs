// Reproducible, continuous .13 / candidate comparison using the user's local Sunshine audio.
// No listening label is inferred from the implementation's own role scores.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { build, createServer } from 'vite';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(project);
const work = path.join(project, 'tools/.sunshine-redo-baseline');
const out = path.join(root, 'exports/Sunshine-redo-20261018');
const state = path.join(root, 'state/sunshine-form-keys-20261018/visual');
const baselineSource = path.join(root,'state/sunshine-form-keys-20261018/baseline/src');
const audioPath = 'D:/野葱视频转换器/音频转换/David Guetta,Avicii - Sunshine_1.mp3';
const lyricPath = 'D:/CloudMusic/VipSongsDownload/David Guetta,Avicii - Sunshine.lrc';
const coverPath = path.join(project, 'plugin/preview.jpg');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fps = 24, width = 640, height = 360, seed = 20261018;
const clips = [
  {id:'intro',scene:'tunnel',variant:'push',start:15,end:39},
  {id:'boundary',scene:'drive',variant:'push',start:55,end:79},
  {id:'drop',scene:'drive',variant:'push',start:125,end:149},
  {id:'late',scene:'rings',variant:'front',start:315,end:339},
].map(c => ({ ...c, count: Math.ceil((c.end-c.start)*fps), renderedEnd: c.start + Math.ceil((c.end-c.start)*fps)/fps }));
const option = (name, fallback) => process.argv.find(x => x.startsWith('--'+name+'='))?.split('=').slice(1).join('=') ?? fallback;
const writeJson = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2));
for (const dir of [work, out, state]) await fs.mkdir(dir, {recursive:true});

async function freezeBaseline(){
 const walk=async(dir,rel='')=>{const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name),r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())out.push(...await walk(p,r));else if(e.isFile()){const bytes=await fs.readFile(p);out.push({path:r,bytes:bytes.length,sha256:hash(bytes)});}}return out.sort((a,b)=>a.path.localeCompare(b.path));};
 const files=await walk(baselineSource),manifestPath=path.join(work,'frozen-source.json');let previous;try{previous=JSON.parse(await fs.readFile(manifestPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(previous){assert.deepEqual(previous.files,files,'Root baseline source changed');for(const f of files)assert.equal(hash(await fs.readFile(path.join(work,'src',f.path))),f.sha256,'Frozen source changed');return previous;}
 for(const f of files){const target=path.join(work,'src',f.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(baselineSource,f.path),target);assert.equal(hash(await fs.readFile(target)),f.sha256);}
 const manifest={version:'0.9.0-local-export.13',source:baselineSource,sourceSha256:hash(JSON.stringify(files)),files};await writeJson(manifestPath,manifest);await writeJson(path.join(state,'baseline-source.json'),manifest);return manifest;
}

async function bundle(side) {
  const snapshot = async (dir, rel='') => {
    const files=[];
    for(const item of await fs.readdir(dir,{withFileTypes:true})){
      const next=path.join(dir,item.name),key=rel?rel+'/'+item.name:item.name;
      if(item.isDirectory())files.push(...await snapshot(next,key));
      else if(item.isFile())files.push({path:key,sha256:hash(await fs.readFile(next))});
    }
    return files.sort((a,b)=>a.path.localeCompare(b.path));
  };
  const sourceDir=side==='before'?path.join(work,'src'):path.join(project,'src');
  const sources=await snapshot(sourceDir);
  const src = side === 'before' ? './src' : '../../src';
  const entry = path.join(work, `${side}-entry.ts`);
  await fs.writeFile(entry, `export { MvPlayer } from '${src}/app/player.ts';\nexport { prepareSong,styleFor,yieldToPage } from '${src}/app/prepare.ts';\nexport { loadFonts } from '${src}/render/text.ts';\nexport { Music } from '${src}/director/music.ts';\n`);
  await build({configFile:false,root:project,publicDir:false,logLevel:'warn',define:{__VERSION__:JSON.stringify(side==='before'?'0.9.0-local-export.13':'candidate-redo')},build:{outDir:work,emptyOutDir:false,minify:false,lib:{entry,formats:['es'],fileName:()=>`${side}-browser.mjs`}}});
  assert.deepEqual(await snapshot(sourceDir),sources,'Source changed during browser bundle build');
  await writeJson(path.join(state,`${side}-source.json`),{files:sources,sourceSha256:hash(JSON.stringify(sources))});
  const body = await fs.readFile(path.join(work, `${side}-browser.mjs`));
  return {file:path.join(work,`${side}-browser.mjs`),sha256:hash(body),bytes:body.length,sourceSha256:hash(JSON.stringify(sources))};
}

const baseline = await freezeBaseline();
if (process.argv.includes('--prepare-baseline')) {
  const before = await bundle('before');
  await writeJson(path.join(state, 'baseline-bundle.json'), before);
  console.log(JSON.stringify({baselineSourceFiles:baseline.files.length,sourceSha256:baseline.sourceSha256,bundle:before}));
  process.exit(0);
}

const sides = option('side','both') === 'both' ? ['before','after'] : [option('side','both')];
assert.ok(sides.every(s=>['before','after'].includes(s)));
const selectedClips=option('clip','all')==='all'?clips:clips.filter(c=>c.id===option('clip','all'));
assert.ok(selectedClips.length);
const [audio, cover, lrc] = await Promise.all([fs.readFile(audioPath),fs.readFile(coverPath),fs.readFile(lyricPath,'utf8')]);
const inputs = {audio:{path:audioPath,sha256:hash(audio)},lrc:{path:lyricPath,sha256:hash(Buffer.from(lrc))},cover:{path:coverPath,sha256:hash(cover)},width,height,fps,seed,clips};
await writeJson(path.join(state, 'inputs.json'), inputs);
const builds = {};
if(!process.argv.includes('--comparison-only'))for (const side of sides) builds[side] = await bundle(side);
const vite = await createServer({configFile:false,root:project,publicDir:path.join(project,'public'),logLevel:'warn',server:{middlewareMode:true,hmr:false,ws:false,fs:{strict:true,allow:[project]}}});
const server = http.createServer((req,res)=>{
  const respond = (type, body) => {res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);};
  if(req.url==='/redo-audio') return respond('audio/mpeg',audio);
  if(req.url==='/redo-cover') return respond('image/jpeg',cover);
  if(req.url==='/redo') return respond('text/html','<!doctype html><style>html,body{margin:0;background:#000;overflow:hidden}#stage{width:640px;height:360px}</style><div id="stage"></div>');
  vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const run = async (exe,args) => {
  const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);
  assert.equal((await once(p,'close'))[0],0,stderr);return stdout;
};
let browser, encoder;
const results = [], comparisons=[];
try {
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync']});
  for (const side of sides) {
    if(process.argv.includes('--comparison-only'))continue;
    const errors=[];
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();page.setDefaultTimeout(240000);
    page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER ERROR',e.message);});
    page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error('BROWSER ERROR',m.text());}});
    await page.goto(base+'/redo');
    const summary=await page.evaluate(async({side,lrc,seed,fps,clips})=>{
      const api=await import(`/tools/.sunshine-redo-baseline/${side}-browser.mjs`);
      const image=new Image();image.src='/redo-cover';await image.decode();
      const [audio]=await Promise.all([fetch('/redo-audio').then(r=>r.arrayBuffer()),api.loadFonts('/fonts/')]);
      const song=await api.prepareSong({id:20261018,name:'Sunshine',artists:['David Guetta','Avicii'],audio,cover:image,lyric:{lrc:{lyric:lrc}}},{pause:api.yieldToPage});
      const player=new api.MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
      player.load(song,api.styleFor(song,'pulse'),new Set(['menger','sierpinski','cantor']),undefined,'none',0,seed);
      const automaticShots=player.director.shots.map(({scene,variant,start,end,section,sectionIndex,seed})=>({scene,variant,start,end,label:section.label,sectionIndex,seed}));
      const gl=player.engine.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
      const renderer={version:gl.getParameter(gl.VERSION),vendor:gl.getParameter(debug?debug.UNMASKED_VENDOR_WEBGL:gl.VENDOR),renderer:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER)};
      const mini=document.createElement('canvas');mini.width=160;mini.height=90;const miniCtx=mini.getContext('2d',{willReadFrequently:true});
      window.REDO={api,song,player,seed,fps,previousPixels:null,fx:null,mini,miniCtx,music:new api.Music(song.analysis),async load(scene,clip,fixture,muted=false,automatic=false){
        this.scene=scene;this.clip=clip;this.previousPixels=null;
        if(automatic)player.load(song,api.styleFor(song,'pulse'),new Set(['menger','sierpinski','cantor']),undefined,'none',0,seed);
        else player.load(song,api.styleFor(song,'pulse'),new Set(['menger','sierpinski','cantor']),{scene,variants:[clip.variant]},'none',0,seed,(shots,music)=>{
          // The production analysis is left intact. This fixed .13 fixture holds
          // label, energy, shot clock, scene and seed constant to isolate signal changes.
          const index=music.a.sections.findIndex(s=>s.start<=clip.start&&s.end>clip.start);
          const section={...fixture,start:clip.start,end:clip.renderedEnd};
          if(muted){
            if(music.a.timbre){const v={...music.a.timbre};for(const [key,value] of Object.entries(v))if(key!=='hz'&&ArrayBuffer.isView(value))v[key]=new value.constructor(value.length);music.a={...music.a,timbre:v};}
            for(const kind of ['foreground','leadRole','synthStab','bassStab','keys','leads']){music.hitLists?.set(kind,[]);music.hitTimes?.set(kind,new Float64Array());}
            for(const k of ['foregroundAt','leadAt'])music[k]=()=>({level:0,attack:0,brightness:.5});
            if(typeof music.foregroundHits==='function')music.foregroundHits=()=>[];
            if(typeof music.highlightHits==='function')music.highlightHits=()=>[];
            if(typeof music.foregroundMotion==='function')music.foregroundMotion=()=>0;
            if(typeof music.roleHits==='function')music.roleHits=()=>[];
            const pulse=music.pulse.bind(music);music.pulse=(kind,...args)=>['foreground','leadRole','synthStab','bassStab','keys','leads'].includes(kind)?0:pulse(kind,...args);
            const hits=music.hitsBetween.bind(music);music.hitsBetween=(kind,...args)=>['foreground','leadRole','synthStab','bassStab','keys','leads'].includes(kind)?[]:hits(kind,...args);
          }
          return [{...shots.find(s=>s.start<=clip.start&&s.end>clip.start),scene,variant:clip.variant,start:clip.start,end:clip.renderedEnd,section,sectionIndex:Math.max(0,index),seed,run:undefined,look:undefined}];
        });
        player.director.overlay.scene.visible=false;
        const original=player.director.frame.bind(player.director);player.director.frame=(...args)=>{const frame=original(...args);this.fx=frame.fx;return frame;};
        await player.warm(api.yieldToPage);
        // Seed post-effect history at the first valid frame; Tunnel's comet uses
        // shot-relative phase and cannot be rendered at a negative shot time.
        for(let n=12;n>0;n--)player.frame(clip.start,1/fps);
        return player.director.shots.map(({scene,variant,start,end,section,seed})=>({scene,variant,start,end,label:section.label,seed}));
      },frame(t){
        const shot=player.frame(t,1/fps),gl=player.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw new Error('WebGL context lost');
        const actual=player.scenes[shot.scene],camera=actual.camera,lines=actual.lines;
        const geometry={};
        if(lines?.mesh?.geometry){geometry.instances=lines.mesh.geometry.instanceCount;for(const name of ['aStart','aEnd','aColor','aWidth']){const a=lines.mesh.geometry.attributes[name];if(!a)continue;const count=geometry.instances*a.itemSize;let sum=0,square=0,max=0;for(let i=0;i<count;i+=Math.max(1,Math.floor(count/256))){const v=a.array[i];sum+=v;square+=v*v;max=Math.max(max,Math.abs(v));}geometry[name]={sum,square,max};}}
        miniCtx.drawImage(player.engine.renderer.domElement,0,0,160,90);const pixels=miniCtx.getImageData(0,0,160,90).data;
        let sum=0,square=0,lit=0,clipped=0,delta=0;
        for(let i=0;i<pixels.length;i+=4){const l=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];sum+=l;square+=l*l;if(l>12)lit++;if(l>=250)clipped++;if(this.previousPixels)delta+=(Math.abs(pixels[i]-this.previousPixels[i])+Math.abs(pixels[i+1]-this.previousPixels[i+1])+Math.abs(pixels[i+2]-this.previousPixels[i+2]))/3;}
        this.previousPixels=new Uint8ClampedArray(pixels);const count=pixels.length/4,mean=sum/count;
        const m=this.music;
        const signals={foreground:m.foregroundAt(t),roles:m.timbreAt(t),legacyLead:m.leadAt(t),kick:m.pulse('kick',t,.08),snare:m.pulse('snare',t,.08),bassStab:m.pulse('bassStab',t,.08),leadRole:m.pulse('leadRole',t,.08)};
        if(typeof m.leadOwnership==='function')signals.leadOwnership=m.leadOwnership(t);
        const v=m.a.timbre;
        if(v?.melodyAttack){const x=t*v.fps,i=Math.min(v.melodyAttack.length-1,Math.floor(x)),fraction=x-i;signals.upperAttack=v.melodyAttack[i]+((v.melodyAttack[i+1]??v.melodyAttack[i])-v.melodyAttack[i])*fraction;}
        if(typeof m.sourceAt==='function')signals.source=m.sourceAt(t);
        return {png:player.engine.renderer.domElement.toDataURL('image/png').split(',')[1],t,scene:shot.scene,variant:shot.variant,label:shot.section.label,signals,camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov},geometry,fx:this.fx,pixels:{mean,standardDeviation:Math.sqrt(Math.max(0,square/count-mean*mean)),litFraction:lit/count,clippedFraction:clipped/count,meanFrameDifference:delta/count}};
      }};
      return {side,version:song.analysis.version,duration:song.duration,bpm:song.analysis.bpm,analysisMs:song.ms,sections:song.analysis.sections,automaticShots,clipCues:clips.map(c=>({id:c.id,start:c.start,end:c.end,foreground:REDO.music.highlightHits(c.start,c.end),keys:REDO.music.hitsBetween('keys',c.start,c.end),leadRole:REDO.music.roleHits('leadRole',c.start,c.end),synthStab:REDO.music.roleHits('synthStab',c.start,c.end),bassStab:REDO.music.roleHits('bassStab',c.start,c.end)})),renderer};
    },{side,lrc,seed,fps,clips});
    await writeJson(path.join(state,`${side}-analysis.json`), summary);
    const fullAnalysis=await page.evaluate(()=>JSON.stringify(REDO.song.analysis,(_key,value)=>ArrayBuffer.isView(value)?Array.from(value):value));
    await fs.writeFile(path.join(state,`${side}-analysis-full.json`),fullAnalysis);
    console.log(JSON.stringify({side,prepared:true,version:summary.version,duration:summary.duration,analysisMs:summary.analysisMs}));
    if(process.argv.includes('--analysis-only')){await context.close();continue;}
    for(const clip of selectedClips){const scene=clip.scene;
      const tag=`${process.argv.includes('--automatic')?'auto':scene}-${clip.id}-${side}${process.argv.includes('--mute-foreground')?'-muted':''}`,file=path.join(out,tag+'.mp4');
      if(process.argv.includes('--mute-foreground')){const control=JSON.parse(await fs.readFile(path.join(out,scene+'-'+clip.id+'-'+side+'-frames.json'),'utf8'));assert.equal(control.bundle.sha256,builds[side].sha256,'Control and knockout must use exactly the same browser bundle');}
      const fixtureFile=path.join(state,clip.id+'-fixture.json');let fixture;
      if(side==='before'){fixture=summary.sections.find(s=>s.start<=clip.start&&s.end>clip.start);await writeJson(fixtureFile,fixture);}else fixture=JSON.parse(await fs.readFile(fixtureFile,'utf8'));
      const shots=await page.evaluate(({scene,clip,fixture,muted,automatic})=>REDO.load(scene,clip,fixture,muted,automatic),{scene,clip,fixture,muted:process.argv.includes('--mute-foreground'),automatic:process.argv.includes('--automatic')});
      encoder=spawn(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-ss',String(clip.start),'-i',audioPath,'-map','0:v:0','-map','1:a:0','-t',String(clip.count/fps),'-frames:v',String(clip.count),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',file],{windowsHide:true,stdio:['pipe','ignore','pipe']});
      let stderr='';encoder.stderr.on('data',b=>stderr+=b);const ended=once(encoder,'close'),frames=[];let lastSha='',duplicates=0;
      for(let n=0;n<clip.count;n++){
        const {png,...frame}=await page.evaluate(t=>REDO.frame(t),clip.start+n/fps),bytes=Buffer.from(png,'base64'),sha=hash(bytes);
        if(sha===lastSha)duplicates++;lastSha=sha;frames.push({...frame,pngSha256:sha});
        if(!encoder.stdin.write(bytes))await once(encoder.stdin,'drain');
        if(n%(fps*4)===0||n===clip.count-1)await fs.writeFile(path.join(out,`${tag}-${n.toString().padStart(4,'0')}.png`),bytes);
        if(n%(fps*5)===0||n===clip.count-1)console.log(JSON.stringify({render:tag,frame:n+1,total:clip.count,songTime:+frame.t.toFixed(3)}));
      }
      encoder.stdin.end();assert.equal((await ended)[0],0,stderr);encoder=undefined;
      const probe=JSON.parse(await run(ffprobe.path,['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,nb_frames,avg_frame_rate','-of','json',file]));
      assert.equal(Number(probe.streams.find(s=>s.codec_type==='video').nb_frames),clip.count);assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
      const min=(key)=>Math.min(...frames.map(f=>f.pixels[key])),max=(key)=>Math.max(...frames.map(f=>f.pixels[key]));
      const quality={minMean:min('mean'),maxMean:max('mean'),minStandardDeviation:min('standardDeviation'),maxClippedFraction:max('clippedFraction'),identicalConsecutiveFrames:duplicates,emptyFrames:frames.filter(f=>f.pixels.mean<3&&f.pixels.standardDeviation<2&&f.pixels.litFraction<.001).length,fullyFadedFrames:frames.filter(f=>f.fx.fade>=.999).length};
      const record={side,scene,clip,seed,width,height,fps,mutedForeground:process.argv.includes('--mute-foreground'),automatic:process.argv.includes('--automatic'),file,sha256:hash(await fs.readFile(file)),probe,shots,quality,errors:[...errors],bundle:builds[side],input:inputs,baselineSourceSha256:baseline.sourceSha256,limits:['Role, foreground, camera and geometry values are implementation diagnostics, not independent instrument ground truth.',process.argv.includes('--automatic')?'Actual automatic shots and section labels are used; scene changes remain part of this comparison.':'Scene, baseline section label and energy, camera variant and shot clock are deliberately held fixed; these clips do not validate automatic structure labels.','This is an actual headless Edge WebGL render, not a running NetEase client audition.'],frames};
      await writeJson(path.join(out,tag+'-frames.json'),record);results.push({...record,frames:undefined});
      console.log(JSON.stringify({completed:tag,quality,errors}));
      if(!process.argv.includes('--automatic'))assert.equal(quality.emptyFrames,0,'Empty continuous-comparison frames: '+tag);
      if(quality.fullyFadedFrames)console.warn('Fixed scene blackout diagnostic: '+tag);
    }
    await context.close();
  }
  if(!process.argv.includes('--analysis-only')&&!process.argv.includes('--mute-foreground'))for(const clip of selectedClips){const scene=clip.scene;
    const prefix=process.argv.includes('--automatic')?'auto':scene;
    const a=path.join(out,`${prefix}-${clip.id}-before.mp4`),b=path.join(out,`${prefix}-${clip.id}-after.mp4`);
    if(!(await fs.stat(a).catch(()=>null))||!(await fs.stat(b).catch(()=>null)))continue;
    const file=path.join(out,`${prefix}-${clip.id}-comparison.mp4`);
    await run(ffmpeg,['-y','-loglevel','error','-i',a,'-i',b,'-filter_complex',"[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='OLD .13':x=12:y=12:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.65[a];[1:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='CANDIDATE':x=12:y=12:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.65[b];[a][b]hstack=inputs=2[v]",'-map','[v]','-map','1:a:0','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',file]);
    const probe=JSON.parse(await run(ffprobe.path,['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,nb_frames,avg_frame_rate','-of','json',file]));
    const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.width,width*2);assert.equal(video.height,height);assert.equal(Number(video.nb_frames),clip.count);assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
    comparisons.push({scene,clip,file,sha256:hash(await fs.readFile(file)),probe});
    console.log(JSON.stringify({comparison:file}));
  }
  if(process.argv.includes('--mute-foreground'))for(const side of sides)for(const clip of selectedClips){
    const scene=clip.scene,active=path.join(out,scene+'-'+clip.id+'-'+side+'.mp4'),muted=path.join(out,scene+'-'+clip.id+'-'+side+'-muted.mp4');
    if(!(await fs.stat(active).catch(()=>null))||!(await fs.stat(muted).catch(()=>null)))continue;
    const file=path.join(out,scene+'-'+clip.id+'-foreground-control-'+side+'.mp4');
    await run(ffmpeg,['-y','-loglevel','error','-i',active,'-i',muted,'-filter_complex',"[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='FOREGROUND ON':x=12:y=12:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.65[a];[1:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='FOREGROUND OFF':x=12:y=12:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.65[b];[a][b]hstack=inputs=2[v]",'-map','[v]','-map','0:a:0','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',file]);
    const raw=async(video)=>{const p=spawn(ffmpeg,['-loglevel','error','-i',video,'-vf','scale=160:90','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','pipe']});const chunks=[];let stderr='';p.stdout.on('data',b=>chunks.push(b));p.stderr.on('data',b=>stderr+=b);assert.equal((await once(p,'close'))[0],0,stderr);return Buffer.concat(chunks);};
    const [a,b]=await Promise.all([raw(active),raw(muted)]);assert.equal(a.length,b.length);const stride=160*90*3,perFrame=[];
    for(let offset=0;offset<a.length;offset+=stride){let abs=0,square=0;for(let j=offset;j<offset+stride;j++){const d=a[j]-b[j];abs+=Math.abs(d);square+=d*d;}perFrame.push({t:clip.start+offset/stride/fps,pixelMeanAbsoluteDifference:abs/stride,pixelRootMeanSquareDifference:Math.sqrt(square/stride)});}
    const activeData=JSON.parse(await fs.readFile(path.join(out,scene+'-'+clip.id+'-'+side+'-frames.json'),'utf8')),mutedData=JSON.parse(await fs.readFile(path.join(out,scene+'-'+clip.id+'-'+side+'-muted-frames.json'),'utf8'));
    let fov=0,position=0,geometry=0;for(let i=0;i<activeData.frames.length;i++){const a=activeData.frames[i],b=mutedData.frames[i];fov+=Math.abs(a.camera.fov-b.camera.fov);position+=Math.hypot(...a.camera.position.map((v,j)=>v-b.camera.position[j]));geometry+=Math.abs((a.geometry.aStart?.square??0)-(b.geometry.aStart?.square??0));}
    const n=perFrame.length,mean=key=>perFrame.reduce((s,f)=>s+f[key],0)/n;
    await writeJson(path.join(out,scene+'-'+clip.id+'-foreground-control-'+side+'.json'),{clip,scene,file,sha256:hash(await fs.readFile(file)),frames:n,meanPixelAbsoluteDifference:mean('pixelMeanAbsoluteDifference'),meanPixelRootMeanSquareDifference:mean('pixelRootMeanSquareDifference'),fractionFramesPixelMAEOver2:perFrame.filter(f=>f.pixelMeanAbsoluteDifference>2).length/n,meanFovDifference:fov/n,meanCameraPositionDifference:position/n,meanGeometrySquareDifference:geometry/n,limits:['Diagnostic disables foreground level/attack APIs and foreground role events before scene construction.','Beat clock, audio playback, fixed scene/camera/section, seed and raw red spectrum remain unchanged; independent green foreground spectrum and role arrays are zeroed in an analysis clone.','A nonzero difference demonstrates actual rendering contribution, not instrument classification truth.'],perFrame});
    console.log(JSON.stringify({foregroundControl:file,meanPixelAbsoluteDifference:mean('pixelMeanAbsoluteDifference'),meanFovDifference:fov/n,meanCameraPositionDifference:position/n}));
  }
  await writeJson(path.join(state,`render-${sides.join('-')}-${Date.now()}.json`),{results,comparisons,finishedAt:new Date().toISOString()});
} finally {
  if(encoder?.exitCode===null)encoder.kill();
  await browser?.close(); await vite.close(); await new Promise(resolve=>server.close(resolve));
}

