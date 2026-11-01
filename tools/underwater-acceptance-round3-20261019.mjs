// Read-only production audit; only local evidence and a disposable browser bundle are written.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {build,createServer} from 'vite';
import {chromium} from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
const project=process.cwd(),root=path.dirname(project),out=path.join(root,'exports/Underwater-acceptance-round3-20261019'),work=path.join(project,'tools/.underwater-acceptance-round3-20261019');
const audioPath='D:/野葱视频转换器/音频转换/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).mp3';
const coverPath='D:/Temp/codex-clipboard-4b1a13bf-15ce-4cd3-8d23-59864ee7a8cd.png';
const lyricPath='D:/CloudMusic/VipSongsDownload/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).lrc';
const hash=b=>createHash('sha256').update(b).digest('hex'),width=960,height=540,fps=12,seed=20261019;
await fs.mkdir(out,{recursive:true});await fs.mkdir(work,{recursive:true});
const sourceFiles=['src/render/engine.ts','src/scenes/lyricRig.ts','src/scenes/underwater.ts','src/scenes/catalog.ts','src/scenes/types.ts','src/app/player.ts','src/director/music.ts','src/director/director.ts','src/style/style.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,hash(await fs.readFile(f))])));
await fs.writeFile(path.join(work,'entry.ts'),`export * as THREE from 'three';\nexport {MvPlayer} from '../../src/app/player.ts';\nexport {prepareSong,styleFor,yieldToPage} from '../../src/app/prepare.ts';\nexport {loadFonts} from '../../src/render/text.ts';\n`);
await build({configFile:false,root:project,publicDir:false,logLevel:'warn',define:{__VERSION__:JSON.stringify('underwater-readonly-audit')},build:{outDir:work,emptyOutDir:false,minify:false,lib:{entry:path.join(work,'entry.ts'),formats:['es'],fileName:()=> 'browser.mjs'}}});
const [audio,cover,lrc]=await Promise.all([fs.readFile(audioPath),fs.readFile(coverPath),fs.readFile(lyricPath,'utf8')]);
const vite=await createServer({configFile:false,root:project,publicDir:path.join(project,'public'),logLevel:'warn',server:{middlewareMode:true,hmr:false,ws:false,fs:{strict:true,allow:[project]}}});
const server=http.createServer((req,res)=>{const send=(type,b)=>{res.writeHead(200,{'Content-Type':type});res.end(b);};if(req.url==='/audio')return send('audio/mpeg',audio);if(req.url==='/cover')return send('image/png',cover);if(req.url==='/audit')return send('text/html',`<!doctype html><style>html,body{margin:0;background:black}#stage{width:${width}px;height:${height}px}</style><div id="stage"></div>`);vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
let browser,encoder;const errors=[];
try{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const page=await context.newPage();page.setDefaultTimeout(240000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.goto(base+'/audit');
 const prepared=await page.evaluate(async({lrc,seed,fps})=>{
  const api=await import('/tools/.underwater-acceptance-round3-20261019/browser.mjs');const image=new Image();image.src='/cover';await image.decode();
  const [bytes]=await Promise.all([fetch('/audio').then(r=>r.arrayBuffer()),api.loadFonts('/fonts/')]);
  const song=await api.prepareSong({id:2026101901,name:'Underneath The Waves',artists:['Last Heroes','Monika Santucci'],audio:bytes,cover:image,lyric:{lrc:{lyric:lrc}}},{pause:api.yieldToPage});
  const player=new api.MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
  const drop=song.analysis.sections.find(s=>s.label==='drop');if(!drop)throw Error('No Drop estimated; do not invent one');
  window.AUDIT={api,song,player,drop,fps,seed,async load(variant='dive',isolate=true,muted=false){
   player.load(song,api.styleFor(song,'pulse'),new Set(),{scene:'underwater',variants:[variant]},'none',0,seed,(shots,music)=>{this.music=music;if(muted)music.foregroundAt=()=>({level:0,attack:0,brightness:.5});return[{scene:'underwater',variant,start:drop.start,end:drop.end,section:drop,sectionIndex:song.analysis.sections.indexOf(drop),seed}];});
   this.scene=player.scenes.underwater;this.sceneId='underwater';player.director.overlay.scene.visible=false;if(isolate)this.scene.rig.group.visible=false;await player.warm(api.yieldToPage);
  },frame(t){
   player.frame(t,1/fps);const s=this.scene,c=s.camera,gl=player.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw Error('WebGL lost');
   const mini=document.createElement('canvas');mini.width=160;mini.height=90;const ctx=mini.getContext('2d');ctx.drawImage(player.engine.renderer.domElement,0,0,160,90);const px=ctx.getImageData(0,0,160,90).data;let sum=0,bright=0;
   for(let i=0;i<px.length;i+=4){const l=.2126*px[i]+.7152*px[i+1]+.0722*px[i+2];sum+=l;if(l>64)bright++;}
   return {t,relative:t-drop.start,position:c.position.toArray(),quaternion:c.quaternion.toArray(),waterPosition:s.waterUniforms.uCamPos.value.toArray(),bubblePosition:s.bubbleUniforms.uCamPos.value.toArray(),bubbleBurst:s.bubbleUniforms.uBurst.value,waterLag:c.position.distanceTo(s.waterUniforms.uCamPos.value),bubbleLag:c.position.distanceTo(s.bubbleUniforms.uCamPos.value),lead:this.music.leadAt(t),foreground:this.music.foregroundAt(t),kick:this.music.pulse('kick',t,.45),leadOwnership:this.music.leadOwnership(t),uLeadLevel:s.rockUniforms.uLeadLevel.value,uBassPulse:s.rockUniforms.uBassPulse.value,pixels:{mean:sum/(px.length/4),brightFraction:bright/(px.length/4)},png:player.engine.renderer.domElement.toDataURL('image/png').split(',')[1]};
  }};
  await AUDIT.load();const bounds=[];AUDIT.scene.sceneryGroup.children.forEach(o=>{o.geometry.computeBoundingBox();o.updateMatrixWorld(true);const b=o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);bounds.push({min:b.min.toArray(),max:b.max.toArray()});});
  const gl=player.engine.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  return {duration:song.duration,bpm:song.analysis.bpm,sections:song.analysis.sections,drop,pillarBounds:bounds,renderer:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER)};
 },{lrc,seed,fps});
 console.log(JSON.stringify({prepared:true,drop:prepared.drop,duration:prepared.duration,renderer:prepared.renderer}));
 await page.evaluate(async()=>{
  const {defaultFx}=await import('/src/render/engine.ts'),{LyricTrack}=await import('/src/director/lyrics.ts');
  AUDIT.lyrics=new LyricTrack(AUDIT.song.lines);AUDIT.originalForeground=AUDIT.music.foregroundAt;
  AUDIT.still=function(t,options={}){
   const scene=this.scene,music=this.music,shot={...this.player.director.shots[0],variant:options.variant??'dive',end:options.long?this.drop.start+65:this.drop.end,section:{...this.drop,end:options.long?this.drop.start+65:this.drop.end}};
   music.foregroundAt=options.muted?()=>({level:0,attack:0,brightness:.5}):this.originalForeground;
   const fx=defaultFx();scene.update({t,dt:1/24,music,lyrics:this.lyrics,palette:this.song.palette,shot,shotT:t-this.drop.start,aspect:this.player.engine.aspect,fx});
   scene.rig.group.visible=!!options.lyrics;
   const hidden=[];if(options.empty)for(const child of scene.scene.children)if(child.visible){child.visible=false;hidden.push(child);}if(options.bubbleOnly)for(const child of scene.scene.children)if(child!==scene.bubbleMesh&&child.visible){child.visible=false;hidden.push(child);}if(options.noAtmosphere)for(const child of [scene.bubbleMesh,scene.marineSnowMesh])if(child.visible){child.visible=false;hidden.push(child);}if(options.snowOnly)for(const child of scene.scene.children)if(child!==scene.marineSnowMesh&&child.visible){child.visible=false;hidden.push(child);}
   if(options.noRocks)scene.sceneryGroup.visible=false;
   const snowSide=scene.marineSnowMesh.material.side;
   if(options.doubleSnow){scene.marineSnowMesh.material.side=2;scene.marineSnowMesh.material.needsUpdate=true;}
   const fixed=defaultFx();fixed.grain=0;fixed.film=0;fixed.echo=0;fixed.motion=0;fixed.aperture=0;fixed.bloom=.35;
   this.player.engine.render(scene.scene,scene.camera,fixed,t,null,null);const gl=this.player.engine.renderer.getContext();gl.finish();
   const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');ctx.drawImage(this.player.engine.renderer.domElement,0,0,160,90);
   const pixels=Array.from(ctx.getImageData(0,0,160,90).data),result={t,relative:t-this.drop.start,options,camera:scene.camera.position.toArray(),quaternion:scene.camera.quaternion.toArray(),waterLag:scene.camera.position.distanceTo(scene.waterUniforms.uCamPos.value),bubbleLag:scene.camera.position.distanceTo(scene.bubbleUniforms.uCamPos.value),burst:scene.bubbleUniforms.uBurst.value,foreground:music.foregroundAt(t),pixels,scenery:scene.recyclableScenery.map(o=>({base:o.userData.baseZ,z:o.position.z})),png:this.player.engine.renderer.domElement.toDataURL('image/png').split(',')[1]};
   for(const child of hidden)child.visible=true;if(options.noRocks)scene.sceneryGroup.visible=true;
   if(options.doubleSnow){scene.marineSnowMesh.material.side=snowSide;scene.marineSnowMesh.material.needsUpdate=true;}
   music.foregroundAt=this.originalForeground;return result;
  };
 });

 const records=[];
 async function bounded(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('GPU timeout '+label)),45000)})]);}finally{clearTimeout(timer);}}
 async function snap(label,relative,options={}){
  const{png,pixels,...record}=await bounded(page.evaluate(o=>AUDIT.still(o.t,o.options),{t:prepared.drop.start+relative,options}),label);
  const file=path.join(out,label+'.png');await fs.writeFile(file,Buffer.from(png,'base64'));
  const result={...record,file,pngSha256:hash(Buffer.from(png,'base64')),pixels};records.push(result);
  console.log(JSON.stringify({case:label,relative,camera:result.camera}));return result;
 }
 const diff=(a,b)=>{let sum=0,changed=0,max=0;for(let i=0;i<a.pixels.length;i+=4)for(let c=0;c<3;c++){const d=Math.abs(a.pixels[i+c]-b.pixels[i+c]);sum+=d;if(d>2)changed++;max=Math.max(max,d);}return{pixelMAE:sum/(160*90*3),changedChannelFraction:changed/(160*90*3),max};};
 const variants=[];for(const v of ['dive','canyon','orbit','abyss']){
  const samples=[];for(const rel of [0,2.4,3.99,4.01,8,12,20,26]){const r=await snap(v+'-'+rel,rel,{variant:v});samples.push((({pixels,...rest})=>rest)(r));}
  const a=samples[2],b=samples[3];variants.push({variant:v,distanceAt4:Math.hypot(...a.camera.map((x,i)=>x-b.camera[i])),samples});
 }
 const foreground=[];for(const v of ['dive','canyon','orbit','abyss'])for(const rel of [4.12,12.12,20.12]){const on=await snap('foreground-on-'+v+'-'+rel,rel,{variant:v}),off=await snap('foreground-off-'+v+'-'+rel,rel,{variant:v,muted:true});foreground.push({variant:v,relative:rel,...diff(on,off)});}
 const seeks=[];for(const rel of [4,20,8,24,4,12])seeks.push(await snap('seek-'+seeks.length+'-'+rel,rel));
 const seekCompare=diff(seeks[0],seeks[4]);
 const longDrop=[];for(const v of ['dive','orbit'])for(const rel of [35,44,50,60]){const on=await snap('long-'+v+'-'+rel,rel,{long:true,variant:v}),off=await snap('long-no-rocks-'+v+'-'+rel,rel,{long:true,noRocks:true,variant:v});longDrop.push({variant:v,relative:rel,camera:on.camera,rockContribution:diff(on,off)});}
 const loop=[];for(const rel of [38/8,98/8,158/8]){const a=await snap('loop-before-'+rel.toFixed(4),rel-.005),b=await snap('loop-after-'+rel.toFixed(4),rel+.005),c=await snap('loop-control-'+rel.toFixed(4),rel-.015);loop.push({relative:rel,boundaryDifference:diff(a,b),controlDifference:diff(c,a),moved:a.scenery.flatMap((o,i)=>Math.abs(b.scenery[i].z-o.z)>100?[{index:i,from:o.z,to:b.scenery[i].z}]:[])});}
 await snap('lyrics4',4,{lyrics:true});await snap('lyrics12',12,{lyrics:true});
 const empty=await snap('empty-baseline',12,{empty:true}),snow=await snap('snow-only',12,{snowOnly:true}),snowDouble=await snap('snow-only-double',12,{snowOnly:true,doubleSnow:true});
 const snowContribution={front:diff(empty,snow),double:diff(empty,snowDouble)};
 const air=await snap('above-water-particles',0),airOff=await snap('above-water-no-particles',0,{noAtmosphere:true}),under=await snap('underwater-particles',4),underOff=await snap('underwater-no-particles',4,{noAtmosphere:true});const atmosphere={aboveWater:diff(air,airOff),underwater:diff(under,underOff)};
 const geometry=await page.evaluate(()=>{
  const {scene,api}=AUDIT,THREE=api.THREE;
  const out=[];
  for(const variant of ['dive','canyon','orbit','abyss'])for(let rel=0;rel<=26;rel+=.25){
   const t=AUDIT.drop.start+rel;scene.update({t,dt:1/24,music:AUDIT.music,lyrics:AUDIT.lyrics,palette:AUDIT.song.palette,shot:{...AUDIT.player.director.shots[0],variant},shotT:rel,aspect:AUDIT.player.engine.aspect,fx:{}});scene.scene.updateMatrixWorld(true);
   const cam=scene.camera.position,ray=new THREE.Raycaster(cam,new THREE.Vector3(.912381,.273643,.303754).normalize(),.001,200);
   let inside=[];
   for(let i=0;i<scene.recyclableScenery.length;i++){
    const obj=scene.recyclableScenery[i];if(obj.geometry.type==='PlaneGeometry')continue;
    const box=new THREE.Box3().setFromObject(obj);if(!box.containsPoint(cam))continue;
    const old=obj.material.side;obj.material.side=THREE.DoubleSide;
    const hits=ray.intersectObject(obj,false).filter((h,i,a)=>i===0||Math.abs(h.distance-a[i-1].distance)>1e-4);obj.material.side=old;
    if(hits.length%2===1)inside.push({index:i,distance:hits[0].distance,baseZ:obj.userData.baseZ,type:obj.geometry.type});
   }
   if(inside.length)out.push({variant,relative:rel,camera:cam.toArray(),inside});
  }
  return out;
 });

 const bubble=await page.evaluate(()=>{const a=AUDIT.scene.bubbleMesh.geometry.attributes.aSeed.array,speeds=[];for(let i=3;i<a.length;i+=4)speeds.push(1.6+a[i]*1.8);return{count:speeds.length,minRelativeRiseSpeed:Math.min(...speeds),maxRelativeRiseSpeed:Math.max(...speeds),meaning:'Unwrapped camera-relative upward velocity between invisible wrap resets; no kick displacement in current vertex shader.'};});
 for(const[f,h]of Object.entries(sourceHashes))assert.equal(hash(await fs.readFile(f)),h,'Source changed: '+f);
 const report={reviewOnly:true,sourceHashes,input:{audioPath,audioSha256:hash(audio),coverPath,coverSha256:hash(cover),lyricPath},prepared,variants,foreground,seekCompare,longDrop,loop,snowContribution,cameraInsideRock:geometry,bubble,atmosphere,errors,records:records.map(({pixels,...r})=>r),limits:['Fresh actual current local source in Edge GPU, actual local audio/cover/LRC.','Fixed bloom; echo/motion/film/grain and overlay/lyrics disabled unless marked for isolated body comparison.','65-second fixtures are forced continuity stress, not actual music sections.','Geometry camera samples use ray parity, visual review also performed.','Independent round3 focused results saved before separate continuous video probe.','Acceptance only: no production/plugin/config changes.']};
 await fs.writeFile(path.join(out,'independent-gpu-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({complete:true,records:records.length,foreground,seekCompare,longDrop,loop,snowContribution,cameraInsideSamples:geometry.length,bubble,atmosphere,errors}));

 // Separate core-scene continuous diagnostic, fixed postprocessing and no global/lyric overlays.
 const count=Math.ceil((prepared.drop.end-prepared.drop.start)*fps),videoPath=path.join(out,'第三轮-完整首个Drop-独立核心场景原声.mp4');
 encoder=spawn(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-ss',String(prepared.drop.start),'-i',audioPath,'-map','0:v:0','-map','1:a:0','-frames:v',String(count),'-t',String(count/fps),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',videoPath],{windowsHide:true,stdio:['pipe','ignore','pipe']});let stderr='';encoder.stderr.on('data',d=>stderr+=d);const ended=once(encoder,'close');const frames=[];
 // Lower recording resolution after high-resolution focused evidence is complete.
 await page.evaluate(()=>{const stage=document.getElementById('stage');stage.style.width='640px';stage.style.height='360px';AUDIT.player.engine.resize();});
 try{
  for(let i=0;i<count;i++){
   const f=await bounded(page.evaluate(t=>AUDIT.still(t),prepared.drop.start+i/fps),'continuous '+i);const bytes=Buffer.from(f.png,'base64');const record={t:f.t,relative:f.relative,camera:f.camera,waterLag:f.waterLag,bubbleLag:f.bubbleLag,sha256:hash(bytes)};frames.push(record);
   if(!encoder.stdin.write(bytes))await once(encoder.stdin,'drain');
   if(i%(fps*4)===0||i===count-1)await fs.writeFile(path.join(out,'continuous-'+(i/fps).toFixed(2)+'.png'),bytes);
   if(i%(fps*4)===0)console.log(JSON.stringify({continuous:i,total:count}));
  }
  encoder.stdin.end();assert.equal((await ended)[0],0,stderr);encoder=undefined;
  await fs.writeFile(path.join(out,'continuous-report.json'),JSON.stringify({status:'COMPLETE',sourceHashes,video:videoPath,frames,errors,mode:'Core scene exact update + fixed post; no global overlay/lyric presentation; audio is original local file slice.'},null,2));
  console.log(JSON.stringify({continuousComplete:true,frames:frames.length,video:videoPath}));
 }catch(e){await fs.writeFile(path.join(out,'continuous-report.json'),JSON.stringify({status:'INCOMPLETE',message:e.message,sourceHashes,framesCompleted:frames.length,mode:'Core scene probe; does not establish client playback failure.'},null,2));throw e;}

 await context.close();
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await vite.close();await new Promise(r=>server.close(r));}
