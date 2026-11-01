import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { startServer, loadSettings } from '../exporter/server.mjs';

const userImgPath = 'C:/Users/86137/.gemini/antigravity/brain/878937d9-5c68-482d-9bc0-fae5875b71d0/.user_uploaded/media_1792901737166_a1260f1a.jpg';
const userImgBuf = await fs.readFile(userImgPath);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5316,
    jobDir: 'D:/NCM/state/crash-test/jobs',
    outputDir: 'D:/NCM/state/crash-test',
  },
});

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/user-screenshot') return r.fulfill({ body: userImgBuf, contentType: 'image/jpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  const result = await page.evaluate(async () => {
    const [{ paletteFromImage }, { extractCoverTone }, { extractLeadColorGroups }] = await Promise.all([
      import('/src/render/palette.ts'),
      import('/src/scenes/coverTone.ts'),
      import('/src/scenes/phoenixLeadColor.ts'),
    ]);

    const img = new Image();
    img.src = '/user-screenshot';
    await new Promise(r => { img.onload = r; });

    const W = img.naturalWidth;
    const H = img.naturalHeight;

    const cropCanvas = document.createElement('canvas');
    const cropW = Math.round(W * 0.40);
    const cropH = Math.round(H * 0.35);
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d');
    const cropX = Math.round(W * 0.30);
    const cropY = Math.round(H * 0.07);

    cropCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const imgData = cropCtx.getImageData(0, 0, cropW, cropH);
    const coverPixels = imgData.data;

    const palette = paletteFromImage(cropCanvas);
    const tone = extractCoverTone({ palette, coverPixels, coverSize: { width: cropW, height: cropH } });
    const leadGroups = extractLeadColorGroups({ coverPixels }, tone);

    return {
      tone: {
        mainHue: tone.mainHue,
      },
      leadGroupsInfo: leadGroups.info,
      leadA_stops: leadGroups.a,
      leadB_stops: leadGroups.b,
    };
  });

  console.log('Production extractLeadColorGroups result on User Cover:\n', JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  try { await app.stop(); } catch {}
}
