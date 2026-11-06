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

const NUM_FLOATING_ROCKS = 34;
const CAM_FOV = 50;
const NUM_BOLT_ARCHETYPES = 18;
const MAX_ACTIVE_BOLTS = 4;
const MAX_LIGHTNING_SEGMENTS = 1280;
const MAX_LIGHTNING_FLARES = 12;

interface RockInitState {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotSpeed: number;
  phase: number;
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
        uRockDark: this.uniforms.uRockDark,
        uDropShock: this.uniforms.uDropShock,
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
        uniform vec3 uRockDark;
        uniform float uDropShock;
        varying vec2 vUv;

        void main() {
          vec2 p = vUv - vec2(0.5);
          float r = length(p) * 2.0;
          // 保持原封面空间拓扑结构，叠加微妙的月表环形山暗调浮雕与日冕内缘背光
          vec3 coverRgb = texture2D(uCover, vUv).rgb;
          float lum = dot(coverRgb, vec3(0.299, 0.587, 0.114));
          float limbBacklight = smoothstep(0.76, 1.0, r);
          vec3 baseDisc = uRockDark * 0.26 + coverRgb * (0.11 + 0.05 * uDropShock) + vec3(lum * 0.035);
          vec3 col = baseDisc + uCoronaColor * limbBacklight * (0.24 + 0.25 * uDropShock);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, this.moonMaterial);
    this.moonMesh.position.set(0, 36, -120);
    this.scene.add(this.moonMesh);

    // 5. 狂暴日冕能量环与贝利珠耀斑 (Solar Corona Ring & Baily's Beads)
    const coronaGeo = new THREE.RingGeometry(moonRadius * 0.97, moonRadius * 2.85, 72);
    this.coronaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCoronaColor: this.uniforms.uCoronaColor,
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
        uniform float uTime;
        uniform vec3 uCoronaColor;
        uniform float uDropShock;
        uniform float uKickPulse;
        varying vec2 vUv;

        void main() {
          vec2 d = vUv - vec2(0.5);
          float r = length(d) * 2.0;
          float angle = atan(d.y, d.x);

          // 多频日冕等离子羽流丝缕
          float streamer = sin(angle * 12.0 + uTime * 2.2) * 0.15
                         + sin(angle * 27.0 - uTime * 3.6) * 0.08
                         + cos(angle * 43.0 + uTime * 1.4) * 0.04;
          float innerEdge = smoothstep(0.32, 0.37 + streamer * 0.09, r);
          float outerFalloff = pow(smoothstep(1.0, 0.36, r), 1.45);

          // Drop 瞬间边缘迸发贝利珠钻石环耀斑 (Baily's Beads)
          float beads = pow(max(0.0, sin(angle * 16.0 + uTime * 0.5)), 32.0) * uDropShock * 3.5;

          float intensity = innerEdge * outerFalloff * (1.25 + 0.65 * uKickPulse + 2.0 * uDropShock) + beads;
          vec3 col = uCoronaColor * (1.05 + beads * 1.5);

          gl_FragColor = vec4(col, clamp(intensity * 0.86, 0.0, 1.0));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.coronaMesh = new THREE.Mesh(coronaGeo, this.coronaMaterial);
    this.coronaMesh.position.set(0, 36, -119.8);
    this.scene.add(this.coronaMesh);

    // 6. 谷底结壳板块液态熔金河（联动真实落雷倒影与接触耀斑）
    const riverGeo = new THREE.PlaneGeometry(34, 190, 40, 80);
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
        uBoltA0: this.uniforms.uBoltA0,
        uBoltB0: this.uniforms.uBoltB0,
        uBoltA1: this.uniforms.uBoltA1,
        uBoltB1: this.uniforms.uBoltB1,
        uBoltPower: this.uniforms.uBoltPower,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
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
        uniform vec3 uBoltA0;
        uniform vec3 uBoltB0;
        uniform vec3 uBoltA1;
        uniform vec3 uBoltB1;
        uniform vec2 uBoltPower;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
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

        float evalRiverBoltGlint(vec3 wp, float slagGrain, vec3 boltB, float power) {
          if (power <= 1e-4) return 0.0;
          float dx = wp.x - boltB.x;
          float dz = wp.z - boltB.z;
          // 熔渣玻璃质结壳拉出纵向高光倒影条 + 落雷击中河面时的环形电浆激波亮斑
          float reflStreak = exp(-dx * dx * 0.045 - dz * dz * 0.0022) * (0.45 + 0.75 * slagGrain);
          float strikeSplash = (boltB.y < -3.5 ? 1.0 : 0.22) * exp(-(dx * dx + dz * dz) * 0.032);
          return power * (reflStreak * 0.55 + strikeSplash * 1.45);
        }

        void main() {
          // 随峡谷蜿蜒的主熔岩河道中心线
          float meander = 2.35 * sin(vWorldPos.z * 0.041 + 0.7) + 1.15 * cos(vWorldPos.z * 0.089 + 2.1);
          float bankDist = abs(vWorldPos.x - meander);

          // 双层对流扭曲：模拟黑色凝固玄武岩浮渣结壳与炽白/金红撕裂熔岩缝隙
          vec2 flowUv = vec2(vWorldPos.x * 0.24, vWorldPos.z * 0.14 - uTime * 0.42);
          float warp = fbm2D(flowUv * 0.85 + vec2(0.0, -uTime * 0.18));
          float ridge1 = 1.0 - abs(noise2D(flowUv * 1.8 + warp * 2.6) * 2.0 - 1.0);
          float ridge2 = 1.0 - abs(noise2D(flowUv * 3.9 - warp * 1.9 + vec2(4.2, uTime * 0.25)) * 2.0 - 1.0);
          float slagGrain = fbm2D(flowUv * 7.5);

          // 河道中央高温翻涌，靠近两岸冷却结壳加厚
          float centerHeat = smoothstep(10.5, 1.8, bankDist);
          float fissure = pow(clamp(ridge1 * 0.68 + ridge2 * 0.32, 0.0, 1.0), 2.4) * (0.45 + 0.75 * centerHeat);

          vec3 cooledCrust = uRockDark * (0.35 + 0.55 * slagGrain);
          vec3 hotCore = mix(uMagmaColor, uCoronaColor, clamp(fissure * 0.55, 0.0, 0.65)) * (1.75 + 0.95 * uKickPulse);
          vec3 col = mix(cooledCrust, hotCore, smoothstep(0.18, 0.72, fissure + centerHeat * 0.22));

          // 叠加真实闪电在黑曜石结壳河面上的电弧高光倒影
          float boltGlint = evalRiverBoltGlint(vWorldPos, slagGrain, uBoltB0, uBoltPower.x)
                          + evalRiverBoltGlint(vWorldPos, slagGrain, uBoltB1, uBoltPower.y);
          col += mix(uLightningColor, vec3(0.98), 0.42) * boltGlint;

          // 远景热霾雾化收敛
          float dist = length(vWorldPos - uCamPos);
          float fogFactor = 1.0 - exp(-pow(dist * 0.0072, 1.85));
          col = mix(col, uFogColor + uMagmaColor * 0.06, clamp(fogFactor, 0.0, 0.95));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.magmaRiverMesh = new THREE.Mesh(riverGeo, this.magmaRiverMaterial);
    this.magmaRiverMesh.rotation.x = -Math.PI / 2;
    this.magmaRiverMesh.position.set(0, -6.0, -62);
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
    const rockGeo = createFracturedBoulderGeometry(seed ^ 0x51a9);
    this.rocksInstanced = new THREE.InstancedMesh(rockGeo, this.boulderMaterial, NUM_FLOATING_ROCKS);
    this.rocksInstanced.frustumCulled = false;
    for (let i = 0; i < NUM_FLOATING_ROCKS; i++) {
      const rx = (seedRand() < 0.5 ? -1 : 1) * (5.2 + seedRand() * 7.2);
      const ry = 0.2 + seedRand() * 23.0;
      const rz = -12.0 - seedRand() * 92.0;
      const baseScale = 0.72 + seedRand() * 1.55;
      this.rockStates.push({
        x: rx,
        y: ry,
        z: rz,
        scaleX: baseScale * (0.82 + seedRand() * 0.42),
        scaleY: baseScale * (0.70 + seedRand() * 0.55),
        scaleZ: baseScale * (0.82 + seedRand() * 0.42),
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
    const shockGeo = new THREE.RingGeometry(1.0, 3.5, 48);
    this.shockwaveMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uDropShock: this.uniforms.uDropShock,
        uCoronaColor: this.uniforms.uCoronaColor,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDropShock;
        uniform vec3 uCoronaColor;
        varying vec2 vUv;
        void main() {
          float rim = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float alpha = pow(max(0.0, rim), 2.0) * uDropShock;
          gl_FragColor = vec4(uCoronaColor * 2.0, alpha * 0.85);
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
        const distFromCenter = 14.2 + cliffRand() * 6.8;
        const hScale = 0.82 + cliffRand() * 0.46;
        const wScale = 0.85 + cliffRand() * 0.38;

        const geo = buttressGeos[(i + (side > 0 ? 1 : 0)) % buttressGeos.length];
        const monolith = new THREE.Mesh(geo, this.canyonMaterial);
        monolith.position.set(
          side * distFromCenter + meander * 0.75,
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

  /** 四组电影级运镜机位（canyon / corona / ridge / abyss）纯函数姿态求值 */
  private evalCameraPose(t: number, s: Shot, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const start = s.run?.start ?? s.start;
    const end = s.run?.end ?? s.end;
    const span = Math.max(0.8, end - start);
    const k = clamp01((t - start) / span);
    const e = inOutCubic(k);
    const dir = (stableShotSeed(s) & 1) === 0 ? 1 : -1;
    const variant = s.variant || 'canyon';

    if (variant === 'corona') {
      // 低机位大仰角穿透悬浮巨石直指日蚀天穹
      const x = lerp(-3.2 * dir, 3.2 * dir, e);
      const y = 1.45 + 0.08 * Math.sin(t * 0.4);
      const z = lerp(-15.0, -28.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 34.0, -120.0);
      return CAM_FOV + 2.0;
    } else if (variant === 'ridge') {
      // 悬停于高位嶙峋断崖内侧边缘（避开岩体穿模），俯瞰深渊熔金河与对岸层叠柱状玄武岩壁
      const x = lerp(8.6 * dir, 6.4 * dir, e);
      const y = lerp(22.5, 18.2, e);
      const z = lerp(-24.0, -42.0, e);
      poseLookAt(pos, quat, x, y, z, -2.5 * dir, 9.5, -96.0);
      return CAM_FOV - 2.0;
    } else if (variant === 'abyss') {
      // 深渊仰攻机位，贴近沸腾结壳熔金河面，仰望两侧刀削斧劈的黑曜石断崖与闪电
      const x = lerp(-2.0 * dir, 2.0 * dir, e);
      const y = -3.8 + 0.05 * Math.sin(t * 0.6);
      const z = lerp(-8.0, -22.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 18.5, -88.0);
      return CAM_FOV + 4.0;
    } else {
      // canyon: 穿梭于蜿蜒黑曜石大裂谷中轴（默认）
      const x = lerp(-1.4 * dir, 1.4 * dir, e);
      const y = 4.6 + 0.10 * Math.sin(t * 0.35);
      const z = lerp(12.0, -8.0, e);
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
    this.uniforms.uCamPos.value.copy(this.camera.position);

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

    // 3. 更新悬浮反重力碎裂黑曜石巨砾（底鼓高频震颤与 Drop 冲击波向外推开）
    const dummy = this.reusableDummy;
    for (let i = 0; i < NUM_FLOATING_ROCKS; i++) {
      const rs = this.rockStates[i];
      const kickJolt = Math.sin(t * 32.0 + i) * 0.35 * kickPulse;
      const pushX = (rs.x > 0 ? 1 : -1) * dropShock * 3.5;
      const y = rs.y + Math.sin(t * 0.8 + rs.phase) * 0.6 + kickJolt;

      dummy.position.set(rs.x + pushX, y, rs.z);
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
