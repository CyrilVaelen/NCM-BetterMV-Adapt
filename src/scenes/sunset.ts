// Sunset Water Platform (晚霞水台): Crafted for Drop sections inspired by The Chainsmokers - Closer (LIONE Remix).
// Top 4/5 (vUv.y in [0.20, 1.0]): Pink sunset clouds & white setting sun with vertical light pillar, crepuscular god rays,
// and dynamic Drop-driven solar aperture area & brightness modulation.
// Bottom 1/5 (vUv.y in [0.0, 0.20]): Glossy water platform displaying the album cover clearly (with reduced sky reflection
// so the pink sunset never washes out the cover artwork), where Lead notes spawn concentric water ripples across the surface.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex, type Music } from '../director/music.ts';
import type { Palette } from '../render/palette.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl, tuneCoverStop } from './coverTone.ts';

/** Maximum concurrent Lead-driven concentric ripple packets on the water platform. */
const MAX_RIPPLES = 28;
/** Maximum concurrent Drop-beat expanding solar aperture waves in the upper 4/5 sunset sky. */
const MAX_SUN_WAVES = 6;
/** Exact screen-space horizon line: bottom 1/5 (0.20) is the water platform, top 4/5 (0.80) is the sunset sky. */
const HORIZON_Y = 0.20;
/** Camera vertical FOV (degrees) and exact upward pitch (radians) that locks the 3D horizon (y=0) to vUv.y = 0.20. */
const CAM_FOV = 50;
const HORIZON_PITCH = Math.atan((1 - 2 * HORIZON_Y) * Math.tan(THREE.MathUtils.degToRad(CAM_FOV * 0.5)));

interface WaterRippleEvent {
  /** Onset timestamp (seconds). */
  t: number;
  /** Normalized platform X coordinate in [0.06, 0.94]. */
  x: number;
  /** Normalized platform Y coordinate (depth inside the bottom 1/5 strip) in [0.12, 0.88]. */
  y: number;
  /** Maximum expansion radius on the platform. */
  maxRadius: number;
  /** Wave amplitude (0..1.4). */
  amp: number;
  /** Expansion time constant (seconds). */
  tau: number;
  /** Ring spatial frequency (cycles per unit radius). */
  freq: number;
  /** Melodic brightness (0..1) for specular glint tint. */
  brightness: number;
  /** Whether this ripple was triggered in a Drop section. */
  inDrop: boolean;
}

interface SunWaveEvent {
  /** Onset timestamp (seconds). */
  t: number;
  /** Strength of the expanding solar aperture wave (0..1.2). */
  strength: number;
  /** Expansion radius scale. */
  scale: number;
}

/**
 * Extracts deterministic Lead-driven water ripple events across the entire song,
 * ensuring spatially balanced, multi-zone ripple appearance across the entire water platform during Drops.
 */
function buildLeadRipples(music: Music, seed: number): WaterRippleEvent[] {
  const random = rng((seed ^ 0x5ea1f00d) >>> 0);
  const out: WaterRippleEvent[] = [];

  // Primary Lead note onsets from voice/timbre analysis and melodic highlight hits
  const leadHits = music.roleHits('lead', 0, music.duration);
  const fgHits = music.highlightHits(0, music.duration);

  // Merge and deduplicate closely spaced melodic onsets (within 50 ms)
  const merged: Array<[number, number]> = [...leadHits, ...fgHits].sort((a, b) => a[0] - b[0]);
  const filtered: Array<[number, number]> = [];
  for (const [t, s] of merged) {
    if (s < 0.15) continue;
    const prev = filtered[filtered.length - 1];
    if (prev && t - prev[0] < 0.05) {
      if (s > prev[1]) prev[1] = s;
      continue;
    }
    filtered.push([t, s]);
  }

  // Stratified 5-zone horizontal + golden-ratio depth sequence so ripples appear evenly across all parts of the water surface
  let seqIdx = 0;
  const pickSpot = (t: number): [number, number] => {
    const zone = seqIdx % 5; // 5 horizontal zones from left to right
    seqIdx++;
    const pitch = music.pitchAt(t);
    const zoneBase = 0.07 + zone * 0.176;
    const inZone = ((seqIdx * 0.61803398875 + pitch.note / 12.0 + random() * 0.25) % 1.0) * 0.155;
    const phiY = (seqIdx * 0.75487766624 + Math.sin(pitch.angle) * 0.15 + random() * 0.20) % 1.0;
    const x = Math.max(0.06, Math.min(0.94, zoneBase + inZone));
    const y = 0.14 + 0.72 * phiY;
    return [x, y];
  };

  for (const [t, s] of filtered) {
    const sec = music.section(Math.min(t, Math.max(0, music.duration - 0.01)));
    const inDrop = sec?.label === 'drop';
    const [x, y] = pickSpot(t);
    const fg = music.foregroundAt(t);
    const amp = Math.min(1.35, (0.52 + 0.72 * s + 0.25 * fg.level) * (inDrop ? 1.22 : 0.82));
    const maxRadius = (0.14 + 0.15 * s + 0.04 * random()) * (inDrop ? 1.15 : 0.90);
    const tau = 0.56 + 0.24 * random();
    // Smooth, plump 3D liquid wave wavelength (2-3 rounded concentric liquid swells per packet)
    const freq = 10.5 + 3.5 * (1.0 - s * 0.35) + 2.0 * fg.brightness;
    out.push({ t, x, y, maxRadius, amp, tau, freq, brightness: fg.brightness, inDrop });

    // On strong Drop Lead attacks, spawn a secondary sympathetic ripple in another zone of the water surface
    if (inDrop && s > 0.45) {
      const [x2, y2] = pickSpot(t + 0.02);
      out.push({
        t: t + 0.03,
        x: x2,
        y: y2,
        maxRadius: maxRadius * 0.84,
        amp: amp * 0.78,
        tau: tau * 0.94,
        freq: freq * 1.06,
        brightness: fg.brightness,
        inDrop: true,
      });
    }
  }

  // Also sample sustained Lead phrases inside Drops so held supersaw/lead chords continuously excite ripples across the water
  for (const sec of music.a.sections) {
    if (sec.label !== 'drop') continue;
    const step = 0.20;
    for (let t = sec.start + 0.08; t < sec.end - 0.08; t += step) {
      const fg = music.foregroundAt(t);
      const lead = music.leadAt(t);
      const level = Math.max(fg.level, lead.level);
      if (level < 0.20) continue;
      const [x, y] = pickSpot(t);
      out.push({
        t,
        x,
        y,
        maxRadius: 0.13 + 0.12 * level,
        amp: 0.48 + 0.55 * level,
        tau: 0.58,
        freq: 11.5 + 3.0 * fg.brightness,
        brightness: fg.brightness,
        inDrop: true,
      });
    }
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Extracts rhythmic Drop groove events that launch expanding solar aperture rings from the white setting sun.
 */
function buildSunWaves(music: Music): SunWaveEvent[] {
  const out: SunWaveEvent[] = [];
  const kicks = music.a.hits.kick ?? [];
  const snares = music.a.hits.snare ?? [];
  const fgHits = music.highlightHits(0, music.duration);

  const rawEvents: Array<[number, number]> = [
    ...kicks.filter(h => h[1] > 0.28).map(([t, s]) => [t, s] as [number, number]),
    ...snares.filter(h => h[1] > 0.35).map(([t, s]) => [t, s * 0.85] as [number, number]),
    ...fgHits.filter(h => h[1] > 0.40).map(([t, s]) => [t, s * 0.9] as [number, number]),
  ].sort((a, b) => a[0] - b[0]);

  let lastT = -Infinity;
  for (const [t, s] of rawEvents) {
    if (t - lastT < 0.22) continue;
    const sec = music.section(Math.min(t, Math.max(0, music.duration - 0.01)));
    const isDrop = sec?.label === 'drop';
    const isChorus = sec?.label === 'chorus';
    if (!isDrop && !isChorus && s < 0.55) continue;
    out.push({
      t,
      strength: Math.min(1.0, s * (isDrop ? 0.95 : 0.58)),
      scale: isDrop ? 0.13 + 0.06 * s : 0.09 + 0.04 * s,
    });
    lastT = t;
  }

  // Ensure every downbeat inside a Drop emits a compact rhythmic solar aperture pulse
  for (const d of music.downbeats) {
    const sec = music.section(Math.min(d, Math.max(0, music.duration - 0.01)));
    if (sec?.label !== 'drop') continue;
    if (out.some(w => Math.abs(w.t - d) < 0.16)) continue;
    out.push({ t: d, strength: 0.78, scale: 0.15 });
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

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uCover;
uniform float uTime;
uniform float uFlow;
uniform float uAspect;
// 运行时恒为 0 的动态循环屏障，阻止 D3D11 HLSL fxc 静态展开多层云海与波纹循环
uniform int uZero;
uniform vec2 uSunPos;         // Normalized position of the white setting sun in screen UV (x in [0..1], y >= 0.20)
uniform float uSunAperture;   // Dynamic Drop-driven aperture area / radius multiplier
uniform float uSunBrightness; // Dynamic Drop-driven sun & cloud illumination brightness
uniform float uBeamIntensity; // Vertical white light pillar intensity & width modulation
uniform float uGodRayPulse;   // Crepuscular ray modulation
uniform float uBeatPhase;     // 0..1 phase within current beat
uniform float uDropIntensity; // 0..1 smooth Drop section envelope
uniform float uLeadLevel;     // Continuous Lead envelope level
uniform float uLeadAttack;    // Continuous Lead attack transient
uniform float uLeadBright;    // Lead spectral brightness
uniform float uGroovePulse;   // Combined rhythmic groove pulse (kick/snare/low/beat)
uniform float uCamShift;      // Camera variant horizontal parallax offset
uniform vec3 uSkyUpper;       // Cover-toned upper sky deep shade (linear space)
uniform vec3 uSkyMid;         // Cover-toned mid sunset sky & cloud body (linear space)
uniform vec3 uSkyVivid;       // Cover-toned vivid lower-mid sunset glow (linear space)
uniform vec3 uSkyWarm;        // Cover-toned warm sky clearing & cloud rim (linear space)
uniform vec3 uSkyAfterglow;   // Cover-toned horizon afterglow band (linear space)
uniform vec3 uSunWarm;        // Cover-toned warm sun aura & highlight (linear space)
uniform vec3 uSunRim;         // Cover-toned god-ray & corona rim glow (linear space)
uniform vec3 uDeepDeck;       // Cover-toned deep water platform deck (linear space)

uniform vec4 uRippleA[${MAX_RIPPLES}]; // (rx, ry, age, amp)
uniform vec4 uRippleB[${MAX_RIPPLES}]; // (maxRadius, freq, tau, brightness)
uniform vec4 uSunWaves[${MAX_SUN_WAVES}]; // (age, strength, scale, 0)

// Convert sRGB color literals to linear light space (matching Engine's FinishShader NeutralToneMapping + sRGB output)
vec3 lin(vec3 srgb) {
  return pow(max(srgb, vec3(0.0)), vec3(2.2));
}

// ── Procedural Hash & Value/FBM Noise ─────────────────────────────────────────
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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

const mat2 OCT_MAT = mat2(0.80, -0.60, 0.60, 0.80);

float fbmClouds(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = uZero; i < 5; i++) {
    v += a * noise2(p);
    p = OCT_MAT * p * 2.03 + vec2(17.1, 31.7);
    a *= 0.5;
  }
  return v;
}

float billowClouds(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = uZero; i < 4; i++) {
    float n = noise2(p);
    v += a * (1.0 - abs(n * 2.0 - 1.0) * 0.70);
    p = OCT_MAT * p * 2.12 + vec2(11.3, 23.9);
    a *= 0.5;
  }
  return v;
}

/**
 * Evaluates the upper 4/5 (uv.y in [0.20, 1.00]) in linear light space:
 * Cover-toned sunset glow (晚霞), 3 layers of visibly drifting clouds (飘动的云),
 * distant horizon mountains & city mist, and a compact white setting sun with vertical light pillar
 * and tight Drop-reactive optical aperture rings.
 */
vec3 renderSunsetSky(vec2 uv, bool isReflection) {
  // Normalized height inside the upper 4/5 sky region: 0.0 at horizon (vUv.y = 0.20), 1.0 at top (vUv.y = 1.00)
  float skyY = clamp((uv.y - ${HORIZON_Y.toFixed(2)}) / ${(1.0 - HORIZON_Y).toFixed(2)}, 0.0, 1.0);
  float skyX = uv.x;

  // Aspect-corrected offset from the white setting sun at the horizon
  vec2 sunUv = uSunPos;
  vec2 toSun = vec2((skyX - sunUv.x) * uAspect, uv.y - sunUv.y);
  float dSun = length(toSun);

  // 1. Luminous Painterly Sunset Sky Gradient Driven by Album Cover Tone (左上深色晚霞 -> 中部柔霞 -> 右上与地平线暖亮余晖)
  vec3 upperLeftOrchid  = uSkyUpper;
  vec3 midSunsetMagenta = uSkyMid;
  vec3 vividCoralRose   = uSkyVivid;
  vec3 warmPeachPink    = uSkyWarm;
  vec3 horizonAfterglow = uSkyAfterglow;

  // Diagonal gradient from upper-left toward lower-right
  float diag = clamp((1.0 - skyX) * 0.55 + skyY * 0.45, 0.0, 1.0);
  vec3 skyCol = mix(warmPeachPink, vividCoralRose, smoothstep(0.08, 0.42, diag));
  skyCol = mix(skyCol, midSunsetMagenta, smoothstep(0.38, 0.72, diag));
  skyCol = mix(skyCol, upperLeftOrchid, smoothstep(0.68, 0.98, diag));

  // Vivid horizon sunset afterglow band (晚霞余晖带)
  float afterglowBand = exp(- skyY * 3.2) * (0.85 + 0.25 * exp(- pow((skyX - sunUv.x) * 1.8, 2.0)));
  skyCol = mix(skyCol, vividCoralRose, exp(- skyY * 1.8) * 0.45);
  skyCol = mix(skyCol, horizonAfterglow, clamp(afterglowBand, 0.0, 0.92));

  // Soft circular sky clearing in the upper-right / center-right sky
  vec2 clearingCenter = vec2(sunUv.x - 0.12, 0.64);
  float dClearing = length(vec2((skyX - clearingCenter.x) * uAspect * 0.82, (uv.y - clearingCenter.y) * 0.95));
  float skyClearing = exp(- (dClearing * dClearing) / 0.16);
  skyCol = mix(skyCol, warmPeachPink * (0.98 + 0.12 * uSunBrightness), skyClearing * 0.62);

  vec3 sunWarmWhite  = uSunWarm;
  vec3 sunPureWhite  = vec3(1.00, 0.98, 1.00);
  vec3 sunsetRimGold = uSunRim;

  // 2. Multi-Layer Sunset Clouds & Visibly Drifting Clouds (浓郁封面同色系晚霞云海 + 明显飘动的浮云与霞带)
  vec2 sunDir2D = normalize(vec2((sunUv.x - skyX) * uAspect, sunUv.y - uv.y) + vec2(1e-4));
  float sunProx = exp(- dSun / max(0.16, 0.28 * uSunAperture));
  float horizonProx = exp(- skyY * 2.2);

  float cloudPersp = mix(1.50, 0.85, pow(skyY, 0.65));
  vec2 baseCloudUv = vec2((skyX - 0.5) * uAspect * cloudPersp + uCamShift * 0.24, skyY);

  // ── Layer A: Diagonal Sweeping Sunset Cloud Bank on Left & Mid Sky (左上至中景斜向晚霞云团) ──
  vec2 rotUv = vec2(baseCloudUv.x * 0.86 + baseCloudUv.y * 0.50, -baseCloudUv.x * 0.50 + baseCloudUv.y * 0.86);
  vec2 p1 = rotUv * vec2(2.1, 2.9) + vec2(-uTime * 0.028 - uFlow * 0.008, uTime * 0.009);
  float c1 = fbmClouds(p1) * 0.55 + billowClouds(p1 * 1.35) * 0.45;
  float c1Sun = fbmClouds(p1 + sunDir2D * 0.07);
  float rim1 = clamp((c1 - c1Sun) * 4.2 + 0.35, 0.0, 1.0);
  float leftCloudMask = smoothstep(0.08, 0.72, (1.0 - skyX) * 0.68 + (1.0 - skyY * 0.5) * 0.32) * (1.0 - 0.45 * skyClearing);
  float d1 = smoothstep(0.40, 0.72, c1 * (0.58 + 0.52 * leftCloudMask));

  vec3 bankShadow = uSkyUpper * 0.92;
  vec3 bankBody   = uSkyMid;
  vec3 bankRim    = mix(mix(uSkyVivid, uSkyWarm, 0.55), sunsetRimGold * (1.02 + 0.20 * uSunBrightness), 0.45 + 0.55 * max(sunProx, horizonProx));
  vec3 col1 = mix(bankShadow, bankBody, smoothstep(0.32, 0.66, c1));
  col1 = mix(col1, bankRim, pow(rim1, 1.2) * (0.55 + 0.45 * max(sunProx, horizonProx)));
  skyCol = mix(skyCol, col1, d1 * 0.82);

  // ── Layer B: Sculpted Drifting Cumulus Sunset Clouds (中景明显飘动的晚霞云朵，带亮边) ──
  vec2 p2 = vec2(baseCloudUv.x * 2.5 - uTime * 0.065 - uFlow * 0.015, baseCloudUv.y * 4.2 + 0.15);
  vec2 warp2 = vec2(fbmClouds(p2 * 0.8 + vec2(3.7, 8.2)), fbmClouds(p2 * 0.8 + vec2(12.4, 5.1))) - 0.5;
  vec2 pw2 = p2 + warp2 * 0.42;
  float c2 = billowClouds(pw2) * 0.64 + fbmClouds(pw2 * 1.6) * 0.36;
  float c2Sun = billowClouds(pw2 + sunDir2D * 0.085);
  float rim2 = clamp((c2 - c2Sun) * 4.8 + 0.38, 0.0, 1.0);
  float band2 = smoothstep(0.05, 0.20, skyY) * smoothstep(0.95, 0.58, skyY);
  float d2 = smoothstep(0.49, 0.74, c2) * band2;

  vec3 cumShadow = mix(uSkyUpper, uSkyMid, 0.35);
  vec3 cumBody   = uSkyVivid * 0.96;
  vec3 cumRim    = mix(mix(uSkyWarm, uSkyAfterglow, 0.45), sunWarmWhite * (1.04 + 0.22 * uSunBrightness), 0.48 + 0.52 * max(sunProx, horizonProx));
  vec3 col2 = mix(cumShadow, cumBody, smoothstep(0.46, 0.70, c2));
  col2 = mix(col2, cumRim, pow(rim2, 1.25) * 0.88);
  // Crisp silver-tinted cloud edge highlight
  float edge2 = smoothstep(0.48, 0.55, c2) * smoothstep(0.67, 0.55, c2);
  col2 += sunWarmWhite * edge2 * (0.26 + 0.45 * max(sunProx, horizonProx)) * uSunBrightness;
  skyCol = mix(skyCol, col2, d2 * (isReflection ? 0.65 : 0.80));

  if (!isReflection) {
    // ── Layer C: Low-to-Mid Drifting Glowing Sunset Cloud Ribbons (前景横向飘动的流云霞带) ──
    vec2 p3 = vec2(baseCloudUv.x * 3.4 + uTime * 0.095 + uFlow * 0.020, baseCloudUv.y * 8.2 - 0.6);
    vec2 warp3 = vec2(noise2(p3 * 1.1 + vec2(0.0, uTime * 0.12)), noise2(p3 * 1.1 + vec2(6.7, 2.3))) - 0.5;
    float c3 = fbmClouds(p3 + warp3 * 0.35);
    float c3Sun = fbmClouds(p3 + warp3 * 0.35 + sunDir2D * 0.08);
    float rim3 = clamp((c3 - c3Sun) * 4.6 + 0.42, 0.0, 1.0);
    float band3 = smoothstep(0.02, 0.12, skyY) * smoothstep(0.68, 0.26, skyY);
    float d3 = smoothstep(0.51, 0.75, c3) * band3;

    vec3 ribbonBase = mix(uSkyMid, uSkyVivid, 0.25);
    vec3 ribbonGlow = mix(uSkyWarm, sunWarmWhite * (1.02 + 0.24 * uSunBrightness), 0.52 + 0.48 * max(sunProx, horizonProx));
    vec3 col3 = mix(ribbonBase, ribbonGlow, clamp(rim3 * 0.85 + 0.30 * horizonProx, 0.0, 1.0));
    skyCol = mix(skyCol, col3, d3 * 0.72);
  }

  // 3. Crepuscular God Rays (丁达尔放射霞光, kept compact around the setting sun)
  float rayAngle = atan(toSun.y, toSun.x);
  float rayPattern = 0.5 + 0.5 * sin(rayAngle * 12.0 + uFlow * 0.32) * cos(rayAngle * 7.0 - uTime * 0.22);
  rayPattern = pow(rayPattern, 2.6);
  float rayReach = 0.22 * uSunAperture;
  float rayMask = exp(- dSun / max(0.06, rayReach)) * smoothstep(0.012, 0.045, dSun) * smoothstep(-0.02, 0.12, toSun.y + 0.04);
  skyCol += sunsetRimGold * rayPattern * rayMask * (0.14 + 0.24 * uGodRayPulse) * uSunBrightness;

  // 4. Distant Horizon Ridges, Twilight Valley Mist & Stepped Cliff Flanks (skyY in [0.0, 0.15])
  if (skyY < 0.16 && !isReflection) {
    float xw = skyX + uCamShift * 0.06;
    // Far mountain ridge silhouette
    float farRidge = 0.056
      + 0.036 * smoothstep(0.55, 0.0, abs(xw - 0.12))
      + 0.026 * smoothstep(0.45, 0.0, abs(xw - 0.88))
      + 0.010 * noise2(vec2(xw * 7.5, 1.3));
    if (skyY < farRidge) {
      float hFrac = clamp(skyY / max(farRidge, 1e-3), 0.0, 1.0);
      vec3 farCol = mix(uSkyUpper * 0.62, mix(uSkyUpper, uSkyVivid, 0.50) * 0.86, hFrac);
      float beamMist = exp(- pow((skyX - sunUv.x) * 4.5, 2.0));
      farCol = mix(farCol, sunWarmWhite * (0.85 + 0.18 * uSunBrightness), beamMist * 0.52);
      skyCol = mix(skyCol, farCol, smoothstep(farRidge, farRidge - 0.005, skyY));
    }

    // Mid mountain ridge with twinkling twilight city lights in the valley
    float midRidge = 0.035
      + 0.040 * smoothstep(0.42, 0.0, xw)
      + 0.025 * smoothstep(0.38, 0.0, 1.0 - xw)
      + 0.007 * noise2(vec2(xw * 12.0, 4.7));
    if (skyY < midRidge) {
      vec3 midCol = mix(uDeepDeck * 1.45, uSkyUpper * 0.62, skyY / max(midRidge, 1e-3));
      vec2 cityGrid = vec2(xw * 210.0, skyY * 400.0);
      vec2 cellId = floor(cityGrid);
      vec2 cellUv = fract(cityGrid) - 0.5;
      float citySeed = hash21(cellId);
      if (citySeed > 0.935 && skyY > 0.007 && skyY < midRidge - 0.005) {
        float dotDist = length(cellUv);
        float twinkle = 0.65 + 0.35 * sin(uTime * 3.5 + citySeed * 62.8);
        float spark = smoothstep(0.32, 0.05, dotDist) * twinkle;
        midCol += sunWarmWhite * spark * (0.55 + 0.45 * uSunBrightness);
      }
      float beamMist = exp(- pow((skyX - sunUv.x) * 5.2, 2.0));
      midCol = mix(midCol, mix(uSkyVivid, uSkyWarm, 0.50) * (0.85 + 0.18 * uSunBrightness), beamMist * 0.42);
      skyCol = mix(skyCol, midCol, smoothstep(midRidge, midRidge - 0.004, skyY));
    }

    // Smooth stepped rocky cliff ledges on left and right flanks
    float leftMask = smoothstep(0.35, 0.0, skyX);
    float leftCliff = 0.092 * pow(leftMask, 1.35) + 0.005 * sin(skyY * 170.0 + skyX * 24.0) * leftMask;
    float rightMask = smoothstep(0.76, 1.0, skyX);
    float rightCliff = 0.050 * pow(rightMask, 1.40) + 0.004 * sin(skyY * 160.0 - skyX * 20.0) * rightMask;
    float cliffH = max(leftCliff, rightCliff);
    if (skyY < cliffH) {
      float terrace = 0.5 + 0.5 * sin(skyY * 200.0 - skyX * 18.0);
      float topEdge = smoothstep(cliffH - 0.013, cliffH, skyY);
      vec3 rockShadow = uDeepDeck * 1.15;
      vec3 rockLit    = mix(uSkyMid, uSkyVivid, 0.55) * (0.88 + 0.20 * uSunBrightness);
      vec3 cliffCol   = mix(rockShadow, rockLit, 0.25 * terrace + 0.75 * topEdge);
      skyCol = mix(skyCol, cliffCol, smoothstep(cliffH, cliffH - 0.003, skyY));
    }
  }

  // 5. Compact White Setting Sun, Vertical Light Pillar & Smaller Drop-Driven Optical Aperture (调小夕阳光圈，保留浓郁晚霞)
  // (A) Compact Inner & Mid Solar Corona
  float coronaR1 = 0.032 * uSunAperture;
  float coronaR2 = 0.072 * uSunAperture;
  float corona1  = exp(- (dSun * dSun) / max(1e-4, coronaR1 * coronaR1));
  float corona2  = exp(- dSun / max(1e-3, coronaR2));
  skyCol += sunsetRimGold * corona2 * (0.15 + 0.16 * uSunBrightness);
  skyCol += sunPureWhite * corona1 * (0.32 + 0.34 * uSunBrightness);

  // (B) Vertical White Light Pillar (贯穿天际的白色夕阳光柱 from Closer LIONE Remix cover)
  float dxBeam = abs(skyX - sunUv.x) * uAspect;
  float beamCoreW = (0.0030 + 0.0020 * uBeamIntensity) * (1.0 + 0.50 * exp(-skyY * 7.5));
  float beamAuraW = (0.012 + 0.012 * uSunAperture) * (1.0 + 0.40 * exp(-skyY * 5.0));
  float beamCore = exp(- (dxBeam * dxBeam) / max(1e-6, beamCoreW * beamCoreW));
  float beamAura = exp(- dxBeam / max(1e-4, beamAuraW));
  skyCol += sunWarmWhite * beamAura * (0.20 + 0.20 * uSunBrightness);
  skyCol = mix(skyCol, sunPureWhite * (1.10 + 0.28 * uSunBrightness), clamp(beamCore * (0.88 + 0.20 * uBeamIntensity), 0.0, 1.0));

  // (C) Compact Setting Sun Horizon Cushion & Pure-White Solar Disc (紧凑精致的夕阳白核与地平线光座)
  vec2 baseDelta = vec2(dxBeam / (0.044 * uSunAperture), skyY / (0.018 * uSunAperture));
  float baseCushion = exp(- dot(baseDelta, baseDelta));
  skyCol += sunPureWhite * baseCushion * (0.45 + 0.34 * uSunBrightness);

  float coreRadius = 0.017 * uSunAperture;
  float sunDisc = exp(- (dSun * dSun) / max(1e-5, coreRadius * coreRadius));
  skyCol += sunPureWhite * sunDisc * (0.65 + 0.45 * uSunBrightness);

  // (D) Smaller, Delicate Dual Optical Lens Aperture Rings (精致小巧的夕阳光圈环，随 Drop 律动呼吸)
  float irisR1 = (0.032 + 0.013 * uGroovePulse + 0.010 * uLeadLevel) * uSunAperture;
  float irisW1 = 0.0024 + 0.0016 * uLeadAttack;
  float irisRing1 = exp(- pow((dSun - irisR1) / irisW1, 2.0));

  float irisR2 = (0.058 + 0.018 * uGroovePulse + 0.014 * uLeadLevel) * uSunAperture;
  float irisW2 = 0.0032 + 0.0020 * uGroovePulse;
  float irisRing2 = exp(- pow((dSun - irisR2) / irisW2, 2.0));

  float irisIntensity = (0.15 + 0.28 * uGroovePulse + 0.20 * uLeadAttack) * uSunBrightness;
  skyCol += sunPureWhite * (irisRing1 * 0.72 + irisRing2 * 0.42) * irisIntensity;

  // Compact expanding beat/groove solar aperture waves around the setting sun (kept small and subtle)
  for (int i = uZero; i < ${MAX_SUN_WAVES}; i++) {
    vec4 sw = uSunWaves[i];
    if (sw.y <= 0.001) continue;
    float waveAge = sw.x;
    float waveRad = sw.z * 0.72 * (1.0 - exp(-waveAge / 0.46));
    float waveW   = 0.0035 + 0.0045 * waveAge;
    float ring    = exp(- pow((dSun - waveRad) / waveW, 2.0)) * exp(-waveAge / 0.72) * smoothstep(0.0, 0.04, waveAge);
    skyCol += sunPureWhite * ring * sw.y * 0.20 * uSunBrightness;
  }

  // (E) Iconic Floating White Diamond Halo Emblem (◇, homage to the Closer LIONE Remix cover)
  if (!isReflection) {
    vec2 diaCenter = vec2(sunUv.x - 0.185, ${HORIZON_Y.toFixed(2)} + 0.056);
    vec2 dp = vec2((skyX - diaCenter.x) * uAspect, uv.y - diaCenter.y);
    float manhattan = abs(dp.x) + abs(dp.y);
    float diaSize = 0.015 * (1.0 + 0.22 * uLeadLevel + 0.18 * uGroovePulse);
    float diaOuter = exp(- pow((manhattan - diaSize) / 0.0020, 2.0));
    float diaInner = exp(- pow((manhattan - diaSize * 0.56) / 0.0016, 2.0));
    float diaGlow  = exp(- manhattan / (diaSize * 2.0)) * 0.25;
    skyCol += sunPureWhite * (diaOuter * 0.90 + diaInner * 0.70 + diaGlow) * (0.75 + 0.40 * uSunBrightness);
  }

  return skyCol;
}

/**
 * Evaluates a realistic 3D perspective ambient water wave field (horizontally elongated perspective swells)
 * so the platform surface has authentic liquid undulations, front/back wave-slope reflections, and broken sun glitter.
 */
vec2 evalAmbientWaterWaves(vec2 waterXZ, float t) {
  vec2 grad = vec2(0.0);
  // Wave train 1: Primary horizontal perspective water swell
  float p1 = waterXZ.x * 2.4 + waterXZ.y * 4.8 - t * 2.6;
  grad += vec2(2.4, 4.8) * cos(p1) * 0.026;
  // Wave train 2: Counter-crossing perspective swell
  float p2 = -waterXZ.x * 3.1 + waterXZ.y * 5.6 - t * 3.1;
  grad += vec2(-3.1, 5.6) * cos(p2) * 0.022;
  // Wave train 3: Mid-frequency wind chop (slices reflections into horizontal liquid bars)
  float p3 = waterXZ.x * 5.2 + waterXZ.y * 9.5 + t * 3.8;
  grad += vec2(5.2, 9.5) * cos(p3) * 0.014;
  // Wave train 4: Fine capillary surface texture
  float p4 = -waterXZ.x * 7.8 + waterXZ.y * 13.5 - t * 4.6;
  grad += vec2(-7.8, 13.5) * cos(p4) * 0.009;
  return grad;
}

/**
 * Evaluates the bottom 1/5 (uv.y in [0.00, 0.20)):
 * Platform displaying the album cover clearly, with REALISTIC physical 3D water reflections:
 * - Smooth, plump 3D concentric Lead ripples + horizontal perspective water swells
 * - Front-slope vs. back-slope optical contrast (back-slopes tilted toward the horizon reflect the bright sunset sky;
 *   front-slopes tilted toward the viewer refract deeply into the album cover)
 * - Horizontal broken shimmering water reflection bars below the setting sun & vertical light pillar
 * - Low average sky reflection on flat water so the album cover stays vivid and unobstructed.
 */
struct WaterSurface {
  float platX;
  float platY;
  float perspZ;
  float insideCover;
  float backSlope;
  float sideSlope;
  vec2 totalGrad;
  vec3 waterNormal;
  vec3 coverCol;
  vec2 reflUv;
};

/**
 * 预处理底部 1/5 水面平台几何、波纹法线、平铺封面折射与天空反射 UV，
 * 以便在 main() 中与上半部天空共用单次 renderSunsetSky 调用，消除 220+ 行天空着色器的双重内联。
 */
WaterSurface prepareWaterPlatform(vec2 uv) {
  float platX = uv.x;
  float platY = clamp(uv.y / ${HORIZON_Y.toFixed(2)}, 0.0, 1.0);

  // 3D Perspective Homography parameters for the horizontal platform plane (y = 0)
  float wNear  = 0.84;
  float wFar   = 0.31;
  float perspW = mix(wNear, wFar, platY);
  float perspZ = wNear / perspW;
  float foreshorten = mix(1.5, 4.2, platY);
  vec2 waterXZ = vec2((platX - 0.5) * uAspect * perspZ * 2.1, perspZ * 3.8);

  // 1. Accumulate 3D Lead-driven Concentric Water Ripples (projected in 3D perspective on the horizontal plane)
  vec2 rippleGrad = vec2(0.0);
  float rippleHeight = 0.0;
  float rippleCaustic = 0.0;

  for (int i = uZero; i < ${MAX_RIPPLES}; i++) {
    vec4 ra = uRippleA[i]; // (rx, ry, age, amp)
    if (ra.w <= 0.001) continue;
    vec4 rb = uRippleB[i]; // (maxRadius, freq, tau, brightness)

    float age  = ra.z;
    float amp  = ra.w;
    float maxR = rb.x;
    float freq = rb.y;
    float tau  = rb.z;

    // 3D perspective-corrected horizontal & depth offset on the flat water plane
    float rPerspW = mix(wNear, wFar, ra.y);
    float perspScaleX = rPerspW / perspW;
    vec2 delta = vec2(((platX - 0.5) * perspScaleX - (ra.x - 0.5)) * uAspect, (platY - ra.y) * 0.34 * foreshorten);
    float dist = length(delta);

    // Expanding wavefront radius
    float rad = maxR * (1.0 - exp(-age / tau));
    float packetW = 0.032 + 0.042 * (rad / max(maxR, 0.05));
    float distFromFront = dist - rad;

    // Smooth Gaussian wave-packet envelope (2-3 plump, rounded concentric liquid swells)
    float packetEnv = exp(- (distFromFront * distFromFront) / (packetW * packetW));
    float timeFade  = exp(- age / (tau * 2.15)) * smoothstep(0.0, 0.025, age);
    float centerSmooth = smoothstep(0.0, 0.016, dist);
    float env = amp * packetEnv * timeFade * centerSmooth;

    if (env > 0.0005) {
      float phase = distFromFront * freq * 6.2831853;
      float waveSin = sin(phase);
      float waveCos = cos(phase);
      vec2 dir = delta / max(dist, 1e-4);

      // True 3D radial wave slope (dh/dx, dh/dz) with perspective depth foreshortening
      rippleGrad += vec2(dir.x, dir.y * 1.65) * (env * waveCos * 1.45);
      rippleHeight += env * waveSin;
      // Wave crest focusing (positive on rounded crests, negative in troughs)
      rippleCaustic += env * waveSin;
    }
  }

  // 2. Combine Lead ripples with 3D perspective ambient water swells
  float swellActivity = 0.55 + 0.35 * uLeadLevel + 0.25 * uGroovePulse;
  vec2 ambientGrad = evalAmbientWaterWaves(waterXZ, uFlow) * swellActivity;
  vec2 totalGrad = rippleGrad + ambientGrad;

  // 3D surface normal: X is horizontal, Y is vertical up, Z is depth toward the horizon
  vec3 waterNormal = normalize(vec3(-totalGrad.x * 0.52, 1.0, -totalGrad.y * 0.62));

  // Front-slope vs. Back-slope decomposition:
  // backSlope (>0): wave facet tilted toward the horizon/sky (catches bright sky & sunset reflection!)
  // frontSlope (>0): wave facet tilted toward the viewer (refracts deeply into the submerged album cover!)
  float backSlope  = clamp(totalGrad.y * 0.58 + length(totalGrad) * 0.18, 0.0, 1.0);
  float frontSlope = clamp(-totalGrad.y * 0.55, 0.0, 1.0);
  float sideSlope  = clamp(abs(totalGrad.x) * 0.45, 0.0, 1.0);

  // 3. Album Cover Laid Flat in True 3D Perspective Homography (将竖向/正方形专辑封面以真实 3D 透视“平放”在水面平台上，消除 2D 竖向压缩感!)
  // In exact 3D pinhole projection of a flat horizontal square/slab on the y=0 plane:
  // - Screen width w(platY) tapers linearly from wNear at the bottom (platY=0) to wFar at the horizon (platY=1).
  // - Horizontal texture coordinate u = 0.5 + (platX - 0.5) / w(platY)
  // - Projective depth coordinate   v = (wFar * platY) / w(platY)
  // Subtle camera lateral parallax on the 3D ground plane
  float centeredX = platX - 0.5 + uCamShift * 0.035 * (1.0 - 0.55 * platY);
  float rawU = 0.5 + centeredX / perspW;
  float rawV = (wFar * platY) / perspW;

  // Water refraction in 3D plane UV space (scaled by perspective depth so refraction is finer near the horizon)
  vec2 refractUv = vec2(waterNormal.x, waterNormal.z) * vec2(0.026, 0.036) * (0.45 + 0.55 * (wFar / perspW));
  vec2 planeUv   = vec2(rawU, rawV) + refractUv;

  // Sample the flat-laid album cover inside u in [0, 1], with subtle chromatic dispersion from water refraction
  vec2 clampedUvR = clamp(planeUv + refractUv * 0.06, 0.002, 0.998);
  vec2 clampedUvG = clamp(planeUv,                    0.002, 0.998);
  vec2 clampedUvB = clamp(planeUv - refractUv * 0.06, 0.002, 0.998);

  vec3 coverSample = vec3(
    texture(uCover, clampedUvR).r,
    texture(uCover, clampedUvG).g,
    texture(uCover, clampedUvB).b
  );
  coverSample = pow(max(coverSample, vec3(0.0)), vec3(1.05)) * 0.96;

  // Outside the 3D perspective trapezoid of the flat-laid album cover (rawU < 0 or rawU > 1):
  // Render the surrounding glossy dark-orchid water platform deck with soft submerged cover-edge bleed
  // and a crisp 3D perspective slab border along rawU = 0 and rawU = 1!
  float outsideDist = max(0.0 - rawU, rawU - 1.0);
  float insideCover = 1.0 - smoothstep(-0.004, 0.012, outsideDist);
  float edgeBevel   = exp(- pow(outsideDist / 0.010, 2.0));

  // Ambient water deck outside the flat-laid cover slab: deep twilight water with soft blurred edge bleed
  vec2 bleedUv = clamp(vec2(rawU, rawV * 0.85 + 0.08) + refractUv * 2.2, 0.01, 0.99);
  vec3 edgeBleedCol = texture(uCover, bleedUv).rgb;
  vec3 deepWaterDeck = mix(uDeepDeck, edgeBleedCol * 0.42, exp(- outsideDist * 5.5));
  // Subtle 3D perspective deck grid lines on the outer water wings to reinforce the 3D horizontal plane
  float deckGridU = smoothstep(0.92, 0.99, cos(rawU * 3.14159265 * 8.0));
  float deckGridV = smoothstep(0.92, 0.99, cos(rawV * 3.14159265 * 6.0));
  deepWaterDeck += uSkyMid * max(deckGridU, deckGridV) * 0.08 * (1.0 - insideCover);

  vec3 coverCol = mix(deepWaterDeck, coverSample, insideCover);
  // Crisp luminous 3D perspective bevel along the left and right edges of the flat-laid cover
  coverCol += mix(uSkyWarm, uSkyAfterglow, 0.5) * edgeBevel * (0.28 + 0.18 * uSunBrightness);

  // Authentic 3D liquid shading on the refracted cover:
  // Focused caustic brightening on wave crests + subtle deep-water shading on wave front-slopes/troughs
  float liquidShading = 1.0 + clamp(rippleCaustic * 0.15, -0.10, 0.18) - 0.12 * frontSlope;
  coverCol *= liquidShading;

  // 4. Realistic Angle-Dependent Sky & Sunset Cloud Reflection (波峰背面真实倒影天空晚霞，正面透出清晰平放封面)
  // Sample the reflected sky with strong normal distortion so reflected clouds & light beam ripple like real water
  float reflSkyY = ${HORIZON_Y.toFixed(2)} + (1.0 - platY) * ${(1.0 - HORIZON_Y).toFixed(2)} * 0.52;
  vec2 reflUv = clamp(
    vec2(platX + waterNormal.x * 0.095, reflSkyY + abs(waterNormal.z) * 0.085),
    vec2(0.002, ${HORIZON_Y.toFixed(2)}),
    vec2(0.998, 0.998)
  );
  return WaterSurface(
    platX,
    platY,
    perspZ,
    insideCover,
    backSlope,
    sideSlope,
    totalGrad,
    waterNormal,
    coverCol,
    reflUv
  );
}

vec3 shadeWaterPlatform(WaterSurface ws, vec3 skyReflCol) {
  float platX = ws.platX;
  float platY = ws.platY;
  float perspZ = ws.perspZ;
  float insideCover = ws.insideCover;
  float backSlope = ws.backSlope;
  float sideSlope = ws.sideSlope;
  vec2 totalGrad = ws.totalGrad;
  vec3 waterNormal = ws.waterNormal;
  vec3 coverCol = ws.coverCol;

  // Schlick Fresnel + directional back-slope reflection weight:
  // Inside the flat-laid cover (insideCover=1), flat water has only ~3.5% reflection so the cover is 96.5% pure!
  // Outside the cover slab on the outer water wings, reflection is slightly stronger (~18%) like deep glossy water.
  vec3 viewDir = normalize(vec3((0.5 - platX) * uAspect * 0.50, 0.34 + 0.44 * (1.0 - platY), -0.88));
  float cosTheta = clamp(dot(waterNormal, viewDir), 0.0, 1.0);
  float fresnel = pow(1.0 - cosTheta, 3.8);
  float baseRefl = mix(0.16, 0.035, insideCover);
  float reflWeight = clamp(
    baseRefl + 0.075 * fresnel + 0.24 * pow(backSlope, 1.15) + 0.08 * sideSlope,
    0.03,
    0.42
  );
  vec3 platformCol = mix(coverCol, clamp(skyReflCol, vec3(0.0), vec3(0.95)), reflWeight);

  // 5. Realistic 3D Specular Water Sheen & Broken Horizontal Sun-Pillar Reflection Bars (真实水面高光与横向破碎夕阳水路)
  // (A) Directional sun & sky-dome specular reflection on tilted 3D wave facets
  vec3 sunLightDir = normalize(vec3((uSunPos.x - platX) * uAspect, 0.30, 0.92));
  vec3 halfSun = normalize(sunLightDir + viewDir);
  float ndothSun = max(0.0, dot(waterNormal, halfSun));

  // Broad sky-horizon reflection sheen across tilted wave back-slopes (gives every ripple a wet, glossy 3D arc!)
  vec3 horizonLightDir = normalize(vec3((0.55 - platX) * uAspect * 0.35, 0.42, 0.88));
  vec3 halfHorizon = normalize(horizonLightDir + viewDir);
  float ndothHorizon = max(0.0, dot(waterNormal, halfHorizon));

  float waveTiltMask = smoothstep(0.04, 0.38, length(totalGrad));
  float glossyWaveSheen = pow(ndothHorizon, 18.0) * smoothstep(0.02, 0.45, backSlope + 0.4 * sideSlope);
  float crispSunGlint   = pow(ndothSun, 76.0) * waveTiltMask;

  vec3 wetSheenCol = uSkyAfterglow * (0.85 + 0.22 * uSunBrightness);
  vec3 sunGlintCol = mix(uSunWarm, vec3(1.0), 0.45) * (0.90 + 0.30 * uSunBrightness);
  platformCol += wetSheenCol * glossyWaveSheen * 0.36 + sunGlintCol * crispSunGlint * 0.55;

  // (B) Broken Horizontal Sun & Light-Pillar Reflection Path on Water (夕阳与白色光柱在水面的真实横向破碎波光条纹)
  float dxPillarWater = abs(platX + waterNormal.x * 0.11 - uSunPos.x) * uAspect;
  float waterColumnW  = 0.010 + 0.024 * (1.0 - platY) + 0.016 * length(totalGrad);
  float columnMask    = exp(- (dxPillarWater * dxPillarWater) / max(1e-5, waterColumnW * waterColumnW));

  // Horizontal wave crests slice the reflected sun & vertical beam into shimmering horizontal bars
  float horizWaveStripes = smoothstep(-0.02, 0.22, totalGrad.y + 0.08 * sin(perspZ * 34.0 - uFlow * 4.2 + waterNormal.x * 18.0));
  float brokenSunPath = columnMask * horizWaveStripes * (0.28 + 0.48 * pow(ndothSun, 12.0));
  platformCol += sunGlintCol * brokenSunPath * (0.45 + 0.25 * platY);

  // (C) Glossy water horizon meniscus at platY -> 1.0 (vUv.y = 0.20)
  float horizonEdge = smoothstep(0.965, 1.0, platY);
  platformCol = mix(platformCol, mix(platformCol, uSkyAfterglow, 0.42), horizonEdge);

  return platformCol;
}

void main() {
  bool isWater = vUv.y < ${HORIZON_Y.toFixed(4)};
  WaterSurface ws;
  vec2 skyUv = vUv;
  if (isWater) {
    ws = prepareWaterPlatform(vUv);
    skyUv = ws.reflUv;
  }
  vec3 skyCol = renderSunsetSky(skyUv, isWater);
  vec3 col = isWater ? shadeWaterPlatform(ws, skyCol) : skyCol;

  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  fragColor = vec4(col, 1.0);
}
`;

/** Pre-compilable shader object for Engine startup warm-up. */
export const sunsetPrograms = (): THREE.Object3D[] => [
  new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: { uZero: { value: 0 } } }),
  ),
];

export class SunsetScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: LyricRig;

  private readonly ripples: WaterRippleEvent[];
  private readonly rippleTimes: Float64Array;
  private readonly rippleA = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4());
  private readonly rippleB = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4());

  private readonly sunWaves: SunWaveEvent[];
  private readonly sunWaveTimes: Float64Array;
  private readonly sunWaveU = Array.from({ length: MAX_SUN_WAVES }, () => new THREE.Vector4());

  private readonly rawKickTimes: Float64Array;
  private readonly rawKickVals: Float64Array;
  private readonly rawSnareTimes: Float64Array;
  private readonly rawSnareVals: Float64Array;

  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly soft: boolean;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, init.aspect, 0.1, 1000);

    const { palette, music } = init;
    const tone = extractCoverTone(init);
    this.scene.background = colorFromHsl(tone.deepHue, tone.mono ? 0.04 : 0.55, 0.11);

    this.ripples = buildLeadRipples(music, init.seed ?? 20261020);
    this.rippleTimes = Float64Array.from(this.ripples, r => r.t);

    this.sunWaves = buildSunWaves(music);
    this.sunWaveTimes = Float64Array.from(this.sunWaves, w => w.t);

    const kicks = music.a.hits.kick ?? [];
    this.rawKickTimes = Float64Array.from(kicks, h => h[0]);
    this.rawKickVals = Float64Array.from(kicks, h => h[1]);

    const snares = music.a.hits.snare ?? [];
    this.rawSnareTimes = Float64Array.from(snares, h => h[0]);
    this.rawSnareVals = Float64Array.from(snares, h => h[1]);

    // 根据专辑封面色调动态构建晚霞天空、云层与水台色板（粉色封面呈现浪漫粉霞，深蓝/暖金等封面同步映射）
    const mkLin = (stop: typeof tone.mid, minL: number, maxL: number, minS: number, maxS: number, bias = 0) => {
      const c = tuneCoverStop(stop, tone, minL, maxL, minS, maxS, bias);
      return linearVec3FromHsl(c.h, c.s, c.l);
    };
    const skyUpper = mkLin(tone.dark, 0.42, 0.48, 0.46, 0.68, -5);
    const skyMid = mkLin(tone.midDark, 0.56, 0.62, 0.56, 0.78, 0);
    const skyVivid = mkLin(tone.mid, 0.68, 0.74, 0.68, 0.90, 3);
    const skyWarm = mkLin(tone.bright, 0.79, 0.84, 0.74, 0.96, 6);
    const skyAfterglow = mkLin(tone.highlight, 0.88, 0.92, 0.72, 0.98, 8);
    const sunWarm = mkLin(tone.highlight, 0.93, 0.96, 0.65, 0.95, 8);
    const sunRim = mkLin(tone.bright, 0.85, 0.90, 0.72, 0.96, 6);
    const deepDeck = mkLin(tone.dark, 0.11, 0.15, 0.44, 0.65, -6);

    this.uniforms = {
      uCover: { value: init.cover },
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uAspect: { value: init.aspect },
      uZero: { value: 0 },
      uSunPos: { value: new THREE.Vector2(0.72, HORIZON_Y + 0.024) },
      uSunAperture: { value: 1.0 },
      uSunBrightness: { value: 1.0 },
      uBeamIntensity: { value: 1.0 },
      uGodRayPulse: { value: 0.5 },
      uBeatPhase: { value: 0 },
      uDropIntensity: { value: 0 },
      uLeadLevel: { value: 0 },
      uLeadAttack: { value: 0 },
      uLeadBright: { value: 0.5 },
      uGroovePulse: { value: 0 },
      uCamShift: { value: 0 },
      uSkyUpper: { value: skyUpper },
      uSkyMid: { value: skyMid },
      uSkyVivid: { value: skyVivid },
      uSkyWarm: { value: skyWarm },
      uSkyAfterglow: { value: skyAfterglow },
      uSunWarm: { value: sunWarm },
      uSunRim: { value: sunRim },
      uDeepDeck: { value: deepDeck },
      uRippleA: { value: this.rippleA },
      uRippleB: { value: this.rippleB },
      uSunWaves: { value: this.sunWaveU },
    };

    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(
      tri,
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        depthTest: false,
        depthWrite: false,
      }),
    );
    quad.frustumCulled = false;
    quad.renderOrder = -10;
    this.scene.add(quad);

    // High-contrast cover-toned lyric palette so sung words read crisply against the sunset sky
    const lyricPalette: Palette = {
      ...palette,
      ink: colorFromHsl(tone.deepHue, tone.mono ? 0.04 : 0.62, 0.08),
      paper: new THREE.Color('#ffffff'),
      signal: colorFromHsl(tone.highHue, tone.mono ? 0.06 : 0.88, 0.76),
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
   * Four distinct 3D camera trajectories (horizon, beam, drift, halo) that all keep the 3D horizon (y=0)
   * projected at exact vUv.y = 0.20 while providing distinct spatial motion and parallax.
   */
  private updateCamera(t: number, shot: Shot): { camShift: number; sunX: number; sunY: number } {
    const k = clamp01((t - shot.start) / Math.max(0.5, shot.end - shot.start));
    const e = inOutCubic(k);
    const shotT = Math.max(0, t - shot.start);
    const variant = shot.variant || 'horizon';

    let camX = 0;
    let camY = 2.4;
    let camZ = -shotT * 4.5;
    let yaw = 0;
    let sunX = 0.725;
    let sunY = HORIZON_Y + 0.022;

    if (variant === 'beam') {
      camX = 2.8 + Math.sin(shotT * 0.35) * 1.4;
      camY = 2.1 + Math.sin(shotT * 0.28) * 0.25;
      camZ = -12.0 - shotT * 5.2;
      yaw = -0.06 + Math.sin(shotT * 0.22) * 0.03;
      sunX = 0.688 + Math.sin(shotT * 0.24) * 0.020;
      sunY = HORIZON_Y + 0.025;
    } else if (variant === 'drift') {
      camX = lerp(-6.5, 6.5, e) + Math.sin(shotT * 0.3) * 0.8;
      camY = 2.6 + Math.cos(shotT * 0.25) * 0.2;
      camZ = -6.0 - shotT * 3.8;
      yaw = lerp(0.08, -0.08, e);
      sunX = lerp(0.745, 0.675, e);
      sunY = HORIZON_Y + 0.020;
    } else if (variant === 'halo') {
      camX = Math.cos(shotT * 0.26) * 3.6;
      camY = 3.2 + Math.sin(shotT * 0.20) * 0.3;
      camZ = 8.0 - shotT * 4.0;
      yaw = Math.sin(shotT * 0.18) * 0.05;
      sunX = 0.712 + Math.cos(shotT * 0.20) * 0.022;
      sunY = HORIZON_Y + 0.028;
    } else {
      camX = Math.sin(shotT * 0.24) * 1.8;
      camY = 2.4 + Math.sin(shotT * 0.32) * 0.18;
      camZ = -shotT * 4.2;
      yaw = Math.sin(shotT * 0.16) * 0.035;
      sunX = 0.728 + Math.sin(shotT * 0.18) * 0.015;
      sunY = HORIZON_Y + 0.022;
    }

    this.camera.position.set(camX, camY, camZ);
    this.camera.quaternion.setFromEuler(new THREE.Euler(HORIZON_PITCH, yaw, 0, 'YXZ'));
    this.camera.updateMatrixWorld();

    return { camShift: camX * 0.08, sunX, sunY };
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, fx } = ctx;
    const { camShift, sunX, sunY } = this.updateCamera(t, shot);

    const fg = music.foregroundAt(t);
    const lead = music.leadAt(t);
    const beatInfo = music.at(t);
    const dropInt = music.dropIntensity(t);
    const isDrop = shot.section.label === 'drop' || dropInt > 0.01;

    // Effective Lead signal driving water ripples and melodic highlights
    const leadLevel = Math.max(fg.level, lead.level * (isDrop ? 1.0 : 0.8));
    const leadAttack = Math.max(fg.attack, lead.attack * (isDrop ? 1.0 : 0.8));
    const leadBright = fg.brightness;

    // Combined Drop rhythm/groove signal (kicks, snares, low-frequency envelope, beat pump, and foreground accents)
    const rawKick = this.rawHitPulse(this.rawKickTimes, this.rawKickVals, t, 0.22);
    const rawSnare = this.rawHitPulse(this.rawSnareTimes, this.rawSnareVals, t, 0.18);
    const lowEnv = music.env('low', t);
    const beatPump = Math.pow(1.0 - beatInfo.phase, 2.2) * (isDrop ? 0.50 : 0.20);
    const groovePulse = clamp01(
      Math.max(rawKick * 0.95, rawSnare * 0.82, fg.attack * 0.90) + 0.26 * lowEnv + 0.30 * beatPump,
    );

    // 1. Update Sunset Lighting (Compact Aperture Area, Brightness, Beam & God Rays) according to Drop groove
    const dropBoost = isDrop ? 0.12 + 0.10 * dropInt : 0.0;
    const apertureScale =
      0.58 +
      dropBoost +
      (this.soft ? 0.20 : 0.32) * groovePulse +
      0.22 * leadLevel +
      0.20 * leadAttack;

    const sunBrightness =
      0.68 +
      dropBoost * 0.55 +
      (this.soft ? 0.26 : 0.42) * groovePulse +
      0.30 * leadAttack +
      0.22 * leadLevel;

    const beamIntensity =
      0.72 +
      0.28 * (isDrop ? 1 : 0) +
      0.52 * leadAttack +
      0.40 * groovePulse +
      0.28 * leadLevel;

    const u = this.uniforms;
    u.uTime.value = t;
    u.uFlow.value = t + music.foregroundMotion(t, 0.25) * (this.soft ? 0.35 : 0.55);
    (u.uSunPos.value as THREE.Vector2).set(sunX, sunY);
    u.uSunAperture.value = apertureScale;
    u.uSunBrightness.value = sunBrightness;
    u.uBeamIntensity.value = beamIntensity;
    u.uGodRayPulse.value = clamp01(0.32 + 0.65 * groovePulse + 0.42 * leadLevel);
    u.uBeatPhase.value = beatInfo.phase;
    u.uDropIntensity.value = isDrop ? Math.max(0.65, dropInt) : 0.15;
    u.uLeadLevel.value = leadLevel;
    u.uLeadAttack.value = leadAttack;
    u.uLeadBright.value = leadBright;
    u.uGroovePulse.value = groovePulse;
    u.uCamShift.value = camShift;

    // 2. Populate active Lead-driven water ripples on the bottom 1/5 platform (pure function of t)
    const foregroundActive = (leadLevel + leadAttack) > 1e-4 ? 1.0 : 0.0;
    let rCount = 0;
    for (let i = lastIndex(this.rippleTimes, t); i >= 0 && rCount < MAX_RIPPLES; i--) {
      const r = this.ripples[i];
      const age = t - r.t;
      if (age < 0) continue;
      if (age > 3.2) break;
      const weight = music.foregroundEventWeight(r.t, t) * foregroundActive;
      const effectiveAmp = r.amp * weight * (0.75 + 0.45 * leadLevel + 0.35 * leadAttack) * (this.soft ? 0.8 : 1.0);
      if (effectiveAmp * Math.exp(-age / (r.tau * 2.15)) < 0.012 && age > 0.8) continue;

      this.rippleA[rCount].set(r.x, r.y, age, effectiveAmp);
      this.rippleB[rCount].set(r.maxRadius, r.freq, r.tau, r.brightness);
      rCount++;
    }
    for (let i = rCount; i < MAX_RIPPLES; i++) {
      this.rippleA[i].set(0, 0, 0, 0);
      this.rippleB[i].set(0, 0, 0, 0);
    }

    // 3. Populate active expanding solar aperture waves in the upper 4/5 sky (pure function of t)
    let wCount = 0;
    for (let i = lastIndex(this.sunWaveTimes, t); i >= 0 && wCount < MAX_SUN_WAVES; i--) {
      const w = this.sunWaves[i];
      const age = t - w.t;
      if (age < 0) continue;
      if (age > 2.2) break;
      this.sunWaveU[wCount].set(age, w.strength * (0.65 + 0.55 * groovePulse), w.scale * apertureScale, 0);
      wCount++;
    }
    for (let i = wCount; i < MAX_SUN_WAVES; i++) {
      this.sunWaveU[i].set(0, 0, 0, 0);
    }

    // 4. Post-processing control: keep pink sunset colors & platform album cover clean and vivid
    fx.impact = 0;
    fx.impactInvert = 0;
    fx.glitch = 0;
    fx.duotone = 0;
    fx.invert = 0;
    fx.zoom = Math.min(fx.zoom, 0.08);
    fx.bloom = (this.soft ? 0.16 : 0.20) + 0.08 * leadAttack + 0.04 * groovePulse;
    fx.vignette = 0.34;
    fx.grain = 0.025;
    fx.risoPositive = 1;

    // 5. Update lyrics
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
