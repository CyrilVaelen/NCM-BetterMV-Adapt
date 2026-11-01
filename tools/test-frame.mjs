import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { loadSettings, startServer } from '../exporter/server.mjs';

const outDir = path.resolve('../exports/Underwater-test-preview');
await fs.mkdir(outDir, { recursive: true });

const audioPath = 'D:/野葱视频转换器/音频转换/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).mp3';
const coverPath = 'C:/Users/86137/.gemini/antigravity/brain/d6a5e869-cea4-42c3-8daa-26ed19bac60c/.user_uploaded/media_1792386445314_25173fb1.png';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).lrc';

const [audioBuf, coverBuf, lrcText] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(coverPath),
  fs.readFile(lrcPath, 'utf8').catch(() => `[00:00.00]Underneath The Waves`),
]);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5238,
    jobDir: path.join(outDir, 'jobs'),
    outputDir: outDir,
  },
});

let browser;
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
    if (u.pathname === '/remodel-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/remodel-cover') return r.fulfill({ body: coverBuf, contentType: 'image/png' });
    return r.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on('console', m => console.log('[CONSOLE]', m.type(), m.text()));
  page.on('pageerror', e => console.error('[PAGE ERROR]', e.message));

  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  const shotsMeta = await page.evaluate(async (lrc) => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
    ]);

    const cover = new Image();
    cover.src = '/remodel-cover';
    await cover.decode();

    const [audio] = await Promise.all([
      fetch('/remodel-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const song = await prepareSong({
      id: 999003,
      name: 'Underneath The Waves',
      artists: ['Last Heroes', 'Monika Santucci'],
      audio,
      cover,
      lyric: { lrc: { lyric: lrc } },
    }, { pause: yieldToPage });

    const stage = document.createElement('div');
    stage.style.cssText = 'width:1280px;height:720px;position:absolute;left:0;top:0';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;

    // 只在此处加载一次并预热！
    player.load(
      song,
      styleFor(song, 'pulse'),
      new Set(),
      { scene: 'underwater', variants: ['dive', 'canyon', 'orbit'] },
      'none',
      0,
      999003,
    );
    await player.warm(yieldToPage);

    window.PREVIEW = {
      render(t) {
        player.frame(t - 1 / 30, 1 / 30);
        const shot = player.frame(t, 1 / 30);
        const gl = player.engine.renderer.getContext();
        gl.finish();
        const cam = player.scenes.underwater.camera;
        return {
          shot: { start: shot.start, end: shot.end, scene: shot.scene, variant: shot.variant, label: shot.section.label },
          camPos: [cam.position.x, cam.position.y, cam.position.z],
          camTarget: [cam.rotation.x, cam.rotation.y, cam.rotation.z],
          png: player.engine.renderer.domElement.toDataURL('image/png').split(',')[1],
        };
      },
    };

    return player.director.shots.filter(s => s.end > 75 && s.start < 110).map(s => ({
      start: s.start, end: s.end, scene: s.scene, variant: s.variant, label: s.section.label
    }));
  }, lrcText);

  console.log('Drop 镜头切分:', JSON.stringify(shotsMeta, null, 2));

  for (const item of [
    { t: 78.5, name: 'frame-dive-78.5.png' },
    { t: 81.5, name: 'frame-dive-81.5.png' },
    { t: 86.0, name: 'frame-dive-86.0.png' },
    { t: 96.0, name: 'frame-dive-96.0.png' },
  ]) {
    const res = await page.evaluate(t => window.PREVIEW.render(t), item.t);
    console.log(`[t=${item.t}] Shot: ${res.shot.variant} (${res.shot.label}), Cam: [${res.camPos.map(x => x.toFixed(2)).join(', ')}]`);
    const dest = path.join(outDir, item.name);
    await fs.writeFile(dest, Buffer.from(res.png, 'base64'));
    console.log(`生成预览: ${dest}`);
  }
} finally {
  if (browser) await browser.close();
  try {
    if (app.server) app.server.close();
    if (app.vite) await app.vite.close();
  } catch {}
}
process.exit(0);
