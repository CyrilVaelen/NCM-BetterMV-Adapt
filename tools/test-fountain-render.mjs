// 花坛喷泉 (fountain) 真机 WebGL2 / D3D11 渲染与视觉核验脚本：
// 覆盖 4 组电影机位 (courtyard / orbit / skim / crown)、粉/暖/冷深三套不同明暗色相专辑封面自适应、
// 主歌静谧涌泉 vs Drop 三阶音乐水舞全开对比、池底圆形琉璃封面水波折射、下部歌词排版以及 42 场景设置面板 UI 核验。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import { loadSettings, startServer } from '../exporter/server.mjs';

const outDir = path.resolve('../exports/fountain-courtyard-20261101');
await fs.mkdir(outDir, { recursive: true });

const warmCoverPath = 'D:/NCM/BetterNCM/export-jobs/4a56e06f-1647-4204-b5d5-825e2ca9d643/cover.image';
const coolCoverPath = 'D:/NCM/BetterNCM/export-jobs/04a52732-bdae-438f-ab04-f9723c197ff8/cover.image';
const pinkCoverPath = 'D:/NCM/BetterNCM/export-jobs/2b89aae0-228f-48b3-b38a-5110e2184e89/cover.image';
const vocalAudioPath = 'D:/CloudMusic/LIONE,The Chainsmokers,Halsey - Closer (LIONE Remix).mp3';
const vocalLrcPath = 'D:/CloudMusic/LIONE,The Chainsmokers,Halsey - Closer (LIONE Remix).lrc';

console.log('读取旋律电音人声曲目、LRC 歌词与粉/暖/冷三套专辑封面...');
const [warmCoverBuf, coolCoverBuf, pinkCoverBuf, vocalAudioBuf, vocalLrcText] = await Promise.all([
  fs.readFile(warmCoverPath),
  fs.readFile(coolCoverPath),
  fs.readFile(pinkCoverPath),
  fs.readFile(vocalAudioPath),
  fs.readFile(vocalLrcPath, 'utf8'),
]);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5246,
    jobDir: path.join(outDir, 'jobs'),
    outputDir: outDir,
  },
});

let browser;
const errors = [];

try {
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: [
      '--use-angle=d3d11',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/warm-cover') return r.fulfill({ body: warmCoverBuf, contentType: 'image/jpeg' });
    if (u.pathname === '/cool-cover') return r.fulfill({ body: coolCoverBuf, contentType: 'image/jpeg' });
    if (u.pathname === '/pink-cover') return r.fulfill({ body: pinkCoverBuf, contentType: 'image/jpeg' });
    if (u.pathname === '/vocal-audio') return r.fulfill({ body: vocalAudioBuf, contentType: 'audio/mpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  page.on('pageerror', e => {
    errors.push(e.message);
    console.error('[PAGEERROR]', e.message);
  });
  page.on('console', m => {
    if (m.type() === 'error' || (m.type() === 'warning' && /THREE\.WebGLProgram|Shader Error/i.test(m.text()))) {
      errors.push(m.text());
      console.error('[CONSOLE]', m.text());
    }
  });

  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  console.log('正在分析 Closer (LIONE Remix) 并初始化 FountainScene (花坛喷泉)...');
  const meta = await page.evaluate(async lrc => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }, { extractCoverTone }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
      import('/src/scenes/coverTone.ts'),
    ]);

    const loadImg = async src => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return img;
    };

    const [pinkCover, warmCover, coolCover, vocalAudio] = await Promise.all([
      loadImg('/pink-cover'),
      loadImg('/warm-cover'),
      loadImg('/cool-cover'),
      fetch('/vocal-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const pinkSong = await prepareSong({
      id: 20261101,
      name: 'Closer (LIONE Remix)',
      artists: ['The Chainsmokers', 'Halsey', 'LIONE'],
      audio: vocalAudio,
      cover: pinkCover,
      lyric: { lrc: { lyric: lrc } },
      wiki: { genres: ['电子-未来贝斯'], tags: ['梦幻', '浪漫'] },
    }, { pause: yieldToPage });

    const warmSong = await prepareSong({
      id: 20261102,
      name: 'Golden Courtyard Sunset',
      artists: ['Avicii'],
      audio: vocalAudio,
      cover: warmCover,
      lyric: { lrc: { lyric: lrc } },
      wiki: { genres: ['电子-渐进浩室'], tags: ['温暖', '大气'] },
    }, {
      pause: yieldToPage,
      analysis: async () => pinkSong.analysis,
    });

    const coolSong = await prepareSong({
      id: 20261103,
      name: 'Starlit Sapphire Basin',
      artists: ['Blue Eternal'],
      audio: vocalAudio,
      cover: coolCover,
      lyric: { lrc: { lyric: lrc } },
      wiki: { genres: ['电子-未来贝斯'], tags: ['空灵', '星辰'] },
    }, {
      pause: yieldToPage,
      analysis: async () => pinkSong.analysis,
    });

    const stage = document.createElement('div');
    stage.style.cssText = 'width:1280px;height:720px;position:absolute;left:0;top:0;overflow:hidden;background:#000';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;

    const secs = pinkSong.analysis.sections;
    const dropSec = secs.find(s => s.label === 'drop') ?? secs.find(s => s.label === 'chorus') ?? secs[Math.floor(secs.length / 2)];
    const calmSec = secs.find(s => s.label === 'verse' || s.label === 'intro') ?? secs[0];

    const dropTarget = dropSec.start + (dropSec.end - dropSec.start) * 0.28;
    const dropKick = pinkSong.analysis.hits.kick.find(h => h[0] >= dropTarget && h[1] > 0.4)?.[0] ?? dropTarget;
    const sungLine = pinkSong.lines.find(l => l.start > 22 && l.text.trim().length > 8) ?? pinkSong.lines[2];
    const lyricT = (sungLine.start + sungLine.end) * 0.5;
    const calmT = calmSec.start + (calmSec.end - calmSec.start) * 0.45;

    window.FOUNTAIN_TEST = {
      player,
      pinkSong,
      warmSong,
      coolSong,
      styleFor,
      yieldToPage,
      async loadFountain(songObj, variant, showLyrics = false) {
        player.load(
          songObj,
          styleFor(songObj, 'pulse'),
          new Set(['cards', 'crystal', 'canvas']),
          { scene: 'fountain', variants: [variant] },
          'none',
          0,
          20261101,
          undefined,
          showLyrics,
        );
        await player.warm(yieldToPage);
      },
      renderPng(t, hideOverlay = true) {
        const prevOverlay = player.director.overlay.scene.visible;
        if (hideOverlay) player.director.overlay.scene.visible = false;
        player.frame(t - 1 / 30, 1 / 30);
        player.frame(t, 1 / 30);
        const gl = player.engine.renderer.getContext();
        gl.finish();
        const b64 = player.engine.renderer.domElement.toDataURL('image/png').split(',')[1];
        const fsScene = player.scenes.fountain;
        const uniforms = fsScene ? {
          coverMood: +fsScene.uniforms.uCoverMood.value.toFixed(3),
          centerSurge: +fsScene.uniforms.uCenterSurge.value.toFixed(3),
          sectionEnergy: +fsScene.uniforms.uSectionEnergy.value.toFixed(3),
          kickPunch: +fsScene.uniforms.uKickPunch.value.toFixed(3),
          hatSparkle: +fsScene.uniforms.uHatSparkle.value.toFixed(3),
        } : null;
        player.director.overlay.scene.visible = prevOverlay;
        return { b64, lost: player.engine.isContextLost(), uniforms };
      },
    };

    return {
      bpm: pinkSong.analysis.bpm,
      dropKick: +dropKick.toFixed(3),
      lyricT: +lyricT.toFixed(3),
      calmT: +calmT.toFixed(3),
      pinkHue: +extractCoverTone(pinkSong).mainHue.toFixed(1),
      warmHue: +extractCoverTone(warmSong).mainHue.toFixed(1),
      coolHue: +extractCoverTone(coolSong).mainHue.toFixed(1),
    };
  }, vocalLrcText);

  console.log('曲目与封面色相分析结果:', JSON.stringify(meta, null, 2));

  // 1. 粉色明亮封面 Drop 高潮：courtyard 主视角
  await page.evaluate(() => window.FOUNTAIN_TEST.loadFountain(window.FOUNTAIN_TEST.pinkSong, 'courtyard', false));
  const rPinkCourtyard = await page.evaluate(t => window.FOUNTAIN_TEST.renderPng(t, true), meta.dropKick + 0.08);
  assert.equal(rPinkCourtyard.lost, false);
  const pinkCourtyardPath = path.join(outDir, '01_fountain_pink_courtyard_drop.png');
  await fs.writeFile(pinkCourtyardPath, Buffer.from(rPinkCourtyard.b64, 'base64'));
  console.log('01_pink_courtyard uniforms:', JSON.stringify(rPinkCourtyard.uniforms));

  // 2. 粉色封面 + 逐字歌词：orbit 环池巡游视角
  await page.evaluate(() => window.FOUNTAIN_TEST.loadFountain(window.FOUNTAIN_TEST.pinkSong, 'orbit', true));
  const rPinkOrbitLyrics = await page.evaluate(t => window.FOUNTAIN_TEST.renderPng(t, false), meta.lyricT);
  await fs.writeFile(path.join(outDir, '02_fountain_pink_orbit_lyrics.png'), Buffer.from(rPinkOrbitLyrics.b64, 'base64'));
  console.log('02_pink_orbit_lyrics uniforms:', JSON.stringify(rPinkOrbitLyrics.uniforms));

  // 3. 粉色封面：crown 高机位花冠俯瞰（检验池底圆形琉璃封面清晰折射与 12 音阶放射水拱）
  await page.evaluate(() => window.FOUNTAIN_TEST.loadFountain(window.FOUNTAIN_TEST.pinkSong, 'crown', false));
  const rPinkCrown = await page.evaluate(t => window.FOUNTAIN_TEST.renderPng(t, true), meta.dropKick + 0.16);
  await fs.writeFile(path.join(outDir, '03_fountain_pink_crown_medallion.png'), Buffer.from(rPinkCrown.b64, 'base64'));
  console.log('03_pink_crown uniforms:', JSON.stringify(rPinkCrown.uniforms));

  // 4. 暖金封面：skim 低角度掠水穿拱视角（同时可作预览候选）
  await page.evaluate(() => window.FOUNTAIN_TEST.loadFountain(window.FOUNTAIN_TEST.warmSong, 'skim', false));
  const rWarmSkim = await page.evaluate(t => window.FOUNTAIN_TEST.renderPng(t, true), meta.dropKick + 0.12);
  await fs.writeFile(path.join(outDir, '04_fountain_warm_skim_arches.png'), Buffer.from(rWarmSkim.b64, 'base64'));
  console.log('04_warm_skim uniforms:', JSON.stringify(rWarmSkim.uniforms));

  // 5. 暖金封面：courtyard 主视角（生成暖色预览候选）
  await page.evaluate(() => window.FOUNTAIN_TEST.loadFountain(window.FOUNTAIN_TEST.warmSong, 'courtyard', false));
  const rWarmCourtyard = await page.evaluate(t => window.FOUNTAIN_TEST.renderPng(t, true), meta.dropKick + 0.10);
  const warmCourtyardPath = path.join(outDir, '05_fountain_warm_courtyard.png');
  await fs.writeFile(warmCourtyardPath, Buffer.from(rWarmCourtyard.b64, 'base64'));
  console.log('05_warm_courtyard uniforms:', JSON.stringify(rWarmCourtyard.uniforms));

  // 6. 深蓝冷色暗调封面：orbit 星夜荧光喷泉对比（检验暗封面自动切换深邃星夜明暗气质）
  await page.evaluate(() => window.FOUNTAIN_TEST.loadFountain(window.FOUNTAIN_TEST.coolSong, 'courtyard', false));
  const rCoolCourtyard = await page.evaluate(t => window.FOUNTAIN_TEST.renderPng(t, true), meta.dropKick + 0.10);
  await fs.writeFile(path.join(outDir, '06_fountain_cool_dark_courtyard.png'), Buffer.from(rCoolCourtyard.b64, 'base64'));
  console.log('06_cool_dark_courtyard uniforms:', JSON.stringify(rCoolCourtyard.uniforms));

  // 7. 主歌静谧涌泉对比帧（验证段落动态跨度）
  const rCalm = await page.evaluate(t => window.FOUNTAIN_TEST.renderPng(t, true), meta.calmT);
  await fs.writeFile(path.join(outDir, '07_fountain_calm_verse.png'), Buffer.from(rCalm.b64, 'base64'));
  console.log('07_calm_verse uniforms:', JSON.stringify(rCalm.uniforms));
  assert.ok(rCoolCourtyard.uniforms.sectionEnergy > rCalm.uniforms.sectionEnergy, 'Drop 段落水舞能量应高于主歌段落');

  // 8. 生成 480x270 的 public/previews/fountain.webp 预览缩略图
  const previewWebp = path.resolve('public/previews/fountain.webp');
  execFileSync(ffmpeg, [
    '-y', '-i', pinkCourtyardPath, '-vf', 'scale=480:270:flags=lanczos', '-c:v', 'libwebp', '-quality', '84', previewWebp,
  ], { stdio: 'ignore' });
  console.log('已生成场景预览图:', previewWebp);

  // 9. 核验 380px 设置抽屉中 42/42 场景计数与「花坛喷泉」卡片
  const uiPage = await context.newPage();
  await uiPage.goto(app.baseUrl + '/tools/lead-preview.html');
  const countText = await uiPage.evaluate(async () => {
    window.plugin = {
      getConfig: (_k, def) => def,
      setConfig: () => {},
    };
    const { settingsView } = await import('/src/plugin/ui.ts');
    document.body.style.cssText = 'margin:0;background:#141418;display:flex;justify-content:center;align-items:flex-start;padding:16px;min-height:720px';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:380px;background:rgba(28,28,31,0.94);border-radius:14px;padding-top:12px;box-shadow:0 16px 48px rgba(0,0,0,0.5)';
    const cfg = {
      style: 'auto',
      vibe: 'auto',
      quality: 'high',
      latencyMs: 0,
      songVisualDelays: {},
      button: true,
      controls: true,
      showLyrics: true,
      off: [],
      offLooks: [],
      lyricDelays: {},
      localLrcPaths: {},
      arrange: 'random',
      fpsCap: 0,
      prefetch: false,
      keys: { toggle: 'Ctrl+Shift+KeyM', exit: 'Escape', playPause: 'Space', back: 'ArrowLeft', forward: 'ArrowRight', volUp: 'ArrowUp', volDown: 'ArrowDown' },
    };
    const view = settingsView(cfg, () => {}, async id => `/previews/${id}.webp`, true);
    wrap.append(view);
    document.body.append(wrap);
    await new Promise(r => setTimeout(r, 350));
    const tiles = Array.from(document.querySelectorAll('.bmv-tile-name'));
    const target = tiles.find(el => el.textContent?.includes('花坛喷泉'));
    target?.scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 250));
    return document.body.innerText;
  });
  assert.ok(countText.includes('已开启 42 / 42'), '设置面板应显示 已开启 42 / 42');
  assert.ok(countText.includes('花坛喷泉'), '设置面板世界分组应包含 花坛喷泉');
  await uiPage.screenshot({ path: path.join(outDir, '08_fountain_settings_tile.png') });
  await uiPage.close();

  assert.equal(errors.length, 0, `渲染期发现异常: ${errors.join('; ')}`);
  console.log('全部花坛喷泉 WebGL2/D3D11 渲染与 UI 核验通过！');
} finally {
  if (browser) await browser.close();
  try {
    if (app.server) app.server.close();
    if (app.vite) await app.vite.close();
  } catch {}
}
process.exit(0);
