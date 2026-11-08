import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startServer, loadSettings } from '../exporter/server.mjs';

const mp3Dir = 'E:/MP3/ILLENIUM3/Ascend';
const testFile = 'Blood.mp3';
const songId = 1384492895;

const audioBuf = await fs.readFile(path.join(mp3Dir, testFile));
const lyricRes = await fetch(`https://music.163.com/api/song/lyric/v1?lv=0&kv=0&yv=0&tv=0&id=${songId}`).then(r => r.json());

// Extract embedded cover
const { spawnSync } = await import('node:child_process');
const ffmpeg = (await import('ffmpeg-static')).default;
const coverRes = spawnSync(ffmpeg, ['-y', '-i', path.join(mp3Dir, testFile), '-an', '-vcodec', 'copy', '-f', 'image2', 'pipe:1']);
const coverBuf = coverRes.stdout;

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5320,
    jobDir: 'D:/NCM/state/test-job',
    outputDir: 'D:/NCM/exports',
  },
  useVite: true,
});

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/test-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/test-cover') return r.fulfill({ body: coverBuf, contentType: 'image/jpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  await page.goto(`${app.baseUrl}/tools/lead-preview.html`);

  const result = await page.evaluate(async ({ songId, lyric }) => {
    const [{ prepareSong, yieldToPage }, { Music }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/director/music.ts'),
    ]);

    const cover = new Image();
    cover.src = '/test-cover';
    await cover.decode();

    const audio = await fetch('/test-audio').then(r => r.arrayBuffer());

    const song = await prepareSong({
      id: songId,
      name: 'Blood',
      audio,
      cover,
      lyric,
    }, { pause: yieldToPage });

    return {
      duration: song.duration,
      sections: song.analysis.sections,
      lines: song.lines.map(l => ({ start: l.start, end: l.end, text: l.text })),
    };
  }, { songId, lyric: lyricRes });

  console.log('DURATION:', result.duration);
  console.log('SECTIONS:', JSON.stringify(result.sections, null, 2));
  console.log('LINES:', JSON.stringify(result.lines.slice(0, 15), null, 2));
} finally {
  await browser.close();
  await app.close();
}
