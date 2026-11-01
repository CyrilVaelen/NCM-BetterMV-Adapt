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

/** 构建三翼交叉 + 外包薄雾壳体的 3D 体积水柱几何体（保证任意平视或俯瞰角度均立体饱满） */
function buildWaterColumnGeometry(): THREE.InstancedBufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = []; // x: 横向[-1..1], y: 高度[0..1]
  const indices: number[] = [];

  const planes = 3;
  const ySegs = 20;
  for (let p = 0; p < planes; p++) {
    const base = positions.length / 3;
    const ang = (p / planes) * Math.PI;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let y = 0; y <= ySegs; y++) {
      const v = y / ySegs;
      // 喷口紧凑，向上微散成柔和水雾花冠
      const halfW = 0.22 + 0.46 * Math.pow(v, 1.35);
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

/** 构建屏幕朝向展宽的抛物线水拱丝带基础网格（沿轨迹参数 s ∈ [0..1] 细分 42 段） */
function buildParabolicRibbonGeometry(segs = 42): THREE.InstancedBufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = []; // x: side(-1..+1), y: s(0..1)
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

/** 构建双层环绕石砌花坛与水池边沿旋转体几何体（带材质分区标记 aZone） */
function buildCourtyardStoneGeometry(): THREE.BufferGeometry {
  // 轮廓点：[radius, y, zone]  zone: 0=池底暗石, 1=水池挑檐石栏, 2=隐藏洗墙灯槽, 3=花坛坡面植壤, 4=外围庭院石坪
  const profile: Array<[number, number, number]> = [
    [0.0, -0.66, 0],
    [8.38, -0.66, 0],
    [8.46, -0.06, 1],
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

// ── GLSL 着色器（模块级静态常量，保障 WebGL 着色器池跨曲目零重编译） ───────────────────────────────────────────────

const GLSL_NOISE = /* glsl */ `
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
`;

// 1. 封面色调天穹与远景花园散景穹顶
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
  vec3 d = normalize(vDir);
  float elev = clamp(d.y, -0.15, 1.0);
  float hMix1 = smoothstep(-0.04, 0.26, elev);
  float hMix2 = smoothstep(0.18, 0.78, elev);
  vec3 col = mix(uSkyHorizon, uSkyMid, hMix1);
  col = mix(col, uSkyTop, hMix2);

  // 随封面色流动的轻柔庭院流云与水雾霞光
  float az = atan(d.x, -d.z);
  vec2 cloudUv = vec2(az * 2.2 + uFlow * 0.035, elev * 3.8 - uFlow * 0.015);
  float clouds = fbm3(cloudUv);
  float cloudBand = smoothstep(0.02, 0.35, elev) * (1.0 - smoothstep(0.45, 0.90, elev));
  col += mix(uSkyHorizon, uMistGlow, 0.45) * smoothstep(0.42, 0.85, clouds) * cloudBand * (0.22 + 0.16 * uCoverMood) * uSidechain;

  // 喷泉中心冲天水柱激起的天际丁达尔水雾光晕
  float centerGlow = exp(-abs(d.x) * 3.2) * exp(-max(0.0, elev - 0.10) * 3.6) * smoothstep(-0.08, 0.08, elev);
  col += uMistGlow * centerGlow * (0.16 + 0.28 * uCenterSurge) * uSidechain;

  // 远景柔焦花园树冠剪影与浪漫庭院水雾地平线（消除花坛外缘与天穹的生硬交界）
  float treeHeight = 0.045 + 0.038 * fbm3(vec2(az * 4.5, 1.7)) + 0.018 * sin(az * 11.0);
  float canopyMask = 1.0 - smoothstep(treeHeight - 0.028, treeHeight + 0.035, elev);
  vec3 canopyShade = mix(uSkyTop * 0.52, uSkyMid * 0.72, 0.45);
  col = mix(col, canopyShade, canopyMask * smoothstep(-0.08, 0.01, elev) * 0.62);

  // 地平线空气透视柔光晨雾/暮霭
  float horizonMist = exp(-pow(max(0.0, elev + 0.01) / 0.085, 2.0));
  col = mix(col, mix(uSkyHorizon, uMistGlow, 0.38), horizonMist * (0.34 + 0.16 * uCenterSurge));

  // 远景庭院拱廊柔和散景灯火与高空微光星尘
  float horizonBand = exp(-pow((elev - 0.026) / 0.034, 2.0));
  float archLights = pow(0.5 + 0.5 * cos(az * 20.0), 10.0) * (0.65 + 0.35 * sin(az * 7.0 + uTime * 0.8));
  col += uMistGlow * horizonBand * archLights * (0.32 - 0.10 * uCoverMood) * uSidechain;

  vec2 starGrid = vec2(az * 95.0, elev * 95.0);
  float starCell = hash21(floor(starGrid));
  if (starCell > 0.986 && elev > 0.12) {
    float dist = length(fract(starGrid) - 0.5);
    float twinkle = 0.65 + 0.35 * sin(uTime * 2.4 + starCell * 40.0);
    col += uMistGlow * (1.0 - smoothstep(0.05, 0.34, dist)) * twinkle * (0.55 - 0.35 * uCoverMood);
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// 2. 双层环形石砌花坛、隐藏洗墙灯带与 12 音阶径向光槽
const STONE_VERT = /* glsl */ `
attribute float aZone;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vZone;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
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

  vec3 N = normalize(vNormal);
  vec3 L = normalize(vec3(0.0, 4.5, 0.0) - vWorldPos);
  float ndl = clamp(dot(N, L), 0.0, 1.0);

  vec3 baseCol = mix(uStoneDark, uStoneLight, 0.35 + 0.45 * clamp(N.y, 0.0, 1.0));
  baseCol *= 0.86 + 0.28 * grain;

  // 花坛植壤苔藓层（zone == 3）：温润深翠苔藓混合封面暗调，承托上方繁茂花丛
  if (vZone > 2.5 && vZone < 3.5) {
    baseCol = mix(uFoliageDeep * 0.58, uStoneDark * 0.72, 0.28) * (0.82 + 0.35 * grain);
  }

  // 外围庭院环形石砖拼缝与水泽微反光（zone == 4）
  if (vZone > 3.5) {
    float ringSeam = smoothstep(0.94, 0.995, cos(r * 5.2));
    float radSeam = smoothstep(0.96, 0.998, cos(ang * 24.0));
    baseCol *= 1.0 - 0.24 * max(ringSeam, radSeam);
    float fadeOut = 1.0 - smoothstep(17.0, 27.5, r);
    baseCol *= fadeOut;
  }

  // 喷泉中心光柱对石栏内壁的暖色漫反射洗亮
  float poolLight = exp(-max(0.0, r - 8.4) * 0.32) * (0.35 + 0.65 * ndl);
  baseCol += uWaterGlow * poolLight * (0.16 + 0.18 * uKickPunch) * uSidechain;

  // 隐藏式阶梯洗墙灯带（zone == 2）与 12 音阶径向嵌灯槽
  float coveMask = 1.0 - clamp(abs(vZone - 2.0), 0.0, 1.0);
  float chromaVal = chromaByAngle(ang);
  float radialSlot = pow(0.5 + 0.5 * cos(ang * 12.0), 18.0) * smoothstep(8.5, 9.0, r) * (1.0 - smoothstep(15.6, 16.3, r));
  vec3 ledCol = mix(uWaterGlow, uPetalBright, 0.42);
  baseCol += ledCol * coveMask * (0.55 + 0.55 * chromaVal + 0.45 * uKickPunch) * uSidechain;
  baseCol += ledCol * radialSlot * (0.20 + 0.65 * chromaVal) * (1.0 - clamp(abs(vZone - 1.0), 0.0, 1.0));

  // 底鼓向外扩散的环形流光波掠过双层石砌花坛
  if (uKickWaveAge >= 0.0 && uKickWaveAge < 1.8) {
    float waveR = 8.4 + uKickWaveAge * 6.5;
    float ringGlow = exp(-pow((r - waveR) / 0.85, 2.0)) * exp(-uKickWaveAge * 1.35);
    baseCol += uPetalBright * ringGlow * 0.38;
  }

  gl_FragColor = vec4(max(baseCol, vec3(0.0)), 1.0);
}
`;

// 3. 圆形镜面水池 + 池底圆形琉璃镶嵌专辑封面 + 解析式落水同心涟漪
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
uniform float uSidechain;
uniform float uCoverMood;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uWaterDeep;
uniform vec3 uWaterGlow;
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

void main() {
  vec2 xz = vWorldPos.xz;
  float r = length(xz);
  float ang = atan(xz.y, xz.x);

  // 1. 细腻微风毛细水纹 + 最多 14 组确定性水拱落水/底鼓同心涟漪（解析高度与梯度）
  float h = 0.0;
  vec2 grad = vec2(0.0);

  vec2 w1 = xz * 2.6 + vec2(uFlow * 0.55, -uFlow * 0.42);
  vec2 w2 = xz * 4.1 + vec2(-uFlow * 0.48, uFlow * 0.62);
  grad += vec2(cos(w1.x) * sin(w1.y), sin(w1.x) * cos(w1.y)) * 0.010;
  grad += vec2(cos(w2.x + w2.y), cos(w2.x + w2.y)) * 0.007;

  float rippleCaustic = 0.0;
  for (int i = uZero; i < ${MAX_RIPPLES}; i++) {
    vec4 ra = uRippleA[i];
    if (ra.w <= 0.001) continue;
    vec4 rb = uRippleB[i];
    vec2 dVec = xz - ra.xy;
    float dist = length(dVec) + 1e-4;
    if (dist > rb.x + 0.8) continue;

    float front = ra.z * (rb.x / max(0.35, rb.z * 1.35));
    float env = exp(-ra.z / rb.z) * exp(-pow((dist - front) / 0.68, 2.0)) * (1.0 - smoothstep(rb.x * 0.78, rb.x, dist));
    float phase = dist * rb.y - ra.z * 11.5;
    float s = sin(phase);
    float c = cos(phase);
    float amp = ra.w * 0.032 * env;
    h += s * amp;
    grad += (dVec / dist) * (c * rb.y * amp);
    rippleCaustic += max(0.0, c) * env * ra.w;
  }

  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 V = normalize(cameraPosition - vWorldPos);

  // 2. 视线经水波真实折射至池底 (depth = 0.65m)：呈现池底圆形琉璃马赛克镶嵌专辑封面
  vec3 refr = refract(-V, N, 0.75);
  vec2 floorXZ = xz + refr.xz * (0.65 / max(0.24, -refr.y)) + grad * 1.45;
  float rFloor = length(floorXZ);

  vec3 floorCol = uWaterDeep * (0.65 + 0.35 * fbm3(floorXZ * 1.8));
  if (rFloor < ${MEDALLION_RADIUS.toFixed(2)} + 0.28) {
    // 端正无拉伸映射圆形琉璃封面（世界 +X 向右，-Z 向上朝向正面观众）
    vec2 coverUv = vec2(
      floorXZ.x / (${(MEDALLION_RADIUS * 2).toFixed(2)}) + 0.5,
      0.5 - floorXZ.y / (${(MEDALLION_RADIUS * 2).toFixed(2)})
    );
    vec2 clampedUv = clamp(coverUv, 0.004, 0.996);
    vec3 coverTex = texture2D(uCover, clampedUv).rgb;

    // 精致琉璃马赛克微晶格倒角高光（既保留封面清晰画面，又赋予水下琉璃砖镶嵌质感）
    vec2 tileGrid = abs(fract(floorXZ * 5.5) - 0.5);
    float grout = smoothstep(0.43, 0.49, max(tileGrid.x, tileGrid.y));
    float tileBevel = 1.0 + 0.08 * (1.0 - 2.0 * length(tileGrid)) - 0.14 * grout;

    float innerMask = 1.0 - smoothstep(${MEDALLION_RADIUS.toFixed(2)} - 0.08, ${MEDALLION_RADIUS.toFixed(2)} + 0.02, rFloor);
    // 双层鎏金/琉璃圆环镶边
    float ringBezel = exp(-pow((rFloor - ${MEDALLION_RADIUS.toFixed(2)}) / 0.075, 2.0))
                    + 0.55 * exp(-pow((rFloor - (${MEDALLION_RADIUS.toFixed(2)} - 0.22)) / 0.045, 2.0));

    vec3 mosaicCol = coverTex * tileBevel * (0.78 + 0.26 * uSidechain + 0.16 * uCenterSurge);
    floorCol = mix(floorCol, mosaicCol, innerMask);
    floorCol += mix(uWaterGlow, uPetalBright, 0.5) * ringBezel * (0.55 + 0.35 * uKickPunch);
  }

  // 水池底部 12 组音阶水下射灯与中心主射灯焦散光斑
  float centerLamp = exp(-rFloor * rFloor * 0.32) * (0.45 + 0.75 * uCenterSurge);
  float normAng = fract(ang / 6.2831853 + 1.0) * 12.0;
  int nozzleIdx = int(mod(floor(normAng + 0.5), 12.0));
  float nozzleAng = float(nozzleIdx) * (6.2831853 / 12.0);
  vec2 nozzlePos = vec2(cos(nozzleAng), sin(nozzleAng)) * 6.75;
  vec2 innerNozzlePos = vec2(cos(nozzleAng + 0.2618), sin(nozzleAng + 0.2618)) * 4.45;
  float cVal = chromaAtIdx(nozzleIdx);
  float lampGlow = exp(- dot(floorXZ - nozzlePos, floorXZ - nozzlePos) * 0.85) * (0.28 + 0.85 * cVal)
                 + exp(- dot(floorXZ - innerNozzlePos, floorXZ - innerNozzlePos) * 1.1) * (0.22 + 0.70 * cVal);

  floorCol += uWaterGlow * (centerLamp * 0.55 + lampGlow * 0.48) * uSidechain;
  floorCol += mix(uWaterGlow, uPetalBright, 0.45) * rippleCaustic * 0.28;

  // 薄水深吸收与清澈透射
  vec3 underWater = mix(floorCol, uWaterDeep, 0.18);

  // 3. 菲涅尔镜面反射：倒映封面色天穹、中心冲天发光水柱与池畔双层花海流光
  vec3 R = reflect(-V, N);
  float fresnel = 0.06 + 0.86 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  vec3 reflSky = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.55, max(0.0, R.y)));

  // 水面上的中心水柱与花坛花海长倒影（随水波自然摇曳拉长）
  float jetRefl = exp(-pow(r * 0.38, 2.0)) * (0.35 + 0.85 * uCenterSurge);
  float flowerRefl = smoothstep(5.2, 8.45, r) * (0.32 + 0.25 * sin(ang * 8.0 + grad.x * 18.0));
  vec3 reflCol = reflSky
    + mix(uWaterGlow, vec3(1.0), 0.45) * jetRefl * 0.55 * uSidechain
    + mix(uPetalPrimary, uPetalBright, 0.4) * flowerRefl * 0.42 * uSidechain;

  vec3 col = mix(underWater, reflCol, clamp(fresnel, 0.06, 0.84));

  // 波峰高光镶边与反拍开镲星芒微闪
  float crestSpec = pow(clamp(length(grad) * 12.5, 0.0, 1.0), 1.75);
  col += mix(uWaterGlow, vec3(1.0), 0.55) * crestSpec * (0.22 + 0.28 * uCenterSurge);

  if (uHatSparkle > 0.02) {
    float glintNoise = vnoise(xz * 14.0 + vec2(uTime * 2.5, -uTime * 1.9));
    float glint = smoothstep(0.84, 0.985, glintNoise) * (0.35 + 2.5 * length(grad));
    col += mix(uPetalBright, vec3(1.0), 0.65) * glint * uHatSparkle * 1.35;
  }

  // 池沿石壁内侧柔和暗影接触过渡
  float edgeShadow = 1.0 - 0.28 * smoothstep(7.95, 8.55, r);
  col *= edgeShadow;

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
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

  // 底鼓径向绽放波：掠过花坛时花瓣微张、花冠轻抬
  float r = length(aInstPos.xz);
  float waveBloom = 0.0;
  if (uKickWaveAge >= 0.0 && uKickWaveAge < 1.8) {
    float waveR = 8.4 + uKickWaveAge * 6.5;
    waveBloom = exp(-pow((r - waveR) / 0.95, 2.0)) * exp(-uKickWaveAge * 1.25);
  }

  vec3 lp = position;
  if (aPetal.z < 1.5) {
    float openAmt = 0.08 * uSectionEnergy + 0.14 * waveBloom + 0.04 * uKickPunch;
    lp.xz *= 1.0 + openAmt * aPetal.y;
    lp.y -= openAmt * 0.04 * aPetal.y * aPetal.y;
  }
  lp *= aInstPos.w * (1.0 + 0.09 * waveBloom);

  // 绕 Y 轴实例旋转 + 朝向水池中心的自然倾角
  float yaw = aInstStyle.x;
  float cy = cos(yaw), sy = sin(yaw);
  vec3 rp = vec3(lp.x * cy - lp.z * sy, lp.y, lp.x * sy + lp.z * cy);
  vec3 rn = vec3(normal.x * cy - normal.z * sy, normal.y, normal.x * sy + normal.z * cy);

  // 庭院微风轻拂摇曳（纯时间函数）
  float breeze = 0.045 + 0.035 * uSectionEnergy;
  float sx = sin(uTime * 1.45 + aInstStyle.z + aInstPos.x * 0.35) * breeze * (0.35 + rp.y * 2.5);
  float sz = cos(uTime * 1.22 + aInstStyle.z * 1.3 + aInstPos.z * 0.35) * breeze * (0.35 + rp.y * 2.5);

  vec3 wp = aInstPos.xyz + rp + vec3(sx, 0.025 * waveBloom, sz);
  vWorldPos = wp;
  vNormalW = normalize(rn);
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

void main() {
  float u = vPetal.x;
  float v = vPetal.y;
  float layer = vPetal.z;

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  // 喷泉池心主光源方向
  vec3 toCenter = vec3(0.0, 2.6, 0.0) - vWorldPos;
  float distCenter = length(toCenter) + 1e-3;
  vec3 L = toCenter / distCenter;

  float r = length(vWorldPos.xz);
  float waveGlow = 0.0;
  if (uKickWaveAge >= 0.0 && uKickWaveAge < 1.8) {
    float waveR = 8.4 + uKickWaveAge * 6.5;
    waveGlow = exp(-pow((r - waveR) / 0.95, 2.0)) * exp(-uKickWaveAge * 1.25);
  }

  vec3 col;
  if (layer > 1.5) {
    // 发光暖金/封面高光花蕊核心，与深邃花心暗影形成精致反差
    col = mix(uPetalBright, vec3(1.0, 0.94, 0.76), 0.48) * (1.15 + 0.45 * uSectionEnergy + 0.55 * waveGlow);
  } else {
    // 封面主色、邻近辅色与奶油亮瓣的自然混种过渡，叠加单朵微明暗差以凸显近景花朵立体层次
    vec3 speciesCol = vColorSeed.x < 0.56
      ? mix(uPetalPrimary, uPetalAccent, vColorSeed.x / 0.56)
      : mix(uPetalAccent, uPetalBright, (vColorSeed.x - 0.56) / 0.44);
    float bloomVar = 0.84 + 0.30 * fract(vColorSeed.x * 13.7 + vColorSeed.y * 5.3);

    // 花心杯状环境光遮蔽 (Cup AO)：令每朵花瓣根部深邃浓郁、瓣尖晶莹透亮，拒绝近景糊成一片
    float cupAo = 0.36 + 0.64 * smoothstep(0.02, 0.68, v);
    float edgeSoft = smoothstep(0.55, 0.98, abs(u));
    float vein = 0.92 + 0.08 * cos(u * 18.0);
    vec3 baseRoot = mix(uCoverDeep * 0.72, speciesCol, 0.32 + 0.14 * layer);
    vec3 tipCol = mix(speciesCol, uPetalBright, 0.42 + 0.24 * layer + 0.18 * edgeSoft);
    col = mix(baseRoot, tipCol, smoothstep(0.10, 0.92, v)) * vein * cupAo * bloomVar;

    // 次表面半透明背光透射 (Subsurface Translucency) + 菲涅尔柔光瓣缘
    float ndl = clamp(dot(N, L), 0.0, 1.0);
    float backTrans = clamp(dot(-N, L), 0.0, 1.0) * (0.28 + 0.72 * v);
    float rim = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.5) * smoothstep(0.15, 0.85, v);
    float fountainFalloff = exp(-max(0.0, r - 8.6) * 0.16);

    float lightGain = 0.48 + 0.46 * ndl + 0.42 * backTrans * fountainFalloff;
    col *= lightGain * uSidechain;
    col += mix(speciesCol, uPetalBright, 0.65) * (rim * 0.26 + backTrans * 0.20 * fountainFalloff + waveGlow * 0.48);

    // 花瓣边缘露珠在高频开镲时的晶莹微闪
    if (uHatSparkle > 0.04 && v > 0.68) {
      float dew = fract(sin(dot(floor(vWorldPos.xz * 28.0), vec2(12.9898, 78.233))) * 43758.5453);
      if (dew > 0.93) col += vec3(0.95) * uHatSparkle * 0.55;
    }
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
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
  vNormalW = normalize(rn);
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

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(vec3(0.0, 3.0, 0.0) - vWorldPos);
  float ndl = clamp(dot(N, L), 0.0, 1.0);
  float rim = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.6);
  float r = length(vWorldPos.xz);
  float poolReach = exp(-max(0.0, r - 8.6) * 0.18);

  vec3 col = mix(uFoliageDeep, uFoliageRim, smoothstep(0.05, 0.92, vUv.y));
  col *= (0.48 + 0.52 * ndl) * uSidechain;
  col += mix(uFoliageRim, uWaterGlow, 0.45) * rim * 0.24 * poolReach;
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// 6. 池心主水柱、内冠副柱与外圈 36 道波浪水冠通用流线体积水舞着色器
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
  float h = max(0.25, aJetDyn.x);
  vHeightNorm = clamp(h / 8.5, 0.08, 1.0);

  vec3 lp = position;
  lp.xz *= aNozzle.z;
  lp.y *= h;

  // 外圈水冠沿径向向外优雅微倾成盛开水莲状
  float rNoz = length(aNozzle.xy);
  vec2 radDir = rNoz > 0.05 ? aNozzle.xy / rNoz : vec2(0.0);
  float flare = aJetDyn.y * uv.y * uv.y * h * 0.22;
  vec3 wp = vec3(aNozzle.x + radDir.x * flare, lp.y - 0.03, aNozzle.y + radDir.y * flare) + vec3(lp.x, 0.0, lp.z);

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
  float across = abs(vUv.x * 2.0 - 1.0); // 0 为水柱中轴，1 为水雾外缘
  float v = vUv.y;

  // 高速向上喷射的多尺度液丝与雾化泡沫纹理
  vec2 streakUv1 = vec2(vUv.x * 5.5 + vSeed * 7.1, v * (5.5 + 4.5 * vHeightNorm) - uTime * 8.6);
  vec2 streakUv2 = vec2(vUv.x * 11.0 - vSeed * 3.7, v * 11.0 - uTime * 12.4);
  float n1 = vnoise(streakUv1);
  float n2 = vnoise(streakUv2);
  float filament = 0.58 * n1 + 0.42 * n2;

  // 水柱向上逐渐雾化破碎，绝无生硬圆柱顶盖截断
  float radialMask = 1.0 - smoothstep(0.15, 0.98, across + 0.24 * v * (1.0 - n1));
  float topBreakup = 1.0 - smoothstep(0.66 + 0.18 * n1, 0.99, v);
  float baseSoft = smoothstep(0.0, 0.06, v);
  float alpha = radialMask * topBreakup * baseSoft * (0.42 + 0.55 * filament);
  if (alpha < 0.012) discard;

  // 水下射灯次表面透光：基座浓郁封面亮色，向上渐变为晶莹白沫与星点水珠
  float coreMask = exp(-across * across * 5.2) * smoothstep(0.35, 0.92, filament);
  vec3 baseLight = mix(uWaterGlow, uPetalBright, 0.35 + 0.35 * sin(vSeed * 6.28));
  vec3 col = mix(baseLight, uFoamWhite, clamp(0.28 + 0.52 * v + 0.45 * coreMask, 0.0, 1.0));

  float hdrGain = (0.78 + 0.95 * vGlow + 0.55 * coreMask) * (0.82 + 0.24 * uSidechain);
  // 顶端细碎水珠受反拍开镲点亮微闪
  if (uHatSparkle > 0.03 && v > 0.55) {
    hdrGain += smoothstep(0.75, 0.96, n2) * uHatSparkle * 0.95;
  }

  gl_FragColor = vec4(col * hdrGain, clamp(alpha * (0.62 + 0.38 * vGlow), 0.0, 0.92));
}
`;

// 7. 中圈 12×2 音阶抛物线交织水拱着色器（屏幕法线叉乘展宽，支持发光水包脉冲追逐）
const ARC_VERT = /* glsl */ `
attribute vec4 aArcGeom;  // x: rStart, y: rEnd, z: thetaStart, w: thetaEnd
attribute vec4 aArcState; // x: apexHeight, y: baseFlowLevel, z: pulsePos(-1..1.3), w: pulseAmp
uniform float uTime;
varying vec2 vUv;
varying float vFlowLevel;
varying float vPulse;
varying float vSeed;

vec3 evalParabola(float s, float r0, float r1, float a0, float a1, float hMax) {
  float r = mix(r0, r1, s);
  float a = mix(a0, a1, s);
  float y = 4.0 * hMax * s * (1.0 - s) - 0.02;
  return vec3(cos(a) * r, y, sin(a) * r);
}

void main() {
  float s = uv.y;
  float side = position.x; // -1 或 +1
  vUv = uv;
  vFlowLevel = aArcState.y;
  vSeed = fract(aArcGeom.z * 0.731 + aArcGeom.x * 0.17);

  // 计算主旋律音头触发的水包沿抛物线轨迹推进的高斯包络
  float pPos = aArcState.z;
  float pEnv = (pPos >= -0.25 && pPos <= 1.25)
    ? exp(-pow((s - pPos) / 0.16, 2.0)) * aArcState.w
    : 0.0;
  vPulse = pEnv;

  float hMax = max(0.35, aArcState.x * (1.0 + 0.18 * pEnv));
  vec3 center = evalParabola(s, aArcGeom.x, aArcGeom.y, aArcGeom.z, aArcGeom.w, hMax);
  vec3 ahead = evalParabola(min(1.0, s + 0.02), aArcGeom.x, aArcGeom.y, aArcGeom.z, aArcGeom.w, hMax);
  vec3 behind = evalParabola(max(0.0, s - 0.02), aArcGeom.x, aArcGeom.y, aArcGeom.z, aArcGeom.w, hMax);
  vec3 tangent = normalize(ahead - behind);

  vec3 toCam = normalize(cameraPosition - center);
  vec3 right = cross(tangent, toCam);
  float rl = length(right);
  right = rl > 1e-4 ? right / rl : vec3(1.0, 0.0, 0.0);

  // 水束宽度：喷口纤细凝练，拱顶与落水段微散成晶莹水珠带，脉冲经过处饱满鼓起
  float width = (0.065 + 0.075 * sin(s * 3.14159265) + 0.065 * pEnv) * (0.65 + 0.45 * clamp(vFlowLevel + pEnv, 0.0, 1.2));
  vec3 wp = center + right * (side * width);
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
${GLSL_NOISE}

void main() {
  float across = abs(vUv.x * 2.0 - 1.0);
  float s = vUv.y;

  // 沿抛物线高速飞跃的液滴流线纹理
  vec2 flowUv = vec2(vUv.x * 3.5 + vSeed * 9.0, s * 9.5 - uTime * 5.8);
  float stream = 0.60 * vnoise(flowUv) + 0.40 * vnoise(flowUv * 2.3 + vec2(3.1, -uTime * 2.4));

  float radial = 1.0 - smoothstep(0.10, 0.96, across);
  float ends = smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.92, 1.0, s));
  float vis = clamp(vFlowLevel * 0.85 + vPulse * 1.15, 0.0, 1.35);
  float alpha = radial * ends * (0.35 + 0.65 * stream) * vis;
  if (alpha < 0.012) discard;

  float core = exp(-across * across * 6.0);
  vec3 tint = mix(uWaterGlow, uPetalBright, 0.35 + 0.45 * s);
  vec3 col = mix(tint, uFoamWhite, clamp(0.32 + 0.48 * core + 0.35 * vPulse, 0.0, 1.0));

  float gain = (0.85 + 1.25 * vPulse + 0.55 * vFlowLevel + 0.40 * core) * (0.85 + 0.22 * uSidechain);
  if (uHatSparkle > 0.03) {
    gain += smoothstep(0.78, 0.97, stream) * uHatSparkle * 0.75;
  }

  gl_FragColor = vec4(col * gain, clamp(alpha * 0.86, 0.0, 0.94));
}
`;

// 8. 水下射灯丁达尔体积光束锥着色器
const CONE_VERT = /* glsl */ `
attribute vec4 aConeSpec; // x, z, radiusScale, heightScale
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vec3 lp = position * vec3(aConeSpec.z, aConeSpec.w, aConeSpec.z);
  vec3 wp = lp + vec3(aConeSpec.x, 0.0, aConeSpec.y);
  vWorldPos = wp;
  vNormalW = normalize(normal);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const CONE_FRAG = /* glsl */ `
uniform vec3 uMistGlow;
uniform vec3 uWaterGlow;
uniform float uCenterSurge;
uniform float uSidechain;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalW;
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  float edgeSoft = pow(abs(dot(normalize(vNormalW), V)), 1.8);
  float vertFade = smoothstep(0.0, 0.14, vUv.y) * pow(1.0 - vUv.y, 2.2);
  float a = edgeSoft * vertFade * (0.08 + 0.14 * uCenterSurge) * uSidechain;
  if (a < 0.004) discard;
  vec3 col = mix(uWaterGlow, uMistGlow, vUv.y);
  gl_FragColor = vec4(col * a, 1.0);
}
`;

// 9. 弹道雾化水珠散景粒子着色器（纯时间函数）
const SPRAY_VERT = /* glsl */ `
attribute vec4 aSpraySeed; // x: baseRadius, y: angle, z: speedScale, w: phaseOffset
uniform float uTime;
uniform float uCenterSurge;
uniform float uSectionEnergy;
uniform float uPixelRatio;
varying float vLife;
varying float vSpark;

void main() {
  float rate = 0.62 + 0.35 * aSpraySeed.z;
  float life = fract(uTime * rate + aSpraySeed.w);
  vLife = life;
  vSpark = fract(aSpraySeed.w * 37.3);

  float energyScale = 0.42 + 0.78 * max(uSectionEnergy, uCenterSurge);
  float angle = aSpraySeed.y + uTime * 0.12;
  float outVel = (0.65 + 1.85 * aSpraySeed.z) * (0.55 + 0.55 * energyScale);
  float upVel = (3.4 + 4.8 * aSpraySeed.z) * energyScale;

  float r = aSpraySeed.x + outVel * life;
  float y = max(0.02, upVel * life - 4.6 * life * life);
  vec3 wp = vec3(cos(angle) * r, y, sin(angle) * r);

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dist = max(1.2, -mv.z);
  // 近镜头粒子自然化为柔和景深虚化光斑（Bokeh）
  float bokehBoost = dist < 4.5 ? (4.5 - dist) * 3.2 : 0.0;
  gl_PointSize = clamp((18.0 * aSpraySeed.z / dist + bokehBoost) * uPixelRatio, 1.5, 28.0);
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
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float softDisc = pow(1.0 - r2, 1.8);
  float env = sin(vLife * 3.14159265);
  float spark = vSpark > 0.72 ? (1.0 + uHatSparkle * 1.6) : 1.0;
  vec3 col = mix(uWaterGlow, uFoamWhite, 0.58) * spark * uSidechain;
  gl_FragColor = vec4(col * softDisc * env * 0.52, 1.0);
}
`;

// 10. 随喷泉气流盘旋上升的飘飞花瓣着色器（纯时间函数）
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

  // 花瓣空中三维翻飞旋转
  float rx = uTime * 1.8 + aDriftSeed.w * 30.0;
  float rz = uTime * 1.3 + aDriftSeed.w * 17.0;
  float cx = cos(rx), sx = sin(rx);
  float cz = cos(rz), sz = sin(rz);
  vec3 p = position * (0.85 + 0.55 * vTint);
  p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  p = vec3(p.x * cz - p.y * sz, p.x * sz + p.y * cz, p.z);

  vec3 wp = vec3(cos(ang) * rad, y, sin(ang) * rad) + p;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  // 贴近镜头前方的花瓣自然柔化隐去，避免近景遮挡镜头
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

void main() {
  if (vFade < 0.02) discard;
  // 圆润水滴花瓣轮廓裁剪（顶端微带樱瓣柔和弧口，零多边形折线感）
  float px = (vUv.x - 0.5) * 2.0;
  float py = vUv.y;
  float halfW = sin(pow(clamp(py, 0.0, 1.0), 0.68) * 3.14159265);
  float petalMask = 1.0 - smoothstep(halfW * 0.72, halfW, abs(px));
  if (petalMask < 0.05) discard;

  vec3 base = vTint < 0.5 ? mix(uPetalPrimary, uPetalBright, vTint * 2.0) : mix(uPetalAccent, uPetalBright, (vTint - 0.5) * 2.0);
  vec3 col = mix(base, uPetalBright, vUv.y * 0.55) * (0.95 + 0.25 * uSidechain);
  gl_FragColor = vec4(col, clamp(vFade * petalMask * 0.86, 0.0, 0.90));
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
  private readonly ringJetDynAttr: THREE.InstancedBufferAttribute;
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

    // 7. 水下射灯丁达尔光束锥（中心主光锥 + 12 音阶外环光锥）
    const coneBase = new THREE.CylinderGeometry(0.85, 0.22, 1.0, 20, 1, true);
    coneBase.translate(0, 0.5, 0);
    const coneGeo = new THREE.InstancedBufferGeometry();
    coneGeo.index = coneBase.index;
    coneGeo.setAttribute('position', coneBase.getAttribute('position'));
    coneGeo.setAttribute('normal', coneBase.getAttribute('normal'));
    coneGeo.setAttribute('uv', coneBase.getAttribute('uv'));
    const coneSpecs = new Float32Array(13 * 4);
    coneSpecs.set([0, 0, 2.2, 5.2], 0);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      coneSpecs.set([Math.cos(a) * 6.75, Math.sin(a) * 6.75, 0.95, 2.8], (k + 1) * 4);
    }
    coneGeo.setAttribute('aConeSpec', new THREE.InstancedBufferAttribute(coneSpecs, 4));
    coneGeo.instanceCount = 13;
    const coneMesh = new THREE.Mesh(
      coneGeo,
      new THREE.ShaderMaterial({
        vertexShader: CONE_VERT,
        fragmentShader: CONE_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    coneMesh.frustumCulled = false;
    coneMesh.renderOrder = 5;
    this.scene.add(coneMesh);

    // 8a. 喷泉第一阶：池心冲天主水柱 (1) + 内冠护卫水柱 (6) = 7 道核心水柱
    const crownCount = 7;
    const crownGeo = buildWaterColumnGeometry();
    const crownNozzles = new Float32Array(crownCount * 4);
    const crownDyn = new Float32Array(crownCount * 4);
    crownNozzles.set([0, 0, 1.45, 0], 0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      crownNozzles.set([Math.cos(a) * 1.38, Math.sin(a) * 1.38, 0.82, (k + 1) / 6], (k + 1) * 4);
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

    // 8b. 喷泉第三阶：外圈 36 道环状波浪水冠（r = 7.72m）
    const ringJetCount = 36;
    const ringJetGeo = buildWaterColumnGeometry();
    const ringNozzles = new Float32Array(ringJetCount * 4);
    const ringDyn = new Float32Array(ringJetCount * 4);
    for (let k = 0; k < ringJetCount; k++) {
      const a = (k / ringJetCount) * Math.PI * 2;
      ringNozzles.set([Math.cos(a) * 7.72, Math.sin(a) * 7.72, 0.52, k / ringJetCount], k * 4);
    }
    ringJetGeo.setAttribute('aNozzle', new THREE.InstancedBufferAttribute(ringNozzles, 4));
    this.ringJetDynAttr = new THREE.InstancedBufferAttribute(ringDyn, 4);
    this.ringJetDynAttr.setUsage(THREE.DynamicDrawUsage);
    ringJetGeo.setAttribute('aJetDyn', this.ringJetDynAttr);
    ringJetGeo.instanceCount = ringJetCount;

    const ringJetMesh = new THREE.Mesh(ringJetGeo, jetMaterial);
    ringJetMesh.frustumCulled = false;
    ringJetMesh.renderOrder = 6;
    this.scene.add(ringJetMesh);

    // 8c. 喷泉第二阶：中圈 24 道（12 外向内螺旋交织 + 12 内向外绽放）抛物线音乐水拱
    const arcCount = 24;
    const arcGeo = buildParabolicRibbonGeometry(42);
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

    // 9a. 喷泉飞沫雾化散景粒子（2200 颗）
    const sprayCount = 2200;
    const sprayGeo = new THREE.BufferGeometry();
    const sprayPos = new Float32Array(sprayCount * 3);
    const spraySeeds = new Float32Array(sprayCount * 4);
    for (let i = 0; i < sprayCount; i++) {
      const isCenter = i < 1300;
      const baseR = isCenter ? random() * 1.45 : (i % 2 === 0 ? 4.45 : 6.75) + (random() - 0.5) * 0.4;
      spraySeeds[i * 4] = baseR;
      spraySeeds[i * 4 + 1] = random() * Math.PI * 2;
      spraySeeds[i * 4 + 2] = 0.35 + 0.65 * random();
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

  /** 四组电影级丝滑镜头机位（courtyard / orbit / skim / crown），保持正面半球以令池底琉璃封面始终端正朝向观众 */
  private updateCamera(t: number, shot: Shot): void {
    const span = Math.max(0.8, (shot.run?.end ?? shot.end) - (shot.run?.start ?? shot.start));
    const k = clamp01((t - (shot.run?.start ?? shot.start)) / span);
    const e = inOutCubic(k);
    const shotT = Math.max(0, t - (shot.run?.start ?? shot.start));
    const dir = (shot.seed & 1) === 0 ? 1 : -1;
    const variant = shot.variant || 'courtyard';

    if (variant === 'orbit') {
      // 中景环池巡礼：沿正面宽幅圆弧平滑巡游，尽览双层发光花海、对称水拱与池底封面
      const theta = lerp(-0.68 * dir, 0.68 * dir, e);
      const rad = 16.4 - 0.9 * Math.sin(k * Math.PI);
      const y = 4.65 + 0.35 * Math.sin(shotT * 0.25);
      this.camera.position.set(Math.sin(theta) * rad, y, Math.cos(theta) * rad);
      this.camera.lookAt(Math.sin(theta) * 0.6, 1.55, 0);
    } else if (variant === 'skim') {
      // 低角度掠水穿拱：贴近内圈花沿与波光池面滑行，仰望晶莹的抛物线水拱在头顶交织
      const theta = lerp(-0.42 * dir, 0.36 * dir, e);
      const rad = lerp(9.6, 7.25, e);
      const y = 1.24 + 0.10 * Math.sin(shotT * 0.32);
      this.camera.position.set(Math.sin(theta) * rad, y, Math.cos(theta) * rad);
      this.camera.lookAt(0, 2.25 + 0.15 * Math.sin(shotT * 0.24), -0.8);
    } else if (variant === 'crown') {
      // 斜高机位花冠俯瞰：圆形琉璃封面、12 重放射抛物线水拱与双层花海构成盛开的光之曼陀罗
      const theta = lerp(-0.34 * dir, 0.34 * dir, e);
      const rad = lerp(11.6, 9.8, e);
      const y = lerp(13.2, 14.4, Math.sin(k * Math.PI));
      this.camera.position.set(Math.sin(theta) * rad, y, Math.cos(theta) * rad);
      this.camera.lookAt(0, 0.45, -0.35);
    } else {
      // courtyard（花畔平视微仰）：前景柔焦摇曳发光花簇，中景冲天水幕与镜面倒影，纵深感极强
      const theta = lerp(-0.26 * dir, 0.26 * dir, e);
      const rad = lerp(14.3, 12.8, e);
      const y = 2.08 + 0.14 * Math.sin(shotT * 0.26);
      this.camera.position.set(Math.sin(theta) * rad, y, Math.cos(theta) * rad);
      this.camera.lookAt(0, 2.15 + 0.12 * Math.sin(shotT * 0.2), -0.4);
    }
    this.camera.updateMatrixWorld();
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

    // 2. 更新池心冲天主水柱 (0) 与 6 道内冠副水柱 (1..6)
    const centerSurge = clamp01(0.22 + 0.56 * energy + 0.34 * kickPulse + 0.26 * fg.level);
    const mainHeight = (this.soft ? 0.86 : 1.0) * (1.55 + 5.65 * energy + 2.15 * kickPulse + 1.25 * fg.level);
    const crownArr = this.crownJetDynAttr.array as Float32Array;
    crownArr[0] = mainHeight;
    crownArr[1] = 0.0;
    crownArr[2] = clamp01(0.45 + 0.65 * kickPulse + 0.45 * energy);
    crownArr[3] = 0.13;

    for (let k = 0; k < 6; k++) {
      const cVal = normChroma((k * 2) % 12);
      const wave = 0.5 + 0.5 * Math.sin(beat.pos * Math.PI * 0.5 + (k / 6) * Math.PI * 2);
      const subH = (0.85 + 3.15 * energy + 1.25 * cVal + 0.95 * kickPulse) * (0.78 + 0.32 * wave);
      const base = (k + 1) * 4;
      crownArr[base] = subH;
      crownArr[base + 1] = 0.24 + 0.18 * snarePulse;
      crownArr[base + 2] = clamp01(0.30 + 0.55 * cVal + 0.35 * kickPulse);
      crownArr[base + 3] = (k + 1) * 0.17;
    }
    this.crownJetDynAttr.needsUpdate = true;

    // 3. 更新中圈 24 道音阶抛物线交织水拱（读取最近活跃水包脉冲位置）
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
    this.arcStateAttr.needsUpdate = true;

    // 4. 更新外圈 36 道环状波浪水冠（正弦花冠旋转波 + 军鼓齐射水莲绽放）
    const ringArr = this.ringJetDynAttr.array as Float32Array;
    for (let k = 0; k < 36; k++) {
      const ang = (k / 36) * Math.PI * 2;
      const cVal = normChroma(k % 12);
      const petalWave = 0.5 + 0.5 * Math.sin(ang * 6.0 - beat.pos * (Math.PI * 0.75));
      const counterWave = 0.5 + 0.5 * Math.cos(ang * 3.0 + beat.pos * (Math.PI * 0.5));
      const envMix = k % 3 === 0 ? lowEnv : k % 3 === 1 ? midEnv : highEnv;
      const h = (0.38 + 1.85 * energy) * (0.42 + 0.42 * petalWave + 0.26 * counterWave)
        + 0.78 * cVal * energy
        + 0.92 * snarePulse;
      const base = k * 4;
      ringArr[base] = h;
      ringArr[base + 1] = -0.32 - 0.35 * snarePulse; // 略向池心聚拢并在军鼓时优雅起伏
      ringArr[base + 2] = clamp01(0.22 + 0.52 * envMix + 0.45 * snarePulse + 0.25 * cVal);
      ringArr[base + 3] = k * 0.113;
    }
    this.ringJetDynAttr.needsUpdate = true;

    // 5. 填充池面活跃落水同心涟漪
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

    // 6. 同步全局着色器 Uniforms
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

    // 7. 后期效果调优：柔和晶莹的电影级水雾辉光，抑制破坏花海色彩的负片与刺眼双色闪白
    fx.invert = 0;
    fx.duotone = 0;
    fx.glitch = Math.min(fx.glitch, 0.08);
    fx.zoom = Math.min(fx.zoom, 0.05);
    fx.bloom = (this.soft ? 0.26 : 0.24) + 0.08 * centerSurge + 0.04 * hatSparkle;
    fx.vignette = 0.42;
    fx.grain = 0.032;

    // 8. 更新下部水池区的 3D 歌词排版
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy * 0.8);
  }
}
