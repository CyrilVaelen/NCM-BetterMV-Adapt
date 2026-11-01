import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { loadSettings, startServer } from '../exporter/server.mjs';

const audioPath = 'D:/野葱视频转换器/音频转换/ILLENIUM,MAX - Beautiful Creatures.mp3';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/ILLENIUM,MAX - Beautiful Creatures.lrc';
const awakeCoverPath = 'D:/NCM/state/phoenix-lead-color-20261023/baseline/awake-cover.jpg';

const [audioBuf, lrcText, awakeCoverBuf] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(lrcPath, 'utf8'),
  fs.readFile(awakeCoverPath),
]);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5296,
    jobDir: 'D:/NCM/state/crash-test/jobs',
    outputDir: 'D:/NCM/state/crash-test',
  },
});

let browser;
try {
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });

  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/bc-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/awake-cover') return r.fulfill({ body: awakeCoverBuf, contentType: 'image/jpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  page.on('console', m => console.log('PAGE LOG:', m.type(), m.text()));

  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  await page.evaluate(async ({ lrc }) => {
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
    stage.style.cssText = 'width:1920px;height:1080px;position:absolute;left:0;top:0';
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

    const domCanvas = player.engine.renderer.domElement;
    domCanvas.addEventListener('webglcontextlost', (e) => {
      console.error('WEBGL CONTEXT LOST EVENT FIRED!', e);
    });

    window.TEST_RUN = {
      player,
      gl: player.engine.renderer.getContext(),
      render(t) {
        player.frame(t, 1 / 30);
        this.gl.finish();
        const b64 = domCanvas.toDataURL('image/jpeg', 0.92);
        return { lost: this.gl.isContextLost(), len: b64.length };
      }
    };
  }, { lrc: lrcText });

  console.log('Testing t=91.167 (frame 35) directly...');
  for (let k = 0; k < 10; k++) {
    const res = await page.evaluate(() => window.TEST_RUN.render(91.167));
    console.log(`Render 91.167 #${k}: lost=${res.lost}, len=${res.len}`);
    if (res.lost) break;
  }

} finally {
  await browser?.close();
  await app.close();
}
