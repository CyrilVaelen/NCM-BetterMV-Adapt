// 激光舞台 · 镭射穹廊 (Superclub Laser Arena): 专为 EDM 电音节高潮 Drop 量身打造的沉浸式全彩体积激光秀场景。
// 空间架构（Afterlife / Hï Ibiza 无界深邃超大型电音暗场风，100% 纯时间函数 f(t) 驱动，零帧间状态累积）：
// 1. 纯净深邃无界暗场（零毛坯支撑立柱与顶梁）：主舞台集中挂载 28 组四眼观众盲眼灯（巨幕顶冠 + 频谱灯塔侧翼 + 台唇），
//    随底鼓重拍泛起封面同源热惯性余晖，两侧高空激光阵列隐没于深黑空间中直接切穿干冰薄雾；
// 2. 舞台中央视觉核心与镜面黑金地坪：远景舞台矗立 1:1 巨幅微距 RGB LED 点阵封面主屏与两侧 12 半音全彩频谱灯塔，
//    下方设重工业超低音炮阵列台座、拉丝黑钛铝折面 DJ 控台与三维骨骼锐舞 DJ；全场铺设湿润黑曜石反光地面，1:1 菲涅尔倒映漫天彩光；
// 3. 纯封面像素提取 6 槽渐变色板 + 双模式灯光色彩编排（空间平滑渐变 SPATIAL_GRADIENT / 全屏同色瞬切 UNISON_SWITCH）：
//    - 100% 源自封面真实可见像素区域聚类（零虚构色相、零浅色饱和度夸大、自动剔除微小噪点杂色）；
//    - 空间平滑渐变模式：同屏多色沿感知最短渐变路径排布，空间相邻的光扇、光束、圆锥与灯塔颜色严格相近渐变；
//    - 全屏同色瞬切模式：全屏所有激光与舞台灯具锁定同一封面提取色 1，随军鼓/重音瞬时切换至封面提取色 2。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import type { Section } from '../types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { sameSceneBlend, stableShotSeed } from './cameraBlend.ts';
import { LyricRig } from './lyricRig.ts';
import { voiceFaces } from './lyricBlock.ts';
import { lastIndex, type Music } from '../director/music.ts';
import { rgbToLab, type Lab, type Palette } from '../render/palette.ts';
import { colorFromHsl, rgbToHsl } from './coverTone.ts';

/** 激光色板总槽位数（从专辑封面像素中深度挖掘最多 6 组独立色彩波长） */
const LASER_PALETTE_SIZE = 6;

/** 舞台与中央巨幅微距 LED 主屏几何常量 */
const STAGE_Z = -54.5;
const SCREEN_SIZE = 15.6;
const SCREEN_CENTER_Y = 10.1;
const STAGE_DECK_H = 1.82;
const STAGE_LIP_Z = -46.8;

/** 四大灯光系统实例容量（均含天空本体 + 湿润地面 1:1 镜像对偶） */
const SHEET_EMITTER_COUNT = 14;
const BEAM_EMITTER_COUNT = 36;
const CONE_LAYER_COUNT = 2;
const CRYO_JET_COUNT = 8;
const BLINDER_COUNT = 28;
const CAM_FOV = 52;

/** 预构建的军鼓/合成器重音激光快切脉冲事件 */
interface ChopperHitEvent {
  /** 触发时间戳（秒） */
  t: number;
  /** 脉冲强度 [0..1.3] */
  amp: number;
  /** 控台快切阵型模式：0=X剪刀对切, 1=中心向外波浪, 2=顶棚铡刀下劈, 3=对称点射矩阵 */
  pattern: number;
  /** 左右交替极性 (-1 或 +1) */
  parity: number;
  /** 主导半音索引 [0..11] */
  note: number;
}

/** 预构建的舞台前缘 CO2 低温气柱喷发事件 */
interface CryoBlastEvent {
  /** 喷发起始时刻（秒） */
  t: number;
  /** 喷射持续时长（秒） */
  dur: number;
  /** 喷射高度强度系数 [0.7..1.25] */
  strength: number;
  /** 喷发编组：0=全场8柱齐射, 1=内侧4柱冲天, 2=由内向外极速排射 */
  mode: number;
}

/** 激光发射台静态布局描述 */
interface SheetEmitterSpec {
  x: number;
  y: number;
  z: number;
  /** 0=舞台正前主排(Liquid Sky), 1=走廊左侧翼下倾, 2=走廊右侧翼下倾 */
  bank: number;
  /** 组内序号 */
  idx: number;
  /** 默认偏航角（弧度，0 表示朝 +Z 观众席正前方） */
  baseYaw: number;
  /** 默认俯仰角（弧度，负值向下压） */
  basePitch: number;
  /** 光幕长度（米） */
  length: number;
}

interface BeamEmitterSpec {
  x: number;
  y: number;
  z: number;
  /** 0=舞台顶排下劈, 1=舞台前缘上挑, 2=左翼龙门斜切, 3=右翼龙门斜切 */
  group: number;
  /** 组内序号 */
  slot: number;
  /** 归一化横向位置 [-1..1] */
  normX: number;
}

/** 预构建的全屏同色瞬切事件（模式 B：全屏统一颜色 1 -> 下一重音瞬切为封面颜色 2） */
interface UnisonCutEvent {
  /** 瞬切触发时间戳（秒） */
  t: number;
  /** 切换到的封面色板槽位索引 [0..5] */
  slot: number;
}

const clampRange = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

interface SamplePixel {
  r: number;
  g: number;
  b: number;
  v: number;
  d: number;
  p0: number;
  p1: number;
  p2: number;
}

interface ExtractedCoverSwatch {
  col: THREE.Vector3;
  core: THREE.Vector3;
  outR: number;
  outG: number;
  outB: number;
  sOut: number;
  chromaD: number;
  rawShare: number;
  pos: [number, number, number];
}

function srgbToLinearVec3(r: number, g: number, b: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.pow(clampRange(r, 0, 1), 2.2),
    Math.pow(clampRange(g, 0, 1), 2.2),
    Math.pow(clampRange(b, 0, 1), 2.2),
  );
}

/**
 * 将封面真实聚类像素均值 (r, g, b) 无失真转换为光学激光色与亮芯色：
 * - 色相 100% 锁定原像素 RGB 比例向量（0° 偏移，严禁生造异色）；
 * - 饱和度严格受原像素真实色度差 d = max - min 与 HSV 纯度双重约束，浅暖云雾保持柔和云白/香槟白，绝不夸大为荧光橙/红。
 */
function clusterRgbToLaserSwatch(
  r: number,
  g: number,
  b: number,
  rawShare: number,
  vOffset = 0,
): ExtractedCoverSwatch {
  const v = Math.max(r, g, b);
  const m = Math.min(r, g, b);
  const d = v - m;

  let outR: number;
  let outG: number;
  let outB: number;
  let coreR: number;
  let coreG: number;
  let coreB: number;
  let sOut: number;

  if (d < 0.032) {
    sOut = 0;
    const vOut = clampRange(0.68 + 0.14 * v + vOffset, 0.62, 0.82);
    outR = vOut;
    outG = vOut;
    outB = vOut;
    const coreV = Math.min(0.95, vOut + 0.12);
    coreR = coreV;
    coreG = coreV;
    coreB = coreV;
  } else {
    const hsvS = d / Math.max(1e-4, v);
    const uR = (r - m) / d;
    const uG = (g - m) / d;
    const uB = (b - m) / d;

    // 浅暖云层 / 奶油白纸底（低色度差或低纯度）绝不放大饱和度；鲜明高色度封面保持饱满激光纯度
    const isPaleTint = hsvS < 0.26 || (d < 0.16 && v > 0.64);
    const satGain = isPaleTint ? 0.88 : hsvS < 0.48 ? 1.02 : 1.08;
    const maxByChroma = clampRange(d * 2.15, 0.03, 0.96);
    sOut = clampRange(Math.min(hsvS * satGain, maxByChroma), 0.0, 0.96);

    // 感知辐射能量平衡：低饱和白色/浅云色三通道同时发光，适度收敛外晕明度防止全屏白光过曝泛雾，高纯度彩色保持满功率炽亮
    const vRaw = clampRange(Math.max(v * 0.96, 0.72 + 0.20 * v) + vOffset, 0.66, 0.94);
    const whiteDamp = 1.0 - 0.17 * Math.pow(1.0 - sOut, 1.5);
    const vOut = clampRange(vRaw * whiteDamp, 0.62, 0.94);
    outR = vOut * (1 - sOut + sOut * uR);
    outG = vOut * (1 - sOut + sOut * uG);
    outB = vOut * (1 - sOut + sOut * uB);

    const coreV = Math.min(0.97, vOut + 0.11);
    const coreS = sOut * 0.64;
    coreR = coreV * (1 - coreS + coreS * uR);
    coreG = coreV * (1 - coreS + coreS * uG);
    coreB = coreV * (1 - coreS + coreS * uB);
  }

  const lab: Lab = rgbToLab(outR, outG, outB);
  return {
    col: srgbToLinearVec3(outR, outG, outB),
    core: srgbToLinearVec3(coreR, coreG, coreB),
    outR,
    outG,
    outB,
    sOut,
    chromaD: d,
    rawShare,
    pos: [lab[0], lab[1] * 2.0, lab[2] * 2.0],
  };
}

function posDist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * 精确穷举 6! = 720 种排列，求解 OKLab 感知空间全局最短哈密顿路径，
 * 确保 uLaserPalette[0 -> 1 -> 2 -> 3 -> 4 -> 5] 构成严格平滑的 1D 连续封面色彩渐变。
 */
function orderSwatchesAsSmoothGradient(swatches: ExtractedCoverSwatch[]): ExtractedCoverSwatch[] {
  const n = swatches.length;
  if (n <= 2) {
    return swatches.slice().sort((a, b) => a.pos[0] - b.pos[0]);
  }
  const distMat: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => posDist(swatches[i].pos, swatches[j].pos)),
  );

  const used = new Uint8Array(n);
  const cur = new Int32Array(n);
  let bestPerm = Array.from({ length: n }, (_, i) => i);
  let bestCost = Infinity;

  const dfs = (depth: number, costSoFar: number) => {
    if (costSoFar >= bestCost) return;
    if (depth === n) {
      bestCost = costSoFar;
      bestPerm = Array.from(cur);
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = 1;
      cur[depth] = i;
      const stepCost = depth === 0 ? 0 : distMat[cur[depth - 1]][i];
      dfs(depth + 1, costSoFar + stepCost);
      used[i] = 0;
    }
  };
  dfs(0, 0);

  // 统一渐变方向：槽位 0 为封面较深沉端，槽位 5 为封面较明亮端（贴合灯塔与主屏由下至上的视觉层次）
  if (swatches[bestPerm[0]].pos[0] > swatches[bestPerm[n - 1]].pos[0]) {
    bestPerm.reverse();
  }
  return bestPerm.map(idx => swatches[idx]);
}

/**
 * 为模式 B（全屏同色瞬切）构建高辨识度封面色轮换序列：
 * 去重近似色并按感知对比度最大化跳跃排序，保证每次全屏切换都干脆利落且 100% 源自封面。
 */
function buildDistinctUnisonOrder(ordered: ExtractedCoverSwatch[]): number[] {
  let startIdx = 0;
  let bestProm = -1;
  for (let i = 0; i < ordered.length; i++) {
    const prom = ordered[i].rawShare * (0.28 + 0.72 * ordered[i].chromaD);
    if (prom > bestProm) {
      bestProm = prom;
      startIdx = i;
    }
  }

  const distinct: number[] = [startIdx];
  while (distinct.length < ordered.length) {
    let nextCand = -1;
    let bestMinD = -1;
    for (let i = 0; i < ordered.length; i++) {
      if (distinct.includes(i)) continue;
      let minD = Infinity;
      for (const dIdx of distinct) {
        const dist = posDist(ordered[i].pos, ordered[dIdx].pos);
        if (dist < minD) minD = dist;
      }
      if (minD > bestMinD) {
        bestMinD = minD;
        nextCand = i;
      }
    }
    if (nextCand < 0 || bestMinD < 0.068) break;
    distinct.push(nextCand);
  }

  // 保底确保至少有 2 个槽位参与切换（例如极度平涂的单色封面在深浅两档间切换）
  if (distinct.length < 2 && ordered.length >= 2) {
    const alt = startIdx === 0 ? ordered.length - 1 : 0;
    distinct.push(alt);
  }

  // 贪心最大对比度跳跃排序，使相邻两次瞬切颜色反差最鲜明
  const seq: number[] = [distinct[0]];
  const rem = distinct.slice(1);
  while (rem.length > 0) {
    const prev = seq[seq.length - 1];
    let bestK = 0;
    let maxD = -1;
    for (let k = 0; k < rem.length; k++) {
      const d = posDist(ordered[prev].pos, ordered[rem[k]].pos);
      if (d > maxD) {
        maxD = d;
        bestK = k;
      }
    }
    seq.push(rem.splice(bestK, 1)[0]);
  }
  return seq;
}

export interface CoverLaserPaletteResult {
  mono: boolean;
  lyricHue: number;
  lyricSat: number;
  laserPalette: THREE.Vector3[];
  laserCores: THREE.Vector3[];
  unisonSlots: number[];
  laserPrimary: THREE.Vector3;
  laserSecondary: THREE.Vector3;
  laserPrimaryCore: THREE.Vector3;
  laserSecondaryCore: THREE.Vector3;
  blinderWarm: THREE.Vector3;
  coverGlow: THREE.Vector3;
  envDark: THREE.Vector3;
  bgHex: THREE.Color;
}

/**
 * 纯封面可见像素聚类提取 6 槽激光色板（零虚构色相、零浅色饱和度夸大、自动剔除 <2.2% 微小噪点杂色）：
 * - 直接对 init.coverPixels 可见区域执行 3D 感知体素密度滤波与 OKLab K-Means 聚类；
 * - 面积不足 2.2% 的细碎杂色（如建筑角落极细暗红线条、角标噪点）被彻底剔除，由封面大面积主色自然拆分为深浅相近色补齐；
 * - 最终 6 槽通过 6! 全局最短路径排成丝滑 1D 渐变，并生成高对比度全屏瞬切序列 unisonSlots。
 */
function buildCoverLaserColors(init: SceneInit): CoverLaserPaletteResult {
  const px = init.coverPixels;
  const samples: SamplePixel[] = [];

  if (px && px.length >= 16) {
    const totalPixels = px.length >>> 2;
    const stride = Math.max(1, Math.floor(totalPixels / 8192));
    for (const minV of [0.095, 0.02]) {
      samples.length = 0;
      for (let idx = 0; idx < totalPixels; idx += stride) {
        const off = idx << 2;
        if (px[off + 3] < 64) continue;
        const r = px[off] / 255;
        const g = px[off + 1] / 255;
        const b = px[off + 2] / 255;
        const v = r > g ? (r > b ? r : b) : (g > b ? g : b);
        if (v < minV) continue;
        const m = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const lab = rgbToLab(r, g, b);
        samples.push({
          r,
          g,
          b,
          v,
          d: v - m,
          p0: lab[0],
          p1: lab[1] * 2.1,
          p2: lab[2] * 2.1,
        });
      }
      if (samples.length >= 32) break;
    }
  }

  // 检测黑白/无彩色封面（90% 分位真实色度差 < 0.045）
  const dSorted = samples.map(s => s.d).sort((a, b) => a - b);
  const d90 = dSorted.length > 0 ? dSorted[Math.min(dSorted.length - 1, Math.floor(dSorted.length * 0.90))] : 0;
  if (init.palette.mono || samples.length < 8 || d90 < 0.045) {
    const monoVs = [0.68, 0.73, 0.78, 0.83, 0.89, 0.94];
    const swatches = monoVs.map(v => clusterRgbToLaserSwatch(v, v, v, 1 / 6));
    const laserPalette = swatches.map(s => s.col);
    const laserCores = swatches.map(s => s.core);
    return {
      mono: true,
      lyricHue: 215,
      lyricSat: 0.04,
      laserPalette,
      laserCores,
      unisonSlots: [5, 1, 4, 0],
      laserPrimary: laserPalette[1].clone(),
      laserSecondary: laserPalette[5].clone(),
      laserPrimaryCore: laserCores[1].clone(),
      laserSecondaryCore: laserCores[5].clone(),
      blinderWarm: laserPalette[4].clone(),
      coverGlow: srgbToLinearVec3(0.45, 0.45, 0.46),
      envDark: new THREE.Vector3(0.0015, 0.0016, 0.0018),
      bgHex: colorFromHsl(215, 0.04, 0.012),
    };
  }

  const N = samples.length;

  // 1. 4×12×12 感知体素网格局部密度滤波：过滤孤立微小噪点，确保初始种子 100% 落在封面显著色块上
  const GL = 4;
  const GA = 12;
  const GB = 12;
  const GRID_TOTAL = GL * GA * GB;
  const cellCount = new Int32Array(GRID_TOTAL);
  const cellP0 = new Float64Array(GRID_TOTAL);
  const cellP1 = new Float64Array(GRID_TOTAL);
  const cellP2 = new Float64Array(GRID_TOTAL);

  for (let i = 0; i < N; i++) {
    const s = samples[i];
    const il = clampRange(Math.floor(s.p0 * GL), 0, GL - 1);
    const ia = clampRange(Math.floor(((s.p1 / 2.1 + 0.36) / 0.72) * GA), 0, GA - 1);
    const ib = clampRange(Math.floor(((s.p2 / 2.1 + 0.36) / 0.72) * GB), 0, GB - 1);
    const cid = (il * GA + ia) * GB + ib;
    cellCount[cid]++;
    cellP0[cid] += s.p0;
    cellP1[cid] += s.p1;
    cellP2[cid] += s.p2;
  }

  interface SeedCell {
    count: number;
    neighCount: number;
    c0: number;
    c1: number;
    c2: number;
  }
  const allCells: SeedCell[] = [];
  for (let il = 0; il < GL; il++) {
    for (let ia = 0; ia < GA; ia++) {
      for (let ib = 0; ib < GB; ib++) {
        const cid = (il * GA + ia) * GB + ib;
        const cnt = cellCount[cid];
        if (cnt === 0) continue;
        let neigh = 0;
        for (let dl = -1; dl <= 1; dl++) {
          const nl = il + dl;
          if (nl < 0 || nl >= GL) continue;
          for (let da = -1; da <= 1; da++) {
            const na = ia + da;
            if (na < 0 || na >= GA) continue;
            for (let db = -1; db <= 1; db++) {
              const nb = ib + db;
              if (nb < 0 || nb >= GB) continue;
              neigh += cellCount[(nl * GA + na) * GB + nb];
            }
          }
        }
        allCells.push({
          count: cnt,
          neighCount: neigh,
          c0: cellP0[cid] / cnt,
          c1: cellP1[cid] / cnt,
          c2: cellP2[cid] / cnt,
        });
      }
    }
  }

  const minNeighSupport = Math.max(3, Math.floor(N * 0.020));
  let seedPool = allCells.filter(c => c.neighCount >= minNeighSupport);
  if (seedPool.length === 0) seedPool = allCells;
  seedPool.sort((a, b) => b.count - a.count);

  // 确定性最远点覆盖初始化（兼顾色块面积权重与跨色系覆盖度）
  const K = LASER_PALETTE_SIZE;
  const centers: Array<[number, number, number]> = [
    [seedPool[0].c0, seedPool[0].c1, seedPool[0].c2],
  ];
  const pickedCellIdx = new Set<number>([0]);
  while (centers.length < K && pickedCellIdx.size < seedPool.length) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < seedPool.length; i++) {
      if (pickedCellIdx.has(i)) continue;
      const cand = seedPool[i];
      let minDSq = Infinity;
      for (const ct of centers) {
        const dSq = (cand.c0 - ct[0]) ** 2 + (cand.c1 - ct[1]) ** 2 + (cand.c2 - ct[2]) ** 2;
        if (dSq < minDSq) minDSq = dSq;
      }
      const score = minDSq * Math.pow(cand.count / N, 0.32);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    pickedCellIdx.add(bestIdx);
    centers.push([seedPool[bestIdx].c0, seedPool[bestIdx].c1, seedPool[bestIdx].c2]);
  }
  while (centers.length < K) {
    const base = centers[centers.length % Math.max(1, pickedCellIdx.size)];
    const shift = (centers.length - 2.5) * 0.02;
    centers.push([clampRange(base[0] + shift, 0.05, 0.95), base[1], base[2]]);
  }

  // 2. 在封面可见像素上执行 12 轮确定性 K-Means 聚类
  const assign = new Int32Array(N);
  for (let iter = 0; iter < 12; iter++) {
    const sum0 = new Float64Array(K);
    const sum1 = new Float64Array(K);
    const sum2 = new Float64Array(K);
    const cnt = new Int32Array(K);
    for (let i = 0; i < N; i++) {
      const s = samples[i];
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < K; c++) {
        const ct = centers[c];
        const dSq = (s.p0 - ct[0]) ** 2 + (s.p1 - ct[1]) ** 2 + (s.p2 - ct[2]) ** 2;
        if (dSq < bestD) {
          bestD = dSq;
          bestC = c;
        }
      }
      assign[i] = bestC;
      sum0[bestC] += s.p0;
      sum1[bestC] += s.p1;
      sum2[bestC] += s.p2;
      cnt[bestC]++;
    }
    for (let c = 0; c < K; c++) {
      if (cnt[c] > 0) {
        centers[c] = [sum0[c] / cnt[c], sum1[c] / cnt[c], sum2[c] / cnt[c]];
      }
    }
  }

  const rawClusters: SamplePixel[][] = Array.from({ length: K }, () => []);
  for (let i = 0; i < N; i++) {
    rawClusters[assign[i]].push(samples[i]);
  }

  // 3. 严格最小面积剪枝：剔除占比 < 2.2% 的细碎杂色簇（连同其离群像素一并丢弃，绝不污染有效色簇均值）
  const minClusterCount = Math.max(2, Math.floor(N * 0.022));
  let validClusters = rawClusters.filter(cl => cl.length >= minClusterCount);
  if (validClusters.length === 0) {
    rawClusters.sort((a, b) => b.length - a.length);
    validClusters = [rawClusters[0]];
  }

  // 若剔除微小噪点后簇数不足 6，则沿主色簇自身最大感知方差轴拆分为真实的封面深浅相近色阶
  const clusterSpread = (cl: SamplePixel[]): { axis: 0 | 1 | 2; variance: number; meanD: number } => {
    const len = cl.length;
    if (len < 4) return { axis: 0, variance: 0, meanD: 0 };
    let m0 = 0, m1 = 0, m2 = 0, md = 0;
    for (let i = 0; i < len; i++) {
      m0 += cl[i].p0;
      m1 += cl[i].p1;
      m2 += cl[i].p2;
      md += cl[i].d;
    }
    m0 /= len; m1 /= len; m2 /= len; md /= len;
    let v0 = 0, v1 = 0, v2 = 0;
    for (let i = 0; i < len; i++) {
      v0 += (cl[i].p0 - m0) ** 2;
      v1 += (cl[i].p1 - m1) ** 2;
      v2 += (cl[i].p2 - m2) ** 2;
    }
    v0 /= len; v1 /= len; v2 /= len;
    const axis: 0 | 1 | 2 = v0 >= v1 && v0 >= v2 ? 0 : v1 >= v2 ? 1 : 2;
    return { axis, variance: v0 + v1 + v2, meanD: md };
  };

  while (validClusters.length < LASER_PALETTE_SIZE) {
    let splitIdx = 0;
    let bestSplitScore = -1;
    let chosenAxis: 0 | 1 | 2 = 0;
    for (let i = 0; i < validClusters.length; i++) {
      const cl = validClusters[i];
      if (cl.length < 4) continue;
      const sp = clusterSpread(cl);
      const score = cl.length * (1.0 + sp.meanD * 2.4) * (0.010 + sp.variance);
      if (score > bestSplitScore) {
        bestSplitScore = score;
        splitIdx = i;
        chosenAxis = sp.axis;
      }
    }
    const target = validClusters[splitIdx];
    if (!target || target.length < 4) {
      validClusters.push(target ? target.slice() : samples.slice(0, 8));
      continue;
    }
    const sorted = target.slice().sort((a, b) =>
      chosenAxis === 0 ? a.p0 - b.p0 : chosenAxis === 1 ? a.p1 - b.p1 : a.p2 - b.p2,
    );
    const mid = sorted.length >>> 1;
    validClusters.splice(splitIdx, 1, sorted.slice(0, mid), sorted.slice(mid));
  }

  if (validClusters.length > LASER_PALETTE_SIZE) {
    validClusters.sort((a, b) => b.length - a.length);
    validClusters = validClusters.slice(0, LASER_PALETTE_SIZE);
  }

  // 4. 计算各真实像素簇的代表色（簇内轻微偏向明亮干净像素，保持真实色彩饱和度与色相）
  const rawMeans = validClusters.map(cl => {
    let wSum = 0, rSum = 0, gSum = 0, bSum = 0;
    for (let i = 0; i < cl.length; i++) {
      const p = cl[i];
      const w = 0.35 + 0.65 * p.v;
      wSum += w;
      rSum += p.r * w;
      gSum += p.g * w;
      bSum += p.b * w;
    }
    const inv = 1 / Math.max(1e-6, wSum);
    const mr = rSum * inv;
    const mg = gSum * inv;
    const mb = bSum * inv;
    return {
      r: mr,
      g: mg,
      b: mb,
      share: cl.length / N,
      lab: rgbToLab(mr, mg, mb),
    };
  });

  // 仅当纯平涂矢量封面拆分出完全相同的 RGB 簇时，做微小同色相明度区分（0° 色相变化）
  const rawSwatches: ExtractedCoverSwatch[] = [];
  for (let i = 0; i < rawMeans.length; i++) {
    let dupCount = 0;
    for (let j = 0; j < i; j++) {
      const dl = Math.hypot(
        rawMeans[i].lab[0] - rawMeans[j].lab[0],
        rawMeans[i].lab[1] - rawMeans[j].lab[1],
        rawMeans[i].lab[2] - rawMeans[j].lab[2],
      );
      if (dl < 0.016) dupCount++;
    }
    const vOffset = dupCount === 0 ? 0 : (dupCount % 2 === 1 ? -0.055 : 0.045) * Math.ceil(dupCount * 0.5);
    rawSwatches.push(clusterRgbToLaserSwatch(rawMeans[i].r, rawMeans[i].g, rawMeans[i].b, rawMeans[i].share, vOffset));
  }

  // 5. 排列为 1D 全局最平滑感知渐变路径 + 构建高辨识度全屏同色瞬切序列
  const ordered = orderSwatchesAsSmoothGradient(rawSwatches);
  const unisonSlots = buildDistinctUnisonOrder(ordered);

  const laserPalette = ordered.map(s => s.col);
  const laserCores = ordered.map(s => s.core);

  // 从已验证的封面提取色中派生屏幕背光、歌词色调与深邃暗场环境底色（零外部越界色相污染）
  let bestLyricIdx = 0;
  let bestLyricScore = -1;
  const glowAccum = new THREE.Vector3(0, 0, 0);
  let shareSum = 0;
  for (let i = 0; i < ordered.length; i++) {
    const sw = ordered[i];
    glowAccum.addScaledVector(sw.col, sw.rawShare);
    shareSum += sw.rawShare;
    const sc = sw.rawShare * 0.35 + sw.chromaD;
    if (sc > bestLyricScore) {
      bestLyricScore = sc;
      bestLyricIdx = i;
    }
  }
  if (shareSum > 1e-5) glowAccum.multiplyScalar(0.56 / shareSum);

  const lyricSw = ordered[bestLyricIdx];
  const lyricHsl = rgbToHsl(lyricSw.outR, lyricSw.outG, lyricSw.outB);
  const darkSw = ordered[0];
  const darkHsl = rgbToHsl(darkSw.outR, darkSw.outG, darkSw.outB);
  const envSat = clampRange(darkSw.sOut * 0.45, 0.04, 0.42);

  const primaryIdx = unisonSlots[0] ?? 0;

  return {
    mono: false,
    lyricHue: lyricHsl.h,
    lyricSat: clampRange(lyricSw.sOut * 1.08, 0.06, 0.90),
    laserPalette,
    laserCores,
    unisonSlots,
    laserPrimary: laserPalette[0].clone(),
    laserSecondary: laserPalette[ordered.length - 1].clone(),
    laserPrimaryCore: laserCores[0].clone(),
    laserSecondaryCore: laserCores[ordered.length - 1].clone(),
    blinderWarm: laserPalette[primaryIdx].clone(),
    coverGlow: glowAccum,
    envDark: srgbToLinearVec3(
      darkSw.outR * 0.13,
      darkSw.outG * 0.13,
      darkSw.outB * 0.13,
    ),
    bgHex: colorFromHsl(darkHsl.h, envSat, 0.010),
  };
}

/** 构建 14 座高功率振镜扫描光幕发射台坐标 */
function buildSheetEmitters(): SheetEmitterSpec[] {
  const list: SheetEmitterSpec[] = [];
  // 0..5: 远景舞台巨幕顶梁与 DJ 台主炮（6 台正前宽幅 Liquid Sky 发射器）
  const stageXs = [-12.6, -7.2, -2.4, 2.4, 7.2, 12.6];
  for (let i = 0; i < 6; i++) {
    const x = stageXs[i];
    const isInner = Math.abs(x) < 4.0;
    list.push({
      x,
      y: isInner ? 18.05 : 17.55,
      z: -52.4,
      bank: 0,
      idx: i,
      baseYaw: -x * 0.016,
      basePitch: isInner ? -0.14 : -0.18,
      length: 72.0,
    });
  }
  // 6..9: 左侧纵深桁架立柱高处内倾激光台
  const bayZs = [-41.5, -31.0, -20.5, -10.0];
  for (let i = 0; i < 4; i++) {
    list.push({
      x: -16.4,
      y: 15.2,
      z: bayZs[i],
      bank: 1,
      idx: i,
      baseYaw: 0.62,
      basePitch: -0.28,
      length: 48.0,
    });
  }
  // 10..13: 右侧纵深桁架立柱高处内倾激光台
  for (let i = 0; i < 4; i++) {
    list.push({
      x: 16.4,
      y: 15.2,
      z: bayZs[i],
      bank: 2,
      idx: i,
      baseYaw: -0.62,
      basePitch: -0.28,
      length: 48.0,
    });
  }
  return list;
}

/** 构建 36 座高锐度单束铡刀激光发射头坐标 */
function buildBeamEmitters(): BeamEmitterSpec[] {
  const list: BeamEmitterSpec[] = [];
  // Group 0 (12 束): 舞台顶梁高密矩阵排
  for (let i = 0; i < 12; i++) {
    const u = (i / 11) * 2 - 1;
    list.push({ x: u * 15.2, y: 17.35, z: -51.8, group: 0, slot: i, normX: u });
  }
  // Group 1 (12 束): 舞台前缘低位仰射激光排（紧贴 Stage Lip）
  for (let i = 0; i < 12; i++) {
    const u = (i / 11) * 2 - 1;
    list.push({ x: u * 13.8, y: STAGE_DECK_H + 0.18, z: STAGE_LIP_Z + 0.25, group: 1, slot: i, normX: u });
  }
  // Group 2 (6 束): 走廊左侧龙门架斜切排
  const sideZs = [-41.5, -31.0, -20.5, -10.0, 0.5, -46.8];
  for (let i = 0; i < 6; i++) {
    list.push({ x: -16.6, y: 12.8 + (i % 2) * 3.4, z: sideZs[i], group: 2, slot: i, normX: -1 });
  }
  // Group 3 (6 束): 走廊右侧龙门架斜切排
  for (let i = 0; i < 6; i++) {
    list.push({ x: 16.6, y: 12.8 + (i % 2) * 3.4, z: sideZs[i], group: 3, slot: i, normX: 1 });
  }
  return list;
}

/** 预构建全曲确定性激光快切事件、全屏同色瞬切事件与 Drop 前缘 CO2 气柱喷发事件 */
function buildLaserShowEvents(
  music: Music,
  seed: number,
  unisonSlots: number[],
): {
  choppers: ChopperHitEvent[];
  chopperTimes: Float64Array;
  unisonCuts: UnisonCutEvent[];
  unisonCutTimes: Float64Array;
  cryos: CryoBlastEvent[];
  cryoTimes: Float64Array;
} {
  const rand = rng((seed ^ 0x7a5e91b3) >>> 0);
  const dur = Math.max(1, music.duration);
  const env = music.a.env;
  const chroma = env.chroma;
  const avgBeatDur = 60 / Math.max(40, music.a.bpm || 128);

  // 融合 synthStab（主军鼓/重音和弦刺）与 lead 强起音，若稀疏则用节拍补齐
  const stabs = music.roleHits('synthStab', 0, dur);
  const leads = music.roleHits('lead', 0, dur);
  const snares = music.a.hits.snare ?? [];

  const merged: Array<{ t: number; amp: number; kind: number }> = [];
  for (const [t, s] of stabs) if (s > 0.18) merged.push({ t, amp: s * 1.12, kind: 0 });
  for (const [t, s] of snares) if (s > 0.22) merged.push({ t, amp: s * 1.05, kind: 1 });
  for (const [t, s] of leads) if (s > 0.28) merged.push({ t, amp: s * 0.92, kind: 2 });
  merged.sort((a, b) => a.t - b.t);

  const choppers: ChopperHitEvent[] = [];
  let lastT = -1;
  let parity = 1;

  for (const item of merged) {
    const sec = music.section(item.t);
    const isClimax = sec.label === 'drop' || sec.label === 'chorus';
    const minGap = isClimax ? 0.085 : 0.16;
    if (item.t - lastT < minGap) continue;
    lastT = item.t;
    parity = -parity;

    // 读取主导色度音高
    let bestNote = Math.floor(rand() * 12);
    if (chroma && chroma.length >= 12) {
      const nChromaFrames = Math.floor(chroma.length / 12);
      const f = Math.min(nChromaFrames - 1, Math.max(0, Math.round((item.t / dur) * (nChromaFrames - 1))));
      let bestVal = -1;
      for (let c = 0; c < 12; c++) {
        const v = chroma[f * 12 + c] ?? 0;
        if (v > bestVal) {
          bestVal = v;
          bestNote = c;
        }
      }
    }

    const barIdx = Math.max(0, music.at(item.t).bar);
    // 每 2 小节顺滑轮换快切几何花式，重拍军鼓优先触发 X 剪刀或顶棚铡刀
    const pattern = item.kind === 1
      ? (barIdx % 2 === 0 ? 0 : 2)
      : (barIdx + (item.kind === 2 ? 1 : 0)) % 4;

    choppers.push({
      t: item.t,
      amp: Math.min(1.3, item.amp * (isClimax ? 1.15 : 0.78)),
      pattern,
      parity,
      note: bestNote,
    });
  }

  // 保底：若某段 Drop 极度缺乏离散重音事件，按每拍注入干净的控台节拍追逐束
  for (const sec of music.a.sections) {
    if (sec.label !== 'drop' && sec.label !== 'chorus') continue;
    let countInSec = 0;
    for (const c of choppers) if (c.t >= sec.start && c.t < sec.end) countInSec++;
    if (countInSec < Math.max(4, (sec.end - sec.start) * 1.1)) {
      for (const bt of music.beats) {
        if (bt < sec.start || bt >= sec.end) continue;
        parity = -parity;
        const barIdx = Math.max(0, music.at(bt).bar);
        choppers.push({
          t: bt,
          amp: 0.92,
          pattern: barIdx % 4,
          parity,
          note: Math.round(bt * 4) % 12,
        });
      }
    }
  }
  choppers.sort((a, b) => a.t - b.t);

  // 构建模式 B（UNISON_SWITCH 全屏同色瞬切）确定性时间表：
  // 紧咬强军鼓/重音刺瞬切，每次保持约 1~2 拍让全屏纯色极具视觉冲击力，下一重音 0ms 瞬切至另一封面提取色！
  const rawSwitchCands: number[] = [0];
  for (const sec of music.a.sections) rawSwitchCands.push(sec.start);
  for (const [t, s] of snares) if (s > 0.24) rawSwitchCands.push(t);
  for (const [t, s] of stabs) if (s > 0.28) rawSwitchCands.push(t);
  rawSwitchCands.sort((a, b) => a - b);

  const filteredSwitchTimes: number[] = [];
  let prevCutT = -99;
  for (const ct of rawSwitchCands) {
    const sec = music.section(ct);
    const isBuild = sec.label === 'build' || sec.label === 'pre';
    const isHigh = sec.label === 'drop' || sec.label === 'chorus';
    const minHold = isBuild
      ? Math.max(0.22, avgBeatDur * 0.48)
      : isHigh
        ? Math.max(0.40, avgBeatDur * 0.90)
        : Math.max(0.75, avgBeatDur * 1.75);
    if (ct - prevCutT >= minHold) {
      filteredSwitchTimes.push(ct);
      prevCutT = ct;
    }
  }

  // 若局部乐段超过 2 拍无瞬切点，按偶数拍补齐，确保全屏瞬切段节奏干脆从不卡顿
  const withFallback = filteredSwitchTimes.slice();
  for (let bi = 0; bi < music.beats.length; bi += 2) {
    const bt = music.beats[bi];
    const idx = lastIndex(Float64Array.from(filteredSwitchTimes), bt);
    const prev = idx >= 0 ? filteredSwitchTimes[idx] : -99;
    const next = idx + 1 < filteredSwitchTimes.length ? filteredSwitchTimes[idx + 1] : dur + 99;
    if (bt - prev >= avgBeatDur * 1.85 && next - bt >= avgBeatDur * 0.90) {
      withFallback.push(bt);
    }
  }
  withFallback.sort((a, b) => a - b);

  const slotRing = unisonSlots.length > 0 ? unisonSlots : [0, 5];
  const unisonCuts: UnisonCutEvent[] = [];
  let lastFinalCut = -99;
  let slotCursor = 0;
  for (const ct of withFallback) {
    if (ct - lastFinalCut < 0.18) continue;
    lastFinalCut = ct;
    unisonCuts.push({
      t: ct,
      slot: slotRing[slotCursor % slotRing.length],
    });
    slotCursor++;
  }

  // 构建 CO2 低温白雾气柱喷发时间表：每个 Drop / Chorus 开场首拍必炸 + 段内每 8 小节下拍二次助推
  const cryos: CryoBlastEvent[] = [];
  for (let si = 0; si < music.a.sections.length; si++) {
    const sec = music.a.sections[si];
    if (sec.label !== 'drop' && sec.label !== 'chorus') continue;
    const isDrop = sec.label === 'drop';
    cryos.push({
      t: sec.start,
      dur: isDrop ? 1.55 : 1.25,
      strength: isDrop ? 1.22 : 0.96,
      mode: 0, // 开场 8 柱齐射
    });

    // 段内每 8 小节（32 拍）在紧邻的小节下拍喷射助推气柱
    const downs = music.downbeats;
    let barCounter = 0;
    for (let di = 0; di < downs.length; di++) {
      const dt = downs[di];
      if (dt <= sec.start + 1.2 || dt >= sec.end - 1.5) continue;
      barCounter++;
      if (barCounter % 8 === 0) {
        cryos.push({
          t: dt,
          dur: 1.28,
          strength: isDrop ? 1.08 : 0.85,
          mode: (barCounter / 8) % 2 === 1 ? 2 : 1,
        });
      }
    }
  }
  cryos.sort((a, b) => a.t - b.t);

  return {
    choppers,
    chopperTimes: Float64Array.from(choppers, c => c.t),
    unisonCuts,
    unisonCutTimes: Float64Array.from(unisonCuts, c => c.t),
    cryos,
    cryoTimes: Float64Array.from(cryos, c => c.t),
  };
}

// ============================================================================
// GLSL 公共噪声与干冰烟雾湍流函数库（无保留字，适配 WebGL2 / D3D11）
// ============================================================================
const GLSL_HAZE_COMMON = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 三层快速干冰体积烟雾云纹（零循环展开负担）
float hazeFbm(vec2 p) {
  float v = 0.52 * noise2D(p);
  p = mat2(0.80, -0.60, 0.60, 0.80) * p * 2.03 + vec2(11.7, 5.3);
  v += 0.31 * noise2D(p);
  p = mat2(0.80, 0.60, -0.60, 0.80) * p * 2.07 + vec2(3.1, 17.9);
  v += 0.17 * noise2D(p);
  return v;
}
`;

// 封面原生 6 槽连续渐变色板采样器（100% 兼容 WebGL1/WebGL2 与 ANGLE D3D11，支持空间平滑渐变与全屏同色瞬切双模式）
const GLSL_PALETTE_COMMON = /* glsl */ `
uniform vec3 uLaserPalette[6];
uniform vec3 uLaserCores[6];
uniform float uPalBase;
uniform float uPalSpan;

vec3 fetchLaserPal(int idx) {
  if (idx <= 0) return uLaserPalette[0];
  if (idx == 1) return uLaserPalette[1];
  if (idx == 2) return uLaserPalette[2];
  if (idx == 3) return uLaserPalette[3];
  if (idx == 4) return uLaserPalette[4];
  return uLaserPalette[5];
}

vec3 fetchLaserCore(int idx) {
  if (idx <= 0) return uLaserCores[0];
  if (idx == 1) return uLaserCores[1];
  if (idx == 2) return uLaserCores[2];
  if (idx == 3) return uLaserCores[3];
  if (idx == 4) return uLaserCores[4];
  return uLaserCores[5];
}

// 严格钳制在 [0.0..5.0] 1D 连续感知渐变路径内插值，彻底杜绝 5->0 取模回绕导致的色彩断层
void sampleLaserPalette(float slotPos, out vec3 col, out vec3 core) {
  float clamped = clamp(slotPos, 0.0, 5.0);
  int i0 = min(4, int(floor(clamped)));
  int i1 = i0 + 1;
  float f = smoothstep(0.08, 0.92, clamped - float(i0));
  col = mix(fetchLaserPal(i0), fetchLaserPal(i1), f);
  core = mix(fetchLaserCore(i0), fetchLaserCore(i1), f);
}

// 统一空间归一化映射：模式 A (uPalSpan=±5.0) 呈现空间平滑渐变；模式 B (uPalSpan=0.0) 全屏锁定单一封面提取色 uPalBase
void sampleStageGradient(float norm01, out vec3 col, out vec3 core) {
  sampleLaserPalette(uPalBase + clamp(norm01, 0.0, 1.0) * uPalSpan, col, core);
}
`;

// ============================================================================
// 1. 深邃无界超大型电音暗场背板与体积干冰雾着色器 (ARENA_VOID_BACKDROP)
// ============================================================================
const BACKDROP_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BACKDROP_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSectionEnergy;
uniform float uDropPower;
uniform float uBlinderGlow;
uniform float uBlackout;
uniform vec3 uCoverGlow;
uniform vec3 uBlinderWarm;
uniform vec3 uEnvDark;
varying vec3 vWorldPos;
${GLSL_HAZE_COMMON}
${GLSL_PALETTE_COMMON}

void main() {
  vec3 dir = normalize(vWorldPos - cameraPosition);
  float up = clamp(dir.y, -0.25, 1.0);

  // 纯净深邃丝绒暗场底色（彻底移除混凝土肋柱与波纹屋面条纹，告别毛坯厂房感）
  vec3 base = uEnvDark * (0.48 + 0.16 * smoothstep(0.55, -0.15, up));

  // 远景主舞台方向（-Z）的局部丁达尔背光晕（严格收敛在舞台主屏后方，保持侧翼与穹顶深黑高反差）
  vec3 stageCenter = vec3(0.0, 9.5, ${STAGE_Z.toFixed(1)});
  vec3 toStage = normalize(stageCenter - cameraPosition);
  float stageAlign = max(0.0, dot(dir, toStage));

  vec2 hazeUv = dir.xy * 3.4 + vec2(uTime * 0.045, -uTime * 0.028);
  float mist = hazeFbm(hazeUv);
  float mistDetail = hazeFbm(hazeUv * 2.3 - vec2(uTime * 0.07, 0.0));
  float hazeDensity = mix(0.62, 1.28, mist * 0.65 + mistDetail * 0.35);

  // 封面激光波长在远景舞台轴心周围泛起柔和大气散射（同步空间渐变或全屏纯色瞬切）
  vec3 laserHaze, dummyCore;
  sampleStageGradient(dir.x * 1.5 + 0.5, laserHaze, dummyCore);
  float stageHalo = pow(stageAlign, 16.0) * (0.030 + 0.068 * uDropPower + 0.022 * uSectionEnergy);
  float skyScatter = smoothstep(0.02, 0.52, up) * pow(stageAlign, 6.0) * (0.007 + 0.020 * uDropPower);

  vec3 col = base;
  col += uCoverGlow * pow(stageAlign, 20.0) * (0.042 + 0.045 * uSectionEnergy) * hazeDensity;
  col += laserHaze * (stageHalo + skyScatter) * hazeDensity;

  // 舞台盲眼灯触发时在舞台上空勾勒封面同源余晖
  float blinderScatter = pow(stageAlign, 5.0) * smoothstep(-0.05, 0.55, up) * uBlinderGlow;
  col += uBlinderWarm * blinderScatter * 0.026 * hazeDensity;

  // Drop 前瞬时收暗蓄力阀门
  col *= (1.0 - 0.86 * uBlackout);

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// ============================================================================
// 2. 远景巨幅微距 LED 点阵封面主屏与两侧 12 半音全彩频谱灯塔着色器 (LED_MONOLITH)
// ============================================================================
const LED_WALL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const LED_MAIN_FRAG = /* glsl */ `
uniform sampler2D uCover;
uniform float uTime;
uniform float uSectionEnergy;
uniform float uKickPunch;
uniform float uSnarePunch;
uniform float uDropPower;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uEnvDark;
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  // 外围重型压铸黑钛金属边框与克制导光内嵌线（外侧 2.0%）
  vec2 edgeDist = min(vUv, 1.0 - vUv);
  float borderMetric = min(edgeDist.x, edgeDist.y);
  if (borderMetric < 0.018) {
    float bevel = smoothstep(0.002, 0.010, borderMetric) * (1.0 - smoothstep(0.013, 0.018, borderMetric));
    vec3 frameMetal = uEnvDark * 3.2 + vec3(0.005);
    vec3 accent = mix(uLaserPrimary, uLaserSecondary, clamp(vUv.y, 0.0, 1.0));
    vec3 frameCol = frameMetal + accent * bevel * (0.22 + 0.38 * uDropPower + 0.20 * uSnarePunch);
    frameCol *= (1.0 - 0.85 * uBlackout);
    gl_FragColor = vec4(frameCol, 1.0);
    return;
  }

  // 内部 1:1 完整封面采样：不反向缩放 UV，确保巨幕作为实体钢构屏与整个舞台随底鼓/军鼓同步微震
  vec2 innerUv = (vUv - 0.018) / 0.964;
  vec2 sampleUv = clamp(innerUv, 0.002, 0.998);

  float chromaShift = (0.0008 * uKickPunch + 0.0010 * uSnarePunch) * uDropPower;
  float r = texture2D(uCover, clamp(sampleUv + vec2(chromaShift, 0.0), 0.002, 0.998)).r;
  float g = texture2D(uCover, sampleUv).g;
  float b = texture2D(uCover, clamp(sampleUv - vec2(chromaShift, 0.0), 0.002, 0.998)).b;
  vec3 texLinear = max(vec3(r, g, b), vec3(0.0));

  // 微距 SMD LED 灯珠晶格：近距离呈现细腻点阵颗粒，远距离基于距离平滑收敛防摩尔纹
  float camDist = length(vWorldPos - cameraPosition);
  float ledDetailFade = 1.0 - smoothstep(18.0, 52.0, camDist);
  vec2 cell = fract(innerUv * 192.0) - 0.5;
  float diode = 1.0 - smoothstep(0.28, 0.52, length(cell));
  float ledMask = mix(1.0, 0.78 + 0.34 * diode, ledDetailFade * 0.72);

  // 扫描刷新微光波纹
  float scanWave = 0.97 + 0.03 * sin(innerUv.y * 90.0 - uTime * 8.0);

  // 亮度控制：保证封面色彩 100% 原汁原味且不过曝洗白
  float gain = (0.72 + 0.20 * uSectionEnergy + 0.07 * uKickPunch + 0.05 * uSnarePunch) * (1.0 - 0.72 * uBlackout);
  vec3 col = texLinear * ledMask * scanWave * gain;

  // 屏幕内侧边缘柔和暗角压边，增强巨幕立体厚度
  float innerVig = smoothstep(0.0, 0.045, min(min(innerUv.x, 1.0 - innerUv.x), min(innerUv.y, 1.0 - innerUv.y)));
  col *= mix(0.45, 1.0, innerVig);

  gl_FragColor = vec4(col, 1.0);
}
`;

const LED_TOWER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDropPower;
uniform float uKickPunch;
uniform float uBlackout;
uniform vec4 uChroma0;
uniform vec4 uChroma1;
uniform vec4 uChroma2;
uniform vec3 uEnvDark;
varying vec2 vUv;
${GLSL_PALETTE_COMMON}

float readChroma(int idx) {
  if (idx < 4) return idx == 0 ? uChroma0.x : idx == 1 ? uChroma0.y : idx == 2 ? uChroma0.z : uChroma0.w;
  if (idx < 8) return idx == 4 ? uChroma1.x : idx == 5 ? uChroma1.y : idx == 6 ? uChroma1.z : uChroma1.w;
  return idx == 8 ? uChroma2.x : idx == 9 ? uChroma2.y : idx == 10 ? uChroma2.z : uChroma2.w;
}

void main() {
  // 12 层垂直半音色度能量灯格，完整横跨专辑封面 6 槽全彩色板
  float rowF = vUv.y * 12.0;
  int noteIdx = clamp(int(floor(rowF)), 0, 11);
  vec2 cellUv = vec2(vUv.x, fract(rowF));

  float edgeX = smoothstep(0.06, 0.14, min(cellUv.x, 1.0 - cellUv.x));
  float edgeY = smoothstep(0.08, 0.18, min(cellUv.y, 1.0 - cellUv.y));
  float padMask = edgeX * edgeY;

  float noteEnergy = readChroma(noteIdx);
  float barFill = smoothstep(0.5 - 0.42 * clamp(noteEnergy * 1.15 + 0.15 * uKickPunch, 0.05, 1.0), 0.5, 1.0 - abs(cellUv.x - 0.5));

  vec3 tint, tintCore;
  sampleStageGradient(float(noteIdx) / 11.0, tint, tintCore);
  tint = mix(tint, tintCore, clamp(noteEnergy * 0.42, 0.0, 0.52));
  vec3 darkFrame = uEnvDark * 4.2 + vec3(0.004);
  float lit = padMask * barFill * (0.24 + 0.88 * noteEnergy + 0.30 * uDropPower);

  vec3 col = darkFrame + tint * lit * (1.0 + 0.28 * uKickPunch);
  col *= (1.0 - 0.85 * uBlackout);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ============================================================================
// 4. 湿润黑金反光舞台与场馆地面着色器 (WET_OBSIDIAN_FLOOR)
// ============================================================================
const FLOOR_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FLOOR_FRAG = /* glsl */ `
uniform sampler2D uCover;
uniform float uTime;
uniform float uSectionEnergy;
uniform float uDropPower;
uniform float uKickPunch;
uniform float uBlinderGlow;
uniform float uBlackout;
uniform vec3 uBlinderWarm;
uniform vec3 uEnvDark;
varying vec3 vWorldPos;
varying vec2 vUv;
${GLSL_HAZE_COMMON}
${GLSL_PALETTE_COMMON}

void main() {
  vec3 P = vWorldPos;
  vec3 V = normalize(cameraPosition - P);
  float cosTheta = max(0.02, V.y);

  // 工业黑金混凝土地坪铺装接缝（宽 4.3m × 长 5.25m 矩形地砖）+ 微细粗糙颗粒 + 低频底鼓声压波纹
  vec2 tile = abs(fract(vec2(P.x / 4.3 + 0.5, P.z / 5.25)) - 0.5);
  float seam = 1.0 - smoothstep(0.478, 0.496, max(tile.x, tile.y));
  float microGrain = noise2D(P.xz * 3.8);
  float puddles = smoothstep(0.32, 0.72, hazeFbm(P.xz * 0.14 + vec2(0.0, 2.3)));

  // 底鼓声压从舞台前缘向外扩散的微细水面涟漪
  float distStage = length(vec2(P.x * 0.75, P.z - (${STAGE_LIP_Z.toFixed(1)})));
  float bassWave = sin(distStage * 2.6 - uTime * 11.0) * exp(-distStage * 0.045) * (0.25 + 0.75 * uKickPunch);

  vec3 N = normalize(vec3(
    (microGrain - 0.5) * 0.032 + bassWave * 0.015 * sign(P.x),
    1.0,
    (noise2D(P.xz * 3.8 + 19.1) - 0.5) * 0.032 + bassWave * 0.018
  ));

  // 菲涅尔反射率：水膜积水区（puddles）如黑镜般高反，干燥混凝土区柔和漫反
  float fresnel = 0.06 + 0.94 * pow(1.0 - max(0.0, dot(N, V)), 4.2);
  float reflectivity = mix(0.28, 0.86, puddles) * fresnel * seam;

  // 解析计算远景巨幅 LED 封面主屏在湿润地面上的 1:1 垂直拉丝镜面反射
  vec3 R = reflect(-V, N);
  vec3 screenRefl = vec3(0.0);
  if (R.z < -0.02) {
    float tPlane = (${STAGE_Z.toFixed(1)} - P.z) / R.z;
    if (tPlane > 0.0) {
      vec3 hit = P + R * tPlane;
      // 湿润粗糙表面的各向异性纵向拉丝模糊（3 抽头近似）
      float halfS = ${(SCREEN_SIZE * 0.5).toFixed(2)};
      // 平面镜像中等效虚拟屏幕中心在 y = -SCREEN_CENTER_Y，反射射线 hit.y > 0 对应屏幕高度 hit.y
      vec2 mirrorUv = vec2((hit.x + halfS) / ${SCREEN_SIZE.toFixed(2)}, (hit.y - ${(SCREEN_CENTER_Y - SCREEN_SIZE * 0.5).toFixed(2)}) / ${SCREEN_SIZE.toFixed(2)});
      float inX = smoothstep(-0.08, 0.04, mirrorUv.x) * (1.0 - smoothstep(0.96, 1.08, mirrorUv.x));
      float inY = smoothstep(-0.18, 0.05, mirrorUv.y) * (1.0 - smoothstep(0.95, 1.18, mirrorUv.y));
      if (inX * inY > 0.002) {
        vec2 cUv0 = clamp(mirrorUv, 0.01, 0.99);
        vec2 cUv1 = clamp(mirrorUv + vec2(0.0, 0.045), 0.01, 0.99);
        vec2 cUv2 = clamp(mirrorUv - vec2(0.0, 0.045), 0.01, 0.99);
        vec3 s0 = max(texture2D(uCover, cUv0).rgb, vec3(0.0));
        vec3 s1 = max(texture2D(uCover, cUv1).rgb, vec3(0.0));
        vec3 s2 = max(texture2D(uCover, cUv2).rgb, vec3(0.0));
        screenRefl = (s0 * 0.5 + (s1 + s2) * 0.25) * inX * inY * (0.48 + 0.28 * uSectionEnergy);
      }

      // 两侧全彩频谱灯塔柔和倒影光带（与上方灯塔严格同步空间渐变或全屏纯色）
      float towerMask = (exp(-pow((abs(hit.x) - 10.6) * 0.55, 2.0))) * smoothstep(0.0, 4.0, hit.y) * (1.0 - smoothstep(14.0, 19.0, hit.y));
      vec3 towerReflCol, towerCoreDummy;
      sampleStageGradient(hit.y / 16.0, towerReflCol, towerCoreDummy);
      screenRefl += towerReflCol * towerMask * (0.18 + 0.32 * uDropPower);
    }
  }

  vec3 floorBase = (uEnvDark * 0.85 + vec3(0.0008)) * (0.65 + 0.55 * microGrain) * seam;

  // 盲眼灯与顶棚环境光在湿润地面的克制漫射高光带
  float centerGlint = exp(-pow(P.x * 0.085, 2.0)) * smoothstep(22.0, -50.0, P.z);
  vec3 blinderFloor = uBlinderWarm * uBlinderGlow * (0.025 + 0.065 * puddles) * centerGlint;

  // 地面低空流淌的薄纱干冰贴地冷雾（Dry Ice Low-Lying Fog），浸润封面激光散射
  float lowFog = hazeFbm(P.xz * 0.09 + vec2(uTime * 0.08, -uTime * 0.14));
  float stageNear = smoothstep(8.0, -48.0, P.z);
  vec3 fogPalCol, fogCoreDummy;
  sampleStageGradient(P.x / 33.2 + 0.5, fogPalCol, fogCoreDummy);
  vec3 groundMist = fogPalCol * pow(lowFog, 1.6) * (0.012 + 0.036 * uDropPower) * stageNear;

  // 远距离边界柔和渐隐融入深邃暗场
  float edgeFade = (1.0 - smoothstep(28.0, 35.5, abs(P.x))) * (1.0 - smoothstep(20.0, 31.0, P.z)) * (1.0 - smoothstep(-66.0, -75.0, P.z));

  // 半透明混合：alpha 控制地面遮挡度，使 y < 0 的 1:1 激光/光幕/气柱镜像自然透出并叠加菲涅尔质感！
  vec3 col = (floorBase + screenRefl * reflectivity + blinderFloor + groundMist) * edgeFade;
  col *= (1.0 - 0.85 * uBlackout);

  float floorOpacity = mix(0.84, 0.56, reflectivity * (0.55 + 0.45 * puddles));
  gl_FragColor = vec4(col, floorOpacity);
}
`;

// ============================================================================
// 5. 重工业巡演舞台主基座（超低音炮穿孔钢网阵列）、拉丝黑钛铝 DJ 控台与 3D 骨骼 DJ 着色器
// ============================================================================
const STAGE_STRUCT_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// 主舞台基座物理材质：巡演级双 18 寸超低音炮穿孔钢网阵列舱 + 工字钢承重立柱 + 防滑拉丝金属台唇（彻底告别卡通霓虹线框盒）
const STAGE_RISER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDropPower;
uniform float uKickPunch;
uniform float uSnarePunch;
uniform float uBlinderGlow;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uCoverGlow;
uniform vec3 uBlinderWarm;
uniform vec3 uEnvDark;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float stageHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float camDist = length(cameraPosition - vWorldPos);
  float detailFade = 1.0 - smoothstep(16.0, 56.0, camDist);

  vec3 laserMid = mix(uLaserPrimary, uLaserSecondary, clamp(0.5 + vWorldPos.x * 0.035, 0.0, 1.0));
  vec3 stageLight = uCoverGlow * (0.20 + 0.16 * uDropPower) + laserMid * (0.10 + 0.18 * uDropPower) + uBlinderWarm * uBlinderGlow * 0.22;

  if (N.y > 0.5) {
    // 舞台顶面：深炭黑防滑巡演甲板（1.22m x 2.44m 标准拼装锁扣暗缝 + 磨砂颗粒 + 台唇枪灰金属压条）
    float deckSeamX = smoothstep(0.0, 0.020, abs(fract(vWorldPos.x * 0.41) - 0.5));
    float deckSeamZ = smoothstep(0.0, 0.025, abs(fract(vWorldPos.z * 0.82) - 0.5));
    float gripGrain = mix(0.5, stageHash(floor(vWorldPos.xz * 48.0)), detailFade * 0.45);
    float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.6);

    // 靠近巨幕后方自然接收更多专辑封面漫反射光，使舞台甲板与封面主屏融于同一物理光场
    float screenProx = smoothstep(-43.0, -52.5, vWorldPos.z) * exp(-pow(vWorldPos.x * 0.095, 2.0));
    vec3 col = (uEnvDark * 1.35 + vec3(0.0022) * (0.75 + 0.5 * gripGrain)) * (0.82 + 0.18 * deckSeamX * deckSeamZ);
    col += uCoverGlow * screenProx * (0.09 + 0.06 * uDropPower);
    col += stageLight * fresnel * 0.26;

    // 舞台最前缘 9cm 拉丝枪灰铝合金防踏空护边压条
    float lipMetal = 1.0 - smoothstep(0.0, 0.09, abs(vWorldPos.z - (${STAGE_LIP_Z.toFixed(2)})));
    col += (vec3(0.012) + stageLight * 0.28) * lipMetal;

    col *= (1.0 - 0.85 * uBlackout);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // 舞台正面与侧立面：模块化重型超低音炮声学阵列舱（16 舱位）+ 工字钢立柱 + 六角穿孔声学钢网
  float bayCoord = vWorldPos.x * 0.52 + 8.0;
  float bx = fract(bayCoord); // [0..1] 单舱局部横向坐标
  float by = vUv.y;           // [0..1] 底部至台唇高度

  // 竖向工字钢立柱与上下钢制边框横梁
  float mullionX = 1.0 - smoothstep(0.032, 0.052, min(bx, 1.0 - bx));
  float beamTop = smoothstep(0.88, 0.91, by);
  float beamBot = 1.0 - smoothstep(0.08, 0.11, by);
  float steelFrame = clamp(max(mullionX, max(beamTop, beamBot)), 0.0, 1.0);

  // 立柱边缘三维微斜面法线扰动（真实捕捉侧上方激光与盲眼灯冷峻金属反光）
  float bevelNx = (smoothstep(0.02, 0.055, bx) - smoothstep(0.02, 0.055, 1.0 - bx)) * 0.35 * (1.0 - beamTop);
  float bevelNy = (smoothstep(0.87, 0.92, by) - smoothstep(0.96, 1.0, by)) * 0.45;
  vec3 pertN = normalize(N + vec3(bevelNx, bevelNy, 0.0));
  vec3 H = normalize(V + normalize(vec3(0.0, 0.62, 0.78)));
  float spec = pow(max(0.0, dot(pertN, H)), 24.0);
  float fres = pow(1.0 - clamp(dot(pertN, V), 0.0, 1.0), 3.2);

  // 横向金属拉丝微纹理
  float brushed = 0.85 + 0.30 * sin(vWorldPos.x * 38.0 + sin(vWorldPos.y * 160.0) * 0.6) * detailFade;
  vec3 frameAlbedo = (uEnvDark * 2.1 + vec3(0.0055)) * brushed;
  vec3 frameCol = frameAlbedo + stageLight * (0.14 * fres + 0.24 * spec);

  // 舱内深黑哑光声学透声钢网罩 + 竖向重工加强筋 + 隐约内敛的双 18 寸低音箱体暗影（不裸露刺眼圆环，尽显巡演级重工业整体感）
  vec2 coneUvL = vec2((bx - 0.29) * 2.55, (by - 0.49) * 1.48);
  vec2 coneUvR = vec2((bx - 0.71) * 2.55, (by - 0.49) * 1.48);
  float minR = min(length(coneUvL), length(coneUvR));
  float subtleDriver = exp(-pow((minR - 0.68) / 0.14, 2.0)) * 0.25 + (1.0 - smoothstep(0.16, 0.34, minR)) * 0.30;
  float coneCavity = smoothstep(0.16, 0.70, minR) * (1.0 - smoothstep(0.72, 0.86, minR));

  // 舱中竖向副加强肋与横向加强压条
  float midRibX = 1.0 - smoothstep(0.010, 0.022, abs(bx - 0.5));
  float midRibY = 1.0 - smoothstep(0.014, 0.030, abs(by - 0.50));
  float subRibs = max(midRibX * 0.65, midRibY * 0.45);

  // 穿孔钢网细密微网孔
  vec2 perfGrid = fract(vec2(vWorldPos.x, vWorldPos.y) * 58.0) - 0.5;
  float perfHole = smoothstep(0.22, 0.42, length(perfGrid));
  float grilleShade = mix(0.76, 0.54 + 0.38 * perfHole, detailFade);

  vec3 speakerInterior = (vec3(0.0018) + uEnvDark * 0.95) * (1.0 - 0.28 * coneCavity);
  speakerInterior += (vec3(0.0022) + stageLight * (0.035 + 0.035 * uKickPunch)) * subtleDriver;
  vec3 grilleCol = speakerInterior * grilleShade + stageLight * (0.055 * fres * perfHole + 0.10 * subRibs * (0.4 + 0.6 * spec));

  vec3 col = mix(grilleCol, frameCol, steelFrame);

  // 台唇顶部冷峻拉丝枪灰铝合金护角压条 + 克制的分段式窄缝定位暗灯眉
  float topEdgeBevel = smoothstep(0.945, 0.995, by);
  col += (vec3(0.011) + stageLight * 0.30) * topEdgeBevel;
  float markerMask = step(abs(bx - 0.5), 0.08) * smoothstep(0.910, 0.928, by) * (1.0 - smoothstep(0.938, 0.952, by));
  col += laserMid * markerMask * (0.14 + 0.20 * uDropPower + 0.16 * uKickPunch);

  // 底部与湿润地面交界处的真实接触环境光遮蔽（Contact AO），赋予钢铁基座沉甸甸的落地重量感
  float contactAO = mix(0.26, 1.0, smoothstep(0.0, 0.24, by));
  col *= contactAO * (1.0 - 0.85 * uBlackout);
  gl_FragColor = vec4(col, 1.0);
}
`;

// 巡演级定制 DJ 控台与踏台物理材质：三仓式阳极氧化横向拉丝钛灰铝合金装甲板 + 铣削斜面金属倒角 + 隐藏式内凹洗墙微光
const DJ_BOOTH_FRAG = /* glsl */ `
uniform float uDropPower;
uniform float uKickPunch;
uniform float uSnarePunch;
uniform float uBlinderGlow;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uCoverGlow;
uniform vec3 uBlinderWarm;
uniform vec3 uEnvDark;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float camDist = length(cameraPosition - vWorldPos);
  float detailFade = 1.0 - smoothstep(8.0, 38.0, camDist);

  // 笔直利落的工业级横向阳极氧化金属拉丝微纹理（杜绝波浪摩尔纹）
  float brushLine = sin(vWorldPos.y * 260.0) * 0.5 + sin(vWorldPos.y * 610.0 + 1.3) * 0.5;
  float brushedTex = 1.0 + 0.12 * brushLine * detailFade;

  // 正面三段式模块化重型拉丝铝饰板分仓（3-Bay Recessed Armor Facade）与 45° 铣削倒角法线偏转
  float bayX = fract(vUv.x * 3.0);
  float isSideFace = step(0.4, abs(N.z));
  float panelInsetX = smoothstep(0.05, 0.09, bayX) * smoothstep(0.05, 0.09, 1.0 - bayX);
  float panelInsetY = smoothstep(0.14, 0.21, vUv.y) * smoothstep(0.14, 0.21, 1.0 - vUv.y);
  float recessedMask = panelInsetX * panelInsetY * isSideFace;

  // 铣削倒角坡面法线：让嵌入式金属边框在顶棚激光与盲眼灯照射下浮现真实冷金属高光棱边
  float bevelNx = ((smoothstep(0.04, 0.09, bayX) - smoothstep(0.09, 0.12, bayX))
                 - (smoothstep(0.04, 0.09, 1.0 - bayX) - smoothstep(0.09, 0.12, 1.0 - bayX))) * 0.42 * isSideFace;
  float bevelNy = ((smoothstep(0.13, 0.21, vUv.y) - smoothstep(0.21, 0.25, vUv.y))
                 - (smoothstep(0.13, 0.21, 1.0 - vUv.y) - smoothstep(0.21, 0.25, 1.0 - vUv.y))) * 0.48 * isSideFace;
  vec3 pertN = normalize(N + vec3(bevelNx, bevelNy + brushLine * 0.03 * detailFade, 0.0));

  float ndotv = clamp(dot(pertN, V), 0.0, 1.0);
  float fresnel = pow(1.0 - ndotv, 2.8);

  // 各向异性金属反射光场：前上方走廊激光/盲眼灯高光 + 后上方巨幕封面漫反射包络
  vec3 laserTint = mix(uLaserPrimary, uLaserSecondary, clamp(0.5 + vWorldPos.x * 0.22, 0.0, 1.0));
  vec3 topFrontLight = normalize(vec3(-vWorldPos.x * 0.12, 0.65, 0.75));
  vec3 H = normalize(V + topFrontLight);
  // 横向拉丝金属在垂直方向展宽各向异性高光带（Anisotropic Brushed Specular）
  float anisoSpec = pow(max(0.0, dot(pertN, H)), 14.0) * 0.55 + pow(max(0.0, 1.0 - abs(pertN.y - H.y)), 18.0) * 0.25;
  float topRim = smoothstep(0.92, 0.99, vUv.y) * isSideFace;

  // 深钛灰金属外框 vs 内嵌深炭拉丝声学百叶芯板
  float louver = 0.76 + 0.24 * smoothstep(0.30, 0.70, fract(vUv.y * 16.0));
  vec3 outerMetal = (uEnvDark * 2.6 + vec3(0.0085)) * brushedTex;
  vec3 innerCore = (uEnvDark * 1.55 + vec3(0.0042)) * brushedTex * louver;
  vec3 metalBase = mix(outerMetal, innerCore, recessedMask);

  vec3 envLight = uCoverGlow * (0.24 + 0.18 * uDropPower) + laserTint * (0.18 + 0.24 * uDropPower + 0.12 * uSnarePunch) + uBlinderWarm * uBlinderGlow * 0.30;
  vec3 col = metalBase;
  col += (vec3(0.008) + envLight * 0.42) * (anisoSpec * (1.0 - 0.35 * recessedMask) + fresnel * 0.26);
  col += (vec3(0.012) + envLight * 0.32) * topRim;

  // 控台最底部内收踢脚线极克制的隐藏式漫射洗墙微光（Recessed Underglow）
  float underglow = (1.0 - smoothstep(0.0, 0.09, vUv.y)) * isSideFace;
  col += laserTint * underglow * (0.07 + 0.10 * uDropPower + 0.06 * uKickPunch);

  col *= (1.0 - 0.85 * uBlackout);
  gl_FragColor = vec4(col, 1.0);
}
`;

// 控台台面专业四联 Pioneer CDJ-3000 播放器 + 中央 DJM-A9 四通道混音台着色器
const DECK_GEAR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBeatPos;
uniform float uDropPower;
uniform float uKickPunch;
uniform float uBlackout;
uniform vec3 uLaserPrimaryCore;
uniform vec3 uEnvDark;
varying vec2 vUv;
${GLSL_PALETTE_COMMON}

void main() {
  // 台面划分为 5 个标准机位槽：[0, 1]=左双联 CDJ，[2]=中央 DJM 混音台，[3, 4]=右双联 CDJ
  vec2 uv = vUv;
  float gx = uv.x * 5.0;
  float unitIdx = floor(gx);
  vec2 local = vec2(fract(gx), uv.y);

  // 铝合金拉丝暗黑机壳底板与设备间隙
  float unitFrame = smoothstep(0.04, 0.07, local.x) * smoothstep(0.04, 0.07, 1.0 - local.x)
                  * smoothstep(0.05, 0.09, local.y) * smoothstep(0.05, 0.09, 1.0 - local.y);
  vec3 col = uEnvDark * 1.8 + vec3(0.0025) * unitFrame;

  if (abs(unitIdx - 2.0) < 0.4) {
    // 中央 DJM-A9 混音台：4 路通道推子 + 实时跳动四路多色 VU 电平表
    float ch = floor(local.x * 4.0);
    float cx = fract(local.x * 4.0);
    float faderSlot = (1.0 - smoothstep(0.03, 0.06, abs(cx - 0.5))) * step(0.14, local.y) * step(local.y, 0.48);
    float faderPos = 0.24 + 0.18 * (0.5 + 0.5 * sin(uTime * 1.7 + ch * 1.3));
    float faderCap = step(abs(cx - 0.5), 0.16) * step(abs(local.y - faderPos), 0.025);

    float meterBar = step(abs(cx - 0.5), 0.11) * step(0.54, local.y) * step(local.y, 0.88);
    float level = clamp(0.32 + 0.48 * uDropPower + 0.32 * uKickPunch - 0.12 * abs(ch - 1.5), 0.15, 0.98);
    float segOn = step(0.25, fract(local.y * 26.0)) * step((local.y - 0.54) / 0.34, level);
    vec3 chTint, chCore;
    sampleStageGradient(ch / 3.0, chTint, chCore);
    vec3 vuCol = mix(chTint, chCore, smoothstep(0.62, 0.86, local.y));

    col += vec3(0.015) * faderSlot + vec3(0.22) * faderCap + vuCol * meterBar * segOn * 1.15;
  } else {
    // 左右 4 台 CDJ-3000：同步封面空间渐变或全屏纯色音轨标记
    float inScreen = step(0.14, local.x) * step(local.x, 0.86) * step(0.64, local.y) * step(local.y, 0.89);
    float waveEnv = 0.055 * (0.35 + 0.65 * abs(sin((local.x + uTime * 0.35 + unitIdx * 0.7) * 24.0)));
    float waveMask = inScreen * (1.0 - smoothstep(0.0, waveEnv, abs(local.y - 0.765)));
    float playhead = inScreen * (1.0 - smoothstep(0.0, 0.016, abs(local.x - 0.5)));

    vec2 jogP = (local - vec2(0.5, 0.35)) * vec2(1.0, 1.18);
    float r = length(jogP);
    float outerRing = exp(-pow((r - 0.235) / 0.018, 2.0));
    float innerHub = step(r, 0.085);
    float spinAng = atan(jogP.y, jogP.x) + uTime * 3.6 * (unitIdx < 2.0 ? 1.0 : -1.0);
    float spinMarker = step(r, 0.082) * step(0.055, r) * smoothstep(0.65, 0.98, cos(spinAng));

    float cueBtn = exp(-length(local - vec2(0.18, 0.16)) * 34.0);
    float playBtn = exp(-length(local - vec2(0.18, 0.25)) * 34.0);

    float deckNorm = unitIdx / 4.0;
    vec3 deckTint, deckCore, altTint, altCore;
    sampleStageGradient(deckNorm, deckTint, deckCore);
    sampleStageGradient(clamp(deckNorm + 0.22, 0.0, 1.0), altTint, altCore);

    col += (uEnvDark * 4.0 + deckTint * 0.22) * inScreen;
    col += mix(deckTint, deckCore, 0.52) * waveMask * 0.95 + vec3(0.45) * playhead;
    col += mix(deckTint, deckCore, 0.42) * (outerRing * (0.65 + 0.45 * uKickPunch) + spinMarker * 0.85);
    col += deckTint * 0.25 * innerHub + uLaserPrimaryCore * cueBtn * 0.65 + altTint * playBtn * 0.65;
  }

  col *= (1.0 - 0.85 * uBlackout);
  gl_FragColor = vec4(col, 1.0);
}
`;

// 写实三维骨骼 DJ 人物与监听音箱顶点/片元着色器（真实 3D 世界法线 + 菲涅尔逆光边缘 + 顶棚激光散射 + 控台近场反光）
const DJ_CHARACTER_VERT = /* glsl */ `
attribute float aMatTag; // 0=哑光服饰/躯干, 1=皮肤/手部, 2=耳机金属/高光饰件
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vMatTag;

void main() {
  vMatTag = aMatTag;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const DJ_CHARACTER_FRAG = /* glsl */ `
uniform float uDropPower;
uniform float uKickPunch;
uniform float uBlinderGlow;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uLaserPrimaryCore;
uniform vec3 uCoverGlow;
uniform vec3 uBlinderWarm;
uniform vec3 uEnvDark;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vMatTag;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // 基础服装与暗部材质：深邃重磅哑光机能卫衣/夹克，绝不透明或泛灰塑料感
  float specBoost = vMatTag > 1.5 ? 2.4 : (vMatTag > 0.5 ? 1.25 : 1.0);
  vec3 baseAlbedo = uEnvDark * (vMatTag > 1.5 ? 2.6 : 1.35) + vec3(0.0014);

  // 1. 背后巨幅 LED 封面主屏强逆光菲涅尔掠射轮廓光（Grazing Fresnel Rim）
  // 仅在法线与视线接近相切（掠射边缘）且面朝背光/侧上方时自然浮现，彻底告别生硬的 2D 等宽亮线描边！
  float ndotv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = pow(1.0 - ndotv, vMatTag > 1.5 ? 2.6 : 3.8);
  float backFacing = smoothstep(-0.28, 0.72, -N.z * 0.68 + abs(N.x) * 0.52 + N.y * 0.35);
  vec3 sideTint = mix(uLaserPrimary, uLaserSecondary, clamp(0.5 + vWorldPos.x * 0.9, 0.0, 1.0));
  vec3 backScreenTint = mix(uCoverGlow, mix(sideTint, uLaserPrimaryCore, 0.38), 0.58);
  vec3 rimLight = backScreenTint * fresnel * backFacing * (0.48 + 0.68 * uDropPower + 0.28 * uKickPunch) * specBoost;

  // 2. 头顶激光天幕与盲眼灯体积漫射顶光（照亮帽顶、斜方肌肩线与高举挥动的小臂上侧）
  float skyFacing = pow( clamp(N.y * 0.78 + 0.22, 0.0, 1.0), 2.2 );
  float frontShadow = 0.38 + 0.62 * smoothstep(0.65, -0.45, N.z); // 面向观众的正胸暗部深沉，突出立体剪影感
  vec3 skyLaser = mix(uLaserPrimary, uLaserSecondary, 0.5) * (0.065 + 0.16 * uDropPower) + uBlinderWarm * uBlinderGlow * 0.14;
  vec3 topScatter = skyLaser * skyFacing * frontShadow * (vMatTag > 1.5 ? 1.55 : 0.85);

  // 3. 身前四联 CDJ 与混音台屏幕向上的近场微光反射（微妙照亮帽檐下沿、下颌、胸前褶皱与打碟双手）
  vec3 consoleCenter = vec3(0.0, 2.90, -49.26);
  vec3 toConsole = consoleCenter - vWorldPos;
  float distConsole = length(toConsole);
  vec3 Lc = toConsole / max(1e-3, distConsole);
  float consoleNdotL = max(0.0, dot(N, Lc));
  float consoleAtten = 1.0 / (1.0 + distConsole * distConsole * 3.2);
  vec3 consoleGlow = mix(sideTint, uLaserPrimaryCore, 0.35) * consoleNdotL * consoleAtten * (0.16 + 0.14 * uKickPunch);

  vec3 col = baseAlbedo + (rimLight + topScatter + consoleGlow) * (1.0 - 0.84 * uBlackout);
  gl_FragColor = vec4(col, 1.0);
}
`;

// DJ 身后舞台地排逆光干冰薄雾烘托着色器（确保即使在纯黑底色封面前，三维 DJ 剪影依然如实拍现场般立体分明）
const DJ_BACKLIGHT_HALO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDropPower;
uniform float uKickPunch;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uCoverGlow;
varying vec2 vUv;
${GLSL_HAZE_COMMON}

void main() {
  vec2 p = (vUv - vec2(0.5, 0.26)) * vec2(1.0, 1.35);
  float r = length(p);
  if (r > 0.72) discard;

  // 自舞台控台后方升腾的柔和干冰逆光雾团
  float mist1 = hazeFbm(vUv * vec2(3.6, 2.8) + vec2(0.0, -uTime * 0.28));
  float mist2 = hazeFbm(vUv * vec2(7.2, 5.4) - vec2(uTime * 0.16, uTime * 0.42));
  float smoke = 0.52 + 0.68 * (mist1 * 0.65 + mist2 * 0.35);

  float radial = exp(-r * r * 7.8) * smoothstep(0.0, 0.14, vUv.y);
  vec3 tint = mix(uCoverGlow, mix(uLaserPrimary, uLaserSecondary, vUv.x), 0.55);
  float alpha = radial * smoke * (0.20 + 0.22 * uDropPower + 0.10 * uKickPunch) * (1.0 - 0.88 * uBlackout);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(tint * alpha, 1.0);
}
`;

// ============================================================================
// 6. 桁架四眼观众盲眼灯着色器 (BLINDER_FLARE — 封面同源热惯性色温余晖)
// ============================================================================
const BLINDER_VERT = /* glsl */ `
attribute vec4 aBlinderPos;   // xyz: 世界坐标, w: 0=天空本体, 1=地面镜像
attribute vec4 aBlinderState; // x: 当前亮度强度 [0..1.4], y: 灯丝色温冷却度 [0=炽亮核..1=封面余晖色], z: 尺寸缩放, w: 相位种子
varying vec2 vQuad;
varying float vPower;
varying float vCool;
varying float vMirror;

void main() {
  vQuad = position.xy;
  vPower = aBlinderState.x;
  vCool = aBlinderState.y;
  vMirror = aBlinderPos.w;

  if (vPower < 0.005) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec3 wp = aBlinderPos.xyz;
  if (vMirror > 0.5) wp.y = -wp.y;

  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float s = aBlinderState.z * (0.75 + 0.85 * min(1.3, vPower));
  // 地面倒影纵向微微拉长以模拟湿润粗糙度拉伸
  vec3 worldVert = wp + camRight * (position.x * s * 1.45) + camUp * (position.y * s * (vMirror > 0.5 ? 1.55 : 0.95));
  gl_Position = projectionMatrix * viewMatrix * vec4(worldVert, 1.0);
}
`;

const BLINDER_FRAG = /* glsl */ `
uniform float uBlackout;
uniform vec3 uBlinderWarm;
uniform vec3 uLaserPrimaryCore;
varying vec2 vQuad;
varying float vPower;
varying float vCool;
varying float vMirror;

void main() {
  float d = length(vQuad);
  if (d > 1.0) discard;

  // 2x2 四眼灯杯亮核 + 精致变形宽银幕水平拉丝眩光（克制光晕半径，避免连片泛白）
  vec2 cell = abs(vQuad) - vec2(0.11, 0.11);
  float pod = exp(-dot(cell, cell) * 76.0);
  float halo = exp(-d * 6.0) * 0.28;
  float streak = exp(-abs(vQuad.y) * 30.0) * pow(max(0.0, 1.0 - abs(vQuad.x)), 2.2) * 0.62;

  // 自适应封面色温热惯性：起音瞬间为封面同色系炽亮核，余晖尾部沉淀为浓郁 uBlinderWarm（黑白封面自动呈铂银白）
  vec3 hotCore = mix(uLaserPrimaryCore, vec3(1.0), 0.38);
  vec3 filamentCol = mix(hotCore, uBlinderWarm, clamp(vCool, 0.0, 1.0));
  vec3 col = mix(filamentCol, mix(uLaserPrimaryCore, vec3(1.0), 0.62), clamp(pod * (1.0 - vCool * 0.75), 0.0, 0.72));

  float intensity = (pod * 1.15 + halo + streak * (1.0 - 0.45 * vCool)) * vPower * 0.62;
  if (vMirror > 0.5) intensity *= 0.32;
  intensity *= (1.0 - 0.88 * uBlackout);

  if (intensity < 0.003) discard;
  gl_FragColor = vec4(col * intensity, 1.0);
}
`;

// ============================================================================
// 7. 振镜扫描体积光膜着色器 (LASER_SHEET — Liquid Sky & Volumetric Fan)
// ============================================================================
const SHEET_VERT = /* glsl */ `
attribute vec4 aSheetOrigin; // xyz: 发射口世界坐标, w: 0=天空本体, 1=地面镜像
attribute vec4 aSheetAngles; // x: yaw(偏航), y: pitch(俯仰), z: roll(滚转), w: spread(半张角 tan)
attribute vec4 aSheetStyle;  // x: 光幕长度(米), y: 功率强度 [0..1.4], z: 色彩混合 [0..1], w: 波浪折痕幅度
uniform float uTime;
varying vec2 vSheetUv; // x ∈ [-1..1] 扇面横向归一化角, y ∈ [0..1] 沿射程距离
varying vec3 vWorldPos;
varying vec3 vOrigin;
varying float vPower;
varying float vColorMix;
varying float vMirror;
varying float vWaveAmp;

void main() {
  // 基础几何体为细分扇形网格：position.x ∈ [-1..1] 横向展开，position.z ∈ [0..1] 沿射程延伸
  vSheetUv = vec2(position.x, position.z);
  vPower = aSheetStyle.y;
  vColorMix = aSheetStyle.z;
  vMirror = aSheetOrigin.w;
  vWaveAmp = aSheetStyle.w;

  if (vPower < 0.008) {
    vWorldPos = vec3(0.0);
    vOrigin = vec3(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float dist = position.z * aSheetStyle.x;
  float lateral = position.x * dist * aSheetAngles.w;
  // Liquid Sky 液态天幕：振镜正弦调制赋予光膜丝绸般起伏的法向波浪折痕
  float waveY = sin(position.x * 4.5 + uTime * 5.2 + aSheetOrigin.x * 0.4) * vWaveAmp * dist * 0.065;

  // 局部射线在 +Z 朝向（由舞台射向观众席），依次应用 roll -> pitch -> yaw 欧拉旋转
  vec3 local = vec3(lateral, waveY, dist);

  float cr = cos(aSheetAngles.z), sr = sin(aSheetAngles.z);
  local.xy = mat2(cr, -sr, sr, cr) * local.xy;

  float cp = cos(aSheetAngles.y), sp = sin(aSheetAngles.y);
  local.yz = mat2(cp, -sp, sp, cp) * local.yz;

  float cy = cos(aSheetAngles.x), sy = sin(aSheetAngles.x);
  local.xz = mat2(cy, sy, -sy, cy) * local.xz;

  vec3 orig = aSheetOrigin.xyz;
  vec3 wp = orig + local;
  if (vMirror > 0.5) {
    orig.y = -orig.y;
    wp.y = -wp.y;
  }

  vOrigin = orig;
  vWorldPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SHEET_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBlackout;
uniform float uSheetSpread;
varying vec2 vSheetUv;
varying vec3 vWorldPos;
varying vec3 vOrigin;
varying float vPower;
varying float vColorMix;
varying float vMirror;
varying float vWaveAmp;
${GLSL_HAZE_COMMON}
${GLSL_PALETTE_COMMON}

void main() {
  if (vPower < 0.008) discard;
  // 严格裁剪地面穿透：天空本体只渲染在 y >= 0，地面镜像只渲染在 y <= 0
  if (vMirror < 0.5 && vWorldPos.y < -0.02) discard;
  if (vMirror > 0.5 && vWorldPos.y > 0.02) discard;

  float u = vSheetUv.x; // [-1..1]
  float r = vSheetUv.y; // [0..1]

  // 1. 振镜折返边缘驻留增亮（Galvo Dwell）：扇面左右两端减速折返锐利明亮，内部底膜晶莹通透绝不糊死背景巨幕
  float absU = abs(u);
  float edgeOuter = exp(-pow((1.0 - absU) * 34.0, 2.0)) * 1.08;
  float interiorFill = (1.0 - smoothstep(0.96, 1.0, absU)) * (0.056 + 0.062 * pow(absU, 2.0));

  // 2. 振镜高速离散扫描丝与角度光束手指（Laser Fingers / Blanked Sub-rays）
  float fingers = pow(0.5 + 0.5 * cos(u * 32.0 + sin(uTime * 3.0) * 1.5), 7.0) * 0.38;
  float highFreqScan = 0.90 + 0.10 * sin(u * 110.0 - uTime * 38.0);

  // 3. 3D 干冰烟雾湍流云纹（FBM Volumetric Haze）：烟雾浓处丁达尔散射如液态丝绸，淡处通透深邃
  vec2 hazeCoord = vWorldPos.xz * 0.085 + vec2(vWorldPos.y * 0.06, -uTime * 0.22);
  float haze1 = hazeFbm(hazeCoord);
  float haze2 = hazeFbm(hazeCoord * 2.1 + vec2(uTime * 0.15, 4.7));
  float smokeDensity = 0.24 + 1.30 * pow(haze1 * 0.65 + haze2 * 0.35, 1.55);

  // 4. 发射口近端能量亮星 + 远端柔和消散
  float originBoost = 0.055 / (0.085 + r * r) * exp(-absU * 5.5);
  float distAtten = (1.0 - smoothstep(0.62, 1.0, r)) * smoothstep(0.0, 0.015, r);

  // 5. 镜头迎面掠过前向散射微增亮（Liquid Sky 贴近视线高度时更具包裹感）
  float eyeProx = exp(-abs(vWorldPos.y - cameraPosition.y) * 0.45) * (1.0 - vMirror);
  float mieBoost = 1.0 + 0.38 * eyeProx;

  // 模式 A 下 vColorMix 按发射器空间坐标平滑映射且扇面内部柔和过渡 (uSheetSpread)；模式 B 下 uSheetSpread = 0 全扇纯色统一！
  vec3 baseLaser, baseCore;
  sampleLaserPalette(vColorMix + u * uSheetSpread, baseLaser, baseCore);
  float density = (interiorFill + fingers + edgeOuter) * highFreqScan * smokeDensity * distAtten * mieBoost + originBoost * 0.24;
  vec3 col = mix(baseLaser, baseCore, clamp(edgeOuter * 0.58 + originBoost * 0.48, 0.0, 0.84))
           + vec3(0.10) * clamp(originBoost * 0.35, 0.0, 0.16);

  float alpha = density * vPower * 0.165;
  if (vMirror > 0.5) alpha *= 0.38;
  alpha *= (1.0 - 0.88 * uBlackout);

  if (alpha < 0.002) discard;
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

// ============================================================================
// 8. 军鼓 / 重音 X 型交叉铡刀单束快切着色器 (LASER_BEAM — 6 槽全彩分束独立波长)
// ============================================================================
const BEAM_VERT = /* glsl */ `
attribute vec4 aBeamStart; // xyz: 发射口世界坐标, w: 0=天空本体, 1=地面镜像
attribute vec4 aBeamEnd;   // xyz: 终点世界坐标, w: 光束半宽(米)
attribute vec4 aBeamStyle; // x: 脉冲亮度 [0..1.4], y: 色板槽位 [0..6), z: 脉冲行进相位, w: 种子
varying vec2 vBeamUv;      // x ∈ [0..1] 沿光束轴向, y ∈ [-1..1] 横向截面
varying vec3 vWorldPos;
varying float vPower;
varying float vColorMix;
varying float vPulsePhase;
varying float vMirror;

void main() {
  vBeamUv = vec2(uv.x, (uv.y - 0.5) * 2.0);
  vPower = aBeamStyle.x;
  vColorMix = aBeamStyle.y;
  vPulsePhase = aBeamStyle.z;
  vMirror = aBeamStart.w;

  if (vPower < 0.01) {
    vWorldPos = vec3(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec3 p0 = aBeamStart.xyz;
  vec3 p1 = aBeamEnd.xyz;
  if (vMirror > 0.5) {
    p0.y = -p0.y;
    p1.y = -p1.y;
  }

  vec3 spine = mix(p0, p1, uv.x);
  vec3 beamDir = normalize(p1 - p0);
  vec3 toCam = normalize(cameraPosition - spine);
  vec3 side = cross(beamDir, toCam);
  float sideLen = length(side);
  side = sideLen > 1e-4 ? side / sideLen : vec3(1.0, 0.0, 0.0);

  // 起点发射口处稍微放宽以容纳水平变形眩光，远端微微扩散
  float halfW = aBeamEnd.w * (1.0 + 0.55 * uv.x) * (0.85 + 0.45 * min(1.2, vPower));
  vec3 wp = spine + side * (vBeamUv.y * halfW);
  vWorldPos = wp;

  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBlackout;
varying vec2 vBeamUv;
varying vec3 vWorldPos;
varying float vPower;
varying float vColorMix;
varying float vPulsePhase;
varying float vMirror;
${GLSL_HAZE_COMMON}
${GLSL_PALETTE_COMMON}

void main() {
  if (vPower < 0.01) discard;
  if (vMirror < 0.5 && vWorldPos.y < -0.02) discard;
  if (vMirror > 0.5 && vWorldPos.y > 0.02) discard;

  float s = vBeamUv.x;        // [0..1] 射程进度
  float d = abs(vBeamUv.y);   // [0..1] 离中心轴距离

  // 锐利同色系亮芯 + 宽阔浓郁的丁达尔窄带激光色晕，每束独立呈现高纯度封面色彩
  float core = exp(-d * d * 86.0);
  float corona = exp(-d * 3.5) * 0.66;

  // 发射口起点高强星芒能量点
  float emitterHotspot = exp(-s * 34.0) * exp(-d * d * 18.0) * 1.15;
  // 光速脉冲团沿射线疾驰而过
  float packet = exp(-pow((s - vPulsePhase) * 5.5, 2.0)) * 0.48;

  // 穿过空间干冰烟雾时的丁达尔明暗起伏
  float mist = 0.50 + 0.72 * hazeFbm(vWorldPos.xz * 0.11 + vec2(vWorldPos.y * 0.09, -uTime * 0.25));
  float endFade = (1.0 - smoothstep(0.75, 1.0, s)) * smoothstep(0.0, 0.008, s);

  vec3 tint, tintCore;
  sampleLaserPalette(vColorMix, tint, tintCore);
  vec3 col = mix(tint, tintCore, clamp(core * 0.80 + emitterHotspot * 0.45, 0.0, 0.90))
           + vec3(0.14) * pow(core, 3.6);

  float alpha = ((core * 1.15 + corona) * (1.0 + packet) * mist * endFade + emitterHotspot * 0.42) * vPower * 0.76;
  if (vMirror > 0.5) alpha *= 0.42;
  alpha *= (1.0 - 0.88 * uBlackout);

  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

// ============================================================================
// 9. 旋转空心断线激光锥笼着色器 (LASER_CONE — 360° 全彩几何激光隧道)
// ============================================================================
const CONE_VERT = /* glsl */ `
attribute vec4 aConeSpec; // x: 末端半径缩放, y: 旋转角速度符号/倍率, z: 功率强度 [0..1.3], w: 0=天空本体, 1=地面镜像
uniform float uTime;
uniform float uConePitch;
varying vec2 vConeUv; // x: 圆周角 [0..1], y: 轴向进度 [0..1] (0=舞台顶点, 1=观众席大口)
varying vec3 vWorldPos;
varying float vConePower;
varying float vSpinDir;
varying float vMirror;

void main() {
  vConeUv = uv;
  vConePower = aConeSpec.z;
  vSpinDir = aConeSpec.y;
  vMirror = aConeSpec.w;

  if (vConePower < 0.01) {
    vWorldPos = vec3(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // 桁架高空旋转激光锥笼：自舞台顶部桁架发射机位发散，向下倾斜切穿观众席，杜绝从专辑封面正中央发射
  float s = uv.y; // [0..1]
  float theta = uv.x * 6.2831853;
  float r = (0.42 + s * 17.6) * aConeSpec.x;

  vec3 apex = vec3(0.0, 18.05, -52.4);
  vec3 axisDir = normalize(vec3(0.0, uConePitch, 1.0));
  vec3 right = vec3(1.0, 0.0, 0.0);
  vec3 upOrtho = normalize(cross(axisDir, right));

  vec3 wp = apex + axisDir * (s * 70.0) + (right * cos(theta) + upOrtho * sin(theta)) * r;
  if (vMirror > 0.5) wp.y = -wp.y;

  vWorldPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const CONE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uConeSpin;
uniform float uBlackout;
varying vec2 vConeUv;
varying vec3 vWorldPos;
varying float vConePower;
varying float vSpinDir;
varying float vMirror;
${GLSL_HAZE_COMMON}
${GLSL_PALETTE_COMMON}

void main() {
  if (vConePower < 0.01) discard;
  if (vMirror < 0.5 && vWorldPos.y < -0.02) discard;
  if (vMirror > 0.5 && vWorldPos.y > 0.02) discard;

  float theta = vConeUv.x * 6.2831853 + uConeSpin * vSpinDir;
  float s = vConeUv.y;

  // Pangolin BEYOND 标志性多色断线圆锥花式（Polychrome Blanked Laser Cone）：24 束分色射线环绕镜头
  float rayWave = cos(theta * 24.0);
  float sharpRay = pow(max(0.0, rayWave), 28.0);
  float softSheet = 0.018 + 0.036 * pow(max(0.0, rayWave), 3.0);

  // 断续脉冲门控（Blanking Gate）沿圆锥高速向前奔涌
  float axialPulse = 0.35 + 0.85 * smoothstep(-0.2, 0.45, sin(s * 26.0 - uTime * 12.0 + vSpinDir * 1.5));
  float mist = 0.44 + 0.82 * hazeFbm(vWorldPos.xz * 0.09 + vec2(vWorldPos.y * 0.08, -uTime * 0.24));

  float ringOrigin = 0.035 * exp(-s * 16.0);
  float distFade = (1.0 - smoothstep(0.68, 1.0, s)) * smoothstep(0.008, 0.055, s);

  // 圆周连续对称空间渐变：0.5 + 0.5 * cos(theta) 在圆周上完全连续闭合，相邻射线颜色平滑过渡；模式 B 下全笼统一纯色！
  vec3 tint, tintCore;
  sampleStageGradient(0.5 + 0.5 * cos(theta), tint, tintCore);
  vec3 col = mix(tint, tintCore, clamp(sharpRay * 0.78, 0.0, 0.88)) + vec3(0.10) * pow(sharpRay, 2.4);

  float alpha = ((sharpRay * 1.65 + softSheet) * axialPulse * mist * distFade + ringOrigin) * vConePower * 0.27;
  if (vMirror > 0.5) alpha *= 0.36;
  alpha *= (1.0 - 0.88 * uBlackout);

  if (alpha < 0.002) discard;
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

// ============================================================================
// 10. 舞台前缘 CO2 低温白雾喷射气柱着色器 (CRYO_JET — 高压射流 + 多色激光染光)
// ============================================================================
const CRYO_VERT = /* glsl */ `
attribute vec4 aCryoBase;  // xyz: 喷嘴世界坐标, w: 0=天空本体, 1=地面镜像
attribute vec4 aCryoState; // x: 归一化喷发年龄 [0..1], y: 强度 [0..1.3], z: 喷柱最大高度(米), w: 随机种子
varying vec2 vCryoUv;      // x ∈ [-1..1] 横向宽度, y ∈ [0..1] 自喷口向上高度
varying vec3 vWorldPos;
varying float vAge;
varying float vStrength;
varying float vSeed;
varying float vMirror;

void main() {
  vCryoUv = vec2((uv.x - 0.5) * 2.0, uv.y);
  vAge = aCryoState.x;
  vStrength = aCryoState.y;
  vSeed = aCryoState.w;
  vMirror = aCryoBase.w;

  if (vStrength < 0.01) {
    vWorldPos = vec3(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // 喷柱在 0.12 归一化时间内极速冲顶，随后向上膨胀扩散消散
  float reach = smoothstep(0.0, 0.16, vAge) * (0.85 + 0.25 * vAge);
  float h = uv.y * aCryoState.z * reach;
  // 底部喷口紧束（0.22m），中上部湍流膨胀至 2.4m..3.5m
  float plumeHalfW = mix(0.22, 2.35 + 1.15 * vAge, pow(uv.y, 0.72));

  vec3 basePos = aCryoBase.xyz;
  float dirY = vMirror > 0.5 ? -1.0 : 1.0;
  if (vMirror > 0.5) basePos.y = -basePos.y;

  vec3 spine = basePos + vec3(0.0, dirY * h, 0.0);
  vec3 toCam = cameraPosition - spine;
  toCam.y = 0.0;
  vec3 right = length(toCam) > 1e-4 ? normalize(cross(vec3(0.0, 1.0, 0.0), toCam)) : vec3(1.0, 0.0, 0.0);

  vec3 wp = spine + right * (vCryoUv.x * plumeHalfW);
  vWorldPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const CRYO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBlinderGlow;
uniform float uBlackout;
uniform vec3 uBlinderWarm;
varying vec2 vCryoUv;
varying vec3 vWorldPos;
varying float vAge;
varying float vStrength;
varying float vSeed;
varying float vMirror;
${GLSL_HAZE_COMMON}
${GLSL_PALETTE_COMMON}

void main() {
  if (vStrength < 0.01) discard;
  if (vMirror < 0.5 && vWorldPos.y < -0.02) discard;
  if (vMirror > 0.5 && vWorldPos.y > 0.02) discard;

  float x = vCryoUv.x; // [-1..1]
  float y = vCryoUv.y; // [0..1]

  // 高速向上翻滚的高压低温水雾噪声
  vec2 flowUv = vec2(x * 1.6 + vSeed * 7.3, y * 3.4 - uTime * 7.5);
  float turb1 = hazeFbm(flowUv);
  float turb2 = hazeFbm(flowUv * 2.2 - vec2(0.0, uTime * 4.5));
  float billow = turb1 * 0.62 + turb2 * 0.38;

  // 横向高斯核心 + 湍流边缘蚕食，避免生硬矩形感
  float radial = max(0.0, 1.0 - abs(x) - (1.0 - billow) * 0.48 * smoothstep(0.05, 0.65, y));
  radial = smoothstep(0.0, 0.55, radial);

  // 喷嘴根部超音速高压白芯 + 随年龄底部先断气、顶部云团升空消散
  float cutoffBottom = smoothstep(max(0.0, (vAge - 0.32) * 1.15), max(0.08, (vAge - 0.32) * 1.15 + 0.28), y);
  float topSoft = 1.0 - smoothstep(0.68, 1.0, y);
  float nozzleCore = exp(-y * 10.0) * exp(-x * x * 8.0) * (1.0 - smoothstep(0.28, 0.52, vAge)) * 1.8;

  float lifeFade = (1.0 - smoothstep(0.45, 1.0, vAge));
  float density = (radial * billow * cutoffBottom * topSoft * 1.35 + nozzleCore) * vStrength * lifeFade;

  // 8 座低温白雾气柱按横向空间坐标实时吸收上方激光照射（模式 A 横向渐变，模式 B 全屏同色瞬切）
  vec3 laserMix, coreDummy;
  sampleStageGradient((vWorldPos.x + 15.0) / 30.0, laserMix, coreDummy);
  vec3 steamBase = vec3(0.86, 0.88, 0.91);
  vec3 litColor = steamBase * 0.26 + laserMix * 0.92 + uBlinderWarm * uBlinderGlow * 0.30;
  vec3 col = mix(litColor, mix(laserMix, vec3(1.0), 0.72), clamp(nozzleCore * 0.52, 0.0, 0.72));

  float alpha = density * (vMirror > 0.5 ? 0.20 : 0.46) * (1.0 - 0.85 * uBlackout);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

// ============================================================================
// 写实三维骨骼 DJ 与舞台器材程序化网格辅助构造器
// ============================================================================
interface LoftRing {
  /** 截面垂直高度（必须按从小到大递增排列以保证法线向外） */
  y: number;
  /** 前后中心偏移 (+Z 朝向观众席面部方向，-Z 朝向后背巨幕) */
  zOff: number;
  /** 左右半宽 */
  rx: number;
  /** 前后半厚 */
  rz: number;
  /** 左右中心偏移 */
  xOff?: number;
}

interface DjRigNodes {
  root: THREE.Group;
  spine: THREE.Group;
  head: THREE.Group;
  shoulderL: THREE.Group;
  elbowL: THREE.Group;
  handL: THREE.Group;
  shoulderR: THREE.Group;
  elbowR: THREE.Group;
  handR: THREE.Group;
}

/** 为任意 BufferGeometry 附加材质标签属性 aMatTag (0=哑光服饰, 1=皮肤/手部, 2=耳机金属/高光饰件) */
function tagGeometry(geo: THREE.BufferGeometry, matTag: number): THREE.BufferGeometry {
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count);
  arr.fill(matTag);
  geo.setAttribute('aMatTag', new THREE.BufferAttribute(arr, 1));
  return geo;
}

/** 按递增高度截面环生成光滑封闭解剖回转/放样曲面网格（精确朝外三维法线） */
function buildLoftGeometry(rings: LoftRing[], radialSegs = 20, matTag = 0): THREE.BufferGeometry {
  const ringCount = rings.length;
  const stride = radialSegs + 1;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < ringCount; i++) {
    const r = rings[i];
    const xo = r.xOff ?? 0;
    for (let j = 0; j <= radialSegs; j++) {
      const theta = (j / radialSegs) * Math.PI * 2;
      positions.push(
        xo + Math.cos(theta) * r.rx,
        r.y,
        r.zOff + Math.sin(theta) * r.rz,
      );
    }
  }

  for (let i = 0; i < ringCount - 1; i++) {
    const row0 = i * stride;
    const row1 = (i + 1) * stride;
    for (let j = 0; j < radialSegs; j++) {
      const a = row0 + j;
      const b = row1 + j;
      const c = row1 + j + 1;
      const d = row0 + j + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  // 底盖与顶盖使用独立顶点封口，绝不与侧壁共享索引，杜绝 90° 法线平均导致的关节菲涅尔亮圈
  const bot = rings[0];
  const botStartIdx = positions.length / 3;
  const botXo = bot.xOff ?? 0;
  positions.push(botXo, bot.y, bot.zOff);
  for (let j = 0; j <= radialSegs; j++) {
    const theta = (j / radialSegs) * Math.PI * 2;
    positions.push(botXo + Math.cos(theta) * bot.rx, bot.y, bot.zOff + Math.sin(theta) * bot.rz);
  }
  for (let j = 0; j < radialSegs; j++) {
    indices.push(botStartIdx, botStartIdx + 1 + j, botStartIdx + 1 + j + 1);
  }

  const top = rings[ringCount - 1];
  const topStartIdx = positions.length / 3;
  const topXo = top.xOff ?? 0;
  positions.push(topXo, top.y, top.zOff);
  for (let j = 0; j <= radialSegs; j++) {
    const theta = (j / radialSegs) * Math.PI * 2;
    positions.push(topXo + Math.cos(theta) * top.rx, top.y, top.zOff + Math.sin(theta) * top.rz);
  }
  for (let j = 0; j < radialSegs; j++) {
    indices.push(topStartIdx, topStartIdx + 1 + j + 1, topStartIdx + 1 + j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return tagGeometry(geo, matTag);
}

/** 构建真实弯曲弧度的制作人鸭舌棒球帽檐（朝向 +Z 前下方自然拱曲，前缘平滑收薄杜绝正面反光亮条） */
function buildCurvedVisorGeometry(matTag = 0): THREE.BufferGeometry {
  const segU = 14;
  const segV = 6;
  const positions: number[] = [];
  const indices: number[] = [];

  // 上表面与下表面双层网格，前缘厚度平滑收束至极薄边缘，消除生硬端面高光
  for (let side = 0; side < 2; side++) {
    const signY = side === 0 ? 1 : -1;
    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV; // 0 = 帽冠根部, 1 = 帽檐前缘
      const halfThick = lerp(0.0030, 0.0004, Math.pow(v, 0.85));
      const width = lerp(0.085, 0.064, v * v);
      const zBase = lerp(0.078, 0.192, v);
      const slopeY = lerp(0.214, 0.186, v);
      for (let iu = 0; iu <= segU; iu++) {
        const u = (iu / segU) * 2 - 1; // [-1..1]
        const edgeTaper = 1.0 - 0.65 * u * u;
        const arch = (1 - u * u) * 0.024;
        const curveZ = zBase - u * u * 0.028 * v;
        positions.push(u * width, slopeY + arch + signY * halfThick * edgeTaper, curveZ);
      }
    }
  }

  const layerVerts = (segV + 1) * (segU + 1);
  const rowStride = segU + 1;
  // 顶面 (+Y) 与底面 (-Y) 独立平滑法线，不跨上下层平均法线
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * rowStride + iu;
      const b = (iv + 1) * rowStride + iu;
      const c = (iv + 1) * rowStride + iu + 1;
      const d = iv * rowStride + iu + 1;
      indices.push(a, b, c, a, c, d);

      const a2 = layerVerts + a;
      const b2 = layerVerts + b;
      const c2 = layerVerts + c;
      const d2 = layerVerts + d;
      indices.push(a2, c2, b2, a2, d2, c2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return tagGeometry(geo, matTag);
}

// ============================================================================
// 主场景类：LaserScene（激光舞台 · 镭射穹廊）
// ============================================================================
export class LaserScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly pal: CoverLaserPaletteResult;
  private readonly rig: LyricRig;
  private readonly soft: boolean;
  private readonly djNodes: DjRigNodes;
  private djArmRaiseL = 0;
  private djArmRaiseR = 0;
  private djSpineFocus = 1;
  private lastDjT = -999;

  private readonly sheetSpecs: SheetEmitterSpec[];
  private readonly beamSpecs: BeamEmitterSpec[];
  private readonly choppers: ChopperHitEvent[];
  private readonly chopperTimes: Float64Array;
  private readonly unisonCuts: UnisonCutEvent[];
  private readonly unisonCutTimes: Float64Array;
  private readonly cryos: CryoBlastEvent[];
  private readonly cryoTimes: Float64Array;

  readonly uniforms: Record<string, THREE.IUniform>;

  private readonly blinderPosAttr: THREE.InstancedBufferAttribute;
  private readonly blinderStateAttr: THREE.InstancedBufferAttribute;
  private readonly blinderCoords: Array<{ x: number; y: number; z: number; portalIdx: number; side: number }>;

  private readonly sheetAnglesAttr: THREE.InstancedBufferAttribute;
  private readonly sheetStyleAttr: THREE.InstancedBufferAttribute;

  private readonly beamStartAttr: THREE.InstancedBufferAttribute;
  private readonly beamEndAttr: THREE.InstancedBufferAttribute;
  private readonly beamStyleAttr: THREE.InstancedBufferAttribute;

  private readonly coneSpecAttr: THREE.InstancedBufferAttribute;
  private readonly cryoStateAttr: THREE.InstancedBufferAttribute;

  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    const pal = buildCoverLaserColors(init);
    this.pal = pal;
    this.scene.background = pal.bgHex;
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, init.aspect, 0.2, 240);
    this.scene.add(this.camera);

    // 1. 初始化全局着色器 Uniforms（动态色彩向量独立 clone，保留 this.pal 作为封面纯正基准）
    this.uniforms = {
      uCover: { value: init.cover },
      uTime: { value: 0 },
      uBeatPos: { value: 0 },
      uSectionEnergy: { value: 0.7 },
      uDropPower: { value: 0 },
      uKickPunch: { value: 0 },
      uSnarePunch: { value: 0 },
      uBlinderGlow: { value: 0 },
      uBlackout: { value: 0 },
      uConeSpin: { value: 0 },
      uConePitch: { value: -0.21 },
      uChroma0: { value: new THREE.Vector4(0.3, 0.3, 0.3, 0.3) },
      uChroma1: { value: new THREE.Vector4(0.3, 0.3, 0.3, 0.3) },
      uChroma2: { value: new THREE.Vector4(0.3, 0.3, 0.3, 0.3) },
      uLaserPalette: { value: pal.laserPalette },
      uLaserCores: { value: pal.laserCores },
      uPalBase: { value: 0.0 },
      uPalSpan: { value: 5.0 },
      uSheetSpread: { value: 0.36 },
      uLaserPrimary: { value: pal.laserPrimary.clone() },
      uLaserSecondary: { value: pal.laserSecondary.clone() },
      uLaserPrimaryCore: { value: pal.laserPrimaryCore.clone() },
      uLaserSecondaryCore: { value: pal.laserSecondaryCore.clone() },
      uCoverGlow: { value: pal.coverGlow },
      uBlinderWarm: { value: pal.blinderWarm.clone() },
      uEnvDark: { value: pal.envDark },
    };

    // 2. 预计算发射器坐标与确定性控台事件表（含重音快切、全屏同色瞬切与 CO2 低温气柱）
    this.sheetSpecs = buildSheetEmitters();
    this.beamSpecs = buildBeamEmitters();
    const ev = buildLaserShowEvents(init.music, init.seed ?? 1, pal.unisonSlots);
    this.choppers = ev.choppers;
    this.chopperTimes = ev.chopperTimes;
    this.unisonCuts = ev.unisonCuts;
    this.unisonCutTimes = ev.unisonCutTimes;
    this.cryos = ev.cryos;
    this.cryoTimes = ev.cryoTimes;

    // 3. 构建深邃无界球形天穹与体积雾背板（平滑无折角接缝，renderOrder = -2）
    const backdropGeo = new THREE.SphereGeometry(132, 32, 20);
    const backdropMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    const backdropMesh = new THREE.Mesh(backdropGeo, backdropMat);
    backdropMesh.position.set(0, 12, -24);
    backdropMesh.renderOrder = -2;
    backdropMesh.frustumCulled = false;
    this.scene.add(backdropMesh);

    // 4. 构建湿润黑金反光舞台与场馆地坪（y = 0, renderOrder = -1, depthWrite = false 以透出下方镜像激光）
    const floorGeo = new THREE.PlaneGeometry(76, 114, 1, 1);
    floorGeo.rotateX(-Math.PI * 0.5);
    const floorMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      depthWrite: false,
      depthTest: true,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(0, 0, -22);
    floorMesh.renderOrder = -1;
    floorMesh.frustumCulled = false;
    this.scene.add(floorMesh);

    // 5. 构建远景舞台高台、巨幅微距 LED 封面主屏、两侧 12 半音全彩频谱灯塔、四联 CDJ 控台与写实 3D 骨骼 DJ
    //    （注：彻底移除走廊门式支撑立柱、顶梁与斜撑，杜绝室内毛坯厂房杂乱感）
    this.djNodes = this.buildStageCenterpiece();

    // 6. 构建集中挂载于主舞台巨幕顶冠、灯塔外翼与台唇的 28 组四眼观众盲眼灯（×2 本体+镜像 = 56 实例）
    const blinders = this.buildBlinderSystem();
    this.blinderPosAttr = blinders.posAttr;
    this.blinderStateAttr = blinders.stateAttr;
    this.blinderCoords = blinders.coords;

    // 7. 构建 14 座振镜扫描体积光膜（Liquid Sky & Fan Sheets，×2 本体+镜像 = 28 实例）
    const sheets = this.buildLaserSheets();
    this.sheetAnglesAttr = sheets.anglesAttr;
    this.sheetStyleAttr = sheets.styleAttr;

    // 8. 构建 36 束军鼓/重音 X 型交叉铡刀单束激光（×2 本体+镜像 = 72 实例）
    const beams = this.buildLaserBeams();
    this.beamStartAttr = beams.startAttr;
    this.beamEndAttr = beams.endAttr;
    this.beamStyleAttr = beams.styleAttr;

    // 9. 构建双层反向旋转空心断线激光锥笼（×2 本体+镜像 = 4 实例）
    this.coneSpecAttr = this.buildLaserCones();

    // 10. 构建舞台前缘 8 座 CO2 低温白雾喷射气柱（×2 本体+镜像 = 16 实例）
    this.cryoStateAttr = this.buildCryoJets();

    // 11. 挂载三维双语歌词排版系统（底部 caption 干净呈现，严格同步封面色系；低饱和/黑白封面保持柔和纯净色调）
    const lyricPalette: Palette = {
      ...init.palette,
      ink: colorFromHsl(pal.lyricHue, pal.mono ? 0.04 : Math.min(0.46, pal.lyricSat * 0.72), 0.05),
      paper: new THREE.Color('#f8fbff'),
      signal: colorFromHsl(pal.lyricHue, pal.mono ? 0.06 : pal.lyricSat, pal.mono ? 0.88 : 0.72),
      light: false,
    };
    this.rig = new LyricRig(lyricPalette, 'caption');
    this.rig.faces = voiceFaces(look, init.seed ?? 1);
    this.rig.layoutFov = CAM_FOV;
    this.scene.add(this.rig.group);
  }

  /** 构建中央巨幅微距 LED 封面主屏、频谱灯塔、舞台底座、四联 CDJ 专业控台、监听音箱与写实三维骨骼 DJ */
  private buildStageCenterpiece(): DjRigNodes {
    // 1. 中央 1:1 巨幅微距 LED 点阵封面主屏
    const screenGeo = new THREE.PlaneGeometry(SCREEN_SIZE, SCREEN_SIZE);
    const screenMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: LED_WALL_VERT,
      fragmentShader: LED_MAIN_FRAG,
    });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(0, SCREEN_CENTER_Y, STAGE_Z);
    screenMesh.renderOrder = 0;
    this.scene.add(screenMesh);

    // 2. 两侧 12 半音色度频谱副屏灯塔（微微向内折角 12°）
    const towerGeo = new THREE.PlaneGeometry(2.55, 14.8);
    const towerMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: LED_WALL_VERT,
      fragmentShader: LED_TOWER_FRAG,
    });
    for (const sign of [-1, 1]) {
      const tower = new THREE.Mesh(towerGeo, towerMat);
      tower.position.set(sign * 10.65, 9.75, STAGE_Z + 0.65);
      tower.rotation.y = -sign * 0.21;
      tower.renderOrder = 0;
      this.scene.add(tower);
    }

    // 3. 重工业巡演主舞台（16 舱超低音炮穿孔钢网阵列）+ 多折面阳极氧化拉丝黑钛铝 DJ 控台
    const riserMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: STAGE_STRUCT_VERT,
      fragmentShader: STAGE_RISER_FRAG,
    });
    const boothMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: STAGE_STRUCT_VERT,
      fragmentShader: DJ_BOOTH_FRAG,
    });

    const stageRiser = new THREE.Mesh(new THREE.BoxGeometry(31.0, STAGE_DECK_H, 9.4), riserMat);
    stageRiser.position.set(0, STAGE_DECK_H * 0.5, STAGE_LIP_Z - 4.7);
    stageRiser.renderOrder = 0;
    this.scene.add(stageRiser);

    const pedestalTopY = STAGE_DECK_H + 0.42; // 1.87m
    const djPedestal = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.42, 2.5), boothMat);
    djPedestal.position.set(0, STAGE_DECK_H + 0.21, -49.70);
    djPedestal.renderOrder = 0;
    this.scene.add(djPedestal);

    // 多体块重工折面铝合金 DJ 控台（内收暗底座 + 前倾折面拉丝装甲挡板 + 铣削金属上压框 + 左右斜切翼舱）
    const boothH = 0.90;
    const djBoothCore = new THREE.Mesh(new THREE.BoxGeometry(4.28, boothH * 0.96, 0.96), boothMat);
    djBoothCore.position.set(0, pedestalTopY + boothH * 0.48, -49.22);
    djBoothCore.renderOrder = 0;
    this.scene.add(djBoothCore);

    // 向前上方微倾 9° 的拉丝钛黑铝合金重工折面主护板（真实捕捉顶光高光渐变）
    const frontArmor = new THREE.Mesh(new THREE.BoxGeometry(4.42, boothH * 0.86, 0.14), boothMat);
    frontArmor.position.set(0, pedestalTopY + boothH * 0.50, -48.70);
    frontArmor.rotation.x = -0.155;
    frontArmor.renderOrder = 0;
    this.scene.add(frontArmor);

    // 顶部防震重金属包边台沿压条
    const topTrim = new THREE.Mesh(new THREE.BoxGeometry(4.52, 0.075, 1.12), boothMat);
    topTrim.position.set(0, pedestalTopY + boothH - 0.02, -49.18);
    topTrim.renderOrder = 0;
    this.scene.add(topTrim);

    for (const sign of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.98, boothH * 0.88, 0.94), boothMat);
      wing.position.set(sign * 2.54, pedestalTopY + boothH * 0.44, -49.30);
      wing.rotation.y = -sign * 0.34;
      wing.rotation.z = sign * 0.05;
      wing.renderOrder = 0;
      this.scene.add(wing);
    }

    // 控台顶面倾斜摆放的四联 Pioneer CDJ-3000 播放器 + DJM-A9 混音台发光面板
    const gearMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: LED_WALL_VERT,
      fragmentShader: DECK_GEAR_FRAG,
    });
    const gearPlane = new THREE.Mesh(new THREE.PlaneGeometry(3.75, 0.80), gearMat);
    gearPlane.position.set(0, pedestalTopY + boothH + 0.038, -49.24);
    gearPlane.rotation.x = -Math.PI * 0.5 + 0.22; // 向站在后方的 DJ 倾斜 12.6°，真实照亮手部与下颌
    gearPlane.renderOrder = 1;
    this.scene.add(gearPlane);

    // DJ 身后舞台地排灯干冰背光薄雾（在纯黑底色封面前也能清晰衬托出三维 DJ 的立体轮廓层次）
    const haloMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: LED_WALL_VERT,
      fragmentShader: DJ_BACKLIGHT_HALO_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const haloMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 4.4), haloMat);
    haloMesh.position.set(0, pedestalTopY + 1.45, -50.65);
    haloMesh.renderOrder = 1;
    this.scene.add(haloMesh);

    // 共用三维物理逆光与近场散射材质（人物、耳机金属饰件与舞台监听音箱共享）
    const djCharMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: DJ_CHARACTER_VERT,
      fragmentShader: DJ_CHARACTER_FRAG,
    });

    // 控台左右两侧专业近场舞台监听音箱（Booth Monitors on Stands，内旋朝向 DJ 双耳）
    const standPoleGeo = tagGeometry(new THREE.CylinderGeometry(0.032, 0.042, 1.18, 10), 0);
    const monitorBoxGeo = tagGeometry(new THREE.BoxGeometry(0.38, 0.54, 0.35), 2);
    for (const sign of [-1, 1]) {
      const pole = new THREE.Mesh(standPoleGeo, djCharMat);
      pole.position.set(sign * 2.65, pedestalTopY + 0.59, -49.42);
      this.scene.add(pole);

      const monitor = new THREE.Mesh(monitorBoxGeo, djCharMat);
      monitor.position.set(sign * 2.65, pedestalTopY + 1.36, -49.42);
      monitor.rotation.y = -sign * 0.52;
      monitor.rotation.x = 0.10;
      this.scene.add(monitor);
    }

    // 4. 构建写实人体比例三维骨骼关节 DJ（立于控台后方 z = -49.88，1.28x 舞台视觉黄金比例确保远近机位均挺拔清晰）
    const root = new THREE.Group();
    root.position.set(0, pedestalTopY - 0.14, -49.88);
    root.scale.setScalar(1.28);
    this.scene.add(root);

    // 4a. 下肢工装裤与骨盆底座（确保高空俯拍机位 rig 下控台内侧腿部站姿完整真实）
    for (const sign of [-1, 1]) {
      const legGeo = buildLoftGeometry([
        { y: 0.00, zOff: 0.01, rx: 0.064, rz: 0.088, xOff: sign * 0.115 },
        { y: 0.44, zOff: 0.01, rx: 0.070, rz: 0.074, xOff: sign * 0.110 },
        { y: 0.88, zOff: 0.00, rx: 0.088, rz: 0.094, xOff: sign * 0.095 },
      ], 14, 0);
      root.add(new THREE.Mesh(legGeo, djCharMat));
    }
    const pelvisGeo = buildLoftGeometry([
      { y: 0.84, zOff: -0.005, rx: 0.172, rz: 0.112 },
      { y: 0.96, zOff: 0.000, rx: 0.168, rz: 0.108 },
    ], 18, 0);
    root.add(new THREE.Mesh(pelvisGeo, djCharMat));

    // 4b. 腰脊枢轴（spine，位于 y = 0.94）与重磅连帽机能卫衣/夹克躯干（饱满宽肩与斜方肌自然斜坡）
    const spine = new THREE.Group();
    spine.position.set(0, 0.94, 0);
    root.add(spine);

    const torsoGeo = buildLoftGeometry([
      { y: -0.05, zOff: -0.008, rx: 0.176, rz: 0.114 }, // 卫衣松弛罗纹下摆
      { y: 0.07,  zOff: 0.002,  rx: 0.166, rz: 0.110 }, // 腰腹自然微收
      { y: 0.21,  zOff: 0.012,  rx: 0.198, rz: 0.128 }, // 中胸背阔肌渐宽
      { y: 0.36,  zOff: 0.014,  rx: 0.232, rz: 0.142 }, // 饱满胸廓与宽厚肩背
      { y: 0.465, zOff: 0.004,  rx: 0.252, rz: 0.136 }, // 健硕双肩外扩廓形
      { y: 0.525, zOff: -0.006, rx: 0.184, rz: 0.116 }, // 饱满斜方肌自然溜肩坡度
      { y: 0.570, zOff: -0.012, rx: 0.124, rz: 0.114 }, // 连帽卫衣立体领圈堆叠口
    ], 24, 0);
    spine.add(new THREE.Mesh(torsoGeo, djCharMat));

    // 后背自然垂坠的连帽卫衣兜帽（Draped Hoodie Cowl，逆光下极大增强服装真实轮廓感）
    const hoodCowlGeo = buildLoftGeometry([
      { y: 0.39, zOff: -0.132, rx: 0.072, rz: 0.042 },
      { y: 0.48, zOff: -0.124, rx: 0.128, rz: 0.062 },
      { y: 0.555, zOff: -0.086, rx: 0.136, rz: 0.072 },
      { y: 0.585, zOff: -0.048, rx: 0.102, rz: 0.052 },
    ], 16, 0);
    spine.add(new THREE.Mesh(hoodCowlGeo, djCharMat));

    // 4c. 颈部与解剖头颅枢轴（head，位于颈根 y = 0.555）+ 一体成形棒球帽冠 + 弯檐 + 包耳监听耳机
    const head = new THREE.Group();
    head.position.set(0, 0.555, 0.006);
    spine.add(head);

    // 将颈部、解剖面部与贴合颅顶的棒球帽冠合并为单一连续光滑网格，彻底消除额头水平接缝亮线！
    const headAndCrownGeo = buildLoftGeometry([
      { y: -0.02, zOff: -0.006, rx: 0.068, rz: 0.068 }, // 健壮颈根无缝汇入卫衣领口
      { y: 0.045, zOff: 0.004,  rx: 0.060, rz: 0.062 }, // 颈部肌肉线条
      { y: 0.086, zOff: 0.024,  rx: 0.068, rz: 0.084 }, // 下颌骨与下巴前探轮廓
      { y: 0.138, zOff: 0.018,  rx: 0.080, rz: 0.098 }, // 颧骨与双颊
      { y: 0.188, zOff: 0.008,  rx: 0.086, rz: 0.106 }, // 眉弓与帽沿根部平滑过渡
      { y: 0.242, zOff: -0.002, rx: 0.084, rz: 0.102 }, // 棒球帽冠饱满弧面
      { y: 0.288, zOff: -0.007, rx: 0.054, rz: 0.066 }, // 帽顶圆拱收束
      { y: 0.305, zOff: -0.008, rx: 0.016, rz: 0.018 }, // 颅顶帽扣
    ], 22, 0);
    head.add(new THREE.Mesh(headAndCrownGeo, djCharMat));
    head.add(new THREE.Mesh(buildCurvedVisorGeometry(0), djCharMat));

    // 双耳包耳式专业监听耳机（椭圆厚耳罩 + 跨越帽顶的金属弹簧头梁弓）
    const earCupGeo = tagGeometry(new THREE.CylinderGeometry(0.046, 0.042, 0.038, 16), 2);
    earCupGeo.rotateZ(Math.PI * 0.5);
    earCupGeo.scale(1.0, 1.24, 0.94);
    for (const sign of [-1, 1]) {
      const cup = new THREE.Mesh(earCupGeo, djCharMat);
      cup.position.set(sign * 0.094, 0.158, 0.006);
      cup.rotation.z = -sign * 0.08;
      head.add(cup);
    }
    const headbandGeo = tagGeometry(new THREE.TorusGeometry(0.098, 0.0115, 8, 20, Math.PI), 2);
    const headband = new THREE.Mesh(headbandGeo, djCharMat);
    headband.position.set(0, 0.208, 0.002);
    headband.rotation.x = -0.10;
    head.add(headband);

    // 4d. 左右双节可动骨骼手臂（注意 DJ 面朝 +Z，故身体左肩在 +X，身体右肩在 -X）
    const buildArmChain = (sideSign: number) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(sideSign * 0.232, 0.458, 0.006);
      shoulder.rotation.order = 'YZX';
      spine.add(shoulder);

      // 宽松夹克大臂袖管（两端带圆润球头收束，饱满三角肌平滑嵌入躯干宽肩 + 肘部衣褶，沿 -Y 延伸 0.29m）
      const upperArmGeo = buildLoftGeometry([
        { y: -0.312, zOff: 0.002, rx: 0.032, rz: 0.032 }, // 肘端圆滑球头底环
        { y: -0.288, zOff: 0.002, rx: 0.055, rz: 0.056 },
        { y: -0.235, zOff: 0.003, rx: 0.064, rz: 0.065 }, // 袖肘褶皱隆起
        { y: -0.130, zOff: 0.000, rx: 0.068, rz: 0.070 },
        { y: -0.015, zOff: -0.002, rx: 0.078, rz: 0.080, xOff: -sideSign * 0.012 },
        { y: 0.042,  zOff: -0.004, rx: 0.066, rz: 0.070, xOff: -sideSign * 0.026 },
        { y: 0.072,  zOff: -0.005, rx: 0.036, rz: 0.038, xOff: -sideSign * 0.038 }, // 三角肌圆顶深嵌肩峰杜绝高举脱节
      ], 16, 0);
      shoulder.add(new THREE.Mesh(upperArmGeo, djCharMat));

      const elbow = new THREE.Group();
      elbow.position.set(0, -0.285, 0);
      elbow.rotation.order = 'YZX';
      shoulder.add(elbow);

      // 挽袖结实前臂（两端带解剖圆润收束，从肘肌自然收细至手腕，沿 -Y 延伸 0.255m）
      const forearmGeo = buildLoftGeometry([
        { y: -0.262, zOff: 0.002, rx: 0.022, rz: 0.019 },
        { y: -0.248, zOff: 0.002, rx: 0.031, rz: 0.026 }, // 手腕扁椭圆截面
        { y: -0.160, zOff: 0.004, rx: 0.041, rz: 0.038 },
        { y: -0.050, zOff: 0.002, rx: 0.051, rz: 0.049 }, // 前臂肱桡肌饱满度
        { y: 0.012,  zOff: -0.001, rx: 0.047, rz: 0.047 },
        { y: 0.034,  zOff: -0.002, rx: 0.026, rz: 0.026 }, // 肘关节圆滑球头嵌入大臂袖口
      ], 14, 1);
      elbow.add(new THREE.Mesh(forearmGeo, djCharMat));

      const hand = new THREE.Group();
      hand.position.set(0, -0.252, 0);
      elbow.add(hand);

      // 立体手掌与微曲手指（扁平掌体 + 虎口大拇指侧隆起，挥手与按旋钮姿态均真实自然）
      const palmGeo = buildLoftGeometry([
        { y: -0.130, zOff: 0.013, rx: 0.016, rz: 0.009 },
        { y: -0.118, zOff: 0.012, rx: 0.029, rz: 0.014 }, // 指尖微向掌心内扣
        { y: -0.075, zOff: 0.006, rx: 0.040, rz: 0.018 }, // 掌指关节宽面
        { y: -0.035, zOff: 0.003, rx: 0.042, rz: 0.021, xOff: -sideSign * 0.006 }, // 虎口拇指根
        { y: 0.006,  zOff: 0.000, rx: 0.030, rz: 0.023 },
        { y: 0.018,  zOff: 0.000, rx: 0.018, rz: 0.015 }, // 腕部平滑球头衔接
      ], 12, 1);
      hand.add(new THREE.Mesh(palmGeo, djCharMat));

      return { shoulder, elbow, hand };
    };

    const armL = buildArmChain(1);  // +X 为面朝观众的 DJ 左臂
    const armR = buildArmChain(-1); // -X 为面朝观众的 DJ 右臂

    return {
      root,
      spine,
      head,
      shoulderL: armL.shoulder,
      elbowL: armL.elbow,
      handL: armL.hand,
      shoulderR: armR.shoulder,
      elbowR: armR.elbow,
      handR: armR.hand,
    };
  }

  /** 构建集中挂载于主舞台巨幕顶冠、频谱灯塔侧翼与台唇的 28 组四眼观众盲眼灯系统（零半空悬浮灯泡，含地面镜像） */
  private buildBlinderSystem() {
    const coords: Array<{ x: number; y: number; z: number; portalIdx: number; side: number }> = [];
    // 1. 巨幕与频谱灯塔顶冠横排 10 组（由中轴向两侧排布）
    for (let i = 0; i < 10; i++) {
      const u = (i / 9) * 2 - 1;
      const x = u * 11.6;
      coords.push({
        x,
        y: 18.06,
        z: STAGE_Z + 0.35,
        portalIdx: Math.round(Math.abs(u) * 4),
        side: x < 0 ? -1 : 1,
      });
    }
    // 2. 两侧 12 半音频谱灯塔外缘竖向对称阵列 10 组（左 5 + 右 5）
    const towerYs = [3.6, 6.6, 9.6, 12.6, 15.6];
    for (const sign of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        coords.push({
          x: sign * 12.18,
          y: towerYs[k],
          z: STAGE_Z + 0.85,
          portalIdx: 4 - k,
          side: sign,
        });
      }
    }
    // 3. 舞台前缘低位台唇观众盲眼灯 8 组
    for (let i = 0; i < 8; i++) {
      const u = (i / 7) * 2 - 1;
      coords.push({
        x: u * 13.4,
        y: STAGE_DECK_H + 0.24,
        z: STAGE_LIP_Z + 0.24,
        portalIdx: Math.round(Math.abs(u) * 3),
        side: u < 0 ? -1 : 1,
      });
    }

    const total = BLINDER_COUNT * 2;
    const baseQuad = new THREE.PlaneGeometry(2, 2);
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = baseQuad.index;
    instGeo.attributes.position = baseQuad.attributes.position;
    instGeo.instanceCount = total;

    const posArr = new Float32Array(total * 4);
    const stateArr = new Float32Array(total * 4);
    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < BLINDER_COUNT; i++) {
        const slot = (mirror * BLINDER_COUNT + i) * 4;
        const c = coords[i];
        posArr[slot] = c.x;
        posArr[slot + 1] = c.y;
        posArr[slot + 2] = c.z;
        posArr[slot + 3] = mirror;

        stateArr[slot] = 0;
        stateArr[slot + 1] = 0.5;
        stateArr[slot + 2] = c.y < 4.0 ? 0.85 : 1.06;
        stateArr[slot + 3] = (i * 0.37) % 1;
      }
    }

    const posAttr = new THREE.InstancedBufferAttribute(posArr, 4);
    const stateAttr = new THREE.InstancedBufferAttribute(stateArr, 4);
    stateAttr.setUsage(THREE.DynamicDrawUsage);
    instGeo.setAttribute('aBlinderPos', posAttr);
    instGeo.setAttribute('aBlinderState', stateAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BLINDER_VERT,
      fragmentShader: BLINDER_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(instGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.scene.add(mesh);

    return { posAttr, stateAttr, coords };
  }

  /** 构建振镜扫描体积光膜网格（横向 36 段细分以呈现丝滑的正弦波浪 Liquid Sky 折痕） */
  private buildLaserSheets() {
    const segX = 36;
    const segZ = 16;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let iz = 0; iz <= segZ; iz++) {
      const rz = iz / segZ;
      for (let ix = 0; ix <= segX; ix++) {
        const rx = (ix / segX) * 2 - 1;
        positions.push(rx, 0, rz);
      }
    }
    const stride = segX + 1;
    for (let iz = 0; iz < segZ; iz++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = iz * stride + ix;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const total = SHEET_EMITTER_COUNT * 2;
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    instGeo.setIndex(indices);
    instGeo.instanceCount = total;

    const originArr = new Float32Array(total * 4);
    const anglesArr = new Float32Array(total * 4);
    const styleArr = new Float32Array(total * 4);

    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < SHEET_EMITTER_COUNT; i++) {
        const slot = (mirror * SHEET_EMITTER_COUNT + i) * 4;
        const sp = this.sheetSpecs[i];
        originArr[slot] = sp.x;
        originArr[slot + 1] = sp.y;
        originArr[slot + 2] = sp.z;
        originArr[slot + 3] = mirror;

        anglesArr[slot] = sp.baseYaw;
        anglesArr[slot + 1] = sp.basePitch;
        anglesArr[slot + 2] = 0;
        anglesArr[slot + 3] = 0.42;

        styleArr[slot] = sp.length;
        styleArr[slot + 1] = 0;
        styleArr[slot + 2] = i % 2;
        styleArr[slot + 3] = 0.5;
      }
    }

    const originAttr = new THREE.InstancedBufferAttribute(originArr, 4);
    const anglesAttr = new THREE.InstancedBufferAttribute(anglesArr, 4);
    const styleAttr = new THREE.InstancedBufferAttribute(styleArr, 4);
    anglesAttr.setUsage(THREE.DynamicDrawUsage);
    styleAttr.setUsage(THREE.DynamicDrawUsage);

    instGeo.setAttribute('aSheetOrigin', originAttr);
    instGeo.setAttribute('aSheetAngles', anglesAttr);
    instGeo.setAttribute('aSheetStyle', styleAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(instGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);

    return { anglesAttr, styleAttr };
  }

  /** 构建 36 束高锐度 X 型交叉铡刀单束激光（含地面镜像） */
  private buildLaserBeams() {
    const basePlane = new THREE.PlaneGeometry(1, 1, 8, 1);
    basePlane.translate(0.5, 0, 0);

    const total = BEAM_EMITTER_COUNT * 2;
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = basePlane.index;
    instGeo.attributes.position = basePlane.attributes.position;
    instGeo.attributes.uv = basePlane.attributes.uv;
    instGeo.instanceCount = total;

    const startArr = new Float32Array(total * 4);
    const endArr = new Float32Array(total * 4);
    const styleArr = new Float32Array(total * 4);

    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < BEAM_EMITTER_COUNT; i++) {
        const slot = (mirror * BEAM_EMITTER_COUNT + i) * 4;
        const b = this.beamSpecs[i];
        startArr[slot] = b.x;
        startArr[slot + 1] = b.y;
        startArr[slot + 2] = b.z;
        startArr[slot + 3] = mirror;

        endArr[slot] = 0;
        endArr[slot + 1] = 2;
        endArr[slot + 2] = 10;
        endArr[slot + 3] = 0.24;

        styleArr[slot] = 0;
        styleArr[slot + 1] = (i % 2);
        styleArr[slot + 2] = 0;
        styleArr[slot + 3] = (i * 0.618) % 1;
      }
    }

    const startAttr = new THREE.InstancedBufferAttribute(startArr, 4);
    const endAttr = new THREE.InstancedBufferAttribute(endArr, 4);
    const styleAttr = new THREE.InstancedBufferAttribute(styleArr, 4);
    endAttr.setUsage(THREE.DynamicDrawUsage);
    styleAttr.setUsage(THREE.DynamicDrawUsage);

    instGeo.setAttribute('aBeamStart', startAttr);
    instGeo.setAttribute('aBeamEnd', endAttr);
    instGeo.setAttribute('aBeamStyle', styleAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(instGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.scene.add(mesh);

    return { startAttr, endAttr, styleAttr };
  }

  /** 构建双层反向旋转空心断线激光锥笼（含地面镜像） */
  private buildLaserCones(): THREE.InstancedBufferAttribute {
    const baseGrid = new THREE.PlaneGeometry(1, 1, 72, 20);
    baseGrid.translate(0.5, 0.5, 0);

    const total = CONE_LAYER_COUNT * 2;
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = baseGrid.index;
    instGeo.attributes.position = baseGrid.attributes.position;
    instGeo.attributes.uv = baseGrid.attributes.uv;
    instGeo.instanceCount = total;

    const specArr = new Float32Array(total * 4);
    for (let mirror = 0; mirror < 2; mirror++) {
      // 外锥（主激光色，正向旋转）+ 内锥（副激光色，反向旋转）
      specArr.set([1.05, 1.0, 0.0, mirror], (mirror * CONE_LAYER_COUNT + 0) * 4);
      specArr.set([0.58, -1.35, 0.0, mirror], (mirror * CONE_LAYER_COUNT + 1) * 4);
    }

    const specAttr = new THREE.InstancedBufferAttribute(specArr, 4);
    specAttr.setUsage(THREE.DynamicDrawUsage);
    instGeo.setAttribute('aConeSpec', specAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: CONE_VERT,
      fragmentShader: CONE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(instGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);

    return specAttr;
  }

  /** 构建舞台前缘 8 座 CO2 低温白雾喷射气柱（含地面镜像） */
  private buildCryoJets(): THREE.InstancedBufferAttribute {
    const basePlane = new THREE.PlaneGeometry(1, 1, 6, 18);
    basePlane.translate(0, 0.5, 0);

    const jetXs = [-14.2, -10.4, -6.8, -3.2, 3.2, 6.8, 10.4, 14.2];
    const total = CRYO_JET_COUNT * 2;
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = basePlane.index;
    instGeo.attributes.position = basePlane.attributes.position;
    instGeo.attributes.uv = basePlane.attributes.uv;
    instGeo.instanceCount = total;

    const baseArr = new Float32Array(total * 4);
    const stateArr = new Float32Array(total * 4);
    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < CRYO_JET_COUNT; i++) {
        const slot = (mirror * CRYO_JET_COUNT + i) * 4;
        baseArr[slot] = jetXs[i];
        baseArr[slot + 1] = STAGE_DECK_H + 0.1;
        baseArr[slot + 2] = STAGE_LIP_Z + 0.35;
        baseArr[slot + 3] = mirror;

        stateArr[slot] = 0;
        stateArr[slot + 1] = 0;
        stateArr[slot + 2] = 15.2;
        stateArr[slot + 3] = (i * 0.29 + 0.13) % 1;
      }
    }

    const baseAttr = new THREE.InstancedBufferAttribute(baseArr, 4);
    const stateAttr = new THREE.InstancedBufferAttribute(stateArr, 4);
    stateAttr.setUsage(THREE.DynamicDrawUsage);
    instGeo.setAttribute('aCryoBase', baseAttr);
    instGeo.setAttribute('aCryoState', stateAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: CRYO_VERT,
      fragmentShader: CRYO_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(instGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.scene.add(mesh);

    return stateAttr;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 计算单个激光舞台机位在时刻 t 的无微震基准轨道（纯函数）。 */
  private evalCameraSetup(t: number, s: Shot, dropPower: number): {
    cx: number; cy: number; cz: number; tx: number; ty: number; tz: number; roll: number; baseFov: number;
  } {
    const dur = Math.max(1.2, s.end - s.start);
    const u = clamp01((t - s.start) / dur);
    const easeU = inOutCubic(u);
    const r = rng((stableShotSeed(s) ^ 0x4c19a2d1) >>> 0);
    const sideSign = r() < 0.5 ? -1 : 1;

    let cx = 0, cy = 3.0, cz = 2.0;
    let tx = 0, ty = 8.4, tz = STAGE_Z;
    let roll = 0;
    let baseFov = CAM_FOV;

    switch (s.variant) {
      case 'tunnel': {
        // 激光锥笼穿行视角：抬升至舞台顶梁激光圆锥笼轴心高度，伴随呼吸式微倾角向前穿梭
        cx = Math.sin(t * 0.38) * 1.45;
        cy = lerp(5.9, 9.8, easeU) + Math.cos(t * 0.55) * 0.25;
        cz = lerp(5.5, -13.5, u);
        tx = Math.sin(t * 0.28) * 0.65;
        ty = lerp(14.8, 17.8, easeU);
        tz = STAGE_Z;
        roll = Math.sin(t * 0.62) * 0.055 * (0.4 + 0.6 * dropPower);
        baseFov = CAM_FOV + 3.5;
        break;
      }
      case 'booth': {
        // 前排护栏仰视压迫视角：逼近舞台前缘，近距离仰望 CO2 冲天气柱、巨幕微距 LED 与瀑布般倾泻的天幕扇
        cx = sideSign * lerp(3.8, -2.4, easeU);
        cy = lerp(1.78, 2.25, easeU);
        cz = lerp(-18.5, -26.5, u);
        tx = sideSign * -0.6;
        ty = lerp(9.4, 10.6, easeU);
        tz = STAGE_Z;
        roll = sideSign * 0.025;
        baseFov = CAM_FOV + 2.0;
        break;
      }
      case 'rig': {
        // 高空斜向航拍巡礼视角：俯瞰无界深邃暗场中立体交织的全彩激光网与黑金地面倒影
        cx = sideSign * lerp(11.4, 6.2, easeU);
        cy = lerp(11.8, 7.6, easeU);
        cz = lerp(-1.5, -17.5, u);
        tx = sideSign * -1.5;
        ty = lerp(5.8, 7.4, easeU);
        tz = STAGE_Z + 4.0;
        roll = -sideSign * 0.045;
        baseFov = CAM_FOV;
        break;
      }
      case 'arena':
      default: {
        // 池座中轴黄金纵深主视角：无界深黑天幕下全彩激光交织，下方湿润黑金地面 1:1 对称反射巨幕与彩光
        cx = sideSign * Math.sin(u * Math.PI) * 1.65;
        cy = lerp(2.65, 3.35, easeU);
        cz = lerp(4.2, -8.8, u);
        tx = 0;
        ty = lerp(8.1, 8.8, easeU);
        tz = STAGE_Z;
        roll = Math.sin(t * 0.42) * 0.018;
        baseFov = CAM_FOV;
        break;
      }
    }
    return { cx, cy, cz, tx, ty, tz, roll, baseFov };
  }

  /** 四组电影级电音节现场运镜（支持同场景切镜丝滑过渡，确保前景舞台与远景专辑封面 100% 同频共振无割裂） */
  private poseCamera(
    t: number,
    shot: Shot,
    _shotT: number,
    kickPunch: number,
    snarePunch: number,
    dropPower: number,
  ): void {
    const curr = this.evalCameraSetup(t, shot, dropPower);
    const blend = sameSceneBlend(t, shot, 1.35);
    let { cx, cy, cz, tx, ty, tz, roll, baseFov } = curr;
    if (blend) {
      const prev = this.evalCameraSetup(t, blend.prev, dropPower);
      const w = blend.w;
      cx = lerp(prev.cx, curr.cx, w);
      cy = lerp(prev.cy, curr.cy, w);
      cz = lerp(prev.cz, curr.cz, w);
      tx = lerp(prev.tx, curr.tx, w);
      ty = lerp(prev.ty, curr.ty, w);
      tz = lerp(prev.tz, curr.tz, w);
      roll = lerp(prev.roll, curr.roll, w);
      baseFov = lerp(prev.baseFov, curr.baseFov, w);
    }

    // 克制细腻的低频底鼓与军鼓声压微震（幅度下调约 83%，保留音乐律动呼吸感而绝不晃成地震）
    const kickImpact = kickPunch * (0.40 + 0.60 * dropPower);
    const snareImpact = snarePunch * (0.50 + 0.50 * dropPower);
    const shakeY = Math.sin(t * 38.0) * 0.0050 * kickImpact + Math.sin(t * 62.0 + 0.6) * 0.0065 * snareImpact;
    const shakeX = Math.cos(t * 31.0) * 0.0032 * kickImpact + Math.cos(t * 54.0 + 1.1) * 0.0045 * snareImpact;

    // 同步微震机制：将微小的声压位移与极克制的视线俯仰角脉冲同步施加到 lookAt 焦点，使封面巨幕与前景舞台轻柔同频共振
    const distToTarget = Math.max(12.0, Math.hypot(tx - cx, ty - cy, tz - cz));
    const angPitchY = (Math.sin(t * 42.0) * 0.00032 * kickImpact + Math.sin(t * 66.0 + 0.4) * 0.00052 * snareImpact) * distToTarget;
    const angYawX = (Math.cos(t * 35.0) * 0.00020 * kickImpact + Math.cos(t * 58.0 + 0.9) * 0.00035 * snareImpact) * distToTarget;
    const rollShake = Math.sin(t * 50.0) * 0.0009 * snareImpact;

    this.camera.fov = baseFov + kickImpact * 0.22 + snareImpact * 0.16;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(cx + shakeX, cy + shakeY, cz);
    this.camera.up.set(Math.sin(roll + rollShake), Math.cos(roll + rollShake), 0);
    this.camera.lookAt(tx + shakeX + angYawX, ty + shakeY + angPitchY, tz);
  }

  /**
   * 实时驱动写实三维骨骼 DJ 的身体律动、平滑抬落手过渡与锐舞“手肘钝角 ↔ 180°”反复推举运动学：
   * - 手肘锐舞循环：高举挥臂时不再僵直，每拍从约 102° 钝角蓄力收肘，随重拍强力向上推展至接近 180°（约 176°）再弹性屈回；
   * - 双臂自然抬放：消除离散小节突变，采用连续时间 S 斜坡 + 帧间角速度限幅平滑器（抬落全程约 0.75~0.90s）及胸前微屈过渡弧线。
   */
  private updateDjPerformance(
    t: number,
    beatPos: number,
    inBar: number,
    beatDur: number,
    meter: number,
    sec: Section,
    prevSec: Section | undefined,
    nextSec: Section | undefined,
    isBreak: boolean,
    isBuild: boolean,
    buildProgress: number,
    dropPower: number,
    kickPunch: number,
    snarePunch: number,
    fgLevel: number,
  ): void {
    const dj = this.djNodes;
    const pedestalTopY = STAGE_DECK_H + 0.42;
    const beatRad = beatPos * Math.PI * 2;
    const barRad = ((inBar + beatPos) * 0.25) * Math.PI * 2;
    const barLen = Math.max(0.8, beatDur * meter);
    const intoSec = Math.max(0, t - sec.start);
    const remSec = Math.max(0, sec.end - t);
    const isHigh = sec.label === 'drop' || sec.label === 'chorus';

    // 0. 计算左右手臂与俯身重心的连续时间目标包络（无任何阶跃跳变）
    let targetRaiseR = 0;
    if (isBuild) {
      const rise = smooth(clamp01((buildProgress - 0.36) / 0.48));
      const holdToNext = nextSec && (nextSec.label === 'drop' || nextSec.label === 'chorus');
      const endFade = holdToNext ? 1.0 : smooth(clamp01(remSec / 0.85));
      targetRaiseR = rise * endFade;
    } else if (isHigh) {
      const prevWasHigh = prevSec && (prevSec.label === 'build' || prevSec.label === 'pre' || prevSec.label === 'drop' || prevSec.label === 'chorus');
      const nextIsHigh = nextSec && (nextSec.label === 'drop' || nextSec.label === 'chorus');
      const entryRamp = prevWasHigh ? 1.0 : smooth(clamp01(intoSec / 0.78));
      const exitRamp = nextIsHigh ? 1.0 : smooth(clamp01(remSec / 0.88));
      // 每 8 小节末尾自然放下右手回转盘微调 1 小节再重新扬起，还原真人 DJ 交替控台与控场的鲜活感
      const cycleBar = (intoSec / barLen) % 8.0;
      const deckTouchDip = 1.0 - smooth(clamp01((cycleBar - 6.15) / 0.45)) * smooth(clamp01((7.75 - cycleBar) / 0.45));
      targetRaiseR = entryRamp * exitRamp * deckTouchDip;
    }

    // 左手（另一只手臂）：仅在高潮段每 8 小节的后半段（第 4.0~6.1 小节）平滑抬起加入双臂共鸣，其余时间稳控混音台
    let targetRaiseL = 0;
    if (isHigh) {
      const barsFloat = intoSec / barLen;
      const inCycle = barsFloat % 8.0;
      if (barsFloat >= 3.6 && inCycle >= 3.6 && inCycle <= 6.2) {
        const winInSec = (inCycle - 3.6) * barLen;
        const winOutSec = (6.2 - inCycle) * barLen;
        const secExitRamp = smooth(clamp01(remSec / 0.90));
        targetRaiseL = smooth(clamp01(winInSec / 0.80)) * smooth(clamp01(winOutSec / 0.88)) * secExitRamp * 0.92;
      }
    }

    const targetFocus = isBreak ? 1.0 : isBuild ? (1.0 - 0.55 * buildProgress) : (1.0 - 0.65 * dropPower);

    // 帧间速率限幅 + 临界阻尼平滑追踪（连续播放时保证任何抬落动作均经历 0.7~0.9s 自然加减速；拖动进度条时直接对齐连续包络）
    const dt = t - this.lastDjT;
    this.lastDjT = t;
    const smoothArm = (cur: number, target: number, rateUp: number, rateDown: number): number => {
      if (!(dt > 0 && dt < 0.28)) return target;
      const diff = target - cur;
      const maxDelta = (diff >= 0 ? rateUp : rateDown) * dt;
      const clampedTarget = cur + Math.max(-maxDelta, Math.min(maxDelta, diff));
      const alpha = 1.0 - Math.exp(-dt / 0.14);
      return lerp(cur, clampedTarget, alpha);
    };
    this.djArmRaiseR = smoothArm(this.djArmRaiseR, targetRaiseR, 1.45, 1.25);
    this.djArmRaiseL = smoothArm(this.djArmRaiseL, targetRaiseL, 1.38, 1.18);
    this.djSpineFocus = smoothArm(this.djSpineFocus, targetFocus, 1.80, 1.80);

    const rR = smooth(clamp01(this.djArmRaiseR));
    const rL = smooth(clamp01(this.djArmRaiseL));
    const consoleFocus = this.djSpineFocus;

    // 1. 膝胯弹性重拍下沉（Groove Bounce）与左右重心微移
    const beatDown = Math.pow(0.5 + 0.5 * Math.cos(beatRad), 1.8);
    const bounceAmp = (0.014 + 0.030 * dropPower + 0.016 * kickPunch);
    const swayX = Math.sin(barRad) * (0.055 + 0.045 * dropPower);
    dj.root.position.set(swayX, pedestalTopY - 0.14 - beatDown * bounceAmp, -49.88);

    // 2. 腰脊前倾俯身度与自然转肩
    const spinePitch = lerp(0.05, 0.17, consoleFocus) + beatDown * (0.026 + 0.036 * dropPower);
    const spineYaw = Math.sin(t * 0.55) * 0.13 - swayX * 0.85;
    const spineRoll = Math.sin(barRad) * 0.042 * (0.4 + 0.6 * dropPower);
    dj.spine.rotation.set(spinePitch, spineYaw, spineRoll);

    // 3. 头部节奏点头（带颈部次级惯性延迟）
    const nodWave = Math.sin(beatRad - 0.35);
    const headPitch = lerp(0.05, 0.21, consoleFocus) + (0.046 + 0.072 * dropPower + 0.040 * kickPunch) * (0.5 - 0.5 * nodWave);
    const headYaw = -spineYaw * 0.45 + 0.10 * Math.cos(t * 0.65 + 0.8);
    const headRoll = Math.cos(barRad + 0.6) * 0.048;
    dj.head.rotation.set(headPitch, headYaw, headRoll);

    // 4. 真实自然 DJ 现场身体律动（收敛双臂挥动幅度，屈肘自然随节拍轻推，告别大幅度直臂指挥家挥舞）
    const phraseMod = 0.94 + 0.06 * Math.sin(barRad * 0.5);
    const rawWaveR = 0.5 + 0.5 * Math.cos(beatRad - 0.55);
    const pumpR = clamp01(Math.pow(rawWaveR, 1.1) * 0.82 + 0.10 * kickPunch + 0.08 * snarePunch);

    const rawWaveL = 0.5 + 0.5 * Math.cos(beatRad - 0.75); // 左手细微异步差
    const pumpL = clamp01(Math.pow(rawWaveL, 1.1) * 0.80 + 0.10 * kickPunch + 0.08 * snarePunch);

    // 5. 左手（+X 侧，YZX 旋转顺序）：混音台调音推子 <-> 抬至胸前/肩部高度保持自然屈肘微幅律动
    const knobTwist = Math.sin(t * (isBuild ? 5.5 + 6.0 * buildProgress : 2.6)) * 0.09;
    const faderPush = Math.cos(beatRad * 0.5) * 0.07 + snarePunch * 0.06;
    const midArcL = 4.0 * rL * (1.0 - rL);

    const deckLx = -0.68 - faderPush;
    const deckLy = 0.14 + knobTwist * 0.5;
    const deckLz = -0.15;
    const deckElLx = -0.84 + faderPush * 0.75;
    const deckElLz = -0.16;

    // 屈肘前倾姿势：大臂自然前倾 -0.38 rad，外展保持在 72°~80° 舒适区，肘关节保持 52°~68° 弹性屈曲，绝不伸直成棍
    const hypeLx = lerp(-0.40, -0.34, pumpL);
    const hypeLy = lerp(-0.22, -0.16, pumpL);
    const hypeLz = lerp(1.26, 1.40 * phraseMod, pumpL);
    const hypeElLx = lerp(-0.20, -0.14, pumpL);
    const hypeElLz = lerp(1.16, 0.86, pumpL);

    dj.shoulderL.rotation.set(
      lerp(deckLx, hypeLx, rL) - 0.15 * midArcL,
      lerp(deckLy, hypeLy, rL),
      lerp(deckLz, hypeLz, rL),
    );
    dj.elbowL.rotation.set(
      lerp(deckElLx, hypeElLx, rL) - 0.22 * midArcL,
      lerp(-0.14, 0.06, rL),
      lerp(deckElLz, hypeElLz, rL),
    );
    dj.handL.rotation.set(lerp(0.32, 0.06 + 0.12 * pumpL, rL), knobTwist * (1.0 - rL), 0);

    // 6. 右手（-X 侧，YZX 旋转顺序）：CDJ 搓盘/控台 <-> 抬至胸前/肩部保持自然屈肘微幅律动
    const platterScrub = Math.sin(t * 3.4) * 0.08;
    const midArcR = 4.0 * rR * (1.0 - rR);

    const deckRx = -0.64 + platterScrub * 0.45;
    const deckRy = -0.06 + platterScrub;
    const deckRz = -0.22;
    const deckElRx = -0.84 - platterScrub * 0.35;
    const deckElRz = 0.16;

    // 屈肘前倾姿势：大臂自然前倾 -0.40 rad，外展保持在 -72°~-80°，肘关节弹性微动 (幅差仅约 17°)，律动克制帅气
    const hypeRx = lerp(-0.40, -0.34, pumpR);
    const hypeRy = lerp(0.22, 0.16, pumpR);
    const hypeRz = lerp(-1.26, -1.40 * phraseMod, pumpR);
    const hypeElRx = lerp(-0.20, -0.14, pumpR);
    const hypeElRz = lerp(-1.16, -0.86, pumpR);

    dj.shoulderR.rotation.set(
      lerp(deckRx, hypeRx, rR) - 0.15 * midArcR,
      lerp(deckRy, hypeRy, rR),
      lerp(deckRz, hypeRz, rR),
    );
    dj.elbowR.rotation.set(
      lerp(deckElRx, hypeElRx, rR) - 0.22 * midArcR,
      lerp(0.12, -0.06, rR),
      lerp(deckElRz, hypeElRz, rR),
    );
    dj.handR.rotation.set(lerp(0.30, 0.06 + 0.12 * pumpR, rR), 0, 0);
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, shotT, fx } = ctx;
    const sec = shot.section;
    const prevSec = music.a.sections[shot.sectionIndex - 1];
    const nextSec = music.a.sections[shot.sectionIndex + 1];
    const beatInfo = music.at(t);
    const beatDur = 60 / Math.max(40, beatInfo.bpm);

    // 1. 解析当前段落能量与控台主状态（Drop / Chorus 全功率炸场，Build 蓄能收束，Break 静谧液态天幕）
    const isDrop = sec.label === 'drop';
    const isChorus = sec.label === 'chorus';
    const isBuild = sec.label === 'build' || sec.label === 'pre';
    const isBreak = sec.label === 'break' || sec.label === 'bridge' || sec.label === 'intro' || sec.label === 'outro';

    const buildProgress = isBuild ? clamp01((t - sec.start) / Math.max(1.0, sec.end - sec.start)) : 0;
    const dropPower = isDrop ? 1.0 : isChorus ? 0.84 : isBuild ? 0.25 + 0.55 * buildProgress : isBreak ? 0.18 : 0.46;

    // Drop 入拍前最后 90ms 瞬时收暗蓄力（Pre-Drop Blackout Choke），入拍首帧轰然全开！
    let blackout = 0;
    if (isBuild && nextSec && nextSec.label === 'drop') {
      const rem = sec.end - t;
      if (rem >= 0 && rem < 0.14) {
        blackout = smooth(1.0 - Math.abs(rem - 0.055) / 0.085);
      }
    }

    // 2. 提取音频脉冲与 12 半音色度包络
    const kickPunch = clamp01(music.pulse('kick', t, 0.13) * 1.12);
    const snarePunch = clamp01(music.pulse('snare', t, 0.11));
    const hatSparkle = clamp01(music.pulse('hat', t, 0.07));
    const fg = music.foregroundAt(t);
    const leadMotion = music.foregroundMotion(t, 0.20);

    const env = music.a.env;
    const chromaTotalFrames = env.chroma ? Math.floor(env.chroma.length / 12) : 0;
    const cIdx = chromaTotalFrames > 0
      ? Math.min(chromaTotalFrames - 1, Math.max(0, Math.round((t / Math.max(0.1, music.duration)) * (chromaTotalFrames - 1))))
      : 0;
    const readChroma = (c: number): number => {
      if (!env.chroma || chromaTotalFrames < 1) return 0.35;
      return clamp01((env.chroma[cIdx * 12 + c] ?? 0) * 1.15);
    };

    // 3. 灯光师控台 Cue 阵型与双色彩编排模式（纯函数确定性决策）
    // - 模式 A (SPATIAL_GRADIENT)：同屏同时呈现丰富的封面提取色，按三维空间位置平滑映射，相邻激光颜色严格相近，形成丝滑渐变光场；
    // - 模式 B (UNISON_SWITCH)：全屏所有激光、光幕、灯塔、气柱锁定同一封面提取色 1，并在下一重音/军鼓 0ms 瞬切至另一封面提取色 2。
    const barsIntoSec = Math.max(0, Math.floor((t - sec.start) / Math.max(0.5, beatDur * music.meter)));
    const cueMode = isDrop || isChorus
      ? (shot.variant === 'tunnel' ? 1 : Math.floor(barsIntoSec / 2) % 4)
      : -1;

    const isUnisonMode = isBreak
      ? false
      : isBuild
        ? buildProgress >= 0.55
        : (Math.floor(barsIntoSec / 4) % 2 === 1);

    // 解析当前色彩映射参数并同步主副环境光向量
    const u = this.uniforms;
    let activeUnisonSlot = this.pal.unisonSlots[0] ?? 0;
    let palBase = 0.0;
    let palSpan = 5.0;
    let sheetSpread = 0.36;

    if (isUnisonMode) {
      const uRing = this.pal.unisonSlots.length > 0 ? this.pal.unisonSlots : [0, 5];
      if (isBuild && buildProgress >= 0.78) {
        // Build 冲刺末段随半拍加密整屏跳切
        const fastStep = Math.max(0, Math.floor(beatInfo.pos * 2));
        activeUnisonSlot = uRing[fastStep % uRing.length];
      } else {
        const cutIdx = lastIndex(this.unisonCutTimes, t);
        activeUnisonSlot = cutIdx >= 0 ? this.unisonCuts[cutIdx].slot : uRing[0];
      }
      palBase = activeUnisonSlot;
      palSpan = 0.0;
      sheetSpread = 0.0;

      const uCol = this.pal.laserPalette[activeUnisonSlot];
      const uCore = this.pal.laserCores[activeUnisonSlot];
      (u.uLaserPrimary.value as THREE.Vector3).copy(uCol);
      (u.uLaserSecondary.value as THREE.Vector3).copy(uCol);
      (u.uLaserPrimaryCore.value as THREE.Vector3).copy(uCore);
      (u.uLaserSecondaryCore.value as THREE.Vector3).copy(uCore);
      (u.uBlinderWarm.value as THREE.Vector3).copy(uCol);
    } else {
      // 模式 A：8 小节乐句组间顺滑翻转左右渐变极性（左->右 vs 右->左），全场所有着色器与激光空间坐标 100% 同相连续渐变
      const reverseGrad = (Math.floor(barsIntoSec / 8) % 2) === 1;
      palBase = reverseGrad ? 5.0 : 0.0;
      palSpan = reverseGrad ? -5.0 : 5.0;
      sheetSpread = reverseGrad ? -0.34 : 0.34;

      const leftIdx = reverseGrad ? 5 : 0;
      const rightIdx = reverseGrad ? 0 : 5;
      (u.uLaserPrimary.value as THREE.Vector3).copy(this.pal.laserPalette[leftIdx]);
      (u.uLaserSecondary.value as THREE.Vector3).copy(this.pal.laserPalette[rightIdx]);
      (u.uLaserPrimaryCore.value as THREE.Vector3).copy(this.pal.laserCores[leftIdx]);
      (u.uLaserSecondaryCore.value as THREE.Vector3).copy(this.pal.laserCores[rightIdx]);
      (u.uBlinderWarm.value as THREE.Vector3).copy(this.pal.blinderWarm);
    }
    u.uPalBase.value = palBase;
    u.uPalSpan.value = palSpan;
    u.uSheetSpread.value = sheetSpread;

    // 连续三维空间渐变场函数：将任意发射点 (x, z) 平滑映射到 [0..5] 封面渐变路径，保证位置相近的激光颜色严格相近
    const evalSpatialColorSlot = (x: number, z: number): number => {
      if (isUnisonMode) return activeUnisonSlot;
      const nx = (x * 0.88 + 14.6) / 29.2;
      const nz = ((z + 52.4) / 53.0 - 0.5) * 0.12;
      const norm01 = clamp01(nx + nz);
      return clampRange(palBase + norm01 * palSpan, 0.0, 5.0);
    };

    // 4. 更新相机位姿（含军鼓+底鼓全场景同步声压震动）与写实三维骨骼 DJ 舞台表演姿态
    this.poseCamera(t, shot, shotT, kickPunch, snarePunch, dropPower);
    this.updateDjPerformance(
      t,
      beatInfo.pos,
      beatInfo.inBar,
      beatDur,
      music.meter,
      sec,
      prevSec,
      nextSec,
      isBreak,
      isBuild,
      buildProgress,
      dropPower,
      kickPunch,
      snarePunch,
      fg.level,
    );

    // 5. 更新 28 组四眼观众盲眼灯（封面同源热惯性余晖 + 重拍短促爆闪点缀）
    const blinderArr = this.blinderStateAttr.array as Float32Array;
    const barDownAge = (beatInfo.inBar * beatDur);
    const downbeatFlash = Math.exp(-barDownAge / 0.14);
    const kickFilament = Math.max(kickPunch * 0.62, downbeatFlash * (isDrop ? 0.96 : 0.55));

    let totalBlinderEnergy = 0;
    for (let i = 0; i < BLINDER_COUNT; i++) {
      const c = this.blinderCoords[i];
      const chaseWave = Math.pow(0.5 + 0.5 * Math.cos(beatInfo.pos * Math.PI - c.portalIdx * 0.95), 2.0);
      let power = kickFilament * (0.25 + 0.75 * chaseWave) * (0.22 + 0.78 * dropPower);
      if (isBuild && buildProgress > 0.65) {
        const buildStrobe = Math.pow(0.5 + 0.5 * Math.cos(t * (22.0 + 28.0 * buildProgress) + i * 1.7), 3.0);
        power = Math.max(power, buildStrobe * buildProgress * 0.82);
      }
      power = Math.min(1.15, power);
      const cool = clamp01(1.0 - power * 0.92);
      totalBlinderEnergy += power;

      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * BLINDER_COUNT + i) * 4;
        blinderArr[slot] = power;
        blinderArr[slot + 1] = cool;
      }
    }
    this.blinderStateAttr.needsUpdate = true;
    const avgBlinderGlow = clamp01((totalBlinderEnergy / BLINDER_COUNT) * 0.95);

    // 6. 更新 14 座振镜扫描体积光膜（Liquid Sky & Volumetric Fan Sheets — 模式 A 空间连续渐变 / 模式 B 全屏同色瞬切）
    const sAngles = this.sheetAnglesAttr.array as Float32Array;
    const sStyle = this.sheetStyleAttr.array as Float32Array;
    const sweepClock = t * 0.85 + leadMotion * 0.24;

    for (let i = 0; i < SHEET_EMITTER_COUNT; i++) {
      const sp = this.sheetSpecs[i];
      let yaw = sp.baseYaw;
      let pitch = sp.basePitch;
      let roll = 0;
      let spread = 0.44;
      let power = 0;
      const colorMix = evalSpatialColorSlot(sp.x, sp.z);
      let waveAmp = 0.45 + 0.45 * fg.level;

      if (sp.bank === 0) {
        // 舞台正前 6 台主 Liquid Sky 发射台（由左至右按空间位置自然过渡封面色彩）
        const symSign = sp.x < 0 ? -1 : 1;
        const pairIdx = Math.min(2, Math.floor(Math.abs(i - 2.5)));

        if (isBreak) {
          // 间奏空灵段：仅开启内侧 4 台慢速丝绸液态天幕，安静呼吸
          const activeBreak = pairIdx <= 1 ? 1.0 : 0.25;
          yaw = sp.baseYaw + Math.sin(t * 0.35 + i) * 0.12;
          pitch = -0.15 + Math.sin(t * 0.48 + pairIdx * 0.8) * 0.055;
          roll = symSign * Math.sin(t * 0.32) * 0.10;
          spread = 0.52;
          power = activeBreak * (0.48 + 0.25 * fg.level);
          waveAmp = 0.72;
        } else if (isBuild) {
          // 铺垫蓄能段：扇面逐渐收窄并压低向舞台前缘聚拢，让出巨幕中心视野
          yaw = lerp(sp.baseYaw, -sp.x * 0.022, buildProgress);
          pitch = lerp(-0.24, -0.14, buildProgress) + Math.sin(t * (3.0 + 8.0 * buildProgress) + i) * 0.03;
          roll = symSign * (1.0 - buildProgress) * 0.22;
          spread = lerp(0.44, 0.18, buildProgress);
          power = 0.36 + 0.48 * buildProgress;
          waveAmp = 0.35 * (1.0 - buildProgress);
        } else {
          // Drop / Chorus / Verse 主秀：随控台 Cue 阵型切换几何角度，色彩严格服从空间渐变或全屏瞬切
          const leadSweep = Math.sin(sweepClock * 1.35 + pairIdx * 0.65);
          if (cueMode === 1) {
            // CONE_VORTEX 期间：退让中央主视野给空心旋转激光锥笼，仅保留外侧贴地薄光幕烘托
            yaw = sp.baseYaw + symSign * 0.16;
            pitch = pairIdx === 0 ? -0.26 + 0.02 * leadSweep : -0.18 + 0.04 * leadSweep;
            roll = symSign * (0.42 + 0.16 * Math.sin(sweepClock));
            spread = pairIdx === 0 ? 0.36 : 0.30;
            power = (pairIdx === 0 ? 0.18 : 0.34) * dropPower + 0.12 * kickPunch;
          } else if (cueMode === 2) {
            // CATHEDRAL_CROWN：交错大倾角斜切搭建哥特式激光穹顶
            yaw = sp.baseYaw - symSign * 0.16;
            pitch = -0.14 + 0.06 * Math.cos(beatInfo.pos * 0.5 * Math.PI + i);
            roll = symSign * 0.52 * (i % 2 === 0 ? 1 : -0.65);
            spread = 0.48;
            power = (0.88 + 0.24 * kickPunch) * dropPower;
          } else {
            // LIQUID_HORIZON & CHOPPER：经典超宽水平波浪天幕压低掠过镜头头顶
            yaw = sp.baseYaw + Math.sin(sweepClock * 0.8 + i * 0.7) * 0.14;
            pitch = -0.175 + 0.065 * Math.sin(sweepClock * 1.45 + pairIdx * 0.55) - 0.025 * kickPunch;
            roll = symSign * Math.sin(sweepClock * 0.95 + pairIdx) * (cueMode === 3 ? 0.28 : 0.14);
            spread = 0.56 + 0.08 * fg.level;
            power = (0.94 + 0.24 * kickPunch + 0.16 * fg.attack) * dropPower;
            waveAmp = 0.65 + 0.45 * fg.level;
          }
        }
      } else {
        // 左右两侧高空深暗边界 8 台内倾激光光幕（bank 1 & 2）
        const sideSign = sp.bank === 1 ? 1 : -1;
        if (isBreak) {
          power = 0.0;
        } else if (isBuild) {
          yaw = sideSign * 0.72;
          pitch = lerp(-0.38, -0.16, buildProgress);
          roll = sideSign * 0.25;
          spread = 0.26;
          power = Math.max(0, (buildProgress - 0.42) * 0.65);
        } else {
          const bayWave = 0.5 + 0.5 * Math.sin(beatInfo.pos * Math.PI * 0.5 - sp.idx * 0.9);
          const baseSideYaw = isUnisonMode ? sp.baseYaw : sideSign * 0.34;
          yaw = baseSideYaw + sideSign * Math.sin(sweepClock + sp.idx) * 0.12;
          pitch = -0.26 + 0.08 * Math.cos(sweepClock * 1.2 + sp.idx * 0.8);
          roll = sideSign * (cueMode === 2 ? 0.42 : 0.20);
          spread = cueMode === 2 ? 0.36 : 0.28;
          power = (cueMode === 1 ? 0.28 : 0.58) * dropPower * (0.40 + 0.60 * bayWave);
        }
      }

      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * SHEET_EMITTER_COUNT + i) * 4;
        sAngles[slot] = yaw;
        sAngles[slot + 1] = pitch;
        sAngles[slot + 2] = roll;
        sAngles[slot + 3] = spread;

        sStyle[slot] = sp.length;
        sStyle[slot + 1] = power;
        sStyle[slot + 2] = colorMix;
        sStyle[slot + 3] = waveAmp;
      }
    }
    this.sheetAnglesAttr.needsUpdate = true;
    this.sheetStyleAttr.needsUpdate = true;

    // 7. 更新 36 束军鼓/重音单束快切激光（模式 A 空间相邻颜色严格平滑渐变 / 模式 B 全屏统一纯色瞬切）
    const bEnd = this.beamEndAttr.array as Float32Array;
    const bStyle = this.beamStyleAttr.array as Float32Array;

    // 查找最近一次快切重音脉冲
    let latestHit: ChopperHitEvent | null = null;
    let hitAge = 99;
    const hitIdx = lastIndex(this.chopperTimes, t);
    if (hitIdx >= 0) {
      latestHit = this.choppers[hitIdx];
      hitAge = t - latestHit.t;
    }
    const hitEnv = latestHit && hitAge >= 0 && hitAge < 0.42
      ? latestHit.amp * Math.exp(-hitAge / (isDrop ? 0.145 : 0.19))
      : 0;
    const activePattern = latestHit ? latestHit.pattern : (barsIntoSec % 4);
    const activeParity = latestHit ? latestHit.parity : 1;
    const pulseTravel = clamp01(hitAge / 0.22);

    for (let i = 0; i < BEAM_EMITTER_COUNT; i++) {
      const b = this.beamSpecs[i];
      let tx = 0, ty = 1.5, tz = 10.0;
      let beamPower = 0;

      if (isBreak) {
        // 间奏段仅保留舞台前缘柔和静态定格皇冠星束
        if (b.group === 1 && (b.slot === 0 || b.slot === 5 || b.slot === 6 || b.slot === 11)) {
          tx = b.x * 1.45;
          ty = 16.5;
          tz = -18.0;
          beamPower = 0.24 + 0.15 * hatSparkle;
        }
      } else if (isBuild) {
        // Build 蓄能：36 束激光随十六分音符依次快闪并向 DJ 控台上空聚拢，不遮挡巨幕主封面
        const step16 = Math.floor(beatInfo.pos * 4) % 12;
        const matchSlot = (i % 12) === step16 ? 1.0 : 0.18;
        tx = lerp(b.x * 0.85, 0.0, buildProgress);
        ty = lerp(1.2, 4.4, buildProgress);
        tz = lerp(-5.0, -32.0, buildProgress);
        beamPower = (0.22 + 0.88 * buildProgress) * matchSlot;
      } else {
        // Drop / Chorus / Verse：模式 A 采用同侧顺向扇形展开（杜绝跨屏异色交叉打架），模式 B 全屏同色启用大交叉对切张力
        const pat = cueMode === 3 ? 0 : activePattern;
        const noteVal = readChroma(i % 12);

        if (b.group === 0) {
          // 舞台顶梁 12 束高能主排
          if (pat === 0) {
            const isLeft = b.normX < 0;
            const inactiveDim = isUnisonMode ? 0.30 : 0.68;
            const bankActive = (activeParity > 0 ? isLeft : !isLeft) ? 1.0 : inactiveDim;
            tx = (isUnisonMode ? -b.normX * 19.5 : b.normX * 19.5) + Math.sin(t * 2.4 + b.slot) * 1.6;
            ty = 0.15;
            tz = -6.0 + Math.abs(b.normX) * 16.0;
            beamPower = (hitEnv * 1.15 + 0.28 * dropPower) * bankActive;
          } else if (pat === 1) {
            // Center-Out Wave（中心向外 12 束连续空间渐变扇形排射）
            const distCenter = Math.abs(b.normX);
            const wavePhase = clamp01(1.0 - Math.abs(distCenter - ((beatInfo.pos * 0.85) % 1.0)) * 2.4);
            tx = b.normX * 24.0;
            ty = 1.2 + 4.5 * noteVal;
            tz = 12.0;
            beamPower = (0.40 + 0.82 * wavePhase + 0.42 * hitEnv) * dropPower;
          } else if (pat === 2) {
            // Guillotine（平行垂直铡刀齐劈地面，清晰展现从左至右丝滑色彩渐变或全屏单色齐劈）
            tx = b.x * 1.08;
            ty = 0.05;
            tz = -12.0 + Math.sin(beatInfo.pos * Math.PI * 0.5 + Math.abs(b.normX) * 2.0) * 14.0;
            beamPower = (0.36 + 0.92 * hitEnv + 0.34 * kickPunch) * dropPower;
          } else {
            // Strobe Matrix（对称高密点射）
            const pairOn = ((b.slot + Math.floor(beatInfo.pos * 4)) % 3 === 0) ? 1.0 : (isUnisonMode ? 0.24 : 0.52);
            tx = isUnisonMode ? -b.normX * 12.0 : b.normX * 16.5;
            ty = 2.8 + (b.slot % 3) * 2.6;
            tz = 14.0;
            beamPower = (0.38 + 0.86 * hitEnv) * pairOn * dropPower;
          }
        } else if (b.group === 1) {
          // 舞台前缘低位仰射 12 束（与正上方顶梁共享横向空间色温，彻底告别上下乱撞杂色）
          const symActive = ((b.slot + (activeParity > 0 ? 0 : 1)) % 2 === 0) ? 1.0 : (isUnisonMode ? 0.34 : 0.64);
          tx = b.normX * (isUnisonMode && cueMode === 2 ? -18.5 : 21.0);
          ty = 13.5 + 4.2 * noteVal;
          tz = 8.0;
          beamPower = (0.30 + 0.82 * hitEnv + 0.28 * snarePunch) * symActive * dropPower;
        } else {
          // 左右高空侧翼 12 束斜切激光刃（模式 A 落在同侧半场顺滑衔接，模式 B 横贯全屏）
          const sideSign = b.group === 2 ? -1 : 1;
          const bankHit = (activeParity * sideSign > 0) ? 1.0 : (isUnisonMode ? 0.36 : 0.65);
          tx = isUnisonMode ? -sideSign * 15.5 : sideSign * 4.2;
          ty = 0.25 + (b.slot % 2) * 2.4;
          tz = b.z + 16.5;
          beamPower = (0.28 + 0.88 * hitEnv) * bankHit * (cueMode === 1 ? 0.55 : 1.0) * dropPower;
        }
      }

      // 按光束三维可见空间位置（兼顾起点与落点横向坐标）平滑采样渐变色板；模式 B 下恒等于 activeUnisonSlot
      const beamSpatialX = b.x * 0.72 + tx * 0.28;
      const colorMix = evalSpatialColorSlot(beamSpatialX, b.z);

      beamPower = Math.min(1.38, beamPower);
      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * BEAM_EMITTER_COUNT + i) * 4;
        bEnd[slot] = tx;
        bEnd[slot + 1] = ty;
        bEnd[slot + 2] = tz;
        bEnd[slot + 3] = b.group === 0 ? 0.195 : 0.160;

        bStyle[slot] = beamPower;
        bStyle[slot + 1] = colorMix;
        bStyle[slot + 2] = pulseTravel;
      }
    }
    this.beamEndAttr.needsUpdate = true;
    this.beamStyleAttr.needsUpdate = true;

    // 8. 更新双层反向旋转空心断线激光锥笼（Laser Cone Tunnel）
    const cSpec = this.coneSpecAttr.array as Float32Array;
    let outerConePower = 0;
    let innerConePower = 0;
    if (isDrop || isChorus) {
      if (cueMode === 1) {
        // CONE_VORTEX 主场：内外双锥满功率反向高速旋转包裹镜头！
        outerConePower = (1.05 + 0.25 * kickPunch) * dropPower;
        innerConePower = (0.88 + 0.22 * fg.level) * dropPower;
      } else if (cueMode === 2) {
        // CATHEDRAL_CROWN：保留一层柔和中心内锥作为中轴圣光柱骨架
        outerConePower = 0.28 * dropPower;
        innerConePower = 0.55 * dropPower;
      }
    } else if (isBuild && buildProgress > 0.45) {
      // Build 后半程内锥逐渐显现蓄势旋转
      innerConePower = (buildProgress - 0.45) * 1.15;
    }

    for (let mirror = 0; mirror < 2; mirror++) {
      const slot0 = (mirror * CONE_LAYER_COUNT + 0) * 4;
      const slot1 = (mirror * CONE_LAYER_COUNT + 1) * 4;
      cSpec[slot0] = 1.02 + 0.08 * kickPunch;
      cSpec[slot0 + 2] = outerConePower;
      cSpec[slot1] = 0.54 + 0.06 * fg.level;
      cSpec[slot1 + 2] = innerConePower;
    }
    this.coneSpecAttr.needsUpdate = true;

    // 9. 更新舞台前缘 8 座 CO2 低温白雾喷射气柱（Cryo Jets）
    const cryoArr = this.cryoStateAttr.array as Float32Array;
    let activeCryo: CryoBlastEvent | null = null;
    let cryoAge = 99;
    const cryoIdx = lastIndex(this.cryoTimes, t);
    if (cryoIdx >= 0) {
      const evCryo = this.cryos[cryoIdx];
      const age = t - evCryo.t;
      if (age >= 0 && age <= evCryo.dur) {
        activeCryo = evCryo;
        cryoAge = age;
      }
    }

    for (let i = 0; i < CRYO_JET_COUNT; i++) {
      let normAge = 0;
      let jetStrength = 0;
      if (activeCryo) {
        const distCenter = Math.abs(i - 3.5); // 0.5, 1.5, 2.5, 3.5
        // mode 2 为中心向外极速排射（延迟 0..0.14s）
        const stagger = activeCryo.mode === 2 ? (distCenter - 0.5) * 0.045 : 0;
        const localAge = cryoAge - stagger;
        const activeMask = activeCryo.mode === 1 ? (distCenter < 2.0 ? 1.0 : 0.0) : 1.0;
        if (localAge >= 0 && localAge <= activeCryo.dur && activeMask > 0) {
          normAge = clamp01(localAge / activeCryo.dur);
          jetStrength = activeCryo.strength * activeMask;
        }
      }

      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * CRYO_JET_COUNT + i) * 4;
        cryoArr[slot] = normAge;
        cryoArr[slot + 1] = jetStrength;
      }
    }
    this.cryoStateAttr.needsUpdate = true;

    // 10. 同步全局着色器 Uniforms
    u.uTime.value = t;
    u.uBeatPos.value = beatInfo.pos;
    u.uSectionEnergy.value = clamp01(sec.energy);
    u.uDropPower.value = dropPower;
    u.uKickPunch.value = kickPunch;
    u.uSnarePunch.value = snarePunch;
    u.uBlinderGlow.value = avgBlinderGlow;
    u.uBlackout.value = blackout;
    u.uConeSpin.value = t * 1.15 + leadMotion * 0.32;
    u.uConePitch.value = -0.21 + Math.sin(t * 0.45) * 0.018;
    (u.uChroma0.value as THREE.Vector4).set(readChroma(0), readChroma(1), readChroma(2), readChroma(3));
    (u.uChroma1.value as THREE.Vector4).set(readChroma(4), readChroma(5), readChroma(6), readChroma(7));
    (u.uChroma2.value as THREE.Vector4).set(readChroma(8), readChroma(9), readChroma(10), readChroma(11));

    // 11. 后期效果调优：全画幅 16:9 展现无界深邃暗场与地面镜像，微幅低频缩放呼吸杜绝地震感，克制泛光防过曝
    fx.letterbox = 0;
    fx.invert = 0;
    fx.duotone = 0;
    fx.glitch = Math.min(fx.glitch, 0.06);
    fx.zoom = Math.min(fx.zoom, 0.012 + 0.014 * kickPunch * dropPower);
    fx.bloom = (this.soft ? 0.20 : 0.22) + 0.05 * dropPower + 0.02 * avgBlinderGlow;
    fx.vignette = 0.44;
    fx.grain = 0.035;

    // 12. 更新底部双语歌词排版
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, sec.energy * 0.8);
  }
}
