import fs from 'node:fs/promises';
import path from 'node:path';
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
    port: 5336,
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
      '--disable-gpu-watchdog',
      '--enable-gpu-rasterization',
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-frame-rate-limit',
    ],
  });

  const width = 1920;
  const height = 1080;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });

  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/bc-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/awake-cover') return r.fulfill({ body: awakeCoverBuf, contentType: 'image/jpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  page.on('console', m => {
    if (m.type() === 'error') console.error('PAGE LOG ERROR:', m.text());
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
    stage.style.cssText = `width:${width}px;height:${height}px;position:absolute;left:0;top:0;overflow:hidden;background:#000`;
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
      stepFrame(t) {
        player.frame(t, 1 / 30);
        return { lost: this.gl.isContextLost() };
      }
    };
  }, { lrc: lrcText, width, height });

  const clipStart = 90.0;
  const clipDuration = 8.0;
  const fps = 30;
  const totalFrames = Math.round(clipDuration * fps);
  const mp4Path = path.join(outDir, 'after-phoenix-stage-playback.mp4');
  console.log(`Recording ${clipDuration}s continuous video (${totalFrames} frames) via Playwright native screenshot to ${mp4Path}...`);

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
    const res = await page.evaluate(time => window.VERIFY_PROBE.stepFrame(time), t);
    if (res.lost) {
      anyLost = true;
      throw new Error(`CRITICAL: WebGL Context Lost at frame ${i} (t=${t.toFixed(3)}s)`);
    }
    const buf = await page.screenshot({ type: 'jpeg', quality: 85, timeout: 0 });
    if (!ff.stdin.write(buf)) {
      await once(ff.stdin, 'drain');
    }
    if ((i + 1) % 30 === 0 || i === totalFrames - 1) {
      console.log(`  Frame ${i + 1}/${totalFrames} (t=${t.toFixed(2)}s) captured & encoded OK`);
    }
  }

  ff.stdin.end();
  const [code] = await once(ff, 'close');
  if (code !== 0) throw new Error(`FFmpeg error (${code}): ${ffErr}`);

  const stat = await fs.stat(mp4Path);
  console.log(`SUCCESS: Native screenshot video saved to ${mp4Path} (${stat.size} bytes), anyLost=${anyLost}`);

} finally {
  await browser?.close();
  await app.close();
}
