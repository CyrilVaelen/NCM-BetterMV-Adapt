// A single-song MV on an explicit frame clock. Nothing plays audio or starts a RAF loop;
// the local export service captures each requested frame and muxes the original audio.
import { MvPlayer } from '../src/app/player.ts';
import { prepareSong, styleFor, yieldToPage } from '../src/app/prepare.ts';
import type { NeteaseLyric } from '../src/lyrics/parse.ts';
import { parseWiki, type SongWiki } from '../src/meta/wiki.ts';
import { parseChorus } from '../src/plugin/source.ts';
import { loadFonts } from '../src/render/text.ts';
import { LOOKS, SCENES } from '../src/scenes/catalog.ts';
import type { LookId, SceneId } from '../src/scenes/types.ts';
import { isVibePresetId, STYLES, type StyleId, type VibePresetId } from '../src/style/style.ts';
import type { LyricLine } from '../src/types.ts';

interface JobInput {
  song: { id: number; name: string; artists?: string[]; album?: string; duration?: number };
  audioUrl: string;
  coverUrl: string;
  lyric?: NeteaseLyric | null;
  /** Already refined lines from the current MV, before its per-song delay. */
  lines?: LyricLine[];
  /** Original analysis input; calibrated words affect presentation only. */
  analysisLines?: LyricLine[];
  wiki?: unknown;
  chorus?: unknown;
  format?: {
    width?: number;
    height?: number;
    fps?: number;
    encoding?: 'grain' | 'standard';
    start?: number;
    duration?: number;
    /** 仅针对离线导出画面的听感前瞻补偿（毫秒，0..200）。 */
    visualLeadMs?: number;
  };
  config?: {
    style?: 'auto' | StyleId;
    vibe?: VibePresetId;
    quality?: 'high' | 'mid' | 'low';
    seed?: number;
    off?: SceneId[];
    offLooks?: LookId[];
    lyricDelays?: Record<string, number>;
    arrange?: 'random' | 'fixed';
    showLyrics?: boolean;
    /** 兼容已启动旧版导出服务进程的画面前瞻透传字段（毫秒，0..200）。 */
    exportLeadMs?: number;
  };
}

interface ExportInfo {
  duration: number;
  name: string;
  artists: string[];
  width: number;
  height: number;
  fps: number;
  visualLeadMs: number;
  seed: number;
  style: StyleId;
}

interface ExportControl {
  ready: Promise<void>;
  frame(time: number, dt?: number): void;
  /** Call synchronously after frame(), in the same page.evaluate callback. */
  capture(): string;
  info(): ExportInfo;
  lost(): number;
}

declare global { interface Window { BMV_EXPORT: ExportControl } }

const params = new URLSearchParams(location.search);
const numberParam = (name: string, fallback: number, min: number, max: number): number => {
  const n = Number(params.get(name) ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}: ${n}`);
  return n;
};

async function fetchChecked(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  return response;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load cover: ${url}`));
    image.src = url;
  });
}

function songWiki(value: unknown): SongWiki | undefined {
  if (!value) return undefined;
  const wiki = value as Partial<SongWiki>;
  return Array.isArray(wiki.genres) && Array.isArray(wiki.tags) ? wiki as SongWiki : parseWiki(value);
}

function chorusRange(value: unknown, id: number): [number, number] | undefined {
  if (Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] >= 0 && value[1] > value[0]) {
    return [value[0], value[1]];
  }
  return parseChorus(value, id);
}

let player: MvPlayer | undefined;
let info: ExportInfo | undefined;
let contextLosses = 0;
let lastFrame = -1;
let visualLeadSec = 0;
let captureCanvas: HTMLCanvasElement | undefined;
let capturedFrame = -1;
let capturedPng = '';

async function initialise(): Promise<void> {
  const job = params.get('job');
  if (!job || !/^[a-zA-Z0-9_-]{1,128}$/.test(job)) throw new Error('Missing or invalid export job ID');
  const width = numberParam('width', 1920, 64, 7680);
  const height = numberParam('height', 1080, 64, 4320);
  const fps = numberParam('fps', 30, 1, 120);
  const input: JobInput = await (await fetchChecked(`/api/jobs/${encodeURIComponent(job)}/input.json`)).json();
  if (!input.song || !Number.isSafeInteger(input.song.id) || !input.audioUrl || !input.coverUrl) throw new Error('Incomplete export job input');
  const config = input.config ?? {};
  if (config.style !== undefined && config.style !== 'auto' && !Object.hasOwn(STYLES, config.style)) throw new Error('Unknown visual style');
  if (config.quality !== undefined && !['high', 'mid', 'low'].includes(config.quality)) throw new Error('Unknown render quality');
  if (config.seed !== undefined && (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff)) throw new Error('Invalid arrangement seed');
  const rawLeadMs = Number(input.format?.visualLeadMs ?? config.exportLeadMs ?? 0);
  if (!Number.isFinite(rawLeadMs) || rawLeadMs < 0 || rawLeadMs > 200) throw new Error('Invalid export visual lead');
  const visualLeadMs = Math.round(rawLeadMs);
  visualLeadSec = visualLeadMs / 1000;

  const stage = document.getElementById('stage')!;
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  const [audio, cover] = await Promise.all([
    fetchChecked(input.audioUrl).then(response => response.arrayBuffer()),
    loadImage(input.coverUrl),
    loadFonts('/fonts/'),
  ]);
  const lines = input.lines === undefined ? undefined : structuredClone(input.lines);
  if (lines !== undefined && !Array.isArray(lines)) throw new Error('Invalid prepared lyrics');
  const analysisLines = input.analysisLines === undefined ? lines : structuredClone(input.analysisLines);
  if (analysisLines !== undefined && !Array.isArray(analysisLines)) throw new Error('Invalid analysis lyrics');
  const song = await prepareSong({
    id: input.song.id, name: input.song.name, artists: input.song.artists ?? [], audio,
    // prepareSong calls refineLines only when it parsed at least one line. This
    // placeholder is replaced before analysis, so prepared lines remain usable
    // even if the lyric endpoint became unavailable after the current MV loaded.
    cover, lyric: analysisLines !== undefined ? { lrc: { lyric: '[00:00.000]BetterMV export' } } : input.lyric ?? null,
    wiki: songWiki(input.wiki), chorus: chorusRange(input.chorus, input.song.id),
  }, { pause: yieldToPage, refineLines: analysisLines === undefined ? undefined : async parsed => { parsed.splice(0, parsed.length, ...analysisLines); } });
  if (lines !== undefined) song.lines = lines;
  if (!Number.isFinite(song.duration) || song.duration <= 0) throw new Error('The audio has no usable duration');
  const showLyrics = config.showLyrics !== false;
  const vibe = isVibePresetId(config.vibe) ? config.vibe : 'auto';
  const style = styleFor(song, config.style, showLyrics, vibe);
  // 离线导出统一以 1:1 原生输出分辨率满血渲染（免疫实时省电“低画质”70% 缩放降级），并解锁至最高 4K 渲染像素预算以完整支持 1080p 与 1440p（2K）导出。
  player = new MvPlayer(stage, 1, { width: 3840, height: 2160 });
  player.engine.renderer.domElement.addEventListener('webglcontextlost', () => { contextLosses++; });
  player.hud.visible = false;
  const seed = config.seed ?? (config.arrange === 'random' ? crypto.getRandomValues(new Uint32Array(1))[0] : input.song.id >>> 0);
  const off = new Set<SceneId | LookId>([
    ...(config.off ?? []).filter(id => SCENES.some(scene => scene.id === id)),
    ...(config.offLooks ?? []).filter(id => LOOKS.some(look => look.id === id)),
  ]);
  const delayMs = Number(config.lyricDelays?.[String(input.song.id)] ?? 0);
  if (!Number.isFinite(delayMs)) throw new Error('Invalid lyric delay');
  player.load(song, style, off, undefined, undefined, delayMs / 1000, seed, undefined, showLyrics, vibe);
  await player.warm(yieldToPage);
  await document.fonts.ready;
  info = { duration: song.duration, name: input.song.name, artists: input.song.artists ?? [], width, height, fps, visualLeadMs, seed, style: style.id };
  document.body.dataset.ready = '1';
}

function frame(time: number, dt?: number): void {
  if (!player || !info) throw new Error('Await BMV_EXPORT.ready before rendering');
  if (contextLosses || player.engine.renderer.getContext().isContextLost()) throw new Error('WebGL context lost; restart the export');
  if (!Number.isFinite(time) || time < 0 || time > info.duration + 1e-6) throw new Error(`Frame time outside the song: ${time}`);
  const step = 1 / info.fps;
  if (dt !== undefined && (!Number.isFinite(dt) || Math.abs(dt - step) > 1e-6)) throw new Error('Frame dt must match the job FPS');
  const target = Math.round(time * info.fps);
  if (Math.abs(time - target * step) > 1e-6) throw new Error('Frame time must be on the job FPS grid');
  if (target < lastFrame) throw new Error('Backward frame requests require reloading the render page');
  // The plugin's temporal effects are tuned around 60 Hz. In particular, a
  // 30-fps output still draws its intermediate 60-Hz frames before capture.
  // 24 fps uses two full 1/60 steps and one exact remainder per output frame;
  // no simulation step exceeds 1/60, and capture still lands exactly at n/fps.
  // Replaying skipped output frames keeps that schedule identical after gaps.
  const maxStep = 1 / 60;
  const mediaTime = (t: number): number => Math.min(info!.duration, t + visualLeadSec);
  for (let n = lastFrame + 1; n <= target; n++) {
    if (n === 0) { player.frame(mediaTime(0), maxStep); continue; }
    const end = n * step;
    let current = (n - 1) * step;
    while (end - current > maxStep + 1e-9) {
      current += maxStep;
      player.frame(mediaTime(current), maxStep);
    }
    player.frame(mediaTime(end), end - current);
  }
  lastFrame = target;
  player.engine.renderer.getContext().finish();
}

function capture(): string {
  if (!player || !info || lastFrame < 0) throw new Error('Render a frame before capturing');
  if (contextLosses || player.engine.renderer.getContext().isContextLost()) throw new Error('WebGL context lost; restart the export');
  if (capturedFrame === lastFrame) return capturedPng;
  const source = player.engine.renderer.domElement;
  let canvas = source;
  if (source.width !== info.width || source.height !== info.height) {
    // Low-quality rendering uses a smaller drawing buffer. Resize into one
    // reusable canvas so the encoder always receives the requested dimensions.
    captureCanvas ??= document.createElement('canvas');
    if (captureCanvas.width !== info.width) captureCanvas.width = info.width;
    if (captureCanvas.height !== info.height) captureCanvas.height = info.height;
    const context = captureCanvas.getContext('2d');
    if (!context) throw new Error('Cannot create the output capture canvas');
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, info.width, info.height);
    canvas = captureCanvas;
  }
  // The renderer does not preserve its drawing buffer. Reading it in this same
  // synchronous task after frame() avoids a compositor capture and a blank PNG.
  const png = canvas.toDataURL('image/png');
  const prefix = 'data:image/png;base64,';
  if (!png.startsWith(prefix)) throw new Error('The render canvas could not encode a PNG');
  capturedFrame = lastFrame;
  capturedPng = png.slice(prefix.length);
  return capturedPng;
}

const ready = initialise();
window.BMV_EXPORT = {
  ready, frame, capture,
  info: () => { if (!info) throw new Error('Export is not ready'); return { ...info, artists: [...info.artists] }; },
  lost: () => contextLosses || Number(player?.engine.renderer.getContext().isContextLost() ?? false),
};
// Keep the rejected Promise visible to the service, with an intelligible page
// for a manual diagnosis. It must never capture a successful-looking blank MV.
void ready.catch(error => {
  console.error(error);
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
  const message = document.createElement('div');
  message.id = 'error';
  message.textContent = document.body.dataset.error;
  document.body.appendChild(message);
});
