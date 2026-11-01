// Local LRC support: reads and parses local .lrc files for per-song lyric calibration overrides.
import { parseNeteaseLyric, type NeteaseLyric } from './parse.ts';
import type { LyricLine } from '../types.ts';

declare const betterncm: any;

/** Browser file inputs may expose only a filename or C:\fakepath. Neither is a usable native path. */
export function localLrcPath(filePath: string): string {
  let p = String(filePath || '').replace(/[\u202a-\u202e\u2066-\u2069]/g, '').trim();
  if (/^(".*"|'.*'|“.*”)$/s.test(p)) p = p.slice(1, -1).trim();
  if (/^file:\/\//i.test(p)) {
    const u = new URL(p);
    p = decodeURIComponent(u.hostname ? `//${u.hostname}${u.pathname}` : u.pathname.replace(/^\/([a-z]:)/i, '$1'));
  }
  if (!p) throw new Error('请选择本地 LRC 文件，或粘贴完整文件路径');
  if ((!/^[a-z]:[\\/]/i.test(p) && !/^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(p)) || /^[a-z]:[\\/]fakepath[\\/]/i.test(p)) {
    throw new Error('需要完整文件路径，不能只填文件名；请点“浏览…”重新选择 LRC');
  }
  return p.replace(/\\/g, '/');
}

/** Decode file bytes directly: UTF-8, UTF-16 and legacy Windows Chinese LRCs. */
export function decodeLocalLrc(bytes: Uint8Array): string {
  if (!bytes.length) throw new Error('本地 LRC 读取结果为空；请重新选择文件');
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  else {
    const size = Math.min(bytes.length, 256); let even = 0, odd = 0;
    for (let i = 0; i < size; i++) if (!bytes[i]) { if (i % 2) odd++; else even++; }
    if (odd > size * 0.2 && even < size * 0.05) encoding = 'utf-16le';
    else if (even > size * 0.2 && odd < size * 0.05) encoding = 'utf-16be';
  }
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch {
    if (encoding !== 'utf-8') throw new Error('无法识别 LRC 编码，请保存为 UTF-8 后重试');
    text = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
  }
  return checkedLocalText(text);
}

function checkedLocalText(text: string): string {
  if (typeof text !== 'string' || !text.trim()) throw new Error('本地 LRC 读取结果为空；请检查完整路径或重新选择文件');
  text = text.replace(/^\uFEFF/, '');
  if (!/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(text)) throw new Error('文件里没有 [分:秒] 格式的 LRC 时间标签，请确认选择了 .lrc 歌词文件');
  return text;
}

/** Read bytes rather than treating BetterNCM's empty HTTP error body as valid text. */
export async function readLocalLrcText(filePath: string): Promise<string> {
  const cleanPath = localLrcPath(filePath);

  if (typeof betterncm !== 'undefined' && betterncm?.fs) {
    const api = betterncm.fs;
    if (api.exists && !(await api.exists(cleanPath))) throw new Error(`找不到本地 LRC 文件：${cleanPath}；请点“浏览…”重新选择`);
    if (api.readFile) {
      const blob = await api.readFile(cleanPath);
      if (!blob || typeof blob.arrayBuffer !== 'function') throw new Error('未能读取本地 LRC 文件，请重新选择');
      return decodeLocalLrc(new Uint8Array(await blob.arrayBuffer()));
    }
    if (api.readFileText) return checkedLocalText(await api.readFileText(cleanPath));
    throw new Error('当前 BetterNCM 未提供文件读取接口');
  }
  // Node / test runner fallback
  const fs = await import('fs/promises');
  return decodeLocalLrc(await fs.readFile(cleanPath));
}

/** An audio file paired with a bound LRC, when both share the same filename stem. */
export interface LocalAudioFile { path: string; audio: ArrayBuffer }

const LOCAL_AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.wav', '.aac', '.ogg', '.opus'];

/**
 * A local NetEase track must be analysed from the local recording that is playing. The LRC binding is the stable
 * per-song anchor available to BetterMV, so look for a same-stem audio file beside it before falling back to the
 * online catalogue stream.
 */
export async function readLocalAudioBesideLrc(filePath: string): Promise<LocalAudioFile | null> {
  const cleanPath = localLrcPath(filePath);
  if (!/\.lrc$/i.test(cleanPath)) return null;
  const stem = cleanPath.replace(/\.lrc$/i, '');
  if (typeof betterncm !== 'undefined' && betterncm?.fs?.readFile) {
    const api = betterncm.fs;
    for (const ext of LOCAL_AUDIO_EXTENSIONS) {
      const path = stem + ext;
      try {
        if (api.exists && !(await api.exists(path))) continue;
        const blob = await api.readFile(path);
        if (blob && blob.size > 0) return { path, audio: await blob.arrayBuffer() };
      } catch { /* try the next supported audio extension */ }
    }
    return null;
  }
  const fs = await import('fs/promises');
  for (const ext of LOCAL_AUDIO_EXTENSIONS) {
    const path = stem + ext;
    try {
      const bytes = await fs.readFile(path);
      if (bytes.length > 0) return { path, audio: Uint8Array.from(bytes).buffer };
    } catch { /* try the next supported audio extension */ }
  }
  return null;
}

/**
 * Parses local LRC text into LyricLines.
 * Explicitly excludes any `yrc` to prevent NetEase word-level lyrics from overriding the calibrated sentences.
 * Retains online translation (tlyric) if available.
 */
export function parseLocalLrc(text: string, duration: number, onlineDoc?: NeteaseLyric | null): LyricLine[] {
  const doc: NeteaseLyric = {
    lrc: { lyric: text },
    tlyric: onlineDoc?.tlyric,
    // yrc is intentionally omitted!
  };
  return parseNeteaseLyric(doc, duration);
}
