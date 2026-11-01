// Reproducible, continuous .12 / candidate comparison using the user's local song.
// No listening label is inferred from the implementation's own role scores.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { build, createServer } from 'vite';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(project);
const work = path.join(project, 'tools/.lead-redo-baseline');
const out = path.join(root, 'exports/Lights-Out-redo-20261018');
const state = path.join(root, 'state/redo-lead-priority-20261018/visual');
const zipPath = path.join(root, 'BetterMV-0.9.0-local-export.12-complete-win64.zip');
const prefix = 'BetterMV-Full/NCM-BetterMV-0.9.0/src/';
const audioPath = 'D:/野葱视频转换器/音频转换/Blanke,RUNN - Lights Out.mp3';
const lyricPath = 'D:/CloudMusic/VipSongsDownload/Blanke,RUNN - Lights Out.lrc';
const coverPath = path.join(project, 'plugin/preview.jpg');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fps = 24, width = 640, height = 360, seed = 20261018;
const clips = [
  { id: 'drop1', start: 62.3, end: 91.84 },
  { id: 'drop2', start: 154.6, end: 213.66 },
].map(c => ({ ...c, count: Math.ceil((c.end-c.start)*fps), renderedEnd: c.start + Math.ceil((c.end-c.start)*fps)/fps }));
const option = (name, fallback) => process.argv.find(x => x.startsWith('--'+name+'='))?.split('=').slice(1).join('=') ?? fallback;
const writeJson = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2));
for (const dir of [work, out, state]) await fs.mkdir(dir, {recursive:true});

async function freezeBaseline() {
  const manifestPath = path.join(work, 'frozen-source.json');
  const bytes = await fs.readFile(zipPath), zipHash = hash(bytes);
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (manifest) {
    assert.equal(manifest.archiveSha256, zipHash, '.12 archive changed since baseline freezing');
    for (const file of manifest.files) assert.equal(hash(await fs.readFile(path.join(work, 'src', file.path))), file.sha256, 'Frozen .12 source changed: '+file.path);
    return manifest;
  }
  const zip = await JSZip.loadAsync(bytes), files = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith(prefix)) continue;
    const rel = name.slice(prefix.length);
    assert.ok(!rel.includes('..') && !path.isAbsolute(rel));
    const body = await entry.async('nodebuffer'), target = path.join(work, 'src', rel);
    await fs.mkdir(path.dirname(target), {recursive:true}); await fs.writeFile(target, body);
    files.push({path:rel,bytes:body.length,sha256:hash(body)});
  }
  assert.ok(files.length > 80 && files.some(f=>f.path==='app/player.ts'));
  files.sort((a,b)=>a.path.localeCompare(b.path));
  manifest = {version:'0.9.0-local-export.12',archive:zipPath,archiveSha256:zipHash,frozenAt:new Date().toISOString(),files};
  await writeJson(manifestPath, manifest); await writeJson(path.join(state, 'baseline-source.json'), manifest);
  return manifest;
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
  await build({configFile:false,root:project,publicDir:false,logLevel:'warn',define:{__VERSION__:JSON.stringify(side==='before'?'0.9.0-local-export.12':'candidate-redo')},build:{outDir:work,emptyOutDir:false,minify:false,lib:{entry,formats:['es'],fileName:()=>`${side}-browser.mjs`}}});
  assert.deepEqual(await snapshot(sourceDir),sources,'Source changed during browser bundle build');
  await writeJson(path.join(state,`${side}-source.json`),{files:sources,sourceSha256:hash(JSON.stringify(sources))});
  const body = await fs.readFile(path.join(work, `${side}-browser.mjs`));
  return {file:path.join(work,`${side}-browser.mjs`),sha256:hash(body),bytes:body.length,sourceSha256:hash(JSON.stringify(sources))};
}

const baseline = await freezeBaseline();
if (process.argv.includes('--prepare-baseline')) {
  const before = await bundle('before');
  await writeJson(path.join(state, 'baseline-bundle.json'), before);
  console.log(JSON.stringify({baselineSourceFiles:baseline.files.length,archiveSha256:baseline.archiveSha256,bundle:before}));
  process.exit(0);
}

const sides = option('side','both') === 'both' ? ['before','after'] : [option('side','both')];
assert.ok(sides.every(s=>['before','after'].includes(s)));
const scenes = option('scene','all') === 'all' ? ['tunnel','drive'] : [option('scene','all')];
assert.ok(scenes.every(s=>['tunnel','drive'].includes(s)));
const selectedClips = option('drop','all') === 'all' ? clips : clips.filter(c=>c.id === 'drop'+option('drop','all'));
assert.ok(selectedClips.length);
const [audio, cover, lrc] = await Promise.all([fs.readFile(audioPath),fs.readFile(coverPath),fs.readFile(lyricPath,'utf8')]);
const inputs = {audio:{path:audioPath,sha256:hash(audio)},lrc:{path:lyricPath,sha256:hash(Buffer.from(lrc))},cover:{path:coverPath,sha256:hash(cover)},width,height,fps,seed,clips};
await writeJson(path.join(state, 'inputs.json'), inputs);
const builds = {};
for (const side of sides) builds[side] = await bundle(side);
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
    const errors=[];
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();page.setDefaultTimeout(240000);
    page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER ERROR',e.message);});
    page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error('BROWSER ERROR',m.text());}});
    await page.goto(base+'/redo');
    const summary=await page.evaluate(async({side,lrc,seed,fps})=>{
      const api=await import(`/tools/.lead-redo-baseline/${side}-browser.mjs`);
      const image=new Image();image.src='/redo-cover';await image.decode();
      const [audio]=await Promise.all([fetch('/redo-audio').then(r=>r.arrayBuffer()),api.loadFonts('/fonts/')]);
      const song=await api.prepareSong({id:20261018,name:'Lights Out',artists:['Blanke','RUNN'],audio,cover:image,lyric:{lrc:{lyric:lrc}}},{pause:api.yieldToPage});
      const player=new api.MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
      const gl=player.engine.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
      const renderer={version:gl.getParameter(gl.VERSION),vendor:gl.getParameter(debug?debug.UNMASKED_VENDOR_WEBGL:gl.VENDOR),renderer:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER)};
      const mini=document.createElement('canvas');mini.width=160;mini.height=90;const miniCtx=mini.getContext('2d',{willReadFrequently:true});
      window.REDO={api,song,player,seed,fps,previousPixels:null,fx:null,mini,miniCtx,music:new api.Music(song.analysis),async load(scene,clip){
        this.scene=scene;this.clip=clip;this.previousPixels=null;
        player.load(song,api.styleFor(song,'pulse'),new Set(['menger','sierpinski','cantor']),{scene,variants:['push']},'none',0,seed,(shots,music)=>{
          // Rounded clip starts may precede the detected downbeat by 3 ms. The
          // second Drop also contains adjacent detected Drop sections. Build a
          // merged Drop shot using its LAST source section index: otherwise the
          // old director mistakes the later Drop piece for a future Drop and
          // holds its pre-Drop blackout for the entire synthetic comparison.
          const pieces=music.a.sections.map((s,i)=>({s,i})).filter(({s})=>s.label==='drop'&&s.end>clip.start+.02&&s.start<clip.end-.02);
          const first=pieces[0]??{s:music.a.sections.find(s=>s.start<=clip.start+.02&&s.end>clip.start+.02),i:0};
          const section={...first.s,start:clip.start,end:clip.renderedEnd,label:'drop',energy:Math.max(...pieces.map(p=>p.s.energy),first.s.energy)};
          return [{...shots.find(s=>s.start<=clip.start+.02&&s.end>clip.start+.02),scene,variant:'push',start:clip.start,end:clip.renderedEnd,section,sectionIndex:pieces.at(-1)?.i??first.i,seed,run:undefined,look:undefined}];
        });
        const original=player.director.frame.bind(player.director);player.director.frame=(...args)=>{const frame=original(...args);this.fx=frame.fx;return frame;};
        await player.warm(api.yieldToPage);
        // Seed post-effect history at the first valid frame; Tunnel's comet uses
        // shot-relative phase and cannot be rendered at a negative shot time.
        for(let n=12;n>0;n--)player.frame(clip.start,1/fps);
        return player.director.shots.map(({scene,variant,start,end,section,seed})=>({scene,variant,start,end,label:section.label,seed}));
      },frame(t){
        const shot=player.frame(t,1/fps),gl=player.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw new Error('WebGL context lost');
        const actual=player.scenes[this.scene],camera=actual.camera,lines=actual.lines;
        const geometry={};
        if(lines){geometry.instances=lines.mesh.geometry.instanceCount;for(const name of ['aStart','aEnd','aColor','aWidth']){const a=lines.mesh.geometry.attributes[name],count=geometry.instances*a.itemSize;let sum=0,square=0,max=0;for(let i=0;i<count;i+=Math.max(1,Math.floor(count/256))){const v=a.array[i];sum+=v;square+=v*v;max=Math.max(max,Math.abs(v));}geometry[name]={sum,square,max};}}
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
      return {side,version:song.analysis.version,duration:song.duration,bpm:song.analysis.bpm,analysisMs:song.ms,sections:song.analysis.sections,renderer};
    },{side,lrc,seed,fps});
    await writeJson(path.join(state,`${side}-analysis.json`), summary);
    const fullAnalysis=await page.evaluate(()=>JSON.stringify(REDO.song.analysis,(_key,value)=>ArrayBuffer.isView(value)?Array.from(value):value));
    await fs.writeFile(path.join(state,`${side}-analysis-full.json`),fullAnalysis);
    console.log(JSON.stringify({side,prepared:true,version:summary.version,duration:summary.duration,analysisMs:summary.analysisMs}));
    if(process.argv.includes('--analysis-only')){await context.close();continue;}
    for(const scene of scenes)for(const clip of selectedClips){
      const tag=`${scene}-${clip.id}-${side}`,file=path.join(out,tag+'.mp4');
      const shots=await page.evaluate(({scene,clip})=>REDO.load(scene,clip),{scene,clip});
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
      const record={side,scene,clip,seed,width,height,fps,file,sha256:hash(await fs.readFile(file)),probe,shots,quality,errors:[...errors],bundle:builds[side],input:inputs,baselineArchiveSha256:baseline.archiveSha256,limits:['Role, foreground, camera and geometry values are implementation diagnostics, not independent instrument ground truth.','Scene and camera variant are deliberately held fixed for the entire Drop to isolate source-response changes.','This is an actual headless Edge WebGL render, not a running NetEase client audition.'],frames};
      await writeJson(path.join(out,tag+'-frames.json'),record);results.push({...record,frames:undefined});
      console.log(JSON.stringify({completed:tag,quality,errors}));
      assert.equal(quality.emptyFrames,0,'Empty continuous-comparison frames: '+tag);
      assert.equal(quality.fullyFadedFrames,0,'Synthetic shot remained under pre-Drop blackout: '+tag);
    }
    await context.close();
  }
  if(!process.argv.includes('--analysis-only'))for(const scene of scenes)for(const clip of selectedClips){
    const a=path.join(out,`${scene}-${clip.id}-before.mp4`),b=path.join(out,`${scene}-${clip.id}-after.mp4`);
    if(!(await fs.stat(a).catch(()=>null))||!(await fs.stat(b).catch(()=>null)))continue;
    const file=path.join(out,`${scene}-${clip.id}-comparison.mp4`);
    await run(ffmpeg,['-y','-loglevel','error','-i',a,'-i',b,'-filter_complex',"[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='OLD .12':x=12:y=12:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.65[a];[1:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='CANDIDATE':x=12:y=12:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.65[b];[a][b]hstack=inputs=2[v]",'-map','[v]','-map','1:a:0','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',file]);
    const probe=JSON.parse(await run(ffprobe.path,['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,nb_frames,avg_frame_rate','-of','json',file]));
    const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.width,width*2);assert.equal(video.height,height);assert.equal(Number(video.nb_frames),clip.count);assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
    comparisons.push({scene,clip,file,sha256:hash(await fs.readFile(file)),probe});
    console.log(JSON.stringify({comparison:file}));
  }
  await writeJson(path.join(state,`render-${sides.join('-')}-${Date.now()}.json`),{results,comparisons,finishedAt:new Date().toISOString()});
} finally {
  if(encoder?.exitCode===null)encoder.kill();
  await browser?.close(); await vite.close(); await new Promise(resolve=>server.close(resolve));
}
