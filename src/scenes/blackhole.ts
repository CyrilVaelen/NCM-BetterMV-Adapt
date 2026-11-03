// 黑洞视界 · 星际黑曜石观测水台 (Event Horizon / Obsidian Astral Observatory):
// 融合《星际穿越》卡冈图雅级双光拱引力透镜奇观与近景星际黑曜石薄水观测甲板的恢弘唯美史诗场景。
// 空间构图（由近及远四层纯时间函数 f(t) 结构，零帧间状态累积，支持任意进度条跳转与无损离线 MP4 导出）：
// 1. 近景星际黑曜石观测水台：脚下铺展六棱微晶黑曜石甲板与 0.28m 超流体薄水镜面，近端居中镶嵌圆形蓝宝石专辑封面星盘与
//    12 宫半音黑金引力刻度外环；星盘区域保持端正微澜与低反射高保真通透，外围开阔黑曜石水道 1:1 实时水波倒映上方巨型黑洞；
// 2. 两侧开阔星际护舷导流碑与甲板星轨灯带：位于画幅两侧外翼（绝不遮挡中央黑洞吸积盘盘翼），随节拍攀升流光，构筑深空尺度参照；
// 3. 远景卡冈图雅双光拱黑洞：基于广义相对论轨道平面解析交点与有理化强场透镜公式（零循环极速求值，秒过 D3D11 编译），
//    无缝呈现横穿纯黑事件视界前方的近端吸积盘、高高拱起的顶部皇冠主光拱、兜底次级引力弯弧、不对称相对论多普勒光子环与爱因斯坦环双色封面星云；
// 4. 三段式宇宙史诗叙事：
//    - Breakdown（时间膨胀）：水面静谧如黑镜，反重力霍金星尘从黑曜石甲板外围缓缓升浮入深空；
//    - Build-up（潮汐坍缩）：漫天潮汐星尘沿对数螺旋轨道向事件视界外缘加速旋转汇聚，光子球层蓄势升温；
//    - Drop（奇点绽放）：南北两极从光子环外冠轰然贯通双螺旋相对论等离子圣光喷流，视界迸发真实弯曲背景星空的引力波空间透镜冲击环。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';
import { LyricRig } from './lyricRig.ts';
import { voiceFaces } from './lyricBlock.ts';
import { lastIndex, type Music } from '../director/music.ts';
import type { Palette } from '../render/palette.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl, rgbToHsl } from './coverTone.ts';

/** 水台最大并发确定性引力水波涟漪数（配合 uZero 屏障保障 D3D11 秒级着色器预编译） */
const MAX_RIPPLES = 14;
/** 苍穹最大并发引力波空间透镜冲击环数 */
const MAX_GRAV_WAVES = 4;
/** 深空伴星衍射星芒锚点总数（左右开阔星翼 × 16 颗伴星） */
const COMPANION_STAR_COUNT = 32;
/** 环绕黑洞与水台的三维潮汐星尘总数（含天空本体 + 水台镜像共 ×2 实例） */
const TIDAL_DUST_COUNT = 640;

/** 近景水下蓝宝石圆形封面星盘中心 Z 坐标与内外环半径（完整收纳于主景下方，且将黑洞倒影让位至后方开阔黑曜石水道） */
const MEDALLION_Z = 3.85;
const MEDALLION_RADIUS = 3.45;
const GRAV_RING_OUTER_R = 4.72;

/** 远景卡冈图雅黑洞世界坐标与史瓦西引力尺度常量（单位：米） */
const BH_X = 0.0;
const BH_Y = 13.5;
const BH_Z = -92.0;
const BH_MASS = 1.92;

/** 远景水台左右外翼星际黑曜石护舷导流碑坐标（置于盘翼外侧 x = ±29.5m，绝不遮挡吸积盘流体） */
const PYLON_X = 29.5;
const PYLON_Z = -52.0;
const PYLON_H = 12.2;

const CAM_FOV = 48;

interface CompanionStar {
  x: number;
  y: number;
  z: number;
  note: number;
  baseMag: number;
  colorMix: number;
}

interface ArpFlareEvent {
  /** 触发时刻（秒） */
  t: number;
  /** 半音索引 [0..11] */
  note: number;
  /** 命中的伴星索引 [0..31] */
  starIdx: number;
  /** 脉冲强度 [0..1.25] */
  amp: number;
}

interface WaterRippleEvent {
  t: number;
  x: number;
  z: number;
  maxRadius: number;
  amp: number;
  tau: number;
  freq: number;
}

interface GravWaveEvent {
  t: number;
  strength: number;
  speed: number;
  tau: number;
}

/** 计算专辑封面整体感知明度（0..1）并挖掘真实的第二对比色相（如日落红封面中的深邃远山蓝） */
function analyzeCoverSecondaryAndLum(
  pixels: Uint8ClampedArray,
  mainHue: number,
  mono: boolean,
  fallbackLight: boolean,
): { lum: number; secondaryHue: number } {
  if (!pixels || pixels.length < 16) {
    return {
      lum: fallbackLight ? 0.65 : 0.28,
      secondaryHue: mono ? 218 : (mainHue + 216) % 360,
    };
  }
  const totalPx = pixels.length >> 2;
  const step = Math.max(1, Math.floor(totalPx / 2048));
  let sumLum = 0;
  let count = 0;

  const BINS = 36;
  const hist = new Float64Array(BINS);

  for (let p = 0; p < totalPx; p += step) {
    const idx = p << 2;
    const r = pixels[idx] / 255;
    const g = pixels[idx + 1] / 255;
    const b = pixels[idx + 2] / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sumLum += y;
    count++;

    if (!mono) {
      const hsl = rgbToHsl(r, g, b);
      if (hsl.s > 0.14 && hsl.l > 0.06 && hsl.l < 0.92) {
        const diff = Math.abs((((hsl.h - mainHue) % 360) + 540) % 360 - 180);
        // 寻找与主色相相差 > 38° 的真实封面第二色相群落
        if (diff > 38) {
          const bin = Math.floor(hsl.h / 10) % BINS;
          hist[bin] += hsl.s * (1 - Math.abs(2 * hsl.l - 1) * 0.65);
        }
      }
    }
  }

  const lum = count > 0 ? sumLum / count : 0.35;
  if (mono) return { lum, secondaryHue: 218 };

  let bestBin = -1;
  let bestWeight = 0;
  for (let b = 0; b < BINS; b++) {
    const w = hist[(b + BINS - 1) % BINS] * 0.5 + hist[b] + hist[(b + 1) % BINS] * 0.5;
    if (w > bestWeight) {
      bestWeight = w;
      bestBin = b;
    }
  }

  if (bestBin >= 0 && bestWeight > count * 0.012) {
    return { lum, secondaryHue: (bestBin * 10 + 5) % 360 };
  }
  // 单色相封面：自动配比和谐的深空电离伴色（偏向深空蓝紫）
  const fallbackSec = (((mainHue + (mainHue < 180 ? 64 : -64)) % 360) + 360) % 360;
  return { lum, secondaryHue: fallbackSec };
}

/** 沿色相环最短弧插值角度（0..360），避免跨 0° 红紫与暖金线性求均值时误穿绿区 */
function lerpHueDeg(h1: number, h2: number, t: number): number {
  const delta = ((((h2 - h1) % 360) + 540) % 360) - 180;
  return (((h1 + delta * t) % 360) + 360) % 360;
}

/** 构建深空左右开阔星翼 32 颗伴星锚点（严格避开中央黑洞吸积盘主核心区） */
function buildCompanionStars(seed: number): CompanionStar[] {
  const random = rng((seed ^ 0x5b91e3a7) >>> 0);
  const stars: CompanionStar[] = [];
  for (let i = 0; i < COMPANION_STAR_COUNT; i++) {
    const side = i < COMPANION_STAR_COUNT / 2 ? -1 : 1;
    const localIdx = i % (COMPANION_STAR_COUNT / 2);
    const u = (localIdx + 0.5) / (COMPANION_STAR_COUNT / 2);
    // 分布在左右远翼星域（方位角 ±0.30..±0.66 rad，仰角 0.08..0.44 rad），不压在吸积盘上
    const az = side * (0.30 + 0.36 * ((localIdx * 0.618034 + random() * 0.16) % 1));
    const el = 0.08 + 0.35 * u + (random() - 0.5) * 0.05;
    const dist = 132 + 18 * random();
    const cosEl = Math.cos(el);
    stars.push({
      x: Math.sin(az) * cosEl * dist,
      y: Math.sin(el) * dist,
      z: -Math.cos(az) * cosEl * dist,
      note: i % 12,
      baseMag: 0.48 + 0.45 * random(),
      colorMix: random(),
    });
  }
  return stars;
}

/** 预提取全曲琶音星芒、水台半音涟漪与高潮引力波透镜冲击环（100% 确定性预计算） */
function buildTimelineEvents(
  music: Music,
  seed: number,
): {
  flares: ArpFlareEvent[];
  flareTimes: Float64Array;
  ripples: WaterRippleEvent[];
  rippleTimes: Float64Array;
  gravWaves: GravWaveEvent[];
  gravWaveTimes: Float64Array;
} {
  const random = rng((seed ^ 0x93d4c17b) >>> 0);
  const flares: ArpFlareEvent[] = [];
  const ripples: WaterRippleEvent[] = [];
  const gravWaves: GravWaveEvent[] = [];

  // 1. 提取主旋律与琶音音符事件
  const rawArp = music.roleHits('lead', 0, music.duration);
  const rawChords = music.roleHits('bassStab', 0, music.duration);
  const merged: Array<{ t: number; s: number }> = [];
  for (const [t, s] of rawArp) {
    if (s >= 0.16) merged.push({ t, s });
  }
  if (merged.length < Math.max(16, music.duration * 0.7)) {
    for (const [t, s] of rawChords) {
      if (s >= 0.24) merged.push({ t, s: s * 0.85 });
    }
  }
  merged.sort((a, b) => a.t - b.t);

  const chroma = new Float32Array(12);
  let lastT = -10;
  let wingToggle = 0;

  for (const item of merged) {
    if (item.t - lastT < 0.11) continue;
    lastT = item.t;

    music.chromaAt(item.t, chroma);
    let bestNote = 0;
    let bestVal = -1;
    for (let k = 0; k < 12; k++) {
      if (chroma[k] > bestVal) {
        bestVal = chroma[k];
        bestNote = k;
      }
    }

    wingToggle ^= 1;
    const baseIdx = wingToggle * 16 + (bestNote % 16);
    const starIdx = Math.min(COMPANION_STAR_COUNT - 1, baseIdx);
    const amp = Math.min(1.22, 0.48 + 0.74 * item.s);
    flares.push({ t: item.t, note: bestNote, starIdx, amp });

    // 在近景星盘外缘黑曜石水面对应方位激起清透涟漪（定位在外环外侧，保持内圆封面平整端正）
    const ringAng = (bestNote / 12) * Math.PI * 2 + (random() - 0.5) * 0.12;
    const ringR = GRAV_RING_OUTER_R + 0.35 + random() * 0.85;
    ripples.push({
      t: item.t,
      x: Math.cos(ringAng) * ringR,
      z: MEDALLION_Z + Math.sin(ringAng) * ringR,
      maxRadius: 2.8 + 1.6 * item.s,
      amp: 0.38 + 0.48 * item.s,
      tau: 1.15 + 0.35 * random(),
      freq: 7.4 + 1.8 * random(),
    });
  }

  // 2. 底鼓在星盘外环与中景黑洞倒影水道激起恢弘低频引力水纹
  let lastKickT = -10;
  for (const [kt, ks] of music.a.hits.kick ?? []) {
    if (ks < 0.32 || kt - lastKickT < 0.44) continue;
    lastKickT = kt;
    ripples.push({
      t: kt,
      x: (random() - 0.5) * 0.25,
      z: MEDALLION_Z + (random() - 0.5) * 0.25,
      maxRadius: 11.5 + 3.5 * ks,
      amp: 0.48 + 0.44 * ks,
      tau: 1.55,
      freq: 4.5,
    });
    const sec = music.section(kt);
    if (sec.label === 'drop' || sec.label === 'chorus') {
      ripples.push({
        t: kt + 0.06,
        x: (random() - 0.5) * 1.8,
        z: -9.5 + (random() - 0.5) * 2.0,
        maxRadius: 13.0 + 4.0 * ks,
        amp: 0.34 + 0.32 * ks,
        tau: 1.70,
        freq: 3.6,
      });
    }
  }
  ripples.sort((a, b) => a.t - b.t);

  // 3. 构建 Drop / 高能 Chorus 的引力波空间折射冲击环
  for (const sec of music.a.sections) {
    if (sec.label === 'drop') {
      gravWaves.push({ t: sec.start, strength: 1.18, speed: 0.48, tau: 2.35 });
      for (const db of music.downbeats) {
        if (db > sec.start + 1.8 && db < sec.end - 1.2) {
          const barIdx = lastIndex(music.downbeats, db);
          if (barIdx >= 0 && barIdx % 4 === 0) {
            gravWaves.push({ t: db, strength: 0.78, speed: 0.44, tau: 1.85 });
          }
        }
      }
    } else if (sec.label === 'chorus' && sec.energy >= 0.72) {
      gravWaves.push({ t: sec.start, strength: 0.84, speed: 0.44, tau: 1.95 });
    }
  }
  gravWaves.sort((a, b) => a.t - b.t);

  return {
    flares,
    flareTimes: Float64Array.from(flares, e => e.t),
    ripples,
    rippleTimes: Float64Array.from(ripples, e => e.t),
    gravWaves,
    gravWaveTimes: Float64Array.from(gravWaves, e => e.t),
  };
}

// ============================================================================
// 共享 GLSL 广义相对论解析双光拱黑洞与深空天体求值核心
// （同时供 SkyDome 与 ObsidianWaterDeck 反射调用，零离屏开销实现 1:1 真实三维视差倒影）
// ============================================================================
const GLSL_BLACKHOLE_COMMON = /* glsl */ `
const vec3 BH_CENTER = vec3(${BH_X.toFixed(2)}, ${BH_Y.toFixed(2)}, ${BH_Z.toFixed(2)});
const float BH_M = ${BH_MASS.toFixed(3)};
const float B_CRIT = 5.1961524 * BH_M; // 3 * sqrt(3) * M 史瓦西阴影临界撞击参数
const float DISK_IN = 3.55 * BH_M;     // 顺行克尔吸积盘内缘半径
const float DISK_OUT = 22.0 * BH_M;    // 吸积盘外缘半径

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm4(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise2(p);
    p = rot * p * 2.03 + vec2(17.1, 31.7);
    a *= 0.5;
  }
  return v;
}

// 零极点畸变的 3D 球面晶格锐利深空繁星层
vec3 sampleStarField(vec3 dir, float density, float timeVal, vec3 warmCol, vec3 coolCol) {
  vec3 p = dir * density;
  vec3 cell = floor(p);
  vec3 f = fract(p) - 0.5;
  vec3 rnd = hash33(cell);
  float starMask = step(0.66, rnd.z);
  vec3 starOffset = (rnd - 0.5) * 0.66;
  float d = length(f - starOffset);
  float size = 0.040 + 0.058 * rnd.x;
  float core = smoothstep(size, 0.0, d) * starMask;
  float halo = exp(-d * 14.0) * 0.30 * starMask * step(0.86, rnd.z);
  float twinkle = 0.74 + 0.26 * sin(timeVal * (1.6 + 2.8 * rnd.y) + rnd.x * 31.4);
  vec3 col = mix(coolCol, warmCol, smoothstep(0.2, 0.8, rnd.y));
  return col * (core * 1.38 + halo) * twinkle;
}

// 吸积盘流体丝绸螺旋等离子体、差速开普勒旋转与相对论多普勒集束求值
vec4 evalAccretionDiskSurface(
  float r,
  vec3 hitDir,
  vec3 rayDir,
  vec3 diskTan,
  vec3 diskBit,
  float flowTime,
  float sectionEnergy,
  float buildCharge,
  float dropIgnite,
  float kickPunch,
  float leadLevel,
  vec3 diskHot,
  vec3 diskPrimary,
  vec3 diskSecondary
) {
  if (r <= DISK_IN * 0.92 || r >= DISK_OUT * 1.06) return vec4(0.0);

  float u = clamp((r - DISK_IN) / (DISK_OUT - DISK_IN), 0.0, 1.0);
  float innerSoft = smoothstep(DISK_IN * 0.93, DISK_IN * 1.09, r);
  float outerSoft = 1.0 - smoothstep(DISK_OUT * 0.56, DISK_OUT * 1.05, r);
  float radialEnv = innerSoft * outerSoft * pow(1.0 - u * 0.84, 1.38);
  if (radialEnv <= 0.001) return vec4(0.0);

  // 盘面极角 theta 与开普勒差速旋转相位
  float px = dot(hitDir, diskTan);
  float pz = dot(hitDir, diskBit);
  float theta = atan(pz, px);

  float keplerOmega = 3.5 / pow(max(r / BH_M, 2.8), 1.12);
  float spinPhase = theta - flowTime * keplerOmega * (1.0 + 0.38 * buildCharge + 0.28 * dropIgnite);

  // 无接缝周期连续螺旋磁流体丝绸纹理（消除刚性机械条纹，呈现真实炽热等离子云流）
  float logR = log(max(r / DISK_IN, 1.001)) * 4.2;
  vec2 seamFreeA = vec2(
    logR * 2.2 - flowTime * 0.14,
    sin(spinPhase * 2.0 + logR * 3.1) * 1.65 + cos(spinPhase - logR * 1.9) * 1.35
  );
  vec2 seamFreeB = vec2(
    logR * 4.9 - flowTime * 0.28,
    cos(spinPhase * 3.0 + logR * 4.8) * 1.95 + sin(spinPhase * 2.0 + logR * 3.7) * 1.55
  );

  float filA = fbm4(seamFreeA);
  float filB = fbm4(seamFreeB);
  // 柔和绵密的丝状开普勒气旋流带（由湍流相位自然扰动，平滑无摩尔纹）
  float silkStream = 0.76 + 0.24 * sin(logR * 11.5 + filA * 5.4 - flowTime * 1.5);
  float wispDetail = 0.84 + 0.16 * cos(logR * 24.0 - filB * 4.8 + sin(spinPhase * 2.0));
  float plasmaDensity = (0.44 + 0.52 * filA + 0.36 * filB) * silkStream * wispDetail;

  // 主旋律与底鼓驱动的由内向外传播的等离子声波亮潮
  float sonicWave = 0.5 + 0.5 * cos(logR * 6.2 - flowTime * 4.4);
  float audioBoost = 1.0
    + (0.34 * leadLevel + 0.38 * kickPunch) * exp(-u * 3.0)
    + (0.28 * dropIgnite + 0.22 * sectionEnergy) * sonicWave * (1.0 - u * 0.62);

  // 相对论多普勒集束效应（迎面侧蓝移增亮，背离侧红移深金温润）
  vec3 orbVelDir = normalize(-sin(theta) * diskTan + cos(theta) * diskBit);
  float beta = clamp(sqrt(BH_M / max(r - 1.6 * BH_M, 1.8 * BH_M)) * 0.68, 0.0, 0.56);
  float mu = dot(-rayDir, orbVelDir);
  float doppler = sqrt(1.0 - beta * beta) / max(0.36, 1.0 - beta * mu);
  float beaming = clamp(pow(doppler, 2.30), 0.36, 2.40);
  float blueShift = clamp((doppler - 0.82) * 0.95, 0.0, 1.0);

  // 双色温史诗渐变：内圈炽白星金 -> 中圈饱满封面主色 -> 外缘深空第二对比色星雾
  float coreHeat = exp(-u * 4.2) * (0.86 + 0.42 * kickPunch + 0.34 * dropIgnite);
  vec3 tempCol = mix(diskSecondary, diskPrimary, smoothstep(0.88, 0.16, u));
  tempCol = mix(tempCol, diskHot, clamp(coreHeat + 0.44 * blueShift * (1.0 - u * 0.55), 0.0, 1.0));
  tempCol *= mix(vec3(1.05, 0.84, 0.70), vec3(0.95, 1.02, 1.12), blueShift);

  float intensity = radialEnv * plasmaDensity * beaming * audioBoost * (0.86 + 0.40 * sectionEnergy + 0.44 * dropIgnite);
  float opacity = clamp(radialEnv * (0.62 + 0.38 * plasmaDensity), 0.0, 0.97);
  return vec4(tempCol * intensity * 1.38, opacity);
}

// 统一求值给定起点 origin 与单位方向 dir 所看到的黑洞宇宙苍穹
vec3 evalBlackHoleCosmos(
  vec3 origin,
  vec3 dir,
  sampler2D coverTex,
  int zeroGuard,
  float timeVal,
  float flowTime,
  float sectionEnergy,
  float buildCharge,
  float dropIgnite,
  float kickPunch,
  float leadLevel,
  vec3 diskNormal,
  vec3 diskTan,
  vec3 diskBit,
  vec3 spaceZenith,
  vec3 spaceHorizon,
  vec3 nebulaCool,
  vec3 diskHot,
  vec3 diskPrimary,
  vec3 diskSecondary,
  vec3 starWarm,
  vec3 starCool,
  vec4 gravWaves[${MAX_GRAV_WAVES}]
) {
  vec3 toBh = BH_CENTER - origin;
  float L = length(toBh);
  vec3 uHat = toBh / max(L, 1e-4);
  float cosAlpha = dot(dir, uHat);
  vec3 perp = dir - uHat * cosAlpha;
  float sinAlpha = length(perp);
  vec3 tHat = sinAlpha > 1e-6 ? (perp / sinAlpha) : diskTan;

  float b = cosAlpha > 0.0 ? (L * sinAlpha) : (L * 2.0);

  // 1. 引力波空间透镜冲击环（Drop / Chorus 期间真实弯曲背景星空，带细腻星耀波前）
  float waveDeflect = 0.0;
  vec3 waveGlow = vec3(0.0);
  if (cosAlpha > 0.25) {
    float angDist = sinAlpha;
    for (int i = zeroGuard; i < ${MAX_GRAV_WAVES}; i++) {
      vec4 gw = gravWaves[i];
      if (gw.y <= 0.001 || gw.x < 0.0) continue;
      float waveR = 0.095 + gw.x * gw.z;
      float env = gw.y * exp(-gw.x / gw.w) * (1.0 - smoothstep(0.54, 0.86, waveR));
      if (env <= 0.002) continue;
      float diff = angDist - waveR;
      float width = 0.0085 + 0.0045 * gw.x;
      float deriv = -(diff / (width * width)) * exp(-(diff * diff) / (width * width));
      waveDeflect += deriv * width * env * 0.036;
      float ringBand = exp(-(diff * diff) / (width * width * 0.72));
      float echoBand = exp(-pow((angDist - waveR * 0.88) / (width * 0.55), 2.0)) * 0.35;
      waveGlow += mix(nebulaCool, diskHot, 0.55) * (ringBand + echoBand) * env * 0.19 * smoothstep(B_CRIT * 1.02, B_CRIT * 1.22, b);
    }
  }

  // 2. 背景深空星云、繁星与爱因斯坦环（严格在 b <= B_CRIT 事件视界内部归于绝对纯黑！）
  float horizonMask = cosAlpha > 0.0
    ? smoothstep(B_CRIT - 0.045 * BH_M, B_CRIT + 0.055 * BH_M, b)
    : 1.0;

  vec3 bgSky = vec3(0.0);
  if (horizonMask > 0.002) {
    float safeB = max(b, B_CRIT * 1.002);
    float deflect = (cosAlpha > 0.0)
      ? ((4.0 * BH_M / safeB) + (11.78 * BH_M * BH_M) / (safeB * safeB))
      : 0.0;
    float alpha = asin(clamp(sinAlpha, 0.0, 1.0));
    float lensedAlpha = alpha - deflect + waveDeflect;
    vec3 lensedDir = cosAlpha > 0.0
      ? normalize(cos(lensedAlpha) * uHat + sin(lensedAlpha) * tHat)
      : dir;

    float upH = clamp(lensedDir.y, 0.0, 1.0);
    bgSky = mix(spaceHorizon, spaceZenith, pow(upH, 0.52));

    // 斜跨深空的双色丝绒银河尘埃带（融合封面第二对比色与主色，烘托冷暖宇宙纵深）
    vec3 galAxis = normalize(vec3(-0.38, 0.76, 0.52));
    float galPlane = abs(dot(lensedDir, galAxis));
    float galBand = exp(-pow(galPlane * 3.6, 1.65));
    vec2 nebUv = vec2(
      atan(lensedDir.x, -lensedDir.z) * 1.9 + flowTime * 0.012,
      lensedDir.y * 2.5 - flowTime * 0.008
    );
    float nebA = fbm4(nebUv * 1.65);
    float nebB = fbm4(nebUv * 3.3 + vec2(4.2, -2.7));
    float dustRift = smoothstep(0.30, 0.72, fbm4(nebUv * 2.7 + vec2(9.1, 3.4)));

    vec3 nebula = nebulaCool * (galBand * nebA * (0.24 + 0.18 * sectionEnergy))
                + diskPrimary * (galBand * nebB * (0.14 + 0.12 * dropIgnite));
    nebula *= (1.0 - 0.54 * dustRift * galBand);
    bgSky += nebula;

    // 爱因斯坦环封面星云母体：在黑洞外缘折射出流淌的封面色彩光晕
    if (cosAlpha > 0.55) {
      vec2 einsteinCoord = vec2(dot(lensedDir - uHat, diskTan), dot(lensedDir - uHat, diskBit)) * 2.5 + 0.5;
      if (einsteinCoord.x > 0.02 && einsteinCoord.x < 0.98 && einsteinCoord.y > 0.02 && einsteinCoord.y < 0.98) {
        vec3 covSample = texture2D(coverTex, einsteinCoord).rgb;
        float einsteinRing = exp(-pow((b - B_CRIT * 1.45) / (BH_M * 3.8), 2.0));
        bgSky += covSample * einsteinRing * (0.18 + 0.15 * sectionEnergy + 0.16 * dropIgnite) * (0.55 + 0.45 * nebA);
      }
    }

    float horizonFade = smoothstep(-0.02, 0.12, dir.y);
    vec3 stars = sampleStarField(lensedDir, 78.0, timeVal, starWarm, starCool)
               + sampleStarField(lensedDir * 1.19 + vec3(0.31, -0.17, 0.23), 142.0, timeVal * 0.82, starCool, starWarm) * 0.62;
    bgSky += stars * horizonFade * (0.88 + 0.28 * dropIgnite);
    bgSky *= horizonMask;
  }

  // 3. 卡冈图雅广义相对论解析双光拱吸积盘 + 次级光子子环 + 不对称光子环 + 双极喷流
  vec3 bhLight = vec3(0.0);
  float frontOccluder = 0.0;

  if (cosAlpha > 0.35 && b < DISK_OUT * 1.35) {
    vec3 cHat = -uHat;
    float nc = dot(cHat, diskNormal);
    float nt = dot(tHat, diskNormal);

    // 3a. 第 1 阶主像（无缝衔接横穿纯黑视界前方的近端吸积盘与上方皇冠主光拱）
    vec2 dirPsi = vec2(-nt, nc);
    if (dirPsi.y < 0.0) dirPsi = -dirPsi;
    float psiLen = max(length(dirPsi), 1e-6);
    float cosPsi1 = clamp(dirPsi.x / psiLen, -1.0, 1.0);
    float sinPsi1 = clamp(dirPsi.y / psiLen, 0.0, 1.0);
    float oneMinusCos = 1.0 - cosPsi1;

    float gravTerm = 2.0 * BH_M * oneMinusCos;
    float denom1 = sqrt(gravTerm * gravTerm + b * b * sinPsi1 * sinPsi1) + gravTerm;
    float r1 = (b * b) / max(denom1, 1e-4);

    float backSideWeight = smoothstep(0.18, -0.18, cosPsi1);
    float vis1 = mix(1.0, horizonMask, backSideWeight);

    vec4 disk1 = vec4(0.0);
    if (vis1 > 0.002 && r1 > DISK_IN * 0.92 && r1 < DISK_OUT * 1.06) {
      vec3 hitDir1 = normalize(cosPsi1 * cHat + sinPsi1 * tHat);
      disk1 = evalAccretionDiskSurface(
        r1, hitDir1, dir, diskTan, diskBit,
        flowTime, sectionEnergy, buildCharge, dropIgnite, kickPunch, leadLevel,
        diskHot, diskPrimary, diskSecondary
      );
      disk1 *= vis1;
    }

    // 3b. 第 2 阶强透镜次级像（底部兜底引力弯弧 & 顶部次级光子内环）
    vec4 disk2 = vec4(0.0);
    if (b > B_CRIT * 0.994 && b < B_CRIT + 5.8 * BH_M) {
      float db = max(0.0, (b - B_CRIT) / BH_M);
      float underExpand = mix(0.82, 2.55, smoothstep(-0.28, 0.38, nt));
      float uSub = db * underExpand;
      float r2 = DISK_IN * 0.96 + BH_M * (uSub * 2.45 + uSub * uSub * 0.78);
      if (r2 < DISK_OUT * 1.05) {
        vec3 hitDir2 = -normalize(cosPsi1 * cHat + sinPsi1 * tHat);
        disk2 = evalAccretionDiskSurface(
          r2, hitDir2, dir, diskTan, diskBit,
          flowTime * 1.04 + 1.57, sectionEnergy, buildCharge, dropIgnite, kickPunch, leadLevel,
          diskHot, diskPrimary, diskSecondary
        );
        float subMask = smoothstep(B_CRIT - 0.02 * BH_M, B_CRIT + 0.06 * BH_M, b);
        disk2.rgb *= subMask * mix(0.88, 0.60, smoothstep(-0.2, 0.35, nt));
        disk2.a *= subMask * 0.85;
      }
    }

    // 3c. 不对称相对论炽白光子环（紧贴事件视界阴影外缘 b == B_CRIT，内部绝不渗光）
    vec3 orbSideDir = normalize(cross(diskNormal, uHat));
    float sideDoppler = clamp(0.68 + 0.56 * dot(tHat, orbSideDir), 0.32, 1.38);
    float ringDist = abs(b - B_CRIT) / BH_M;
    float strictOutside = smoothstep(B_CRIT - 0.05 * BH_M, B_CRIT + 0.02 * BH_M, b);
    float photonCore = exp(-pow(ringDist / 0.095, 2.0)) * strictOutside;
    float photonHalo = exp(-ringDist * 1.95) * smoothstep(B_CRIT - 0.12 * BH_M, B_CRIT + 0.18 * BH_M, b);
    float photonPulse = 1.0 + 0.45 * kickPunch + 0.38 * buildCharge + 0.48 * dropIgnite;
    vec3 photonCol = mix(diskPrimary, diskHot, 0.78) * photonCore * 1.95 * sideDoppler * photonPulse
                   + mix(diskSecondary, diskPrimary, 0.58) * photonHalo * 0.38 * sideDoppler * (0.8 + 0.5 * sectionEnergy);

    // 3d. 双极相对论等离子圣光喷流（严格从光子球南北极冠 b > B_CRIT 外侧迸发，保证视界黑球绝对深邃纯净）
    vec3 jetGlow = vec3(0.0);
    float jetPower = 0.06 + 0.28 * buildCharge + 1.15 * dropIgnite + 0.24 * kickPunch * dropIgnite;
    if (jetPower > 0.04 && b > B_CRIT * 0.96) {
      vec3 skyOffset = tHat * b;
      vec3 poleAxis = normalize(diskNormal - uHat * dot(diskNormal, uHat));
      vec3 polePerp = cross(uHat, poleAxis);
      float jetH = abs(dot(skyOffset, poleAxis));
      float jetR = abs(dot(skyOffset, polePerp));

      if (jetH > B_CRIT * 0.94) {
        float beamHalfW = BH_M * (0.48 + 0.055 * pow(jetH / BH_M, 0.85));
        float coreBeam = exp(-pow(jetR / (beamHalfW * 0.40), 2.0));
        float sheathBeam = exp(-pow(jetR / (beamHalfW * 1.32), 2.0));

        float hNorm = jetH / BH_M;
        float helixA = 0.5 + 0.5 * cos(hNorm * 0.85 - flowTime * 7.2 + (dot(skyOffset, polePerp) / max(beamHalfW, 0.1)) * 3.14);
        float helixB = 0.5 + 0.5 * sin(hNorm * 1.35 - flowTime * 9.6 - (dot(skyOffset, polePerp) / max(beamHalfW, 0.1)) * 3.14);
        float knots = 0.64 + 0.36 * sin(hNorm * 0.62 - flowTime * 11.2);
        float rootMask = smoothstep(B_CRIT * 0.96, B_CRIT * 1.35, b) * smoothstep(B_CRIT * 0.92, B_CRIT * 1.28, jetH);
        float lengthLimit = mix(12.0 * BH_M, 44.0 * BH_M, clamp(dropIgnite + 0.45 * buildCharge, 0.0, 1.0));
        float topFade = exp(-(jetH - B_CRIT) / lengthLimit);

        float jetEnv = rootMask * topFade * jetPower * knots;
        vec3 jCol = mix(diskPrimary, diskHot, 0.72) * coreBeam * 1.32
                  + mix(nebulaCool, diskPrimary, 0.58) * sheathBeam * (0.35 + 0.65 * max(helixA, helixB)) * 0.68;
        jetGlow = jCol * jetEnv;
      }
    }

    float frontShield = (1.0 - backSideWeight) * disk1.a;
    frontOccluder = frontShield;
    bhLight = (photonCol + disk2.rgb + jetGlow) * (1.0 - frontShield * 0.85) + disk1.rgb;
    // 柔和收敛极端 HDR 尖峰，既保留内圈炽白星金高光，又防止大半径泛光向视界中心漫射冲淡纯黑剪影
    bhLight = bhLight / (1.0 + max(vec3(0.0), bhLight - 1.15) * 0.40);
  }

  vec3 totalSky = bgSky * (1.0 - frontOccluder * 0.92) + bhLight + waveGlow;

  // 地平线极薄星雾衔接带，仅在贴近 y = 0 水天线处柔和融合，不染色高空深邃天幕
  float horizonMist = exp(-abs(dir.y) * 28.0);
  totalSky = mix(totalSky, spaceHorizon + nebulaCool * (0.04 + 0.04 * sectionEnergy), horizonMist * 0.42);

  return max(totalSky, vec3(0.0));
}
`;

// ============================================================================
// 1. 苍穹天球着色器 (Sky Dome)
// ============================================================================
const SKY_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAG = /* glsl */ `
uniform sampler2D uCover;
uniform int uZero;
uniform float uTime;
uniform float uFlow;
uniform float uSectionEnergy;
uniform float uBuildCharge;
uniform float uDropIgnite;
uniform float uKickPunch;
uniform float uLeadLevel;
uniform vec3 uDiskNormal;
uniform vec3 uDiskTan;
uniform vec3 uDiskBit;
uniform vec3 uSpaceZenith;
uniform vec3 uSpaceHorizon;
uniform vec3 uNebulaCool;
uniform vec3 uDiskHot;
uniform vec3 uDiskPrimary;
uniform vec3 uDiskSecondary;
uniform vec3 uStarWarm;
uniform vec3 uStarCool;
uniform vec4 uGravWaves[${MAX_GRAV_WAVES}];
varying vec3 vWorldPos;
${GLSL_BLACKHOLE_COMMON}

void main() {
  vec3 rd = normalize(vWorldPos - cameraPosition);
  vec3 col = evalBlackHoleCosmos(
    cameraPosition, rd, uCover, uZero,
    uTime, uFlow, uSectionEnergy, uBuildCharge, uDropIgnite, uKickPunch, uLeadLevel,
    uDiskNormal, uDiskTan, uDiskBit,
    uSpaceZenith, uSpaceHorizon, uNebulaCool, uDiskHot, uDiskPrimary, uDiskSecondary, uStarWarm, uStarCool,
    uGravWaves
  );
  gl_FragColor = vec4(col, 1.0);
}
`;

// ============================================================================
// 2. 近景星际黑曜石观测水台 + 蓝宝石圆形封面星盘 + 1:1 黑洞实时水波倒影着色器
// ============================================================================
const DECK_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const DECK_FRAG = /* glsl */ `
uniform sampler2D uCover;
uniform int uZero;
uniform float uTime;
uniform float uFlow;
uniform float uSectionEnergy;
uniform float uBuildCharge;
uniform float uDropIgnite;
uniform float uZeroGravity;
uniform float uKickPunch;
uniform float uHatSparkle;
uniform float uLeadLevel;
uniform float uCoverGain;
uniform vec3 uDiskNormal;
uniform vec3 uDiskTan;
uniform vec3 uDiskBit;
uniform vec3 uSpaceZenith;
uniform vec3 uSpaceHorizon;
uniform vec3 uNebulaCool;
uniform vec3 uDiskHot;
uniform vec3 uDiskPrimary;
uniform vec3 uDiskSecondary;
uniform vec3 uStarWarm;
uniform vec3 uStarCool;
uniform vec3 uObsidianDeep;
uniform vec4 uGravWaves[${MAX_GRAV_WAVES}];
uniform vec4 uRippleA[${MAX_RIPPLES}];
uniform vec4 uRippleB[${MAX_RIPPLES}];
uniform vec4 uChroma0;
uniform vec4 uChroma1;
uniform vec4 uChroma2;
varying vec3 vWorldPos;
${GLSL_BLACKHOLE_COMMON}

float chromaAtIdx(int idx) {
  if (idx < 4) return idx == 0 ? uChroma0.x : idx == 1 ? uChroma0.y : idx == 2 ? uChroma0.z : uChroma0.w;
  if (idx < 8) return idx == 4 ? uChroma1.x : idx == 5 ? uChroma1.y : idx == 6 ? uChroma1.z : uChroma1.w;
  return idx == 8 ? uChroma2.x : idx == 9 ? uChroma2.y : idx == 10 ? uChroma2.z : uChroma2.w;
}

float obsidianHexSeam(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
  vec2 cell = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
  cell = abs(cell);
  float hexDist = max(dot(cell, s * 0.5), cell.x);
  return smoothstep(0.455, 0.498, hexDist);
}

// 解析计算水台反射射线与两侧外翼星际护舷导流碑的镜像
vec3 evalPylonReflection(vec3 origin, vec3 R) {
  if (R.z >= -0.02) return vec3(0.0);
  float tHit = (${PYLON_Z.toFixed(2)} - origin.z) / R.z;
  if (tHit <= 0.0 || tHit > 160.0) return vec3(0.0);
  vec3 hit = origin + R * tHit;
  if (hit.y < 0.0 || hit.y > ${PYLON_H.toFixed(2)}) return vec3(0.0);

  float hFrac = hit.y / ${PYLON_H.toFixed(2)};
  float pylonCenterX = ${PYLON_X.toFixed(2)} - hFrac * 1.35;
  float halfWidth = mix(0.68, 0.18, hFrac);
  float dx = abs(abs(hit.x) - pylonCenterX);
  float bodyMask = 1.0 - smoothstep(halfWidth * 0.75, halfWidth * 1.15, dx);
  if (bodyMask <= 0.001) return vec3(0.0);

  float stripMask = exp(-pow(dx / (halfWidth * 0.28), 2.0));
  float climbPulse = 0.55 + 0.45 * sin(hFrac * 9.0 - uFlow * 3.6);
  float glow = (0.42 + 0.62 * uSectionEnergy + 0.72 * uDropIgnite + 0.32 * uKickPunch) * (0.55 + 0.45 * climbPulse);
  vec3 col = uObsidianDeep * 0.55 * bodyMask + mix(uDiskPrimary, uDiskHot, 0.45) * stripMask * glow * (1.0 - 0.35 * hFrac);
  return col * exp(-tHit * 0.009);
}

void main() {
  vec2 xz = vWorldPos.xz;
  float distOrigin = length(xz);
  float rawDistMed = length(xz - vec2(0.0, ${MEDALLION_Z.toFixed(2)}));
  // 在中央蓝宝石封面星盘区域平滑收敛水波振幅，令圆形封面边缘圆润端正、内部图案清晰不扭曲
  float medCalm = mix(0.16, 1.0, smoothstep(${MEDALLION_RADIUS.toFixed(2)} * 0.85, ${GRAV_RING_OUTER_R.toFixed(2)} + 0.75, rawDistMed));

  // 1. 超流体薄水微澜与确定性引力波涟漪
  float calmScale = (1.0 - 0.76 * uZeroGravity) * medCalm;
  vec2 grad = vec2(0.0);

  vec2 w1 = xz * 1.85 + vec2(uFlow * 0.36, -uFlow * 0.30);
  vec2 w2 = xz * 3.20 + vec2(-uFlow * 0.28, uFlow * 0.42);
  grad += vec2(cos(w1.x) * sin(w1.y), sin(w1.x) * cos(w1.y)) * 0.0048 * calmScale;
  grad += vec2(cos(w2.x + w2.y), cos(w2.x + w2.y)) * 0.0034 * calmScale;

  float rippleCaustic = 0.0;
  for (int i = uZero; i < ${MAX_RIPPLES}; i++) {
    vec4 ra = uRippleA[i];
    if (ra.w <= 0.001) continue;
    vec4 rb = uRippleB[i];
    vec2 dVec = xz - ra.xy;
    float dist = length(dVec) + 1e-4;
    if (dist > rb.x + 0.8) continue;

    float front = ra.z * (rb.x / max(0.35, rb.z * 1.32));
    float env = exp(-ra.z / rb.z) * exp(-pow((dist - front) / 0.62, 2.0)) * (1.0 - smoothstep(rb.x * 0.78, rb.x, dist));
    float phase = dist * rb.y - ra.z * 10.2;
    float c = cos(phase);
    float amp = ra.w * 0.019 * env * (0.35 + 0.65 * calmScale);
    grad += (dVec / dist) * (c * rb.y * amp);
    rippleCaustic += max(0.0, c) * env * ra.w * medCalm;
  }

  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 V = normalize(cameraPosition - vWorldPos);

  // 2. 水下 0.26m 抛光玄武黑曜石甲板与端正蓝宝石圆形封面星盘
  vec3 refr = refract(-V, N, 0.75);
  vec2 floorXZ = xz + refr.xz * (0.26 / max(0.30, -refr.y)) * medCalm + grad * (0.68 * medCalm);
  vec2 medDelta = floorXZ - vec2(0.0, ${MEDALLION_Z.toFixed(2)});
  float rMed = length(medDelta);
  float angMed = atan(medDelta.y, medDelta.x);

  float hexSeam = obsidianHexSeam(floorXZ * 0.48) * exp(-distOrigin * 0.048);
  vec3 floorCol = uObsidianDeep * (0.76 + 0.24 * fbm4(floorXZ * 0.72))
                + mix(uObsidianDeep, uNebulaCool, 0.35) * hexSeam * (0.12 + 0.10 * uSectionEnergy);

  // 星际观测甲板两侧对称光轨（置于 x = ±12.5m 开阔外侧，引导视线通往远方黑洞水道）
  if (rMed > ${GRAV_RING_OUTER_R.toFixed(2)} + 0.35) {
    float isoRings = exp(-pow(fract(rMed * 0.14 - uFlow * 0.06) - 0.5, 2.0) / 0.0018) * exp(-rMed * 0.048);
    float deckRails = exp(-pow((abs(floorXZ.x) - 12.2) / 0.10, 2.0))
                    * smoothstep(4.0, -2.0, floorXZ.y)
                    * (1.0 - smoothstep(36.0, 62.0, -floorXZ.y));
    vec3 guideCol = mix(uNebulaCool, uDiskPrimary, 0.55);
    floorCol += guideCol * (isoRings * 0.11 + deckRails * (0.22 + 0.25 * uSectionEnergy + 0.24 * uDropIgnite));
  }

  // 近景圆形蓝宝石专辑封面星盘 + 12 宫半音黑金引力刻度环
  float medallionZone = 1.0 - smoothstep(${GRAV_RING_OUTER_R.toFixed(2)} - 0.12, ${GRAV_RING_OUTER_R.toFixed(2)} + 0.28, rMed);
  if (medallionZone > 0.001) {
    if (rMed < ${MEDALLION_RADIUS.toFixed(2)} + 0.16) {
      vec2 coverUv = vec2(
        medDelta.x / (${(MEDALLION_RADIUS * 2).toFixed(2)}) + 0.5,
        0.5 - medDelta.y / (${(MEDALLION_RADIUS * 2).toFixed(2)})
      );
      vec2 clampedUv = clamp(coverUv, 0.004, 0.996);
      vec3 coverSample = texture2D(uCover, clampedUv).rgb;

      float crystalEtch = 1.0 + 0.022 * cos(rMed * 16.0);
      float coverMask = 1.0 - smoothstep(${MEDALLION_RADIUS.toFixed(2)} - 0.055, ${MEDALLION_RADIUS.toFixed(2)} + 0.018, rMed);
      float edgeVignette = 1.0 - 0.14 * smoothstep(${MEDALLION_RADIUS.toFixed(2)} * 0.75, ${MEDALLION_RADIUS.toFixed(2)}, rMed);
      vec3 litCover = coverSample * uCoverGain * crystalEtch * edgeVignette * (0.90 + 0.20 * uSectionEnergy + 0.14 * uKickPunch);
      floorCol = mix(floorCol, litCover, coverMask);
    }

    // 12 宫半音史瓦西引力刻度外环
    float normAng = fract(angMed / 6.2831853 + 1.0);
    int noteIdx = int(mod(floor(normAng * 12.0 + 0.5), 12.0));
    float cVal = chromaAtIdx(noteIdx);

    float innerRim = exp(-pow((rMed - ${MEDALLION_RADIUS.toFixed(2)}) / 0.054, 2.0));
    float outerRim = exp(-pow((rMed - ${GRAV_RING_OUTER_R.toFixed(2)}) / 0.060, 2.0));
    float midScaleRing = exp(-pow((rMed - ${(0.5 * (MEDALLION_RADIUS + GRAV_RING_OUTER_R)).toFixed(2)}) / 0.032, 2.0));

    float inRingBand = smoothstep(${MEDALLION_RADIUS.toFixed(2)} + 0.04, ${MEDALLION_RADIUS.toFixed(2)} + 0.16, rMed)
                     * (1.0 - smoothstep(${GRAV_RING_OUTER_R.toFixed(2)} - 0.16, ${GRAV_RING_OUTER_R.toFixed(2)} - 0.04, rMed));

    float fineTicks = pow(0.5 + 0.5 * cos(angMed * 72.0 - uFlow * 0.25), 16.0) * inRingBand;
    float majorSpokes = pow(0.5 + 0.5 * cos(angMed * 12.0 + 0.261799), 26.0) * inRingBand;

    float gemAngle = float(noteIdx) * (6.2831853 / 12.0);
    vec2 gemPos = vec2(cos(gemAngle), sin(gemAngle)) * ${(0.5 * (MEDALLION_RADIUS + GRAV_RING_OUTER_R)).toFixed(2)};
    float gemDist = length(medDelta - gemPos);
    float gemCore = exp(-pow(gemDist / 0.15, 2.0)) * (0.28 + 1.38 * cVal);
    float gemHalo = exp(-pow(gemDist / 0.52, 2.0)) * (0.12 + 0.62 * cVal);

    floorCol = mix(floorCol, uObsidianDeep * 0.36, inRingBand * 0.74);

    vec3 ringGold = mix(uDiskPrimary, uDiskHot, 0.48);
    vec3 gemActive = mix(uDiskPrimary, vec3(1.0, 0.98, 0.92), 0.58);
    floorCol += ringGold * (innerRim * (0.84 + 0.42 * uKickPunch) + outerRim * (0.70 + 0.35 * uSectionEnergy) + midScaleRing * 0.30);
    floorCol += ringGold * (fineTicks * 0.26 + majorSpokes * 0.44);
    floorCol += gemActive * (gemCore * 1.15 + gemHalo * 0.56);
  }

  floorCol += mix(uDiskPrimary, uStarCool, 0.45) * rippleCaustic * 0.20;

  // 3. 超流体黑曜石镜面 1:1 真实反射卡冈图雅黑洞、双光拱、喷流与外翼导流碑
  vec3 R = reflect(-V, N);
  R.y = max(0.002, R.y);
  vec3 normR = normalize(R);
  vec3 reflCosmos = evalBlackHoleCosmos(
    vWorldPos, normR, uCover, uZero,
    uTime, uFlow, uSectionEnergy, uBuildCharge, uDropIgnite, uKickPunch, uLeadLevel,
    uDiskNormal, uDiskTan, uDiskBit,
    uSpaceZenith, uSpaceHorizon, uNebulaCool, uDiskHot, uDiskPrimary, uDiskSecondary, uStarWarm, uStarCool,
    uGravWaves
  );
  vec3 reflPylon = evalPylonReflection(vWorldPos, normR);
  vec3 reflTotal = (reflCosmos + reflPylon) * 0.92;

  // 在近景专辑封面星盘上方主动压低强反射，确保封面高保真通透；星盘外黑曜石水道全面释放高反射倒影
  float rawFresnel = 0.22 + 0.74 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.2);
  float coverClearMask = 1.0 - smoothstep(${MEDALLION_RADIUS.toFixed(2)} * 0.86, ${GRAV_RING_OUTER_R.toFixed(2)} + 0.85, rMed);
  float fresnel = mix(rawFresnel, min(rawFresnel, 0.12), coverClearMask * 0.92);

  vec3 col = mix(floorCol, reflTotal, clamp(fresnel, 0.08, 0.92));

  float crestSpec = pow(clamp(length(grad) * 14.0, 0.0, 1.0), 1.7);
  col += mix(uDiskPrimary, uDiskHot, 0.62) * crestSpec * (0.18 + 0.24 * uDropIgnite);

  if (uHatSparkle > 0.02 && coverClearMask < 0.5) {
    float glintNoise = vnoise2(xz * 12.5 + vec2(uTime * 1.9, -uTime * 1.5));
    float glint = smoothstep(0.87, 0.99, glintNoise) * exp(-distOrigin * 0.032);
    col += mix(uStarCool, uDiskHot, 0.55) * glint * uHatSparkle * 1.05;
  }

  float horizonBlend = smoothstep(82.0, 176.0, distOrigin);
  vec3 farMist = uSpaceHorizon + uNebulaCool * (0.04 + 0.04 * uSectionEnergy);
  col = mix(col, farMist, horizonBlend);

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// ============================================================================
// 3. 外翼黑曜石星际护舷导流碑着色器 (Obsidian Wing Pylons)
// ============================================================================
const PYLON_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PYLON_FRAG = /* glsl */ `
uniform float uFlow;
uniform float uSectionEnergy;
uniform float uBuildCharge;
uniform float uDropIgnite;
uniform float uKickPunch;
uniform vec3 uObsidianDeep;
uniform vec3 uNebulaCool;
uniform vec3 uDiskHot;
uniform vec3 uDiskPrimary;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec2 vUv;

void main() {
  if (vWorldPos.y < -0.02) discard;

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(vec3(${BH_X.toFixed(2)}, ${BH_Y.toFixed(2)}, ${BH_Z.toFixed(2)}) - vWorldPos);

  float ndl = clamp(dot(N, L), 0.0, 1.0);
  float rim = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.5);
  float hFrac = clamp(vWorldPos.y / ${PYLON_H.toFixed(2)}, 0.0, 1.0);

  vec3 baseCol = mix(uObsidianDeep * 0.62, uNebulaCool * 0.26, 0.25 + 0.55 * ndl);
  vec3 col = baseCol + mix(uDiskPrimary, uDiskHot, 0.5) * rim * (0.38 + 0.42 * uSectionEnergy + 0.45 * uDropIgnite);

  float groove = exp(-pow(abs(sin(vUv.x * 6.2831853 * 2.0)), 2.0) / 0.020);
  float ticks = 0.68 + 0.32 * cos(vWorldPos.y * 5.2);
  float climbWave = 0.45 + 0.55 * sin(hFrac * 9.5 - uFlow * (3.2 + 2.4 * uBuildCharge));
  float glowAmp = (0.32 + 0.60 * uSectionEnergy + 0.80 * uDropIgnite + 0.38 * uBuildCharge + 0.30 * uKickPunch) * climbWave;

  col += mix(uDiskPrimary, uDiskHot, 0.45 + 0.35 * hFrac) * groove * ticks * glowAmp * (1.0 - 0.28 * hFrac);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// ============================================================================
// 4. 深空伴星十字/六芒衍射星芒着色器（含天空本体 + 水台镜像双实例）
// ============================================================================
const STAR_FLARE_VERT = /* glsl */ `
attribute vec4 aStarPos;
attribute vec4 aStarState;
uniform float uTime;
uniform float uBuildCharge;
uniform float uDropIgnite;
varying vec2 vQuad;
varying float vGlow;
varying float vColorMix;
varying float vIsMirror;

void main() {
  vQuad = position.xy;
  vGlow = aStarState.x;
  vColorMix = aStarState.y;
  vIsMirror = aStarPos.w;

  vec3 worldCenter = aStarPos.xyz;
  if (vIsMirror > 0.5) {
    worldCenter.y = -worldCenter.y;
  }

  vec3 toCam = cameraPosition - worldCenter;
  vec3 forward = normalize(toCam);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = cross(forward, right);

  float pulseSize = (1.05 + 2.55 * vGlow + 0.65 * uDropIgnite) * (0.70 + 0.34 * aStarState.z);
  float mirrorScale = vIsMirror > 0.5 ? 1.12 : 1.0;
  float rot = aStarState.w * 6.2831 + uTime * 0.06 + uBuildCharge * 0.35;
  float c = cos(rot), s = sin(rot);
  vec2 rq = vec2(c * vQuad.x - s * vQuad.y, s * vQuad.x + c * vQuad.y);

  vec3 wp = worldCenter + (right * rq.x + up * rq.y) * pulseSize * mirrorScale;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const STAR_FLARE_FRAG = /* glsl */ `
uniform float uFlow;
uniform float uZeroGravity;
uniform vec3 uDiskHot;
uniform vec3 uDiskPrimary;
uniform vec3 uStarCool;
varying vec2 vQuad;
varying float vGlow;
varying float vColorMix;
varying float vIsMirror;

void main() {
  vec2 q = vQuad;
  if (vIsMirror > 0.5) {
    float ripple = sin(q.y * 12.0 + uFlow * 4.5) * 0.055 * (1.0 - 0.75 * uZeroGravity);
    q.x += ripple;
  }

  float r = length(q);
  if (r > 1.0) discard;

  float core = exp(-r * r * 22.0);
  float halo = exp(-r * 4.0) * 0.38;
  float spikeMain = exp(-abs(q.x) * 30.0) * exp(-abs(q.y) * 3.2)
                  + exp(-abs(q.y) * 30.0) * exp(-abs(q.x) * 3.2);
  float diagA = abs(q.x * 0.7071 + q.y * 0.7071);
  float diagB = abs(q.x * 0.7071 - q.y * 0.7071);
  float spikeSub = (exp(-diagA * 36.0) + exp(-diagB * 36.0)) * exp(-r * 4.5) * 0.38;

  float flare = core * 1.40 + halo + (spikeMain + spikeSub) * smoothstep(0.16, 0.85, vGlow);
  float edgeMask = 1.0 - smoothstep(0.75, 1.0, r);

  vec3 baseCol = mix(uStarCool, uDiskPrimary, vColorMix);
  vec3 col = mix(baseCol, uDiskHot, clamp(core * 0.82 + vGlow * 0.25, 0.0, 1.0));
  float mirrorAtten = vIsMirror > 0.5 ? 0.42 : 1.0;
  float intensity = (0.14 + 1.22 * vGlow) * edgeMask * mirrorAtten;

  gl_FragColor = vec4(col * flare * intensity, 1.0);
}
`;

// ============================================================================
// 5. 三维潮汐螺旋星尘粒子着色器（严格遵守黑洞事件视界纯黑遮挡与封面星盘净空保护）
// ============================================================================
const TIDAL_DUST_VERT = /* glsl */ `
attribute vec4 aSeedA; // x: orbitRNorm, y: baseAngle, z: heightSeed, w: isMirror
attribute vec4 aSeedB; // x: sizeSeed, y: colorSeed, z: speedSeed, w: phaseSeed
uniform float uTime;
uniform float uFlow;
uniform float uSectionEnergy;
uniform float uBuildCharge;
uniform float uDropIgnite;
uniform float uZeroGravity;
uniform float uKickPunch;
uniform vec3 uDiskNormal;
uniform vec3 uDiskTan;
uniform vec3 uDiskBit;
varying vec2 vQuad;
varying float vAlpha;
varying float vColorMix;
varying float vHeat;

void main() {
  vQuad = position.xy;
  vColorMix = aSeedB.y;
  float isMirror = aSeedA.w;
  const vec3 bhCenter = vec3(${BH_X.toFixed(2)}, ${BH_Y.toFixed(2)}, ${BH_Z.toFixed(2)});
  const float bCrit = ${ (5.1961524 * BH_MASS).toFixed(3) };

  vec3 worldPos;
  float alphaBase;
  if (aSeedB.w < 0.65) {
    // 远景潮汐轨道粒子：环绕吸积盘外圈（半径 15m..52m），随 Build-up 螺旋收束
    float u = fract(aSeedA.x - uFlow * (0.042 + 0.13 * uBuildCharge + 0.075 * uDropIgnite) * (0.65 + 0.7 * aSeedB.z));
    float rad = mix(14.8, 52.0, pow(u, 0.82)) * (1.0 - 0.18 * uBuildCharge);
    float angSpeed = (1.10 / pow(max(u, 0.14), 0.72)) * (0.55 + 0.55 * aSeedB.z);
    float ang = aSeedA.y + uFlow * angSpeed * (0.45 + 0.65 * uBuildCharge + 0.55 * uDropIgnite);
    float diskThickness = (1.2 + 5.2 * u) * (1.0 + 0.65 * uZeroGravity - 0.38 * uBuildCharge);
    float offN = (aSeedA.z - 0.5) * 2.0 * diskThickness + sin(uTime * 0.8 + aSeedB.w * 20.0) * 0.60;

    worldPos = bhCenter
             + uDiskTan * (cos(ang) * rad)
             + uDiskBit * (sin(ang) * rad)
             + uDiskNormal * offN;
    worldPos.y = max(0.45, worldPos.y);
    vHeat = (1.0 - u) * (0.55 + 0.45 * uDropIgnite + 0.35 * uBuildCharge);
    alphaBase = smoothstep(0.0, 0.14, u) * (1.0 - smoothstep(0.84, 1.0, u)) * (0.42 + 0.52 * uSectionEnergy + 0.42 * uDropIgnite);
  } else {
    // 近中景水台外翼霍金反重力荧光星尘（分布在两侧，避开中央视界通道）
    float cycle = fract(aSeedA.z + uTime * (0.030 + 0.046 * uZeroGravity + 0.024 * aSeedB.z));
    float side = aSeedB.x < 0.5 ? -1.0 : 1.0;
    float spreadX = side * (9.5 + 24.0 * aSeedA.x);
    float pz = -14.0 - 44.0 * fract(aSeedA.y / 6.2831853);
    float py = 0.35 + cycle * (11.5 + 7.5 * uZeroGravity);

    worldPos = vec3(spreadX, py, pz);
    vHeat = 0.25 + 0.42 * uDropIgnite;
    alphaBase = sin(cycle * 3.1415926) * (0.34 + 0.62 * uZeroGravity + 0.32 * uSectionEnergy);
  }

  vec3 targetBh = bhCenter;
  if (isMirror > 0.5) {
    worldPos.y = -worldPos.y;
    targetBh.y = -targetBh.y;
    alphaBase *= 0.42;
  }

  // 严格保护事件视界纯黑剪影：任何视线穿过黑洞阴影 (b < bCrit * 1.12) 的粒子全部平滑消隐，确保视界核心纯粹漆黑
  vec3 camToParticle = worldPos - cameraPosition;
  float distParticle = max(length(camToParticle), 1e-3);
  vec3 rayP = camToParticle / distParticle;
  vec3 camToBh = targetBh - cameraPosition;
  float distBh = max(length(camToBh), 1e-3);
  vec3 uBh = camToBh / distBh;
  float cosA = dot(rayP, uBh);
  if (cosA > 0.0) {
    float bProj = distBh * sqrt(max(0.0, 1.0 - cosA * cosA));
    alphaBase *= smoothstep(bCrit * 1.02, bCrit * 1.24, bProj);
  }

  // 若为水台镜像粒子，当视线落入近景圆形封面星盘区域 (y=0 交点距星盘中心 <= 外环半径) 时平滑消隐，保护封面清晰无杂点
  if (isMirror > 0.5 && rayP.y < -1e-3 && cameraPosition.y > 0.0) {
    float tWater = -cameraPosition.y / rayP.y;
    vec2 waterHitXZ = cameraPosition.xz + rayP.xz * tWater;
    float dMed = length(waterHitXZ - vec2(0.0, ${MEDALLION_Z.toFixed(2)}));
    alphaBase *= smoothstep(${GRAV_RING_OUTER_R.toFixed(2)} - 0.1, ${GRAV_RING_OUTER_R.toFixed(2)} + 1.2, dMed);
  }

  float twinkle = 0.68 + 0.32 * sin(uTime * (2.2 + 3.1 * aSeedB.z) + aSeedA.y * 7.0);
  vAlpha = alphaBase * twinkle * (1.0 + 0.26 * uKickPunch);

  vec3 toCam = -camToParticle;
  vec3 forward = toCam / distParticle;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = cross(forward, right);

  float worldSize = (0.042 + 0.078 * aSeedB.x) * (1.0 + distParticle * 0.013) * (1.0 + 0.22 * uDropIgnite);
  vec3 wp = worldPos + (right * vQuad.x + up * vQuad.y) * worldSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const TIDAL_DUST_FRAG = /* glsl */ `
uniform vec3 uDiskHot;
uniform vec3 uDiskPrimary;
uniform vec3 uNebulaCool;
uniform vec3 uStarCool;
varying vec2 vQuad;
varying float vAlpha;
varying float vColorMix;
varying float vHeat;

void main() {
  if (vAlpha <= 0.004) discard;
  float r = length(vQuad);
  if (r > 1.0) discard;

  float core = exp(-r * r * 10.0);
  float soft = (1.0 - smoothstep(0.35, 1.0, r)) * 0.42;
  vec3 baseCol = mix(mix(uStarCool, uNebulaCool, 0.45), uDiskPrimary, vColorMix);
  vec3 col = mix(baseCol, uDiskHot, clamp(vHeat * 0.78 + core * 0.35, 0.0, 1.0));

  gl_FragColor = vec4(col * (core * 1.22 + soft) * vAlpha, 1.0);
}
`;

function buildTaperedPylonGeometry(widthBottom: number, widthTop: number, height: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(widthTop, widthBottom, height, 4, 8, false);
  geo.rotateY(Math.PI / 4);
  geo.translate(0, height * 0.5, 0);
  geo.computeVertexNormals();
  return geo;
}

export class BlackHoleScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.15, 420);

  private readonly rig: LyricRig;
  private readonly soft: boolean;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly companionStars: CompanionStar[];
  private readonly starStateAttr: THREE.InstancedBufferAttribute;

  private readonly flares: ArpFlareEvent[];
  private readonly flareTimes: Float64Array;
  private readonly ripples: WaterRippleEvent[];
  private readonly rippleTimes: Float64Array;
  private readonly gravWaves: GravWaveEvent[];
  private readonly gravWaveTimes: Float64Array;

  private readonly rawKickTimes: Float64Array;
  private readonly rawKickVals: Float64Array;
  private readonly rawHatTimes: Float64Array;
  private readonly rawHatVals: Float64Array;

  private readonly gravWaveVecs: THREE.Vector4[];
  private readonly rippleA: THREE.Vector4[];
  private readonly rippleB: THREE.Vector4[];
  private readonly chromaBuf = new Float32Array(12);

  private readonly diskNormal = new THREE.Vector3();
  private readonly diskTan = new THREE.Vector3();
  private readonly diskBit = new THREE.Vector3();
  private readonly baseQuat = new THREE.Quaternion();
  private readonly eulerTmp = new THREE.Euler();

  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    const seed = init.seed ?? 0x4b1ac801;

    // 1. 提取专辑封面主色相与真实第二对比色相，构筑深邃纯净宇宙底色 + 冷暖交响星云与吸积盘色谱
    const tone = extractCoverTone(init);
    const { lum: coverLum, secondaryHue } = analyzeCoverSecondaryAndLum(
      init.coverPixels,
      tone.mainHue,
      tone.mono,
      init.palette.light,
    );
    const coverMood = clamp01((coverLum - 0.18) / 0.62);
    const coverGain = lerp(1.16, 0.84, coverMood);

    const mainHue = tone.mono ? 38 : tone.mainHue;
    const warmGoldHue = tone.mono ? 40 : lerpHueDeg(mainHue, 38, 0.72);
    const coolStarHue = tone.mono ? 214 : lerpHueDeg(secondaryHue, 212, 0.45);
    // 深空底色向午夜深蓝紫靠拢并保持极低明度，使中央黑洞与双光拱璀璨夺目、绝无暗棕脏雾
    const deepSpaceHue = tone.mono ? 222 : lerpHueDeg(secondaryHue, 226, 0.35);

    const spaceZenith = linearVec3FromHsl(deepSpaceHue, tone.mono ? 0.12 : 0.52, 0.015);
    const spaceHorizon = linearVec3FromHsl(deepSpaceHue, tone.mono ? 0.16 : 0.48, 0.038 + 0.012 * coverMood);
    const nebulaCool = linearVec3FromHsl(secondaryHue, tone.mono ? 0.14 : 0.82, 0.54);
    const diskHot = linearVec3FromHsl(warmGoldHue, tone.mono ? 0.16 : 0.58, 0.91);
    const diskPrimary = linearVec3FromHsl(mainHue, tone.mono ? 0.14 : Math.max(0.74, tone.bright.s * 0.96), 0.62);
    const diskSecondary = linearVec3FromHsl(secondaryHue, tone.mono ? 0.10 : Math.max(0.64, tone.midDark.s * 0.90), 0.46);
    const starWarm = linearVec3FromHsl(warmGoldHue, tone.mono ? 0.18 : 0.56, 0.86);
    const starCool = linearVec3FromHsl(coolStarHue, tone.mono ? 0.16 : 0.68, 0.84);
    const obsidianDeep = linearVec3FromHsl(deepSpaceHue, tone.mono ? 0.08 : 0.42, 0.034 + 0.014 * coverMood);

    this.scene.background = new THREE.Color(spaceZenith.x, spaceZenith.y, spaceZenith.z);

    // 2. 预计算全曲音频驱动事件表
    this.companionStars = buildCompanionStars(seed);
    const timeline = buildTimelineEvents(init.music, seed);
    this.flares = timeline.flares;
    this.flareTimes = timeline.flareTimes;
    this.ripples = timeline.ripples;
    this.rippleTimes = timeline.rippleTimes;
    this.gravWaves = timeline.gravWaves;
    this.gravWaveTimes = timeline.gravWaveTimes;

    const kicks = init.music.a.hits.kick ?? [];
    this.rawKickTimes = Float64Array.from(kicks, h => h[0]);
    this.rawKickVals = Float64Array.from(kicks, h => h[1]);

    const hats = init.music.a.hits.hat ?? [];
    this.rawHatTimes = Float64Array.from(hats, h => h[0]);
    this.rawHatVals = Float64Array.from(hats, h => h[1]);

    this.gravWaveVecs = Array.from({ length: MAX_GRAV_WAVES }, () => new THREE.Vector4(0, 0, 0, 1));
    this.rippleA = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0));
    this.rippleB = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0));

    const rollSign = (seed & 2) === 0 ? 1 : -1;
    this.updateDiskBasis(0.255, rollSign * 0.112);

    this.uniforms = {
      uCover: { value: init.cover },
      uZero: { value: 0 },
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uPixelRatio: { value: 1 },
      uSectionEnergy: { value: 0.5 },
      uBuildCharge: { value: 0 },
      uDropIgnite: { value: 0 },
      uZeroGravity: { value: 0 },
      uKickPunch: { value: 0 },
      uHatSparkle: { value: 0 },
      uLeadLevel: { value: 0 },
      uCoverGain: { value: coverGain },
      uDiskNormal: { value: this.diskNormal },
      uDiskTan: { value: this.diskTan },
      uDiskBit: { value: this.diskBit },
      uSpaceZenith: { value: spaceZenith },
      uSpaceHorizon: { value: spaceHorizon },
      uNebulaCool: { value: nebulaCool },
      uDiskHot: { value: diskHot },
      uDiskPrimary: { value: diskPrimary },
      uDiskSecondary: { value: diskSecondary },
      uStarWarm: { value: starWarm },
      uStarCool: { value: starCool },
      uObsidianDeep: { value: obsidianDeep },
      uGravWaves: { value: this.gravWaveVecs },
      uRippleA: { value: this.rippleA },
      uRippleB: { value: this.rippleB },
      uChroma0: { value: new THREE.Vector4() },
      uChroma1: { value: new THREE.Vector4() },
      uChroma2: { value: new THREE.Vector4() },
    };

    // 3. 远景深空与卡冈图雅黑洞天球 (renderOrder = 0)
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(260, 48, 32),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    skyDome.frustumCulled = false;
    skyDome.renderOrder = 0;
    this.scene.add(skyDome);

    // 4. 近景星际黑曜石超流体水台与蓝宝石封面星盘 (renderOrder = 1)
    const deckGeo = new THREE.CircleGeometry(192, 96);
    deckGeo.rotateX(-Math.PI / 2);
    const deckMesh = new THREE.Mesh(
      deckGeo,
      new THREE.ShaderMaterial({
        vertexShader: DECK_VERT,
        fragmentShader: DECK_FRAG,
        uniforms: this.uniforms,
        depthWrite: true,
        toneMapped: false,
      }),
    );
    deckMesh.frustumCulled = false;
    deckMesh.renderOrder = 1;
    this.scene.add(deckMesh);

    // 5. 外翼星际黑曜石护舷导流碑 (renderOrder = 3，位于画幅外侧护卫，不遮挡中央黑洞盘翼)
    const pylonMat = new THREE.ShaderMaterial({
      vertexShader: PYLON_VERT,
      fragmentShader: PYLON_FRAG,
      uniforms: this.uniforms,
      depthWrite: true,
      depthTest: true,
      toneMapped: false,
    });
    const mainPylonGeo = buildTaperedPylonGeometry(0.68, 0.16, PYLON_H);
    const subPylonGeo = buildTaperedPylonGeometry(0.42, 0.11, PYLON_H * 0.54);

    for (const side of [-1, 1]) {
      const mainPylon = new THREE.Mesh(mainPylonGeo, pylonMat);
      mainPylon.position.set(side * PYLON_X, -0.05, PYLON_Z);
      mainPylon.rotation.z = side * 0.11;
      mainPylon.rotation.x = -0.04;
      mainPylon.renderOrder = 3;
      this.scene.add(mainPylon);

      const subPylon = new THREE.Mesh(subPylonGeo, pylonMat);
      subPylon.position.set(side * (PYLON_X + 4.2), -0.05, PYLON_Z + 9.0);
      subPylon.rotation.z = side * 0.135;
      subPylon.rotation.x = -0.035;
      subPylon.renderOrder = 3;
      this.scene.add(subPylon);
    }

    // 6. 深空伴星十字/六芒衍射星芒（32 天空本体 + 32 水台镜像 = 64 实例）
    const totalStarInst = COMPANION_STAR_COUNT * 2;
    const quadBase = new THREE.PlaneGeometry(2, 2);
    const flareGeo = new THREE.InstancedBufferGeometry();
    flareGeo.index = quadBase.index;
    flareGeo.setAttribute('position', quadBase.getAttribute('position'));

    const starPosArr = new Float32Array(totalStarInst * 4);
    const starStateArr = new Float32Array(totalStarInst * 4);
    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < COMPANION_STAR_COUNT; i++) {
        const s = this.companionStars[i];
        const idx = (mirror * COMPANION_STAR_COUNT + i) * 4;
        starPosArr[idx] = s.x;
        starPosArr[idx + 1] = s.y;
        starPosArr[idx + 2] = s.z;
        starPosArr[idx + 3] = mirror;

        starStateArr[idx] = 0.18;
        starStateArr[idx + 1] = s.colorMix;
        starStateArr[idx + 2] = s.baseMag;
        starStateArr[idx + 3] = (i * 0.193) % 1;
      }
    }
    flareGeo.setAttribute('aStarPos', new THREE.InstancedBufferAttribute(starPosArr, 4));
    this.starStateAttr = new THREE.InstancedBufferAttribute(starStateArr, 4);
    this.starStateAttr.setUsage(THREE.DynamicDrawUsage);
    flareGeo.setAttribute('aStarState', this.starStateAttr);
    flareGeo.instanceCount = totalStarInst;

    const flareMesh = new THREE.Mesh(
      flareGeo,
      new THREE.ShaderMaterial({
        vertexShader: STAR_FLARE_VERT,
        fragmentShader: STAR_FLARE_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    flareMesh.frustumCulled = false;
    flareMesh.renderOrder = 2;
    this.scene.add(flareMesh);

    // 7. 环绕黑洞外环与水台的霍金/潮汐螺旋星尘（640 本体 + 640 水台倒影 = 1280 实例）
    const totalDustInst = TIDAL_DUST_COUNT * 2;
    const dustGeo = new THREE.InstancedBufferGeometry();
    dustGeo.index = quadBase.index;
    dustGeo.setAttribute('position', quadBase.getAttribute('position'));

    const seedA = new Float32Array(totalDustInst * 4);
    const seedB = new Float32Array(totalDustInst * 4);
    const dustRand = rng((seed ^ 0x3f82d914) >>> 0);
    for (let i = 0; i < TIDAL_DUST_COUNT; i++) {
      const rNorm = dustRand();
      const baseAng = dustRand() * Math.PI * 2;
      const hSeed = dustRand();
      const szSeed = dustRand();
      const colSeed = dustRand();
      const spdSeed = dustRand();
      const phSeed = i / TIDAL_DUST_COUNT;

      for (let mirror = 0; mirror < 2; mirror++) {
        const idx = (mirror * TIDAL_DUST_COUNT + i) * 4;
        seedA[idx] = rNorm;
        seedA[idx + 1] = baseAng;
        seedA[idx + 2] = hSeed;
        seedA[idx + 3] = mirror;

        seedB[idx] = szSeed;
        seedB[idx + 1] = colSeed;
        seedB[idx + 2] = spdSeed;
        seedB[idx + 3] = phSeed;
      }
    }
    dustGeo.setAttribute('aSeedA', new THREE.InstancedBufferAttribute(seedA, 4));
    dustGeo.setAttribute('aSeedB', new THREE.InstancedBufferAttribute(seedB, 4));
    dustGeo.instanceCount = totalDustInst;

    const dustMesh = new THREE.Mesh(
      dustGeo,
      new THREE.ShaderMaterial({
        vertexShader: TIDAL_DUST_VERT,
        fragmentShader: TIDAL_DUST_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    dustMesh.frustumCulled = false;
    dustMesh.renderOrder = 2;
    this.scene.add(dustMesh);

    // 8. 底部优雅立体字幕架（同步和谐星耀高亮色，不产生突兀异色）
    const highlightCol = colorFromHsl(warmGoldHue, tone.mono ? 0.16 : 0.82, 0.80);
    const lyricPalette: Palette = {
      ...init.palette,
      ink: colorFromHsl(deepSpaceHue, tone.mono ? 0.08 : 0.45, 0.05),
      paper: new THREE.Color('#f8fbff'),
      signal: highlightCol,
      accent: highlightCol,
      light: false,
    };
    this.rig = new LyricRig(lyricPalette, 'caption');
    this.rig.faces = voiceFaces(look, seed);
    this.scene.add(this.rig.group);
    this.diskRollSign = ((this.flares.length + seed) & 1) === 0 ? 1 : -1;

    this.resize(init.aspect);
  }

  private readonly diskRollSign: number;

  private updateDiskBasis(tiltX: number, rollZ: number): void {
    this.eulerTmp.set(tiltX, 0, rollZ, 'ZXY');
    this.baseQuat.setFromEuler(this.eulerTmp);
    this.diskTan.set(1, 0, 0).applyQuaternion(this.baseQuat).normalize();
    this.diskNormal.set(0, 1, 0).applyQuaternion(this.baseQuat).normalize();
    this.diskBit.set(0, 0, 1).applyQuaternion(this.baseQuat).normalize();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setViewport(_width: number, _height: number, pixelRatio: number): void {
    this.uniforms.uPixelRatio.value = Math.max(1, pixelRatio);
  }

  private evalPulse(times: Float64Array, vals: Float64Array, t: number, decay: number): number {
    if (!times.length) return 0;
    const i = lastIndex(times, t);
    if (i < 0) return 0;
    const one = (idx: number): number => {
      if (idx < 0 || idx >= times.length) return 0;
      const age = t - times[idx];
      if (age < 0) return 0;
      const v = vals[idx] ?? 0;
      if (age < 0.025) {
        const u = age / 0.025;
        return v * u * u * (3 - 2 * u);
      }
      return v * Math.exp(-(age - 0.025) / decay);
    };
    return Math.max(one(i), one(i - 1));
  }

  /** 计算单个黑洞观测机位在时刻 t 的目标姿态（纯函数）。 */
  private evalCameraPose(t: number, s: Shot, buildCharge: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const span = Math.max(0.8, s.end - s.start);
    const k = clamp01((t - s.start) / span);
    const e = inOutCubic(k);
    const dir = (stableShotSeed(s) & 1) === 0 ? 1 : -1;
    const variant = s.variant || 'observatory';

    if (variant === 'glide') {
      // 掠水巡航：贴着黑曜石超流体镜面水道向远方黑洞双光拱滑翔推进，展现天地对称的极致流体奇观
      const x = lerp(-2.2 * dir, 2.2 * dir, e);
      const z = lerp(11.6, 5.2, e) - 0.85 * buildCharge;
      const y = 2.35 + 0.12 * Math.sin(t * 0.26);
      poseLookAt(pos, quat, x, y, z, x * 0.22, 5.2 + 0.22 * Math.sin(t * 0.20), -44.0);
    } else if (variant === 'astrolabe') {
      // 星盘俯掠：斜高机位环绕近景发光蓝宝石封面星盘与 12 宫引力刻度环，同时完整保留上方卡冈图雅黑洞光拱
      const theta = lerp(-0.30 * dir, 0.30 * dir, e);
      const rad = lerp(13.6, 12.2, e);
      const y = lerp(5.4, 4.3, e);
      poseLookAt(pos, quat, Math.sin(theta) * rad, y, MEDALLION_Z + Math.cos(theta) * rad, 0, lerp(3.8, 4.9, e), lerp(-22.0, -34.0, e));
    } else if (variant === 'horizon') {
      // 视界仰望：越过前盘，低机位仰望横贯天幕的巨型引力透镜双光拱、光子环与贯通天地的双极圣光喷流
      const theta = lerp(-0.18 * dir, 0.18 * dir, e);
      const z = lerp(7.2, 3.8, e) - 1.0 * buildCharge;
      const y = 1.72 + 0.10 * Math.sin(t * 0.22);
      poseLookAt(pos, quat, Math.sin(theta) * 8.5, y, z, Math.sin(theta) * 1.2, 8.8 + 0.8 * e, -52.0);
    } else {
      // observatory（星台主景，默认黄金构图）：下方 100% 完整收纳端正圆形封面星盘，中景黑曜石水道完整倒映黑洞，远景卡冈图雅高悬苍穹
      const theta = lerp(-0.16 * dir, 0.16 * dir, e);
      const distFromMed = lerp(13.2, 11.8, e) - 0.55 * buildCharge;
      const y = 4.25 + 0.12 * Math.sin(t * 0.24);
      poseLookAt(pos, quat, Math.sin(theta) * 10.5, y, MEDALLION_Z + distFromMed, 0, 3.65 + 0.14 * Math.sin(t * 0.18), -26.0);
    }
  }

  /** 四组史诗电影级机位（observatory / glide / astrolabe / horizon），同场景切镜时平滑衔接 */
  private updateCamera(t: number, shot: Shot, buildCharge: number): void {
    blendCameraPose((time, s, pos, quat) => this.evalCameraPose(time, s, buildCharge, pos, quat), t, shot, this.camera, 1.5);
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, fx } = ctx;
    const curSec = music.section(t);
    const label = curSec?.label ?? shot.section.label;
    const secDur = Math.max(0.5, (curSec?.end ?? shot.end) - (curSec?.start ?? shot.start));
    const secProg = clamp01((t - (curSec?.start ?? shot.start)) / secDur);

    let zeroGravity = 0;
    if (label === 'break' || label === 'bridge') {
      zeroGravity = smooth(Math.min(1, (t - curSec.start) / 0.8)) * smooth(Math.min(1, (curSec.end - t) / 0.8));
    } else if (label === 'intro' || label === 'outro') {
      zeroGravity = 0.55;
    }

    let buildCharge = 0;
    if (label === 'build' || label === 'pre') {
      buildCharge = Math.pow(secProg, 0.82) * smooth(Math.min(1, (curSec.end - t) / 0.08));
    }

    const dropIgnite = label === 'drop'
      ? Math.max(music.dropIntensity(t), 0.94 * smooth(Math.min(1, (t - curSec.start) / 0.15)))
      : label === 'chorus' && (curSec?.energy ?? 0) >= 0.76
        ? 0.58 * smooth(Math.min(1, (t - curSec.start) / 0.35))
        : 0;

    this.updateCamera(t, shot, buildCharge);

    // 吸积盘倾角方向绑定全曲恒定种子，避免同场景切镜时黑洞双光拱与喷流左右镜像瞬跳翻转
    const rollSign = this.diskRollSign;
    const tiltX = 0.252 + 0.020 * Math.sin(t * 0.11);
    const rollZ = rollSign * 0.106 + 0.025 * Math.cos(t * 0.085);
    this.updateDiskBasis(tiltX, rollZ);

    const kickPulse = this.evalPulse(this.rawKickTimes, this.rawKickVals, t, 0.22);
    const hatPulse = this.evalPulse(this.rawHatTimes, this.rawHatVals, t, 0.14);
    const highEnv = music.env('high', t);
    const hatSparkle = clamp01(hatPulse * 0.80 + highEnv * 0.40);
    const lead = music.foregroundAt(t);
    const leadLevel = clamp01(lead.level * 0.72 + lead.attack * 0.55);

    const secDrive = label === 'drop' ? 1.0
      : label === 'chorus' ? 0.86
      : label === 'build' || label === 'pre' ? 0.45 + 0.50 * secProg
      : label === 'break' || label === 'bridge' ? 0.30
      : 0.48;
    const energy = clamp01(secDrive * 0.65 + (curSec?.energy ?? shot.section.energy) * 0.35);

    music.chromaAt(t, this.chromaBuf);
    let maxC = 0.001;
    for (let k = 0; k < 12; k++) if (this.chromaBuf[k] > maxC) maxC = this.chromaBuf[k];
    const normChroma = (k: number) => clamp01((this.chromaBuf[k] / maxC) * (0.32 + 0.68 * this.chromaBuf[k]));

    const starGlow = new Float32Array(COMPANION_STAR_COUNT);
    for (let i = 0; i < COMPANION_STAR_COUNT; i++) {
      const s = this.companionStars[i];
      const idleTwinkle = 0.14 + 0.07 * Math.sin(t * (1.4 + s.baseMag) + i * 2.3);
      starGlow[i] = idleTwinkle * s.baseMag;
    }

    for (let i = lastIndex(this.flareTimes, t); i >= 0; i--) {
      const ev = this.flares[i];
      const age = t - ev.t;
      if (age < 0) continue;
      if (age > 2.2) break;
      const env = age < 0.028 ? smooth(age / 0.028) : Math.exp(-(age - 0.028) / 0.65);
      const flare = ev.amp * env;
      if (starGlow[ev.starIdx] < 0.18 + flare) {
        starGlow[ev.starIdx] = 0.18 + flare;
      }
    }

    const starArr = this.starStateAttr.array as Float32Array;
    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < COMPANION_STAR_COUNT; i++) {
        const idx = (mirror * COMPANION_STAR_COUNT + i) * 4;
        starArr[idx] = starGlow[i];
      }
    }
    this.starStateAttr.needsUpdate = true;

    let gwCount = 0;
    for (let i = lastIndex(this.gravWaveTimes, t); i >= 0 && gwCount < MAX_GRAV_WAVES; i--) {
      const gw = this.gravWaves[i];
      const age = t - gw.t;
      if (age < 0) continue;
      if (age > 3.8) break;
      this.gravWaveVecs[gwCount].set(age, gw.strength, gw.speed, gw.tau);
      gwCount++;
    }
    for (let i = gwCount; i < MAX_GRAV_WAVES; i++) {
      this.gravWaveVecs[i].set(0, 0, 0, 1);
    }

    let rCount = 0;
    for (let i = lastIndex(this.rippleTimes, t); i >= 0 && rCount < MAX_RIPPLES; i--) {
      const rp = this.ripples[i];
      const age = t - rp.t;
      if (age < 0) continue;
      if (age > 3.2) break;
      const effAmp = rp.amp * (0.68 + 0.36 * energy);
      if (effAmp * Math.exp(-age / rp.tau) < 0.02 && age > 0.8) continue;
      this.rippleA[rCount].set(rp.x, rp.z, age, effAmp);
      this.rippleB[rCount].set(rp.maxRadius, rp.freq, rp.tau, 0);
      rCount++;
    }
    for (let i = rCount; i < MAX_RIPPLES; i++) {
      this.rippleA[i].set(0, 0, 0, 0);
      this.rippleB[i].set(0, 0, 0, 0);
    }

    const u = this.uniforms;
    u.uTime.value = t;
    u.uFlow.value = t * (0.72 - 0.24 * zeroGravity) + music.foregroundMotion(t, 0.25) * 0.22;
    u.uSectionEnergy.value = energy;
    u.uBuildCharge.value = buildCharge;
    u.uDropIgnite.value = dropIgnite;
    u.uZeroGravity.value = zeroGravity;
    u.uKickPunch.value = clamp01(kickPulse);
    u.uHatSparkle.value = hatSparkle;
    u.uLeadLevel.value = leadLevel;
    (u.uChroma0.value as THREE.Vector4).set(normChroma(0), normChroma(1), normChroma(2), normChroma(3));
    (u.uChroma1.value as THREE.Vector4).set(normChroma(4), normChroma(5), normChroma(6), normChroma(7));
    (u.uChroma2.value as THREE.Vector4).set(normChroma(8), normChroma(9), normChroma(10), normChroma(11));

    fx.letterbox = 0;
    fx.invert = 0;
    fx.duotone = 0;
    fx.glitch = Math.min(fx.glitch, 0.04);
    fx.zoom = Math.min(fx.zoom, 0.028 + 0.04 * dropIgnite + 0.028 * buildCharge);
    fx.ca = Math.max(fx.ca, 0.05 * dropIgnite + 0.07 * kickPulse * dropIgnite);
    fx.bloom = (this.soft ? 0.20 : 0.17) + 0.04 * dropIgnite + 0.03 * buildCharge;
    fx.vignette = 0.44;
    fx.grain = 0.030;

    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy * 0.75);
  }
}
