import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import { PROJECT, loadSettings, startServer } from '../exporter/server.mjs';

const outDir = path.resolve('../exports/Underwater-review-20261019-remodel');
await fs.mkdir(outDir, { recursive: true });

const audioPath = 'D:/野葱视频转换器/音频转换/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).mp3';
const coverPath = 'C:/Users/86137/.gemini/antigravity/brain/d6a5e869-cea4-42c3-8daa-26ed19bac60c/.user_uploaded/media_1792386445314_25173fb1.png';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).lrc';

console.log('读取音频、封面与LRC歌词...');
const [audioBuf, coverBuf, lrcText] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(coverPath),
  fs.readFile(lrcPath, 'utf8').catch(() => `[00:00.00]Underneath The Waves\n[01:19.44]Underneath the waves tonight\n[01:30.00]Submerged in sound`),
]);

console.log(`音频: ${(audioBuf.length / (1024 * 1024)).toFixed(2)} MB, 封面: ${(coverBuf.length / 1024).toFixed(2)} KB`);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5228,
    jobDir: path.join(outDir, 'jobs'),
    outputDir: outDir,
  },
});

let browser;

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
    if (u.pathname === '/remodel-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/remodel-cover') return r.fulfill({ body: coverBuf, contentType: 'image/png' });
    return r.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  page.on('pageerror', e => console.error('[PAGE ERROR]', e.message));
  page.on('console', m => {
    if (m.type() === 'error') console.log('[CONSOLE ERROR]', m.text());
  });

  console.log('加载渲染环境...');
  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  const songMeta = await page.evaluate(async (lrc) => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
    ]);

    const cover = new Image();
    cover.src = '/remodel-cover';
    await cover.decode();

    const [audio] = await Promise.all([
      fetch('/remodel-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const song = await prepareSong({
      id: 999002,
      name: 'Underneath The Waves',
      artists: ['Last Heroes', 'Monika Santucci'],
      audio,
      cover,
      lyric: { lrc: { lyric: lrc } },
    }, { pause: yieldToPage });

    const stage = document.createElement('div');
    stage.style.cssText = 'width:1280px;height:720px;position:absolute;left:0;top:0';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;

    player.load(
      song,
      styleFor(song, 'pulse'),
      new Set(),
      { scene: 'underwater', variants: ['dive'] },
      'none',
      0,
      999002,
    );
    await player.warm(yieldToPage);

    window.VERIFY_ENV = {
      player,
      song,
      switchVariant(variant) {
        player.load(
          song,
          styleFor(song, 'pulse'),
          new Set(),
          { scene: 'underwater', variants: [variant] },
          'none',
          0,
          999002,
        );
      },
      renderFrame(t) {
        player.frame(t - 1 / 30, 1 / 30);
        player.frame(t, 1 / 30);
        const gl = player.engine.renderer.getContext();
        gl.finish();
        const cam = player.scenes.underwater.camera;
        return {
          camPos: [cam.position.x, cam.position.y, cam.position.z],
          png: player.engine.renderer.domElement.toDataURL('image/png').split(',')[1],
        };
      },
    };

    const drop = song.analysis.sections.find(s => s.label === 'drop');
    return {
      dropStart: drop.start,
      dropEnd: drop.end,
      dropDuration: drop.end - drop.start,
    };
  }, lrcText);

  console.log(`Drop 首个高潮段落: ${songMeta.dropStart.toFixed(3)}s - ${songMeta.dropEnd.toFixed(3)}s (持续 ${songMeta.dropDuration.toFixed(2)}s)`);

  // 1. 验证整个 26.5 秒 Drop 进程中，空间连续性（解决第 8/12/20 秒驶离布景问题）
  console.log('\n=== 1. 验证完整 Drop 期间空间与布景连续性 ===');
  const dropTimes = [
    { offset: 0.0, label: '00_drop_start_surface', desc: '入水前夕水面上空 (shotT=0s)' },
    { offset: 1.2, label: '01_drop_submerge_plunge', desc: '冲破水面瞬间 (shotT=1.2s)' },
    { offset: 4.0, label: '02_drop_level_out', desc: '入水拉平平滑穿行 (shotT=4s)' },
    { offset: 8.0, label: '03_drop_canyon_arch1', desc: '穿越第一巨大岩桥 (shotT=8s, 昔日驶离起点)' },
    { offset: 12.0, label: '04_drop_stratified_cliffs', desc: '宏伟层叠断崖群 (shotT=12s, 昔日空空如也点)' },
    { offset: 18.0, label: '05_drop_cross_arch2', desc: '穿越第二宏伟横向岩桥 (shotT=18s)' },
    { offset: 24.0, label: '06_drop_deep_abyss_monoliths', desc: '深海石道与远海溶洞 (shotT=24s)' },
    { offset: 26.2, label: '07_drop_climax_end', desc: 'Drop结尾深邃海景 (shotT=26.2s)' },
  ];

  for (const item of dropTimes) {
    const t = songMeta.dropStart + item.offset;
    const res = await page.evaluate(t => window.VERIFY_ENV.renderFrame(t), t);
    console.log(`  [${item.label}] t=${t.toFixed(2)}s -> 相机位置: [${res.camPos.map(x => x.toFixed(2)).join(', ')}] (${item.desc})`);
    await fs.writeFile(path.join(outDir, `${item.label}.png`), Buffer.from(res.png, 'base64'));
  }

  // 2. 验证各个变体（orbit, canyon, abyss）的稳定景别
  console.log('\n=== 2. 验证各镜头变体 (canyon, orbit, abyss) ===');
  for (const variant of ['canyon', 'orbit', 'abyss']) {
    await page.evaluate(v => window.VERIFY_ENV.switchVariant(v), variant);
    const t = songMeta.dropStart + 6.0;
    const res = await page.evaluate(t => window.VERIFY_ENV.renderFrame(t), t);
    console.log(`  [variant: ${variant}] t=${t.toFixed(2)}s -> 相机位置: [${res.camPos.map(x => x.toFixed(2)).join(', ')}]`);
    await fs.writeFile(path.join(outDir, `variant_${variant}.png`), Buffer.from(res.png, 'base64'));
  }

  // 切回 dive 录制视频
  await page.evaluate(() => window.VERIFY_ENV.switchVariant('dive'));

  // 3. 录制全新改造后的完整首个 Drop 原声视频 (79.0s - 106.0s，共 27 秒，30fps)
  console.log('\n=== 3. 录制全新改造后完整 27 秒 Drop 演示视频 ===');
  const videoFile = path.join(outDir, '水下石柱-重构后完整Drop-演示.mp4');
  const fps = 30;
  const startT = songMeta.dropStart - 0.5;
  const endT = songMeta.dropEnd + 0.5;
  const totalFrames = Math.round((endT - startT) * fps);

  // 提取对应时间区间的音频切片
  const tempAudio = path.join(outDir, 'drop-audio-slice.wav');
  await new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, [
      '-y',
      '-ss', String(startT),
      '-to', String(endT),
      '-i', audioPath,
      '-ac', '2',
      '-ar', '44100',
      tempAudio,
    ]);
    p.on('close', code => code === 0 ? resolve() : reject(new Error('audio slice failed')));
  });

  const ff = spawn(ffmpeg, [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-r', String(fps),
    '-i', 'pipe:0',
    '-i', tempAudio,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '17',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    videoFile,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let ffErr = '';
  ff.stderr.on('data', d => ffErr += d.toString());

  console.log(`正在逐帧渲染并压制 ${totalFrames} 帧...`);
  for (let f = 0; f < totalFrames; f++) {
    const t = startT + f / fps;
    const b64 = await page.evaluate(t => {
      const res = window.VERIFY_ENV.renderFrame(t);
      return res.png;
    }, t);
    ff.stdin.write(Buffer.from(b64, 'base64'));
    if (f % 45 === 0) {
      process.stdout.write(`进度: ${Math.round((f / totalFrames) * 100)}%\r`);
    }
  }
  ff.stdin.end();

  const [code] = await once(ff, 'close');
  if (code !== 0) {
    console.error('FFmpeg 视频压制失败:', ffErr);
  } else {
    console.log(`\n视频生成成功: ${videoFile}`);
  }

} finally {
  if (browser) await browser.close();
  try {
    if (app.server) app.server.close();
    if (app.vite) await app.vite.close();
  } catch {}
}

console.log('\n全部重构后验证完成！');
process.exit(0);
