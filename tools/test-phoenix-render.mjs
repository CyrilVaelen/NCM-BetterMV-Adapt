import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import { loadSettings, startServer } from '../exporter/server.mjs';

const outDir = path.resolve('../exports/phoenix-beautiful-creatures-drop');
await fs.mkdir(outDir, { recursive: true });

const audioPath = 'D:/野葱视频转换器/音频转换/ILLENIUM,MAX - Beautiful Creatures.mp3';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/ILLENIUM,MAX - Beautiful Creatures.lrc';
const coverPath = 'C:/Users/86137/.gemini/antigravity/brain/0daf44c5-ae1d-4bc4-9363-ae0858fe199d/.user_uploaded/media_1792587627346_257094fd.jpg';

console.log('读取 ILLENIUM,MAX - Beautiful Creatures 音频、LRC 与 Awake 专辑封面...');
const [audioBuf, lrcText, coverBuf] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(lrcPath, 'utf8'),
  fs.readFile(coverPath),
]);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5232,
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/bc-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/bc-cover') return r.fulfill({ body: coverBuf, contentType: 'image/jpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') {
      errors.push(m.text());
      console.log('BROWSER ERROR: ' + m.text());
    }
  });

  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  console.log('正在执行 Beautiful Creatures 音频分析、封面色调提取与 PhoenixScene 初始化...');
  const initResult = await page.evaluate(async (lrc) => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }, { extractCoverTone }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
      import('/src/scenes/coverTone.ts'),
    ]);

    const cover = new Image();
    cover.src = '/bc-cover';
    await cover.decode();

    const [audio] = await Promise.all([
      fetch('/bc-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const song = await prepareSong({
      id: 20261021,
      name: 'Beautiful Creatures',
      artists: ['ILLENIUM', 'MAX'],
      audio,
      cover,
      lyric: { lrc: { lyric: lrc } },
    }, { pause: yieldToPage });

    const coverTone = extractCoverTone(song);

    const stage = document.createElement('div');
    stage.style.cssText = 'width:1280px;height:720px;position:absolute;left:0;top:0';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;

    // 默认自动编排镜头验证 Drop 1 / Drop 2
    player.load(song, styleFor(song, 'pulse'), new Set(), undefined, 'none', 0, 20261021);
    const autoShots = player.director.shots.map(s => ({
      start: +s.start.toFixed(2),
      end: +s.end.toFixed(2),
      scene: s.scene,
      variant: s.variant,
      label: s.section.label,
    }));

    window.MV_PROBE = {
      player,
      song,
      styleFor,
      yieldToPage,
      async switchScene(sceneId, variants) {
        player.load(
          song,
          styleFor(song, 'pulse'),
          new Set(),
          { scene: sceneId, variants },
          'none',
          0,
          20261021,
        );
        await player.warm(yieldToPage);
      },
      renderAt(t, opts = {}) {
        const prevOverlay = player.director.overlay.scene.visible;
        const phoenixScene = player.scenes.phoenix;
        const prevRig = phoenixScene ? phoenixScene.rig.group.visible : true;
        if (opts.clean) {
          player.director.overlay.scene.visible = false;
          if (phoenixScene) phoenixScene.rig.group.visible = false;
        }
        player.frame(t, 1 / 30);
        const gl = player.engine.renderer.getContext();
        gl.finish();
        const mime = opts.jpeg ? 'image/jpeg' : 'image/png';
        const b64 = player.engine.renderer.domElement.toDataURL(mime, 0.92).split(',')[1];
        player.director.overlay.scene.visible = prevOverlay;
        if (phoenixScene) phoenixScene.rig.group.visible = prevRig;
        const uniforms = phoenixScene ? {
          speakerPulse: +phoenixScene.uniforms.uSpeakerPulse.value.toFixed(3),
          fireDistribution: +phoenixScene.uniforms.uFireDistribution.value.toFixed(3),
          fireSize: +phoenixScene.uniforms.uFireSize.value.toFixed(3),
          fireBrightness: +phoenixScene.uniforms.uFireBrightness.value.toFixed(3),
          wingPhase: +phoenixScene.uniforms.uWingPhase.value.toFixed(3),
          phoenixPos: [
            +phoenixScene.uniforms.uPhoenixPos.value.x.toFixed(3),
            +phoenixScene.uniforms.uPhoenixPos.value.y.toFixed(3),
          ],
        } : null;
        return { b64, uniforms };
      },
    };

    return {
      duration: song.duration,
      sections: song.analysis.sections.map(s => ({
        label: s.label,
        start: +s.start.toFixed(2),
        end: +s.end.toFixed(2),
        energy: +s.energy.toFixed(2),
      })),
      coverTone: {
        mainHue: +coverTone.mainHue.toFixed(1),
        deepHue: +coverTone.deepHue.toFixed(1),
        highHue: +coverTone.highHue.toFixed(1),
        satScale: +coverTone.satScale.toFixed(2),
      },
      autoDrops: autoShots.filter(s => s.label === 'drop'),
    };
  }, lrcText);

  console.log('段落分析结果:', JSON.stringify(initResult.sections));
  console.log('提取到的专辑封面色调 (CoverTone):', JSON.stringify(initResult.coverTone));
  console.log('自动编排下的 Drop 镜头:', JSON.stringify(initResult.autoDrops));

  console.log('\n正在切换至「涅槃舞台 (phoenix)」场景并渲染关键验证帧...');
  await page.evaluate(() => window.MV_PROBE.switchScene('phoenix', ['stage', 'soar', 'sonic', 'altar']));

  const checkFrames = [
    { t: 88.20, label: '01_pre_drop_calm', clean: true },
    { t: 91.15, label: '02_drop1_blast_downstroke', clean: true },
    { t: 91.42, label: '03_drop1_wing_upstroke', clean: true },
    { t: 95.80, label: '04_drop1_soundwaves_peak', clean: true },
    { t: 103.85, label: '05_drop1_with_lyrics', clean: false },
    { t: 192.40, label: '06_drop2_climax_soar', clean: false },
  ];

  for (const item of checkFrames) {
    await page.evaluate(t => window.MV_PROBE.player.frame(t - 1 / 30, 1 / 30), item.t);
    const res = await page.evaluate(({ t, clean }) => window.MV_PROBE.renderAt(t, { clean }), item);
    const filePath = path.join(outDir, `${item.label}.png`);
    await fs.writeFile(filePath, Buffer.from(res.b64, 'base64'));
    console.log(`已保存核验帧: ${item.label}.png | 参数:`, JSON.stringify(res.uniforms));
  }

  // 导出 Beautiful Creatures Drop 1 15秒视频片段 (88.5s -> 103.5s, 30fps)
  if (!process.env.SKIP_MP4) {
    const clipStart = 88.5;
  const clipDuration = 15.0;
  const fps = 30;
  const totalFrames = Math.round(clipDuration * fps);
  const mp4Path = path.join(outDir, 'phoenix_beautiful_creatures_drop.mp4');
  console.log(`\n正在合成 ${clipDuration}s Drop 预览视频 (${totalFrames} 帧 -> ${mp4Path})...`);

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
    const { b64 } = await page.evaluate(time => window.MV_PROBE.renderAt(time, { jpeg: true, clean: false }), t);
    const buf = Buffer.from(b64, 'base64');
    if (!ff.stdin.write(buf)) {
      await once(ff.stdin, 'drain');
    }
    if ((i + 1) % 90 === 0 || i === totalFrames - 1) {
      console.log(`  已渲染视频帧 ${i + 1}/${totalFrames} (t=${t.toFixed(2)}s)`);
    }
  }
  ff.stdin.end();
  const [code] = await once(ff, 'close');
  if (code !== 0) {
    throw new Error(`FFmpeg 退出码 ${code}: ${ffErr.slice(-500)}`);
  }
    console.log(`已成功导出 Drop 预览视频: ${mp4Path}`);
  }

  assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
} finally {
  if (browser) await browser.close();
  try {
    if (app.server) app.server.close();
    if (app.vite) await app.vite.close();
  } catch {}
}
process.exit(0);
