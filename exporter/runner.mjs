import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const READY_TIMEOUT = 240_000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function positive(value, name, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

async function assertAbsent(file) {
  try { await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('The output file already exists; choose a new file name.');
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function processResult(child) {
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  // A process can fail before the next awaited browser operation has finished.
  void result.catch(() => {});
  return result;
}

async function stopProcess(child, result) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([result.catch(() => {}), delay(3_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([result.catch(() => {}), delay(3_000)]);
  }
}

async function inspectFile(ffmpegPath, partial, expected, signal, ffprobePath) {
  const sibling = ffprobePath ?? path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  let probe = false;
  try { probe = (await fs.stat(sibling)).isFile(); } catch { /* ffmpeg may be supplied without ffprobe */ }
  const executable = probe ? sibling : ffmpegPath;
  const args = probe
    ? ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames', '-of', 'json', partial]
    : ['-hide_banner', '-i', partial];
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const result = processResult(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-2_000_000); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-128_000); });
  const abort = () => child.kill('SIGTERM');
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new Error('Export cancelled.');
    const ended = await withTimeout(result, 45_000, 'Timed out checking the encoded MP4.');
    if (signal?.aborted) throw new Error('Export cancelled.');
    if (probe) {
      if (ended.code !== 0) throw new Error(`FFprobe could not read the MP4: ${stderr}`);
      const metadata = JSON.parse(stdout);
      const video = metadata.streams?.find(stream => stream.codec_type === 'video');
      const audio = metadata.streams?.find(stream => stream.codec_type === 'audio');
      if (!video || !audio || video.codec_name !== 'h264' || audio.codec_name !== 'aac') throw new Error('The encoded MP4 is missing its H.264 video or AAC audio.');
      if (video.width !== expected.width || video.height !== expected.height) throw new Error('The encoded video dimensions do not match the requested dimensions.');
      const [numerator, denominator = 1] = String(video.avg_frame_rate).split('/').map(Number);
      if (!Number.isFinite(numerator / denominator) || Math.abs(numerator / denominator - expected.fps) > 0.001) throw new Error('The encoded frame rate does not match the requested frame rate.');
      if (video.nb_frames && Number.isFinite(Number(video.nb_frames)) && Number(video.nb_frames) !== expected.frames) throw new Error('The encoded MP4 contains an unexpected number of frames.');
      const duration = Number(metadata.format?.duration);
      if (!Number.isFinite(duration) || Math.abs(duration - expected.duration) > Math.max(0.15, 2 / expected.fps)) throw new Error('The encoded MP4 duration does not match the rendered frames.');
      return { method: 'ffprobe', duration, videoCodec: video.codec_name, audioCodec: audio.codec_name, metadata };
    }
    // `ffmpeg -i` deliberately exits 1 without an output, but must recognize both streams and the container.
    if (ended.signal || !/Duration:\s*\d+:\d+:\d+(?:\.\d+)?/.test(stderr) || !/Video:\s*h264\b/.test(stderr) || !/Audio:\s*aac\b/.test(stderr)) {
      throw new Error(`FFmpeg could not verify the encoded MP4: ${stderr}`);
    }
    return { method: 'ffmpeg-metadata', videoCodec: 'h264', audioCodec: 'aac' };
  } finally {
    signal?.removeEventListener('abort', abort);
    await stopProcess(child, result);
  }
}

/** Render one prepared local job. No shell, Bun, browser recording, or wall-clock frame timing is used. */
export async function renderJob(job, options, update = () => {}) {
  const { width, height, fps } = job.format ?? {};
  positive(width, 'width', true); positive(height, 'height', true); positive(fps, 'fps', true);
  if (width % 2 || height % 2) throw new Error('H.264 dimensions must be even numbers.');
  if (!path.isAbsolute(job.dir) || !path.isAbsolute(job.outputPath)) throw new Error('Job and output paths must be absolute.');
  if (!options.ffmpegPath) throw new Error('FFmpeg is not configured.');
  const base = new URL(options.baseUrl);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('The renderer must use a local HTTP server.');
  const requestedStart = job.format.start ?? 0;
  if (!Number.isFinite(requestedStart) || requestedStart < 0) throw new Error('Invalid start time.');
  if (job.format.duration !== undefined) positive(job.format.duration, 'duration');
  await assertAbsent(job.outputPath);
  const audioPath = path.join(job.dir, 'audio.bin');
  const audioStat = await fs.stat(audioPath);
  if (!audioStat.isFile() || !audioStat.size) throw new Error('The job has no complete audio file.');
  const partial = path.join(path.dirname(job.outputPath), `.${path.basename(job.outputPath)}.${randomUUID()}.partial.mp4`);
  const started = Date.now();
  const errors = [], consoleErrors = [];
  let browser, encoder, encoderResult, encoderEnded, encoderFailure, fatalError;
  let encoderStderr = '', captured = 0;
  const signal = options.signal;
  const check = () => {
    if (signal?.aborted) throw new Error('Export cancelled.');
    if (fatalError) throw fatalError;
    if (encoderFailure) throw encoderFailure;
    if (encoderEnded && captured < (encoderEnded.expectedFrames ?? Infinity)) throw new Error(`FFmpeg stopped before all frames were written (${encoderEnded.code ?? encoderEnded.signal}).`);
  };
  const abort = () => { fatalError = new Error('Export cancelled.'); encoder?.kill('SIGTERM'); void browser?.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    check();
    await update({ state: 'preparing', progress: 0.01, frames: 0, totalFrames: 0 });
    const { chromium } = await import('playwright-core');
    const launch = { headless: true, chromiumSandbox: true, args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-frame-rate-limit', '--disable-gpu-vsync'] };
    if (options.edgePath) launch.executablePath = options.edgePath;
    else launch.channel = 'msedge';
    browser = await chromium.launch(launch);
    check();
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    // Only the local job server receives the private authorization header.
    await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort('blockedbyclient'));
    const page = await context.newPage();
    await page.setExtraHTTPHeaders({ 'X-BetterMV-Token': options.token });
    page.on('pageerror', error => { errors.push(error.stack ?? error.message); fatalError ??= new Error(`Renderer error: ${error.message}`); });
    page.on('crash', () => { fatalError = new Error('The rendering browser crashed.'); });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text();
      consoleErrors.push(text); if (consoleErrors.length > 20) consoleErrors.shift();
      if (/webgl.*(?:context.*lost|out of memory)|context_lost_webgl/i.test(text)) fatalError ??= new Error(`WebGL rendering failed: ${text}`);
    });
    const url = new URL('/exporter/render.html', base);
    url.search = new URLSearchParams({ job: String(job.id), width: String(width), height: String(height), fps: String(fps) }).toString();
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT });
    await withTimeout((async () => {
      await page.waitForFunction(() => !!window.BMV_EXPORT?.ready || !!document.body?.dataset.error, null, { timeout: READY_TIMEOUT });
      await page.evaluate(async () => {
        if (document.body?.dataset.error) throw new Error(document.body.dataset.error);
        await window.BMV_EXPORT.ready;
      });
    })(), READY_TIMEOUT, 'Timed out preparing the song for export.');
    check();
    const info = await page.evaluate(() => window.BMV_EXPORT.info());
    const sourceDuration = positive(info.duration, 'decoded audio duration');
    const firstFrame = Math.round(requestedStart * fps), start = firstFrame / fps;
    if (start >= sourceDuration) throw new Error('The selected start time is past the end of the song.');
    const end = Math.min(sourceDuration, job.format.duration === undefined ? sourceDuration : start + job.format.duration);
    const totalFrames = Math.max(1, Math.ceil((end - start) * fps - 1e-7));
    const duration = totalFrames / fps, finalFrame = firstFrame + totalFrames;
    const dt = 1 / fps;
    await update({ state: 'preparing', progress: 0.05, frames: 0, totalFrames, start, duration, sourceDuration, warmupFrames: firstFrame, info });
    const args = ['-hide_banner', '-loglevel', 'warning', '-n', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', 'pipe:0',
      '-ss', String(start), '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-t', String(duration), '-movflags', '+faststart', '-f', 'mp4', partial];
    encoder = spawn(options.ffmpegPath, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    encoderResult = processResult(encoder);
    void encoderResult.then(result => { encoderEnded = { ...result, expectedFrames: totalFrames }; }, error => { encoderFailure = error; });
    encoder.stdin.on('error', error => { encoderFailure ??= error; });
    encoder.stderr.on('data', chunk => { encoderStderr = (encoderStderr + chunk).slice(-64_000); });
    let lastUpdate = 0;
    for (let n = 0; n < finalFrame; n++) {
      check();
      const image = await page.evaluate(({ time, dt, capture }) => {
        const renderer = window.BMV_EXPORT;
        if (renderer.lost()) throw new Error('The WebGL context was lost.');
        renderer.frame(time, dt);
        if (renderer.lost()) throw new Error('The WebGL context was lost.');
        return capture ? renderer.capture() : null;
      }, { time: n / fps, dt, capture:n>=firstFrame });
      check();
      if (n >= firstFrame) {
        check();
        // Wait for the pipe's write callback before creating the next PNG; at most one frame is queued.
        await new Promise((resolve, reject) => encoder.stdin.write(Buffer.from(image, 'base64'), error => error ? reject(error) : resolve()));
        captured++;
      }
      if (Date.now() - lastUpdate >= 500 || n + 1 === finalFrame) {
        lastUpdate = Date.now();
        await update({ state: 'rendering', progress: 0.05 + 0.88 * (n + 1) / finalFrame, frames: captured, totalFrames, renderedFrames: n + 1, warmupFrames: firstFrame, time: n / fps, elapsedMs: Date.now() - started });
      }
    }
    check();
    await update({ state: 'encoding', progress: 0.95, frames: captured, totalFrames });
    await new Promise((resolve, reject) => encoder.stdin.end(error => error ? reject(error) : resolve()));
    const encoded = await encoderResult;
    if (encoded.code !== 0) throw new Error(`FFmpeg failed (${encoded.code ?? encoded.signal}): ${encoderStderr}`);
    check();
    const stat = await fs.stat(partial);
    if (!stat.isFile() || stat.size < 1_024) throw new Error('FFmpeg did not create a complete MP4.');
    const validation = await inspectFile(options.ffmpegPath, partial, { width, height, fps, frames: captured, duration }, signal, options.ffprobePath);
    check();
    await update({ state: 'encoding', progress: 0.99, frames: captured, totalFrames, bytes: stat.size });
    await assertAbsent(job.outputPath);
    // Same-directory hard-link publication is atomic and refuses an existing destination. Unlike rename,
    // it cannot overwrite another completed export in the race after the existence check.
    await fs.link(partial, job.outputPath);
    // The complete output is already published. A temporary-link cleanup error must not mark it as failed.
    await fs.unlink(partial).catch(() => {});
    return { ...info, duration, sourceDuration, start, frames: captured, width, height, fps, bytes: stat.size, outputPath: job.outputPath,
      elapsedMs: Date.now() - started, validation, pageErrors: errors, consoleErrors };
  } catch (error) {
    const detail = encoderStderr.trim();
    if (detail && !String(error.message).includes(detail)) error.message += `\nFFmpeg: ${detail}`;
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (encoder) await stopProcess(encoder, encoderResult);
    if (browser) await withTimeout(browser.close(), 10_000, 'Timed out closing the rendering browser.').catch(() => {});
    await fs.unlink(partial).catch(error => { if (error.code !== 'ENOENT') console.error('Could not remove incomplete export:', partial, error.message); });
  }
}
