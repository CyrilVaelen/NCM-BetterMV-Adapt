import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { loadSettings, startServer } from '../exporter/server.mjs';

console.log('Initializing render-round19-validation...');
const outDir = 'D:/NCM/state/phoenix-lead-color-20261023/verification/round19';
await fs.mkdir(outDir, { recursive: true });

const audioPath = 'D:/野葱视频转换器/音频转换/ILLENIUM,MAX - Beautiful Creatures.mp3';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/ILLENIUM,MAX - Beautiful Creatures.lrc';
const awakeCoverPath = 'D:/NCM/state/phoenix-lead-color-20261023/baseline/awake-cover.jpg';

console.log('Reading files...');
const [audioBuf, lrcText, awakeCoverBuf] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(lrcPath, 'utf8'),
  fs.readFile(awakeCoverPath),
]);

console.log('Starting server...');
const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5330,
    jobDir: path.join(outDir, 'jobs'),
    outputDir: outDir,
  },
});
console.log('Server started on', app.baseUrl);

console.log('Launching browser...');
let browser;
try {
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: [
      '--use-angle=d3d11',
      '--disable-gpu-watchdog',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  console.log('Browser launched successfully!');

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
  page.on('console', m => console.log('PAGE:', m.type(), m.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));

  console.log('Navigating to preview page...');
  await page.goto(app.baseUrl + '/tools/lead-preview.html');
  console.log('Page loaded, evaluating setup...');

  await page.evaluate(async ({ lrc, width, height }) => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
    ]);

    const loadCoverImg = async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    };

    const awakeCover = await loadCoverImg('/awake-cover');
    const [audio] = await Promise.all([
      fetch('/bc-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const song = await prepareSong({
      id: 20261021,
      name: 'Beautiful Creatures',
      artists: ['ILLENIUM', 'MAX'],
      audio: audio.slice(0),
      cover: awakeCover,
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

    window.RENDER_HELPER = {
      player,
      renderFrame(t) {
        player.director.overlay.scene.visible = false;
        if (player.scenes?.phoenix?.rig?.group) {
          player.scenes.phoenix.rig.group.visible = false;
        }
        player.frame(t - 1 / 30, 1 / 30);
        player.frame(t, 1 / 30);
        player.engine.renderer.getContext().finish();
      }
    };
  }, { lrc: lrcText, width, height });

  console.log('Rendering Drop section frame (t=91.4s)...');
  await page.evaluate(() => window.RENDER_HELPER.renderFrame(91.4));

  // 1. 全景大图
  const fullPath = path.join(outDir, 'round19-fullscreen-drop.png');
  await page.screenshot({ path: fullPath, clip: { x: 0, y: 0, width, height } });
  console.log('Saved full frame:', fullPath);

  // 2. 屏幕立地特写 (中央巨屏 + DJ台 + 地面接缝，x: 480..1440, y: 150..780)
  const screenCropPath = path.join(outDir, 'round19-screen-ground.png');
  await page.screenshot({
    path: screenCropPath,
    clip: { x: 500, y: 80, width: 920, height: 750 },
  });
  console.log('Saved screen crop:', screenCropPath);

  // 3. 音箱大光圈特写 (右音箱大光圈平滑渐变，x: 1250..1850, y: 250..750)
  const spkCropPath = path.join(outDir, 'round19-speaker-ring.png');
  await page.screenshot({
    path: spkCropPath,
    clip: { x: 1300, y: 260, width: 550, height: 520 },
  });
  console.log('Saved speaker ring crop:', spkCropPath);

  // 4. 凤凰外延光晕特写 (凤凰翼尖与周围空间，x: 550..1370, y: 300..750)
  const phxCropPath = path.join(outDir, 'round19-phoenix-wing.png');
  await page.screenshot({
    path: phxCropPath,
    clip: { x: 580, y: 330, width: 760, height: 420 },
  });
  console.log('Saved phoenix wing crop:', phxCropPath);

  // 5. 水面地面反射平滑过渡特写 (下半部地面，x: 400..1520, y: 690..1080)
  const waterCropPath = path.join(outDir, 'round19-water-gradient.png');
  await page.screenshot({
    path: waterCropPath,
    clip: { x: 400, y: 690, width: 1120, height: 390 },
  });
  console.log('Saved water gradient crop:', waterCropPath);

  console.log('All verification renders completed successfully!');

} finally {
  await browser?.close();
  await app.close();
}
