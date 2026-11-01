import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { PROJECT, loadSettings, startServer } from '../exporter/server.mjs';

const out=path.resolve('../exports/Lights-Out-lead-priority-20261018');
const audioPath='D:/野葱视频转换器/音频转换/Blanke,RUNN - Lights Out.mp3';
const lyricPath='D:/CloudMusic/VipSongsDownload/Blanke,RUNN - Lights Out.lrc';
await fs.mkdir(out,{recursive:true});
const [audio,cover,lrc]=await Promise.all([fs.readFile(audioPath),fs.readFile('plugin/preview.jpg'),fs.readFile(lyricPath,'utf8')]);
const settings=await loadSettings(),app=await startServer({settings:{...settings,port:5209,jobDir:path.join(out,'jobs'),outputDir:out}});
let browser;
const errors=[];
try {
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:1});
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==app.baseUrl)return r.abort();if(u.pathname==='/lights-audio')return r.fulfill({body:audio,contentType:'audio/mpeg'});if(u.pathname==='/lights-cover')return r.fulfill({body:cover,contentType:'image/jpeg'});return r.continue();});
  await context.request.get(app.baseUrl+'/api/health',{headers:{'X-BetterMV-Token':settings.token}});
  const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(lyric=>{window.LIGHTS_LRC=lyric;},lrc);
  await page.goto(app.baseUrl+'/tools/lead-preview.html');
  const summary=await page.evaluate(async()=>{
    const [{prepareSong,styleFor,yieldToPage},{MvPlayer},{loadFonts},{Music}]=await Promise.all([import('/src/app/prepare.ts'),import('/src/app/player.ts'),import('/src/render/text.ts'),import('/src/director/music.ts')]);
    const image=new Image();image.src='/lights-cover';await image.decode();
    const [bytes]=await Promise.all([fetch('/lights-audio').then(r=>r.arrayBuffer()),loadFonts('/fonts/')]);
    const song=await prepareSong({id:0,name:'Lights Out',artists:['Blanke','RUNN'],audio:bytes,cover:image,lyric:{lrc:{lyric:window.LIGHTS_LRC}}},{pause:yieldToPage});
    const stage=document.createElement('div');stage.style.cssText='width:960px;height:540px;position:absolute;left:0;top:0';document.body.append(stage);
    const player=new MvPlayer(stage,1);player.hud.visible=false;const music=new Music(song.analysis),off=new Set(['menger','sierpinski','cantor']);
    const overlap=[67.933,202.433],dropSections=song.analysis.sections.filter(s=>s.label==='drop');
    const dropWindows=[];for(const s of dropSections){const last=dropWindows.at(-1);if(last&&Math.abs(last[1]-s.start)<.05)last[1]=s.end;else dropWindows.push([s.start,s.end]);}
    const priorityStats=dropWindows.map(([start,end])=>{const raw=music.hitsBetween('bassStab',start,end).filter(h=>h[1]>.2),kept=music.roleHits('bassStab',start,end).filter(h=>h[1]>.2);return {drop:[+start.toFixed(3),+end.toFixed(3)],bassEvents:raw.length,leadPrioritySuppressed:raw.length-kept.length,bassOnlyEvents:kept.length,leadEvents:music.roleHits('lead',start,end).filter(h=>h[1]>.2).length};});
    const bassOnly=dropWindows.flatMap(([start,end])=>music.roleHits('bassStab',start,end)).find(([t])=>{const r=music.timbreAt(t),lead=music.leadAt(t);return r.lead<.16||lead.brightness<.38;})?.[0];
    const checks=[];
    for(const scene of ['tunnel','drive']) {
      player.load(song,styleFor(song,'pulse'),off,{scene,variants:['push']},'none',0,20261018);
      await player.warm(yieldToPage);
      const times=[overlap[0]-.12,overlap[0],overlap[0]+.16,overlap[1]-.12,overlap[1],overlap[1]+.16,...(bassOnly?[bassOnly]:[])];
      for(const t of times) {
        for(let i=5;i>0;i--)player.frame(t-i/30,1/30);
        const shot=player.frame(t,1/30),gl=player.engine.renderer.getContext();gl.finish();if(gl.isContextLost())throw new Error('WebGL context lost');
        const png=player.engine.renderer.domElement.toDataURL('image/png').split(',')[1];
        checks.push({scene,t,variant:shot.variant,label:shot.section.label,foreground:music.foregroundAt(t),roles:music.timbreAt(t),bassEvents:music.roleHits('bassStab',t-.05,t+.05),leadEvents:music.roleHits('lead',t-.05,t+.05),kickPulse:music.pulse('kick',t,.08),png});
      }
    }
    return {version:song.analysis.version,duration:song.duration,bpm:song.analysis.bpm,sections:song.analysis.sections.map(s=>({start:+s.start.toFixed(3),end:+s.end.toFixed(3),label:s.label})),priorityStats,overlap,bassOnly,checks};
  });
  assert.equal(summary.version,6);
  assert.ok(summary.checks.some(c=>c.scene==='tunnel')&&summary.checks.some(c=>c.scene==='drive'));
  for(const scene of ['tunnel','drive'])for(const t of [67.933,202.433]) {
    const c=summary.checks.find(x=>x.scene===scene&&x.t===t);assert.ok(c,scene+' frame missing');
    assert.ok(c.foreground.level>0.15&&c.foreground.attack>0.2,scene+' did not respond to the lead');
    assert.equal(c.bassEvents.length,0,scene+' retained the competing bass accent');
    assert.ok(c.leadEvents.length>0,scene+' lost the lead event');
  }
  if(summary.bassOnly)for(const scene of ['tunnel','drive'])assert.ok(summary.checks.some(c=>c.scene===scene&&c.t===summary.bassOnly&&c.bassEvents.length>0),scene+' lost its bass-only response');
  const frames=summary.checks.map(({png,...frame})=>frame);
  for(const c of summary.checks)await fs.writeFile(path.join(out,`${c.scene}-${c.t.toFixed(3)}.png`),Buffer.from(c.png,'base64'));
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'render-verification.json'),JSON.stringify({summary:{version:summary.version,duration:summary.duration,bpm:summary.bpm,sections:summary.sections,priorityStats:summary.priorityStats,overlap:summary.overlap,bassOnly:summary.bassOnly},checks:frames,errors,sourceAudio:audioPath,sourceLrc:lyricPath,renderer:'Headless Edge, actual local Lights Out audio and LRC, forced tunnel and drive scenes'},null,2));
  console.log(JSON.stringify({version:summary.version,duration:summary.duration,bpm:summary.bpm,sections:summary.sections,priorityStats:summary.priorityStats,bassOnly:summary.bassOnly,frames:frames.map(c=>({scene:c.scene,t:c.t,level:+c.foreground.level.toFixed(3),attack:+c.foreground.attack.toFixed(3),bassEvents:c.bassEvents.length,leadEvents:c.leadEvents.length})),errors}));
} finally { await browser?.close(); await app.close(); }
