// 日蚀裂谷 (Eclipse): 摇滚/金属/暗黑电音专属 3D 火山玄武岩与黑曜石大裂谷世界。
// 适配曲风：摇滚 (Rock), 后摇 (Post-Rock), 金属 (Metal), 暗黑 Trap / Dubstep。
// 100% 确定性纯时间函数 f(t) 驱动，零累积状态，支持任意 seek 与离线 MP4 导出。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex } from '../director/music.ts';
import { colorFromHsl, extractCoverTone, tuneCoverStop } from './coverTone.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';

const NUM_FLOATING_ROCKS = 34;
const CAM_FOV = 50;

interface RockInitState {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotSpeed: number;
  phase: number;
}

/**
 * 确定性三角波谐波（用于雕刻棱角分明的柱状玄武岩劈理面与断崖折角）
 */
function triWave(x: number): number {
  return Math.asin(Math.sin(x)) * 0.6366197723675814;
}

/**
 * 构建无缝闭合的柱状玄武岩峭壁岩柱几何体（0 裂缝边界）：
 * 通过多阶方位角三角谐波、倾斜断层台阶与纵向节理劈理，塑造嶙峋立体的火山断崖巨柱。
 */
function createBasaltButtressGeometry(
  width: number,
  height: number,
  depth: number,
  taper: number,
  seed: number,
): THREE.BufferGeometry {
  const radialSegs = 24;
  const heightSegs = 20;
  const geo = new THREE.CylinderGeometry(width * (1.0 - taper), width, height, radialSegs, heightSegs, false);
  const pos = geo.attributes.position;

  const p1 = (seed % 97) * 0.0647;
  const p2 = ((seed >> 3) % 89) * 0.0705;
  const p3 = ((seed >> 6) % 83) * 0.0757;
  const p4 = ((seed >> 9) % 79) * 0.0795;

  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    const z0 = pos.getZ(i);

    const theta = Math.atan2(z0, x0);
    const yNorm = y0 / height; // -0.5 .. +0.5

    // 1. 多边形玄武岩柱状棱面（3/5/8 阶锐角劈理）
    const f3 = triWave(3.0 * theta + p1);
    const f5 = triWave(5.0 * theta + p2);
    const f8 = triWave(8.0 * theta + p3);
    const angularFacet = 1.0 + 0.21 * f3 + 0.13 * f5 + 0.075 * f8;

    // 2. 倾斜断层阶梯台地与悬挑岩檐（破除水平环纹）
    const strataCoord = (y0 + height * 0.5) / 7.5 + p4 + 0.48 * f3 - 0.34 * f5;
    const strataFrac = strataCoord - Math.floor(strataCoord);
    const ledgeStep = 0.94 + 0.11 * (0.5 - 0.5 * Math.cos(strataFrac * Math.PI * 2.0)) + 0.04 * Math.sin(strataFrac * Math.PI * 4.0);

    // 3. 斜向构造劈理裂槽
    const cleavage = 0.075 * triWave(6.0 * theta + y0 * 0.21 + p2) * Math.sin(3.0 * theta - y0 * 0.16 + p3);

    const rScale = (angularFacet * ledgeStep + cleavage) * (1.0 - taper * (yNorm + 0.5));
    const x = x0 * rScale;
    const z = z0 * rScale * (depth / width);
    const y = y0 + 0.65 * f3 * Math.cos(y0 * 0.19 + p4) + 0.28 * f5 * Math.sin(theta * 2.0 + p1);

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * 构建蜿蜒起伏的单侧黑曜石大裂谷连续断崖地形网格：
 * 横截面从谷底熔岩河碎石滩岸（y = -6.8m）经多层悬挑断崖台阶攀升至锯齿状峰林天际线（y = 26..45m），
 * 外侧自然回落封闭，杜绝平板盒子的生硬感与穿模。
 */
function createSculptedChasmSideGeometry(side: -1 | 1, seed: number): THREE.BufferGeometry {
  const uSegs = 42; // 横截面分段：河岸 -> 陡壁阶梯 -> 锯齿崖顶 -> 远端坡脊
  const zSegs = 104; // 纵深分段：z = +28m .. -158m
  const zNear = 28.0;
  const zFar = -158.0;

  const vertCount = (uSegs + 1) * (zSegs + 1);
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  const phi1 = (seed % 101) * 0.0622 + (side > 0 ? 1.37 : 0.0);
  const phi2 = ((seed >> 4) % 97) * 0.0647 + (side > 0 ? 2.81 : 0.0);
  const phi3 = ((seed >> 8) % 89) * 0.0705 + (side > 0 ? 0.93 : 0.0);

  let ptr = 0;
  let uvPtr = 0;

  for (let iz = 0; iz <= zSegs; iz++) {
    const vz = iz / zSegs;
    const z = lerp(zNear, zFar, vz);

    // 峡谷整体蛇形构造弯曲与宽窄呼吸（保证中央航道与全部机位净空）
    const meander = 2.35 * Math.sin(z * 0.041 + 0.7) + 1.15 * Math.cos(z * 0.089 + 2.1);
    const halfGorge = 9.4 + 2.2 * Math.cos(z * 0.052 + phi1) + 1.1 * Math.sin(z * 0.125 + phi2);

    // 崖顶锯齿峰峦起伏高度（彻底消除水平直线顶边）
    const rimPeakHeight =
      31.5 +
      5.8 * triWave(z * 0.068 + phi1) +
      3.6 * triWave(z * 0.155 + phi2) +
      2.1 * Math.sin(z * 0.31 + phi3);

    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;

      // 沿高度与纵深交错的断层岩阶与纵向冲沟
      const gully = Math.pow(0.5 + 0.5 * Math.cos(z * 0.17 + u * 2.2 + phi2), 2.6);
      const terraceWave =
        0.95 * triWave(u * 19.5 + z * 0.08 + phi1) +
        0.55 * triWave(u * 37.0 - z * 0.14 + phi3);
      const cragJut = 1.65 * triWave(z * 0.22 + u * 5.4 + phi2) + 0.85 * Math.sin(z * 0.43 - u * 8.1 + phi1);

      let absX: number;
      let y: number;

      if (u <= 0.18) {
        // 1) 浸入熔岩河边缘的嶙峋碎石滩岸
        const k = u / 0.18;
        const shoreJagged = 1.35 * triWave(z * 0.28 + phi3) + 0.75 * Math.sin(z * 0.62 + phi1);
        absX = lerp(halfGorge - 1.6, halfGorge + 2.1, k) + shoreJagged * (1.0 - 0.35 * k);
        y = lerp(-6.85, -2.1, Math.pow(k, 0.82)) + 0.45 * terraceWave * k;
      } else if (u <= 0.74) {
        // 2) 多级陡峭黑曜石/玄武岩主断崖与悬挑岩壁
        const k = (u - 0.18) / 0.56;
        // 中段内探悬挑、冲沟内凹，保证 |x| >= 11.5m 留出充裕飞行走廊
        const overhang = Math.sin(k * Math.PI * 2.5 + phi1) * 1.45 - gully * 2.3;
        absX = lerp(halfGorge + 2.1, halfGorge + 10.6, Math.pow(k, 0.88)) + overhang + cragJut * 0.85 + terraceWave * 0.65;
        y = lerp(-2.1, rimPeakHeight, k) + terraceWave * 0.95;
      } else {
        // 3) 锯齿状断崖山脊冠部与远端火山岩台地封闭斜坡
        const k = (u - 0.74) / 0.26;
        const ridgeSpire = (1.0 - k) * (2.8 * Math.max(0, triWave(z * 0.24 + phi3)) + 1.2 * terraceWave);
        absX = lerp(halfGorge + 10.6, 54.0, Math.pow(k, 1.12)) + cragJut * (1.0 - 0.5 * k);
        y = lerp(rimPeakHeight, 17.5, Math.pow(k, 1.35)) + ridgeSpire;
      }

      const worldX = side * absX + meander * (1.0 - 0.45 * u);
      positions[ptr++] = worldX;
      positions[ptr++] = y;
      positions[ptr++] = z;

      uvs[uvPtr++] = u;
      uvs[uvPtr++] = vz;
    }
  }

  // 根据左右侧确保三角面片法线全部朝向峡谷内部与上方（右手法则逆时针正面）
  const stride = uSegs + 1;
  for (let iz = 0; iz < zSegs; iz++) {
    for (let iu = 0; iu < uSegs; iu++) {
      const a = iz * stride + iu;
      const b = a + 1;
      const c = (iz + 1) * stride + iu;
      const d = c + 1;
      if (side < 0) {
        // 左侧岩壁 (x < 0)：正面法线指向 (+X 峡谷内侧, +Y 天顶)
        indices.push(a, c, b, b, c, d);
      } else {
        // 右侧岩壁 (x > 0)：正面法线指向 (-X 峡谷内侧, +Y 天顶)
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 构建棱角碎裂的悬浮火山黑曜石巨砾几何体
 */
function createFracturedBoulderGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.18, 2);
  const pos = geo.attributes.position;
  const p1 = (seed % 73) * 0.086;
  const p2 = ((seed >> 4) % 67) * 0.093;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;

    // 多平面贝壳状断口切削
    const cut1 = triWave(nx * 3.4 + ny * 2.7 + p1);
    const cut2 = triWave(nz * 4.1 - nx * 2.9 + p2);
    const cut3 = triWave(ny * 5.2 + nz * 3.3 - p1);
    const r = 1.0 + 0.19 * cut1 + 0.14 * cut2 + 0.08 * cut3;

    pos.setXYZ(i, x * r, y * r * 0.88, z * r);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * 火山柱状玄武岩与黑曜石共享高精度程序化岩石着色器源码：
 * - 3D 有限差分凹凸微法线（六方柱状节理 + 倾斜火山凝灰岩层理 + 3 阶贝壳状断口裂隙 + 气孔微颗粒）
 * - 四重物理光照（谷底熔金河仰射暖光、日蚀冕环逆光边缘高光、黑曜石玻璃质镜面反光、军鼓闪电瞬态阴影）
 * - 真实顺沿深层构造裂隙流淌的底鼓充能熔岩地脉
 */
const CANYON_ROCK_VERTEX_GLSL = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING
      mat4 instModel = modelMatrix * instanceMatrix;
      vec4 wp = instModel * vec4(position, 1.0);
      vNormal = normalize(mat3(instModel) * normal);
    #else
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vNormal = normalize(mat3(modelMatrix) * normal);
    #endif
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CANYON_ROCK_FRAGMENT_GLSL = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCamPos;
  uniform vec3 uRockDark;
  uniform vec3 uRockMid;
  uniform vec3 uRockLight;
  uniform vec3 uCoronaColor;
  uniform vec3 uMagmaColor;
  uniform vec3 uLightningColor;
  uniform vec3 uFogColor;
  uniform float uKickPulse;
  uniform float uSnareFlash;
  uniform float uDropShock;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

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

  // 多尺度火山柱状玄武岩节理、断层岩阶与贝壳状裂隙高度场（零循环，极速编译）
  float volcanicRockField(vec3 wp, out float ledgeTop, out float creviceOpen, out float fissureCrack) {
    // 1) 大尺度构造断层扭曲，打破任何人工规则重复
    float macroFault = fbm3D(wp * vec3(0.055, 0.038, 0.055) + vec3(3.1, 7.4, 1.9));
    vec3 warped = wp + (macroFault - 0.5) * vec3(5.2, 7.8, 5.2);

    // 2) 纵向柱状玄武岩多边形劈理节理（Columnar Basalt Vertical Joints）
    float colA = 1.0 - abs(noise3D(warped * vec3(0.34, 0.055, 0.34)) * 2.0 - 1.0);
    float colB = 1.0 - abs(noise3D(warped * vec3(0.68, 0.11, 0.68) + vec3(5.4, 2.1, 8.7)) * 2.0 - 1.0);
    float basaltCols = colA * 0.62 + colB * 0.38;

    // 3) 倾斜火山凝灰岩层理与断裂岩阶（Stepped Volcanic Strata）
    float yTilted = warped.y + wp.z * 0.11 - abs(wp.x) * 0.14;
    float bed1 = sin(yTilted * 0.62 + noise3D(wp * 0.21) * 3.8) * 0.5 + 0.5;
    float bed2 = sin(yTilted * 1.48 + noise3D(wp * 0.47 + 4.3) * 4.4) * 0.5 + 0.5;
    float blockMask = smoothstep(0.24, 0.76, noise3D(wp * 0.16 + vec3(8.2, 3.5, 6.1)));
    float steppedStrata = smoothstep(0.20, 0.80, mix(bed1, bed2, blockMask));

    // 4) 锐利黑曜石断口裂隙网（Sharp Conchoidal Fracture Network）
    float r1 = 1.0 - abs(noise3D(warped * vec3(0.26, 0.22, 0.26) + vec3(1.7, 9.2, 4.8)) * 2.0 - 1.0);
    float r2 = 1.0 - abs(noise3D(wp * vec3(0.75, 0.62, 0.75) + macroFault * 3.1) * 2.0 - 1.0);
    float r3 = 1.0 - abs(noise3D(wp * 1.85 + vec3(6.3, 2.8, 9.4)) * 2.0 - 1.0);
    // 裂隙在 r1, r2 峰值处内凹成深缝，其余区域形成坚硬块状岩面
    fissureCrack = pow(clamp(r1 * 0.68 + r2 * 0.32, 0.0, 1.0), 3.6);
    float rockBlocks = basaltCols * 0.52 + steppedStrata * 0.32 + r3 * 0.16 - fissureCrack * 0.55;

    // 5) 高频玄武岩气孔与粗粝矿物颗粒（Volcanic Scoria & Mineral Grain）
    float grain = noise3D(wp * 3.4) * 0.13 + noise3D(wp * 7.8) * 0.065;

    ledgeTop = smoothstep(0.42, 0.84, basaltCols) * (0.40 + 0.60 * steppedStrata);
    creviceOpen = clamp(0.22 + 0.78 * smoothstep(-0.08, 0.62, rockBlocks), 0.15, 1.0);
    return rockBlocks + grain;
  }

  float volcanicReliefOnly(vec3 wp) {
    float lt, co, fc;
    return volcanicRockField(wp, lt, co, fc);
  }

  void main() {
    vec3 toCam = uCamPos - vWorldPos;
    float dist = length(toCam);
    vec3 viewDir = toCam / max(dist, 1e-4);

    // 1) 插值基底法线 + 3D 有限差分微法线，赋予岩壁真实凹凸棱角、层理台阶与粗糙石纹
    vec3 geomN = normalize(vNormal);
    float eps = 0.14;
    float ledgeTop, creviceOpen, fissureCrack;
    float h0 = volcanicRockField(vWorldPos, ledgeTop, creviceOpen, fissureCrack);
    float hx = volcanicReliefOnly(vWorldPos + vec3(eps, 0.0, 0.0));
    float hy = volcanicReliefOnly(vWorldPos + vec3(0.0, eps, 0.0));
    float hz = volcanicReliefOnly(vWorldPos + vec3(0.0, 0.0, eps));
    vec3 grad = vec3(hx - h0, hy - h0, hz - h0) / eps;
    vec3 N = normalize(geomN - grad * 0.92);

    // 2) 多层次火山岩反照率：深邃黑曜石沟壑 -> 风化玄武岩中调 -> 断口矿物亮脊
    float detailVar = fbm3D(vWorldPos * 0.36 + vec3(5.1, 2.3, 8.9));
    float microGrain = fbm3D(vWorldPos * 2.15 + vec3(9.4, 4.1, 3.7));
    float upSlope = smoothstep(0.05, 0.72, N.y);

    vec3 albedo = mix(uRockDark * 0.78, uRockMid * 1.15, creviceOpen * (0.38 + 0.62 * detailVar));
    albedo = mix(albedo, uRockLight * 1.08, ledgeTop * (0.35 + 0.65 * upSlope) * 0.68);
    // 近熔岩河岸边缘的焦黑热蚀湿润黑曜石带
    float shoreGlass = smoothstep(1.5, -5.8, vWorldPos.y + (detailVar - 0.5) * 2.2);
    albedo = mix(albedo, uRockDark * 0.52, shoreGlass * 0.58);
    albedo *= (0.76 + 0.48 * microGrain);

    float creviceAO = clamp(creviceOpen * (0.52 + 0.48 * detailVar), 0.16, 1.0);

    // 3) 四重物理峡谷照明
    // (a) 苍穹日全食冕环主逆光 + 黑曜石玻璃质断口高光（来自 (0, 36, -120)）
    vec3 coronaPos = vec3(0.0, 36.0, -120.0);
    vec3 coronaDir = normalize(coronaPos - vWorldPos);
    float nDotCorona = max(dot(N, coronaDir), 0.0);
    vec3 halfCorona = normalize(coronaDir + viewDir);
    float roughnessMask = mix(0.35, 1.0, ledgeTop * 0.6 + shoreGlass * 0.4);
    float obsidianSpec = pow(max(dot(N, halfCorona), 0.0), 28.0) * roughnessMask;
    vec3 coronaLit = uCoronaColor * (
      albedo * nDotCorona * (0.95 + 0.55 * uDropShock) +
      obsidianSpec * (0.34 + 0.45 * uDropShock + 0.18 * uKickPulse)
    );

    // (b) 谷底液态熔金河仰射暖光与热浪焦散（照亮悬挑岩壁下表面与内侧峭壁）
    vec3 magmaOrigin = vec3(0.0, -6.2, vWorldPos.z);
    vec3 magmaDir = normalize(magmaOrigin - vWorldPos);
    // magmaDir 由岩壁表面指向谷底熔岩河光源，朝内与朝下的悬挑岩面 dot(N, magmaDir) > 0 获得强烈熔金仰射暖光
    float nDotMagma = max(dot(N, magmaDir), 0.0);
    float magmaHeightFalloff = exp(-max(0.0, vWorldPos.y + 5.8) * 0.075);
    float magmaRadialFalloff = exp(-max(0.0, abs(vWorldPos.x) - 8.0) * 0.055);
    float heatFlicker = 0.78 + 0.22 * sin(vWorldPos.z * 0.24 - uTime * 2.8 + detailVar * 5.0);
    vec3 magmaBounce = uMagmaColor * (albedo * 1.45 + vec3(0.08)) *
      nDotMagma * magmaHeightFalloff * magmaRadialFalloff * heatFlicker * (1.15 + 0.75 * uKickPulse);

    // (c) 天顶暗夜环境散射光（保留岩壁背光面丰富冷暗体块层次，绝不死黑）
    float skyExpose = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 skyAmb = mix(uRockDark * 0.55, uRockMid * 0.72, skyExpose) * albedo * 1.65;

    // (d) 军鼓劈落闪电瞬态强侧顶光（立体照亮岩石棱面并留出深邃裂隙暗部）
    vec3 boltDir = normalize(vec3(-sign(vWorldPos.x + 0.001) * 0.45, 0.78, -0.42));
    float nDotBolt = max(dot(N, boltDir), 0.0);
    float boltSpec = pow(max(dot(N, normalize(boltDir + viewDir)), 0.0), 18.0);
    vec3 lightningLit = uLightningColor * uSnareFlash * (albedo * nDotBolt * 2.4 + boltSpec * 0.55);

    // (e) 掠射轮廓边缘光（分离层叠交错的前后玄武岩柱）
    float fresnelRim = pow(clamp(1.0 - max(dot(viewDir, N), 0.0), 0.0, 1.0), 2.8);
    vec3 rimGlow = mix(uCoronaColor, uRockLight, 0.45) * fresnelRim * (0.22 + 0.28 * nDotCorona + 0.30 * uDropShock);

    vec3 rockLit = (skyAmb + coronaLit + magmaBounce + lightningLit) * creviceAO + rimGlow * creviceAO;

    // 4) 嵌于真实深层岩石裂隙中的炽热大地熔岩脉络（摒弃虚假正弦网格）
    float lowWallMask = smoothstep(26.0, -5.5, vWorldPos.y);
    float veinSurge = 0.5 + 0.5 * sin(vWorldPos.z * 0.16 - uTime * 9.5 + detailVar * 6.28318);
    float activeFissure = smoothstep(0.42, 0.88, fissureCrack) * lowWallMask * smoothstep(0.28, 0.75, detailVar);
    float veinHeat = activeFissure * (0.32 + 1.55 * uKickPulse * veinSurge + 0.95 * uDropShock);
    vec3 veinEmission = mix(uMagmaColor, uCoronaColor, 0.25 * veinSurge) * veinHeat * 1.45;

    vec3 col = rockLit + veinEmission;

    // 5) 峡谷纵深大气雾效与谷底热霾自然融合
    float fogFactor = 1.0 - exp(-pow(dist * 0.0072, 1.85));
    vec3 horizonMist = mix(uFogColor, uCoronaColor * 0.14, smoothstep(-55.0, -140.0, vWorldPos.z));
    horizonMist += uMagmaColor * 0.07 * exp(-max(0.0, vWorldPos.y + 4.0) * 0.14);
    col = mix(col, horizonMist, clamp(fogFactor, 0.0, 0.94));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class EclipseScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.1, 380);
  private rig: LyricRig;

  // 预烘焙音频事件
  private kickTimes: Float64Array;
  private kickAmps: Float32Array;
  private snareTimes: Float64Array;
  private snareAmps: Float32Array;
  private downbeatTimes: Float64Array;

  // 场景网格与材质
  private moonMesh: THREE.Mesh;
  private moonMaterial: THREE.ShaderMaterial;
  private coronaMesh: THREE.Mesh;
  private coronaMaterial: THREE.ShaderMaterial;
  private magmaRiverMesh: THREE.Mesh;
  private magmaRiverMaterial: THREE.ShaderMaterial;
  readonly canyonGroup = new THREE.Group();
  readonly canyonWallsMesh!: THREE.Mesh;
  readonly canyonMaterial!: THREE.ShaderMaterial;
  readonly boulderMaterial!: THREE.ShaderMaterial;
  readonly rocksInstanced: THREE.InstancedMesh;
  private rockStates: RockInitState[] = [];
  private lightningLines: THREE.LineSegments;
  readonly lightningMaterial: THREE.LineBasicMaterial;
  readonly shockwaveRingMesh: THREE.Mesh;
  private shockwaveMaterial: THREE.ShaderMaterial;
  private reusableDummy = new THREE.Object3D();

  // 色彩基调（严格遵循 R5 同色系微调与黑白中性灰保护规范）
  readonly colorCorona: THREE.Color;
  readonly colorMagma: THREE.Color;
  readonly colorObsidian: THREE.Color;
  readonly colorRockMid: THREE.Color;
  readonly colorRockLight: THREE.Color;
  readonly colorLightning: THREE.Color;

  private uniforms: {
    uTime: { value: number };
    uCamPos: { value: THREE.Vector3 };
    uCover: { value: THREE.Texture };
    uKickPulse: { value: number };
    uSnareFlash: { value: number };
    uDropShock: { value: number };
    uCoronaColor: { value: THREE.Color };
    uMagmaColor: { value: THREE.Color };
    uRockDark: { value: THREE.Color };
    uRockMid: { value: THREE.Color };
    uRockLight: { value: THREE.Color };
    uLightningColor: { value: THREE.Color };
    uFogColor: { value: THREE.Color };
  };

  constructor(private init: SceneInit, _look?: string) {
    // 1. 色彩提取与微调（严格遵循 R5 规则与黑白中性灰 S <= 0.05 保护）
    const tone = extractCoverTone(init);
    const isMono = tone.mono || init.palette.mono;
    const seed = init.seed ?? 1001;
    const seedRand = rng((seed ^ 0x66cc4422) >>> 0);
    const deltaHue = isMono ? 0 : (seedRand() < 0.5 ? -1 : 1) * (6 + 10 * seedRand());

    const stopCorona = tuneCoverStop(tone.highlight, tone, 0.65, 0.96, 0.60, 0.98, deltaHue);
    const stopMagma = tuneCoverStop(tone.bright, tone, 0.50, 0.85, 0.70, 0.98, deltaHue);
    const stopDeep = tuneCoverStop(tone.dark, tone, 0.06, 0.15, 0.14, 0.45, deltaHue);
    const stopMid = tuneCoverStop(tone.mid, tone, 0.18, 0.30, 0.12, 0.42, deltaHue);
    const stopRimRock = tuneCoverStop(tone.highlight, tone, 0.38, 0.56, 0.14, 0.45, deltaHue);

    this.colorCorona = isMono ? colorFromHsl(0, 0, stopCorona.l) : colorFromHsl(stopCorona.h, stopCorona.s, stopCorona.l);
    this.colorMagma = isMono ? colorFromHsl(0, 0, stopMagma.l) : colorFromHsl(stopMagma.h, stopMagma.s, stopMagma.l);
    this.colorObsidian = isMono ? colorFromHsl(0, 0, stopDeep.l) : colorFromHsl(stopDeep.h, stopDeep.s * 0.65, stopDeep.l);
    this.colorRockMid = isMono ? colorFromHsl(0, 0, stopMid.l) : colorFromHsl(stopMid.h, stopMid.s * 0.55, stopMid.l);
    this.colorRockLight = isMono ? colorFromHsl(0, 0, stopRimRock.l) : colorFromHsl(stopRimRock.h, stopRimRock.s * 0.50, stopRimRock.l);
    this.colorLightning = isMono
      ? colorFromHsl(0, 0.0, 0.92)
      : colorFromHsl(stopCorona.h, 0.45, 0.92);

    const fogColor = this.colorObsidian.clone().multiplyScalar(0.36);
    this.scene.background = fogColor;
    this.scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0075);

    // 2. 音频事件预烘焙
    const { music } = init;
    const kicks = music.a.hits.kick ?? [];
    const snares = music.a.hits.snare ?? [];
    const downbeats = music.a.downbeats;

    const kLen = kicks.length;
    this.kickTimes = new Float64Array(kLen);
    this.kickAmps = new Float32Array(kLen);
    for (let i = 0; i < kLen; i++) {
      this.kickTimes[i] = kicks[i][0];
      this.kickAmps[i] = kicks[i][1];
    }
    const sLen = snares.length;
    this.snareTimes = new Float64Array(sLen);
    this.snareAmps = new Float32Array(sLen);
    for (let i = 0; i < sLen; i++) {
      this.snareTimes[i] = snares[i][0];
      this.snareAmps[i] = snares[i][1];
    }
    this.downbeatTimes = new Float64Array(downbeats.length);
    for (let i = 0; i < downbeats.length; i++) this.downbeatTimes[i] = downbeats[i];

    // 3. 着色器共享 Uniforms
    this.uniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3(0, 4.5, 12) },
      uCover: { value: init.cover },
      uKickPulse: { value: 0 },
      uSnareFlash: { value: 0 },
      uDropShock: { value: 0 },
      uCoronaColor: { value: this.colorCorona },
      uMagmaColor: { value: this.colorMagma },
      uRockDark: { value: this.colorObsidian },
      uRockMid: { value: this.colorRockMid },
      uRockLight: { value: this.colorRockLight },
      uLightningColor: { value: this.colorLightning },
      uFogColor: { value: fogColor },
    };

    // 4. 苍穹日全食月轮与玄武岩蚀刻浮雕封面 (Embossed Lunar Basalt Disc at Z = -120m, Y = 36m)
    const moonRadius = 14.5;
    const moonGeo = new THREE.CircleGeometry(moonRadius, 64);
    this.moonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCover: this.uniforms.uCover,
        uTime: this.uniforms.uTime,
        uCoronaColor: this.uniforms.uCoronaColor,
        uRockDark: this.uniforms.uRockDark,
        uDropShock: this.uniforms.uDropShock,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uCover;
        uniform float uTime;
        uniform vec3 uCoronaColor;
        uniform vec3 uRockDark;
        uniform float uDropShock;
        varying vec2 vUv;

        void main() {
          vec2 p = vUv - vec2(0.5);
          float r = length(p) * 2.0;
          // 保持原封面空间拓扑结构，叠加微妙的月表环形山暗调浮雕与日冕内缘背光
          vec3 coverRgb = texture2D(uCover, vUv).rgb;
          float lum = dot(coverRgb, vec3(0.299, 0.587, 0.114));
          float limbBacklight = smoothstep(0.76, 1.0, r);
          vec3 baseDisc = uRockDark * 0.26 + coverRgb * (0.11 + 0.05 * uDropShock) + vec3(lum * 0.035);
          vec3 col = baseDisc + uCoronaColor * limbBacklight * (0.24 + 0.25 * uDropShock);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, this.moonMaterial);
    this.moonMesh.position.set(0, 36, -120);
    this.scene.add(this.moonMesh);

    // 5. 狂暴日冕能量环与贝利珠耀斑 (Solar Corona Ring & Baily's Beads)
    const coronaGeo = new THREE.RingGeometry(moonRadius * 0.97, moonRadius * 2.85, 72);
    this.coronaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCoronaColor: this.uniforms.uCoronaColor,
        uDropShock: this.uniforms.uDropShock,
        uKickPulse: this.uniforms.uKickPulse,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCoronaColor;
        uniform float uDropShock;
        uniform float uKickPulse;
        varying vec2 vUv;

        void main() {
          vec2 d = vUv - vec2(0.5);
          float r = length(d) * 2.0;
          float angle = atan(d.y, d.x);

          // 多频日冕等离子羽流丝缕
          float streamer = sin(angle * 12.0 + uTime * 2.2) * 0.15
                         + sin(angle * 27.0 - uTime * 3.6) * 0.08
                         + cos(angle * 43.0 + uTime * 1.4) * 0.04;
          float innerEdge = smoothstep(0.32, 0.37 + streamer * 0.09, r);
          float outerFalloff = pow(smoothstep(1.0, 0.36, r), 1.45);

          // Drop 瞬间边缘迸发贝利珠钻石环耀斑 (Baily's Beads)
          float beads = pow(max(0.0, sin(angle * 16.0 + uTime * 0.5)), 32.0) * uDropShock * 3.5;

          float intensity = innerEdge * outerFalloff * (1.25 + 0.65 * uKickPulse + 2.0 * uDropShock) + beads;
          vec3 col = uCoronaColor * (1.05 + beads * 1.5);

          gl_FragColor = vec4(col, clamp(intensity * 0.86, 0.0, 1.0));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.coronaMesh = new THREE.Mesh(coronaGeo, this.coronaMaterial);
    this.coronaMesh.position.set(0, 36, -119.8);
    this.scene.add(this.coronaMesh);

    // 6. 谷底结壳板块液态熔金河 (Crust-Plated Molten Magma River at Y = -6.0m)
    const riverGeo = new THREE.PlaneGeometry(34, 190, 40, 80);
    this.magmaRiverMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCamPos: this.uniforms.uCamPos,
        uMagmaColor: this.uniforms.uMagmaColor,
        uCoronaColor: this.uniforms.uCoronaColor,
        uRockDark: this.uniforms.uRockDark,
        uFogColor: this.uniforms.uFogColor,
        uKickPulse: this.uniforms.uKickPulse,
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
        uniform vec3 uMagmaColor;
        uniform vec3 uCoronaColor;
        uniform vec3 uRockDark;
        uniform vec3 uFogColor;
        uniform float uKickPulse;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise2D(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
            mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        float fbm2D(vec2 p) {
          float v = 0.0;
          v += 0.52 * noise2D(p); p = p * 2.09 + vec2(7.3, 3.1);
          v += 0.27 * noise2D(p); p = p * 2.15 + vec2(2.9, 11.7);
          v += 0.14 * noise2D(p); p = p * 2.05 + vec2(9.1, 5.4);
          v += 0.07 * noise2D(p);
          return v;
        }

        void main() {
          // 随峡谷蜿蜒的主熔岩河道中心线
          float meander = 2.35 * sin(vWorldPos.z * 0.041 + 0.7) + 1.15 * cos(vWorldPos.z * 0.089 + 2.1);
          float bankDist = abs(vWorldPos.x - meander);

          // 双层对流扭曲：模拟黑色凝固玄武岩浮渣结壳与炽白/金红撕裂熔岩缝隙
          vec2 flowUv = vec2(vWorldPos.x * 0.24, vWorldPos.z * 0.14 - uTime * 0.42);
          float warp = fbm2D(flowUv * 0.85 + vec2(0.0, -uTime * 0.18));
          float ridge1 = 1.0 - abs(noise2D(flowUv * 1.8 + warp * 2.6) * 2.0 - 1.0);
          float ridge2 = 1.0 - abs(noise2D(flowUv * 3.9 - warp * 1.9 + vec2(4.2, uTime * 0.25)) * 2.0 - 1.0);
          float slagGrain = fbm2D(flowUv * 7.5);

          // 河道中央高温翻涌，靠近两岸冷却结壳加厚
          float centerHeat = smoothstep(10.5, 1.8, bankDist);
          float fissure = pow(clamp(ridge1 * 0.68 + ridge2 * 0.32, 0.0, 1.0), 2.4) * (0.45 + 0.75 * centerHeat);

          vec3 cooledCrust = uRockDark * (0.35 + 0.55 * slagGrain);
          vec3 hotCore = mix(uMagmaColor, uCoronaColor, clamp(fissure * 0.55, 0.0, 0.65)) * (1.75 + 0.95 * uKickPulse);
          vec3 col = mix(cooledCrust, hotCore, smoothstep(0.18, 0.72, fissure + centerHeat * 0.22));

          // 远景热霾雾化收敛
          float dist = length(vWorldPos - uCamPos);
          float fogFactor = 1.0 - exp(-pow(dist * 0.0072, 1.85));
          col = mix(col, uFogColor + uMagmaColor * 0.06, clamp(fogFactor, 0.0, 0.95));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.magmaRiverMesh = new THREE.Mesh(riverGeo, this.magmaRiverMaterial);
    this.magmaRiverMesh.rotation.x = -Math.PI / 2;
    this.magmaRiverMesh.position.set(0, -6.0, -62);
    this.scene.add(this.magmaRiverMesh);

    // 7. 构建蜿蜒分层的火山黑曜石/柱状玄武岩大裂谷两侧峭壁与凸出岩柱群
    const rockShaderConfig = {
      uniforms: this.uniforms,
      vertexShader: CANYON_ROCK_VERTEX_GLSL,
      fragmentShader: CANYON_ROCK_FRAGMENT_GLSL,
    };
    this.canyonMaterial = new THREE.ShaderMaterial(rockShaderConfig);
    this.boulderMaterial = new THREE.ShaderMaterial(rockShaderConfig);

    this.canyonWallsMesh = this.buildCanyonWalls(seed);
    this.scene.add(this.canyonGroup);

    // 8. 悬浮反重力碎裂黑曜石巨砾 (Textured Anti-gravity Fractured Obsidian Boulders)
    const rockGeo = createFracturedBoulderGeometry(seed ^ 0x51a9);
    this.rocksInstanced = new THREE.InstancedMesh(rockGeo, this.boulderMaterial, NUM_FLOATING_ROCKS);
    this.rocksInstanced.frustumCulled = false;
    for (let i = 0; i < NUM_FLOATING_ROCKS; i++) {
      const rx = (seedRand() < 0.5 ? -1 : 1) * (5.2 + seedRand() * 7.2);
      const ry = 0.2 + seedRand() * 23.0;
      const rz = -12.0 - seedRand() * 92.0;
      const baseScale = 0.72 + seedRand() * 1.55;
      this.rockStates.push({
        x: rx,
        y: ry,
        z: rz,
        scaleX: baseScale * (0.82 + seedRand() * 0.42),
        scaleY: baseScale * (0.70 + seedRand() * 0.55),
        scaleZ: baseScale * (0.82 + seedRand() * 0.42),
        rotSpeed: 0.16 + seedRand() * 0.34,
        phase: seedRand() * Math.PI * 2,
      });
    }
    this.scene.add(this.rocksInstanced);

    // 9. 军鼓劈落分叉闪电电弧 (Snare Branched Lightning Strikes)
    const lightningGeo = new THREE.BufferGeometry();
    const lPos: number[] = [];
    for (let side = -1; side <= 1; side += 2) {
      let curX = side * 1.5;
      let curY = 36.0;
      let curZ = -116.0;
      for (let s = 0; s < 14; s++) {
        const nextX = curX + side * (0.85 + seedRand() * 2.1);
        const nextY = curY - (2.3 + seedRand() * 1.4);
        const nextZ = curZ + (5.2 + seedRand() * 3.6);
        lPos.push(curX, curY, curZ, nextX, nextY, nextZ);
        // 局部次级分叉电弧
        if (s % 3 === 1) {
          const bx = nextX + side * (1.8 + seedRand() * 2.6);
          const by = nextY - (2.0 + seedRand() * 2.2);
          const bz = nextZ + (1.5 + seedRand() * 2.5);
          lPos.push(nextX, nextY, nextZ, bx, by, bz);
        }
        curX = nextX;
        curY = nextY;
        curZ = nextZ;
      }
    }
    lightningGeo.setAttribute('position', new THREE.Float32BufferAttribute(lPos, 3));
    this.lightningMaterial = new THREE.LineBasicMaterial({
      color: this.colorLightning,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lightningLines = new THREE.LineSegments(lightningGeo, this.lightningMaterial);
    this.scene.add(this.lightningLines);

    // 10. Drop 日冕冲击波环 (Corona Shockwave Ring)
    const shockGeo = new THREE.RingGeometry(1.0, 3.5, 48);
    this.shockwaveMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uDropShock: this.uniforms.uDropShock,
        uCoronaColor: this.uniforms.uCoronaColor,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDropShock;
        uniform vec3 uCoronaColor;
        varying vec2 vUv;
        void main() {
          float rim = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float alpha = pow(max(0.0, rim), 2.0) * uDropShock;
          gl_FragColor = vec4(uCoronaColor * 2.0, alpha * 0.85);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.shockwaveRingMesh = new THREE.Mesh(shockGeo, this.shockwaveMaterial);
    this.shockwaveRingMesh.position.set(0, 36, -119);
    this.scene.add(this.shockwaveRingMesh);

    // 11. 歌词
    this.rig = new LyricRig(init.palette, 'hook');
    this.scene.add(this.rig.group);
  }

  /**
   * 构建双侧连续雕刻峡谷断崖 + 22 座交错凸出的柱状玄武岩峭壁巨柱与天际峡门峰林
   */
  private buildCanyonWalls(seed: number): THREE.Mesh {
    const leftGeo = createSculptedChasmSideGeometry(-1, seed ^ 0x1357);
    const rightGeo = createSculptedChasmSideGeometry(1, seed ^ 0x2468);

    const leftWall = new THREE.Mesh(leftGeo, this.canyonMaterial);
    const rightWall = new THREE.Mesh(rightGeo, this.canyonMaterial);
    this.canyonGroup.add(leftWall, rightWall);

    // 3 种不同高宽比的无缝雕刻玄武岩柱原型，沿峡谷纵深错落排布形成真实遮挡视差与锯齿剪影
    const buttressGeos = [
      createBasaltButtressGeometry(4.6, 36.0, 5.4, 0.22, seed ^ 0x1111),
      createBasaltButtressGeometry(5.8, 42.0, 6.8, 0.28, seed ^ 0x2222),
      createBasaltButtressGeometry(3.8, 29.0, 4.5, 0.18, seed ^ 0x3333),
    ];

    const cliffRand = rng((seed ^ 0x99ef3311) >>> 0);
    const numPairs = 10;
    for (let i = 0; i < numPairs; i++) {
      const zBase = 14.0 - i * 14.8;
      for (const side of [-1, 1] as const) {
        const z = zBase - cliffRand() * 5.5;
        const meander = 2.35 * Math.sin(z * 0.041 + 0.7) + 1.15 * Math.cos(z * 0.089 + 2.1);
        const distFromCenter = 14.2 + cliffRand() * 6.8;
        const hScale = 0.82 + cliffRand() * 0.46;
        const wScale = 0.85 + cliffRand() * 0.38;

        const geo = buttressGeos[(i + (side > 0 ? 1 : 0)) % buttressGeos.length];
        const monolith = new THREE.Mesh(geo, this.canyonMaterial);
        monolith.position.set(
          side * distFromCenter + meander * 0.75,
          9.5 + (hScale - 0.85) * 14.0,
          z,
        );
        monolith.rotation.y = cliffRand() * Math.PI * 2;
        // 略微向峡谷内倾或外耸，营造险峻压迫感同时绝不侵入中央航道
        monolith.rotation.z = -side * (0.03 + cliffRand() * 0.07);
        monolith.scale.set(wScale, hScale, wScale);
        this.canyonGroup.add(monolith);
      }
    }

    // 远端夹峙日全食天穹的巨型玄武岩峡门双峰（Z = -112m）
    const gateGeo = createBasaltButtressGeometry(8.2, 54.0, 9.5, 0.34, seed ^ 0x77aa);
    for (const side of [-1, 1] as const) {
      const gatePeak = new THREE.Mesh(gateGeo, this.canyonMaterial);
      gatePeak.position.set(side * 25.5, 19.0, -112.0);
      gatePeak.rotation.y = side > 0 ? 0.8 : 2.3;
      gatePeak.rotation.z = -side * 0.08;
      this.canyonGroup.add(gatePeak);
    }

    return leftWall;
  }

  /** 四组电影级运镜机位（canyon / corona / ridge / abyss）纯函数姿态求值 */
  private evalCameraPose(t: number, s: Shot, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const start = s.run?.start ?? s.start;
    const end = s.run?.end ?? s.end;
    const span = Math.max(0.8, end - start);
    const k = clamp01((t - start) / span);
    const e = inOutCubic(k);
    const dir = (stableShotSeed(s) & 1) === 0 ? 1 : -1;
    const variant = s.variant || 'canyon';

    if (variant === 'corona') {
      // 低机位大仰角穿透悬浮巨石直指日蚀天穹
      const x = lerp(-3.2 * dir, 3.2 * dir, e);
      const y = 1.45 + 0.08 * Math.sin(t * 0.4);
      const z = lerp(-15.0, -28.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 34.0, -120.0);
      return CAM_FOV + 2.0;
    } else if (variant === 'ridge') {
      // 悬停于高位嶙峋断崖内侧边缘（避开岩体穿模），俯瞰深渊熔金河与对岸层叠柱状玄武岩壁
      const x = lerp(8.6 * dir, 6.4 * dir, e);
      const y = lerp(22.5, 18.2, e);
      const z = lerp(-24.0, -42.0, e);
      poseLookAt(pos, quat, x, y, z, -2.5 * dir, 9.5, -96.0);
      return CAM_FOV - 2.0;
    } else if (variant === 'abyss') {
      // 深渊仰攻机位，贴近沸腾结壳熔金河面，仰望两侧刀削斧劈的黑曜石断崖与闪电
      const x = lerp(-2.0 * dir, 2.0 * dir, e);
      const y = -3.8 + 0.05 * Math.sin(t * 0.6);
      const z = lerp(-8.0, -22.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 18.5, -88.0);
      return CAM_FOV + 4.0;
    } else {
      // canyon: 穿梭于蜿蜒黑曜石大裂谷中轴（默认）
      const x = lerp(-1.4 * dir, 1.4 * dir, e);
      const y = 4.6 + 0.10 * Math.sin(t * 0.35);
      const z = lerp(12.0, -8.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 24.5, -120.0);
      return CAM_FOV;
    }
  }

  /** 同场景切点纯函数相机平滑过渡 */
  private updateCamera(t: number, shot: Shot): void {
    blendCameraPose(
      (tau, s, pos, quat) => this.evalCameraPose(tau, s, pos, quat),
      t,
      shot,
      this.camera,
      1.45,
    );
  }

  /** 二分查找单脉冲衰减响应 */
  private evalPulse(times: Float64Array, vals: Float32Array, t: number, decay: number): number {
    const i = lastIndex(times, t);
    if (i < 0) return 0;
    const one = (idx: number) => {
      if (idx < 0) return 0;
      const age = t - times[idx];
      if (age < 0 || age > decay * 4.5) return 0;
      const v = vals[idx];
      if (age < 0.02) return v * (age / 0.02);
      return v * Math.exp(-(age - 0.02) / decay);
    };
    return Math.max(one(i), one(i - 1));
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, fx } = ctx;
    const curSec = music.section(t);
    const label = curSec?.label ?? shot.section.label;
    const isDrop = label === 'drop';
    const isChorus = label === 'chorus';

    // 1. 相机更新并同步世界坐标至岩石与熔岩着色器
    this.updateCamera(t, shot);
    this.uniforms.uCamPos.value.copy(this.camera.position);

    // 2. 音频包络与瞬态
    const kickPulse = this.evalPulse(this.kickTimes, this.kickAmps, t, 0.24);
    const snareFlash = this.evalPulse(this.snareTimes, this.snareAmps, t, 0.16);

    // Drop 冲击波强度
    let dropShock = 0;
    if (isDrop && curSec) {
      const dropAge = t - curSec.start;
      if (dropAge >= 0 && dropAge < 2.5) {
        dropShock = Math.exp(-dropAge / 0.75);
      }
    }

    // 3. 更新悬浮反重力碎裂黑曜石巨砾（底鼓高频震颤与 Drop 冲击波向外推开）
    const dummy = this.reusableDummy;
    for (let i = 0; i < NUM_FLOATING_ROCKS; i++) {
      const rs = this.rockStates[i];
      const kickJolt = Math.sin(t * 32.0 + i) * 0.35 * kickPulse;
      const pushX = (rs.x > 0 ? 1 : -1) * dropShock * 3.5;
      const y = rs.y + Math.sin(t * 0.8 + rs.phase) * 0.6 + kickJolt;

      dummy.position.set(rs.x + pushX, y, rs.z);
      dummy.rotation.set(t * rs.rotSpeed, t * rs.rotSpeed * 0.8, rs.phase);
      dummy.scale.set(rs.scaleX, rs.scaleY, rs.scaleZ);
      dummy.updateMatrix();
      this.rocksInstanced.setMatrixAt(i, dummy.matrix);
    }
    this.rocksInstanced.instanceMatrix.needsUpdate = true;

    // 4. 更新军鼓闪电劈落电弧透明度
    this.lightningMaterial.opacity = clamp01(snareFlash * 1.5);

    // 5. 更新 Drop 日冕冲击波环尺度（严格幂等归一）
    const shockScale = dropShock > 0.001 ? 1.0 + (1.0 - dropShock) * 22.0 : 1.0;
    this.shockwaveRingMesh.scale.set(shockScale, shockScale, 1.0);

    // 6. 全局 Uniforms
    this.uniforms.uTime.value = t;
    this.uniforms.uKickPulse.value = kickPulse;
    this.uniforms.uSnareFlash.value = snareFlash;
    this.uniforms.uDropShock.value = dropShock;

    // 7. 后期调优
    fx.bloom = 0.32 + 0.18 * dropShock + 0.10 * snareFlash;
    fx.vignette = 0.46;
    fx.letterbox = 0;

    // 8. 歌词
    const energy = isDrop ? 1.0 : isChorus ? 0.88 : 0.50;
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
