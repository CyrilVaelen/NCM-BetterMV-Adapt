// 星空 · 星穹之镜 (Starry Salar / Astral Mirror): 专为 Trance（出神舞曲）量身打造的世界级宇宙星穹场景。
// 空间构图（由下至上、由近及远四层纯时间函数 f(t) 结构，零状态累积，支持任意进度条跳转与无损离线 MP4 导出）：
// 1. 天空之镜盐湖与水下星盘封面：下方无垠薄水晶盐镜面，近景水底居中镶嵌圆形发光星盘专辑封面与 12 宫半音刻度外环，
//    远景遵循菲涅尔反射定律 1:1 实时倒映苍穹银河、双色星云、神圣星象环门、琶音星座连线与极乐流星雨；
// 2. 地平线神圣星象环门：水天交界处矗立多环咬合的巨型星象拱门与双子星碑，内环镌刻精密星度刻线随小节律动旋转；
// 3. 琶音「点星成座」系统：提取全曲合成器拨弦琶音与主旋律音符，触发夜空 36 颗主恒星绽放十字/六芒衍射星芒，
//    并在连续音符间动态拉出生长流光几何星座连线（含盐湖水中摇曳镜像）；
// 4. 三段式 Trance 星象叙事：
//    - Breakdown（失重空灵）：水面归于静谧黑镜，数千颗荧光星尘反重力从盐湖水面缓缓飘升入银河；
//    - Build-up（星轨聚能）：漫天星辰围绕星门中心拉出长曝光旋转坍缩星轨弧线，奇点光核蓄势升温；
//    - Drop（极乐爆发）：星门迸发超新星日冕冲击环与直贯天顶的星穹圣光柱，漫天流星雨随 Supersaw 主旋律划破苍穹。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { voiceFaces } from './lyricBlock.ts';
import { lastIndex, type Music } from '../director/music.ts';
import type { Palette } from '../render/palette.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl } from './coverTone.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';

/** 水面最大并发确定性涟漪波包数（配合 uZero 屏障保障 D3D11 秒级着色器编译） */
const MAX_RIPPLES = 14;
/** 苍穹最大并发超新星日冕冲击波数 */
const MAX_SUPERNOVA_WAVES = 4;
/** 天球星座锚点恒星总数（3 大星官天区 × 12 半音色度） */
const CONSTELLATION_STAR_COUNT = 36;
/** 最大并发可见几何星座连线数（每条含天空本体 + 盐湖镜像共 2 实例） */
const MAX_CONSTELLATION_LINES = 28;
/** 最大并发划空极乐流星数（每道含天空本体 + 盐湖镜像共 2 实例） */
const MAX_METEORS = 18;

/** 水下圆形发光星盘封面半径与 12 宫星度外环半径（世界单位：米） */
const MEDALLION_RADIUS = 5.45;
const ASTROLABE_OUTER_R = 7.48;
/** 远景神圣星象环门世界坐标与各环半径 */
const ARCH_Z = -46.0;
const ARCH_CENTER_Y = 10.2;
const ARCH_OUTER_R = 14.8;
const ARCH_MID_R = 11.6;
const ARCH_INNER_R = 8.4;
const CAM_FOV = 48;

interface StarAnchor {
  x: number;
  y: number;
  z: number;
  cluster: number;
  note: number;
  baseMag: number;
  colorMix: number;
}

interface ArpStarEvent {
  /** 触发时刻（秒） */
  t: number;
  /** 半音索引 [0..11] */
  note: number;
  /** 命中的天球恒星索引 [0..35] */
  starIdx: number;
  /** 脉冲强度 [0..1.25] */
  amp: number;
  /** 若与前一音符构成连续乐句，记录前一颗恒星索引以绘制生长星座连线；否则为 -1 */
  prevStarIdx: number;
}

interface MeteorEvent {
  /** 流星起始时刻（秒） */
  t: number;
  /** 飞行持续时长（秒） */
  dur: number;
  /** 起点三维坐标 */
  x0: number;
  y0: number;
  z0: number;
  /** 终点三维坐标 */
  x1: number;
  y1: number;
  z1: number;
  /** 轨迹上拱弧高 */
  arcLift: number;
  /** 亮度强度 */
  amp: number;
  /** 冷暖色调权重 */
  colorMix: number;
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

interface SupernovaWaveEvent {
  t: number;
  strength: number;
  speed: number;
  tau: number;
}

/** 计算专辑封面整体感知明度（0..1），用于微调水下封面背光平衡 */
function computeCoverLuminance(pixels: Uint8ClampedArray, fallbackLight: boolean): number {
  if (!pixels || pixels.length < 16) return fallbackLight ? 0.65 : 0.28;
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

/** 构建 36 颗天球星座主恒星锚点（左翼、天顶银心、右翼三大星官簇 × 12 半音，排布自然舒展） */
function buildStarAnchors(seed: number): StarAnchor[] {
  const random = rng((seed ^ 0x7c3a91e5) >>> 0);
  const anchors: StarAnchor[] = [];
  // 三个星官簇的方位中心（弧度）与仰角基准，严格收纳于 16:9 黄金画幅天际内
  const clusterAz = [-0.42, 0.0, 0.42];
  const clusterEl = [0.28, 0.36, 0.29];

  for (let cluster = 0; cluster < 3; cluster++) {
    for (let note = 0; note < 12; note++) {
      // 在各自星官天区内按黄金角螺旋紧凑排布，使连线呈现真实古星图的精致折线与三角构型
      const ringT = (note + 0.5) / 12;
      const localAngle = note * 2.39996323 + cluster * 1.15 + (random() - 0.5) * 0.22;
      const spreadAz = (0.06 + 0.14 * Math.sqrt(ringT)) * Math.cos(localAngle);
      const spreadEl = (0.045 + 0.10 * Math.sqrt(ringT)) * Math.sin(localAngle) + (note - 5.5) * 0.006;

      const az = clusterAz[cluster] + spreadAz;
      const el = THREE.MathUtils.clamp(clusterEl[cluster] + spreadEl, 0.15, 0.48);
      const dist = 66.0 + 6.0 * random();

      const cosEl = Math.cos(el);
      const x = Math.sin(az) * cosEl * dist;
      const y = Math.sin(el) * dist + 1.5;
      const z = -Math.cos(az) * cosEl * dist;

      anchors.push({
        x,
        y,
        z,
        cluster,
        note,
        baseMag: 0.42 + 0.45 * random(),
        colorMix: random(),
      });
    }
  }
  return anchors;
}

/** 预构建全曲确定性星象事件轴：琶音星座点亮/连线、Drop 流星雨、水面涟漪、超新星冲击环 */
function buildStarryEvents(music: Music, anchors: readonly StarAnchor[], seed: number): {
  arpEvents: ArpStarEvent[];
  arpTimes: Float64Array;
  lineEvents: Array<{ t: number; aIdx: number; bIdx: number; amp: number }>;
  lineTimes: Float64Array;
  meteors: MeteorEvent[];
  meteorTimes: Float64Array;
  ripples: WaterRippleEvent[];
  rippleTimes: Float64Array;
  novas: SupernovaWaveEvent[];
  novaTimes: Float64Array;
} {
  const random = rng((seed ^ 0x3b8d52f7) >>> 0);
  const arpEvents: ArpStarEvent[] = [];
  const lineEvents: Array<{ t: number; aIdx: number; bIdx: number; amp: number }> = [];
  const meteors: MeteorEvent[] = [];
  const ripples: WaterRippleEvent[] = [];
  const novas: SupernovaWaveEvent[] = [];

  // 1. 提取合成器拨弦琶音 (synthStab)、主旋律 (lead) 与键盘和弦 (keys) 起音
  const synthHits = music.roleHits('synthStab', 0, music.duration);
  const leadHits = music.roleHits('lead', 0, music.duration);
  const keyHits = music.hitsBetween('keys', 0, music.duration);
  const bassHits = music.roleHits('bassStab', 0, music.duration);

  const melodicRaw: Array<{ t: number; s: number; roleBias: number }> = [];
  for (const [t, s] of synthHits) if (s >= 0.16) melodicRaw.push({ t, s: s * 1.06, roleBias: 0 });
  for (const [t, s] of leadHits) if (s >= 0.16) melodicRaw.push({ t, s: s * 1.10, roleBias: 1 });
  for (const [t, s] of keyHits) if (s >= 0.18) melodicRaw.push({ t, s: s * 0.94, roleBias: 2 });
  if (melodicRaw.length < 24) {
    for (const [t, s] of bassHits) if (s >= 0.20) melodicRaw.push({ t, s: s * 0.85, roleBias: 0 });
    for (const [t, s] of music.a.hits.accent ?? []) if (s >= 0.20) melodicRaw.push({ t, s: s * 0.88, roleBias: 1 });
  }
  melodicRaw.sort((a, b) => a.t - b.t);

  let lastArpT = -10;
  let lastStarIdx = -1;
  let activeCluster = Math.floor(random() * 3);
  let notesInPhrase = 0;

  for (const item of melodicRaw) {
    if (item.t - lastArpT < 0.082) continue;
    const gap = item.t - lastArpT;
    const pitch = music.pitchAt(item.t);
    const note = ((pitch.note % 12) + 12) % 12;

    // 乐句停顿超过 1.15s 或同一星官连续点亮满 7 颗星后，轮换至下一片星官天区开启新星座
    const brokenPhrase = gap > 1.15 || notesInPhrase >= 7;
    if (brokenPhrase) {
      activeCluster = (activeCluster + 1 + (random() > 0.65 ? 1 : 0)) % 3;
      notesInPhrase = 0;
    }

    let starIdx = activeCluster * 12 + note;
    // 防止连续两个相同音高原地踏步导致零长度连线
    if (starIdx === lastStarIdx) {
      starIdx = activeCluster * 12 + ((note + 7) % 12);
    }

    let prevStarIdx = !brokenPhrase && lastStarIdx >= 0 ? lastStarIdx : -1;
    if (prevStarIdx >= 0) {
      const a0 = anchors[prevStarIdx];
      const a1 = anchors[starIdx];
      const d3 = Math.hypot(a1.x - a0.x, a1.y - a0.y, a1.z - a0.z);
      if (d3 > 21.5) prevStarIdx = -1;
    }
    const amp = Math.min(1.25, 0.56 + 0.68 * item.s);

    arpEvents.push({ t: item.t, note, starIdx, amp, prevStarIdx });
    if (prevStarIdx >= 0 && prevStarIdx !== starIdx) {
      lineEvents.push({ t: item.t, aIdx: prevStarIdx, bIdx: starIdx, amp });
    }

    // 琶音星光同步在水下星盘十二宫外环对应方位激起清透涟漪
    const ringAng = (note / 12) * Math.PI * 2 + (random() - 0.5) * 0.14;
    const ringR = ASTROLABE_OUTER_R - 0.65 + (random() - 0.5) * 0.8;
    ripples.push({
      t: item.t,
      x: Math.cos(ringAng) * ringR,
      z: Math.sin(ringAng) * ringR,
      maxRadius: 2.6 + 1.6 * item.s,
      amp: 0.45 + 0.55 * item.s,
      tau: 1.05 + 0.35 * random(),
      freq: 8.2 + 2.2 * random(),
    });

    lastArpT = item.t;
    lastStarIdx = starIdx;
    notesInPhrase++;
  }

  // 补充四四拍强底鼓在星盘中心外缘激起的宽波长水纹脉冲
  let lastKickRippleT = -10;
  for (const [kt, ks] of music.a.hits.kick ?? []) {
    if (ks < 0.32 || kt - lastKickRippleT < 0.42) continue;
    lastKickRippleT = kt;
    ripples.push({
      t: kt,
      x: (random() - 0.5) * 0.35,
      z: (random() - 0.5) * 0.35,
      maxRadius: 11.2 + 3.2 * ks,
      amp: 0.58 + 0.52 * ks,
      tau: 1.45,
      freq: 5.2,
    });
  }
  ripples.sort((a, b) => a.t - b.t);

  // 2. 构建超新星日冕冲击环与极乐流星雨（Drop 密集爆发，Chorus 适度辉映，平缓段偶现许愿单星）
  for (const sec of music.a.sections) {
    if (sec.label === 'drop') {
      // Drop 首拍触发主超新星苍穹光环
      novas.push({ t: sec.start, strength: 1.25, speed: 0.88, tau: 2.1 });
      // Drop 内每 4 小节重拍触发次级推进星环
      for (const db of music.downbeats) {
        if (db > sec.start + 1.8 && db < sec.end - 1.2) {
          const barIdx = lastIndex(music.downbeats, db);
          if (barIdx >= 0 && barIdx % 4 === 0) {
            novas.push({ t: db, strength: 0.78, speed: 0.76, tau: 1.65 });
          }
        }
      }
    } else if (sec.label === 'chorus' && sec.energy >= 0.72) {
      novas.push({ t: sec.start, strength: 0.85, speed: 0.74, tau: 1.75 });
    }
  }
  novas.sort((a, b) => a.t - b.t);

  // 流星雨生成：遍历小节与高潮旋律重音，塑造和谐统一的平行斜掠流星雨倾角
  const showerDir = (seed & 1) === 0 ? 1 : -1;
  let lastMeteorT = -10;

  for (const sec of music.a.sections) {
    const isDrop = sec.label === 'drop';
    const isChorus = sec.label === 'chorus';
    const isBuild = sec.label === 'build' || sec.label === 'pre';

    if (isDrop || isChorus) {
      const minGap = isDrop ? 0.24 : 0.58;
      // 优先贴合该段落内的主旋律强音触发流星
      for (const ev of arpEvents) {
        if (ev.t < sec.start || ev.t >= sec.end) continue;
        if (ev.t - lastMeteorT < minGap) continue;
        if (ev.amp < (isDrop ? 0.68 : 0.82) && random() > (isDrop ? 0.45 : 0.22)) continue;

        lastMeteorT = ev.t;
        const spanZ = -56.0 - 22.0 * random();
        const startX = (random() - 0.5) * 68.0 - showerDir * 14.0;
        const startY = 22.0 + 18.0 * random();
        const travelX = showerDir * (20.0 + 16.0 * random());
        const travelY = -(11.0 + 9.5 * random());

        meteors.push({
          t: ev.t,
          dur: 0.58 + 0.34 * random(),
          x0: startX,
          y0: startY,
          z0: spanZ,
          x1: startX + travelX,
          y1: Math.max(4.2, startY + travelY),
          z1: spanZ + (random() - 0.5) * 8.0,
          arcLift: 1.4 + 1.2 * random(),
          amp: isDrop ? (0.85 + 0.45 * random()) : (0.68 + 0.35 * random()),
          colorMix: random(),
        });
      }

      // 确保纯节奏型 Trance Drop 即使旋律稀疏也有壮丽密集的平行斜掠流星雨
      const stepSec = isDrop ? 0.26 : 0.75;
      for (let mt = sec.start + 0.08; mt < sec.end - 0.25; mt += stepSec + random() * 0.22) {
        let nearExisting = false;
        for (let k = meteors.length - 1; k >= 0 && k >= meteors.length - 8; k--) {
          if (Math.abs(meteors[k].t - mt) < 0.14) { nearExisting = true; break; }
        }
        if (nearExisting) continue;
        const spanZ = -56.0 - 16.0 * random();
        const startX = (random() - 0.5) * 58.0 - showerDir * 12.0;
        const startY = 17.5 + 13.5 * random();
        meteors.push({
          t: mt,
          dur: 0.65 + 0.30 * random(),
          x0: startX,
          y0: startY,
          z0: spanZ,
          x1: startX + showerDir * (19.0 + 12.0 * random()),
          y1: Math.max(4.2, startY - (9.5 + 6.5 * random())),
          z1: spanZ + (random() - 0.5) * 5.0,
          arcLift: 1.2 + 0.9 * random(),
          amp: isDrop ? 1.08 : 0.78,
          colorMix: random(),
        });
      }
    } else if (!isBuild) {
      // 平缓/间奏段落：每隔 5~8 秒偶现一颗静谧的单星划过天际，增添空灵呼吸感
      for (let mt = sec.start + 2.2; mt < sec.end - 1.5; mt += 5.5 + random() * 3.5) {
        const spanZ = -64.0 - 14.0 * random();
        const startX = (random() - 0.5) * 52.0 - showerDir * 10.0;
        const startY = 24.0 + 12.0 * random();
        meteors.push({
          t: mt,
          dur: 0.85 + 0.30 * random(),
          x0: startX,
          y0: startY,
          z0: spanZ,
          x1: startX + showerDir * (18.0 + 10.0 * random()),
          y1: Math.max(7.0, startY - 9.5),
          z1: spanZ,
          arcLift: 1.2,
          amp: 0.62,
          colorMix: random(),
        });
      }
    }
  }
  meteors.sort((a, b) => a.t - b.t);

  return {
    arpEvents,
    arpTimes: Float64Array.from(arpEvents, e => e.t),
    lineEvents,
    lineTimes: Float64Array.from(lineEvents, e => e.t),
    meteors,
    meteorTimes: Float64Array.from(meteors, e => e.t),
    ripples,
    rippleTimes: Float64Array.from(ripples, e => e.t),
    novas,
    novaTimes: Float64Array.from(novas, e => e.t),
  };
}

// ============================================================================
// 共享 GLSL 天体噪声与苍穹求值核心（被 SkyDome 与 SalarMirror 同步调用，实现 1:1 真实镜像）
// ============================================================================
const GLSL_COSMOS_COMMON = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

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

// 零极点畸变的 3D 球面网格锐利背景繁星层
vec3 sampleStarLayer(vec3 dir, float density, float timeVal, vec3 warmCol, vec3 coolCol) {
  vec3 p = dir * density;
  vec3 cell = floor(p);
  vec3 f = fract(p) - 0.5;
  vec3 rnd = hash33(cell);
  // 控制稀疏度，仅部分晶格生成亮星
  float starMask = step(0.62, rnd.z);
  vec3 starOffset = (rnd - 0.5) * 0.66;
  float d = length(f - starOffset);
  float size = 0.045 + 0.065 * rnd.x;
  float core = smoothstep(size, 0.0, d) * starMask;
  float halo = exp(-d * 13.0) * 0.35 * starMask * step(0.84, rnd.z);
  float twinkle = 0.72 + 0.28 * sin(timeVal * (1.8 + 3.4 * rnd.y) + rnd.x * 40.0);
  vec3 sCol = mix(coolCol, warmCol, smoothstep(0.25, 0.85, rnd.y));
  return sCol * (core * 1.45 + halo) * twinkle * (0.45 + 0.85 * rnd.x);
}

// 统一计算任意射线 (origin, dir) 所见的宇宙苍穹：
// 包含深空渐变、斜跨天际的银河银心与暗尘埃大裂隙、封面双色体积星云、Build-up 长曝光星轨、Drop 超新星日冕与圣光柱
vec3 evalCosmosSky(
  vec3 origin,
  vec3 dir,
  int zeroGuard,
  float timeVal,
  float flowVal,
  float sectionEnergy,
  float buildCharge,
  float dropIgnite,
  float kickPunch,
  vec3 spaceZenith,
  vec3 spaceHorizon,
  vec3 nebulaPrimary,
  vec3 nebulaAccent,
  vec3 starWarm,
  vec3 starCool,
  vec4 novaWaves[${MAX_SUPERNOVA_WAVES}]
) {
  float up = clamp(dir.y, 0.0, 1.0);
  // 1. 深邃宇宙靛蓝天顶与地平线大气微辉 (Airglow)
  vec3 sky = mix(spaceHorizon, spaceZenith, pow(up, 0.52));

  // 2. 银河银盘坐标系（倾角 36°，从左下方地平线斜跨过星门右上方直抵天顶）
  float celestialDrift = timeVal * 0.0085;
  float ca = cos(celestialDrift), sa = sin(celestialDrift);
  vec3 sDir = vec3(dir.x * ca - dir.z * sa, dir.y, dir.x * sa + dir.z * ca);
  // 旋转至倾斜银盘平面
  const float tilt = 0.62;
  float ct = cos(tilt), st = sin(tilt);
  vec3 galDir = vec3(sDir.x * ct - sDir.y * st, sDir.x * st + sDir.y * ct, sDir.z);

  float galLat = asin(clamp(galDir.y, -1.0, 1.0)); // 银纬 (-pi/2 .. pi/2)
  float galLon = atan(galDir.x, -galDir.z);        // 银经 (-pi .. pi)

  // 银河主光带包络与银心隆起（银心锁在正面视野偏右上 galLon ≈ 0.18）
  float coreBulge = exp(-pow((galLon - 0.18) / 0.85, 2.0));
  float bandWidth = 0.24 + 0.14 * coreBulge;
  float bandEnv = exp(-pow(galLat / bandWidth, 2.0));

  vec2 galUv = vec2(galLon * 2.4, galLat * 5.2);
  float cloudFine = fbm4(galUv + vec2(flowVal * 0.02, -flowVal * 0.015));
  float cloudMacro = fbm4(galUv * 0.52 - vec2(flowVal * 0.012, 0.0));

  // 大裂隙星际暗尘埃带（Ridged Dark Dust Rift）：赋予银河深空天文摄影般的真实明暗层次
  float dustNoise = fbm4(galUv * 1.45 + vec2(3.7, -1.9));
  float dustLane = smoothstep(0.44, 0.72, dustNoise) * exp(-pow(galLat / 0.11, 2.0));

  float milkyGlow = bandEnv * (0.38 + 0.92 * cloudFine) * (0.55 + 0.75 * coreBulge);
  milkyGlow *= (1.0 - 0.68 * dustLane);

  // 3. 封面主副色电离发射星云与反射星云团（丝绒般顺滑的星际云气，零像素颗粒感）
  float nebMaskA = smoothstep(0.34, 0.80, cloudMacro) * exp(-pow((galLat - 0.07) / 0.40, 2.0));
  float nebMaskB = smoothstep(0.36, 0.84, fbm4(galUv * 0.88 + vec2(11.3, 5.4))) * exp(-pow((galLat + 0.09) / 0.44, 2.0));
  float nebulaBoost = 0.78 + 0.46 * sectionEnergy + 0.38 * dropIgnite + 0.14 * kickPunch;

  vec3 galacticCoreCol = mix(starWarm, nebulaPrimary, 0.38);
  sky += galacticCoreCol * milkyGlow * (0.44 + 0.30 * dropIgnite) * smoothstep(-0.02, 0.14, dir.y);
  sky += nebulaPrimary * nebMaskA * 0.52 * nebulaBoost * smoothstep(-0.02, 0.16, dir.y);
  sky += nebulaAccent * nebMaskB * 0.48 * nebulaBoost * smoothstep(-0.02, 0.16, dir.y);

  // 4. 四层球面圆核锐利繁星（含银盘密集针尖星团，彻底杜绝体素方块感）
  float horizonFade = smoothstep(-0.01, 0.10, dir.y);
  vec3 galDenseStars = sampleStarLayer(galDir * 1.07 + vec3(1.9, -3.1, 2.4), 270.0, timeVal * 0.65, starWarm, starCool)
                     * bandEnv * (1.15 - 0.65 * dustLane);
  vec3 stars = sampleStarLayer(sDir, 76.0, timeVal, starWarm, starCool)
             + sampleStarLayer(sDir * 1.13 + vec3(4.1, 2.3, -1.7), 132.0, timeVal * 0.85, starWarm, starCool) * 0.72
             + sampleStarLayer(sDir * 0.91 - vec3(2.7, 5.1, 3.3), 210.0, timeVal * 0.7, starCool, starWarm) * 0.48
             + galDenseStars * 0.75;
  // Build-up 星轨拉长期间平滑收束点状星，转为旋转星轨弧线
  sky += stars * horizonFade * (1.0 - 0.45 * buildCharge);

  // 5. 锁定远方 3D 神圣星象环门中心的世界极轴（使天空与水中倒影的星轨、日冕波、光柱 100% 严丝合缝对齐环门中心）
  vec3 archWorld = vec3(0.0, ${ARCH_CENTER_Y.toFixed(2)}, ${ARCH_Z.toFixed(2)});
  vec3 axisZ = normalize(archWorld - origin);
  vec3 axisX = normalize(cross(vec3(0.0, 1.0, 0.0), axisZ));
  vec3 axisY = cross(axisZ, axisX);

  float projX = dot(dir, axisX);
  float projY = dot(dir, axisY);
  float projZ = dot(dir, axisZ);
  float rho = acos(clamp(projZ, -1.0, 1.0)); // 距星门中心的张角（弧度）
  float phi = atan(projY, projX);

  // 5a. Build-up「长曝光星轨旋转聚能」(Star-Trail Vortex Convergence)
  if (buildCharge > 0.008 && projZ > 0.15) {
    float spinAngle = timeVal * (0.55 + 1.85 * buildCharge) + buildCharge * 2.4;
    float radialCell = floor(rho * 68.0);
    float ringSeed = hash11(radialCell * 1.73 + 13.7);
    float trailCount = 3.0 + floor(ringSeed * 5.0);
    float arcPhase = fract((phi + spinAngle * (0.65 + 0.7 * ringSeed)) / 6.2831853 * trailCount + ringSeed * 7.0);
    // 随 buildCharge 增大，点状星逐渐拉长为优雅的同心圆弧星轨
    float arcLen = 0.06 + 0.58 * buildCharge;
    float arcProfile = smoothstep(0.0, 0.025, arcPhase) * (1.0 - smoothstep(arcLen * 0.55, arcLen, arcPhase));
    float ringLine = exp(-pow((fract(rho * 68.0) - 0.5) / 0.24, 2.0));
    float radialWindow = smoothstep(0.03, 0.14, rho) * (1.0 - smoothstep(0.55, 1.15, rho));

    vec3 trailCol = mix(nebulaAccent, starWarm, ringSeed);
    trailCol = mix(trailCol, vec3(1.0), 0.35 * buildCharge);
    sky += trailCol * arcProfile * ringLine * radialWindow * step(0.28, ringSeed) * buildCharge * 1.35 * horizonFade;

    // 星门奇点聚能星核（随 Build-up 推向顶点越聚越亮）
    float singularity = exp(-pow(rho / (0.16 - 0.07 * buildCharge), 2.0));
    sky += mix(nebulaPrimary, vec3(1.0, 0.98, 0.94), 0.65) * singularity * buildCharge * 0.95;
  }

  // 5b. Drop「星穹圣光柱与超新星日冕波」(Astral Pillar & Supernova Shockwave Rings)
  if (projZ > 0.0) {
    // 星门核心恒常神圣星晕（克制通透，不泛白掩盖背景星云）
    float coreHalo = exp(-pow(rho / 0.17, 2.0)) * (0.18 + 0.32 * sectionEnergy + 0.45 * dropIgnite + 0.20 * kickPunch);
    sky += mix(nebulaPrimary, starWarm, 0.48) * coreHalo;

    if (dropIgnite > 0.01) {
      // 沿星门正上方直冲天顶的凝练丝缕状星穹圣光柱
      float beamWidth = 0.032 + 0.036 * max(0.0, projY) + 0.010 * kickPunch;
      float beamXMask = exp(-pow(projX / beamWidth, 2.0));
      float beamYMask = smoothstep(-0.03, 0.05, projY) * exp(-max(0.0, projY) * 2.05);
      float filaments = 0.65 + 0.35 * sin(projX * 150.0 + flowVal * 3.2) * cos(projY * 28.0 - flowVal * 4.5);
      vec3 pillarCol = mix(nebulaPrimary, vec3(1.0, 0.98, 0.93), 0.62 + 0.25 * exp(-abs(projX) * 52.0));
      sky += pillarCol * beamXMask * beamYMask * filaments * dropIgnite * (0.98 + 0.35 * kickPunch);
    }

    // 超新星日冕双层纤细激波星环（锐利通透，透出背后璀璨星云与流星雨）
    for (int i = zeroGuard; i < ${MAX_SUPERNOVA_WAVES}; i++) {
      vec4 nw = novaWaves[i]; // x: age, y: strength, z: speed, w: tau
      if (nw.y <= 0.001 || nw.x < 0.0) continue;
      float waveRho = 0.07 + nw.x * nw.z;
      float env = nw.y * exp(-nw.x / nw.w) * (1.0 - smoothstep(0.92, 1.32, waveRho));
      if (env <= 0.002) continue;
      float primaryRing = exp(-pow((rho - waveRho) / (0.014 + 0.008 * nw.x), 2.0));
      float echoRing = exp(-pow((rho - waveRho * 0.84) / (0.009 + 0.005 * nw.x), 2.0)) * 0.55;
      vec3 ringCol = mix(nebulaAccent, vec3(1.0, 0.98, 0.95), 0.58);
      sky += ringCol * (primaryRing + echoRing) * env * 0.88 * horizonFade;
    }
  }

  // 地平线柔和大雾衔接带，令远方天水无痕交融
  float horizonMist = exp(-abs(dir.y) * 16.0);
  sky = mix(sky, spaceHorizon + nebulaPrimary * (0.08 + 0.08 * sectionEnergy), horizonMist * 0.48);

  return max(sky, vec3(0.0));
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
uniform int uZero;
uniform float uTime;
uniform float uFlow;
uniform float uSectionEnergy;
uniform float uBuildCharge;
uniform float uDropIgnite;
uniform float uKickPunch;
uniform vec3 uSpaceZenith;
uniform vec3 uSpaceHorizon;
uniform vec3 uNebulaPrimary;
uniform vec3 uNebulaAccent;
uniform vec3 uStarWarm;
uniform vec3 uStarCool;
uniform vec4 uNovaWaves[${MAX_SUPERNOVA_WAVES}];
varying vec3 vWorldPos;
${GLSL_COSMOS_COMMON}

void main() {
  vec3 rd = normalize(vWorldPos - cameraPosition);
  vec3 col = evalCosmosSky(
    cameraPosition, rd, uZero,
    uTime, uFlow, uSectionEnergy, uBuildCharge, uDropIgnite, uKickPunch,
    uSpaceZenith, uSpaceHorizon, uNebulaPrimary, uNebulaAccent, uStarWarm, uStarCool,
    uNovaWaves
  );
  gl_FragColor = vec4(col, 1.0);
}
`;

// ============================================================================
// 2. 天空之镜盐湖 + 水下发光星盘琉璃封面 + 星门倒影着色器 (Salar Mirror)
// ============================================================================
const SALAR_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SALAR_FRAG = /* glsl */ `
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
uniform float uArchSpinA;
uniform float uArchSpinB;
uniform vec3 uSpaceZenith;
uniform vec3 uSpaceHorizon;
uniform vec3 uNebulaPrimary;
uniform vec3 uNebulaAccent;
uniform vec3 uStarWarm;
uniform vec3 uStarCool;
uniform vec3 uSalarDeep;
uniform vec4 uNovaWaves[${MAX_SUPERNOVA_WAVES}];
uniform vec4 uRippleA[${MAX_RIPPLES}]; // x, z, age, amp
uniform vec4 uRippleB[${MAX_RIPPLES}]; // maxRadius, freq, tau, unused
uniform vec4 uChroma0;
uniform vec4 uChroma1;
uniform vec4 uChroma2;
varying vec3 vWorldPos;
${GLSL_COSMOS_COMMON}

float chromaAtIdx(int idx) {
  if (idx < 4) return idx == 0 ? uChroma0.x : idx == 1 ? uChroma0.y : idx == 2 ? uChroma0.z : uChroma0.w;
  if (idx < 8) return idx == 4 ? uChroma1.x : idx == 5 ? uChroma1.y : idx == 6 ? uChroma1.z : uChroma1.w;
  return idx == 8 ? uChroma2.x : idx == 9 ? uChroma2.y : idx == 10 ? uChroma2.z : uChroma2.w;
}

// 乌尤尼盐沼水底天然六边形微晶盐壳肌理
float hexSaltCrust(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
  vec2 cell = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
  cell = abs(cell);
  float hexDist = max(dot(cell, s * 0.5), cell.x);
  return smoothstep(0.42, 0.495, hexDist);
}

// 解析计算反射射线 R 与远方神圣星象环门平面 (z = ARCH_Z) 的水波摇曳倒影
vec3 evalArchReflection(vec3 origin, vec3 R) {
  if (R.z >= -0.02) return vec3(0.0);
  float tHit = (${ARCH_Z.toFixed(2)} - origin.z) / R.z;
  if (tHit <= 0.0 || tHit > 160.0) return vec3(0.0);
  vec3 hit = origin + R * tHit;
  if (hit.y < 0.0) return vec3(0.0);

  vec2 d = hit.xy - vec2(0.0, ${ARCH_CENTER_Y.toFixed(2)});
  float r = length(d);
  float ang = atan(d.y, d.x);

  // 外主拱环、中旋转星度环、内咬合环三层发光轮廓
  float outerBand = exp(-pow((r - ${ARCH_OUTER_R.toFixed(2)}) / 0.42, 2.0));
  float midBand = exp(-pow((r - ${ARCH_MID_R.toFixed(2)}) / 0.28, 2.0))
                * (0.65 + 0.35 * cos((ang + uArchSpinA) * 36.0));
  float innerBand = exp(-pow((r - ${ARCH_INNER_R.toFixed(2)}) / 0.24, 2.0))
                  * (0.65 + 0.35 * sin((ang - uArchSpinB) * 24.0));
  // 两侧入水双子星碑
  float pierMask = exp(-pow((abs(hit.x) - 10.72) / 0.45, 2.0)) * (1.0 - smoothstep(6.2, 7.8, hit.y));

  float glowBoost = 0.55 + 0.55 * uSectionEnergy + 0.65 * uDropIgnite + 0.35 * uBuildCharge + 0.22 * uKickPunch;
  vec3 archCol = mix(uNebulaPrimary, uStarWarm, 0.55) * (outerBand * 0.95 + pierMask * 0.72)
               + mix(uNebulaAccent, vec3(1.0), 0.48) * (midBand * 0.85 + innerBand * (0.80 + 0.65 * uBuildCharge));
  return archCol * glowBoost * exp(-tHit * 0.008);
}

void main() {
  vec2 xz = vWorldPos.xz;
  float distOrigin = length(xz);

  // 1. 水面微澜与确定性落水/底鼓涟漪（Breakdown 失重期间水面自动静谧如完美黑镜）
  float calmScale = 1.0 - 0.72 * uZeroGravity;
  vec2 grad = vec2(0.0);

  vec2 w1 = xz * 2.1 + vec2(uFlow * 0.42, -uFlow * 0.34);
  vec2 w2 = xz * 3.5 + vec2(-uFlow * 0.36, uFlow * 0.48);
  grad += vec2(cos(w1.x) * sin(w1.y), sin(w1.x) * cos(w1.y)) * 0.0065 * calmScale;
  grad += vec2(cos(w2.x + w2.y), cos(w2.x + w2.y)) * 0.0045 * calmScale;

  float rippleCaustic = 0.0;
  for (int i = uZero; i < ${MAX_RIPPLES}; i++) {
    vec4 ra = uRippleA[i];
    if (ra.w <= 0.001) continue;
    vec4 rb = uRippleB[i];
    vec2 dVec = xz - ra.xy;
    float dist = length(dVec) + 1e-4;
    if (dist > rb.x + 0.8) continue;

    float front = ra.z * (rb.x / max(0.35, rb.z * 1.32));
    float env = exp(-ra.z / rb.z) * exp(-pow((dist - front) / 0.65, 2.0)) * (1.0 - smoothstep(rb.x * 0.78, rb.x, dist));
    float phase = dist * rb.y - ra.z * 10.8;
    float c = cos(phase);
    float amp = ra.w * 0.024 * env * (0.45 + 0.55 * calmScale);
    grad += (dVec / dist) * (c * rb.y * amp);
    rippleCaustic += max(0.0, c) * env * ra.w;
  }

  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 V = normalize(cameraPosition - vWorldPos);

  // 2. 水下晶盐湖底与圆形发光星盘专辑封面折射求值 (depth = 0.36m)
  vec3 refr = refract(-V, N, 0.75);
  vec2 floorXZ = xz + refr.xz * (0.36 / max(0.26, -refr.y)) + grad * 1.15;
  float rFloor = length(floorXZ);
  float angFloor = atan(floorXZ.y, floorXZ.x);

  // 天然乌尤尼六边形微晶盐脊底纹（随远距离柔和消隐）
  float saltRidge = hexSaltCrust(floorXZ * 0.62) * exp(-distOrigin * 0.055);
  vec3 floorCol = uSalarDeep * (0.72 + 0.28 * fbm4(floorXZ * 0.85))
                + mix(uSalarDeep, uStarCool, 0.25) * saltRidge * 0.14;

  // 水下圆形星盘专辑封面 + 12 宫音阶刻度外环
  float medallionZone = 1.0 - smoothstep(${ASTROLABE_OUTER_R.toFixed(2)} - 0.15, ${ASTROLABE_OUTER_R.toFixed(2)} + 0.35, rFloor);
  if (medallionZone > 0.001) {
    // 2a. 内圆高保真专辑封面 (rFloor <= MEDALLION_RADIUS)
    if (rFloor < ${MEDALLION_RADIUS.toFixed(2)} + 0.22) {
      vec2 coverUv = vec2(
        floorXZ.x / (${(MEDALLION_RADIUS * 2).toFixed(2)}) + 0.5,
        0.5 - floorXZ.y / (${(MEDALLION_RADIUS * 2).toFixed(2)})
      );
      vec2 clampedUv = clamp(coverUv, 0.004, 0.996);
      vec3 coverTex = texture2D(uCover, clampedUv).rgb;

      // 极细腻的水晶星盘同心微刻线，绝不破坏封面图案细节
      float crystalEtch = 1.0 + 0.035 * cos(rFloor * 14.0);
      float coverMask = 1.0 - smoothstep(${MEDALLION_RADIUS.toFixed(2)} - 0.07, ${MEDALLION_RADIUS.toFixed(2)} + 0.02, rFloor);
      // 柔和边缘蓝宝石水晶暗角与背光提亮，确保暗色与亮色封面均通透清晰
      float edgeVignette = 1.0 - 0.16 * smoothstep(${MEDALLION_RADIUS.toFixed(2)} * 0.72, ${MEDALLION_RADIUS.toFixed(2)}, rFloor);
      vec3 litCover = coverTex * crystalEtch * edgeVignette * (0.86 + 0.22 * uSectionEnergy + 0.14 * uKickPunch);
      floorCol = mix(floorCol, litCover, coverMask);
    }

    // 2b. 星象十二宫刻度外环 (MEDALLION_RADIUS .. ASTROLABE_OUTER_R)
    float normAng = fract(angFloor / 6.2831853 + 1.0);
    float sectorF = normAng * 12.0;
    int noteIdx = int(mod(floor(sectorF + 0.5), 12.0));
    float cVal = chromaAtIdx(noteIdx);

    // 内外双层星辉金属镶边环 + 中间精密分度环
    float innerRim = exp(-pow((rFloor - ${MEDALLION_RADIUS.toFixed(2)}) / 0.068, 2.0));
    float outerRim = exp(-pow((rFloor - ${ASTROLABE_OUTER_R.toFixed(2)}) / 0.075, 2.0));
    float midScaleRing = exp(-pow((rFloor - ${(0.5 * (MEDALLION_RADIUS + ASTROLABE_OUTER_R)).toFixed(2)}) / 0.038, 2.0));

    float inRingBand = smoothstep(${MEDALLION_RADIUS.toFixed(2)} + 0.05, ${MEDALLION_RADIUS.toFixed(2)} + 0.22, rFloor)
                     * (1.0 - smoothstep(${ASTROLABE_OUTER_R.toFixed(2)} - 0.22, ${ASTROLABE_OUTER_R.toFixed(2)} - 0.05, rFloor));

    // 72 道星度细刻线 + 12 道半音宫位主分割线
    float fineTicks = pow(0.5 + 0.5 * cos(angFloor * 72.0), 16.0) * inRingBand;
    float majorSpokes = pow(0.5 + 0.5 * cos(angFloor * 12.0 + 0.261799), 26.0) * inRingBand;

    // 12 颗半音星芒宝石节点（随实时琶音/主音色度点亮）
    float gemAngle = float(noteIdx) * (6.2831853 / 12.0);
    vec2 gemPos = vec2(cos(gemAngle), sin(gemAngle)) * ${(0.5 * (MEDALLION_RADIUS + ASTROLABE_OUTER_R)).toFixed(2)};
    float gemDist = length(floorXZ - gemPos);
    float gemCore = exp(-pow(gemDist / 0.19, 2.0)) * (0.28 + 1.35 * cVal);
    float gemHalo = exp(-pow(gemDist / 0.68, 2.0)) * (0.12 + 0.65 * cVal);

    // 扇区底盘深蓝黑曜石衬底，烘托星盘刻度对比度
    floorCol = mix(floorCol, uSalarDeep * 0.45, inRingBand * 0.65);

    vec3 runeCol = mix(uNebulaPrimary, uStarWarm, 0.52);
    vec3 activeCol = mix(uNebulaAccent, vec3(1.0, 0.98, 0.92), 0.55);
    floorCol += runeCol * (innerRim * (0.78 + 0.42 * uKickPunch) + outerRim * (0.65 + 0.35 * uSectionEnergy) + midScaleRing * 0.32);
    floorCol += runeCol * (fineTicks * 0.28 + majorSpokes * 0.45);
    floorCol += activeCol * (gemCore * 1.15 + gemHalo * 0.58);
  }

  // 涟漪焦散微光
  floorCol += mix(uNebulaPrimary, uStarCool, 0.5) * rippleCaustic * 0.24;

  // 3. 天空之镜 1:1 真实苍穹与星门反射
  vec3 R = reflect(-V, N);
  R.y = max(0.002, R.y);
  vec3 reflSky = evalCosmosSky(
    vWorldPos, normalize(R), uZero,
    uTime, uFlow, uSectionEnergy, uBuildCharge, uDropIgnite, uKickPunch,
    uSpaceZenith, uSpaceHorizon, uNebulaPrimary, uNebulaAccent, uStarWarm, uStarCool,
    uNovaWaves
  );
  vec3 reflArch = evalArchReflection(vWorldPos, normalize(R));
  vec3 reflTotal = (reflSky + reflArch) * 0.90;

  // 菲涅尔权重：在中心专辑封面正上方主动压低天空强反射以保持封面高保真清晰度；外围盐湖全面释放天空之镜高反射
  float rawFresnel = 0.18 + 0.78 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.4);
  float coverClearMask = 1.0 - smoothstep(${MEDALLION_RADIUS.toFixed(2)} * 0.82, ${ASTROLABE_OUTER_R.toFixed(2)} + 1.2, rFloor);
  float fresnel = mix(rawFresnel, min(rawFresnel, 0.18), coverClearMask * 0.88);

  vec3 col = mix(floorCol, reflTotal, clamp(fresnel, 0.08, 0.92));

  // 水波波峰星辉高光与高频开镲晶盐微闪
  float crestSpec = pow(clamp(length(grad) * 14.0, 0.0, 1.0), 1.7);
  col += mix(uNebulaPrimary, vec3(1.0), 0.6) * crestSpec * (0.20 + 0.25 * uDropIgnite);

  if (uHatSparkle > 0.02 && coverClearMask < 0.5) {
    float glintNoise = vnoise2(xz * 12.0 + vec2(uTime * 2.1, -uTime * 1.6));
    float glint = smoothstep(0.86, 0.99, glintNoise) * exp(-distOrigin * 0.035);
    col += mix(uStarCool, vec3(1.0), 0.65) * glint * uHatSparkle * 1.15;
  }

  // 远景无垠盐湖与地平线宇宙微雾无缝融合（消除任何生硬网格边缘）
  float horizonBlend = smoothstep(75.0, 168.0, distOrigin);
  vec3 farMist = uSpaceHorizon + uNebulaPrimary * (0.08 + 0.08 * uSectionEnergy);
  col = mix(col, farMist, horizonBlend);

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// ============================================================================
// 3. 神圣几何巨型星象环门着色器 (Celestial Astrolabe Arch)
// ============================================================================
const ARCH_VERT = /* glsl */ `
attribute float aRingRole; // 0: 外主拱与双子星碑, 1: 中旋转星度环, 2: 内咬合聚能环
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec2 vUv;
varying float vRole;

void main() {
  vUv = uv;
  vRole = aRingRole;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ARCH_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSectionEnergy;
uniform float uBuildCharge;
uniform float uDropIgnite;
uniform float uKickPunch;
uniform vec3 uSpaceHorizon;
uniform vec3 uNebulaPrimary;
uniform vec3 uNebulaAccent;
uniform vec3 uStarWarm;
uniform vec3 uArchMetal;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec2 vUv;
varying float vRole;

void main() {
  // 裁剪没入盐湖水面 (y < 0) 以下的环段，使拱门稳稳立于镜面之上
  if (vWorldPos.y < -0.02) discard;

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(vec3(0.0, 16.0, 12.0) - vWorldPos);

  float ndl = clamp(dot(N, L), 0.0, 1.0);
  float rim = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.4);

  // 深空星银/暗金立体金属骨架 + 连续不断裂的发光星辉能量导轨（避免背光面出现黑格断裂感）
  vec3 metalBase = mix(uArchMetal, uStarWarm * 0.42, 0.35 + 0.45 * ndl);
  vec3 col = metalBase * (0.62 + 0.58 * ndl);

  // 沿环截面连续发光的双道星辉嵌线 + 温润微雕星度刻纹
  float continuousRail = pow(0.5 + 0.5 * cos(vUv.y * 6.2831853 * 2.0), 5.0);
  float fineEtch = 0.82 + 0.18 * cos(vUv.x * 6.2831853 * (vRole > 0.5 ? 72.0 : 48.0));

  // 沿拱环流淌的柔和圣光波，保留高保底亮度使整道星门始终连贯璀璨
  float pulseWave = 0.76 + 0.24 * sin(vUv.x * 6.2831853 * 2.0 - uTime * (1.8 + 3.0 * uBuildCharge));
  float energyGain = 0.56 + 0.48 * uSectionEnergy + 0.65 * uBuildCharge + 0.75 * uDropIgnite + 0.28 * uKickPunch;

  vec3 glowCol = vRole < 0.5
    ? mix(uNebulaPrimary, uStarWarm, 0.58)
    : vRole < 1.5
      ? mix(uNebulaAccent, uStarWarm, 0.52)
      : mix(uNebulaPrimary, vec3(1.0, 0.98, 0.92), 0.68 + 0.25 * uBuildCharge);

  col += glowCol * (continuousRail * 0.58 + rim * 0.72 + 0.18) * fineEtch * pulseWave * energyGain;

  // 入水底座轻柔水雾接触辉光
  float waterFoot = exp(-max(0.0, vWorldPos.y) * 1.4);
  col += mix(uNebulaPrimary, uStarWarm, 0.4) * waterFoot * (0.22 + 0.25 * uKickPunch);

  // 远景大气透视微融合
  col = mix(col, uSpaceHorizon, 0.14);

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// ============================================================================
// 4. 琶音「点星成座」：十字/六芒衍射亮星芒着色器（含天空本体 + 盐湖镜像对偶）
// ============================================================================
const STAR_FLARE_VERT = /* glsl */ `
attribute vec4 aStarPos;   // xyz: 世界坐标, w: 0=天空本体, 1=盐湖倒影
attribute vec4 aStarState; // x: 当前闪耀强度, y: 色调权重, z: 基础星等, w: 相位种子
uniform float uTime;
uniform float uBuildCharge;
varying vec2 vQuad;
varying float vIntensity;
varying float vColorMix;
varying float vIsRefl;
varying vec3 vWorldPos;

void main() {
  vQuad = position.xy; // [-1..1]^2
  vIntensity = aStarState.x;
  vColorMix = aStarState.y;
  vIsRefl = aStarPos.w;

  vec3 wp = aStarPos.xyz;
  if (vIsRefl > 0.5) {
    wp.y = -wp.y;
    // 水中镜像随微风涟漪横向轻柔摇曳
    wp.x += sin(uTime * 2.4 + wp.z * 0.35 + aStarState.w * 6.28) * 0.34;
  }
  vWorldPos = wp;

  // 面向镜头的 Billboard 尺寸：被琶音点亮时绽放修长锐利的衍射光针
  float scale = (1.15 + 3.65 * clamp(vIntensity, 0.0, 1.35)) * (0.85 + 0.3 * aStarState.z);
  // Build-up 末尾略微收束让位于星轨聚能
  scale *= 1.0 - 0.25 * uBuildCharge;

  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 worldVert = wp + (camRight * position.x + camUp * position.y) * scale;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldVert, 1.0);
}
`;

const STAR_FLARE_FRAG = /* glsl */ `
uniform vec3 uNebulaPrimary;
uniform vec3 uNebulaAccent;
uniform vec3 uStarWarm;
uniform vec3 uStarCool;
varying vec2 vQuad;
varying float vIntensity;
varying float vColorMix;
varying float vIsRefl;
varying vec3 vWorldPos;

void main() {
  float d = length(vQuad);
  if (d > 1.0) discard;

  // 晶莹圆星核 + 主十字衍射星针 + 45° 副对角微芒
  float core = exp(-d * d * 26.0);
  float softHalo = exp(-d * 4.2) * 0.42;

  float spikeH = exp(-abs(vQuad.y) * 28.0) * pow(max(0.0, 1.0 - abs(vQuad.x)), 1.8);
  float spikeV = exp(-abs(vQuad.x) * 28.0) * pow(max(0.0, 1.0 - abs(vQuad.y)), 1.8);
  vec2 rotQ = vec2(vQuad.x + vQuad.y, vQuad.x - vQuad.y) * 0.70710678;
  float spikeDiag = (exp(-abs(rotQ.y) * 38.0) * pow(max(0.0, 1.0 - abs(rotQ.x)), 2.4)
                   + exp(-abs(rotQ.x) * 38.0) * pow(max(0.0, 1.0 - abs(rotQ.y)), 2.4)) * 0.45;

  float flareBoost = smoothstep(0.18, 0.95, vIntensity);
  float shape = core * 1.4 + softHalo * (0.45 + 0.65 * flareBoost)
              + (spikeH + spikeV + spikeDiag) * flareBoost * 1.25;

  vec3 tint = vColorMix < 0.5
    ? mix(uStarCool, uNebulaPrimary, vColorMix * 1.4)
    : mix(uNebulaAccent, uStarWarm, (vColorMix - 0.5) * 1.6);
  vec3 col = mix(tint, vec3(1.0, 0.99, 0.96), clamp(core * 0.85 + flareBoost * 0.35, 0.0, 1.0));

  float alpha = shape * vIntensity;

  // 水中镜像处理：菲涅尔反射衰减 + 避让脚下水下星盘封面核心区
  if (vIsRefl > 0.5) {
    vec3 ray = vWorldPos - cameraPosition;
    float tWater = -cameraPosition.y / min(-1e-3, ray.y);
    vec2 waterHitXZ = cameraPosition.xz + ray.xz * max(0.0, tWater);
    float rHit = length(waterHitXZ);
    float coverProtect = smoothstep(${MEDALLION_RADIUS.toFixed(2)} * 0.85, ${ASTROLABE_OUTER_R.toFixed(2)} + 1.5, rHit);
    alpha *= 0.48 * mix(0.22, 1.0, coverProtect);
  }

  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

// ============================================================================
// 5. 琶音「点星成座」：动态生长几何星座连线着色器（含天空本体 + 盐湖镜像）
// ============================================================================
const CONSTELLATION_LINE_VERT = /* glsl */ `
attribute vec4 aLineStart; // xyz: 起点世界坐标, w: 0=天空本体, 1=盐湖倒影
attribute vec4 aLineEnd;   // xyz: 终点世界坐标, w: 连线生长进度 [0..1]
attribute vec4 aLineStyle; // x: 亮度/余晖权重, y: 流光脉冲位置, z: 色调混合, w: 线宽缩放
uniform float uTime;
varying vec2 vLineUv;
varying float vAlpha;
varying float vDrawProg;
varying float vPulsePos;
varying float vColorMix;
varying float vIsRefl;
varying vec3 vWorldPos;

void main() {
  vLineUv = uv; // uv.x ∈ [0..1] 沿连线方向, uv.y ∈ [0..1] 横向宽度
  vAlpha = aLineStyle.x;
  vDrawProg = aLineEnd.w;
  vPulsePos = aLineStyle.y;
  vColorMix = aLineStyle.z;
  vIsRefl = aLineStart.w;

  if (vAlpha <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vWorldPos = vec3(0.0);
    return;
  }

  vec3 p0 = aLineStart.xyz;
  vec3 p1 = aLineEnd.xyz;
  if (vIsRefl > 0.5) {
    p0.y = -p0.y;
    p1.y = -p1.y;
    p0.x += sin(uTime * 2.3 + p0.z * 0.35 + p0.y * 0.2) * 0.32;
    p1.x += sin(uTime * 2.3 + p1.z * 0.35 + p1.y * 0.2) * 0.32;
  }

  vec3 center = mix(p0, p1, uv.x);
  vWorldPos = center;

  // 计算屏幕空间正交法向展开细丝光带
  vec3 segDir = normalize(p1 - p0 + vec3(1e-4));
  vec3 viewDir = normalize(cameraPosition - center);
  vec3 side = normalize(cross(viewDir, segDir) + vec3(0.0, 1e-4, 0.0));

  float halfWidth = (0.14 + 0.10 * aLineStyle.w) * (vIsRefl > 0.5 ? 1.35 : 1.0);
  vec3 worldVert = center + side * ((uv.y - 0.5) * 2.0 * halfWidth);

  gl_Position = projectionMatrix * viewMatrix * vec4(worldVert, 1.0);
}
`;

const CONSTELLATION_LINE_FRAG = /* glsl */ `
uniform vec3 uNebulaPrimary;
uniform vec3 uNebulaAccent;
uniform vec3 uStarWarm;
uniform vec3 uStarCool;
varying vec2 vLineUv;
varying float vAlpha;
varying float vDrawProg;
varying float vPulsePos;
varying float vColorMix;
varying float vIsRefl;
varying vec3 vWorldPos;

void main() {
  // 未生长到达的线段裁切 + 前端明亮流光笔触头
  if (vLineUv.x > vDrawProg) discard;

  float crossProfile = exp(-pow((vLineUv.y - 0.5) * 3.4, 2.0));
  // 两端接近恒星处自然柔化衔接
  float endTaper = smoothstep(0.0, 0.06, vLineUv.x) * (1.0 - smoothstep(0.94, 1.0, vLineUv.x));
  // 连线生长前锋高光火花
  float headSpark = exp(-pow((vLineUv.x - vDrawProg) / 0.085, 2.0)) * smoothstep(0.98, 0.15, vDrawProg);
  // 沿连线滑行的能量光子波包
  float photon = exp(-pow((vLineUv.x - vPulsePos) / 0.14, 2.0));

  vec3 baseCol = mix(
    mix(uStarCool, uNebulaPrimary, 0.55),
    mix(uNebulaAccent, uStarWarm, 0.55),
    vColorMix
  );
  vec3 col = mix(baseCol, vec3(1.0, 0.99, 0.96), clamp(0.35 + 0.55 * headSpark + 0.45 * photon, 0.0, 1.0));

  float intensity = crossProfile * endTaper * vAlpha * (0.62 + 1.15 * headSpark + 0.65 * photon);

  if (vIsRefl > 0.5) {
    vec3 ray = vWorldPos - cameraPosition;
    float tWater = -cameraPosition.y / min(-1e-3, ray.y);
    vec2 waterHitXZ = cameraPosition.xz + ray.xz * max(0.0, tWater);
    float rHit = length(waterHitXZ);
    float coverProtect = smoothstep(${MEDALLION_RADIUS.toFixed(2)} * 0.85, ${ASTROLABE_OUTER_R.toFixed(2)} + 1.5, rHit);
    intensity *= 0.44 * mix(0.20, 1.0, coverProtect);
  }

  if (intensity < 0.002) discard;
  gl_FragColor = vec4(col * intensity, 1.0);
}
`;

// ============================================================================
// 6. Drop 极乐流星雨着色器（弧形天球划空彗尾 + 盐湖镜像对偶）
// ============================================================================
const METEOR_VERT = /* glsl */ `
attribute vec4 aMetP0;    // xyz: 起点, w: 0=天空本体, 1=盐湖镜像
attribute vec4 aMetP1;    // xyz: 终点, w: 弧形抬升高度
attribute vec4 aMetState; // x: 归一化进度 [0..1.35], y: 强度, z: 色调混合, w: 彗尾长度
uniform float uTime;
varying vec2 vUv;
varying float vStrength;
varying float vColorMix;
varying float vIsRefl;
varying vec3 vWorldPos;

vec3 evalMeteorCurve(vec3 p0, vec3 p1, float lift, float s) {
  float sc = clamp(s, 0.0, 1.0);
  vec3 p = mix(p0, p1, sc);
  p.y += lift * 4.0 * sc * (1.0 - sc);
  return p;
}

void main() {
  vUv = uv; // uv.x: 0=流星头部, 1=彗尾末端; uv.y: [0..1] 横向宽度
  float headS = aMetState.x;
  vStrength = aMetState.y;
  vColorMix = aMetState.z;
  vIsRefl = aMetP0.w;

  if (vStrength <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vWorldPos = vec3(0.0);
    return;
  }

  float tailSpan = aMetState.w;
  float curS = headS - uv.x * tailSpan;
  float epsS = curS - 0.025;

  vec3 pos = evalMeteorCurve(aMetP0.xyz, aMetP1.xyz, aMetP1.w, curS);
  vec3 prevPos = evalMeteorCurve(aMetP0.xyz, aMetP1.xyz, aMetP1.w, epsS);

  if (vIsRefl > 0.5) {
    pos.y = -pos.y;
    prevPos.y = -prevPos.y;
    pos.x += sin(uTime * 2.8 + pos.z * 0.4 + pos.y * 0.25) * 0.35;
    prevPos.x += sin(uTime * 2.8 + prevPos.z * 0.4 + prevPos.y * 0.25) * 0.35;
  }
  vWorldPos = pos;

  vec3 tangent = normalize(pos - prevPos + vec3(1e-4, 0.0, 0.0));
  vec3 viewDir = normalize(cameraPosition - pos);
  vec3 side = normalize(cross(viewDir, tangent) + vec3(0.0, 1e-4, 0.0));

  // 流星头部凝练锐利，中前段略宽，尾部渐细消散
  float widthEnv = mix(0.28, 0.05, pow(uv.x, 0.65));
  if (vIsRefl > 0.5) widthEnv *= 1.38;
  // 超出 [0..1] 轨迹范围的尾段平滑收零
  float validMask = step(0.0, curS) * (1.0 - smoothstep(0.96, 1.05, curS));
  widthEnv *= validMask;

  vec3 worldVert = pos + side * ((uv.y - 0.5) * 2.0 * widthEnv);
  gl_Position = projectionMatrix * viewMatrix * vec4(worldVert, 1.0);
}
`;

const METEOR_FRAG = /* glsl */ `
uniform vec3 uNebulaPrimary;
uniform vec3 uNebulaAccent;
uniform vec3 uStarWarm;
uniform vec3 uStarCool;
varying vec2 vUv;
varying float vStrength;
varying float vColorMix;
varying float vIsRefl;
varying vec3 vWorldPos;

void main() {
  float crossGlow = exp(-pow((vUv.y - 0.5) * 3.6, 2.0));
  // 头部耀眼火流星核 + 修长柔和电离余迹
  float headFlash = exp(-vUv.x * 16.0) * 1.65;
  float tailFade = pow(max(0.0, 1.0 - vUv.x), 2.15);

  vec3 tailTint = mix(
    mix(uNebulaPrimary, uStarCool, 0.45),
    mix(uNebulaAccent, uStarWarm, 0.50),
    vColorMix
  );
  vec3 col = mix(tailTint, vec3(1.0, 0.99, 0.95), clamp(exp(-vUv.x * 6.5) * 0.92, 0.0, 1.0));

  float alpha = crossGlow * (headFlash + tailFade * 0.92) * vStrength;

  if (vIsRefl > 0.5) {
    vec3 ray = vWorldPos - cameraPosition;
    float tWater = -cameraPosition.y / min(-1e-3, ray.y);
    vec2 waterHitXZ = cameraPosition.xz + ray.xz * max(0.0, tWater);
    float rHit = length(waterHitXZ);
    float coverProtect = smoothstep(${MEDALLION_RADIUS.toFixed(2)} * 0.85, ${ASTROLABE_OUTER_R.toFixed(2)} + 1.5, rHit);
    alpha *= 0.46 * mix(0.22, 1.0, coverProtect);
  }

  if (alpha < 0.002) discard;
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

// ============================================================================
// 7. 三段式星尘粒子着色器：Breakdown 反重力从盐湖升空 / Build 聚能 / Drop 巡航星流
// ============================================================================
const STARDUST_VERT = /* glsl */ `
attribute vec4 aDustSeed; // x: 径向种子, y: 角度种子, z: 高度周期种子, w: 色调与大小种子
uniform float uTime;
uniform float uPixelRatio;
uniform float uZeroGravity;
uniform float uBuildCharge;
uniform float uDropIgnite;
uniform float uSectionEnergy;
varying float vAlpha;
varying float vSeed;

void main() {
  vSeed = aDustSeed.w;
  float rBase = 2.2 + 34.0 * pow(aDustSeed.x, 0.72);
  float theta = aDustSeed.y * 6.2831853 + uTime * (0.04 + 0.22 * uBuildCharge);

  // Breakdown 反重力缓升周期（从 y=0.05 镜面脱离，缓缓飘向夜空）
  float riseRate = 0.055 + 0.065 * uZeroGravity + 0.095 * uBuildCharge + 0.14 * uDropIgnite;
  float life = fract(aDustSeed.z + uTime * riseRate);

  vec3 wp;
  wp.x = cos(theta) * rBase;
  wp.z = sin(theta) * rBase * 0.95 - 10.0;
  wp.y = 0.06 + life * (8.5 + 9.5 * uZeroGravity + 6.0 * uDropIgnite);

  // Build-up 期间微尘受引力牵引向远方星门核心汇聚
  if (uBuildCharge > 0.01) {
    vec3 archTarget = vec3(0.0, ${ARCH_CENTER_Y.toFixed(2)}, ${ARCH_Z.toFixed(2)});
    wp = mix(wp, archTarget, uBuildCharge * life * 0.58);
  }

  // 柔和横向游弋气流
  wp.x += sin(uTime * 0.85 + aDustSeed.z * 19.0) * 0.42;
  wp.z += cos(uTime * 0.72 + aDustSeed.y * 15.0) * 0.42;

  float fadeLife = smoothstep(0.0, 0.14, life) * (1.0 - smoothstep(0.76, 1.0, life));
  float twinkle = 0.62 + 0.38 * sin(uTime * (2.6 + 2.8 * aDustSeed.w) + aDustSeed.y * 30.0);
  // Breakdown 反重力段最晶莹空灵，平时轻盈点缀
  float stageGain = 0.32 + 0.72 * uZeroGravity + 0.45 * uBuildCharge + 0.52 * uDropIgnite + 0.22 * uSectionEnergy;
  vAlpha = fadeLife * twinkle * clamp(stageGain, 0.0, 1.35);

  vec4 mvPos = viewMatrix * vec4(wp, 1.0);
  float dist = max(1.5, -mvPos.z);
  gl_PointSize = clamp((24.0 + 36.0 * aDustSeed.w) * uPixelRatio / dist, 1.2, 22.0);
  gl_Position = projectionMatrix * mvPos;
}
`;

const STARDUST_FRAG = /* glsl */ `
uniform vec3 uNebulaPrimary;
uniform vec3 uNebulaAccent;
uniform vec3 uStarWarm;
uniform vec3 uStarCool;
varying float vAlpha;
varying float vSeed;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;

  float core = exp(-r * r * 7.5);
  float bokehRim = smoothstep(0.95, 0.55, r) * 0.25;
  vec3 tint = vSeed < 0.5
    ? mix(uStarCool, uNebulaPrimary, vSeed * 1.5)
    : mix(uNebulaAccent, uStarWarm, (vSeed - 0.5) * 1.6);
  vec3 col = mix(tint, vec3(1.0, 0.99, 0.95), core * 0.65);

  float a = (core + bokehRim) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

/** 构建用于星座连线与流星轨迹的分段条带几何体 (uv.x ∈ [0..1] 沿纵向, uv.y ∈ [0..1] 沿横向) */
function buildSegmentedRibbonGeometry(segments: number): THREE.BufferGeometry {
  const cols = segments + 1;
  const pos = new Float32Array(cols * 2 * 3);
  const uvs = new Float32Array(cols * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < cols; i++) {
    const u = i / segments;
    const v0 = i * 2;
    const v1 = i * 2 + 1;
    uvs[v0 * 2] = u;
    uvs[v0 * 2 + 1] = 0;
    uvs[v1 * 2] = u;
    uvs[v1 * 2 + 1] = 1;

    if (i < segments) {
      const n0 = (i + 1) * 2;
      const n1 = (i + 1) * 2 + 1;
      indices.push(v0, n0, v1, v1, n0, n1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** 为几何体填充统一的环角色顶点属性 aRingRole */
function tagGeometryRole(geo: THREE.BufferGeometry, role: number): THREE.BufferGeometry {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count).fill(role);
  geo.setAttribute('aRingRole', new THREE.BufferAttribute(arr, 1));
  return geo;
}

export class StarryScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private readonly soft: boolean;
  private readonly rig: LyricRig;
  private readonly anchors: StarAnchor[];
  private readonly arpEvents: ArpStarEvent[];
  private readonly arpTimes: Float64Array;
  private readonly lineEvents: Array<{ t: number; aIdx: number; bIdx: number; amp: number }>;
  private readonly lineTimes: Float64Array;
  private readonly meteors: MeteorEvent[];
  private readonly meteorTimes: Float64Array;
  private readonly ripples: WaterRippleEvent[];
  private readonly rippleTimes: Float64Array;
  private readonly novas: SupernovaWaveEvent[];
  private readonly novaTimes: Float64Array;

  private readonly rawKickTimes: Float64Array;
  private readonly rawKickVals: Float64Array;
  private readonly rawHatTimes: Float64Array;
  private readonly rawHatVals: Float64Array;
  private readonly chromaBuf = new Float32Array(12);

  private readonly archMidMesh: THREE.Mesh;
  private readonly archInnerMesh: THREE.Mesh;

  private readonly starStateAttr: THREE.InstancedBufferAttribute;
  private readonly lineStartAttr: THREE.InstancedBufferAttribute;
  private readonly lineEndAttr: THREE.InstancedBufferAttribute;
  private readonly lineStyleAttr: THREE.InstancedBufferAttribute;
  private readonly metP0Attr: THREE.InstancedBufferAttribute;
  private readonly metP1Attr: THREE.InstancedBufferAttribute;
  private readonly metStateAttr: THREE.InstancedBufferAttribute;

  private readonly novaVecs: THREE.Vector4[] = [];
  private readonly rippleA: THREE.Vector4[] = [];
  private readonly rippleB: THREE.Vector4[] = [];
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    const { music, palette } = init;
    this.soft = look === 'ballad';
    const seed = init.seed ?? 1;
    const tone = extractCoverTone(init);
    const coverMood = computeCoverLuminance(init.coverPixels, palette.light);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, init.aspect, 0.2, 420);
    this.scene.add(this.camera);

    // 预提取确定性星象事件与打击乐脉冲时间轴
    this.anchors = buildStarAnchors(seed);
    const ev = buildStarryEvents(music, this.anchors, seed);
    this.arpEvents = ev.arpEvents;
    this.arpTimes = ev.arpTimes;
    this.lineEvents = ev.lineEvents;
    this.lineTimes = ev.lineTimes;
    this.meteors = ev.meteors;
    this.meteorTimes = ev.meteorTimes;
    this.ripples = ev.ripples;
    this.rippleTimes = ev.rippleTimes;
    this.novas = ev.novas;
    this.novaTimes = ev.novaTimes;

    const kicks = music.a.hits.kick ?? [];
    this.rawKickTimes = Float64Array.from(kicks, h => h[0]);
    this.rawKickVals = Float64Array.from(kicks, h => h[1]);

    const hats = music.a.hits.hat ?? [];
    this.rawHatTimes = Float64Array.from(hats, h => h[0]);
    this.rawHatVals = Float64Array.from(hats, h => h[1]);

    for (let i = 0; i < MAX_SUPERNOVA_WAVES; i++) this.novaVecs.push(new THREE.Vector4(0, 0, 0, 1));
    for (let i = 0; i < MAX_RIPPLES; i++) {
      this.rippleA.push(new THREE.Vector4(0, 0, 0, 0));
      this.rippleB.push(new THREE.Vector4(0, 0, 0, 0));
    }

    // 天体色度提纯：深空底色保持纯净深邃午夜靛蓝黑，封面色彩化作通透双色发光星云与恒星色温
    const mainHue = tone.mono ? 216 : tone.mainHue;
    // 确保副星云色相与主星云拉开富有层次的天体电离双色碰撞（约 64°~78°）
    const rawDiff = ((tone.highHue - mainHue) % 360 + 540) % 360 - 180;
    const accentHue = tone.mono
      ? 262
      : Math.abs(rawDiff) < 42
        ? (mainHue + (rawDiff >= 0 ? 68 : -68) + 360) % 360
        : tone.highHue;

    const spaceZenith = linearVec3FromHsl((mainHue + 228) * 0.5, tone.mono ? 0.28 : 0.56, 0.024);
    const spaceHorizon = linearVec3FromHsl(mainHue, tone.mono ? 0.24 : 0.58, 0.078 + 0.025 * coverMood);
    const nebulaPrimary = linearVec3FromHsl(mainHue, tone.mono ? 0.24 : 0.90, 0.56);
    const nebulaAccent = linearVec3FromHsl(accentHue, tone.mono ? 0.28 : 0.88, 0.60);
    const starWarm = linearVec3FromHsl(tone.mono ? 42 : (mainHue * 0.35 + 38), tone.mono ? 0.25 : 0.62, 0.84);
    const starCool = linearVec3FromHsl(tone.mono ? 208 : (accentHue * 0.45 + 198 * 0.55), 0.72, 0.82);
    const salarDeep = linearVec3FromHsl(mainHue, tone.mono ? 0.18 : 0.48, 0.052 + 0.025 * coverMood);
    const archMetal = linearVec3FromHsl(mainHue, tone.mono ? 0.10 : 0.26, 0.14);

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
      uArchSpinA: { value: 0 },
      uArchSpinB: { value: 0 },
      uSpaceZenith: { value: spaceZenith },
      uSpaceHorizon: { value: spaceHorizon },
      uNebulaPrimary: { value: nebulaPrimary },
      uNebulaAccent: { value: nebulaAccent },
      uStarWarm: { value: starWarm },
      uStarCool: { value: starCool },
      uSalarDeep: { value: salarDeep },
      uArchMetal: { value: archMetal },
      uNovaWaves: { value: this.novaVecs },
      uRippleA: { value: this.rippleA },
      uRippleB: { value: this.rippleB },
      uChroma0: { value: new THREE.Vector4() },
      uChroma1: { value: new THREE.Vector4() },
      uChroma2: { value: new THREE.Vector4() },
    };

    // 1. 苍穹天球 (renderOrder = 0)
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(230, 48, 32),
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

    // 2. 天空之镜盐沼与水下星盘封面 (renderOrder = 1)
    const salarGeo = new THREE.CircleGeometry(176, 96);
    salarGeo.rotateX(-Math.PI / 2);
    const salarMesh = new THREE.Mesh(
      salarGeo,
      new THREE.ShaderMaterial({
        vertexShader: SALAR_VERT,
        fragmentShader: SALAR_FRAG,
        uniforms: this.uniforms,
        depthWrite: true,
        toneMapped: false,
      }),
    );
    salarMesh.frustumCulled = false;
    salarMesh.renderOrder = 1;
    this.scene.add(salarMesh);

    // 3. 神圣几何巨型星象环门 (renderOrder = 3，立于 z = ARCH_Z 水天交界处)
    const archMat = new THREE.ShaderMaterial({
      vertexShader: ARCH_VERT,
      fragmentShader: ARCH_FRAG,
      uniforms: this.uniforms,
      depthWrite: true,
      depthTest: true,
      toneMapped: false,
    });

    const archGroup = new THREE.Group();
    archGroup.position.set(0, ARCH_CENTER_Y, ARCH_Z);

    // 外主圣拱环（八角棱面管截面，硬朗神圣）
    const outerRingGeo = tagGeometryRole(new THREE.TorusGeometry(ARCH_OUTER_R, 0.42, 8, 96), 0);
    const outerRingMesh = new THREE.Mesh(outerRingGeo, archMat);
    outerRingMesh.renderOrder = 3;
    archGroup.add(outerRingMesh);

    // 两侧入水衔接双子星碑护柱（立于外环穿入水面处 x = ±10.72, y = 0）
    const pierGeo = tagGeometryRole(new THREE.CylinderGeometry(0.18, 0.56, 7.6, 6), 0);
    for (const sign of [-1, 1]) {
      const pier = new THREE.Mesh(pierGeo, archMat);
      pier.position.set(sign * 10.72, -ARCH_CENTER_Y + 3.6, 0.45);
      pier.renderOrder = 3;
      archGroup.add(pier);
    }

    // 中层旋转星度游标环
    const midRingGeo = tagGeometryRole(new THREE.TorusGeometry(ARCH_MID_R, 0.25, 8, 84), 1);
    this.archMidMesh = new THREE.Mesh(midRingGeo, archMat);
    this.archMidMesh.rotation.x = 0.14;
    this.archMidMesh.rotation.y = -0.10;
    this.archMidMesh.renderOrder = 3;
    archGroup.add(this.archMidMesh);

    // 内层反向咬合聚能星环
    const innerRingGeo = tagGeometryRole(new THREE.TorusGeometry(ARCH_INNER_R, 0.20, 8, 72), 2);
    this.archInnerMesh = new THREE.Mesh(innerRingGeo, archMat);
    this.archInnerMesh.rotation.x = -0.16;
    this.archInnerMesh.rotation.y = 0.12;
    this.archInnerMesh.renderOrder = 3;
    archGroup.add(this.archInnerMesh);

    this.scene.add(archGroup);

    // 4. 琶音星座主恒星十字/六芒衍射星芒（36 天空本体 + 36 盐湖水中倒影 = 72 实例）
    const totalStarInst = CONSTELLATION_STAR_COUNT * 2;
    const flareQuad = new THREE.PlaneGeometry(2, 2);
    const flareGeo = new THREE.InstancedBufferGeometry();
    flareGeo.index = flareQuad.index;
    flareGeo.setAttribute('position', flareQuad.getAttribute('position'));

    const starPosArr = new Float32Array(totalStarInst * 4);
    const starStateArr = new Float32Array(totalStarInst * 4);
    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < CONSTELLATION_STAR_COUNT; i++) {
        const a = this.anchors[i];
        const idx = (mirror * CONSTELLATION_STAR_COUNT + i) * 4;
        starPosArr[idx] = a.x;
        starPosArr[idx + 1] = a.y;
        starPosArr[idx + 2] = a.z;
        starPosArr[idx + 3] = mirror;

        starStateArr[idx] = 0.22;
        starStateArr[idx + 1] = a.colorMix;
        starStateArr[idx + 2] = a.baseMag;
        starStateArr[idx + 3] = (i * 0.173) % 1;
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
    flareMesh.renderOrder = 2; // 置于盐湖之后、实体星门之前，令星门金属骨架自然遮挡其后方恒星
    this.scene.add(flareMesh);

    // 5. 琶音动态生长几何星座连线（28 天空本体 + 28 盐湖倒影 = 56 实例）
    const totalLineInst = MAX_CONSTELLATION_LINES * 2;
    const lineRibbon = buildSegmentedRibbonGeometry(12);
    const lineGeo = new THREE.InstancedBufferGeometry();
    lineGeo.index = lineRibbon.index;
    lineGeo.setAttribute('position', lineRibbon.getAttribute('position'));
    lineGeo.setAttribute('uv', lineRibbon.getAttribute('uv'));

    this.lineStartAttr = new THREE.InstancedBufferAttribute(new Float32Array(totalLineInst * 4), 4);
    this.lineEndAttr = new THREE.InstancedBufferAttribute(new Float32Array(totalLineInst * 4), 4);
    this.lineStyleAttr = new THREE.InstancedBufferAttribute(new Float32Array(totalLineInst * 4), 4);
    this.lineStartAttr.setUsage(THREE.DynamicDrawUsage);
    this.lineEndAttr.setUsage(THREE.DynamicDrawUsage);
    this.lineStyleAttr.setUsage(THREE.DynamicDrawUsage);
    lineGeo.setAttribute('aLineStart', this.lineStartAttr);
    lineGeo.setAttribute('aLineEnd', this.lineEndAttr);
    lineGeo.setAttribute('aLineStyle', this.lineStyleAttr);
    lineGeo.instanceCount = totalLineInst;

    const lineMesh = new THREE.Mesh(
      lineGeo,
      new THREE.ShaderMaterial({
        vertexShader: CONSTELLATION_LINE_VERT,
        fragmentShader: CONSTELLATION_LINE_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    lineMesh.frustumCulled = false;
    lineMesh.renderOrder = 2;
    this.scene.add(lineMesh);

    // 6. Drop 极乐流星雨（18 天空本体 + 18 盐湖倒影 = 36 实例）
    const totalMeteorInst = MAX_METEORS * 2;
    const metRibbon = buildSegmentedRibbonGeometry(16);
    const metGeo = new THREE.InstancedBufferGeometry();
    metGeo.index = metRibbon.index;
    metGeo.setAttribute('position', metRibbon.getAttribute('position'));
    metGeo.setAttribute('uv', metRibbon.getAttribute('uv'));

    this.metP0Attr = new THREE.InstancedBufferAttribute(new Float32Array(totalMeteorInst * 4), 4);
    this.metP1Attr = new THREE.InstancedBufferAttribute(new Float32Array(totalMeteorInst * 4), 4);
    this.metStateAttr = new THREE.InstancedBufferAttribute(new Float32Array(totalMeteorInst * 4), 4);
    this.metP0Attr.setUsage(THREE.DynamicDrawUsage);
    this.metP1Attr.setUsage(THREE.DynamicDrawUsage);
    this.metStateAttr.setUsage(THREE.DynamicDrawUsage);
    metGeo.setAttribute('aMetP0', this.metP0Attr);
    metGeo.setAttribute('aMetP1', this.metP1Attr);
    metGeo.setAttribute('aMetState', this.metStateAttr);
    metGeo.instanceCount = totalMeteorInst;

    const meteorMesh = new THREE.Mesh(
      metGeo,
      new THREE.ShaderMaterial({
        vertexShader: METEOR_VERT,
        fragmentShader: METEOR_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    meteorMesh.frustumCulled = false;
    meteorMesh.renderOrder = 2;
    this.scene.add(meteorMesh);

    // 7. Breakdown 反重力荧光星尘粒子（2600 颗）
    const dustCount = 2600;
    const dustGeo = new THREE.BufferGeometry();
    const dustDummyPos = new Float32Array(dustCount * 3);
    const dustSeeds = new Float32Array(dustCount * 4);
    const random = rng((seed ^ 0x91e42a6b) >>> 0);
    for (let i = 0; i < dustCount; i++) {
      dustSeeds[i * 4] = random();
      dustSeeds[i * 4 + 1] = random();
      dustSeeds[i * 4 + 2] = random();
      dustSeeds[i * 4 + 3] = random();
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustDummyPos, 3));
    dustGeo.setAttribute('aDustSeed', new THREE.BufferAttribute(dustSeeds, 4));

    const dustPoints = new THREE.Points(
      dustGeo,
      new THREE.ShaderMaterial({
        vertexShader: STARDUST_VERT,
        fragmentShader: STARDUST_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      }),
    );
    dustPoints.frustumCulled = false;
    dustPoints.renderOrder = 4;
    this.scene.add(dustPoints);

    // 8. 3D 底部字幕排版：精致低位展示，不遮挡水下星盘封面与远方星门
    const lyricPalette: Palette = {
      ...palette,
      ink: colorFromHsl(mainHue, tone.mono ? 0.08 : 0.48, 0.05),
      paper: new THREE.Color('#f8fbff'),
      signal: colorFromHsl(accentHue, tone.mono ? 0.20 : 0.90, 0.76),
      light: false,
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

  /** 带 25ms 柔顺起音阻尼的纯函数瞬态脉冲求值 */
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

  /** 四组电影级运镜机位（mirror / glide / astrolabe / zenith）的纯函数姿态求值，保持正面半球以令水下星盘封面始终端正 */
  private evalCameraPose(t: number, s: Shot, buildCharge: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const start = s.run?.start ?? s.start;
    const end = s.run?.end ?? s.end;
    const span = Math.max(0.8, end - start);
    const k = clamp01((t - start) / span);
    const e = inOutCubic(k);
    const dir = (stableShotSeed(s) & 1) === 0 ? 1 : -1;
    const variant = s.variant || 'mirror';

    if (variant === 'glide') {
      // 贴水巡航：沿晶莹镜面盐湖向远方神圣星象环门匀速滑翔，诠释 Trance 138 BPM 催眠推进感
      const x = lerp(-1.8 * dir, 1.8 * dir, e);
      const z = lerp(16.2, 9.6, e) + 0.8 * buildCharge;
      const y = 1.85 + 0.12 * Math.sin(t * 0.28);
      poseLookAt(pos, quat, x, y, z, x * 0.25, 3.6 + 0.2 * Math.sin(t * 0.22), -24.0);
    } else if (variant === 'astrolabe') {
      // 星盘俯掠：斜高机位环绕水下发光星盘封面与十二宫刻度，缓缓抬头收纳远方星门与银河倒影
      const theta = lerp(-0.38 * dir, 0.38 * dir, e);
      const rad = lerp(12.6, 10.8, e);
      const y = lerp(7.6, 5.4, e);
      poseLookAt(pos, quat, Math.sin(theta) * rad, y, Math.cos(theta) * rad, 0, lerp(0.6, 2.2, e), lerp(-1.2, -10.5, e));
    } else if (variant === 'zenith') {
      // 苍穹星旋：低机位仰望跨天银河拱桥、密集生长的琶音星座网、神圣星门与划破长空的流星雨
      const theta = lerp(-0.24 * dir, 0.24 * dir, e);
      const rad = lerp(12.4, 10.6, e);
      const y = 1.48 + 0.10 * Math.sin(t * 0.24);
      poseLookAt(pos, quat, Math.sin(theta) * rad, y, Math.cos(theta) * rad, Math.sin(theta) * 1.2, 7.6 + 0.8 * e, -26.0);
    } else {
      // mirror（镜湖主景，默认黄金构图）：兼顾前景水下星盘封面、天空之镜对称倒影、地平线星门与苍穹银河
      const theta = lerp(-0.22 * dir, 0.22 * dir, e);
      const rad = lerp(14.2, 12.6, e) + 0.9 * buildCharge;
      const y = 2.68 + 0.14 * Math.sin(t * 0.25);
      poseLookAt(pos, quat, Math.sin(theta) * rad, y, Math.cos(theta) * rad, 0, 3.35 + 0.15 * Math.sin(t * 0.2), -18.0);
    }
  }

  /** 同场景跨切点相机平滑过渡（1.45s），消除镜湖多机位切换时的视角跳变 */
  private updateCamera(t: number, shot: Shot, buildCharge: number): void {
    blendCameraPose(
      (tau, s, pos, quat) => this.evalCameraPose(tau, s, buildCharge, pos, quat),
      t,
      shot,
      this.camera,
      1.45,
    );
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, fx } = ctx;
    const beat = music.at(t);
    const curSec = music.section(t);
    const label = curSec?.label ?? shot.section.label;
    const secDur = Math.max(0.5, (curSec?.end ?? shot.end) - (curSec?.start ?? shot.start));
    const secProg = clamp01((t - (curSec?.start ?? shot.start)) / secDur);

    // 三段式星象叙事核心状态量（纯时间函数计算，任意 seek 严格一致）
    // 1) Breakdown 反重力失重度
    let zeroGravity = 0;
    if (label === 'break' || label === 'bridge') {
      zeroGravity = smooth(Math.min(1, (t - curSec.start) / 0.8)) * smooth(Math.min(1, (curSec.end - t) / 0.8));
    } else if (label === 'intro' || label === 'outro') {
      zeroGravity = 0.55;
    }

    // 2) Build-up 星轨旋转聚能度（随段落推进由 0 平滑爬升至 1，衔接 Drop 释放）
    let buildCharge = 0;
    if (label === 'build' || label === 'pre') {
      buildCharge = Math.pow(secProg, 0.82) * smooth(Math.min(1, (curSec.end - t) / 0.08));
    }

    // 3) Drop 极乐爆发在场度
    const dropIgnite = label === 'drop'
      ? Math.max(music.dropIntensity(t), 0.92 * smooth(Math.min(1, (t - curSec.start) / 0.15)))
      : label === 'chorus' && (curSec?.energy ?? 0) >= 0.78
        ? 0.52 * smooth(Math.min(1, (t - curSec.start) / 0.35))
        : 0;

    this.updateCamera(t, shot, buildCharge);

    const kickPulse = this.evalPulse(this.rawKickTimes, this.rawKickVals, t, 0.22);
    const hatPulse = this.evalPulse(this.rawHatTimes, this.rawHatVals, t, 0.14);
    const highEnv = music.env('high', t);
    const hatSparkle = clamp01(hatPulse * 0.82 + highEnv * 0.42);

    const secDrive = label === 'drop' ? 1.0
      : label === 'chorus' ? 0.86
      : label === 'build' || label === 'pre' ? 0.45 + 0.50 * secProg
      : label === 'break' || label === 'bridge' ? 0.30
      : 0.46;
    const energy = clamp01(secDrive * 0.65 + (curSec?.energy ?? shot.section.energy) * 0.35);

    // 1. 更新 12 半音色度向量（驱动水下星盘 12 宫宝石槽）
    music.chromaAt(t, this.chromaBuf);
    let maxC = 0.001;
    for (let k = 0; k < 12; k++) if (this.chromaBuf[k] > maxC) maxC = this.chromaBuf[k];
    const normChroma = (k: number) => clamp01((this.chromaBuf[k] / maxC) * (0.32 + 0.68 * this.chromaBuf[k]));

    // 2. 更新远景神圣星象环门双内环咬合旋转（纯时间函数）
    const spinA = t * 0.14 + beat.pos * 0.045 + buildCharge * 1.65;
    const spinB = -t * 0.19 - beat.pos * 0.055 - buildCharge * 2.10;
    this.archMidMesh.rotation.z = spinA;
    this.archInnerMesh.rotation.z = spinB;

    // 3. 更新 36 颗天球星座恒星闪耀状态（同步写入天空本体与盐湖镜像实例）
    const starGlow = new Float32Array(CONSTELLATION_STAR_COUNT);
    for (let i = 0; i < CONSTELLATION_STAR_COUNT; i++) {
      const a = this.anchors[i];
      const idleTwinkle = 0.16 + 0.08 * Math.sin(t * (1.5 + a.baseMag) + i * 2.1);
      starGlow[i] = idleTwinkle * a.baseMag;
    }

    for (let i = lastIndex(this.arpTimes, t); i >= 0; i--) {
      const ev = this.arpEvents[i];
      const age = t - ev.t;
      if (age < 0) continue;
      if (age > 2.4) break;
      const env = age < 0.028 ? smooth(age / 0.028) : Math.exp(-(age - 0.028) / 0.68);
      const flare = ev.amp * env;
      if (starGlow[ev.starIdx] < 0.22 + flare) {
        starGlow[ev.starIdx] = 0.22 + flare;
      }
    }

    const starArr = this.starStateAttr.array as Float32Array;
    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < CONSTELLATION_STAR_COUNT; i++) {
        const idx = (mirror * CONSTELLATION_STAR_COUNT + i) * 4;
        starArr[idx] = starGlow[i];
      }
    }
    this.starStateAttr.needsUpdate = true;

    // 4. 更新动态生长几何星座连线（最多 28 条活跃连线 × 2 本体/镜像）
    const startArr = this.lineStartAttr.array as Float32Array;
    const endArr = this.lineEndAttr.array as Float32Array;
    const styleArr = this.lineStyleAttr.array as Float32Array;
    const LINE_LIFE = 2.85;
    const LINE_GROW = 0.16;

    let activeLines = 0;
    const usedPairs = new Set<number>();
    for (let i = lastIndex(this.lineTimes, t); i >= 0 && activeLines < MAX_CONSTELLATION_LINES; i--) {
      const le = this.lineEvents[i];
      const age = t - le.t;
      if (age < 0) continue;
      if (age > LINE_LIFE) break;

      const pairKey = le.aIdx < le.bIdx ? le.aIdx * 64 + le.bIdx : le.bIdx * 64 + le.aIdx;
      if (usedPairs.has(pairKey)) continue;
      usedPairs.add(pairKey);

      const p0 = this.anchors[le.aIdx];
      const p1 = this.anchors[le.bIdx];
      const drawProg = clamp01(age / LINE_GROW);
      const fade = age < LINE_GROW ? 1.0 : Math.exp(-(age - LINE_GROW) / 1.15);
      const alpha = le.amp * fade * (1.0 - 0.3 * buildCharge);
      if (alpha < 0.02) continue;

      const pulsePos = (age * 1.35) % 1.25;
      const colorMix = 0.5 * (p0.colorMix + p1.colorMix);

      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * MAX_CONSTELLATION_LINES + activeLines) * 4;
        startArr[slot] = p0.x;
        startArr[slot + 1] = p0.y;
        startArr[slot + 2] = p0.z;
        startArr[slot + 3] = mirror;

        endArr[slot] = p1.x;
        endArr[slot + 1] = p1.y;
        endArr[slot + 2] = p1.z;
        endArr[slot + 3] = inOutCubic(drawProg);

        styleArr[slot] = alpha;
        styleArr[slot + 1] = pulsePos;
        styleArr[slot + 2] = colorMix;
        styleArr[slot + 3] = le.amp;
      }
      activeLines++;
    }

    for (let s = activeLines; s < MAX_CONSTELLATION_LINES; s++) {
      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * MAX_CONSTELLATION_LINES + s) * 4;
        styleArr[slot] = 0;
      }
    }
    this.lineStartAttr.needsUpdate = true;
    this.lineEndAttr.needsUpdate = true;
    this.lineStyleAttr.needsUpdate = true;

    // 5. 更新划破天际的极乐流星雨（最多 18 道并发 × 2 本体/镜像）
    const mp0 = this.metP0Attr.array as Float32Array;
    const mp1 = this.metP1Attr.array as Float32Array;
    const mSt = this.metStateAttr.array as Float32Array;
    let activeMeteors = 0;

    for (let i = lastIndex(this.meteorTimes, t); i >= 0 && activeMeteors < MAX_METEORS; i--) {
      const m = this.meteors[i];
      const age = t - m.t;
      if (age < 0) continue;
      if (age > 1.85) break;
      const normAge = age / m.dur;
      const tailSpan = 0.48;
      if (normAge > 1.0 + tailSpan) continue;

      const env = smooth(Math.min(1, normAge / 0.08)) * (1.0 - smooth((normAge - 0.88) / (0.12 + tailSpan)));
      const strength = m.amp * env;
      if (strength < 0.02) continue;

      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * MAX_METEORS + activeMeteors) * 4;
        mp0[slot] = m.x0;
        mp0[slot + 1] = m.y0;
        mp0[slot + 2] = m.z0;
        mp0[slot + 3] = mirror;

        mp1[slot] = m.x1;
        mp1[slot + 1] = m.y1;
        mp1[slot + 2] = m.z1;
        mp1[slot + 3] = m.arcLift;

        mSt[slot] = normAge;
        mSt[slot + 1] = strength;
        mSt[slot + 2] = m.colorMix;
        mSt[slot + 3] = tailSpan;
      }
      activeMeteors++;
    }

    for (let s = activeMeteors; s < MAX_METEORS; s++) {
      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * MAX_METEORS + s) * 4;
        mSt[slot] = 0;
        mSt[slot + 1] = 0;
      }
    }
    this.metP0Attr.needsUpdate = true;
    this.metP1Attr.needsUpdate = true;
    this.metStateAttr.needsUpdate = true;

    // 6. 填充活跃超新星苍穹冲击环与盐湖水面涟漪
    let nCount = 0;
    for (let i = lastIndex(this.novaTimes, t); i >= 0 && nCount < MAX_SUPERNOVA_WAVES; i--) {
      const nv = this.novas[i];
      const age = t - nv.t;
      if (age < 0) continue;
      if (age > 3.6) break;
      this.novaVecs[nCount].set(age, nv.strength, nv.speed, nv.tau);
      nCount++;
    }
    for (let i = nCount; i < MAX_SUPERNOVA_WAVES; i++) {
      this.novaVecs[i].set(0, 0, 0, 1);
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

    // 7. 同步全局着色器 Uniforms
    const u = this.uniforms;
    u.uTime.value = t;
    u.uFlow.value = t * 0.78 + music.foregroundMotion(t, 0.25) * 0.20;
    u.uSectionEnergy.value = energy;
    u.uBuildCharge.value = buildCharge;
    u.uDropIgnite.value = dropIgnite;
    u.uZeroGravity.value = zeroGravity;
    u.uKickPunch.value = clamp01(kickPulse);
    u.uHatSparkle.value = hatSparkle;
    u.uArchSpinA.value = spinA;
    u.uArchSpinB.value = spinB;
    (u.uChroma0.value as THREE.Vector4).set(normChroma(0), normChroma(1), normChroma(2), normChroma(3));
    (u.uChroma1.value as THREE.Vector4).set(normChroma(4), normChroma(5), normChroma(6), normChroma(7));
    (u.uChroma2.value as THREE.Vector4).set(normChroma(8), normChroma(9), normChroma(10), normChroma(11));

    // 8. 后期效果调优：全画幅 16:9 完整展现水下星盘封面与底部字幕，屏蔽负片、双色洗白与粗暴故障闪烁
    fx.letterbox = 0;
    fx.invert = 0;
    fx.duotone = 0;
    fx.glitch = Math.min(fx.glitch, 0.05);
    fx.zoom = Math.min(fx.zoom, 0.04 + 0.04 * dropIgnite);
    fx.bloom = (this.soft ? 0.30 : 0.28) + 0.10 * dropIgnite + 0.05 * buildCharge;
    fx.vignette = 0.44;
    fx.grain = 0.032;

    // 9. 更新底部歌词排版
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy * 0.75);
  }
}
