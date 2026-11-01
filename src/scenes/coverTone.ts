// 专辑封面色调提取与和谐色板生成器 (Cover Tone & Harmonic Palette Generator)
// 为「水下石柱 (underwater)」与「晚霞水台 (sunset)」等世界场景提取与专辑封面完全一致的色彩基调。
import * as THREE from 'three';
import type { SceneInit } from './types.ts';

export interface SrgbHsl {
  /** 色相 (0..360 度) */
  h: number;
  /** 饱和度 (0..1) */
  s: number;
  /** 明度 (0..1) */
  l: number;
}

export interface CoverToneStops {
  /** 是否为黑白/单色封面 */
  mono: boolean;
  /** 主导色相 (0..360 度) */
  mainHue: number;
  /** 暗部色相 (0..360 度) */
  deepHue: number;
  /** 亮部色相 (0..360 度) */
  highHue: number;
  /** 封面整体饱和度缩放因子 */
  satScale: number;
  /** 从暗到亮的五级封面代表色 (sRGB HSL) */
  dark: SrgbHsl;
  midDark: SrgbHsl;
  mid: SrgbHsl;
  bright: SrgbHsl;
  highlight: SrgbHsl;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const wrapDeg = (deg: number) => ((deg % 360) + 360) % 360;

/** sRGB (0..1) 转 HSL (h: 0..360, s: 0..1, l: 0..1) */
export function rgbToHsl(r: number, g: number, b: number): SrgbHsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) * 0.5;
  if (d < 1e-5) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1) + 1e-6);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h: wrapDeg(h), s: clamp(s, 0, 1), l: clamp(l, 0, 1) };
}

/** HSL (h: 0..360, s: 0..1, l: 0..1) 转 sRGB (0..1) */
export function hslToRgb(hDeg: number, s: number, l: number): [number, number, number] {
  const h = wrapDeg(hDeg) / 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  if (s < 1e-5) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
}

/** 创建 Three.js 颜色对象（输入 sRGB HSL，自动转换为 Three.js 内部线性空间） */
export function colorFromHsl(hDeg: number, s: number, l: number): THREE.Color {
  const [r, g, b] = hslToRgb(hDeg, s, l);
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

/** 创建线性空间 vec3（与 Engine FinishShader 的 pow(srgb, 2.2) 保持一致） */
export function linearVec3FromHsl(hDeg: number, s: number, l: number): THREE.Vector3 {
  const [r, g, b] = hslToRgb(hDeg, s, l);
  return new THREE.Vector3(
    Math.pow(Math.max(0, r), 2.2),
    Math.pow(Math.max(0, g), 2.2),
    Math.pow(Math.max(0, b), 2.2),
  );
}

/** 计算两个色相角 (0..360) 之间的最短有向差 (-180..180) */
function hueDiffDeg(a: number, b: number): number {
  const d = ((a - b) % 360 + 540) % 360 - 180;
  return d;
}

/**
 * 从专辑封面像素与调色板中提取主导色彩基调（色相、饱和度与暗-中-亮五级色阶）。
 */
export function extractCoverTone(init: Pick<SceneInit, 'palette' | 'coverPixels' | 'coverSize'>): CoverToneStops {
  const { palette, coverPixels } = init;
  const sigRgb = { r: 0, g: 0, b: 0 };
  palette.signal.getRGB(sigRgb, THREE.SRGBColorSpace);
  const fallbackHsl = rgbToHsl(sigRgb.r, sigRgb.g, sigRgb.b);

  if (palette.mono || !coverPixels || coverPixels.length < 16) {
    const h = fallbackHsl.h;
    const s = palette.mono ? 0.04 : clamp(fallbackHsl.s, 0.55, 0.88);
    return {
      mono: palette.mono,
      mainHue: h,
      deepHue: wrapDeg(h - 10),
      highHue: wrapDeg(h + 8),
      satScale: palette.mono ? 0.06 : 1.0,
      dark: { h: wrapDeg(h - 10), s: s * 0.72, l: 0.24 },
      midDark: { h: wrapDeg(h - 4), s: s * 0.82, l: 0.42 },
      mid: { h, s: s * 0.90, l: 0.58 },
      bright: { h: wrapDeg(h + 5), s: s * 0.95, l: 0.74 },
      highlight: { h: wrapDeg(h + 9), s: s * 0.92, l: 0.86 },
    };
  }

  // 1. 构建 36 桶色相直方图（按色度与中等明度加权，突出封面主体色调）
  const BINS = 36;
  const hist = new Float64Array(BINS);
  const samples: Array<{ h: number; s: number; l: number; d: number; r: number; g: number; b: number; w: number }> = [];

  const totalPx = coverPixels.length >> 2;
  const step = Math.max(1, Math.floor(totalPx / 4096));
  for (let p = 0; p < totalPx; p += step) {
    const idx = p << 2;
    const r = coverPixels[idx] / 255;
    const g = coverPixels[idx + 1] / 255;
    const b = coverPixels[idx + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) * 0.5;
    if (d < 0.045 || l < 0.06 || l > 0.96) continue;
    const hsl = rgbToHsl(r, g, b);
    // 兼顾色度与明度：避免极暗部噪点干扰，让封面大面积主色调（如粉色晚霞、深海蓝等）占主导
    const lWeight = 0.35 + 0.65 * Math.sin(Math.PI * clamp(l, 0.05, 0.95));
    const w = Math.pow(d, 1.35) * lWeight;
    const bin = Math.floor((hsl.h / 360) * BINS) % BINS;
    hist[bin] += w;
    samples.push({ h: hsl.h, s: hsl.s, l: hsl.l, d, r, g, b, w });
  }

  if (samples.length < 24) {
    const h = fallbackHsl.h;
    const s = clamp(fallbackHsl.s, 0.55, 0.88);
    return {
      mono: false,
      mainHue: h,
      deepHue: wrapDeg(h - 10),
      highHue: wrapDeg(h + 8),
      satScale: 1.0,
      dark: { h: wrapDeg(h - 10), s: s * 0.72, l: 0.24 },
      midDark: { h: wrapDeg(h - 4), s: s * 0.82, l: 0.42 },
      mid: { h, s: s * 0.90, l: 0.58 },
      bright: { h: wrapDeg(h + 5), s: s * 0.95, l: 0.74 },
      highlight: { h: wrapDeg(h + 9), s: s * 0.92, l: 0.86 },
    };
  }

  // 平滑色相直方图并寻找主导色相峰值
  const smoothHist = new Float64Array(BINS);
  let bestBin = 0;
  for (let i = 0; i < BINS; i++) {
    const prev = hist[(i + BINS - 1) % BINS];
    const next = hist[(i + 1) % BINS];
    smoothHist[i] = hist[i] * 0.5 + (prev + next) * 0.25;
    if (smoothHist[i] > smoothHist[bestBin]) bestBin = i;
  }
  const peakCenterDeg = ((bestBin + 0.5) / BINS) * 360;

  // 2. 筛选属于封面主色系（距离峰值 ±36° 以内）的像素，计算主色相与五级明度分位代表色
  const family = samples.filter(sp => Math.abs(hueDiffDeg(sp.h, peakCenterDeg)) <= 36);
  const pool = family.length >= 16 ? family : samples;

  let cosSum = 0;
  let sinSum = 0;
  let sSum = 0;
  let wSum = 0;
  for (const sp of pool) {
    const rad = (sp.h * Math.PI) / 180;
    cosSum += Math.cos(rad) * sp.w;
    sinSum += Math.sin(rad) * sp.w;
    sSum += sp.s * sp.w;
    wSum += sp.w;
  }

  const mainHue = wrapDeg((Math.atan2(sinSum, cosSum) * 180) / Math.PI);
  const meanSat = wSum > 0 ? sSum / wSum : fallbackHsl.s;
  const satScale = clamp(0.82 + 0.26 * meanSat, 0.78, 1.08);

  // 按明度排序主色系像素，提取 5 个明度分位窗口的平均 RGB 并转回 HSL
  const sorted = pool.slice().sort((a, b) => a.l - b.l);
  const sampleQuantileBand = (qCenter: number, halfSpan = 0.08): SrgbHsl => {
    const n = sorted.length;
    const i0 = Math.max(0, Math.floor((qCenter - halfSpan) * n));
    const i1 = Math.min(n - 1, Math.ceil((qCenter + halfSpan) * n));
    let rAcc = 0, gAcc = 0, bAcc = 0, wAcc = 0;
    for (let i = i0; i <= i1; i++) {
      const sp = sorted[i];
      rAcc += sp.r * sp.w;
      gAcc += sp.g * sp.w;
      bAcc += sp.b * sp.w;
      wAcc += sp.w;
    }
    if (wAcc <= 1e-6) return { h: mainHue, s: meanSat, l: qCenter };
    const hsl = rgbToHsl(rAcc / wAcc, gAcc / wAcc, bAcc / wAcc);
    // 将分位色相约束在主色相 ±18° 内，保证整体色调纯净统一
    const dh = clamp(hueDiffDeg(hsl.h, mainHue), -18, 18);
    return { h: wrapDeg(mainHue + dh), s: hsl.s, l: hsl.l };
  };

  const qDark = sampleQuantileBand(0.14);
  const qMidDark = sampleQuantileBand(0.36);
  const qMid = sampleQuantileBand(0.60);
  const qBright = sampleQuantileBand(0.80);
  const qHighlight = sampleQuantileBand(0.93);

  // 暖色/粉色系 (280°..360° 或 0°..70°) 暗部向紫兰/深玫红偏移、亮部向珊瑚暖金偏移；冷色系反之
  const isWarmOrPink = mainHue >= 280 || mainHue <= 70;
  const naturalDeepShift = isWarmOrPink ? -11 : 9;
  const naturalHighShift = isWarmOrPink ? 10 : -7;

  const deepHue = wrapDeg(mainHue + clamp(hueDiffDeg(qDark.h, mainHue) * 0.45 + naturalDeepShift * 0.55, -16, 16));
  const highHue = wrapDeg(mainHue + clamp(hueDiffDeg(qHighlight.h, mainHue) * 0.45 + naturalHighShift * 0.55, -16, 16));

  return {
    mono: false,
    mainHue,
    deepHue,
    highHue,
    satScale,
    dark: qDark,
    midDark: qMidDark,
    mid: qMid,
    bright: qBright,
    highlight: qHighlight,
  };
}

/**
 * 将提取到的封面分位色规整到目标场景所需的明度与饱和度区间，保留封面的色相与粉彩/浓郁特质。
 */
export function tuneCoverStop(
  stop: SrgbHsl,
  tone: CoverToneStops,
  minL: number,
  maxL: number,
  minS: number,
  maxS: number,
  hueBiasDeg = 0,
): SrgbHsl {
  if (tone.mono) {
    return { h: tone.mainHue, s: 0.04, l: (minL + maxL) * 0.5 };
  }
  const h = wrapDeg(stop.h + hueBiasDeg);
  const s = clamp(stop.s * tone.satScale, minS, maxS);
  const l = clamp(stop.l, minL, maxL);
  return { h, s, l };
}
