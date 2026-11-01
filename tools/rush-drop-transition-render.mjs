import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {build,createServer} from 'vite';
import {chromium} from 'playwright-core';
import ffmpeg from 'ffmpeg-static';

const project=process.cwd(),root=path.resolve(project,'..');
const state=path.join(root,'state/rush-drop-transition-20261021');
const out=path.join(root,'exports/Rush-drop-transition-20261021');
const audioPath='D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3';
const lrcPath='D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.lrc';
const coverPath=path.join(state,'embedded-cover.jpg');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const reuseBefore=process.argv.includes('--reuse-before'),renderedSourceHashes={};
for(const rel of ['src/director/director.ts','src/render/shots.ts','src/style/style.ts'])renderedSourceHashes[rel]=sha(await fs.readFile(path.join(project,rel)));
const statistics=rgb=>{
  const values=[];for(let i=0;i<rgb.length;i+=3)values.push(.2126*rgb[i]+.7152*rgb[i+1]+.0722*rgb[i+2]);
  const mean=values.reduce((a,b)=>a+b,0)/values.length,std=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);values.sort((a,b)=>a-b);
  return {mean,std,p05:values[Math.floor(values.length*.05)],p95:values[Math.floor(values.length*.95)],darkShare:values.filter(v=>v<8).length/values.length};
};
const [audio,lrc,cover,live]=await Promise.all([fs.readFile(audioPath),fs.readFile(lrcPath,'utf8'),fs.readFile(coverPath),fs.readFile(path.join(state,'live-.27.json'),'utf8').then(JSON.parse)]);
const bundles=path.join(state,'browser-bundles');await fs.mkdir(bundles,{recursive:true});
for(const side of ['before','after']){
  const source=side==='before'?path.join(state,'baseline/src'):path.join(project,'src');
  const spec=rel=>JSON.stringify(path.join(source,rel).replaceAll('\\','/'));
  const entry=path.join(state,`browser-${side}.ts`);
  await fs.writeFile(entry,`export {MvPlayer} from ${spec('app/player.ts')};\nexport {prepareSong,styleFor,yieldToPage} from ${spec('app/prepare.ts')};\nexport {loadFonts} from ${spec('render/text.ts')};\nexport {ShotPass,TransitionKind} from ${spec('render/shots.ts')};\nexport * as THREE from 'three';\n`);
  await build({configFile:false,root:project,publicDir:false,logLevel:'warn',resolve:{alias:[{find:'three/addons',replacement:path.join(project,'node_modules/three/examples/jsm')},{find:'three',replacement:path.join(project,'node_modules/three')}]},define:{__VERSION__:JSON.stringify(`drop-transition-${side}`)},build:{target:'chrome91',outDir:bundles,emptyOutDir:false,minify:false,lib:{entry,formats:['es'],fileName:()=>`${side}.mjs`}}});
}
const assets=new Map([
  ['/probe-audio',{bytes:audio,type:'audio/mpeg'}],['/probe-cover',{bytes:cover,type:'image/jpeg'}],
  ['/before.mjs',{bytes:await fs.readFile(path.join(bundles,'before.mjs')),type:'text/javascript'}],
  ['/after.mjs',{bytes:await fs.readFile(path.join(bundles,'after.mjs')),type:'text/javascript'}],
  ['/probe',{bytes:Buffer.from('<!doctype html><html><head><style>body{margin:0;background:#000}#stage{width:960px;height:540px}</style></head><body><div id="stage"></div></body></html>'),type:'text/html'}],
]);
const app=await createServer({configFile:false,root:project,server:{host:'127.0.0.1',port:5223,strictPort:true},plugins:[{name:'transition-local-assets',configureServer(server){server.middlewares.use((req,res,next)=>{const item=assets.get((req.url??'').split('?')[0]);if(!item)return next();res.setHeader('Content-Type',item.type);res.setHeader('Cache-Control','no-store');res.end(item.bytes);});}}]});
await app.listen();let context,encoder;const errors=[];
try{
  context=await chromium.launchPersistentContext(path.join(state,'edge-render-profile'),{channel:'msedge',headless:true,viewport:{width:960,height:540},deviceScaleFactor:1,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-crash-reporter','--disable-breakpad','--noerrdialogs']});
  await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5223'?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(240000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5223/probe');
  const prepared=await page.evaluate(async ({lrc,live})=>{
    const [before,after]=await Promise.all([import('/before.mjs'),import('/after.mjs')]);
    await Promise.all([before.loadFonts('/fonts/'),after.loadFonts('/fonts/')]);
    const cover=new Image();cover.src='/probe-cover';await cover.decode();
    const audio=await fetch('/probe-audio').then(r=>r.arrayBuffer());
    const song=await after.prepareSong({id:434659448,name:'Rush Over Me',artists:['Seven Lions','Said The Sky','ILLENIUM'],audio,cover,lyric:{lrc:{lyric:lrc}},wiki:{bpm:67,genres:[],tags:[]},chorus:[59.681,88.99]},{pause:after.yieldToPage});
    const freshSections=song.analysis.sections.map(s=>({...s}));
    // Use the user's confirmed .27 entry and its measured energies; the decoded local recording supplies all
    // unchanged envelope/beat/foreground data. This recreates that real section handoff without a forced scene.
    song.analysis.sections=live.analysis.sections.map((s,i)=>{const info=live.analysis.sectionTrace.finalLabels[i];return {...s,energy:info.e,group:i,vocal:info.cover>=.12};});
    const entry=song.analysis.sections.find(s=>s.label==='drop'&&s.start>180).start;
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d',{willReadFrequently:true});
    window.PROBE={before,after,song,entry,player:null,async use(side){this.player?.dispose();const api=this[side];this.player=new api.MvPlayer(document.getElementById('stage'),1);this.player.hud.visible=false;this.player.load({...song,cover:song.cover.clone()},api.styleFor(song,'pulse'),new Set(),undefined,undefined,0,0);await this.player.warm(api.yieldToPage);return this.player.shots.filter(s=>s.end>entry-.8&&s.start<entry+.8).map(s=>({start:s.start,end:s.end,scene:s.scene,variant:s.variant,label:s.section.label}));},frame(t,png=false){const p=this.player,frame=p.director.frame(t,1/60,p.engine.aspect);for(const scene of Object.values(p.scenes))scene?.keepUp?.(t,p.engine.renderer);p.engine.render(frame.scene.scene,frame.scene.camera,frame.fx,t,frame.transition,p.director.overlay);const gl=p.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw Error('WebGL context lost');ctx.drawImage(p.engine.renderer.domElement,0,0,160,90);const pixels=ctx.getImageData(0,0,160,90).data,values=[];for(let i=0;i<pixels.length;i+=4)values.push(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2]);const mean=values.reduce((a,b)=>a+b,0)/values.length,std=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);values.sort((a,b)=>a-b);return {t,scene:frame.shot.scene,label:frame.shot.section.label,fade:frame.fx.fade,impact:frame.fx.impact,transition:frame.transition?{kind:frame.transition.kind,progress:frame.transition.progress}:null,mean,std,p05:values[Math.floor(values.length*.05)],p95:values[Math.floor(values.length*.95)],darkShare:values.filter(v=>v<8).length/values.length,...(png?{png:p.engine.renderer.domElement.toDataURL('image/png').split(',')[1]}:{})};}};
    const gl=document.createElement('canvas').getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
    return {entry,freshSections,sections:song.analysis.sections,palette:song.palette.css,renderer:gl?(ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)):null};
  },{lrc,live});
  console.log(JSON.stringify({prepared:true,entry:prepared.entry,renderer:prepared.renderer}));
  const records={},plans={},clips={},fps=60,from=prepared.entry-.6,frames=72;
  for(const side of ['before','after']){
    plans[side]=await page.evaluate(side=>PROBE.use(side),side);
    if(side==='before'&&reuseBefore){
      clips.before=path.join(out,'Drop2-before.mp4');
      const decoded=spawnSync(ffmpeg,['-v','error','-i',clips.before,'-vf','scale=160:90','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,maxBuffer:16*1024*1024});
      assert.equal(decoded.status,0,decoded.stderr?.toString());const stride=160*90*3;
      assert.equal(decoded.stdout.length,frames*stride);records.before=[];
      for(let i=0;i<frames;i++){
        const metadata=await page.evaluate(t=>{const p=PROBE.player,f=p.director.frame(t,1/60,p.engine.aspect);return {t,scene:f.shot.scene,label:f.shot.section.label,fade:f.fx.fade,impact:f.fx.impact,transition:f.transition?{kind:f.transition.kind,progress:f.transition.progress}:null};},from+i/fps);
        records.before.push({...metadata,...statistics(decoded.stdout.subarray(i*stride,(i+1)*stride))});
      }
      console.log(JSON.stringify({side,reusedRenderedFrames:frames,source:'preserved frozen .27 video'}));continue;
    }
    for(let i=0;i<18;i++)await page.evaluate(t=>PROBE.frame(t),from-.3+i/fps);
    const output=path.join(out,`Drop2-${side}.mp4`);clips[side]=output;
    encoder=spawn(ffmpeg,['-v','error','-y','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-ss',String(from),'-i',audioPath,'-map','0:v:0','-map','1:a:0','-t',String(frames/fps),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let stderr='';encoder.stderr.on('data',d=>stderr+=d);const done=once(encoder,'close');records[side]=[];
    for(let i=0;i<frames;i++){
      const {png,...frame}=await page.evaluate(t=>PROBE.frame(t,true),from+i/fps);records[side].push(frame);
      const bytes=Buffer.from(png,'base64');if(!encoder.stdin.write(bytes))await once(encoder.stdin,'drain');
      if([9,27,31,35,36,37,39,45].includes(i))await fs.writeFile(path.join(out,`${side}-${i}-${frame.t.toFixed(5)}.png`),bytes);
      if(i%24===0)console.log(JSON.stringify({side,frame:i,t:frame.t,fade:frame.fade,impact:frame.impact,std:frame.std}));
    }
    encoder.stdin.end();assert.equal((await done)[0],0,stderr);encoder=null;
  }
  await fs.writeFile(path.join(out,'raw-verification.json'),JSON.stringify({prepared,plans,records,clips,renderedSourceHashes},null,2));
  assert.deepEqual(plans.after,plans.before,'shot boundaries, scene selection and variants must not change');
  assert.ok(records.before.some(f=>f.fade===1),'frozen .27 reproduces the full-frame blackout');
  assert.ok(records.after.every(f=>f.fade===0&&f.impact===0),'no blackout/impact frame remains');
  assert.ok(records.after.some(f=>f.t<prepared.entry&&f.transition?.kind===13),'incoming picture blends before the entry');
  const onBeat=records.after.find(f=>Math.abs(f.t-prepared.entry)<1e-7);assert.ok(onBeat&&onBeat.label==='drop'&&!onBeat.transition,'full Drop is shown exactly on its verified boundary');
  const flatDark=f=>f.mean<45&&f.std<3&&(f.p95-f.p05)<8;
  const summary={before:{blackoutFrames:records.before.filter(f=>f.fade===1).length,impactFrames:records.before.filter(f=>f.impact===1).length,flatDarkFrames:records.before.filter(flatDark).length},after:{blackoutFrames:records.after.filter(f=>f.fade===1).length,impactFrames:records.after.filter(f=>f.impact===1).length,flatDarkFrames:records.after.filter(flatDark).length,minStd:Math.min(...records.after.map(f=>f.std))}};
  assert.equal(summary.after.flatDarkFrames,0,'no near-flat dark image in the rendered handoff');assert.deepEqual(errors,[]);
  const comparison=path.join(out,'Drop2-before-after.mp4');
  const comparisonProcess=spawn(ffmpeg,['-v','error','-y','-i',clips.before,'-i',clips.after,'-filter_complex','[0:v][1:v]hstack=inputs=2[v]','-map','[v]','-map','1:a','-c:v','libx264','-crf','18','-c:a','copy','-movflags','+faststart',comparison],{windowsHide:true,stdio:'ignore'});assert.equal((await once(comparisonProcess,'close'))[0],0);
  const report={createdAt:new Date().toISOString(),input:{audioPath,audioSha256:sha(audio),lrcPath,lrcSha256:sha(lrc),coverPath,coverSource:'embedded artwork extracted from the original MP3'},renderedSourceHashes,prepared,plans,summary,records,clips,comparison,fps,frameCountPerSide:frames,errors,limits:['Actual local audio decode, album art and full automatic MvPlayer post chain in Edge WebGL; not a live NetEase window capture.','Visual comparison uses the .27 live section boundaries/energies and a fixed seed 0; the user random arrangement seed was not recorded.']};
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({summary,comparison,verification:path.join(out,'verification.json')}));
}finally{if(encoder?.exitCode===null)encoder.kill();await context?.close();await app.close();}
