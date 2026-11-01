import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import { loadSettings, startServer } from '../exporter/server.mjs';

const modeArg = process.argv.find(a => a.startsWith('--mode='))?.slice(7) || 'before';
const recordVideo = process.argv.includes('--video');
const stateRoot = 'D:/NCM/state/phoenix-lead-color-20261023';
const framesArg = process.argv.find(a => a.startsWith('--frames='))?.slice(9);
const skipAlt = process.argv.includes('--no-alt');
const outDir = path.join(stateRoot, modeArg === 'before' ? 'baseline/renders' : 'verification/renders');
await fs.mkdir(outDir, { recursive: true });

const audioPath = 'D:/野葱视频转换器/音频转换/ILLENIUM,MAX - Beautiful Creatures.mp3';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/ILLENIUM,MAX - Beautiful Creatures.lrc';
const awakeCoverPath = path.join(stateRoot, 'baseline/awake-cover.jpg');
const altCoverPath = 'D:/NCM/NCM-BetterMV-0.9.0/tools/previews/demo-cover.jpg';

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

const [audioBuf, lrcText, awakeCoverBuf, altCoverBuf, phoenixSourceBuf] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(lrcPath, 'utf8'),
  fs.readFile(awakeCoverPath),
  fs.readFile(altCoverPath),
  fs.readFile('D:/NCM/NCM-BetterMV-0.9.0/src/scenes/phoenix.ts'),
]);

console.log(`[${modeArg}] phoenix.ts SHA256: ${sha256(phoenixSourceBuf)}`);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5246,
    jobDir: path.join(outDir, 'jobs'),
    outputDir: outDir,
  },
});

let browser;
const errors = [];

try {
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
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
  page.setDefaultTimeout(240000);
  page.on('pageerror', e => {
    errors.push(e.message);
    console.error('PAGE ERROR:', e.message);
  });
  page.on('console', m => {
    if (m.type() === 'error') {
      errors.push(m.text());
      console.error('CONSOLE ERROR:', m.text());
    }
  });

  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  const initInfo = await page.evaluate(async ({ lrc, width, height }) => {
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

    // Synthesize a vivid cool-blue/cyan electronic cover image in-memory as well so we test both demo-cover and a pure cool-blue album cover
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
      name: 'Beautiful Creatures (Cyan Palette Test)',
      artists: ['ILLENIUM', 'MAX'],
      audio: audio.slice(0),
      cover: blueCover,
      lyric: { lrc: { lyric: lrc } },
    }, { pause: yieldToPage });

    const demoSong = await prepareSong({
      id: 20261023,
      name: 'Beautiful Creatures (Demo Cover Test)',
      artists: ['ILLENIUM', 'MAX'],
      audio: audio.slice(0),
      cover: demoCover,
      lyric: { lrc: { lyric: lrc } },
    }, { pause: yieldToPage });

    const stage = document.createElement('div');
    stage.style.cssText = `width:${width}px;height:${height}px;position:absolute;left:0;top:0`;
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;

    const cropCanvas = document.createElement('canvas');
    const cropCtx = cropCanvas.getContext('2d');

    window.VERIFY_PROBE = {
      player,
      songs: { awake: awakeSong, blue: blueSong, demo: demoSong },
      styleFor,
      yieldToPage,
      async activateSong(songKey, variant = 'stage') {
        const song = this.songs[songKey];
        player.load(
          song,
          styleFor(song, 'pulse'),
          new Set(),
          { scene: 'phoenix', variants: [variant] },
          'none',
          0,
          20261021,
        );
        await player.warm(yieldToPage);
        return extractCoverTone(song);
      },
      renderFrame(t, opts = {}) {
        const prevOverlay = player.director.overlay.scene.visible;
        const phoenixScene = player.scenes.phoenix;
        const prevRig = phoenixScene ? phoenixScene.rig.group.visible : true;
        if (opts.clean) {
          player.director.overlay.scene.visible = false;
          if (phoenixScene) phoenixScene.rig.group.visible = false;
        }
        player.frame(t - 1 / 30, 1 / 30);
        player.frame(t, 1 / 30);
        const gl = player.engine.renderer.getContext();
        gl.finish();
        const domCanvas = player.engine.renderer.domElement;
        const mime = opts.jpeg ? 'image/jpeg' : 'image/png';
        const fullB64 = domCanvas.toDataURL(mime, 0.92).split(',')[1];

        const crops = {};
        if (opts.crops) {
          // 1. Left & Right speakers crop: left speaker (x: 0..640, y: 120..840) + right speaker (x: 1280..1920, y: 120..840)
          cropCanvas.width = 1280;
          cropCanvas.height = 720;
          cropCtx.clearRect(0, 0, 1280, 720);
          cropCtx.drawImage(domCanvas, 0, 120, 640, 720, 0, 0, 640, 720);
          cropCtx.drawImage(domCanvas, 1280, 120, 640, 720, 640, 0, 640, 720);
          crops.speaker = cropCanvas.toDataURL('image/png').split(',')[1];

          // 2. Phoenix & Central Cover crop: center stage (x: 480..1440, y: 40..760)
          cropCanvas.width = 960;
          cropCanvas.height = 720;
          cropCtx.clearRect(0, 0, 960, 720);
          cropCtx.drawImage(domCanvas, 480, 40, 960, 720, 0, 0, 960, 720);
          crops.phoenix = cropCanvas.toDataURL('image/png').split(',')[1];

          // 3. Water Floor & Meditator crop: lower center & speaker reflections (x: 160..1760, y: 560..1060)
          cropCanvas.width = 1600;
          cropCanvas.height = 500;
          cropCtx.clearRect(0, 0, 1600, 500);
          cropCtx.drawImage(domCanvas, 160, 560, 1600, 500, 0, 0, 1600, 500);
          crops.water = cropCanvas.toDataURL('image/png').split(',')[1];

          // 4. 凤凰头颈与胸羽 4 倍放大 (围绕凤凰中心)
          const phx = phoenixScene ? phoenixScene.uniforms.uPhoenixPos.value : { x: 0.5, y: 0.5 };
          const cx = phx.x * 1920, cy = (1 - phx.y) * 1080;
          cropCanvas.width = 1280;
          cropCanvas.height = 720;
          cropCtx.imageSmoothingQuality = 'high';
          cropCtx.clearRect(0, 0, 1280, 720);
          cropCtx.drawImage(domCanvas, cx - 160, cy - 110, 320, 180, 0, 0, 1280, 720);
          crops.head = cropCanvas.toDataURL('image/png').split(',')[1];

          // 5. 左侧音箱 2 倍放大
          const ls = phoenixScene ? phoenixScene.uniforms.uLeftSpeaker.value : { x: 0.176, y: 0.532 };
          const lx = ls.x * 1920, ly = (1 - ls.y) * 1080;
          cropCanvas.width = 960;
          cropCanvas.height = 960;
          cropCtx.clearRect(0, 0, 960, 960);
          cropCtx.drawImage(domCanvas, lx - 240, ly - 260, 480, 480, 0, 0, 960, 960);
          crops.speakerZoom = cropCanvas.toDataURL('image/png').split(',')[1];
        }

        player.director.overlay.scene.visible = prevOverlay;
        if (phoenixScene) phoenixScene.rig.group.visible = prevRig;

        const uniforms = phoenixScene ? {
          speakerPulse: +phoenixScene.uniforms.uSpeakerPulse.value.toFixed(3),
          speakerBass: +phoenixScene.uniforms.uSpeakerBass.value.toFixed(3),
          fireDistribution: +phoenixScene.uniforms.uFireDistribution.value.toFixed(3),
          fireSize: +phoenixScene.uniforms.uFireSize.value.toFixed(3),
          fireBrightness: +phoenixScene.uniforms.uFireBrightness.value.toFixed(3),
          leadShareB: +phoenixScene.uniforms.uLeadShareB.value.toFixed(3),
          colorFusion: +phoenixScene.uniforms.uColorFusion.value.toFixed(3),
          leadGlow: +phoenixScene.uniforms.uLeadGlow.value.toFixed(3),
          leadPulse: +phoenixScene.uniforms.uLeadPulse.value.toFixed(3),
          lightPulse: +phoenixScene.uniforms.uLightPulse.value.toFixed(3),
          wingPhase: +phoenixScene.uniforms.uWingPhase.value.toFixed(3),
          phoenixPos: [
            +phoenixScene.uniforms.uPhoenixPos.value.x.toFixed(3),
            +phoenixScene.uniforms.uPhoenixPos.value.y.toFixed(3),
          ],
          leftSpeaker: [
            +phoenixScene.uniforms.uLeftSpeaker.value.x.toFixed(3),
            +phoenixScene.uniforms.uLeftSpeaker.value.y.toFixed(3),
          ],
          rightSpeaker: [
            +phoenixScene.uniforms.uRightSpeaker.value.x.toFixed(3),
            +phoenixScene.uniforms.uRightSpeaker.value.y.toFixed(3),
          ],
        } : null;

        return { fullB64, crops, uniforms };
      },
      trackSummary() {
        const sc = player.scenes.phoenix;
        const tr = sc.leadTrack;
        const song = this.songs.awake;
        const step = 2; // 15 fps 摘要
        const pick = arr => Array.from({ length: Math.floor(arr.length / step) }, (_, i) => +arr[i * step].toFixed(3));
        return {
          fps: tr.fps / step,
          shareB: pick(tr.shareB), fusion: pick(tr.fusion), vocal: pick(tr.vocal), energy: pick(tr.energy),
          dominantB: Array.from({ length: Math.floor(tr.dominantB.length / step) }, (_, i) => tr.dominantB[i * step]),
          sections: sc.init.music.a.sections.map(x => [x.label, +x.start.toFixed(2), +x.end.toFixed(2), x.vocal]),
          leadA: sc.uniforms.uLeadA.value.map(v => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]),
          leadB: sc.uniforms.uLeadB.value.map(v => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]),
        };
      },
    };

    return {
      awakeTone: extractCoverTone(awakeSong),
      blueTone: extractCoverTone(blueSong),
      demoTone: extractCoverTone(demoSong),
    };
  }, { lrc: lrcText, width, height });

  console.log('Cover tones:', JSON.stringify({
    awakeMainHue: +initInfo.awakeTone.mainHue.toFixed(1),
    blueMainHue: +initInfo.blueTone.mainHue.toFixed(1),
    demoMainHue: +initInfo.demoTone.mainHue.toFixed(1),
  }));

  await page.evaluate(() => window.VERIFY_PROBE.activateSong('awake', 'stage'));
  const summary = await page.evaluate(() => window.VERIFY_PROBE.trackSummary());
  await fs.writeFile(path.join(outDir, `${modeArg}-lead-track.json`), JSON.stringify(summary));
  console.log('Lead colors A:', JSON.stringify(summary.leadA), 'B:', JSON.stringify(summary.leadB));
  console.log('Sections:', JSON.stringify(summary.sections));

  const defaultFrames = [
    { t: 91.15, tag: 'drop1_downstroke', clean: true, withCrops: true },
    { t: 91.42, tag: 'drop1_upstroke', clean: true, withCrops: false },
    { t: 95.80, tag: 'drop1_peak', clean: true, withCrops: false },
    { t: 103.85, tag: 'drop1_lyrics', clean: false, withCrops: false },
  ];
  const keyFrames = framesArg
    ? framesArg.split(',').map(x => { const [t, tag, crops] = x.split(':'); return { t: +t, tag, clean: true, withCrops: crops === 'c' }; })
    : defaultFrames;

  const manifest = {
    mode: modeArg,
    phoenixSourceSha256: sha256(phoenixSourceBuf),
    renders: {},
  };

  for (const kf of keyFrames) {
    const res = await page.evaluate(({ t, clean, withCrops }) =>
      window.VERIFY_PROBE.renderFrame(t, { clean, crops: withCrops }), kf);
    const fullBuf = Buffer.from(res.fullB64, 'base64');
    const fullFile = path.join(outDir, `${modeArg}-${kf.tag}-full.png`);
    await fs.writeFile(fullFile, fullBuf);
    manifest.renders[`${kf.tag}-full`] = { path: fullFile, sha256: sha256(fullBuf), uniforms: res.uniforms };

    if (kf.withCrops) {
      for (const [cropName, b64] of Object.entries(res.crops)) {
        const cBuf = Buffer.from(b64, 'base64');
        const cFile = path.join(outDir, `${modeArg}-${kf.tag}-${cropName}.png`);
        await fs.writeFile(cFile, cBuf);
        manifest.renders[`${kf.tag}-${cropName}`] = { path: cFile, sha256: sha256(cBuf) };
      }
    }
    console.log(`[${modeArg}] Saved ${kf.tag} | uniforms:`, JSON.stringify(res.uniforms));
  }

  // Render alternate album palettes (blue/cyan and demo cover) at the exact same timestamp t=91.15
  for (const altKey of (skipAlt ? [] : ['blue', 'demo'])) {
    await page.evaluate(k => window.VERIFY_PROBE.activateSong(k, 'stage'), altKey);
    const res = await page.evaluate(() => window.VERIFY_PROBE.renderFrame(91.15, { clean: true, crops: false }));
    const buf = Buffer.from(res.fullB64, 'base64');
    const fPath = path.join(outDir, `${modeArg}-alt-${altKey}-full.png`);
    await fs.writeFile(fPath, buf);
    manifest.renders[`alt-${altKey}-full`] = { path: fPath, sha256: sha256(buf), uniforms: res.uniforms };
    console.log(`[${modeArg}] Saved alt-${altKey}-full.png`);
  }

  if (recordVideo) {
    await page.evaluate(() => window.VERIFY_PROBE.activateSong('awake', 'stage'));
    const clipStart = 90.0;
    const clipDuration = 8.0;
    const fps = 30;
    const totalFrames = Math.round(clipDuration * fps);
    const mp4Path = path.join(outDir, `${modeArg}-phoenix-stage-playback.mp4`);
    console.log(`[${modeArg}] Recording ${clipDuration}s continuous playback video (${totalFrames} frames -> ${mp4Path})...`);

    const ff = spawn(ffmpeg, [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-framerate', String(fps),
      '-i', '-',
      '-ss', String(clipStart),
      '-t', String(clipDuration),
      '-i', audioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      mp4Path,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });

    let ffErr = '';
    ff.stderr.on('data', d => { ffErr += d.toString(); });

    for (let i = 0; i < totalFrames; i++) {
      const t = clipStart + i / fps;
      const { fullB64 } = await page.evaluate(time => window.VERIFY_PROBE.renderFrame(time, { jpeg: true, clean: false }), t);
      const buf = Buffer.from(fullB64, 'base64');
      if (!ff.stdin.write(buf)) {
        await once(ff.stdin, 'drain');
      }
      if ((i + 1) % 60 === 0 || i === totalFrames - 1) {
        console.log(`  video frame ${i + 1}/${totalFrames} (t=${t.toFixed(2)}s)`);
      }
    }
    ff.stdin.end();
    const [code] = await once(ff, 'close');
    if (code !== 0) {
      throw new Error(`FFmpeg exited with ${code}: ${ffErr.slice(-500)}`);
    }
    const mp4Buf = await fs.readFile(mp4Path);
    manifest.renders.video = { path: mp4Path, sha256: sha256(mp4Buf), bytes: mp4Buf.length };
    console.log(`[${modeArg}] Saved video: ${mp4Path} (${mp4Buf.length} bytes)`);
  }

  await fs.writeFile(path.join(outDir, `${modeArg}-manifest.json`), JSON.stringify(manifest, null, 2));
  if (errors.length > 0) {
    throw new Error(`Browser errors encountered: ${errors.join('; ')}`);
  }
} finally {
  await browser?.close();
  await app.close();
}
