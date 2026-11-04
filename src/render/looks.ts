// Looks: a whole section redrawn in another medium, over whatever plate is on screen (after the grade and the tone
// mapping, on display colours). The plates all share one language — dark ground, the cover's colours, hairlines —
// and a look is what makes a section feel like another world (the reference films switch medium per section):
//   riso   a Riso print: the picture separated into two or three spot inks, each a halftone screen at its own angle,
//          mis-registered a little, on cream paper. Dark plates print light-on-paper: their dark ground stays paper,
//          what glows takes the ink (the brighter, the heavier), so a black frame becomes a printed page.
//   hibit  a Hi-bit pixel picture: blocks (each the average of its area), a few flat colour levels per channel,
//          faint gaps between the blocks like a dot-matrix screen.
//   ascii  the picture made of characters — the song's own (the lyrics' characters sorted by how much ink they take),
//          or a Latin ramp for songs without them — each cell's glyph picked by its brightness, in its colour.
//   crt    the picture on a curved tube: scanlines, an RGB grille, a black bezel with rounded corners.
//   vhs    the picture played off a tape: soft luma, colour far softer and smeared late to the right, lines that waver,
//          a tracking band rolling up the frame with snow in it, the head switch tearing the bottom lines, blacks
//          lifted and whites rolled off. The words stay on the tape (the wavering is small; they read).
// With ascii, riso or hibit on, the lyrics and the motion-graphics layer are drawn apart (ShotPass.split) so the sung line
// stays readable: over characters and pixels they lie flat and clean, off the glass (the engine's rule: subtitles stay outside
// the tube); on a print they are printed solid in the set's deepest ink, with the next ink a touch off register
// (type on a Riso is solid, never screened).
// Methods after the base engine's post.ts / ascii.ts (riso ink fit, bayer dither, CRT surface, measured glyph ramp).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { Palette } from './palette.ts';
import { hasCjk } from './text.ts';

/** Riso ink sets (sRGB hex): the paper, then the inks. The song's set is the one nearest its signal colour. */
const RISO_INKS: Array<{ paper: string; inks: string[] }> = [
  { paper: '#F4EFE6', inks: ['#FF48B0', '#0078BF', '#FFE800'] }, // fluorescent pink, blue, yellow
  { paper: '#F2ECE0', inks: ['#F15060', '#00838A', '#FFE800'] }, // bright red, teal, yellow
  { paper: '#F4EFE6', inks: ['#765BA7', '#FF48B0'] }, // purple, fluorescent pink
  { paper: '#F3EEE4', inks: ['#0078BF', '#FF6C2F'] }, // blue, orange
  { paper: '#F2EDE2', inks: ['#00A95C', '#3D5588', '#FFE800'] }, // green, federal blue, yellow
];

const lum = (v: THREE.Vector3) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
const hex3 = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * A set's uniforms: paper, inks, and the matrix that turns a colour's optical density over the paper
 * (log(colour / paper) per channel) into each ink's coverage (least squares).
 */
function risoSet(k: number) {
  const set = RISO_INKS[k];
  const paper = hex3(set.paper), inks = set.inks.map(hex3);
  const A = inks.map(c => c.map((v, ch) => Math.log(Math.max(v, 0.02) / paper[ch])));
  const n = A.length;
  const ata = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => A[i].reduce((s, v, ch) => s + v * A[j][ch], 0)));
  const inv = invert(ata);
  const M = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, ch) => (i < n ? inv[i].reduce((s, v, j) => s + v * A[j][ch], 0) : 0)));
  const m3 = new THREE.Matrix3().set(...(M.flat() as [number, number, number, number, number, number, number, number, number]));
  const ink = (i: number) => new THREE.Vector3(...(inks[i] ?? paper));
  return { paper: new THREE.Vector3(...paper), ink0: ink(0), ink1: ink(1), ink2: ink(2), m: m3, n };
}

function invert(a: number[][]): number[][] {
  const n = a.length, m = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c] || 1e-9;
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c]; for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j]; }
  }
  return m.map(r => r.slice(n));
}

/** The ink set for a palette: the one whose first ink is nearest the signal's hue (a grey cover gets the blue set). */
export function risoInksFor(palette: Palette): number {
  if (palette.mono) return 3;
  const hsl = { h: 0, s: 0, l: 0 };
  palette.signal.getHSL(hsl, THREE.SRGBColorSpace);
  let best = 0, bestD = Infinity;
  RISO_INKS.forEach((set, i) => {
    const ink = new THREE.Color(set.inks[0]), o = { h: 0, s: 0, l: 0 };
    ink.getHSL(o);
    const d = Math.min(Math.abs(o.h - hsl.h), 1 - Math.abs(o.h - hsl.h));
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

const MONO = '"Cascadia Mono", Consolas, "Courier New", monospace';
const CJK = '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
const LATIN_RAMP = " .'`,:;-~=+*!?/|()[]{}<>il1tfjrxnuvczXYUJCLQ0OZmwqpdbkhao#MW&8%B@$";

/** 缓存单字符墨量覆盖率测量结果，避免每次切歌对相同字符重复执行昂贵的 getImageData 同步像素回读。 */
const glyphCoverageCache = new Map<string, number>();
/** 未启用 ASCII 滤镜的歌曲共享默认拉丁字符图集，实现零开销复用。 */
let sharedLatinAtlas: GlyphAtlas | null = null;

/**
 * Glyphs sorted by measured ink coverage, white on transparent in one row of cells (64 px tall). From the song's
 * lyrics when it has enough distinct CJK characters (about 24 spread over the ink range, a few light marks under
 * them), else a Latin ramp.
 */
export class GlyphAtlas {
  readonly texture: THREE.CanvasTexture;
  readonly n: number;
  /** Cell width / height. */
  readonly aspect: number;

  constructor(text: string) {
    const AH = 64;
    const cjk = [...new Set(Array.from(text).filter(ch => hasCjk(ch)))];
    const useCjk = cjk.length >= 24;
    const family = useCjk ? CJK : MONO;
    const weight = useCjk ? 500 : 600;
    const font = `${weight} ${Math.round(AH * (useCjk ? 0.8 : 0.86))}px ${family}`;
    const m = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    m.font = font;
    const cand = useCjk ? ['·', '、', '一', ...cjk.slice(0, 400)] : Array.from(LATIN_RAMP);
    const adv = useCjk ? AH * 0.92 : Math.max(...cand.map(ch => m.measureText(ch).width), AH * 0.4);
    const AW = Math.ceil(adv);
    this.aspect = AW / AH;
    let pc: CanvasRenderingContext2D | null = null;
    const cover = (ch: string) => {
      const cacheKey = `${font}|${AW}|${AH}|${ch}`;
      const cached = glyphCoverageCache.get(cacheKey);
      if (cached !== undefined) return cached;
      if (!pc) {
        const probe = document.createElement('canvas');
        probe.width = AW; probe.height = AH;
        pc = probe.getContext('2d', { willReadFrequently: true })!;
      }
      pc.clearRect(0, 0, AW, AH);
      pc.font = font; pc.fillStyle = '#fff'; pc.textAlign = 'center'; pc.textBaseline = 'middle';
      pc.fillText(ch, AW / 2, AH * 0.54);
      const d = pc.getImageData(0, 0, AW, AH).data;
      let s = 0;
      for (let i = 3; i < d.length; i += 4) s += d[i];
      const val = s / (255 * AW * AH);
      if (glyphCoverageCache.size > 4096) glyphCoverageCache.clear();
      glyphCoverageCache.set(cacheKey, val);
      return val;
    };
    const measured = cand.map(ch => ({ ch, c: ch === ' ' ? 0 : cover(ch) })).filter(g => g.c > 0.002).sort((a, b) => a.c - b.c);
    let ramp: Array<{ ch: string; c: number }> = [];
    if (useCjk) {
      // Even steps over the measured range: the lightest marks, then ~24 characters spread across it.
      const lo = measured[0].c, hi = measured[measured.length - 1].c, steps = 26;
      for (let k = 0; k < steps; k++) {
        const want = lo + ((hi - lo) * k) / (steps - 1);
        let pick = measured[0];
        for (const g of measured) if (Math.abs(g.c - want) < Math.abs(pick.c - want)) pick = g;
        if (!ramp.includes(pick)) ramp.push(pick);
      }
    } else {
      for (const g of measured) if (!ramp.length || g.c - ramp[ramp.length - 1].c > 0.004) ramp.push(g);
    }
    ramp = [{ ch: ' ', c: 0 }, ...ramp];
    this.n = ramp.length;
    const atlas = document.createElement('canvas');
    atlas.width = AW * ramp.length; atlas.height = AH;
    const ac = atlas.getContext('2d')!;
    ac.font = font; ac.fillStyle = '#fff'; ac.textAlign = 'center'; ac.textBaseline = 'middle';
    ramp.forEach((g, i) => ac.fillText(g.ch, AW * i + AW / 2, AH * 0.54));
    this.texture = new THREE.CanvasTexture(atlas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
  }

  dispose(): void { this.texture.dispose(); }
}

const vertexShader = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse, tLyr, tAtlas;
  uniform float uRiso, uRisoPos, uHibit, uAscii, uCrt, uVhs, uStained, uBlueprint, uSplit, uFade, uTime, uGlyphs, uGlyphAspect, uBox;
  uniform vec3 uBoxInk;
  uniform vec2 uRes;
  uniform vec3 risoPaper, risoInk0, risoInk1, risoInk2, risoDeep, risoSecond;
  uniform mat3 risoM;
  uniform float risoN;
  varying vec2 vUv;
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
  }
  // The device-pixel size of the frame's height / 1080 (patterns keep their size at every resolution).
  float unit() { return uRes.y / 1080.0; }

  // ---- VHS: the picture off a tape (after the base engine's post) ----
  vec3 toYiq(vec3 c) { return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
  vec3 fromYiq(vec3 y) { return vec3(y.x + 0.956 * y.y + 0.621 * y.z, y.x - 0.272 * y.y - 0.647 * y.z, y.x - 1.106 * y.y + 1.703 * y.z); }
  vec3 vhs(vec2 uv) {
    float fi = floor(uTime * 30.0), u = unit();
    float row = floor(uv.y * uRes.y / (2.0 * u));
    // The lines waver a little, and a tracking band rolls up the frame dragging its lines sideways.
    uv.x += sin(uv.y * 38.0 + fi * 0.21) * 0.0014 + (hash12(vec2(row, fi)) - 0.5) * 0.0016;
    // (Not always there: it rolls through for a while every few seconds, as a tape's tracking drifts.)
    float band = smoothstep(0.04, 0.0, abs(uv.y - fract(fi * 0.006 + 0.15))) * smoothstep(0.45, 0.6, sin(fi * 0.012) * 0.5 + 0.5);
    uv.x += band * (hash12(vec2(floor(uv.y * uRes.y / (3.0 * u)), fi)) - 0.5) * 0.035;
    // The head switch tears the bottom lines.
    uv.x += step(uv.y, 0.025) * (hash12(vec2(floor(uv.y * uRes.y / u), fi + 7.0)) - 0.3) * 0.03;
    // Soft luma (a tape holds some 250 lines across); the colour far softer, smeared to the right and late.
    vec2 px = vec2(u / uRes.x, 0.0);
    vec3 l = vec3(0.0);
    for (int i = -2; i <= 2; i++) l += texture2D(tDiffuse, uv + px * float(i) * 1.2).rgb;
    vec2 ch = vec2(0.0);
    for (int i = 0; i < 6; i++) ch += toYiq(texture2D(tDiffuse, uv - px * (float(i) * 2.5 + 3.0)).rgb).yz;
    vec3 c = max(fromYiq(vec3(toYiq(l / 5.0).x, ch / 6.0 * 0.85)), 0.0);
    // Tape tone: blacks lifted, whites rolled off, a faint magenta cast.
    c = (0.035 + c * 0.9) * vec3(1.03, 0.97, 1.04);
    // Snow in the tracking band, a little everywhere.
    float nz = hash12(vec2(floor(uv.x * uRes.x / (3.0 * u)), row) + fi * 31.0);
    return mix(c, vec3(nz), band * 0.3) + (nz - 0.5) * 0.03;
  }

  // ---- Hi-bit: the colour of the block a point falls in ----
  float blockPx() { return max(3.0, floor(5.0 * unit() + 0.5)); }
  // The block's colour: the average over it (one sample per block aliased fine textures — dot screens, hairlines —
  // into a checkerboard of speckle; the user: “像素有点太重了，看不清”).
  vec3 blockColour(vec2 uv) {
    float b = blockPx();
    vec2 cell = floor(uv * uRes / b);
    vec3 c = vec3(0.0);
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++)
      c += texture2D(tDiffuse, (cell * b + (vec2(float(i), float(j)) + 0.5) * b / 4.0) / uRes).rgb;
    return c / 16.0;
  }

  // ---- ASCII: the picture as glyphs ----
  vec3 ascii(vec2 uv) {
    float ch = max(10.0, floor(23.0 * unit() + 0.5));
    vec2 cell = vec2(ch * uGlyphAspect, ch);
    vec2 px = uv * uRes;
    vec2 cid = floor(px / cell), inC = fract(px / cell);
    // The cell's colour: the brightest of nine taps, mixed with their mean (a hairline through the cell still
    // gives a glyph, so line plates come out as lines of characters).
    vec3 c = vec3(0.0), avg = vec3(0.0);
    float best = -1.0;
    for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
      vec3 s = texture2D(tDiffuse, (cid + vec2(0.17 + 0.33 * float(i), 0.17 + 0.33 * float(j))) * cell / uRes).rgb;
      avg += s;
      float l = luma(s);
      if (l > best) { best = l; c = s; }
    }
    c = mix(avg / 9.0, c, 0.7);
    float l = pow(clamp(luma(c) * 1.9, 0.0, 1.0), 0.7);
    l += (hash12(cid * 1.37 + 3.1) - 0.5) * 0.5 / max(uGlyphs - 1.0, 1.0);
    float gi = l < 0.05 ? 0.0 : clamp(floor(l * (uGlyphs - 1.0) + 0.5), 1.0, uGlyphs - 1.0);
    float cov = texture2D(tAtlas, vec2((gi + inC.x) / uGlyphs, inC.y)).a;
    float mx = max(max(c.r, c.g), c.b);
    vec3 gc = c / max(mx, 0.04) * (0.55 + 0.6 * clamp(mx * 1.6, 0.0, 1.0));
    // A faint trace of the picture under the glyphs keeps the shapes legible between them.
    return mix(c * 0.07, gc, cov);
  }

  // ---- Riso ----
  vec3 risoTarget(vec2 u) {
    vec3 c = texture2D(tDiffuse, u).rgb;
    float l = luma(c), mx = max(max(c.r, c.g), c.b);
    // A dark frame prints its light as ink on the paper: a coloured light as its own colour at full strength (one
    // or two inks), a white one (the words, a flash) as a deep overprint, so the brightest things read darkest.
    float mn = min(min(c.r, c.g), c.b);
    float sat = (mx - mn) / max(mx, 1e-3);
    vec3 hue = (c - mn) / max(mx - mn, 1e-3);
    vec3 ink = mix(vec3(0.16), mix(vec3(0.16), vec3(1.0), hue), smoothstep(0.12, 0.45, sat));
    vec3 dark = mix(risoPaper, ink, smoothstep(0.03, 0.55, l + 0.15 * mx));
    // A plate lit like a picture prints positive: its own colours, a touch more contrast, the paper as its white.
    vec3 positive = pow(clamp(c, 0.0, 1.0), vec3(0.55)) * risoPaper;
    return mix(dark, positive, uRisoPos);
  }
  vec3 risoCover(vec2 u) { return clamp(risoM * log(max(risoTarget(u), vec3(0.02)) / risoPaper), 0.0, 1.0); }
  float screen(vec2 px, float ang, float c, float dot) {
    vec2 q = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * px / dot;
    float inv = step(0.5, c);
    vec2 f = fract(q + 0.5 * inv) - 0.5;
    float r = sqrt(mix(c, 1.0 - c, inv) / 3.14159);
    float d = length(f), aa = max(fwidth(d) * 0.8, 0.02);
    float m = 1.0 - smoothstep(r - aa, r + aa, d);
    return mix(m, 1.0 - m, inv);
  }
  vec3 riso(vec2 uv) {
    float u1 = unit();
    vec2 sh = vec2(2.5 * u1) / uRes;
    float c0 = risoCover(uv + sh * vec2(1.0, 0.4)).x, c1 = risoCover(uv + sh * vec2(-0.6, -0.8)).y, c2 = risoCover(uv + sh * vec2(0.2, 1.0)).z;
    vec2 px = uv * uRes;
    float dot = 6.5 * u1;
    // Uneven ink, fixed on the paper.
    float tx = 0.55 * (vnoise(px / (14.0 * u1)) - 0.5) + 0.25 * (vnoise(px / (3.0 * u1)) - 0.5);
    vec3 pr = risoPaper;
    pr *= mix(vec3(1.0), risoInk0 / risoPaper, screen(px, 0.2618, c0 * (1.0 + 0.3 * tx), dot));
    if (risoN > 1.5) pr *= mix(vec3(1.0), risoInk1 / risoPaper, screen(px + 1.7, 1.309, c1 * (1.0 - 0.3 * tx), dot));
    if (risoN > 2.5) pr *= mix(vec3(1.0), risoInk2 / risoPaper, screen(px + 3.1, 0.0, c2 * (1.0 + 0.25 * tx), dot));
    // Paper tooth.
    pr *= 1.0 - 0.035 * vnoise(px / (1.6 * u1));
    return pr;
  }

  // ---- Stained Glass: 彩绘镶嵌玻璃 ----
  void worleyCell(vec2 p, out float f1, out float f2, out vec2 cellCenter) {
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    f1 = 8.0;
    f2 = 8.0;
    cellCenter = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = vec2(hash12(ip + g), hash12(ip + g + 13.37));
        o = 0.5 + 0.38 * sin(o * 6.2831853);
        vec2 r = g + o - fp;
        float d = dot(r, r);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          cellCenter = ip + g + o;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    f1 = sqrt(f1);
    f2 = sqrt(f2);
  }

  vec3 stained(vec2 uv) {
    float u = unit();
    float cellSize = max(24.0, 42.0 * u);
    vec2 p = uv * uRes / cellSize;
    float f1, f2;
    vec2 cellCenter;
    worleyCell(p, f1, f2, cellCenter);

    // 铅条掩码与金属焊锡脊线高光 (H型黑铅条)
    float cameWidth = 0.085;
    float edgeDist = f2 - f1;
    float came = smoothstep(0.0, cameWidth, edgeDist);
    vec3 cameCol = vec3(0.04, 0.04, 0.05);
    float ridge = pow(clamp(1.0 - edgeDist / cameWidth, 0.0, 1.0), 3.0) * 0.25;
    cameCol += vec3(ridge);

    // 刻面立体折射与水纹色散
    vec2 centerUv = cellCenter * cellSize / uRes;
    vec2 delta = uv - centerUv;
    vec2 disp = -delta * (0.014 * (1.0 - smoothstep(0.0, 0.8, f1)));
    disp += (vec2(vnoise(uv * 120.0), vnoise(uv * 120.0 + 4.5)) - 0.5) * 0.003;

    vec2 uvR = clamp(uv + disp * 1.06, 0.0, 1.0);
    vec2 uvG = clamp(uv + disp, 0.0, 1.0);
    vec2 uvB = clamp(uv + disp * 0.94, 0.0, 1.0);
    vec3 glassSample = vec3(
      texture2D(tDiffuse, uvR).r,
      texture2D(tDiffuse, uvG).g,
      texture2D(tDiffuse, uvB).b
    );
    vec3 centerSample = texture2D(tDiffuse, clamp(centerUv, 0.0, 1.0)).rgb;
    vec3 glassCol = mix(glassSample, centerSample, 0.22);

    // 宝石色泽调色与明度/拓扑保真（R5）
    float l_src = luma(glassCol);
    float mx = max(max(glassCol.r, glassCol.g), glassCol.b);
    float mn = min(min(glassCol.r, glassCol.g), glassCol.b);
    float sat = (mx - mn) / max(mx, 1e-4);

    // 同色系饱和度提振 + 透光高光暖辉
    vec3 jewel = mix(vec3(l_src), glassCol, 1.45);
    jewel += pow(clamp(l_src, 0.0, 1.0), 2.5) * vec3(0.12, 0.10, 0.05);

    // 明度严格归一化保真，杜绝黑白灰中性封面强行染色
    float l_jewel = luma(jewel);
    if (l_jewel > 1e-4 && l_src > 1e-4) {
      jewel = jewel * (l_src / l_jewel);
    }
    vec3 finalGlass = mix(vec3(l_src), jewel, smoothstep(0.04, 0.18, sat));

    return mix(cameCol, finalGlass, came);
  }

  // ---- Blueprint: 工程蓝图线稿 ----
  vec3 blueprint(vec2 uv) {
    float u = unit();
    vec2 px = uv * uRes;

    // 普鲁士蓝底图与纸纹
    vec3 bg = vec3(0.025, 0.082, 0.215);
    bg += (vnoise(uv * 400.0) - 0.5) * 0.015 + sin(uv.y * uRes.y * 0.4) * 0.005;

    // 原图低对比度灰阶垫底，保持空间透视感
    float origLuma = luma(texture2D(tDiffuse, uv).rgb);
    bg += vec3(0.03, 0.09, 0.18) * origLuma;

    // 主测量网格 (间距 80px) 与次网格 (间距 16px)
    float majorSpacing = max(32.0, 80.0 * u);
    vec2 majorGrid = abs(fract(px / majorSpacing) - 0.5);
    float majorDist = min(majorGrid.x, majorGrid.y) * majorSpacing;
    float majorLine = 1.0 - smoothstep(0.0, 1.2 * u, majorDist);

    float minorSpacing = max(8.0, 16.0 * u);
    vec2 minorGrid = abs(fract(px / minorSpacing) - 0.5);
    float minorDist = min(minorGrid.x, minorGrid.y) * minorSpacing;
    float minorLine = 1.0 - smoothstep(0.0, 0.9 * u, minorDist);

    // 主网格交叉十字微标
    vec2 tickDist = abs(px - floor(px / majorSpacing + 0.5) * majorSpacing);
    float tickLine = step(min(tickDist.x, tickDist.y), 0.75 * u) * step(max(tickDist.x, tickDist.y), 5.0 * u);

    vec3 minorColor = vec3(0.05, 0.16, 0.32);
    vec3 majorColor = vec3(0.10, 0.30, 0.55);
    vec3 tickColor = vec3(0.35, 0.65, 0.90);
    vec3 gridCol = bg + minorColor * (minorLine * 0.45) + majorColor * (majorLine * 0.65) + tickColor * (tickLine * 0.85);

    // Sobel 梯度边缘线稿提取
    vec2 st = vec2(u * 1.25) / uRes;
    float s_tl = luma(texture2D(tDiffuse, uv + vec2(-st.x,  st.y)).rgb);
    float s_t  = luma(texture2D(tDiffuse, uv + vec2( 0.0,   st.y)).rgb);
    float s_tr = luma(texture2D(tDiffuse, uv + vec2( st.x,  st.y)).rgb);
    float s_l  = luma(texture2D(tDiffuse, uv + vec2(-st.x,  0.0)).rgb);
    float s_r  = luma(texture2D(tDiffuse, uv + vec2( st.x,  0.0)).rgb);
    float s_bl = luma(texture2D(tDiffuse, uv + vec2(-st.x, -st.y)).rgb);
    float s_b  = luma(texture2D(tDiffuse, uv + vec2( 0.0,  -st.y)).rgb);
    float s_br = luma(texture2D(tDiffuse, uv + vec2( st.x, -st.y)).rgb);
    float gx = (s_tr + 2.0 * s_r + s_br) - (s_tl + 2.0 * s_l + s_bl);
    float gy = (s_bl + 2.0 * s_b + s_br) - (s_tl + 2.0 * s_t + s_tr);
    float g = sqrt(gx * gx + gy * gy);
    float edgeMask = smoothstep(0.08, 0.28, g);
    vec3 edgeCol = vec3(0.85, 0.95, 1.0);

    // 45° 剖面工程排线阴影 (暗部 L < 0.48)
    float hatchSpacing = max(4.0, 9.0 * u);
    float hatch1 = step(fract((px.x + px.y) / hatchSpacing), 0.16);
    float shadowMask1 = smoothstep(0.48, 0.15, origLuma);

    float hatch2 = step(fract((px.x - px.y) / hatchSpacing), 0.16);
    float shadowMask2 = smoothstep(0.22, 0.05, origLuma);

    vec3 hatchCol = vec3(0.20, 0.45, 0.75) * (hatch1 * shadowMask1 * 0.6 + hatch2 * shadowMask2 * 0.5);

    return mix(gridCol + hatchCol, edgeCol, edgeMask);
  }

  void main() {
    // ---- the tube's glass: barrel curvature ----
    vec2 glass = vUv;
    if (uCrt > 0.0) {
      vec2 d = (vUv - 0.5) * 2.0;
      d *= 1.0 + 0.11 * uCrt * d.yx * d.yx;
      glass = d * 0.5 + 0.5;
    }
    vec2 uv = glass;
    vec3 col = uHibit > 0.0 ? blockColour(uv) : texture2D(tDiffuse, uv).rgb;
    if (uVhs > 0.0) col = mix(col, vhs(uv), uVhs);
    if (uAscii > 0.0) col = mix(col, ascii(uv), uAscii);
    if (uRiso > 0.0) col = mix(col, riso(glass), uRiso);
    if (uStained > 0.0) col = mix(col, stained(glass), uStained);
    if (uBlueprint > 0.0) col = mix(col, blueprint(glass), uBlueprint);
    if (uHibit > 0.0) {
      // Flat colour levels, no dither (dither turned glow haze into speckle), the near-blacks held black, and faint
      // gaps between the blocks.
      float b = blockPx();
      float L = 6.0;
      vec3 cc = clamp(col, 0.0, 1.0);
      cc *= smoothstep(0.02, 0.08, max(max(cc.r, cc.g), cc.b));
      vec3 q = floor(cc * L + 0.5) / L;
      col = mix(col, q, uHibit);
      vec2 fp = fract(glass * uRes / b);
      float gw = 1.0 / b;
      col *= 1.0 - uHibit * 0.28 * max(step(1.0 - gw, fp.x), step(1.0 - gw, fp.y));
    }
    if (uCrt > 0.0) {
      vec2 gpx = glass * uRes;
      float L = luma(clamp(col, 0.0, 1.0));
      float ph = 0.5 - 0.5 * cos(6.2831853 * glass.y * 300.0);
      col *= 1.0 - uCrt * 0.5 * ph * (1.0 - 0.5 * L);
      int gx = int(mod(floor(gl_FragCoord.x / max(1.0, floor(unit() + 0.5))), 3.0));
      vec3 grille = gx == 0 ? vec3(1.16, 0.92, 0.92) : gx == 1 ? vec3(0.92, 1.16, 0.92) : vec3(0.92, 0.92, 1.16);
      col *= mix(vec3(1.0), grille, uCrt * 0.3);
      col *= 1.0 + (hash12(vec2(floor(uTime * 60.0), 7.0)) - 0.5) * 0.025 * uCrt;
      // The glass darkens toward its rim; outside it, a black bezel with rounded corners.
      vec2 asp = vec2(uRes.x / uRes.y, 1.0);
      vec2 q = (glass - 0.5) * asp, hb = 0.5 * asp - 0.004;
      float rr = 0.055;
      float dB = length(max(abs(q) - (hb - rr), 0.0)) - rr;
      col *= mix(1.0, smoothstep(0.0, -0.09, dB) * 0.35 + 0.65, uCrt);
      col *= 1.0 - smoothstep(-0.002, 0.002, dB) * uCrt;
    }
    // The letterbox, redrawn in the medium (the bars drawn under the overlay are printed over or turned to glyphs):
    // solid in the deepest ink on a print, the cover's ink elsewhere; the words and motion graphics go over it.
    if (vUv.y < uBox || vUv.y > 1.0 - uBox) col = uRiso > 0.0 ? risoDeep : uBoxInk;
    // The words and the motion graphics (linear, premultiplied): clean over characters, printed solid on paper.
    if (uSplit > 0.5) {
      vec4 w = texture2D(tLyr, vUv) * clamp(1.0 - uFade, 0.0, 1.0);
      if (uRiso > 0.0) {
        // 仅用单次对位采样印制歌词主墨，移除错位套印采样以消除 Riso 模式下的文字双影
        float k = clamp(luma(w.rgb) * 1.6, 0.0, 1.0);
        float tooth = 1.0 - 0.12 * vnoise(vUv * uRes / (2.0 * unit()));
        col *= mix(vec3(1.0), risoDeep / risoPaper, k * tooth * uRiso);
      } else if (w.a > 0.001) {
        vec3 lin = clamp(w.rgb / w.a, 0.0, 1.0);
        vec3 s = mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lin));
        col = mix(col, s, clamp(w.a, 0.0, 1.0));
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

/** The look settings a frame carries (Fx), 0..1 each; the riso inks and the glyphs are per song. */
export interface LookFx { riso: number; risoPositive: number; hibit: number; ascii: number; crt: number; vhs: number; stained: number; blueprint: number; letterbox: number; fade?: number }

export class LookPass extends Pass {
  private quad: FullScreenQuad;
  readonly material: THREE.ShaderMaterial;
  private atlas: GlyphAtlas | null = null;
  private ownsAtlas = false;
  private inks = -1;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: null }, tLyr: { value: null }, tAtlas: { value: null },
        uRiso: { value: 0 }, uRisoPos: { value: 0 }, uHibit: { value: 0 }, uAscii: { value: 0 }, uCrt: { value: 0 }, uVhs: { value: 0 }, uStained: { value: 0 }, uBlueprint: { value: 0 }, uSplit: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 },
        uGlyphs: { value: 2 }, uGlyphAspect: { value: 1 }, uRes: { value: new THREE.Vector2(1920, 1080) },
        risoPaper: { value: new THREE.Vector3(1, 1, 1) }, risoDeep: { value: new THREE.Vector3() }, risoSecond: { value: new THREE.Vector3() }, risoInk0: { value: new THREE.Vector3() }, risoInk1: { value: new THREE.Vector3() }, risoInk2: { value: new THREE.Vector3() },
        risoM: { value: new THREE.Matrix3() }, risoN: { value: 0 },
        uBox: { value: 0 }, uBoxInk: { value: new THREE.Vector3() },
      },
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** Per song: the riso inks nearest its palette and the glyphs from its lyrics (skipped when ASCII look is unused). */
  setSong(palette: Palette, lyricText: string, needsAscii = true): void {
    const ink = palette.ink.clone().convertLinearToSRGB();
    (this.material.uniforms.uBoxInk.value as THREE.Vector3).set(ink.r, ink.g, ink.b);
    const k = risoInksFor(palette);
    if (k !== this.inks) {
      const r = risoSet(k), u = this.material.uniforms;
      this.inks = k;
      (u.risoPaper.value as THREE.Vector3).copy(r.paper);
      (u.risoInk0.value as THREE.Vector3).copy(r.ink0);
      (u.risoInk1.value as THREE.Vector3).copy(r.ink1);
      (u.risoInk2.value as THREE.Vector3).copy(r.ink2);
      (u.risoM.value as THREE.Matrix3).copy(r.m);
      u.risoN.value = r.n;
      // The words: the darkest ink, the next darkest off register under it.
      const inks = [r.ink0, r.ink1, r.ink2].slice(0, r.n).sort((a, b) => lum(a) - lum(b));
      (u.risoDeep.value as THREE.Vector3).copy(inks[0]);
      (u.risoSecond.value as THREE.Vector3).copy(inks[1] ?? inks[0]);
    }
    if (this.ownsAtlas) this.atlas?.dispose();
    if (needsAscii) {
      this.atlas = new GlyphAtlas(lyricText);
      this.ownsAtlas = true;
    } else {
      this.atlas = (sharedLatinAtlas ??= new GlyphAtlas(''));
      this.ownsAtlas = false;
    }
    const u = this.material.uniforms;
    u.tAtlas.value = this.atlas.texture;
    u.uGlyphs.value = this.atlas.n;
    u.uGlyphAspect.value = this.atlas.aspect;
  }

  set(fx: LookFx, t: number, lyr: THREE.Texture | null): void {
    const u = this.material.uniforms;
    u.uRiso.value = fx.riso;
    u.uRisoPos.value = fx.risoPositive;
    u.uHibit.value = fx.hibit;
    u.uAscii.value = this.atlas ? fx.ascii : 0;
    u.uCrt.value = fx.crt;
    u.uVhs.value = fx.vhs;
    u.uStained.value = fx.stained;
    u.uBlueprint.value = fx.blueprint;
    u.uBox.value = 0.128 * fx.letterbox;
    u.uFade.value = fx.fade ?? 0;
    u.uTime.value = t;
    u.uSplit.value = lyr ? 1 : 0;
    u.tLyr.value = lyr;
  }

  override setSize(width: number, height: number): void {
    (this.material.uniforms.uRes.value as THREE.Vector2).set(width, height);
  }

  /** Draws once into `target` so the first section with a look doesn't stall on compiling it. */
  warm(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    this.material.uniforms.tDiffuse.value = read.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    this.quad.render(renderer);
  }

  override dispose(): void {
    if (this.ownsAtlas) this.atlas?.dispose();
    this.atlas = null;
    this.ownsAtlas = false;
    sharedLatinAtlas?.dispose();
    sharedLatinAtlas = null;
    this.material.dispose();
    this.quad.dispose();
  }
}
