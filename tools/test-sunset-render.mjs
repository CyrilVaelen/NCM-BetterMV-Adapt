import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import { loadSettings, startServer } from '../exporter/server.mjs';

const outDir = path.resolve('../exports/sunset-closer-drop');
await fs.mkdir(outDir, { recursive: true });

const audioPath = 'D:/CloudMusic/LIONE,The Chainsmokers,Halsey - Closer (LIONE Remix).mp3';
const lrcPath = 'D:/CloudMusic/LIONE,The Chainsmokers,Halsey - Closer (LIONE Remix).lrc';
const coverPath = 'C:/Users/86137/.gemini/antigravity/brain/5e7e8c8b-1e43-47aa-9db3-474b836c22ea/.user_uploaded/media_1792473090226_bdeedbd6.jpg';

console.log('读取 Closer (LIONE Remix) 音频、LRC 与专辑封面...');
const [audioBuf, lrcText, coverBuf] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(lrcPath, 'utf8'),
  fs.readFile(coverPath),
]);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5226,
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
    args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/closer-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/closer-cover') return r.fulfill({ body: coverBuf, contentType: 'image/jpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') {
      errors.push(m.text());
      console.log('BROWSER ERROR: ' + m.text());
    }
  });

  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  console.log('正在执行 Closer (LIONE Remix) 音频分析、封面色调提取与场景初始化...');
  const initResult = await page.evaluate(async (lrc) => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }, { extractCoverTone }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
      import('/src/scenes/coverTone.ts'),
    ]);

    const cover = new Image();
    cover.src = '/closer-cover';
    await cover.decode();

    const [audio] = await Promise.all([
      fetch('/closer-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const song = await prepareSong({
      id: 20261020,
      name: 'Closer (LIONE Remix)',
      artists: ['The Chainsmokers', 'Halsey', 'LIONE'],
      audio,
      cover,
      lyric: { lrc: { lyric: lrc } },
    }, { pause: yieldToPage });

    const coverTone = extractCoverTone(song);

    const stage = document.createElement('div');
    stage.style.cssText = 'width:1280px;height:720px;position:absolute;left:0;top:0';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;

    // 默认自动编排镜头验证 Drop 1 / Drop 2
    player.load(song, styleFor(song, 'pulse'), new Set(), undefined, 'none', 0, 20261020);
    const autoShots = player.director.shots.map(s => ({
      start: +s.start.toFixed(2),
      end: +s.end.toFixed(2),
      scene: s.scene,
      variant: s.variant,
      label: s.section.label,
    }));

    window.MV_PROBE = {
      player,
      song,
      styleFor,
      yieldToPage,
      async switchScene(sceneId, variants) {
        player.load(
          song,
          styleFor(song, 'pulse'),
          new Set(),
          { scene: sceneId, variants },
          'none',
          0,
          20261020,
        );
        await player.warm(yieldToPage);
      },
      renderAt(t, opts = {}) {
        const prevOverlay = player.director.overlay.scene.visible;
        if (opts.clean) {
          player.director.overlay.scene.visible = false;
        }
        player.frame(t, 1 / 30);
        const gl = player.engine.renderer.getContext();
        gl.finish();
        const b64 = player.engine.renderer.domElement.toDataURL('image/png').split(',')[1];
        player.director.overlay.scene.visible = prevOverlay;
        return { b64 };
      },
    };

    return {
      duration: song.duration,
      coverTone: {
        mainHue: +coverTone.mainHue.toFixed(1),
        deepHue: +coverTone.deepHue.toFixed(1),
        highHue: +coverTone.highHue.toFixed(1),
        satScale: +coverTone.satScale.toFixed(2),
      },
      autoDrops: autoShots.filter(s => s.label === 'drop'),
    };
  }, lrcText);

  console.log('提取到的专辑封面色调 (CoverTone):', JSON.stringify(initResult.coverTone));
  console.log('自动编排下的 Drop 镜头:', JSON.stringify(initResult.autoDrops));

  // ── 1. 核验粉色封面下的「水下石柱 (underwater)」场景 ──
  console.log('\n正在切换至「水下石柱 (underwater)」场景并渲染粉色色调关键帧...');
  await page.evaluate(() => window.MV_PROBE.switchScene('underwater', ['dive', 'canyon', 'orbit', 'abyss']));

  const uwCheckTimes = [
    { t: 74.60, label: 'uw_01_drop_dive', clean: true },
    { t: 78.25, label: 'uw_02_drop_pillars_lyrics', clean: false },
    { t: 83.10, label: 'uw_03_drop_arch_jellyfish', clean: true },
  ];

  for (const item of uwCheckTimes) {
    await page.evaluate(t => window.MV_PROBE.player.frame(t - 1 / 30, 1 / 30), item.t);
    const res = await page.evaluate(({ t, clean }) => window.MV_PROBE.renderAt(t, { clean }), item);
    const filePath = path.join(outDir, `${item.label}.png`);
    await fs.writeFile(filePath, Buffer.from(res.b64, 'base64'));
    console.log(`已保存粉色水下石柱核验帧: ${item.label}.png`);
  }

  // 录制 8 秒粉色水下石柱 Drop 视频 (73.5s - 81.5s, 240 帧)
  const uwVideoFile = path.join(outDir, 'closer-lione-underwater-pink-drop.mp4');
  const fps = 30;
  const uwStartT = 73.5;
  const uwDurT = 8.0;
  const uwFrames = Math.round(uwDurT * fps);
  console.log(`正在录制粉色「水下石柱」Drop 原声视频 (${uwStartT}s - ${uwStartT + uwDurT}s, ${uwFrames} 帧)...`);
  const ffUw = spawn(ffmpeg, [
    '-y', '-f', 'image2pipe', '-vcodec', 'png', '-r', String(fps), '-i', 'pipe:0',
    '-ss', String(uwStartT), '-t', String(uwDurT), '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', uwVideoFile,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  for (let f = 0; f < uwFrames; f++) {
    const t = uwStartT + f / fps;
    const { b64 } = await page.evaluate(t => window.MV_PROBE.renderAt(t, { clean: false }), t);
    ffUw.stdin.write(Buffer.from(b64, 'base64'));
  }
  ffUw.stdin.end();
  await once(ffUw, 'close');
  console.log(`粉色水下石柱视频生成成功: ${uwVideoFile}`);

  // ── 2. 核验封面同色调下的「晚霞水台 (sunset)」场景 ──
  console.log('\n正在切换至「晚霞水台 (sunset)」场景并渲染关键帧...');
  await page.evaluate(() => window.MV_PROBE.switchScene('sunset', ['horizon', 'beam', 'drift', 'halo']));

  const sunsetCheckTimes = [
    { t: 74.60, label: '01_drop1_lead_hit', clean: true },
    { t: 78.25, label: '02_drop1_water_ripples', clean: true },
    { t: 83.10, label: '03_drop1_with_lyrics', clean: false },
  ];

  for (const item of sunsetCheckTimes) {
    await page.evaluate(t => window.MV_PROBE.player.frame(t - 1 / 30, 1 / 30), item.t);
    const res = await page.evaluate(({ t, clean }) => window.MV_PROBE.renderAt(t, { clean }), item);
    const filePath = path.join(outDir, `${item.label}.png`);
    await fs.writeFile(filePath, Buffer.from(res.b64, 'base64'));
    console.log(`已保存晚霞水台核验帧: ${item.label}.png`);
  }

  // 录制 8 秒晚霞水台 Drop 视频 (73.5s - 81.5s, 240 帧)
  const sunsetVideoFile = path.join(outDir, 'closer-lione-sunset-drop.mp4');
  console.log(`正在录制「晚霞水台」Drop 原声视频 (${uwStartT}s - ${uwStartT + uwDurT}s, ${uwFrames} 帧)...`);
  const ffSun = spawn(ffmpeg, [
    '-y', '-f', 'image2pipe', '-vcodec', 'png', '-r', String(fps), '-i', 'pipe:0',
    '-ss', String(uwStartT), '-t', String(uwDurT), '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', sunsetVideoFile,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  for (let f = 0; f < uwFrames; f++) {
    const t = uwStartT + f / fps;
    const { b64 } = await page.evaluate(t => window.MV_PROBE.renderAt(t, { clean: false }), t);
    ffSun.stdin.write(Buffer.from(b64, 'base64'));
  }
  ffSun.stdin.end();
  await once(ffSun, 'close');
  console.log(`晚霞水台视频生成成功: ${sunsetVideoFile}`);

  assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);

} finally {
  if (browser) await browser.close();
  try {
    if (app.server) app.server.close();
    if (app.vite) await app.vite.close();
  } catch {}
}
process.exit(0);
