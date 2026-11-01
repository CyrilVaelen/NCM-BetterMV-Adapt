// Hand a snapshot of the current song to the local, offline MP4 renderer. Playback stays independent of the job.
import type { Client, PlayingSong } from './client.ts';
import type { Config } from './ui.ts';
import type { LyricLine } from '../types.ts';
import { fetchChorus, fetchLyric, fetchWiki, getAudio } from './source.ts';
import { parseLocalLrc, readLocalLrcText } from '../lyrics/local.ts';

declare const __BMV_EXPORT_TOKEN__: string;

const SERVICE = 'http://127.0.0.1:5196';
const TOKEN = typeof __BMV_EXPORT_TOKEN__ === 'string' ? __BMV_EXPORT_TOKEN__ : '';
const OUTPUT = 'D:\\NCM\\exports';
const delay = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

import type { Section } from '../types.ts';

export interface ExportSnapshot {
  song: PlayingSong;
  config: Config;
  /** Keep the arrangement and, when available, the refined lyric timings being shown. */
  seed?: number;
  lines?: LyricLine[];
  analysisLines?: LyricLine[];
  duration?: number;
  sections?: Section[];
  currentTime?: number;
}

interface ExportJob {
  id: string;
  state: 'queued' | 'preparing' | 'rendering' | 'encoding' | 'completed' | 'failed';
  /** Overall progress, 0..1. */
  progress?: number;
  outputName?: string;
  error?: string;
}

const STAGES: Record<ExportJob['state'], string> = {
  queued: '等待开始…', preparing: '正在准备画面…', rendering: '正在生成 MV…',
  encoding: '正在保存 MP4…', completed: '导出完成', failed: '导出未完成',
};

const SECTION_NAMES: Record<string, string> = {
  intro: '前奏', verse: '主歌', pre: '预副歌', chorus: '副歌', drop: '高潮',
  build: '铺垫', break: '间奏', bridge: '桥段', outro: '尾奏',
};

function formatTime(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseTime(str: string, fallback: number): number {
  str = String(str || '').trim();
  if (!str) return fallback;
  if (str.includes(':')) {
    const parts = str.split(':');
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return Math.max(0, m * 60 + s);
  }
  const n = parseFloat(str);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

class ServiceUnavailable extends Error {}
class ServiceMismatch extends Error {}
class MissingJob extends Error {}
class ServiceRequestError extends Error {}

/** Keep useful validation advice; detailed diagnostics stay in the export tool. */
function readableError(value: unknown): string {
  if (typeof value === 'string' && /[\u3400-\u9fff]/.test(value) && value.length <= 180 && !/[\r\n]|[A-Za-z]:[\\/]|(?:Error:|\bat \S|ffmpeg version)/.test(value)) return value;
  return '导出未完成，请查看“MV导出工具”中的提示后重试。';
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 12000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    headers.set('X-BetterMV-Token', TOKEN);
    const response = await fetch(SERVICE + path, { ...init, headers, signal: controller.signal });
    if (response.status === 401 || response.status === 403) throw new ServiceMismatch();
    if (response.status === 404 && path.startsWith('/api/exports/')) throw new MissingJob();
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ServiceRequestError(readableError(body?.error));
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ServiceMismatch || error instanceof MissingJob || error instanceof ServiceRequestError) throw error;
    throw new ServiceUnavailable();
  } finally { clearTimeout(timer); }
}

/** A persistent export state, shared by every opening of the MV page's export sheet. */
export class VideoExporter {
  private busy = false;
  private jobId: string | null = null;
  private songName = '';
  private message = '将当前歌曲的完整 MV 保存为带声音的 MP4。';
  private progress = 0;
  private outputName = '';
  private error = false;
  /** A smaller default keeps full-song exports practical on integrated graphics. */
  private resolution: 720 | 1080 = 720;
  private refresh: (() => void) | null = null;

  private rangeMode = 'full';
  private startSec = 0;
  private endSec = 0;

  constructor(private client: Client, private snapshot: () => ExportSnapshot | null) {}

  /** Built afresh when the sheet opens; a running job keeps its state when the sheet is put away. */
  view(): HTMLElement {
    const root = document.createElement('div');
    root.dataset.bmvSettings = '';
    root.style.cssText = 'padding:8px 20px 24px;line-height:1.6';
    const format = document.createElement('p');
    format.textContent = `MP4 · ${this.resolution}p · 30 帧/秒`;
    format.style.cssText = 'margin:0 0 12px;font-size:15px;font-weight:600';
    const description = document.createElement('p');
    description.textContent = '使用当前画风、场景和歌词设置。导出期间可以继续听歌或切换歌曲。';
    description.style.cssText = 'margin:0 0 18px;color:var(--l2)';

    // 分辨率选择
    const resolutionRow = document.createElement('label');
    resolutionRow.textContent = '分辨率';
    resolutionRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 8px';
    const resolution = document.createElement('select');
    resolution.setAttribute('aria-label', '导出视频分辨率');
    resolution.style.cssText = 'max-width:220px;padding:6px 10px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:#353440;color:#fff;font:inherit';
    for (const [value, label] of [['720', '720p（推荐）'], ['1080', '1080p（更清晰）']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      resolution.append(option);
    }
    resolution.value = String(this.resolution);
    resolution.onchange = () => {
      this.resolution = resolution.value === '1080' ? 1080 : 720;
      this.refresh?.();
    };
    resolutionRow.append(resolution);

    const resolutionHint = document.createElement('p');
    resolutionHint.textContent = '720p 生成更快。1080p 画面更清晰，所需时间更长。';
    resolutionHint.style.cssText = 'margin:0 0 16px;font-size:12px;color:var(--l3)';

    // 片段选择区域
    const current = this.snapshot();
    const songDur = Math.max(10, Math.round(current?.duration ?? current?.song?.duration ?? 240));
    if (this.endSec <= 0 || this.endSec > songDur + 5) this.endSec = songDur;

    const rangeRow = document.createElement('div');
    rangeRow.style.cssText = 'margin:0 0 16px;padding:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px';

    const rangeHeader = document.createElement('div');
    rangeHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px';
    const rangeLabel = document.createElement('span');
    rangeLabel.textContent = '导出片段';
    rangeLabel.style.cssText = 'font-weight:600';

    const rangeSelect = document.createElement('select');
    rangeSelect.style.cssText = 'max-width:240px;padding:5px 8px;border:1px solid rgba(255,255,255,.2);border-radius:6px;background:#353440;color:#fff;font:inherit;font-size:13px';

    const optFull = document.createElement('option');
    optFull.value = 'full';
    optFull.textContent = `整首歌曲 (00:00 - ${formatTime(songDur)})`;
    rangeSelect.append(optFull);

    const opt10s = document.createElement('option');
    opt10s.value = '10s';
    opt10s.textContent = '前 10 秒试片 (00:00 - 00:10)';
    rangeSelect.append(opt10s);

    const optCur30 = document.createElement('option');
    optCur30.value = 'cur30';
    optCur30.textContent = '当前播放时刻起 30 秒';
    rangeSelect.append(optCur30);

    // 添加歌曲结构中的段落（如各 Drop 高潮段落、Chorus 副歌段落）
    const sections = current?.sections || [];
    let secCount: Record<string, number> = {};
    sections.forEach((sec, idx) => {
      if (sec.label === 'drop' || sec.label === 'chorus') {
        const cn = SECTION_NAMES[sec.label] || sec.label;
        secCount[sec.label] = (secCount[sec.label] || 0) + 1;
        const opt = document.createElement('option');
        opt.value = `sec_${idx}`;
        opt.textContent = `${cn} ${secCount[sec.label]} (${formatTime(sec.start)} - ${formatTime(sec.end)})`;
        rangeSelect.append(opt);
      }
    });

    const optCustom = document.createElement('option');
    optCustom.value = 'custom';
    optCustom.textContent = '自定义时间段…';
    rangeSelect.append(optCustom);
    rangeSelect.value = this.rangeMode;

    rangeHeader.append(rangeLabel, rangeSelect);

    // 自定义时间输入行
    const timeEditRow = document.createElement('div');
    timeEditRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px';

    const startInput = document.createElement('input');
    startInput.type = 'text';
    startInput.style.cssText = 'width:62px;padding:4px 6px;text-align:center;border:1px solid rgba(255,255,255,.2);border-radius:5px;background:#252430;color:#fff;font:inherit';
    startInput.value = formatTime(this.startSec);

    const toSpan = document.createElement('span');
    toSpan.textContent = '至';
    toSpan.style.color = 'var(--l3)';

    const endInput = document.createElement('input');
    endInput.type = 'text';
    endInput.style.cssText = 'width:62px;padding:4px 6px;text-align:center;border:1px solid rgba(255,255,255,.2);border-radius:5px;background:#252430;color:#fff;font:inherit';
    endInput.value = formatTime(this.endSec);

    const btnCurTime = document.createElement('button');
    btnCurTime.type = 'button';
    btnCurTime.textContent = '设为当前播放点';
    btnCurTime.style.cssText = 'padding:3px 8px;border:1px solid rgba(255,255,255,.2);border-radius:5px;background:rgba(255,255,255,.08);color:#eee;font:inherit;font-size:12px;cursor:pointer';
    btnCurTime.title = '把开始时间设置为当前正在听的时间点，结束时间设为后30秒';

    const btnResetFull = document.createElement('button');
    btnResetFull.type = 'button';
    btnResetFull.textContent = '整首';
    btnResetFull.style.cssText = 'padding:3px 8px;border:1px solid rgba(255,255,255,.2);border-radius:5px;background:rgba(255,255,255,.08);color:#eee;font:inherit;font-size:12px;cursor:pointer';

    const rangeHint = document.createElement('span');
    rangeHint.style.cssText = 'margin-left:auto;color:var(--l2);font-size:12px';

    const syncRangeUi = () => {
      const dur = Math.max(1, this.endSec - this.startSec);
      startInput.value = formatTime(this.startSec);
      endInput.value = formatTime(this.endSec);
      rangeHint.textContent = `时长：${Math.round(dur)} 秒`;
      this.refresh?.();
    };

    btnCurTime.onclick = () => {
      const curT = Math.floor(this.snapshot()?.currentTime ?? 0);
      this.startSec = Math.max(0, Math.min(songDur - 5, curT));
      this.endSec = Math.min(songDur, this.startSec + 30);
      this.rangeMode = 'custom';
      rangeSelect.value = 'custom';
      syncRangeUi();
    };

    btnResetFull.onclick = () => {
      this.startSec = 0;
      this.endSec = songDur;
      this.rangeMode = 'full';
      rangeSelect.value = 'full';
      syncRangeUi();
    };

    startInput.onchange = () => {
      this.startSec = Math.max(0, Math.min(songDur - 1, parseTime(startInput.value, this.startSec)));
      if (this.endSec <= this.startSec) this.endSec = Math.min(songDur, this.startSec + 30);
      this.rangeMode = 'custom';
      rangeSelect.value = 'custom';
      syncRangeUi();
    };

    endInput.onchange = () => {
      this.endSec = Math.max(this.startSec + 1, Math.min(songDur, parseTime(endInput.value, this.endSec)));
      this.rangeMode = 'custom';
      rangeSelect.value = 'custom';
      syncRangeUi();
    };

    rangeSelect.onchange = () => {
      this.rangeMode = rangeSelect.value;
      if (this.rangeMode === 'full') {
        this.startSec = 0;
        this.endSec = songDur;
      } else if (this.rangeMode === '10s') {
        this.startSec = 0;
        this.endSec = Math.min(10, songDur);
      } else if (this.rangeMode === 'cur30') {
        const curT = Math.floor(this.snapshot()?.currentTime ?? 0);
        this.startSec = Math.max(0, Math.min(songDur - 5, curT));
        this.endSec = Math.min(songDur, this.startSec + 30);
      } else if (this.rangeMode.startsWith('sec_')) {
        const idx = parseInt(this.rangeMode.slice(4), 10);
        const sec = sections[idx];
        if (sec) {
          this.startSec = Math.floor(sec.start);
          this.endSec = Math.ceil(sec.end);
        }
      }
      syncRangeUi();
    };

    timeEditRow.append(startInput, toSpan, endInput, btnCurTime, btnResetFull, rangeHint);
    rangeRow.append(rangeHeader, timeEditRow);

    const song = document.createElement('p');
    song.style.cssText = 'margin:0 0 12px;overflow-wrap:anywhere';
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'margin:0 0 10px;overflow-wrap:anywhere';
    const meter = document.createElement('progress');
    meter.max = 1;
    meter.setAttribute('aria-label', '视频导出进度');
    meter.style.cssText = 'display:block;width:100%;height:8px;margin-bottom:12px';
    const saved = document.createElement('p');
    saved.style.cssText = 'margin:0 0 18px;font-size:12px;color:var(--l2);user-select:text;overflow-wrap:anywhere';

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'bmv-btn';
    start.onclick = () => {
      if (this.rangeMode === 'full' && this.startSec === 0 && this.endSec >= songDur - 0.5) {
        void this.begin();
      } else {
        const dur = Math.max(1, this.endSec - this.startSec);
        void this.begin(this.startSec, dur, `${formatTime(this.startSec)}-${formatTime(this.endSec)}`);
      }
    };

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'bmv-btn';
    preview.textContent = '快速试片 10秒';
    preview.onclick = () => void this.begin(0, 10, '10秒试片');

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    actions.append(start, preview);

    const note = document.createElement('p');
    note.textContent = '视频保存在 ' + OUTPUT + '。请保持“MV导出工具”打开，生成时间取决于所选片段长度和电脑性能。';
    note.style.cssText = 'margin:18px 0 0;font-size:12px;color:var(--l3);overflow-wrap:anywhere';

    root.append(format, description, resolutionRow, resolutionHint, rangeRow, song, status, meter, saved, actions, note);

    this.refresh = () => {
      const snap = this.snapshot();
      format.textContent = `MP4 · ${this.resolution}p · 30 帧/秒`;
      resolution.disabled = this.busy || !!this.jobId;
      resolution.style.opacity = resolution.disabled ? '.5' : '1';
      rangeSelect.disabled = this.busy || !!this.jobId;
      startInput.disabled = this.busy || !!this.jobId;
      endInput.disabled = this.busy || !!this.jobId;
      btnCurTime.disabled = this.busy || !!this.jobId;
      btnResetFull.disabled = this.busy || !!this.jobId;

      song.textContent = this.busy || this.jobId || this.outputName ? this.songName : snap?.song.name || '请先播放一首歌曲';
      status.textContent = this.message + (this.busy && this.progress > 0 ? ` ${Math.floor(this.progress * 100)}%` : '');
      status.style.color = this.error ? '#ffb4ab' : 'var(--l2)';
      meter.value = this.progress;
      meter.style.display = this.busy ? 'block' : 'none';
      saved.textContent = this.outputName ? `已保存：${OUTPUT}\\${this.outputName}` : '';

      start.disabled = this.busy || (!this.jobId && !snap);
      start.style.opacity = start.disabled ? '.5' : '1';
      start.style.cursor = start.disabled ? 'default' : 'pointer';

      const dur = Math.max(1, this.endSec - this.startSec);
      const isFull = this.rangeMode === 'full' && this.startSec === 0 && this.endSec >= songDur - 0.5;
      start.textContent = this.busy
        ? '正在导出…'
        : this.jobId
        ? '继续查看进度'
        : this.outputName
        ? '再次导出'
        : isFull
        ? '导出完整 MV'
        : `导出选定片段（${Math.round(dur)}秒）`;

      preview.disabled = this.busy || !!this.jobId || !snap;
      preview.style.opacity = preview.disabled ? '.5' : '1';
      preview.style.cursor = preview.disabled ? 'default' : 'pointer';
    };

    syncRangeUi();
    return root;
  }

  private update(message: string, progress = this.progress): void {
    this.message = message;
    this.progress = Math.max(0, Math.min(1, Number(progress) || 0));
    this.refresh?.();
  }

  private async begin(startSec = 0, durSec?: number, label?: string): Promise<void> {
    if (this.busy) return;
    const current = this.snapshot();
    const snapshot = current ? JSON.parse(JSON.stringify(current)) as ExportSnapshot : null;
    const width = this.resolution === 1080 ? 1920 : 1280;
    const height = this.resolution;
    if (!this.jobId && !snapshot) return;
    if (!this.jobId && snapshot) {
      this.songName = snapshot.song.name + (label ? `（${label}）` : durSec ? `（${Math.round(durSec)}秒片段）` : '');
    }
    this.busy = true;
    this.error = false;
    this.outputName = '';
    try {
      if (!TOKEN) throw new ServiceMismatch();
      this.update(this.jobId ? '正在读取导出进度…' : '正在连接 MV 导出工具…', this.jobId ? this.progress : 0);
      await request('/api/health');
      if (!this.jobId && snapshot) {
        const song = { ...snapshot.song, artists: [...snapshot.song.artists] };
        const config = JSON.parse(JSON.stringify({
          style: snapshot.config.style, quality: snapshot.config.quality,
          off: snapshot.config.off, offLooks: snapshot.config.offLooks,
          lyricDelays: snapshot.config.lyricDelays, arrange: snapshot.config.arrange,
          showLyrics: snapshot.config.showLyrics,
          seed: snapshot.seed,
        }));
        let lines = snapshot.lines ? JSON.parse(JSON.stringify(snapshot.lines)) : undefined;
        const localLrcPath = snapshot.config?.localLrcPaths?.[String(song.id)];
        if (!lines && localLrcPath) {
          try {
            const localLrcText = await readLocalLrcText(localLrcPath);
            lines = parseLocalLrc(localLrcText, snapshot.duration ?? song.duration);
          } catch (e) {
            console.warn('[BetterMV Export] 无法读取绑定的本地 LRC 文件', e);
          }
        }
        this.update('正在准备歌曲和歌词…', 0.01);
        let cancelled = false;
        let timer = 0;
        const assets = Promise.all([
          getAudio(this.client, song.id, () => cancelled, song.local ? localLrcPath : undefined), fetchLyric(song.id), fetchWiki(song.id), fetchChorus(song.id),
          this.cover(song.cover),
        ]);
        const [audioAsset, lyric, wiki, chorus, cover] = await Promise.race([
          assets,
          new Promise<never>((_resolve, reject) => { timer = window.setTimeout(() => {
            cancelled = true;
            reject(new Error('暂时无法读取完整歌曲，请将歌曲完整缓存后重试。'));
          }, 190000); }),
        ]).finally(() => { cancelled = true; clearTimeout(timer); });
        const audio = audioAsset.audio;

        const formatConfig: Record<string, any> = { width, height, fps: 30 };
        if (durSec !== undefined) {
          formatConfig.start = Math.max(0, startSec);
          formatConfig.duration = Math.max(1, durSec);
        }

        const metadata = {
          song, lyric, wiki, chorus, config, lines, analysisLines: snapshot.analysisLines,
          format: formatConfig,
        };
        const body = new FormData();
        body.append('metadata', JSON.stringify(metadata));
        body.append('audio', new Blob([audio], { type: 'application/octet-stream' }), 'song.audio');
        body.append('cover', cover, 'cover.image');
        this.update('正在提交导出任务…', 0.02);
        const job = await request<ExportJob>('/api/exports', { method: 'POST', body }, 120000);
        if (!job || !/^[a-zA-Z0-9_-]+$/.test(job.id)) throw new Error('导出工具未能创建任务，请重试。');
        this.jobId = job.id;
        this.update(STAGES[job.state] || '等待开始…', job.progress ?? 0.02);
      }
      await this.followJob();
    } catch (error) {
      this.error = true;
      this.update(error instanceof ServiceUnavailable
        ? this.jobId ? '暂时无法读取进度。请保持“MV导出工具”打开，再点击“继续查看进度”。' : '请先打开“MV导出工具”，再重试。'
        : error instanceof ServiceMismatch ? 'MV 导出工具与当前插件不匹配，请重新打开配套的导出工具。'
        : (error as Error)?.message || '导出未完成，请重试。');
    } finally {
      this.busy = false;
      this.refresh?.();
    }
  }

  private async cover(url: string): Promise<Blob> {
    if (!url) return this.fallbackCover();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url.replace(/^http:/, 'https:').replace(/\?.*$/, '') + '?param=1024y1024', { signal: controller.signal });
      return response.ok ? await response.blob() : this.fallbackCover();
    } catch { return this.fallbackCover(); }
    finally { clearTimeout(timer); }
  }

  private fallbackCover(): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('暂时无法生成歌曲封面，请稍后重试。');
    const gradient = context.createLinearGradient(0, 0, 512, 512);
    gradient.addColorStop(0, '#25243e');
    gradient.addColorStop(1, '#7b66bd');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob); else reject(new Error('暂时无法生成歌曲封面，请稍后重试。'));
    }, 'image/png'));
  }

  private async followJob(): Promise<void> {
    // A job may take longer than real time; tolerate transient connection failures, with bounded consecutive retries.
    let failures = 0;
    while (this.jobId) {
      let job: ExportJob;
      try {
        job = await request<ExportJob>('/api/exports/' + encodeURIComponent(this.jobId));
        failures = 0;
      } catch (error) {
        if (error instanceof MissingJob) {
          this.jobId = null;
          throw new Error('导出任务已失效，请重新开始。');
        }
        if (!(error instanceof ServiceUnavailable) || ++failures >= 4) throw error;
        await delay(2500);
        continue;
      }
      if (!job || !(job.state in STAGES)) throw new ServiceMismatch();
      this.update(STAGES[job.state] || '正在导出…', job.progress ?? this.progress);
      if (job.state === 'completed') {
        this.jobId = null;
        this.outputName = job.outputName || '视频.mp4';
        this.update('导出完成', 1);
        return;
      }
      if (job.state === 'failed') {
        this.jobId = null;
        throw new Error(readableError(job.error));
      }
      await delay(2000);
    }
  }
}
