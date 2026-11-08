import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startServer, loadSettings } from '../exporter/server.mjs';

const mp3Dir = 'E:/MP3/ILLENIUM3/Ascend';
const files = (await fs.readdir(mp3Dir)).filter(f => f.endsWith('.mp3'));

const songMap = {
  'All Together.mp3': 1384496795,
  'Blood.mp3': 1384492895,
  'Broken Ones.mp3': 1384496797,
  'Crashing.mp3': 1384496796,
  'Every Piece Of Me.mp3': 1384492896,
  'Good Things Fall Apart.mp3': 1384492894,
  'Gorgeous.mp3': 1384496800,
  'Hold On (ILLENIUM).mp3': 1384492893,
  'In Your Arms.mp3': 1384492898,
  'Lonely.mp3': 1384492900,
  'Pray.mp3': 1384496799,
  'Sad Songs Fall Apart.mp3': 1454864598,
  'Sad Songs.mp3': 1384492897,
  'Take You Down (Nurko Remix).mp3': 1448419923,
  'Take You Down.mp3': 1384496794,
  'Takeaway.mp3': 1384496798,
  'That’s Why.mp3': 1384496793,
};

// Fetch lyrics for all
const lyrics = {};
for (const [file, id] of Object.entries(songMap)) {
  try {
    const r = await fetch(`https://music.163.com/api/song/lyric/v1?lv=0&kv=0&yv=0&tv=0&id=${id}`).then(res => res.json());
    lyrics[file] = r;
  } catch (e) {
    console.error('Failed to fetch lyric for', file, e);
  }
}

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5321,
    jobDir: 'D:/NCM/state/test-job-all',
    outputDir: 'D:/NCM/exports',
  },
  useVite: true,
});

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

const results = {};

try {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  
  let currentAudio = null;
  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/probe-audio') return r.fulfill({ body: currentAudio, contentType: 'audio/mpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  await page.goto(`${app.baseUrl}/tools/lead-preview.html`);

  for (const file of files) {
    console.log(`Analyzing ${file}...`);
    currentAudio = await fs.readFile(path.join(mp3Dir, file));
    const lyric = lyrics[file];
    const id = songMap[file] || 1;

    const data = await page.evaluate(async ({ id, name, lyric }) => {
      const [{ prepareSong, yieldToPage }] = await Promise.all([
        import('/src/app/prepare.ts'),
      ]);

      const dummyCanvas = document.createElement('canvas');
      dummyCanvas.width = 100;
      dummyCanvas.height = 100;
      const dummyImg = new Image();
      dummyImg.src = dummyCanvas.toDataURL();
      await dummyImg.decode();

      const audio = await fetch('/probe-audio').then(r => r.arrayBuffer());

      const song = await prepareSong({
        id,
        name,
        audio,
        cover: dummyImg,
        lyric,
      }, { pause: yieldToPage });

      const drops = song.analysis.sections.filter(s => s.label === 'drop');
      const lines = song.lines.map(l => ({ start: l.start, end: l.end, text: l.text }));

      return {
        duration: song.duration,
        bpm: song.analysis.bpm,
        sections: song.analysis.sections,
        drops,
        lines,
      };
    }, { id, name: file, lyric });

    results[file] = data;
    console.log(`  Duration: ${data.duration.toFixed(1)}s, Drops: ${data.drops.length}`);
    for (let i = 0; i < data.drops.length; i++) {
      const d = data.drops[i];
      console.log(`    Drop ${i + 1}: ${d.start.toFixed(2)}s -> ${d.end.toFixed(2)}s (energy: ${d.energy})`);
    }
  }

  await fs.writeFile('D:/NCM/state/ascend_analysis.json', JSON.stringify(results, null, 2));
  console.log('Saved all analysis to D:/NCM/state/ascend_analysis.json');
} finally {
  await browser.close();
  await app.close();
}
