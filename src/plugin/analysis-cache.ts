// 歌曲音频分析结果的本地磁盘持久化缓存（按曲目 ID + 音频字节数 + 时长 + 歌词指纹 + BPM/副歌提示 + ANALYSIS_VERSION 严格校验）。
import { ANALYSIS_VERSION } from '../analysis/index.ts';
import type { Analysis, LyricLine } from '../types.ts';

/** 磁盘缓存最多保留的歌曲数量（超出时按最近访问时间淘汰最旧条目）。 */
const MAX_CACHE_ENTRIES = 80;
const CACHE_SCHEMA = 1;

export interface AnalysisCacheMeta {
  audioBytes: number;
  duration: number;
  lyricFingerprint: string;
  wikiBpm?: number;
  chorus?: [number, number];
}

interface EncodedF32 {
  __f32: string;
}

interface CacheEnvelope {
  schema: number;
  analysisVersion: number;
  meta: {
    audioBytes: number;
    duration: number;
    lyricFingerprint: string;
    wikiBpm: number | null;
    chorus: [number, number] | null;
  };
  payload: unknown;
}

interface CacheIndex {
  entries: Array<{ id: number; at: number }>;
}

/** 将字节数组分块编码为 Base64 字符串，避免大数组展开导致调用栈溢出。 */
function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x2000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunk)));
  }
  return btoa(parts.join(''));
}

/** 将 Base64 字符串还原为对齐的 Float32Array。 */
function base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  if (bin.length % 4 !== 0) throw new Error('Float32Array 字节长度非法');
  const ab = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(ab);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(ab);
}

/** 递归将任意层级的 Float32Array 无损编码为 Base64 标记对象。 */
function encodeValue(value: unknown): unknown {
  if (value instanceof Float32Array) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { __f32: bytesToBase64(view) } satisfies EncodedF32;
  }
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = encodeValue(v);
    }
    return out;
  }
  return value;
}

/** 递归还原所有 Base64 标记对象为 Float32Array。 */
function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (typeof rec.__f32 === 'string' && Object.keys(rec).length === 1) {
      return base64ToFloat32(rec.__f32);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = decodeValue(v);
    return out;
  }
  return value;
}

/** 计算歌词列表的确定性双通道哈希指纹，任何行时间、词时间或文本变化都会使缓存失效。 */
export function lyricFingerprint(lines: readonly LyricLine[]): string {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x9e3779b9 >>> 0;
  const feed = (n: number) => {
    h1 = Math.imul(h1 ^ (n & 0xffff), 0x01000193) >>> 0;
    h1 = Math.imul(h1 ^ (n >>> 16), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ n, 0x85ebca6b) >>> 0;
  };
  const feedStr = (s: string) => {
    feed(s.length);
    for (let i = 0; i < s.length; i++) feed(s.charCodeAt(i));
  };
  feed(lines.length);
  for (const line of lines) {
    feed(Math.round(line.start * 1000));
    feed(Math.round(line.end * 1000));
    feed((line.timedWords ? 1 : 0) | (line.backing ? 2 : 0));
    feedStr(line.text);
    feed(line.words.length);
    for (const w of line.words) {
      feed(Math.round(w.start * 1000));
      feed(Math.round(w.end * 1000));
      feedStr(w.text);
    }
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function sameChorus(a: [number, number] | null | undefined, b: [number, number] | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) <= 1e-3 && Math.abs(a[1] - b[1]) <= 1e-3;
}

function matchesMeta(saved: CacheEnvelope['meta'] | undefined, expected: AnalysisCacheMeta): boolean {
  if (!saved) return false;
  if (saved.audioBytes !== expected.audioBytes) return false;
  if (!Number.isFinite(saved.duration) || Math.abs(saved.duration - expected.duration) > 0.25) return false;
  if (saved.lyricFingerprint !== expected.lyricFingerprint) return false;
  if ((saved.wikiBpm ?? null) !== (expected.wikiBpm ?? null)) return false;
  if (!sameChorus(saved.chorus, expected.chorus ?? null)) return false;
  return true;
}

/** 将 Analysis 与可选校验元信息序列化为 JSON 字符串（IEEE-754 Float32 无损保留）。 */
export function serializeAnalysis(analysis: Analysis, meta?: AnalysisCacheMeta): string {
  const envelope: CacheEnvelope = {
    schema: CACHE_SCHEMA,
    analysisVersion: ANALYSIS_VERSION,
    meta: {
      audioBytes: meta?.audioBytes ?? 0,
      duration: meta?.duration ?? analysis.duration,
      lyricFingerprint: meta?.lyricFingerprint ?? '',
      wikiBpm: meta?.wikiBpm ?? null,
      chorus: meta?.chorus ? [meta.chorus[0], meta.chorus[1]] : null,
    },
    payload: encodeValue(analysis),
  };
  return JSON.stringify(envelope);
}

/** 从 JSON 字符串还原 Analysis；若版本、结构或元信息不匹配则返回 null。 */
export function deserializeAnalysis(raw: string, expectedMeta?: AnalysisCacheMeta): Analysis | null {
  try {
    const doc = JSON.parse(raw) as Partial<CacheEnvelope>;
    if (!doc || doc.schema !== CACHE_SCHEMA || doc.analysisVersion !== ANALYSIS_VERSION) return null;
    if (expectedMeta && !matchesMeta(doc.meta, expectedMeta)) return null;
    const restored = decodeValue(doc.payload) as Analysis | null;
    if (!restored || typeof restored !== 'object') return null;
    if (restored.version !== ANALYSIS_VERSION) return null;
    if (!Array.isArray(restored.sections) || !Array.isArray(restored.beats)) return null;
    if (!(restored.env?.rms instanceof Float32Array)) return null;
    return restored;
  } catch {
    return null;
  }
}

let cacheDirPromise: Promise<string | null> | null = null;

async function getCacheDir(): Promise<string | null> {
  if (typeof betterncm === 'undefined' || !betterncm.app?.getDataPath || !betterncm.fs) return null;
  if (!cacheDirPromise) {
    cacheDirPromise = (async () => {
      try {
        const root = (await betterncm.app.getDataPath()).replace(/[\\/]+$/, '');
        const parent = `${root}/BetterMV`;
        const dir = `${parent}/analysis-cache`;
        if (!(await betterncm.fs.exists(parent))) await betterncm.fs.mkdir(parent);
        if (!(await betterncm.fs.exists(dir))) await betterncm.fs.mkdir(dir);
        return dir;
      } catch {
        return null;
      }
    })();
  }
  return cacheDirPromise;
}

async function touchIndex(dir: string, songId: number): Promise<void> {
  try {
    const indexPath = `${dir}/index.json`;
    let entries: Array<{ id: number; at: number }> = [];
    if (await betterncm.fs.exists(indexPath)) {
      try {
        const parsed = JSON.parse(await betterncm.fs.readFileText(indexPath)) as Partial<CacheIndex>;
        if (Array.isArray(parsed?.entries)) {
          entries = parsed.entries.filter(e => e && Number.isSafeInteger(e.id) && Number.isFinite(e.at));
        }
      } catch { /* 索引损坏时重建 */ }
    }
    const now = Date.now();
    entries = [{ id: songId, at: now }, ...entries.filter(e => e.id !== songId)];
    const evicted = entries.slice(MAX_CACHE_ENTRIES);
    entries = entries.slice(0, MAX_CACHE_ENTRIES);
    await betterncm.fs.writeFileText(indexPath, JSON.stringify({ entries } satisfies CacheIndex));
    for (const old of evicted) {
      const oldPath = `${dir}/${old.id}.json`;
      try {
        await betterncm.fs.remove(oldPath);
      } catch { /* 忽略删除失败 */ }
    }
  } catch { /* 索引维护异常不影响主流程 */ }
}

/** 读取并校验指定歌曲的本地音频分析缓存；未命中或环境不支持时返回 null。 */
export async function readAnalysisCache(songId: number, meta: AnalysisCacheMeta): Promise<Analysis | null> {
  if (!Number.isSafeInteger(songId) || songId <= 0) return null;
  const dir = await getCacheDir();
  if (!dir) return null;
  try {
    const file = `${dir}/${songId}.json`;
    if (!(await betterncm.fs.exists(file))) return null;
    const raw = await betterncm.fs.readFileText(file);
    const analysis = deserializeAnalysis(raw, meta);
    if (analysis) void touchIndex(dir, songId);
    return analysis;
  } catch {
    return null;
  }
}

/** 将指定歌曲的音频分析结果异步写入本地磁盘缓存。 */
export async function writeAnalysisCache(songId: number, meta: AnalysisCacheMeta, analysis: Analysis): Promise<void> {
  if (!Number.isSafeInteger(songId) || songId <= 0) return;
  const dir = await getCacheDir();
  if (!dir) return;
  try {
    const raw = serializeAnalysis(analysis, meta);
    await betterncm.fs.writeFileText(`${dir}/${songId}.json`, raw);
    await touchIndex(dir, songId);
  } catch { /* 缓存落盘失败静默忽略 */ }
}
