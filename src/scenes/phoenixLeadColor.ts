// 涅槃舞台：专辑封面双 Lead 代表色分组 + 主音色主导/人声融合时间轨
//
// 1. extractLeadColorGroups：对专辑封面像素做加权 k-means 聚类，按色相（封面存在两组明显色相时）或明度
//    （单一色系封面）把封面颜色分为两组代表色：
//      A 组 = 明亮主奏 Lead（旋律合成器单音线条）的代表色；
//      B 组 = 温暖和声/伴奏/切分 Lead（和弦 Stab/Pluck/Keys）的代表色。
//    每组输出 deep → mid → bright → core 四级线性空间色阶。
// 2. buildLeadColorTrack：一次性预计算整首歌的时间轨（纯函数，支持任意 seek）：
//      shareB  = B 组代表色在发光区域中的占比（哪种 Lead 主导，对应代表色占比增加）；
//      fusion  = 人声驱动的跨组颜色融合程度（无人声时严格为 0，有人声时适度融合，结束后在短暂窗口内平滑还原）；
//      vocal   = 音频真实人声活跃度；
//      energy  = 当前主导 Lead 的综合发光能量；
//      dominantB = 0（A 主导）或 1（B 主导）。
//    建立稳定的乐器身份识别：同一音源自身的明暗/滤波扫频（filter sweep）绝不切换 Lead 身份；
//    人声作为重要主导声部全面参与 Lead 活动量与代表色占比仲裁。

import * as THREE from 'three';
import type { Music } from '../director/music.ts';
import type { LyricTrack } from '../director/lyrics.ts';
import type { SceneInit } from './types.ts';
import { linearVec3FromHsl, rgbToHsl, type CoverToneStops, type SrgbHsl } from './coverTone.ts';

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const unit = (x: number) => clamp(x, 0, 1);
const smoothUnit = (x: number) => { const k = unit(x); return k * k * (3 - 2 * k); };
const wrapDeg = (deg: number) => ((deg % 360) + 360) % 360;
const hueDiff = (a: number, b: number) => ((a - b) % 360 + 540) % 360 - 180;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export interface LeadColorGroups {
  /** 明亮主奏 Lead 代表色：deep, mid, bright, core（线性空间） */
  a: THREE.Vector3[];
  /** 温暖和声/键盘 Lead 代表色：deep, mid, bright, core（线性空间） */
  b: THREE.Vector3[];
  /** 调试信息：两组主色相与分组方式 */
  info: { hueA: number; hueB: number; split: 'hue' | 'lightness' | 'fallback' };
}

interface ColorSample { x: number; y: number; z: number; r: number; g: number; b: number; w: number }
interface Cluster { r: number; g: number; b: number; w: number; hsl: SrgbHsl }

/** 组内按明度从暗到亮插值色相，四级色阶自适应封面自身饱和度质感（浓烈保持浓烈，素雅保持素雅，绝不人工拉爆）。 */
function buildStops(group: Cluster[], tone: CoverToneStops, lightBias: number): { stops: THREE.Vector3[]; hue: number } {
  let cs = 0, sn = 0, sSum = 0, wSum = 0;
  for (const c of group) {
    const rad = (c.hsl.h * Math.PI) / 180;
    cs += Math.cos(rad) * c.w; sn += Math.sin(rad) * c.w;
    sSum += c.hsl.s * c.w; wSum += c.w;
  }
  const hue = wrapDeg((Math.atan2(sn, cs) * 180) / Math.PI);
  const sat = wSum > 0 ? sSum / wSum : 0.8;
  const sorted = group.slice().sort((p, q) => p.hsl.l - q.hsl.l);
  const darkHue = sorted.length ? hue + clamp(hueDiff(sorted[0].hsl.h, hue), -14, 14) : hue;
  const lightHue = sorted.length ? hue + clamp(hueDiff(sorted[sorted.length - 1].hsl.h, hue), -14, 14) : hue;
  const sScale = tone.mono ? 0 : tone.satScale;
  const towardHigh = (h: number, k: number) => wrapDeg(h + hueDiff(tone.highHue, h) * k);

  // 自适应饱和度基准：高饱和电音封面保持炽热浓烈，低饱和水墨水彩封面保持清雅通透，消除粗暴拉爆
  const baseS = tone.mono ? 0.03 : sat * sScale;
  const dynamicS = tone.mono ? 0.03 : (baseS < 0.32 ? baseS * 1.30 : mix(baseS, 0.92, 0.35));

  const mk = (k: number, l: number, sFactor: number, maxS: number, highPull = 0) => {
    const h = towardHigh(wrapDeg(darkHue + hueDiff(lightHue, darkHue) * k), highPull);
    const s = tone.mono ? 0.03 : clamp(dynamicS * sFactor, 0.05, maxS);
    return linearVec3FromHsl(h, s, clamp(l + lightBias, 0.05, 0.95));
  };
  return {
    hue,
    stops: [
      mk(0.00, 0.42, 0.88, 0.95),
      mk(0.40, 0.56, 0.98, 0.99),
      mk(0.75, 0.69, 1.05, 1.00, 0.35),
      mk(1.00, 0.82, 0.92, 0.96, 0.65),
    ],
  };
}

function fallbackGroups(tone: CoverToneStops): LeadColorGroups {
  const stop = (h: number, s: number, l: number) => linearVec3FromHsl(h, tone.mono ? 0.04 : s, l);
  const hA = tone.highHue, hB = tone.deepHue;
  return {
    a: [stop(hA, 0.88, 0.46), stop(hA, 0.94, 0.60), stop(hA, 0.96, 0.73), stop(hA, 0.82, 0.89)],
    b: [stop(hB, 0.90, 0.38), stop(hB, 0.94, 0.52), stop(hB, 0.96, 0.66), stop(hB, 0.80, 0.84)],
    info: { hueA: hA, hueB: hB, split: 'fallback' },
  };
}

/**
 * 从专辑封面像素中提取两组 Lead 代表色。确定性算法（固定初始化），同一封面每次结果相同。
 */
export function extractLeadColorGroups(init: Pick<SceneInit, 'coverPixels'>, tone: CoverToneStops): LeadColorGroups {
  const px = init.coverPixels;
  if (tone.mono || !px || px.length < 64) return fallbackGroups(tone);

  // 1. 采样封面中“会发光”的彩色像素：偏重高色度、较高明度的颜色
  const samples: ColorSample[] = [];
  const total = px.length >> 2;
  const step = Math.max(1, Math.floor(total / 6000));
  for (let p = 0; p < total; p += step) {
    const i = p << 2;
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const c = mx - mn, l = (mx + mn) * 0.5;
    if (c < 0.09 || l < 0.08 || l > 0.96) continue;
    const h = rgbToHsl(r, g, b).h * Math.PI / 180;
    samples.push({ x: Math.cos(h) * c, y: Math.sin(h) * c, z: (l - 0.5) * 0.8, r, g, b, w: Math.pow(c, 1.1) * (0.35 + 0.65 * l) });
  }
  if (samples.length < 32) return fallbackGroups(tone);

  // 2. 加权 k-means（K=6），最远点确定性初始化
  const K = Math.min(6, samples.length);
  const dist2 = (s: ColorSample, c: { x: number; y: number; z: number }) => (s.x - c.x) ** 2 + (s.y - c.y) ** 2 + (s.z - c.z) ** 2;
  const centers: Array<{ x: number; y: number; z: number }> = [];
  let first = samples[0];
  for (const s of samples) if (s.w > first.w) first = s;
  centers.push({ x: first.x, y: first.y, z: first.z });
  while (centers.length < K) {
    let best = samples[0], bestScore = -1;
    for (const s of samples) {
      let md = Infinity;
      for (const c of centers) md = Math.min(md, dist2(s, c));
      const score = s.w * md;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (bestScore <= 1e-9) break;
    centers.push({ x: best.x, y: best.y, z: best.z });
  }
  const assign = new Int32Array(samples.length);
  for (let iter = 0; iter < 10; iter++) {
    for (let i = 0; i < samples.length; i++) {
      let bi = 0, bd = Infinity;
      for (let k = 0; k < centers.length; k++) { const d = dist2(samples[i], centers[k]); if (d < bd) { bd = d; bi = k; } }
      assign[i] = bi;
    }
    const acc = centers.map(() => ({ x: 0, y: 0, z: 0, w: 0 }));
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i], a = acc[assign[i]];
      a.x += s.x * s.w; a.y += s.y * s.w; a.z += s.z * s.w; a.w += s.w;
    }
    for (let k = 0; k < centers.length; k++) if (acc[k].w > 0) centers[k] = { x: acc[k].x / acc[k].w, y: acc[k].y / acc[k].w, z: acc[k].z / acc[k].w };
  }

  // 3. 汇总聚类颜色与面积权重，去掉占比过小的杂色
  const sums = centers.map(() => ({ r: 0, g: 0, b: 0, w: 0 }));
  let wTotal = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], a = sums[assign[i]];
    a.r += s.r * s.w; a.g += s.g * s.w; a.b += s.b * s.w; a.w += s.w; wTotal += s.w;
  }
  const clusters: Cluster[] = sums
    .filter(a => a.w / wTotal >= 0.03)
    .map(a => ({ r: a.r / a.w, g: a.g / a.w, b: a.b / a.w, w: a.w / wTotal, hsl: rgbToHsl(a.r / a.w, a.g / a.w, a.b / a.w) }));
  if (clusters.length < 2) return fallbackGroups(tone);

  // 4. 双色相分组 vs 单色相明度分组仲裁
  // 关键准则：若要分成两组不同色相，两组都必须具备真实的色彩纯度（饱满度），
  // 严禁将微弱冷灰背景误判为独立色相，避免国画/水彩封面的淡青灰远山被错误放大为艳紫色！
  const meanSat = (g: Cluster[]) => g.reduce((s, c) => s + c.hsl.s * c.w, 0) / Math.max(1e-6, g.reduce((s, c) => s + c.w, 0));
  let bestHueSplit: { ga: Cluster[]; gb: Cluster[]; sep: number } | null = null;
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const ga: Cluster[] = [], gb: Cluster[] = [];
      for (const c of clusters) (Math.abs(hueDiff(c.hsl.h, clusters[i].hsl.h)) <= Math.abs(hueDiff(c.hsl.h, clusters[j].hsl.h)) ? ga : gb).push(c);
      const wa = ga.reduce((s, c) => s + c.w, 0), wb = gb.reduce((s, c) => s + c.w, 0);
      if (wa < 0.12 || wb < 0.12) continue;

      const sa = meanSat(ga), sb = meanSat(gb);
      // 必须两组均具备清晰的色彩饱和度 (>= 0.28 且比例不过于悬殊)，才承认为双色相封面
      if (sa < 0.28 || sb < 0.28 || Math.min(sa, sb) / Math.max(sa, sb) < 0.40) continue;

      const meanHue = (g: Cluster[]) => {
        let cs = 0, sn = 0;
        for (const c of g) { const r = c.hsl.h * Math.PI / 180; cs += Math.cos(r) * c.w; sn += Math.sin(r) * c.w; }
        return Math.atan2(sn, cs) * 180 / Math.PI;
      };
      const sep = Math.abs(hueDiff(meanHue(ga), meanHue(gb)));
      if (!bestHueSplit || sep > bestHueSplit.sep) bestHueSplit = { ga, gb, sep };
    }
  }

  let ga: Cluster[], gb: Cluster[], split: 'hue' | 'lightness';
  if (bestHueSplit && bestHueSplit.sep >= 26) {
    ga = bestHueSplit.ga; gb = bestHueSplit.gb; split = 'hue';
  } else {
    // 单色调/低饱和封面：按明度自然划分明亮主奏组与沉稳和声组
    const byL = clusters.slice().sort((p, q) => p.hsl.l - q.hsl.l);
    let cut = 1, bestSep = -1;
    for (let k = 1; k < byL.length; k++) {
      const lo = byL.slice(0, k), hi = byL.slice(k);
      const wl = lo.reduce((s, c) => s + c.w, 0), wh = hi.reduce((s, c) => s + c.w, 0);
      if (wl < 0.15 || wh < 0.15) continue;
      const ml = lo.reduce((s, c) => s + c.hsl.l * c.w, 0) / wl, mh = hi.reduce((s, c) => s + c.hsl.l * c.w, 0) / wh;
      if (mh - ml > bestSep) { bestSep = mh - ml; cut = k; }
    }
    gb = byL.slice(0, cut); ga = byL.slice(cut); split = 'lightness';
  }

  // A 组主奏 Lead 显著度评定：优先兼顾饱和生动度（Prominence）与明度，避免让暗淡无色的浅灰天空窃取主导地位
  const score = (g: Cluster[]) => {
    const w = Math.max(1e-6, g.reduce((s, c) => s + c.w, 0));
    const avgL = g.reduce((s, c) => s + c.hsl.l * c.w, 0) / w;
    const avgS = g.reduce((s, c) => s + c.hsl.s * c.w, 0) / w;
    return avgL * 0.45 + avgS * 0.55;
  };
  if (score(ga) < score(gb)) [ga, gb] = [gb, ga];

  const A = buildStops(ga, tone, 0.02);
  const B = buildStops(gb, tone, -0.03);

  // 5. 两组色相过近时，沿封面自身的亮部/暗部色相方向轻微拉开，保证两种 Lead 可分辨
  const dh = hueDiff(A.hue, B.hue);
  if (Math.abs(dh) < 12) {
    const push = (12 - Math.abs(dh)) * 0.5;
    const dirA = Math.sign(hueDiff(tone.highHue, tone.mainHue)) || 1;
    const dirB = Math.sign(hueDiff(tone.deepHue, tone.mainHue)) || -dirA;
    const ga2 = ga.map(c => ({ ...c, hsl: { ...c.hsl, h: wrapDeg(c.hsl.h + dirA * push) } }));
    const gb2 = gb.map(c => ({ ...c, hsl: { ...c.hsl, h: wrapDeg(c.hsl.h + dirB * push) } }));
    const A2 = buildStops(ga2, tone, 0.02), B2 = buildStops(gb2, tone, -0.03);
    return { a: A2.stops, b: B2.stops, info: { hueA: A2.hue, hueB: B2.hue, split } };
  }
  return { a: A.stops, b: B.stops, info: { hueA: A.hue, hueB: B.hue, split } };
}

// ───────────────────────────── Lead 主导 / 人声融合时间轨 ─────────────────────────────

export const LEAD_TRACK_FPS = 30;

export interface LeadColorTrack {
  fps: number;
  /** B 组代表色占比（0..1）：B Lead 主导时 > 0.5，A Lead 主导时 < 0.5 */
  shareB: Float32Array;
  /** 人声驱动的颜色融合程度（0..1）；无人声时严格为 0 */
  fusion: Float32Array;
  /** 人声包络（0..1） */
  vocal: Float32Array;
  /** 当前主导 Lead 的能量（0..1） */
  energy: Float32Array;
  /** 0 = A（主奏旋律）主导，1 = B（切分/和弦合成器）主导 */
  dominantB: Uint8Array;
}

/** 歌词制作信息行（作词/作曲等）不是演唱。 */
const META_LINE = /^\s*(作词|作曲|编曲|制作人?|混音|录音|母带|和声|监制|出品|发行|吉他|贝斯|鼓|弦乐|配唱|统筹|企划|lyrics?|composer|producer|arranger|written|mix(ed|ing)?|master(ed|ing)?)\s*(by)?\s*[:：]/i;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g;

/** 从歌词中提取实际演唱区间 [start, end, weight]；和声/切片人声权重较低。 */
function vocalSpans(lyrics: LyricTrack | undefined): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  if (!lyrics || !lyrics.lines) return out;
  for (const line of lyrics.lines) {
    const text = (line.text || '').trim();
    if (!text || META_LINE.test(text)) continue;
    const weight = line.backing ? 0.6 : 1.0;
    if (line.timedWords && line.words && line.words.length) {
      for (const w of line.words) if (w.end > w.start) out.push([w.start, w.end + 0.08, weight]);
      continue;
    }
    // 逐行歌词：如果行持续时间合理，保留完整演唱时长（支持长元音尾音）
    if (line.end > line.start && line.end - line.start >= 0.5) {
      out.push([line.start, line.end, weight]);
      continue;
    }
    const cjk = (text.match(CJK) || []).length;
    const latin = (text.replace(CJK, ' ').match(/[A-Za-z0-9']+/g) || []).length;
    const est = clamp(cjk * 0.30 + latin * 0.36, 0.9, 7.5);
    const end = Math.min(line.end > line.start ? line.end : line.start + est, line.start + est);
    out.push([line.start, end, weight]);
  }
  return out;
}

/**
 * 预计算整首歌的 Lead 代表色主导与人声融合曲线。
 * 遵循严格的声学角色语义与无混色规则：
 * 1. 乐器身份识别：A = Melodic Upper Lead（单音主奏旋律线条）；B = Synth Stab / Keys / Pluck（切分和弦伴奏）。
 *    同一音源内部仅改变 brightness 绝不改变乐器归属！
 * 2. 人声作为 Lead 全面参与仲裁：人声活动量直接影响主导 Lead、代表色占比和总能量。
 * 3. 严格受控的融合许可：无人声时 fusion 严格为 0；有人声时柔和融合；人声结束后在短暂窗口（<0.5s）内迅速归零还原。
 */
export function buildLeadColorTrack(music: Music, lyrics: LyricTrack | undefined): LeadColorTrack {
  const fps = LEAD_TRACK_FPS;
  const dur = Math.max(0, music.duration || 0);
  const n = Math.max(2, Math.ceil(dur * fps) + 2);
  const dt = 1 / fps;

  // 1. 人声先验覆盖（歌词演唱区间）
  const vocalPrior = new Float32Array(n);
  const spans = vocalSpans(lyrics);
  const hasLyrics = spans.length > 0;
  for (const [s, e, w] of spans) {
    const i0 = Math.max(0, Math.floor(s * fps));
    const i1 = Math.min(n - 1, Math.ceil(e * fps));
    for (let i = i0; i <= i1; i++) vocalPrior[i] = Math.max(vocalPrior[i], w);
  }

  // 检查歌曲分段元数据中是否有 vocal 标记（无歌词但有人声段落的先验支持）
  const sections = music.a?.sections || [];
  const sectionVocal = new Float32Array(n);
  for (const sec of sections) {
    if (sec.vocal) {
      const i0 = Math.max(0, Math.floor(sec.start * fps));
      const i1 = Math.min(n - 1, Math.ceil(sec.end * fps));
      for (let i = i0; i <= i1; i++) sectionVocal[i] = 1.0;
    }
  }

  const shareB = new Float32Array(n);
  const fusion = new Float32Array(n);
  const vocal = new Float32Array(n);
  const energy = new Float32Array(n);
  const dominantB = new Uint8Array(n);

  const kUp = (tau: number) => 1 - Math.exp(-dt / tau);

  let sA = 0, sB = 0, sVocal = 0;
  let dom = 0; // 0 = A 主导, 1 = B 主导
  let pending = 0;
  let share = 0.28; // 初始偏向 A 主奏
  let en = 0;

  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const fg = music.foregroundAt(t);
    const focus = music.leadOwnership(t);
    const tb = music.timbreAt(t);
    const midEnv = music.env('mid', t);

    // ────────────────────────── A/B 真实身份识别（绝不按 brightness 分桶！） ──────────────────────────
    // A 组代表色：Melodic Upper Lead（单音主奏主旋律线条）
    // 证据来源：timbre.lead，leadOwnership，foreground.level
    // 即使同一乐器经历高通/低通滤波（brightness 发生改变），其作为主奏旋律的身份保持不变！
    const leadActivity = Math.max(tb.lead, fg.level * focus);
    const rawA = leadActivity * (0.45 + 0.55 * focus);

    // B 组代表色：Synth Stab / Keys / Pluck（节奏型切分伴奏合成器、和弦按键）
    // 证据来源：tb.synthStab, music.pulse('keys'), music.pulse('synthStab')
    const stabPulse = music.pulse ? Math.max(music.pulse('synthStab', t, 0.22), music.pulse('keys', t, 0.25)) : 0;
    const synthStabVal = tb.synthStab || 0;
    const rawB = Math.max(synthStabVal * 1.15, stabPulse * 0.95);

    // ────────────────────────── 人声作为 Lead 参与仲裁 ──────────────────────────
    // 人声真实声学证据（中频能量比与谐波）
    const midAcoustic = smoothUnit((midEnv - 0.05) / 0.14);
    let vRaw = 0;
    if (hasLyrics) {
      // 有歌词时：歌词时间窗与中频能量共同确认
      vRaw = vocalPrior[i] * midAcoustic;
    } else {
      // 无歌词但有音频中频支持与 section 标记：提取音频人声
      vRaw = (sectionVocal[i] ? 0.9 : 0.6) * midAcoustic;
    }

    // 平滑滤波器
    sA += (rawA - sA) * kUp(rawA > sA ? 0.05 : 0.35);
    sB += (rawB - sB) * kUp(rawB > sB ? 0.05 : 0.35);
    // 人声包络：起音快（0.08s），释音短暂明确（0.25s），确保人声结束后在 <0.5s 内完全还原！
    sVocal += (vRaw - sVocal) * kUp(vRaw > sVocal ? 0.08 : 0.25);

    // ────────────────────────── 主导权与代表色占比仲裁 ──────────────────────────
    // 仲裁规则：
    // 1. 无人声时：当且仅当真实 B 类乐器（synthStab/keys）持续明显强于 A（持续超过 0.16s）才切换为 B；
    //    若只有同一旋律音源（无论 brightness 怎么变），sB 接近 0，sA 占绝对优势，稳固保持 A 主导！
    // 2. 有人声介入时：人声主导听觉，人声作为 Lead 参与声部仲裁，推动代表色占比均衡化；
    if (sB > sA * 1.25 + 0.08) {
      pending += dt;
      if (pending >= 0.16) {
        dom = 1;
        pending = 0;
      }
    } else if (sA > sB * 1.20 + 0.04) {
      pending += dt;
      if (pending >= 0.16) {
        dom = 0;
        pending = 0;
      }
    } else {
      pending = 0;
    }

    // 目标占比 targetShare：
    // 当 A 主导时，B 占比低（例如 0.20 附近，A 占 80%）；
    // 当 B 主导时，B 占比高（例如 0.80 附近，B 占 80%）；
    // 当人声强烈时（sVocal > 0），人声调节两组代表色占比向中性协调区（0.50）平滑靠近，为人声融合做好空间准备！
    const baseTarget = dom === 1 ? 0.78 : 0.22;
    const targetWithVocal = mixScalar(baseTarget, 0.50, unit(sVocal * 0.85));
    share += (targetWithVocal - share) * kUp(0.14);

    // ────────────────────────── 融合许可单独控制（严禁无人声融合） ──────────────────────────
    // 只有在检测到真实人声存在（sVocal > 0.05）时才产生融合许可！
    // 人声停止后，fusion 在短暂的恢复窗口（约 0.35s）内彻底归零！
    const isVocalActive = sVocal >= 0.05;
    const fusionTarget = isVocalActive ? smoothUnit((sVocal - 0.05) / 0.75) * 0.72 : 0.0;
    // 快起快落
    const fusionVal = fusionTarget > 0 ? fusionTarget : 0.0;

    // 综合发光能量：结合主奏、和弦以及人声的共同贡献
    const maxActive = Math.max(sA, sB, sVocal * 0.9);
    en += (maxActive - en) * kUp(0.06);

    shareB[i] = share;
    fusion[i] = fusionVal;
    vocal[i] = sVocal;
    energy[i] = unit(en);
    dominantB[i] = dom;
  }

  return { fps, shareB, fusion, vocal, energy, dominantB };
}

function mixScalar(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/** 线性插值读取时间轨（越界时取端点）。 */
export function sampleTrack(arr: Float32Array, fps: number, t: number): number {
  if (!arr.length) return 0;
  const x = Math.max(0, t * fps), i = Math.floor(x);
  if (i >= arr.length - 1) return arr[arr.length - 1];
  return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
}
