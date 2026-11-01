import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = 'D:/NCM/state/phoenix-lead-color-20261023';
const baseDir = path.join(root, 'baseline/renders');
const afterDir = path.join(root, 'verification/renders');

const pairs = [
  ['before-drop1_downstroke-full.png', 'after-drop1_downstroke-full.png', 'compare-drop1_downstroke-full.png'],
  ['before-drop1_downstroke-speaker.png', 'after-drop1_downstroke-speaker.png', 'compare-drop1_downstroke-speaker.png'],
  ['before-drop1_downstroke-phoenix.png', 'after-drop1_downstroke-phoenix.png', 'compare-drop1_downstroke-phoenix.png'],
  ['before-drop1_downstroke-water.png', 'after-drop1_downstroke-water.png', 'compare-drop1_downstroke-water.png'],
  ['before-drop1_lyrics-full.png', 'after-drop1_vocal_fusion-full.png', 'compare-drop1_vocal_fusion-full.png'],
  ['before-alt-blue-full.png', 'after-alt-blue-full.png', 'compare-alt-blue-full.png'],
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();

for (const [beforeName, afterName, outName] of pairs) {
  const beforePath = path.join(baseDir, beforeName);
  const afterPath = path.join(afterDir, afterName);
  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) {
    console.warn('Skipping pair due to missing file:', beforeName, afterName);
    continue;
  }
  const beforeB64 = fs.readFileSync(beforePath).toString('base64');
  const afterB64 = fs.readFileSync(afterPath).toString('base64');

  const stitchedB64 = await page.evaluate(async ({ b64A, b64B, labelA, labelB }) => {
    const loadImg = b64 => new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = 'data:image/png;base64,' + b64;
    });
    const [imgA, imgB] = await Promise.all([loadImg(b64A), loadImg(b64B)]);
    const w = imgA.naturalWidth;
    const h = imgA.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgA, 0, 0);
    ctx.drawImage(imgB, w, 0);

    // Labels
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(20, 20, 320, 50);
    ctx.fillRect(w + 20, 20, 320, 50);
    ctx.fillStyle = '#ffeedd';
    ctx.fillText(labelA, 35, 56);
    ctx.fillText(labelB, w + 35, 56);

    return canvas.toDataURL('image/png').split(',')[1];
  }, { b64A: beforeB64, b64B: afterB64, labelA: '修改前 (Before)', labelB: '修改后 (After)' });

  const outPath = path.join(afterDir, outName);
  fs.writeFileSync(outPath, Buffer.from(stitchedB64, 'base64'));
  console.log('Saved comparison:', outName);
}

await browser.close();
