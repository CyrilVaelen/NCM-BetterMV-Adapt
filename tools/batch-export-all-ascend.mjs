import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import { loadSettings, startServer } from '../exporter/server.mjs';

const mp3Dir = 'E:/MP3/ILLENIUM3/Ascend';
const outDir = 'D:/NCM/exports';
await fs.mkdir(outDir, { recursive: true });

// 17 首歌曲完整切片配置（高潮 Drop + 前一句 vocal + 结束后 2.0s）
// 严禁高潮前和结束后出现激光舞台！高潮阶段强制激光舞台！
const TRACKS = [
  {
    file: 'All Together.mp3',
    name: 'All Together',
    artists: ['ILLENIUM', 'OI:MI'],
    songId: 1384496795,
    clipStart: 71.93,
    dropStart: 73.81,
    dropEnd: 88.58,
    clipEnd: 90.58,
    lastVocal: 'All together',
    preScene: 'starry',
    dropScene: 'laser',
    postScene: 'tunnel',
  },
  {
    file: 'Blood.mp3',
    name: 'Blood',
    artists: ['ILLENIUM', 'Foy Vance'],
    songId: 1384492895,
    clipStart: 63.96,
    dropStart: 64.91,
    dropEnd: 89.88,
    clipEnd: 91.88,
    lastVocal: "We're blood",
    preScene: 'underwater',
    dropScene: 'laser',
    postScene: 'tunnel',
  },
  {
    file: 'Broken Ones.mp3',
    name: 'Broken Ones',
    artists: ['ILLENIUM', 'Anna Henderson'],
    songId: 1384496797,
    clipStart: 55.73,
    dropStart: 56.99,
    dropEnd: 83.18,
    clipEnd: 85.18,
    lastVocal: "Here's to the broken ones",
    preScene: 'cathedral',
    dropScene: 'laser',
    postScene: 'clouds',
  },
  {
    file: 'Crashing.mp3',
    name: 'Crashing',
    artists: ['ILLENIUM', 'Bahari'],
    songId: 1384496796,
    clipStart: 61.65,
    dropStart: 64.97,
    dropEnd: 84.97,
    clipEnd: 86.97,
    lastVocal: "So I'm crashing here tonight",
    preScene: 'highway',
    dropScene: 'laser',
    postScene: 'drive',
  },
  {
    file: 'Every Piece Of Me.mp3',
    name: 'Every Piece Of Me',
    artists: ['ILLENIUM', 'Echos'],
    songId: 1384492896,
    clipStart: 62.48,
    dropStart: 65.42,
    dropEnd: 87.24,
    clipEnd: 89.24,
    lastVocal: 'So why are you still trying to take me down',
    preScene: 'aurora',
    dropScene: 'laser',
    postScene: 'particles',
  },
  {
    file: 'Good Things Fall Apart.mp3',
    name: 'Good Things Fall Apart',
    artists: ['ILLENIUM', 'Jon Bellion'],
    songId: 1384492894,
    clipStart: 43.21,
    dropStart: 50.39,
    dropEnd: 77.06,
    clipEnd: 79.06,
    lastVocal: 'Messing with my head, whoa',
    preScene: 'sunset',
    dropScene: 'laser',
    postScene: 'clouds',
  },
  {
    file: 'Gorgeous.mp3',
    name: 'Gorgeous',
    artists: ['ILLENIUM', 'Bipolar Sunshine'],
    songId: 1384496800,
    clipStart: 104.50,
    dropStart: 106.64,
    dropEnd: 127.45,
    clipEnd: 129.45,
    lastVocal: "And it's gor-",
    preScene: 'phoenix',
    dropScene: 'laser',
    postScene: 'tunnel',
  },
  {
    file: 'Hold On (ILLENIUM).mp3',
    name: 'Hold On',
    artists: ['ILLENIUM', 'Georgia Ku'],
    songId: 1384492893,
    clipStart: 61.89,
    dropStart: 64.48,
    dropEnd: 89.97,
    clipEnd: 91.97,
    lastVocal: 'Why do I hold on to you?',
    preScene: 'velvet',
    dropScene: 'laser',
    postScene: 'drive',
  },
  {
    file: 'In Your Arms.mp3',
    name: 'In Your Arms',
    artists: ['ILLENIUM', 'X Ambassadors'],
    songId: 1384492898,
    clipStart: 66.43,
    dropStart: 70.31,
    dropEnd: 83.28,
    clipEnd: 85.28,
    lastVocal: "That's right where I'm supposed to be",
    preScene: 'fountain',
    dropScene: 'laser',
    postScene: 'rings',
  },
  {
    file: 'Lonely.mp3',
    name: 'Lonely',
    artists: ['ILLENIUM', 'Chandler Leighton'],
    songId: 1384492900,
    clipStart: 78.00,
    dropStart: 82.57,
    dropEnd: 103.21,
    clipEnd: 105.21,
    lastVocal: "Won't you let me love the lonely...",
    preScene: 'starry',
    dropScene: 'laser',
    postScene: 'cathedral',
  },
  {
    file: 'Pray.mp3',
    name: 'Pray',
    artists: ['ILLENIUM', 'Kameron Alexander'],
    songId: 1384496799,
    clipStart: 104.32,
    dropStart: 105.18,
    dropEnd: 131.49,
    clipEnd: 133.49,
    lastVocal: 'Mercy, mercy, mercy',
    preScene: 'eclipse',
    dropScene: 'laser',
    postScene: 'tunnel',
  },
  {
    file: 'Sad Songs Fall Apart.mp3',
    name: 'Sad Songs Fall Apart',
    artists: ['ILLENIUM', 'Said The Sky', 'Annika Wells'],
    songId: 1454864598,
    clipStart: 287.85,
    dropStart: 289.56,
    dropEnd: 316.00,
    clipEnd: 318.00,
    lastVocal: "I'll be writing sad songs",
    preScene: 'blackhole',
    dropScene: 'laser',
    postScene: 'underwater',
  },
  {
    file: 'Sad Songs.mp3',
    name: 'Sad Songs',
    artists: ['ILLENIUM', 'Said The Sky', 'Annika Wells'],
    songId: 1384492897,
    clipStart: 145.52,
    dropStart: 147.18,
    dropEnd: 173.67,
    clipEnd: 175.67,
    lastVocal: "I'll be writing sad songs",
    preScene: 'clouds',
    dropScene: 'laser',
    postScene: 'shatter',
  },
  {
    file: 'Take You Down (Nurko Remix).mp3',
    name: 'Take You Down (Nurko Remix)',
    artists: ['ILLENIUM', 'Nurko'],
    songId: 1448419923,
    clipStart: 87.39,
    dropStart: 89.61,
    dropEnd: 114.87,
    clipEnd: 116.87,
    lastVocal: 'Take you down with me',
    preScene: 'drive',
    dropScene: 'laser',
    postScene: 'tunnel',
  },
  {
    file: 'Take You Down.mp3',
    name: 'Take You Down',
    artists: ['ILLENIUM'],
    songId: 1384496794,
    clipStart: 67.05,
    dropStart: 71.68,
    dropEnd: 102.74,
    clipEnd: 104.74,
    lastVocal: 'Take you down with me',
    preScene: 'sunset',
    dropScene: 'laser',
    postScene: 'aurora',
  },
  {
    file: 'Takeaway.mp3',
    name: 'Takeaway',
    artists: ['The Chainsmokers', 'ILLENIUM', 'Lennon Stella'],
    songId: 1384496798,
    clipStart: 81.93,
    dropStart: 85.69,
    dropEnd: 100.09,
    clipEnd: 102.09,
    lastVocal: 'Your heart for takeaway...',
    preScene: 'pavilion',
    dropScene: 'laser',
    postScene: 'rings',
  },
  {
    file: 'That’s Why.mp3',
    name: 'That’s Why',
    artists: ['ILLENIUM', 'GOLDN'],
    songId: 1384496793,
    clipStart: 60.83,
    dropStart: 68.58,
    dropEnd: 82.29,
    clipEnd: 84.29,
    lastVocal: "That's why, I don't try",
    preScene: 'city',
    dropScene: 'laser',
    postScene: 'tunnel',
  },
];

console.log(`========================================================================`);
console.log(`  ILLENIUM - ASCEND 专辑高潮切片视频批量导出系统 (1440p 60fps HEVC QSV)`);
console.log(`  曲目总数: ${TRACKS.length} 首`);
console.log(`  输出目录: ${outDir}`);
console.log(`========================================================================`);

// 读取本地已缓存的分析元数据（如歌词等）
let localAnalysis = {};
try {
  localAnalysis = JSON.parse(await fs.readFile('D:/NCM/state/ascend_analysis.json', 'utf8'));
} catch (e) {
  console.warn('Could not read ascend_analysis.json, fallback to online lyric fetching');
}

// 启动常驻 HTTP 帧流服务 (port 5345)
let activeEncoder = null;
let framesReceived = 0;
let totalTargetFrames = 0;
let lastLogTime = Date.now();

const frameServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url === '/push-frame' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const buf = Buffer.concat(chunks);
      if (activeEncoder && activeEncoder.stdin.writable) {
        if (!activeEncoder.stdin.write(buf)) {
          await once(activeEncoder.stdin, 'drain');
        }
        framesReceived++;
        if (Date.now() - lastLogTime >= 2000 || framesReceived === totalTargetFrames) {
          lastLogTime = Date.now();
          const pct = ((framesReceived / totalTargetFrames) * 100).toFixed(1);
          console.log(`  [Progress] Frame ${framesReceived}/${totalTargetFrames} (${pct}%)`);
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise(r => frameServer.listen(5345, '127.0.0.1', r));

// 启动常驻 BetterMV 导出渲染服务器 (port 5346)
const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5346,
  },
  useVite: true,
});

// 启动常驻 Edge/Chromium 浏览器
const width = 2560;
const height = 1440;
const fps = 60;

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: [
    '--use-angle=d3d11',
    '--enable-gpu-rasterization',
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
  ],
});

const exportSummary = [];

try {
  let trackIndex = 0;
  for (const track of TRACKS) {
    trackIndex++;
    const safeBaseName = path.parse(track.file).name;
    const outFileName = `${safeBaseName}-Ascend-LaserDrop-1440p60.mp4`;
    const outputPath = path.join(outDir, outFileName);

    console.log(`\n------------------------------------------------------------------------`);
    console.log(`[${trackIndex}/${TRACKS.length}] 正在处理: ${track.name} (${track.file})`);
    console.log(`  切片时间: ${track.clipStart.toFixed(2)}s ~ ${track.clipEnd.toFixed(2)}s (时长 ${(track.clipEnd - track.clipStart).toFixed(2)}s)`);
    console.log(`  高潮 Drop: ${track.dropStart.toFixed(2)}s ~ ${track.dropEnd.toFixed(2)}s [激光舞台 laser]`);
    console.log(`  前置场景: [${track.preScene}] (歌词: "${track.lastVocal}")`);
    console.log(`  后置场景: [${track.postScene}] (Drop 结束 +2.0s 尾声)`);

    // 检查是否已存在且大于 1MB（断点跳过）
    if (existsSync(outputPath)) {
      const existingStat = await fs.stat(outputPath);
      if (existingStat.size > 1024 * 1024) {
        console.log(`  -> 目标视频已存在并完整 (${(existingStat.size / (1024 * 1024)).toFixed(2)} MB)，跳过导出！`);
        exportSummary.push({
          track: track.name,
          duration: (track.clipEnd - track.clipStart).toFixed(2) + 's',
          size: (existingStat.size / (1024 * 1024)).toFixed(2) + ' MB',
          status: 'Skipped (Existing)',
          path: outputPath,
        });
        continue;
      }
    }

    const audioPath = path.join(mp3Dir, track.file);
    const audioBuf = await fs.readFile(audioPath);

    // 提取原 MP3 内嵌封面
    const coverRes = spawnSync(ffmpeg, ['-y', '-i', audioPath, '-an', '-vcodec', 'copy', '-f', 'image2', 'pipe:1']);
    const coverBuf = coverRes.stdout;

    // 获取歌词
    let lyricData = null;
    try {
      lyricData = await fetch(`https://music.163.com/api/song/lyric/v1?lv=0&kv=0&yv=0&tv=0&id=${track.songId}`).then(r => r.json());
    } catch (e) {
      console.warn(`  在线歌词获取失败，使用本地歌词缓存`);
    }

    const duration = track.clipEnd - track.clipStart;
    const totalFrames = Math.ceil(duration * fps);
    totalTargetFrames = totalFrames;
    framesReceived = 0;
    lastLogTime = Date.now();

    // 启动当前曲目的 FFmpeg 硬件加速进程（小体积 1440p 60fps HEVC QSV）
    const ffmpegArgs = [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0',
      '-ss', String(track.clipStart), '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-vf', 'scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=p010le',
      '-c:v', 'hevc_qsv',
      '-preset', 'veryfast',
      '-global_quality', '28',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-tag:v', 'hvc1',
      '-r', String(fps),
      '-c:a', 'aac', '-b:a', '256k',
      '-af', 'apad', '-t', String(duration),
      '-movflags', '+faststart', '-f', 'mp4', outputPath,
    ];

    activeEncoder = spawn(ffmpeg, ffmpegArgs, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let ffStderr = '';
    activeEncoder.stderr.on('data', d => { ffStderr += d.toString(); });
    const encoderDone = once(activeEncoder, 'close');

    // 创建隔离上下文与页面
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.route('**/*', r => {
      const u = new URL(r.request().url());
      if (u.origin !== app.baseUrl && u.origin !== 'http://127.0.0.1:5345') return r.abort();
      if (u.pathname === '/song-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
      if (u.pathname === '/song-cover') return r.fulfill({ body: coverBuf, contentType: 'image/jpeg' });
      return r.continue();
    });

    const page = await context.newPage();
    page.on('console', m => {
      if (m.type() === 'error') console.error('  [Browser Error]:', m.text());
    });

    await page.goto(`${app.baseUrl}/tools/lead-preview.html`);

    await page.evaluate(async ({ track, lyricData, width, height }) => {
      const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }] = await Promise.all([
        import('/src/app/prepare.ts'),
        import('/src/app/player.ts'),
        import('/src/render/text.ts'),
      ]);

      const cover = new Image();
      cover.src = '/song-cover';
      await cover.decode();

      const [audio] = await Promise.all([
        fetch('/song-audio').then(r => r.arrayBuffer()),
        loadFonts('/fonts/'),
      ]);

      const song = await prepareSong({
        id: track.songId,
        name: track.name,
        artists: track.artists,
        audio,
        cover,
        lyric: lyricData,
      }, { pause: yieldToPage });

      const stage = document.createElement('div');
      stage.style.cssText = `width:${width}px;height:${height}px;position:absolute;left:0;top:0;overflow:hidden;background:#000`;
      document.body.innerHTML = '';
      document.body.append(stage);

      const player = new MvPlayer(stage, 1, { width, height });
      player.hud.visible = false;
      const style = styleFor(song, 'auto', true, 'auto');

      // 强制场景规则：高潮前用 preScene，高潮用 laser，高潮结束后用 postScene
      const forcePlan = [
        { scene: track.preScene, start: track.clipStart, end: track.dropStart },
        { scene: 'laser', variant: 'arena', start: track.dropStart, end: track.dropEnd },
        { scene: track.postScene, start: track.dropEnd, end: track.clipEnd },
      ];

      const retake = (plannedShots, music) => {
        const sortedPlan = [...forcePlan].sort((a, b) => a.start - b.start);
        const result = [];
        for (const shot of plannedShots) {
          let currentStart = shot.start;
          const currentEnd = shot.end;
          for (const fp of sortedPlan) {
            if (fp.end <= currentStart || fp.start >= currentEnd) continue;
            if (fp.start > currentStart) {
              result.push({
                ...shot,
                start: currentStart,
                scene: (shot.scene === 'laser' && fp.scene !== 'laser') ? track.preScene : shot.scene,
                end: fp.start,
              });
              currentStart = fp.start;
            }
            const segEnd = Math.min(currentEnd, fp.end);
            const matchedSection = music.a.sections.find(s => !(segEnd <= s.start || currentStart >= s.end))
              ?? shot.section;
            const sectionLabel = fp.scene === 'laser' ? 'drop' : (matchedSection.label === 'drop' ? 'chorus' : matchedSection.label);
            const sectionEnergy = fp.scene === 'laser' ? 1.0 : matchedSection.energy;
            result.push({
              scene: fp.scene,
              variant: fp.variant ?? (fp.scene === 'laser' ? 'arena' : shot.variant),
              start: currentStart,
              end: segEnd,
              section: { ...matchedSection, label: sectionLabel, energy: sectionEnergy },
              sectionIndex: shot.sectionIndex,
              seed: (track.songId ^ Math.round(currentStart * 100)) >>> 0,
            });
            currentStart = segEnd;
          }
          if (currentStart < currentEnd) {
            result.push({
              ...shot,
              start: currentStart,
              scene: shot.scene === 'laser' ? track.postScene : shot.scene,
              end: currentEnd,
            });
          }
        }
        return result;
      };

      player.load(song, style, new Set(), undefined, undefined, 0, track.songId >>> 0, retake, true, 'auto');
      await player.warm(yieldToPage);

      window.RENDER_STREAM = {
        player,
        canvas: player.engine.renderer.domElement,
        async streamAll(clipStart, totalFrames, fps, pushUrl) {
          const dt = 1 / fps;
          for (let i = 8; i > 0; i--) {
            player.frame(Math.max(0, clipStart - i * dt), dt);
          }

          let inflight = 0;
          for (let f = 0; f < totalFrames; f++) {
            const t = clipStart + f * dt;
            player.frame(t, dt);
            const blob = await new Promise(r => this.canvas.toBlob(r, 'image/jpeg', 0.88));
            while (inflight >= 3) {
              await new Promise(r => setTimeout(r, 2));
            }
            inflight++;
            fetch(pushUrl, { method: 'POST', body: blob }).finally(() => {
              inflight--;
            });
          }
          while (inflight > 0) {
            await new Promise(r => setTimeout(r, 10));
          }
          return true;
        }
      };
    }, { track, lyricData, width, height });

    console.log(`  [Render] 开始渲染 ${totalFrames} 帧 (1440p @ 60fps)...`);
    const streamStart = Date.now();

    await page.evaluate(async ({ clipStart, totalFrames, fps }) => {
      await window.RENDER_STREAM.streamAll(clipStart, totalFrames, fps, 'http://127.0.0.1:5345/push-frame');
    }, { clipStart: track.clipStart, totalFrames, fps });

    const streamSec = ((Date.now() - streamStart) / 1000).toFixed(1);
    const actualFps = (totalFrames / streamSec).toFixed(1);
    console.log(`  [Render] 渲染推流完成，用时 ${streamSec}s (平均 ${actualFps} fps)，等待 FFmpeg 封包...`);

    activeEncoder.stdin.end();
    const [code] = await encoderDone;
    activeEncoder = null;
    await context.close();

    if (code !== 0) {
      throw new Error(`FFmpeg 退出异常 (code ${code}): ${ffStderr}`);
    }

    const stat = await fs.stat(outputPath);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    console.log(`  [Success] 导出成功! 文件: ${outFileName} (${sizeMb} MB)`);

    exportSummary.push({
      track: track.name,
      duration: `${duration.toFixed(2)}s`,
      size: `${sizeMb} MB`,
      status: 'Success',
      path: outputPath,
    });
  }
} finally {
  await browser.close();
  await app.close();
  await new Promise(r => frameServer.close(r));
}

console.log(`\n========================================================================`);
console.log(`  ALL ASCEND EXPORTS FINISHED! 渲染报告汇总`);
console.log(`========================================================================`);
console.table(exportSummary);
