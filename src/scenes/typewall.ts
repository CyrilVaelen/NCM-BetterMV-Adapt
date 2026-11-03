// Type wall (the 字 style, for rap): the words ARE the picture. The line being rapped is stacked in rows as it is
// sung, every row set as wide as the frame allows (Latin a word a row, Chinese two to four characters a row); a new
// row slams in at the bottom and shoves the stack up; the word being rapped is in the signal colour; a snare knocks
// the newest row out of a solid signal block; kicks jolt the whole wall. Behind: the cover as a hard ink / signal
// duotone — a strip down one side (split), full-bleed and dark (stack), or nothing but ink (solo, one row at a time).
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, lerp, outExpo, rng, snap } from './types.ts';
import { sameSceneBlend, stableShotSeed } from './cameraBlend.ts';
import { textMesh, hasCjk } from '../render/text.ts';
import type { LineState } from '../director/lyrics.ts';
import { lastIndex } from '../director/music.ts';

const DIST = 10;
type Mesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
interface Row { text: string; start: number; mesh: Mesh; block: Mesh; aspect: number }
interface Built { index: number; rows: Row[]; root: THREE.Group }

const coverVertex = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const coverFragment = /* glsl */ `
  uniform sampler2D uCover; uniform vec3 uInk, uSig; uniform float uDim, uKick; varying vec2 vUv;
  void main() {
    float l = dot(texture2D(uCover, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
    float v = smoothstep(0.32, 0.5, l + uKick * 0.08);
    gl_FragColor = vec4(mix(uInk, uSig, v) * uDim, 1.0);
  }`;

export class TypeWall implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
  private built = new Map<number, Built>();
  private cover: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private snares: Float64Array;
  private musicRows: Mesh[] = [];

  constructor(private init: SceneInit) {
    const { palette } = init;
    this.scene.background = palette.ink.clone();
    this.cover = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: coverVertex, fragmentShader: coverFragment, depthWrite: false,
      uniforms: { uCover: { value: init.cover }, uInk: { value: palette.ink.clone() }, uSig: { value: palette.signal.clone() }, uDim: { value: 1 }, uKick: { value: 0 } },
    }));
    this.cover.renderOrder = -5;
    this.scene.add(this.cover);
    // Between lines the wall remains a picture: four solid typographic strokes shaped by the foreground.
    // They are visual marks, not substitute lyrics, and stay on the body layer under all looks.
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0.5, 0, 0);
      const row = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: palette.signal, toneMapped: false, depthWrite: false }));
      row.renderOrder = -2;
      this.musicRows.push(row);
      this.scene.add(row);
    }
    this.snares = Float64Array.from(init.music.roleHits('synthStab', 0, init.music.duration).filter(h => h[1] > 0.2), h => h[0]);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    for (const b of Array.from(this.built.values())) this.drop(b);
  }

  /** Rows of a line: a Latin word each; Chinese in runs of up to four characters, broken at punctuation. */
  private rowsOf(state: LineState): Array<{ text: string; start: number }> {
    const words = state.line.words;
    if (!hasCjk(state.line.text)) return words.map(w => ({ text: w.text.toUpperCase(), start: w.start }));
    const rows: Array<{ text: string; start: number }> = [];
    let cur: { text: string; start: number } | null = null;
    for (const w of words) {
      const glyphs = Array.from(w.text.replace(/[，。、！？；：,.!?;:]/g, ''));
      if (!cur || Array.from(cur.text).length + glyphs.length > 4) { cur = { text: '', start: w.start }; rows.push(cur); }
      cur.text += glyphs.join('');
      if (/[，。、！？；：,.!?;:]$/.test(w.text)) cur = null;
    }
    return rows.filter(r => r.text);
  }

  private build(state: LineState): Built {
    const root = new THREE.Group();
    root.userData.lyrics = true;
    const rows = this.rowsOf(state).map(r => {
      const mesh = textMesh(r.text, 'condensed', 1, { center: true, px: 200, halo: 'none' });
      mesh.material.toneMapped = false;
      mesh.material.depthTest = false;
      mesh.renderOrder = 20;
      const block = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: this.init.palette.signal, toneMapped: false, depthTest: false, transparent: true }));
      block.renderOrder = 19;
      root.add(block, mesh);
      return { text: r.text, start: r.start, mesh, block, aspect: mesh.userData.width as number };
    });
    this.scene.add(root);
    return { index: state.index, rows, root };
  }

  private drop(b: Built): void {
    this.scene.remove(b.root);
    b.root.traverse(o => { const m = o as Mesh; if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });
    this.built.delete(b.index);
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, palette } = ctx;
    const random = rng(shot.seed);
    const cam = this.camera;
    const vh = 2 * DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), vw = vh * ctx.aspect;
    const foreground = music.foregroundAt(t);
    const kick = foreground.attack + 0.3 * foreground.level;
    const si = lastIndex(this.snares, t), snareAge = si >= 0 ? t - this.snares[si] : 99;
    const side = random() < 0.5 ? -1 : 1;
    const variant = shot.variant;

    // The cover behind: a strip, a dim full bleed, or nothing.
    const cu = this.cover.material.uniforms;
    cu.uKick.value = kick;
    const states = ctx.lyrics.visible(t);
    const instrumental = states.length === 0;
    const flow = music.foregroundMotion(t, 0.3);
    this.musicRows.forEach((row, i) => {
      row.visible = instrumental;
      if (!instrumental) return;
      const wave = 0.5 + 0.5 * Math.sin(flow * 0.75 + i * 1.7);
      const width = vw * (0.19 + i * 0.035 + foreground.level * (0.14 + 0.13 * wave) + foreground.attack * 0.1);
      row.position.set(-vw * 0.29, (1.5 - i) * vh * 0.13, -DIST + 0.1);
      row.scale.set(width, vh * (0.055 + 0.02 * foreground.level + 0.015 * foreground.attack), 1);
      row.material.color.copy(palette.signal).lerp(palette.paper, 0.2 + 0.25 * foreground.attack).multiplyScalar(0.5 + 0.65 * foreground.level + 0.5 * foreground.attack);
    });
    this.cover.visible = variant !== 'solo' || instrumental;
    if (variant === 'split' && !instrumental) {
      this.cover.scale.set(vw * 0.34 * (1 + foreground.level * 0.05), vh * (1 + foreground.level * 0.05), 1);
      this.cover.position.set(side * vw * 0.33, 0, 0);
      cu.uDim.value = 1;
    } else {
      const size = instrumental ? Math.min(vw * 0.7, vh * 0.85) : vw * 1.05;
      this.cover.scale.setScalar(size * (1 + foreground.level * 0.08 + foreground.attack * 0.035));
      this.cover.position.set(0, -kick * 0.05, 0);
      cu.uDim.value = instrumental ? 0.6 + 0.3 * foreground.level : 0.22 + 0.14 * foreground.level;
    }
    // Where the words go: the free side of a split, else the whole frame.
    const areaW = variant === 'split' ? vw * 0.58 : vw * 0.88;
    const areaX = variant === 'split' ? -side * vw * 0.19 : 0;

    const keep = new Set(states.map(s => s.index));
    for (const b of Array.from(this.built.values())) if (!keep.has(b.index)) this.drop(b);
    const jolt = kick * vh * 0.012;
    for (const st of states) {
      const b = this.built.get(st.index) ?? this.built.set(st.index, this.build(st)).get(st.index)!;
      const shown = b.rows.filter(r => t >= r.start - 0.03);
      const rows = variant === 'solo' ? shown.slice(-1) : shown.slice(-4);
      // Heights: each row as wide as the area, capped; the stack sits on a baseline below the middle.
      // (Four rows of at most a fifth of the frame fit between the baseline and the top margin.)
      const hs = rows.map(r => Math.min(vh * (variant === 'solo' ? 0.5 : 0.2), areaW / Math.max(0.2, r.aspect)));
      let y = -vh * (variant === 'solo' ? 0.25 : 0.4) + snap(st.exit) * vh * 1.1;
      for (const r of b.rows) { r.mesh.visible = false; r.block.visible = false; }
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i], h = hs[i];
        const age = t - r.start, slam = outExpo(clamp01(age / 0.12));
        // Rows above the newest slide up to their places as it pushes in.
        const lift = i === rows.length - 1 ? 0 : (1 - outExpo(clamp01((t - rows[rows.length - 1].start) / 0.15))) * -hs[rows.length - 1];
        const scale = h * (1 + (1 - slam) * 0.5) * (1 + 0.025 * foreground.level);
        const yy = y + h * 0.5 + lift - jolt;
        r.mesh.visible = true;
        r.mesh.scale.set(scale, scale, 1);
        r.mesh.position.set(areaX, yy, -DIST);
        const newest = i === rows.length - 1;
        const snap = newest && snareAge < 0.14 && age > 0.05;
        const singing = newest && age < 0.5;
        r.mesh.material.color.copy(snap ? palette.ink : singing ? palette.signal : palette.paper);
        r.mesh.material.opacity = slam * (1 - st.exit) * (newest ? 1 : 0.55 + 0.45 * (i / rows.length));
        r.block.visible = snap;
        if (snap) {
          r.block.scale.set(r.aspect * h * 1.06, h * 1.1, 1);
          r.block.position.set(areaX, yy, -DIST - 0.01);
          r.block.material.opacity = 1 - st.exit;
        }
        y += h * 1.02;
      }
    }

    const evalRoll = (s: Shot) => {
      const rr = rng(stableShotSeed(s));
      const sSide = rr() < 0.5 ? -1 : 1;
      return (rr() - 0.5) * 0.06 + kick * 0.01 * sSide;
    };
    const blend = sameSceneBlend(t, shot, 0.8);
    const roll = blend ? lerp(evalRoll(blend.prev), evalRoll(shot), blend.w) : evalRoll(shot);
    cam.position.set(0, 0, 0);
    cam.lookAt(0, 0, -1);
    cam.rotateZ(roll);
    cam.updateMatrixWorld();
    this.cover.position.z = -DIST - 0.5;
    this.cover.lookAt(cam.position);
    ctx.fx.bloom = 0.2 + kick * 0.2;
    ctx.fx.vignette = 0.35;
    ctx.fx.ca = kick * 0.25;
  }

}
