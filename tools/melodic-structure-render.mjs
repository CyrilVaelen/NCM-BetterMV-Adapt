import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { PROJECT, loadSettings, startServer } from '../exporter/server.mjs';
import { parseWiki } from '../src/meta/wiki.ts';
import { parseChorus } from '../src/plugin/source.ts';
const out=path.resolve(PROJECT,'../exports/Melodic-structure-20261018');
const metadata=JSON.parse(await fs.readFile(path.join(out,'love-metadata.json'),'utf8'));
const audioPath='D:/野葱视频转换器/音频转换/NURKO,Neriah - Love Is A Highway.mp3';
const lrcPath='D:/CloudMusic/VipSongsDownload/NURKO,Neriah - Love Is A Highway.lrc';
const [audio,cover,lrc]=await Promise.all([fs.readFile(audioPath),fs.readFile('plugin/preview.jpg'),fs.readFile(lrcPath,'utf8')]);
const settings=await loadSettings(), app=await startServer({settings:{...settings,port:5207,jobDir:path.join(out,'jobs'),outputDir:out}});
let browser; const errors=[];
try {
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:1});
  await context.route('**/*',async r=>{
    const u=new URL(r.request().url());
    if(u.origin!==app.baseUrl) return r.abort();
    if(u.pathname==='/probe-audio') return r.fulfill({body:audio,contentType:'audio/mpeg'});
    if(u.pathname==='/probe-cover') return r.fulfill({body:cover,contentType:'image/jpeg'});
    return r.continue();
  });
  await context.request.get(app.baseUrl+'/api/health',{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.baseUrl+'/tools/lead-preview.html');
  console.log('Preparing full song through the actual browser decoder, analysis and automatic director');
  const summary=await page.evaluate(async ({lrc,wiki,chorus})=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{loadFonts}]=await Promise.all([import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/src/render/text.ts')]);
    const cover=new Image();cover.src='/probe-cover';await cover.decode();
    const [audio]=await Promise.all([fetch('/probe-audio').then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const song=await prepareSong({id:2052331548,name:'Love Is A Highway',artists:['NURKO','Neriah'],audio,cover,lyric:{lrc:{lyric:lrc}},wiki,chorus},{pause:yieldToPage});
    const player=new MvPlayer(document.getElementById('stage'),1);player.hud.visible=false;
    player.load(song,styleFor(song,'pulse'),new Set(['menger','sierpinski','cantor']),undefined,undefined,0,2052331548);
    await player.warm(yieldToPage);
    window.PROBE={song,player,frame(t){
      for(let i=6;i>0;i--)player.frame(Math.max(0,t-i/30),1/30);
      const shot=player.frame(t,1/30),gl=player.engine.renderer.getContext();gl.finish();
      if(gl.isContextLost()) throw new Error('Lost WebGL context');
      return {t,scene:shot.scene,label:shot.section.label,start:shot.section.start,end:shot.section.end,png:player.engine.renderer.domElement.toDataURL('image/png').split(',')[1]};
    }};
    return {version:song.analysis.version,duration:song.duration,sections:song.analysis.sections,ms:song.ms,wiki,chorus,forcedScene:false};
  },{lrc,wiki:parseWiki(metadata.wiki),chorus:parseChorus(metadata.chorus,2052331548)});
  assert.equal(summary.version,5);
  const checks=[];
  for(const [t,label]of [[22,'pre'],[68,'build'],[133,'verse'],[148,'pre'],[100,'drop'],[195,'drop']]) {
    const {png,...frame}=await page.evaluate(t=>PROBE.frame(t),t);
    assert.equal(frame.label,label,JSON.stringify(frame));
    await fs.writeFile(path.join(out,`actual-${t}s-${label}.png`),Buffer.from(png,'base64'));checks.push(frame);console.log(JSON.stringify(frame));
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'render-verification.json'),JSON.stringify({audioPath,lrcPath,summary,checks,errors,host:'Headless Edge, actual prepareSong + MvPlayer; no forced scene or injected analysis',limit:'The running NetEase window was not driven'},null,2));
} finally {await browser?.close();await app.close();}
