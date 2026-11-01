import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import { loadSettings, startServer } from '../exporter/server.mjs';

const stateRoot = 'D:/NCM/state/phoenix-lead-color-20261023';
const outDir = path.join(stateRoot, 'verification/renders');
await fs.mkdir(outDir, { recursive: true });

const audioPath = 'D:/野葱视频转换器/音频转换/ILLENIUM,MAX - Beautiful Creatures.mp3';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/ILLENIUM,MAX - Beautiful Creatures.lrc';
const awakeCoverPath = path.join(stateRoot, 'baseline/awake-cover.jpg');

const [audioBuf, lrcText, awakeCoverBuf] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(lrcPath, 'utf8'),
  fs.readFile(awakeCoverPath),
]);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5328,
    jobDir: path.join(outDir, 'jobs'),
    outputDir: outDir,
  },
});

let browser;
try {
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: [
      '--use-angle=d3d11',
      '--enable-gpu-rasterization',
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--disable-gpu-watchdog',
    ],
  });

  const width = 1920, height = 1080;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });

  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/bc-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/awake-cover') return r.fulfill({ body: awakeCoverBuf, contentType: 'image/jpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  page.on('console', m => {
    if (m.type() === 'error') console.error('CONSOLE ERROR:', m.text());
  });

  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  await page.evaluate(async ({ lrc, width, height }) => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
    ]);

    const img = new Image();
    img.src = '/awake-cover';
    await img.decode();

    const [audio] = await Promise.all([
      fetch('/bc-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const song = await prepareSong({
      id: 20261021,
      name: 'Beautiful Creatures',
      artists: ['ILLENIUM', 'MAX'],
      audio: audio.slice(0),
      cover: img,
      lyric: { lrc: { lyric: lrc } },
    }, { pause: yieldToPage });

    const stage = document.createElement('div');
    stage.style.cssText = `width:${width}px;height:${height}px;position:absolute;left:0;top:0`;
    document.body.innerHTML = '';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;
    player.load(
      song,
      styleFor(song, 'pulse'),
      new Set(),
      { scene: 'phoenix', variants: ['stage'] },
      'none',
      0,
      20261021,
    );
    await player.warm(yieldToPage);

    window.VERIFY_PROBE = {
      player,
      gl: player.engine.renderer.getContext(),
      async renderFrame(t) {
        player.frame(t, 1 / 30);
        const lost = this.gl.isContextLost();
        const domCanvas = player.engine.renderer.domElement;
        const fullB64 = domCanvas.toDataURL('image/jpeg', 0.92).split(',')[1];
        return { fullB64, lost };
      }
    };
  }, { lrc: lrcText, width, height });

  const clipStart = 90.0;
  const clipDuration = 8.0;
  const fps = 30;
  const totalFrames = Math.round(clipDuration * fps);
  const mp4Path = path.join(outDir, 'after-phoenix-stage-playback.mp4');
  console.log(`Recording ${clipDuration}s continuous video (${totalFrames} frames) to ${mp4Path}...`);

  const ff = spawn(ffmpeg, [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-framerate', String(fps),
    '-i', '-',
    '-ss', String(clipStart),
    '-t', String(clipDuration),
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    mp4Path,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let ffErr = '';
  ff.stderr.on('data', d => { ffErr += d.toString(); });

  let anyLost = false;
  for (let i = 0; i < totalFrames; i++) {
    const t = clipStart + i / fps;
    const res = await page.evaluate(time => window.VERIFY_PROBE.renderFrame(time), t);
    if (res.lost) {
      anyLost = true;
      throw new Error(`CRITICAL: WebGL Context Lost at frame ${i} (t=${t.toFixed(3)}s)`);
    }
    const buf = Buffer.from(res.fullB64, 'base64');
    if (!ff.stdin.write(buf)) {
      await once(ff.stdin, 'drain');
    }
    if ((i + 1) % 30 === 0 || i === totalFrames - 1) {
      console.log(`  Frame ${i + 1}/${totalFrames} (t=${t.toFixed(2)}s) encoded OK`);
    }
    await new Promise(r => setTimeout(r, 25));
  }

  ff.stdin.end();
  const [code] = await once(ff, 'close');
  if (code !== 0) throw new Error(`FFmpeg error (${code}): ${ffErr}`);

  const stat = await fs.stat(mp4Path);
  console.log(`SUCCESS: Video saved to ${mp4Path} (${stat.size} bytes), anyLost=${anyLost}`);

} finally {
  await browser?.close();
  await app.close();
}
