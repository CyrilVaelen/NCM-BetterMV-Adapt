import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { loadSettings, startServer } from '../exporter/server.mjs';

const audioPath = 'D:/野葱视频转换器/音频转换/ILLENIUM,MAX - Beautiful Creatures.mp3';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/ILLENIUM,MAX - Beautiful Creatures.lrc';
const userImgPath = 'C:/Users/86137/.gemini/antigravity/brain/878937d9-5c68-482d-9bc0-fae5875b71d0/.user_uploaded/media_1792901737166_a1260f1a.jpg';

const [audioBuf, lrcText, userImgBuf] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(lrcPath, 'utf8'),
  fs.readFile(userImgPath),
]);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5318,
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
    if (u.pathname === '/user-screenshot') return r.fulfill({ body: userImgBuf, contentType: 'image/jpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  page.on('console', m => console.log('PAGE:', m.text()));

  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  await page.evaluate(async ({ lrc }) => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
    ]);

    // 载入用户截图并裁切封面
    const userImg = new Image();
    userImg.src = '/user-screenshot';
    await userImg.decode();

    const W = userImg.naturalWidth;
    const H = userImg.naturalHeight;

    const cropCanvas = document.createElement('canvas');
    const cropW = Math.round(W * 0.40);
    const cropH = Math.round(H * 0.35);
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d');
    const cropX = Math.round(W * 0.30);
    const cropY = Math.round(H * 0.07);
    cropCtx.drawImage(userImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const [audio] = await Promise.all([
      fetch('/bc-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const song = await prepareSong({
      id: 20261025,
      name: 'Chinese Ink Painting Track',
      artists: ['Artist'],
      audio: audio.slice(0),
      cover: cropCanvas,
      lyric: { lrc: { lyric: lrc } },
    }, { pause: yieldToPage });

    const stage = document.createElement('div');
    stage.style.cssText = 'width:1920px;height:1080px;position:absolute;left:0;top:0';
    document.body.innerHTML = '';
    document.body.appendChild(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;
    player.load(
      song,
      styleFor(song, 'pulse'),
      new Set(),
      { scene: 'phoenix', variants: ['stage'] },
      'none',
      0,
      20261025,
    );
    await player.warm(yieldToPage);

    // 渲染一帧 Drop 高潮时刻 (t = 92.5s)
    player.frame(92.5, 1 / 30);
    window.__mvPlayer = player;
  }, { lrc: lrcText });

  await page.evaluate(() => {
    Object.defineProperty(document.fonts, 'ready', { value: Promise.resolve(document.fonts) });
  });

  await page.waitForTimeout(500);

  // 截图存盘
  const outPath = 'D:/NCM/state/phoenix-lead-color-20261023/verification/round20/round20-fixed-ink-cover-drop.png';
  await page.screenshot({ path: outPath });
  console.log('Saved fixed render screenshot to:', outPath);

  // 同时复制到 Artifact 目录
  const artifactPath = 'C:/Users/86137/.gemini/antigravity/brain/878937d9-5c68-482d-9bc0-fae5875b71d0/round20-fixed-ink-cover-drop.png';
  await fs.copyFile(outPath, artifactPath);
  console.log('Copied to artifact path:', artifactPath);
} finally {
  await browser.close();
  try { await app.stop(); } catch {}
}
