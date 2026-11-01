// Renderer + post chain: shots (one, or two joined by a transition, plus the motion-graphics overlay) → memory (a frame
// kept for flashbacks) → echo trails → bloom → grade (mirror, pixelate, glitch, barrel, zoom blur, smear, chromatic
// aberration, exposure, duotone, invert, flashback, vignette, scanlines, grain, fade, flash) → output → look (a section
// redrawn as a riso print, Hi-bit pixels, characters or on a tube; src/render/looks.ts).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { setAnisotropy } from './text.ts';
import { EchoPass, MemoryPass, ShotPass, TransitionKind, WordsPass, type Transition } from './shots.ts';
import { LookPass } from './looks.ts';
import type { Palette } from './palette.ts';

/** The geometry and camera of three's FullScreenQuad (one big triangle, position and uv), for compiling a pass's material. */
const PASS_QUAD = new THREE.BufferGeometry();
PASS_QUAD.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
PASS_QUAD.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
const PASS_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
/** A material drawn with a FullScreenQuad, as an object for MvScene.offscreen (compiled with its plate). */
export const passMesh = (material: THREE.Material) => new THREE.Mesh(PASS_QUAD, material);

export interface Fx {
  bloom: number;
  /** Chromatic aberration, 0..1. */
  ca: number;
  /** White flash, 0..1. */
  flash: number;
  /** Fade to ink, 0..1. */
  fade: number;
  grain: number;
  vignette: number;
  /** Slice displacement + RGB split for a few frames after a cut, 0..1. */
  glitch: number;
  /** Radial zoom blur, 0..1. */
  zoom: number;
  /** Wide-lens barrel distortion (keeps the corners, swells the middle), 0 = none, ~0.2 = strong. */
  barrel: number;
  /** Light trails: how much of the last frame survives (0 = none, ~0.85 = long streaks). */
  echo: number;
  /** Map the picture onto the palette's ink → signal ramp, 0..1. */
  duotone: number;
  /** Negative, 0..1 (a snare's flash in a drop). */
  invert: number;
  /** Mirror the frame: 0 none, 1 left onto right, 2 top onto bottom, 3 both (a four-way mirror). */
  mirror: number;
  /** Directional smear (a whip pan), in screen widths / heights. */
  smearX: number;
  smearY: number;
  /** Pixelate into blocks this many device pixels wide (0 = off). */
  pixel: number;
  /** Scan lines, 0..1. */
  scan: number;
  /** Brightness multiplier (strobes). */
  exposure: number;
  /** Keep this frame for a flashback. */
  remember: boolean;
  /** The kept frame laid over the picture in the palette's duotone (where lighter), 0..1. */
  memory: number;
  /** Looks (src/render/looks.ts), 0..1: a riso print, Hi-bit pixels, characters (the words drawn apart), a tube. */
  riso: number;
  /** The riso print of a plate lit like a picture (sky, clouds): positive, its darks inked (else its lights are). */
  risoPositive: number;
  hibit: number;
  ascii: number;
  crt: number;
  /** The VHS look (looks.ts): the picture played off a tape, 0..1. */
  vhs: number;
  /** The finish (FinishShader: grade, halation, lens, sharpening, film grain), 0..1; 0 = the plain output. */
  film: number;
  /** The lens (src/render/lens.ts) on the shot on screen: depth of field and motion blur, −1 = the plate's own. */
  aperture: number;
  motion: number;
  /** Focus distance, 0 = the plate's own (PlateLens.focus). */
  focus: number;
  /** Which shot is on screen (its start): a new value is a cut, where the motion blur starts afresh. */
  cut: number;
  /** A plate that moves its world past a still camera: how fast it flies, world units per second along the view. */
  travel: number;
  /** Impact frame, 0..1: the frame cut to two flat colours, the cover's ink and signal colour (impactInvert 1: swapped). */
  impact: number;
  impactInvert: number;
  /** Letterbox, 0..1 of the bars of a 2.39:1 frame (drawn under the overlay). */
  letterbox: number;
}

export const defaultFx = (): Fx => ({
  bloom: 0.35, ca: 0, flash: 0, fade: 0, grain: 0.04, vignette: 0.5, glitch: 0, zoom: 0, barrel: 0,
  echo: 0, duotone: 0, invert: 0, mirror: 0, smearX: 0, smearY: 0, pixel: 0, scan: 0, exposure: 1,
  remember: false, memory: 0, riso: 0, risoPositive: 0, hibit: 0, ascii: 0, crt: 0, vhs: 0, film: 1,
  aperture: -1, motion: -1, focus: 0, cut: 0, travel: 0,
  impact: 0, impactInvert: 0, letterbox: 0,
});

/** A style's finish (FinishShader), set per song with the palette. */
export interface Finish {
  /** Contrast about mid grey, in linear light (1 = none). */
  contrast: number;
  /** The warm glow film gives round bright lights, 0..1. */
  halation: number;
  /** Lateral chromatic aberration at the corners, in px at 1080p. */
  lens: number;
  /** Local contrast at edges, 0..1. */
  sharpen: number;
  /** How far the shadows lean to the cover's dark hues and the highlights to its paper, 0..1. */
  tone: number;
  /** Film grain on the display picture, times the plate's fx.grain. */
  grain: number;
  /** The shutter for the motion blur, seconds (1/48: a film camera's half-turn at 24 frames). */
  shutter: number;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uCA: { value: 0 },
    uFlash: { value: 0 },
    uFade: { value: 0 },
    uGrain: { value: 0.05 },
    uVignette: { value: 0.55 },
    uGlitch: { value: 0 },
    uZoom: { value: 0 },
    uBarrel: { value: 0 },
    uDuotone: { value: 0 },
    uInvert: { value: 0 },
    uMirror: { value: 0 },
    uSmear: { value: new THREE.Vector2() },
    uPixel: { value: 0 },
    uScan: { value: 0 },
    uExposure: { value: 1 },
    uFilm: { value: 0 },
    tHalo: { value: null as THREE.Texture | null },
    uHalation: { value: 0 },
    tMemory: { value: null as THREE.Texture | null },
    uMemory: { value: 0 },
    tWords: { value: null as THREE.Texture | null },
    uWordsOn: { value: 0 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uInk: { value: new THREE.Color(0x0a0a0b) },
    uSignal: { value: new THREE.Color(0xffffff) },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tMemory, tHalo, tWords;
    uniform float uHalation, uWordsOn;
    uniform float uTime, uCA, uFlash, uFade, uGrain, uVignette, uAspect, uGlitch, uZoom, uBarrel;
    uniform float uDuotone, uInvert, uMirror, uPixel, uScan, uExposure, uMemory, uFilm;
    uniform vec2 uSmear, uResolution;
    uniform vec3 uInk, uSignal;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    vec3 split(vec2 uv, vec2 off) {
      return vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
    }
    void main() {
      vec2 uv = vUv;
      if (uMirror > 0.5) {
        if (uMirror < 1.5 || uMirror > 2.5) uv.x = 0.5 - abs(uv.x - 0.5);
        if (uMirror > 1.5) uv.y = 0.5 - abs(uv.y - 0.5);
      }
      if (uPixel > 0.5) { vec2 cells = uResolution / uPixel; uv = (floor(uv * cells) + 0.5) / cells; }
      if (uBarrel > 0.001) {
        vec2 d = uv - 0.5, dd = d * vec2(uAspect, 1.0);
        float rm = 0.25 * uAspect * uAspect + 0.25;
        uv = 0.5 + d * (1.0 + uBarrel * dot(dd, dd)) / (1.0 + uBarrel * rm);
      }
      if (uGlitch > 0.001) {
        float n = hash(vec2(floor(uv.y * 28.0), floor(uTime * 40.0)));
        uv.x += (n - 0.5) * 0.14 * uGlitch * step(0.55, n);
      }
      vec2 c = uv - 0.5;
      vec2 off = c * uCA * 0.018 + vec2(uGlitch * 0.012, 0.0);
      vec3 col = vec3(0.0);
      if (uZoom > 0.001) {
        for (int i = 0; i < 10; i++) col += split(uv - c * (float(i) / 9.0) * uZoom * 0.14, off);
        col /= 10.0;
      } else if (abs(uSmear.x) + abs(uSmear.y) > 0.0005) {
        for (int i = 0; i < 12; i++) col += split(uv + uSmear * (float(i) / 11.0 - 0.5), off);
        col /= 12.0;
      } else col = split(uv, off);
      if (uHalation > 0.001) {
        // Halation (the finish): light scattered back through the film base glows warm round bright lights, only
        // outside them; read where the picture is (after the mirror, pixels and lens), from the bloom's tightest blur.
        float h = dot(texture2D(tHalo, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
        col += vec3(1.0, 0.38, 0.18) * max(h - 0.4 * dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0) * uHalation;
      }
      col *= uExposure;
      if (uDuotone > 0.001) {
        float l = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.5);
        // Ink in the shadows, the signal colour in the mids, lifted towards white in the highlights.
        vec3 duo = mix(mix(uInk, uSignal, smoothstep(0.02, 0.55, l)), mix(uSignal, vec3(1.0), 0.55), smoothstep(0.55, 1.0, l));
        col = mix(col, duo, uDuotone);
      }
      if (uInvert > 0.001) col = mix(col, vec3(1.0) - clamp(col, 0.0, 1.0), uInvert);
      if (uMemory > 0.001) {
        // A flashback: the kept frame in the ink → signal duotone, laid over the present where it is lighter (so the
        // words sung since stay readable and nothing goes darker; the word it held sits where it still is). The colour
        // says it is a memory; it is no brighter than the frame was.
        vec3 m = texture2D(tMemory, vUv).rgb * uExposure;
        float l = clamp(dot(m, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.5);
        vec3 mem = mix(mix(uInk, uSignal, smoothstep(0.0, 0.45, l)), mix(uSignal, vec3(1.0), 0.4), smoothstep(0.45, 1.0, l));
        col = mix(col, max(col, mem), uMemory);
      }
      if (uWordsOn > 0.5) {
        // 分离渲染的清晰歌词层（预乘线性 HDR），在畸变模糊与闪回之后、暗角与淡出之前叠回，彻底杜绝镜头甩镜/缩放/色差/闪回重影
        vec4 w = texture2D(tWords, vUv);
        col = w.rgb * uExposure + col * (1.0 - clamp(w.a, 0.0, 1.0));
      }
      float r = length(c * vec2(uAspect, 1.0)) / length(vec2(uAspect, 1.0) * 0.5);
      col *= mix(1.0, smoothstep(1.25, 0.2, r), uVignette);
      if (uScan > 0.001) col *= 1.0 - uScan * 0.4 * (0.5 + 0.5 * sin(vUv.y * uResolution.y * 1.4));
      // (With the finish on, the grain is laid on the display picture there instead.)
      col += (hash(vUv * 1024.0 + fract(uTime * 13.7)) - 0.5) * uGrain * (1.0 - uFilm);
      col = mix(col, uInk, uFade);
      col += vec3(uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/**
 * The finish, in place of three's OutputPass: what a camera and film add to every frame (after the base engine's
 * post, which the user's own films are finished with), in the cover's colours. Linear HDR in: lateral chromatic
 * aberration growing to the corners → local contrast at edges → a grade (contrast about mid grey; shadows towards the cover's dark hues,
 * highlights towards its paper) → the same Neutral tone mapping and sRGB encoding as before → film grain on the
 * display picture (monochrome, two sizes, strongest in the mid-tones, new 30 times a second) → dither. uFilm 0 gives
 * OutputPass's output exactly (plus the dither).
 */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uFilm: { value: 0 },
    uGrain: { value: 0.04 },
    uContrast: { value: 1 },
    uGrainScale: { value: 1 },
    uLens: { value: 0 },
    uSharpen: { value: 0 },
    uImpact: { value: 0 },
    uImpactInvert: { value: 0 },
    uInkD: { value: new THREE.Vector3() },
    uSignalD: { value: new THREE.Vector3(1, 1, 1) },
    uShadow: { value: new THREE.Vector3(1, 1, 1) },
    uHigh: { value: new THREE.Vector3(1, 1, 1) },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uPixelRatio: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uFilm, uGrain, uGrainScale, uContrast, uLens, uSharpen, uPixelRatio;
    uniform vec3 uShadow, uHigh, uInkD, uSignalD;
    uniform float uImpact, uImpactInvert;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    // three's NeutralToneMapping (Khronos PBR Neutral), exposure 1.
    vec3 neutral(vec3 color) {
      const float StartCompression = 0.8 - 0.04;
      const float Desaturation = 0.15;
      float x = min(color.r, min(color.g, color.b));
      float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
      color -= offset;
      float peak = max(color.r, max(color.g, color.b));
      if (peak < StartCompression) return color;
      float d = 1. - StartCompression;
      float newPeak = 1. - d * d / (peak + d - StartCompression);
      color *= newPeak / peak;
      float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.);
      return mix(color, vec3(newPeak), g);
    }
    vec3 srgb(vec3 v) { return mix(pow(v, vec3(0.41666)) * 1.055 - vec3(0.055), v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308)))); }
    void main() {
      vec2 c = vUv - 0.5;
      float aspect = uResolution.x / uResolution.y;
      vec2 cc = c * vec2(aspect, 1.0);
      float r2 = dot(cc, cc) / (0.25 * aspect * aspect + 0.25);
      // Lateral chromatic aberration: red pushed out, blue pulled in, nothing in the middle, uLens px in the corners.
      vec2 off = cc / max(length(cc), 1e-4) * r2 * uLens * uFilm / 1080.0 * vec2(1.0 / aspect, 1.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
      // Local contrast: the luminance against its four neighbours (a CSS px away), as a ratio (no dark rings, no hue).
      vec2 px = uPixelRatio / uResolution;
      float ln = 0.25 * luma(texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb
        + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb);
      float lc = luma(col);
      col *= clamp(pow((lc + 0.02) / (ln + 0.02), uSharpen * uFilm * 0.6), 0.8, 1.3);
      // Grade: contrast about mid grey — the darks pushed down, the lights only a little up (it fades out over the
      // stops above mid grey, so bright skies and suns keep their detail) — then the split tone.
      vec3 ev = log2(max(col, 1e-6) / 0.18);
      vec3 k = mix(vec3(uContrast), vec3(1.0), clamp(ev / 3.0, 0.0, 1.0));
      col = 0.18 * exp2(ev * mix(vec3(1.0), k, uFilm));
      col *= mix(vec3(1.0), mix(uShadow, uHigh, smoothstep(0.12, 0.7, sqrt(luma(col)))), uFilm);
      vec3 s = srgb(clamp(neutral(col), 0.0, 1.0));
      // Impact frame: the picture cut to two flat colours at a threshold, the cover's ink and its signal colour (not its
      // paper: a frame that is mostly light would be a white flash).
      if (uImpact > 0.001) {
        float on = step(0.36, luma(s));
        s = mix(s, mix(uInkD, uSignalD, abs(on - uImpactInvert)), uImpact);
      }
      // Film grain on what is seen.
      float lm = luma(s), tq = floor(uTime * 30.0);
      vec2 cell = floor(gl_FragCoord.xy / uPixelRatio);
      float g = 0.7 * (hash(cell + tq * 17.31) - 0.5) + 0.6 * (hash(floor(cell * 0.5) + tq * 7.13 + 91.7) - 0.5);
      s += g * uGrain * uGrainScale * uFilm * (0.6 + 1.2 * lm * (1.0 - lm));
      s += (hash(gl_FragCoord.xy + fract(uTime) * 311.0) + hash(gl_FragCoord.yx * 1.31 + 17.0) - 1.0) / 255.0;
      gl_FragColor = vec4(s, 1.0);
    }`,
};

/** Hue of a colour at luminance 1, its channels kept within 0.5..1.8 (a near-grey colour gives near 1). */
function hueOf(c: THREE.Color): THREE.Vector3 {
  const l = Math.max(1e-3, c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722);
  return new THREE.Vector3(c.r / l, c.g / l, c.b / l).clampScalar(0.5, 1.8);
}
/** A tint leaning `amount` of the way towards `hue`, at luminance 1. */
function tint(hue: THREE.Vector3, amount: number): THREE.Vector3 {
  const v = new THREE.Vector3(1, 1, 1).lerp(hue, amount);
  return v.divideScalar(v.x * 0.2126 + v.y * 0.7152 + v.z * 0.0722);
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private shots: ShotPass;
  private warmTarget: THREE.WebGLRenderTarget | null = null;
  private echo: EchoPass;
  private wordsOver: WordsPass;
  private memory: MemoryPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private finish: ShaderPass;
  private look: LookPass;
  /** Scales every frame's fx.film (the dev harness's ?film=0 shows the MV without the finish). */
  filmScale = 1;
  /** Scales the lens (depth of field, motion blur; the dev harness's ?lens=0). */
  get lensScale(): number { return this.shots.lensScale; }
  set lensScale(v: number) { this.shots.lensScale = v; }
  private halation = 0;
  private basePixelRatio = 1;
  private readonly onResize = () => this.resize();
  /** 标记当前 WebGL 上下文是否曾发生过丢失（即使后续浏览器触发了 restored，旧 RenderTarget 句柄也已失效，必须重建实例） */
  contextLost = false;
  width = 1;
  height = 1;
  private postCompiled = false;
  private postCompilePromise: Promise<unknown> | null = null;
  private postWarmed = false;
  /** 常驻保活的自定义着色器宿主池，使切歌销毁旧场景材质时底层 WebGLProgram 引用计数保持 >= 1，避免跨歌重复触发 D3D11 编译。 */
  private retainedPrograms = new Map<string, { holder: THREE.Object3D; geo: THREE.BufferGeometry; mat: THREE.Material }>();
  private dummyTex: THREE.DataTexture | null = null;

  constructor(readonly container: HTMLElement, pixelRatio = Math.min(window.devicePixelRatio || 1, 2)) {
    this.basePixelRatio = pixelRatio;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.domElement.addEventListener('webglcontextlost', () => {
      this.contextLost = true;
      this.postCompiled = false;
      this.postCompilePromise = null;
      this.postWarmed = false;
    });
    this.applySafePixelRatio();
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    setAnisotropy(renderer.capabilities.getMaxAnisotropy());

    // 禁用 HalfFloat 离屏缓冲上的 4× MSAA（避免在集成显卡上分配数百 MB 浮点多重采样缓冲及每帧数次全屏 blitFramebuffer 解析导致显卡重置）
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.applySafePixelRatio();
    this.shots = new ShotPass();
    this.memory = new MemoryPass();
    this.echo = new EchoPass();
    this.echo.enabled = false;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 0.92);
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.tMemory.value = this.memory.rt.texture;
    this.grade.uniforms.tWords.value = this.shots.words.texture;
    this.composer.addPass(this.shots);
    this.composer.addPass(this.memory);
    this.composer.addPass(this.echo);
    // (The words over the trails, under the glow: they still bloom, but don't smear.)
    this.wordsOver = new WordsPass(this.shots.words.texture);
    this.wordsOver.enabled = false;
    this.composer.addPass(this.wordsOver);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.finish = new ShaderPass(FinishShader);
    // Halation (part of the finish, drawn in the grade): the bloom's first, tightest blur of the lights above its
    // threshold; resized in place, so bound once.
    this.grade.uniforms.tHalo.value = this.bloom.renderTargetsVertical[0].texture;
    this.composer.addPass(this.finish);
    this.look = new LookPass();
    this.look.enabled = false;
    this.composer.addPass(this.look);
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  /** 检查当前渲染引擎是否处于上下文丢失或已失效状态 */
  isContextLost(): boolean {
    return this.contextLost || this.renderer.getContext().isContextLost();
  }

  get aspect(): number { return this.width / this.height; }

  /** Palette colours the post chain uses (fade-to ink, duotone ramp). */
  setPalette(ink: THREE.Color, signal: THREE.Color): void {
    (this.grade.uniforms.uInk.value as THREE.Color).copy(ink);
    (this.grade.uniforms.uSignal.value as THREE.Color).copy(signal);
    // (Display colours for the impact frame, drawn after the tone mapping; the letterbox in the ink.)
    const d = (c: THREE.Color) => { const s = c.clone().convertLinearToSRGB(); return new THREE.Vector3(s.r, s.g, s.b); };
    (this.finish.uniforms.uInkD.value as THREE.Vector3).copy(d(ink));
    (this.finish.uniforms.uSignalD.value as THREE.Vector3).copy(d(signal));
    this.shots.setInk(ink);
  }

  /**
   * The style's finish for this song: shadows lean to the cover's ink and second colour, highlights to its paper
   * and a little of its signal colour (a grey cover gives no tint, only the contrast).
   */
  setFinish(palette: Palette, finish: Finish): void {
    this.halation = finish.halation;
    this.shots.shutter = finish.shutter;
    const u = this.finish.uniforms;
    const dark = hueOf(palette.ink).add(hueOf(palette.accent)).multiplyScalar(0.5);
    const light = hueOf(palette.paper).multiplyScalar(0.7).add(hueOf(palette.signal).multiplyScalar(0.3));
    (u.uShadow.value as THREE.Vector3).copy(tint(dark, 0.2 * finish.tone));
    (u.uHigh.value as THREE.Vector3).copy(tint(light, 0.15 * finish.tone));
    u.uContrast.value = finish.contrast;
    u.uLens.value = finish.lens;
    u.uGrainScale.value = finish.grain;
    u.uSharpen.value = finish.sharpen;
  }

  /** Per song: the riso inks for its palette, the glyphs from its lyrics (skipped when ASCII look is unused). */
  setLooks(palette: Palette, lyricText: string, needsAscii = true): void { this.look.setSong(palette, lyricText, needsAscii); }

  /** The cover, for transitions that wipe through its shapes. */
  setCover(cover: THREE.Texture | null): void { this.shots.setCover(cover); }

  private getDummyTexture(): THREE.DataTexture {
    if (!this.dummyTex) {
      const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
      tex.needsUpdate = true;
      this.dummyTex = tex;
    }
    return this.dummyTex;
  }

  /**
   * 为已编译的自定义 ShaderMaterial / RawShaderMaterial 注册零显存泄漏的常驻保活引用，
   * 保证切歌卸载场景时底层 WebGLProgram 不会被 gl.deleteProgram 销毁。
   */
  private retainShaders(target: THREE.WebGLRenderTarget | null, objects: readonly THREE.Object3D[], camera: THREE.Camera): void {
    if (this.isContextLost()) return;
    const targetTag = target ? `${target.texture.type}:${target.texture.colorSpace}` : 'screen';
    const newHolders: THREE.Object3D[] = [];

    for (const root of objects) {
      root.traverse(o => {
        const renderable = o as THREE.Mesh;
        const geo = renderable.geometry;
        if (!geo || !renderable.material) return;
        const mats = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        const objKind = o instanceof THREE.Points ? 'pts'
          : o instanceof THREE.LineSegments ? 'lseg'
          : o instanceof THREE.LineLoop ? 'lloop'
          : o instanceof THREE.Line ? 'line'
          : o instanceof THREE.InstancedMesh ? 'imesh'
          : 'mesh';
        const geoInst = geo instanceof THREE.InstancedBufferGeometry ? '1' : '0';
        const attrSig = Object.keys(geo.attributes).sort().map(n => `${n}:${geo.attributes[n].itemSize}`).join(',');

        for (const m of mats) {
          if (!(m instanceof THREE.ShaderMaterial)) continue;
          const definesSig = m.defines ? JSON.stringify(m.defines) : '';
          const matFlags = `${m.type}|${m.glslVersion ?? ''}|${m.toneMapped ? 1 : 0}|${m.premultipliedAlpha ? 1 : 0}|${m.alphaTest}|${m.customProgramCacheKey()}`;
          const key = `${targetTag}|${objKind}|${geoInst}|${attrSig}|${matFlags}|${definesSig}|${m.vertexShader}|${m.fragmentShader}`;
          if (this.retainedPrograms.has(key)) continue;

          if (this.retainedPrograms.size >= 192) {
            const oldestKey = this.retainedPrograms.keys().next().value;
            if (oldestKey !== undefined) {
              const old = this.retainedPrograms.get(oldestKey);
              this.retainedPrograms.delete(oldestKey);
              old?.geo.dispose();
              old?.mat.dispose();
            }
          }

          const clonedMat = m.clone();
          const dummy = this.getDummyTexture();
          for (const u of Object.values(clonedMat.uniforms)) {
            if (u.value instanceof THREE.Texture) {
              u.value = dummy;
            } else if (Array.isArray(u.value) && u.value.some(v => v instanceof THREE.Texture)) {
              u.value = u.value.map(v => (v instanceof THREE.Texture ? dummy : v));
            }
          }

          const keepGeo = geo instanceof THREE.InstancedBufferGeometry ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
          for (const [name, attr] of Object.entries(geo.attributes)) {
            if (!(attr instanceof THREE.BufferAttribute)) continue;
            const Ctor = (attr.array as Float32Array).constructor as new (len: number) => THREE.TypedArray;
            const emptyArr = new Ctor(0);
            const clonedAttr = attr instanceof THREE.InstancedBufferAttribute
              ? new THREE.InstancedBufferAttribute(emptyArr, attr.itemSize, attr.normalized)
              : new THREE.BufferAttribute(emptyArr, attr.itemSize, attr.normalized);
            keepGeo.setAttribute(name, clonedAttr);
          }

          let holder: THREE.Object3D;
          if (o instanceof THREE.Points) holder = new THREE.Points(keepGeo, clonedMat);
          else if (o instanceof THREE.LineSegments) holder = new THREE.LineSegments(keepGeo, clonedMat);
          else if (o instanceof THREE.LineLoop) holder = new THREE.LineLoop(keepGeo, clonedMat);
          else if (o instanceof THREE.Line) holder = new THREE.Line(keepGeo, clonedMat);
          else if (o instanceof THREE.InstancedMesh) holder = new THREE.InstancedMesh(keepGeo, clonedMat, 0);
          else holder = new THREE.Mesh(keepGeo, clonedMat);
          holder.frustumCulled = false;

          this.retainedPrograms.set(key, { holder, geo: keepGeo, mat: clonedMat });
          newHolders.push(holder);
        }
      });
    }

    if (newHolders.length > 0) {
      const batch = new THREE.Scene();
      for (const h of newHolders) batch.add(h);
      const r = this.renderer, prev = r.getRenderTarget();
      try {
        r.setRenderTarget(target);
        r.compile(batch, camera);
      } catch {
        // 忽略极端上下文状态下的保活绑定异常，不影响正常渲染
      } finally {
        r.setRenderTarget(prev);
      }
    }
  }

  /** Returns the number of shader programs currently retained across song switches (for diagnostics/testing). */
  get retainedProgramCount(): number {
    return this.retainedPrograms.size;
  }

  /**
   * Draws a scene once off screen with every object in it shown, so its shaders are compiled and its buffers and
   * textures uploaded before it is first cut to (otherwise that cut stalls for 20–100 ms, longer in NetEase's
   * Chromium). With no scene, warms the transition quad.
   */
  warm(scene?: THREE.Object3D, camera?: THREE.Camera): void {
    if (this.isContextLost()) return;
    const r = this.renderer, prev = r.getRenderTarget();
    const target = this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
    if (scene && camera) {
      const hidden: THREE.Object3D[] = [];
      scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      try {
        r.setRenderTarget(target);
        r.render(scene, camera);
        this.retainShaders(target, [scene], camera);
      } finally {
        for (const o of hidden) o.visible = false;
      }
    } else if (!this.postWarmed) {
      this.shots.warm(r, target);
      this.look.warm(r, target);
      this.postWarmed = true;
    }
    r.setRenderTarget(prev);
  }

  /**
   * Starts compiling a scene's shaders (hidden objects too) and resolves when they are ready, so warm() then only
   * uploads. With KHR_parallel_shader_compile the GPU process compiles them on its own threads: every plate at once,
   * the page free meanwhile. (Compiled in line on the first draw instead, one plate after another, the D3D compiler
   * behind Chromium took about five seconds for a song's plates.)
   */
  compile(scene: THREE.Object3D, camera: THREE.Camera, offscreen: readonly THREE.Object3D[] = []): Promise<unknown> {
    if (this.isContextLost()) return Promise.resolve();
    const hidden: THREE.Object3D[] = [];
    scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try {
      // (Set to an off-screen target like the one the plates are drawn into: the programs depend on it.)
      return this.compileFor(this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType }), [scene, ...offscreen], camera, true);
    } finally {
      for (const o of hidden) o.visible = false;
    }
  }

  /**
   * 协作式逐材质异步编译：每次仅向 GPU 编译队列提交单个未编译网格（保留原场景灯光环境），
   * 每个网格完成后立即让出事件循环并检查取消令牌，避免后台一次性塞满 D3D11 编译队列而阻塞连续切歌。
   */
  async compileIncremental(
    scene: THREE.Scene,
    camera: THREE.Camera,
    offscreen: readonly THREE.Object3D[] = [],
    pause: () => Promise<void>,
    aborted: () => boolean,
  ): Promise<boolean> {
    if (this.isContextLost() || aborted()) return false;
    const target = (this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType }));
    const seenMaterials = new Set<THREE.Material>();
    const items: Array<{ obj: THREE.Object3D; hostScene: THREE.Scene | undefined }> = [];
    const collect = (root: THREE.Object3D, hostScene: THREE.Scene | undefined) => {
      root.traverse(o => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        const list = Array.isArray(mat) ? mat : [mat];
        let hasNew = false;
        for (const m of list) {
          if (m && !seenMaterials.has(m)) {
            seenMaterials.add(m);
            hasNew = true;
          }
        }
        if (hasNew) items.push({ obj: o, hostScene });
      });
    };
    collect(scene, scene);
    for (const extra of offscreen) collect(extra, extra instanceof THREE.Scene ? extra : undefined);

    for (const { obj, hostScene } of items) {
      if (this.isContextLost() || aborted()) return false;
      const hiddenAncestors: THREE.Object3D[] = [];
      for (let cur: THREE.Object3D | null = obj; cur; cur = cur.parent) {
        if (!cur.visible) {
          hiddenAncestors.push(cur);
          cur.visible = true;
        }
      }
      let p: Promise<unknown>;
      try {
        p = this.compileSingleFor(target, obj, camera, hostScene);
      } finally {
        for (const h of hiddenAncestors) h.visible = false;
      }
      await p;
      if (this.isContextLost() || aborted()) return false;
      await pause();
    }
    this.retainShaders(target, [scene, ...offscreen], camera);
    return true;
  }

  /**
   * Compiles the post chain's materials like compile(), for both an off-screen target and the screen (the last pass
   * draws to it, and a program differs by its target), so the MV's first frame doesn't compile them in line.
   */
  compilePost(): Promise<unknown> {
    if (this.isContextLost() || this.postCompiled) return Promise.resolve();
    if (this.postCompilePromise) return this.postCompilePromise;
    const mats = new Set<THREE.Material>();
    const take = (v: unknown) => { if (v instanceof THREE.Material) mats.add(v); else if (Array.isArray(v)) v.forEach(take); };
    for (const pass of [...this.composer.passes, this.look]) for (const v of Object.values(pass)) take(v);
    const quads = [...mats].map(passMesh);
    const p = Promise.all([
      this.compileFor(this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType }), quads, PASS_CAMERA, false),
      this.compileFor(null, quads, PASS_CAMERA, false),
    ]).then(() => {
      if (!this.isContextLost()) this.postCompiled = true;
    }).finally(() => {
      this.postCompilePromise = null;
    });
    this.postCompilePromise = p;
    return p;
  }

  private compileSingleFor(
    target: THREE.WebGLRenderTarget | null,
    object: THREE.Object3D,
    camera: THREE.Camera,
    targetScene?: THREE.Scene,
  ): Promise<unknown> {
    if (this.isContextLost()) return Promise.resolve();
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(target);
    const compilePromise = r.compileAsync(object, camera, targetScene ?? null).catch(() => {});
    r.setRenderTarget(prev);
    return new Promise<void>(resolve => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearInterval(checkTimer);
        clearTimeout(timeoutTimer);
        resolve();
      };
      const checkTimer = setInterval(() => {
        if (this.isContextLost()) done();
      }, 50);
      const timeoutTimer = setTimeout(done, 30000);
      void compilePromise.then(done, done);
    });
  }

  private compileFor(target: THREE.WebGLRenderTarget | null, objects: readonly THREE.Object3D[], camera: THREE.Camera, retain = false): Promise<unknown> {
    if (this.isContextLost()) return Promise.resolve();
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(target);
    const compilePromise = Promise.all(objects.map(o => r.compileAsync(o, camera)))
      .then(() => {
        if (retain) this.retainShaders(target, objects, camera);
      })
      .catch(() => {});
    r.setRenderTarget(prev);
    // 防止 WebGL 上下文在异步编译轮询期间丢失导致 compileAsync 永远不 resolve
    return new Promise<void>(resolve => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearInterval(checkTimer);
        clearTimeout(timeoutTimer);
        resolve();
      };
      const checkTimer = setInterval(() => {
        if (this.isContextLost()) done();
      }, 50);
      const timeoutTimer = setTimeout(done, 30000);
      void compilePromise.then(done, done);
    });
  }

  /**
   * The quality setting, applied live. The post chain's buffers keep the ratio they were created with unless told
   * (EffectComposer reads it once), so both change together; call resize() after.
   */
  setPixelRatio(pixelRatio: number): void {
    this.basePixelRatio = pixelRatio;
    this.applySafePixelRatio();
  }

  /**
   * 物理渲染分辨率预算保护（Max Pixel Budget Protection）：
   * 无论用户显示器是 2K、4K、高分屏还是 Windows 设置了 150%/200% DPI 缩放，
   * 自动平滑将内部主渲染缓冲区的物理像素尺寸上限锁定在 1920x1080 范围以内。
   * 这直接杜绝了数千万像素与重型片元着色器并发导致的显卡 TDR（超时重置）！
   */
  private applySafePixelRatio(): void {
    const w = this.container.clientWidth || window.innerWidth || 1920;
    const h = this.container.clientHeight || window.innerHeight || 1080;
    const maxRatioW = 1920 / Math.max(1, w);
    const maxRatioH = 1080 / Math.max(1, h);
    const maxSafeRatio = Math.max(0.5, Math.min(maxRatioW, maxRatioH));
    const effectivePixelRatio = Math.min(this.basePixelRatio, maxSafeRatio);
    this.renderer.setPixelRatio(effectivePixelRatio);
    this.composer?.setPixelRatio(effectivePixelRatio);
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.width = w; this.height = h;
    this.applySafePixelRatio();
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.composer.setSize(w, h);
    this.grade.uniforms.uAspect.value = w / h;
    const pr = this.renderer.getPixelRatio();
    (this.grade.uniforms.uResolution.value as THREE.Vector2).set(w * pr, h * pr);
    (this.finish.uniforms.uResolution.value as THREE.Vector2).set(w * pr, h * pr);
    this.finish.uniforms.uPixelRatio.value = pr;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, fx: Fx, t: number, transition: Transition | null = null, overlay: { scene: THREE.Scene; camera: THREE.Camera } | null = null): void {
    if (this.isContextLost()) return;
    this.shots.scene = scene;
    this.shots.camera = camera;
    this.shots.transition = transition;
    this.shots.overlay = overlay;
    this.shots.time = t;
    this.shots.shotKey = fx.cut;
    this.shots.lensFx.aperture = fx.aperture;
    this.shots.lensFx.motion = fx.motion;
    this.shots.lensFx.focus = fx.focus;
    this.shots.lensFx.travel = fx.travel;
    const echoOn = fx.echo > 0.01;
    if (echoOn && !this.echo.enabled) this.echo.reset();
    this.echo.enabled = echoOn;
    this.echo.decay = fx.echo;
    // Scenes set their glow on one scale; it is drawn at 0.6 of that, with a tighter halo, and the white flash at
    // 1× instead of 1.6× (the user, 2026-10-01: “闪光/辉光效果还是太强了，减小”).
    this.bloom.strength = fx.bloom * 0.6;
    const u = this.grade.uniforms;
    u.uTime.value = t;
    u.uCA.value = fx.ca;
    u.uFlash.value = fx.flash;
    u.uFade.value = fx.fade;
    u.uGrain.value = fx.grain;
    u.uVignette.value = fx.vignette;
    u.uGlitch.value = fx.glitch;
    u.uZoom.value = fx.zoom;
    u.uBarrel.value = fx.barrel;
    u.uDuotone.value = fx.duotone;
    u.uInvert.value = fx.invert;
    u.uMirror.value = fx.mirror;
    (u.uSmear.value as THREE.Vector2).set(fx.smearX, fx.smearY);
    u.uPixel.value = fx.pixel;
    u.uScan.value = fx.scan;
    u.uExposure.value = fx.exposure;
    if (fx.remember) this.memory.armed = true;
    u.uMemory.value = fx.memory;
    const film = Math.min(1, Math.max(0, fx.film * this.filmScale));
    u.uFilm.value = film;
    const f = this.finish.uniforms;
    f.uTime.value = t;
    f.uFilm.value = film;
    f.uGrain.value = fx.grain;
    f.uImpact.value = fx.impact;
    f.uImpactInvert.value = fx.impactInvert;
    this.shots.letterbox = fx.letterbox;
    // (Halation follows the glow a plate asks for: a light cover shown whole, with its glow cut, keeps its paper clean.)
    u.uHalation.value = this.halation * film * Math.min(1.25, fx.bloom / 0.4);
    const looking = fx.riso + fx.hibit + fx.ascii + fx.crt + fx.vhs > 0.001;
    this.look.enabled = looking;
    // VHS 磁带色度横向拖影同样开启歌词分离叠印；动态模糊/错位转场、闪回采样与 Grade 空间畸变模糊期间亦分离歌词，彻底消除重影
    const lookSplit = looking && (fx.ascii > 0.001 || fx.riso > 0.001 || fx.hibit > 0.001 || fx.vhs > 0.001);
    const blurTrans = !!transition && (
      transition.kind === TransitionKind.zoom ||
      transition.kind === TransitionKind.whip ||
      transition.kind === TransitionKind.chroma ||
      transition.kind === TransitionKind.spin
    );
    const gradeGhost = fx.zoom > 0.001 || Math.abs(fx.smearX) + Math.abs(fx.smearY) > 0.0005 || fx.glitch > 0.001 || fx.ca > 0.015 || fx.mirror > 0.5 || fx.memory > 0.001;
    const cleanSplit = fx.remember || echoOn || blurTrans || gradeGhost;
    this.shots.split = lookSplit || cleanSplit;
    this.wordsOver.enabled = !lookSplit && cleanSplit && !gradeGhost;
    u.uWordsOn.value = !lookSplit && gradeGhost ? 1 : 0;
    if (looking) this.look.set(fx, t, lookSplit ? this.shots.words.texture : null);
    this.composer.render();
  }

  /** 彻底释放后处理管线中的所有离屏 RenderTarget、材质与事件监听器 */
  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    if (!this.isContextLost()) {
      for (const item of this.retainedPrograms.values()) {
        try { item.geo.dispose(); } catch {}
        try { item.mat.dispose(); } catch {}
      }
      try { this.dummyTex?.dispose(); } catch {}
      try { this.warmTarget?.dispose(); } catch {}
      try { this.shots.dispose(); } catch {}
      try { this.memory.dispose(); } catch {}
      try { this.echo.dispose(); } catch {}
      try { this.wordsOver.dispose(); } catch {}
      try { this.bloom.dispose(); } catch {}
      try { this.grade.dispose(); } catch {}
      try { this.finish.dispose(); } catch {}
      try { this.look.dispose(); } catch {}
      try { this.composer.renderTarget1.dispose(); } catch {}
      try { this.composer.renderTarget2.dispose(); } catch {}
      try { this.renderer.dispose(); } catch {}
    }
    this.retainedPrograms.clear();
    this.dummyTex = null;
    this.warmTarget = null;
    try { this.renderer.domElement.remove(); } catch {}
  }
}
