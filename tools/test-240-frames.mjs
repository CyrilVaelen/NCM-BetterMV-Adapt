import fs from 'node:fs/promises';
import path from 'node:path';
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
    port: 5312,
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
      async render(t) {
        player.frame(t, 1 / 30);
        this.gl.finish();
        return { lost: this.gl.isContextLost(), len: 0 };
      }
    };
  }, { lrc: lrcText });

  console.log('Testing 240 continuous frames (full 8.0s video simulation)...');
  let anyLost = false;
  for (let i = 0; i < 240; i++) {
    const t = 90.0 + i / 30;
    const res = await page.evaluate(time => window.TEST_RUN.render(time), t);
    if (i % 30 === 0 || res.lost) {
      console.log(`Frame ${i} (t=${t.toFixed(3)}): lost=${res.lost}, len=${res.len}`);
    }
    if (res.lost) {
      anyLost = true;
      break;
    }
    await new Promise(r => setTimeout(r, 12));
  }
  console.log('Full 240 frames result: anyLost =', anyLost);

  const outDir = 'D:/NCM/state/phoenix-lead-color-20261023/verification/round20';
  await fs.mkdir(outDir, { recursive: true });

  console.log('Rendering clean drop frame for screenshots...');
  await page.evaluate(() => {
    window.TEST_RUN.player.director.overlay.scene.visible = false;
    if (window.TEST_RUN.player.scenes?.phoenix?.rig?.group) {
      window.TEST_RUN.player.scenes.phoenix.rig.group.visible = false;
    }
    window.TEST_RUN.player.frame(91.4 - 1/30, 1/30);
    window.TEST_RUN.player.frame(91.4, 1/30);
    window.TEST_RUN.gl.finish();

    try {
      Object.defineProperty(document.fonts, 'status', { value: 'loaded', configurable: true });
      Object.defineProperty(document.fonts, 'ready', { value: Promise.resolve(document.fonts), configurable: true });
    } catch {}
  });

  const width = 1920;
  const height = 1080;
  const fullPath = path.join(outDir, 'round20-fullscreen-drop.png');
  await page.screenshot({ path: fullPath, clip: { x: 0, y: 0, width, height }, timeout: 15000 });
  console.log('Saved full frame:', fullPath);

  const headCropPath = path.join(outDir, 'round20-phoenix-head.png');
  await page.screenshot({ path: headCropPath, clip: { x: 820, y: 290, width: 280, height: 320 }, timeout: 15000 });
  console.log('Saved phoenix head crop:', headCropPath);

  const meditatorCropPath = path.join(outDir, 'round20-meditator.png');
  await page.screenshot({ path: meditatorCropPath, clip: { x: 840, y: 780, width: 240, height: 280 }, timeout: 15000 });
  console.log('Saved meditator crop:', meditatorCropPath);

  const screenCropPath = path.join(outDir, 'round20-screen-ground.png');
  await page.screenshot({ path: screenCropPath, clip: { x: 500, y: 80, width: 920, height: 750 }, timeout: 15000 });
  console.log('Saved screen crop:', screenCropPath);

  const phxCropPath = path.join(outDir, 'round20-phoenix-wing.png');
  await page.screenshot({ path: phxCropPath, clip: { x: 580, y: 330, width: 760, height: 420 }, timeout: 15000 });
  console.log('Saved phoenix wing crop:', phxCropPath);

  const spkCropPath = path.join(outDir, 'round20-speaker-ring.png');
  await page.screenshot({ path: spkCropPath, clip: { x: 1300, y: 260, width: 550, height: 520 }, timeout: 15000 });
  console.log('Saved speaker ring crop:', spkCropPath);

} finally {
  await browser?.close();
  await app.close();
}
