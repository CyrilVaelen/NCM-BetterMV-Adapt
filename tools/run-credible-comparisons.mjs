import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { loadSettings, startServer } from '../exporter/server.mjs';

const stateRoot = 'D:/NCM/state/phoenix-lead-color-20261023';
const baseRendersDir = path.join(stateRoot, 'baseline/renders');
const afterRendersDir = path.join(stateRoot, 'verification/renders');
const baselineBakPath = path.join(stateRoot, 'baseline/phoenix.ts.bak');
const candidateBakPath = 'D:/NCM/NCM-BetterMV-0.9.0/src/scenes/phoenix.ts.candidate';
const currentPhoenixPath = 'D:/NCM/NCM-BetterMV-0.9.0/src/scenes/phoenix.ts';

const audioPath = 'D:/野葱视频转换器/音频转换/ILLENIUM,MAX - Beautiful Creatures.mp3';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/ILLENIUM,MAX - Beautiful Creatures.lrc';
const awakeCoverPath = path.join(stateRoot, 'baseline/awake-cover.jpg');
const altCoverPath = 'D:/NCM/NCM-BetterMV-0.9.0/tools/previews/demo-cover.jpg';

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

const [audioBuf, lrcText, awakeCoverBuf, altCoverBuf] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(lrcPath, 'utf8'),
  fs.readFile(awakeCoverPath),
  fs.readFile(altCoverPath),
]);

async function captureMode(mode, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const phoenixBuf = await fs.readFile(currentPhoenixPath);
  const curSha = sha256(phoenixBuf);
  console.log(`\n========================================`);
  console.log(`[${mode.toUpperCase()}] Capturing with phoenix.ts SHA256: ${curSha}`);
  console.log(`========================================`);

  const settings = await loadSettings();
  const port = mode === 'before' ? 5250 : 5252;
  const app = await startServer({
    settings: {
      ...settings,
      port,
      jobDir: path.join(outDir, 'jobs'),
      outputDir: outDir,
    },
  });

  let browser;
  const manifest = { mode, phoenixSourceSha256: curSha, renders: {} };

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

    const width = 1920;
    const height = 1080;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });

    await context.route('**/*', r => {
      const u = new URL(r.request().url());
      if (u.origin !== app.baseUrl) return r.abort();
      if (u.pathname === '/bc-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
      if (u.pathname === '/awake-cover') return r.fulfill({ body: awakeCoverBuf, contentType: 'image/jpeg' });
      if (u.pathname === '/alt-cover') return r.fulfill({ body: altCoverBuf, contentType: 'image/jpeg' });
      return r.continue();
    });

    const page = await context.newPage();
    page.on('console', m => {
      if (m.type() === 'error') console.error('PAGE LOG ERROR:', m.text());
    });

    await page.goto(app.baseUrl + '/tools/lead-preview.html');

    await page.evaluate(async ({ lrc, width, height }) => {
      const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }, { extractCoverTone }] = await Promise.all([
        import('/src/app/prepare.ts'),
        import('/src/app/player.ts'),
        import('/src/render/text.ts'),
        import('/src/scenes/coverTone.ts'),
      ]);

      const loadCoverImg = async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      };

      const makeBlueCover = (baseImg) => {
        const c = document.createElement('canvas');
        c.width = baseImg.naturalWidth || 512;
        c.height = baseImg.naturalHeight || 512;
        const ctx = c.getContext('2d');
        ctx.filter = 'hue-rotate(175deg) saturate(1.25)';
        ctx.drawImage(baseImg, 0, 0, c.width, c.height);
        return c;
      };

      const awakeCover = await loadCoverImg('/awake-cover');
      const demoCover = await loadCoverImg('/alt-cover');
      const blueCoverCanvas = makeBlueCover(awakeCover);
      const blueCover = await loadCoverImg(blueCoverCanvas.toDataURL('image/jpeg', 0.95));

      const [audio] = await Promise.all([
        fetch('/bc-audio').then(r => r.arrayBuffer()),
        loadFonts('/fonts/'),
      ]);

      const awakeSong = await prepareSong({
        id: 20261021,
        name: 'Beautiful Creatures',
        artists: ['ILLENIUM', 'MAX'],
        audio: audio.slice(0),
        cover: awakeCover,
        lyric: { lrc: { lyric: lrc } },
      }, { pause: yieldToPage });

      const blueSong = await prepareSong({
        id: 20261022,
        name: 'Beautiful Creatures (Blue Shift)',
        artists: ['ILLENIUM', 'MAX'],
        audio: audio.slice(0),
        cover: blueCover,
        lyric: { lrc: { lyric: lrc } },
      }, { pause: yieldToPage });

      const demoSong = await prepareSong({
        id: 20261023,
        name: 'Beautiful Creatures (Alt Demo Cover)',
        artists: ['ILLENIUM', 'MAX'],
        audio: audio.slice(0),
        cover: demoCover,
        lyric: { lrc: { lyric: lrc } },
      }, { pause: yieldToPage });

      const stage = document.createElement('div');
      stage.style.cssText = `width:${width}px;height:${height}px;position:absolute;left:0;top:0;overflow:hidden;background:#000`;
      document.body.innerHTML = '';
      document.body.append(stage);

      const player = new MvPlayer(stage, 1);
      player.hud.visible = false;

      const cropCanvas = document.createElement('canvas');
      const cropCtx = cropCanvas.getContext('2d');

      window.CAPTURE_PROBE = {
        player,
        async activateSong(key, variant = 'stage') {
          const songMap = { awake: awakeSong, blue: blueSong, demo: demoSong };
          const s = songMap[key];
          player.load(
            s,
            styleFor(s, 'pulse'),
            new Set(),
            { scene: 'phoenix', variants: [variant] },
            'none',
            0,
            20261021,
          );
          await player.warm(yieldToPage);
        },
        renderFrame(t, opts = {}) {
          const prevOverlay = player.director.overlay.scene.visible;
          const phoenixScene = player.scenes?.phoenix;
          const prevRig = phoenixScene ? phoenixScene.rig?.group?.visible : true;
          if (opts.clean) {
            player.director.overlay.scene.visible = false;
            if (phoenixScene?.rig?.group) phoenixScene.rig.group.visible = false;
          }
          player.frame(t - 1 / 30, 1 / 30);
          player.frame(t, 1 / 30);
          const domCanvas = player.engine.renderer.domElement;
          const fullB64 = domCanvas.toDataURL('image/png').split(',')[1];

          const crops = {};
          if (opts.crops) {
            // 1. Speaker Zoom (左侧音箱 2 倍放大)
            const ls = phoenixScene?.uniforms?.uLeftSpeaker?.value || { x: 0.176, y: 0.532 };
            const lx = ls.x * 1920, ly = (1 - ls.y) * 1080;
            cropCanvas.width = 960;
            cropCanvas.height = 960;
            cropCtx.clearRect(0, 0, 960, 960);
            cropCtx.drawImage(domCanvas, lx - 240, ly - 260, 480, 480, 0, 0, 960, 960);
            crops.speakerZoom = cropCanvas.toDataURL('image/png').split(',')[1];

            // 2. Speaker Full (两侧音箱组合)
            cropCanvas.width = 1280;
            cropCanvas.height = 720;
            cropCtx.clearRect(0, 0, 1280, 720);
            cropCtx.drawImage(domCanvas, 0, 120, 640, 720, 0, 0, 640, 720);
            cropCtx.drawImage(domCanvas, 1280, 120, 640, 720, 640, 0, 640, 720);
            crops.speaker = cropCanvas.toDataURL('image/png').split(',')[1];

            // 3. Phoenix Body (中央火凤)
            cropCanvas.width = 960;
            cropCanvas.height = 720;
            cropCtx.clearRect(0, 0, 960, 720);
            cropCtx.drawImage(domCanvas, 480, 40, 960, 720, 0, 0, 960, 720);
            crops.phoenix = cropCanvas.toDataURL('image/png').split(',')[1];

            // 4. Head Zoom (凤凰头颈特写 4 倍放大)
            const phx = phoenixScene?.uniforms?.uPhoenixPos?.value || { x: 0.5, y: 0.5 };
            const cx = phx.x * 1920, cy = (1 - phx.y) * 1080;
            cropCanvas.width = 1280;
            cropCanvas.height = 720;
            cropCtx.clearRect(0, 0, 1280, 720);
            cropCtx.drawImage(domCanvas, cx - 160, cy - 110, 320, 180, 0, 0, 1280, 720);
            crops.head = cropCanvas.toDataURL('image/png').split(',')[1];

            // 5. Water Floor (水面反射)
            cropCanvas.width = 1600;
            cropCanvas.height = 500;
            cropCtx.clearRect(0, 0, 1600, 500);
            cropCtx.drawImage(domCanvas, 160, 560, 1600, 500, 0, 0, 1600, 500);
            crops.water = cropCanvas.toDataURL('image/png').split(',')[1];
          }

          player.director.overlay.scene.visible = prevOverlay;
          if (phoenixScene?.rig?.group) phoenixScene.rig.group.visible = prevRig;

          return { fullB64, crops };
        }
      };
    }, { lrc: lrcText, width, height });

    await page.evaluate(() => window.CAPTURE_PROBE.activateSong('awake', 'stage'));

    // 1. drop1_downstroke (t=91.15) with crops
    const resDown = await page.evaluate(() => window.CAPTURE_PROBE.renderFrame(91.15, { clean: true, crops: true }));
    const fDown = path.join(outDir, `${mode}-drop1_downstroke-full.png`);
    const bufDown = Buffer.from(resDown.fullB64, 'base64');
    await fs.writeFile(fDown, bufDown);
    manifest.renders['drop1_downstroke-full'] = { path: fDown, sha256: sha256(bufDown) };

    for (const [cropName, b64] of Object.entries(resDown.crops)) {
      const cBuf = Buffer.from(b64, 'base64');
      const cFile = path.join(outDir, `${mode}-drop1_downstroke-${cropName}.png`);
      await fs.writeFile(cFile, cBuf);
      manifest.renders[`drop1_downstroke-${cropName}`] = { path: cFile, sha256: sha256(cBuf) };
      console.log(`[${mode}] Saved crop: ${mode}-drop1_downstroke-${cropName}.png (${sha256(cBuf).slice(0, 12)}...)`);
    }

    // 2. drop1_upstroke (t=91.42)
    const resUp = await page.evaluate(() => window.CAPTURE_PROBE.renderFrame(91.42, { clean: true, crops: false }));
    const fUp = path.join(outDir, `${mode}-drop1_upstroke-full.png`);
    const bufUp = Buffer.from(resUp.fullB64, 'base64');
    await fs.writeFile(fUp, bufUp);
    manifest.renders['drop1_upstroke-full'] = { path: fUp, sha256: sha256(bufUp) };

    // 3. drop1_peak (t=95.80)
    const resPeak = await page.evaluate(() => window.CAPTURE_PROBE.renderFrame(95.80, { clean: true, crops: false }));
    const fPeak = path.join(outDir, `${mode}-drop1_peak-full.png`);
    const bufPeak = Buffer.from(resPeak.fullB64, 'base64');
    await fs.writeFile(fPeak, bufPeak);
    manifest.renders['drop1_peak-full'] = { path: fPeak, sha256: sha256(bufPeak) };

    // 4. drop1_vocal_fusion / lyrics (t=103.85)
    const resVocal = await page.evaluate(() => window.CAPTURE_PROBE.renderFrame(103.85, { clean: false, crops: false }));
    const fVocal = path.join(outDir, `${mode}-drop1_vocal_fusion-full.png`);
    const bufVocal = Buffer.from(resVocal.fullB64, 'base64');
    await fs.writeFile(fVocal, bufVocal);
    manifest.renders['drop1_vocal_fusion-full'] = { path: fVocal, sha256: sha256(bufVocal) };

    // 5. Alternate blue cover (t=91.15)
    await page.evaluate(() => window.CAPTURE_PROBE.activateSong('blue', 'stage'));
    const resBlue = await page.evaluate(() => window.CAPTURE_PROBE.renderFrame(91.15, { clean: true, crops: false }));
    const fBlue = path.join(outDir, `${mode}-alt-blue-full.png`);
    const bufBlue = Buffer.from(resBlue.fullB64, 'base64');
    await fs.writeFile(fBlue, bufBlue);
    manifest.renders['alt-blue-full'] = { path: fBlue, sha256: sha256(bufBlue) };

    // 6. Alternate demo cover (t=91.15)
    await page.evaluate(() => window.CAPTURE_PROBE.activateSong('demo', 'stage'));
    const resDemo = await page.evaluate(() => window.CAPTURE_PROBE.renderFrame(91.15, { clean: true, crops: false }));
    const fDemo = path.join(outDir, `${mode}-alt-demo-full.png`);
    const bufDemo = Buffer.from(resDemo.fullB64, 'base64');
    await fs.writeFile(fDemo, bufDemo);
    manifest.renders['alt-demo-full'] = { path: fDemo, sha256: sha256(bufDemo) };

    await fs.writeFile(path.join(outDir, `${mode}-manifest.json`), JSON.stringify(manifest, null, 2));
    console.log(`[${mode}] All renders saved to ${outDir}`);

  } finally {
    await browser?.close();
    await app.close();
  }

  return manifest;
}

// ── STEP 1: Backup Candidate & Switch to Baseline ──
console.log('--- Step 1: Backing up Candidate & Switching to Baseline ---');
const candSource = await fs.readFile(currentPhoenixPath);
await fs.writeFile(candidateBakPath, candSource);
const baseSource = await fs.readFile(baselineBakPath);
await fs.writeFile(currentPhoenixPath, baseSource);

let baseManifest;
let candManifest;

try {
  baseManifest = await captureMode('before', baseRendersDir);
} finally {
  // ── STEP 2: Restore Candidate ──
  console.log('\n--- Step 2: Restoring Candidate & Capturing After ---');
  await fs.writeFile(currentPhoenixPath, candSource);
}

candManifest = await captureMode('after', afterRendersDir);

// ── STEP 3: Stitching Comparisons & Validating Hashes ──
console.log('\n--- Step 3: Stitching Comparisons & Validating Hashes ---');
const pairs = [
  ['before-drop1_downstroke-full.png', 'after-drop1_downstroke-full.png', 'compare-drop1_downstroke-full.png', 'Drop1 下振翼 全景对比'],
  ['before-drop1_downstroke-head.png', 'after-drop1_downstroke-head.png', 'compare-drop1_downstroke-head.png', '凤凰头颈眼喙与覆羽 4x特写对比'],
  ['before-drop1_downstroke-speakerZoom.png', 'after-drop1_downstroke-speakerZoom.png', 'compare-drop1_downstroke-speakerZoom.png', '音箱防尘帽与凹面发光 2x特写对比'],
  ['before-drop1_downstroke-phoenix.png', 'after-drop1_downstroke-phoenix.png', 'compare-drop1_downstroke-phoenix.png', '中央火凤与祭坛对比'],
  ['before-drop1_downstroke-speaker.png', 'after-drop1_downstroke-speaker.png', 'compare-drop1_downstroke-speaker.png', '两侧巨型音箱舞台对称分布对比'],
  ['before-drop1_downstroke-water.png', 'after-drop1_downstroke-water.png', 'compare-drop1_downstroke-water.png', '湿润混凝土水面反射对比'],
  ['before-drop1_vocal_fusion-full.png', 'after-drop1_vocal_fusion-full.png', 'compare-drop1_vocal_fusion-full.png', '人声段色彩融合对比'],
  ['before-alt-blue-full.png', 'after-alt-blue-full.png', 'compare-alt-blue-full.png', '蓝调电子专辑泛化换色全景对比'],
  ['before-alt-demo-full.png', 'after-alt-demo-full.png', 'compare-alt-demo-full.png', 'Demo专辑多色调泛化换色全景对比'],
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const hashReportLines = [
  `# PHOENIX-LEAD-COLOR-18 最终渲染与哈希校验报告`,
  `生成时间: ${new Date().toISOString()}`,
  `Baseline phoenix.ts SHA256: ${baseManifest.phoenixSourceSha256}`,
  `Candidate phoenix.ts SHA256: ${candManifest.phoenixSourceSha256}`,
  ``,
  `| 对比项 | Before 文件名 (SHA256) | After 文件名 (SHA256) | 状态 |`,
  `| :--- | :--- | :--- | :--- |`
];

let allDiffer = true;

for (const [beforeName, afterName, outName, desc] of pairs) {
  const beforePath = path.join(baseRendersDir, beforeName);
  const afterPath = path.join(afterRendersDir, afterName);
  const [bBuf, aBuf] = await Promise.all([fs.readFile(beforePath), fs.readFile(afterPath)]);
  const bSha = sha256(bBuf);
  const aSha = sha256(aBuf);

  if (bSha === aSha) {
    allDiffer = false;
    console.error(`CRITICAL ERROR: Before and After hashes are identical for ${desc}! (${bSha})`);
    hashReportLines.push(`| ${desc} | ${beforeName} (${bSha.slice(0, 10)}...) | ${afterName} (${aSha.slice(0, 10)}...) | ❌ 异常相同 |`);
  } else {
    console.log(`OK: ${desc} hashes differ (Before: ${bSha.slice(0, 10)}... vs After: ${aSha.slice(0, 10)}...)`);
    hashReportLines.push(`| ${desc} | ${beforeName} (${bSha.slice(0, 10)}...) | ${afterName} (${aSha.slice(0, 10)}...) | ✅ 差异确凿 |`);
  }

  // Stitch
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

    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(20, 20, 360, 52);
    ctx.fillRect(w + 20, 20, 360, 52);
    ctx.fillStyle = '#ffeedd';
    ctx.fillText(labelA, 35, 58);
    ctx.fillText(labelB, w + 35, 58);

    return canvas.toDataURL('image/png').split(',')[1];
  }, { b64A: bBuf.toString('base64'), b64B: aBuf.toString('base64'), labelA: '基线版本 (Baseline Before)', labelB: '返工修复版本 (Candidate After)' });

  const outPath = path.join(afterRendersDir, outName);
  await fs.writeFile(outPath, Buffer.from(stitchedB64, 'base64'));
  console.log(`Saved comparison stitched image: ${outName}`);
}

await browser.close();

const finalHashesTxt = path.join(afterRendersDir, '../final-hashes.txt');
await fs.writeFile(finalHashesTxt, hashReportLines.join('\n'));
console.log(`\nHash validation report written to ${finalHashesTxt}`);

if (!allDiffer) {
  throw new Error('FAILURE: Some Before/After images still had identical hashes!');
} else {
  console.log('ALL PAIRS PASSED: Every single Before/After pair has a verified distinct SHA256!');
}
