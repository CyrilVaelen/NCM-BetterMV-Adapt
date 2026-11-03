// Channel: flying down a tube built of the song's spectrum. Each ring of light round the tube is the spectrum at one
// moment, mirrored four ways (the bass on the side walls, the treble over the top and the floor), its loud bands
// reaching in from the wall; the rings ahead are the sound still to come, dim, and each flares as it crosses "now" —
// a ring just ahead of the camera — then glows on behind it. So the tube narrows round every kick and every bass
// note before it arrives, and a drop is a wall of light rushing in. Every strong kick is also a bright hoop coming
// down the tube to meet the camera. The flight's speed is the music's (fractal.ts, Flight: calm sections drift,
// builds accelerate, a drop goes flat out, kicks surge); the tube turns slowly into a helix as it goes.
// Cameras: down the middle (axis), close to one wall, the rings streaming past (wall), rolling (roll). The words are
// signs ahead in the tube.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, rng, smooth } from './types.ts';
import { LyricBlocks, Stands, voiceFor } from './lyricBlock.ts';
import { COLS, SpecRing, Spectrogram } from './viz.ts';
import { Flight, hue, u3 } from './fractal.ts';
import { lastIndex } from '../director/music.ts';
import { blendCameraPose, evalChainPose, poseLookAt, stableShotSeed, standShotStart } from './cameraBlend.ts';

const NB = 64;
const RING = 1024;
/** The tube's radius; points round each ring; rings a second; seconds of them behind and ahead of now. */
const R = 3;
const AROUND = 168;
const RATE = 30;
const BACK = 1;
const AHEAD = 6;
const ROWS = (BACK + AHEAD) * RATE;
/** How far ahead of the camera "now" is, seconds. */
const LEAD = 1.0;
const HOOPS = 12;

type Pal = { ink: THREE.Color; signal: THREE.Color; accent: THREE.Color; paper: THREE.Color };

function vert(_p: Pal): string {
  return /* glsl */ `
uniform sampler2D tSpec;
uniform sampler2D tRowZ;
uniform float uC0, uNow, uScale, uGain, uTwist, uSelective;
uniform vec3 uLeadDrop;
uniform vec3 uToneLow, uToneMid, uToneHigh;
attribute vec2 cell;
varying vec3 vCol;
const float PI = 3.14159265;
void main() {
  float a = cell.x, row = cell.y;
  float col = uC0 + row * ${(COLS / RATE).toFixed(1)};
  float band = abs(sin(a)) * ${(NB - 1).toFixed(1)};
  vec2 spectrum = texture2D(tSpec, vec2((band + 0.5) / ${NB.toFixed(1)}, (mod(col, ${RING.toFixed(1)}) + 0.5) / ${RING.toFixed(1)})).rg;
  float v=spectrum.r, light=mix(v, .12*v+.88*min(1.0,1.5*spectrum.g),uSelective);
  float z = texture2D(tRowZ, vec2((row + 0.5) / ${ROWS.toFixed(1)}, 0.5)).r;
  float r = ${R.toFixed(2)} * (1.0 - 0.55 * pow(v, 1.4));
  // Chord stabs open the tube itself; held lead sends a broad bend down its walls.
  r *= 1.0 + 0.16 * uLeadDrop.x * sin(z * 0.45 + uLeadDrop.z * 6.2831853)
    + 0.32 * uLeadDrop.y * (0.7 + 0.3 * cos(3.0 * a));
  float aa = a + z * uTwist;
  vec3 pos = vec3(cos(aa) * r, sin(aa) * r, z);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  // Ahead: dim; crossing now: a flare; behind: glowing on, fading.
  float age = (uNow - col) / ${COLS.toFixed(1)};
  float lit = age < 0.0 ? 0.3 + 0.7 * exp(age * 2.5) : 1.0;
  lit *= 1.0 + 2.2 * exp(-pow(age / 0.06, 2.0));
  float k = band / ${(NB - 1).toFixed(1)};
  vec3 tone = k < 0.5 ? mix(uToneLow, uToneMid, smoothstep(0.05, 0.5, k)) : mix(uToneMid, uToneHigh, smoothstep(0.55, 1.0, k));
  vCol = tone * (0.06 + 1.7 * light * light) * lit * uGain;
  gl_PointSize = uScale * (0.035 + 0.05 * v) / -mv.z;
}`;
}

const DOT_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  gl_FragColor = vec4(vCol * (1.0 - d) * (1.0 - d), 1.0);
}`;

/** The hoops: a ring of light per strong kick, at its place down the tube (per hoop: z, strength, flare). */
function hoopFrag(_p: Pal): string {
  return /* glsl */ `
uniform vec3 uHoop[${HOOPS}];
uniform vec3 uHoopWhite, uHoopSig;
varying vec3 vPos;
void main() {
  float c = 0.0, f = 0.0;
  for (int i = 0; i < ${HOOPS}; i++) {
    vec3 h = uHoop[i];
    if (h.y <= 0.0) continue;
    float e = (vPos.z - h.x) / 0.18;
    float g = exp(-e * e) * h.y;
    c += g;
    f += g * h.z;
  }
  gl_FragColor = vec4(mix(uHoopSig, uHoopWhite, clamp(f / max(c, 1e-4), 0.0, 1.0)) * c, 1.0);
}`;
}

const POS_VERT = /* glsl */ `varying vec3 vPos; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

export class Channel implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 400);
  private ring: SpecRing;
  private flight: Flight;
  private cruise: number;
  private rowZ = new Float32Array(ROWS);
  private rowTex: THREE.DataTexture;
  private u: Record<string, THREE.IUniform>;
  private hoopU = Array.from({ length: HOOPS }, () => new THREE.Vector3());
  private hoopTube: THREE.Mesh;
  private kicks: Float64Array;
  private kickV: Float64Array;
  private blocks: LyricBlocks;
  /** Lines stand down the tube a little above its axis, left and right by turns. */
  private stands = new Stands([[-0.1, 0.08], [0.1, 0]]);
  private readonly soft: boolean;
  private height = 1080;
  private baseFov = 70;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    const { palette, music } = init;
    this.scene.background = palette.ink.clone().multiplyScalar(0.06);
    this.ring = new SpecRing(Spectrogram.of(init.stereo, music.duration + 8, NB, 30), RING, init.music.a.timbre);
    this.flight = new Flight(music, this.soft);
    this.cruise = 7 * (clamp01(((music.a.bpm || 120) - 60) / 120) * 0.5 + 0.75);
    this.rowTex = new THREE.DataTexture(this.rowZ, ROWS, 1, THREE.RedFormat, THREE.FloatType);
    this.rowTex.minFilter = this.rowTex.magFilter = THREE.NearestFilter;
    this.rowTex.needsUpdate = true;
    this.u = {
      tSpec: { value: this.ring.texture }, tRowZ: { value: this.rowTex }, uC0: { value: 0 }, uNow: { value: 0 }, uScale: { value: 1000 }, uGain: { value: 1 }, uTwist: { value: 0.02 }, uHoop: { value: this.hoopU }, uLeadDrop: { value: new THREE.Vector3() }, uSelective: { value: 0 },
      uToneLow: { value: u3(hue(palette.accent)) },
      uToneMid: { value: u3(hue(palette.signal)) },
      uToneHigh: { value: u3(hue(palette.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.3))) },
      uHoopWhite: { value: u3(hue(palette.paper.clone().lerp(new THREE.Color(1, 1, 1), 0.5))) },
      uHoopSig: { value: u3(hue(palette.signal)) },
    };

    const cells = new Float32Array(AROUND * ROWS * 2);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < AROUND; i++) {
      const o = (j * AROUND + i) * 2;
      cells[o] = ((i + 0.5 * (j % 2)) / AROUND) * Math.PI * 2;
      cells[o + 1] = j;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('cell', new THREE.BufferAttribute(cells, 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AROUND * ROWS * 3), 3));
    const points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: vert(palette), fragmentShader: DOT_FRAG, uniforms: this.u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    points.frustumCulled = false;

    // The hoops: an open cylinder just inside the tube's wall, lit only where a hoop is.
    this.hoopTube = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 1, 96, 1, true).rotateX(Math.PI / 2),
      new THREE.ShaderMaterial({ vertexShader: POS_VERT, fragmentShader: hoopFrag(palette), uniforms: this.u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.hoopTube.frustumCulled = false;
    this.scene.add(points, this.hoopTube);

    // Keep the kick's light rhythm bed where bass is alone; a bright simultaneous lead owns the foreground event.
    const rawK = music.selectiveAt(0)
      ? music.roleHits('bassStab', 0, music.duration).filter(h => h[1] > 0.45)
      : music.a.hits.kick.filter(h => h[1] > 0.45);
    const melodyStabs = music.highlightHits(0,music.duration)
      .filter(h => h[1] > 0.35 && (music.selectiveAt(h[0]) || !rawK.some(k => Math.abs(k[0] - h[0]) < 0.08)));
    const allCandidates = [...rawK.map(k => [k[0], k[1]*(music.selectiveAt(k[0])?.16:1)] as [number, number]), ...melodyStabs.map(s => [s[0], s[1] * (music.selectiveAt(s[0])?1:.85)] as [number, number])]
      .sort((a, b) => a[0] - b[0]);
    const mergedHits: [number, number][] = [];
    for (const h of allCandidates) {
      const prev = mergedHits[mergedHits.length - 1];
      if (!prev || h[0] - prev[0] > 0.06) mergedHits.push(h);
      else if (h[1] > prev[1]) mergedHits[mergedHits.length - 1] = h;
    }
    this.kicks = Float64Array.from(mergedHits, h => h[0]);
    this.kickV = Float64Array.from(mergedHits, h => h[1]);

    this.blocks = new LyricBlocks(palette, music, { voice: voiceFor(look, init.seed), em: 0.95, maxW: this.soft ? 11 : 13, trans: 0.48, dust: [0, 1.2, 0] });
    this.scene.add(this.blocks.group);
    this.scene.onBeforeRender = renderer => { this.height = renderer.getDrawingBufferSize(new THREE.Vector2()).y; };
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.blocks.setAspect(aspect);
  }

  keepUp(t: number): void {
    this.ring.spec.prefetch(t, 0.8);
  }

  /** World z at song time t (flying towards −z). */
  private z(t: number): number { return -this.flight.at(t) * this.cruise; }

  private evalPose(t: number, shot: Shot, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const random = rng(stableShotSeed(shot));
    const side = random() < 0.5 ? -1 : 1, phase = random() * 6.28;
    const z = this.z(t - LEAD);
    let x = Math.sin(t * 0.37 + phase) * 0.25, y = Math.sin(t * 0.29 + phase * 2) * 0.2, roll = 0;
    if (shot.variant === 'wall') { x = side * R * 0.5; y = -R * 0.12; }
    else if (shot.variant === 'roll') roll = side * this.flight.at(t) * 0.05;
    poseLookAt(pos, quat, x, y, z, x * 0.3, y * 0.3, z - 20);
    const zRot = roll + 0.08 * Math.sin(t * 0.21 + phase);
    const half = zRot * 0.5;
    quat.multiply(new THREE.Quaternion(0, 0, Math.sin(half), Math.cos(half)));
  }

  update(ctx: FrameCtx): void {
    const { t, shot } = ctx;
    const rawPose = (tau: number, s: Shot, pp: THREE.Vector3, qq: THREE.Quaternion) => this.evalPose(tau, s, pp, qq);
    blendCameraPose(rawPose, t, shot, this.camera, 1.2);
    const now = t * COLS, step = COLS / RATE;
    const c0 = Math.floor(now / step) * step - BACK * COLS;
    this.ring.sync(c0 - 2, c0 + ROWS * step + 2);
    for (let j = 0; j < ROWS; j++) this.rowZ[j] = this.z((c0 + j * step) / COLS);
    this.rowTex.needsUpdate = true;
    this.u.uC0.value = c0;
    this.u.uNow.value = now;
    const sec = shot.section, loud = sec.label === 'chorus' || sec.label === 'drop';
    const lead = ctx.music.foregroundAt(t);
    this.u.uSelective.value=+ctx.music.selectiveAt(t);
    const gain = 0.65 + 0.35 * ctx.music.dropIntensity(t);
    (this.u.uLeadDrop.value as THREE.Vector3).set(gain * lead.level, gain * lead.attack, lead.brightness);
    this.u.uGain.value = (0.7 + 0.5 * clamp01(sec.energy ?? 0.5)) * (loud ? 1.15 : 1) * (1 + 0.32 * lead.level + 0.3 * lead.attack);
    this.u.uTwist.value = ((loud ? 0.03 : 0.015) + 0.045 * lead.level * (lead.brightness - 0.2)) * (this.soft ? 0.5 : 1);
    this.hoopTube.position.z = this.z(t);
    this.hoopTube.scale.set(1, 1, 400);

    // Hoops: the strong kicks of the next few seconds and the last one, white as they cross now.
    let m = 0;
    for (let i = Math.max(0, lastIndex(this.kicks, t - 0.6)); i < this.kicks.length && m < HOOPS; i++) {
      const dt = this.kicks[i] - t;
      if (dt > AHEAD - 0.5) break;
      const k = this.kickV[i] * (loud ? 1.2 : 0.7) * (this.soft ? 0.5 : 1);
      const flare = Math.exp(-Math.pow(dt / 0.08, 2));
      const strength = k * ctx.music.foregroundEventWeight(this.kicks[i], t) * (dt > 0 ? 0.35 + 0.65 * Math.exp(-dt * 1.2) : Math.exp(dt / 0.25)) * (1 + 1.5 * flare);
      this.hoopU[m++].set(this.z(this.kicks[i]), strength, flare);
    }
    for (let i = m; i < HOOPS; i++) this.hoopU[i].set(0, 0, 0);

    // Speed widens the lens and streaks the frame at the top end.
    const sp = this.flight.speedAt(t);
    const leadPunch = (sec.label === 'drop' ? 10 : 5) * lead.attack;
    const fov = this.baseFov + 18 * smooth((sp - 1.2) / 2) + leadPunch;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    // Focal scale belongs to this frame's lens, including a direct seek onto a melodic attack.
    this.u.uScale.value = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));

    // The words: each line one block standing down the tube, where the flight has it in view while it is sung, turned
    // to the camera as it rolls so it reads level (lyricBlock.ts); the camera flies through it as the next comes up.
    const at = (time: number, pp: THREE.Vector3, qq: THREE.Quaternion) => evalChainPose(rawPose, time, shot, pp, qq, 1.2);
    const view = { reach: 9, far: 17, fov: this.camera.fov, aspect: this.camera.aspect, em: this.soft ? 0.064 : 0.068, level: true };
    this.blocks.update(ctx.lyrics, t, sec.energy, (st, time, root, leave, size) => {
      const anchorStart = standShotStart(rawPose, shot, st.line.start - 0.15);
      const s = this.stands.get(anchorStart, st, leave, at, 0.95, view, size);
      s.apply(time, root);
      return smooth((s.depth(time) - 1.5) / 3);
    });

    ctx.fx.bloom = (this.soft ? 0.5 : loud ? 0.55 : 0.6) + (sec.label === 'drop' ? 0.22 : 0.08) * lead.attack;
    ctx.fx.ca = (sec.label === 'drop' ? 0.35 : 0.12) * lead.attack;
    ctx.fx.vignette = 0.55;
    ctx.fx.grain = 0.03;
    ctx.fx.zoom = Math.max(ctx.fx.zoom, 0.2 * smooth((sp - 1.6) / 2.2));
  }
}
