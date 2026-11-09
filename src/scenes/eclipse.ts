// 日蚀裂谷 (Eclipse): 摇滚/金属/暗黑电音专属 3D 火山玄武岩与黑曜石大裂谷世界。
// 适配曲风：摇滚 (Rock), 后摇 (Post-Rock), 金属 (Metal), 暗黑 Trap / Dubstep。
// 100% 确定性纯时间函数 f(t) 驱动，零累积状态，支持任意 seek 与离线 MP4 导出。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex } from '../director/music.ts';
import { colorFromHsl, extractCoverTone, tuneCoverStop } from './coverTone.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';

const NUM_FLOATING_ROCKS = 24;
const CAM_FOV = 50;
const NUM_BOLT_ARCHETYPES = 18;
const MAX_ACTIVE_BOLTS = 4;
const MAX_LIGHTNING_SEGMENTS = 1280;
const MAX_LIGHTNING_FLARES = 12;

interface RockInitState {
  side: -1 | 1;
  laneX: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  maxRadius: number;
  rotSpeed: number;
  phase: number;
}

/**
 * 精确计算给定纵深 z、高度 y 与左右侧 side 处，大裂谷连续断崖网格与凸出玄武岩柱向中央航道探出的最内侧安全距离（相对蜿蜒中心 meander）：
 * 1) 对当前 z 前后 ±2.2m（覆盖巨石自身 Z 向半径）以及高度 u 上下邻域采样 createSculptedChasmSideGeometry 同源公式，取最小值；
 * 2) 同时扣除 20 座交错凸出柱状玄武岩柱（buttress 内缘最深探至 7.8m）的包络；
 * 确保悬浮巨石外缘与摄像机轨迹始终保持在真实岩壁与岩柱净空之内，100% 杜绝石头嵌入岩壁或摄像机穿入岩体。
 */
function evalSingleWallAbsX(z: number, u: number, side: -1 | 1, phi1: number, phi2: number, phi3: number): number {
  const halfGorge = 9.4 + 2.2 * Math.cos(z * 0.052 + phi1) + 1.1 * Math.sin(z * 0.125 + phi2);
  const gully = Math.pow(0.5 + 0.5 * Math.cos(z * 0.17 + u * 2.2 + phi2), 2.6);
  const terraceWave =
    0.95 * triWave(u * 19.5 + z * 0.08 + phi1) +
    0.55 * triWave(u * 37.0 - z * 0.14 + phi3);
  const cragJut = 1.65 * triWave(z * 0.22 + u * 5.4 + phi2) + 0.85 * Math.sin(z * 0.43 - u * 8.1 + phi1);

  let absX: number;
  if (u <= 0.18) {
    const k = u / 0.18;
    const shoreJagged = 1.35 * triWave(z * 0.28 + phi3) + 0.75 * Math.sin(z * 0.62 + phi1);
    absX = lerp(halfGorge - 1.6, halfGorge + 2.1, k) + shoreJagged * (1.0 - 0.35 * k);
  } else {
    const k = clamp01((u - 0.18) / 0.56);
    const overhang = Math.sin(k * Math.PI * 2.5 + phi1) * 1.45 - gully * 2.3;
    absX =
      lerp(halfGorge + 2.1, halfGorge + 10.6, Math.pow(k, 0.88)) +
      overhang +
      cragJut * 0.85 +
      terraceWave * 0.65;
  }
  const m = chasmMeanderX(z);
  const worldX = side * absX + m * (1.0 - 0.45 * u);
  return side * (worldX - m);
}

function evalExactCanyonWallInnerAbsX(z: number, y: number, side: -1 | 1, wallSeed: number): number {
  const phi1 = (wallSeed % 101) * 0.0622 + (side > 0 ? 1.37 : 0.0);
  const phi2 = ((wallSeed >> 4) % 97) * 0.0647 + (side > 0 ? 2.81 : 0.0);
  const phi3 = ((wallSeed >> 8) % 89) * 0.0705 + (side > 0 ? 0.93 : 0.0);

  const rimPeakHeight =
    31.5 +
    5.8 * triWave(z * 0.068 + phi1) +
    3.6 * triWave(z * 0.155 + phi2) +
    2.1 * Math.sin(z * 0.31 + phi3);

  const kCenter = clamp01((y + 2.1) / Math.max(10.0, rimPeakHeight + 2.1));
  const uCenter = 0.18 + kCenter * 0.56;

  // 在巨石三维球体所覆盖的 (z ± 1.8m, u ± 0.06) 邻域内取岩壁最内突点
  let minWall = 99.0;
  for (let dz = -1.8; dz <= 1.8; dz += 1.8) {
    for (let du = -0.06; du <= 0.06; du += 0.06) {
      const uSample = Math.max(0.10, Math.min(0.74, uCenter + du));
      const d = evalSingleWallAbsX(z + dz, uSample, side, phi1, phi2, phi3);
      if (d < minWall) minWall = d;
    }
  }
  // 同时受限于凸出柱状玄武岩柱（buttress 内缘约 8.2m）
  return Math.max(4.5, Math.min(minWall, 8.2));
}

/** 局部归一化坐标系下的单段分形闪电微元（起点 (0,0,0) -> 终点 (0,0,1)） */
interface BoltSegmentLocal {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  w0: number;
  w1: number;
  u0: number;
  u1: number;
  tier: number; // 1.0=主干, 0.54=一级分枝, 0.25=二级毛细电弧
  phase: number;
}

interface BoltArchetype {
  segments: BoltSegmentLocal[];
  /** 主干中段局部偏移，用于更贴合弯曲电弧的近场 3D 岩壁照明 */
  midX: number;
  midY: number;
}

/** 预烘焙的确定性峡谷雷击事件 */
interface LightningStrikeEvent {
  t0: number;
  amp: number;
  archetype: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  twist: number;
  spread: number;
  trunkRadius: number;
  leadDur: number;
  restrikeCount: number;
  restrike1Delay: number;
  restrike2Delay: number;
  hasCloudSheet: boolean;
  hasGroundImpact: boolean;
}

interface ActiveStrikeEval {
  ev: LightningStrikeEvent;
  leaderFront: number;
  trunkCore: number;
  trunkHalo: number;
  branchKeep: number;
  beadedFade: number;
  channelDrift: number;
  cloudGlow: number;
  impactGlow: number;
  lightPower: number;
}

/** 计算给定纵深 z 处大裂谷蜿蜒河道中轴线 X 坐标 */
function chasmMeanderX(z: number): number {
  return 2.35 * Math.sin(z * 0.041 + 0.7) + 1.15 * Math.cos(z * 0.089 + 2.1);
}

/**
 * 三维中点位移分形细分（Midpoint Displacement Breakdown）：
 * 在起点 A 与终点 B 之间生成具有真实大气电介质击穿急拐折角（Sharp Kinks）与多尺度锯齿的 3D 折线点列。
 */
function subdivideBoltChain(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  levels: number,
  roughness: number,
  rand: () => number,
): Float32Array {
  const count = (1 << levels) + 1;
  const pts = new Float32Array(count * 3);
  pts[0] = ax;
  pts[1] = ay;
  pts[2] = az;
  const last = (count - 1) * 3;
  pts[last] = bx;
  pts[last + 1] = by;
  pts[last + 2] = bz;

  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const totalLen = Math.hypot(dx, dy, dz) || 1e-4;

  let step = 1 << levels;
  let scale = totalLen * roughness;

  for (let lv = 0; lv < levels; lv++) {
    const half = step >> 1;
    for (let i = 0; i < count - 1; i += step) {
      const i0 = i * 3;
      const i1 = (i + step) * 3;
      const im = (i + half) * 3;

      const sx = pts[i1] - pts[i0];
      const sy = pts[i1 + 1] - pts[i0 + 1];
      const sz = pts[i1 + 2] - pts[i0 + 2];
      const segLen = Math.hypot(sx, sy, sz) || 1e-5;
      const tx = sx / segLen;
      const ty = sy / segLen;
      const tz = sz / segLen;

      // 构造与当前子段正交的局部基 (ux, uy, uz) 与 (vx, vy, vz)
      let rx = 0;
      let ry = 1;
      let rz = 0;
      if (Math.abs(ty) > 0.88) {
        rx = 1;
        ry = 0;
      }
      let ux = ty * rz - tz * ry;
      let uy = tz * rx - tx * rz;
      let uz = tx * ry - ty * rx;
      const uLen = Math.hypot(ux, uy, uz) || 1e-5;
      ux /= uLen;
      uy /= uLen;
      uz /= uLen;
      const vx = ty * uz - tz * uy;
      const vy = tz * ux - tx * uz;
      const vz = tx * uy - ty * ux;

      // 模拟阶梯先导遇到局部气团不均匀时的急折拐点，并对大尺度层级施加最小横向偏折保底以杜绝笔直段
      const kinkBoost = lv <= 3 && rand() < 0.38 ? 1.56 : 0.96;
      let raw1 = rand() + rand() - 1.0;
      if (lv <= 2 && Math.abs(raw1) < 0.24) {
        raw1 = (raw1 >= 0 ? 1 : -1) * (0.28 + rand() * 0.32);
      }
      const n1 = raw1 * scale * kinkBoost;
      const n2 = (rand() + rand() - 1.0) * scale * kinkBoost * 0.68;
      const alongJitter = (rand() - 0.5) * scale * 0.20;

      pts[im] = 0.5 * (pts[i0] + pts[i1]) + ux * n1 + vx * n2 + tx * alongJitter;
      pts[im + 1] = 0.5 * (pts[i0 + 1] + pts[i1 + 1]) + uy * n1 + vy * n2 + ty * alongJitter;
      pts[im + 2] = 0.5 * (pts[i0 + 2] + pts[i1 + 2]) + uz * n1 + vz * n2 + tz * alongJitter;
    }
    step = half;
    scale *= 0.56;
  }
  return pts;
}

/**
 * 构建包含 6 级分形高精锯齿主干、一级阶梯先导分枝与二级毛细电弧细丝的 3D 闪电树原型
 */
function buildBoltArchetype(rand: () => number): BoltArchetype {
  const segments: BoltSegmentLocal[] = [];

  // 1) 主干：6 级细分 = 64 段凌厉多尺度锯齿通道
  const trunkLevels = 6;
  const trunkSegs = 1 << trunkLevels;
  const trunkPts = subdivideBoltChain(0, 0, 0, 0, 0, 1, trunkLevels, 0.175 + rand() * 0.048, rand);

  for (let i = 0; i < trunkSegs; i++) {
    const o0 = i * 3;
    const o1 = (i + 1) * 3;
    const u0 = i / trunkSegs;
    const u1 = (i + 1) / trunkSegs;
    segments.push({
      ax: trunkPts[o0],
      ay: trunkPts[o0 + 1],
      az: trunkPts[o0 + 2],
      bx: trunkPts[o1],
      by: trunkPts[o1 + 1],
      bz: trunkPts[o1 + 2],
      w0: 1.0 - 0.22 * u0,
      w1: 1.0 - 0.22 * u1,
      u0,
      u1,
      tier: 1.0,
      phase: rand(),
    });
  }

  const midIdx = (trunkSegs >> 1) * 3;
  const midX = trunkPts[midIdx];
  const midY = trunkPts[midIdx + 1];

  // 2) 筛选主干外凸急折拐点生长 6~9 条一级分叉先导（锐角向下向外斜伸，绝不逆向倒长）
  const numPrimary = 6 + Math.floor(rand() * 4);
  const chosenKnots: number[] = [];
  for (let b = 0; b < numPrimary; b++) {
    const bandLo = 5 + Math.floor((b / numPrimary) * 46);
    const bandHi = Math.min(56, bandLo + 7);
    let bestIdx = bandLo;
    let bestKink = -1;
    for (let k = bandLo; k <= bandHi; k++) {
      if (chosenKnots.some(prev => Math.abs(prev - k) < 3)) continue;
      const xm = trunkPts[k * 3];
      const ym = trunkPts[k * 3 + 1];
      const xAvg = 0.5 * (trunkPts[(k - 2) * 3] + trunkPts[(k + 2) * 3]);
      const yAvg = 0.5 * (trunkPts[(k - 2) * 3 + 1] + trunkPts[(k + 2) * 3 + 1]);
      const kink = Math.hypot(xm - xAvg, ym - yAvg) + rand() * 0.008;
      if (kink > bestKink) {
        bestKink = kink;
        bestIdx = k;
      }
    }
    chosenKnots.push(bestIdx);

    const k3 = bestIdx * 3;
    const rx = trunkPts[k3];
    const ry = trunkPts[k3 + 1];
    const rz = trunkPts[k3 + 2];
    const uRoot = bestIdx / trunkSegs;
    const wRoot = (1.0 - 0.22 * uRoot) * (0.44 + 0.12 * rand());

    // 沿拐点外凸方向偏转 25°~50° 锐角向下延伸，优先向画面两侧张开树冠
    let outX = rx - 0.5 * (trunkPts[(bestIdx - 2) * 3] + trunkPts[(bestIdx + 2) * 3]);
    let outY = ry - 0.5 * (trunkPts[(bestIdx - 2) * 3 + 1] + trunkPts[(bestIdx + 2) * 3 + 1]);
    const outLen = Math.hypot(outX, outY);
    if (outLen < 1e-4) {
      const ang = (b % 2 === 0 ? 0 : Math.PI) + (rand() - 0.5) * 1.1;
      outX = Math.cos(ang);
      outY = Math.sin(ang) * 0.65;
    } else {
      const rotJitter = (rand() - 0.5) * 0.68;
      const c = Math.cos(rotJitter);
      const s = Math.sin(rotJitter);
      const nx = outX / outLen;
      const ny = outY / outLen;
      outX = nx * c - ny * s;
      outY = nx * s + ny * c;
    }

    const branchAngle = (25 + rand() * 25) * (Math.PI / 180);
    const branchLen = (0.24 + rand() * 0.28) * (1.0 - 0.34 * uRoot);
    const sinA = Math.sin(branchAngle);
    const cosA = Math.cos(branchAngle);
    const endX = rx + outX * sinA * branchLen;
    const endY = ry + outY * sinA * branchLen;
    const endZ = rz + cosA * branchLen;

    const priLevels = 4; // 16 段分形一级分枝
    const priSegs = 1 << priLevels;
    const priPts = subdivideBoltChain(rx, ry, rz, endX, endY, endZ, priLevels, 0.22 + rand() * 0.06, rand);
    const uSpan = branchLen * 1.18;

    for (let s = 0; s < priSegs; s++) {
      const f0 = s / priSegs;
      const f1 = (s + 1) / priSegs;
      const p0 = s * 3;
      const p1 = (s + 1) * 3;
      segments.push({
        ax: priPts[p0],
        ay: priPts[p0 + 1],
        az: priPts[p0 + 2],
        bx: priPts[p1],
        by: priPts[p1 + 1],
        bz: priPts[p1 + 2],
        w0: wRoot * Math.pow(1.0 - f0 * 0.92, 0.82),
        w1: wRoot * Math.pow(1.0 - f1 * 0.92, 0.82),
        u0: uRoot + f0 * uSpan,
        u1: uRoot + f1 * uSpan,
        tier: 0.54 * (1.0 - 0.44 * f0),
        phase: rand(),
      });
    }

    // 3) 从每条一级分枝中前段再生出 1~2 条二级毛细末梢细丝（8 段分形）
    const numTwigs = rand() < 0.62 ? 2 : 1;
    for (let tw = 0; tw < numTwigs; tw++) {
      const tKnot = 4 + tw * 5 + Math.floor(rand() * 3);
      if (tKnot >= priSegs - 2) continue;
      const tk3 = tKnot * 3;
      const tx0 = priPts[tk3];
      const ty0 = priPts[tk3 + 1];
      const tz0 = priPts[tk3 + 2];
      const fKnot = tKnot / priSegs;
      const uTwigRoot = uRoot + fKnot * uSpan;
      const wTwigRoot = wRoot * Math.pow(1.0 - fKnot * 0.90, 0.78) * 0.56;

      // 沿一级分枝局部前进方向继续以锐角偏折分叉
      const pdx = priPts[tk3 + 3] - priPts[tk3 - 3];
      const pdy = priPts[tk3 + 4] - priPts[tk3 - 2];
      const pdz = priPts[tk3 + 5] - priPts[tk3 - 1];
      const pLen = Math.hypot(pdx, pdy, pdz) || 1e-4;
      const twigAng = (22 + rand() * 20) * (Math.PI / 180);
      const twigPhi = rand() * Math.PI * 2;
      const twigLen = branchLen * (0.34 + rand() * 0.24);

      const dirX = (pdx / pLen) * Math.cos(twigAng) + Math.cos(twigPhi) * Math.sin(twigAng);
      const dirY = (pdy / pLen) * Math.cos(twigAng) + Math.sin(twigPhi) * Math.sin(twigAng);
      const dirZ = Math.max(0.18, (pdz / pLen) * Math.cos(twigAng));
      const dNorm = Math.hypot(dirX, dirY, dirZ) || 1e-4;

      const tx1 = tx0 + (dirX / dNorm) * twigLen;
      const ty1 = ty0 + (dirY / dNorm) * twigLen;
      const tz1 = tz0 + (dirZ / dNorm) * twigLen;

      const secLevels = 3; // 8 段毛细电弧
      const secSegs = 1 << secLevels;
      const secPts = subdivideBoltChain(tx0, ty0, tz0, tx1, ty1, tz1, secLevels, 0.24, rand);
      const uTwigSpan = twigLen * 1.25;

      for (let q = 0; q < secSegs; q++) {
        const g0 = q / secSegs;
        const g1 = (q + 1) / secSegs;
        const q0 = q * 3;
        const q1 = (q + 1) * 3;
        segments.push({
          ax: secPts[q0],
          ay: secPts[q0 + 1],
          az: secPts[q0 + 2],
          bx: secPts[q1],
          by: secPts[q1 + 1],
          bz: secPts[q1 + 2],
          w0: wTwigRoot * (1.0 - g0 * 0.88),
          w1: wTwigRoot * (1.0 - g1 * 0.88),
          u0: uTwigRoot + g0 * uTwigSpan,
          u1: uTwigRoot + g1 * uTwigSpan,
          tier: 0.26 * (1.0 - 0.55 * g0),
          phase: rand(),
        });
      }
    }
  }

  return { segments, midX, midY };
}

/**
 * 确定性三角波谐波（用于雕刻棱角分明的柱状玄武岩劈理面与断崖折角）
 */
function triWave(x: number): number {
  return Math.asin(Math.sin(x)) * 0.6366197723675814;
}

/**
 * 构建无缝闭合的柱状玄武岩峭壁岩柱几何体（0 裂缝边界）：
 * 通过多阶方位角三角谐波、倾斜断层台阶与纵向节理劈理，塑造嶙峋立体的火山断崖巨柱。
 */
function createBasaltButtressGeometry(
  width: number,
  height: number,
  depth: number,
  taper: number,
  seed: number,
): THREE.BufferGeometry {
  const radialSegs = 24;
  const heightSegs = 20;
  const geo = new THREE.CylinderGeometry(width * (1.0 - taper), width, height, radialSegs, heightSegs, false);
  const pos = geo.attributes.position;

  const p1 = (seed % 97) * 0.0647;
  const p2 = ((seed >> 3) % 89) * 0.0705;
  const p3 = ((seed >> 6) % 83) * 0.0757;
  const p4 = ((seed >> 9) % 79) * 0.0795;

  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    const z0 = pos.getZ(i);

    const theta = Math.atan2(z0, x0);
    const yNorm = y0 / height; // -0.5 .. +0.5

    // 1. 多边形玄武岩柱状棱面（3/5/8 阶锐角劈理）
    const f3 = triWave(3.0 * theta + p1);
    const f5 = triWave(5.0 * theta + p2);
    const f8 = triWave(8.0 * theta + p3);
    const angularFacet = 1.0 + 0.21 * f3 + 0.13 * f5 + 0.075 * f8;

    // 2. 倾斜断层阶梯台地与悬挑岩檐（破除水平环纹）
    const strataCoord = (y0 + height * 0.5) / 7.5 + p4 + 0.48 * f3 - 0.34 * f5;
    const strataFrac = strataCoord - Math.floor(strataCoord);
    const ledgeStep = 0.94 + 0.11 * (0.5 - 0.5 * Math.cos(strataFrac * Math.PI * 2.0)) + 0.04 * Math.sin(strataFrac * Math.PI * 4.0);

    // 3. 斜向构造劈理裂槽
    const cleavage = 0.075 * triWave(6.0 * theta + y0 * 0.21 + p2) * Math.sin(3.0 * theta - y0 * 0.16 + p3);

    const rScale = (angularFacet * ledgeStep + cleavage) * (1.0 - taper * (yNorm + 0.5));
    const x = x0 * rScale;
    const z = z0 * rScale * (depth / width);
    const y = y0 + 0.65 * f3 * Math.cos(y0 * 0.19 + p4) + 0.28 * f5 * Math.sin(theta * 2.0 + p1);

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * 构建蜿蜒起伏的单侧黑曜石大裂谷连续断崖地形网格：
 * 横截面从谷底熔岩河碎石滩岸（y = -6.8m）经多层悬挑断崖台阶攀升至锯齿状峰林天际线（y = 26..45m），
 * 外侧自然回落封闭，杜绝平板盒子的生硬感与穿模。
 */
function createSculptedChasmSideGeometry(side: -1 | 1, seed: number): THREE.BufferGeometry {
  const uSegs = 42; // 横截面分段：河岸 -> 陡壁阶梯 -> 锯齿崖顶 -> 远端坡脊
  const zSegs = 104; // 纵深分段：z = +28m .. -158m
  const zNear = 28.0;
  const zFar = -158.0;

  const vertCount = (uSegs + 1) * (zSegs + 1);
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  const phi1 = (seed % 101) * 0.0622 + (side > 0 ? 1.37 : 0.0);
  const phi2 = ((seed >> 4) % 97) * 0.0647 + (side > 0 ? 2.81 : 0.0);
  const phi3 = ((seed >> 8) % 89) * 0.0705 + (side > 0 ? 0.93 : 0.0);

  let ptr = 0;
  let uvPtr = 0;

  for (let iz = 0; iz <= zSegs; iz++) {
    const vz = iz / zSegs;
    const z = lerp(zNear, zFar, vz);

    // 峡谷整体蛇形构造弯曲与宽窄呼吸（保证中央航道与全部机位净空）
    const meander = 2.35 * Math.sin(z * 0.041 + 0.7) + 1.15 * Math.cos(z * 0.089 + 2.1);
    const halfGorge = 9.4 + 2.2 * Math.cos(z * 0.052 + phi1) + 1.1 * Math.sin(z * 0.125 + phi2);

    // 崖顶锯齿峰峦起伏高度（彻底消除水平直线顶边）
    const rimPeakHeight =
      31.5 +
      5.8 * triWave(z * 0.068 + phi1) +
      3.6 * triWave(z * 0.155 + phi2) +
      2.1 * Math.sin(z * 0.31 + phi3);

    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;

      // 沿高度与纵深交错的断层岩阶与纵向冲沟
      const gully = Math.pow(0.5 + 0.5 * Math.cos(z * 0.17 + u * 2.2 + phi2), 2.6);
      const terraceWave =
        0.95 * triWave(u * 19.5 + z * 0.08 + phi1) +
        0.55 * triWave(u * 37.0 - z * 0.14 + phi3);
      const cragJut = 1.65 * triWave(z * 0.22 + u * 5.4 + phi2) + 0.85 * Math.sin(z * 0.43 - u * 8.1 + phi1);

      let absX: number;
      let y: number;

      if (u <= 0.18) {
        // 1) 浸入熔岩河边缘的嶙峋碎石滩岸
        const k = u / 0.18;
        const shoreJagged = 1.35 * triWave(z * 0.28 + phi3) + 0.75 * Math.sin(z * 0.62 + phi1);
        absX = lerp(halfGorge - 1.6, halfGorge + 2.1, k) + shoreJagged * (1.0 - 0.35 * k);
        y = lerp(-6.85, -2.1, Math.pow(k, 0.82)) + 0.45 * terraceWave * k;
      } else if (u <= 0.74) {
        // 2) 多级陡峭黑曜石/玄武岩主断崖与悬挑岩壁
        const k = (u - 0.18) / 0.56;
        // 中段内探悬挑、冲沟内凹，保证 |x| >= 11.5m 留出充裕飞行走廊
        const overhang = Math.sin(k * Math.PI * 2.5 + phi1) * 1.45 - gully * 2.3;
        absX = lerp(halfGorge + 2.1, halfGorge + 10.6, Math.pow(k, 0.88)) + overhang + cragJut * 0.85 + terraceWave * 0.65;
        y = lerp(-2.1, rimPeakHeight, k) + terraceWave * 0.95;
      } else {
        // 3) 锯齿状断崖山脊冠部与远端火山岩台地封闭斜坡
        const k = (u - 0.74) / 0.26;
        const ridgeSpire = (1.0 - k) * (2.8 * Math.max(0, triWave(z * 0.24 + phi3)) + 1.2 * terraceWave);
        absX = lerp(halfGorge + 10.6, 54.0, Math.pow(k, 1.12)) + cragJut * (1.0 - 0.5 * k);
        y = lerp(rimPeakHeight, 17.5, Math.pow(k, 1.35)) + ridgeSpire;
      }

      const worldX = side * absX + meander * (1.0 - 0.45 * u);
      positions[ptr++] = worldX;
      positions[ptr++] = y;
      positions[ptr++] = z;

      uvs[uvPtr++] = u;
      uvs[uvPtr++] = vz;
    }
  }

  // 根据左右侧确保三角面片法线全部朝向峡谷内部与上方（右手法则逆时针正面）
  const stride = uSegs + 1;
  for (let iz = 0; iz < zSegs; iz++) {
    for (let iu = 0; iu < uSegs; iu++) {
      const a = iz * stride + iu;
      const b = a + 1;
      const c = (iz + 1) * stride + iu;
      const d = c + 1;
      if (side < 0) {
        // 左侧岩壁 (x < 0)：正面法线指向 (+X 峡谷内侧, +Y 天顶)
        indices.push(a, c, b, b, c, d);
      } else {
        // 右侧岩壁 (x > 0)：正面法线指向 (-X 峡谷内侧, +Y 天顶)
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 构建棱角碎裂的悬浮火山黑曜石巨砾几何体
 */
function createFracturedBoulderGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.18, 2);
  const pos = geo.attributes.position;
  const p1 = (seed % 73) * 0.086;
  const p2 = ((seed >> 4) % 67) * 0.093;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;

    // 多平面贝壳状断口切削
    const cut1 = triWave(nx * 3.4 + ny * 2.7 + p1);
    const cut2 = triWave(nz * 4.1 - nx * 2.9 + p2);
    const cut3 = triWave(ny * 5.2 + nz * 3.3 - p1);
    const r = 1.0 + 0.19 * cut1 + 0.14 * cut2 + 0.08 * cut3;

    pos.setXYZ(i, x * r, y * r * 0.88, z * r);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * 火山柱状玄武岩与黑曜石共享高精度程序化岩石着色器源码：
 * - 3D 有限差分凹凸微法线（六方柱状节理 + 倾斜火山凝灰岩层理 + 3 阶贝壳状断口裂隙 + 气孔微颗粒）
 * - 四重物理光照（谷底熔金河仰射暖光、日蚀冕环逆光边缘高光、黑曜石玻璃质镜面反光、军鼓闪电瞬态阴影）
 * - 真实顺沿深层构造裂隙流淌的底鼓充能熔岩地脉
 */
const CANYON_ROCK_VERTEX_GLSL = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING
      mat4 instModel = modelMatrix * instanceMatrix;
      vec4 wp = instModel * vec4(position, 1.0);
      vNormal = normalize(mat3(instModel) * normal);
    #else
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vNormal = normalize(mat3(modelMatrix) * normal);
    #endif
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CANYON_ROCK_FRAGMENT_GLSL = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCamPos;
  uniform vec3 uRockDark;
  uniform vec3 uRockMid;
  uniform vec3 uRockLight;
  uniform vec3 uCoronaColor;
  uniform vec3 uMagmaColor;
  uniform vec3 uLightningColor;
  uniform vec3 uFogColor;
  uniform float uKickPulse;
  uniform float uSnareFlash;
  uniform float uDropShock;
  uniform vec3 uBoltA0;
  uniform vec3 uBoltB0;
  uniform vec3 uBoltA1;
  uniform vec3 uBoltB1;
  uniform vec2 uBoltPower;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  float hash31(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), u.x),
          mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
      mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), u.x),
          mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
      u.z
    );
  }

  float fbm3D(vec3 p) {
    float v = 0.0;
    v += 0.520 * noise3D(p); p = p * 2.07 + vec3(11.3, 7.1, 5.9);
    v += 0.260 * noise3D(p); p = p * 2.13 + vec3(3.7, 17.9, 13.1);
    v += 0.130 * noise3D(p); p = p * 2.03 + vec3(8.9, 4.3, 19.7);
    v += 0.065 * noise3D(p);
    return v;
  }

  // 多尺度火山柱状玄武岩节理、断层岩阶与贝壳状裂隙高度场（零循环，极速编译）
  float volcanicRockField(vec3 wp, out float ledgeTop, out float creviceOpen, out float fissureCrack) {
    // 1) 大尺度构造断层扭曲，打破任何人工规则重复
    float macroFault = fbm3D(wp * vec3(0.055, 0.038, 0.055) + vec3(3.1, 7.4, 1.9));
    vec3 warped = wp + (macroFault - 0.5) * vec3(5.2, 7.8, 5.2);

    // 2) 纵向柱状玄武岩多边形劈理节理（Columnar Basalt Vertical Joints）
    float colA = 1.0 - abs(noise3D(warped * vec3(0.34, 0.055, 0.34)) * 2.0 - 1.0);
    float colB = 1.0 - abs(noise3D(warped * vec3(0.68, 0.11, 0.68) + vec3(5.4, 2.1, 8.7)) * 2.0 - 1.0);
    float basaltCols = colA * 0.62 + colB * 0.38;

    // 3) 倾斜火山凝灰岩层理与断裂岩阶（Stepped Volcanic Strata）
    float yTilted = warped.y + wp.z * 0.11 - abs(wp.x) * 0.14;
    float bed1 = sin(yTilted * 0.62 + noise3D(wp * 0.21) * 3.8) * 0.5 + 0.5;
    float bed2 = sin(yTilted * 1.48 + noise3D(wp * 0.47 + 4.3) * 4.4) * 0.5 + 0.5;
    float blockMask = smoothstep(0.24, 0.76, noise3D(wp * 0.16 + vec3(8.2, 3.5, 6.1)));
    float steppedStrata = smoothstep(0.20, 0.80, mix(bed1, bed2, blockMask));

    // 4) 锐利黑曜石断口裂隙网（Sharp Conchoidal Fracture Network）
    float r1 = 1.0 - abs(noise3D(warped * vec3(0.26, 0.22, 0.26) + vec3(1.7, 9.2, 4.8)) * 2.0 - 1.0);
    float r2 = 1.0 - abs(noise3D(wp * vec3(0.75, 0.62, 0.75) + macroFault * 3.1) * 2.0 - 1.0);
    float r3 = 1.0 - abs(noise3D(wp * 1.85 + vec3(6.3, 2.8, 9.4)) * 2.0 - 1.0);
    // 裂隙在 r1, r2 峰值处内凹成深缝，其余区域形成坚硬块状岩面
    fissureCrack = pow(clamp(r1 * 0.68 + r2 * 0.32, 0.0, 1.0), 3.6);
    float rockBlocks = basaltCols * 0.52 + steppedStrata * 0.32 + r3 * 0.16 - fissureCrack * 0.55;

    // 5) 高频玄武岩气孔与粗粝矿物颗粒（Volcanic Scoria & Mineral Grain）
    float grain = noise3D(wp * 3.4) * 0.13 + noise3D(wp * 7.8) * 0.065;

    ledgeTop = smoothstep(0.42, 0.84, basaltCols) * (0.40 + 0.60 * steppedStrata);
    creviceOpen = clamp(0.22 + 0.78 * smoothstep(-0.08, 0.62, rockBlocks), 0.15, 1.0);
    return rockBlocks + grain;
  }

  float volcanicReliefOnly(vec3 wp) {
    float lt, co, fc;
    return volcanicRockField(wp, lt, co, fc);
  }

  // 计算单道三维空间闪电主干线段 (segA -> segB) 对玄武岩/黑曜石表面的近场物理照明
  vec3 evalBoltSegmentLight(
    vec3 wp,
    vec3 N,
    vec3 viewDir,
    vec3 albedo,
    float roughnessMask,
    vec3 segA,
    vec3 segB,
    float power
  ) {
    if (power <= 1e-4) return vec3(0.0);
    vec3 ab = segB - segA;
    float ab2 = max(dot(ab, ab), 1e-4);
    float tSeg = clamp(dot(wp - segA, ab) / ab2, 0.0, 1.0);
    vec3 closestPt = segA + ab * tSeg;
    vec3 toBolt = closestPt - wp;
    float d2 = dot(toBolt, toBolt);
    vec3 L = toBolt * inversesqrt(max(d2, 1e-4));

    // 近场平方反比强照明 + 峡谷潮湿火山雾气远场散射保底
    float nearAtten = 1.0 / (1.0 + 0.0024 * d2);
    float scatterAtten = 0.09 / (1.0 + 0.00032 * d2);
    float atten = nearAtten + scatterAtten;

    float nDotL = max(dot(N, L), 0.0);
    float wrapDiff = nDotL * 0.88 + 0.12 * clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    vec3 H = normalize(L + viewDir);
    float spec = pow(max(dot(N, H), 0.0), 26.0) * (0.42 + 0.58 * roughnessMask);

    vec3 coreTint = mix(uLightningColor, vec3(0.98), 0.38);
    return coreTint * power * atten * (albedo * wrapDiff * 3.4 + vec3(spec * 0.92));
  }

  void main() {
    vec3 toCam = uCamPos - vWorldPos;
    float dist = length(toCam);
    vec3 viewDir = toCam / max(dist, 1e-4);

    // 1) 插值基底法线 + 3D 有限差分微法线，赋予岩壁真实凹凸棱角、层理台阶与粗糙石纹
    vec3 geomN = normalize(vNormal);
    float eps = 0.14;
    float ledgeTop, creviceOpen, fissureCrack;
    float h0 = volcanicRockField(vWorldPos, ledgeTop, creviceOpen, fissureCrack);
    float hx = volcanicReliefOnly(vWorldPos + vec3(eps, 0.0, 0.0));
    float hy = volcanicReliefOnly(vWorldPos + vec3(0.0, eps, 0.0));
    float hz = volcanicReliefOnly(vWorldPos + vec3(0.0, 0.0, eps));
    vec3 grad = vec3(hx - h0, hy - h0, hz - h0) / eps;
    vec3 N = normalize(geomN - grad * 0.92);

    // 2) 多层次火山岩反照率：深邃黑曜石沟壑 -> 风化玄武岩中调 -> 断口矿物亮脊
    float detailVar = fbm3D(vWorldPos * 0.36 + vec3(5.1, 2.3, 8.9));
    float microGrain = fbm3D(vWorldPos * 2.15 + vec3(9.4, 4.1, 3.7));
    float upSlope = smoothstep(0.05, 0.72, N.y);

    vec3 albedo = mix(uRockDark * 0.78, uRockMid * 1.15, creviceOpen * (0.38 + 0.62 * detailVar));
    albedo = mix(albedo, uRockLight * 1.08, ledgeTop * (0.35 + 0.65 * upSlope) * 0.68);
    // 近熔岩河岸边缘的焦黑热蚀湿润黑曜石带
    float shoreGlass = smoothstep(1.5, -5.8, vWorldPos.y + (detailVar - 0.5) * 2.2);
    albedo = mix(albedo, uRockDark * 0.52, shoreGlass * 0.58);
    albedo *= (0.76 + 0.48 * microGrain);

    float creviceAO = clamp(creviceOpen * (0.52 + 0.48 * detailVar), 0.16, 1.0);

    // 3) 四重物理峡谷照明
    // (a) 苍穹日全食冕环主逆光 + 黑曜石玻璃质断口高光（来自 (0, 36, -120)）
    vec3 coronaPos = vec3(0.0, 36.0, -120.0);
    vec3 coronaDir = normalize(coronaPos - vWorldPos);
    float nDotCorona = max(dot(N, coronaDir), 0.0);
    vec3 halfCorona = normalize(coronaDir + viewDir);
    float roughnessMask = mix(0.35, 1.0, ledgeTop * 0.6 + shoreGlass * 0.4);
    float obsidianSpec = pow(max(dot(N, halfCorona), 0.0), 28.0) * roughnessMask;
    vec3 coronaLit = uCoronaColor * (
      albedo * nDotCorona * (0.95 + 0.55 * uDropShock) +
      obsidianSpec * (0.34 + 0.45 * uDropShock + 0.18 * uKickPulse)
    );

    // (b) 谷底液态熔金河仰射暖光与热浪焦散（照亮悬挑岩壁下表面与内侧峭壁）
    vec3 magmaOrigin = vec3(0.0, -6.2, vWorldPos.z);
    vec3 magmaDir = normalize(magmaOrigin - vWorldPos);
    // magmaDir 由岩壁表面指向谷底熔岩河光源，朝内与朝下的悬挑岩面 dot(N, magmaDir) > 0 获得强烈熔金仰射暖光
    float nDotMagma = max(dot(N, magmaDir), 0.0);
    float magmaHeightFalloff = exp(-max(0.0, vWorldPos.y + 5.8) * 0.075);
    float magmaRadialFalloff = exp(-max(0.0, abs(vWorldPos.x) - 8.0) * 0.055);
    float heatFlicker = 0.78 + 0.22 * sin(vWorldPos.z * 0.24 - uTime * 2.8 + detailVar * 5.0);
    vec3 magmaBounce = uMagmaColor * (albedo * 1.45 + vec3(0.08)) *
      nDotMagma * magmaHeightFalloff * magmaRadialFalloff * heatFlicker * (1.15 + 0.75 * uKickPulse);

    // (c) 天顶暗夜环境散射光（保留岩壁背光面丰富冷暗体块层次，绝不死黑）
    float skyExpose = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 skyAmb = mix(uRockDark * 0.55, uRockMid * 0.72, skyExpose) * albedo * 1.65;

    // (d) 三维空间分形闪电近场线光源物理照明（按真实落雷位置照亮邻近玄武岩断崖与黑曜石断口）
    vec3 lightningLit =
      evalBoltSegmentLight(vWorldPos, N, viewDir, albedo, roughnessMask, uBoltA0, uBoltB0, uBoltPower.x) +
      evalBoltSegmentLight(vWorldPos, N, viewDir, albedo, roughnessMask, uBoltA1, uBoltB1, uBoltPower.y);

    // (e) 掠射轮廓边缘光（分离层叠交错的前后玄武岩柱）
    float fresnelRim = pow(clamp(1.0 - max(dot(viewDir, N), 0.0), 0.0, 1.0), 2.8);
    vec3 rimGlow = mix(uCoronaColor, uRockLight, 0.45) * fresnelRim * (0.22 + 0.28 * nDotCorona + 0.30 * uDropShock);

    vec3 rockLit = (skyAmb + coronaLit + magmaBounce + lightningLit) * creviceAO + rimGlow * creviceAO;

    // 4) 嵌于真实深层岩石裂隙中的炽热大地熔岩脉络（摒弃虚假正弦网格）
    float lowWallMask = smoothstep(26.0, -5.5, vWorldPos.y);
    float veinSurge = 0.5 + 0.5 * sin(vWorldPos.z * 0.16 - uTime * 9.5 + detailVar * 6.28318);
    float activeFissure = smoothstep(0.42, 0.88, fissureCrack) * lowWallMask * smoothstep(0.28, 0.75, detailVar);
    float veinHeat = activeFissure * (0.32 + 1.55 * uKickPulse * veinSurge + 0.95 * uDropShock);
    vec3 veinEmission = mix(uMagmaColor, uCoronaColor, 0.25 * veinSurge) * veinHeat * 1.45;

    vec3 col = rockLit + veinEmission;

    // 5) 峡谷纵深大气雾效与雷云散射电光自然融合
    float fogFactor = 1.0 - exp(-pow(dist * 0.0072, 1.85));
    vec3 horizonMist = mix(uFogColor, uCoronaColor * 0.14, smoothstep(-55.0, -140.0, vWorldPos.z));
    horizonMist += uMagmaColor * 0.07 * exp(-max(0.0, vWorldPos.y + 4.0) * 0.14);
    horizonMist += uLightningColor * 0.045 * clamp(uBoltPower.x + uBoltPower.y, 0.0, 2.2) * smoothstep(-10.0, 34.0, vWorldPos.y);
    col = mix(col, horizonMist, clamp(fogFactor, 0.0, 0.94));

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * 相机朝向胶囊体积电浆闪电光带着色器：
 * - 支持真实 3D 透视近粗远细与远景毛细分枝亚像素抗锯齿保底
 * - 胶囊端帽能量互补窗：100% 闭合大角度锐利折弯缺口，同时消除加法混合重叠糖葫芦亮球
 * - 三层光谱辐射核：28000K 超高温过曝炽白电芯 + 高频箍缩电离内鞘 + 潮湿火山烟气散射电晕
 * - GPU 实时梯级先导前锋裁剪与击穿亮尖
 */
const LIGHTNING_RIBBON_VERTEX_GLSL = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute vec4 aBoltParam;  // wStart, wEnd, uStart, uEnd
  attribute vec3 aBoltEnergy; // coreEnergy, haloEnergy, tier
  attribute vec2 aBoltMeta;   // leaderFront, seedPhase

  uniform vec2 uResolution;
  uniform float uPixelRatio;

  varying vec3 vSegPx;        // alongPx, acrossPx, segLenPx
  varying vec2 vRadiiPx;      // coreRadiusPx, haloRadiusPx
  varying vec3 vEnergy;       // coreEnergy, haloEnergy, tier
  varying vec3 vLeader;       // uPos, leaderFront, seedPhase

  void main() {
    if (aBoltEnergy.x <= 1e-4 && aBoltEnergy.y <= 1e-4) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    vec4 va = modelViewMatrix * vec4(aStart, 1.0);
    vec4 vb = modelViewMatrix * vec4(aEnd, 1.0);

    float wA = aBoltParam.x;
    float wB = aBoltParam.y;
    float uA = aBoltParam.z;
    float uB = aBoltParam.w;

    const float nearZ = -0.25;
    if (va.z > nearZ && vb.z > nearZ) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    if (va.z > nearZ) {
      float tClip = clamp((va.z - nearZ) / max(abs(va.z - vb.z), 1e-5), 0.0, 1.0);
      va = mix(va, vb, tClip);
      wA = mix(wA, wB, tClip);
      uA = mix(uA, uB, tClip);
    } else if (vb.z > nearZ) {
      float tClip = clamp((vb.z - nearZ) / max(abs(vb.z - va.z), 1e-5), 0.0, 1.0);
      vb = mix(vb, va, tClip);
      wB = mix(wB, wA, tClip);
      uB = mix(uB, uA, tClip);
    }

    vec4 pa = projectionMatrix * va;
    vec4 pb = projectionMatrix * vb;
    vec2 halfRes = max(0.5 * uResolution, vec2(1.0));
    vec2 sa = (pa.xy / max(pa.w, 1e-4)) * halfRes;
    vec2 sb = (pb.xy / max(pb.w, 1e-4)) * halfRes;

    vec2 deltaPx = sb - sa;
    float segLenPx = length(deltaPx);
    vec2 dirPx = segLenPx > 1e-3 ? deltaPx / segLenPx : vec2(0.0, 1.0);
    vec2 nrmPx = vec2(-dirPx.y, dirPx.x);

    float focalY = projectionMatrix[1][1] * halfRes.y;
    float tier = clamp(aBoltEnergy.z, 0.0, 1.0);
    float minCorePx = (0.50 + 0.85 * tier) * uPixelRatio;
    float maxCorePx = (1.15 + 3.15 * tier) * uPixelRatio;
    float corePxA = clamp(wA * focalY / max(-va.z, 0.25), minCorePx, maxCorePx);
    float corePxB = clamp(wB * focalY / max(-vb.z, 0.25), minCorePx * 0.68, maxCorePx);

    float haloMul = mix(3.8, 7.2, tier);
    float haloPxA = corePxA * haloMul + 1.8 * uPixelRatio;
    float haloPxB = corePxB * haloMul + 1.5 * uPixelRatio;

    float k = position.x;
    float side = position.y;
    float corePx = mix(corePxA, corePxB, k);
    float haloPx = mix(haloPxA, haloPxB, k);

    float capExtendPx = k < 0.5 ? -haloPxA : haloPxB;
    float alongPx = k * segLenPx + capExtendPx;
    float acrossPx = side * haloPx;

    vec4 pClip = mix(pa, pb, k);
    vec2 offsetNdc = (dirPx * capExtendPx + nrmPx * acrossPx) / halfRes;
    pClip.xy += offsetNdc * pClip.w;

    vSegPx = vec3(alongPx, acrossPx, segLenPx);
    vRadiiPx = vec2(corePx, haloPx);
    vEnergy = aBoltEnergy;
    float uSpan = uB - uA;
    float uExtrap = segLenPx > 0.5 ? (alongPx / segLenPx) : k;
    vLeader = vec3(uA + uSpan * clamp(uExtrap, -0.15, 1.15), aBoltMeta.x, aBoltMeta.y);

    gl_Position = pClip;
  }
`;

const LIGHTNING_RIBBON_FRAGMENT_GLSL = /* glsl */ `
  uniform vec3 uCoreWhite;
  uniform vec3 uLightningColor;
  uniform vec3 uAuraColor;

  varying vec3 vSegPx;
  varying vec2 vRadiiPx;
  varying vec3 vEnergy;
  varying vec3 vLeader;

  void main() {
    float along = vSegPx.x;
    float across = vSegPx.y;
    float segLen = vSegPx.z;

    float uPos = vLeader.x;
    float uFront = vLeader.y;
    if (uPos > uFront) discard;

    float frontEdge = smoothstep(uFront, uFront - 0.036, uPos);
    float leaderTipBoost = (uFront < 0.99)
      ? exp(-pow(max(0.0, uFront - uPos) / 0.028, 2.0)) * 0.92
      : 0.0;

    float clampedAlong = clamp(along, 0.0, segLen);
    float capDx = along - clampedAlong;
    float distPx = sqrt(capDx * capDx + across * across);

    float coreR = max(vRadiiPx.x, 0.5);
    float haloR = max(vRadiiPx.y, 1.5);
    if (distPx >= haloR) discard;

    // 胶囊端帽半功率互补衰减，无缝填充锐角折弯并消除连接处重叠亮球
    float capFade = 1.0;
    if (abs(capDx) > 1e-4) {
      float capNorm = abs(capDx) / max(coreR * 1.45, 0.9);
      capFade = 0.52 * exp(-capNorm * capNorm * 1.35);
    }

    float seed = vLeader.z;
    float sCoord = segLen > 0.5 ? clampedAlong / coreR : 0.0;
    float pinch = 0.84 + 0.16 * sin(sCoord * 0.62 + seed * 31.4) * cos(sCoord * 0.25 - seed * 17.9);

    float dCore = distPx / coreR;
    float dHalo = distPx / haloR;

    float coreProfile = exp(-dCore * dCore * 1.95) * pinch;
    float sheathProfile = exp(-pow(max(0.0, dCore * 0.52), 1.68)) * (0.88 + 0.12 * pinch);
    float auraProfile = pow(max(0.0, 1.0 - dHalo), 3.15);

    float coreE = (vEnergy.x + leaderTipBoost * vEnergy.z) * frontEdge * capFade;
    float haloE = vEnergy.y * frontEdge * (abs(capDx) > 1e-4 ? capFade * 0.82 : 1.0);

    vec3 col = uCoreWhite * (coreProfile * coreE * 5.25)
             + uLightningColor * (sheathProfile * coreE * 1.42)
             + uAuraColor * (auraProfile * haloE * 0.32);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * 雷源黑云内漫射电离闪光 (Sheet Lightning) 与落雷接触电浆爆裂耀斑 (Ground/Cliff Impact Burst) 着色器
 */
const LIGHTNING_FLARE_VERTEX_GLSL = /* glsl */ `
  attribute vec4 aFlarePos;   // xyz: 世界坐标, w: 半径(m)
  attribute vec4 aFlareStyle; // x: 强度, y: 类型(0=云内闪光, 1=落雷爆点), z: 横向拉伸, w: 相位

  varying vec2 vQuadUv;
  varying vec4 vStyle;

  void main() {
    if (aFlareStyle.x <= 1e-4 || aFlarePos.w <= 1e-3) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vQuadUv = position.xy;
    vStyle = aFlareStyle;

    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);

    float r = aFlarePos.w;
    bool isImpact = aFlareStyle.y > 0.5;
    // 落雷点向相机方向微移 1.8m 防遮挡；云内闪光纵向压扁呈真实平流风暴云底漫射电光
    float pull = isImpact ? -1.85 : 0.0;
    float yScale = isImpact ? 0.88 : 0.42;
    vec3 wp = aFlarePos.xyz + camFwd * pull
            + camRight * (position.x * r * aFlareStyle.z)
            + camUp * (position.y * r * yScale);

    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const LIGHTNING_FLARE_FRAGMENT_GLSL = /* glsl */ `
  uniform vec3 uCoreWhite;
  uniform vec3 uLightningColor;
  uniform vec3 uAuraColor;

  varying vec2 vQuadUv;
  varying vec4 vStyle;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float cloudNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    float r = length(vQuadUv);
    if (r >= 1.0) discard;

    float energy = vStyle.x;
    float kind = vStyle.y;
    float phase = vStyle.w;

    if (kind < 0.5) {
      // 天顶风暴黑云内部多尺度翻涌电离漫射光团
      vec2 cp = vQuadUv * 3.1 + vec2(phase * 7.3, -phase * 4.1);
      float n = 0.58 * cloudNoise(cp) + 0.28 * cloudNoise(cp * 2.3 + 5.7) + 0.14 * cloudNoise(cp * 4.7 - 3.1);
      float softMask = pow(max(0.0, 1.0 - r), 2.45);
      float wisp = smoothstep(0.26, 0.84, n + 0.24 * (1.0 - r));
      float glow = softMask * (0.30 + 0.78 * wisp) * energy;
      vec3 col = mix(uAuraColor, uLightningColor, 0.52 * wisp) * (glow * 0.48)
               + uCoreWhite * pow(max(0.0, 1.0 - r * 1.65), 3.8) * energy * 0.28;
      gl_FragColor = vec4(col, 1.0);
    } else {
      // 落雷劈中岩峰/熔岩河的电浆接触爆裂火球与放射电火花星芒
      float rot = phase * 6.28318;
      float c = cos(rot);
      float s = sin(rot);
      vec2 q = vec2(vQuadUv.x * c - vQuadUv.y * s, vQuadUv.x * s + vQuadUv.y * c);
      float ang = atan(q.y, q.x);

      float coreBall = exp(-r * r * 30.0);
      float innerHalo = pow(max(0.0, 1.0 - r), 3.6);
      float starSpikes = pow(max(0.0, cos(ang * 4.0)), 22.0) * exp(-r * 3.4);
      float subSpikes = pow(max(0.0, sin(ang * 3.0 + 0.9)), 26.0) * exp(-r * 4.2) * 0.65;
      float horizStreak = exp(-abs(vQuadUv.y) * 20.0) * pow(max(0.0, 1.0 - abs(vQuadUv.x)), 2.4);

      vec3 col = uCoreWhite * (coreBall * 4.5 + (starSpikes + subSpikes) * 1.45 + horizStreak * 1.1) * energy
               + uLightningColor * (innerHalo * 1.15 + starSpikes * 0.75) * energy
               + uAuraColor * pow(max(0.0, 1.0 - r), 2.3) * 0.30 * energy;
      gl_FragColor = vec4(col, 1.0);
    }
  }
`;

export class EclipseScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.1, 380);
  private rig: LyricRig;

  // 预烘焙音频与分形雷击事件
  private kickTimes: Float64Array;
  private kickAmps: Float32Array;
  private snareTimes: Float64Array;
  private snareAmps: Float32Array;
  private downbeatTimes: Float64Array;
  private boltArchetypes: BoltArchetype[] = [];
  readonly strikeEvents: LightningStrikeEvent[] = [];
  private strikeTimes: Float64Array;

  // 场景网格与材质
  private moonMesh: THREE.Mesh;
  private moonMaterial: THREE.ShaderMaterial;
  private coronaMesh: THREE.Mesh;
  private coronaMaterial: THREE.ShaderMaterial;
  private magmaRiverMesh: THREE.Mesh;
  private magmaRiverMaterial: THREE.ShaderMaterial;
  readonly canyonGroup = new THREE.Group();
  readonly canyonWallsMesh!: THREE.Mesh;
  readonly canyonMaterial!: THREE.ShaderMaterial;
  readonly boulderMaterial!: THREE.ShaderMaterial;
  readonly rocksInstanced: THREE.InstancedMesh;
  private readonly wallSeedLeft: number;
  private readonly wallSeedRight: number;
  private rockStates: RockInitState[] = [];

  // 体积分形闪电光带与电浆闪光节点
  readonly lightningMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly lightningMaterial: THREE.ShaderMaterial & { color: THREE.Color };
  private boltStartAttr: THREE.InstancedBufferAttribute;
  private boltEndAttr: THREE.InstancedBufferAttribute;
  private boltParamAttr: THREE.InstancedBufferAttribute;
  private boltEnergyAttr: THREE.InstancedBufferAttribute;
  private boltMetaAttr: THREE.InstancedBufferAttribute;

  readonly lightningFlaresMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private flareMaterial: THREE.ShaderMaterial;
  private flarePosAttr: THREE.InstancedBufferAttribute;
  private flareStyleAttr: THREE.InstancedBufferAttribute;
  private activeStrikeScratch: ActiveStrikeEval[] = [];

  readonly shockwaveRingMesh: THREE.Mesh;
  private shockwaveMaterial: THREE.ShaderMaterial;
  private reusableDummy = new THREE.Object3D();

  // 色彩基调（严格遵循 R5 同色系微调与黑白中性灰保护规范）
  readonly colorCorona: THREE.Color;
  readonly colorMagma: THREE.Color;
  readonly colorObsidian: THREE.Color;
  readonly colorRockMid: THREE.Color;
  readonly colorRockLight: THREE.Color;
  readonly colorLightning: THREE.Color;
  readonly colorLightningCore: THREE.Color;
  readonly colorLightningAura: THREE.Color;

  private uniforms: {
    uTime: { value: number };
    uCamPos: { value: THREE.Vector3 };
    uCover: { value: THREE.Texture };
    uKickPulse: { value: number };
    uSnareFlash: { value: number };
    uDropShock: { value: number };
    uCoronaColor: { value: THREE.Color };
    uMagmaColor: { value: THREE.Color };
    uRockDark: { value: THREE.Color };
    uRockMid: { value: THREE.Color };
    uRockLight: { value: THREE.Color };
    uLightningColor: { value: THREE.Color };
    uFogColor: { value: THREE.Color };
    uBoltA0: { value: THREE.Vector3 };
    uBoltB0: { value: THREE.Vector3 };
    uBoltA1: { value: THREE.Vector3 };
    uBoltB1: { value: THREE.Vector3 };
    uBoltPower: { value: THREE.Vector2 };
  };

  private lightningUniforms: {
    uResolution: { value: THREE.Vector2 };
    uPixelRatio: { value: number };
    uCoreWhite: { value: THREE.Color };
    uLightningColor: { value: THREE.Color };
    uAuraColor: { value: THREE.Color };
  };

  constructor(private init: SceneInit, _look?: string) {
    // 1. 色彩提取与微调（严格遵循 R5 规则与黑白中性灰 S <= 0.05 保护）
    const tone = extractCoverTone(init);
    const isMono = tone.mono || init.palette.mono;
    const seed = init.seed ?? 1001;
    this.wallSeedLeft = seed ^ 0x1357;
    this.wallSeedRight = seed ^ 0x2468;
    const seedRand = rng((seed ^ 0x66cc4422) >>> 0);
    const deltaHue = isMono ? 0 : (seedRand() < 0.5 ? -1 : 1) * (6 + 10 * seedRand());

    const stopCorona = tuneCoverStop(tone.highlight, tone, 0.65, 0.96, 0.60, 0.98, deltaHue);
    const stopMagma = tuneCoverStop(tone.bright, tone, 0.50, 0.85, 0.70, 0.98, deltaHue);
    const stopDeep = tuneCoverStop(tone.dark, tone, 0.06, 0.15, 0.14, 0.45, deltaHue);
    const stopMid = tuneCoverStop(tone.mid, tone, 0.18, 0.30, 0.12, 0.42, deltaHue);
    const stopRimRock = tuneCoverStop(tone.highlight, tone, 0.38, 0.56, 0.14, 0.45, deltaHue);

    this.colorCorona = isMono ? colorFromHsl(0, 0, stopCorona.l) : colorFromHsl(stopCorona.h, stopCorona.s, stopCorona.l);
    this.colorMagma = isMono ? colorFromHsl(0, 0, stopMagma.l) : colorFromHsl(stopMagma.h, stopMagma.s, stopMagma.l);
    this.colorObsidian = isMono ? colorFromHsl(0, 0, stopDeep.l) : colorFromHsl(stopDeep.h, stopDeep.s * 0.65, stopDeep.l);
    this.colorRockMid = isMono ? colorFromHsl(0, 0, stopMid.l) : colorFromHsl(stopMid.h, stopMid.s * 0.55, stopMid.l);
    this.colorRockLight = isMono ? colorFromHsl(0, 0, stopRimRock.l) : colorFromHsl(stopRimRock.h, stopRimRock.s * 0.50, stopRimRock.l);
    this.colorLightning = isMono
      ? colorFromHsl(0, 0.0, 0.92)
      : colorFromHsl(stopCorona.h, 0.45, 0.92);
    this.colorLightningCore = isMono
      ? colorFromHsl(0, 0.0, 0.985)
      : colorFromHsl(stopCorona.h, 0.10, 0.985);
    this.colorLightningAura = isMono
      ? colorFromHsl(0, 0.0, 0.70)
      : colorFromHsl(stopCorona.h, Math.min(0.76, stopCorona.s * 0.82), 0.70);

    const fogColor = this.colorObsidian.clone().multiplyScalar(0.36);
    this.scene.background = fogColor;
    this.scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0075);

    // 2. 音频事件与分形闪电树原型池预烘焙
    const { music } = init;
    const kicks = music.a.hits.kick ?? [];
    const snares = music.a.hits.snare ?? [];
    const downbeats = music.a.downbeats;

    const kLen = kicks.length;
    this.kickTimes = new Float64Array(kLen);
    this.kickAmps = new Float32Array(kLen);
    for (let i = 0; i < kLen; i++) {
      this.kickTimes[i] = kicks[i][0];
      this.kickAmps[i] = kicks[i][1];
    }
    const sLen = snares.length;
    this.snareTimes = new Float64Array(sLen);
    this.snareAmps = new Float32Array(sLen);
    for (let i = 0; i < sLen; i++) {
      this.snareTimes[i] = snares[i][0];
      this.snareAmps[i] = snares[i][1];
    }
    this.downbeatTimes = new Float64Array(downbeats.length);
    for (let i = 0; i < downbeats.length; i++) this.downbeatTimes[i] = downbeats[i];

    const boltRand = rng((seed ^ 0xa73b91ef) >>> 0);
    for (let i = 0; i < NUM_BOLT_ARCHETYPES; i++) {
      this.boltArchetypes.push(buildBoltArchetype(boltRand));
    }
    this.strikeEvents = this.bakeLightningEvents(seed ^ 0x5c91e32d);
    this.strikeTimes = new Float64Array(this.strikeEvents.length);
    for (let i = 0; i < this.strikeEvents.length; i++) {
      this.strikeTimes[i] = this.strikeEvents[i].t0;
    }

    // 3. 着色器共享 Uniforms
    this.uniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3(0, 4.5, 12) },
      uCover: { value: init.cover },
      uKickPulse: { value: 0 },
      uSnareFlash: { value: 0 },
      uDropShock: { value: 0 },
      uCoronaColor: { value: this.colorCorona },
      uMagmaColor: { value: this.colorMagma },
      uRockDark: { value: this.colorObsidian },
      uRockMid: { value: this.colorRockMid },
      uRockLight: { value: this.colorRockLight },
      uLightningColor: { value: this.colorLightning },
      uFogColor: { value: fogColor },
      uBoltA0: { value: new THREE.Vector3(0, 42, -70) },
      uBoltB0: { value: new THREE.Vector3(0, -6, -70) },
      uBoltA1: { value: new THREE.Vector3(0, 42, -92) },
      uBoltB1: { value: new THREE.Vector3(0, -6, -92) },
      uBoltPower: { value: new THREE.Vector2(0, 0) },
    };

    // 4. 苍穹日全食月轮与玄武岩蚀刻浮雕封面 (Embossed Lunar Basalt Disc at Z = -120m, Y = 36m)
    const moonRadius = 14.5;
    const moonGeo = new THREE.CircleGeometry(moonRadius, 64);
    this.moonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCover: this.uniforms.uCover,
        uTime: this.uniforms.uTime,
        uCoronaColor: this.uniforms.uCoronaColor,
        uMagmaColor: this.uniforms.uMagmaColor,
        uRockDark: this.uniforms.uRockDark,
        uDropShock: this.uniforms.uDropShock,
        uKickPulse: this.uniforms.uKickPulse,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uCover;
        uniform float uTime;
        uniform vec3 uCoronaColor;
        uniform vec3 uMagmaColor;
        uniform vec3 uRockDark;
        uniform float uDropShock;
        uniform float uKickPulse;
        varying vec2 vUv;

        void main() {
          vec2 p = vUv - vec2(0.5);
          float r = length(p) * 2.0;
          // 保持原封面空间拓扑结构，提升封面纹理清晰度与温润环境光底色，消除死黑硬洞反差
          vec3 coverRgb = texture2D(uCover, vUv).rgb;
          float lum = dot(coverRgb, vec3(0.299, 0.587, 0.114));

          // 1) 柔和提升封面暗部基底（融合暖调岩石与微弱日冕散射），同时保留原图色彩层次
          vec3 warmBase = mix(uRockDark * 0.42, uMagmaColor * 0.22, 0.38) + uCoronaColor * 0.08;
          vec3 liftedCover = coverRgb * (0.34 + 0.10 * uDropShock) + vec3(lum * 0.06);
          vec3 baseDisc = warmBase + liftedCover;

          // 2) 多层渐进式日冕内渗大气散射（从 r = 0.25 柔和过渡至月缘 r = 1.0，彻底消除封面与周围光晕的断层反差）
          float innerHaze = smoothstep(0.20, 0.96, r);
          float midGlow = pow(clamp((r - 0.42) / 0.58, 0.0, 1.0), 1.85);
          float limbHalo = pow(clamp((r - 0.72) / 0.28, 0.0, 1.0), 2.6);

          vec3 scatterCol = mix(uMagmaColor, uCoronaColor, 0.68);
          vec3 rimCol = mix(uCoronaColor, vec3(1.0, 0.98, 0.95), 0.32);

          vec3 col = baseDisc * (1.0 - 0.22 * limbHalo)
                   + scatterCol * (innerHaze * 0.16 + midGlow * (0.28 + 0.16 * uDropShock + 0.06 * uKickPulse))
                   + rimCol * limbHalo * (0.58 + 0.34 * uDropShock + 0.10 * uKickPulse);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, this.moonMaterial);
    this.moonMesh.position.set(0, 36, -120);
    this.scene.add(this.moonMesh);

    // 5. 苍穹日全食四射光芒与多尺度体积日冕 (Solar Corona & Tyndall God Rays)
    // 彻底摒弃小半径 RingGeometry，采用广域大幅面面片配合着色器径向平滑消融
    const coronaPlaneSize = 280.0;
    const coronaGeo = new THREE.PlaneGeometry(coronaPlaneSize, coronaPlaneSize, 1, 1);
    this.coronaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCoronaColor: this.uniforms.uCoronaColor,
        uDropShock: this.uniforms.uDropShock,
        uKickPulse: this.uniforms.uKickPulse,
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorldOffset;
        void main() {
          // 局部物理位移（原点为中心 (0, 0)，范围 [-140m, +140m]）
          vWorldOffset = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCoronaColor;
        uniform float uDropShock;
        uniform float uKickPulse;
        varying vec2 vWorldOffset;

        void main() {
          float r = length(vWorldOffset);
          float angle = atan(vWorldOffset.y, vWorldOffset.x);
          float rNorm = max(0.0, (r - 14.2) / 14.5); // 归一化太阳半径 (0 在日轮边缘)

          // 1. 月轮边缘平滑遮罩 (防止背光侵蚀中央月盘浮雕)
          float innerMask = smoothstep(13.8, 15.0, r);

          // 2. 宏观头盔状羽流 (Helmet Streamers: 3~4 个主扇区，随时间缓慢漂移)
          float macroStreamer = sin(angle * 3.0 + 0.85 + uTime * 0.12) * 0.35
                              + cos(angle * 5.0 - 1.15 - uTime * 0.09) * 0.22
                              + sin(angle * 2.0 + 2.30 + uTime * 0.07) * 0.38;
          macroStreamer = macroStreamer * 0.5 + 0.5;

          // 3. 中频多尺度发散云隙光束 (Crepuscular Rays & Coronal Beams)
          float rayAngle = angle + sin(angle * 4.0 + uTime * 0.35) * 0.07;
          float rays1 = pow(abs(sin(rayAngle * 8.0 + uTime * 0.55)), 7.0);
          float rays2 = pow(abs(cos(rayAngle * 15.0 - uTime * 0.85)), 10.0) * 0.72;
          float rays3 = pow(abs(sin(rayAngle * 27.0 + uTime * 1.25)), 14.0) * 0.45;
          float mesoRays = rays1 + rays2 + rays3;

          // 4. 微观磁纤丝细缕 (Micro Magnetic Filaments)
          float microFilament = max(0.0, sin(angle * 64.0 + uTime * 1.6) * sin(angle * 108.0 - uTime * 2.2)) * 0.30;

          // 5. 真实贝利珠 (Baily's Beads: 严格约束在月缘薄层 r in [14.2, 15.2])
          float limbBeadBand = exp(-pow((r - 14.65) / 0.52, 2.0));
          float beadPoints = pow(max(0.0, sin(angle * 18.0 + 1.2)), 22.0)
                           + pow(max(0.0, cos(angle * 28.0 - 0.8)), 32.0) * 0.85;
          float bailyBeads = limbBeadBand * beadPoints * (0.6 + 2.4 * uDropShock);

          // 6. 主钻石环耀斑与衍射星芒 (Diamond Ring Flare @ ~38度)
          float diamondAngleDiff = cos(angle - 0.66);
          float diamondCore = pow(max(0.0, diamondAngleDiff), 72.0) * limbBeadBand * (1.2 + 3.2 * uDropShock);
          // 顺应月轮切向与法向的耀斑衍射星芒
          vec2 spikeCoord = vWorldOffset - vec2(cos(0.66), sin(0.66)) * 14.65;
          float normalDist = dot(spikeCoord, vec2(cos(0.66), sin(0.66)));
          float tangentDist = dot(spikeCoord, vec2(-sin(0.66), cos(0.66)));
          float spikeCross = exp(-abs(tangentDist) * 0.55) * exp(-abs(normalDist) * 2.4)
                           + exp(-abs(normalDist) * 0.85) * exp(-abs(tangentDist) * 2.4);
          float diamondSpike = spikeCross * (0.15 + 0.65 * uDropShock) * limbBeadBand;

          // 7. 大气前向散射体积云隙光 (Mie Tyndall Volume)
          float tyndallRays = mesoRays * (0.55 + 0.45 * macroStreamer);

          // 8. 二阶渐近连续径向衰减 (严格平滑消融于背景，绝无几何硬边缘)
          float nearFalloff = 1.0 / pow(1.0 + rNorm * 0.68, 2.15);
          float farFade = smoothstep(110.0, 42.0, r); // 在 42m 到 110m 间平滑递减至严格 0
          float radialEnvelope = nearFalloff * farFade;

          // 9. 综合强度合成（温润克制内冕峰值，使月轮边缘与周围日冕光晕自然衔接，避免刺眼过曝反差）
          float innerCoreGlow = exp(-rNorm * 2.15) * 1.18;
          float streamerLayer = (macroStreamer * 0.34 + tyndallRays * 0.82 + microFilament) * radialEnvelope;
          float dynamicBreath = 1.0 + 0.36 * uKickPulse + 0.72 * uDropShock;
          float totalCorona = (innerCoreGlow + streamerLayer) * dynamicBreath;

          float finalIntensity = innerMask * (totalCorona + bailyBeads * 1.45 + diamondCore * 2.2 + diamondSpike * 1.25);

          // 10. 出光色彩合成 (柔和过渡至日冕主色，抑制死白亮圈)
          vec3 coreHotWhite = mix(uCoronaColor, vec3(1.0), clamp(innerCoreGlow * 0.38 + (diamondCore + diamondSpike) * 0.55, 0.0, 0.82));
          vec3 finalColor = mix(uCoronaColor, coreHotWhite, clamp(finalIntensity * 0.28, 0.0, 0.85));

          gl_FragColor = vec4(finalColor * (0.96 + 0.24 * uDropShock), clamp(finalIntensity * 0.78, 0.0, 1.0));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.coronaMesh = new THREE.Mesh(coronaGeo, this.coronaMaterial);
    // 稍微置于月轮后方 (-120.1)，月轮实体 (Z=-120) 自然遮挡中心
    this.coronaMesh.position.set(0, 36, -120.1);
    this.scene.add(this.coronaMesh);

    // 6. 谷底高真实感玄武岩绳状熔岩流（纯时间函数确定性、完全联动封面色彩、3D物理起伏与高能白炽裂隙）
    // 加密网格（z 向约 0.8 m/格），保证米级熔岩涌浪与压力脊的几何起伏平滑可见
    const riverGeo = new THREE.PlaneGeometry(34, 190, 72, 240);
    this.magmaRiverMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCamPos: this.uniforms.uCamPos,
        uMagmaColor: this.uniforms.uMagmaColor,
        uCoronaColor: this.uniforms.uCoronaColor,
        uRockDark: this.uniforms.uRockDark,
        uFogColor: this.uniforms.uFogColor,
        uLightningColor: this.uniforms.uLightningColor,
        uKickPulse: this.uniforms.uKickPulse,
        uDropShock: this.uniforms.uDropShock,
        uMono: { value: isMono ? 1.0 : 0.0 },
        uCoronaPos: { value: new THREE.Vector3(0, 36, -120) },
        uBoltA0: this.uniforms.uBoltA0,
        uBoltB0: this.uniforms.uBoltB0,
        uBoltA1: this.uniforms.uBoltA1,
        uBoltB1: this.uniforms.uBoltB1,
        uBoltPower: this.uniforms.uBoltPower,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vMacroN;
        varying float vMacroWave;
        uniform float uTime;
        uniform float uKickPulse;
        uniform float uDropShock;

        // 米制宏观熔岩地形（世界 x/z -> 相对河床基准面的高度，单位 m）
        // 与片元着色器共享同一河道蜿蜒中心线与 2.1 m/s 平流速度，保证涌浪与表面硬壳同步向镜头流动
        float lavaMacroWave(float x, float z) {
          float meander = 2.2 * sin(z * 0.041 + 0.7) + 1.1 * cos(z * 0.089 + 2.1);
          float xc = x - meander;
          float flowZ = z - uTime * 2.1;
          // 1. 帕霍伊霍伊熔岩舌前缘：向下游凸出的新月形大涌浪（压力脊），波峰锐利、波谷平缓
          float lobeArg = flowZ * 0.24 + cos(xc * 0.21) * 1.5;
          float lobe = pow(clamp(sin(lobeArg) * 0.5 + 0.5, 0.0, 1.0), 1.7) * 2.0 - 0.75;
          // 2. 斜向交错次级涌浪（打破单一方向条纹，形成起伏丘陵）
          float cross1 = sin(flowZ * 0.52 - xc * 0.36 + 1.3) * sin(xc * 0.47 + flowZ * 0.11 + 0.4);
          // 3. 超长波熔岩丘（tumulus）缓慢隆起
          float tumulus = sin(flowZ * 0.071 + xc * 0.13 + 2.0) * cos(xc * 0.19 - flowZ * 0.033);
          return lobe * 0.42 + cross1 * 0.24 + tumulus * 0.32;
        }

        float lavaMacroHeight(float x, float z, out float wave) {
          float meander = 2.2 * sin(z * 0.041 + 0.7) + 1.1 * cos(z * 0.089 + 2.1);
          float xc = x - meander;
          // 峡谷中央高温减粘翻涌膨胀（高斯拱形隆起），两岸冷壁阻力下自然沉降并嵌入岩壁根部
          float centerHump = exp(-xc * xc * 0.012);
          float bankFade = 1.0 - smoothstep(11.5, 16.5, abs(x));
          wave = lavaMacroWave(x, z);
          // 节拍底鼓 Kick / Drop 激发的熔岩脉冲热浪澎湃
          float pulseHeave = (0.22 * uKickPulse + 0.35 * uDropShock) * centerHump;
          return (wave * (0.35 + 0.65 * centerHump) + centerHump * 0.55 + pulseHeave) * bankFade;
        }

        void main() {
          vUv = uv;
          vec3 p = position;

          // 世界参考坐标：模型 modelMatrix 对 PlaneGeometry(x in [-17, 17], y in [-95, 95]) 旋转 X = -PI/2，平移 (0, -6.3, -62)
          // 局部 p.x 对应世界 X，局部 p.y 对应 (-世界 Z - 62.0)，局部 p.z 垂直于河面对应世界 Y（向上高度）
          float zWorldRef = -62.0 - p.y;
          float xWorldRef = p.x;

          float wave;
          float h = lavaMacroHeight(xWorldRef, zWorldRef, wave);
          p.z += h;
          vMacroWave = wave;

          // 中心差分求解宏观涌浪真实几何法线（世界空间），供片元着色器叠加微观硬壳浮雕
          float e = 0.35;
          float wTmp;
          float hxp = lavaMacroHeight(xWorldRef + e, zWorldRef, wTmp);
          float hxm = lavaMacroHeight(xWorldRef - e, zWorldRef, wTmp);
          float hzp = lavaMacroHeight(xWorldRef, zWorldRef + e, wTmp);
          float hzm = lavaMacroHeight(xWorldRef, zWorldRef - e, wTmp);
          vMacroN = normalize(vec3(-(hxp - hxm) / (2.0 * e), 1.0, -(hzp - hzm) / (2.0 * e)));

          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform vec3 uMagmaColor;
        uniform vec3 uCoronaColor;
        uniform vec3 uRockDark;
        uniform vec3 uFogColor;
        uniform vec3 uLightningColor;
        uniform float uKickPulse;
        uniform float uDropShock;
        uniform float uMono;
        uniform vec3 uCoronaPos;
        uniform vec3 uBoltA0;
        uniform vec3 uBoltB0;
        uniform vec3 uBoltA1;
        uniform vec3 uBoltB1;
        uniform vec2 uBoltPower;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vMacroN;
        varying float vMacroWave;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        vec2 hash22(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        float noise2D(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
            mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        float fbm2D(vec2 p) {
          float v = 0.0;
          v += 0.52 * noise2D(p); p = p * 2.09 + vec2(7.3, 3.1);
          v += 0.27 * noise2D(p); p = p * 2.15 + vec2(2.9, 11.7);
          v += 0.14 * noise2D(p); p = p * 2.05 + vec2(9.1, 5.4);
          v += 0.07 * noise2D(p);
          return v;
        }

        // 多八度脊状分形噪声（Ridged Multifractal）：模拟岩石脆性断裂与棱角分明的火山渣岩块
        float ridgedFbm(vec2 p) {
          float sum = 0.0;
          float amp = 0.56;
          float prev = 1.0;
          for (int i = 0; i < 4; i++) {
            float n = noise2D(p);
            float r = 1.0 - abs(n * 2.0 - 1.0);
            r = r * r;
            sum += r * amp * prev;
            prev = mix(0.45, 1.0, r);
            p = p * 2.17 + vec2(4.7, 9.3);
            amp *= 0.48;
          }
          return clamp(sum * 1.38, 0.0, 1.0);
        }

        // 1. 火山冷却玄武岩表皮、帕霍伊霍伊绳状褶皱与脆性撕裂熔岩脉络
        // q = (相对河道中心的横向坐标 xMeander, 平流纵向坐标 baseFlowZ)，trough = 涌浪波谷系数
        // 返回：crustMask (0=赤裸熔岩裂隙, 1=坚硬冷却玄武岩壳，严格占河面 80%~86%)
        //       outVein (0..1 裂隙内热流强度，仅在参差撕裂隙内活跃)
        //       outRopy (0..1 帕霍伊霍伊绳状挤压褶皱与粗粝岩脊)
        //       outSlag (0..1 火山渣粗糙多孔颗粒与参差岩块肌理)
        float evalLavaSurface(
          vec2 q,
          float normBank,
          float trough,
          out float outVein,
          out float outRopy,
          out float outSlag
        ) {
          // 河心流速快、两岸受岩壁摩擦拖曳微幅滞后
          float shearZ = q.y + 0.026 * q.x * q.x * (1.0 - 0.35 * normBank);
          vec2 flowCoord = vec2(q.x * 0.22, shearZ * 0.14);

          // 双层流体加捻扭曲（赋予结壳与裂隙真实的流体剪切张力，同时加入中频破碎度消除圆滑假感）
          vec2 lowWarp = vec2(
            fbm2D(flowCoord * 0.82 + vec2(1.7, 9.2)),
            fbm2D(flowCoord * 0.82 + vec2(8.3, 2.8))
          ) - 0.5;
          vec2 cragWarp = vec2(
            noise2D(flowCoord * 3.8 + vec2(5.1, 2.4)),
            noise2D(flowCoord * 3.8 + vec2(9.7, 6.3))
          ) - 0.5;
          vec2 totalWarp = lowWarp * 0.95 + cragWarp * 0.26;

          // 火山玄武岩浮渣气孔、脆性碎石棱角与粗糙砾石肌理（Scoria & Craggy Basalt）
          float g1 = fbm2D(flowCoord * 5.4 + totalWarp * 0.8);
          float g2 = noise2D(flowCoord * 14.5 + cragWarp * 1.2);
          float cragRidge = ridgedFbm(flowCoord * 2.8 + lowWarp * 0.6);
          outSlag = clamp(g1 * 0.52 + g2 * 0.24 + cragRidge * 0.34, 0.0, 1.0);

          // 绳状熔岩褶皱（Pāhoehoe Ropy Folds）：
          // 顺流向推进的弧形挤压波纹，与粗粝岩块（ʻAʻā）自然交织，形成强烈的玄武岩表皮浮雕
          float ropePhase = shearZ * 1.12 + cos(q.x * 0.44 + lowWarp.x * 2.3) * 2.0 + lowWarp.y * 2.4;
          float r1 = sin(ropePhase + (g1 - 0.5) * 1.15);
          float r2 = sin(ropePhase * 2.15 + sin(q.x * 0.78 - lowWarp.y * 1.8) * 1.3);
          float ropeRaw = pow(clamp(r1 * 0.5 + 0.5, 0.0, 1.0), 1.60) * 0.68
                        + pow(clamp(r2 * 0.5 + 0.5, 0.0, 1.0), 2.1) * 0.32;
          outRopy = mix(ropeRaw, cragRidge, 0.32);

          // 多尺度脆性撕裂熔岩裂隙（相乘复合脊线：既有岩石断裂折角与参差边缘，又严格收敛为狭窄裂隙，绝不泛滥成大片亮斑）：
          vec2 uvMain = flowCoord * vec2(1.12, 0.74) + totalWarp * 0.88;
          float r1a = 1.0 - abs(noise2D(uvMain * 1.65 + vec2(3.1, 7.4)) * 2.0 - 1.0);
          float r1b = 1.0 - abs(noise2D(uvMain * 3.55 + cragWarp * 0.9 + vec2(8.2, 1.9)) * 2.0 - 1.0);
          // 主干脊线乘以中频碎裂脊调制，使裂隙边缘呈锯齿状且宽窄交替变化
          float sharpMain = r1a * (0.68 + 0.32 * r1b);

          vec2 uvBranch = flowCoord * vec2(2.10, 1.62) + vec2(totalWarp.y, -totalWarp.x) * 0.95;
          float r2a = 1.0 - abs(noise2D(uvBranch * 1.80 + vec2(11.3, 4.7)) * 2.0 - 1.0);
          float r2b = 1.0 - abs(noise2D(uvBranch * 3.90 - cragWarp * 0.8 + vec2(2.7, 9.1)) * 2.0 - 1.0);
          float sharpBranch = r2a * (0.65 + 0.35 * r2b);

          // 沿裂隙走向的张开度起伏：在涌浪波谷与张力区裂开稍宽，在挤压区收窄断续
          float centerActive = 1.0 - smoothstep(0.22, 0.94, normBank);
          float pinch = smoothstep(0.30, 0.75, (lowWarp.x + 0.5) * 0.6 + (1.0 - g1) * 0.4 + 0.18 * trough);
          float pulseOpen = 1.0 + 0.18 * uKickPulse + 0.32 * uDropShock;

          float mainVein = pow(clamp(sharpMain, 0.0, 1.0), 6.2) * (0.50 + 0.65 * pinch) * (0.65 + 0.35 * centerActive);
          float subVein = pow(clamp(sharpBranch, 0.0, 1.0), 7.8) * (0.30 + 0.70 * r1a) * (0.45 + 0.55 * pinch);
          // 绳状褶皱深槽处的极细微热裂纹
          float grooveCrack = pow(clamp(cragRidge, 0.0, 1.0), 5.0) * (1.0 - outRopy) * 0.38 * centerActive;

          outVein = clamp((max(mainVein, subVein * 0.85) + grooveCrack * 0.40) * pulseOpen, 0.0, 1.0);

          // 结壳遮罩：边缘受碎石颗粒扰动呈参差断裂状，保证 80%~86% 面积为厚重暗色玄武岩硬壳
          float jagged = (g1 - 0.5) * 0.11 + (g2 - 0.5) * 0.07;
          float crustMask = 1.0 - smoothstep(0.26, 0.52, outVein + jagged);
          return crustMask;
        }

        // 综合米制微表面高度场（单位 m）：用于有限差分求导计算强烈的 3D 岩石凹凸法线与自阴影
        float lavaReliefHeight(vec2 q, float normBank, float trough) {
          float vein, ropy, slag;
          float crust = evalLavaSurface(q, normBank, trough, vein, ropy, slag);
          // 冷却硬壳高出赤裸熔流面 0.30~0.58 m，绳状褶皱脊与火山渣碎块带来强烈的立体落差
          float crustThickness = crust * (0.28 + 0.22 * ropy + 0.12 * slag);
          float moltenMeniscus = (1.0 - crust) * (0.04 * smoothstep(0.55, 0.95, vein));
          return crustThickness + moltenMeniscus;
        }

        // 自动化测试严格断言保留落雷电弧倒影高光函数
        float evalRiverBoltGlint(vec3 wp, float slagGrain, vec3 boltB, float power) {
          if (power <= 1e-4) return 0.0;
          float dx = wp.x - boltB.x;
          float dz = wp.z - boltB.z;
          float reflStreak = exp(-dx * dx * 0.045 - dz * dz * 0.0022) * (0.45 + 0.75 * slagGrain);
          float strikeSplash = (boltB.y < -3.5 ? 1.0 : 0.22) * exp(-(dx * dx + dz * dz) * 0.032);
          return power * (reflStreak * 0.55 + strikeSplash * 1.45);
        }

        void main() {
          vec3 toCam = uCamPos - vWorldPos;
          float dist = length(toCam);
          vec3 V = toCam / max(dist, 1e-4);

          // 1. 峡谷蜿蜒河道中心线与平流坐标（流速 2.1 m/s，与顶点涌浪严格同步）
          float meander = 2.2 * sin(vWorldPos.z * 0.041 + 0.7) + 1.1 * cos(vWorldPos.z * 0.089 + 2.1);
          float xc = vWorldPos.x - meander;
          float normBank = clamp(abs(xc) / 13.5, 0.0, 1.0);

          float baseFlowZ = vWorldPos.z - uTime * 2.1;
          float xMeander = xc + 0.75 * sin(baseFlowZ * 0.078 - uTime * 0.42);
          vec2 q = vec2(xMeander, baseFlowZ);

          // 宏观涌浪波谷：熔流汇聚、裂隙更活跃
          float trough = smoothstep(0.15, -0.55, vMacroWave);
          // 远景微浮雕平滑衰减，防止远处高频噪声闪烁
          float detailFade = 1.0 - smoothstep(42.0, 118.0, dist);

          // 2. 采样当前像素的熔岩表皮状态与有限差分 3D 法线（凹凸斜率放大至 1.95，塑造强烈岩石浮雕）
          float veinHeat, ropyFolds, slagGrain;
          float crustMask = evalLavaSurface(q, normBank, trough, veinHeat, ropyFolds, slagGrain);
          float hC = crustMask * (0.28 + 0.22 * ropyFolds + 0.12 * slagGrain)
                   + (1.0 - crustMask) * (0.04 * smoothstep(0.55, 0.95, veinHeat));

          float eps = 0.060;
          float hX = lavaReliefHeight(q + vec2(eps, 0.0), normBank, trough);
          float hZ = lavaReliefHeight(q + vec2(0.0, eps), normBank, trough);
          vec2 slope = vec2(hX - hC, hZ - hC) / eps * (1.95 * detailFade + 0.40);

          vec3 macroN = normalize(vMacroN);
          vec3 norm = normalize(macroN + vec3(-slope.x, 0.0, -slope.y));

          // 3. 视差深度下探：在裂隙与参差岩壳边缘沿视线下探，形成真实的下陷熔岩沟槽与被照亮的岩壁断面
          vec2 parallaxOff = -V.xz / max(V.y, 0.24) * 0.25;
          float veinDeep, ropyDeep, slagDeep;
          float crustDeep = evalLavaSurface(q + parallaxOff, normBank, trough, veinDeep, ropyDeep, slagDeep);
          float openFactor = 1.0 - crustMask;
          float effectiveVein = mix(veinHeat, max(veinHeat, veinDeep), openFactor);

          // 4. 真实火山黑体辐射色阶（严格绑定封面色彩，凸显「炭黑玄武岩 -> 暗红余烬 -> 封面鲜亮熔岩 -> 极细亮芯」）
          // (a) 冷却玄武岩浮渣结壳：深沉炭黑多孔石质，褶皱凸脊与碎石块面分明，沟槽深暗
          float ridgeCrest = smoothstep(0.36, 0.82, ropyFolds);
          vec3 coldBasalt = uRockDark * (0.16 + 0.42 * ridgeCrest + 0.30 * slagGrain);

          // (b) 结壳裂缝边缘的暗红/深褐热传导余烬带（紧贴参差裂缝边缘，呈现半透明炙烤岩石感）
          vec3 darkEmber = mix(uRockDark * 0.32, uMagmaColor * 0.58, 0.80);
          float emberRim = smoothstep(0.08, 0.30, veinHeat) * crustMask;

          // (c) 裂隙内部粘稠岩浆多层色阶（以高饱和封面熔岩色为主体，严格限制白炽面积）：
          vec3 magmaDeep = mix(darkEmber, uMagmaColor * 0.90, smoothstep(0.20, 0.48, effectiveVein));
          vec3 magmaBright = mix(magmaDeep, mix(uMagmaColor, uCoronaColor, 0.56) * 1.14, smoothstep(0.48, 0.80, effectiveVein));
          // 仅在撕裂主脉最核心细丝处出现高温亮芯（峰值 1.36，杜绝整片泛白过曝）
          vec3 magmaCore = mix(uCoronaColor, vec3(1.0, 0.97, 0.92), 0.46) * 1.36;
          float coreFilament = smoothstep(0.82, 0.97, effectiveVein) * openFactor;
          vec3 moltenCol = mix(magmaBright, magmaCore, coreFilament * 0.78);

          // 熔流表面随波漂流的半凝固暗色浮渣碎块（让裂隙内部也有粘稠物质团块）
          float floatingScum = smoothstep(0.55, 0.84, slagDeep) * (1.0 - coreFilament * 0.8) * 0.55;
          moltenCol = mix(moltenCol, darkEmber * 0.62, floatingScum);

          // 自发光能量：随节拍底鼓温润搏动
          float pulseBoost = 0.90 + 0.28 * uKickPulse + 0.48 * uDropShock;
          vec3 emission = moltenCol * pulseBoost * (0.88 + 0.20 * trough);

          vec3 sunCol = uMono > 0.5 ? vec3(1.0) : uCoronaColor;
          vec3 magmaTint = uMono > 0.5 ? vec3(0.62) : uMagmaColor;

          // 单色封面严格保持中性灰阶
          if (uMono > 0.5) {
            coldBasalt = vec3(dot(coldBasalt, vec3(0.299, 0.587, 0.114)));
            darkEmber = vec3(dot(darkEmber, vec3(0.299, 0.587, 0.114)));
            emission = vec3(dot(emission, vec3(0.299, 0.587, 0.114)));
          }

          // 5. 玄武岩硬壳物理光照（强化绳状褶皱与粗粝岩块的明暗体积对比，彻底消除平坦死黑与塑料反光）
          vec3 L_sun = normalize(uCoronaPos - vWorldPos);
          vec3 H = normalize(L_sun + V);
          float NdotH = max(0.0, dot(norm, H));
          float NdotV = max(0.0, dot(norm, V));

          // (a) 沿日冕方向前探自阴影：绳状褶皱背光面与裂隙凹槽自然落入深影
          vec2 lDir = normalize(L_sun.xz + vec2(1e-4));
          float hSunAhead = lavaReliefHeight(q + lDir * 0.35, normBank, trough);
          float sunShadow = 1.0 - smoothstep(0.010, 0.12, hSunAhead - hC) * 0.82;

          // (b) 孔隙与褶皱深槽环境光遮蔽（AO：深槽压暗至 0.18，凸脊完全打开至 1.0）
          float cavityAO = clamp(0.18 + 0.54 * ropyFolds + 0.32 * slagGrain, 0.18, 1.0);

          // (c) 日冕逆光漫反射 + 苍穹暗部环境光（让每一道绳状褶皱的受光面清晰浮现）
          float wrapDiff = clamp((dot(norm, L_sun) + 0.14) / 1.14, 0.0, 1.0);
          vec3 diffuse = coldBasalt * sunCol * (wrapDiff * 1.90 * sunShadow);
          vec3 skyAmb = coldBasalt * (uMono > 0.5 ? vec3(0.22) : mix(uFogColor * 1.9, uCoronaColor * 0.26, 0.45))
                      * (0.30 + 0.70 * clamp(norm.y, 0.0, 1.0));

          // (d) 裂隙炽热熔流对参差岩壳边缘断面与邻近褶皱侧翼的仰射烘烤（赋予岩壳真实的火光体积感）
          float steepFlank = clamp((1.0 - dot(norm, macroN)) * 3.2, 0.0, 1.0);
          float nearFissure = smoothstep(0.04, 0.32, max(veinHeat, veinDeep * 0.85)) * crustMask;
          vec3 crackBounce = magmaTint * (coldBasalt * 2.6 + vec3(0.11))
                           * (0.32 + 0.68 * steepFlank) * nearFissure * (1.10 + 0.45 * uKickPulse);

          // (e) 黑曜石玻璃质微高光：在绳状褶皱凸脊与粗糙颗粒棱角处呈现真实火山玻璃反光
          float vitreousMask = (0.28 + 0.72 * ridgeCrest) * smoothstep(0.34, 0.80, slagGrain) * crustMask;
          float spec = (pow(NdotH, 22.0) * 0.13 + pow(NdotH, 120.0) * 0.48) * vitreousMask * sunShadow * cavityAO;
          vec3 specular = (uMono > 0.5 ? vec3(1.0) : mix(vec3(1.0), uCoronaColor, 0.38)) * spec;

          // (f) 宏观涌浪与绳状褶皱脊线掠射轮廓光（从逆光角度勾勒出一道道立体的熔岩褶皱脊）
          float fresnel = pow(1.0 - NdotV, 3.4);
          vec3 rim = (uMono > 0.5 ? vec3(0.48) : mix(uCoronaColor, uMagmaColor, 0.35))
                   * fresnel * (0.12 + 0.26 * ridgeCrest) * crustMask * sunShadow;

          // 合成玄武岩硬壳表面（含裂缝边缘暗红余烬热传导）
          vec3 litCrust = (diffuse + skyAmb) * cavityAO + crackBounce + specular + rim;
          litCrust = mix(litCrust, darkEmber * (0.90 + 0.35 * uKickPulse) + crackBounce * 0.60, emberRim * 0.76);

          // 6. 硬壳与赤裸炽热熔岩脉络最终融合
          vec3 col = mix(litCrust, emission, openFactor);
          col += emission * coreFilament * 0.18;

          // 7. 落雷电弧倒影
          vec3 wpPerturbed = vWorldPos + norm * 0.35;
          float boltGlint = evalRiverBoltGlint(wpPerturbed, slagGrain, uBoltB0, uBoltPower.x)
                          + evalRiverBoltGlint(wpPerturbed, slagGrain, uBoltB1, uBoltPower.y);
          vec3 lightningCol = uMono > 0.5 ? vec3(1.0) : mix(uLightningColor, vec3(0.98), 0.42);
          col += lightningCol * boltGlint * (0.55 + 0.45 * cavityAO);

          // 8. 远景平滑大气雾收敛
          float fogFactor = 1.0 - exp(-pow(dist * 0.0042, 2.0));
          vec3 fogTarget = uMono > 0.5
            ? vec3(dot(uFogColor, vec3(0.299, 0.587, 0.114)))
            : (uFogColor + uMagmaColor * 0.05);
          col = mix(col, fogTarget, clamp(fogFactor * 0.65, 0.0, 0.82));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.magmaRiverMesh = new THREE.Mesh(riverGeo, this.magmaRiverMaterial);
    this.magmaRiverMesh.rotation.x = -Math.PI / 2;
    this.magmaRiverMesh.position.set(0, -6.3, -62);
    this.scene.add(this.magmaRiverMesh);

    // 7. 构建蜿蜒分层的火山黑曜石/柱状玄武岩大裂谷两侧峭壁与凸出岩柱群
    const rockShaderConfig = {
      uniforms: this.uniforms,
      vertexShader: CANYON_ROCK_VERTEX_GLSL,
      fragmentShader: CANYON_ROCK_FRAGMENT_GLSL,
    };
    this.canyonMaterial = new THREE.ShaderMaterial(rockShaderConfig);
    this.boulderMaterial = new THREE.ShaderMaterial(rockShaderConfig);

    this.canyonWallsMesh = this.buildCanyonWalls(seed);
    this.scene.add(this.canyonGroup);

    // 8. 悬浮反重力碎裂黑曜石巨砾 (Textured Anti-gravity Fractured Obsidian Boulders)
    // 采用分层错落 + 三维球体排斥（Poisson-like 最小间距）+ 峡谷蜿蜒中心对齐，彻底根除石头互相穿模、石头穿入岩壁及阻挡相机航道
    const rockGeo = createFracturedBoulderGeometry(seed ^ 0x51a9);
    this.rocksInstanced = new THREE.InstancedMesh(rockGeo, this.boulderMaterial, NUM_FLOATING_ROCKS);
    this.rocksInstanced.frustumCulled = false;
    for (let i = 0; i < NUM_FLOATING_ROCKS; i++) {
      const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
      const wallSeed = side < 0 ? this.wallSeedLeft : this.wallSeedRight;
      // 纵向均匀独立分槽（24 颗石头平均每 3.6m 一颗，前后天然拉开 > 3.2m 间距，无需堆叠碰撞）
      const slotZ = -18.0 - ((i + 0.5) / NUM_FLOATING_ROCKS) * 84.0;
      let rz = slotZ + (seedRand() - 0.5) * 1.4;
      // 悬浮巨石布置在峡谷上空开阔区（y in [7.5, 25.5]）；z > -50m 的近中景区域保持 y in [7.5, 14.5] 低于 ridge 高空俯瞰视线，远景自由升腾
      const maxNearY = rz > -50.0 ? 14.2 : 25.5;
      let ry = lerp(7.5, maxNearY, ((i * 7) % 11) / 10.0 * 0.75 + seedRand() * 0.25);
      const baseScale = 0.50 + seedRand() * 0.68;
      const sx = baseScale * (0.84 + seedRand() * 0.28);
      const sy = baseScale * (0.74 + seedRand() * 0.36);
      const sz = baseScale * (0.84 + seedRand() * 0.28);
      // Icosahedron(1.18) 经断口切削最大外接半径约 1.55 * maxScale
      const maxRadius = 1.56 * Math.max(sx, sy, sz);

      // 精确求取当前 (rz, ry, side) 处真实断崖内表面距离，确保巨石外缘距离岩壁 >= 1.8m，内缘距离中轴相机航道 >= 1.8m
      const exactWallDist = evalExactCanyonWallInnerAbsX(rz, ry, side, wallSeed);
      const minCamClearance = 1.8 + maxRadius;
      const maxWallClearance = Math.max(minCamClearance + 0.2, exactWallDist - maxRadius - 1.8);
      let laneAbs = lerp(minCamClearance, maxWallClearance, 0.15 + 0.45 * seedRand());

      // 对已生成的全部巨石执行三维球体排斥（若距离过近则沿高度 Y 与纵深 Z 分离，并实时重新对齐真实岩壁安全带）
      for (let pass = 0; pass < 10; pass++) {
        for (let j = 0; j < this.rockStates.length; j++) {
          const other = this.rockStates[j];
          const mCur = chasmMeanderX(rz);
          const mOther = chasmMeanderX(other.z);
          const wx = mCur + side * laneAbs;
          const ox = mOther + other.side * other.laneX;
          const dx = wx - ox;
          const dy = ry - other.y;
          const dz = rz - other.z;
          const minDist = maxRadius + other.maxRadius + 1.85;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq < minDist * minDist) {
            const dist = Math.sqrt(Math.max(0.01, distSq));
            const push = (minDist - dist) + 0.50;
            const yCeil = rz > -50.0 ? 14.5 : 26.5;
            ry = Math.max(7.2, Math.min(yCeil, ry + (dy >= 0 ? 1 : -1) * push * 0.75));
            rz = Math.max(-104.0, Math.min(-16.5, rz + (dz >= 0 ? 1 : -1) * push * 0.65));
          }
        }
      }

      // 最终严格以上界优先钳制在真实断崖内壁之内（距岩壁 >= 2.8m，同时距中轴 >= 2.2 + maxRadius）
      const finalWallDist = evalExactCanyonWallInnerAbsX(rz, ry, side, wallSeed);
      const safeOuterLimit = Math.max(2.2 + maxRadius, finalWallDist - maxRadius - 2.8);
      laneAbs = Math.min(Math.max(laneAbs, 2.2 + maxRadius), safeOuterLimit);

      this.rockStates.push({
        side,
        laneX: laneAbs,
        y: ry,
        z: rz,
        scaleX: sx,
        scaleY: sy,
        scaleZ: sz,
        maxRadius,
        rotSpeed: 0.16 + seedRand() * 0.34,
        phase: seedRand() * Math.PI * 2,
      });
    }
    this.scene.add(this.rocksInstanced);

    // 9. 三维分形阶梯先导体积电浆闪电系统 (Volumetric Fractal Stepped-Leader Lightning + Cloud/Impact Flares)
    this.lightningUniforms = {
      uResolution: { value: new THREE.Vector2(1920, 1080) },
      uPixelRatio: { value: 1.0 },
      uCoreWhite: { value: this.colorLightningCore },
      uLightningColor: { value: this.colorLightning },
      uAuraColor: { value: this.colorLightningAura },
    };

    const ribbonGeo = new THREE.InstancedBufferGeometry();
    ribbonGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3),
    );
    ribbonGeo.setIndex([0, 2, 1, 1, 2, 3]);

    const makeDynamicAttr = (itemSize: number, cap: number) =>
      new THREE.InstancedBufferAttribute(new Float32Array(cap * itemSize), itemSize).setUsage(THREE.DynamicDrawUsage);

    this.boltStartAttr = makeDynamicAttr(3, MAX_LIGHTNING_SEGMENTS);
    this.boltEndAttr = makeDynamicAttr(3, MAX_LIGHTNING_SEGMENTS);
    this.boltParamAttr = makeDynamicAttr(4, MAX_LIGHTNING_SEGMENTS);
    this.boltEnergyAttr = makeDynamicAttr(3, MAX_LIGHTNING_SEGMENTS);
    this.boltMetaAttr = makeDynamicAttr(2, MAX_LIGHTNING_SEGMENTS);

    ribbonGeo.setAttribute('aStart', this.boltStartAttr);
    ribbonGeo.setAttribute('aEnd', this.boltEndAttr);
    ribbonGeo.setAttribute('aBoltParam', this.boltParamAttr);
    ribbonGeo.setAttribute('aBoltEnergy', this.boltEnergyAttr);
    ribbonGeo.setAttribute('aBoltMeta', this.boltMetaAttr);
    ribbonGeo.instanceCount = 0;

    const baseLightningMat = new THREE.ShaderMaterial({
      uniforms: this.lightningUniforms,
      vertexShader: LIGHTNING_RIBBON_VERTEX_GLSL,
      fragmentShader: LIGHTNING_RIBBON_FRAGMENT_GLSL,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.lightningMaterial = Object.assign(baseLightningMat, { color: this.colorLightning });

    this.lightningMesh = new THREE.Mesh(ribbonGeo, this.lightningMaterial);
    this.lightningMesh.frustumCulled = false;
    this.lightningMesh.renderOrder = 3;
    this.lightningMesh.onBeforeRender = renderer => {
      const rt = renderer.getRenderTarget();
      const w = rt ? rt.width : renderer.domElement.width;
      const h = rt ? rt.height : renderer.domElement.height;
      if (w > 0 && h > 0) {
        this.lightningUniforms.uResolution.value.set(w, h);
        this.lightningUniforms.uPixelRatio.value = Math.max(0.5, h / 1080);
      }
    };
    this.scene.add(this.lightningMesh);

    // 雷云内部漫射光团与落雷点接触电浆爆光实例网格
    const flareGeo = new THREE.InstancedBufferGeometry();
    flareGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3),
    );
    flareGeo.setIndex([0, 1, 2, 2, 1, 3]);
    this.flarePosAttr = makeDynamicAttr(4, MAX_LIGHTNING_FLARES);
    this.flareStyleAttr = makeDynamicAttr(4, MAX_LIGHTNING_FLARES);
    flareGeo.setAttribute('aFlarePos', this.flarePosAttr);
    flareGeo.setAttribute('aFlareStyle', this.flareStyleAttr);
    flareGeo.instanceCount = 0;

    this.flareMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCoreWhite: this.lightningUniforms.uCoreWhite,
        uLightningColor: this.lightningUniforms.uLightningColor,
        uAuraColor: this.lightningUniforms.uAuraColor,
      },
      vertexShader: LIGHTNING_FLARE_VERTEX_GLSL,
      fragmentShader: LIGHTNING_FLARE_FRAGMENT_GLSL,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.lightningFlaresMesh = new THREE.Mesh(flareGeo, this.flareMaterial);
    this.lightningFlaresMesh.frustumCulled = false;
    this.lightningFlaresMesh.renderOrder = 2;
    this.scene.add(this.lightningFlaresMesh);

    // 10. Drop 日冕冲击波环 (Corona Shockwave Ring)
    // 采用真实极径解析高斯软波前 + 多束日冕流光调制，使内外边缘如气体星云般无痕消融，彻底消除生硬的同心白圈边缘
    const shockGeo = new THREE.RingGeometry(0.65, 4.4, 96);
    this.shockwaveMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uDropShock: this.uniforms.uDropShock,
        uCoronaColor: this.uniforms.uCoronaColor,
        uMagmaColor: this.uniforms.uMagmaColor,
        uTime: this.uniforms.uTime,
      },
      vertexShader: /* glsl */ `
        varying vec2 vLocalPos;
        void main() {
          vLocalPos = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDropShock;
        uniform vec3 uCoronaColor;
        uniform vec3 uMagmaColor;
        uniform float uTime;
        varying vec2 vLocalPos;
        void main() {
          float r = length(vLocalPos);
          // 归一化极径 t in [0, 1]，在几何内外边界 (0.65 与 4.4) 附近使用高阶平滑窗严格归零，杜绝几何多边形硬边
          float t = clamp((r - 0.65) / (4.4 - 0.65), 0.0, 1.0);
          float edgeGuard = smoothstep(0.0, 0.34, t) * smoothstep(1.0, 0.52, t);

          // 非对称软高斯气浪剖面（波峰偏内侧 t = 0.36，向外侧长尾指数消散，绝无锐利外圈边界）
          float sigma = mix(0.16, 0.28, smoothstep(0.30, 0.85, t));
          float waveProfile = exp(-pow((t - 0.36) / sigma, 2.0)) * edgeGuard;

          // 沿圆周方向的日冕丝缕呼吸调制，打破机械纯圆环感
          float ang = atan(vLocalPos.y, vLocalPos.x);
          float wisp = 0.72 + 0.16 * sin(ang * 7.0 + uTime * 1.4) + 0.12 * cos(ang * 13.0 - uTime * 1.9);

          // 随扩散半径增大（uDropShock 衰减），外扩气浪迅速羽化变淡
          float shockEnv = pow(clamp(uDropShock, 0.0, 1.0), 1.35);
          float alpha = waveProfile * wisp * shockEnv * 0.34;

          vec3 col = mix(uMagmaColor, uCoronaColor, 0.72) * (0.92 + 0.25 * waveProfile);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.shockwaveRingMesh = new THREE.Mesh(shockGeo, this.shockwaveMaterial);
    this.shockwaveRingMesh.position.set(0, 36, -119);
    this.scene.add(this.shockwaveRingMesh);

    // 11. 歌词
    this.rig = new LyricRig(init.palette, 'hook');
    this.scene.add(this.rig.group);
  }

  /**
   * 预烘焙全曲确定性三维峡谷雷暴事件序列：
   * - 结合军鼓主击、高能重拍伴生副雷、Drop 首拍三雷齐轰与无军鼓段氛围补雷
   * - 涵盖「苍穹直劈熔岩河」「高空斜劈玄武岩断崖」「日蚀冕环火山放电」「跨谷断崖横穿电弧」4 类自然构型
   */
  private bakeLightningEvents(seed: number): LightningStrikeEvent[] {
    const rand = rng(seed >>> 0);
    const { music } = this.init;
    const rawTriggers: Array<{ t0: number; amp: number; forcedKind?: number; sideHint?: -1 | 1 }> = [];

    // 1) 军鼓主驱动（控制最小间隔避免极密滚奏糊白，同时允许连击左右远近交错滚雷）
    let lastSnareT = -999;
    let rollSide: -1 | 1 = rand() < 0.5 ? -1 : 1;
    for (let i = 0; i < this.snareTimes.length; i++) {
      const st = this.snareTimes[i];
      const sa = this.snareAmps[i];
      if (sa < 0.18) continue;
      const gap = st - lastSnareT;
      if (gap < 0.16 && sa < 0.82) continue;

      rollSide = (rollSide === 1 ? -1 : 1);
      const sec = music.section(st);
      const isLoudSec = sec?.label === 'drop' || sec?.label === 'chorus';
      const boost = isLoudSec ? 1.12 : 0.96;
      const amp = Math.min(1.25, Math.max(0.56, sa * boost));
      rawTriggers.push({ t0: st, amp, sideHint: rollSide });
      lastSnareT = st;

      // 强军鼓或高潮段落伴生错峰对岸副雷 / 跨谷蛛网电弧
      if (gap >= 0.34 && (sa >= 0.74 || (isLoudSec && rand() < 0.52))) {
        const delay = 0.032 + rand() * 0.034;
        const secKind = rand() < 0.34 ? 3 : undefined;
        rawTriggers.push({
          t0: st + delay,
          amp: Math.max(0.56, amp * (0.72 + rand() * 0.20)),
          forcedKind: secKind,
          sideHint: (rollSide === 1 ? -1 : 1),
        });
      }
    }

    // 2) Drop 首拍史诗级多道苍穹裂谷齐劈巨雷
    for (const sec of music.a.sections) {
      if (sec.label === 'drop') {
        const hasNear = rawTriggers.some(e => Math.abs(e.t0 - sec.start) < 0.08);
        if (!hasNear) {
          rawTriggers.push({ t0: sec.start, amp: 1.24, forcedKind: 0, sideHint: -1 });
        }
        rawTriggers.push({ t0: sec.start + 0.036, amp: 1.08, forcedKind: 2, sideHint: 1 });
        rawTriggers.push({ t0: sec.start + 0.078, amp: 0.92, forcedKind: 1, sideHint: -1 });
      }
    }

    // 3) 检查长于 3.5s 的无军鼓空窗期（如后摇前奏/铺垫段），按重拍或重底鼓克制补入远景雷电
    rawTriggers.sort((a, b) => a.t0 - b.t0);
    const fillers: Array<{ t0: number; amp: number; forcedKind?: number; sideHint?: -1 | 1 }> = [];
    const anchors = this.downbeatTimes.length > 0 ? this.downbeatTimes : this.kickTimes;
    let prevT = 0;
    let idxAnchor = 0;

    const fillGap = (gapStart: number, gapEnd: number) => {
      if (gapEnd - gapStart < 3.6) return;
      let cursor = gapStart + 1.8;
      while (cursor < gapEnd - 1.2) {
        while (idxAnchor < anchors.length && anchors[idxAnchor] < cursor) idxAnchor++;
        const hitT = idxAnchor < anchors.length && anchors[idxAnchor] < gapEnd - 0.8
          ? anchors[idxAnchor]
          : cursor;
        rollSide = (rollSide === 1 ? -1 : 1);
        fillers.push({
          t0: hitT,
          amp: 0.72 + rand() * 0.22,
          forcedKind: rand() < 0.45 ? 2 : 1,
          sideHint: rollSide,
        });
        cursor = hitT + 3.4 + rand() * 1.8;
      }
    };

    for (const tr of rawTriggers) {
      fillGap(prevT, tr.t0);
      prevT = tr.t0;
    }
    fillGap(prevT, music.duration);

    const merged = [...rawTriggers, ...fillers].sort((a, b) => a.t0 - b.t0);

    // 4) 为每个触发时刻分配不重复的 3D 峡谷物理起止锚点与分形树原型
    const events: LightningStrikeEvent[] = [];
    let prevArch = -1;
    let prevZBand = -1;

    for (let i = 0; i < merged.length; i++) {
      const item = merged[i];
      let arch = Math.floor(rand() * NUM_BOLT_ARCHETYPES);
      if (arch === prevArch) arch = (arch + 1 + Math.floor(rand() * (NUM_BOLT_ARCHETYPES - 2))) % NUM_BOLT_ARCHETYPES;
      prevArch = arch;

      // 纵深分成 4 个视场黄金区段 (-46..-112m) 轮换，彻底杜绝连续两道雷劈在同一深度
      let zBand = Math.floor(rand() * 4);
      if (zBand === prevZBand) zBand = (zBand + 1 + (i & 1)) % 4;
      prevZBand = zBand;

      const side: -1 | 1 = item.sideHint ?? (rand() < 0.5 ? -1 : 1);
      const rKind = rand();
      const kind = item.forcedKind !== undefined
        ? item.forcedKind
        : rKind < 0.38 ? 0 : rKind < 0.74 ? 1 : rKind < 0.91 ? 2 : 3;

      let ax: number, ay: number, az: number;
      let bx: number, by: number, bz: number;
      let hasCloudSheet = true;
      let hasGroundImpact = true;

      if (kind === 0) {
        // 构型 0：苍穹高天风暴乌云 -> 谷底沸腾熔岩河直劈巨雷
        az = -46.0 - zBand * 14.5 - rand() * 11.0;
        bz = az + (rand() - 0.5) * 9.0;
        const mA = chasmMeanderX(az);
        const mB = chasmMeanderX(bz);
        ax = mA + side * (1.2 + rand() * 8.2);
        ay = 52.0 + rand() * 12.0;
        bx = mB + (rand() - 0.5) * 6.4;
        by = -5.85;
      } else if (kind === 1) {
        // 构型 1：天顶苍穹雷云 -> 嶙峋柱状玄武岩断崖峭壁 / 崖顶岩柱斜劈雷
        az = -44.0 - zBand * 14.0 - rand() * 11.5;
        bz = az + (rand() - 0.5) * 8.5;
        const mA = chasmMeanderX(az);
        const mB = chasmMeanderX(bz);
        ax = mA - side * (0.5 + rand() * 5.8);
        ay = 52.5 + rand() * 11.5;
        bx = mB + side * (13.4 + rand() * 5.4);
        by = 5.5 + rand() * 21.0;
      } else if (kind === 2) {
        // 构型 2：远端日全食冕环外缘火山磁暴巨雷（严格贴合月轮外环迸发，不遮挡黑月盘）
        az = -116.0 - rand() * 4.5;
        bz = -88.0 - rand() * 18.0;
        const coronaAng = (side > 0 ? 0.14 : Math.PI - 0.14) + (rand() - 0.5) * 0.82;
        const rimR = 14.7 + rand() * 1.8;
        ax = Math.cos(coronaAng) * rimR;
        ay = 36.0 + Math.sin(coronaAng) * rimR;
        const mB = chasmMeanderX(bz);
        if (rand() < 0.55) {
          bx = mB + (rand() - 0.5) * 6.8;
          by = -5.85;
        } else {
          bx = mB + side * (13.8 + rand() * 6.5);
          by = 8.0 + rand() * 18.0;
        }
        hasCloudSheet = false;
      } else {
        // 构型 3：跨峡谷两侧万丈黑曜石断崖横向/斜向蛛网击穿电弧
        az = -48.0 - zBand * 13.0 - rand() * 10.0;
        bz = az + (rand() - 0.5) * 11.0;
        const mA = chasmMeanderX(az);
        const mB = chasmMeanderX(bz);
        ax = mA - side * (14.8 + rand() * 4.8);
        ay = 27.5 + rand() * 9.5;
        bx = mB + side * (14.2 + rand() * 4.8);
        by = 11.5 + rand() * 13.5;
        hasCloudSheet = false;
        hasGroundImpact = true;
      }

      const restrikeRoll = rand();
      const restrikeCount = restrikeRoll < 0.26 ? 0 : restrikeRoll < 0.74 ? 1 : 2;
      const restrike1Delay = 0.068 + rand() * 0.044;
      const restrike2Delay = restrike1Delay + 0.056 + rand() * 0.042;
      // 约束主锯齿轴绕主干旋转角落在屏幕横向主象限 (±37°)，避免沿相机视线纵深投影退化为直线
      const twist = (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 1.30 + Math.PI * 2;

      events.push({
        t0: item.t0,
        amp: item.amp,
        archetype: arch,
        ax,
        ay,
        az,
        bx,
        by,
        bz,
        twist,
        spread: 0.90 + rand() * 0.42,
        trunkRadius: (kind === 3 ? 0.058 : 0.072) + 0.042 * Math.min(1.15, item.amp) * (0.85 + 0.3 * rand()),
        leadDur: 0.022 + rand() * 0.015,
        restrikeCount,
        restrike1Delay,
        restrike2Delay,
        hasCloudSheet,
        hasGroundImpact,
      });
    }

    return events;
  }

  /**
   * 单次雷击事件的纯函数高速摄影时间动力学求值：
   * 云内前兆电离 (-25ms..0) -> 梯级先导极速劈落 (0..leadDur) -> 主回击白炽爆闪 -> 侧枝快速复合熄灭 & 箭式先导多重回击频闪 -> 串珠冷却余晖
   */
  private evalStrikeAt(ev: LightningStrikeEvent, t: number, out: ActiveStrikeEval): boolean {
    const tau = t - ev.t0;
    if (tau < -0.025 || tau > 0.40) return false;

    out.ev = ev;
    if (tau < 0) {
      // 雷云内部电荷集聚前兆暗闪（闪电尚未破云）
      const pre = clamp01((tau + 0.025) / 0.025);
      out.leaderFront = 0.0;
      out.trunkCore = 0.0;
      out.trunkHalo = 0.0;
      out.branchKeep = 0.0;
      out.beadedFade = 0.0;
      out.channelDrift = 0.0;
      out.cloudGlow = ev.amp * pre * pre * 0.52;
      out.impactGlow = 0.0;
      out.lightPower = out.cloudGlow * 0.18;
      return true;
    }

    if (tau < ev.leadDur) {
      // 阶段 1：梯级先导自上而下高速探路击穿
      const p = tau / ev.leadDur;
      out.leaderFront = p * 1.02;
      out.trunkCore = ev.amp * (0.52 + 0.32 * p);
      out.trunkHalo = ev.amp * (0.48 + 0.30 * p);
      out.branchKeep = 0.96;
      out.beadedFade = 0.0;
      out.channelDrift = 0.0;
      out.cloudGlow = ev.amp * (0.55 + 0.38 * p);
      out.impactGlow = 0.0;
      out.lightPower = ev.amp * (0.28 + 0.35 * p);
      return true;
    }

    // 阶段 2 & 3：接地主回击爆闪 + 箭式先导多重回击频闪 (Dart Re-strikes) + 持续电流热通道余晖
    const ut = tau - ev.leadDur;
    out.leaderFront = 1.02 + Math.min(0.48, ut * 4.2);

    const mainReturn = Math.exp(-ut / 0.035);
    const continuingCurrent = 0.26 * Math.exp(-ut / 0.125);

    let re1 = 0;
    if (ev.restrikeCount >= 1 && ut >= ev.restrike1Delay) {
      const d1 = ut - ev.restrike1Delay;
      re1 = 0.84 * (d1 < 0.007 ? d1 / 0.007 : Math.exp(-(d1 - 0.007) / 0.023));
    }
    let re2 = 0;
    if (ev.restrikeCount >= 2 && ut >= ev.restrike2Delay) {
      const d2 = ut - ev.restrike2Delay;
      re2 = 0.58 * (d2 < 0.007 ? d2 / 0.007 : Math.exp(-(d2 - 0.007) / 0.019));
    }

    const strokeSum = 1.24 * mainReturn + continuingCurrent + re1 + re2;
    out.trunkCore = ev.amp * strokeSum;
    out.trunkHalo = ev.amp * (1.05 * mainReturn + 0.36 * Math.exp(-ut / 0.145) + 0.85 * re1 + 0.60 * re2);
    // 未接地的分叉盲端在主回击后 40ms 内快速复合消隐，次级回击仅微弱感应重燃
    out.branchKeep = clamp01(Math.exp(-ut / 0.040) + 0.24 * re1 + 0.14 * re2);
    out.beadedFade = clamp01(ut / 0.18);
    out.channelDrift = ut * 0.62;
    out.cloudGlow = ev.amp * (0.96 * Math.exp(-ut / 0.082) + 0.62 * re1 + 0.42 * re2);
    out.impactGlow = ev.hasGroundImpact
      ? ev.amp * (1.38 * Math.exp(-ut / 0.046) + 0.72 * re1 + 0.48 * re2)
      : 0.0;
    out.lightPower = ev.amp * (1.42 * mainReturn + 0.24 * continuingCurrent + 0.92 * re1 + 0.62 * re2);

    return out.trunkCore > 0.004 || out.trunkHalo > 0.004 || out.cloudGlow > 0.006;
  }

  /**
   * 纯函数构建当前帧活跃闪电的 3D 体积光带实例缓冲、云层/落点耀斑与峡谷近场线光源坐标
   */
  private updateLightningSystem(t: number): number {
    const nEvents = this.strikeEvents.length;
    if (nEvents === 0) {
      this.lightningMesh.geometry.instanceCount = 0;
      this.lightningFlaresMesh.geometry.instanceCount = 0;
      this.uniforms.uBoltPower.value.set(0, 0);
      return 0;
    }

    // 检索 t + 0.025 之前最近可能处于活跃期 (-0.025s .. +0.40s) 的雷击事件
    let idx = lastIndex(this.strikeTimes, t + 0.026);
    let activeCount = 0;
    let scanGuard = 0;

    while (idx >= 0 && scanGuard < 14 && activeCount < MAX_ACTIVE_BOLTS) {
      const ev = this.strikeEvents[idx];
      if (t - ev.t0 > 0.41) break;
      const slot = (this.activeStrikeScratch[activeCount] ??= {
        ev,
        leaderFront: 0,
        trunkCore: 0,
        trunkHalo: 0,
        branchKeep: 0,
        beadedFade: 0,
        channelDrift: 0,
        cloudGlow: 0,
        impactGlow: 0,
        lightPower: 0,
      });
      if (this.evalStrikeAt(ev, t, slot)) {
        activeCount++;
      }
      idx--;
      scanGuard++;
    }

    if (activeCount === 0) {
      this.lightningMesh.geometry.instanceCount = 0;
      this.lightningFlaresMesh.geometry.instanceCount = 0;
      this.uniforms.uBoltPower.value.set(0, 0);
      return 0;
    }

    // 按瞬时光照功率选出最强的 2 道闪电驱动峡谷断崖与熔岩河近场 3D 照明
    let best0 = -1;
    let best1 = -1;
    for (let i = 0; i < activeCount; i++) {
      const p = this.activeStrikeScratch[i].lightPower;
      if (best0 < 0 || p > this.activeStrikeScratch[best0].lightPower) {
        best1 = best0;
        best0 = i;
      } else if (best1 < 0 || p > this.activeStrikeScratch[best1].lightPower) {
        best1 = i;
      }
    }

    if (best0 >= 0 && this.activeStrikeScratch[best0].lightPower > 1e-4) {
      const s0 = this.activeStrikeScratch[best0];
      const e0 = s0.ev;
      const reach0 = clamp01(s0.leaderFront);
      this.uniforms.uBoltA0.value.set(e0.ax, e0.ay, e0.az);
      this.uniforms.uBoltB0.value.set(
        lerp(e0.ax, e0.bx, reach0),
        lerp(e0.ay, e0.by, reach0),
        lerp(e0.az, e0.bz, reach0),
      );
      this.uniforms.uBoltPower.value.x = s0.lightPower;
    } else {
      this.uniforms.uBoltPower.value.x = 0;
    }

    if (best1 >= 0 && this.activeStrikeScratch[best1].lightPower > 1e-4) {
      const s1 = this.activeStrikeScratch[best1];
      const e1 = s1.ev;
      const reach1 = clamp01(s1.leaderFront);
      this.uniforms.uBoltA1.value.set(e1.ax, e1.ay, e1.az);
      this.uniforms.uBoltB1.value.set(
        lerp(e1.ax, e1.bx, reach1),
        lerp(e1.ay, e1.by, reach1),
        lerp(e1.az, e1.bz, reach1),
      );
      this.uniforms.uBoltPower.value.y = s1.lightPower;
    } else {
      this.uniforms.uBoltPower.value.y = 0;
    }

    // 组装体积电浆分形线段与天顶云闪/落雷爆点缓冲
    const startArr = this.boltStartAttr.array as Float32Array;
    const endArr = this.boltEndAttr.array as Float32Array;
    const paramArr = this.boltParamAttr.array as Float32Array;
    const energyArr = this.boltEnergyAttr.array as Float32Array;
    const metaArr = this.boltMetaAttr.array as Float32Array;

    const flarePosArr = this.flarePosAttr.array as Float32Array;
    const flareStyleArr = this.flareStyleAttr.array as Float32Array;

    let segCount = 0;
    let flareCount = 0;
    let maxPeakFlash = 0;

    for (let a = 0; a < activeCount; a++) {
      const st = this.activeStrikeScratch[a];
      const ev = st.ev;
      if (st.lightPower > maxPeakFlash) maxPeakFlash = st.lightPower;

      // 1) 写入苍穹雷源云底电离闪光团（仅高空云层落雷开启，不遮挡日全食黑月盘与峡谷中段）
      if (ev.hasCloudSheet && st.cloudGlow > 0.008 && flareCount < MAX_LIGHTNING_FLARES) {
        const fo = flareCount * 4;
        flarePosArr[fo] = ev.ax;
        flarePosArr[fo + 1] = ev.ay - 0.8;
        flarePosArr[fo + 2] = ev.az;
        flarePosArr[fo + 3] = 16.5 + 4.5 * ev.spread;
        flareStyleArr[fo] = st.cloudGlow;
        flareStyleArr[fo + 1] = 0.0; // 云内漫射电光
        flareStyleArr[fo + 2] = 2.35;
        flareStyleArr[fo + 3] = (ev.twist * 0.159155) % 1.0;
        flareCount++;
      }

      // 2) 写入落雷劈中岩峰/熔岩河的紧凑电浆爆裂耀斑
      if (st.impactGlow > 0.01 && flareCount < MAX_LIGHTNING_FLARES) {
        const fo = flareCount * 4;
        flarePosArr[fo] = ev.bx;
        flarePosArr[fo + 1] = ev.by + (ev.by < -4.0 ? 0.45 : 0.18);
        flarePosArr[fo + 2] = ev.bz;
        flarePosArr[fo + 3] = (ev.by < -4.0 ? 4.8 : 3.6) * (0.85 + 0.22 * ev.amp);
        flareStyleArr[fo] = st.impactGlow;
        flareStyleArr[fo + 1] = 1.0; // 落雷爆裂火球与星芒
        flareStyleArr[fo + 2] = ev.by < -4.0 ? 1.55 : 1.18;
        flareStyleArr[fo + 3] = ((ev.twist * 0.31831 + 0.37) % 1.0);
        flareCount++;
      }

      if (st.leaderFront <= 0.001 || (st.trunkCore <= 0.003 && st.trunkHalo <= 0.003)) continue;

      // 构造从起点 A 指向终点 B 的局部三维正交标架 (U, V, W)
      const wx = ev.bx - ev.ax;
      const wy = ev.by - ev.ay;
      const wz = ev.bz - ev.az;
      const boltLen = Math.hypot(wx, wy, wz) || 1.0;
      const dirX = wx / boltLen;
      const dirY = wy / boltLen;
      const dirZ = wz / boltLen;

      let refX = 0;
      let refY = 0;
      let refZ = 1;
      if (Math.abs(dirZ) > 0.86) {
        refX = 1;
        refZ = 0;
      }
      let b0x = dirY * refZ - dirZ * refY;
      let b0y = dirZ * refX - dirX * refZ;
      let b0z = dirX * refY - dirY * refX;
      const b0Len = Math.hypot(b0x, b0y, b0z) || 1e-5;
      b0x /= b0Len;
      b0y /= b0Len;
      b0z /= b0Len;

      const b1x = dirY * b0z - dirZ * b0y;
      const b1y = dirZ * b0x - dirX * b0z;
      const b1z = dirX * b0y - dirY * b0x;

      // 绕主轴旋转 twist 并按 spread 缩放横向分形曲折度
      const cosT = Math.cos(ev.twist);
      const sinT = Math.sin(ev.twist);
      const latScale = boltLen * ev.spread;
      const ux = (b0x * cosT + b1x * sinT) * latScale;
      const uy = (b0y * cosT + b1y * sinT) * latScale;
      const uz = (b0z * cosT + b1z * sinT) * latScale;
      const vx = (-b0x * sinT + b1x * cosT) * latScale;
      const vy = (-b0y * sinT + b1y * cosT) * latScale;
      const vz = (-b0z * sinT + b1z * cosT) * latScale;

      const arch = this.boltArchetypes[ev.archetype];
      const segs = arch.segments;
      const drift = st.channelDrift;
      // 冷却期电浆通道轻微收细并呈现炽热电离串珠节理
      const radiusShrink = 1.0 - 0.35 * st.beadedFade;

      for (let s = 0; s < segs.length; s++) {
        if (segCount >= MAX_LIGHTNING_SEGMENTS) break;
        const seg = segs[s];
        if (seg.u0 > st.leaderFront) continue;

        const isTrunk = seg.tier > 0.85;
        const tierFactor = isTrunk ? 1.0 : seg.tier * st.branchKeep * 1.45;
        if (tierFactor <= 0.012) continue;

        // 冷却尾段串珠状电离余晖调制
        const beadMod = isTrunk && st.beadedFade > 0.15
          ? 1.0 - st.beadedFade * 0.48 * (0.5 + 0.5 * Math.sin(seg.phase * 25.13))
          : 1.0;

        const segCore = st.trunkCore * tierFactor * beadMod;
        const segHalo = st.trunkHalo * (isTrunk ? 1.0 : tierFactor * 0.82);
        if (segCore <= 0.002 && segHalo <= 0.002) continue;

        // 热膨胀上升微漂移（两端锚点收敛，中段自然微颤）
        const env0 = Math.sin(clamp01(seg.az) * Math.PI);
        const env1 = Math.sin(clamp01(seg.bz) * Math.PI);
        const d0y = drift * env0 * (0.65 + 0.35 * Math.sin(seg.phase * 12.5));
        const d1y = drift * env1 * (0.65 + 0.35 * Math.cos(seg.phase * 12.5));
        const d0x = drift * 0.42 * env0 * Math.cos(seg.phase * 18.8 + ev.twist);
        const d1x = drift * 0.42 * env1 * Math.cos(seg.phase * 18.8 + ev.twist + 0.4);

        const pAx = ev.ax + wx * seg.az + ux * seg.ax + vx * seg.ay + d0x;
        const pAy = ev.ay + wy * seg.az + uy * seg.ax + vy * seg.ay + d0y;
        const pAz = ev.az + wz * seg.az + uz * seg.ax + vz * seg.ay;

        const pBx = ev.ax + wx * seg.bz + ux * seg.bx + vx * seg.by + d1x;
        const pBy = ev.ay + wy * seg.bz + uy * seg.bx + vy * seg.by + d1y;
        const pBz = ev.az + wz * seg.bz + uz * seg.bx + vz * seg.by;

        const i3 = segCount * 3;
        const i4 = segCount * 4;
        const i2 = segCount * 2;

        startArr[i3] = pAx;
        startArr[i3 + 1] = pAy;
        startArr[i3 + 2] = pAz;

        endArr[i3] = pBx;
        endArr[i3 + 1] = pBy;
        endArr[i3 + 2] = pBz;

        const baseR = ev.trunkRadius * radiusShrink;
        paramArr[i4] = Math.max(0.012, seg.w0 * baseR);
        paramArr[i4 + 1] = Math.max(0.008, seg.w1 * baseR);
        paramArr[i4 + 2] = seg.u0;
        paramArr[i4 + 3] = seg.u1;

        energyArr[i3] = segCore;
        energyArr[i3 + 1] = segHalo;
        energyArr[i3 + 2] = isTrunk ? 1.0 : seg.tier;

        metaArr[i2] = st.leaderFront;
        metaArr[i2 + 1] = seg.phase;

        segCount++;
      }
    }

    if (segCount > 0) {
      for (const attr of [
        this.boltStartAttr,
        this.boltEndAttr,
        this.boltParamAttr,
        this.boltEnergyAttr,
        this.boltMetaAttr,
      ]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, segCount * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
    this.lightningMesh.geometry.instanceCount = segCount;

    if (flareCount > 0) {
      for (const attr of [this.flarePosAttr, this.flareStyleAttr]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, flareCount * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
    this.lightningFlaresMesh.geometry.instanceCount = flareCount;

    return maxPeakFlash;
  }

  /**
   * 构建双侧连续雕刻峡谷断崖 + 22 座交错凸出的柱状玄武岩峭壁巨柱与天际峡门峰林
   */
  private buildCanyonWalls(seed: number): THREE.Mesh {
    const leftGeo = createSculptedChasmSideGeometry(-1, seed ^ 0x1357);
    const rightGeo = createSculptedChasmSideGeometry(1, seed ^ 0x2468);

    const leftWall = new THREE.Mesh(leftGeo, this.canyonMaterial);
    const rightWall = new THREE.Mesh(rightGeo, this.canyonMaterial);
    this.canyonGroup.add(leftWall, rightWall);

    // 3 种不同高宽比的无缝雕刻玄武岩柱原型，沿峡谷纵深错落排布形成真实遮挡视差与锯齿剪影
    const buttressGeos = [
      createBasaltButtressGeometry(4.6, 36.0, 5.4, 0.22, seed ^ 0x1111),
      createBasaltButtressGeometry(5.8, 42.0, 6.8, 0.28, seed ^ 0x2222),
      createBasaltButtressGeometry(3.8, 29.0, 4.5, 0.18, seed ^ 0x3333),
    ];

    const cliffRand = rng((seed ^ 0x99ef3311) >>> 0);
    const numPairs = 10;
    for (let i = 0; i < numPairs; i++) {
      const zBase = 14.0 - i * 14.8;
      for (const side of [-1, 1] as const) {
        const z = zBase - cliffRand() * 5.5;
        const meander = 2.35 * Math.sin(z * 0.041 + 0.7) + 1.15 * Math.cos(z * 0.089 + 2.1);
        const distFromCenter = 15.6 + cliffRand() * 6.4;
        const hScale = 0.82 + cliffRand() * 0.46;
        const wScale = 0.80 + cliffRand() * 0.32;

        const geo = buttressGeos[(i + (side > 0 ? 1 : 0)) % buttressGeos.length];
        const monolith = new THREE.Mesh(geo, this.canyonMaterial);
        monolith.position.set(
          side * distFromCenter + meander * 0.88,
          9.5 + (hScale - 0.85) * 14.0,
          z,
        );
        monolith.rotation.y = cliffRand() * Math.PI * 2;
        // 略微向峡谷内倾或外耸，营造险峻压迫感同时绝不侵入中央航道
        monolith.rotation.z = -side * (0.03 + cliffRand() * 0.07);
        monolith.scale.set(wScale, hScale, wScale);
        this.canyonGroup.add(monolith);
      }
    }

    // 远端夹峙日全食天穹的巨型玄武岩峡门双峰（Z = -112m）
    const gateGeo = createBasaltButtressGeometry(8.2, 54.0, 9.5, 0.34, seed ^ 0x77aa);
    for (const side of [-1, 1] as const) {
      const gatePeak = new THREE.Mesh(gateGeo, this.canyonMaterial);
      gatePeak.position.set(side * 25.5, 19.0, -112.0);
      gatePeak.rotation.y = side > 0 ? 0.8 : 2.3;
      gatePeak.rotation.z = -side * 0.08;
      this.canyonGroup.add(gatePeak);
    }

    return leftWall;
  }

  /**
   * 四组电影级运镜机位（canyon / corona / ridge / abyss）纯函数姿态求值：
   * 全部机位横坐标均跟随当前纵深 z 处的峡谷蜿蜒中心线 chasmMeanderX(z)，
   * 始终处于无巨石、无断崖悬挑、无玄武岩柱的中央净空走廊内，彻底杜绝摄像机穿入岩石内部。
   */
  private evalCameraPose(t: number, s: Shot, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const start = s.run?.start ?? s.start;
    const end = s.run?.end ?? s.end;
    const span = Math.max(0.8, end - start);
    const k = clamp01((t - start) / span);
    const e = inOutCubic(k);
    const dir = (stableShotSeed(s) & 1) === 0 ? 1 : -1;
    const variant = s.variant || 'canyon';

    if (variant === 'corona') {
      // 低机位大仰角直指日蚀天穹（沿蜿蜒中心安全走廊平滑推进，避开两侧悬浮巨石带）
      const z = lerp(-15.0, -28.0, e);
      const meander = chasmMeanderX(z);
      const x = meander + lerp(-1.5 * dir, 1.5 * dir, e);
      const y = 1.45 + 0.08 * Math.sin(t * 0.4);
      poseLookAt(pos, quat, x, y, z, 0, 34.0, -120.0);
      return CAM_FOV + 2.0;
    } else if (variant === 'ridge') {
      // 悬停于高位峡谷中轴净空区，俯瞰深渊熔金河与对岸层叠柱状玄武岩壁（|x - meander| <= 1.8m，严格处于巨石带内侧净空）
      const z = lerp(-24.0, -42.0, e);
      const meander = chasmMeanderX(z);
      const x = meander + lerp(1.8 * dir, 1.2 * dir, e);
      const y = lerp(22.5, 18.2, e);
      poseLookAt(pos, quat, x, y, z, meander - 2.2 * dir, 9.5, -96.0);
      return CAM_FOV - 2.0;
    } else if (variant === 'abyss') {
      // 深渊仰攻机位，贴近沸腾结壳熔金河面上方安全高度（与最高涌浪波峰保持 >= 1.3m 净空），仰望两侧黑曜石断崖与闪电
      const z = lerp(-8.0, -22.0, e);
      const meander = chasmMeanderX(z);
      const x = meander + lerp(-1.5 * dir, 1.5 * dir, e);
      const y = -3.45 + 0.05 * Math.sin(t * 0.6);
      poseLookAt(pos, quat, x, y, z, 0, 18.5, -88.0);
      return CAM_FOV + 4.0;
    } else {
      // canyon: 穿梭于蜿蜒黑曜石大裂谷中轴（默认）
      const z = lerp(12.0, -8.0, e);
      const meander = chasmMeanderX(z);
      const x = meander + lerp(-1.2 * dir, 1.2 * dir, e);
      const y = 4.6 + 0.10 * Math.sin(t * 0.35);
      poseLookAt(pos, quat, x, y, z, 0, 24.5, -120.0);
      return CAM_FOV;
    }
  }

  /** 同场景切点纯函数相机平滑过渡 */
  private updateCamera(t: number, shot: Shot): void {
    blendCameraPose(
      (tau, s, pos, quat) => this.evalCameraPose(tau, s, pos, quat),
      t,
      shot,
      this.camera,
      1.45,
    );
  }

  /** 二分查找单脉冲衰减响应 */
  private evalPulse(times: Float64Array, vals: Float32Array, t: number, decay: number): number {
    const i = lastIndex(times, t);
    if (i < 0) return 0;
    const one = (idx: number) => {
      if (idx < 0) return 0;
      const age = t - times[idx];
      if (age < 0 || age > decay * 4.5) return 0;
      const v = vals[idx];
      if (age < 0.02) return v * (age / 0.02);
      return v * Math.exp(-(age - 0.02) / decay);
    };
    return Math.max(one(i), one(i - 1));
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, fx } = ctx;
    const curSec = music.section(t);
    const label = curSec?.label ?? shot.section.label;
    const isDrop = label === 'drop';
    const isChorus = label === 'chorus';

    // 1. 相机更新并同步世界坐标至岩石与熔岩着色器
    this.updateCamera(t, shot);
    const camPos = this.camera.position;
    this.uniforms.uCamPos.value.copy(camPos);

    // 2. 音频包络与瞬态
    const kickPulse = this.evalPulse(this.kickTimes, this.kickAmps, t, 0.24);
    const snareFlash = this.evalPulse(this.snareTimes, this.snareAmps, t, 0.16);

    // Drop 冲击波强度
    let dropShock = 0;
    if (isDrop && curSec) {
      const dropAge = t - curSec.start;
      if (dropAge >= 0 && dropAge < 2.5) {
        dropShock = Math.exp(-dropAge / 0.75);
      }
    }

    // 3. 更新悬浮反重力碎裂黑曜石巨砾（严格钳制在峡谷岩壁与相机航道之间的安全净空带，零穿模）
    const dummy = this.reusableDummy;
    for (let i = 0; i < NUM_FLOATING_ROCKS; i++) {
      const rs = this.rockStates[i];
      const kickJolt = Math.sin(t * 32.0 + i) * 0.22 * kickPulse;
      const y = rs.y + Math.sin(t * 0.8 + rs.phase) * 0.45 + kickJolt;

      // Drop 冲击波仅在真实峡谷内壁安全余量内温和外推，绝不把巨石推入两侧断崖或玄武岩柱
      const wallSeed = rs.side < 0 ? this.wallSeedLeft : this.wallSeedRight;
      const exactWallDist = evalExactCanyonWallInnerAbsX(rs.z, y, rs.side, wallSeed);
      const wallLimit = Math.max(
        rs.laneX,
        exactWallDist - rs.maxRadius - 2.6,
      );
      const maxSafePush = Math.max(0.0, wallLimit - rs.laneX);
      const pushAbs = Math.min(dropShock * 1.10, maxSafePush);

      const meander = chasmMeanderX(rs.z);
      const wx = meander + rs.side * (rs.laneX + pushAbs);
      let wy = y;
      let wz = rs.z;

      // 相机近场球形安全护盾：若任何过渡运镜靠近巨石，仅沿高度 Y 与纵深 Z 平滑推开，绝不横向推入峡谷岩壁，100% 杜绝摄像机穿过石头内部
      const dx = wx - camPos.x;
      const dy = wy - camPos.y;
      const dz = wz - camPos.z;
      const safeCamDist = rs.maxRadius + 3.2;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < safeCamDist * safeCamDist) {
        const dist = Math.sqrt(Math.max(1e-4, distSq));
        const repel = safeCamDist - dist;
        wy += (dy >= -0.5 ? 1 : -1) * repel * 0.85;
        wz += (dz <= 0 ? -1 : 1) * repel * 0.65;
      }

      dummy.position.set(wx, wy, wz);
      dummy.rotation.set(t * rs.rotSpeed, t * rs.rotSpeed * 0.8, rs.phase);
      dummy.scale.set(rs.scaleX, rs.scaleY, rs.scaleZ);
      dummy.updateMatrix();
      this.rocksInstanced.setMatrixAt(i, dummy.matrix);
    }
    this.rocksInstanced.instanceMatrix.needsUpdate = true;

    // 4. 纯函数更新三维分形闪电树、天顶云闪、落雷爆点与峡谷近场闪电照明
    const boltPeak = this.updateLightningSystem(t);

    // 5. 更新 Drop 日冕冲击波环尺度（严格幂等归一）
    const shockScale = dropShock > 0.001 ? 1.0 + (1.0 - dropShock) * 22.0 : 1.0;
    this.shockwaveRingMesh.scale.set(shockScale, shockScale, 1.0);

    // 6. 全局 Uniforms
    this.uniforms.uTime.value = t;
    this.uniforms.uKickPulse.value = kickPulse;
    this.uniforms.uSnareFlash.value = Math.max(snareFlash, Math.min(1.4, boltPeak * 0.85));
    this.uniforms.uDropShock.value = dropShock;

    // 7. 后期调优（雷霆回击瞬间适度激发镜头辉光）
    fx.bloom = 0.32 + 0.18 * dropShock + 0.12 * Math.min(1.2, Math.max(snareFlash, boltPeak * 0.85));
    fx.vignette = 0.46;
    fx.letterbox = 0;

    // 8. 歌词
    const energy = isDrop ? 1.0 : isChorus ? 0.88 : 0.50;
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
