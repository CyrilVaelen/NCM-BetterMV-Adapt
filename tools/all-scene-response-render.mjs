// Actual-engine scene coverage. The OFF intervention removes foreground cues before scene construction;
// original PCM, drum envelopes, beat clock, section, seed and raw spectrum remain identical.
// Text plates receive an explicitly synthetic lyric fixture, never an altered lyric file.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { build, createServer } from 'vite';
import { chromium } from 'playwright-core';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.dirname(project);
const option=(key,fallback)=>process.argv.find(v=>v.startsWith('--'+key+'='))?.slice(key.length+3)??fallback;
const state=path.resolve(option('out',path.join(root,'state/all-scene-response-20261018/gpu')));
const work=path.join(project,'tools/.all-scene-response');
const audioPath=option('audio','D:/野葱视频转换器/音频转换/David Guetta,Avicii - Sunshine_1.mp3');
const coverPath=path.join(project,'plugin/preview.jpg');
const width=640,height=360,seed=20261018;
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=(name,value)=>fs.writeFile(path.join(state,name),JSON.stringify(value,null,2));
await fs.mkdir(state,{recursive:true});await fs.mkdir(work,{recursive:true});
async function manifest(dir,relative=''){
 const files=[];for(const item of await fs.readdir(dir,{withFileTypes:true})){
  const p=path.join(dir,item.name),r=relative?relative+'/'+item.name:item.name;
  if(item.isDirectory())files.push(...await manifest(p,r));
  else if(item.isFile()){const bytes=await fs.readFile(p);files.push({path:r,bytes:bytes.length,sha256:hash(bytes)});}
 }return files.sort((a,b)=>a.path.localeCompare(b.path));
}
const sources=await manifest(path.join(project,'src'));
await fs.writeFile(path.join(work,'entry.ts'),`export { MvPlayer } from '../../src/app/player.ts';\nexport { prepareSong, styleFor, yieldToPage } from '../../src/app/prepare.ts';\nexport { loadFonts } from '../../src/render/text.ts';\nexport { Music } from '../../src/director/music.ts';\nexport { LyricTrack } from '../../src/director/lyrics.ts';\nexport { defaultFx } from '../../src/render/engine.ts';\nexport { SCENES, LOOKS } from '../../src/scenes/catalog.ts';\nexport { STYLES } from '../../src/style/style.ts';\n`);
await build({configFile:false,root:project,publicDir:false,logLevel:'warn',define:{__VERSION__:JSON.stringify('all-scene-response-candidate')},build:{outDir:work,emptyOutDir:false,minify:false,lib:{entry:path.join(work,'entry.ts'),formats:['es'],fileName:()=> 'browser.mjs'}}});
assert.deepEqual(await manifest(path.join(project,'src')),sources,'Source changed during bundle build; rerun against frozen source');
const bundle={path:path.join(work,'browser.mjs'),sha256:hash(await fs.readFile(path.join(work,'browser.mjs'))),sourceSha256:hash(JSON.stringify(sources)),files:sources};
bundle.artifactPath=path.join(state,'browser.mjs');await fs.copyFile(bundle.path,bundle.artifactPath);assert.equal(hash(await fs.readFile(bundle.artifactPath)),bundle.sha256);
await json('source.json',bundle);
const [audio,cover]=await Promise.all([fs.readFile(audioPath),fs.readFile(coverPath)]);
const vite=await createServer({configFile:false,root:project,publicDir:path.join(project,'public'),logLevel:'warn',server:{middlewareMode:true,hmr:false,ws:false,fs:{strict:true,allow:[project]}}});
const server=http.createServer((req,res)=>{
 const respond=(type,body)=>{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);};
 if(req.url==='/coverage-audio')return respond('audio/mpeg',audio);
 if(req.url==='/coverage-cover')return respond('image/jpeg',cover);
 if(req.url==='/coverage')return respond('text/html',`<!doctype html><style>html,body{margin:0;background:#000;overflow:hidden}#stage{width:${width}px;height:${height}px}</style><div id="stage"></div>`);
 vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const results=[],errors=[];
try{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync']});
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const page=await context.newPage();page.setDefaultTimeout(240000);
 page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER',e.message);});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error('BROWSER',m.text());}});
 await page.goto(base+'/coverage');
 const prepared=await page.evaluate(async({seed})=>{
  const api=await import('/tools/.all-scene-response/browser.mjs');
  const image=new Image();image.src='/coverage-cover';await image.decode();
  const [audio]=await Promise.all([fetch('/coverage-audio').then(r=>r.arrayBuffer()),api.loadFonts('/fonts/')]);
  const song=await api.prepareSong({id:20261018,name:'Sunshine',artists:['David Guetta','Avicii'],audio,cover:image,lyric:null},{pause:api.yieldToPage});
  const originalLines=song.lines;
  const words=['MELODIC','KEYS','SHAPE','THE','LIGHT'];
  // This fixture only gives text plates visible type to animate. Audio analysis remains the original instrumental.
  const fixtureLines=Array.from({length:75},(_,i)=>{const start=i*4,end=start+3.8;return{start,end,text:words.join(' '),timedWords:true,words:words.map((text,j)=>({text:text+' ',start:start+j*.7,end:start+(j+1)*.7}))};});
  const player=new api.MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
  const referenceMusic=new api.Music(song.analysis);
  const candidateHits=referenceMusic.highlightHits(14,39).filter(h=>referenceMusic.foregroundAt(h[0]+.04).level>.2).sort((a,b)=>b[1]-a[1]);
  const anchorTimes=[];for(const h of candidateHits)if(anchorTimes.every(t=>Math.abs(t-h[0])>5)){anchorTimes.push(h[0]+.045);if(anchorTimes.length===3)break;}
  if(anchorTimes.length<3)anchorTimes.splice(0,anchorTimes.length,16.045,24.045,32.045);anchorTimes.sort((a,b)=>a-b);
  const times=anchorTimes.flatMap(t=>[t,t+1/24,t+2/24]);
  const variants={drive:'push',tunnel:'rush',rings:'front',ridges:'front',shatter:'wall',flip:'wave',align:'swing',kaleido:'petal',halftone:'in',particles:'hold',relief:'fly',diorama:'drift',bokeh:'focus',ink:'bloom',papercut:'bloom',vinyl:'top',clouds:'over',city:'horizon',aurora:'wide',pillars:'orbit',canvas:'high',rain:'pane',lanterns:'wide',ripple:'face',channel:'axis',orb:'wide',scope:'wave',menger:'glide',sierpinski:'glide',cantor:'glide',poster:'stack',typewall:'stack',neon:'walk',cards:'open',crystal:'orbit',subdivide:'ball',debug:'orbit'};
  const mini=document.createElement('canvas');mini.width=160;mini.height=90;const miniCtx=mini.getContext('2d',{willReadFrequently:true});
  // Numeric snapshots cover subject transforms, vertex/instance attributes and shader uniforms. UUIDs are excluded.
  const captureState=scene=>{
   const state={};let object=0;
   const samples=(key,array,count=array.length)=>{let sum=0,square=0,max=0;const step=Math.max(1,Math.floor(count/128));for(let i=0;i<count;i+=step){const v=array[i];if(Number.isFinite(v)){sum+=v;square+=v*v;max=Math.max(max,Math.abs(v));}}state[key+'.sum']=sum;state[key+'.square']=square;state[key+'.max']=max;};
   const vector=(key,value)=>{if(typeof value==='number'&&Number.isFinite(value))state[key]=value;else if(ArrayBuffer.isView(value))samples(key,value);else if(Array.isArray(value)){if(value.every(x=>typeof x==='number'))samples(key,value);else value.slice(0,128).forEach((v,i)=>vector(key+'.'+i,v));}else if(value?.toArray){const a=value.toArray();if(a.every(Number.isFinite))a.forEach((v,i)=>state[key+'.'+i]=v);}};
   const capture=o=>{const key='object'+object++;if(o.visible===false)return;vector(key+'.position',o.position);vector(key+'.scale',o.scale);vector(key+'.rotation',o.quaternion);
    if(o.geometry){const g=o.geometry;state[key+'.instances']=Number.isFinite(g.instanceCount)?g.instanceCount:g.attributes.position?.count??0;for(const [name,a]of Object.entries(g.attributes)){const count=Math.min(a.array.length,Number.isFinite(g.instanceCount)?g.instanceCount*a.itemSize:a.array.length);samples(key+'.geometry.'+name,a.array,count);}}
    const ms=Array.isArray(o.material)?o.material:[o.material];for(let j=0;j<ms.length;j++){const m=ms[j];if(!m)continue;vector(key+'.material'+j+'.color',m.color);vector(key+'.material'+j+'.opacity',m.opacity);for(const [name,u]of Object.entries(m.uniforms??{}))if(!u.value?.isTexture)vector(key+'.uniform.'+name,u.value);}
   };scene.scene.traverse(capture);for(const o of scene.offscreen??[])o.traverse(capture);
   vector('camera.position',scene.camera.position);vector('camera.rotation',scene.camera.quaternion);vector('camera.fov',scene.camera.fov);return state;
  };
  const accepted=['foreground','leadRole','synthStab','bassStab','keys','leads'];
  function mute(music){
   // Preserve leadFocus ownership used to downweight background drums; zero the cloned accepted cue arrays only.
   if(music.a.timbre){const v={...music.a.timbre};for(const[key,value]of Object.entries(v))if(key!=='hz'&&ArrayBuffer.isView(value))v[key]=new value.constructor(value.length);music.a={...music.a,timbre:v};}
   for(const kind of accepted){music.hitLists.set(kind,[]);music.hitTimes.set(kind,new Float64Array());}
   for(const name of ['foregroundAt','leadAt'])music[name]=()=>({level:0,attack:0,brightness:.5});
   for(const name of ['highlightHits','foregroundHits','roleHits'])if(typeof music[name]==='function')music[name]=()=>[];
   for(const name of ['foregroundMotion','foregroundSpeed'])if(typeof music[name]==='function')music[name]=()=>0;
   const pulse=music.pulse.bind(music);music.pulse=(kind,...args)=>accepted.includes(kind)?0:pulse(kind,...args);
   const hits=music.hitsBetween.bind(music);music.hitsBetween=(kind,...args)=>accepted.includes(kind)?[]:hits(kind,...args);
  }
  window.COVERAGE={api,song,player,referenceMusic,times,seed,variants,mini,miniCtx,fixtureLines,originalLines,onCache:[],scene:null,music:null,shot:null,
   async load(id,style,muted,look='none',lyrics=true,variant=variants[id]){
    song.lines=lyrics?fixtureLines:originalLines;
    player.load(song,api.styleFor(song,style),new Set(),{scene:id,variants:[variant]},'none',0,seed,(shots,music)=>{
     if(muted)mute(music);this.music=music;
     const section={start:10,end:45,label:'verse',energy:.72,group:0,vocal:lyrics};
     this.shot={scene:id,variant,start:10,end:45,section,sectionIndex:0,seed,look:undefined};return[this.shot];
    });
    player.director.overlay.scene.visible=false;this.scene=player.scenes[id];this.lyrics=new api.LyricTrack(song.lines);this.look=look;
    await player.warm(api.yieldToPage);
    return {scene:id,style,muted,look,lyrics,shot:this.shot};
   },
   frame(t,index,muted,save=true,captureImage=true){
    const fx=api.defaultFx(),ctx={t,dt:1/24,music:this.music,lyrics:this.lyrics,palette:song.palette,shot:this.shot,shotT:t-this.shot.start,aspect:player.engine.aspect,fx};
    this.scene.update(ctx);this.scene.keepUp?.(t,player.engine.renderer);
    // A fixed post chain prevents global director flashes from pretending that a static subject responds.
    const fixed=api.defaultFx();fixed.grain=0;fixed.film=0;fixed.aperture=0;fixed.motion=0;fixed.echo=0;fixed.bloom=.35;fixed.risoPositive=fx.risoPositive;
    if(this.look!=='none')fixed[this.look]=1;
    player.engine.render(this.scene.scene,this.scene.camera,fixed,t,null,undefined);
    const gl=player.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw new Error('WebGL context lost');const glError=gl.getError();if(glError!==gl.NO_ERROR)throw new Error('WebGL error '+glError);
    miniCtx.drawImage(player.engine.renderer.domElement,0,0,160,90);const pixels=new Uint8ClampedArray(miniCtx.getImageData(0,0,160,90).data),state=captureState(this.scene);
    const traces=[];this.scene.scene.traverse(o=>{const g=o.geometry;if(!g?.attributes.aSeg)return;const n=g.instanceCount;traces.push({segments:Float32Array.from(g.attributes.aSeg.array.subarray(0,n*4)),energy:Float32Array.from(g.attributes.aEnergy.array.subarray(0,n)),sigma:o.material.uniforms.uSigma.value});});
    let sum=0,square=0,lit=0;for(let i=0;i<pixels.length;i+=4){const l=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];sum+=l;square+=l*l;if(l>12)lit++;}
    const count=pixels.length/4,mean=sum/count,result={t,mean,standardDeviation:Math.sqrt(Math.max(0,square/count-mean*mean)),litFraction:lit/count,state,signal:referenceMusic.foregroundAt(t)};
    if(muted&&this.onCache[index]){
     const on=this.onCache[index];let abs=0,sq=0,changed=0;for(let i=0;i<pixels.length;i+=4)for(let j=0;j<3;j++){const d=pixels[i+j]-on.pixels[i+j];abs+=Math.abs(d);sq+=d*d;if(Math.abs(d)>2)changed++;}
     const differences=Object.keys({...state,...on.state}).map(key=>({key,delta:Math.abs((state[key]??0)-(on.state[key]??0))})).filter(x=>x.delta>1e-7).sort((a,b)=>b.delta-a.delta);
     result.control={pixelMAE:abs/(count*3),pixelRMSE:Math.sqrt(sq/(count*3)),changedChannelFraction:changed/(count*3),changedStateCount:differences.length,changedGeometry: differences.filter(x=>x.key.includes('.geometry.')).length,changedUniforms:differences.filter(x=>x.key.includes('.uniform.')).length,changedTransforms:differences.filter(x=>/position|rotation|scale|camera/.test(x.key)).length,largestStateDifferences:differences.slice(0,16)};
     if(traces.length)result.control.scopeTraces=traces.map((trace,i)=>{const a=on.traces[i];let segmentDifferences=0,energyDifferences=0,maxSegmentDifference=0;for(let j=0;j<Math.max(trace.segments.length,a?.segments.length??0);j++){const d=Math.abs((trace.segments[j]??Infinity)-(a?.segments[j]??-Infinity));if(d!==0){segmentDifferences++;maxSegmentDifference=Math.max(maxSegmentDifference,d);}}for(let j=0;j<Math.max(trace.energy.length,a?.energy.length??0);j++)if(trace.energy[j]!==a?.energy[j])energyDifferences++;return{segmentCount:trace.energy.length,segmentCoordinateDifferences:segmentDifferences,maxSegmentDifference,energyDifferences,sigmaDifference:Math.abs(trace.sigma-(a?.sigma??0))};});
    }else if(save)this.onCache[index]={pixels,state,traces};
    result.png=captureImage?player.engine.renderer.domElement.toDataURL('image/png').split(',')[1]:null;return result;
   }
  };
  const gl=player.engine.renderer.getContext(),dbg=gl.getExtension('WEBGL_debug_renderer_info');
  return {scenes:api.SCENES,looks:api.LOOKS,times,anchorTimes,analysisVersion:song.analysis.version,duration:song.duration,analysisMs:song.ms,renderer:{version:gl.getParameter(gl.VERSION),vendor:gl.getParameter(dbg?dbg.UNMASKED_VENDOR_WEBGL:gl.VENDOR),renderer:gl.getParameter(dbg?dbg.UNMASKED_RENDERER_WEBGL:gl.RENDERER)},fixture:'Actual Sunshine audio; synthetic timed lyrics for scene exercise; verse label, energy, shot clock and seed fixed; director overlay and effects disabled. Three successive frames at each of three musical anchors.'};
 },{seed});
 assert.equal(prepared.scenes.length,37,'Registered scene catalog changed; update expected coverage count');
 await json('inputs.json',{audioPath,audioSha256:hash(audio),audioBytes:audio.length,coverPath,coverSha256:hash(cover),coverBytes:cover.length,width,height,seed,...prepared});
 console.log(JSON.stringify({prepared:true,scenes:prepared.scenes.length,times:prepared.times,renderer:prepared.renderer}));
 const selected=option('scenes','all')==='all'?prepared.scenes:prepared.scenes.filter(s=>option('scenes','all').split(',').includes(s.id));
 const styles=option('styles','pulse,ballad').split(',');
 const cases=styles.flatMap(style=>selected.map(scene=>({scene,style,look:'none',lyrics:!process.argv.includes('--no-lyrics')})));
 if(!process.argv.includes('--no-extras')){
  for(const id of ['ridges','clouds','canvas'])cases.push({scene:prepared.scenes.find(s=>s.id===id),style:'ink',look:'none',lyrics:true});
  for(const id of ['poster','typewall','neon','lanterns','canvas','relief'])for(const style of ['pulse','ballad'])cases.push({scene:prepared.scenes.find(s=>s.id===id),style,look:'none',lyrics:false});
  for(const variant of ['xy','xy-near','xy-angle'])cases.push({scene:prepared.scenes.find(s=>s.id==='scope'),style:'pulse',look:'none',lyrics:true,variant});
 }
 if(!process.argv.includes('--no-looks'))for(const look of prepared.looks)for(const id of ['tunnel','diorama','poster','scope'])cases.push({scene:prepared.scenes.find(s=>s.id===id),style:'pulse',look:look.id,lyrics:true});
 for(const c of cases){
  const tag=c.style+'-'+c.scene.id+(c.look==='none'?'':'-'+c.look)+(c.lyrics?'':'-no-lyrics')+(c.variant?'-'+c.variant:''),record={scene:c.scene.id,name:c.scene.name,style:c.style,look:c.look,lyrics:c.lyrics,variant:c.variant,frames:{on:[],off:[]}};
  const pngs={on:[],off:[]};
  for(const muted of [false,true]){
   const mode=muted?'off':'on';record[mode+'Setup']=await page.evaluate(o=>COVERAGE.load(o.id,o.style,o.muted,o.look,o.lyrics,o.variant),{id:c.scene.id,style:c.style,muted,look:c.look,lyrics:c.lyrics,variant:c.variant});
   for(let i=0;i<prepared.times.length;i++){
    const captureImage=!process.argv.includes('--anchors-only')||i%3===0||i===prepared.times.length-1;
    const {png,...frame}=await page.evaluate(o=>COVERAGE.frame(o.t,o.i,o.muted,true,o.captureImage),{t:prepared.times[i],i,muted,captureImage});
    const file=png?path.join(state,`${tag}-${mode}-${i}.png`):null,bytes=png?Buffer.from(png,'base64'):null;if(bytes)await fs.writeFile(file,bytes);
    record.frames[mode].push({...frame,file,pngSha256:bytes?hash(bytes):null});pngs[mode].push(png);
   }
   // Repeat a time after a backwards seek; compare numeric subject state, separately from post history.
   await page.evaluate(t=>COVERAGE.frame(t,-1,true,false,false),prepared.times[0]);
   const last=prepared.times.length-1,repeated=await page.evaluate(t=>COVERAGE.frame(t,-1,true,false),prepared.times[last]);
   const original=record.frames[mode][last].state,diffs=Object.keys({...original,...repeated.state}).map(key=>({key,delta:Math.abs((original[key]??0)-(repeated.state[key]??0))})).filter(x=>x.delta>1e-7);
   const pixelMAE=await page.evaluate(async({a,b})=>{const c=document.createElement('canvas');c.width=160;c.height=90;const ctx=c.getContext('2d',{willReadFrequently:true}),arrays=[];for(const png of[a,b]){const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();ctx.drawImage(image,0,0,160,90);arrays.push(ctx.getImageData(0,0,160,90).data);}let sum=0;for(let i=0;i<arrays[0].length;i+=4)for(let j=0;j<3;j++)sum+=Math.abs(arrays[0][i+j]-arrays[1][i+j]);return sum/(160*90*3);},{a:pngs[mode][last],b:repeated.png});
   record[mode+'Seek']={sameTime:prepared.times[last],pixelMAE,changedNumericState:diffs.length,maxDifference:Math.max(0,...diffs.map(d=>d.delta)),differences:diffs.slice(0,12)};
  }
  record.meanPixelMAE=record.frames.off.reduce((s,f)=>s+f.control.pixelMAE,0)/prepared.times.length;
  record.subjectStatesDiffer=record.frames.off.every(f=>f.control.changedStateCount>0);
  record.visibleContribution=record.frames.off.every(f=>f.control.pixelMAE>.05);
  record.emptyOnFrames=record.frames.on.filter(f=>f.mean<3&&f.standardDeviation<2&&f.litFraction<.001).length;
  const strip=await page.evaluate(async({pngs,label,times})=>{
   const canvas=document.createElement('canvas');canvas.width=960;canvas.height=126;const ctx=canvas.getContext('2d');ctx.fillStyle='#121212';ctx.fillRect(0,0,960,126);ctx.fillStyle='#eee';ctx.font='14px "Microsoft YaHei", sans-serif';ctx.fillText(label,8,17);
   for(const [mode,row]of [['on',0],['off',1]])for(let i=0;i<3;i++){const n=i*3,image=new Image();image.src='data:image/png;base64,'+pngs[mode][n];await image.decode();const x=row*480+i*160;ctx.drawImage(image,x,24,160,90);ctx.fillText(`${mode.toUpperCase()} ${times[n].toFixed(2)}s`,x+4,124);}
   return canvas.toDataURL('image/png').split(',')[1];
  },{pngs,label:c.scene.name+' / '+tag,times:prepared.times});
  record.strip=path.join(state,tag+'-strip.png');await fs.writeFile(record.strip,Buffer.from(strip,'base64'));
  record.fullRecord=path.join(state,tag+'-frames.json');await fs.writeFile(record.fullRecord,JSON.stringify(record,null,2));
  const compact={...record,frames:Object.fromEntries(Object.entries(record.frames).map(([mode,frames])=>[mode,frames.map(({state,...frame})=>({...frame,numericStateSha256:hash(JSON.stringify(state))}))]))};
  results.push(compact);await json('progress.json',{bundle:bundle.sha256,completed:results.length,total:cases.length,results,errors});
  console.log(JSON.stringify({completed:tag,number:results.length,total:cases.length,meanPixelMAE:record.meanPixelMAE,visibleContribution:record.visibleContribution,subjectStatesDiffer:record.subjectStatesDiffer,emptyOnFrames:record.emptyOnFrames,seeks:[record.onSeek.changedNumericState,record.offSeek.changedNumericState]}));
 }
 const sheets=[];for(let i=0;i<results.length;i+=9){
  const part=results.slice(i,i+9),images=await Promise.all(part.map(r=>fs.readFile(r.strip).then(b=>b.toString('base64'))));
  const png=await page.evaluate(async(images)=>{const c=document.createElement('canvas');c.width=960;c.height=126*images.length;const ctx=c.getContext('2d');for(let i=0;i<images.length;i++){const im=new Image();im.src='data:image/png;base64,'+images[i];await im.decode();ctx.drawImage(im,0,i*126);}return c.toDataURL('image/png').split(',')[1];},images);
  const file=path.join(state,'contact-sheet-'+String(i/9+1).padStart(2,'0')+'.png');await fs.writeFile(file,Buffer.from(png,'base64'));sheets.push(file);
 }
 const failures=results.filter(r=>!r.visibleContribution||!r.subjectStatesDiffer||r.emptyOnFrames).map(r=>({scene:r.scene,style:r.style,look:r.look,meanPixelMAE:r.meanPixelMAE,subjectStatesDiffer:r.subjectStatesDiffer,emptyOnFrames:r.emptyOnFrames}));
 const report={finishedAt:new Date().toISOString(),bundle:bundle.sha256,sourceSha256:bundle.sourceSha256,registeredScenes:prepared.scenes.length,cases:results.length,totalFrames:results.length*prepared.times.length*2,passed:failures.length===0&&errors.length===0,failures,errors,sheets,results,limits:['Actual Edge WebGL scene render; scene frame update and engine are production code. Director overlay, transitions, global responsive effects, lens history and grain are disabled to isolate scene response.','ON/OFF is a causal rendering intervention, not independent instrument classification truth.','Same real audio, beat clock, env and raw spectrum for both modes. Accepted foreground timbre arrays, accepted events, foregroundAt/leadAt, foregroundMotion AND foregroundSpeed are removed before OFF scene construction. Original lead ownership remains for background-drum attenuation.','Text plates use a synthetic timed lyric fixture. This fixture is kept out of original song files and audio analysis.','Pulse and ballad styles have the same fixed verse label, energy, time, camera variant and seed. Postlook cases use the same isolated subjects.','A numeric state difference alone is insufficient; GPU pixels must also differ. Seek state differences are reported separately and require interpretation for deliberately accumulative Canvas state.']};
 await json('report.json',report);
 console.log(JSON.stringify({finished:true,passed:report.passed,cases:report.cases,totalFrames:report.totalFrames,failures,report:path.join(state,'report.json')}));
 await context.close();
}finally{await browser?.close();await vite.close();await new Promise(resolve=>server.close(resolve));}
