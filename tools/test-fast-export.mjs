import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import { loadSettings, startServer, PROJECT } from '../exporter/server.mjs';
import { detectHevcEncoder, buildFfmpegArgs } from '../exporter/runner.mjs';

const mp3Dir = 'E:/MP3/ILLENIUM3/Ascend';
const testFile = 'Blood.mp3';
const songId = 1384492895;

console.log('--- TEST FAST EXPORT (Blood.mp3) ---');
const audioPath = path.join(mp3Dir, testFile);
const audioBuf = await fs.readFile(audioPath);
const coverRes = spawnSync(ffmpeg, ['-y', '-i', audioPath, '-an', '-vcodec', 'copy', '-f', 'image2', 'pipe:1']);
const coverBuf = coverRes.stdout;

const lyric = await fetch(`https://music.163.com/api/song/lyric/v1?lv=0&kv=0&yv=0&tv=0&id=${songId}`).then(r => r.json());

const clipStart = 63.96;
const dropStart = 64.91;
const dropEnd = 89.88;
const clipEnd = dropEnd + 2.0;
const duration = clipEnd - clipStart;
const fps = 60;
const totalFrames = Math.ceil(duration * fps);
const width = 2560;
const height = 1440;

const outDir = 'D:/NCM/exports';
await fs.mkdir(outDir, { recursive: true });
const outputPath = path.join(outDir, `Blood-test-1440p-60fps.mp4`);
try { await fs.unlink(outputPath); } catch {}

const hevcBackend = await detectHevcEncoder(ffmpeg);
console.log('HEVC backend:', hevcBackend);

// Setup HTTP frame receiver
let encoder = null;
let framesReceived = 0;
let lastLog = Date.now();

const frameServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url === '/push-frame' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const buf = Buffer.concat(chunks);
      if (encoder && encoder.stdin.writable) {
        if (!encoder.stdin.write(buf)) {
          await once(encoder.stdin, 'drain');
        }
        framesReceived++;
        if (Date.now() - lastLog >= 1500 || framesReceived === totalFrames) {
          lastLog = Date.now();
          const pct = ((framesReceived / totalFrames) * 100).toFixed(1);
          console.log(`[Stream] Frame ${framesReceived}/${totalFrames} (${pct}%)`);
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise(r => frameServer.listen(5345, '127.0.0.1', r));

// Start BetterMV server
const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5346,
  },
  useVite: true,
});

// Start FFmpeg encoder
const ffmpegArgs = [
  '-hide_banner', '-loglevel', 'warning', '-y',
  '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0',
  '-ss', String(clipStart), '-i', audioPath,
  '-map', '0:v:0', '-map', '1:a:0',
  '-vf', 'scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=p010le',
  '-c:v', 'hevc_qsv',
  '-preset', 'veryfast',
  '-global_quality', '22',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-tag:v', 'hvc1',
  '-r', String(fps),
  '-c:a', 'aac', '-b:a', '256k',
  '-af', 'apad', '-t', String(duration),
  '-movflags', '+faststart', '-f', 'mp4', outputPath,
];

encoder = spawn(ffmpeg, ffmpegArgs, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
let ffStderr = '';
encoder.stderr.on('data', d => { ffStderr += d.toString(); });
const encoderDone = once(encoder, 'close');

// Launch browser
const browser = await chromium.launch({
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
  ],
});

try {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl && u.origin !== 'http://127.0.0.1:5345') return r.abort();
    if (u.pathname === '/song-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/song-cover') return r.fulfill({ body: coverBuf, contentType: 'image/jpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  page.on('console', m => {
    if (m.type() === 'error') console.error('PAGE LOG ERROR:', m.text());
  });

  await page.goto(`${app.baseUrl}/tools/lead-preview.html`);

  console.log('Initializing scene and player in browser...');
  const initResult = await page.evaluate(async ({ songId, lyric, width, height, clipStart, dropStart, dropEnd, clipEnd }) => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }, { SCENES }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
      import('/src/scenes/catalog.ts'),
    ]);

    const cover = new Image();
    cover.src = '/song-cover';
    await cover.decode();

    const [audio] = await Promise.all([
      fetch('/song-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const song = await prepareSong({
      id: songId,
      name: 'Blood',
      artists: ['ILLENIUM', 'Foy Vance'],
      audio,
      cover,
      lyric,
    }, { pause: yieldToPage });

    const stage = document.createElement('div');
    stage.style.cssText = `width:${width}px;height:${height}px;position:absolute;left:0;top:0;overflow:hidden;background:#000`;
    document.body.innerHTML = '';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1, { width, height });
    player.hud.visible = false;
    const style = styleFor(song, 'auto', true, 'auto');

    // Retake: strictly enforce non-laser pre-drop, laser during drop, non-laser post-drop!
    const forcePlan = [
      { scene: 'underwater', variant: 'canyon', start: clipStart, end: dropStart },
      { scene: 'laser', variant: 'arena', start: dropStart, end: dropEnd },
      { scene: 'tunnel', variant: 'rush', start: dropEnd, end: clipEnd },
    ];

    const retake = (plannedShots, music) => {
      const sortedPlan = [...forcePlan].sort((a, b) => a.start - b.start);
      const result = [];
      for (const shot of plannedShots) {
        let currentStart = shot.start;
        const currentEnd = shot.end;
        for (const fp of sortedPlan) {
          if (fp.end <= currentStart || fp.start >= currentEnd) continue;
          if (fp.start > currentStart) {
            result.push({
              ...shot,
              start: currentStart,
              scene: (shot.scene === 'laser' && fp.scene !== 'laser') ? 'tunnel' : shot.scene,
              end: fp.start,
            });
            currentStart = fp.start;
          }
          const segEnd = Math.min(currentEnd, fp.end);
          const matchedSection = music.a.sections.find(s => !(segEnd <= s.start || currentStart >= s.end))
            ?? shot.section;
          const sectionLabel = fp.scene === 'laser' ? 'drop' : (matchedSection.label === 'drop' ? 'chorus' : matchedSection.label);
          const sectionEnergy = fp.scene === 'laser' ? 1.0 : matchedSection.energy;
          result.push({
            scene: fp.scene,
            variant: fp.variant ?? (fp.scene === 'laser' ? 'arena' : shot.variant),
            start: currentStart,
            end: segEnd,
            section: { ...matchedSection, label: sectionLabel, energy: sectionEnergy },
            sectionIndex: shot.sectionIndex,
            seed: (songId ^ Math.round(currentStart * 100)) >>> 0,
          });
          currentStart = segEnd;
        }
        if (currentStart < currentEnd) {
          result.push({
            ...shot,
            start: currentStart,
            end: currentEnd,
          });
        }
      }
      return result;
    };

    player.load(song, style, new Set(), undefined, undefined, 0, songId >>> 0, retake, true, 'auto');
    await player.warm(yieldToPage);

    window.RENDER_STREAM = {
      player,
      canvas: player.engine.renderer.domElement,
      async streamAll(clipStart, totalFrames, fps, pushUrl) {
        const dt = 1 / fps;
        // Warm up 8 frames before clipStart
        for (let i = 8; i > 0; i--) {
          player.frame(Math.max(0, clipStart - i * dt), dt);
        }

        for (let f = 0; f < totalFrames; f++) {
          const t = clipStart + f * dt;
          player.frame(t, dt);
          const blob = await new Promise(r => this.canvas.toBlob(r, 'image/jpeg', 0.95));
          await fetch(pushUrl, { method: 'POST', body: blob });
        }
        return true;
      }
    };

    return { ok: true, duration: song.duration };
  }, { songId, lyric, width, height, clipStart, dropStart, dropEnd, clipEnd });

  console.log(`Player initialized (song dur: ${initResult.duration.toFixed(1)}s). Streaming ${totalFrames} frames...`);
  const streamStart = Date.now();

  await page.evaluate(async ({ clipStart, totalFrames, fps }) => {
    await window.RENDER_STREAM.streamAll(clipStart, totalFrames, fps, 'http://127.0.0.1:5345/push-frame');
  }, { clipStart, totalFrames, fps });

  const streamDuration = ((Date.now() - streamStart) / 1000).toFixed(1);
  console.log(`Streaming finished in ${streamDuration}s (${(totalFrames / streamDuration).toFixed(1)} fps)! Closing encoder...`);

  encoder.stdin.end();
  const [code] = await encoderDone;
  if (code !== 0) throw new Error(`FFmpeg exited with code ${code}: ${ffStderr}`);

  const stat = await fs.stat(outputPath);
  console.log(`SUCCESS! Video saved to ${outputPath}`);
  console.log(`  File size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);
} finally {
  await browser.close();
  await app.close();
  await new Promise(r => frameServer.close(r));
}
