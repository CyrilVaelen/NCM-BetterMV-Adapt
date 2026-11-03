// 花坛喷泉 (Courtyard Musical Fountain): 现代流光音乐喷泉与双层封面色花海庭院场景。
// 空间构图（由内向外四层结构，纯时间函数 f(t) 驱动，零状态累积，支持任意拖动与离线 MP4 导出）：
// 1. 核心三阶水舞：池心冲天主水柱与内冠副柱（随底鼓与段落能量冲起）+ 中圈 12 组音阶抛物线交织水拱（随主旋律/键盘和弦腾跃追逐）
//    + 外圈 36 道环状波浪水冠（随频谱与军鼓如水莲盛开）；
// 2. 池面与琉璃封面：开阔圆形镜面水池，水底中心镶嵌圆形琉璃质感的专辑封面徽章，透过清澈水波与解析式落水同心涟漪自然折射，
//    实时映出上方发光水幕、花海灯火与反拍开镲星芒焦散；
// 3. 双层环绕花海：温润石砌双层阶梯花坛内嵌隐藏洗墙灯带，GPU 实例化渲染约 4200 朵双层曲面透光立体花簇与 3000 簇绿植叶片，
//    随微风摇曳并在底鼓光波掠过时由内向外泛起流光花浪；
// 4. 全域封面色彩与明暗自适应：读取封面的色相、饱和度与整体明度分布，自动驱动天幕、水雾光束、水下射灯与花海深浅色阶。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';
import { LyricRig } from './lyricRig.ts';
import { voiceFaces } from './lyricBlock.ts';
import { lastIndex, type Music } from '../director/music.ts';
import type { Palette } from '../render/palette.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl, tuneCoverStop } from './coverTone.ts';

/** 池面最大并发落水涟漪数量（纯解析求值 + uZero 屏障，保障 D3D11 秒级编译与高帧率） */
const MAX_RIPPLES = 14;
/** 抛物线水拱单次脉冲飞行时长（秒），水包到达终点瞬间在池面落点激起涟漪 */
const ARC_FLIGHT = 0.56;
/** 水池水面半径与池底琉璃封面半径（世界单位） */
const POOL_RADIUS = 8.55;
const MEDALLION_RADIUS = 5.32;
const CAM_FOV = 48;

interface ArcLaunchEvent {
  /** 发射时刻（秒） */
  t: number;
  /** 半音音级 [0..11] */
  note: number;
  /** 脉冲强度 [0..1.2] */
  amp: number;
  /** 内外圈标志：0 为外圈向内交织水拱，1 为内圈向外绽放水拱 */
  ring: number;
}

interface SplashRippleEvent {
  /** 涟漪起始时刻（秒） */
  t: number;
  /** 池面世界坐标 X */
  x: number;
  /** 池面世界坐标 Z */
  z: number;
  /** 最大扩散半径 */
  maxRadius: number;
  /** 振幅 */
  amp: number;
  /** 衰减时间常数 */
  tau: number;
  /** 空间波数 */
  freq: number;
}

/** 计算专辑封面整体感知明度（0..1），使天幕、庭院环境光与石材明暗完全贴合封面气质 */
function computeCoverLuminance(pixels: Uint8ClampedArray, fallbackLight: boolean): number {
  if (!pixels || pixels.length < 16) return fallbackLight ? 0.68 : 0.28;
  const totalPx = pixels.length >> 2;
  const step = Math.max(1, Math.floor(totalPx / 2048));
  let sum = 0;
  let count = 0;
  for (let p = 0; p < totalPx; p += step) {
    const idx = p << 2;
    const r = pixels[idx] / 255;
    const g = pixels[idx + 1] / 255;
    const b = pixels[idx + 2] / 255;
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    count++;
  }
  return count > 0 ? sum / count : 0.35;
}

/** 预提取全曲抛物线水拱发射事件与落水涟漪时间轴（100% 确定性纯函数） */
function buildFountainEvents(music: Music, seed: number): {
  arcEvents: ArcLaunchEvent[];
  arcTimes: Float64Array;
  ripples: SplashRippleEvent[];
  rippleTimes: Float64Array;
} {
  const random = rng((seed ^ 0x5f09a41c) >>> 0);
  const arcEvents: ArcLaunchEvent[] = [];
  const ripples: SplashRippleEvent[] = [];

  const leadHits = music.roleHits('lead', 0, music.duration);
  const synthHits = music.roleHits('synthStab', 0, music.duration);
  const keyHits = music.hitsBetween('keys', 0, music.duration);
  const bassHits = music.roleHits('bassStab', 0, music.duration);

  const melodicRaw: Array<{ t: number; s: number; ring: number }> = [];
  for (const [t, s] of leadHits) if (s >= 0.18) melodicRaw.push({ t, s: s * 1.08, ring: 0 });
  for (const [t, s] of synthHits) if (s >= 0.18) melodicRaw.push({ t, s: s * 0.96, ring: 1 });
  for (const [t, s] of keyHits) if (s >= 0.20) melodicRaw.push({ t, s: s * 0.90, ring: 0 });
  if (melodicRaw.length < 16) {
    for (const [t, s] of bassHits) if (s >= 0.20) melodicRaw.push({ t, s: s * 0.85, ring: 1 });
    for (const [t, s] of music.a.hits.accent ?? []) if (s >= 0.22) melodicRaw.push({ t, s: s * 0.85, ring: 0 });
  }
  melodicRaw.sort((a, b) => a.t - b.t);

  let lastT = -1;
  let seq = 0;
  for (const item of melodicRaw) {
    if (item.t - lastT < 0.085) continue;
    lastT = item.t;
    const pitch = music.pitchAt(item.t);
    const note = ((pitch.note % 12) + 12) % 12;
    const ring = (seq + item.ring) % 2;
    seq++;
    const amp = Math.min(1.2, 0.48 + 0.65 * item.s);
    arcEvents.push({ t: item.t, note, amp, ring });

    // 水拱脉冲经过 ARC_FLIGHT 秒落入水面，在精确落水点激起同心涟漪
    const baseAngle = (note / 12) * Math.PI * 2 + (ring === 0 ? 0 : Math.PI / 12);
    const landAngle = baseAngle + (ring === 0 ? 0.52 : -0.44);
    const landR = ring === 0 ? 1.92 : 6.72;
    ripples.push({
      t: item.t + ARC_FLIGHT,
      x: Math.cos(landAngle) * landR,
      z: Math.sin(landAngle) * landR,
      maxRadius: 2.5 + 1.5 * item.s + 0.4 * random(),
      amp: 0.44 + 0.42 * item.s,
      tau: 0.78 + 0.24 * random(),
      freq: 5.6 + 1.8 * random(),
    });
  }

  // 底鼓在池心主水柱基座激起宽幅扩张重力波
  let lastKickRipple = -1;
  for (const [t, s] of music.a.hits.kick ?? []) {
    if (s < 0.26 || t - lastKickRipple < 0.22) continue;
    lastKickRipple = t;
    ripples.push({
      t,
      x: (random() - 0.5) * 0.35,
      z: (random() - 0.5) * 0.35,
      maxRadius: 7.8,
      amp: 0.56 + 0.36 * s,
      tau: 1.08,
      freq: 3.6,
    });
  }

  ripples.sort((a, b) => a.t - b.t);
  return {
    arcEvents,
    arcTimes: Float64Array.from(arcEvents, e => e.t),
    ripples,
    rippleTimes: Float64Array.from(ripples, r => r.t),
  };
}

// ── 程序化高精度几何体构建 ─────────────────────────────────────────────────────────────────────────────────────────

/** 构建单朵双层 11 瓣杯状曲面花朵几何体（含内圈 5 瓣、外圈 6 瓣与中心花蕊，带自定义 aPetal 属性） */
function buildSculptedFlowerGeometry(): THREE.InstancedBufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const petalMeta: number[] = []; // x: u(-1..1), y: v(0..1 根到尖), z: 层级(0外瓣, 1内瓣, 2花蕊)
  const indices: number[] = [];

  const addPetal = (angle: number, length: number, width: number, lift: number, curl: number, layer: number) => {
    const base = positions.length / 3;
    const rows = 4; // 0..3
    const cols = 3; // 左、中脊、右
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);

    for (let r = 0; r < rows; r++) {
      const v = r / (rows - 1);
      // 花瓣宽度呈饱满水滴形：中部鼓起、尖端柔润收拢
      const wProfile = Math.sin(Math.pow(v, 0.72) * Math.PI * 0.92) * width + 0.018 * (1 - v);
      // 纵向杯状托举与尖端优雅微卷
      const radial = 0.035 + v * length;
      const yCurve = lift * Math.sin(v * Math.PI * 0.68) - curl * v * v * v + 0.02;

      for (let c = 0; c < cols; c++) {
        const u = (c / (cols - 1)) * 2 - 1; // -1, 0, +1
        // 横向内凹成碗状花瓣，拒绝扁平纸片感
        const cup = (1 - u * u) * -0.022 * Math.sin(v * Math.PI) + Math.abs(u) * 0.018 * (1 - v * 0.4);
        const lx = radial * ca - u * wProfile * sa;
        const lz = radial * sa + u * wProfile * ca;
        const ly = yCurve + cup;
        positions.push(lx, ly, lz);

        // 光滑解析法线（略微向外上方舒展，强化边缘次表面透光）
        const nx = ca * 0.32 - sa * u * 0.28;
        const nz = sa * 0.32 + ca * u * 0.28;
        const ny = 0.88 - 0.25 * v;
        const inv = 1 / Math.hypot(nx, ny, nz);
        normals.push(nx * inv, ny * inv, nz * inv);
        petalMeta.push(u, v, layer);
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const i0 = base + r * cols + c;
        const i1 = i0 + 1;
        const i2 = i0 + cols;
        const i3 = i2 + 1;
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }
  };

  // 外圈 6 瓣舒展托底
  for (let k = 0; k < 6; k++) {
    addPetal((k / 6) * Math.PI * 2, 0.22, 0.105, 0.095, 0.038, 0);
  }
  // 内圈 5 瓣杯状错位簇拥
  for (let k = 0; k < 5; k++) {
    addPetal((k / 5) * Math.PI * 2 + 0.31, 0.165, 0.086, 0.135, 0.015, 1);
  }

  // 中心饱满花蕊冠（6 边形微凸圆顶）
  const centerIdx = positions.length / 3;
  positions.push(0, 0.085, 0);
  normals.push(0, 1, 0);
  petalMeta.push(0, 0, 2);
  const stamenSegs = 6;
  for (let k = 0; k <= stamenSegs; k++) {
    const a = (k / stamenSegs) * Math.PI * 2;
    positions.push(Math.cos(a) * 0.052, 0.052, Math.sin(a) * 0.052);
    normals.push(Math.cos(a) * 0.45, 0.89, Math.sin(a) * 0.45);
    petalMeta.push(0, 1, 2);
  }
  for (let k = 0; k < stamenSegs; k++) {
    indices.push(centerIdx, centerIdx + 1 + k + 1, centerIdx + 1 + k);
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aPetal', new THREE.Float32BufferAttribute(petalMeta, 3));
  geo.setIndex(indices);
  return geo;
}

/** 构建单簇 5 叶弧形舒展草本绿植衬底几何体 */
function buildFoliageClusterGeometry(): THREE.InstancedBufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const leafUv: number[] = []; // u, v
  const indices: number[] = [];

  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const base = positions.length / 3;
    const angle = (b / blades) * Math.PI * 2 + (b % 2) * 0.22;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const len = 0.34 + (b % 3) * 0.06;
    const wid = 0.085;
    const archH = 0.16 + (b % 2) * 0.05;

    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const v = r / (rows - 1);
      // 叶片中部舒展饱满，叶尖自然收尖至 0，彻底消除方形截断感
      const w = Math.sin(Math.pow(v, 0.62) * Math.PI) * wid * (1 - 0.15 * v);
      const dist = 0.02 + v * len;
      const y = archH * Math.sin(v * Math.PI * 0.76) - 0.045 * v * v;
      for (let s = -1; s <= 1; s += 2) {
        const lx = dist * ca - s * w * sa;
        const lz = dist * sa + s * w * ca;
        positions.push(lx, y, lz);
        const nx = ca * 0.25 - sa * s * 0.28;
        const nz = sa * 0.25 + ca * s * 0.28;
        const ny = 0.90;
        const inv = 1 / Math.hypot(nx, ny, nz);
        normals.push(nx * inv, ny * inv, nz * inv);
        leafUv.push(s * 0.5 + 0.5, v);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      const i0 = base + r * 2;
      indices.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
    }
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(leafUv, 2));
  geo.setIndex(indices);
  return geo;
}

/** 构建单朵微弧面水滴形飘飞花瓣几何体（配合片元有机花瓣轮廓裁剪，消除多边形硬边） */
function buildSinglePetalGeometry(): THREE.InstancedBufferGeometry {
  const positions = [
    -0.052, 0.006, -0.068,
     0.052, 0.006, -0.068,
    -0.056, 0.016,  0.000,
     0.056, 0.016,  0.000,
    -0.048, -0.006, 0.068,
     0.048, -0.006, 0.068,
  ];
  const uvs = [0, 0, 1, 0, 0, 0.5, 1, 0.5, 0, 1, 1, 1];
  const indices = [0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5];
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 构建 5 翼黄金角错位修长流线水束簇几何体（任意平视或俯瞰角度均纤秀立体，无扁平纸片或肥大圆锥感） */
function buildWaterColumnGeometry(): THREE.InstancedBufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = []; // x: 横向[0..1], y: 高度[0..1]
  const indices: number[] = [];

  const planes = 5;
  const ySegs = 28;
  for (let p = 0; p < planes; p++) {
    const base = positions.length / 3;
    const ang = (p / planes) * Math.PI + (p % 2) * 0.11;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const widthVar = 0.88 + 0.22 * ((p * 3) % 5) / 4;
    for (let y = 0; y <= ySegs; y++) {
      const v = y / ySegs;
      // 喷口纤细凝练，中段修长挺拔，仅顶端受重力自然微散成细碎水珠冠
      const halfW = (0.085 + 0.125 * Math.pow(v, 0.88) + 0.085 * v * v * v) * widthVar;
      for (let s = -1; s <= 1; s += 2) {
        positions.push(ca * s * halfW, v, sa * s * halfW);
        uvs.push(s * 0.5 + 0.5, v);
      }
    }
    for (let y = 0; y < ySegs; y++) {
      const i0 = base + y * 2;
      indices.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
    }
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** 构建屏幕朝向展宽的抛物线水晶水束基础网格（沿轨迹参数 s ∈ [0..1] 加密细分 56 段，曲线丝滑圆润） */
function buildParabolicRibbonGeometry(segs = 56): THREE.InstancedBufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = []; // x: side(0..1), y: s(0..1)
  const indices: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    positions.push(-1, s, 0, 1, s, 0);
    uvs.push(0, s, 1, s);
    if (i < segs) {
      const b = i * 2;
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** 构建双层环绕石砌花坛与水池边沿旋转体几何体（从池壁 r=8.32 起步，彻底消除 r=0 极点退化三角形） */
function buildCourtyardStoneGeometry(): THREE.BufferGeometry {
  // 轮廓点：[radius, y, zone]  zone: 1=水池挑檐石栏, 2=隐藏洗墙灯槽, 3=花坛坡面植壤, 4=外围庭院石坪
  const profile: Array<[number, number, number]> = [
    [8.32, -0.38, 1],
    [8.46, -0.04, 1],
    [8.42, 0.34, 1],
    [8.72, 0.44, 1],
    [8.98, 0.42, 2], // 一层内侧洗墙灯槽
    [9.06, 0.34, 3], // 一层花海内沿
    [11.78, 0.68, 3], // 一层花海外沿微抬坡面
    [11.88, 0.72, 1],
    [11.96, 1.06, 2], // 二层阶梯隐藏灯带
    [12.16, 1.16, 1],
    [12.30, 1.02, 3], // 二层花海内沿
    [15.82, 1.38, 3], // 二层花海外沿环抱坡面
    [16.05, 1.42, 1],
    [16.32, 0.92, 1],
    [16.55, -0.12, 4],
    [28.0, -0.18, 4],
    [56.0, -0.24, 4],
  ];

  const radialSegs = 96;
  const positions: number[] = [];
  const normals: number[] = [];
  const zones: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < profile.length; i++) {
    const [r, y, zone] = profile[i];
    const prev = profile[Math.max(0, i - 1)];
    const next = profile[Math.min(profile.length - 1, i + 1)];
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    // 轮廓切线 (dr, dy) 的上外法线为 (-dy, dr)
    let nr = -dy;
    let ny = dr;
    const nl = Math.hypot(nr, ny) || 1;
    nr /= nl;
    ny /= nl;

    for (let s = 0; s <= radialSegs; s++) {
      const u = s / radialSegs;
      const theta = u * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      positions.push(r * ct, y, r * st);
      normals.push(nr * ct, ny, nr * st);
      zones.push(zone);
      uvs.push(u * 12, r * 0.25);
    }
  }

  const ringStride = radialSegs + 1;
  for (let i = 0; i < profile.length - 1; i++) {
    for (let s = 0; s < radialSegs; s++) {
      const a = i * ringStride + s;
      const b = a + ringStride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aZone', new THREE.Float32BufferAttribute(zones, 1));
  geo.setIndex(indices);
  return geo;
}

// ── GLSL 着色器（模块级静态常量，全链路零 NaN/Inf 防护，保障 WebGL 着色器池跨曲目零重编译） ────────────────────────

const GLSL_NOISE = /* glsl */ `
float safePow(float b, float e) {
  return pow(max(b, 1e-5), e);
}
vec3 safeNorm(vec3 v) {
  float l = length(v);
  return l > 1e-5 ? v / l : vec3(0.0, 1.0, 0.0);
}
float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm3(vec2 p) {
  float v = 0.0;
  v += 0.55 * vnoise(p);
  v += 0.30 * vnoise(p * 2.07 + vec2(1.7, 9.2));
  v += 0.15 * vnoise(p * 4.13 + vec2(8.3, 2.8));
  return v;
}
// 双层平滑干涉水底光学焦散网（连续液态光网，无孤立噪点）
float waterCausticNet(vec2 p, float t) {
  vec2 q1 = p * 2.15 + vec2(t * 0.42, -t * 0.31);
  vec2 q2 = vec2(p.x * 1.65 - p.y * 1.48, p.x * 1.48 + p.y * 1.65) - vec2(t * 0.36, t * 0.44);
  float w1 = abs(sin(q1.x + 0.65 * sin(q1.y * 1.3)) + cos(q1.y + 0.65 * cos(q1.x * 1.2)));
  float w2 = abs(sin(q2.x + 0.55 * cos(q2.y * 1.4)) + cos(q2.y - 0.55 * sin(q2.x * 1.3)));
  float c1 = 1.0 - smoothstep(0.0, 0.52, w1 * 0.5);
  float c2 = 1.0 - smoothstep(0.0, 0.56, w2 * 0.5);
  return safePow(c1 * 0.58 + c2 * 0.42, 2.2);
}
`;

// 1. 封面色调天穹、月华/晴空柔光区与远景花园散景穹顶
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uMistGlow;
uniform float uTime;
uniform float uFlow;
uniform float uCenterSurge;
uniform float uSidechain;
uniform float uCoverMood;
varying vec3 vDir;
${GLSL_NOISE}
void main() {
  vec3 d = safeNorm(vDir);
  float elev = clamp(d.y, -0.15, 1.0);
  float hMix1 = smoothstep(-0.04, 0.28, elev);
  float hMix2 = smoothstep(0.20, 0.80, elev);
  vec3 col = mix(uSkyHorizon, uSkyMid, hMix1);
  col = mix(col, uSkyTop, hMix2);

  // 庭院正前方高空柔和月华/云隙天光漫射亮区（为下方水池提供物理自洽的天光反射源）
  vec3 skyLightDir = safeNorm(vec3(0.14, 0.42, -0.89));
  float keyGlow = safePow(max(0.0, dot(d, skyLightDir)), 5.5);
  col += mix(uMistGlow, vec3(0.96, 0.98, 1.0), 0.45) * keyGlow * (0.28 + 0.18 * uCoverMood);

  // 随封面色流动的轻柔庭院流云与水雾霞光
  float az = atan(d.x, -d.z);
  vec2 cloudUv = vec2(az * 2.2 + uFlow * 0.035, elev * 3.8 - uFlow * 0.015);
  float clouds = fbm3(cloudUv);
  float cloudBand = smoothstep(0.02, 0.35, elev) * (1.0 - smoothstep(0.45, 0.90, elev));
  col += mix(uSkyHorizon, uMistGlow, 0.45) * smoothstep(0.42, 0.85, clouds) * cloudBand * (0.22 + 0.16 * uCoverMood) * uSidechain;

  // 喷泉中心冲天水柱激起的天际丁达尔水雾光晕
  float centerGlow = exp(-abs(d.x) * 3.2) * exp(-max(0.0, elev - 0.10) * 3.6) * smoothstep(-0.08, 0.08, elev);
  col += uMistGlow * centerGlow * (0.14 + 0.24 * uCenterSurge) * uSidechain;

  // 远景柔焦花园树冠剪影与浪漫庭院水雾地平线
  float treeHeight = 0.045 + 0.038 * fbm3(vec2(az * 4.5, 1.7)) + 0.018 * sin(az * 11.0);
  float canopyMask = 1.0 - smoothstep(treeHeight - 0.028, treeHeight + 0.035, elev);
  vec3 canopyShade = mix(uSkyTop * 0.52, uSkyMid * 0.72, 0.45);
  col = mix(col, canopyShade, canopyMask * smoothstep(-0.08, 0.01, elev) * 0.62);

  // 地平线空气透视柔光晨雾/暮霭
  float horizonMist = exp(-safePow(max(0.0, elev + 0.01) / 0.085, 2.0));
  col = mix(col, mix(uSkyHorizon, uMistGlow, 0.38), horizonMist * (0.32 + 0.14 * uCenterSurge));

  // 远景庭院拱廊柔和散景灯火与高空微光星尘
  float horizonBand = exp(-safePow(abs(elev - 0.026) / 0.034, 2.0));
  float archLights = safePow(clamp(0.5 + 0.5 * cos(az * 20.0), 0.0, 1.0), 10.0) * (0.65 + 0.35 * sin(az * 7.0 + uTime * 0.8));
  col += uMistGlow * horizonBand * archLights * max(0.0, 0.30 - 0.10 * uCoverMood) * uSidechain;

  vec2 starGrid = vec2(az * 95.0, elev * 95.0);
  float starCell = hash21(floor(starGrid));
  if (starCell > 0.986 && elev > 0.12) {
    float dist = length(fract(starGrid) - 0.5);
    float twinkle = 0.65 + 0.35 * sin(uTime * 2.4 + starCell * 40.0);
    col += uMistGlow * (1.0 - smoothstep(0.05, 0.34, dist)) * twinkle * max(0.0, 0.52 - 0.35 * uCoverMood);
  }

  gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(10.0)), 1.0);
}
`;

// 2. 双层环形石砌花坛、湿润水岸石栏与隐藏洗墙灯带
const STONE_VERT = /* glsl */ `
attribute float aZone;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vZone;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec3 wn = mat3(modelMatrix) * normal;
  float nl = length(wn);
  vNormal = nl > 1e-5 ? wn / nl : vec3(0.0, 1.0, 0.0);
  vUv = uv;
  vZone = aZone;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const STONE_FRAG = /* glsl */ `
uniform vec3 uStoneDark;
uniform vec3 uStoneLight;
uniform vec3 uFoliageDeep;
uniform vec3 uWaterGlow;
uniform vec3 uPetalBright;
uniform float uTime;
uniform float uKickPunch;
uniform float uKickWaveAge;
uniform float uSidechain;
uniform vec4 uChroma0;
uniform vec4 uChroma1;
uniform vec4 uChroma2;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vZone;
${GLSL_NOISE}

float chromaAtIdx(int idx) {
  if (idx < 4) return idx == 0 ? uChroma0.x : idx == 1 ? uChroma0.y : idx == 2 ? uChroma0.z : uChroma0.w;
  if (idx < 8) return idx == 4 ? uChroma1.x : idx == 5 ? uChroma1.y : idx == 6 ? uChroma1.z : uChroma1.w;
  return idx == 8 ? uChroma2.x : idx == 9 ? uChroma2.y : idx == 10 ? uChroma2.z : uChroma2.w;
}

float chromaByAngle(float ang) {
  float normA = fract(ang / 6.2831853 + 1.0) * 12.0;
  float fl = floor(normA);
  int idx = int(mod(fl, 12.0));
  int nextIdx = int(mod(fl + 1.0, 12.0));
  return mix(chromaAtIdx(idx), chromaAtIdx(nextIdx), fract(normA));
}

void main() {
  float r = length(vWorldPos.xz);
  float ang = atan(vWorldPos.z, vWorldPos.x);
  float grain = fbm3(vWorldPos.xz * 2.4);

  vec3 N = safeNorm(vNormal);
  vec3 V = safeNorm(cameraPosition - vWorldPos);
  vec3 L = safeNorm(vec3(0.0, 4.5, 0.0) - vWorldPos);
  float ndl = clamp(dot(N, L), 0.0, 1.0);

  vec3 baseCol = mix(uStoneDark, uStoneLight, 0.35 + 0.45 * clamp(N.y, 0.0, 1.0));
  baseCol *= 0.88 + 0.24 * grain;

  // 紧邻水池的挑檐石栏（r < 8.85）带有水雾浸润的湿石镜面光泽，与水面反光自然呼应
  if (vZone < 1.5 && r < 8.95) {
    vec3 skyKey = safeNorm(vec3(0.12, 0.68, -0.72));
    vec3 H = safeNorm(skyKey + V);
    float wetSpec = safePow(max(0.0, dot(N, H)), 28.0) * clamp(N.y, 0.0, 1.0);
    baseCol *= 0.90; // 湿润石材底色微沉，高光清亮
    baseCol += mix(vec3(0.95, 0.97, 1.0), uPetalBright, 0.25) * wetSpec * 0.28;
  }

  // 花坛植壤苔藓层（zone == 3）
  if (vZone > 2.5 && vZone < 3.5) {
    baseCol = mix(uFoliageDeep * 0.58, uStoneDark * 0.72, 0.28) * (0.82 + 0.35 * grain);
  }

  // 外围庭院环形石砖拼缝（zone == 4）
  if (vZone > 3.5) {
    float ringSeam = smoothstep(0.94, 0.995, cos(r * 5.2));
    float radSeam = smoothstep(0.96, 0.998, cos(ang * 24.0));
    baseCol *= 1.0 - 0.24 * max(ringSeam, radSeam);
    float fadeOut = 1.0 - smoothstep(18.0, 48.0, r);
    baseCol *= fadeOut;
  }

  // 喷泉水光对石栏内壁的漫反射与水波焦散映照
  float poolLight = exp(-max(0.0, r - 8.4) * 0.36) * (0.35 + 0.65 * ndl);
  baseCol += mix(vec3(0.88, 0.94, 1.0), uWaterGlow, 0.55) * poolLight * (0.14 + 0.16 * uKickPunch) * uSidechain;

  // 隐藏式阶梯洗墙灯带（zone == 2）与 12 音阶径向嵌灯槽
  float coveMask = 1.0 - clamp(abs(vZone - 2.0), 0.0, 1.0);
  float chromaVal = chromaByAngle(ang);
  float radialSlot = safePow(clamp(0.5 + 0.5 * cos(ang * 12.0), 0.0, 1.0), 18.0)
                   * smoothstep(8.5, 9.0, r) * (1.0 - smoothstep(15.6, 16.3, r));
  vec3 ledCol = mix(uWaterGlow, uPetalBright, 0.45);
  baseCol += ledCol * coveMask * (0.48 + 0.50 * chromaVal + 0.40 * uKickPunch) * uSidechain;
  baseCol += ledCol * radialSlot * (0.18 + 0.55 * chromaVal) * (1.0 - clamp(abs(vZone - 1.0), 0.0, 1.0));

  // 底鼓向外扩散的环形流光波掠过双层石砌花坛
  if (uKickWaveAge >= 0.0 && uKickWaveAge < 1.8) {
    float waveR = 8.4 + uKickWaveAge * 6.5;
    float ringGlow = exp(-safePow(abs(r - waveR) / 0.85, 2.0)) * exp(-uKickWaveAge * 1.35);
    baseCol += uPetalBright * ringGlow * 0.34;
  }

  gl_FragColor = vec4(clamp(baseCol, vec3(0.0), vec3(10.0)), 1.0);
}
`;

// 3. 真实光学镜面反光水池 + 三维喷泉摇曳倒影 + 水底琉璃封面清澈折射与焦散
const BASIN_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BASIN_FRAG = /* glsl */ `
uniform sampler2D uCover;
uniform int uZero;
uniform float uTime;
uniform float uFlow;
uniform float uKickPunch;
uniform float uHatSparkle;
uniform float uCenterSurge;
uniform float uSectionEnergy;
uniform float uSidechain;
uniform float uCoverMood;
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uMistGlow;
uniform vec3 uWaterDeep;
uniform vec3 uWaterGlow;
uniform vec3 uFoamWhite;
uniform vec3 uPetalPrimary;
uniform vec3 uPetalBright;
uniform vec4 uRippleA[${MAX_RIPPLES}]; // x, z, age, amp
uniform vec4 uRippleB[${MAX_RIPPLES}]; // maxRadius, freq, tau, unused
uniform vec4 uChroma0;
uniform vec4 uChroma1;
uniform vec4 uChroma2;
varying vec3 vWorldPos;
${GLSL_NOISE}

float chromaAtIdx(int idx) {
  if (idx < 4) return idx == 0 ? uChroma0.x : idx == 1 ? uChroma0.y : idx == 2 ? uChroma0.z : uChroma0.w;
  if (idx < 8) return idx == 4 ? uChroma1.x : idx == 5 ? uChroma1.y : idx == 6 ? uChroma1.z : uChroma1.w;
  return idx == 8 ? uChroma2.x : idx == 9 ? uChroma2.y : idx == 10 ? uChroma2.z : uChroma2.w;
}

float chromaByAngle(float ang) {
  float normA = fract(ang / 6.2831853 + 1.0) * 12.0;
  float fl = floor(normA);
  int idx = int(mod(fl, 12.0));
  int nextIdx = int(mod(fl + 1.0, 12.0));
  return mix(chromaAtIdx(idx), chromaAtIdx(nextIdx), fract(normA));
}

// Trowbridge-Reitz GGX 微表面水面镜面高光分布函数
float ggxDistribution(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float ndh = max(0.0, dot(N, H));
  float denom = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159265 * denom * denom, 1e-4);
}

// 多尺度真实液态水面重力波与微风细浪解析梯度场（平滑连续，切分出真实横向水波倒影条）
vec2 evalPoolLiquidWaves(vec2 xz, float r, float flow) {
  vec2 g = vec2(0.0);
  // 1) 主交叉液态涌浪（形成温润饱满的波面起伏）
  float p1 = xz.x * 1.85 + xz.y * 2.95 - flow * 2.35;
  g += vec2(1.85, 2.95) * cos(p1) * 0.0155;
  float p2 = -xz.x * 2.35 + xz.y * 3.30 - flow * 2.75;
  g += vec2(-2.35, 3.30) * cos(p2) * 0.0135;

  // 2) 池心主喷泉持续激起的径向荡漾环形水波
  vec2 radDir = r > 1e-3 ? xz / r : vec2(1.0, 0.0);
  float centerWave = cos(r * 5.2 - flow * 4.4) * smoothstep(0.25, 1.4, r) * exp(-r * 0.14);
  g += radDir * centerWave * (0.024 + 0.026 * uCenterSurge);

  // 3) 中高频微风鳞浪（为天光与喷泉反光赋予灵动细碎的液面闪烁，无任何静态颗粒感）
  float p3 = xz.x * 5.4 + xz.y * 7.8 + flow * 3.6;
  g += vec2(5.4, 7.8) * cos(p3) * 0.0046;
  float p4 = -xz.x * 7.2 + xz.y * 9.6 - flow * 4.2;
  g += vec2(-7.2, 9.6) * cos(p4) * 0.0034;
  return g;
}

void main() {
  vec2 xz = vWorldPos.xz;
  float r = length(xz);
  float ang = atan(xz.y, xz.x);

  // 1. 构建真实三维液态水波梯度与法线（环境涌浪 + 水拱落水同心波包，纯靠法线高光与折射呈现，零粉笔白圈）
  float waveActivity = 0.78 + 0.34 * uSectionEnergy;
  vec2 grad = evalPoolLiquidWaves(xz, r, uFlow) * waveActivity;
  float splashFoam = 0.0;
  float waveCurvature = 0.0;

  for (int i = uZero; i < ${MAX_RIPPLES}; i++) {
    vec4 ra = uRippleA[i];
    if (ra.w <= 0.001) continue;
    vec4 rb = uRippleB[i];
    vec2 dVec = xz - ra.xy;
    float dist = length(dVec);
    if (dist > rb.x + 0.75) continue;

    // 真实扩散波前包络：圆润的 2~3 圈同心水波凹凸
    float rad = rb.x * (1.0 - exp(-ra.z / max(0.25, rb.z * 0.95)));
    float packetW = 0.34 + 0.26 * (rad / max(rb.x, 0.5));
    float dFront = dist - rad;
    float env = ra.w * exp(-(dFront * dFront) / (packetW * packetW))
              * exp(-ra.z / (rb.z * 1.45))
              * smoothstep(0.0, 0.03, ra.z)
              * smoothstep(0.0, 0.14, dist);

    if (env > 0.0004) {
      float phase = dFront * rb.y * 1.25;
      float waveCos = cos(phase);
      float waveSin = sin(phase);
      vec2 dir = dVec / max(dist, 1e-4);
      // 仅写入三维波面斜率，由真实光线反射与池底折射自然显现晶莹水环
      grad += dir * (waveCos * rb.y * 0.022 * env);
      waveCurvature += waveSin * env;
    }

    // 仅在水柱刚落入池面的极小核心点 (dist < 0.22m, age < 0.24s) 产生转瞬即逝的清透水花微沫
    if (ra.z < 0.26 && dist < 0.26) {
      float dropSplash = (1.0 - smoothstep(0.04, 0.24, dist)) * exp(-ra.z * 11.0) * ra.w;
      splashFoam += dropSplash * 0.55;
    }
  }

  vec3 N = safeNorm(vec3(-grad.x, 1.0, -grad.y));
  vec3 V = safeNorm(cameraPosition - vWorldPos);
  float ndv = clamp(dot(N, V), 0.02, 1.0);

  // 2. 清澈深水斯涅尔折射（Snell's Refraction + 微光学色散 + 双层流动水底焦散光网）
  vec3 refr = refract(-V, N, 0.75);
  float waterDepth = 0.62;
  vec2 refrOffset = refr.xz * (waterDepth / max(0.26, -refr.y)) + grad * 0.85;
  vec2 floorXZ = xz + refrOffset;
  float rFloor = length(floorXZ);

  // 池底深翠/暗琉璃石底与流动水波焦散
  float floorDetail = fbm3(floorXZ * 1.6);
  vec3 floorCol = uWaterDeep * (0.52 + 0.28 * floorDetail);

  if (rFloor < ${MEDALLION_RADIUS.toFixed(2)} + 0.26) {
    vec2 baseUv = vec2(
      floorXZ.x / (${(MEDALLION_RADIUS * 2).toFixed(2)}) + 0.5,
      0.5 - floorXZ.y / (${(MEDALLION_RADIUS * 2).toFixed(2)})
    );
    // 水波斜率引发的细微清澈光学色散（波纹划过时边缘泛起晶莹水光折射感）
    vec2 disp = grad * 0.018;
    vec3 coverTex = vec3(
      texture2D(uCover, clamp(baseUv + disp, 0.004, 0.996)).r,
      texture2D(uCover, clamp(baseUv,        0.004, 0.996)).g,
      texture2D(uCover, clamp(baseUv - disp, 0.004, 0.996)).b
    );

    float innerMask = 1.0 - smoothstep(${MEDALLION_RADIUS.toFixed(2)} - 0.06, ${MEDALLION_RADIUS.toFixed(2)} + 0.03, rFloor);
    // 精致双圈水晶金属压环（无粗糙黑缝，完整保留专辑封面通透细腻质感）
    float ringBezel = exp(-safePow(abs(rFloor - ${MEDALLION_RADIUS.toFixed(2)}) / 0.055, 2.0))
                    + 0.48 * exp(-safePow(abs(rFloor - (${MEDALLION_RADIUS.toFixed(2)} - 0.20)) / 0.035, 2.0));

    // 水波凹凸带来的池底明暗聚光感，并对浅亮封面自动做水深浸润衰减，杜绝池心泛白过曝并突显水面波光反光
    float crestFocus = 1.0 + clamp(waveCurvature * 0.24, -0.16, 0.26);
    float coverWaterGain = mix(0.82, 0.48, uCoverMood) * (0.84 + 0.16 * uSidechain + 0.08 * uCenterSurge);
    vec3 medallionCol = coverTex * crestFocus * coverWaterGain;
    floorCol = mix(floorCol, medallionCol, innerMask);
    floorCol += mix(vec3(0.92, 0.96, 1.0), uPetalBright, 0.45) * ringBezel * (0.42 + 0.28 * uKickPunch);
  }

  // 池底柔和流动的水波光学焦散网 + 喷嘴水下射灯柔光
  float caustics = waterCausticNet(floorXZ, uFlow);
  float centerLamp = exp(-rFloor * rFloor * 0.34) * (0.28 + 0.52 * uCenterSurge) * mix(1.0, 0.42, uCoverMood);
  float cAngVal = chromaByAngle(atan(floorXZ.y, floorXZ.x));
  float ringLamp = (exp(-safePow(abs(rFloor - 6.75) / 0.62, 2.0)) + 0.75 * exp(-safePow(abs(rFloor - 4.45) / 0.55, 2.0)))
                 * (0.18 + 0.50 * cAngVal) * mix(1.0, 0.62, uCoverMood);

  vec3 crispAqua = mix(vec3(0.84, 0.93, 1.0), uWaterGlow, 0.42);
  floorCol += crispAqua * caustics * (0.12 + 0.18 * uCenterSurge + 0.10 * cAngVal) * mix(1.0, 0.68, uCoverMood) * uSidechain;
  floorCol += mix(uWaterGlow, crispAqua, 0.35) * (centerLamp * 0.36 + ringLamp * 0.30) * uSidechain;

  // 比尔-朗伯定律（Beer-Lambert）清澈水体透射吸收：视角越倾斜水程越长，呈现深邃通透的液态层次
  float opticalPath = waterDepth / max(0.28, -refr.y);
  vec3 waterTint = mix(uWaterDeep * 0.76, uWaterDeep * 1.10 + vec3(0.01, 0.025, 0.04), 0.45);
  float transmit = exp(-opticalPath * 0.32);
  vec3 underWater = mix(waterTint, floorCol, transmit);

  // 3. 真实物理镜面反射（Analytical 3D Ray-Scene Water Reflection + 双瓣 GGX 液态波面反光）
  vec3 R = reflect(-V, N);
  vec3 reflDir = safeNorm(vec3(R.x, max(0.025, R.y), R.z));

  // 3a) 倒映天空渐变、流云与前方月华/霞光亮带
  float rElev = clamp(reflDir.y, 0.0, 1.0);
  vec3 reflSky = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.32, rElev));
  reflSky = mix(reflSky, uSkyTop, smoothstep(0.24, 0.82, rElev));
  float rAz = atan(reflDir.x, -reflDir.z);
  float rClouds = fbm3(vec2(rAz * 2.2 + uFlow * 0.035, rElev * 3.8 - uFlow * 0.015));
  reflSky += mix(uSkyHorizon, uMistGlow, 0.55) * smoothstep(0.40, 0.84, rClouds) * (1.0 - smoothstep(0.55, 0.95, rElev)) * 0.36;
  // 增强天空反射中的通透天光银辉，确保深暗封面下水面依然有清晰镜面反光对比
  vec3 skySheenCol = mix(vec3(0.76, 0.84, 0.96), mix(uMistGlow, vec3(1.0), 0.48), 0.62);
  float backSlope = clamp(-grad.y * 4.5 + length(grad) * 1.8, 0.0, 1.0);
  reflSky = mix(reflSky, skySheenCol * (0.42 + 0.32 * uCoverMood + 0.18 * uCenterSurge), 0.28 + 0.36 * backSlope);

  // 3b) 反射射线与上方池心冲天水柱簇的三维真实光线求交（被水波自然切分为晃动的晶莹长倒影！）
  vec2 rHoriz = reflDir.xz;
  float rHorizLen2 = max(dot(rHoriz, rHoriz), 1e-4);
  float tClosest = max(0.0, -dot(xz, rHoriz) / rHorizLen2);
  vec2 closestPt = xz + rHoriz * tClosest;
  float distToCenterAxis = length(closestPt);
  float hitCenterY = tClosest * reflDir.y;
  float activeJetH = 2.4 + 5.6 * uCenterSurge;
  float colHit = exp(-safePow(distToCenterAxis / (0.62 + 0.22 * hitCenterY), 2.0))
               * smoothstep(-0.1, 0.35, hitCenterY)
               * (1.0 - smoothstep(activeJetH * 0.65, activeJetH * 1.15, hitCenterY));
  vec3 fountainCrystal = mix(vec3(0.95, 0.98, 1.0), uWaterGlow, 0.22);
  vec3 reflFountain = fountainCrystal * colHit * (0.65 + 0.85 * uCenterSurge) * uSidechain;

  // 3c) 反射射线与上方 24 道抛物线水拱及外圈 36 道水冠的三维平面求交倒影
  float tArcPlane = 1.45 / max(0.10, reflDir.y);
  vec2 arcHitXZ = xz + reflDir.xz * tArcPlane;
  float arcHitR = length(arcHitXZ);
  float arcHitAng = atan(arcHitXZ.y, arcHitXZ.x);
  float arcSpokes = safePow(clamp(0.5 + 0.5 * cos(arcHitAng * 12.0 + grad.x * 8.0), 0.0, 1.0), 4.0);
  float arcBand = exp(-safePow(abs(arcHitR - 4.5) / 1.85, 2.0)) * arcSpokes * (0.25 + 0.75 * uSectionEnergy);
  float outerCrownRefl = exp(-safePow(abs(arcHitR - 7.55) / 0.55, 2.0))
                       * (0.55 + 0.45 * cos(arcHitAng * 36.0)) * (0.30 + 0.60 * uSectionEnergy);
  reflFountain += fountainCrystal * (arcBand * 0.48 + outerCrownRefl * 0.42) * uSidechain;

  // 3d) 池边双层石砌花海与洗墙灯带的柔和近岸倒影
  float tBankPlane = 0.85 / max(0.08, reflDir.y);
  vec2 bankHitXZ = xz + reflDir.xz * tBankPlane;
  float bankHitR = length(bankHitXZ);
  float bankMask = smoothstep(8.2, 9.6, bankHitR) * (1.0 - smoothstep(14.5, 18.0, bankHitR));
  vec3 bankReflCol = mix(uPetalPrimary, uPetalBright, 0.5 + 0.5 * sin(atan(bankHitXZ.y, bankHitXZ.x) * 7.0));
  vec3 reflTotal = reflSky + reflFountain + bankReflCol * bankMask * 0.36 * uSidechain;

  // 改良液态水体菲涅尔系数：正视清澈透出池底封面，斜视与波浪背面平滑涌现清亮镜面反光
  float schlick = safePow(1.0 - ndv, 4.2);
  float fresnel = clamp(0.10 + 0.76 * schlick + 0.16 * backSlope, 0.08, 0.88);
  vec3 col = mix(underWater, reflTotal, fresnel);

  // 4. 关键光学灵魂：多光源 GGX 微表面镜面波光（确保平视与 crown 高俯视下水面均有极真实的晶莹高光反光！）
  // 光源 A：前方天际主霞光/月光（驱动平视与斜视波光大道）
  vec3 L_horizon = safeNorm(vec3(0.16, 0.40, -0.90));
  vec3 H_horizon = safeNorm(L_horizon + V);
  // 光源 B：庭院前上方晴空/月华漫射主光（专为 crown 俯视与 orbit 中景提供波面与涟漪月牙高光！）
  vec3 L_zenith = safeNorm(vec3(-0.14, 0.80, -0.58));
  vec3 H_zenith = safeNorm(L_zenith + V);
  // 光源 C：池心冲天发光水柱近场点光源（让每一圈同心涟漪朝向池心的波坡闪耀灵动水光！）
  vec3 fountainLightPos = vec3(0.0, 2.6 + 2.2 * uCenterSurge, 0.0);
  vec3 L_fountain = safeNorm(fountainLightPos - vWorldPos);
  vec3 H_fountain = safeNorm(L_fountain + V);

  float specSharp = ggxDistribution(N, H_horizon, 0.065) * 0.22
                  + ggxDistribution(N, H_zenith, 0.075) * 0.20
                  + ggxDistribution(N, H_fountain, 0.095) * (0.12 + 0.24 * uCenterSurge) * exp(-r * 0.14);
  float specSilky = ggxDistribution(N, H_horizon, 0.24) * 0.12
                  + ggxDistribution(N, H_zenith, 0.26) * 0.14;

  // 仅在存在波面起伏与涟漪斜率时绽放灵动碎银波光，避免平水死白遮挡池底封面
  float waveSparkleGate = 0.32 + 0.68 * smoothstep(0.008, 0.055, length(grad));
  vec3 specTint = mix(vec3(0.96, 0.985, 1.0), uMistGlow, 0.22);
  col += specTint * (min(specSharp, 3.2) * waveSparkleGate + min(specSilky, 0.85)) * (0.78 + 0.28 * uHatSparkle);

  // 水拱落点中心瞬时清透水花微沫
  if (splashFoam > 0.002) {
    col += vec3(0.95, 0.98, 1.0) * min(splashFoam, 0.85);
  }

  // 池沿石壁内侧水深微暗角与弯液面高光边（Meniscus Rim）
  float meniscus = exp(-safePow(abs(r - 8.42) / 0.06, 2.0));
  col += specTint * meniscus * 0.18;
  col *= 1.0 - 0.22 * smoothstep(8.05, 8.55, r);

  gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(10.0)), 1.0);
}
`;

// 4. GPU 实例化双层立体透光花簇着色器
const FLOWER_VERT = /* glsl */ `
attribute vec3 aPetal;      // u(-1..1), v(0..1), layer(0外瓣,1内瓣,2花蕊)
attribute vec4 aInstPos;    // xyz: 花朵世界坐标, w: 尺寸缩放
attribute vec4 aInstStyle;  // x: 朝向角, y: 色彩混合权重, z: 微风相位, w: 径向归一化层级
uniform float uTime;
uniform float uKickPunch;
uniform float uKickWaveAge;
uniform float uSectionEnergy;
varying vec3 vPetal;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec2 vColorSeed;

void main() {
  vPetal = aPetal;
  vColorSeed = vec2(aInstStyle.y, aInstStyle.w);

  float r = length(aInstPos.xz);
  float waveBloom = 0.0;
  if (uKickWaveAge >= 0.0 && uKickWaveAge < 1.8) {
    float waveR = 8.4 + uKickWaveAge * 6.5;
    float dR = (r - waveR) / 0.95;
    waveBloom = exp(-dR * dR) * exp(-uKickWaveAge * 1.25);
  }

  vec3 lp = position;
  if (aPetal.z < 1.5) {
    float openAmt = 0.08 * uSectionEnergy + 0.14 * waveBloom + 0.04 * uKickPunch;
    lp.xz *= 1.0 + openAmt * aPetal.y;
    lp.y -= openAmt * 0.04 * aPetal.y * aPetal.y;
  }
  lp *= aInstPos.w * (1.0 + 0.09 * waveBloom);

  float yaw = aInstStyle.x;
  float cy = cos(yaw), sy = sin(yaw);
  vec3 rp = vec3(lp.x * cy - lp.z * sy, lp.y, lp.x * sy + lp.z * cy);
  vec3 rn = vec3(normal.x * cy - normal.z * sy, normal.y, normal.x * sy + normal.z * cy);

  float breeze = 0.045 + 0.035 * uSectionEnergy;
  float sx = sin(uTime * 1.45 + aInstStyle.z + aInstPos.x * 0.35) * breeze * (0.35 + rp.y * 2.5);
  float sz = cos(uTime * 1.22 + aInstStyle.z * 1.3 + aInstPos.z * 0.35) * breeze * (0.35 + rp.y * 2.5);

  vec3 wp = aInstPos.xyz + rp + vec3(sx, 0.025 * waveBloom, sz);
  vWorldPos = wp;
  float rnl = length(rn);
  vNormalW = rnl > 1e-5 ? rn / rnl : vec3(0.0, 1.0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FLOWER_FRAG = /* glsl */ `
uniform vec3 uCoverDeep;
uniform vec3 uPetalPrimary;
uniform vec3 uPetalBright;
uniform vec3 uPetalAccent;
uniform vec3 uWaterGlow;
uniform float uKickWaveAge;
uniform float uHatSparkle;
uniform float uSidechain;
uniform float uSectionEnergy;
varying vec3 vPetal;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec2 vColorSeed;
${GLSL_NOISE}

void main() {
  float u = vPetal.x;
  float v = vPetal.y;
  float layer = vPetal.z;

  vec3 N = safeNorm(vNormalW);
  vec3 V = safeNorm(cameraPosition - vWorldPos);
  vec3 toCenter = vec3(0.0, 2.6, 0.0) - vWorldPos;
  vec3 L = safeNorm(toCenter);

  float r = length(vWorldPos.xz);
  float waveGlow = 0.0;
  if (uKickWaveAge >= 0.0 && uKickWaveAge < 1.8) {
    float waveR = 8.4 + uKickWaveAge * 6.5;
    waveGlow = exp(-safePow(abs(r - waveR) / 0.95, 2.0)) * exp(-uKickWaveAge * 1.25);
  }

  vec3 col;
  if (layer > 1.5) {
    col = mix(uPetalBright, vec3(1.0, 0.94, 0.76), 0.48) * (1.10 + 0.40 * uSectionEnergy + 0.48 * waveGlow);
  } else {
    vec3 speciesCol = vColorSeed.x < 0.56
      ? mix(uPetalPrimary, uPetalAccent, vColorSeed.x / 0.56)
      : mix(uPetalAccent, uPetalBright, (vColorSeed.x - 0.56) / 0.44);
    float bloomVar = 0.84 + 0.30 * fract(vColorSeed.x * 13.7 + vColorSeed.y * 5.3);

    float cupAo = 0.36 + 0.64 * smoothstep(0.02, 0.68, v);
    float edgeSoft = smoothstep(0.55, 0.98, abs(u));
    float vein = 0.92 + 0.08 * cos(u * 18.0);
    vec3 baseRoot = mix(uCoverDeep * 0.72, speciesCol, 0.32 + 0.14 * layer);
    vec3 tipCol = mix(speciesCol, uPetalBright, 0.42 + 0.24 * layer + 0.18 * edgeSoft);
    col = mix(baseRoot, tipCol, smoothstep(0.10, 0.92, v)) * vein * cupAo * bloomVar;

    float ndl = clamp(dot(N, L), 0.0, 1.0);
    float backTrans = clamp(dot(-N, L), 0.0, 1.0) * (0.28 + 0.72 * v);
    float rim = safePow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.5) * smoothstep(0.15, 0.85, v);
    float fountainFalloff = exp(-max(0.0, r - 8.6) * 0.16);

    float lightGain = 0.48 + 0.46 * ndl + 0.42 * backTrans * fountainFalloff;
    col *= lightGain * uSidechain;
    col += mix(speciesCol, uPetalBright, 0.65) * (rim * 0.24 + backTrans * 0.18 * fountainFalloff + waveGlow * 0.42);

    if (uHatSparkle > 0.04 && v > 0.68) {
      float dew = hash21(floor(vWorldPos.xz * 28.0));
      if (dew > 0.94) col += vec3(0.92, 0.96, 1.0) * uHatSparkle * 0.48;
    }
  }

  gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(10.0)), 1.0);
}
`;

// 5. GPU 实例化草本弧形绿植衬底着色器
const FOLIAGE_VERT = /* glsl */ `
attribute vec4 aInstPos;
attribute vec2 aInstRot; // x: yaw, y: phase
uniform float uTime;
uniform float uSectionEnergy;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec3 lp = position * aInstPos.w;
  float cy = cos(aInstRot.x), sy = sin(aInstRot.x);
  vec3 rp = vec3(lp.x * cy - lp.z * sy, lp.y, lp.x * sy + lp.z * cy);
  vec3 rn = vec3(normal.x * cy - normal.z * sy, normal.y, normal.x * sy + normal.z * cy);

  float sway = sin(uTime * 1.25 + aInstRot.y + aInstPos.x * 0.3) * (0.03 + 0.025 * uSectionEnergy) * uv.y;
  vec3 wp = aInstPos.xyz + rp + vec3(sway, 0.0, sway * 0.7);
  vWorldPos = wp;
  float rnl = length(rn);
  vNormalW = rnl > 1e-5 ? rn / rnl : vec3(0.0, 1.0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FOLIAGE_FRAG = /* glsl */ `
uniform vec3 uFoliageDeep;
uniform vec3 uFoliageRim;
uniform vec3 uWaterGlow;
uniform float uSidechain;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorldPos;
${GLSL_NOISE}

void main() {
  vec3 N = safeNorm(vNormalW);
  vec3 V = safeNorm(cameraPosition - vWorldPos);
  vec3 L = safeNorm(vec3(0.0, 3.0, 0.0) - vWorldPos);
  float ndl = clamp(dot(N, L), 0.0, 1.0);
  float rim = safePow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.6);
  float r = length(vWorldPos.xz);
  float poolReach = exp(-max(0.0, r - 8.6) * 0.18);

  vec3 col = mix(uFoliageDeep, uFoliageRim, smoothstep(0.05, 0.92, vUv.y));
  col *= (0.48 + 0.52 * ndl) * uSidechain;
  col += mix(uFoliageRim, uWaterGlow, 0.45) * rim * 0.22 * poolReach;
  gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(8.0)), 1.0);
}
`;

// 6. 池心多层皇冠清澈水柱簇着色器（细密高速液丝 + 清透折射水色 + 顶端瑞利微水珠剥离）
const JET_VERT = /* glsl */ `
attribute vec4 aNozzle;  // x, z, radiusScale, indexNorm(0..1)
attribute vec4 aJetDyn;  // x: height, y: tiltOut, z: glowIntensity, w: phaseSeed
uniform float uTime;
varying vec2 vUv;
varying float vGlow;
varying float vSeed;
varying float vHeightNorm;

void main() {
  vUv = uv;
  vGlow = aJetDyn.z;
  vSeed = aJetDyn.w;
  float h = max(0.30, aJetDyn.x);
  vHeightNorm = clamp(h / 8.5, 0.08, 1.0);

  vec3 lp = position;
  lp.xz *= aNozzle.z;
  lp.y *= h;

  // 护卫副水柱沿径向优雅向外舒展弯曲，顶端呈自然抛物线微垂
  float rNoz = length(aNozzle.xy);
  vec2 radDir = rNoz > 0.04 ? aNozzle.xy / rNoz : vec2(0.0);
  float flare = aJetDyn.y * (0.45 * uv.y + 0.55 * uv.y * uv.y) * h * 0.24;
  vec3 wp = vec3(aNozzle.x + radDir.x * flare, lp.y - 0.02, aNozzle.y + radDir.y * flare) + vec3(lp.x, 0.0, lp.z);

  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const JET_FRAG = /* glsl */ `
uniform vec3 uWaterGlow;
uniform vec3 uPetalBright;
uniform vec3 uFoamWhite;
uniform float uTime;
uniform float uHatSparkle;
uniform float uSidechain;
varying vec2 vUv;
varying float vGlow;
varying float vSeed;
varying float vHeightNorm;
${GLSL_NOISE}

void main() {
  float signedX = vUv.x * 2.0 - 1.0;
  float across = abs(signedX);
  float v = vUv.y;

  // 1. 高速向上蹿升的细密液态水丝场（18~32 股清晰可辨的纤细水线，拒绝糊成一团白雾）
  float speed = 9.5 + 3.5 * vHeightNorm;
  vec2 fineUv1 = vec2(vUv.x * 16.0 + vSeed * 11.3, v * (7.5 + 5.5 * vHeightNorm) - uTime * speed);
  vec2 fineUv2 = vec2(vUv.x * 30.0 - vSeed * 7.7, v * 15.0 - uTime * (speed * 1.32));
  float s1 = vnoise(fineUv1);
  float s2 = vnoise(fineUv2);

  // 提取锐利纤细的高速液丝（Liquid Strands）与中后段断裂的晶莹小水珠（Micro-Droplets）
  float strandPattern = smoothstep(0.38, 0.88, 0.56 * s1 + 0.44 * s2);
  vec2 dropGrid = vec2(vUv.x * 24.0 + vSeed * 19.0, v * 34.0 - uTime * (speed * 1.18));
  vec2 dropId = floor(dropGrid);
  vec2 dropF = fract(dropGrid) - 0.5;
  float dropRnd = hash21(dropId);
  float droplet = step(0.56, dropRnd) * (1.0 - smoothstep(0.08, 0.36, length(dropF * vec2(1.1, 0.75))));

  // 2. 流体物理分段轮廓：底部喷口层流晶莹凝练，向上逐渐拉丝并散落为细碎水珠冠
  float taperWidth = mix(0.46, 0.96, smoothstep(0.0, 0.85, v));
  float normR = across / max(taperWidth, 0.1);
  if (normR > 1.02) discard;

  float radialEnvelope = 1.0 - smoothstep(0.28, 1.0, normR);
  float topFeather = 1.0 - smoothstep(0.68 + 0.22 * s1, 0.995, v);
  float baseEntry = smoothstep(0.0, 0.035, v);

  // 核心高速水脊线 + 细密水丝 + 顶部飞散微水珠，间隙保持通透清澈！
  float laminarCore = exp(-normR * normR * 9.5) * (1.0 - 0.45 * v);
  float breakupMix = smoothstep(0.22, 0.78, v);
  float detailStructure = mix(
    0.35 + 0.65 * strandPattern,
    0.55 * strandPattern + 0.85 * droplet,
    breakupMix
  );

  float alpha = radialEnvelope * topFeather * baseEntry * clamp(laminarCore * 0.72 + detailStructure * 0.58, 0.0, 1.0);
  if (alpha < 0.015) discard;

  // 3. 清澈水体光学着色：纯净冰白镜面高光为主，仅喷口基座微染清透水下灯光，绝不浑浊发粉！
  vec3 crystalWhite = mix(vec3(0.96, 0.985, 1.0), uFoamWhite, 0.24);
  vec3 clearAqua = mix(vec3(0.80, 0.90, 1.0), uWaterGlow, 0.38);
  float baseUplight = exp(-v * 4.2); // 仅底部 25% 折射池底封面色水下灯
  vec3 bodyTint = mix(clearAqua, mix(uWaterGlow, uPetalBright, 0.35), baseUplight * 0.72);

  // 镜面折射亮丝（水束两侧菲涅尔亮边 + 中心纯白水芯 + 水珠闪点）
  float fresnelRim = exp(-safePow(abs(normR - 0.56) / 0.18, 2.0)) * strandPattern;
  float specHighlight = clamp(laminarCore * 0.85 + strandPattern * 0.52 + droplet * 0.90 + fresnelRim * 0.45, 0.0, 1.0);
  vec3 col = mix(bodyTint * 0.88, crystalWhite, smoothstep(0.18, 0.82, specHighlight));

  float hdrGain = (0.72 + 0.68 * vGlow + 0.55 * specHighlight) * (0.86 + 0.18 * uSidechain);
  if (uHatSparkle > 0.03) {
    hdrGain += droplet * uHatSparkle * 0.85;
  }

  // 控制透明叠加上限（保持水流清澈透景，不糊成死白块）
  float outAlpha = clamp(alpha * (0.42 + 0.34 * specHighlight) * (0.75 + 0.25 * vGlow), 0.0, 0.78);
  gl_FragColor = vec4(clamp(col * hdrGain, vec3(0.0), vec3(10.0)), outAlpha);
}
`;

// 7. 抛物线水晶水束着色器（统一驱动中圈 24 道交织音阶水拱 + 外圈 36 道向心水晶水冠，共 60 道纤细清澈水弧）
const ARC_VERT = /* glsl */ `
attribute vec4 aArcGeom;  // x: rStart, y: rEnd, z: thetaStart, w: thetaEnd
attribute vec4 aArcState; // x: apexHeight, y: baseFlowLevel, z: pulsePos(-1..1.3), w: pulseAmp (负值标记外圈纤巧水冠)
uniform float uTime;
varying vec2 vUv;
varying float vFlowLevel;
varying float vPulse;
varying float vSeed;
varying float vIsOuterCrown;

vec3 evalParabola(float s, float r0, float r1, float a0, float a1, float hMax) {
  float r = mix(r0, r1, s);
  float a = mix(a0, a1, s);
  float y = 4.0 * hMax * s * (1.0 - s) - 0.015;
  return vec3(cos(a) * r, y, sin(a) * r);
}

void main() {
  float s = uv.y;
  float side = position.x; // -1 或 +1
  vUv = uv;
  vFlowLevel = aArcState.y;
  vSeed = fract(aArcGeom.z * 0.731 + aArcGeom.x * 0.17);

  // aArcState.w < 0 用于标记外圈 36 道纤巧向心水冠（喷射到抛物线前 72% 自然垂落散成微水珠，如盛开水晶莲瓣）
  float isOuter = aArcState.w < -0.5 ? 1.0 : 0.0;
  vIsOuterCrown = isOuter;
  float sEff = isOuter > 0.5 ? s * 0.76 : s;

  float pPos = aArcState.z;
  float rawAmp = max(0.0, aArcState.w);
  float pEnv = (isOuter < 0.5 && pPos >= -0.25 && pPos <= 1.25)
    ? exp(-((s - pPos) * (s - pPos)) / 0.022) * rawAmp
    : 0.0;
  vPulse = pEnv;

  float hMax = max(0.32, aArcState.x * (1.0 + 0.16 * pEnv));
  vec3 center = evalParabola(sEff, aArcGeom.x, aArcGeom.y, aArcGeom.z, aArcGeom.w, hMax);
  vec3 ahead = evalParabola(min(1.0, sEff + 0.018), aArcGeom.x, aArcGeom.y, aArcGeom.z, aArcGeom.w, hMax);
  vec3 behind = evalParabola(max(0.0, sEff - 0.018), aArcGeom.x, aArcGeom.y, aArcGeom.z, aArcGeom.w, hMax);
  vec3 diff = ahead - behind;
  float dl = length(diff);
  vec3 tangent = dl > 1e-5 ? diff / dl : vec3(0.0, 1.0, 0.0);

  vec3 toCam = cameraPosition - center;
  float tcl = length(toCam);
  toCam = tcl > 1e-5 ? toCam / tcl : vec3(0.0, 0.0, 1.0);
  vec3 right = cross(tangent, toCam);
  float rl = length(right);
  right = rl > 1e-4 ? right / rl : vec3(1.0, 0.0, 0.0);

  // 凝练纤细且柔顺抗锯齿的水晶水束宽度：内含玻璃折射细芯，外裹微透明水膜柔边
  float baseW = isOuter > 0.5
    ? (0.032 + 0.028 * sin(s * 3.14159265)) * (0.76 + 0.34 * vFlowLevel)
    : (0.042 + 0.038 * sin(s * 3.14159265) + 0.036 * pEnv) * (0.72 + 0.38 * clamp(vFlowLevel + pEnv, 0.0, 1.2));

  vec3 wp = center + right * (side * baseW);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const ARC_FRAG = /* glsl */ `
uniform vec3 uWaterGlow;
uniform vec3 uPetalBright;
uniform vec3 uFoamWhite;
uniform float uTime;
uniform float uHatSparkle;
uniform float uSidechain;
varying vec2 vUv;
varying float vFlowLevel;
varying float vPulse;
varying float vSeed;
varying float vIsOuterCrown;
${GLSL_NOISE}

void main() {
  float across = abs(vUv.x * 2.0 - 1.0);
  if (across > 0.99) discard;
  float s = vUv.y;

  // 1. 高速层流液丝与屏幕空间抗锯齿瑞利（Rayleigh-Plateau）圆润液滴串
  float flowRate = vIsOuterCrown > 0.5 ? 6.4 : 5.8;
  vec2 filamentUv = vec2(vUv.x * 7.5 + vSeed * 13.0, s * 13.5 - uTime * flowRate);
  float filament = 0.60 * vnoise(filamentUv) + 0.40 * vnoise(filamentUv * 2.1 + vec2(4.7, -uTime * 2.8));
  float crispStrands = smoothstep(0.32, 0.84, filament);

  // 连续平滑的瑞利波包液珠串 + fwidth 距离自适应抗锯齿（近景颗颗晶莹水滴，远景丝滑清亮水线零锯齿）
  float beadCoord = s * 28.0 - uTime * (flowRate * 1.32) + vSeed * 31.0;
  float fw = fwidth(beadCoord);
  float aaFade = 1.0 - smoothstep(0.28, 0.85, fw);
  float waveBead1 = 0.5 + 0.5 * sin(beadCoord * 6.2831853 + filament * 2.6);
  float waveBead2 = 0.5 + 0.5 * sin(beadCoord * 3.71 - uTime * 3.4 + vSeed * 11.0);
  float radialDrop = exp(-across * across * 6.5);
  float rawBead = smoothstep(0.46, 0.92, waveBead1 * (0.55 + 0.45 * waveBead2)) * radialDrop;
  float bead = mix(0.42 * radialDrop, rawBead, aaFade);

  // 2. 初段清透玻璃层流管（柔滑菲涅尔双折射亮边 + 纯白高光银芯） -> 中后段柔顺拉丝液珠链
  float glassCore = exp(-across * across * 14.0);
  float glassRim = exp(-safePow(abs(across - 0.56) / 0.18, 2.0));
  float laminarGlass = clamp(glassCore * 0.90 + glassRim * 0.62 + 0.22 * (1.0 - across), 0.0, 1.0);

  float breakup = vIsOuterCrown > 0.5
    ? smoothstep(0.26, 0.84, s)
    : smoothstep(0.32, 0.82, s);
  float liquidDetail = mix(laminarGlass, 0.54 * crispStrands + 0.78 * bead + 0.42 * glassCore, breakup);

  float radialSoft = 1.0 - smoothstep(0.56, 0.99, across);
  float endFade = vIsOuterCrown > 0.5
    ? smoothstep(0.0, 0.045, s) * (1.0 - smoothstep(0.66, 0.99, s))
    : smoothstep(0.0, 0.045, s) * (1.0 - smoothstep(0.92, 1.0, s));

  float activity = clamp(vFlowLevel * 0.90 + vPulse * 1.22, 0.0, 1.4);
  float alpha = radialSoft * endFade * liquidDetail * activity;
  if (alpha < 0.012) discard;

  // 3. 清澈透明水晶着色：剔除乳白粉雾，仅喷口微带封面折射光，水拱通体冰清晶亮
  vec3 crystalWhite = mix(vec3(0.97, 0.99, 1.0), uFoamWhite, 0.18);
  vec3 nozzleTint = mix(vec3(0.82, 0.91, 1.0), mix(uWaterGlow, uPetalBright, 0.32), exp(-s * 4.5) * 0.72);
  float specMask = clamp(glassCore * 0.85 + glassRim * 0.45 + bead * 0.88 + vPulse * 0.45, 0.0, 1.0);
  vec3 col = mix(nozzleTint, crystalWhite, smoothstep(0.14, 0.74, specMask));

  float gain = (0.76 + 1.02 * vPulse + 0.42 * vFlowLevel + 0.50 * specMask) * (0.88 + 0.18 * uSidechain);
  if (uHatSparkle > 0.03) {
    gain += bead * uHatSparkle * 0.75;
  }

  float outAlpha = clamp(alpha * (0.48 + 0.34 * specMask), 0.0, 0.80);
  gl_FragColor = vec4(clamp(col * gain, vec3(0.0), vec3(10.0)), outAlpha);
}
`;

// 8. 细腻晶莹微水珠飞沫粒子着色器（5200 颗锐利微水滴，杜绝近景糊脸大雾球，尽显清澈水珠颗粒感）
const SPRAY_VERT = /* glsl */ `
attribute vec4 aSpraySeed; // x: baseRadius, y: angle, z: speedScale, w: phaseOffset
uniform float uTime;
uniform float uCenterSurge;
uniform float uSectionEnergy;
uniform float uPixelRatio;
varying float vLife;
varying float vSpark;

void main() {
  float rate = 0.68 + 0.42 * aSpraySeed.z;
  float life = fract(uTime * rate + aSpraySeed.w);
  vLife = life;
  vSpark = fract(aSpraySeed.w * 37.3);

  float energyScale = 0.40 + 0.76 * max(uSectionEnergy, uCenterSurge);
  bool isOuter = aSpraySeed.x > 7.1;
  float dirSign = isOuter ? -1.0 : 1.0; // 外圈水冠微水珠向池内抛洒，池心与水拱微水珠自然散落
  float angle = aSpraySeed.y + uTime * (isOuter ? 0.05 : 0.10);
  float outVel = (0.45 + 1.45 * aSpraySeed.z) * (0.55 + 0.50 * energyScale) * dirSign;
  float upVel = (isOuter ? (1.8 + 2.4 * aSpraySeed.z) : (3.0 + 4.8 * aSpraySeed.z)) * energyScale;

  float r = max(0.08, aSpraySeed.x + outVel * life);
  float y = max(0.02, upVel * life - 4.9 * life * life);
  vec3 wp = vec3(cos(angle) * r, y, sin(angle) * r);

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dist = max(1.8, -mv.z);
  // 精细微水珠尺寸（1.2px ~ 5.5px），颗颗晶莹分明，绝不化作浑浊大白团
  float dropletPx = (14.0 + 10.0 * aSpraySeed.z) / dist;
  gl_PointSize = clamp(dropletPx * uPixelRatio, 1.15, 5.8);
  gl_Position = projectionMatrix * mv;
}
`;

const SPRAY_FRAG = /* glsl */ `
uniform vec3 uWaterGlow;
uniform vec3 uFoamWhite;
uniform float uHatSparkle;
uniform float uSidechain;
varying float vLife;
varying float vSpark;
${GLSL_NOISE}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 >= 1.0) discard;
  // 真实球形微水滴光学特征：边缘清透微折射 + 偏心镜面纯白星点高光核
  float specDot = exp(-dot(d - vec2(-0.12, -0.12), d - vec2(-0.12, -0.12)) * 28.0);
  float rim = safePow(max(1.0 - r2, 0.0), 1.6);
  float env = sin(vLife * 3.14159265);
  float spark = vSpark > 0.68 ? (1.0 + uHatSparkle * 1.45) : 1.0;

  vec3 dropletCol = mix(mix(vec3(0.84, 0.93, 1.0), uWaterGlow, 0.30), vec3(1.0), 0.55 + 0.45 * specDot);
  vec3 outCol = dropletCol * spark * uSidechain * (0.28 * rim + 0.82 * specDot) * env;
  gl_FragColor = vec4(clamp(outCol, vec3(0.0), vec3(6.0)), 1.0);
}
`;

// 9. 随喷泉气流盘旋上升的飘飞花瓣着色器（纯时间函数）
const PETAL_DRIFT_VERT = /* glsl */ `
attribute vec4 aDriftSeed; // x: baseRadius, y: baseAngle, z: heightSpan, w: phase
uniform float uTime;
uniform float uSectionEnergy;
varying vec2 vUv;
varying float vTint;
varying float vFade;

void main() {
  vUv = uv;
  vTint = fract(aDriftSeed.w * 19.7);

  float cycle = fract(uTime * (0.065 + 0.035 * uSectionEnergy) + aDriftSeed.w);
  vFade = sin(cycle * 3.14159265) * (0.35 + 0.65 * uSectionEnergy);

  float ang = aDriftSeed.y + cycle * 2.4 + 0.25 * sin(uTime * 0.7 + aDriftSeed.w * 12.0);
  float rad = mix(aDriftSeed.x, aDriftSeed.x * 0.68, cycle) + 0.45 * sin(uTime * 0.9 + aDriftSeed.w * 8.0);
  float y = 0.65 + cycle * aDriftSeed.z + 0.18 * sin(uTime * 1.6 + aDriftSeed.w * 20.0);

  float rx = uTime * 1.8 + aDriftSeed.w * 30.0;
  float rz = uTime * 1.3 + aDriftSeed.w * 17.0;
  float cx = cos(rx), sx = sin(rx);
  float cz = cos(rz), sz = sin(rz);
  vec3 p = position * (0.85 + 0.55 * vTint);
  p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  p = vec3(p.x * cz - p.y * sz, p.x * sz + p.y * cz, p.z);

  vec3 wp = vec3(cos(ang) * rad, y, sin(ang) * rad) + p;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vFade *= smoothstep(2.2, 5.2, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const PETAL_DRIFT_FRAG = /* glsl */ `
uniform vec3 uPetalPrimary;
uniform vec3 uPetalBright;
uniform vec3 uPetalAccent;
uniform float uSidechain;
varying vec2 vUv;
varying float vTint;
varying float vFade;
${GLSL_NOISE}

void main() {
  if (vFade < 0.02) discard;
  float px = (vUv.x - 0.5) * 2.0;
  float py = vUv.y;
  float halfW = sin(safePow(clamp(py, 0.001, 1.0), 0.68) * 3.14159265);
  float petalMask = 1.0 - smoothstep(halfW * 0.72, max(halfW, 0.01), abs(px));
  if (petalMask < 0.05) discard;

  vec3 base = vTint < 0.5 ? mix(uPetalPrimary, uPetalBright, vTint * 2.0) : mix(uPetalAccent, uPetalBright, (vTint - 0.5) * 2.0);
  vec3 col = mix(base, uPetalBright, vUv.y * 0.55) * (0.95 + 0.22 * uSidechain);
  gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(6.0)), clamp(vFade * petalMask * 0.86, 0.0, 0.90));
}
`;

// ── 场景主类 ───────────────────────────────────────────────────────────────────────────────────────────────────────

export class FountainScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly rig: LyricRig;
  private readonly soft: boolean;

  private readonly arcEvents: ArcLaunchEvent[];
  private readonly arcTimes: Float64Array;
  private readonly ripples: SplashRippleEvent[];
  private readonly rippleTimes: Float64Array;
  private readonly rippleA = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4());
  private readonly rippleB = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4());

  private readonly rawKickTimes: Float64Array;
  private readonly rawKickVals: Float64Array;
  private readonly rawSnareTimes: Float64Array;
  private readonly rawSnareVals: Float64Array;
  private readonly rawHatTimes: Float64Array;
  private readonly rawHatVals: Float64Array;
  private readonly chromaBuf = new Float32Array(12);

  // 动态更新的 GPU 实例属性缓冲
  private readonly crownJetDynAttr: THREE.InstancedBufferAttribute;
  private readonly arcStateAttr: THREE.InstancedBufferAttribute;

  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, init.aspect, 0.15, 420);

    const { palette, music } = init;
    const seed = init.seed ?? 20261101;
    const random = rng((seed ^ 0x9e3779b9) >>> 0);

    // 1. 提取专辑封面色相、饱和度与整体明度气质（实现 100% 跟随封面色彩与明暗）
    const tone = extractCoverTone(init);
    const meanLum = computeCoverLuminance(init.coverPixels, palette.light);
    const coverMood = clamp01((meanLum - 0.16) / 0.56); // 0=深邃星夜封面, 0.5=梦幻暮色, 1=清透明亮花园

    const mkLin = (stop: typeof tone.mid, minL: number, maxL: number, minS: number, maxS: number, bias = 0) => {
      const c = tuneCoverStop(stop, tone, minL, maxL, minS, maxS, bias);
      return linearVec3FromHsl(c.h, c.s, c.l);
    };

    const skyTop = mkLin(tone.dark, lerp(0.055, 0.28, coverMood), lerp(0.10, 0.38, coverMood), 0.38, 0.72, -8);
    const skyMid = mkLin(tone.midDark, lerp(0.13, 0.44, coverMood), lerp(0.22, 0.58, coverMood), 0.45, 0.80, -2);
    const skyHorizon = mkLin(tone.mid, lerp(0.26, 0.64, coverMood), lerp(0.38, 0.78, coverMood), 0.52, 0.88, 6);
    const mistGlow = mkLin(tone.highlight, lerp(0.60, 0.78, coverMood), lerp(0.76, 0.90, coverMood), 0.48, 0.86, 8);

    const waterDeep = mkLin(tone.dark, lerp(0.05, 0.16, coverMood), lerp(0.09, 0.24, coverMood), 0.42, 0.74, -6);
    const waterGlow = mkLin(tone.bright, 0.62, 0.80, 0.58, 0.92, 4);
    const foamWhite = linearVec3FromHsl(tone.highHue, tone.mono ? 0.03 : 0.22, 0.94);

    // 花坛三色花海色板（主色、高光奶油亮瓣、邻近和谐辅色）+ 与封面色调微融的自然草本绿叶
    const petalPrimary = mkLin(tone.mid, 0.48, 0.66, 0.58, 0.92, 0);
    const petalBright = mkLin(tone.highlight, 0.76, 0.90, 0.42, 0.85, 10);
    const analogousShift = ((tone.mainHue >= 280 || tone.mainHue <= 50) ? 26 : -26);
    const petalAccent = mkLin(tone.bright, 0.54, 0.72, 0.58, 0.92, analogousShift);

    const leafHueDelta = ((tone.deepHue - 142 + 540) % 360) - 180;
    const leafHue = (142 + leafHueDelta * 0.24 + 360) % 360;
    const foliageDeep = linearVec3FromHsl(leafHue, tone.mono ? 0.06 : 0.42, lerp(0.11, 0.22, coverMood));
    const foliageRim = linearVec3FromHsl((leafHue - 10 + 360) % 360, tone.mono ? 0.08 : 0.48, lerp(0.28, 0.46, coverMood));

    const stoneDark = linearVec3FromHsl(tone.deepHue, tone.mono ? 0.03 : 0.16, lerp(0.08, 0.22, coverMood));
    const stoneLight = linearVec3FromHsl(tone.mainHue, tone.mono ? 0.04 : 0.20, lerp(0.18, 0.42, coverMood));

    this.scene.background = colorFromHsl(tone.deepHue, tone.mono ? 0.04 : 0.45, lerp(0.06, 0.30, coverMood));

    // 2. 预构建确定性音乐事件
    const ev = buildFountainEvents(music, seed);
    this.arcEvents = ev.arcEvents;
    this.arcTimes = ev.arcTimes;
    this.ripples = ev.ripples;
    this.rippleTimes = ev.rippleTimes;

    const kicks = music.a.hits.kick ?? [];
    this.rawKickTimes = Float64Array.from(kicks, h => h[0]);
    this.rawKickVals = Float64Array.from(kicks, h => h[1]);

    const snares = music.a.hits.snare ?? [];
    this.rawSnareTimes = Float64Array.from(snares, h => h[0]);
    this.rawSnareVals = Float64Array.from(snares, h => h[1]);

    const hats = music.a.hits.hat ?? [];
    this.rawHatTimes = Float64Array.from(hats, h => h[0]);
    this.rawHatVals = Float64Array.from(hats, h => h[1]);

    this.uniforms = {
      uCover: { value: init.cover },
      uZero: { value: 0 },
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uKickPunch: { value: 0 },
      uKickWaveAge: { value: 10 },
      uHatSparkle: { value: 0 },
      uCenterSurge: { value: 0.3 },
      uSectionEnergy: { value: 0.5 },
      uSidechain: { value: 1.0 },
      uCoverMood: { value: coverMood },
      uPixelRatio: { value: 1.5 },
      uSkyTop: { value: skyTop },
      uSkyMid: { value: skyMid },
      uSkyHorizon: { value: skyHorizon },
      uMistGlow: { value: mistGlow },
      uWaterDeep: { value: waterDeep },
      uWaterGlow: { value: waterGlow },
      uFoamWhite: { value: foamWhite },
      uCoverDeep: { value: mkLin(tone.dark, 0.16, 0.28, 0.45, 0.78, -6) },
      uPetalPrimary: { value: petalPrimary },
      uPetalBright: { value: petalBright },
      uPetalAccent: { value: petalAccent },
      uFoliageDeep: { value: foliageDeep },
      uFoliageRim: { value: foliageRim },
      uStoneDark: { value: stoneDark },
      uStoneLight: { value: stoneLight },
      uChroma0: { value: new THREE.Vector4(0.15, 0.15, 0.15, 0.15) },
      uChroma1: { value: new THREE.Vector4(0.15, 0.15, 0.15, 0.15) },
      uChroma2: { value: new THREE.Vector4(0.15, 0.15, 0.15, 0.15) },
      uRippleA: { value: this.rippleA },
      uRippleB: { value: this.rippleB },
    };

    // 3. 天幕穹顶
    const skyGeo = new THREE.SphereGeometry(220, 48, 28);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -20;
    this.scene.add(skyMesh);

    // 4. 双层环形石砌花坛与庭院基座
    const stoneGeo = buildCourtyardStoneGeometry();
    const stoneMat = new THREE.ShaderMaterial({
      vertexShader: STONE_VERT,
      fragmentShader: STONE_FRAG,
      uniforms: this.uniforms,
      toneMapped: false,
    });
    const stoneMesh = new THREE.Mesh(stoneGeo, stoneMat);
    stoneMesh.renderOrder = 0;
    this.scene.add(stoneMesh);

    // 5. 圆形镜面水池（含水下琉璃封面折射与涟漪倒影）
    const basinGeo = new THREE.CircleGeometry(POOL_RADIUS, 128);
    basinGeo.rotateX(-Math.PI / 2);
    const basinMat = new THREE.ShaderMaterial({
      vertexShader: BASIN_VERT,
      fragmentShader: BASIN_FRAG,
      uniforms: this.uniforms,
      toneMapped: false,
    });
    const basinMesh = new THREE.Mesh(basinGeo, basinMat);
    basinMesh.renderOrder = 1;
    this.scene.add(basinMesh);

    // 6. 双层花坛坡面采样辅助函数（一层 r∈[9.18, 11.68]，二层 r∈[12.42, 15.68]）
    const bedHeightAt = (r: number, tier: 0 | 1): number => {
      if (tier === 0) return lerp(0.35, 0.67, clamp01((r - 9.06) / (11.78 - 9.06)));
      return lerp(1.03, 1.37, clamp01((r - 12.30) / (15.82 - 12.30)));
    };

    // 6a. 实例化绿植衬底（3000 簇）
    const foliageCount = 3000;
    const foliageGeo = buildFoliageClusterGeometry();
    const folPos = new Float32Array(foliageCount * 4);
    const folRot = new Float32Array(foliageCount * 2);
    for (let i = 0; i < foliageCount; i++) {
      const tier: 0 | 1 = i < 1350 ? 0 : 1;
      const u = random();
      const r = tier === 0 ? lerp(9.12, 11.72, Math.sqrt(u)) : lerp(12.38, 15.72, Math.sqrt(u));
      const theta = (i * 2.39996323) + (random() - 0.5) * 0.14;
      const y = bedHeightAt(r, tier) - 0.01;
      folPos[i * 4] = Math.cos(theta) * r;
      folPos[i * 4 + 1] = y;
      folPos[i * 4 + 2] = Math.sin(theta) * r;
      folPos[i * 4 + 3] = 0.85 + 0.55 * random();
      folRot[i * 2] = random() * Math.PI * 2;
      folRot[i * 2 + 1] = random() * 20;
    }
    foliageGeo.setAttribute('aInstPos', new THREE.InstancedBufferAttribute(folPos, 4));
    foliageGeo.setAttribute('aInstRot', new THREE.InstancedBufferAttribute(folRot, 2));
    foliageGeo.instanceCount = foliageCount;
    const foliageMesh = new THREE.Mesh(
      foliageGeo,
      new THREE.ShaderMaterial({
        vertexShader: FOLIAGE_VERT,
        fragmentShader: FOLIAGE_FRAG,
        uniforms: this.uniforms,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    foliageMesh.frustumCulled = false;
    foliageMesh.renderOrder = 2;
    this.scene.add(foliageMesh);

    // 6b. 实例化双层立体透光花簇（4200 朵，采用黄金角螺旋错落排布，繁茂自然无网格感）
    const flowerCount = 4200;
    const flowerGeo = buildSculptedFlowerGeometry();
    const flwPos = new Float32Array(flowerCount * 4);
    const flwStyle = new Float32Array(flowerCount * 4);
    for (let i = 0; i < flowerCount; i++) {
      const tier: 0 | 1 = i < 1950 ? 0 : 1;
      const u = random();
      const r = tier === 0 ? lerp(9.16, 11.68, Math.pow(u, 0.58)) : lerp(12.42, 15.68, Math.pow(u, 0.58));
      const theta = i * 2.39996323 + (random() - 0.5) * 0.12;
      const y = bedHeightAt(r, tier) + 0.05 + 0.07 * random();
      // 让同片小花丛的品种色彩自然成簇过渡，同时混入闪烁亮瓣
      const patchColor = 0.5 + 0.5 * Math.sin(theta * 5.0 + (tier === 0 ? 0.0 : 1.7) + r * 0.6);
      const colorMix = clamp01(patchColor * 0.72 + random() * 0.28);

      flwPos[i * 4] = Math.cos(theta) * r;
      flwPos[i * 4 + 1] = y;
      flwPos[i * 4 + 2] = Math.sin(theta) * r;
      flwPos[i * 4 + 3] = (tier === 0 ? 0.92 : 1.08) * (0.76 + 0.52 * random());

      flwStyle[i * 4] = random() * Math.PI * 2;
      flwStyle[i * 4 + 1] = colorMix;
      flwStyle[i * 4 + 2] = random() * Math.PI * 2;
      flwStyle[i * 4 + 3] = tier === 0 ? (r - 9.16) / 2.52 : (r - 12.42) / 3.26;
    }
    flowerGeo.setAttribute('aInstPos', new THREE.InstancedBufferAttribute(flwPos, 4));
    flowerGeo.setAttribute('aInstStyle', new THREE.InstancedBufferAttribute(flwStyle, 4));
    flowerGeo.instanceCount = flowerCount;
    const flowerMesh = new THREE.Mesh(
      flowerGeo,
      new THREE.ShaderMaterial({
        vertexShader: FLOWER_VERT,
        fragmentShader: FLOWER_FRAG,
        uniforms: this.uniforms,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    flowerMesh.frustumCulled = false;
    flowerMesh.renderOrder = 3;
    this.scene.add(flowerMesh);

    // 7a. 喷泉第一阶：池心三层水晶皇冠液丝水柱簇（中心主晶柱 1 + 内冠修长水柱 6 + 外护冠纤细水柱 12 = 19 道清澈水柱）
    const crownCount = 19;
    const crownGeo = buildWaterColumnGeometry();
    const crownNozzles = new Float32Array(crownCount * 4);
    const crownDyn = new Float32Array(crownCount * 4);
    crownNozzles.set([0, 0, 1.12, 0], 0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      crownNozzles.set([Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0.66, (k + 1) / 19], (k + 1) * 4);
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
      crownNozzles.set([Math.cos(a) * 1.54, Math.sin(a) * 1.54, 0.45, (k + 7) / 19], (k + 7) * 4);
    }
    crownGeo.setAttribute('aNozzle', new THREE.InstancedBufferAttribute(crownNozzles, 4));
    this.crownJetDynAttr = new THREE.InstancedBufferAttribute(crownDyn, 4);
    this.crownJetDynAttr.setUsage(THREE.DynamicDrawUsage);
    crownGeo.setAttribute('aJetDyn', this.crownJetDynAttr);
    crownGeo.instanceCount = crownCount;

    const jetMaterial = new THREE.ShaderMaterial({
      vertexShader: JET_VERT,
      fragmentShader: JET_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const crownMesh = new THREE.Mesh(crownGeo, jetMaterial);
    crownMesh.frustumCulled = false;
    crownMesh.renderOrder = 7;
    this.scene.add(crownMesh);

    // 7b. 喷泉第二阶与第三阶：中圈 24 道交织音阶抛物线水拱 + 外圈 36 道纤巧向心水晶水冠（统一 60 道清澈液丝抛物线）
    const arcCount = 60;
    const arcGeo = buildParabolicRibbonGeometry(56);
    const arcGeomData = new Float32Array(arcCount * 4);
    const arcStateData = new Float32Array(arcCount * 4);
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * Math.PI * 2;
      // 外环 12 道：从 r=6.75m 跨过 30° 螺旋交织向池心 r=1.92m 跃入，形成水晶皇冠交叉水拱
      arcGeomData.set([6.75, 1.92, a0, a0 + 0.52], k * 4);
      // 内环 12 道：从 r=4.45m 反向旋转向外池 r=6.72m 优雅舒展
      const a1 = a0 + Math.PI / 12;
      arcGeomData.set([4.45, 6.72, a1, a1 - 0.44], (k + 12) * 4);
    }
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      // 外圈 36 道纤细向心水帘：从池沿 r=7.86m 向池内 r=6.38m 划出晶莹抛物线并自然散落微水珠
      arcGeomData.set([7.86, 6.38, a, a], (24 + k) * 4);
    }
    arcGeo.setAttribute('aArcGeom', new THREE.InstancedBufferAttribute(arcGeomData, 4));
    this.arcStateAttr = new THREE.InstancedBufferAttribute(arcStateData, 4);
    this.arcStateAttr.setUsage(THREE.DynamicDrawUsage);
    arcGeo.setAttribute('aArcState', this.arcStateAttr);
    arcGeo.instanceCount = arcCount;

    const arcMesh = new THREE.Mesh(
      arcGeo,
      new THREE.ShaderMaterial({
        vertexShader: ARC_VERT,
        fragmentShader: ARC_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    arcMesh.frustumCulled = false;
    arcMesh.renderOrder = 8;
    this.scene.add(arcMesh);

    // 8a. 细腻晶莹微水珠飞沫粒子（5200 颗锐利清透微水滴，折射点点银白星芒）
    const sprayCount = 5200;
    const sprayGeo = new THREE.BufferGeometry();
    const sprayPos = new Float32Array(sprayCount * 3);
    const spraySeeds = new Float32Array(sprayCount * 4);
    for (let i = 0; i < sprayCount; i++) {
      let baseR: number;
      if (i < 2200) {
        baseR = Math.pow(random(), 0.72) * 1.62;
      } else if (i < 3600) {
        baseR = (i % 2 === 0 ? 4.45 : 6.75) + (random() - 0.5) * 0.36;
      } else {
        baseR = 7.76 + (random() - 0.5) * 0.24;
      }
      spraySeeds[i * 4] = baseR;
      spraySeeds[i * 4 + 1] = random() * Math.PI * 2;
      spraySeeds[i * 4 + 2] = 0.25 + 0.75 * random();
      spraySeeds[i * 4 + 3] = random();
    }
    sprayGeo.setAttribute('position', new THREE.Float32BufferAttribute(sprayPos, 3));
    sprayGeo.setAttribute('aSpraySeed', new THREE.Float32BufferAttribute(spraySeeds, 4));
    const sprayPoints = new THREE.Points(
      sprayGeo,
      new THREE.ShaderMaterial({
        vertexShader: SPRAY_VERT,
        fragmentShader: SPRAY_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    sprayPoints.frustumCulled = false;
    sprayPoints.renderOrder = 9;
    this.scene.add(sprayPoints);

    // 9b. 气流托举漫天飘飞透光花瓣（420 片）
    const driftCount = 420;
    const driftGeo = buildSinglePetalGeometry();
    const driftSeeds = new Float32Array(driftCount * 4);
    for (let i = 0; i < driftCount; i++) {
      driftSeeds[i * 4] = lerp(7.8, 15.6, random());
      driftSeeds[i * 4 + 1] = random() * Math.PI * 2;
      driftSeeds[i * 4 + 2] = 3.2 + 4.5 * random();
      driftSeeds[i * 4 + 3] = random();
    }
    driftGeo.setAttribute('aDriftSeed', new THREE.InstancedBufferAttribute(driftSeeds, 4));
    driftGeo.instanceCount = driftCount;
    const driftMesh = new THREE.Mesh(
      driftGeo,
      new THREE.ShaderMaterial({
        vertexShader: PETAL_DRIFT_VERT,
        fragmentShader: PETAL_DRIFT_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    driftMesh.frustumCulled = false;
    driftMesh.renderOrder = 9;
    this.scene.add(driftMesh);

    // 10. 歌词排版：搭配柔和暗底 scrim 落于画面中下部清澈水池视觉区，不遮挡中心冲天水舞
    const lyricPalette: Palette = {
      ...palette,
      ink: colorFromHsl(tone.deepHue, tone.mono ? 0.04 : 0.48, 0.06),
      paper: new THREE.Color('#fffdf9'),
      signal: colorFromHsl(tone.highHue, tone.mono ? 0.16 : 0.88, 0.74),
      light: coverMood > 0.55,
    };
    this.rig = new LyricRig(lyricPalette, 'caption');
    this.rig.faces = voiceFaces(look, seed);
    this.scene.add(this.rig.group);

    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setViewport(_width: number, _height: number, pixelRatio: number): void {
    this.uniforms.uPixelRatio.value = Math.max(1, pixelRatio);
  }

  /** 带 26ms 柔顺起音阻尼的纯函数瞬态脉冲求值 */
  private evalPulse(times: Float64Array, vals: Float64Array, t: number, decay: number): number {
    if (!times.length) return 0;
    const i = lastIndex(times, t);
    if (i < 0) return 0;
    const one = (idx: number): number => {
      if (idx < 0 || idx >= times.length) return 0;
      const age = t - times[idx];
      if (age < 0) return 0;
      const v = vals[idx] ?? 0;
      if (age < 0.026) {
        const u = age / 0.026;
        return v * u * u * (3 - 2 * u);
      }
      return v * Math.exp(-(age - 0.026) / decay);
    };
    return Math.max(one(i), one(i - 1));
  }

  /** 计算单个喷泉庭院机位在时刻 t 的目标姿态（纯函数）。 */
  private evalCameraPose(t: number, s: Shot, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const span = Math.max(0.8, s.end - s.start);
    const k = clamp01((t - s.start) / span);
    const e = inOutCubic(k);
    const dir = (stableShotSeed(s) & 1) === 0 ? 1 : -1;
    const variant = s.variant || 'courtyard';

    if (variant === 'orbit') {
      // 中景环池巡礼：沿正面宽幅圆弧平滑巡游，尽览双层发光花海、对称水拱与池底封面
      const theta = lerp(-0.68 * dir, 0.68 * dir, e);
      const rad = 16.4 - 0.9 * Math.sin(k * Math.PI);
      const y = 4.65 + 0.35 * Math.sin(t * 0.25);
      poseLookAt(pos, quat, Math.sin(theta) * rad, y, Math.cos(theta) * rad, Math.sin(theta) * 0.6, 1.55, 0);
    } else if (variant === 'skim') {
      // 低角度掠水穿拱：贴近内圈花沿与波光池面滑行，仰望晶莹的抛物线水拱在头顶交织
      const theta = lerp(-0.42 * dir, 0.36 * dir, e);
      const rad = lerp(9.6, 7.25, e);
      const y = 1.24 + 0.10 * Math.sin(t * 0.32);
      poseLookAt(pos, quat, Math.sin(theta) * rad, y, Math.cos(theta) * rad, 0, 2.25 + 0.15 * Math.sin(t * 0.24), -0.8);
    } else if (variant === 'crown') {
      // 斜高机位花冠俯瞰：圆形琉璃封面、12 重放射抛物线水拱与双层花海构成盛开的光之曼陀罗
      const theta = lerp(-0.34 * dir, 0.34 * dir, e);
      const rad = lerp(11.6, 9.8, e);
      const y = lerp(13.2, 14.4, Math.sin(k * Math.PI));
      poseLookAt(pos, quat, Math.sin(theta) * rad, y, Math.cos(theta) * rad, 0, 0.45, -0.35);
    } else {
      // courtyard（花畔平视微仰）：前景柔焦摇曳发光花簇，中景冲天水幕与镜面倒影，纵深感极强
      const theta = lerp(-0.26 * dir, 0.26 * dir, e);
      const rad = lerp(14.3, 12.8, e);
      const y = 2.08 + 0.14 * Math.sin(t * 0.26);
      poseLookAt(pos, quat, Math.sin(theta) * rad, y, Math.cos(theta) * rad, 0, 2.15 + 0.12 * Math.sin(t * 0.2), -0.4);
    }
  }

  /** 四组电影级丝滑镜头机位（courtyard / orbit / skim / crown），同场景切镜时平滑衔接 */
  private updateCamera(t: number, shot: Shot): void {
    blendCameraPose((time, s, pos, quat) => this.evalCameraPose(time, s, pos, quat), t, shot, this.camera, 1.45);
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, fx } = ctx;
    this.updateCamera(t, shot);

    const beat = music.at(t);
    const fg = music.foregroundAt(t);
    const lowEnv = music.env('low', t);
    const midEnv = music.env('mid', t);
    const highEnv = music.env('high', t);

    const kickPulse = this.evalPulse(this.rawKickTimes, this.rawKickVals, t, 0.24);
    const snarePulse = this.evalPulse(this.rawSnareTimes, this.rawSnareVals, t, 0.20);
    const hatPulse = this.evalPulse(this.rawHatTimes, this.rawHatVals, t, 0.14);

    // 最近一次强底鼓距今的时间（驱动池畔双层花坛由内向外扩散的绽放光浪）
    const lastKickIdx = lastIndex(this.rawKickTimes, t);
    let kickWaveAge = 10;
    for (let k = lastKickIdx; k >= 0 && k > lastKickIdx - 6; k--) {
      if ((this.rawKickVals[k] ?? 0) >= 0.26) {
        kickWaveAge = t - this.rawKickTimes[k];
        break;
      }
    }

    // 段落情绪基准：主歌/间奏静谧涌泉，铺垫逐级蓄势，副歌/Drop 盛大音乐喷泉全开
    const label = shot.section.label;
    const secDrive = label === 'drop' ? 1.0
      : label === 'chorus' ? 0.90
      : label === 'build' || label === 'pre' ? 0.68
      : label === 'intro' || label === 'break' || label === 'outro' ? 0.32
      : 0.48;
    const energy = clamp01(secDrive * 0.65 + shot.section.energy * 0.35);

    const phaseBreath = 0.92 + 0.14 * Math.sin(beat.phase * Math.PI);
    const sidechain = clamp01(phaseBreath - 0.10 * kickPulse + 0.12 * lowEnv);
    const hatSparkle = clamp01(hatPulse * 0.85 + highEnv * 0.48);

    // 1. 更新 12 半音色度向量
    music.chromaAt(t, this.chromaBuf);
    let maxC = 0.001;
    for (let k = 0; k < 12; k++) if (this.chromaBuf[k] > maxC) maxC = this.chromaBuf[k];
    const normChroma = (k: number) => clamp01((this.chromaBuf[k] / maxC) * (0.35 + 0.65 * this.chromaBuf[k]));

    // 2. 更新池心三层水晶皇冠液丝水柱簇（0: 中心主晶柱, 1..6: 内冠护卫水柱, 7..18: 外护冠纤细水柱）
    const centerSurge = clamp01(0.22 + 0.56 * energy + 0.34 * kickPulse + 0.26 * fg.level);
    const mainHeight = (this.soft ? 0.86 : 1.0) * (1.70 + 5.60 * energy + 2.10 * kickPulse + 1.20 * fg.level);
    const crownArr = this.crownJetDynAttr.array as Float32Array;
    crownArr[0] = mainHeight;
    crownArr[1] = 0.0;
    crownArr[2] = clamp01(0.45 + 0.65 * kickPulse + 0.45 * energy);
    crownArr[3] = 0.13;

    for (let k = 0; k < 6; k++) {
      const cVal = normChroma((k * 2) % 12);
      const wave = 0.5 + 0.5 * Math.sin(beat.pos * Math.PI * 0.5 + (k / 6) * Math.PI * 2);
      const subH = (1.10 + 3.45 * energy + 1.20 * cVal + 0.95 * kickPulse) * (0.80 + 0.30 * wave);
      const base = (k + 1) * 4;
      crownArr[base] = subH;
      crownArr[base + 1] = 0.16 + 0.12 * snarePulse;
      crownArr[base + 2] = clamp01(0.32 + 0.52 * cVal + 0.35 * kickPulse);
      crownArr[base + 3] = (k + 1) * 0.17;
    }

    for (let k = 0; k < 12; k++) {
      const cVal = normChroma(k);
      const wave = 0.5 + 0.5 * Math.cos(beat.pos * Math.PI * 0.5 - (k / 12) * Math.PI * 2);
      const outerSubH = (0.68 + 2.15 * energy + 0.95 * cVal + 0.62 * kickPulse) * (0.76 + 0.34 * wave);
      const base = (k + 7) * 4;
      crownArr[base] = outerSubH;
      crownArr[base + 1] = 0.28 + 0.16 * snarePulse;
      crownArr[base + 2] = clamp01(0.28 + 0.50 * cVal + 0.30 * snarePulse);
      crownArr[base + 3] = (k + 7) * 0.23;
    }
    this.crownJetDynAttr.needsUpdate = true;

    // 3. 更新中圈 24 道音阶抛物线交织水拱 + 外圈 36 道纤巧向心水晶水冠（共 60 道清澈液丝抛物线）
    const arcArr = this.arcStateAttr.array as Float32Array;
    const pulsePos = new Float32Array(24).fill(-1);
    const pulseAmp = new Float32Array(24).fill(0);

    for (let i = lastIndex(this.arcTimes, t); i >= 0; i--) {
      const ev = this.arcEvents[i];
      const age = t - ev.t;
      if (age < 0) continue;
      if (age > ARC_FLIGHT * 1.28) break;
      const slot = ev.ring * 12 + ev.note;
      if (ev.amp > pulseAmp[slot]) {
        pulsePos[slot] = age / ARC_FLIGHT;
        pulseAmp[slot] = ev.amp;
      }
    }

    for (let k = 0; k < 12; k++) {
      const cVal = normChroma(k);
      const chase = 0.5 + 0.5 * Math.sin(beat.pos * (Math.PI / 2) - (k / 12) * Math.PI * 2);
      // 主歌轻柔保留少数优雅水弧；副歌/Drop 全部 12×2 水拱交织盛开
      const outerFlow = clamp01((energy * 0.68 + cVal * 0.52) * (0.45 + 0.55 * chase));
      const outerApex = 1.65 + 2.85 * energy + 0.95 * cVal;
      arcArr[k * 4] = outerApex;
      arcArr[k * 4 + 1] = outerFlow;
      arcArr[k * 4 + 2] = pulsePos[k];
      arcArr[k * 4 + 3] = pulseAmp[k];

      const chaseInner = 0.5 + 0.5 * Math.cos(beat.pos * (Math.PI / 2) + (k / 12) * Math.PI * 2);
      const innerFlow = clamp01((energy * 0.56 + cVal * 0.48 + snarePulse * 0.25) * (0.40 + 0.60 * chaseInner));
      const innerApex = 1.15 + 1.95 * energy + 0.75 * cVal;
      const idx2 = (k + 12) * 4;
      arcArr[idx2] = innerApex;
      arcArr[idx2 + 1] = innerFlow;
      arcArr[idx2 + 2] = pulsePos[k + 12];
      arcArr[idx2 + 3] = pulseAmp[k + 12];
    }

    // 外圈 36 道向心水晶水冠（正弦花冠旋转波 + 军鼓齐射水莲绽放，w=-1 标记纤巧向心水帘模式）
    for (let k = 0; k < 36; k++) {
      const ang = (k / 36) * Math.PI * 2;
      const cVal = normChroma(k % 12);
      const petalWave = 0.5 + 0.5 * Math.sin(ang * 6.0 - beat.pos * (Math.PI * 0.75));
      const counterWave = 0.5 + 0.5 * Math.cos(ang * 3.0 + beat.pos * (Math.PI * 0.5));
      const envMix = k % 3 === 0 ? lowEnv : k % 3 === 1 ? midEnv : highEnv;
      const crownApex = (0.46 + 1.48 * energy) * (0.46 + 0.38 * petalWave + 0.24 * counterWave)
        + 0.52 * cVal * energy
        + 0.68 * snarePulse;
      const crownFlow = clamp01(0.42 + 0.46 * envMix + 0.36 * snarePulse + 0.22 * cVal);
      const base = (24 + k) * 4;
      arcArr[base] = crownApex;
      arcArr[base + 1] = crownFlow;
      arcArr[base + 2] = -1.0;
      arcArr[base + 3] = -1.0;
    }
    this.arcStateAttr.needsUpdate = true;

    // 4. 填充池面活跃落水同心涟漪
    let rCount = 0;
    for (let i = lastIndex(this.rippleTimes, t); i >= 0 && rCount < MAX_RIPPLES; i--) {
      const rp = this.ripples[i];
      const age = t - rp.t;
      if (age < 0) continue;
      if (age > 3.2) break;
      const effAmp = rp.amp * (0.72 + 0.35 * energy);
      if (effAmp * Math.exp(-age / rp.tau) < 0.02 && age > 0.8) continue;
      this.rippleA[rCount].set(rp.x, rp.z, age, effAmp);
      this.rippleB[rCount].set(rp.maxRadius, rp.freq, rp.tau, 0);
      rCount++;
    }
    for (let i = rCount; i < MAX_RIPPLES; i++) {
      this.rippleA[i].set(0, 0, 0, 0);
      this.rippleB[i].set(0, 0, 0, 0);
    }

    // 5. 同步全局着色器 Uniforms
    const u = this.uniforms;
    u.uTime.value = t;
    u.uFlow.value = t * 0.85 + music.foregroundMotion(t, 0.25) * 0.22;
    u.uKickPunch.value = clamp01(kickPulse);
    u.uKickWaveAge.value = kickWaveAge;
    u.uHatSparkle.value = hatSparkle;
    u.uCenterSurge.value = centerSurge;
    u.uSectionEnergy.value = energy;
    u.uSidechain.value = sidechain;
    (u.uChroma0.value as THREE.Vector4).set(normChroma(0), normChroma(1), normChroma(2), normChroma(3));
    (u.uChroma1.value as THREE.Vector4).set(normChroma(4), normChroma(5), normChroma(6), normChroma(7));
    (u.uChroma2.value as THREE.Vector4).set(normChroma(8), normChroma(9), normChroma(10), normChroma(11));

    // 6. 后期效果调优：晶莹清澈的电影级微辉光，关闭 PULSE 段落切入暗墨闪黑（impact=0）与负片/双色闪白
    fx.impact = 0;
    fx.invert = 0;
    fx.duotone = 0;
    fx.glitch = Math.min(fx.glitch, 0.06);
    fx.zoom = Math.min(fx.zoom, 0.045);
    fx.bloom = (this.soft ? 0.21 : 0.19) + 0.06 * centerSurge + 0.03 * hatSparkle;
    fx.vignette = 0.40;
    fx.grain = 0.024;

    // 8. 更新下部水池区的 3D 歌词排版
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy * 0.8);
  }
}
