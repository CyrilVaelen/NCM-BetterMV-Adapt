// Paper-cut (the 墨 style): the cover folded into a round window flower (窗花) cut from red paper and pasted on rice
// paper. The fold is the kaleidoscope's (8 or 12 mirrored segments, an endless zoom in log-polar space): the cover is
// split into its darks and lights and one side stays paper (see cutAt), the fold lines and band edges are the strips
// that hold it together,
// two rings close it round; the broad solid parts are pierced with little crescents (月牙纹), as a paper-cut's are, and
// it casts a faint shadow on the page under it. It turns slowly and keeps growing outwards from its heart, a little
// faster when the song is fuller. The red is the cover's most saturated colour, deepened (a cover without colour gets
// vermilion). Variants: turn (turning as it grows), bloom (only growing, closer). The words are written on the paper
// beside it in columns, a line to the left, the next to the right (arcs in the pattern itself piled up unreadably).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { lerp, rng } from './types.ts';
import { firstSameSeed, sameSceneBlend } from './cameraBlend.ts';
import { LyricRig } from './lyricRig.ts';
import { ricePaper } from './ink.ts';

const vertexShader = /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uCover;
  uniform float uAspect, uSeg, uRot, uZoom, uThresh, uKeepLight, uRadius, uScale, uLight;
  uniform vec3 uRed, uRice;
  varying vec2 vP;
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
  }
  /** The fold: where in the cover this point reads; edge = how near a fold line or a band edge it is (0..1). */
  vec2 fold(vec2 p, out float edge) {
    float r = length(p);
    float a = atan(p.y, p.x) + uRot;
    float seg = 6.2831853 / uSeg;
    float la = mod(a, seg);
    float m = abs(la - seg * 0.5);
    float band = fract(log(max(r, 1e-3)) * 1.25 - uZoom);
    float edgeA = 1.0 - smoothstep(0.0028, 0.0075, min(la, seg - la) * r);
    float edgeB = 1.0 - smoothstep(0.012, 0.03, min(band, 1.0 - band));
    edge = max(edgeA, edgeB);
    return vec2(cos(m), sin(m)) * mix(0.06, 0.47, band) + 0.5;
  }
  /** The red paper here: the cover's darks, the strips, the two rims; nothing outside the flower. */
  float paperAt(vec2 p) {
    float edge;
    vec2 uv = fold(p, edge);
    // (Read blurred: scissors cut clean shapes, not a photo's grain.)
    float l = dot(texture2D(uCover, uv, 2.5).rgb, vec3(0.2126, 0.7152, 0.0722));
    float keep = smoothstep(uThresh + 0.015, uThresh - 0.015, l);
    if (uKeepLight > 0.5) keep = 1.0 - keep;
    float r = length(p);
    float rim = 1.0 - smoothstep(0.008, 0.012, abs(r - uRadius * 0.975));
    rim = max(rim, 1.0 - smoothstep(0.003, 0.006, abs(r - uRadius * 0.935)));
    float inner = 1.0 - smoothstep(uRadius * 0.93, uRadius * 0.935, r);
    return max(max(keep, edge) * inner, rim) * (1.0 - smoothstep(uRadius - 0.003, uRadius, r));
  }
  void main() {
    vec2 p = vP * vec2(uAspect, 1.0) / uScale;
    float r = length(p);
    float m = paperAt(p);
    // Crescents pierce the broad solid parts (away from every cut edge), following the fold.
    float edge;
    vec2 uv = fold(p, edge);
    vec2 g = uv * 30.0, f = fract(g) - 0.5;
    float cres = (1.0 - smoothstep(0.2, 0.23, length(f))) * smoothstep(0.16, 0.19, length(f - vec2(0.1, 0.08)));
    // (Only where a crescent is big enough to cut: towards the heart they would shrink into a moiré.)
    cres *= 1.0 - smoothstep(0.08, 0.14, max(fwidth(g.x), fwidth(g.y)));
    float e = 0.014;
    float inner = min(min(paperAt(p + vec2(e, 0.0)), paperAt(p - vec2(e, 0.0))), min(paperAt(p + vec2(0.0, e)), paperAt(p - vec2(0.0, e))));
    m *= 1.0 - cres * smoothstep(0.92, 1.0, inner) * (1.0 - edge) * step(r, uRadius * 0.9);
    // The paper lies a little above the page: a faint shadow down and to one side.
    float sh = paperAt(p + vec2(-0.006, 0.009)) * (1.0 - m);
    vec3 rice = uRice * (0.94 + 0.06 * n2(vP * 9.0) - 0.03 * smoothstep(0.6, 0.9, n2(vec2(vP.x * 300.0, vP.y * 14.0))));
    rice *= 1.0 - 0.18 * sh;
    vec3 red = uRed * (0.9 + 0.08 * n2(vP * 60.0) + 0.06 * n2(vP * 7.0));
    // Freshly articulated notes light the cut edges; the paper remains visibly red on rice paper.
    float cutEdge = clamp(1.0 - inner, 0.0, 1.0);
    red = mix(red, mix(uRed, uRice, 0.4), uLight * (0.18 + 0.65 * cutEdge));
    gl_FragColor = vec4(mix(rice, red, m), 1.0);
  }`;

/**
 * The paper's red, as the seal's: vermilion, or the cover's own red when it has one (a strong colour in the red
 * family), deepened. (Other hues were tried: a mustard or a navy cut reads as card, not as a window flower.)
 */
function cutRed(palette: SceneInit['palette']): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  for (const c of [palette.signal, palette.accent]) {
    c.getHSL(hsl);
    if (!palette.mono && hsl.s > 0.4 && (hsl.h < 0.05 || hsl.h > 0.93)) return new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, 0.7), THREE.MathUtils.clamp(hsl.l, 0.16, 0.26));
  }
  return new THREE.Color(0.6, 0.055, 0.035);
}

/**
 * Where to cut: the split between the cover's darks and lights (Otsu's threshold on its brightness, linear as the
 * shader reads the texture), and which side stays paper — whichever is nearer half the cover, so a flat graphic
 * cover (a field of one colour with a figure on it) is neither all paper nor all cut away. (A median cut fell inside
 * such a field and cut the whole flower out.)
 */
function cutAt(px: Uint8ClampedArray): { thresh: number; keepLight: boolean } {
  const B = 128, hist = new Float64Array(B);
  const lin = (v: number) => Math.pow(v / 255, 2.2);
  let n = 0;
  for (let o = 0; o < px.length; o += 16, n++) hist[Math.min(B - 1, Math.floor((0.2126 * lin(px[o]) + 0.7152 * lin(px[o + 1]) + 0.0722 * lin(px[o + 2])) * B))]++;
  let sum = 0;
  for (let i = 0; i < B; i++) sum += i * hist[i];
  let w0 = 0, s0 = 0, best = -1, split = B / 2;
  for (let i = 0; i < B - 1; i++) {
    w0 += hist[i]; s0 += i * hist[i];
    const w1 = n - w0;
    if (!w0 || !w1) continue;
    const between = w0 * w1 * Math.pow(s0 / w0 - (sum - s0) / w1, 2);
    if (between > best) { best = between; split = i + 1; }
  }
  let dark = 0;
  for (let i = 0; i < split; i++) dark += hist[i];
  const f = dark / Math.max(1, n), keepLight = Math.abs(1 - f - 0.5) < Math.abs(f - 0.5);
  // A thin cut (under 45% paper) reads as a wheel of strips: move the split into the cut side a bin at a time until
  // enough stays paper, but never across a bin that alone would take it past 75% (a flat field of one colour).
  let kept = keepLight ? 1 - f : f;
  while (kept < 0.45) {
    const next = keepLight ? split - 1 : split;
    if (next < 0 || next >= B || kept + hist[next] / n > 0.75) break;
    kept += hist[next] / n;
    split += keepLight ? -1 : 1;
  }
  return { thresh: split / B, keepLight };
}

export class PaperCut implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  private material: THREE.ShaderMaterial;
  private rig: LyricRig;

  constructor(private init: SceneInit) {
    const { palette } = init;
    const rice = ricePaper(palette);
    this.scene.background = rice.clone();
    const cut = cutAt(init.coverPixels);
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        uCover: { value: init.cover }, uAspect: { value: 16 / 9 }, uSeg: { value: 8 }, uRot: { value: 0 }, uZoom: { value: 0 },
        uThresh: { value: cut.thresh }, uKeepLight: { value: cut.keepLight ? 1 : 0 }, uRadius: { value: 0.92 }, uScale: { value: 1 }, uLight: { value: 0 },
        uRed: { value: cutRed(palette) }, uRice: { value: rice },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    quad.renderOrder = -10;
    this.scene.add(quad);
    this.camera.position.set(0, 0, 10);
    this.rig = new LyricRig(palette, 'poem');
    this.rig.onLight = true;
    this.rig.place = (root, st) => {
      const vh = 2 * 10 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), vw = vh * this.camera.aspect;
      // In the margin beside the flower (it is as tall as the frame), a little above the middle.
      const margin = Math.max(vw / 2 - vh * 0.46, vh * 0.12);
      root.position.set((st.index % 2 ? 1 : -1) * (vw / 2 - margin * 0.5), vh * 0.03, 0);
    };
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uAspect.value = aspect;
    const vh = 2 * 10 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.rig.frame = { vh, vw: vh * aspect };
  }

  /** 纯函数求值指定镜头在时刻 t 的窗花基础旋转角与缩放倍率。 */
  private evalShotCut(t: number, s: Shot, dir: number): { rot: number; scale: number } {
    const sStart = s.run?.start ?? s.start;
    if (s.variant === 'bloom') {
      // bloom 模式下窗花停驻在切入时刻的角度上，仅向外生长并拉近，避免与 turn 发生大角度倒转跳变
      return { rot: dir * sStart * 0.035, scale: 1.35 };
    }
    return { rot: dir * t * 0.035, scale: 1 };
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot } = ctx;
    const u = this.material.uniforms;
    // 同场景连切时固定窗花折数（8/12 折）与旋转方向，避免切镜瞬间窗花瓣数重折或角度正负反转
    const baseRandom = rng(firstSameSeed(shot));
    u.uSeg.value = baseRandom() < 0.5 ? 8 : 12;
    const dir = baseRandom() < 0.5 ? -1 : 1;
    const foreground = music.foregroundAt(t), travel = music.foregroundMotion(t, 0.2);
    // Integrate accepted notes in song time: sequential playback and a direct seek reveal the same fold.
    u.uZoom.value = t * 0.075 + travel * 0.018 + foreground.level * 0.08 + foreground.attack * 0.035;

    const cB = this.evalShotCut(t, shot, dir);
    let rot = cB.rot, scale = cB.scale;
    const blend = sameSceneBlend(t, shot, 1.25);
    if (blend) {
      const cA = this.evalShotCut(t, blend.prev, dir);
      rot = lerp(cA.rot, rot, blend.w);
      scale = lerp(cA.scale, scale, blend.w);
    }
    u.uRot.value = rot + dir * travel * 0.012;
    u.uScale.value = scale * (1 + foreground.level * 0.055 + foreground.attack * 0.035);
    u.uLight.value = Math.min(1, foreground.level * 0.25 + foreground.attack * 0.8);
    ctx.fx.bloom = 0.04;
    ctx.fx.vignette = 0.25;
    ctx.fx.grain = 0.035;
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }
}
