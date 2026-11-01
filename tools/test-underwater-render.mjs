import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import { PROJECT, loadSettings, startServer } from '../exporter/server.mjs';

const outDir = path.resolve('exports/underwater-test');
await fs.mkdir(outDir, { recursive: true });

const audioPath = 'D:/野葱视频转换器/音频转换/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).mp3';
const coverPath = 'C:/Users/86137/.gemini/antigravity/brain/d6a5e869-cea4-42c3-8daa-26ed19bac60c/.user_uploaded/media_1792386445314_25173fb1.png';

console.log('读取音频与专辑封面...');
const [audioBuf, coverBuf] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(coverPath),
]);

console.log(`音频大小: ${(audioBuf.length / (1024 * 1024)).toFixed(2)} MB, 封面大小: ${(coverBuf.length / 1024).toFixed(2)} KB`);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5218,
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
    if (u.pathname === '/underwater-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/underwater-cover') return r.fulfill({ body: coverBuf, contentType: 'image/png' });
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

  console.log('加载播放测试环境...');
  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  console.log('正在执行音频分析与渲染器初始化...');
  const initResult = await page.evaluate(async () => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }, { Music }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
      import('/src/director/music.ts'),
    ]);

    const cover = new Image();
    cover.src = '/underwater-cover';
    await cover.decode();

    const [audio] = await Promise.all([
      fetch('/underwater-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const song = await prepareSong({
      id: 999001,
      name: 'Underneath The Waves',
      artists: ['Last Heroes', 'Monika Santucci'],
      audio,
      cover,
      lyric: {
        lrc: {
          lyric: `[00:00.00]Underneath The Waves\n[00:39.70]Build up to the deep\n[01:19.44]Underneath the waves tonight\n[01:30.00]Submerged in sound`,
        },
      },
    }, { pause: yieldToPage });

    const stage = document.createElement('div');
    stage.style.cssText = 'width:1280px;height:720px;position:absolute;left:0;top:0';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;

    // 加载歌曲并强制使用 underwater 场景
    player.load(
      song,
      styleFor(song, 'pulse'),
      new Set(),
      { scene: 'underwater', variants: ['dive', 'canyon', 'orbit'] },
      'none',
      0,
      999001,
    );

    await player.warm(yieldToPage);

    window.UNDERWATER_PROBE = {
      player,
      song,
      renderAt(t) {
        player.frame(t, 1 / 30);
        const gl = player.engine.renderer.getContext();
        gl.finish();
        return player.engine.renderer.domElement.toDataURL('image/png').split(',')[1];
      },
    };

    return {
      duration: song.duration,
      sections: song.analysis.sections.map(s => ({ label: s.label, start: s.start, end: s.end, energy: s.energy })),
      shots: player.director.shots.map(s => ({ start: s.start, end: s.end, scene: s.scene, variant: s.variant, label: s.section.label })),
    };
  });

  console.log(`歌曲解析完成，段落数: ${initResult.sections.length}，镜头数: ${initResult.shots.length}`);
  const dropSection = initResult.sections.find(s => s.label === 'drop');
  console.log('Drop 段落:', dropSection);

  // 关键时间点采样
  // Drop 1 位于 79.44s
  const checkTimes = [
    { t: 78.5, label: '01_pre_dive_surface', desc: '进入Drop前夕（水面之上蓄力俯视）' },
    { t: 79.5, label: '02_submerge_plunge', desc: '进入Drop冲破水面瞬间（破水白光与绽放）' },
    { t: 81.0, label: '03_deep_pillars_glow', desc: '深海石道与符文石柱能量槽高亮发光' },
    { t: 83.0, label: '04_bubbles_burst', desc: '底鼓重拍触发眼前晶莹透明气泡喷涌与浮动' },
    { t: 86.0, label: '05_ancient_archway', desc: '穿越深海水下石拱门与发光石柱群' },
  ];

  console.log('\n=== 开始提取关键帧截图 ===');
  for (const item of checkTimes) {
    console.log(`渲染时刻 t=${item.t.toFixed(2)}s (${item.desc})...`);
    // 预热两帧
    await page.evaluate(t => {
      window.UNDERWATER_PROBE.player.frame(t - 1 / 30, 1 / 30);
    }, item.t);

    const b64 = await page.evaluate(t => {
      return window.UNDERWATER_PROBE.renderAt(t);
    }, item.t);

    const filePath = path.join(outDir, `${item.label}.png`);
    await fs.writeFile(filePath, Buffer.from(b64, 'base64'));
    console.log(`  -> 已保存: ${filePath}`);
  }

  // 录制一段 Drop 瞬间的 MP4 视频（77s - 85s，共 8 秒，30fps）
  console.log('\n=== 录制 Drop 进水高潮演示片段 (77s - 85s) ===');
  const videoFile = path.join(outDir, 'underwater-drop-demo.mp4');
  const fps = 30;
  const startT = 77.0;
  const endT = 85.0;
  const totalFrames = Math.round((endT - startT) * fps);

  const ff = spawn(ffmpeg, [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-r', String(fps),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    videoFile,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let ffErr = '';
  ff.stderr.on('data', d => ffErr += d.toString());

  console.log(`正在渲染合成 ${totalFrames} 帧...`);
  for (let f = 0; f < totalFrames; f++) {
    const t = startT + f / fps;
    const b64 = await page.evaluate(t => window.UNDERWATER_PROBE.renderAt(t), t);
    ff.stdin.write(Buffer.from(b64, 'base64'));
    if (f % 30 === 0) {
      process.stdout.write(`进度: ${Math.round((f / totalFrames) * 100)}%\r`);
    }
  }
  ff.stdin.end();

  const [code] = await once(ff, 'close');
  if (code !== 0) {
    console.error('FFmpeg 视频合成失败:', ffErr);
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

console.log('\n全部水下场景特效检测完成！');
process.exit(0);
