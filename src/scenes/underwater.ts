// Underwater Stone Pillars & Cross Rock Arch: Faithfully crafted based on Last Heroes' "Underneath The Waves".
// Natural stratified cliffs, colossal cross-channel rock bridges, mossy subaerial peaks, and deep ocean cavern lighting.
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { colorFromHsl, extractCoverTone, tuneCoverStop } from './coverTone.ts';

const sin = Math.sin;
const cos = Math.cos;
const DIVE_PLUNGE_SECONDS = 2.4;

/** A Drop enters at the full dive depth; ordinary shots keep the 2.4 s plunge. */
export function underwaterDiveEntryProgress(shotT: number, isDrop: boolean): number {
  return isDrop ? 1 : clamp01(shotT / DIVE_PLUNGE_SECONDS);
}

/**
 * Creates a watertight, finely stratified natural cliff monolith.
 * Uses analytical spatial harmonic fields so coincident seam/cap vertices
 * receive mathematically identical displacements, ensuring 0 seam separation.
 */
function createCliffGeometry(width: number, height: number, depth: number, taper: number, seed: number): THREE.BufferGeometry {
  const facets = 24;
  const heightSegments = 16;
  const geo = new THREE.CylinderGeometry(width * (1.0 - taper), width, height, facets, heightSegments, false);
  const pos = geo.attributes.position;

  // Deterministic seed phase offsets per cliff
  const phi1 = (seed % 100) * 0.0628;
  const phi2 = ((seed >> 2) % 100) * 0.0628;
  const phi3 = ((seed >> 4) % 100) * 0.0628;
  const phi4 = ((seed >> 6) % 100) * 0.0628;

  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    const z0 = pos.getZ(i);

    const theta = Math.atan2(z0, x0);
    const Y = y0 / height;

    // 1. Sharp-crested angular rock buttresses (piecewise-linear triangle harmonics for chiseled karst facets)
    const tri3 = Math.asin(sin(3.0 * theta + phi1)) * 0.63661977;
    const tri5 = Math.asin(sin(5.0 * theta + phi2)) * 0.63661977;
    const tri7 = Math.asin(cos(7.0 * theta + phi3)) * 0.63661977;
    const A = 1.0 + 0.18 * tri3 + 0.11 * tri5 + 0.06 * tri7;

    // 2. Oblique karst ledges & non-horizontal craggy facets (strongly warped by azimuth so no horizontal rings form)
    const layerH = 11.5;
    const yLayer = (y0 + height * 0.5) / layerH + phi4 + 0.45 * tri3 - 0.30 * tri5;
    const fracY = yLayer - Math.floor(yLayer);
    const shelfWave = 0.5 - 0.5 * cos(fracY * Math.PI * 2.0);
    const stepProfile = 0.96 + 0.07 * shelfWave + 0.03 * sin(fracY * Math.PI * 4.0);
    const L = stepProfile + 0.05 * cos(y0 * 0.38 + theta * 2.0 + phi2);

    // 3. Intersecting vertical & diagonal karst cleavage planes
    const C = 0.065 * Math.asin(cos(5.0 * theta + y0 * 0.18)) * sin(3.0 * theta - y0 * 0.14);

    // 4. Combined taper and radial displacement
    const R = (A * L + C) * (1.0 - taper * (Y + 0.5));

    const x = x0 * R;
    const z = z0 * R * (depth / width);
    const y = y0 + 0.42 * tri3 * cos(y0 * 0.22 + phi4);

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates a colossal, 100% closed and watertight cross-channel rock arch (0 open boundary edges).
 * Sculpted around a non-twisting geological arch spine with massive haunches and chiseled rock ledges.
 */
function createCrossRockArchGeometry(span: number, rise: number, thickness: number, width: number, seed: number): THREE.BufferGeometry {
  const radialSegments = 16;
  const tubularSegments = 40;
  const R0 = span * 0.5;
  const r0 = thickness * 0.5;
  const geo = new THREE.TorusGeometry(R0, r0, radialSegments, tubularSegments, Math.PI);

  const step = tubularSegments + 1;
  const pos = geo.attributes.position;
  const oldIndices = geo.index ? Array.from(geo.index.array) : [];
  const newPositions = Array.from(pos.array);
  const newIndices = [...oldIndices];

  // Seal terminal cut 1 at arc = 0 with circular cap fan
  const c1 = newPositions.length / 3;
  newPositions.push(R0, 0, 0);
  for (let j = 0; j < radialSegments; j++) {
    newIndices.push(c1, (j + 1) * step, j * step);
  }

  // Seal terminal cut 2 at arc = Math.PI with circular cap fan
  const c2 = newPositions.length / 3;
  newPositions.push(-R0, 0, 0);
  for (let j = 0; j < radialSegments; j++) {
    newIndices.push(c2, j * step + tubularSegments, (j + 1) * step + tubularSegments);
  }

  const cappedGeo = new THREE.BufferGeometry();
  cappedGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  cappedGeo.setIndex(newIndices);

  const cPos = cappedGeo.attributes.position;
  const phi1 = (seed % 100) * 0.0628;
  const phi2 = ((seed >> 3) % 100) * 0.0628;

  for (let i = 0; i < cPos.count; i++) {
    const x0 = cPos.getX(i);
    const y0 = cPos.getY(i);
    const z0 = cPos.getZ(i);

    const alpha = Math.atan2(y0, x0);
    const sinA = Math.max(0.0, sin(alpha));

    // Local cross-section offsets from the torus spine (cx, cy, 0)
    const cx = cos(alpha) * R0;
    const cy = sin(alpha) * R0;
    const dx = x0 - cx;
    const dy = y0 - cy;
    const dz = z0;

    // 1. Natural asymmetric geological arch spine (depends ONLY on alpha — zero corkscrew twisting!)
    const archAsym = 0.045 * sin(alpha * 2.0 + phi1) + 0.030 * cos(alpha * 3.0 + phi2);
    const spineCragY = 0.045 * cos(alpha * 5.0 + phi1) + 0.025 * sin(alpha * 9.0 + phi2) + 0.015 * cos(alpha * 13.0 + phi1);
    const footPlunge = -16.5 * Math.pow(1.0 - sinA, 3.0);
    const spineX = cx * (1.0 + archAsym);
    const spineY = cy * (rise / R0) * (0.96 - 0.08 * sinA * sinA + spineCragY) + footPlunge;
    const spineZ = 0.85 * sin(alpha * 2.0 + phi1) * sinA + 0.35 * cos(alpha * 5.0 + phi2) * sinA;

    // 2. Craggy stepped rock blocks & angular ledges on the cross-section (zero helical twist!)
    const yWorldApprox = spineY + dy;
    const triA5 = Math.asin(sin(alpha * 5.0 + phi1)) * 0.63661977;
    const triA9 = Math.asin(cos(alpha * 9.0 + phi2)) * 0.63661977;
    const triA13 = Math.asin(sin(alpha * 13.0 + phi1 * 1.5)) * 0.63661977;
    const stepLedge = sin(yWorldApprox * 0.75 + phi1) * 0.12 + cos(yWorldApprox * 1.45 + phi2) * 0.06;
    const blockFacet = 0.15 * triA5 + 0.11 * triA9 + 0.06 * triA13;

    // Massive haunches at the sides (sinA -> 0), rugged stone bridge at the crown (sinA -> 1)
    const haunch = 1.26 - 0.22 * sinA * sinA;
    const crossScale = haunch * (1.0 + stepLedge + blockFacet);

    // Smooth C0 plateau deck on top (uDy > 0) and craggy corbeled stone vault underneath (uDy < 0)
    const uDy = dy / r0;
    const topFlatten = uDy >= 0.0
      ? 1.0 + uDy * (-0.24 * sinA * sinA + 0.10 * triA5 - 0.06 * triA9)
      : 1.0 + (-uDy) * (0.06 + 0.18 * triA9 - 0.12 * triA5 + 0.10 * triA13);
    const zRib = 1.0 + 0.14 * triA5 + 0.09 * triA9 + 0.08 * sin(yWorldApprox * 0.65 + phi2);

    const x = spineX + dx * crossScale;
    const y = spineY + dy * crossScale * topFlatten;
    const z = spineZ + dz * (width / thickness) * crossScale * zRib;

    cPos.setXYZ(i, x, y, z);
  }

  cappedGeo.computeVertexNormals();
  return cappedGeo;
}

export class UnderwaterScene implements MvScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  // Scene geometry groups
  private domeMesh: THREE.Mesh;
  private waterPlane: THREE.Mesh;
  private seabedMesh: THREE.Mesh;
  private sceneryGroup: THREE.Group;
  private recyclableScenery: THREE.Object3D[] = [];
  private rockMaterials: THREE.ShaderMaterial[] = [];
  private causticRays: THREE.Mesh;
  private bubbleMesh: THREE.InstancedMesh;
  private marineSnowMesh: THREE.InstancedMesh;

  // Lyrics rig
  private rig: LyricRig;

  // Shader Uniforms
  private waterUniforms: {
    uTime: { value: number };
    uCamPos: { value: THREE.Vector3 };
    uColorWater: { value: THREE.Color };
    uColorSky: { value: THREE.Color };
    uDeepColor: { value: THREE.Color };
  };

  private rockUniforms: {
    uTime: { value: number };
    uCamPos: { value: THREE.Vector3 };
    uLeadLevel: { value: number };
    uLeadAttack: { value: number };
    uBassPulse: { value: number };
    uRockDark: { value: THREE.Color };
    uRockMid: { value: THREE.Color };
    uRockLight: { value: THREE.Color };
    uVeinGlow: { value: THREE.Color };
    uFloraColor: { value: THREE.Color };
    uDeepFog: { value: THREE.Color };
    uSky: { value: THREE.Color };
    uUpperSea: { value: THREE.Color };
    uAbyss: { value: THREE.Color };
    uAmbLow: { value: THREE.Color };
    uAmbHigh: { value: THREE.Color };
    uDirectSun: { value: THREE.Color };
    uUnderBounce: { value: THREE.Color };
    uCausticTint: { value: THREE.Color };
    uVeinTint: { value: THREE.Color };
    uRimGlow: { value: THREE.Color };
  };

  private rayUniforms: {
    uTime: { value: number };
    uRayColor: { value: THREE.Color };
    uRayAccent: { value: THREE.Color };
    uEnergy: { value: number };
  };

  private bubbleUniforms: {
    uTime: { value: number };
    uCamPos: { value: THREE.Vector3 };
    uBurst: { value: number };
    uBubbleColor: { value: THREE.Color };
    uBubbleSky: { value: THREE.Color };
    uBubbleRefract: { value: THREE.Color };
    uBubbleDeep: { value: THREE.Color };
  };

  private snowUniforms: {
    uTime: { value: number };
    uCamPos: { value: THREE.Vector3 };
    uColor: { value: THREE.Color };
  };

  private jellyMesh!: THREE.InstancedMesh;
  private jellyUniforms!: {
    uTime: { value: number };
    uCamPos: { value: THREE.Vector3 };
    uLeadLevel: { value: number };
    uBassPulse: { value: number };
    uJellyCyan: { value: THREE.Color };
    uJellyAqua: { value: THREE.Color };
    uJellyRim: { value: THREE.Color };
    uJellyCanal: { value: THREE.Color };
  };

  private plumeMesh!: THREE.InstancedMesh;
  private plumeUniforms!: {
    uTime: { value: number };
    uCamPos: { value: THREE.Vector3 };
    uLeadLevel: { value: number };
    uBassPulse: { value: number };
    uPlumeLow: { value: THREE.Color };
    uPlumeHigh: { value: THREE.Color };
  };

  private look: 'pulse' | 'ballad';

  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.look = look;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, init.aspect, 0.2, 800);

    const palette = init.palette;
    const tone = extractCoverTone(init);

    // 暖色/粉色系封面（如 Closer LIONE Remix 的粉色封面）在低明度下需适度提亮并保持柔和粉彩饱和度，
    // 从而呈现通透纯粹的「粉色深海石柱」而非暗红/褐红；深蓝/冷色系封面则保持深海幽蓝质感。
    const warmth = 0.5 - 0.5 * Math.cos(((tone.mainHue - 198) * Math.PI) / 180);
    const lLift = warmth * 0.14;
    const mk = (stop: typeof tone.mid, minL: number, maxL: number, minS: number, maxS: number, bias = 0) => {
      const c = tuneCoverStop(stop, tone, minL + lLift, maxL + lLift, minS, maxS, bias);
      return colorFromHsl(c.h, c.s, c.l);
    };
    const mkLight = (hDeg: number, s: number, l: number) => colorFromHsl(hDeg, tone.mono ? 0.03 : s, l);

    // 根据专辑封面色调动态生成的深海、水面、天穹与石柱色板
    const deepOceanBlue = mk(tone.dark, 0.12, 0.24, 0.42, 0.62, -4);
    const oceanWaterCyan = mk(tone.mid, 0.26, 0.44, 0.48, 0.72, 0);
    const sunSkyLight = mk(tone.bright, 0.40, 0.60, 0.52, 0.78, 4);
    const domeSky = mk(tone.mid, 0.30, 0.48, 0.50, 0.74, 2);
    const domeUpperSea = mk(tone.midDark, 0.19, 0.34, 0.46, 0.68, -2);
    const domeAbyss = mk(tone.dark, 0.07, 0.15, 0.40, 0.58, -7);
    const seabedFloorCol = mk(tone.dark, 0.13, 0.25, 0.42, 0.62, -5);

    // 喀斯特石柱、横跨石桥与能量光脉色板（与封面色调完全一致）
    const rockDark = mk(tone.dark, 0.10, 0.20, 0.38, 0.58, -5);
    const rockMid = mk(tone.midDark, 0.22, 0.38, 0.44, 0.66, 0);
    const rockLight = mk(tone.mid, 0.35, 0.54, 0.48, 0.74, 3);
    const veinGlowCyan = mk(tone.bright, 0.42, 0.64, 0.56, 0.84, 5);
    const floraGreen = mk(tone.mid, 0.30, 0.46, 0.40, 0.64, 14);

    // 石柱 3D 照明与焦散/光脉高光（采用低饱和柔和封面色光，避免与 stoneBase 相乘后色彩发暗偏红）
    const ambLowCol = mkLight(tone.deepHue, 0.24, 0.54 + warmth * 0.08);
    const ambHighCol = mkLight(tone.mainHue, 0.26, 0.74 + warmth * 0.06);
    const directSunCol = mkLight(tone.highHue, 0.28, 0.86 + warmth * 0.04);
    const underBounceCol = mkLight(tone.mainHue, 0.28, 0.66 + warmth * 0.06);
    const causticTintCol = mk(tone.bright, 0.54, 0.72, 0.56, 0.84, 4);
    const veinTintCol = mk(tone.highlight, 0.60, 0.78, 0.60, 0.88, 6);
    const rimGlowCol = mk(tone.bright, 0.54, 0.72, 0.55, 0.82, 3);
    const waterfallCol = mk(tone.highlight, 0.72, 0.84, 0.50, 0.78, 6);
    const rayAccentCol = mk(tone.bright, 0.58, 0.74, 0.58, 0.86, 4);

    // 水母、热液雾幔、气泡与海雪微粒的封面同色系发光色板
    const jellyCyanCol = mk(tone.bright, 0.60, 0.76, 0.62, 0.88, 5);
    const jellyAquaCol = mk(tone.mid, 0.50, 0.66, 0.58, 0.84, -4);
    const jellyRimCol = mk(tone.midDark, 0.56, 0.72, 0.56, 0.84, -22);
    const jellyCanalCol = mk(tone.highlight, 0.72, 0.86, 0.60, 0.88, 8);
    const plumeLowCol = mk(tone.midDark, 0.46, 0.62, 0.52, 0.78, 0);
    const plumeHighCol = mk(tone.bright, 0.60, 0.74, 0.58, 0.84, 4);
    const bubbleSkyCol = mkLight(tone.highHue, 0.42, 0.96);
    const bubbleRefractCol = mk(tone.bright, 0.60, 0.76, 0.58, 0.86, 3);
    const bubbleDeepCol = mk(tone.dark, 0.16, 0.26, 0.42, 0.64, -6);
    const snowCol = mk(tone.highlight, 0.78, 0.90, 0.52, 0.82, 6);

    this.scene.background = deepOceanBlue;
    this.scene.fog = new THREE.FogExp2(deepOceanBlue.getHex(), 0.0020);

    this.waterUniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uColorWater: { value: oceanWaterCyan },
      uColorSky: { value: sunSkyLight },
      uDeepColor: { value: deepOceanBlue },
    };

    // Distant abyssal ocean dome backdrop centered on camera with vertical depth gradient matching the cover
    const domeGeo = new THREE.SphereGeometry(380, 24, 16);
    const domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uCamPos: this.waterUniforms.uCamPos,
        uSky: { value: domeSky },
        uUpperSea: { value: domeUpperSea },
        uAbyss: { value: domeAbyss },
      },
      vertexShader: `varying vec3 vWorldPos; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uCamPos;
        uniform vec3 uSky;
        uniform vec3 uUpperSea;
        uniform vec3 uAbyss;
        varying vec3 vWorldPos;
        vec3 computeBackdropColor(vec3 viewRay, float camY) {
          float y = camY + viewRay.y * 380.0;
          vec3 col = mix(uAbyss, uUpperSea, smoothstep(-140.0, 10.0, y));
          col = mix(col, uSky, smoothstep(-5.0, 95.0, y));
          return col;
        }
        void main() {
          vec3 viewRay = normalize(vWorldPos - uCamPos);
          gl_FragColor = vec4(computeBackdropColor(viewRay, uCamPos.y), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.domeMesh = new THREE.Mesh(domeGeo, domeMat);
    this.domeMesh.frustumCulled = false;
    this.scene.add(this.domeMesh);

    // =========================================================================
    // 1. Water Surface (y = 0)
    // =========================================================================
    const waterGeo = new THREE.PlaneGeometry(500, 680, 96, 96);
    waterGeo.rotateX(-Math.PI / 2);

    const waterMat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          vec3 pos = position;
          float w1 = sin(pos.x * 0.08 + uTime * 2.0) * cos(pos.z * 0.07 + uTime * 1.6) * 0.45;
          float w2 = sin((pos.x + pos.z) * 0.18 - uTime * 2.6) * 0.20;
          pos.y += w1 + w2;

          vec4 wp = modelMatrix * vec4(pos, 1.0);
          vWorldPos = wp.xyz;

          vec3 n = normalize(vec3(-cos(pos.x * 0.08 + uTime * 2.0) * 0.09, 1.0, -sin(pos.z * 0.07 + uTime * 1.6) * 0.09));
          vNormal = normalize(mat3(modelMatrix) * n);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCamPos;
        uniform vec3 uColorWater;
        uniform vec3 uColorSky;
        uniform vec3 uDeepColor;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          bool isUnder = uCamPos.y < 0.0;
          vec3 viewDir = normalize(uCamPos - vWorldPos);
          vec3 n = isUnder ? -vNormal : vNormal;

          float ndv = clamp(dot(viewDir, n), 0.0, 1.0);
          float fresnel = pow(1.0 - ndv, 3.2);
          float radialDist = length(vWorldPos.xz - uCamPos.xz);
          float edgeFade = 1.0 - smoothstep(52.0, 92.0, radialDist);

          vec3 col;
          float alpha;
          if (isUnder) {
            // Subtle overhead Snell skylight dome high above all canyon arches - never slices rock geometry
            float snellWindow = smoothstep(0.46, 0.95, ndv);
            vec3 skyGlow = mix(uColorWater * 1.15, uColorSky * 1.12, smoothstep(0.55, 0.95, ndv));
            col = mix(uDeepColor, skyGlow, snellWindow);
            alpha = snellWindow * edgeFade * 0.18;
          } else {
            // Looking at water surface from above: deep teal-cyan water with bright horizon reflection
            col = mix(uDeepColor * 0.95, uColorWater * 0.92, 0.45 + 0.55 * fresnel);
            col = mix(col, uColorSky * 0.95, fresnel * 0.65);
            float surfaceHorizonFade = 1.0 - smoothstep(140.0, 260.0, radialDist);
            alpha = clamp(0.82 + fresnel * 0.14, 0.0, 0.96) * surfaceHorizonFade;
          }

          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.waterPlane = new THREE.Mesh(waterGeo, waterMat);
    this.waterPlane.position.set(0, 24.0, 0);
    this.waterPlane.renderOrder = -1;
    this.waterPlane.frustumCulled = false;
    this.scene.add(this.waterPlane);

    // =========================================================================
    // 2. Seabed Ocean Floor (y = -38)
    // =========================================================================
    const seabedGeo = new THREE.PlaneGeometry(500, 680, 48, 48);
    seabedGeo.rotateX(-Math.PI / 2);
    const sPos = seabedGeo.attributes.position;
    const sR = rng(0x3519);
    for (let i = 0; i < sPos.count; i++) {
      const x = sPos.getX(i);
      const z = sPos.getZ(i);
      sPos.setY(i, (sR() - 0.5) * 3.5 + sin(x * 0.04) * 3.0 + cos(z * 0.04) * 3.5);
    }
    seabedGeo.computeVertexNormals();

    const seabedMat = new THREE.ShaderMaterial({
      uniforms: {
        uCamPos: this.waterUniforms.uCamPos,
        uFloorColor: { value: seabedFloorCol },
        uSky: { value: domeSky },
        uUpperSea: { value: domeUpperSea },
        uAbyss: { value: domeAbyss },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uCamPos;
        uniform vec3 uFloorColor;
        uniform vec3 uSky;
        uniform vec3 uUpperSea;
        uniform vec3 uAbyss;
        varying vec3 vWorldPos;
        vec3 computeBackdropColor(vec3 viewRay, float camY) {
          float y = camY + viewRay.y * 380.0;
          vec3 col = mix(uAbyss, uUpperSea, smoothstep(-140.0, 10.0, y));
          col = mix(col, uSky, smoothstep(-5.0, 95.0, y));
          return col;
        }
        void main() {
          vec3 toFrag = vWorldPos - uCamPos;
          float dist = length(toFrag);
          if (dist >= 99.0) discard;
          vec3 viewRay = toFrag / max(dist, 1e-4);
          vec3 bgCol = computeBackdropColor(viewRay, uCamPos.y);
          vec3 floorCol = uFloorColor * (0.90 + 0.20 * sin(vWorldPos.x * 0.14) * cos(vWorldPos.z * 0.14));
          float fog = smoothstep(54.0, 95.0, dist);
          gl_FragColor = vec4(mix(floorCol, bgCol, fog), 1.0);
        }
      `,
    });
    this.seabedMesh = new THREE.Mesh(seabedGeo, seabedMat);
    this.seabedMesh.position.set(0, -38, 0);
    this.seabedMesh.frustumCulled = false;
    this.scene.add(this.seabedMesh);

    // =========================================================================
    // 3. Natural Stratified Cliffs, Cross Rock Arches & Submerged Ruins
    // =========================================================================
    this.sceneryGroup = new THREE.Group();
    this.rockUniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uLeadLevel: { value: 0 },
      uLeadAttack: { value: 0 },
      uBassPulse: { value: 0 },
      uRockDark: { value: rockDark },
      uRockMid: { value: rockMid },
      uRockLight: { value: rockLight },
      uVeinGlow: { value: veinGlowCyan },
      uFloraColor: { value: floraGreen },
      uDeepFog: { value: deepOceanBlue },
      uSky: { value: domeSky },
      uUpperSea: { value: domeUpperSea },
      uAbyss: { value: domeAbyss },
      uAmbLow: { value: ambLowCol },
      uAmbHigh: { value: ambHighCol },
      uDirectSun: { value: directSunCol },
      uUnderBounce: { value: underBounceCol },
      uCausticTint: { value: causticTintCol },
      uVeinTint: { value: veinTintCol },
      uRimGlow: { value: rimGlowCol },
    };

    const rockShaderMat = new THREE.ShaderMaterial({
      uniforms: this.rockUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform float uLeadLevel;
        uniform float uLeadAttack;
        uniform float uBassPulse;
        uniform vec3 uRockDark;
        uniform vec3 uRockMid;
        uniform vec3 uRockLight;
        uniform vec3 uVeinGlow;
        uniform vec3 uFloraColor;
        uniform vec3 uDeepFog;
        uniform vec3 uSky;
        uniform vec3 uUpperSea;
        uniform vec3 uAbyss;
        uniform vec3 uAmbLow;
        uniform vec3 uAmbHigh;
        uniform vec3 uDirectSun;
        uniform vec3 uUnderBounce;
        uniform vec3 uCausticTint;
        uniform vec3 uVeinTint;
        uniform vec3 uRimGlow;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vUv;

        vec3 computeBackdropColor(vec3 viewRay, float camY) {
          float y = camY + viewRay.y * 380.0;
          vec3 col = mix(uAbyss, uUpperSea, smoothstep(-140.0, 10.0, y));
          col = mix(col, uSky, smoothstep(-5.0, 95.0, y));
          return col;
        }

        // 3D Hash & Value Noise for natural fractured rock grain and irregular geological structure
        float hash31(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float noise3D(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), u.x),
                mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
            mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), u.x),
                mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
            u.z
          );
        }

        float fbm3D(vec3 p) {
          float v = 0.0;
          v += 0.520 * noise3D(p); p = p * 2.07 + vec3(11.3, 7.1, 5.9);
          v += 0.260 * noise3D(p); p = p * 2.13 + vec3(3.7, 17.9, 13.1);
          v += 0.130 * noise3D(p); p = p * 2.03 + vec3(8.9, 4.3, 19.7);
          v += 0.065 * noise3D(p);
          return v;
        }

        // Multi-scale 3D karst block jointing, solution pockets & fault-displaced rock relief (zero horizontal zebra rings)
        float rockStratification(vec3 wp, out float ledgeTop, out float creviceDark, out float blockJoints) {
          float faultZone = fbm3D(wp * vec3(0.08, 0.05, 0.08) + vec3(2.1, 5.4, 8.3));
          float faultShift = (faultZone - 0.5) * 14.0 + (fbm3D(wp * 0.14) - 0.5) * 9.5;
          float yWarped = wp.y + faultShift + (wp.x - wp.z) * 0.35;

          // Strong 3D cellular masks break up any horizontal continuity into interlocking karst rock blocks
          float mask1 = smoothstep(0.22, 0.78, noise3D(wp * vec3(0.14, 0.11, 0.14) + vec3(1.3, 7.1, 4.6)));
          float mask2 = smoothstep(0.22, 0.78, noise3D(wp * vec3(0.24, 0.18, 0.24) + vec3(6.8, 2.4, 9.1)));

          // Oblique warped bedding planes (subordinate to 3D block cleavage)
          float s1 = sin(yWarped * 0.38 + noise3D(wp * 0.18) * 4.6) * 0.5 + 0.5;
          float s2 = sin(yWarped * 0.89 + noise3D(wp * 0.38 + 4.1) * 5.2) * 0.5 + 0.5;
          float strata = mix(s1, s2, mask1) * (0.35 + 0.65 * mask2);

          // Dominant 3D karst cleavage joints & vertical solution flutes slicing rock into craggy polyhedral blocks
          vec3 jp = wp + (vec3(faultZone, mask1, mask2) - 0.5) * 7.5;
          float vj1 = 1.0 - abs(noise3D(jp * vec3(0.22, 0.10, 0.22)) * 2.0 - 1.0);
          float vj2 = 1.0 - abs(noise3D(jp * vec3(0.48, 0.22, 0.48) + vec3(4.7, 1.9, 6.2)) * 2.0 - 1.0);
          float vj3 = 1.0 - abs(noise3D(wp * vec3(0.95, 0.55, 0.95) + faultZone * 2.5) * 2.0 - 1.0);
          blockJoints = vj1 * 0.50 + vj2 * 0.34 + vj3 * 0.16;

          float steppedBed = smoothstep(0.22, 0.78, strata);
          ledgeTop = smoothstep(0.48, 0.86, blockJoints) * (0.45 + 0.55 * steppedBed) * (0.35 + 0.65 * mask1);
          creviceDark = smoothstep(0.16, 0.68, blockJoints) * (0.42 + 0.58 * steppedBed);

          float micro = noise3D(wp * 2.4) * 0.16 + noise3D(wp * 5.6) * 0.08;
          return blockJoints * 0.54 + steppedBed * 0.28 + micro;
        }

        float rockRelief(vec3 wp) {
          float lTop, cDark, bJoints;
          return rockStratification(wp, lTop, cDark, bJoints);
        }

        void main() {
          // Early distance cull well inside minimum wrap distance (106.79) after 100% backdrop convergence at dist = 96
          vec3 toFrag = vWorldPos - uCamPos;
          float dist = length(toFrag);
          if (dist >= 99.0) discard;

          // 1. Smooth interpolated vertex normal as continuous base so low-poly mesh triangles never show through
          vec3 geomN = normalize(vNormal);

          // 2. High-detail 3D finite-difference procedural rock normal (sculpted shelves, oblique faults & stone grain)
          float eps = 0.16;
          float shelfTopMask, creviceMask, blockJoints;
          float h0 = rockStratification(vWorldPos, shelfTopMask, creviceMask, blockJoints);
          float hx = rockRelief(vWorldPos + vec3(eps, 0.0, 0.0));
          float hy = rockRelief(vWorldPos + vec3(0.0, eps, 0.0));
          float hz = rockRelief(vWorldPos + vec3(0.0, 0.0, eps));
          vec3 reliefGrad = vec3(hx - h0, hy - h0, hz - h0) / eps;
          vec3 N = normalize(geomN - reliefGrad * 0.76);

          // 3. Karst stone albedo driven by album cover palette (uRockDark -> uRockMid -> uRockLight)
          float macroWarp = fbm3D(vWorldPos * 0.09);
          float detailNoise = fbm3D(vWorldPos * 0.42 + vec3(4.2, 1.7, 8.5));
          float fineGrain = fbm3D(vWorldPos * 1.85 + vec3(9.1, 3.4, 6.2));

          vec3 stoneBase = mix(uRockDark * 0.88, uRockMid * 1.18, creviceMask * (0.42 + 0.58 * detailNoise));
          float upLedge = smoothstep(0.06, 0.65, N.y) * 0.72 + smoothstep(0.55, 0.88, blockJoints) * 0.28;
          stoneBase = mix(stoneBase, uRockLight * 1.10, shelfTopMask * upLedge * 0.72);
          stoneBase *= (0.80 + 0.44 * fineGrain);

          // 4. Lighting: Cover-toned water transmission + 3D seabed bounce light
          vec3 viewDir = -toFrag / max(dist, 1e-4);
          vec3 lightDir = normalize(vec3(0.22, 0.92, -0.30));
          vec3 bounceDir = normalize(vec3(-0.28, -0.78, -0.56));
          float NdotL = max(dot(N, lightDir), 0.0);
          float NdotBounce = max(dot(N, bounceDir), 0.0);
          float viewRelief = max(dot(N, viewDir), 0.0);
          float upwardExpose = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
          float creviceAO = clamp(0.30 + 0.70 * creviceMask * (0.42 + 0.58 * detailNoise) * (0.58 + 0.42 * smoothstep(-0.85, 0.45, N.y)), 0.28, 1.0);

          float depthAtten = clamp((vWorldPos.y + 42.0) / 44.0, 0.56, 1.0);
          vec3 ambientSea = mix(uAmbLow, uAmbHigh, upwardExpose) * depthAtten;
          vec3 directSun = uDirectSun * NdotL * (0.60 + 0.40 * depthAtten);
          vec3 underBounce = uUnderBounce * (NdotBounce * 0.68 + viewRelief * 0.32) * (0.44 + 0.56 * shelfTopMask) * depthAtten;

          vec3 rockColor = stoneBase * (ambientSea + directSun + underBounce) * creviceAO;

          // 5. Subaerial Island Cliff & Arch Appearance (natural weathered coastal stone + feathered vegetation in cover tone)
          float camSurfaceView = smoothstep(-4.5, 0.5, uCamPos.y);
          float isAboveWater = smoothstep(-0.4, 1.4, vWorldPos.y) * camSurfaceView;
          if (isAboveWater > 0.01) {
            float wetShore = smoothstep(2.4, -0.2, vWorldPos.y + (detailNoise - 0.5) * 1.2);
            vec3 dryCliffStone = mix(uRockDark * 1.35, uRockMid * 1.45, creviceMask * (0.42 + 0.58 * detailNoise));
            dryCliffStone = mix(dryCliffStone, uRockLight * 1.35, shelfTopMask * fineGrain * 0.48);
            dryCliffStone *= (0.75 + 0.48 * fineGrain);
            vec3 coastalStone = mix(dryCliffStone, uRockDark * 0.75, wetShore * 0.72);
            vec3 subaerialLit = coastalStone * (uAmbHigh * 0.75 + uDirectSun * 0.90 * NdotL) * creviceAO;

            // Soft, organic vegetation mask driven jointly by elevation, smooth normal slope, and multi-scale 3D noise
            float elevMask = smoothstep(0.5, 4.5, vWorldPos.y + (macroWarp - 0.5) * 2.8 + (detailNoise - 0.5) * 1.4);
            float slopeVal = geomN.y * 0.52 + N.y * 0.48 + (detailNoise - 0.5) * 0.38 + (fineGrain - 0.5) * 0.22;
            float slopeMask = smoothstep(0.02, 0.60, slopeVal);
            float clumpNoise = fbm3D(vWorldPos * 0.92 + vec3(2.3, 6.1, 4.4)) * 0.62
                             + noise3D(vWorldPos * 2.85 + vec3(7.1, 1.3, 5.9)) * 0.38;

            float mossFringe = elevMask * smoothstep(-0.05, 0.48, slopeVal) * smoothstep(0.18, 0.66, clumpNoise);
            float shrubCanopy = elevMask * slopeMask * smoothstep(0.30, 0.76, clumpNoise + slopeMask * 0.26);

            float leafMicro = noise3D(vWorldPos * 4.8) * 0.6 + noise3D(vWorldPos * 9.5) * 0.4;
            vec3 mossTone = mix(uFloraColor * 0.65, uFloraColor * 1.05, detailNoise * 0.7 + leafMicro * 0.3);
            vec3 shrubTone = mix(uFloraColor * 0.80, uFloraColor * 1.25, clamp(detailNoise * 0.55 + leafMicro * 0.45, 0.0, 1.0));
            shrubTone = mix(shrubTone, uVeinGlow * 1.10, smoothstep(0.55, 0.88, leafMicro * upwardExpose));

            float vegLit = (0.38 + 0.74 * NdotL) * (0.65 + 0.35 * creviceAO) * (0.82 + 0.36 * leafMicro);
            vec3 aboveCol = mix(subaerialLit, mossTone * vegLit, mossFringe * 0.80);
            aboveCol = mix(aboveCol, shrubTone * vegLit, shrubCanopy * 0.92);
            rockColor = mix(rockColor, aboveCol, isAboveWater);
          }

          // 6. Cover-Toned Caustic Light Web & Karst Fissure Luminescence
          float isUnderwater = 1.0 - isAboveWater;
          if (isUnderwater > 0.01) {
            float topShelf = smoothstep(0.14, 0.68, N.y);
            float underVault = smoothstep(-0.08, -0.72, N.y) * 0.45;
            vec2 cUv1 = vWorldPos.xz * 0.34 + vec2(uTime * 0.75, -uTime * 0.55);
            vec2 cUv2 = vWorldPos.xz * 0.46 - vec2(uTime * 0.50, uTime * 0.80);
            float cVal = abs(sin(cUv1.x + cos(cUv1.y * 1.2)) * cos(cUv2.y + sin(cUv2.x * 1.2)));
            float causticNet = pow(clamp(1.0 - cVal, 0.0, 1.0), 3.0);

            float energyGlow = 0.36 + uLeadLevel * 1.02 + uBassPulse * 0.50;
            vec3 causticLight = mix(uCausticTint, uRockLight * 1.18, 0.42) * causticNet * (topShelf + underVault) * energyGlow;

            float shelfEdgeGlow = shelfTopMask * (0.35 + 0.65 * upwardExpose) * (0.45 + 0.55 * fineGrain);
            float veinWave = clamp(sin(vWorldPos.y * 0.48 - uTime * 3.2 + macroWarp * 6.28318) * 0.5 + 0.5, 0.0001, 1.0);
            float fractureLine = smoothstep(0.16, 0.015, abs(detailNoise - 0.48)) * smoothstep(0.32, 0.78, fineGrain);
            float upwardSurge = pow(veinWave, 2.2) * fractureLine;
            float veinActive = (0.14 + uLeadLevel * 0.90 + uBassPulse * 0.55) * smoothstep(-38.0, 4.0, vWorldPos.y);
            vec3 veinTone = mix(uRockLight, uVeinTint, 0.45 + 0.25 * sin(vWorldPos.y * 0.24 - uTime * 1.8));
            vec3 veinLight = veinTone * (shelfEdgeGlow * 0.46 + upwardSurge * 0.68) * veinActive;

            rockColor += (causticLight + veinLight) * isUnderwater * creviceAO;
          }

          // 7. Cover-Toned grazing rim light separating overlapping karst pillars in depth
          float rim = pow(clamp(1.0 - max(dot(viewDir, N), 0.0), 0.0001, 1.0), 2.5);
          rockColor += uRimGlow * rim * (0.38 + uLeadLevel * 0.40) * isUnderwater * creviceAO;

          // 8. High-clarity deep sea visibility: crisp multi-layer karst labyrinth up to dist = 75+, seamless convergence at dist = 96
          vec3 viewRay = -viewDir;
          vec3 exactBackdrop = computeBackdropColor(viewRay, uCamPos.y);
          vec3 targetFog = mix(uDeepFog * 0.95, exactBackdrop, 0.55);
          float midFogFactor = smoothstep(48.0, 86.0, dist) * (1.0 - isAboveWater * 0.72);
          vec3 finalColor = mix(rockColor, targetFog, midFogFactor * 0.34);
          float farBackdropFade = smoothstep(74.0, 96.0, dist);
          finalColor = mix(finalColor, exactBackdrop, farBackdropFade);

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
    });
    this.rockMaterials.push(rockShaderMat);

    // Build repeating grand canyon scenery module with period L = 240
    const seedRng = rng((init.seed ?? 0) ^ 0x7c49);

    // Helper to register recyclable scenery object
    const registerScenery = (mesh: THREE.Object3D, z: number) => {
      mesh.position.z = z;
      mesh.userData.baseZ = z;
      mesh.frustumCulled = false;
      this.sceneryGroup.add(mesh);
      this.recyclableScenery.push(mesh);
    };

    // (A) Asymmetric Karst Natural Bridges & Intersecting Cavern Roof Vaults
    // Shifted laterally and rotated at criss-crossing angles so the ceiling looks like a natural karst cavern dome
    const archConfigs = [
      // [az, ax, ay, yaw, roll, span, rise, thick, width]
      [-60, 2.5, -22.5, 0.24, -0.055, 68, 28, 7.0, 10.0],
      [-50, -1.5, -17.5, -0.34, 0.045, 70, 26, 6.4, 9.0],
      [0, 0.0, -18.5, -0.26, 0.050, 68, 27, 6.8, 9.5],
      [60, -2.0, -21.0, -0.20, 0.055, 68, 28, 7.0, 10.0],
      [70, 2.0, -17.5, 0.34, -0.045, 70, 26, 6.4, 9.0],
      [120, -2.5, -22.5, 0.22, -0.050, 68, 28, 7.0, 10.0],
    ];
    for (let i = 0; i < archConfigs.length; i++) {
      const cfg = archConfigs[i];
      const az = cfg[0], ax = cfg[1], ay = cfg[2], yaw = cfg[3], roll = cfg[4];
      const archGeo = createCrossRockArchGeometry(cfg[5], cfg[6], cfg[7], cfg[8], 1000 + i * 17);
      const archMesh = new THREE.Mesh(archGeo, rockShaderMat);
      archMesh.position.set(ax, ay, az);
      archMesh.rotation.y = yaw;
      archMesh.rotation.z = roll;
      registerScenery(archMesh, az);

      // Floor-to-ceiling karst abutment cliffs anchoring each arch into the seabed and cavern roof
      for (const side of [-1, 1]) {
        const legGeo = createCliffGeometry(9.5, 84, 9.8, 0.14, 2000 + i * 31 + (side > 0 ? 1 : 2));
        const legMesh = new THREE.Mesh(legGeo, rockShaderMat);
        legMesh.position.set(
          ax + side * 34.5 * Math.cos(yaw),
          -6,
          az - side * Math.sin(yaw) * 34.0
        );
        registerScenery(legMesh, legMesh.position.z);
      }
    }

    // (A2) Five Staggered Twin-Pillar Karst Gates & Labyrinth Baffle Pillars (camera threads between the two stone pillars!)
    // Full floor-to-ceiling height (h = 84 at y = -6, spanning y = -48 to +36) so NO flat cylinder caps ever appear in frame!
    // Synchronized with the Z-periodic karst labyrinth path: X_path(Z) = 7.5 * sin(Z * PI / 60) - 2.0 * sin(Z * PI / 120)
    const twinGates = [
      // [gateZ, p1X, p1ZOff, p1W, p2X, p2ZOff, p2W, baffleX, baffleZOff, baffleW]
      [-90, -1.8, 0.0, 4.8, 19.8, 1.5, 5.2, -16.5, -3.5, 5.8],
      [-30, 4.6, 0.0, 4.8, -17.0, 1.5, 5.2, 18.5, -3.5, 5.8],
      [0, -11.0, -2.5, 4.8, 11.0, 2.5, 4.8, -23.5, 3.0, 6.2],
      [30, -4.6, 0.0, 4.8, 17.0, 1.5, 5.2, -18.5, -3.5, 5.8],
      [90, 1.8, 0.0, 4.8, -19.8, 1.5, 5.2, 16.5, -3.5, 5.8],
    ];
    for (let gIdx = 0; gIdx < twinGates.length; gIdx++) {
      const g = twinGates[gIdx];
      const gz = g[0];
      const pillars = [
        [g[1], gz + g[2], g[3], 84, 4100 + gIdx * 43 + 1, 0.055],
        [g[4], gz + g[5], g[6], 84, 4100 + gIdx * 43 + 7, -0.065],
        [g[7], gz + g[8], g[9], 84, 4100 + gIdx * 43 + 13, 0.085],
      ];
      for (let pIdx = 0; pIdx < pillars.length; pIdx++) {
        const p = pillars[pIdx];
        const pGeo = createCliffGeometry(p[2], p[3], p[2] * 1.08, 0.14, p[4]);
        const pMesh = new THREE.Mesh(pGeo, rockShaderMat);
        pMesh.position.set(p[0], -6, p[1]);
        pMesh.rotation.y = seedRng() * Math.PI * 2;
        pMesh.rotation.z = p[5];
        registerScenery(pMesh, p[1]);
      }
    }

    // (A3) Inter-Chamber Karst Labyrinth Divider Pillars & Leaning Cavern Buttresses
    // Floor-to-ceiling karst pillars placed between gates to break up corridor sightlines while preserving clear water chambers
    const labyrinthDividers = [
      [-108, -6.5, 20.5, 4.6],
      [-46, 8.5, -17.5, 4.6],
      [15, -7.6, 18.5, 4.5],
      [44, -8.8, 18.0, 4.6],
      [106, 6.5, -20.5, 4.6],
    ];
    for (let dIdx = 0; dIdx < labyrinthDividers.length; dIdx++) {
      const d = labyrinthDividers[dIdx];
      const dz = d[0];
      const xs = [d[1], d[2]];
      for (let s = 0; s < 2; s++) {
        const colGeo = createCliffGeometry(d[3], 84, d[3] * 1.08, 0.14, 5200 + dIdx * 59 + s * 11);
        const colMesh = new THREE.Mesh(colGeo, rockShaderMat);
        const zPos = dz + (s === 0 ? -1.5 : 1.5);
        colMesh.position.set(xs[s], -6, zPos);
        colMesh.rotation.y = seedRng() * Math.PI * 2;
        colMesh.rotation.z = (s === 0 ? -1 : 1) * 0.065;
        registerScenery(colMesh, zPos);
      }
    }

    // (B) Winding Karst Grotto Walls & Craggy Cavern Flanks on Left and Right sides (Z: -120 to 120, period L = 240)
    // Modulated with the labyrinth S-curve so outer cavern walls curve organically like a karst grotto rather than a straight corridor
    for (let z = -120; z < 120; z += 15) {
      const caveCurve = Math.sin((z * Math.PI) / 60.0) * 5.5;
      // Left karst cavern wall
      const leftW = 13.0 + seedRng() * 3.5;
      const leftH = 82 + seedRng() * 10;
      const leftGeo = createCliffGeometry(leftW, leftH, 15, 0.22, Math.round(seedRng() * 10000));
      const leftMesh = new THREE.Mesh(leftGeo, rockShaderMat);
      leftMesh.position.set(-41 + caveCurve - seedRng() * 4, -6 + (seedRng() - 0.5) * 3, z + (seedRng() - 0.5) * 3);
      leftMesh.rotation.y = seedRng() * Math.PI * 2;
      leftMesh.rotation.z = -0.06;
      registerScenery(leftMesh, leftMesh.position.z);

      // Right karst cavern wall
      const rightW = 13.0 + seedRng() * 3.5;
      const rightH = 82 + seedRng() * 10;
      const rightGeo = createCliffGeometry(rightW, rightH, 15, 0.22, Math.round(seedRng() * 10000));
      const rightMesh = new THREE.Mesh(rightGeo, rockShaderMat);
      rightMesh.position.set(41 + caveCurve + seedRng() * 4, -6 + (seedRng() - 0.5) * 3, z + (seedRng() - 0.5) * 3);
      rightMesh.rotation.y = seedRng() * Math.PI * 2;
      rightMesh.rotation.z = 0.06;
      registerScenery(rightMesh, rightMesh.position.z);

      // Stepped outer karst massif peaks
      if (Math.abs(z % 30) < 8) {
        for (const side of [-1, 1]) {
          const peakGeo = createCliffGeometry(15, 64, 16, 0.34, Math.round(seedRng() * 10000));
          const peakMesh = new THREE.Mesh(peakGeo, rockShaderMat);
          peakMesh.position.set(side * (52 + seedRng() * 6) + caveCurve, -8, z + (seedRng() - 0.5) * 4);
          peakMesh.rotation.y = seedRng() * Math.PI * 2;
          registerScenery(peakMesh, peakMesh.position.z);
        }
      }
    }

    // (C) Soft Feathered Subaerial Waterfalls cascading from mossy cliffs into water surface
    const waterfallMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.rockUniforms ? this.rockUniforms.uTime : { value: 0 },
        uCamPos: this.rockUniforms ? this.rockUniforms.uCamPos : { value: new THREE.Vector3() },
        uWaterfallCol: { value: waterfallCol },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform vec3 uWaterfallCol;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          float dist = length(vWorldPos - uCamPos);
          if (dist >= 96.0) discard;
          // Soft feathered boundaries on all 4 sides - strictly no hard rectangular edges
          float edgeX = smoothstep(0.0, 0.38, vUv.x) * smoothstep(1.0, 0.62, vUv.x);
          float edgeY = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.78, vUv.y);
          float stream1 = sin(vUv.x * 28.0) * 0.5 + 0.5;
          float stream2 = sin(vUv.x * 52.0 + vUv.y * 18.0 + uTime * 7.5) * 0.5 + 0.5;
          float mist = (0.45 + 0.55 * stream1 * stream2) * edgeX * edgeY;
          float splash = smoothstep(0.35, 0.05, vUv.y) * edgeX * 0.35;
          // Visible when viewing from above/near water surface, smoothly fades out when deep underwater or far away
          float surfaceVis = smoothstep(-5.0, 1.0, uCamPos.y);
          float distFade = 1.0 - smoothstep(55.0, 92.0, dist);
          float alpha = clamp((mist * 0.48 + splash) * smoothstep(-1.5, 1.5, vWorldPos.y) * surfaceVis * distFade, 0.0, 0.60);
          gl_FragColor = vec4(uWaterfallCol, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (const az of [-90, -30, 30, 90]) {
      for (const s of [-1, 1]) {
        const wfGeo = new THREE.PlaneGeometry(7, 22);
        const wfMesh = new THREE.Mesh(wfGeo, waterfallMat);
        wfMesh.position.set(s * 36, 9, az);
        wfMesh.rotation.y = s > 0 ? -0.45 : 0.45;
        registerScenery(wfMesh, az);
      }
    }

    this.scene.add(this.sceneryGroup);

    // =========================================================================
    // 4. Seamless Multi-Layered Underwater Caustic God-Ray Curtains
    // =========================================================================
    const rayGeo = new THREE.CylinderGeometry(20, 62, 78, 40, 1, true);
    rayGeo.translate(0, -28, 0);
    this.rayUniforms = {
      uTime: { value: 0 },
      uRayColor: { value: sunSkyLight },
      uRayAccent: { value: rayAccentCol },
      uEnergy: { value: 0.5 },
    };
    const rayMat = new THREE.ShaderMaterial({
      uniforms: this.rayUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uRayColor;
        uniform vec3 uRayAccent;
        uniform float uEnergy;
        varying vec3 vWorldPos;
        varying vec2 vUv;

        void main() {
          // Strictly 2*PI integer harmonic frequencies along vUv.x so cylinder seam has ZERO discontinuity!
          float tau = 6.28318530718;
          float verticalFade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.60, vUv.y);
          float underFade = smoothstep(0.5, -2.5, vWorldPos.y);
          float s1 = sin(vUv.x * 5.0 * tau + uTime * 0.65 + vUv.y * 1.4) * 0.5 + 0.5;
          float s2 = cos(vUv.x * 8.0 * tau - uTime * 0.48 - vUv.y * 1.1) * 0.5 + 0.5;
          float s3 = sin(vUv.x * 13.0 * tau + uTime * 0.92 + vUv.y * 2.2) * 0.5 + 0.5;
          float mainShaft = pow(clamp(s1 * s2, 0.0001, 1.0), 2.6);
          float fineCurtain = pow(clamp(s2 * s3, 0.0001, 1.0), 3.0) * 0.50;
          float shaft = (mainShaft + fineCurtain) * (0.38 + 0.72 * uEnergy);
          vec3 rayCol = mix(uRayColor, uRayAccent, fineCurtain * 0.45);
          float alpha = clamp(shaft * verticalFade * underFade * 0.082, 0.0, 0.28);
          gl_FragColor = vec4(rayCol, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.causticRays = new THREE.Mesh(rayGeo, rayMat);
    this.causticRays.position.set(0, 0, 45);
    this.causticRays.frustumCulled = false;
    this.scene.add(this.causticRays);

    // =========================================================================
    // 4B. Bioluminescent Deep-Sea Jellyfish Swarm & Rising Hydrothermal Plumes
    // =========================================================================
    // (1) Bioluminescent Spirit Jellyfish / Medusae (36 instances with rounded umbrella domes & separated filament tentacles)
    const jellyCount = 36;
    const jellyGeo = new THREE.SphereGeometry(1.15, 24, 16);
    this.jellyUniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uLeadLevel: { value: 0 },
      uBassPulse: { value: 0 },
      uJellyCyan: { value: jellyCyanCol },
      uJellyAqua: { value: jellyAquaCol },
      uJellyRim: { value: jellyRimCol },
      uJellyCanal: { value: jellyCanalCol },
    };
    const jellyMat = new THREE.ShaderMaterial({
      uniforms: this.jellyUniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform float uLeadLevel;
        uniform float uBassPulse;
        varying vec2 vUv;
        varying vec3 vLocalPos;
        varying vec3 vWorldNormal;
        varying vec3 vViewDir;
        varying float vAlpha;
        varying float vHueSeed;
        varying float vPulseGlow;

        void main() {
          vUv = uv;
          vLocalPos = position;
          vHueSeed = aSeed.w;

          // Swimming propulsion cycle accelerated slightly by music energy
          float swimPhase = uTime * (2.1 + aSeed.w * 1.0) + aSeed.x * 12.56637;
          float pulse = sin(swimPhase);
          float thrust = smoothstep(-0.45, 0.90, pulse);
          vPulseGlow = 0.40 + 0.60 * thrust + uLeadLevel * 0.75 + uBassPulse * 0.60;

          vec3 p = position;
          float angle = uv.x * 6.28318530718;
          vec3 localN = normal;
          if (p.y >= 0.0) {
            // True rounded hemispherical umbrella bell: widest at bottom rim (bellH = 0), rounded dome at top (bellH = 1)
            float bellH = clamp(p.y / 1.15, 0.0, 1.0);
            float skirtMargin = 1.0 - bellH;
            float scallop = 1.0 + 0.07 * cos(angle * 8.0) * skirtMargin * skirtMargin;
            float bellRadiusScale = (0.96 + 0.24 * skirtMargin * (1.0 + 0.32 * pulse)) * scallop;
            p.xz *= bellRadiusScale;
            p.y = pow(clamp(bellH, 0.0001, 1.0), 0.82) * (0.92 - 0.14 * pulse);
            localN = normalize(vec3(position.x, position.y * 1.15 + 0.15, position.z));
          } else {
            // Trailing tentacle cylinder/fronds hanging from beneath the umbrella dome
            float tentDepth = clamp(-p.y / 1.15, 0.0, 1.0);
            float rBase = sqrt(max(1.0 - p.y * p.y / (1.15 * 1.15), 1e-4));
            vec2 unitXZ = p.xz / max(rBase * 1.15, 1e-4);
            float tentRadius = (0.68 - 0.42 * tentDepth) * (0.85 + 0.15 * cos(angle * 8.0));
            float swayX = sin(uTime * 2.6 - tentDepth * 4.5 + aSeed.y * 6.28318) * 0.38 * tentDepth;
            float swayZ = cos(uTime * 2.2 - tentDepth * 4.0 + aSeed.z * 6.28318) * 0.38 * tentDepth;
            p.xz = unitXZ * tentRadius + vec2(swayX, swayZ);
            p.y = -tentDepth * (2.25 + 0.30 * sin(swimPhase - 1.2));
            localN = normalize(vec3(unitXZ.x, -0.15, unitXZ.y));
          }

          // Gentle 3D tilt along swimming direction
          float tiltX = sin(uTime * 0.9 + aSeed.z) * 0.16;
          float cT = cos(tiltX), sT = sin(tiltX);
          p = vec3(p.x * cT - p.y * sT, p.x * sT + p.y * cT, p.z);
          localN = vec3(localN.x * cT - localN.y * sT, localN.x * sT + localN.y * cT, localN.z);

          // Infinite Z-wrapping (period L = 240) and buoyant rising between y = -28 and y = -4.5
          float L = 240.0;
          float relZ = mod(aSeed.z - uCamPos.z + 120.0, L) - 120.0;
          float worldZ = uCamPos.z + relZ;
          float riseCycle = mod(aSeed.y + uTime * (0.55 + aSeed.w * 0.35) + thrust * 0.18, 23.5);
          float worldY = -28.0 + riseCycle;
          float worldX = aSeed.x + sin(uTime * 0.65 + aSeed.w * 6.28318) * 2.2;

          vec3 worldCenter = vec3(worldX, worldY, worldZ);
          float scale = 0.78 + aSeed.w * 0.55;
          vec3 wPos = worldCenter + p * scale;

          vWorldNormal = normalize(localN);
          vViewDir = normalize(uCamPos - wPos);
          float dist = length(wPos - uCamPos);
          float distFade = 1.0 - smoothstep(54.0, 86.0, dist);
          float verticalLife = smoothstep(0.0, 3.5, riseCycle) * smoothstep(23.5, 19.0, riseCycle);
          float submergeFade = smoothstep(-2.0, -4.5, worldY) * smoothstep(0.0, -1.8, uCamPos.y);
          vAlpha = distFade * verticalLife * submergeFade;

          gl_Position = projectionMatrix * viewMatrix * vec4(wPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uJellyCyan;
        uniform vec3 uJellyAqua;
        uniform vec3 uJellyRim;
        uniform vec3 uJellyCanal;
        varying vec2 vUv;
        varying vec3 vLocalPos;
        varying vec3 vWorldNormal;
        varying vec3 vViewDir;
        varying float vAlpha;
        varying float vHueSeed;
        varying float vPulseGlow;

        void main() {
          if (vAlpha <= 0.005) discard;
          float angle = vUv.x * 6.28318530718;
          vec3 N = normalize(vWorldNormal);
          vec3 V = normalize(vViewDir);
          float NdotV = abs(dot(N, V));
          float fresnel = pow(clamp(1.0 - NdotV, 0.0001, 1.0), 1.85);

          vec3 cyanBio = uJellyCyan;
          vec3 aquaBio = uJellyAqua;
          vec3 violetRim = uJellyRim;
          vec3 baseBio = mix(cyanBio, aquaBio, vHueSeed);

          if (vLocalPos.y >= 0.0) {
            // Rounded translucent umbrella dome with 8 radial bioluminescent canals and glowing scalloped margin
            float bellH = clamp(vLocalPos.y / 1.15, 0.0, 1.0);
            float radialCanal = pow(clamp(0.5 + 0.5 * cos(angle * 8.0), 0.0001, 1.0), 4.5);
            float rimBand = smoothstep(0.28, 0.0, bellH);
            float apexCore = smoothstep(0.55, 0.95, bellH) * 0.35;

            vec3 col = mix(baseBio, violetRim, fresnel * 0.65 + rimBand * 0.35);
            col += uJellyCanal * radialCanal * 0.45;
            col *= (0.65 + 0.45 * vPulseGlow);

            float bellAlpha = (0.06 + 0.34 * fresnel + 0.22 * radialCanal + 0.26 * rimBand + apexCore) * vAlpha;
            gl_FragColor = vec4(col, clamp(bellAlpha, 0.0, 0.62));
          } else {
            // Separated, delicate glowing filament tentacles & inner oral arms (transparent between strands!)
            float tentDepth = clamp(-vLocalPos.y / 1.15, 0.0, 1.0);
            float wave1 = cos(angle * 8.0 + tentDepth * 4.2 + sin(uTime * 2.4 + tentDepth * 5.0) * 0.75);
            float wave2 = cos(angle * 4.0 - tentDepth * 3.0 + cos(uTime * 1.9 + tentDepth * 4.0) * 0.65);
            float thinStrands = smoothstep(0.68, 0.96, wave1);
            float oralFrills = smoothstep(0.58, 0.92, wave2) * (1.0 - tentDepth * 0.75) * 0.55;
            float filamentMask = clamp(thinStrands + oralFrills, 0.0, 1.0);
            float edgeSoft = smoothstep(0.0, 0.35, NdotV);
            float tipFade = smoothstep(1.0, 0.12, tentDepth);

            float tentAlpha = filamentMask * edgeSoft * tipFade * vAlpha * (0.42 + 0.28 * vPulseGlow);
            if (tentAlpha <= 0.008) discard;

            vec3 col = mix(violetRim, cyanBio, tentDepth * 0.65 + thinStrands * 0.35) * (0.75 + 0.50 * vPulseGlow);
            gl_FragColor = vec4(col, clamp(tentAlpha, 0.0, 0.58));
          }
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.jellyMesh = new THREE.InstancedMesh(jellyGeo, jellyMat, jellyCount);
    this.jellyMesh.frustumCulled = false;
    const jSeeds = new Float32Array(jellyCount * 4);
    const jRng = rng(0x52d9);
    for (let i = 0; i < jellyCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      // Distributed gracefully across the mid-ground canyon wings (|X| = 6.5 .. 24.5)
      jSeeds[i * 4 + 0] = side * (6.5 + jRng() * 18.0);
      jSeeds[i * 4 + 1] = jRng() * 23.5;
      jSeeds[i * 4 + 2] = -120.0 + (i / jellyCount) * 240.0 + (jRng() - 0.5) * 6.0;
      jSeeds[i * 4 + 3] = jRng();
      this.jellyMesh.setMatrixAt(i, new THREE.Matrix4());
    }
    jellyGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(jSeeds, 4));
    this.jellyMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.jellyMesh);

    // (2) Rising Hydrothermal Bioluminescent Mist Curtains along Outer Canyon Walls (16 instances, zero cylinder walls)
    const plumeCount = 16;
    const plumeGeo = new THREE.PlaneGeometry(4.2, 28.0, 1, 16);
    this.plumeUniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uLeadLevel: { value: 0 },
      uBassPulse: { value: 0 },
      uPlumeLow: { value: plumeLowCol },
      uPlumeHigh: { value: plumeHighCol },
    };
    const plumeMat = new THREE.ShaderMaterial({
      uniforms: this.plumeUniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform float uLeadLevel;
        uniform float uBassPulse;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vEnergy;

        void main() {
          vUv = uv;
          float L = 240.0;
          float relZ = mod(aSeed.z - uCamPos.z + 120.0, L) - 120.0;
          float worldZ = uCamPos.z + relZ;

          float h = uv.y;
          float gentleSway = sin(h * 3.2 - uTime * (1.4 + aSeed.w * 0.6) + aSeed.y * 6.28318) * 0.65;
          vec3 centerPos = vec3(aSeed.x + gentleSway, -22.0 + position.y, worldZ);

          // Camera-facing horizontal billboard axis so mist curtain never shows hard edges or wavy spine lines
          vec3 toCamXZ = uCamPos - centerPos;
          vec3 right = normalize(vec3(toCamXZ.z, 0.0, -toCamXZ.x) + vec3(1e-4, 0.0, 0.0));
          vec3 wPos = centerPos + right * position.x * (0.85 + 0.55 * h);

          float dist = length(wPos - uCamPos);
          float distFade = smoothstep(8.0, 18.0, dist) * (1.0 - smoothstep(52.0, 86.0, dist));
          float submergeFade = smoothstep(-0.5, -2.5, uCamPos.y) * smoothstep(-3.0, -7.5, wPos.y);
          vEnergy = 0.34 + uLeadLevel * 0.78 + uBassPulse * 0.68;
          vAlpha = distFade * submergeFade;

          gl_Position = projectionMatrix * viewMatrix * vec4(wPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uPlumeLow;
        uniform vec3 uPlumeHigh;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vEnergy;

        void main() {
          if (vAlpha <= 0.005) discard;
          // Smooth Gaussian horizontal falloff - zero cylinder edges or double lines
          float x = vUv.x * 2.0 - 1.0;
          float hFeather = exp(-x * x * 4.5) * smoothstep(1.0, 0.0, abs(x));
          float vFade = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.55, vUv.y);

          float s1 = sin(x * 3.5 + vUv.y * 9.0 - uTime * 2.8) * 0.5 + 0.5;
          float s2 = cos(x * 5.2 - vUv.y * 14.0 - uTime * 3.9) * 0.5 + 0.5;
          float mist = (0.35 + 0.65 * s1 * s2) * hFeather * vFade;

          vec3 col = mix(uPlumeLow, uPlumeHigh, s1 * s2);
          float alpha = clamp(mist * 0.22 * vAlpha * vEnergy, 0.0, 0.28);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.plumeMesh = new THREE.InstancedMesh(plumeGeo, plumeMat, plumeCount);
    this.plumeMesh.frustumCulled = false;
    const pSeeds = new Float32Array(plumeCount * 4);
    const pRng = rng(0x88f1);
    for (let i = 0; i < plumeCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      // Placed along the outer canyon flanks (|X| = 22.0 .. 30.0) so camera never clips inside a plume
      pSeeds[i * 4 + 0] = side * (22.0 + pRng() * 8.0);
      pSeeds[i * 4 + 1] = pRng();
      pSeeds[i * 4 + 2] = -120.0 + (i / plumeCount) * 240.0;
      pSeeds[i * 4 + 3] = pRng();
      this.plumeMesh.setMatrixAt(i, new THREE.Matrix4());
    }
    plumeGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(pSeeds, 4));
    this.plumeMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.plumeMesh);

    // =========================================================================
    // 5. Marine Atmosphere: Subtle Near Bubbles + Marine Snow Dust
    // =========================================================================
    // (A) Photorealistic 3D Underwater Air Bubbles (Snell critical-angle TIR + capillary ripples + wake streams)
    const bubbleCount = 220;
    const bubbleGeo = new THREE.PlaneGeometry(0.28, 0.28);
    this.bubbleUniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uBurst: { value: 0 },
      uBubbleColor: { value: veinGlowCyan },
      uBubbleSky: { value: bubbleSkyCol },
      uBubbleRefract: { value: bubbleRefractCol },
      uBubbleDeep: { value: bubbleDeepCol },
    };

    const bubbleMat = new THREE.ShaderMaterial({
      uniforms: this.bubbleUniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform float uBurst;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vBurst;
        varying float vSizeFactor;
        varying float vPhase;
        varying float vTilt;

        void main() {
          vUv = uv;
          vBurst = uBurst;
          vSizeFactor = aSeed.w;
          vPhase = uTime * (6.8 + aSeed.w * 3.5) + aSeed.x * 25.13274 + aSeed.z * 12.56637;

          // Pure monotonic upward buoyant motion - vertical velocity is ALWAYS > 0
          float riseSpeed = 1.55 + aSeed.w * 1.95;
          float yOffset = mod(aSeed.y + uTime * riseSpeed, 22.0) - 11.0;

          // Helical horizontal path induced by wake vortex shedding (zero vertical component)
          float helixAngle = uTime * (2.5 + aSeed.w * 1.3) + aSeed.x * 12.56637 + aSeed.y * 0.52;
          float helixRadius = 0.14 + aSeed.w * 0.24;
          float wobbleX = sin(helixAngle) * helixRadius;
          float wobbleZ = cos(helixAngle) * helixRadius;

          // Hydrodynamic banking tilt into the horizontal helical turn
          vTilt = cos(helixAngle) * (0.14 + 0.18 * aSeed.w);

          vec3 worldCenter = uCamPos + vec3(
            (aSeed.x - 0.5) * 18.0 + wobbleX,
            yOffset,
            (aSeed.z - 0.5) * 18.0 + wobbleZ
          );

          vec3 toCam = normalize(uCamPos - worldCenter);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 up = cross(toCam, right);

          // Hero wobbling cap-bubbles (aSeed.w > 0.6) + trailing wake pearl bubbles (aSeed.w <= 0.6)
          float baseScale = 0.32 + pow(clamp(aSeed.w, 0.0001, 1.0), 1.35) * 1.12;
          float size = baseScale * (1.0 + uBurst * 0.42);
          vec3 vPos = worldCenter + (right * position.x + up * position.y) * size;

          // Smoothly fade out when bubble is above water surface (y = 0) and when camera is above water
          float submergeFade = smoothstep(0.2, -1.0, worldCenter.y) * smoothstep(0.5, -0.6, uCamPos.y);
          float distCam = length(worldCenter - uCamPos);
          float nearFarFade = smoothstep(1.3, 2.6, distCam) * (1.0 - smoothstep(11.5, 16.5, distCam));
          vAlpha = smoothstep(11.0, 7.2, abs(yOffset)) * nearFarFade * submergeFade;

          gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBubbleColor;
        uniform vec3 uBubbleSky;
        uniform vec3 uBubbleRefract;
        uniform vec3 uBubbleDeep;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vBurst;
        varying float vSizeFactor;
        varying float vPhase;
        varying float vTilt;

        void main() {
          if (vAlpha <= 0.004) discard;
          vec2 p = (vUv * 2.0 - 1.0) * 1.12;

          // 1. Rotate into hydrodynamic drift frame & apply oblate cap deformation + multi-harmonic surface tension ripples
          float cT = cos(vTilt), sT = sin(vTilt);
          vec2 q = vec2(p.x * cT - p.y * sT, p.x * sT + p.y * cT);
          float oblate = smoothstep(0.28, 0.88, vSizeFactor);
          float wobble1 = sin(vPhase);
          float wobble2 = cos(vPhase * 1.618 + 1.2);
          q.x *= 1.0 - oblate * (0.15 + 0.08 * wobble1);
          q.y *= 1.0 + oblate * (0.20 + 0.10 * wobble1);
          // Rising jellyfish-cap hydrodynamic asymmetry: rounded upper dome, flattened/indented trailing wake base
          q.y += (q.x * q.x * 0.22 - 0.05) * oblate;

          float theta = atan(q.y, q.x + 1e-5);
          float capillaryRipple = (sin(theta * 3.0 + vPhase) * 0.045 + cos(theta * 5.0 - vPhase * 1.4) * 0.025) * oblate;
          vec2 qDef = q * (1.0 + capillaryRipple);

          float r2 = dot(qDef, qDef);
          if (r2 > 1.0) discard;
          float r = sqrt(r2);

          // 2. Reconstruct 3D deformed cavity normal
          float nz = sqrt(max(1.0 - r2, 0.0001));
          vec3 N = normalize(vec3(
            qDef.x * (1.15 + 0.12 * cos(theta * 3.0 + vPhase) * oblate),
            qDef.y * (1.32 + 0.12 * sin(theta * 3.0 + vPhase) * oblate),
            nz
          ));

          // 3. Real Underwater Air-Cavity Optics (n_water/n_air = 1.333, critical angle sin(theta_c) = 0.75)
          // Total Internal Reflection (TIR) mirror zone near grazing angles
          float tirMask = smoothstep(0.54, 0.86, r) * (1.0 - smoothstep(0.95, 1.0, r));
          float fresnel = pow(clamp(1.0 - nz, 0.0001, 1.0), 2.1);

          // Upper dome reflects bright sunlit ocean surface; lower-left rim catches internal caustic bounce
          float upperArch = smoothstep(-0.20, 0.65, N.y - 0.18 * N.x);
          float lowerCaustic = smoothstep(0.52, 0.92, r) * smoothstep(-0.05, -0.78, N.y + 0.26 * N.x) * (1.0 - smoothstep(0.93, 1.0, r));

          // Diverging-lens interior refraction: bends bright surface light into lower-inner belly & dark abyss into upper-inner band
          float innerLens = 1.0 - smoothstep(0.55, 0.82, r);
          float bellyGlow = innerLens * smoothstep(0.15, -0.62, N.y) * 0.42;
          float criticalDarkBand = smoothstep(0.48, 0.74, r) * (1.0 - smoothstep(0.74, 0.91, r)) * (0.55 + 0.45 * upperArch);

          // Curved overhead skylight window reflection (wraps organically along the 3D upper-left dome)
          vec3 sunDir = normalize(vec3(-0.34, 0.76, 0.55));
          float sunDot = clamp(dot(N, sunDir), 0.0001, 1.0);
          float windowArc = pow(sunDot, 20.0) * smoothstep(0.32, 0.82, r) * (1.0 - smoothstep(0.90, 0.98, r));
          float crispSpec = pow(sunDot, 84.0) * 1.45;

          // Secondary internal reflection glint on opposite lower-right rim
          vec3 bounceDir = normalize(vec3(0.38, -0.72, 0.58));
          float bounceGlint = pow(clamp(dot(N, bounceDir), 0.0001, 1.0), 30.0) * smoothstep(0.45, 0.88, r) * 0.75;

          // Subtle thin-film chromatic iridescence along the TIR boundary
          vec3 iridescence = vec3(
            0.5 + 0.5 * sin(r * 14.0 + theta * 2.0 + vPhase * 0.5),
            0.5 + 0.5 * sin(r * 14.0 + theta * 2.0 + vPhase * 0.5 + 2.1),
            0.5 + 0.5 * sin(r * 14.0 + theta * 2.0 + vPhase * 0.5 + 4.2)
          );

          // 4. Composite photorealistic underwater bubble color & alpha in cover tone
          vec3 silverSky = uBubbleSky;
          vec3 aquaRefract = mix(uBubbleRefract, uBubbleColor, 0.35);
          vec3 deepNavy = uBubbleDeep;

          vec3 tirColor = mix(aquaRefract, silverSky, upperArch * 0.82 + fresnel * 0.18);
          tirColor = mix(tirColor, iridescence * 1.15, 0.16 * tirMask);

          vec3 col = mix(deepNavy, tirColor, clamp(tirMask * (0.45 + 0.55 * upperArch) + lowerCaustic * 0.85 + bellyGlow, 0.0, 1.0));
          col += mix(aquaRefract, silverSky, 0.55) * (lowerCaustic * 0.72 + bellyGlow * 0.55);
          col += vec3(0.97, 0.995, 1.0) * (windowArc * 1.05 + crispSpec + bounceGlint);

          float outerAA = 1.0 - smoothstep(0.90, 1.0, r);
          float rawAlpha = (
            tirMask * (0.26 + 0.58 * upperArch) +
            lowerCaustic * 0.62 +
            criticalDarkBand * 0.32 +
            bellyGlow * 0.24 +
            windowArc * 0.92 +
            crispSpec +
            bounceGlint * 0.75 +
            0.04
          ) * outerAA;

          float alpha = clamp(rawAlpha * vAlpha * (0.84 + vBurst * 0.25), 0.0, 0.92);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.bubbleMesh = new THREE.InstancedMesh(bubbleGeo, bubbleMat, bubbleCount);
    this.bubbleMesh.frustumCulled = false;
    const bSeeds = new Float32Array(bubbleCount * 4);
    const bRng = rng(0x61a8);
    // 44 buoyant rising bubble streams: each has 1 hero wobbling cap-bubble + 4 trailing wake pearl bubbles
    const streamCount = 44;
    for (let s = 0; s < streamCount; s++) {
      const baseX = bRng();
      const baseY = bRng() * 22.0;
      const baseZ = bRng();
      for (let m = 0; m < 5; m++) {
        const i = s * 5 + m;
        const isHero = m === 0;
        const isMedium = m === 1;
        bSeeds[i * 4 + 0] = clamp01(baseX + (isHero ? 0 : (bRng() - 0.5) * 0.038));
        bSeeds[i * 4 + 1] = (baseY - m * (0.28 + bRng() * 0.32) + 22.0) % 22.0;
        bSeeds[i * 4 + 2] = clamp01(baseZ + (isHero ? 0 : (bRng() - 0.5) * 0.038));
        bSeeds[i * 4 + 3] = isHero ? (0.72 + bRng() * 0.28) : isMedium ? (0.42 + bRng() * 0.25) : (0.15 + bRng() * 0.26);
        this.bubbleMesh.setMatrixAt(i, new THREE.Matrix4());
      }
    }
    bubbleGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(bSeeds, 4));
    this.bubbleMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.bubbleMesh);

    // (B) Distant Marine Snow / Micro Floating Particles (240 softened natural circular specks)
    const snowCount = 240;
    const snowGeo = new THREE.PlaneGeometry(0.11, 0.11);
    this.snowUniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uColor: { value: snowCol },
    };
    const snowMat = new THREE.ShaderMaterial({
      uniforms: this.snowUniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCamPos;
        varying vec2 vUv;
        varying float vAlpha;

        void main() {
          vUv = uv;
          float slowRise = 0.35 + aSeed.w * 0.55;
          float yOff = mod(aSeed.y + uTime * slowRise, 32.0) - 16.0;
          float driftX = sin(uTime * 1.2 + aSeed.x * 6.28) * 0.45;
          float driftZ = cos(uTime * 1.1 + aSeed.z * 6.28) * 0.45;

          vec3 wPos = uCamPos + vec3(
            (aSeed.x - 0.5) * 36.0 + driftX,
            yOff,
            (aSeed.z - 0.5) * 36.0 + driftZ
          );

          vec3 toCam = normalize(uCamPos - wPos);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 up = cross(toCam, right);

          // Expand billboard quad towards camera so particles have real rendered area
          vec3 vPos = wPos + (right * position.x + up * position.y) * (0.75 + aSeed.w * 0.55);

          // Smoothly fade out when particle is above water surface, when camera is above water, or when too close to lens
          float submergeFade = smoothstep(0.2, -1.0, wPos.y) * smoothstep(0.5, -0.6, uCamPos.y);
          float nearLensFade = smoothstep(3.2, 7.5, length(wPos - uCamPos));
          vAlpha = smoothstep(16.0, 10.0, abs(yOff)) * 0.65 * submergeFade * nearLensFade;
          gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float d = length(p);
          if (d > 1.0) discard;
          float softCircle = 1.0 - d * d;
          gl_FragColor = vec4(uColor, vAlpha * softCircle * 0.9);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.marineSnowMesh = new THREE.InstancedMesh(snowGeo, snowMat, snowCount);
    this.marineSnowMesh.frustumCulled = false;
    const sSeeds = new Float32Array(snowCount * 4);
    const sRng = rng(0x9043);
    for (let i = 0; i < snowCount; i++) {
      sSeeds[i * 4 + 0] = sRng();
      sSeeds[i * 4 + 1] = sRng() * 32.0;
      sSeeds[i * 4 + 2] = sRng();
      sSeeds[i * 4 + 3] = sRng();
      this.marineSnowMesh.setMatrixAt(i, new THREE.Matrix4());
    }
    snowGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sSeeds, 4));
    this.marineSnowMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.marineSnowMesh);

    // =========================================================================
    // 6. Lyrics Typography Rig (Configured with actual 10-unit view frame)
    // =========================================================================
    this.rig = new LyricRig(palette, 'hook');
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // LyricRig uses internal DISTANCE = 10 units
    const vh = 2 * 10.0 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    this.rig.frame = { vh, vw: vh * aspect };
  }

  update(ctx: FrameCtx): void {
    const { t, dt, music, shot, shotT, fx } = ctx;
    const isDrop = shot.section.label === 'drop';
    const isBuild = shot.section.label === 'pre';

    // 1. Music Reactive Quantities (Shared foreground and timbre priority)
    const foreground = music.foregroundAt(t);
    const leadVal = Math.max(0, foreground.level * 1.25 + foreground.attack * 0.85);

    // Deterministic bass pulse (pure function of t, zero history state)
    const bassPulse = music.pulse('kick', t, 0.22);

    // 2. Compute Camera Trajectory FIRST so camera is at current frame
    const variant = shot.variant || (isDrop ? 'dive' : 'canyon');
    this.updateCamera(shotT, variant, isDrop, isBuild, t, dt, fx);
    this.camera.updateMatrixWorld();

    // 3. Dynamic Infinite Canyon Scenery Recycling along Z (UW-04)
    // Seamlessly wraps scenery around camera so canyon is 100% packed forever (even 65s+ Drop)
    const camZ = this.camera.position.z;
    const L = 240.0;
    const halfL = L * 0.5;
    for (let i = 0; i < this.recyclableScenery.length; i++) {
      const obj = this.recyclableScenery[i];
      const relZ = ((obj.userData.baseZ - camZ) % L + L) % L;
      obj.position.z = camZ + (relZ - halfL);
    }
    this.domeMesh.position.copy(this.camera.position);
    this.waterPlane.position.z = camZ;
    this.seabedMesh.position.z = camZ;
    this.causticRays.position.z = variant === 'orbit' ? 60.0 : camZ + 28.0;
    this.causticRays.position.x = variant === 'orbit' ? 0.0 : Math.sin(t * 0.28) * 6.0;

    // 4. Update Uniforms with current frame camera parameters (zero-frame latency)
    this.waterUniforms.uTime.value = t;
    this.waterUniforms.uCamPos.value.copy(this.camera.position);

    this.rockUniforms.uTime.value = t;
    this.rockUniforms.uCamPos.value.copy(this.camera.position);
    this.rockUniforms.uLeadLevel.value = leadVal;
    this.rockUniforms.uLeadAttack.value = foreground.attack;
    this.rockUniforms.uBassPulse.value = bassPulse;

    this.rayUniforms.uTime.value = t;
    this.rayUniforms.uEnergy.value = 0.35 + foreground.level * 0.65;

    this.jellyUniforms.uTime.value = t;
    this.jellyUniforms.uCamPos.value.copy(this.camera.position);
    this.jellyUniforms.uLeadLevel.value = leadVal;
    this.jellyUniforms.uBassPulse.value = bassPulse;

    this.plumeUniforms.uTime.value = t;
    this.plumeUniforms.uCamPos.value.copy(this.camera.position);
    this.plumeUniforms.uLeadLevel.value = leadVal;
    this.plumeUniforms.uBassPulse.value = bassPulse;

    this.bubbleUniforms.uTime.value = t;
    this.bubbleUniforms.uCamPos.value.copy(this.camera.position);
    this.bubbleUniforms.uBurst.value = bassPulse;

    this.snowUniforms.uTime.value = t;
    this.snowUniforms.uCamPos.value.copy(this.camera.position);

    // 5. Post Effect Control: Suppress harsh 2-color impact threshold & glitch flash on entry for smooth underwater flow
    fx.impact = 0;
    fx.impactInvert = 0;
    fx.glitch = 0;
    fx.zoom = Math.min(fx.zoom, 0.18);
    if (isDrop) {
      const entryBoost = shotT < 0.8 ? (1.0 - shotT / 0.8) * 0.25 : 0.0;
      fx.bloom = Math.max(fx.bloom, 0.38 + foreground.level * 0.25 + entryBoost);
    }

    // 6. Lyrics Update
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, shot.section.energy);
  }

  /**
   * Multi-act dynamic underwater camera choreography:
   * Starts directly submerged underwater (no aerial entry), combining deep underwater dive,
   * banking slalom around sentinel spires, deep trench upward cathedral gaze, and ascending spiral.
   */
  private updateCamera(shotT: number, variant: string, isDrop: boolean, isBuild: boolean, t: number, dt: number, fx: any): void {
    const cam = this.camera;
    const lookTarget = new THREE.Vector3(0, -10, 0);
    let bankRoll = 0.0;

    // Z-locked Karst Labyrinth path: periodic with L = 240 so camera threads cleanly between every Twin-Pillar Gate!
    const k1 = Math.PI / 60.0;
    const k2 = Math.PI / 120.0;

    const v = variant || (isDrop ? 'dive' : 'canyon');

    if (v === 'dive') {
      // Directly Submerged Multi-Act Karst Labyrinth & Twin-Pillar Odyssey (zero above-water aerial phase).
      // A Drop starts at full depth on its first frame; on other sections the plunge still unfolds over 2.4 s.
      // Act I (0..2.5s): Threads through Twin-Pillar Gate II (Z = -30)
      // Act II (2.5..8.5s): Banking Karst Slalom through Twin-Pillar Portal III (Z = 0) and Twin-Pillar Gate IV (Z = +30)
      // Act III (8.5..15.5s): Abyssal Cavern Dive (y -> -18.5) with UpwardKarst Cathedral Gaze at Z = +60
      // Act IV (15.5..22.5s): Twin-Pillar Gate V Slalom (Z = +90) & Ascending Bioluminescent Spiral (y -> -10.8)
      // Act V (22.5s+): Continuous winding karst labyrinth slalom
      const k = underwaterDiveEntryProgress(shotT, isDrop);
      const easePlunge = smooth(k);

      const baseUnderwaterY = -9.5 + (-13.6 - (-9.5)) * easePlunge;
      const trenchDive = -4.9 * Math.exp(-Math.pow((shotT - 11.8) / 3.4, 2.0));
      const spiralClimb = 2.8 * Math.exp(-Math.pow((shotT - 18.8) / 3.2, 2.0));
      const longWaveY = (sin(shotT * 0.38 - 1.1) * 2.5 + cos(shotT * 0.21) * 1.2) * smooth(clamp01((shotT - 21.0) / 4.0));
      const currentY = baseUnderwaterY + trenchDive + spiralClimb + longWaveY;

      const forwardZ = -38.0 + shotT * 8.0;
      const slalomX = 7.5 * sin(forwardZ * k1) - 2.0 * sin(forwardZ * k2);
      const aheadZ = forwardZ + 23.0;
      const aheadX = 7.5 * sin(aheadZ * k1) - 2.0 * sin(aheadZ * k2);

      // Dynamic pitch & yaw gaze: steers into the twin-pillar gates while framing the karst cave ceiling & arches
      const upwardCathedralGaze = 4.0 * Math.exp(-Math.pow((shotT - 12.0) / 3.5, 2.0))
                                + 2.2 * Math.max(0.0, sin(shotT * 0.36 - 0.5));
      const lookX = aheadX + cos(forwardZ * k1) * 1.8;
      const lookY = currentY - 0.4 + upwardCathedralGaze + cos(shotT * 0.38) * 1.3;

      bankRoll = -cos(forwardZ * k1) * 0.085;
      cam.position.set(slalomX, currentY, forwardZ);
      lookTarget.set(lookX, lookY, forwardZ + 32.0);

    } else if (v === 'canyon') {
      // CANYON: Winding Karst Labyrinth slalom threading between twin stone pillars & cavern dividers
      const forwardZ = -18.0 + shotT * 8.0;
      const swayX = 7.5 * sin(forwardZ * k1) - 2.0 * sin(forwardZ * k2);
      const aheadZ = forwardZ + 23.0;
      const aheadX = 7.5 * sin(aheadZ * k1) - 2.0 * sin(aheadZ * k2);
      const y = -13.2 + cos(shotT * 0.31) * 2.8 + sin(shotT * 0.17) * 1.2;
      const lookX = aheadX + cos(forwardZ * k1) * 1.6;
      const lookY = y + 1.0 + sin(shotT * 0.29) * 2.2;

      bankRoll = -cos(forwardZ * k1) * 0.078;
      cam.position.set(swayX, y, forwardZ);
      lookTarget.set(lookX, lookY, forwardZ + 32.0);

    } else if (v === 'orbit') {
      // ORBIT: 360-degree orbital sweep inside the Grand Karst Cavern Chamber gazing through surrounding twin pillars & arches
      const centerX = -1.8;
      const centerZ = 66.0;
      const radius = 5.6;
      const angle = 0.5 + shotT * 0.24;
      const y = -13.2 + sin(shotT * 0.32) * 2.6;

      bankRoll = sin(angle) * 0.055;
      cam.position.set(centerX + cos(angle) * radius, y, centerZ + sin(angle) * radius);
      lookTarget.set(sin(shotT * 0.28) * 5.5, -9.2 + cos(shotT * 0.25) * 2.2, 38.0);

    } else if (v === 'abyss') {
      // ABYSS: Deep karst cave floor exploration weaving between the massive twin pillar bases and gazing up at the cavern vault
      const forwardZ = -25.0 + shotT * 7.2;
      const y = -22.8 + sin(shotT * 0.26) * 2.0;
      const swayX = 7.5 * sin(forwardZ * k1) - 2.0 * sin(forwardZ * k2);
      const aheadZ = forwardZ + 22.0;
      const aheadX = 7.5 * sin(aheadZ * k1) - 2.0 * sin(aheadZ * k2);

      bankRoll = -cos(forwardZ * k1) * 0.068;
      cam.position.set(swayX, y, forwardZ);
      lookTarget.set(aheadX, -11.2 + sin(shotT * 0.22) * 2.2, forwardZ + 32.0);

    } else {
      // Fallback continuous karst labyrinth path
      const forwardZ = shotT * 8.0;
      const swayX = 7.5 * sin(forwardZ * k1) - 2.0 * sin(forwardZ * k2);
      cam.position.set(swayX, -12.5, forwardZ);
      lookTarget.set(7.5 * sin((forwardZ + 24.0) * k1), -12.0, forwardZ + 32.0);
    }

    cam.up.set(bankRoll, 1.0, 0.0).normalize();
    cam.lookAt(lookTarget);
  }
}
