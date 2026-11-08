import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { loadSettings, startServer } from '../exporter/server.mjs';

const mp3Dir = 'E:/MP3/ILLENIUM3/Ascend';
const testFile = 'Blood.mp3';
const songId = 1384492895;

console.log('Loading audio and cover...');
const audioBuf = await fs.readFile(path.join(mp3Dir, testFile));
const coverRes = spawnSync(ffmpeg, ['-y', '-i', path.join(mp3Dir, testFile), '-an', '-vcodec', 'copy', '-f', 'image2', 'pipe:1']);
const coverBuf = coverRes.stdout;

const lyric = await fetch(`https://music.163.com/api/song/lyric/v1?lv=0&kv=0&yv=0&tv=0&id=${songId}`).then(r => r.json());

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5328,
  },
  useVite: true,
});

const clipStart = 63.9;
const dropStart = 64.91;
const dropEnd = 89.88;
const clipEnd = dropEnd + 2.0;
const duration = clipEnd - clipStart;

const metadata = {
  song: {
    id: songId,
    name: 'Blood',
    artists: ['ILLENIUM', 'Foy Vance'],
    duration: 248,
  },
  lyric,
  config: {
    style: 'auto',
    quality: 'high',
    seed: songId >>> 0,
    forcePlan: [
      { scene: 'underwater', start: clipStart, end: dropStart, variant: 'dive' },
      { scene: 'laser', start: dropStart, end: dropEnd, variant: 'arena' },
      { scene: 'tunnel', start: dropEnd, end: clipEnd, variant: 'rush' },
    ],
  },
  format: {
    width: 2560,
    height: 1440,
    fps: 60,
    encoding: 'hevc',
    start: clipStart,
    duration: Number(duration.toFixed(2)),
  },
};

const form = new FormData();
form.append('metadata', JSON.stringify(metadata));
form.append('audio', new Blob([audioBuf]), 'song.audio');
form.append('cover', new Blob([coverBuf]), 'cover.image');

console.log('Submitting export job to', app.baseUrl);
const response = await fetch(`${app.baseUrl}/api/exports`, {
  method: 'POST',
  headers: { 'X-BetterMV-Token': settings.token },
  body: form,
});

const job = await response.json();
if (!response.ok) {
  console.error('Job submission failed:', job);
  await app.close();
  process.exit(1);
}

console.log(`Job submitted: ${job.id}, rendering ${duration.toFixed(1)}s (1440p @ 60fps)...`);

const startTime = Date.now();
while (true) {
  await new Promise(r => setTimeout(r, 2000));
  const status = await (await fetch(`${app.baseUrl}/api/exports/${job.id}`, {
    headers: { 'X-BetterMV-Token': settings.token },
  })).json();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`[${elapsed}s] state: ${status.state}, frames: ${status.frames}/${status.totalFrames} (${Math.round((status.progress || 0) * 100)}%)`);

  if (status.state === 'failed') {
    console.error('Job failed:', status.error);
    break;
  }
  if (status.state === 'completed') {
    console.log('Job completed! Output file:', status.outputName);
    console.log('Result:', status.result);
    break;
  }
}

await app.close();
