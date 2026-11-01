// Phoenix Stage (涅槃舞台 / 烈焰火凤): Crafted for Drop sections inspired by ILLENIUM - Awake ("Beautiful Creatures").
// Features:
// 1. Grand dark industrial/temple stage with central backlit portal, dark altar monolith (with glowing Braille dots),
//    realistic meditating foreground human silhouette, and rough wet concrete stage floor with perspective slab seams.
// 2. Two colossal monolith speakers flanking the left and right sides of the stage, with blazing golden-orange circular
//    cones, interior ember mesh, bottom stage floodlights, physical bass camera vibration, and realistic 3D schlieren
//    air-pressure refraction shockwaves (heat-haze optical distortion & subtle vapor compression) that rush forward
//    toward the camera.
// 3. A majestic, luminous V-winged fire phoenix hovering and gliding with slow, weighty, regal wingbeats in the upper
//    frame, with blinding white-gold & orange-gold flames engulfing its lower wing feathers, wingtips, tail, and crown,
//    transforming in distribution, size, brightness, and turbulence with the Drop groove and Lead melody.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex, type Music } from '../director/music.ts';
import type { Palette } from '../render/palette.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl, tuneCoverStop } from './coverTone.ts';
import { buildLeadColorTrack, extractLeadColorGroups, sampleTrack, type LeadColorTrack } from './phoenixLeadColor.ts';
import type { LyricTrack } from '../director/lyrics.ts';

/** Maximum concurrent 3D schlieren refractive acoustic shockwaves emitted by the dual giant speakers. */
const MAX_SOUND_WAVES = 6;
/** Screen-space stage floor horizon line: bottom 36% is the 3D wet concrete stage floor, top 64% is the grand stage & sky. */
const STAGE_HORIZON_Y = 0.36;
/** Camera vertical FOV (degrees) and pitch (radians) locking the 3D stage floor horizon (y=0) to vUv.y = STAGE_HORIZON_Y. */
const CAM_FOV = 50;
const HORIZON_PITCH = Math.atan((1 - 2 * STAGE_HORIZON_Y) * Math.tan(THREE.MathUtils.degToRad(CAM_FOV * 0.5)));

interface SoundWaveEvent {
  /** Onset timestamp (seconds). */
  t: number;
  /** Acoustic shockwave strength (0..1.35). */
  strength: number;
  /** Maximum 3D forward travel scale. */
  maxRadius: number;
  /** 3D forward travel duration from speaker plane (z=0) past camera plane (z=1) in seconds. */
  tau: number;
  /** Subtle turbulence modulation frequency. */
  freq: number;
  /** Emission balance: 0 = symmetric dual-speaker blast, -1 = left-led stereo wave, +1 = right-led stereo wave. */
  stereoBias: number;
}

/**
 * Extracts deterministic Drop-reactive 3D acoustic shockwave events from kicks, snares, bass/synth stabs,
 * foreground melodic onsets, and Drop downbeats.
 * 智能声部聚类与仲裁：
 * 绝不因鼓点先到就丢弃同拍或紧邻（0.16s 内）更强的 Lead 起音；
 * 当鼓点与 Lead 重叠时生成多声部复合音波（Hybrid Shockwave），叠加冲击共振并保留 Lead 的高频颗粒与音高频率；
 * 纯 Lead 起音完整保留独立音波。
 */
function buildSoundWaves(music: Music, seed: number): SoundWaveEvent[] {
  const random = rng((seed ^ 0xfa1e7071) >>> 0);
  const out: SoundWaveEvent[] = [];

  const kicks = music.a.hits.kick ?? [];
  const snares = music.a.hits.snare ?? [];
  const bassStabs = music.roleHits('bassStab', 0, music.duration);
  const synthStabs = music.roleHits('synthStab', 0, music.duration);
  const leadHits = music.roleHits('lead', 0, music.duration);
  const fgHits = music.highlightHits(0, music.duration);

  const leadWeight = (t: number) => 0.60 + 0.40 * music.leadOwnership(t);
  const rawCandidates: Array<{ t: number; s: number; kind: 'kick' | 'snare' | 'melodic' | 'lead' }> = [
    ...kicks.filter(h => h[1] > 0.20).map(([t, s]) => ({ t, s: s * 1.15, kind: 'kick' as const })),
    ...snares.filter(h => h[1] > 0.22).map(([t, s]) => ({ t, s: s * 1.05, kind: 'snare' as const })),
    ...bassStabs.filter(h => h[1] > 0.22).map(([t, s]) => ({ t, s: s * 1.08, kind: 'kick' as const })),
    ...synthStabs.filter(h => h[1] > 0.24).map(([t, s]) => ({ t, s: s * 1.00, kind: 'melodic' as const })),
    ...leadHits.filter(h => h[1] > 0.20).map(([t, s]) => ({ t, s: s * 1.25 * leadWeight(t), kind: 'lead' as const })),
    ...fgHits.filter(h => h[1] > 0.26).map(([t, s]) => ({ t, s: s * 0.98, kind: 'melodic' as const })),
  ].sort((a, b) => a.t - b.t);

  // 聚类聚合相近起音（在 0.12s 窗口内的事件进行多声部合并，杜绝鼓点吞掉 Lead）
  const clusters: Array<Array<{ t: number; s: number; kind: 'kick' | 'snare' | 'melodic' | 'lead' }>> = [];
  for (const c of rawCandidates) {
    const lastCluster = clusters[clusters.length - 1];
    if (lastCluster && c.t - lastCluster[0].t < 0.12) {
      lastCluster.push(c);
    } else {
      clusters.push([c]);
    }
  }

  let lastT = -Infinity;
  let seq = 0;

  for (const cluster of clusters) {
    // 找出聚类中最强的鼓点事件与最强的 Lead/Melodic 事件
    const kickEvents = cluster.filter(x => x.kind === 'kick' || x.kind === 'snare');
    const leadEvents = cluster.filter(x => x.kind === 'lead' || x.kind === 'melodic');

    const maxKick = kickEvents.reduce((m, x) => (x.s > m.s ? x : m), kickEvents[0]);
    const maxLead = leadEvents.reduce((m, x) => (x.s > m.s ? x : m), leadEvents[0]);

    // 仲裁中心时间点与强度
    let mainT = cluster[0].t;
    let mainStrength = cluster[0].s;
    let isLeadDom = false;

    if (maxKick && maxLead) {
      // 鼓点与 Lead 同拍或紧邻：复合共振，强度由两者叠加决定，绝不吞掉 Lead！
      mainStrength = Math.max(maxKick.s, maxLead.s) + Math.min(maxKick.s, maxLead.s) * 0.40;
      isLeadDom = maxLead.s >= maxKick.s * 0.85;
      mainT = isLeadDom ? maxLead.t : maxKick.t;
    } else if (maxLead) {
      mainStrength = maxLead.s;
      mainT = maxLead.t;
      isLeadDom = true;
    } else if (maxKick) {
      mainStrength = maxKick.s;
      mainT = maxKick.t;
      isLeadDom = false;
    }

    const sec = music.section(Math.min(mainT, Math.max(0, music.duration - 0.01)));
    const isDrop = sec?.label === 'drop';
    const isChorus = sec?.label === 'chorus';
    const isBuild = sec?.label === 'build' || sec?.label === 'pre';

    const minGap = isDrop ? (isLeadDom ? 0.14 : 0.18) : isChorus ? (isLeadDom ? 0.22 : 0.28) : 0.40;
    if (mainT - lastT < minGap) continue;
    if (!isDrop && !isChorus && !isBuild && mainStrength < 0.45) continue;

    const pitch = music.pitchAt(mainT);
    const effStrength = Math.min(1.45, mainStrength * (isDrop ? (isLeadDom ? 1.30 : 1.20) : isChorus ? 0.90 : 0.70));
    const maxRadius = (0.42 + 0.18 * Math.min(1, effStrength)) * (isDrop ? 1.15 : 0.90);
    // Lead 音波推进更快、更利落，贴合旋律起音的颗粒感
    const tau = isLeadDom
      ? (isDrop ? 0.72 + 0.10 * random() : 0.88 + 0.14 * random())
      : (isDrop ? 0.88 + 0.16 * random() : 1.05 + 0.20 * random());
    const freq = isLeadDom ? (7.0 + (pitch.note % 5) * 2.0) : (5.0 + (pitch.note % 3) * 2.0);
    const stereoBias = !isLeadDom || effStrength > 0.95 ? 0.0 : ((seq % 3) - 1) * 0.22;
    seq++;

    out.push({ t: mainT, strength: effStrength, maxRadius, tau, freq, stereoBias });
    lastT = mainT;
  }

  // Ensure every beat inside a Drop emits a crisp 3D refractive air-pressure shockwave
  for (let i = 0; i < music.beats.length; i++) {
    const bt = music.beats[i];
    const sec = music.section(Math.min(bt, Math.max(0, music.duration - 0.01)));
    if (sec?.label !== 'drop') continue;
    if (out.some(w => Math.abs(w.t - bt) < 0.14)) continue;
    const isDown = music.downbeats.some(d => Math.abs(d - bt) < 0.05);
    out.push({
      t: bt,
      strength: isDown ? 1.25 : 0.92,
      maxRadius: isDown ? 0.58 : 0.46,
      tau: isDown ? 0.88 : 0.80,
      freq: isDown ? 5.0 : 7.0,
      stereoBias: 0.0,
    });
  }

  return out.sort((a, b) => a.t - b.t);
}

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

/**
 * 涅槃舞台三层共享通用头（uniforms + 轻量噪声 + 双 Lead 色彩映射 + 声压热浪折射场）。
 * 将原本 2,170 行的巨型单一片元着色器按互不遮挡的空间层次拆分为 3 个独立轻量片元程序：
 * 1) FLOOR_FRAG：地面湿润混凝土、水面反射与冥想人像（下半屏 vUv.y < 0.36）
 * 2) STAGE_FRAG：上半屏舞台巨幕、双巨型音箱与体积烟雾背景（上半屏 vUv.y >= 0.36）
 * 3) PHOENIX_OVERLAY_FRAG：涅槃火凤、前景薄雾面纱与中央祭坛（上半屏预乘 Alpha 叠加，数学 100% 恒等）
 */
const PHOENIX_COMMON = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uCover;
uniform float uTime;
uniform float uFlow;
uniform float uAspect;
// 运行时恒为 0 的动态循环屏障，阻止 D3D11 HLSL fxc 对多层噪声与羽毛循环做指数级静态展开
uniform int uZero;

// Stage & Speaker uniforms
uniform vec2 uLeftSpeaker;      // Left giant speaker ring center in screen UV
uniform vec2 uRightSpeaker;     // Right giant speaker ring center in screen UV
uniform float uSpeakerPulse;    // Speaker cone excursion & ring glow pulse (0..1.4)
uniform float uSpeakerBass;     // Low-frequency speaker diaphragm vibration & camera tremor
uniform float uPortalGlow;      // Central stage backlight portal intensity
uniform float uCamShift;        // Horizontal camera parallax shift
uniform float uCamLift;         // Vertical camera parallax shift

// Phoenix flight & wing-flapping uniforms
uniform vec2 uPhoenixPos;       // Hovering/soaring phoenix center in screen UV
uniform float uPhoenixScale;    // Dynamic scale of the soaring phoenix
uniform float uPhoenixRoll;     // Banking roll angle (radians) as the phoenix glides
uniform float uPhoenixYaw;      // Subtle horizontal turning perspective skew (-1..1)
uniform float uWingPhase;       // Slow, weighty wing-flapping phase (radians)
uniform float uWingAmp;         // Wing flap stroke amplitude
uniform float uWingDownstroke;  // 0..1 power-downstroke impulse on downbeats

// Phoenix Drop-reactive fire uniforms (Distribution, Size, Brightness, Turbulence)
uniform float uFireDistribution;// 0..1.55: how far flames spread across full wings, wingtips, crown & tail
uniform float uFireSize;        // 0.65..2.30: flame tongue height, trailing plume length, and fire aura reach
uniform float uFireBrightness;  // 0.70..2.45: HDR flame radiance, white-hot core incandescence, and stage illumination
uniform float uFireTurbulence;  // 0.70..2.20: flame upward churn speed and ember eruption intensity

// Musical groove uniforms
uniform float uDropIntensity;   // 0..1 smooth Drop envelope
uniform float uGroovePulse;     // Combined Drop rhythm/groove pulse
uniform float uLeadLevel;       // Continuous melodic Lead level
uniform float uLeadAttack;      // Melodic Lead attack transient
uniform float uHighEnv;         // High-frequency spectral energy (sparks & braille shimmer)

// Cover-adapted linear color palette
uniform vec3 uStageDark;        // Deep charcoal/obsidian stage background
uniform vec3 uSmokeWarm;        // Warm illuminated volumetric smoke tint
uniform vec3 uFireDeep;         // Deep crimson-amber outer flame & speaker halo
uniform vec3 uFireMid;          // Blazing orange-gold primary flame & speaker ring
uniform vec3 uFireBright;       // Brilliant yellow-gold inner flame & shockwave crest
uniform vec3 uFireCore;         // Incandescent white-gold core

// Active 3D advancing schlieren shockwaves:
// uSoundWaveA: (age, strength, maxRadius, tau)
// uSoundWaveB: (freq, stereoBias, 0, 0)
uniform vec4 uSoundWaveA[${MAX_SOUND_WAVES}];
uniform vec4 uSoundWaveB[${MAX_SOUND_WAVES}];

// 双 Lead 代表色体系（均取自专辑封面聚类色）：
// uLeadA = 明亮主奏 Lead 代表色，uLeadB = 温暖和声/键盘 Lead 代表色，各为 deep / mid / bright / core 四级色阶
uniform vec3 uLeadA[4];
uniform vec3 uLeadB[4];
uniform float uLeadShareB;      // B 组代表色在发光区域中的面积占比（主导 Lead 的代表色占比更高）
uniform float uColorFusion;     // 人声驱动的两组代表色融合程度（无人声时严格为 0）
uniform float uLeadGlow;        // 当前主导 Lead 的持续能量
uniform float uLeadPulse;       // Lead 主音色起音脉冲（驱动光环外扩与音波）
uniform float uLightPulse;      // 随 Drop 律动呼吸的整体光强系数

// ── Procedural Hash & Multi-Scale Noise Functions ─────────────────────────────
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

const mat2 ROT_OCT = mat2(0.80, -0.60, 0.60, 0.80);

/** 统一 4 八度普通/火焰脊线噪声，配合单入口调用消除重复内联与 4 倍静态展开 */
float sampleOctave4(vec2 p, bool isFire) {
  float v = 0.0;
  float a = isFire ? 0.52 : 0.5;
  float scale = isFire ? 2.08 : 2.04;
  vec2 shift = isFire ? vec2(19.1, 7.3) : vec2(13.7, 29.3);
  float decay = isFire ? 0.48 : 0.5;
  for (int i = uZero; i < 4; i++) {
    float n = noise2(p);
    if (isFire) {
      float ridge = 1.0 - abs(n * 2.0 - 1.0);
      v += a * mix(n, ridge * ridge, 0.58);
    } else {
      v += a * n;
    }
    p = ROT_OCT * p * scale + shift;
    a *= decay;
  }
  return v;
}

float fbm(vec2 p) { return sampleOctave4(p, false); }
float fireNoise(vec2 p) { return sampleOctave4(p, true); }

vec2 rot2D(vec2 p, float ang) {
  float c = cos(ang), s = sin(ang);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec2 sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-5), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
  return -smin(-a, -b, k);
}

// ── 双 Lead 代表色分布与人声融合 ───────────────────────────────────────────────
vec3 rampStops(vec3 c0, vec3 c1, vec3 c2, vec3 c3, float h) {
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.34, h));
  c = mix(c, c2, smoothstep(0.30, 0.66, h));
  return mix(c, c3, smoothstep(0.64, 0.97, h));
}

float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/**
 * 该位置属于 B 组代表色的权重 (0..1)。
 * 以缓慢漂移的大尺度分形场把发光与反射区域划分为 A / B 两组代表色；
 * 始终保持连续平滑的渐变过渡（消除生硬线条分割），保证两组代表色之间自然羽化；
 * 有人声时过渡带宽随 uColorFusion 进一步展开交融。
 */
float leadGroupWeightB(vec2 p, float seed) {
  float n = fbm(p + vec2(seed * 7.31, seed * 3.17) + vec2(uTime * 0.04, -uTime * 0.028));
  // 平滑的连续 rank 映射，避免陡峭阶跃造成线条切痕
  float rank = smoothstep(0.20, 0.80, n);
  // 保留充足的平滑渐变带宽 (0.18 .. 0.45)，确保不同颜色交界处始终柔和连续
  float band = mix(0.18, 0.45, uColorFusion);
  return 1.0 - smoothstep(uLeadShareB - band, uLeadShareB + band, rank);
}

/**
 * 按热度 (0 = 暗部外焰, 1 = 炽亮内核) 与所属色组返回发光颜色。
 * 空间分布严格保持连续平滑渐变（杜绝二值化硬切与线条分割）；
 * 有人声介入时进一步加深高光互融与泛光交融。
 */
vec3 leadColor(float heat, float wB) {
  float s0 = smoothstep(0.0, 0.34, heat);
  float s1 = smoothstep(0.30, 0.66, heat);
  float s2 = smoothstep(0.64, 0.97, heat);
  vec3 a = mix(mix(mix(uLeadA[0], uLeadA[1], s0), uLeadA[2], s1), uLeadA[3], s2);
  vec3 b = mix(mix(mix(uLeadB[0], uLeadB[1], s0), uLeadB[2], s1), uLeadB[3], s2);
  vec3 separated = mix(a, b, wB);
  vec3 blend = mix(a, b, 0.5);
  float lt = lumaOf(blend);
  blend = max(vec3(0.0), vec3(lt) + (blend - vec3(lt)) * 1.20);
  float fuseW = step(0.001, uColorFusion) * uColorFusion * 0.75;
  return mix(separated, blend, fuseW);
}

/**
 * 漫射环境光（烟雾、地面等大面积受光）。
 * 空间平滑过渡，主导 Lead 占主导地位，伴有柔和渐变。
 */
vec3 leadAmbient(float heat) {
  float fuseW = step(0.001, uColorFusion) * uColorFusion * 0.65;
  float w = mix(smoothstep(0.35, 0.65, uLeadShareB), 0.5, fuseW);
  return rampStops(
    mix(uLeadA[0], uLeadB[0], w),
    mix(uLeadA[1], uLeadB[1], w),
    mix(uLeadA[2], uLeadB[2], w),
    mix(uLeadA[3], uLeadB[3], w),
    heat
  );
}

// ── 0. Realistic 3D Acoustic Schlieren Refraction, Heat-Haze & Bass Vibration ─
/**
 * Computes the physical optical refraction, thermal heat-haze blur, and bass vibration field.
 *
 * Key Realism Principles:
 *   - NO cartoony solid-color soundwave rings!
 *   - NO sharp boundaries or creases (彻底消除音波折痕与明显边界，大幅模糊柔化)!
 *   - Uses an ultra-wide, deeply blurred C2-smooth Gaussian pressure cushion (wWidth = 0.062..0.172)
 *     broken up by organic billowing fire heat-haze eddies so the distortion flows seamlessly
 *     like real hot air convection (火的热气造成的画面扭曲) without ever kinking lines into folds.
 *
 * Returns:
 *   .xy = Smooth, crease-free 2D UV refraction & bass vibration displacement vector
 *   .z  = Wide-blurred heat-haze & acoustic optical blur/shimmer strength (0..1.2)
 *   .w  = Physical camera bass tremor strength
 */
vec4 evaluateAcousticAndHeatRefraction(vec2 uv) {
  vec2 totalOffset = vec2(0.0);
  float softBlurField = 0.0;

  // 1. Physical Bass Camera Tremor & Acoustic Air Thump on Heavy Kicks/Drops
  // Smooth damped mechanical vibration + subtle radial air-pressure compression
  float bassHit = max(0.0, uSpeakerPulse - 0.28) * (0.45 + 0.55 * uDropIntensity);
  vec2 camTremor = vec2(
    sin(uTime * 86.0 + uv.y * 5.0),
    cos(uTime * 102.0 + uv.x * 5.0)
  ) * (0.0013 * bassHit * bassHit);
  vec2 radialThump = (uv - vec2(0.50, 0.48)) * (-0.0042 * bassHit);
  totalOffset += camTremor + radialThump;

  // 2. Smooth Billowing Thermal Heat-Haze (Rising hot air above the blazing Phoenix & both giant speakers)
  // Thermal plume rising from the Phoenix flames
  vec2 dPhx = vec2((uv.x - uPhoenixPos.x) * uAspect, uv.y - uPhoenixPos.y);
  float phxHeatZone = exp(- length(dPhx * vec2(0.70, 1.05)) / (0.24 * uFireSize))
    + exp(- pow(dPhx.x / 0.19, 2.0)) * smoothstep(-0.04, 0.22, dPhx.y) * (1.0 - smoothstep(0.22, 0.40, dPhx.y)) * 0.72;

  // Thermal plume around & above Left and Right blazing speaker rings
  vec2 dSpkL = vec2((uv.x - uLeftSpeaker.x) * uAspect, uv.y - uLeftSpeaker.y);
  vec2 dSpkR = vec2((uv.x - uRightSpeaker.x) * uAspect, uv.y - uRightSpeaker.y);
  float spkHeatZone = (
    exp(- length(dSpkL * vec2(0.95, 0.72)) / 0.21) +
    exp(- length(dSpkR * vec2(0.95, 0.72)) / 0.21)
  ) * (0.55 + 0.65 * uSpeakerPulse + 0.35 * uLeadPulse);

  float totalHeatZone = clamp(phxHeatZone * (0.70 + 0.35 * uFireBrightness) + spkHeatZone, 0.0, 1.6);
  bool hasWaves = uSoundWaveA[0].y > 0.001;
  vec2 heatGrad = vec2(0.0);
  float airBillow = 0.5;
  vec2 airUv = vec2(uv.x * uAspect, uv.y);
  if (totalHeatZone > 0.002 || hasWaves) {
    vec2 heatUv = vec2(uv.x * uAspect * 14.0, uv.y * 12.0 - uTime * 3.1);
    int heatSamples = hasWaves ? 3 : 2;
    for (int hi = uZero; hi < heatSamples; hi++) {
      vec2 hp = hi == 0 ? (heatUv + vec2(1.7, 3.2))
        : hi == 1 ? (heatUv + vec2(8.3, 5.1))
        : (airUv * 8.5 + vec2(0.0, -uTime * 2.2));
      float hv = fbm(hp);
      if (hi == 0) heatGrad.x = hv - 0.5;
      else if (hi == 1) heatGrad.y = hv - 0.5;
      else airBillow = hv;
    }
  }
  totalOffset += heatGrad * totalHeatZone * 0.0048;
  softBlurField += totalHeatZone * 0.20;

  // 3. 3D Advancing Acoustic Heat-Haze Waves (Ultra-Wide, Deeply Blurred, Zero Crease!)
  if (hasWaves) {
    float baseRingR = 0.106 * (1.0 + 0.080 * uSpeakerPulse + 0.060 * uLeadPulse);

    // Organic low-frequency air billows that break up circularity and feather wave boundaries
    vec2 airEddy = vec2(
      noise2(airUv * 16.0 + vec2(uTime * 1.9, -uTime * 3.0)) - 0.5,
      noise2(airUv * 16.0 + vec2(5.4 - uTime * 1.7, -uTime * 2.8)) - 0.5
    );

    for (int i = uZero; i < ${MAX_SOUND_WAVES}; i++) {
    vec4 wa = uSoundWaveA[i]; // (age, strength, maxRadius, tau)
    if (wa.y <= 0.001) break;
    vec4 wb = uSoundWaveB[i]; // (freq, stereoBias, 0, 0)

    float age      = wa.x;
    float strength = wa.y;
    float tau      = wa.w;
    float bias     = wb.y;

    // Normalized 3D forward progress from speaker plane (0.0) past the camera lens (1.0)
    float zNorm = clamp(age / max(0.25, tau), 0.0, 1.0);
    if (zNorm >= 0.995) continue;

    // 3D Perspective progression: wavefront expands and blurs wider as it rushes toward the camera
    float perspAccel = pow(zNorm, 1.25);
    float curRad = baseRingR + 0.92 * perspAccel;
    // ULTRA-WIDE Gaussian wave width (0.062 to 0.172) so the wave boundary is completely blurred & crease-free!
    float wWidth = 0.062 + 0.110 * pow(zNorm, 1.05);

    // Projected 3D wave centers shifting gently along the speaker-to-camera sightline
    vec2 centerL = uLeftSpeaker + vec2(-0.05 * perspAccel, -0.04 * perspAccel);
    vec2 centerR = uRightSpeaker + vec2(0.05 * perspAccel, -0.04 * perspAccel);

    float birthFade = smoothstep(0.0, 0.10, zNorm);
    float lensPassFade = 1.0 - smoothstep(0.65, 0.99, zNorm);
    float envFade = birthFade * lensPassFade * strength;

    // Perturb radial distance with smooth organic air billows so the wave is a soft heat cloud, never a hard ring
    float billowShift = (airBillow - 0.5) * (0.038 + 0.052 * zNorm);

    // Left Speaker Broad Blurred Pressure Cushion
    vec2 dpL = vec2((uv.x - centerL.x) * uAspect, uv.y - centerL.y);
    float rL = length(dpL);
    vec2 dirL = dpL / max(rL, 1e-4);
    float dFrontL = (rL + billowShift - curRad) / wWidth;
    // Ultra-soft C2 refractive cushion: wide Gaussian bell + gentle slope (zero sharp fold/crease!)
    float softBellL  = exp(- 0.45 * dFrontL * dFrontL);
    float softSlopeL = -0.78 * (dFrontL / (1.0 + 0.80 * dFrontL * dFrontL)) * softBellL;
    float outsideConeL = smoothstep(baseRingR * 0.60, baseRingR * 1.50, rL);
    float weightL = envFade * clamp(1.0 - bias, 0.5, 1.25) * outsideConeL;

    // Right Speaker Broad Blurred Pressure Cushion
    vec2 dpR = vec2((uv.x - centerR.x) * uAspect, uv.y - centerR.y);
    float rR = length(dpR);
    vec2 dirR = dpR / max(rR, 1e-4);
    float dFrontR = (rR - billowShift - curRad) / wWidth;
    float softBellR  = exp(- 0.45 * dFrontR * dFrontR);
    float softSlopeR = -0.78 * (dFrontR / (1.0 + 0.80 * dFrontR * dFrontR)) * softBellR;
    float outsideConeR = smoothstep(baseRingR * 0.60, baseRingR * 1.50, rR);
    float weightR = envFade * clamp(1.0 + bias, 0.5, 1.25) * outsideConeR;

    // Strong yet completely smooth radial air-density refraction + organic heat-haze convection eddies
    float refractAmp = 0.0125 + 0.0145 * zNorm;
    totalOffset += (dirL * softSlopeL + (heatGrad * 0.75 + airEddy * 0.45) * softBellL) * weightL * refractAmp;
    totalOffset += (dirR * softSlopeR + (heatGrad * 0.75 + airEddy * 0.45) * softBellR) * weightR * refractAmp;

    // 4. 3D Floor Ground-Wave Refraction (Broad, deeply blurred ripple sweeping across wet floor reflections!)
#ifdef IS_FLOOR_PASS
    if (uv.y < ${STAGE_HORIZON_Y.toFixed(4)}) {
      float floorY = clamp(uv.y / ${STAGE_HORIZON_Y.toFixed(4)}, 0.0, 1.0);
      float distFromHorizon = 1.0 - floorY;
      float waveFrontFloor = pow(zNorm, 1.14) * 1.12;
      float floorThick = 0.105 + 0.155 * zNorm;
      float dFloorWave = (distFromHorizon + billowShift * 0.85 - waveFrontFloor) / floorThick;
      float floorBell  = exp(- 0.45 * dFloorWave * dFloorWave);
      float floorSlope = -0.75 * (dFloorWave / (1.0 + 0.80 * dFloorWave * dFloorWave)) * floorBell;
      totalOffset += vec2(heatGrad.x * floorBell * 1.45, floorSlope * 0.80) * envFade * 0.0145;
      softBlurField += floorBell * envFade * (0.50 + 0.50 * airBillow) * 0.28;
    }
#endif

    // Wide-feathered optical blur & vapor shimmer (blurred over a wide band, strongest in dense fog near speakers)
    float nearFogL = exp(- max(0.0, rL - baseRingR) / 0.36);
    float nearFogR = exp(- max(0.0, rR - baseRingR) / 0.36);
    float mistMod = 0.48 + 0.52 * airBillow;
    softBlurField += (softBellL * weightL * (0.16 + 0.84 * nearFogL) + softBellR * weightR * (0.16 + 0.84 * nearFogR)) * mistMod * 0.28;
    }
  }

  return vec4(totalOffset, clamp(softBlurField, 0.0, 1.25), bassHit);
}
`;

const PHOENIX_BIRD_PART = /* glsl */ `
/**
 * 自然猛禽覆羽流线（告别规整矩阵鳞片，建立具有方向与有机错落的羽列质感）。
 * q：羽流对齐坐标，叠加双重多频流线扰动与尺度渐变，彻底消除四边形或直线鳞片感。
 */
vec3 featherScales(vec2 q) {
  vec2 warpedQ = q + vec2(
    0.28 * sin(q.y * 1.57 + q.x * 0.72) + 0.12 * sin(q.x * 2.8 + 1.2),
    0.18 * cos(q.x * 1.85 - q.y * 0.85) + 0.08 * cos(q.y * 3.1 - 0.7)
  );
  float r0 = floor(warpedQ.y);
  float R = 0.65;
  float offU = mod(r0 - 1.0, 2.0) * 0.5;
  float cxU = floor(warpedQ.x - offU) + 0.5 + offU;
  float jU = hash21(vec2(cxU, r0 - 1.0));
  vec2 dU = warpedQ - vec2(cxU + (jU - 0.5) * 0.28, r0 - 0.5);
  float rU = length(dU * vec2(1.22, 0.78 + 0.15 * jU));
  float offL = mod(r0, 2.0) * 0.5;
  float cxL = floor(warpedQ.x - offL) + 0.5 + offL;
  float jL = hash21(vec2(cxL, r0));
  vec2 dL = warpedQ - vec2(cxL + (jL - 0.5) * 0.28, r0 + 0.5);
  float rL = length(dL * vec2(1.22, 0.78 + 0.15 * jL));

  float inU = 1.0 - smoothstep(R - 0.08, R + 0.03, rU);
  float rimU = smoothstep(R - 0.26, R - 0.04, rU) * mix(0.35, 1.0, smoothstep(-0.15, 0.42, dU.y));
  float shadowL = exp(- max(0.0, rU - R) / 0.10);
  float rimL = smoothstep(R - 0.26, R - 0.04, rL) * smoothstep(0.0, 0.38, dL.y) * 0.45;
  float rim = mix(rimL * (1.0 - shadowL), rimU, inU);
  float body = mix(0.48 * (1.0 - 0.82 * shadowL), 0.62 + 0.38 * clamp(dU.y / R, 0.0, 1.0), inU);
  float rachis = (1.0 - smoothstep(0.0, 0.055, abs(mix(dL.x, dU.x, inU)))) * mix(smoothstep(0.0, 0.52, dL.y), 1.0, inU);
  return vec3(rim, body, rachis);
}

/**
 * Evaluates the ILLENIUM Awake Phoenix's swept V-dihedral wing spine & deep avian wing chord:
 *   .x = Leading-edge height yLead(u)
 *   .y = Wing chord thickness wingChord(u)
 * Implements continuous kinematic wave propagation from wing root -> wrist -> primary wingtips
 * so the wingbeat transmits organically rather than oscillating rigidly.
 */
vec2 evalWingSpine(
  float uVal,
  float sideSign,
  float strokeRoot,
  float strokeMid,
  float strokeTip,
  float upstrokeFold
) {
  float uC = clamp(uVal, 0.0, 1.12);
  // 保持两翼大体平衡，同时引入自然的左右姿态微差 (打破机械镜像)
  float sideArchMod = 1.0 + 0.032 * sideSign * sin(uC * 2.6 + 0.35);
  // 肩背至腕部的饱满拱起弧度 + 外侧初级飞羽的舒展上扬
  float humeralArch = (0.016 + 0.022 * sin(clamp(uC * 1.55, 0.0, 3.14159265))) * sideArchMod;
  float dihedralSweep = (0.034 * pow(uC, 1.22) + 0.018 * pow(smoothstep(0.45, 1.06, uC), 1.55)) * (1.0 - 0.022 * sideSign);
  float baseArch = humeralArch + dihedralSweep;

  // 翅根 -> 腕部 -> 翼尖的连贯传递与跟随 (Kinematic phase propagation)
  float flapDisp = (
    0.011 * uC * (strokeRoot + 0.16 - 0.14 * uWingDownstroke) +
    0.016 * pow(uC, 1.36) * (strokeMid + 0.12 - 0.10 * upstrokeFold - 0.08 * uWingDownstroke) +
    0.014 * pow(uC, 1.76) * (strokeTip + 0.08)
  ) * uWingAmp * (1.0 + 0.028 * sideSign);
  float yLead = baseArch + flapDisp;

  // 饱满浑厚的翼弦厚度：显著加宽肩背、翅根与中内段覆羽/次级飞羽扇面，消除“单薄长条拼接在细躯干上”的感觉
  float chordSpan = clamp(uC / 1.04, 0.0, 1.0);
  float chordBell = sin(pow(chordSpan, 0.56) * 3.14159265);
  float rootShoulderChord = 0.044 * (1.0 - smoothstep(0.0, 0.52, uC));
  float wingChord = (rootShoulderChord + 0.066 * chordBell) * (1.0 + 0.04 * (1.0 - upstrokeFold));
  return vec2(yLead, wingChord);
}

// ── 1. 写实形体、覆羽/飞羽层叠遮挡与沿羽流分布的涅槃火凤 ──────────────────────
/**
 * Evaluates the hovering Phoenix and its feather-aligned flames at screen UV.
 * Key structural & material refinements (对齐参考封面):
 *   1. 连贯饱满的胸腹、肩背、翅根与头颈过渡体积，羽冠克制自然；
 *   2. 区分贴近身体的暗部覆羽 (Coverts) 与外侧散开的初级/次级飞羽 (Flight Feathers)，长短、间距、弯曲与朝向具自然差异；
 *   3. 彻底去除上翼缘完整高亮描边与规则暗带，通过邻近羽片遮挡、暗部体块与烟雾遮蔽建立真实厚度；
 *   4. 尾羽整理为与躯干自然连接的层叠扇面，兼具长短、粗细、弯曲与前后层次；
 *   5. 火焰沿羽毛与身体走势连续而断续地分布，具疏密、透明度与长度变化，翼尖、部分羽缘、背部与尾端更活跃，翅根与胸腹保留深邃暗部。
 */
vec4 evaluatePhoenixAndFire(vec2 uv) {
  // Transform screen UV into Phoenix local aspect-corrected coordinates centered at uPhoenixPos
  vec2 p = vec2((uv.x - uPhoenixPos.x) * uAspect, uv.y - uPhoenixPos.y);
  p /= max(0.45, uPhoenixScale);
  p = rot2D(p, -uPhoenixRoll);
  float sideSign = p.x >= 0.0 ? 1.0 : -1.0;
  float sideIdx  = p.x >= 0.0 ? 1.0 : 0.0;
  p.x *= 1.0 - 0.045 * uPhoenixYaw * sideSign;

  // 宽广平滑的局部包围盒 (放宽至 0.62，杜绝同心圆/椭圆光圈硬切痕迹)
  float radialDist = length(p * vec2(0.52, 0.75));
  if (radialDist >= 0.62) {
    return vec4(0.0);
  }
  float outerBoundsFade = 1.0 - smoothstep(0.48, 0.61, radialDist);

  float sx = abs(p.x);

  // ── A. 连贯传递的扇翅动力学 (翅根 -> 翼中 -> 翼尖 -> 尾羽依次传递跟随) ──
  float phi = uWingPhase + 0.08 * sideSign;
  float sRawRoot = sin(phi);
  float sRawMid  = sin(phi - 0.52);
  float sRawTip  = sin(phi - 1.04);
  float strokeRoot = sRawRoot + 0.20 * (sRawRoot * sRawRoot - 0.5);
  float strokeMid  = sRawMid  + 0.20 * (sRawMid  * sRawMid  - 0.5);
  float strokeTip  = sRawTip  + 0.20 * (sRawTip  * sRawTip  - 0.5);
  float upstrokeFold = max(0.0, -cos(phi)) * 0.60;

  float bodyBob = -0.0028 * sin(uWingPhase + 0.25);
  vec2 bp = vec2(p.x, p.y - bodyBob);

  // 舒展宽阔的翼展，带轻微左右不对称
  float wingSpan = (0.242 - 0.009 * upstrokeFold + 0.011 * uWingDownstroke) * (1.0 + 0.016 * sideSign);
  float u = sx / wingSpan;
  float uClamped = clamp(u, 0.0, 1.08);

  vec2 spineHere = evalWingSpine(u, sideSign, strokeRoot, strokeMid, strokeTip, upstrokeFold);
  float yLead = spineHere.x;
  float wingChord = spineHere.y;
  float yTrail = yLead - wingChord;

  // 1. 贴近身体与上翼缘的厚重覆羽体块 (Upper & Inner Covert Mass: 小覆羽 + 中覆羽 + 大覆羽)
  // 采用非规则交错羽簇边界，彻底消除死板正弦波条带，让翅根与肩背连成浑然一体的暗部肌肉与覆羽体积
  float covertChordFrac = mix(0.64, 0.40, smoothstep(0.22, 0.88, uClamped));
  float covertCellX = uClamped * 9.5 + sideIdx * 3.7;
  float covertIdx = floor(covertCellX);
  float covertSub = fract(covertCellX);
  float covertScallop = (hash21(vec2(covertIdx, sideIdx * 7.0 + 2.0)) - 0.5) * 0.0045
                      - 0.0028 * pow(covertSub - 0.5, 2.0);
  float yCovertBottom = yLead - wingChord * covertChordFrac + covertScallop;
  // 上翼缘局部羽毛微起伏（绝不画成刚性亮线）
  float leadFeatherBump = 0.0016 * (noise2(vec2(uClamped * 18.0 + sideIdx * 5.0, 1.7)) - 0.5) * smoothstep(0.10, 0.75, uClamped);
  // 上翼梁立体弧面厚度 (Spar Camber Profile)：前缘饱满微隆起骨骼翼弓，彻底打破直线纸片扁平感
  float wingSparProfile = 0.0078 * sin(clamp(uClamped, 0.0, 1.0) * 3.14159) * (1.0 - 0.25 * uClamped);
  float dyCovert = max(bp.y - (yLead + leadFeatherBump + wingSparProfile), yCovertBottom - bp.y);
  float dxCovert = sx - wingSpan * 0.82;
  float dCovertWing = length(max(vec2(dxCovert, dyCovert), 0.0)) + min(max(dxCovert, dyCovert), 0.0) - 0.0036;

  // 2. 次级飞羽与内侧初级飞羽 (长短、弯曲、间距、朝向各异的层叠羽片，空间包围盒粗筛跳过无关像素)
  float dFlightFeathers = 1.0;
  float bestFeatAlong = 0.0;
  float bestFeatVane = 0.0;
  float bestFeatEdgeFire = 0.0;
  float bestFeatDepth = 0.0;
  float bestFeatLen = 0.05;
  float occluderShadow = 0.0;

  // 粗包围盒距离剔除：飞羽集中在 sx >= 0.025 且 bp.y 处于翼前缘下方的区域；远离区域直接跳过循环避免 GPU 负担！
  float dyFlightBox = max(bp.y - (yLead + 0.035), (yLead - wingChord * 1.55) - bp.y);
  float dxFlightBox = max(0.025 - sx, sx - wingSpan * 1.15);
  float flightBoxDist = max(dxFlightBox, dyFlightBox);

  if (flightBoxDist < 0.015) {
    // 合并 10 片次级飞羽 (0..9) 与 5 片翼尖初级飞羽 (10..14) 为单循环，共享 evalWingSpine 调用点
    for (int fIdx = uZero; fIdx < 15; fIdx++) {
      bool isPrim = fIdx >= 10;
      float idxF = float(isPrim ? fIdx - 10 : fIdx);
      float fi = isPrim ? (idxF / 4.0) : (idxF / 9.0);
      float fSeed = isPrim ? (idxF * 7.13 + sideIdx * 19.7) : (idxF * 5.17 + sideIdx * 31.41);
      vec2 fRnd = hash22(isPrim ? vec2(fSeed, sideIdx * 5.3 + idxF) : vec2(fSeed, idxF * 1.9 + sideIdx * 13.7));

      float uAnchor = isPrim
        ? (mix(0.68, 0.85, fi) + (fRnd.x - 0.5) * 0.018)
        : clamp(mix(0.07, 0.78, pow(fi, 0.90)) + (fRnd.x - 0.5) * 0.032 * smoothstep(0.06, 0.85, fi), 0.05, 0.82);
      vec2 anchorSpine = evalWingSpine(uAnchor, sideSign, strokeRoot, strokeMid, strokeTip, upstrokeFold);
      float chordOff = isPrim ? mix(0.10, 0.34, fi) : (mix(0.32, 0.18, fi) + (fRnd.y - 0.5) * 0.07);
      vec2 fStart = vec2(uAnchor * wingSpan, anchorSpine.x - anchorSpine.y * chordOff);

      float fAng = isPrim
        ? (mix(0.40, -0.22, pow(fi, 0.92)) + (fRnd.y - 0.5) * 0.07 + 0.05 * strokeTip)
        : (mix(-0.88, 0.08, pow(fi, 0.90)) + (fRnd.y - 0.5) * 0.12 + 0.03 * sin(fSeed * 2.1) + 0.032 * (strokeMid - 0.25 * upstrokeFold));
      float fLen = isPrim
        ? (wingSpan * 0.27 * (1.0 - 0.26 * abs(fi - 0.38)) * (0.90 + 0.22 * fRnd.x))
        : (wingSpan * mix(0.20, 0.29, smoothstep(0.08, 0.72, fi)) * (1.0 - 0.14 * pow(max(0.0, fi - 0.72) / 0.28, 1.4)) * (0.80 + 0.30 * fract(fRnd.x * 3.3 + fRnd.y * 2.1) + 0.08 * sin(idxF * 2.1 + sideIdx * 2.4)));

      vec2 fDir = vec2(cos(fAng), sin(fAng));
      vec2 fOrtho = vec2(-fDir.y, fDir.x);
      vec2 relP = vec2(sx, bp.y) - fStart;
      float alongF = clamp(dot(relP, fDir) / max(fLen, 1e-4), 0.0, 1.0);
      float archCurve = isPrim
        ? ((0.0036 * (1.0 - fi * 0.6) * pow(alongF, 1.65)) * (0.8 + 0.4 * fRnd.y))
        : ((mix(0.0024, 0.0068, fi) * pow(alongF, 1.50) + 0.0012 * sin(alongF * 3.14159265)) * (0.55 + 0.85 * fract(fRnd.x * 1.9 + fRnd.y * 3.1)));
      vec2 diffP = relP - (fDir * (alongF * fLen) + fOrtho * archCurve);
      float signedVane = dot(diffP, fOrtho);
      float fWidth = isPrim
        ? (mix(0.0084, 0.0026, pow(alongF, 1.35)) * (0.92 + 0.16 * fRnd.x))
        : (mix(0.0155, 0.0108, fi) * (0.90 + 0.26 * fRnd.x) * (1.0 - 0.70 * pow(smoothstep(0.45, 1.0, alongF), 1.60)));
      float dFeat = length(diffP) - fWidth;

      if (isPrim) {
        if (dFeat < dFlightFeathers) {
          dFlightFeathers = dFeat;
          bestFeatAlong = alongF;
          bestFeatVane = clamp(signedVane / max(fWidth, 1e-4), -1.0, 1.0);
          bestFeatEdgeFire = 0.55 + 0.45 * smoothstep(0.25, 0.85, fi);
          bestFeatDepth = 1.1 + fi * 0.2;
          bestFeatLen = fLen;
        }
        dFlightFeathers = smin(dFlightFeathers, dFeat, 0.0008);
      } else {
        float fDepth = fi + 0.22 * (fRnd.x - 0.5);
        float edgeFirePropensity = smoothstep(0.32, 0.88, fract(fSeed * 0.618 + fRnd.y * 1.3))
                                 * (0.30 + 0.70 * smoothstep(0.18, 0.80, fi));
        if (dFeat < 0.0040) {
          float inThisFeather = 1.0 - smoothstep(-0.0006, 0.0020, dFeat);
          if (fDepth > bestFeatDepth && dFlightFeathers < 0.0012) {
            occluderShadow = max(occluderShadow, exp(- max(0.0, dFeat + 0.0008) / 0.0028));
          } else if (fDepth < bestFeatDepth && inThisFeather > 0.01) {
            occluderShadow = max(occluderShadow, exp(- max(0.0, dFlightFeathers + 0.0008) / 0.0028));
          }
          if (dFeat < dFlightFeathers) {
            dFlightFeathers = dFeat;
            bestFeatAlong = alongF;
            bestFeatVane = clamp(signedVane / max(fWidth, 1e-4), -1.0, 1.0);
            bestFeatEdgeFire = edgeFirePropensity;
            bestFeatDepth = fDepth;
            bestFeatLen = fLen;
          }
        }
        dFlightFeathers = smin(dFlightFeathers, dFeat, 0.0016);
      }
    }
  } else {
    dFlightFeathers = flightBoxDist + 0.02;
  }

  float dWingCombined = smin(dCovertWing, dFlightFeathers, 0.0036);
  float chordFrac = clamp((yLead - bp.y) / max(wingChord, 0.008), 0.0, 1.45);

  // ── B. 连贯有力的胸腹、肩背、头颈过渡 (强健雄浑的翅根肩膀，昂然露出的威武猛禽头颈!) ──
  // 1. 宽阔厚重的肩胛覆羽与胸大肌：向两侧双翼饱满舒展，保留翅根宏大体积，绝不削薄双肩！
  vec2 shoulderBridge = sdSegment(vec2(sx, bp.y), vec2(0.016, 0.012), vec2(0.082, 0.024));
  float dShoulderMass = shoulderBridge.x - mix(0.032, 0.024, shoulderBridge.y);

  float chestY = clamp((bp.y - (-0.028)) / 0.062, 0.0, 1.0);
  float torsoHalfW = mix(0.022, 0.052, sin(pow(chestY, 0.54) * 2.85));
  vec2 torsoSeg = sdSegment(vec2(sx, bp.y), vec2(0.0, -0.028), vec2(0.0, 0.030));
  float dTorso = smin(torsoSeg.x - torsoHalfW, dShoulderMass, 0.0110);

  // 2. 傲然挺拔的高耸猛禽头颈：明显高耸于饱满双肩之上，修长强健、金喙锐目，彻底打破黑团！
  vec2 headCenter = vec2(-0.0070, 0.0610);
  vec2 neckBasePos = vec2(0.0, 0.026);

  // 鸟类优雅微拱的 S 型颈椎轴线 (胸前微挺，喉下自然收束，头骨傲然高踞)
  float archT = clamp((bp.y - 0.026) / 0.035, 0.0, 1.0);
  float neckArchX = -0.0070 * archT - 0.0022 * sin(archT * 3.1415926);
  vec2 neckSeg = sdSegment(bp - vec2(neckArchX - (-0.0070 * archT), 0.0), neckBasePos, headCenter + vec2(0.0008, -0.0045));
  float neckT = neckSeg.y;
  float neckCenterX = neckArchX;

  // 喉部收细至猛禽真实解剖比例 (前喉紧致、颈背丰满，头骨明显宽于咽喉，彻底破除大粗脖子与贴纸肉团!)
  float neckThroatW = mix(0.0135, 0.0055, pow(neckT, 1.15));
  float neckNapeW   = mix(0.0155, 0.0078, pow(neckT, 0.90));
  float neckHalfW   = (bp.x < neckCenterX) ? neckThroatW : neckNapeW;

  // 颈背长矛状披肩翎羽 (Lanceolate Hackles) 的层叠羽片微起伏
  float hackleLayer = sin((bp.y - 0.026) * 180.0 - (bp.x - neckCenterX) * 90.0);
  float hackleAmp   = smoothstep(0.18, 0.85, neckT) * step(neckCenterX, bp.x) * 0.0014;
  float dNeck = neckSeg.x - (neckHalfW + hackleLayer * hackleAmp);

  // 猛禽颏喉凹折 (Gular Angle Cut)：在下巴与前喉交界处形成明确的结构阴影凹折，让下颌骨与头骨鲜明独立！
  float throatCut = length(bp - (headCenter + vec2(-0.0060, -0.0062))) - 0.0040;
  dNeck = smax(dNeck, -throatCut, 0.0020);

  // 头部：雄壮威严的猛禽头骨 (前额平伏低平、冷峻眉弓突出、后枕饱满高耸)
  vec2 hp = rot2D(bp - headCenter, -0.16);
  float dSkull = length(hp * vec2(0.88, 1.15)) - 0.0108;
  // 压低霸气的猛禽眉弓骨 (Supraorbital Ridge)
  float browLine = hp.y - 0.0068 + hp.x * 0.22;
  dSkull = smax(dSkull, browLine, 0.0026);
  // 后枕圆润饱满向颈背延伸
  float dNape = length((bp - (headCenter + vec2(0.0048, -0.0020))) * vec2(1.0, 0.90)) - 0.0092;
  dSkull = smin(dSkull, dNape, 0.0028);

  // 弯钩利喙与蜡膜：纯正金雕/猛禽流线型下弯月牙利喙，基部蜡膜自然衔接，尖端锋芒钩曲！
  vec2 beakBase = headCenter + vec2(-0.0080, 0.0008);
  vec2 bq = bp - beakBase;
  float bAlong = clamp(-bq.x / 0.0145, 0.0, 1.0);
  float beakCurveY = -0.0058 * pow(bAlong, 1.85);
  // 喙基部半厚度收敛至紧凑的 0.0030，尖端尖锐钩收
  float beakHalfH = mix(0.0030, 0.00035, pow(bAlong, 0.82));
  float dBeakUpper = smax(abs(bq.y - beakCurveY) - beakHalfH, max(bq.x - 0.0006, -bq.x - 0.0145), 0.0005);
  // 咬合下喙：紧凑收于上喙内侧
  vec2 jawSeg = sdSegment(bp, beakBase + vec2(0.0003, -0.0020), beakBase + vec2(-0.0070, -0.0034));
  float dJaw = jawSeg.x - mix(0.0014, 0.0004, jawSeg.y);
  float dBeak = min(dBeakUpper, dJaw);
  float headWithBeak = smin(dSkull, dBeak, 0.0016);

  // 华美神凤羽冠：3 束修长如剑翎的烈火羽冠，自后脑顺势向后上方飞扬，翎羽修长分明
  float dCrest = 1.0;
  float crestTipGlow = 0.0;
  float crestFeatherRelief = 0.0;
  for (int c = uZero; c < 3; c++) {
    float fc = float(c) / 2.0;
    float crestAng = 0.55 + fc * 0.32 + 0.025 * sin(uTime * 1.3 + fc * 1.5);
    float crestLen = mix(0.0220, 0.0145, fc);
    vec2 cStart = headCenter + vec2(0.0038 + fc * 0.0020, 0.0050 - fc * 0.0030);
    vec2 cDir = vec2(cos(crestAng), sin(crestAng));
    vec2 cOrtho = vec2(-cDir.y, cDir.x);
    vec2 cRel = bp - cStart;
    float alongC = clamp(dot(cRel, cDir) / crestLen, 0.0, 1.0);
    float cWave = -0.0018 * pow(alongC, 1.7) + 0.0008 * sin(alongC * 3.2 - uTime * 1.5 + fc * 2.0) * alongC;
    vec2 diffC = cRel - cDir * (alongC * crestLen) - cOrtho * cWave;
    float cWidth = mix(0.0012, 0.0003, pow(alongC, 0.85));
    float dC = length(diffC) - cWidth;
    dCrest = min(dCrest, dC);
    crestTipGlow = max(crestTipGlow, exp(- max(0.0, dC + 0.0004) / 0.0020) * smoothstep(0.42, 0.98, alongC));
    crestFeatherRelief = max(crestFeatherRelief, (1.0 - smoothstep(0.0, cWidth, length(diffC))) * (1.0 - alongC * 0.35));
  }

  float dHead = smin(dNeck, smin(headWithBeak, dCrest, 0.0018), 0.0028);

  // 3. 与腰腹自然连接的连贯层叠扇形尾羽 (整理尾羽：消除分叉齿感，形成紧密交叠的饱满尾扇并保留长短、粗细与前后层次!)
  vec2 tailOrigin = vec2(0.0, -0.015);
  // 尾羽随扇翅相位产生滞后跟随摆动 (连贯传递与跟随)
  float tailFollow = 0.0024 * sin(uWingPhase - 1.35) + 0.0015 * sin(uTime * 1.15);
  vec2 tp = bp - tailOrigin;

  // 饱满的尾上/尾下覆羽扇面基座，从腰部微收处自然向下张开成连贯尾扇
  float tailFanT = clamp(-tp.y / 0.068, 0.0, 1.0);
  float fanHalfW = mix(0.0135, 0.0235, sin(pow(tailFanT, 0.65) * 2.55));
  vec2 tailCoreSeg = sdSegment(vec2(sx, tp.y), vec2(0.0, 0.002), vec2(0.0, -0.056));
  float dTailBase = tailCoreSeg.x - fanHalfW;

  float dTailFront = dTailBase;
  float dTailBack  = 1.0;
  float bestTailAlong = 0.0;
  float tailTipFireGlow = 0.0;
  float tailFeatherRelief = 0.0;

  // 7 束紧密交叠的前后层扇形尾羽 (k=0..3 为前层主尾羽，k=4..6 为后层衬底尾羽，叶片宽厚重叠，仅在尾扇下缘形成自然的羽端错落)
  for (int k = uZero; k < 7; k++) {
    bool isBackLayer = k >= 4;
    float idx = float(isBackLayer ? k - 4 : k);
    float spanNorm = isBackLayer ? ((idx - 1.0) * 0.78) : ((idx - 1.5) / 1.5);
    float seedK = float(k) * 4.13 + 2.3;

    // 中央尾羽略长、两侧渐短，形成圆润楔形尾扇并带细微不对称
    float centerWeight = 1.0 - abs(spanNorm);
    float asymLen = 0.0038 * sin(seedK * 1.7);
    float plumeDrop = (isBackLayer ? 0.060 : 0.066) + 0.015 * pow(centerWeight, 0.85) + asymLen;
    float alongT = clamp(-tp.y / plumeDrop, 0.0, 1.0);

    // 顺应尾扇柔和展开，羽片紧密贴合不劈叉
    float fanSpreadX = spanNorm * (0.012 + 0.009 * pow(alongT, 1.10)) * (isBackLayer ? 1.10 : 0.95);
    float gentleCurve = spanNorm * 0.0032 * sin(alongT * 2.4) * pow(alongT, 0.90)
                      + 0.0012 * sin(alongT * 3.2 - uTime * 1.3 + seedK) * pow(alongT, 1.1)
                      + tailFollow * pow(alongT, 1.15);
    float curveX = fanSpreadX + gentleCurve;
    float curveY = -alongT * plumeDrop;

    vec2 diffPlume = tp - vec2(curveX, curveY);
    float distPlume = length(diffPlume) * 0.88;

    // 宽厚交叠的尾羽叶片 (消除分叉空隙，同时保持粗细差异与羽端层次)
    float baseThick = isBackLayer
      ? (0.0074 - 0.0010 * abs(spanNorm))
      : mix(0.0068, 0.0096, centerWeight);
    float tipTaperT = 1.0 - 0.56 * pow(smoothstep(0.64, 1.0, alongT), 1.65);
    float plumeW = baseThick * tipTaperT;
    float dPlume = distPlume - plumeW;

    // 尾羽叶片表面明暗起伏与羽轴立体感
    float vaneCamber = clamp(1.0 - abs(diffPlume.x) / max(plumeW, 1e-4), 0.0, 1.0);
    tailFeatherRelief = max(tailFeatherRelief, vaneCamber * (isBackLayer ? 0.55 : 0.95) * (1.0 - smoothstep(-0.0005, 0.0015, dPlume)));

    if (isBackLayer) {
      dTailBack = smin(dTailBack, dPlume, 0.0024);
    } else {
      if (dPlume < dTailFront) {
        bestTailAlong = alongT;
      }
      dTailFront = smin(dTailFront, dPlume, 0.0028);
    }
    float tipWeight = smoothstep(0.58, 0.96, alongT) * (isBackLayer ? 0.65 : 1.0);
    tailTipFireGlow = max(tailTipFireGlow, exp(- max(0.0, dPlume + 0.0008) / 0.0026) * tipWeight);
  }

  float dTail = min(dTailFront, dTailBack);
  float tailBackLayerMask = (1.0 - smoothstep(-0.0005, 0.0008, dTailBack)) * smoothstep(-0.0010, 0.0016, dTailFront);
  float tailFrontOcclusion = exp(- max(0.0, dTailFront) / 0.0036) * tailBackLayerMask;

  float dCoreBodyRaw = smin(dTorso, smin(dHead, dTail, 0.0042), 0.0055);
  // 绒毛质感：身体、颈部与头部轮廓带细碎蓬松的绒羽起伏（喙部保持硬朗的角质轮廓）
  float downN = noise2(bp * 260.0 + vec2(sideIdx * 5.1, 2.3)) * 0.62 + noise2(bp * 480.0 + vec2(7.7, 1.3)) * 0.38;
  float beakNear = 1.0 - smoothstep(0.0, 0.0030, dBeak);
  float dCoreBody = dCoreBodyRaw + (downN - 0.5) * 0.0016 * (1.0 - beakNear);
  float dFullBird = smin(dCoreBody, dWingCombined, 0.0055);
  float birdMask  = 1.0 - smoothstep(-0.0006, 0.0009, dFullBird);

  // 鸟体外部火焰安全早退：当像素与鸟体的有向距离超过外焰与辉光的最大有效半径 (0.130) 时直接跳过火焰 FBM 采样
  if (dFullBird > 0.130) {
    return vec4(0.0);
  }

  // ── C. 沿羽毛与身体走势分布的火焰动态 (疏密、断续、透明度与长度变化，速度沉稳克制!) ──
  float fireClock = uTime * 1.55 + uFlow * 0.62;
  float distSpread = smoothstep(0.12, 1.35, uFireDistribution);
  float effFireSize = 0.90 + 0.32 * smoothstep(0.80, 2.40, uFireSize);
  float effBright   = 0.90 + 0.30 * smoothstep(0.80, 2.50, uFireBrightness);

  // 1 & 2. 将全部 13 次 4 八度火焰与色块噪声采样合并为单入口动态循环，消除 D3D11 fxc 13 倍重复内联
  vec2 featherFlowUv = vec2(
    bp.x * 0.84 - sideSign * (bp.y - yTrail * 0.55) * 0.64,
    bp.y - yTrail * 0.52
  );
  vec2 qDown = vec2(featherFlowUv.x * 42.0, featherFlowUv.y * 24.0 + fireClock);
  bool needUp = sx < 0.110 && bp.y > -0.032;
  vec2 uvUp = vec2(bp.x * 0.92 + sideSign * bp.y * 0.18, bp.y);
  vec2 qUp = vec2(uvUp.x * 38.0, uvUp.y * 22.0 - fireClock);

  vec2 warpDown = vec2(0.0), warpUp = vec2(0.0);
  float fCoarse = 0.0, fMed = 0.0, fFine = 0.0;
  float uCoarse = 0.0, uMed = 0.0, uFine = 0.0;
  float clumpNoise = 0.0, nLeadPhx = 0.0, barbFire = 0.0;

  for (int fn = uZero; fn < 13; fn++) {
    if (!needUp && fn >= 5 && fn <= 9) continue;
    vec2 sp;
    bool isF = false;
    if (fn == 0)       sp = qDown * 0.44 + vec2(1.7, 9.2);
    else if (fn == 1)  sp = qDown * 0.44 + vec2(8.3, 2.8);
    else if (fn == 2)  sp = qDown * 0.50 + warpDown * 1.12;
    else if (fn == 3)  { sp = qDown * 1.18 + warpDown * 1.38 + vec2(0.0, fireClock * 0.50); isF = true; }
    else if (fn == 4)  { sp = qDown * 2.35 - warpDown * 0.80 + vec2(3.7, fireClock * 0.82); isF = true; }
    else if (fn == 5)  sp = qUp * 0.46 + vec2(4.1, 2.3);
    else if (fn == 6)  sp = qUp * 0.46 + vec2(9.7, 6.4);
    else if (fn == 7)  sp = qUp * 0.50 + warpUp * 1.08;
    else if (fn == 8)  { sp = qUp * 1.16 + warpUp * 1.34 - vec2(0.0, fireClock * 0.50); isF = true; }
    else if (fn == 9)  { sp = qUp * 2.30 - warpUp * 0.76 - vec2(2.1, fireClock * 0.82); isF = true; }
    else if (fn == 10) sp = vec2(bp.x * 22.0 + sideSign * 2.7, bp.y * 20.0 - fireClock * 0.38);
    else if (fn == 11) sp = vec2(bp.x * 15.0, bp.y * 11.0 - fireClock * 0.10) + vec2(4.2 * 7.31, 4.2 * 3.17) + vec2(uTime * 0.04, -uTime * 0.028);
    else               { sp = vec2(bestFeatAlong * 5.0 - fireClock * 0.55, bestFeatVane * 2.4 + bestFeatDepth * 6.1); isF = true; }

    float val = sampleOctave4(sp, isF);
    if (fn == 0)       warpDown.x = val - 0.5;
    else if (fn == 1)  warpDown.y = val - 0.5;
    else if (fn == 2)  fCoarse = smoothstep(0.18, 0.82, val);
    else if (fn == 3)  fMed = pow(val, 1.44);
    else if (fn == 4)  fFine = pow(val, 1.64);
    else if (fn == 5)  warpUp.x = val - 0.5;
    else if (fn == 6)  warpUp.y = val - 0.5;
    else if (fn == 7)  uCoarse = smoothstep(0.22, 0.82, val);
    else if (fn == 8)  uMed = pow(val, 1.50);
    else if (fn == 9)  uFine = pow(val, 1.70);
    else if (fn == 10) clumpNoise = val;
    else if (fn == 11) nLeadPhx = val;
    else               barbFire = val;
  }
  float fireFieldDown = clamp(fCoarse * 0.30 + fMed * 0.58 + fFine * 0.48, 0.0, 1.42);
  float fireFieldUp   = needUp ? clamp(uCoarse * 0.26 + uMed * 0.58 + uFine * 0.48, 0.0, 1.40) : 0.0;
  float spanCluster = 0.62 + 0.38 * sin(uClamped * 21.0 + sideIdx * 2.1 + clumpNoise * 2.8);
  float flameIntermittency = smoothstep(0.16, 0.72, clumpNoise * 0.48 + fCoarse * 0.32 + spanCluster * 0.30);

  // ── 区域 1：沿全翼覆羽下缘、次级飞羽与外侧初级飞羽翼尖自然衔接的层叠燃烧火羽! ──
  float wingtipBoost = smoothstep(0.52, 0.88, u);
  float midWingActivity = smoothstep(0.08, 0.20, u) * (0.76 + 0.24 * flameIntermittency);
  float wingFocus = mix(midWingActivity * 0.94, 1.16, wingtipBoost);
  float spanEnd = 0.98 + 0.12 * distSpread;
  float wingSpanEnv = smoothstep(0.06, 0.15, u) * (1.0 - smoothstep(spanEnd - 0.08, spanEnd + 0.04, u));

  // 关键修正：火舌起始锚点沿层叠覆羽齿状下缘 (dCovertWing) 与每根飞羽的轴向深度 (bestFeatAlong) 自然错落展开，
  // 彻底消除翼面中段僵直的对角分界线，让覆羽暗部 -> 暖铜覆羽尖 -> 金橙飞羽 -> 炽白火舌呈层叠羽毛过渡！
  float covertScallopShift = (covertChordFrac - 0.56) * wingChord * 0.85
                           + covertScallop * 1.4
                           + 0.0045 * sin(uClamped * 38.0 + sideIdx * 1.9 + clumpNoise * 3.2);
  float trailJitter = warpDown.y * 0.0042 + (fMed - 0.5) * 0.0052 + covertScallopShift;
  float flameRootY = yTrail + wingChord * mix(0.24, 0.44, wingtipBoost) + trailJitter;
  float belowRoot = flameRootY - bp.y;
  // 距离飞羽下缘与覆羽下缘的距离：让火舌顺着每根飞羽末端与间隙自然向下舔舐
  float featherTrailDist = max(0.0, dWingCombined + 0.0052) * smoothstep(-0.010, 0.045, belowRoot);
  float underRootMask = wingSpanEnv * smoothstep(-0.0085, 0.0045, belowRoot);

  // 火舌向下与向外延伸的充足长度，具羽簇长短变化
  float lengthVar = 0.70 + 0.62 * flameIntermittency;
  float underReach = (0.028 + 0.034 * pow(clamp(u, 0.0, 1.0), 0.78)) * lengthVar * effFireSize * (0.88 + 0.26 * distSpread);
  float effectiveDepthBelow = mix(max(0.0, belowRoot), featherTrailDist * 1.12, 0.52);
  float normBelow = pow(clamp(effectiveDepthBelow / max(0.004, underReach), 0.0, 2.0), 0.78);
  float underRootCore = (1.0 - smoothstep(0.0, 0.52, normBelow)) * (0.14 + 0.18 * wingtipBoost) * (0.60 + 0.40 * flameIntermittency);
  float underExcess = mix(-1.0, underRootCore + fireFieldDown * (0.88 + 0.30 * wingFocus) * (0.62 + 0.38 * flameIntermittency) - normBelow, underRootMask);

  // 外侧初级飞羽翼尖的羽流火舌：平滑的高斯发散热辐射，彻底消除尖锐折角与硬刀片边缘
  float tipSpanEnv = smoothstep(0.42, 0.65, u) * exp(- pow(max(0.0, u - 0.90) / 0.22, 2.0));
  float tipEdgeMask = tipSpanEnv * smoothstep(-0.0080, 0.0050, dWingCombined);
  float tipReach = (0.025 + 0.028 * distSpread) * (0.75 + 0.45 * flameIntermittency) * effFireSize;
  float tipDissipation = exp(- pow(max(0.0, dWingCombined) / max(0.0035, tipReach), 2.0));
  float tipExcessRaw = (0.22 * wingtipBoost + fireFieldDown * (1.02 + 0.26 * distSpread) * (0.65 + 0.35 * flameIntermittency)) * tipDissipation - 0.15;
  float tipExcess = mix(-0.6, tipExcessRaw, tipEdgeMask);

  // ── 区域 2：尾羽腰侧与尾扇末端火舌 (尾扇主体保留暗部，腰侧与末端火苗自然呼应参考封面!) ──
  float tailTipMask = smoothstep(-0.024, -0.058, bp.y) * (1.0 - smoothstep(-0.096, -0.118, bp.y))
    * (1.0 - smoothstep(0.032, 0.056 + 0.012 * distSpread, sx))
    * smoothstep(-0.0045, 0.0014, dTail);
  float tailReach = (0.009 + 0.014 * distSpread) * (0.72 + 0.42 * flameIntermittency) * effFireSize;
  float belowTail = max(0.0, dTail + 0.0018) + max(0.0, (-0.078) - bp.y) * 0.78;
  float normTail = pow(clamp(belowTail / max(0.0025, tailReach), 0.0, 2.0), 0.78);
  float tailExcess = mix(-1.0, 0.14 + fireFieldDown * (0.90 + 0.22 * distSpread) * (0.60 + 0.40 * flameIntermittency) - normTail, tailTipMask);

  // ── 区域 3：肩背与头颈后方升腾的火焰冠冕 (衬托深色头颈剪影，还原参考封面背部升腾火光!) ──
  vec2 crownOrigin = vec2(-0.001, 0.017);
  vec2 dCrown = vec2(
    (bp.x - crownOrigin.x) / ((0.046 + 0.015 * distSpread) * effFireSize),
    max(0.0, bp.y - crownOrigin.y) / ((0.066 + 0.024 * distSpread + 0.012 * uGroovePulse) * effFireSize)
  );
  float belowCrownOrigin = max(0.0, crownOrigin.y - bp.y) / (0.020 * effFireSize);
  float normCrown = pow(clamp(length(dCrown) + belowCrownOrigin, 0.0, 2.0), 0.76);
  float crownMask = smoothstep(0.002, 0.015, bp.y) * (1.0 - smoothstep(0.052, 0.108, sx));
  float crownInnerCore = (1.0 - smoothstep(0.0, 0.62, normCrown)) * 0.46 * (0.60 + 0.40 * uCoarse);
  float crownExcess = mix(-1.0, crownInnerCore + fireFieldUp * (1.04 + 0.22 * distSpread) - normCrown * 0.84, crownMask);

  // ── D. 双 Lead 封面代表色分布的火焰、写实羽毛材质与暗部体块合成 ──
  // 复用上方单入口采样得到的 nLeadPhx，避免再次内联 4 八度 fbm
  float leadBandPhx = mix(0.18, 0.45, uColorFusion);
  float wBPhx = 1.0 - smoothstep(uLeadShareB - leadBandPhx, uLeadShareB + leadBandPhx, smoothstep(0.20, 0.80, nLeadPhx));
  // 光强随 Drop 律动呼吸，并在 Lead 起音时短暂增强
  float glowBoost = uLightPulse * (1.0 + 0.22 * uLeadPulse);

  // 1. 背部升腾火焰与局部热辐射光晕 (仅在背部、翼下火舌与尾端发光，绝不在上翼缘形成等宽光圈!)
  float bgRidgeDetail = 0.52 * uMed + 0.48 * uFine;
  float bgCoreZone = smoothstep(0.08, 0.34, crownExcess);
  float bgTongueMask = smoothstep(-0.02, 0.16, crownExcess)
    * mix(clamp(0.18 + 1.04 * pow(bgRidgeDetail, 0.88), 0.0, 1.0), 1.0, bgCoreZone * 0.52)
    * (0.50 + 0.50 * smoothstep(0.20, 0.72, uCoarse))
    * outerBoundsFade;
  float bgHeat = clamp(smoothstep(-0.01, 0.36, crownExcess) * (0.42 + 0.68 * bgRidgeDetail) * effBright, 0.0, 1.0);
  // 色块只附着在浓密火舌上；稀薄火舌边缘与外围辉光回到主导色，避免在背景中出现硬边色斑
  float wBPhxAmbient = smoothstep(0.38, 0.62, uLeadShareB);
  float wBFlame = mix(wBPhxAmbient, wBPhx, smoothstep(0.10, 0.45, bgTongueMask));
  vec3 bgFlameCol = leadColor(bgHeat * 0.97, wBFlame);

  float lowerSideWeight = smoothstep(0.32, 0.82, chordFrac) * smoothstep(0.07, 0.22, u);
  // 严格沿羽流、背部火冕与尾羽末端的各向异性火光辐射，绝不在鸟身周围生成等距圆形光环
  float focalAuraWeight = max(
    max(wingtipBoost * 0.82, lowerSideWeight * 0.75),
    max(smoothstep(0.008, 0.036, bp.y) * (1.0 - smoothstep(0.040, 0.092, sx)), smoothstep(-0.032, -0.076, bp.y) * 0.68)
  ) * (0.48 + 0.52 * flameIntermittency);
  float surfDist = max(0.0, dFullBird);
  // 仅在真实火焰活跃部位向外平滑衰减，无火空域不产生发光
  float focalFireAura = exp(- (surfDist * surfDist) / max(1e-5, 0.0006 * effFireSize * effFireSize)) * focalAuraWeight * (0.36 + 0.16 * distSpread) * (0.55 + 0.45 * fMed);
  // 彻底移除导致正圆形光晕的全局 phoenixWideGlow，改由真实的背部与翼下局部火舌漫射替代
  vec3 bgFireRgb = (
    bgFlameCol * bgTongueMask * (1.30 + 0.24 * distSpread) +
    leadColor(0.42, mix(wBPhx, wBPhxAmbient, smoothstep(0.0, 0.015, surfDist))) * focalFireAura
  ) * (1.0 - birdMask) * glowBoost;

  // 2. 区分贴近身体的暗部覆羽与下半翼受火光透射的飞羽
  float inWingSpan = smoothstep(0.02, 0.08, u) * (1.0 - smoothstep(0.99, 1.12, u));
  float covertClusterWave = 0.5 + 0.5 * cos(covertCellX * 6.2831853 + chordFrac * 4.5);
  float covertMarginMod   = (covertChordFrac - 0.56) * 0.65 + 0.08 * (covertClusterWave - 0.5);

  // 胸腹、肩背、头颈、上翼面与尾扇中心的连贯暗部体块 (浑然一体自然过渡，消除断层与硬切)
  float trunkDarkMass = exp(- pow((bp.x - neckCenterX * 0.45) / 0.038, 2.0) - pow((bp.y - (-0.002)) / 0.052, 2.0));
  float tailCoreDark  = exp(- pow(sx / 0.020, 2.0) - pow((bp.y - (-0.045)) / 0.028, 2.0)) * 0.84;
  float upperWingBandDark = (1.0 - smoothstep(0.24 + covertMarginMod, 0.62 + covertMarginMod, chordFrac))
                          * (1.0 - 0.38 * smoothstep(0.66, 0.96, u))
                          * inWingSpan;
  float bodyAndRootShadowMass = clamp(max(trunkDarkMass * 0.68, max(tailCoreDark, upperWingBandDark * 0.90)), 0.0, 1.0);

  float fgRidgeDetail = 0.52 * fMed + 0.48 * fFine;

  // 3. 前景层叠火舌：平滑自然的火苗外缘过渡，杜绝剪纸般的尖锐角折
  float fgExcess = max(max(underExcess, tipExcess), tailExcess);
  float fgCoreZone = smoothstep(0.08, 0.38, fgExcess) * max(wingtipBoost, smoothstep(0.60, 0.96, chordFrac));
  float fgRawMask = smoothstep(-0.05, 0.22, fgExcess)
    * mix(clamp(0.16 + 0.96 * pow(fgRidgeDetail, 0.90), 0.0, 1.0), 1.0, fgCoreZone * 0.46)
    * (0.45 + 0.55 * flameIntermittency)
    * outerBoundsFade;

  float fgTongueAlpha = pow(fgRawMask, 1.18) * (1.0 - 0.92 * bodyAndRootShadowMass);
  float fgHeat = clamp(smoothstep(-0.01, 0.38, fgExcess) * (0.38 + 0.68 * fgRidgeDetail) * effBright, 0.0, 1.0);
  float fgCoreGate = 0.45 + 0.55 * max(wingtipBoost, smoothstep(0.65, 1.05, chordFrac));
  vec3 fgFlameCol = leadColor(fgHeat * mix(0.80, 1.0, fgCoreGate), wBPhx);

  // 覆羽与飞羽上半段对前景火舌产生自然的羽毛遮挡层次
  float featherBodyOcclusion = smoothstep(-0.0005, -0.0038, dFullBird)
                             * (1.0 - 0.86 * smoothstep(0.48 + covertMarginMod * 0.6, 0.88, chordFrac))
                             * (0.55 + 0.45 * occluderShadow);
  float fgVisibleAlpha = fgTongueAlpha * (1.0 - featherBodyOcclusion * 0.84);
  vec3 fgFireRgb = fgFlameCol * fgVisibleAlpha * (1.18 + 0.22 * distSpread) * glowBoost;

  // 火光对暗部羽毛的反弹照明：越靠近翼下火舌、背部火冕与尾端越亮，使暗部羽片纹理清晰可辨
  float fireBounce = clamp(
    0.35
    + 0.55 * smoothstep(0.30, 0.95, chordFrac) * inWingSpan
    + 0.50 * exp(- pow((bp.y - 0.020) / 0.022, 2.0)) * (1.0 - smoothstep(0.02, 0.05, sx))
    + 0.25 * focalAuraWeight,
    0.0, 1.3
  ) * (0.85 + 0.15 * uLightPulse);
  vec3 deepShadowPlumage = mix(vec3(0.024, 0.018, 0.016), uStageDark * 0.30 + uFireDeep * 0.12, 0.50);

  // 4. 写实羽毛与三维雕塑体块：保持无动态外层分支平铺，避免 D3D11 fxc 谓词化含循环代码块导致编译膨胀
  float silhouetteAlpha = birdMask * outerBoundsFade;
  float beakMask = 1.0 - smoothstep(-0.0004, 0.0006, dBeak);
  float covertGrade = smoothstep(0.05, 0.55, chordFrac);
  vec2 covertQ = vec2(uClamped * mix(40.0, 26.0, covertGrade) + sideIdx * 17.3, chordFrac * mix(13.0, 8.0, covertGrade));
  covertQ += (vec2(noise2(covertQ * 0.35 + vec2(2.1, 7.3)), noise2(covertQ * 0.41 + vec2(9.4, 1.6))) - 0.5) * vec2(1.1, 0.8);
  float bodyScaleK = mix(150.0, 225.0, smoothstep(0.010, 0.040, bp.y));
  vec2 bodyQ = vec2(bp.x * bodyScaleK * 1.15 + 0.6 * sin(bp.y * 140.0), -bp.y * bodyScaleK + 3.0);
  bodyQ += (vec2(noise2(bodyQ * 0.33 + vec2(4.4, 0.7)), noise2(bodyQ * 0.37 + vec2(1.9, 6.2))) - 0.5) * vec2(1.0, 0.7);
  vec3 covertScale = vec3(0.0);
  vec3 bodyScale = vec3(0.0);
  for (int fs = uZero; fs < 2; fs++) {
    vec3 sv = featherScales(fs == 0 ? covertQ : bodyQ);
    if (fs == 0) covertScale = sv;
    else bodyScale = sv;
  }
  float plumageVis = 0.35 + 0.65 * smoothstep(0.32, 0.72, noise2(vec2(bp.x * 42.0 + sideIdx * 3.3, bp.y * 36.0)));
  float inCovertZone = smoothstep(0.08, 0.20, chordFrac)
                     * (1.0 - smoothstep(0.52 + covertMarginMod, 0.70 + covertMarginMod, chordFrac))
                     * inWingSpan * (1.0 - smoothstep(0.80, 0.98, u)) * plumageVis;
  float inBodyZone = (1.0 - smoothstep(-0.0010, 0.0016, dCoreBody)) * (1.0 - beakMask) * plumageVis;

  float covertLowerRimFire = smoothstep(0.32, 0.76, chordFrac)
                           * (1.0 - smoothstep(0.82, 1.15, chordFrac))
                           * (0.30 + 0.90 * covertScale.x)
                           * smoothstep(0.08, 0.20, u)
                           * inWingSpan;

  float inFlightZone = smoothstep(0.03, 0.16, bestFeatAlong) * inWingSpan;
  float featherShadowPatch = smoothstep(0.26, 0.70, noise2(vec2(bp.x * 34.0 + sideIdx * 4.1, bp.y * 28.0 - uTime * 0.45)));
  float featVaneRelief = clamp(
    (0.36 + 0.48 * bestFeatVane) * (1.0 - 0.76 * occluderShadow) * (0.52 + 0.48 * featherShadowPatch),
    0.0,
    1.0
  ) * inFlightZone;

  float featherHash = hash21(vec2(bestFeatDepth * 13.0, sideIdx + 0.5));
  float barbPhase = bestFeatAlong * bestFeatLen * 270.0 - abs(bestFeatVane) * 1.7 + featherHash * 6.0
                  + 0.8 * noise2(vec2(bestFeatAlong * 9.0, bestFeatVane * 2.0 + featherHash * 7.0));
  float barbs = 0.5 + 0.5 * sin(barbPhase * 6.2831853);
  float rachisLine = (1.0 - smoothstep(0.0, 0.14, abs(bestFeatVane))) * smoothstep(0.05, 0.30, bestFeatAlong) * (1.0 - smoothstep(0.82, 1.0, bestFeatAlong));
  float vaneSplit = smoothstep(0.62, 0.95, bestFeatAlong) * smoothstep(0.58, 0.82, noise2(vec2(bestFeatVane * 3.2 + featherHash * 9.0, bestFeatAlong * 16.0)));
  float flightFibre = mix(1.0, (0.84 + 0.16 * barbs) * (1.0 - 0.28 * rachisLine) * (1.0 - 0.38 * vaneSplit), inFlightZone);

  float oneSidedFeatherEdge = exp(- pow((bestFeatVane - 0.55) / 0.30, 2.0))
    * smoothstep(0.16, 0.72, bestFeatAlong)
    * (1.0 - 0.85 * occluderShadow)
    * featherShadowPatch;
  float featherTipTranslucency = smoothstep(0.28, 0.88, bestFeatAlong)
    * (0.46 + 0.54 * max(0.0, bestFeatVane + 0.35))
    * (1.0 - 0.65 * occluderShadow)
    * inFlightZone;
  float lowerWingFeatherBurn = smoothstep(0.46 + covertMarginMod * 0.7, 0.90, chordFrac)
                             * smoothstep(0.08, 0.20, u)
                             * inWingSpan
                             * (1.0 - 0.62 * occluderShadow)
                             * (0.52 + 0.48 * flameIntermittency);
  float upperBackGlow = exp(- pow(sx / 0.038, 2.0) - pow((bp.y - 0.016) / 0.018, 2.0)) * (0.50 + 0.50 * uMed);

  float selectiveFeatherFire = (
    (oneSidedFeatherEdge * (0.36 + 0.64 * bestFeatEdgeFire) * 0.80 + covertLowerRimFire * (0.50 + 0.50 * flameIntermittency) * 0.78) * (0.46 + 0.60 * barbFire) +
    (featherTipTranslucency * mix(0.68, 1.18, wingtipBoost) + lowerWingFeatherBurn * 0.62) * (0.50 + 0.54 * max(barbFire, fgRidgeDetail)) +
    upperBackGlow * 0.68
  ) * (1.0 - 0.88 * bodyAndRootShadowMass) * flightFibre;

  float burningFeathersMask = birdMask * clamp(
    selectiveFeatherFire + (tailTipFireGlow * (1.0 - 0.68 * tailFrontOcclusion) * 0.88 + crestTipGlow * 0.32) * (0.50 + 0.50 * fgRidgeDetail),
    0.0,
    1.28
  );

  float shoulderCamber = exp(- pow((chordFrac - 0.20) / 0.16, 2.0)) * inWingSpan * (1.0 - 0.55 * bodyAndRootShadowMass);
  float scaleRelief = covertScale.y * inCovertZone * 0.18 + bodyScale.y * inBodyZone * 0.14;
  float scaleRim = covertScale.x * inCovertZone + bodyScale.x * inBodyZone * 0.75;
  float scaleRachis = covertScale.z * inCovertZone * 0.25 + bodyScale.z * inBodyZone * 0.15;

  float neckCamber = exp(- pow(abs(bp.x - neckCenterX) / max(neckHalfW, 0.003), 2.0)) * smoothstep(0.024, 0.065, bp.y);
  float feather3DThickness = clamp(
    (0.12 + 0.26 * shoulderCamber + 0.38 * featVaneRelief * flightFibre + scaleRelief + 0.22 * tailFeatherRelief + 0.22 * neckCamber)
    * (1.0 - 0.45 * bodyAndRootShadowMass)
    * (1.0 - 0.55 * tailBackLayerMask),
    0.04,
    0.95
  );

  vec3 warmSculptPlumage = mix(uStageDark * 0.35, mix(uFireDeep, uFireMid, 0.50), 0.45);
  vec3 basePlumage = mix(deepShadowPlumage, warmSculptPlumage, feather3DThickness);
  basePlumage += leadAmbient(0.42) * scaleRim * fireBounce * 0.055;
  basePlumage *= 1.0 - 0.18 * scaleRachis;
  float downTex = noise2(bp * 360.0 + vec2(sideIdx * 2.7, 0.0)) * 0.55 + noise2(bp * 520.0 + vec2(3.1, 5.9)) * 0.45;
  basePlumage *= 0.90 + 0.20 * downTex * clamp(inBodyZone + inCovertZone * 0.6, 0.0, 1.0);

  float cereMask = beakMask * smoothstep(0.38, 0.06, bAlong) * smoothstep(-0.0050, -0.0008, bq.x);
  float mouthLine = beakMask * (1.0 - smoothstep(0.0002, 0.0007, abs(bq.y - (-0.0020 - 0.0012 * bAlong))));
  vec2 eyePos = headCenter + rot2D(vec2(-0.0044, 0.0018), 0.16);
  vec2 eyeLocal = rot2D(bp - eyePos, -0.22) * vec2(0.95, 1.65);
  float eyeDist = length(eyeLocal);
  float eyeSocketAO = exp(- (eyeDist * eyeDist) / (0.0038 * 0.0038));
  float irisOuter = exp(- pow((eyeDist - 0.0012) / 0.00030, 2.0));
  float irisInner = exp(- pow((eyeDist - 0.0008) / 0.00025, 2.0));
  float eyePupil = 1.0 - smoothstep(0.00035, 0.00060, eyeDist);
  float eyeSpecular = exp(- dot(eyeLocal - vec2(-0.00035, 0.00032), eyeLocal - vec2(-0.00035, 0.00032)) / (0.00025 * 0.00025));

  float headEdgeRim = smoothstep(-0.0016, -0.0001, dFullBird) * (1.0 - smoothstep(-0.0001, 0.0010, dFullBird))
                    * smoothstep(0.046, 0.066, bp.y)
                    * max(0.0, -hp.x * 0.45 + hp.y * 0.85 + 0.20)
                    * (1.0 - beakMask * 0.70);
  vec3 rimLightCol = leadColor(0.88, wBPhx) * (headEdgeRim * 0.95 + crestTipGlow * 0.85) * (1.0 + 0.25 * effBright);

  float inSkullArea = (1.0 - smoothstep(-0.0005, 0.0018, dSkull)) * (1.0 - beakMask);
  float browHighlight = exp(- pow((browLine + 0.0014) / 0.0009, 2.0)) * smoothstep(-0.007, 0.003, hp.x) * inSkullArea;
  vec3 browCol = leadColor(0.78, wBPhx) * browHighlight * 0.32;

  vec3 crestPlumageCol = (leadColor(0.72, wBPhx) * crestFeatherRelief * 0.32 + leadColor(0.96, wBPhx) * crestTipGlow * 0.90)
                       * (1.0 - smoothstep(-0.0004, 0.0010, dCrest));

  vec3 cereCol = mix(vec3(0.52, 0.36, 0.12), leadColor(0.75, wBPhx), 0.45) * cereMask * (0.85 + 0.20 * effBright);
  float beakRidge = exp(- pow((bq.y - beakCurveY - beakHalfH * 0.52) / 0.00065, 2.0)) * smoothstep(0.06, 0.72, bAlong);
  vec3 beakHornBase = mix(uStageDark * 0.22, mix(uFireDeep, uSmokeWarm, 0.40), 0.45);
  vec3 beakCol = beakMask * (
    (beakHornBase + leadColor(0.92, wBPhx) * beakRidge * 0.90 * (1.10 + 0.25 * effBright)) * (1.0 - mouthLine * 0.75)
    * (1.0 - cereMask) + cereCol
  );

  vec3 irisCol = mix(leadColor(0.78, wBPhx), leadColor(0.95, wBPhx), irisInner) * irisOuter;
  vec3 eyeCol = (1.0 - eyeSocketAO * 0.65) * (
    irisCol * (1.0 - eyePupil) * 1.35
    + vec3(1.0, 0.98, 0.94) * eyeSpecular * 1.65
  ) * (1.0 - beakMask);

  vec3 veinFlameCol = leadColor(clamp(burningFeathersMask * 0.80, 0.0, 1.0) * (0.84 + 0.16 * max(wingtipBoost, smoothstep(0.40, 0.82, chordFrac))), wBPhx);
  vec3 litPlumage = basePlumage
    + veinFlameCol * burningFeathersMask * (1.16 + 0.22 * distSpread) * effBright * glowBoost
    + rimLightCol + browCol + crestPlumageCol + beakCol + eyeCol;

  // 5. 围绕翅膀与尾羽周围飞散的微细余烬颗粒 (Embers)
  vec2 emberUv = bp * 68.0 + vec2(sideSign * fireClock * 0.45, fireClock * 0.85);
  vec2 emberCell = floor(emberUv);
  vec2 emberFrac = fract(emberUv) - 0.5;
  vec2 emberRnd = hash22(emberCell + vec2(17.3, 29.1));
  float emberDist = length(emberFrac - (emberRnd - 0.5) * 0.55);
  float emberSpark = (1.0 - smoothstep(0.04, 0.14, emberDist))
    * step(0.84, emberRnd.x)
    * exp(- max(0.0, dFullBird) / 0.028)
    * (1.0 - birdMask * 0.75)
    * focalAuraWeight
    * outerBoundsFade;
  vec3 emberRgb = leadColor(0.74 + 0.26 * emberRnd.y, wBPhx) * emberSpark * 0.90 * effBright * glowBoost;

  // 6. 轮廓外侧半透明的蓬松绒羽（身体、颈部与头部），被背后火光透射出细软纤维
  vec2 fluffC = bp - vec2(0.0, 0.010);
  float fluffAng = atan(fluffC.y, fluffC.x);
  float fibre = noise2(vec2(fluffAng * 14.0, length(fluffC) * 160.0 - uTime * 0.2));
  float fluffBand = (1.0 - smoothstep(0.0, 0.0032, dCoreBody)) * smoothstep(-0.0006, 0.0006, dCoreBody);
  float fluff = fluffBand * smoothstep(0.35, 0.75, fibre) * smoothstep(0.0, 0.003, dWingCombined) * (1.0 - beakNear) * outerBoundsFade;
  vec3 fluffRgb = mix(deepShadowPlumage, leadAmbient(0.35) * 0.55, clamp(0.30 + 0.45 * fireBounce, 0.0, 1.0)) * fluff;

  vec3 totalRgb = bgFireRgb + litPlumage * silhouetteAlpha + fgFireRgb + emberRgb + fluffRgb * (1.0 - birdMask);
  float flameOcclusion = clamp(bgTongueMask * (1.0 - birdMask) * 0.70 + fgVisibleAlpha * 0.76 + emberSpark * 0.50 + fluff * 0.55 * (1.0 - birdMask), 0.0, 0.90);
  float totalAlpha = max(silhouetteAlpha, flameOcclusion);
  return vec4(totalRgb, totalAlpha);
}
`;

const PHOENIX_STAGE_PART = /* glsl */ `
// ── 2. 拔地而起的中央舞台 LED 巨幕背景显示屏 (Ground-Standing Stage LED Video Wall) ──
/**
 * 直接立在地面 (STAGE_HORIZON_Y = 0.3600) 并耸立于 DJ 台正后方，尺寸宏大、结构扎实，彻底消除悬空割裂感！
 * 1) 底部牢固接触地面，并带有深色舞台地台桁架与地面接触阴影；
 * 2) 封面充满整个大屏幕（四周模糊化并延展过渡，彻底消除矩形硬切与方框感）；
 * 3) 中央 1:1 清晰展示专辑封面主体，与外围延展模糊底图以超宽平滑高斯羽化融合；
 * 4) 电子大屏边缘柔和融入舞台大气烟雾，与整体舞台浑然一体。
 */
void evaluateGiganticGroundScreen(
  vec2 lensUv,
  float softBlurField,
  inout vec3 stageCol
) {
  float screenBottom = ${STAGE_HORIZON_Y.toFixed(4)};
  float screenTop    = 0.9400;
  float screenH      = screenTop - screenBottom; // 0.5800 顶天立地大屏
  float screenCenterY = (screenBottom + screenTop) * 0.5; // 0.6500
  float screenHalfH   = screenH * 0.5; // 0.2900
  float screenCenterX = 0.50 - uCamShift * 0.04;
  
  // 舞台巨幕半宽 (宏大宽幅大屏，气势磅礴)
  float screenHalfW = 0.235;

  vec2 dScreen = abs(vec2(lensUv.x - screenCenterX, lensUv.y - screenCenterY)) - vec2(screenHalfW, screenHalfH);
  float screenBoxDist = length(max(dScreen, 0.0)) + min(max(dScreen.x, dScreen.y), 0.0);

  if (screenBoxDist < 0.018 && lensUv.y >= screenBottom) {
    float inScreen = 1.0 - smoothstep(-0.0015, 0.0025, screenBoxDist);

    // 屏幕归一化 UV (0..1)
    vec2 scrUv = vec2(
      (lensUv.x - (screenCenterX - screenHalfW)) / (screenHalfW * 2.0),
      (lensUv.y - screenBottom) / screenH
    );

    // 1. 全屏延展光学模糊底图 (Aspect-Fill Extended Ambient Cover)
    // 封面按宽高比充满整个大屏幕，四周向外延伸，消除黑边与任何内层矩形框
    float fillScale = max(1.0, (screenHalfW * 2.0 * uAspect) / screenH);
    vec2 fillUv = (scrUv - 0.5) * vec2(1.0, 1.0 / fillScale) + 0.5;
    vec2 cFillClamped = clamp(fillUv, 0.005, 0.995);

    // 深度柔和的大面积光学景深模糊采样
    vec3 bgBlurred = 0.20 * textureLod(uCover, cFillClamped, 0.0).rgb;
    bgBlurred += 0.16 * textureLod(uCover, clamp(cFillClamped + vec2( 0.022,  0.016), 0.005, 0.995), 0.0).rgb;
    bgBlurred += 0.16 * textureLod(uCover, clamp(cFillClamped + vec2(-0.022,  0.016), 0.005, 0.995), 0.0).rgb;
    bgBlurred += 0.16 * textureLod(uCover, clamp(cFillClamped + vec2( 0.018, -0.022), 0.005, 0.995), 0.0).rgb;
    bgBlurred += 0.16 * textureLod(uCover, clamp(cFillClamped + vec2(-0.018, -0.022), 0.005, 0.995), 0.0).rgb;
    bgBlurred += 0.16 * textureLod(uCover, clamp(cFillClamped + vec2( 0.000,  0.028), 0.005, 0.995), 0.0).rgb;
    // 环境底色微调，与舞台深邃基调融为一体
    bgBlurred = mix(uStageDark * 0.28, bgBlurred, 0.85);

    // 2. 中央 1:1 清晰封面展示 (不压缩、不拉伸、完整保真)
    float coverScaleY = 0.84;
    float coverScaleX = coverScaleY * (screenH / (screenHalfW * 2.0 * uAspect));
    vec2 coverLocalUv = (scrUv - vec2(0.5, 0.55)) / vec2(coverScaleX, coverScaleY) + vec2(0.5);

    vec2 cUv = clamp(coverLocalUv, 0.005, 0.995);
    float opticalSoft = clamp(softBlurField * 0.20, 0.0, 0.30);
    vec3 clearCoverCol = textureLod(uCover, cUv, 0.0).rgb;
    if (opticalSoft > 0.02) {
      vec2 bOff = vec2(0.0015, 0.0018) * opticalSoft;
      vec3 cBlur = 0.25 * (
        textureLod(uCover, clamp(cUv + bOff, 0.005, 0.995), 0.0).rgb +
        textureLod(uCover, clamp(cUv - bOff, 0.005, 0.995), 0.0).rgb +
        textureLod(uCover, clamp(cUv + vec2(-bOff.x, bOff.y), 0.005, 0.995), 0.0).rgb +
        textureLod(uCover, clamp(cUv + vec2(bOff.x, -bOff.y), 0.005, 0.995), 0.0).rgb
      );
      clearCoverCol = mix(clearCoverCol, cBlur, opticalSoft * 0.40);
    }

    // 3. 超宽平滑高斯羽化混合 (消除所有矩形切割线条与直角硬边!)
    // 计算距离中央清晰区域四边的距离，使用宽达 0.18 的平滑连续过渡带
    vec2 dCenter = abs(coverLocalUv - 0.5);
    float edgeBoxDist = max(dCenter.x - 0.44, dCenter.y - 0.44);
    float clearWeight = 1.0 - smoothstep(-0.14, 0.06, edgeBoxDist);

    // 清晰封面极其平滑自然地消融至全屏延展模糊背景中，绝无突兀边界
    vec3 displayCol = mix(bgBlurred, clearCoverCol, clearWeight);

    // 屏幕边缘暗角与哑光金属结构框 (柔和边缘，不造成突兀刀切线)
    float scrVignette = smoothstep(0.0, 0.035, scrUv.x) * smoothstep(1.0, 0.965, scrUv.x)
                      * smoothstep(0.0, 0.038, scrUv.y) * smoothstep(1.0, 0.962, scrUv.y);
    float screenIllum = 0.76 + 0.14 * uPortalGlow + 0.08 * uSpeakerPulse;

    // 舞台巨幕底座金属桁架与立地接触阴影 (Ground Truss & Contact Base)
    float baseGroundShadow = smoothstep(0.0, 0.045, scrUv.y);
    float baseTrussEdge = exp(- pow((lensUv.y - screenBottom) / 0.0045, 2.0));

    vec3 finalScreen = mix(uStageDark * 0.35, displayCol * screenIllum, 0.18 + 0.82 * scrVignette);
    finalScreen *= 0.72 + 0.28 * baseGroundShadow;
    // 底座金属横梁高光
    finalScreen += mix(uStageDark, uSmokeWarm, 0.55) * baseTrussEdge * 0.32;

    // 外边框发光
    float bezelBorder = exp(- pow(screenBoxDist / 0.0022, 2.0));
    finalScreen += mix(uStageDark, uSmokeWarm, 0.40) * bezelBorder * 0.22;

    stageCol = mix(stageCol, finalScreen, inScreen * 0.95);
  }
}

// ── 2B. 复刻参考封面结构的巨型立体音响 (饱满的大光圈、单一主大圆单元、统一透视、内凹振膜与三层能量光环!) ──
void evaluateGiantSpeaker(
  vec2 lensUv,
  vec2 heatUv,
  float softBlurField,
  vec2 ringCenter,
  float side,
  inout vec3 stageCol
) {
  // 空间包围盒粗筛早退：远离音箱本体与光晕影响区域的像素立即退出，使全屏中央与对侧像素开销减半
  vec2 dpDistCheck = vec2((lensUv.x - ringCenter.x) * uAspect, lensUv.y - ringCenter.y);
  if (abs(dpDistCheck.x) > 0.35 || abs(dpDistCheck.y) > 0.42) {
    return;
  }

  // 1. 核对参考封面的箱体比例与朝向透视：
  // 参考封面中音箱为稳重的暗色三维长方体，略向舞台中央内倾，内侧立面与顶面转角清晰可见，
  // 发光大圆环几乎撑满正面板宽度（约 90%），光圈粗壮饱满，上方无醒目小圆单元。
  float cabBottom = ${STAGE_HORIZON_Y.toFixed(4)};
  float cabTop = 0.756;
  float baffleHalfW = 0.0640; // 正面板半宽 (16:9 下对应高度单位宽度 2 * 0.0640 * 1.7778 = 0.2276)
  float sideWallW   = 0.0165; // 朝向舞台内侧的三维箱体侧面厚度

  // 音箱正面板 X 范围与内侧立面 X 范围 (side = -1 为左音箱，内侧在右 +x；side = +1 为右音箱，内侧在左 -x)
  float dxFromCenter = lensUv.x - ringCenter.x;
  // alongInward > 0 表示朝向舞台中央（内侧），alongInward < 0 表示朝向画面外侧
  float alongInward = -dxFromCenter * side;

  // 正面板水平归一化坐标 (-1 = 外侧边缘, +1 = 内侧正面棱线)
  float baffleNormX = clamp(alongInward / baffleHalfW, -1.5, 1.5);
  // 侧立面水平归一化坐标 (0 = 内侧正面棱线, 1 = 内侧背面后缘)
  float sideWallNormX = (alongInward - baffleHalfW) / sideWallW;

  // 透视顶边：正面板顶边向舞台内侧微微倾斜，侧立面顶边向深处进一步透视下倾
  float topFrontY = cabTop - 0.0075 * clamp(baffleNormX, -1.0, 1.0);
  float topSideY  = (cabTop - 0.0075) - 0.0150 * clamp(sideWallNormX, 0.0, 1.0);

  // 光圈色块：沿圆环平滑流动的 A / B 两组 Lead 代表色，过渡带极其柔和连续，杜绝任何径向直线硬切
  vec2 dpRawEarly = vec2((heatUv.x - ringCenter.x) * uAspect, heatUv.y - ringCenter.y);
  float ringAngle = atan(dpRawEarly.y, dpRawEarly.x);
  // 平滑双谐波流动波形，保证全圆周 2*PI 连续无缝
  float angWave1 = sin(ringAngle + uTime * 0.15 * side);
  float angWave2 = sin(ringAngle * 2.0 - uTime * 0.10 * side + 1.2) * 0.45;
  float angCombined = (angWave1 + angWave2) / 1.45; // -1 .. +1
  // 结合 uLeadShareB，提供宽达 0.60 的极宽羽化过渡带，使两种颜色如环形呼吸般平滑过渡
  float shareShift = (uLeadShareB - 0.5) * 1.3;
  float wBRing = smoothstep(shareShift - 0.55, shareShift + 0.55, angCombined);
  float wBAmbient = smoothstep(0.35, 0.65, uLeadShareB);
  // 光圈强度：常态即饱满明亮，随底鼓/Lead 主音色起音与 Drop 律动呼吸
  float ringIntensity = (0.92 + 0.28 * uSpeakerPulse + 0.16 * uLeadGlow + 0.32 * uLeadPulse + 0.10 * uSpeakerBass + 0.10 * uDropIntensity) * uLightPulse;

  // 预计算大圆单元透视几何与箱体遮罩，使音箱内全部 5 次 4 八度噪声合并为单一 sampleOctave4 调用点
  vec2 dpRaw  = dpRawEarly;
  vec2 dpLens = vec2((lensUv.x - ringCenter.x) * uAspect, lensUv.y - ringCenter.y);
  vec2 dpPersp     = vec2(dpRaw.x * 1.065, dpRaw.y + dpRaw.x * side * 0.036);
  vec2 dpLensPersp = vec2(dpLens.x * 1.065, dpLens.y + dpLens.x * side * 0.036);
  float rPersp     = length(dpPersp);
  float rLensPersp = length(dpLensPersp);
  float coneExcursion = 1.0 + 0.032 * uSpeakerPulse + 0.018 * uLeadPulse + 0.013 * uSpeakerBass * sin(uTime * 52.0);
  float ringRadius = 0.1035 * coneExcursion;
  vec2 recessOffset = vec2(side * 0.0064, -0.0017);
  vec2 dpCone = dpLensPersp - recessOffset;
  float rCone = length(dpCone);
  bool needCone = rLensPersp < ringRadius * 1.04;

  float inFrontX = 0.0, inFrontY = 0.0, inFrontBaffle = 0.0, inSideWall = 0.0, inCabinet = 0.0;
  float cabNormY = clamp((lensUv.y - cabBottom) / (cabTop - cabBottom), 0.0, 1.0);
  bool inVerticalSpan = lensUv.y >= cabBottom && lensUv.y <= cabTop + 0.014;
  if (inVerticalSpan && alongInward >= -baffleHalfW - 0.012 && alongInward <= baffleHalfW + sideWallW + 0.012) {
    inFrontX = smoothstep(-baffleHalfW - 0.0018, -baffleHalfW + 0.0012, alongInward)
             * (1.0 - smoothstep(baffleHalfW - 0.0010, baffleHalfW + 0.0012, alongInward));
    inFrontY = smoothstep(cabBottom - 0.001, cabBottom + 0.002, lensUv.y)
             * (1.0 - smoothstep(topFrontY - 0.0020, topFrontY + 0.0015, lensUv.y));
    inFrontBaffle = inFrontX * inFrontY;

    float inSideX = smoothstep(baffleHalfW - 0.0010, baffleHalfW + 0.0012, alongInward)
                  * (1.0 - smoothstep(baffleHalfW + sideWallW - 0.0015, baffleHalfW + sideWallW + 0.0018, alongInward));
    float inSideY = smoothstep(cabBottom - 0.001, cabBottom + 0.002, lensUv.y)
                  * (1.0 - smoothstep(topSideY - 0.0020, topSideY + 0.0015, lensUv.y));
    inSideWall = inSideX * inSideY;
    inCabinet = clamp(inFrontBaffle + inSideWall, 0.0, 1.0);
  }

  vec2 innerSmokeUv = dpCone * 15.0 + vec2(-side * uTime * 0.28, -uTime * 0.36);
  vec2 ringPlaneUv = dpPersp * 20.0;
  float bottomMistNoise = 0.0, innerWisp1 = 0.0, innerWisp2 = 0.0, circumFire1 = 0.0, circumFire2 = 0.0;
  for (int sn = uZero; sn < 5; sn++) {
    if (sn == 0 && inCabinet <= 0.001) continue;
    if ((sn == 1 || sn == 2) && !needCone) continue;
    vec2 sp = sn == 0 ? vec2(alongInward * uAspect * 16.0 + side * 2.1, cabNormY * 12.0 - uTime * 0.35)
      : sn == 1 ? (innerSmokeUv + vec2(1.9, 4.3))
      : sn == 2 ? (innerSmokeUv * 1.85 - vec2(uTime * 0.22, -uTime * 0.30))
      : sn == 3 ? (ringPlaneUv + vec2(side * 3.1, -uTime * 1.15))
      : (ringPlaneUv * 2.15 + vec2(-uTime * 0.85, uTime * 1.40 + side * 5.7));
    bool isF = sn == 1 || sn >= 3;
    float sv = sampleOctave4(sp, isF);
    if (sn == 0) bottomMistNoise = sv;
    else if (sn == 1) innerWisp1 = sv;
    else if (sn == 2) innerWisp2 = sv;
    else if (sn == 3) circumFire1 = sv;
    else circumFire2 = sv;
  }

  if (inCabinet > 0.001) {
    // 克制的暗色哑光箱体表面：仅保留远景下细腻自然的声学暗面微肌理
    vec2 microUv = vec2(alongInward * uAspect * 95.0, (lensUv.y - cabBottom) * 95.0);
    float fineGrain = noise2(microUv) * 0.60 + noise2(microUv * 2.3 + vec2(7.1, 3.9)) * 0.40;
    float subtleBaffleTex = 0.94 + 0.12 * (fineGrain - 0.5);

    // 正面板与内侧立面的明暗体积区分
    vec3 frontBaseCol = mix(vec3(0.011, 0.011, 0.013), uStageDark * 0.52, 0.48) * subtleBaffleTex;
    vec3 sideBaseCol  = mix(vec3(0.005, 0.005, 0.007), uStageDark * 0.28, 0.42) * (0.92 + 0.08 * fineGrain);

    // 上方区域保持干净暗面（上方小圆单元仅留极微弱的暗部结构暗示 < 2%）
    vec2 upperHintP = vec2((lensUv.x - ringCenter.x) * uAspect, lensUv.y - (cabBottom + 0.354));
    float upperShadowHint = exp(- pow((length(upperHintP) - 0.020) / 0.005, 2.0)) * 0.05;
    frontBaseCol *= 1.0 - upperShadowHint * inFrontBaffle;

    // 正面与内侧立面交界处的三维转折棱线（局部受光，非整圈等亮描边）
    float innerCornerEdge = exp(- pow((alongInward - baffleHalfW) / 0.0022, 2.0)) * inFrontY;
    float ringHeightProximity = exp(- pow((lensUv.y - ringCenter.y) / 0.160, 2.0));
    float topCornerBevel = exp(- pow((lensUv.y - topFrontY) / 0.0028, 2.0)) * inFrontX * (0.35 + 0.65 * smoothstep(-0.6, 0.9, baffleNormX));

    // 音箱底部保留深色箱体剪影与适度暖雾反光（主要底部暖光交由前景体积烟雾自然漫射）
    float bottomMistY = (1.0 - smoothstep(0.02, 0.28, cabNormY)) * smoothstep(0.0, 0.045, cabNormY);
    float bottomHorizBell = smoothstep(-0.78, 0.05, baffleNormX) * (1.0 - smoothstep(0.45, 0.96, baffleNormX));
    float basePoolGlow = bottomMistY * bottomHorizBell * (0.50 + 0.50 * bottomMistNoise);
    float floorContactAO = smoothstep(0.0, 0.024, cabNormY);

    vec3 cabCol = mix(frontBaseCol, sideBaseCol, inSideWall);

    // 内侧立面受舞台中央背光与凤凰火光的微弱侧照
    float sideStageLight = (1.0 - clamp(sideWallNormX, 0.0, 1.0)) * (0.35 + 0.65 * (1.0 - cabNormY)) * (0.30 + 0.25 * uPortalGlow);
    cabCol += mix(uStageDark, uSmokeWarm, 0.48) * sideStageLight * inSideWall * 0.16;

    // 三维转角棱线受光（受光圈的主导 Lead 代表色照射）与底部柔和漫射受光
    vec3 cornerSpec = mix(uStageDark, uSmokeWarm, 0.62) * (0.14 + 0.38 * ringHeightProximity) + leadAmbient(0.55) * (0.22 * ringHeightProximity * uLightPulse);
    cabCol += cornerSpec * (innerCornerEdge * 0.42 + topCornerBevel * 0.20);
    cabCol += mix(uSmokeWarm, leadAmbient(0.70), 0.5) * 0.16 * basePoolGlow * inFrontBaffle * (0.72 + 0.28 * uSpeakerPulse);
    cabCol *= 0.55 + 0.45 * floorContactAO;

    stageCol = mix(stageCol, cabCol, inCabinet * 0.96);
  }

  // 2. 统一透视关系的大圆单元、内凹边壁与凹面振膜
  if (needCone) {
    float inAperture = 1.0 - smoothstep(ringRadius * 0.985, ringRadius * 1.025, rLensPersp);
    float normR = clamp(rCone / max(ringRadius, 1e-4), 0.0, 1.15);
    vec2 coneDir = dpCone / max(rCone, 1e-5);

    // A. 单元嵌入箱体的内凹筒壁：外侧方向露出内凹厚度并接收光环强掠射光，内侧产生遮挡暗边
    float rimExposure = clamp(dot(dpLensPersp / max(rLensPersp, 1e-5), vec2(side, -0.15)), -1.0, 1.0);
    float inRecessWall = smoothstep(0.86, 0.99, rLensPersp / ringRadius) * smoothstep(-0.2, 0.9, rimExposure);

    // B. 振膜边缘悬边：柔和的半圆弧悬边立体明暗
    float surroundT = (normR - 0.905) / 0.065;
    float inSurround = exp(- surroundT * surroundT * 1.8) * smoothstep(0.80, 0.86, normR);
    float surroundLight = 0.45 + 0.55 * clamp(dot(coneDir, vec2(side * 0.85, -0.52)), -1.0, 1.0);

    // C. 凹面振膜主体与中心防尘帽结构
    float bowlSlope = smoothstep(0.18, 0.88, normR);
    float concaveGrazing = clamp(dot(coneDir, vec2(side * 0.92, -0.38)), -1.0, 1.0);
    float bowlIllum = smoothstep(-0.35, 0.85, concaveGrazing) * pow(bowlSlope, 1.15);

    float inCenterCap = 1.0 - smoothstep(0.19, 0.26, normR);
    float capHighlight = clamp(dot(coneDir, vec2(-side * 0.75, 0.65)), 0.0, 1.0) * smoothstep(0.02, 0.22, normR) * inCenterCap;
    float capSeamShadow = exp(- pow((normR - 0.225) / 0.028, 2.0));

    float coneMicro = noise2(dpCone * 140.0) * 0.5 + noise2(dpCone * 290.0 + vec2(3.7, 8.1)) * 0.5;
    vec3 coneDarkBase = mix(vec3(0.010, 0.009, 0.011), uStageDark * 0.40, 0.50) * (0.90 + 0.16 * coneMicro);

    // 圆环内部的能量烟火丝缕与凹面受光（参考封面中圆环内部被火光与飞散余烬充盈）
    float innerEnergyFilaments = smoothstep(0.34, 0.82, innerWisp1 * 0.62 + innerWisp2 * 0.38)
                               * (0.30 + 0.70 * smoothstep(0.10, 0.92, normR));

    // 内圈火光充盈：从光圈内缘向内柔和衰减，远离中心防尘帽（保留中心深色凹面振膜与防尘帽立体机械结构!）
    float inwardDist = max(0.0, ringRadius - rLensPersp);
    float innerCoronaFill = exp(- inwardDist / 0.018) * smoothstep(0.26, 0.88, normR) * (0.60 + 0.40 * innerWisp2);
    // 圆环内部飞散的细小余烬
    vec2 sparkUv = dpCone * 95.0 + vec2(side * uTime * 0.9, uTime * 1.6);
    vec2 sparkCell = floor(sparkUv);
    vec2 sparkRnd = hash22(sparkCell + vec2(side * 11.0, 5.0));
    float sparkD = length(fract(sparkUv) - 0.5 - (sparkRnd - 0.5) * 0.6);
    float innerSparks = (1.0 - smoothstep(0.05, 0.16, sparkD)) * step(0.86, sparkRnd.x) * smoothstep(0.25, 0.85, normR);

    // 振膜内部受光：紧贴光圈内缘处延续弧段颜色，向内迅速过渡为主导 Lead 的代表色，避免出现扇形色块
    float wBCone = mix(wBAmbient, wBRing, smoothstep(0.90, 0.985, normR));
    vec3 coneCol = coneDarkBase * (1.0 - 0.38 * capSeamShadow);
    vec3 warmConeLight = leadColor(0.40, wBCone) * (0.72 + 0.28 * uSpeakerPulse);
    coneCol += warmConeLight * (bowlIllum * 0.36 + inSurround * surroundLight * 0.42 + capHighlight * 0.24);
    coneCol += mix(uSmokeWarm, leadColor(0.70, wBCone), 0.55) * inRecessWall * (0.44 + 0.30 * uSpeakerPulse);
    coneCol += leadColor(0.30 + 0.30 * innerWisp1, wBCone) * innerEnergyFilaments * (0.16 + 0.18 * pow(normR, 1.5)) * ringIntensity * 0.65;
    coneCol += leadColor(0.50, wBCone) * innerCoronaFill * 0.20 * ringIntensity;
    coneCol += leadColor(0.80, wBCone) * innerSparks * 0.45 * ringIntensity;

    stageCol = mix(stageCol, coneCol, inAperture * 0.96);
  }

  // 3. 粗壮立体发光大圆环：内核、火焰日冕过渡与外围辉光层次清晰，强拍下保持振膜与箱体内部构造立体可读
  float circumEnergy = 0.76 + 0.38 * (circumFire1 * 0.62 + circumFire2 * 0.38);

  // 圆环边缘的不规则火苗扰动：Lead 起音时火舌外翻更明显，但圆环轮廓始终清晰可读
  float radialFlameJitter = ((circumFire1 - 0.48) * 0.0030 + (circumFire2 - 0.50) * 0.0018) * (1.0 + 0.7 * uLeadPulse);
  float signedDr = rPersp - (ringRadius + radialFlameJitter);
  float absDr = abs(signedDr);

  // 第一层：高亮内核 (Inner Core) — 控制强光下的过度泛白，保留纤细锐利的高光脊线
  float coreWidth = (0.0058 + 0.0010 * softBlurField) * (1.0 + 0.10 * uSpeakerPulse + 0.14 * uLeadPulse);
  float ringCore = exp(- (signedDr * signedDr) / max(1e-6, coreWidth * coreWidth)) * (0.86 + 0.22 * circumFire2);
  // 内核正中一线白炽高光
  float ringHotLine = exp(- (signedDr * signedDr) / max(1e-6, 0.18 * coreWidth * coreWidth));

  // 第二层：饱满的火焰能量过渡带 (Mid Transition)
  float transInnerW = 0.0105 * (1.0 + 0.12 * uSpeakerPulse + 0.16 * uLeadPulse);
  float transOuterW = 0.0165 * (1.0 + 0.16 * uSpeakerPulse + 0.20 * uLeadPulse);
  float transScale  = signedDr >= 0.0 ? transOuterW : transInnerW;
  float ringTransition = exp(- absDr / max(1e-4, transScale)) * circumEnergy;

  // 第三层：非对称消散的外围辉光 — 向外舒展，向内收敛，不吞没凹面振膜细节
  float haloScale = signedDr >= 0.0
    ? (0.038 + 0.008 * uSpeakerPulse + 0.018 * uLeadPulse + 0.005 * softBlurField)
    : (0.014 + 0.004 * uSpeakerPulse);
  float ringOuterHalo = exp(- absDr / haloScale) * (0.78 + 0.22 * circumFire1);
  // 光圈周围的空气漫射，使音箱整体饱满（范围适度，不冲淡箱体和背景）
  float wideAirGlow = exp(- max(0.0, signedDr) / 0.068) * smoothstep(-0.016, 0.010, signedDr);

  // 外侧边缘火花颗粒与圆环向外下方的局部暖雾漫射
  float sparkBand = exp(- pow(max(0.0, signedDr - 0.004) / 0.012, 2.0)) * smoothstep(0.62, 0.92, circumFire2);
  vec2 flareDir = normalize(vec2(side * 0.65, -0.76));
  float flareProj = dot(dpPersp, flareDir);
  float flareOrtho = length(dpPersp - flareDir * flareProj);
  float downwardFlare = exp(- pow(flareOrtho / 0.050, 2.0))
                      * smoothstep(-0.018, 0.042, flareProj)
                      * exp(- max(0.0, flareProj) / 0.17) * 0.18;

  // 三层光色严格取自双 Lead 封面代表色：内核 / 过渡带按圆周弧段分色；
  // 外围辉光贴近圆环处延续弧段颜色，向外逐渐过渡为主导 Lead 的代表色（光在空气中的自然散射）
  float wBHalo  = mix(wBRing, wBAmbient, smoothstep(0.002, 0.008, absDr));
  float wBTrans = mix(wBRing, wBAmbient, smoothstep(0.006, 0.016, absDr));
  vec3 ringCoreTint  = leadColor(0.74, wBRing);
  vec3 ringHotTint   = leadColor(0.97, wBRing);
  vec3 ringTransTint = leadColor(0.58, wBTrans);
  vec3 ringHaloTint  = leadColor(0.24, wBHalo);
  vec3 ringAirTint   = leadColor(0.20, wBAmbient);

  stageCol += ringAirTint * wideAirGlow * 0.045 * ringIntensity;
  stageCol += ringHaloTint * ringOuterHalo * 0.36 * ringIntensity;
  stageCol += ringAirTint * downwardFlare * 1.05 * ringIntensity;
  stageCol += ringTransTint * ringTransition * 0.82 * ringIntensity;
  stageCol += leadColor(0.58, wBAmbient) * sparkBand * 0.36 * ringIntensity;
  stageCol += ringCoreTint * ringCore * 1.15 * ringIntensity;
  stageCol += ringHotTint * ringHotLine * 0.38 * ringIntensity;
}

// ── 3. Upper Grand Stage, Central Album Cover, Atmospheric Mist & Phoenix ──
vec3 renderUpperStage(vec2 rawUv, vec2 warpedUv, float softBlurField, float bassHit) {
  vec2 uv = warpedUv;
  // Smooth camera-vibration UV for structural lines so they never develop sharp refraction creases
  vec2 lensUv = mix(rawUv, warpedUv, 0.22);
  float stageY = clamp((uv.y - ${STAGE_HORIZON_Y.toFixed(4)}) / ${(1.0 - STAGE_HORIZON_Y).toFixed(4)}, 0.0, 1.0);
  float stageX = lensUv.x + uCamShift * 0.04;

  // 1. Deep Dark Temple / Industrial Stage Backdrop
  vec3 col = uStageDark * (0.20 + 0.14 * (1.0 - stageY));

  // 1B. 拔地而起的中央舞台 LED 巨幕背景显示屏 (Ground-Standing Stage LED Video Wall)
  // 直接立在地面并耸立于 DJ 台正后方，尺寸变大、气势宏大，彻底解决悬空割裂感！
  evaluateGiganticGroundScreen(lensUv, softBlurField, col);

  // 平缓连续的垂直漫射舞台光与环境微光 (彻底消除假椭圆/圆形光圈轮廓)
  float portalShaft = exp(- pow(abs(stageX - 0.5) * uAspect / (0.36 + 0.05 * softBlurField), 2.0)) * exp(- stageY * 2.5);
  float portalCoreGlow = exp(- stageY * 3.2) * (0.45 + 0.55 * exp(- pow(abs(stageX - 0.5) * uAspect / 0.30, 2.0)));

  vec3 backlightWarm  = mix(uStageDark, uSmokeWarm, 0.76);
  vec3 backlightAmber = mix(uFireDeep, uFireMid, 0.48);
  col += backlightAmber * portalShaft * (0.16 + 0.10 * uPortalGlow);
  col += backlightWarm * portalCoreGlow * (0.28 + 0.14 * uPortalGlow);

  // 2. Render Left & Right Reference-Matched 3D Monolith Speakers
  // 合并为动态循环单调用点，避免 D3D11 fxc 将巨型音箱函数重复内联两遍
  for (int spkIdx = uZero; spkIdx < 2; spkIdx++) {
    vec2 spkCenter = spkIdx == 0 ? uLeftSpeaker : uRightSpeaker;
    float spkSide = spkIdx == 0 ? -1.0 : 1.0;
    evaluateGiantSpeaker(lensUv, uv, softBlurField, spkCenter, spkSide, col);
  }

  float topVig = smoothstep(0.68, 1.0, stageY) * (0.35 + 0.65 * pow(abs(rawUv.x - 0.5) * 2.0, 1.5));
  col *= 1.0 - 0.55 * topVig;
  return col;
}

void main() {
  vec4 refrField = evaluateAcousticAndHeatRefraction(vUv);
  vec2 warpedUv = clamp(vUv + refrField.xy, vec2(0.001), vec2(0.999));
  warpedUv.y = max(${STAGE_HORIZON_Y.toFixed(4)} + 0.001, warpedUv.y);
  vec3 col = clamp(renderUpperStage(vUv, warpedUv, refrField.z, refrField.w), 0.0, 16.0);
  fragColor = vec4(col, 1.0);
}
`;

const PHOENIX_SMOKE_PART = /* glsl */ `
float sampleAdvectedSmoke(vec2 p, vec2 baseWind, float flowClock, bool isBillow) {
  float v = 0.0;
  float a = isBillow ? 0.54 : 0.52;
  float scale = isBillow ? 2.08 : 2.05;
  vec2 shift = isBillow ? vec2(19.1, 7.3) : vec2(13.7, 29.3);
  float decay = isBillow ? 0.48 : 0.50;
  for (int i = uZero; i < 3; i++) {
    float fi = float(i);
    vec2 octWind = isBillow
      ? rot2D(baseWind, (1.0 - fi) * 0.20) * (0.82 + 0.14 * fi)
      : rot2D(baseWind, (fi - 1.0) * 0.18) * (0.85 + 0.12 * fi);
    float n = noise2(p - octWind * flowClock);
    if (isBillow) {
      float ridge = 1.0 - abs(n * 2.0 - 1.0);
      v += a * mix(n, ridge * ridge, 0.54);
    } else {
      v += a * n;
    }
    p = ROT_OCT * p * scale + shift;
    a *= decay;
  }
  return v;
}

float driftingSmokeParticleLayer(vec2 smokeUv, vec2 driftVel, float clock, float gridScale, float seedOffset) {
  vec2 p = smokeUv * gridScale - driftVel * clock + vec2(seedOffset, seedOffset * 1.618);
  vec2 baseCell = floor(p);
  vec2 f = fract(p);
  vec2 rnd = hash22(baseCell + vec2(seedOffset * 3.7, seedOffset * 5.3));
  if (rnd.x < 0.35) return 0.0;

  float phase1 = rnd.x * 6.2831853 + clock * (0.36 + 0.26 * rnd.y);
  float phase2 = rnd.y * 6.2831853 - clock * (0.28 + 0.22 * rnd.x);
  vec2 weave = vec2(0.25 * sin(phase1), 0.25 * cos(phase2));
  vec2 center = 0.5 + (rnd - 0.5) * 0.38 + weave;
  vec2 dp = f - center;

  float radius = mix(0.18, 0.36, rnd.y);
  float d2 = dot(dp * vec2(0.75, 1.25), dp * vec2(0.75, 1.25)) / (radius * radius);
  float puff = exp(- 2.4 * d2) * smoothstep(1.3, 0.12, d2);
  float breathe = 0.60 + 0.40 * sin(clock * 1.5 + rnd.y * 6.28);
  return clamp(puff * breathe * smoothstep(0.35, 0.85, rnd.x), 0.0, 1.2);
}

void main() {
  vec4 refrField = evaluateAcousticAndHeatRefraction(vUv);
  vec2 rawUv = vUv;
  vec2 warpedUv = clamp(vUv + refrField.xy, vec2(0.001), vec2(0.999));
  warpedUv.y = max(${STAGE_HORIZON_Y.toFixed(4)} + 0.001, warpedUv.y);
  float softBlurField = refrField.z;

  vec2 lensUv = mix(rawUv, warpedUv, 0.22);
  float stageY = clamp((warpedUv.y - ${STAGE_HORIZON_Y.toFixed(4)}) / ${(1.0 - STAGE_HORIZON_Y).toFixed(4)}, 0.0, 1.0);
  float stageX = lensUv.x + uCamShift * 0.04;
  float portalCoreGlow = exp(- stageY * 3.2) * (0.45 + 0.55 * exp(- pow(abs(stageX - 0.5) * uAspect / 0.30, 2.0)));

  vec2 smokeSampleUv = mix(rawUv, warpedUv, 0.28);
  vec2 smokeUv = vec2((smokeSampleUv.x - 0.5) * uAspect, smokeSampleUv.y - ${STAGE_HORIZON_Y.toFixed(4)});
  float smokeClock = uTime * 0.62 + uFlow * 0.38;

  vec2 windUpLeft  = vec2(-0.22, 0.32);
  vec2 windUpRight = vec2( 0.22, 0.32);
  float rightWeight = smoothstep(-0.32, 0.32, smokeUv.x);
  vec2 windCurrent  = mix(windUpLeft, windUpRight, rightWeight);

  vec2 warp1 = vec2(
    sin(smokeUv.y * 5.2 + smokeClock * 1.2),
    cos(smokeUv.x * 4.8 - smokeClock * 1.4)
  ) * 0.12 + (vec2(noise2(smokeUv * 3.4), noise2(smokeUv * 3.4 + vec2(4.7, 2.1))) - 0.5) * 0.22;

  float smokeBase = 0.0, smokeRidges = 0.0, blurredRidges = 0.0;
  vec2 blurShift = (warpedUv - rawUv) * 1.25 + vec2(0.0, 0.007 * softBlurField);
  int smCount = softBlurField > 0.02 ? 3 : 2;
  for (int sm = uZero; sm < smCount; sm++) {
    vec2 smp = sm == 0 ? (smokeUv * 3.8 + warp1 * 0.52)
      : sm == 1 ? (smokeUv * 6.8 + warp1 * 0.46)
      : ((smokeUv + blurShift) * 6.6 + warp1 * 0.48);
    float sv = sampleAdvectedSmoke(smp, sm == 0 ? windCurrent : windCurrent * 1.15, smokeClock, sm > 0);
    if (sm == 0) smokeBase = sv;
    else if (sm == 1) smokeRidges = sv;
    else blurredRidges = sv;
  }
  if (softBlurField > 0.02) {
    smokeRidges = mix(smokeRidges, 0.5 * (smokeRidges + blurredRidges), clamp(softBlurField * 0.85, 0.0, 0.85));
  }

  float partStreamL = 0.0, partStreamR = 0.0, partStreamU = 0.0;
  for (int ps = uZero; ps < 3; ps++) {
    vec2 pUv = ps == 0 ? (smokeUv + warp1 * 0.07) : ps == 1 ? (smokeUv - warp1 * 0.07) : smokeUv;
    vec2 pVel = ps == 0 ? vec2(-0.42, 0.56) : ps == 1 ? vec2(0.44, 0.54) : vec2(0.06, 0.66);
    float pScale = ps == 0 ? 5.2 : ps == 1 ? 5.6 : 7.2;
    float pSeed = ps == 0 ? 11.7 : ps == 1 ? 27.4 : 43.9;
    float pv = driftingSmokeParticleLayer(pUv, pVel, smokeClock, pScale, pSeed);
    if (ps == 0) partStreamL = pv;
    else if (ps == 1) partStreamR = pv;
    else partStreamU = pv;
  }
  float driftingSmokeParticles = clamp(
    (partStreamL * (1.15 - 0.50 * rightWeight) + partStreamR * (0.65 + 0.50 * rightWeight) + partStreamU * 0.85) * (0.45 + 0.65 * smokeBase),
    0.0,
    1.35
  );

  float smokeField = smokeBase * 0.46 + smokeRidges * 0.48 + driftingSmokeParticles * 0.22;

  float centerDistX = (smokeSampleUv.x - 0.5) * uAspect;
  float screenHazeFalloff = smoothstep(0.04, 0.28, abs(centerDistX));
  float smokeClearing  = mix(0.70, 1.0, screenHazeFalloff);

  float sideAndSpeakerMist = smoothstep(0.10, 0.28, abs(centerDistX)) * (1.0 - smoothstep(0.18, 0.78, stageY)) * 0.82;
  float altarPlumeMist     = exp(- pow(centerDistX / 0.26, 2.0)) * exp(- pow((stageY - 0.14) / 0.18, 2.0)) * 0.68;
  float lowHorizonMist     = exp(- stageY / 0.15) * 0.52;
  float stageSmokeEnv      = max(sideAndSpeakerMist, max(altarPlumeMist, lowHorizonMist)) * smokeClearing;
  float smokeDensity       = smoothstep(0.24, 0.76, smokeField * (0.34 + 0.76 * stageSmokeEnv)) * smokeClearing;

  float dPhoenixSmoke = length(vec2((smokeSampleUv.x - uPhoenixPos.x) * uAspect, smokeSampleUv.y - uPhoenixPos.y) * vec2(0.68, 0.95));
  float phoenixSmokeLight = exp(- dPhoenixSmoke / (0.24 * uFireSize)) * min(1.50, uFireBrightness * 0.62) * (0.80 + 0.20 * uLightPulse);
  float dSpkSmokeL = length(vec2((smokeSampleUv.x - uLeftSpeaker.x) * uAspect, smokeSampleUv.y - uLeftSpeaker.y));
  float dSpkSmokeR = length(vec2((smokeSampleUv.x - uRightSpeaker.x) * uAspect, smokeSampleUv.y - uRightSpeaker.y));
  float speakerSmokeLight = (exp(- dSpkSmokeL / 0.23) + exp(- dSpkSmokeR / 0.23)) * (0.62 + 0.34 * uSpeakerPulse + 0.20 * uLeadPulse) * (0.80 + 0.20 * uLightPulse);

  vec2 baseMistPosL = vec2(uLeftSpeaker.x + 0.014, ${STAGE_HORIZON_Y.toFixed(4)} + 0.044);
  vec2 baseMistPosR = vec2(uRightSpeaker.x - 0.014, ${STAGE_HORIZON_Y.toFixed(4)} + 0.044);
  float baseMistPoolL = exp(- pow((smokeSampleUv.x - baseMistPosL.x) * uAspect / 0.086, 2.0) - pow((smokeSampleUv.y - baseMistPosL.y) / 0.060, 2.0));
  float baseMistPoolR = exp(- pow((smokeSampleUv.x - baseMistPosR.x) * uAspect / 0.086, 2.0) - pow((smokeSampleUv.y - baseMistPosR.y) / 0.060, 2.0));
  float speakerBaseMistLight = (baseMistPoolL + baseMistPoolR) * (0.45 + 0.55 * smokeBase) * (0.72 + 0.28 * uSpeakerPulse);

  vec3 smokeLitCol = uStageDark * 0.48
    + mix(uStageDark, uSmokeWarm, 0.72) * (portalCoreGlow * 0.45 + lowHorizonMist * 0.36)
    + leadAmbient(0.34) * phoenixSmokeLight * 0.50
    + mix(leadAmbient(0.24), uSmokeWarm, 0.45) * speakerSmokeLight * 0.58
    + mix(uSmokeWarm, leadAmbient(0.68), 0.46) * speakerBaseMistLight * 0.50;

  float aSmoke = clamp(smokeDensity * 0.58 + speakerBaseMistLight * 0.32, 0.0, 0.78);

  float tendrilEnv = (0.24 + 0.76 * stageSmokeEnv) * smoothstep(0.01, 0.14, stageY) * (1.0 - smoothstep(0.55, 0.88, stageY)) * smokeClearing;
  float wisps = smoothstep(0.50 - 0.05 * softBlurField, 0.80 + 0.05 * softBlurField, smokeRidges) * tendrilEnv;
  vec3 localSmokeIllum = mix(uSmokeWarm, leadAmbient(0.50), 0.42) * (0.30 + 0.58 * max(phoenixSmokeLight, max(speakerSmokeLight, portalCoreGlow * 0.8)));

  float particleEnv = (0.24 + 0.76 * stageSmokeEnv) * smoothstep(0.02, 0.14, stageY) * (1.0 - smoothstep(0.65, 0.92, stageY)) * smokeClearing;
  vec3 particleCol = mix(uSmokeWarm, leadAmbient(0.72), 0.40) * (0.28 + 0.56 * max(phoenixSmokeLight, speakerSmokeLight));

  float smokeModulatedWave = softBlurField * smokeDensity * (0.55 + 0.45 * smokeBase);
  vec3 smokeAdd = localSmokeIllum * wisps * (0.28 + 0.16 * uFireBrightness)
    + particleCol * driftingSmokeParticles * particleEnv * (0.20 + 0.14 * uFireBrightness + 0.08 * uHighEnv)
    + mix(uSmokeWarm, uFireMid, 0.45) * smokeModulatedWave * 0.24;

  float topVig = smoothstep(0.68, 1.0, stageY) * (0.35 + 0.65 * pow(abs(rawUv.x - 0.5) * 2.0, 1.5));
  float vig = 1.0 - 0.55 * topVig;
  fragColor = vec4(clamp((smokeLitCol * aSmoke + smokeAdd) * vig, 0.0, 16.0), aSmoke);
}
`;

const PHOENIX_FLOOR_PART = /* glsl */ `
// ── 4. Rough Wet Concrete 3D Stage Floor, Acoustic Faraday Ripples & Meditating Human ──
/**
 * Evaluates the anatomically articulated SDF of the foreground meditating human (rear view).
 * 彻底消除高频正弦振荡（杜绝边缘摩尔纹与散斑颗粒感），采用纯净 Lipschitz-1 平滑骨骼胶囊段。
 */
float evalMeditatorSdf(vec2 fp) {
  float fx = abs(fp.x);
  float asym = fp.x >= 0.0 ? 1.0 : -1.0;

  // A. 平滑自然颅骨与颈部连接 (无高频杂波，边缘丝滑抗锯齿)
  vec2 headPos = vec2(0.0002 * sin(uTime * 0.85), 0.0248);
  vec2 hp = fp - headPos;
  float skullTaper = 0.90 + 0.16 * clamp(hp.y / 0.0090, -1.0, 1.0);
  float dCranium = (length(vec2(hp.x / (0.0075 * skullTaper), hp.y / 0.0090)) - 1.0) * 0.0078;
  float dEars = length((vec2(fx, hp.y) - vec2(0.0063, -0.0006)) * vec2(1.45, 0.82)) - 0.0012;
  float dHead = smin(dCranium, dEars, 0.0008);

  // B. 平滑连贯的颈部与自然下沉斜方肌/肩线
  vec2 neckSeg = sdSegment(vec2(fx, fp.y), vec2(0.0, 0.0185), vec2(0.0, 0.0128));
  float dNeck = neckSeg.x - mix(0.0052, 0.0072, neckSeg.y);

  // 肩部自然顺滑斜下至三角肌 (消除高频正弦波皱痕)
  vec2 shoulderBar = sdSegment(vec2(fx, fp.y), vec2(0.0018, 0.0142), vec2(0.0136, 0.0068 - 0.0002 * asym));
  float dShoulders = shoulderBar.x - mix(0.0050, 0.0045, shoulderBar.y);

  // C. 倒三角背部与平滑躯干
  float torsoY = clamp((0.0090 - fp.y) / 0.0255, 0.0, 1.0);
  float torsoHalfW = mix(0.0114, 0.0086, smoothstep(0.0, 0.72, torsoY)) + 0.0022 * smoothstep(0.68, 1.0, torsoY);
  float dxTorso = fx - torsoHalfW;
  float dyTorso = max(fp.y - 0.0090, -0.0168 - fp.y);
  float dTorso = length(max(vec2(dxTorso, dyTorso), 0.0)) + min(max(dxTorso, dyTorso), 0.0) - 0.0024;

  // D. 平滑手臂与手腕
  vec2 upperArmSeg = sdSegment(vec2(fx, fp.y), vec2(0.0134, 0.0066), vec2(0.0174, -0.0044 + 0.0003 * asym));
  float dUpperArms = upperArmSeg.x - mix(0.0044, 0.0038, upperArmSeg.y);
  vec2 forearmSeg = sdSegment(vec2(fx, fp.y), vec2(0.0170, -0.0048 + 0.0003 * asym), vec2(0.0110, -0.0136 - 0.0002 * asym));
  float dForearms = forearmSeg.x - mix(0.0038, 0.0030, forearmSeg.y);
  float dArms = smin(dUpperArms, dForearms, 0.0028);

  // E. 沉稳盘坐双腿
  vec2 leftThigh  = sdSegment(fp, vec2(-0.0045, -0.0124), vec2(-0.0252, -0.0156));
  vec2 rightThigh = sdSegment(fp, vec2( 0.0045, -0.0124), vec2( 0.0256, -0.0152));
  float dThighs = min(
    leftThigh.x  - mix(0.0056, 0.0043, leftThigh.y),
    rightThigh.x - mix(0.0056, 0.0043, rightThigh.y)
  );
  vec2 backShinSeg  = sdSegment(fp, vec2(-0.0244, -0.0158), vec2( 0.0074, -0.0196));
  float dBackShin   = backShinSeg.x - mix(0.0040, 0.0032, backShinSeg.y);
  vec2 frontShinSeg = sdSegment(fp, vec2( 0.0248, -0.0154), vec2(-0.0062, -0.0226));
  float dFrontShin  = frontShinSeg.x - mix(0.0042, 0.0034, frontShinSeg.y);
  float dLegs = smin(dThighs, smin(dBackShin, dFrontShin, 0.0016), 0.0020);

  float dTorsoShoulders = smin(dShoulders, dTorso, 0.0028);
  float dUpperBody = smin(dTorsoShoulders, dArms, 0.0018);
  float dHeadNeck = smin(dHead, dNeck, 0.0022);
  float dHeadTorso = smin(dHeadNeck, dUpperBody, 0.0025);
  return smin(dHeadTorso, dLegs, 0.0020);
}

vec3 renderStageFloor(vec2 rawUv, vec2 warpedUv, float vaporCompression) {
  float floorX = rawUv.x;
  float floorY = clamp(rawUv.y / ${STAGE_HORIZON_Y.toFixed(4)}, 0.0, 1.0);
  float distFromHorizon = 1.0 - floorY;

  // 3D Perspective floor projection
  float wNear = 0.94;
  float wFar  = 0.24;
  float perspW = mix(wNear, wFar, floorY);
  float perspZ = wNear / perspW;
  vec2 floorWorldXZ = vec2((floorX - 0.5 + uCamShift * 0.03) * uAspect * perspZ * 2.2, perspZ * 4.2);

  // 1. Industrial Concrete Slab Perspective Seams & Wet/Dry Concrete Micro-Roughness
  float seamLong1 = exp(- pow((abs(floorWorldXZ.x) - 0.62) / (0.016 * perspZ), 2.0));
  float seamLong2 = exp(- pow((abs(floorWorldXZ.x) - 1.48) / (0.018 * perspZ), 2.0));
  float seamHoriz = smoothstep(0.982, 0.998, cos(floorWorldXZ.y * 3.14159 * 0.72));
  float diagRidge = exp(- pow((abs(floorWorldXZ.x) * 0.42 + floorWorldXZ.y * 0.85 - 2.35) / 0.045, 2.0)) * smoothstep(0.15, 0.65, floorY);
  float floorSeams = clamp(seamLong1 * 0.85 + seamLong2 * 0.75 + seamHoriz * 0.65 + diagRidge * 0.55, 0.0, 1.0);

  float concreteGrain = noise2(floorWorldXZ * vec2(28.0, 36.0)) * 0.5 + noise2(floorWorldXZ * vec2(75.0, 90.0)) * 0.5;
  float puddleField = fbm(floorWorldXZ * vec2(2.4, 3.8) + vec2(1.3, 4.7));
  float puddleMask = smoothstep(0.32, 0.68, puddleField);

  // Acoustic Faraday standing-wave vibration in the wet concrete puddles when bass/shockwaves hit!
  float bassVibration = sin(floorWorldXZ.x * 38.0 + uTime * 42.0) * cos(floorWorldXZ.y * 42.0 - uTime * 48.0);
  float puddleShimmer = 0.5 + 0.5 * sin(floorWorldXZ.y * 26.0 - uFlow * 4.2 + puddleField * 8.0 + bassVibration * 1.6 * uSpeakerBass);
  float wetGloss = (0.22 + 0.78 * puddleMask) * (0.78 + 0.22 * puddleShimmer * concreteGrain);

  // 2. 水面保留暗部与不均匀反射：不铺成整片均质亮色，反射位置与上方两侧音箱光环及中央火凤严格对应！
  float rippleWave = sin(floorWorldXZ.y * 32.0 - uTime * 2.4 + puddleField * 6.5) * 0.6
                   + cos(floorWorldXZ.y * 58.0 + floorWorldXZ.x * 8.0 + uTime * 1.8) * 0.4;
  float horizBlur = ((noise2(floorWorldXZ * vec2(14.0, 22.0)) - 0.5) * 0.018 + rippleWave * 0.008) * (1.15 - 0.45 * puddleMask);
  float reflX = warpedUv.x + (warpedUv.x - rawUv.x) * 1.5 + horizBlur;
  float reflDist = clamp(distFromHorizon + (warpedUv.y - rawUv.y) * 2.2, 0.0, 1.0);

  float dxLeft    = abs(reflX - uLeftSpeaker.x) * uAspect;
  float dxRight   = abs(reflX - uRightSpeaker.x) * uAspect;
  float dxCenter  = abs(reflX - (0.5 - uCamShift * 0.04)) * uAspect;
  float dxPhoenix = abs(reflX - uPhoenixPos.x) * uAspect;

  // 两侧巨型音箱大圆光环与箱体底部光池在水面的位置对应反射柱（如参考封面中左右两侧鲜明的水波反射带）
  float speakerSpread = 0.084 + 0.074 * reflDist;
  float leftPillar  = exp(- pow(dxLeft / speakerSpread, 2.0)) * exp(- pow((reflDist - 0.30) / 0.38, 2.0));
  float rightPillar = exp(- pow(dxRight / speakerSpread, 2.0)) * exp(- pow((reflDist - 0.30) / 0.38, 2.0));
  float ringReflY   = reflDist - (0.532 - ${STAGE_HORIZON_Y.toFixed(4)}) * 1.10;
  float ringHotL    = exp(- (dxLeft * dxLeft) / 0.0100 - (ringReflY * ringReflY) / (0.052 + 0.026 * (1.0 - puddleMask)));
  float ringHotR    = exp(- (dxRight * dxRight) / 0.0100 - (ringReflY * ringReflY) / (0.052 + 0.026 * (1.0 - puddleMask)));
  // 水波横向条带打散反射，形成自然的明暗水纹断续感
  float waveBandMod = 0.62 + 0.38 * smoothstep(-0.45, 0.55, rippleWave);
  float speakerRefl = ((leftPillar + rightPillar) * 0.60 + (ringHotL + ringHotR) * 0.78) * waveBandMod * (0.70 + 0.38 * uSpeakerPulse + 0.26 * uLeadPulse) * uLightPulse;

  // 中央火凤与祭坛逆光的水面反射：控制在中央纵向走廊内，保留两侧与中景之间的暗部湿润混凝土对比
  float phoenixSpreadX = (0.115 + 0.042 * uFireSize) * (0.80 + 0.32 * reflDist);
  float phoenixReflY   = reflDist - 0.30;
  float phoenixFireRefl = exp(- pow(dxPhoenix / phoenixSpreadX, 2.0) - pow(phoenixReflY / 0.30, 2.0))
    * (0.50 + 0.38 * min(1.8, uFireBrightness))
    * (0.68 + 0.32 * fbm(floorWorldXZ * vec2(4.5, 8.0) + vec2(0.0, uTime * 0.7)))
    * waveBandMod * uLightPulse;

  float portalRefl = exp(- pow(dxCenter / 0.16, 2.0)) * exp(- reflDist / 0.36) * (0.22 + 0.14 * uPortalGlow);
  // 立地巨幕显示屏在湿润地面的倒影延伸 (稳固舞台立地感)
  float dxScreen = abs(reflX - (0.5 - uCamShift * 0.04)) * uAspect;
  float screenReflPillar = exp(- pow(dxScreen / 0.24, 2.0)) * exp(- reflDist / 0.38) * (0.24 + 0.16 * uPortalGlow);

  // 湿润暗色混凝土地面基底：保留深邃暗部结构，不在无光源区域平铺橙色
  vec3 dryConcrete = uStageDark * (0.15 + 0.12 * concreteGrain);
  vec3 wetConcrete = mix(dryConcrete * 0.55, uStageDark * 0.28 + uFireDeep * 0.08, wetGloss);
  vec3 floorCol = wetConcrete;

  // 倒影色块：沿水面拉长的 A / B 两组 Lead 代表色，对应上方光圈与火凤的色彩分布
  float wBRefl = leadGroupWeightB(vec2(reflX * uAspect * 8.5, reflDist * 2.4 + horizBlur * 6.0), 1.7);
  float reflMod = (0.42 + 0.58 * wetGloss) * (0.78 + 0.40 * concreteGrain);
  floorCol += leadColor(0.36, wBRefl) * speakerRefl * reflMod * 0.92;
  floorCol += leadColor(0.90, wBRefl) * (ringHotL + ringHotR) * wetGloss * waveBandMod * (0.36 + 0.26 * uSpeakerPulse + 0.18 * uLeadPulse) * uLightPulse;
  floorCol += leadColor(0.50, wBRefl) * phoenixFireRefl * reflMod * 0.68;
  floorCol += mix(uSmokeWarm, uFireMid, 0.45) * portalRefl * reflMod * 0.38;
  floorCol += mix(uStageDark * 0.3, leadAmbient(0.60), 0.50) * screenReflPillar * reflMod * 0.55;
  floorCol += leadAmbient(0.70) * vaporCompression * wetGloss * (speakerRefl * 0.28 + phoenixFireRefl * 0.34 + 0.08);

  float underAltarX = 1.0 - smoothstep(0.130, 0.142, abs(floorX + uCamShift * 0.04 - 0.5));
  float underAltarY = smoothstep(0.76, 0.995, floorY);
  floorCol *= 1.0 - 0.82 * underAltarX * underAltarY;

  floorCol = floorCol * (1.0 - 0.38 * floorSeams) + mix(uFireMid, uFireBright, 0.4) * floorSeams * (0.04 + 0.09 * (speakerRefl + phoenixFireRefl));

  float bottomVig = smoothstep(0.45, 1.0, distFromHorizon) * (0.25 + 0.75 * pow(abs(floorX - 0.5) * 2.0, 1.6));
  floorCol *= 1.0 - 0.52 * bottomVig;

  // 3. Foreground Meditating Human: Calmly Grounded in Water with Soft Contact Shadow & Wave-Shattered Reflection
  // (弱化坐姿下方较硬较亮的边，补柔和的接触暗部和被水纹打散的倒影!)
  // 3. Foreground Meditating Human: 丝滑无颗粒感的超采样抗锯齿与三维柔和漫反射轮廓
  vec2 figCenter = vec2(0.50 - uCamShift * 0.045, 0.168);
  vec2 fp = vec2((floorX - figCenter.x) * uAspect, rawUv.y - figCenter.y) / 1.15;
  if (abs(fp.x) < 0.135 && fp.y > -0.115 && fp.y < 0.055) {
    float fx = abs(fp.x);

    // A. 柔和水面漫射波纹
    vec2 waterBaseDelta = vec2(fp.x * 0.80, (fp.y + 0.0195) * 2.60);
    float rWater = length(waterBaseDelta);
    float angWater = atan(waterBaseDelta.y, waterBaseDelta.x);
    float angBreakup = 0.65 + 0.35 * sin(angWater * 3.0);
    float ripPhase = fract(uTime * 0.12);
    float rad1 = mix(0.030, 0.052, ripPhase);
    float softRippleCrest = exp(- pow((rWater - rad1) / 0.0052, 2.0)) * sin(ripPhase * 3.14159265) * 0.55
                          + exp(- pow((rWater - 0.038) / 0.0058, 2.0)) * 0.42;
    float softRippleTrough = exp(- pow((rWater - 0.031) / 0.0055, 2.0)) * 0.65;
    float rippleMask = angBreakup * smoothstep(0.022, 0.034, rWater) * smoothstep(-0.008, -0.022, fp.y);
    floorCol *= 1.0 - 0.12 * softRippleTrough * rippleMask;
    floorCol += mix(uSmokeWarm, uFireMid, 0.45) * softRippleCrest * rippleMask * (0.028 + 0.018 * wetGloss);

    // B. 水面接触环境遮蔽 (AO) 与倒影
    vec2 contactCoreP = vec2(fp.x * 0.76, fp.y + 0.0204);
    vec2 contactWideP = vec2(fp.x * 0.62, fp.y + 0.0222);
    float softContactAO = 0.62 * exp(- (contactCoreP.x * contactCoreP.x) / 0.00062 - (contactCoreP.y * contactCoreP.y) / 0.000028)
                        + 0.38 * exp(- (contactWideP.x * contactWideP.x) / 0.00110 - (contactWideP.y * contactWideP.y) / 0.000110);
    floorCol *= 1.0 - 0.54 * clamp(softContactAO, 0.0, 1.0);

    float yWaterLine = -0.0196;
    if (fp.y < yWaterLine + 0.003) {
      float distBelow = max(0.0, yWaterLine - fp.y);
      float wavePhase1 = fp.y * 360.0 - uTime * 2.1;
      float wavePhase2 = fp.y * 620.0 + fp.x * 70.0 + uTime * 2.9;
      float waveSin = sin(wavePhase1) * 0.62 + cos(wavePhase2) * 0.38;
      float waterShiftX = waveSin * (0.0022 + 0.20 * distBelow);

      float rx = abs(fp.x + waterShiftX);
      float ry = yWaterLine + distBelow * 0.85;
      float reflHalfW = mix(
        0.0260,
        mix(0.0158, 0.0078, smoothstep(-0.005, 0.024, ry)),
        smoothstep(-0.020, -0.005, ry)
      );
      float dRefl = max(rx - reflHalfW, ry - 0.032);
      float inReflBody = 1.0 - smoothstep(-0.0025, 0.0050 + distBelow * 0.12, dRefl);

      float waterWaveTrough = smoothstep(-0.22, 0.58, waveSin);
      float distFade = exp(- distBelow / 0.036) * (1.0 - smoothstep(0.045, 0.078, distBelow)) * smoothstep(0.0, 0.0020, distBelow);
      float reflDarken = inReflBody * (0.36 + 0.64 * waterWaveTrough) * distFade;
      floorCol *= 1.0 - 0.48 * reflDarken;
    }

    // 充裕平滑的超采样抗锯齿带宽 (至少 1.4 个屏幕像素)，彻底消除边缘摩尔纹与颗粒感
    // 将本体距离与 4-tap 中心差分法线合并为单调用点动态循环（远离人像时首步即 break），消除 5 倍 SDF AST 内联
    float aaBand = max(fwidth(fp.y) * 1.45, 0.00042);
    float eps = max(aaBand * 1.3, 0.00038);
    float dFig = 1.0;
    float figMask = 0.0;
    vec2 sdfGrad = vec2(0.0);
    for (int gIdx = uZero; gIdx < 5; gIdx++) {
      vec2 dOff = gIdx == 0 ? vec2(0.0)
        : gIdx == 1 ? vec2(eps, 0.0)
        : gIdx == 2 ? vec2(-eps, 0.0)
        : gIdx == 3 ? vec2(0.0, eps)
        : vec2(0.0, -eps);
      float sVal = evalMeditatorSdf(fp + dOff);
      if (gIdx == 0) {
        dFig = sVal;
        figMask = smoothstep(aaBand, -aaBand, dFig);
        if (figMask <= 0.001) break;
      } else if (gIdx == 1) sdfGrad.x += sVal;
      else if (gIdx == 2) sdfGrad.x -= sVal;
      else if (gIdx == 3) sdfGrad.y += sVal;
      else sdfGrad.y -= sVal;
    }

    if (figMask > 0.001) {
      float gradLen = length(sdfGrad);
      vec2 edgeDir = gradLen > 1e-6 ? (sdfGrad / gradLen) : normalize(vec2(fp.x, fp.y + 0.005));

      float edgeDepth = clamp(-dFig / 0.0052, 0.0, 1.0);
      float bevelFactor = pow(1.0 - edgeDepth, 1.25);

      // 躯干与脊椎平缓体块明暗 (无微观震颤)
      float inBack = smoothstep(-0.011, 0.009, fp.y) * (1.0 - smoothstep(0.007, 0.012, fx));
      float spineFurrow = -sin(clamp(fp.x / 0.0062, -1.0, 1.0) * 3.14159265) * 0.22 * inBack;

      vec2 nXY = edgeDir * bevelFactor * 0.82 + vec2(spineFurrow + (fp.x / 0.026) * 0.28, clamp((fp.y - 0.001) / 0.030, -0.42, 0.52) * 0.38) * (1.0 - 0.55 * bevelFactor);
      float nZ = sqrt(max(0.04, 1.0 - dot(nXY, nXY)));
      vec3 N = normalize(vec3(nXY, nZ));

      // 宽广柔和的菲涅尔曲面轮廓光 (宽达 0.0040，消除 1 像素高光细线的颗粒断裂感)
      float innerRimInset = smoothstep(0.0, 0.0042, -dFig);
      float fresnelGrazing = pow(clamp(1.0 - N.z, 0.0, 1.0), 1.65) * innerRimInset;
      float upperBodyRimFade = smoothstep(-0.013, -0.001, fp.y);
      float softRimLight = fresnelGrazing * upperBodyRimFade * (0.35 + 0.65 * max(0.0, N.y * 0.62 + abs(N.x) * 0.65));

      // 顶部与侧面漫射舞台柔光 (平缓宽厚，无杂色噪点)
      float topLightAlign = max(0.0, N.y * 0.65 + (1.0 - N.z) * 0.48) * upperBodyRimFade;
      float leftSpkAlign  = max(0.0, -N.x * 0.78 + N.y * 0.25) * smoothstep(-0.002, 0.024, -fp.x) * upperBodyRimFade;
      float rightSpkAlign = max(0.0,  N.x * 0.78 + N.y * 0.25) * smoothstep(-0.002, 0.024,  fp.x) * upperBodyRimFade;

      float waterAbsorption = 1.0 - 0.55 * smoothstep(-0.014, -0.022, fp.y);

      // 深沉温和的炭褐衣材质感
      vec3 warmBronzeCloth = mix(uStageDark, uFireDeep, 0.28);
      float backSculpt = clamp(max(0.0, N.y * 0.48 + N.z * 0.52), 0.0, 1.0) * waterAbsorption;
      vec3 baseCharcoal = mix(uStageDark * 0.08, warmBronzeCloth * 0.25, backSculpt * innerRimInset);

      vec3 colTopBacklight = mix(uFireBright, uFireCore, 0.55) * (softRimLight * 1.15 + topLightAlign * 0.18 * innerRimInset)
                           * (0.50 + 0.30 * min(1.6, uFireBrightness) + 0.14 * uPortalGlow);
      vec3 colSideSpeakers = mix(uSmokeWarm, uFireBright, 0.45) * (leftSpkAlign + rightSpkAlign) * softRimLight * 0.85 * (0.65 + 0.45 * uSpeakerPulse);

      vec3 figCol = (baseCharcoal + colTopBacklight + colSideSpeakers) * (0.80 + 0.20 * waterAbsorption);
      floorCol = mix(floorCol, figCol, figMask);
    }
  }

  return floorCol;
}

void main() {
  vec4 refrField = evaluateAcousticAndHeatRefraction(vUv);
  vec2 warpedUv = clamp(vUv + refrField.xy, vec2(0.001), vec2(0.999));
  vec3 col = clamp(renderStageFloor(vUv, warpedUv, refrField.z), 0.0, 16.0);
  fragColor = vec4(col, 1.0);
}
`;

const PHOENIX_OVERLAY_MAIN = /* glsl */ `
void main() {
  // 粗包围盒早退：既不在火凤广域光晕范围也不在中央祭坛范围内的像素直接跳过声波与羽毛 SDF
  vec2 pApprox = vec2((vUv.x - uPhoenixPos.x) * uAspect, vUv.y - uPhoenixPos.y) / max(0.45, uPhoenixScale);
  pApprox = rot2D(pApprox, -uPhoenixRoll);
  bool nearBird = length(pApprox * vec2(0.52, 0.75)) < 0.68;
  bool nearAltar = abs(vUv.x + uCamShift * 0.04 - 0.5) < 0.165 && vUv.y < ${STAGE_HORIZON_Y.toFixed(4)} + 0.062;
  if (!nearBird && !nearAltar) {
    discard;
  }

  vec4 refrField = evaluateAcousticAndHeatRefraction(vUv);
  vec2 warpedUv = clamp(vUv + refrField.xy, vec2(0.001), vec2(0.999));
  warpedUv.y = max(${STAGE_HORIZON_Y.toFixed(4)} + 0.001, warpedUv.y);
  float softBlurField = refrField.z;

  vec2 rawUv = vUv;
  vec2 lensUv = mix(rawUv, warpedUv, 0.22);
  float stageY = clamp((warpedUv.y - ${STAGE_HORIZON_Y.toFixed(4)}) / ${(1.0 - STAGE_HORIZON_Y).toFixed(4)}, 0.0, 1.0);

  vec2 phoenixUv = mix(rawUv, warpedUv, 0.28);
  vec4 phoenix = nearBird ? evaluatePhoenixAndFire(phoenixUv) : vec4(0.0);

  vec3 overRgb = phoenix.rgb;
  float overA = phoenix.a;

  // 烟雾与余烬同凤凰的相互遮挡与照明（仅在凤凰不透明或火焰发光区域计算）
  if (overA > 0.0002) {
    vec2 smokeSampleUv = phoenixUv;
    float fgSmokeZone = exp(- pow((smokeSampleUv.x - uPhoenixPos.x) * uAspect / 0.22, 2.0) - pow((smokeSampleUv.y - (uPhoenixPos.y - 0.028)) / 0.065, 2.0));
    if (fgSmokeZone > 0.001) {
      vec2 smokeUv = vec2((smokeSampleUv.x - 0.5) * uAspect, smokeSampleUv.y - ${STAGE_HORIZON_Y.toFixed(4)});
      float smokeClock = uTime * 0.62 + uFlow * 0.38;
      float rightWeight = smoothstep(-0.32, 0.32, smokeUv.x);
      vec2 windCurrent = mix(vec2(-0.22, 0.32), vec2(0.22, 0.32), rightWeight);
      vec2 warp1 = vec2(
        sin(smokeUv.y * 5.2 + smokeClock * 1.2),
        cos(smokeUv.x * 4.8 - smokeClock * 1.4)
      ) * 0.12 + (vec2(noise2(smokeUv * 3.4), noise2(smokeUv * 3.4 + vec2(4.7, 2.1))) - 0.5) * 0.22;
      float smokeBase = 0.0, smokeRidges = 0.0, blurredRidges = 0.0;
      vec2 blurShift = (warpedUv - rawUv) * 1.25 + vec2(0.0, 0.007 * softBlurField);
      int smCount = softBlurField > 0.02 ? 3 : 2;
      for (int sm = uZero; sm < smCount; sm++) {
        vec2 drift = (sm == 0 ? windCurrent : windCurrent * 1.15) * smokeClock;
        vec2 smp = sm == 0 ? (smokeUv * 3.8 + warp1 * 0.52 - drift)
          : sm == 1 ? (smokeUv * 6.8 + warp1 * 0.46 - drift)
          : ((smokeUv + blurShift) * 6.6 + warp1 * 0.48 - drift);
        float sv = sampleOctave4(smp, sm > 0);
        if (sm == 0) smokeBase = sv;
        else if (sm == 1) smokeRidges = sv;
        else blurredRidges = sv;
      }
      if (softBlurField > 0.02) {
        smokeRidges = mix(smokeRidges, 0.5 * (smokeRidges + blurredRidges), clamp(softBlurField * 0.85, 0.0, 0.85));
      }
      float fgSmokeVeil = smoothstep(0.46, 0.82, smokeRidges * 0.65 + smokeBase * 0.35) * fgSmokeZone * overA;
      float v = fgSmokeVeil * 0.26;
      vec3 fgSmokeCol = mix(uStageDark * 0.35, mix(uSmokeWarm, uFireMid, 0.48), 0.68);
      overRgb = overRgb * (1.0 - v) + fgSmokeCol * v;
      overA = clamp(overA + v - overA * v, 0.0, 1.0);
    }
  }

  // 中央黑色祭坛 / DJ 台（带发光盲文点阵）
  float altarHalfW = 0.138;
  float altarBottom = ${STAGE_HORIZON_Y.toFixed(4)};
  float altarTop = ${STAGE_HORIZON_Y.toFixed(4)} + 0.046;
  float altarX = lensUv.x + uCamShift * 0.04;
  float dxAltar = abs(altarX - 0.5) - altarHalfW;
  float dyAltar = max(altarBottom - rawUv.y, rawUv.y - altarTop);

  if (dxAltar < 0.008 && dyAltar < 0.008 && rawUv.y >= altarBottom) {
    float inAltar = 1.0 - smoothstep(-0.001, 0.0025, max(dxAltar, dyAltar));
    float topRim = smoothstep(altarTop - 0.0040, altarTop, rawUv.y) * (1.0 - smoothstep(altarHalfW * 0.15, altarHalfW, abs(altarX - 0.5)));
    vec3 altarCol = uStageDark * 0.14 + mix(uSmokeWarm, uFireBright, 0.45) * topRim * (0.20 + 0.12 * uPortalGlow);

    vec2 bUv = vec2((altarX - 0.5) / altarHalfW, (rawUv.y - altarBottom) / (altarTop - altarBottom));
    if (abs(bUv.x) < 0.36 && bUv.y > 0.24 && bUv.y < 0.74) {
      vec2 grid = vec2((bUv.x + 0.36) / 0.72 * 15.0, (bUv.y - 0.24) / 0.50 * 3.0);
      vec2 cellId = floor(grid);
      vec2 cellUv = fract(grid) - 0.5;
      float dotHash = hash21(cellId + vec2(7.0, 13.0));
      float isLetterCol = step(0.15, mod(cellId.x, 3.0));
      if (dotHash > 0.44 && isLetterCol > 0.5) {
        float dDot = length(cellUv * vec2(1.1, 1.0));
        float pulseDot = 0.65 + 0.35 * sin(uTime * 5.0 + dotHash * 31.4) + 0.45 * uGroovePulse + 0.35 * uHighEnv;
        float dotGlow = (1.0 - smoothstep(0.06, 0.22, dDot)) * pulseDot;
        altarCol += mix(uFireBright, uFireCore, 0.65) * dotGlow * 0.82;
      }
    }

    overRgb = mix(overRgb, altarCol, inAltar);
    overA = mix(overA, 1.0, inAltar);
  }

  if (overA <= 0.0001 && dot(overRgb, vec3(1.0)) <= 0.0001) {
    discard;
  }

  float topVig = smoothstep(0.68, 1.0, stageY) * (0.35 + 0.65 * pow(abs(rawUv.x - 0.5) * 2.0, 1.5));
  float vig = 1.0 - 0.55 * topVig;
  fragColor = vec4(clamp(overRgb * vig, 0.0, 16.0), clamp(overA, 0.0, 1.0));
}
`;

const FLOOR_FRAG = `#define IS_FLOOR_PASS\n${PHOENIX_COMMON}\n${PHOENIX_FLOOR_PART}`;
const STAGE_FRAG = `${PHOENIX_COMMON}\n${PHOENIX_STAGE_PART}`;
const STAGE_SMOKE_FRAG = `${PHOENIX_COMMON}\n${PHOENIX_SMOKE_PART}`;
const PHOENIX_OVERLAY_FRAG = `${PHOENIX_COMMON}\n${PHOENIX_BIRD_PART}\n${PHOENIX_OVERLAY_MAIN}`;

/** 生成 NDC 纵向区间 [yMin, yMax] 的轴对齐全宽矩形几何体 */
function makeBandGeometry(yMin: number, yMax: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      -1, yMin, 0,
       1, yMin, 0,
       1, yMax, 0,
      -1, yMin, 0,
       1, yMax, 0,
      -1, yMax, 0,
    ], 3),
  );
  return g;
}

function makePremulOverlayMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

function createPhoenixMaterials(uniforms: Record<string, THREE.IUniform>): {
  floorMat: THREE.RawShaderMaterial;
  stageMat: THREE.RawShaderMaterial;
  smokeMat: THREE.RawShaderMaterial;
  overlayMat: THREE.RawShaderMaterial;
} {
  const floorMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FLOOR_FRAG,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const stageMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: STAGE_FRAG,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const smokeMat = makePremulOverlayMaterial(STAGE_SMOKE_FRAG, uniforms);
  const overlayMat = makePremulOverlayMaterial(PHOENIX_OVERLAY_FRAG, uniforms);
  return { floorMat, stageMat, smokeMat, overlayMat };
}

/** Pre-compilable shader objects for Engine startup warm-up. */
export const phoenixPrograms = (): THREE.Object3D[] => {
  const g = new THREE.BufferGeometry();
  const { floorMat, stageMat, smokeMat, overlayMat } = createPhoenixMaterials({ uZero: { value: 0 } });
  return [
    new THREE.Mesh(g, floorMat),
    new THREE.Mesh(g, stageMat),
    new THREE.Mesh(g, smokeMat),
    new THREE.Mesh(g, overlayMat),
  ];
};

export class PhoenixScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: LyricRig;

  private readonly soundWaves: SoundWaveEvent[];
  private readonly soundWaveTimes: Float64Array;
  private readonly soundWaveA = Array.from({ length: MAX_SOUND_WAVES }, () => new THREE.Vector4());
  private readonly soundWaveB = Array.from({ length: MAX_SOUND_WAVES }, () => new THREE.Vector4());

  private readonly rawKickTimes: Float64Array;
  private readonly rawKickVals: Float64Array;
  private readonly rawSnareTimes: Float64Array;
  private readonly rawSnareVals: Float64Array;

  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly soft: boolean;
  /** 双 Lead 代表色主导 / 人声融合时间轨（歌词热更新时重建） */
  private leadTrack: LeadColorTrack;
  private leadTrackLyrics: LyricTrack | undefined;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, init.aspect, 0.1, 1000);

    const { palette, music } = init;
    const tone = extractCoverTone(init);
    this.scene.background = colorFromHsl(tone.deepHue, tone.mono ? 0.04 : 0.45, 0.06);

    this.soundWaves = buildSoundWaves(music, init.seed ?? 20261021);
    this.soundWaveTimes = Float64Array.from(this.soundWaves, w => w.t);

    const kicks = music.a.hits.kick ?? [];
    this.rawKickTimes = Float64Array.from(kicks, h => h[0]);
    this.rawKickVals = Float64Array.from(kicks, h => h[1]);

    const snares = music.a.hits.snare ?? [];
    this.rawSnareTimes = Float64Array.from(snares, h => h[0]);
    this.rawSnareVals = Float64Array.from(snares, h => h[1]);

    // 涅槃舞台全场景色调取自专辑封面 (Stage, smoke, speakers, Phoenix flames & floor reflections all adapt to the album cover!)
    const mkLin = (stop: typeof tone.mid, minL: number, maxL: number, minS: number, maxS: number, bias = 0) => {
      const c = tuneCoverStop(stop, tone, minL, maxL, minS, maxS, bias);
      return linearVec3FromHsl(c.h, c.s, c.l);
    };

    const stageDark  = mkLin(tone.dark,      0.06, 0.10, 0.28, 0.56, -6);
    const smokeWarm  = mkLin(tone.mid,       0.56, 0.65, 0.46, 0.80,  2);
    const fireDeep   = mkLin(tone.midDark,   0.38, 0.46, 0.78, 0.96, -8);
    const fireMid    = mkLin(tone.mid,       0.52, 0.60, 0.85, 0.99,  0);
    const fireBright = mkLin(tone.bright,    0.66, 0.74, 0.88, 1.00,  8);
    const fireCore   = mkLin(tone.highlight, 0.84, 0.92, 0.72, 0.96, 14);

    // 双 Lead 代表色：A = 明亮主奏 Lead（封面中更明亮的一组颜色），B = 温暖和声/键盘 Lead（更深沉的一组）
    const leadGroups = extractLeadColorGroups(init, tone);
    this.leadTrackLyrics = init.lyrics;
    this.leadTrack = buildLeadColorTrack(music, init.lyrics);

    this.uniforms = {
      uCover: { value: init.cover },
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uAspect: { value: init.aspect },
      uZero: { value: 0 },
      uLeftSpeaker: { value: new THREE.Vector2(0.176, 0.532) },
      uRightSpeaker: { value: new THREE.Vector2(0.824, 0.532) },
      uSpeakerPulse: { value: 0.25 },
      uSpeakerBass: { value: 0.20 },
      uPortalGlow: { value: 0.85 },
      uCamShift: { value: 0 },
      uCamLift: { value: 0 },
      uPhoenixPos: { value: new THREE.Vector2(0.50, 0.504) },
      uPhoenixScale: { value: 0.96 },
      uPhoenixRoll: { value: 0 },
      uPhoenixYaw: { value: 0 },
      uWingPhase: { value: 0 },
      uWingAmp: { value: 1.0 },
      uWingDownstroke: { value: 0 },
      uFireDistribution: { value: 0.35 },
      uFireSize: { value: 1.0 },
      uFireBrightness: { value: 1.0 },
      uFireTurbulence: { value: 1.0 },
      uDropIntensity: { value: 0 },
      uGroovePulse: { value: 0 },
      uLeadLevel: { value: 0 },
      uLeadAttack: { value: 0 },
      uHighEnv: { value: 0 },
      uStageDark: { value: stageDark },
      uSmokeWarm: { value: smokeWarm },
      uFireDeep: { value: fireDeep },
      uFireMid: { value: fireMid },
      uFireBright: { value: fireBright },
      uFireCore: { value: fireCore },
      uLeadA: { value: leadGroups.a },
      uLeadB: { value: leadGroups.b },
      uLeadShareB: { value: 0.3 },
      uColorFusion: { value: 0 },
      uLeadGlow: { value: 0 },
      uLeadPulse: { value: 0 },
      uLightPulse: { value: 1 },
      uSoundWaveA: { value: this.soundWaveA },
      uSoundWaveB: { value: this.soundWaveB },
    };

    const ySplit = STAGE_HORIZON_Y * 2 - 1;
    const floorGeo = makeBandGeometry(-1, ySplit);
    const upperGeo = makeBandGeometry(ySplit, 1);
    const { floorMat, stageMat, smokeMat, overlayMat } = createPhoenixMaterials(this.uniforms);

    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.frustumCulled = false;
    floorMesh.renderOrder = -10;
    this.scene.add(floorMesh);

    const stageMesh = new THREE.Mesh(upperGeo, stageMat);
    stageMesh.frustumCulled = false;
    stageMesh.renderOrder = -9;
    this.scene.add(stageMesh);

    const smokeMesh = new THREE.Mesh(upperGeo, smokeMat);
    smokeMesh.frustumCulled = false;
    smokeMesh.renderOrder = -8.5;
    this.scene.add(smokeMesh);

    const overlayMesh = new THREE.Mesh(upperGeo, overlayMat);
    overlayMesh.frustumCulled = false;
    overlayMesh.renderOrder = -8;
    this.scene.add(overlayMesh);

    // High-contrast album-toned lyric palette so sung words read crisply over the stage & fire
    const lyricPalette: Palette = {
      ...palette,
      ink: colorFromHsl(tone.deepHue, tone.mono ? 0.04 : 0.60, 0.07),
      paper: new THREE.Color('#fffdf8'),
      signal: colorFromHsl(tone.highHue, tone.mono ? 0.06 : 0.92, 0.72),
      light: true,
    };
    this.rig = new LyricRig(lyricPalette, this.soft ? 'poem' : 'hook');
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.uniforms.uAspect.value = aspect;
  }

  /** Evaluates raw drum hit pulse even when leadOwnership is 1.0 during a melodic Drop. */
  private rawHitPulse(times: Float64Array, vals: Float64Array, t: number, decay: number): number {
    if (!times.length) return 0;
    const i = lastIndex(times, t);
    if (i < 0) return 0;
    const evalAt = (idx: number): number => {
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
    return Math.max(evalAt(i), evalAt(i - 1));
  }

  /**
   * Four distinct 3D camera trajectories (stage, soar, sonic, altar) that maintain the stage horizon
   * while offering distinct spatial perspective and parallax across the grand stage.
   */
  private updateCamera(t: number, shot: Shot, groovePulse: number): { camShift: number; camLift: number } {
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const e = inOutCubic(k);
    const shotT = Math.max(0, t - shot.start);
    const variant = shot.variant || 'stage';

    let camX = 0;
    let camY = 2.4;
    let camZ = -shotT * 4.2;
    let yaw = 0;

    if (variant === 'soar') {
      camX = Math.sin(shotT * 0.32) * 1.1;
      camY = 2.7 + Math.sin(shotT * 0.24) * 0.18;
      camZ = -8.0 - shotT * 4.5;
      yaw = Math.sin(shotT * 0.20) * 0.025;
    } else if (variant === 'sonic') {
      camX = lerp(-2.2, 2.2, e) + Math.sin(shotT * 0.28) * 0.5;
      camY = 2.25 + Math.cos(shotT * 0.22) * 0.15;
      camZ = -5.0 - shotT * 4.2 - groovePulse * 0.30;
      yaw = lerp(0.035, -0.035, e);
    } else if (variant === 'altar') {
      camX = Math.cos(shotT * 0.22) * 1.6;
      camY = 2.85 + Math.sin(shotT * 0.18) * 0.18;
      camZ = 6.0 - shotT * 3.6;
      yaw = Math.sin(shotT * 0.16) * 0.028;
    } else {
      camX = Math.sin(shotT * 0.20) * 0.9;
      camY = 2.4 + Math.sin(shotT * 0.24) * 0.12;
      camZ = -shotT * 3.8;
      yaw = Math.sin(shotT * 0.15) * 0.020;
    }

    this.camera.position.set(camX, camY, camZ);
    this.camera.quaternion.setFromEuler(new THREE.Euler(HORIZON_PITCH, yaw, 0, 'YXZ'));
    this.camera.updateMatrixWorld();

    return {
      camShift: camX * 0.040,
      camLift: (camY - 2.4) * 0.014,
    };
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, fx } = ctx;

    const fg = music.foregroundAt(t);
    const lead = music.leadAt(t);
    const beatInfo = music.at(t);
    const dropInt = music.dropIntensity(t);
    const isDrop = shot.section.label === 'drop' || dropInt > 0.01;

    // Melodic Lead & spectral envelope signals
    const leadLevel = Math.max(fg.level, lead.level * (isDrop ? 1.0 : 0.82));
    const leadAttack = Math.max(fg.attack, lead.attack * (isDrop ? 1.0 : 0.82));
    const lowEnv = music.env('low', t);
    const highEnv = music.env('high', t);
    const rmsEnv = music.env('rms', t);

    // Combined Drop rhythm/groove signal (kicks, snares, bass stabs, beat pump, and foreground accents)
    const rawKick = this.rawHitPulse(this.rawKickTimes, this.rawKickVals, t, 0.22);
    const rawSnare = this.rawHitPulse(this.rawSnareTimes, this.rawSnareVals, t, 0.19);
    const bassStabPulse = music.pulse('bassStab', t, 0.20);
    const synthStabPulse = music.pulse('synthStab', t, 0.18);
    const beatPump = Math.pow(1.0 - beatInfo.phase, 2.1) * (isDrop ? 0.54 : 0.22);

    const groovePulse = clamp01(
      Math.max(rawKick * 0.98, rawSnare * 0.88, bassStabPulse * 0.92, fg.attack * 0.88) +
        0.28 * lowEnv +
        0.28 * beatPump,
    );

    const { camShift, camLift } = this.updateCamera(t, shot, groovePulse);

    // ── 0. 双 Lead 代表色主导 / 人声融合（预计算时间轨，纯函数可 seek；歌词热更新时重建） ──
    if (ctx.lyrics !== this.leadTrackLyrics) {
      this.leadTrackLyrics = ctx.lyrics;
      this.leadTrack = buildLeadColorTrack(music, ctx.lyrics);
    }
    const track = this.leadTrack;
    const leadShareB = sampleTrack(track.shareB, track.fps, t);
    const colorFusion = sampleTrack(track.fusion, track.fps, t);
    const leadGlow = sampleTrack(track.energy, track.fps, t);
    // Lead 主音色起音脉冲：已确认的主旋律起音事件（按主音色归属度加权）与连续起音包络取大
    const leadOwn = music.leadOwnership(t);
    const leadPulse = clamp01(Math.max(
      music.pulse('leadRole', t, 0.24) * (0.55 + 0.45 * leadOwn),
      leadAttack * (isDrop ? 0.95 : 0.70),
    ));
    // 光强随 Drop 律动呼吸：节拍泵 + 律动脉冲 + Lead 起音
    const lightPulse =
      (isDrop ? 0.92 : 0.86) +
      0.10 * groovePulse +
      0.18 * beatPump +
      0.08 * leadPulse +
      0.05 * leadGlow * (isDrop ? 1 : 0.6);

    // ── 1. Dual Giant Speakers & Acoustic Vibration Dynamics ──
    // 动态余量优化：保留鼓点基底同时为 Lead 主音色起音留下充足动态范围，彻底避免强拍长期被 clamp 钳在 1.0
    const drumPart = 0.46 * Math.max(rawKick, rawSnare * 0.85, bassStabPulse);
    const groovePart = 0.16 * groovePulse;
    const leadPart = (isDrop ? 0.40 : 0.26) * leadPulse + 0.12 * leadLevel;
    const speakerPulse = clamp01(
      (isDrop ? 0.14 : 0.06) + drumPart + groovePart + leadPart,
    );
    const speakerBass = clamp01(0.20 + 0.58 * Math.max(lowEnv, rmsEnv * 0.85) + 0.48 * rawKick);
    const portalGlow = 0.68 + (isDrop ? 0.26 : 0.08) + 0.42 * groovePulse + 0.32 * leadLevel + 0.22 * leadAttack;

    // ── 2. Slow, Weighty, Majestic Phoenix Flight & Wingbeat Kinematics ──
    // Reduced wingbeat frequency by ~4.6x (from 10.5 rad/s to 2.25 rad/s, ~2.8 seconds per full majestic wing cycle!)
    // so the colossal Phoenix glides and heaves its wings with monumental poise and weight!
    const flowMotion = music.foregroundMotion(t, 0.22);
    const wingPhase = t * 2.25 + flowMotion * (isDrop ? 0.42 : 0.20);
    const wingAmp = (this.soft ? 0.72 : 0.84) + (isDrop ? 0.14 : 0.04) + 0.12 * groovePulse + 0.08 * leadLevel;
    const wingDownstroke = clamp01(Math.max(rawKick * 0.55, rawSnare * 0.65, leadAttack * 0.45));

    // Slow, poised hovering trajectory above the central stage altar (3.5x slower and steadier than before!)
    const orbitSpeed = isDrop ? 0.22 : 0.15;
    const orbitX = Math.sin(t * orbitSpeed) * 0.014 + Math.cos(t * orbitSpeed * 0.53) * 0.006;
    const orbitY = Math.sin(t * orbitSpeed * 1.4) * 0.008;
    const flapLiftY = -Math.sin(wingPhase) * 0.0065 * wingAmp + 0.004 * wingDownstroke;

    const phoenixX = 0.50 + orbitX - camShift * 0.22;
    const phoenixY = 0.504 + orbitY + flapLiftY + camLift;
    const phoenixRoll = Math.cos(t * orbitSpeed) * 0.045 + Math.sin(t * orbitSpeed * 0.53) * 0.018;
    const phoenixYaw  = Math.cos(t * orbitSpeed) * 0.65;
    const phoenixScale = 0.94 + 0.04 * Math.sin(t * orbitSpeed * 0.8) + (isDrop ? 0.05 : 0.0) + 0.03 * groovePulse;

    // ── 3. Dazzling Phoenix Fire Dynamics Driven by Drop Groove (Distribution, Size, Brightness, Turbulence) ──
    const fireDistribution =
      (isDrop ? 0.42 : 0.20) +
      0.56 * groovePulse +
      0.40 * leadLevel +
      0.34 * Math.max(leadAttack, synthStabPulse) +
      0.18 * highEnv;

    const fireSize =
      0.78 +
      (isDrop ? 0.28 : 0.08) +
      0.56 * groovePulse +
      0.36 * Math.max(rawKick, rawSnare) +
      0.30 * leadLevel +
      0.24 * leadAttack;

    const fireBrightness =
      0.95 +
      (isDrop ? 0.32 : 0.12) +
      0.58 * groovePulse +
      0.40 * Math.max(leadAttack, rawSnare, rawKick) +
      0.28 * leadLevel +
      0.18 * highEnv;

    const fireTurbulence =
      0.78 +
      (isDrop ? 0.35 : 0.08) +
      0.55 * groovePulse +
      0.38 * leadLevel +
      0.25 * highEnv;

    const u = this.uniforms;
    u.uTime.value = t;
    u.uFlow.value = t + flowMotion * (this.soft ? 0.35 : 0.60);
    (u.uLeftSpeaker.value as THREE.Vector2).set(0.176 - camShift * 0.35, 0.532 + camLift * 0.5);
    (u.uRightSpeaker.value as THREE.Vector2).set(0.824 - camShift * 0.35, 0.532 + camLift * 0.5);
    u.uSpeakerPulse.value = speakerPulse;
    u.uSpeakerBass.value = speakerBass;
    u.uPortalGlow.value = portalGlow;
    u.uCamShift.value = camShift;
    u.uCamLift.value = camLift;

    (u.uPhoenixPos.value as THREE.Vector2).set(phoenixX, phoenixY);
    u.uPhoenixScale.value = phoenixScale;
    u.uPhoenixRoll.value = phoenixRoll;
    u.uPhoenixYaw.value = phoenixYaw;
    u.uWingPhase.value = wingPhase;
    u.uWingAmp.value = wingAmp;
    u.uWingDownstroke.value = wingDownstroke;

    u.uFireDistribution.value = fireDistribution;
    u.uFireSize.value = fireSize;
    u.uFireBrightness.value = fireBrightness;
    u.uFireTurbulence.value = fireTurbulence;

    u.uDropIntensity.value = isDrop ? Math.max(0.68, dropInt) : 0.15;
    u.uGroovePulse.value = groovePulse;
    u.uLeadLevel.value = leadLevel;
    u.uLeadAttack.value = leadAttack;
    u.uHighEnv.value = highEnv;
    u.uLeadShareB.value = leadShareB;
    u.uColorFusion.value = colorFusion;
    u.uLeadGlow.value = leadGlow;
    u.uLeadPulse.value = leadPulse;
    u.uLightPulse.value = lightPulse;

    // ── 4. Populate Active 3D Schlieren Refractive Shockwaves (pure function of t) ──
    let wCount = 0;
    for (let i = lastIndex(this.soundWaveTimes, t); i >= 0 && wCount < MAX_SOUND_WAVES; i--) {
      const w = this.soundWaves[i];
      const age = t - w.t;
      if (age < 0) continue;
      if (age > 1.8) break;
      if (age >= w.tau) continue;
      const effStrength = w.strength * (0.75 + 0.45 * groovePulse + 0.25 * leadLevel);

      this.soundWaveA[wCount].set(age, effStrength, w.maxRadius, w.tau);
      this.soundWaveB[wCount].set(w.freq, w.stereoBias, 0, 0);
      wCount++;
    }
    for (let i = wCount; i < MAX_SOUND_WAVES; i++) {
      this.soundWaveA[i].set(0, 0, 0.3, 1.0);
      this.soundWaveB[i].set(6.0, 0, 0, 0);
    }

    // ── 5. Post-Processing FX (Subtle bloom, zero radial zoom blur so foreground meditating figure stays razor-sharp) ──
    fx.invert = 0;
    fx.zoom = 0;
    fx.bloom = (this.soft ? 0.03 : 0.045) + 0.035 * groovePulse;
    fx.vignette = 0.24 + (isDrop ? 0.04 : 0.06);
    fx.grain = 0.018;
    fx.risoPositive = 1;

    // ── 6. 3D Lyric Rig Update ──
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, clamp01(0.42 + 0.35 * groovePulse + 0.25 * leadLevel));
  }
}
