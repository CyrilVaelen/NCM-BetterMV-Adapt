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
const project=process.cwd(),root=path.dirname(project),out=path.join(root,'exports/Underwater-review-20261019'),work=path.join(project,'tools/.underwater-audit-20261019');
const audioPath='D:/野葱视频转换器/音频转换/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).mp3';
const coverPath='D:/Temp/codex-clipboard-4b1a13bf-15ce-4cd3-8d23-59864ee7a8cd.png';
const lyricPath='D:/CloudMusic/VipSongsDownload/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).lrc';
const hash=b=>createHash('sha256').update(b).digest('hex'),width=640,height=360,fps=12,seed=20261019;
await fs.mkdir(out,{recursive:true});await fs.mkdir(work,{recursive:true});
const sourceFiles=['src/scenes/underwater.ts','src/scenes/catalog.ts','src/scenes/types.ts','src/app/player.ts','src/director/music.ts','src/director/director.ts','src/style/style.ts'];
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
  const api=await import('/tools/.underwater-audit-20261019/browser.mjs');const image=new Image();image.src='/cover';await image.decode();
  const [bytes]=await Promise.all([fetch('/audio').then(r=>r.arrayBuffer()),api.loadFonts('/fonts/')]);
  const song=await api.prepareSong({id:2026101901,name:'Underneath The Waves',artists:['Last Heroes','Monika Santucci'],audio:bytes,cover:image,lyric:{lrc:{lyric:lrc}}},{pause:api.yieldToPage});
  const player=new api.MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
  const drop=song.analysis.sections.find(s=>s.label==='drop');if(!drop)throw Error('No Drop estimated; do not invent one');
  window.AUDIT={api,song,player,drop,fps,seed,async load(variant='dive',isolate=true){
   player.load(song,api.styleFor(song,'pulse'),new Set(),{scene:'underwater',variants:[variant]},'none',0,seed,(shots,music)=>{this.music=music;return[{scene:'underwater',variant,start:drop.start,end:drop.end,section:drop,sectionIndex:song.analysis.sections.indexOf(drop),seed}];});
   this.scene=player.scenes.underwater;player.director.overlay.scene.visible=false;if(isolate)this.scene.rig.group.visible=false;await player.warm(api.yieldToPage);
  },frame(t){
   player.frame(t,1/fps);const s=this.scene,c=s.camera,gl=player.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw Error('WebGL lost');
   const mini=document.createElement('canvas');mini.width=160;mini.height=90;const ctx=mini.getContext('2d');ctx.drawImage(player.engine.renderer.domElement,0,0,160,90);const px=ctx.getImageData(0,0,160,90).data;let sum=0,bright=0;
   for(let i=0;i<px.length;i+=4){const l=.2126*px[i]+.7152*px[i+1]+.0722*px[i+2];sum+=l;if(l>64)bright++;}
   return {t,relative:t-drop.start,position:c.position.toArray(),quaternion:c.quaternion.toArray(),waterPosition:s.waterUniforms.uCamPos.value.toArray(),bubblePosition:s.bubbleUniforms.uCamPos.value.toArray(),bubbleBurst:s.bubbleUniforms.uBurst.value,waterLag:c.position.distanceTo(s.waterUniforms.uCamPos.value),bubbleLag:c.position.distanceTo(s.bubbleUniforms.uCamPos.value),lead:this.music.leadAt(t),foreground:this.music.foregroundAt(t),kick:this.music.pulse('kick',t,.45),leadOwnership:this.music.leadOwnership(t),uLeadGlow:s.pillarUniforms.uLeadGlow.value,uKickPulse:s.pillarUniforms.uKickPulse.value,pixels:{mean:sum/(px.length/4),brightFraction:bright/(px.length/4)},png:player.engine.renderer.domElement.toDataURL('image/png').split(',')[1]};
  }};
  await AUDIT.load();const bounds=[];AUDIT.scene.pillarsGroup.children.forEach(o=>{o.geometry.computeBoundingBox();o.updateMatrixWorld(true);const b=o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);bounds.push({min:b.min.toArray(),max:b.max.toArray()});});
  const gl=player.engine.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  return {duration:song.duration,bpm:song.analysis.bpm,sections:song.analysis.sections,drop,pillarBounds:bounds,renderer:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER)};
 },{lrc,seed,fps});
 console.log(JSON.stringify({prepared:true,drop:prepared.drop,duration:prepared.duration,renderer:prepared.renderer}));
 const count=Math.ceil((prepared.drop.end-prepared.drop.start)*fps),video=path.join(out,'水下石柱-完整首个Drop-原声.mp4');
 encoder=spawn(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-ss',String(prepared.drop.start),'-i',audioPath,'-map','0:v:0','-map','1:a:0','-frames:v',String(count),'-t',String(count/fps),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',video],{windowsHide:true,stdio:['pipe','ignore','pipe']});let stderr='';encoder.stderr.on('data',d=>stderr+=d);const ended=once(encoder,'close');const frames=[],stills=[];
 for(let i=0;i<count;i++){
  const{png,...f}=await page.evaluate(t=>AUDIT.frame(t),prepared.drop.start+i/fps);const bytes=Buffer.from(png,'base64');frames.push(f);if(!encoder.stdin.write(bytes))await once(encoder.stdin,'drain');
  if(i%(fps*4)===0||i===count-1||i===Math.round(1.2*fps)||i===Math.round(2.4*fps)){const file=path.join(out,'dive-'+f.relative.toFixed(2)+'.png');await fs.writeFile(file,bytes);stills.push({t:f.t,relative:f.relative,file});}
  if(i%(fps*8)===0)console.log(JSON.stringify({frames:i,total:count,time:f.t}));
 }
 encoder.stdin.end();assert.equal((await ended)[0],0,stderr);encoder=undefined;
 const variants=[];for(const variant of ['dive','canyon','orbit','abyss']){
  await page.evaluate(v=>AUDIT.load(v),variant);const sample=[];
  for(const rel of [0,2.4,3.99,4.01,8,12,20])if(prepared.drop.start+rel<prepared.drop.end){const{png,...f}=await page.evaluate(t=>AUDIT.frame(t),prepared.drop.start+rel);const file=path.join(out,variant+'-audit-'+rel.toFixed(2)+'.png');await fs.writeFile(file,Buffer.from(png,'base64'));sample.push({...f,file});}
  const a=sample.find(f=>f.relative>3.98&&f.relative<4),b=sample.find(f=>f.relative>4&&f.relative<4.02);variants.push({variant,sample,cameraDistanceAt4s:a&&b?Math.hypot(...a.position.map((v,i)=>v-b.position[i])):null});
 }
 const target=frames.find(f=>f.bubbleBurst>.2&&f.kick<.6),seek=[];if(target){await page.evaluate(()=>AUDIT.load('dive'));const{png,...direct}=await page.evaluate(t=>AUDIT.frame(t),target.t);seek.push({t:target.t,sequential:target,direct});await fs.writeFile(path.join(out,'direct-seek.png'),Buffer.from(png,'base64'));}
 const selected=stills.filter(s=>s.relative===0||s.relative>=4).slice(0,10),sheet=await page.evaluate(async({items})=>{const canvas=document.createElement('canvas');canvas.width=960;canvas.height=Math.ceil(items.length/3)*206;const ctx=canvas.getContext('2d');ctx.fillStyle='#101820';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.font='15px sans-serif';ctx.fillStyle='white';for(let i=0;i<items.length;i++){const im=new Image();im.src='data:image/png;base64,'+items[i].png;await im.decode();const x=i%3*320,y=Math.floor(i/3)*206;ctx.drawImage(im,x,y,320,180);ctx.fillText('Drop +'+items[i].relative.toFixed(2)+'s',x+8,y+200);}return canvas.toDataURL('image/png').split(',')[1];},{items:await Promise.all(selected.map(async s=>({relative:s.relative,png:(await fs.readFile(s.file)).toString('base64')})))});await fs.writeFile(path.join(out,'完整Drop时序.png'),Buffer.from(sheet,'base64'));
 for(const[f,h]of Object.entries(sourceHashes))assert.equal(hash(await fs.readFile(f)),h,'Production source changed during audit: '+f);
 const report={reviewOnly:true,sourceHashes,audio:{path:audioPath,sha256:hash(audio),bytes:audio.length},cover:{path:coverPath,sha256:hash(cover)},lyrics:{path:lyricPath,sha256:hash(Buffer.from(lrc))},...prepared,video,frames,stills,variants,seek,errors,limits:['Current local source rendered in Edge, no production/plugin/config edits or installation.','Attached album art and actual local MP3/LRC used; scene forced for isolated inspection, overlay and lyric presentation hidden.','Automatic section labels are estimates; musical roles are model diagnostics, not independent instrument truth.']};await fs.writeFile(path.join(out,'review.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({complete:true,frames:frames.length,errors,video,report:path.join(out,'review.json'),variantJumps:variants.map(v=>({variant:v.variant,distanceAt4:v.cameraDistanceAt4s}))}));
 await context.close();
}finally{if(encoder?.exitCode===null)encoder.kill();await browser?.close();await vite.close();await new Promise(r=>server.close(r));}
