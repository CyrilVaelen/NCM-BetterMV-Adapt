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
const project=process.cwd(),root=path.dirname(project),out=path.join(root,'exports/Underwater-acceptance-20261019/focused'),work=path.join(project,'tools/.underwater-acceptance-focused-20261019');
const audioPath='D:/野葱视频转换器/音频转换/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).mp3';
const coverPath='D:/Temp/codex-clipboard-4b1a13bf-15ce-4cd3-8d23-59864ee7a8cd.png';
const lyricPath='D:/CloudMusic/VipSongsDownload/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).lrc';
const hash=b=>createHash('sha256').update(b).digest('hex'),width=640,height=360,fps=12,seed=20261019;
await fs.mkdir(out,{recursive:true});await fs.mkdir(work,{recursive:true});
const sourceFiles=['src/render/engine.ts','src/scenes/lyricRig.ts','src/scenes/underwater.ts','src/scenes/catalog.ts','src/scenes/types.ts','src/app/player.ts','src/director/music.ts','src/director/director.ts','src/style/style.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,hash(await fs.readFile(f))])));
await fs.writeFile(path.join(work,'entry.ts'),`export {MvPlayer} from '../../src/app/player.ts';\nexport {prepareSong,styleFor,yieldToPage} from '../../src/app/prepare.ts';\nexport {loadFonts} from '../../src/render/text.ts';\n`);
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
  const api=await import('/tools/.underwater-acceptance-focused-20261019/browser.mjs');const image=new Image();image.src='/cover';await image.decode();
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
   const hidden=[];if(options.snowOnly)for(const child of scene.scene.children)if(child!==scene.marineSnowMesh&&child.visible){child.visible=false;hidden.push(child);}
   if(options.noRocks)scene.sceneryGroup.visible=false;
   const snowSide=scene.marineSnowMesh.material.side;
   if(options.doubleSnow){scene.marineSnowMesh.material.side=2;scene.marineSnowMesh.material.needsUpdate=true;}
   const fixed=defaultFx();fixed.grain=0;fixed.film=0;fixed.echo=0;fixed.motion=0;fixed.aperture=0;fixed.bloom=.35;
   this.player.engine.render(scene.scene,scene.camera,fixed,t,null,null);const gl=this.player.engine.renderer.getContext();gl.finish();
   const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');ctx.drawImage(this.player.engine.renderer.domElement,0,0,160,90);
   const pixels=Array.from(ctx.getImageData(0,0,160,90).data),result={t,relative:t-this.drop.start,options,camera:scene.camera.position.toArray(),quaternion:scene.camera.quaternion.toArray(),waterLag:scene.camera.position.distanceTo(scene.waterUniforms.uCamPos.value),bubbleLag:scene.camera.position.distanceTo(scene.bubbleUniforms.uCamPos.value),burst:scene.bubbleUniforms.uBurst.value,foreground:music.foregroundAt(t),pixels,png:this.player.engine.renderer.domElement.toDataURL('image/png').split(',')[1]};
   for(const child of hidden)child.visible=true;if(options.noRocks)scene.sceneryGroup.visible=true;
   if(options.doubleSnow){scene.marineSnowMesh.material.side=snowSide;scene.marineSnowMesh.material.needsUpdate=true;}
   music.foregroundAt=this.originalForeground;return result;
  };
 });
 const records=[];
 async function snap(label,relative,options={}){const{png,pixels,...record}=await Promise.race([page.evaluate(o=>AUDIT.still(o.t,o.options),{t:prepared.drop.start+relative,options}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Focused frame timeout: '+label)),45000))]);const file=path.join(out,label+'.png');await fs.writeFile(file,Buffer.from(png,'base64'));const result={...record,file,pngSha256:hash(Buffer.from(png,'base64')),pixels};records.push(result);console.log(JSON.stringify({case:label,relative,waterLag:result.waterLag}));return result;}
 const diff=(left,right)=>{let sum=0,changed=0;for(let i=0;i<left.pixels.length;i+=4)for(let c=0;c<3;c++){const d=Math.abs(left.pixels[i+c]-right.pixels[i+c]);sum+=d;if(d>2)changed++;}return{pixelMAE:sum/(160*90*3),changedChannelFraction:changed/(160*90*3)};};
 const variants=[];for(const v of ['dive','canyon','orbit','abyss']){const a=await snap(v+'-before4',3.99,{variant:v}),b=await snap(v+'-after4',4.01,{variant:v});variants.push({variant:v,distance:Math.hypot(...a.camera.map((x,i)=>x-b.camera[i])),a:a.camera,b:b.camera,quaternion:b.quaternion});}
 const foreground=[];for(const rel of [4.12,12.12,20.12]){const on=await snap('foreground-on-'+rel,rel),off=await snap('foreground-off-'+rel,rel,{muted:true});foreground.push({relative:rel,...diff(on,off)});}
 const seeks=[];for(const rel of [4,20,8,24,4,12])seeks.push(await snap('seek-'+seeks.length+'-'+rel,rel));
 const seekCompare=diff(seeks[0],seeks[4]);
 const longDrop=[];for(const rel of [35,44,50,60]){const on=await snap('long-drop-'+rel,rel,{long:true}),off=await snap('long-drop-no-rocks-'+rel,rel,{long:true,noRocks:true});longDrop.push({relative:rel,camera:on.camera,rockContribution:diff(on,off)});}
 await snap('lyrics4',4,{lyrics:true});await snap('lyrics12',12,{lyrics:true});
 const normalSnow=await snap('snow-only-front',12,{snowOnly:true}),doubleSnow=await snap('snow-only-double',12,{snowOnly:true,doubleSnow:true});
 const bubbleVelocity=await page.evaluate(()=>{const dt=1/240;let negativeSteps=0,minVelocity=Infinity,example=null;for(let t=AUDIT.drop.start;t<AUDIT.drop.end-dt;t+=dt){const a=AUDIT.music.pulse('kick',t,.22),b=AUDIT.music.pulse('kick',t+dt,.22),velocity=1.6+0.25*1.8;if(velocity<0){negativeSteps++;if(velocity<minVelocity){minVelocity=velocity;example={t,burst:a,nextBurst:b,velocity};}}}return{testedSeedScale:.25,baseRiseSpeed:2.05,step:dt,negativeSteps,minVelocity:Number.isFinite(minVelocity)?minVelocity:null,example};});
 for(const[f,h]of Object.entries(sourceHashes))assert.equal(hash(await fs.readFile(f)),h,'Source changed: '+f);
 const report={reviewOnly:true,sourceHashes,input:{audioPath,audioSha256:hash(audio),coverPath,coverSha256:hash(cover),lyricPath},prepared,variants,foreground,seekCompare,longDrop,snowSideDifference:diff(normalSnow,doubleSnow),bubbleVelocity,errors,records:records.map(({pixels,...r})=>r),limits:['Fresh single-scene Edge GPU checks, global echo/motion/grain/finish and lyric overlay disabled for deterministic subject comparison.','Long Drop checks are a forced 65-second continuity stress fixture, not a relabeling of the song.','Double-sided snow is a diagnostic in-memory intervention only; production source unchanged.','No plugin installation or production edits performed.']};
 await fs.writeFile(path.join(out,'focused-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({complete:true,records:records.length,variants,foreground,seekCompare,longDrop,snowSideDifference:report.snowSideDifference,bubbleVelocity,errors}));
 await context.close();
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await vite.close();await new Promise(r=>server.close(r));}
