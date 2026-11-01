// 暗涌水廊 (velvet) 与微醺 (VELVET) 风格真机 WebGL2 / D3D11 渲染核验脚本：
// 覆盖 4 组丝滑机位 (lounge / skim / platter / gallery)、正拍侧链微收 vs 反拍开镲膨胀、冷暖双色封面自适应、
// 下三分之一歌词防遮挡排版、380px 紧凑设置面板 UI 以及 8 秒 30fps 原声 MP4 连续录制。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { loadSettings, startServer } from '../exporter/server.mjs';

const outDir = path.resolve('../exports/velvet-deep-house-20261030');
await fs.mkdir(outDir, { recursive: true });

const houseAudioPath = 'D:/NCM/BetterNCM/export-jobs/4a56e06f-1647-4204-b5d5-825e2ca9d643/audio.bin';
const warmCoverPath = 'D:/NCM/BetterNCM/export-jobs/4a56e06f-1647-4204-b5d5-825e2ca9d643/cover.image';
const coolCoverPath = 'D:/NCM/BetterNCM/export-jobs/04a52732-bdae-438f-ab04-f9723c197ff8/cover.image';
const pinkCoverPath = 'D:/NCM/BetterNCM/export-jobs/2b89aae0-228f-48b3-b38a-5110e2184e89/cover.image';
const vocalAudioPath = 'D:/CloudMusic/LIONE,The Chainsmokers,Halsey - Closer (LIONE Remix).mp3';
const vocalLrcPath = 'D:/CloudMusic/LIONE,The Chainsmokers,Halsey - Closer (LIONE Remix).lrc';

console.log('读取 House 音频、人声 LRC 与暖/冷/粉三套专辑封面...');
const [houseAudioBuf, warmCoverBuf, coolCoverBuf, pinkCoverBuf, vocalAudioBuf, vocalLrcText] = await Promise.all([
  fs.readFile(houseAudioPath),
  fs.readFile(warmCoverPath),
  fs.readFile(coolCoverPath),
  fs.readFile(pinkCoverPath),
  fs.readFile(vocalAudioPath),
  fs.readFile(vocalLrcPath, 'utf8'),
]);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5238,
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
    args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/house-audio') return r.fulfill({ body: houseAudioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/warm-cover') return r.fulfill({ body: warmCoverBuf, contentType: 'image/jpeg' });
    if (u.pathname === '/cool-cover') return r.fulfill({ body: coolCoverBuf, contentType: 'image/jpeg' });
    if (u.pathname === '/pink-cover') return r.fulfill({ body: pinkCoverBuf, contentType: 'image/jpeg' });
    if (u.pathname === '/vocal-audio') return r.fulfill({ body: vocalAudioBuf, contentType: 'audio/mpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  page.on('pageerror', e => {
    errors.push(e.message);
    console.error('[PAGEERROR]', e.message);
  });
  page.on('console', m => {
    if (m.type() === 'error') {
      errors.push(m.text());
      console.error('[CONSOLE ERROR]', m.text());
    }
  });

  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  console.log('正在分析 4/4 浩室电钢琴曲目并初始化 VelvetScene (暗涌水廊)...');
  const probeInfo = await page.evaluate(async () => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }, { extractCoverTone }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
      import('/src/scenes/coverTone.ts'),
    ]);

    const loadImg = async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return img;
    };

    const [warmCover, coolCover, houseAudio] = await Promise.all([
      loadImg('/warm-cover'),
      loadImg('/cool-cover'),
      fetch('/house-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const houseSong = await prepareSong({
      id: 20261030,
      name: 'Midnight Velvet Groove',
      artists: ['David Guetta', 'Avicii'],
      audio: houseAudio,
      cover: warmCover,
      lyric: null,
      wiki: { genres: ['电子-深邃浩室'], tags: ['深夜', '微醺'], language: '纯音乐' },
    }, { pause: yieldToPage });

    const coolSong = await prepareSong({
      id: 20261031,
      name: 'Midnight Indigo Lounge',
      artists: ['Blue Eternal'],
      audio: houseAudio,
      cover: coolCover,
      lyric: null,
      wiki: { genres: ['Deep House'], tags: ['深夜', '放松'], language: '纯音乐' },
    }, {
      pause: yieldToPage,
      analysis: async () => houseSong.analysis,
    });

    const stage = document.createElement('div');
    stage.style.cssText = 'width:1280px;height:720px;position:absolute;left:0;top:0;overflow:hidden;background:#000';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;

    // 核验默认自动风格编排
    player.load(houseSong, styleFor(houseSong, 'auto'), new Set(), undefined, 'none', 0, 20261030);
    await player.warm(yieldToPage);

    const autoShots = player.shots.map(s => ({
      start: +s.start.toFixed(2),
      end: +s.end.toFixed(2),
      scene: s.scene,
      variant: s.variant,
      label: s.section.label,
    }));

    // 寻找强底鼓拍点用于验证光学侧链抽吸 vs 反拍开镲膨胀
    const activeSec = houseSong.analysis.sections.find(s => s.label === 'drop' || s.label === 'chorus')
      ?? houseSong.analysis.sections[Math.floor(houseSong.analysis.sections.length / 2)];
    const midTarget = activeSec.start + Math.min(12, (activeSec.end - activeSec.start) * 0.35);
    const strongKick = houseSong.analysis.hits.kick.find(h => h[0] >= midTarget && h[1] > 0.45)?.[0] ?? midTarget;
    const beatSec = 60 / Math.max(60, houseSong.analysis.bpm);

    window.VELVET_TEST = {
      player,
      houseSong,
      coolSong,
      styleFor,
      yieldToPage,
      loadImg,
      prepareSong,
      async loadOnly(songObj, variantList) {
        player.load(
          songObj,
          styleFor(songObj, 'velvet'),
          new Set(['cards', 'crystal', 'canvas']),
          { scene: 'velvet', variants: variantList },
          'none',
          0,
          20261030,
        );
        await player.warm(yieldToPage);
      },
      renderPng(t, clean = true) {
        const prevOverlay = player.director.overlay.scene.visible;
        if (clean) player.director.overlay.scene.visible = false;
        player.frame(t - 1 / 30, 1 / 30);
        player.frame(t, 1 / 30);
        const gl = player.engine.renderer.getContext();
        gl.finish();
        const b64 = player.engine.renderer.domElement.toDataURL('image/png').split(',')[1];
        const velvetScene = player.scenes.velvet;
        const uniforms = velvetScene ? {
          sidechain: +velvetScene.uniforms.uSidechain.value.toFixed(3),
          kickPunch: +velvetScene.uniforms.uKickPunch.value.toFixed(3),
          offbeatHat: +velvetScene.uniforms.uOffbeatHat.value.toFixed(3),
          keysGlow: +velvetScene.uniforms.uKeysGlow.value.toFixed(3),
          filterOpen: +velvetScene.uniforms.uFilterOpen.value.toFixed(3),
        } : null;
        player.director.overlay.scene.visible = prevOverlay;
        return { b64, lost: player.engine.isContextLost(), uniforms };
      },
    };

    const warmTone = extractCoverTone(houseSong);
    const coolTone = extractCoverTone(coolSong);
    return {
      choiceStyle: houseSong.choice.style.id,
      choiceReason: houseSong.choice.reason,
      bpm: houseSong.analysis.bpm,
      duration: houseSong.duration,
      strongKick: +strongKick.toFixed(3),
      beatSec: +beatSec.toFixed(4),
      warmHue: +warmTone.mainHue.toFixed(1),
      coolHue: +coolTone.mainHue.toFixed(1),
      autoVelvetShots: autoShots.filter(s => s.scene === 'velvet').slice(0, 6),
    };
  });

  console.log('自动识别与色调信息:', JSON.stringify(probeInfo, null, 2));
  assert.equal(probeInfo.choiceStyle, 'velvet', '深邃浩室曲目必须自动选入 velvet (微醺) 风格');

  const kT = probeInfo.strongKick;
  const bSec = probeInfo.beatSec;

  // 1. 渲染 lounge 主视角关键帧（同时用于生成 velvet.webp 预览图）
  await page.evaluate(() => window.VELVET_TEST.loadOnly(window.VELVET_TEST.houseSong, ['lounge']));
  const rLounge = await page.evaluate(t => window.VELVET_TEST.renderPng(t, true), kT + bSec * 0.48);
  assert.equal(rLounge.lost, false);
  const loungePath = path.join(outDir, '01_velvet_lounge_hero.png');
  await fs.writeFile(loungePath, Buffer.from(rLounge.b64, 'base64'));
  console.log('01_velvet_lounge_hero.png uniforms:', JSON.stringify(rLounge.uniforms));

  // 2. 渲染 skim 低掠水面视角：对比正拍底鼓微收 (t = kT + 0.025s) vs 反拍开镲膨胀 (t = kT + 0.50 * beat)
  await page.evaluate(() => window.VELVET_TEST.loadOnly(window.VELVET_TEST.houseSong, ['skim']));
  const rDuck = await page.evaluate(t => window.VELVET_TEST.renderPng(t, true), kT + 0.025);
  const rBloom = await page.evaluate(t => window.VELVET_TEST.renderPng(t, true), kT + bSec * 0.50);
  await fs.writeFile(path.join(outDir, '02_velvet_skim_kick_duck.png'), Buffer.from(rDuck.b64, 'base64'));
  await fs.writeFile(path.join(outDir, '03_velvet_skim_offbeat_bloom.png'), Buffer.from(rBloom.b64, 'base64'));
  console.log('02_kick_duck uniforms:', JSON.stringify(rDuck.uniforms));
  console.log('03_offbeat_bloom uniforms:', JSON.stringify(rBloom.uniforms));
  assert.ok(rBloom.uniforms.sidechain > rDuck.uniforms.sidechain, '反拍侧链回弹亮度应显著高于正拍底鼓微收瞬间');

  // 3. 渲染冷色封面下的 platter 斜侧黑胶唱针特写
  await page.evaluate(() => window.VELVET_TEST.loadOnly(window.VELVET_TEST.coolSong, ['platter']));
  const rCool = await page.evaluate(t => window.VELVET_TEST.renderPng(t, true), kT + bSec * 1.48);
  await fs.writeFile(path.join(outDir, '04_velvet_platter_cool_cover.png'), Buffer.from(rCool.b64, 'base64'));
  console.log('04_cool_cover uniforms:', JSON.stringify(rCool.uniforms));

  // 4. 渲染带人声歌词的 gallery 宽幅玻璃光栅机位（验证下三分之一歌词不遮挡中央悬浮黑胶封面）
  const rLyrics = await page.evaluate(async (lrc) => {
    const { loadImg, prepareSong, yieldToPage } = window.VELVET_TEST;
    const [pinkCover, vocalAudio] = await Promise.all([
      loadImg('/pink-cover'),
      fetch('/vocal-audio').then(r => r.arrayBuffer()),
    ]);
    const vocalSong = await prepareSong({
      id: 20261032,
      name: 'Closer (LIONE Remix)',
      artists: ['The Chainsmokers', 'Halsey', 'LIONE'],
      audio: vocalAudio,
      cover: pinkCover,
      lyric: { lrc: { lyric: lrc } },
      wiki: { genres: ['Deep House'], tags: ['深夜', '浪漫'] },
    }, { pause: yieldToPage });
    await window.VELVET_TEST.loadOnly(vocalSong, ['gallery']);
    const sungLine = vocalSong.lines.find(l => l.start > 22 && l.text.trim().length > 8) ?? vocalSong.lines[2];
    const targetT = (sungLine.start + sungLine.end) * 0.5;
    return window.VELVET_TEST.renderPng(targetT, false);
  }, vocalLrcText);
  await fs.writeFile(path.join(outDir, '05_velvet_gallery_lyrics.png'), Buffer.from(rLyrics.b64, 'base64'));
  console.log('05_gallery_lyrics uniforms:', JSON.stringify(rLyrics.uniforms));

  // 5. 切回 House 曲目的 velvet 编排（循环展示 lounge -> skim -> platter），录制 8 秒 30fps 原声 MP4
  await page.evaluate(() => window.VELVET_TEST.loadOnly(window.VELVET_TEST.houseSong, ['lounge', 'skim', 'platter', 'gallery']));
  const mp4Path = path.join(outDir, 'velvet-deep-house-groove.mp4');
  const fps = 30;
  const clipStart = Math.max(0, kT - 0.5);
  const clipDur = 8.0;
  const totalFrames = Math.round(clipDur * fps);
  console.log(`正在录制 8 秒 30fps 暗涌水廊原声核验视频 (${clipStart.toFixed(2)}s - ${(clipStart + clipDur).toFixed(2)}s, ${totalFrames} 帧)...`);

  const ff = spawn(ffmpeg, [
    '-y', '-f', 'image2pipe', '-vcodec', 'png', '-r', String(fps), '-i', 'pipe:0',
    '-ss', String(clipStart), '-t', String(clipDur), '-i', houseAudioPath,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', mp4Path,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  for (let f = 0; f < totalFrames; f++) {
    const t = clipStart + f / fps;
    const b64 = await page.evaluate(t => {
      const p = window.VELVET_TEST.player;
      p.frame(t, 1 / 30);
      p.engine.renderer.getContext().finish();
      return p.engine.renderer.domElement.toDataURL('image/png').split(',')[1];
    }, t);
    ff.stdin.write(Buffer.from(b64, 'base64'));
  }
  ff.stdin.end();
  const [ffCode] = await once(ff, 'close');
  assert.equal(ffCode, 0, 'ffmpeg 编码 MP4 应正常退出');

  // 使用 ffprobe 校验生成的 MP4 流信息
  const probeRaw = execFileSync(ffprobe.path, [
    '-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration', '-of', 'json', mp4Path,
  ], { encoding: 'utf8' });
  console.log('MP4 ffprobe 核验结果:', probeRaw.trim());

  // 6. 同步生成 480x270 的 public/previews/velvet.webp 预览缩略图，并在 380px 设置抽屉中截图验证 UI
  const previewWebp = path.resolve('public/previews/velvet.webp');
  execFileSync(ffmpeg, [
    '-y', '-i', loungePath, '-vf', 'scale=480:270:flags=lanczos', '-c:v', 'libwebp', '-quality', '82', previewWebp,
  ], { stdio: 'ignore' });
  console.log('已生成场景预览图:', previewWebp);

  // 在同一浏览器上下文打开独立页面检验 380px 紧凑设置面板 UI（微醺按钮 + 暗涌水廊卡片）
  const uiPage = await context.newPage();
  await uiPage.goto(app.baseUrl + '/tools/lead-preview.html');
  await uiPage.evaluate(async () => {
    window.plugin = {
      getConfig: (_k, def) => def,
      setConfig: () => {},
    };
    const { settingsView } = await import('/src/plugin/ui.ts');
    document.body.style.cssText = 'margin:0;background:#141418;display:flex;justify-content:center;align-items:flex-start;padding:16px;min-height:720px';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:380px;background:rgba(28,28,31,0.94);border-radius:14px;padding-top:12px;box-shadow:0 16px 48px rgba(0,0,0,0.5)';
    const cfg = {
      style: 'velvet',
      quality: 'high',
      latencyMs: 0,
      songVisualDelays: {},
      button: true,
      controls: true,
      off: [],
      offLooks: [],
      lyricDelays: {},
      localLrcPaths: {},
      arrange: 'random',
      fpsCap: 0,
      prefetch: false,
      keys: { toggle: 'Ctrl+Shift+KeyM', exit: 'Escape', playPause: 'Space', back: 'ArrowLeft', forward: 'ArrowRight', volUp: 'ArrowUp', volDown: 'ArrowDown' },
    };
    const view = settingsView(cfg, () => {}, async id => `/previews/${id}.webp`, true);
    wrap.append(view);
    document.body.append(wrap);
    await new Promise(r => setTimeout(r, 350));
  });
  await uiPage.screenshot({ path: path.join(outDir, '06_velvet_settings_style_row.png') });
  await uiPage.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.bmv-tile-name'));
    const target = tiles.find(el => el.textContent?.includes('暗涌水廊'));
    target?.scrollIntoView({ block: 'center' });
  });
  await uiPage.waitForTimeout(300);
  await uiPage.screenshot({ path: path.join(outDir, '07_velvet_settings_scene_tile.png') });
  await uiPage.close();

  assert.equal(errors.length, 0, `渲染期发现异常: ${errors.join('; ')}`);
  console.log('全部 WebGL2/D3D11 关键帧、MP4 与 UI 核验渲染圆满完成！');
} finally {
  if (browser) await browser.close();
  try {
    if (app.server) app.server.close();
    if (app.vite) await app.vite.close();
  } catch {}
}
process.exit(0);
