// 千灯天阙 (Pavilion): 3D 国风与国潮电音大场面。
// 适配曲风：国风电音 (Guofeng EDM), 大气古风 (Epic Traditional), 戏腔燃曲 (Opera Electronic)。
// 100% 确定性纯时间函数 f(t) 驱动，零累积状态，支持任意 seek 与离线 MP4 导出。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex } from '../director/music.ts';
import { colorFromHsl, extractCoverTone, tuneCoverStop } from './coverTone.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';

const PAVILION_Z = -32.0;
const POOL_RADIUS = 13.5;
const NUM_STRINGS = 7;
const NUM_KOI = 12;
const NUM_FIREFLIES = 180;
const NUM_AMBIENT_SKY_LANTERNS = 260;
const MAX_RELEASED_SKY_LANTERNS = 160;
const MAX_SKY_LANTERNS = NUM_AMBIENT_SKY_LANTERNS + MAX_RELEASED_SKY_LANTERNS;
const SKY_LANTERN_LIFE = 34.0;
const NUM_LOTUS_LANTERNS = 32;
const CAM_FOV = 46;

interface KoiState {
  speed: number;
  phase: number;
  radiusX: number;
  radiusZ: number;
  yBase: number;
  scale: number;
  seed: number;
  pattern: number;
}

/** 常驻环绕云海与天阙的孔明灯纯函数轨道参数 */
interface AmbientSkyLanternSpec {
  baseX: number;
  baseZ: number;
  ySpan: number;
  yMin: number;
  speed: number;
  phaseOffset: number;
  swayAmp: number;
  swayFreq: number;
  size: number;
  seed: number;
}

/** 随人声字词、旋律重音实时点亮放飞的孔明灯事件 */
interface ReleasedSkyLanternEvent {
  t0: number;
  x0: number;
  y0: number;
  z0: number;
  riseSpeed: number;
  windX: number;
  windZ: number;
  size: number;
  seed: number;
}

/** 飞檐与池栏古典六角宫灯挂点参数 */
interface PalaceLanternAnchor {
  gx: number;
  gy: number;
  gz: number;
  scale: number;
  chainLen: number;
  phase: number;
  inPavilionGroup: boolean;
}

/** 天池盛开莲花河灯参数 */
interface LotusLanternSpec {
  radius: number;
  angle0: number;
  omega: number;
  scale: number;
  seed: number;
}

/**
 * 构建传统八棱微弧束腰孔明灯（天灯）三维立体网格 + 底口内部双交叉跃动火苗芯
 * uv.y >= 0 表示熟宣灯罩表面 (0..1 自底口向灯顶)，uv.y < 0 表示内部明火烛芯 (-1..0)
 */
function createSkyLanternGeometry(): THREE.BufferGeometry {
  const radialSegs = 16;
  const heightSegs = 12;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 传统孔明灯修长宽肩轮廓：底口竹圈微敛 -> 高挺宽肩 -> 顶部圆拱收拢
  const profileRadius = (v: number): number => {
    if (v < 0.76) {
      const k = v / 0.76;
      return 0.225 + 0.170 * Math.pow(k, 0.86) + 0.018 * Math.sin(k * Math.PI);
    }
    const k = (v - 0.76) / 0.24;
    return 0.395 * Math.cos(k * Math.PI * 0.496);
  };

  const heightScale = 1.38;

  for (let iy = 0; iy <= heightSegs; iy++) {
    const v = iy / heightSegs;
    const baseR = profileRadius(v);
    const y = (v - 0.42) * heightScale;

    // 数值导数求切向以计算精确曲面法线
    const dv = 0.005;
    const rPrev = profileRadius(Math.max(0, v - dv));
    const rNext = profileRadius(Math.min(1, v + dv));
    const drDy = (rNext - rPrev) / (2 * dv * heightScale);

    for (let ix = 0; ix <= radialSegs; ix++) {
      const u = ix / radialSegs;
      const theta = u * Math.PI * 2;
      // 八根竹篾撑起的微妙棱弧立体感
      const ribBulge = 1.0 + 0.022 * Math.cos(theta * 8.0) * Math.sin(v * Math.PI);
      const r = baseR * ribBulge;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      positions.push(cosT * r, y, sinT * r);

      const nx = cosT;
      const ny = -drDy;
      const nz = sinT;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / nLen, ny / nLen, nz / nLen);
      uvs.push(u, v);
    }
  }

  const stride = radialSegs + 1;
  for (let iy = 0; iy < heightSegs; iy++) {
    for (let ix = 0; ix < radialSegs; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = (iy + 1) * stride + ix;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // 底口内部十字交叉立体明火烛芯面片（正反双绕序索引兼容 FrontSide，消除宣纸灯罩背面半透明暗壳）
  const flamePlanes = [0, Math.PI * 0.5];
  const flameW = 0.135;
  const flameH = 0.34;
  const flameBottomY = -0.45 * heightScale;
  for (const ang of flamePlanes) {
    const baseIdx = positions.length / 3;
    const cx = Math.cos(ang) * flameW;
    const cz = Math.sin(ang) * flameW;
    const nx = -Math.sin(ang);
    const nz = Math.cos(ang);

    positions.push(
      -cx, flameBottomY, -cz,
      cx, flameBottomY, cz,
      -cx, flameBottomY + flameH, -cz,
      cx, flameBottomY + flameH, cz,
    );
    for (let k = 0; k < 4; k++) normals.push(nx, 0, nz);
    uvs.push(0, -1.02, 1, -1.02, 0, -0.02, 1, -0.02);
    indices.push(
      baseIdx, baseIdx + 1, baseIdx + 2,
      baseIdx + 2, baseIdx + 1, baseIdx + 3,
      baseIdx, baseIdx + 2, baseIdx + 1,
      baseIdx + 1, baseIdx + 2, baseIdx + 3,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * 构建古典六角鎏金宫灯三维几何体：
 * - uv.y in [0.0, 1.0]: 六面熟绢灯罩主体（带中心烛芯透射与团花云纹）
 * - uv.y in [1.1, 1.9]: 深朱漆描金飞檐攒尖上灯冠、须弥下灯座与六道立体楠木雕花立骨
 * - uv.y in [-1.2, -0.05]: 灯底垂坠的宫绦金红丝穗流苏（随风柔性摆动）
 */
function createPalaceLanternGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const tagUvY = (g: THREE.BufferGeometry, yMin: number, yMax: number): THREE.BufferGeometry => {
    const nonIdx = g.index ? g.toNonIndexed() : g;
    const pos = nonIdx.attributes.position;
    if (!nonIdx.attributes.normal) nonIdx.computeVertexNormals();
    const uvArr = new Float32Array(pos.count * 2);
    const origUv = nonIdx.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = origUv ? origUv.getX(i) : 0.5;
      const v = origUv ? origUv.getY(i) : 0.5;
      uvArr[i * 2] = u;
      uvArr[i * 2 + 1] = lerp(yMin, yMax, v);
    }
    nonIdx.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    return nonIdx;
  };

  // 1) 六面微收腰熟绢宫灯罩 (y: -0.34 .. +0.34)
  const shadeGeo = new THREE.CylinderGeometry(0.30, 0.26, 0.68, 6, 6, true);
  const sPos = shadeGeo.attributes.position;
  for (let i = 0; i < sPos.count; i++) {
    const y = sPos.getY(i);
    const k = (y + 0.34) / 0.68;
    const bulge = 1.0 + 0.10 * Math.sin(k * Math.PI);
    sPos.setX(i, sPos.getX(i) * bulge);
    sPos.setZ(i, sPos.getZ(i) * bulge);
  }
  shadeGeo.computeVertexNormals();
  parts.push(tagUvY(shadeGeo, 0.0, 1.0));

  // 2) 六道立体楠木灯骨肋条 + 上下雕花箍框
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const strut = new THREE.CylinderGeometry(0.016, 0.015, 0.72, 5, 4);
    const stPos = strut.attributes.position;
    for (let k = 0; k < stPos.count; k++) {
      const y = stPos.getY(k);
      const frac = clamp01((y + 0.36) / 0.72);
      const rad = lerp(0.262, 0.302, frac) * (1.0 + 0.10 * Math.sin(frac * Math.PI));
      stPos.setX(k, stPos.getX(k) + Math.cos(ang) * rad);
      stPos.setZ(k, stPos.getZ(k) + Math.sin(ang) * rad);
    }
    strut.computeVertexNormals();
    parts.push(tagUvY(strut, 1.25, 1.45));
  }

  // 3) 六角攒尖起翘飞檐灯冠 (y: +0.34 .. +0.62) + 鎏金宝珠顶
  const canopy = new THREE.ConeGeometry(0.45, 0.26, 6, 4, false);
  const cPos = canopy.attributes.position;
  for (let i = 0; i < cPos.count; i++) {
    const x = cPos.getX(i);
    const y = cPos.getY(i);
    const z = cPos.getZ(i);
    const r = Math.hypot(x, z);
    // 古典飞檐凹曲翘角
    const eavesLift = Math.pow(r / 0.45, 2.2) * 0.085;
    cPos.setY(i, y + 0.47 + eavesLift);
  }
  canopy.computeVertexNormals();
  parts.push(tagUvY(canopy, 1.50, 1.85));

  const finial = new THREE.SphereGeometry(0.055, 8, 6);
  finial.translate(0, 0.63, 0);
  parts.push(tagUvY(finial, 1.82, 1.92));

  // 4) 下托须弥莲座框 (y: -0.44 .. -0.33)
  const baseSeat = new THREE.CylinderGeometry(0.27, 0.18, 0.12, 6, 1);
  baseSeat.translate(0, -0.39, 0);
  parts.push(tagUvY(baseSeat, 1.30, 1.65));

  // 5) 鎏金挂链细杆 (y: +0.64 .. +0.98)
  const chain = new THREE.CylinderGeometry(0.011, 0.011, 0.36, 5, 1);
  chain.translate(0, 0.81, 0);
  parts.push(tagUvY(chain, 1.80, 1.92));

  // 6) 底部宫绦丝穗流苏（uv.y 编码为 [-1.05, -0.05]：-0.05 为顶部如意结，-1.05 为底部丝穗末梢）
  const knot = new THREE.SphereGeometry(0.042, 8, 6);
  knot.translate(0, -0.48, 0);
  parts.push(tagUvY(knot, -0.12, -0.05));

  const tassel = new THREE.CylinderGeometry(0.024, 0.062, 0.56, 8, 6, true);
  tassel.translate(0, -0.78, 0);
  // 注意 CylinderGeometry 默认 v=1 在顶、v=0 在底，因此映射 [-1.05, -0.12] 使顶为 -0.12、底为 -1.05
  parts.push(tagUvY(tassel, -1.05, -0.12));

  return mergeGeometries(parts, false);
}

/**
 * 构建双层十六瓣盛开天池莲花河灯几何体：
 * - uv.y in [0.0, 1.0]: 莲花瓣（0=花托根部烛心旁，1=微翘莲瓣尖端）
 * - uv.y < 0: 中央温暖花蕊烛心球
 */
function createLotusLanternGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const addPetalRing = (count: number, len: number, width: number, tilt: number, lift: number, angleOffset: number) => {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + angleOffset;
      const uSegs = 4;
      const vSegs = 5;
      const pos: number[] = [];
      const uvs: number[] = [];
      const idx: number[] = [];

      for (let iv = 0; iv <= vSegs; iv++) {
        const v = iv / vSegs;
        // 莲瓣中部宽润饱满、首尾收尖，瓣尖优雅微翘
        const w = width * Math.sin(Math.pow(v, 0.72) * Math.PI) * (1.0 - 0.15 * v);
        const r = 0.06 + v * len;
        const y = lift + Math.sin(v * Math.PI * 0.65) * tilt + Math.pow(v, 2.4) * 0.07;

        for (let iu = 0; iu <= uSegs; iu++) {
          const u = iu / uSegs;
          const lat = (u - 0.5) * 2.0;
          // 花瓣横向微凹成匙状托光曲面
          const cupY = y + lat * lat * 0.028 * (1.0 - 0.3 * v);
          const lx = r;
          const lz = lat * w;
          const wx = lx * Math.cos(ang) - lz * Math.sin(ang);
          const wz = lx * Math.sin(ang) + lz * Math.cos(ang);
          pos.push(wx, cupY, wz);
          uvs.push(u, v);
        }
      }

      const stride = uSegs + 1;
      for (let iv = 0; iv < vSegs; iv++) {
        for (let iu = 0; iu < uSegs; iu++) {
          const a = iv * stride + iu;
          const b = a + 1;
          const c = (iv + 1) * stride + iu;
          const d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      parts.push(g.toNonIndexed());
    }
  };

  // 内层 8 瓣微拢捧光 + 外层 8 瓣舒展浮水
  addPetalRing(8, 0.28, 0.105, 0.15, 0.03, 0);
  addPetalRing(8, 0.38, 0.130, 0.06, 0.01, Math.PI / 8);

  // 中央花心烛火明珠 (uv.y = -0.5)
  const core = new THREE.SphereGeometry(0.085, 10, 8).toNonIndexed();
  core.translate(0, 0.09, 0);
  const cCount = core.attributes.position.count;
  const cUvs = new Float32Array(cCount * 2);
  for (let i = 0; i < cCount; i++) {
    cUvs[i * 2] = 0.5;
    cUvs[i * 2 + 1] = -0.5;
  }
  core.setAttribute('uv', new THREE.BufferAttribute(cUvs, 2));
  parts.push(core);

  return mergeGeometries(parts, false);
}

/**
 * 构建东方古建八角凹曲起翘飞檐琉璃瓦屋顶（放射扇面精确瓦垄 UV + 翼角反宇曲线 + 立体滴水瓦当封口檐唇）
 */
function createChineseOctagonalRoofGeometry(
  topRadius: number,
  eaveRadius: number,
  height: number,
  upturn: number,
): THREE.BufferGeometry {
  const sides = 8;
  const subPerSide = 8;
  const radialSegs = sides * subPerSide;
  const ringSegs = 14;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const evalRingPoint = (v: number, ia: number): [number, number, number, number] => {
    const u = ia / radialSegs;
    const sector = Math.floor(ia / subPerSide) % sides;
    const f = (ia % subPerSide) / subPerSide;
    // 注意当 ia 恰好落在最后一扇终点时保持连续扇区坐标
    const sectorCoord = ia / subPerSide;

    const sag = height * (1.0 - v) * (1.0 - 0.34 * v * (1.0 - v));
    const a0 = (sector / sides) * Math.PI * 2;
    const a1 = ((sector + 1) / sides) * Math.PI * 2;

    const rCurr = lerp(topRadius, eaveRadius, v);
    const cornerFactor = Math.pow(Math.abs(f - 0.5) * 2.0, 1.85);
    const wingFlare = 1.0 + cornerFactor * Math.pow(v, 2.1) * 0.11;

    const x0 = Math.cos(a0) * rCurr;
    const z0 = Math.sin(a0) * rCurr;
    const x1 = Math.cos(a1) * rCurr;
    const z1 = Math.sin(a1) * rCurr;

    const x = lerp(x0, x1, f) * wingFlare;
    const z = lerp(z0, z1, f) * wingFlare;
    const cornerLift = upturn * Math.pow(v, 2.3) * (0.28 + 0.72 * cornerFactor);
    const y = sag + cornerLift;
    return [x, y, z, sectorCoord || u * sides];
  };

  for (let ir = 0; ir <= ringSegs; ir++) {
    const v = ir / ringSegs; // 0 = 顶部攒尖/上口, 1 = 飞檐外缘
    for (let ia = 0; ia <= radialSegs; ia++) {
      const [x, y, z, su] = evalRingPoint(v, ia);
      positions.push(x, y, z);
      uvs.push(su, v);
    }
  }

  // 檐口立体滴水瓦当垂直封边唇（v 编码为 1.06，彻底消除俯视与平视的纸片薄边感）
  for (let ia = 0; ia <= radialSegs; ia++) {
    const [x, y, z, su] = evalRingPoint(1.0, ia);
    positions.push(x * 0.996, y - 0.135, z * 0.996);
    uvs.push(su, 1.06);
  }

  const stride = radialSegs + 1;
  for (let ir = 0; ir < ringSegs + 1; ir++) {
    for (let ia = 0; ia < radialSegs; ia++) {
      const a = ir * stride + ia;
      const b = a + 1;
      const c = (ir + 1) * stride + ia;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 构建八角屋顶的 8 道立体高浮雕攒尖垂脊 / 戗脊 + 檐角昂首仙人走兽脊饰序列
 * 贴合与 createChineseOctagonalRoofGeometry 完全一致的反宇凹曲弧线，使俯视呈现苍劲放射骨感
 */
function createOctagonalRoofRidgesGeometry(
  topRadius: number,
  eaveRadius: number,
  height: number,
  upturn: number,
  yOffset: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const sides = 8;
  const segs = 14;
  const halfW = 0.095;
  const ridgeH = 0.145;

  const ridgePoint = (ang: number, v: number): [number, number, number] => {
    const sag = height * (1.0 - v) * (1.0 - 0.34 * v * (1.0 - v));
    const wingFlare = 1.0 + Math.pow(v, 2.1) * 0.11;
    const r = lerp(topRadius, eaveRadius, v) * wingFlare;
    const y = yOffset + sag + upturn * Math.pow(v, 2.3);
    return [Math.cos(ang) * r, y, Math.sin(ang) * r];
  };

  for (let s = 0; s < sides; s++) {
    const ang = (s / sides) * Math.PI * 2;
    const tx = -Math.sin(ang);
    const tz = Math.cos(ang);
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];

    // 截面 4 个顶点：左底(0)、左顶(1)、右顶(2)、右底(3)
    for (let i = 0; i <= segs; i++) {
      const v = i / segs;
      const [cx, cy, cz] = ridgePoint(ang, v);
      // 顶端汇入鎏金宝顶莲座处平滑压低收束，彻底杜绝刺穿宝座产生破面斑点
      const topTuck = smooth(clamp01(v / 0.12));
      // 翘角尖端昂首微扬形成古典鸱吻戗脊收头
      const tipHorn = v > 0.86 ? Math.pow((v - 0.86) / 0.14, 1.8) * 0.16 : 0.0;
      const wScale = lerp(0.55, 1.08, v) * (v > 0.94 ? 0.78 : 1.0);
      const w = halfW * wScale;
      const h = (ridgeH * (0.88 + 0.22 * v) + tipHorn) * (0.15 + 0.85 * topTuck);

      pos.push(
        cx - tx * w, cy - 0.03, cz - tz * w,
        cx - tx * (w * 0.52), cy + h, cz - tz * (w * 0.52),
        cx + tx * (w * 0.52), cy + h, cz + tz * (w * 0.52),
        cx + tx * w, cy - 0.03, cz + tz * w,
      );
      uvs.push(0.0, v, 0.36, v, 0.64, v, 1.0, v);
    }

    for (let i = 0; i < segs; i++) {
      const b0 = i * 4;
      const b1 = (i + 1) * 4;
      // 左侧坡、脊顶面、右侧坡
      for (let k = 0; k < 3; k++) {
        idx.push(b0 + k, b0 + k + 1, b1 + k, b0 + k + 1, b1 + k + 1, b1 + k);
      }
    }

    // 封口端面（翘角前端）
    const endB = segs * 4;
    idx.push(endB, endB + 2, endB + 1, endB, endB + 3, endB + 2);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g.toNonIndexed());

    // 檐角脊背排布 3 尊精巧琉璃仙人走兽凸饰（v = 0.76, 0.84, 0.91）
    const beastLocs = [0.76, 0.84, 0.91];
    for (let bi = 0; bi < beastLocs.length; bi++) {
      const bv = beastLocs[bi];
      const [bx, by, bz] = ridgePoint(ang, bv);
      const bSize = 0.068 + bi * 0.012;
      const beast = new THREE.ConeGeometry(bSize * 0.72, bSize * 2.1, 5);
      beast.rotateX(0.28);
      beast.rotateY(-ang + Math.PI * 0.5);
      beast.translate(bx, by + ridgeH + bSize * 0.75, bz);
      const nonIdx = beast.toNonIndexed();
      const cnt = nonIdx.attributes.position.count;
      const buv = new Float32Array(cnt * 2);
      for (let k = 0; k < cnt; k++) {
        buv[k * 2] = 0.5;
        buv[k * 2 + 1] = bv;
      }
      nonIdx.setAttribute('uv', new THREE.BufferAttribute(buv, 2));
      parts.push(nonIdx);
    }
  }

  return mergeGeometries(parts, false);
}

/**
 * 构建三维解剖级东方灵韵锦鲤几何体：
 * - uv.y in [0.0, 1.0]: 饱满流线纺锤鱼躯（前肩宽厚、隆背微垂腹、平滑收至尾柄）+ 吻须
 * - uv.y in [1.10, 1.90]: 双叶深 V 分叉飘逸蝴蝶燕尾纱鳍（立体双翼斜展，俯视与侧视皆舒展灵动）
 * - uv.y in [2.10, 2.90]: 鳃后两侧宽大扇形蝴蝶胸鳍与腹鳍（随游弋节奏上下轻柔划水扇动）
 * - uv.y in [3.10, 3.90]: 背脊高扬流线旗状背鳍
 */
function createKoiGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1) 饱满流线鱼躯 (u in [0.0, 0.72], z: +0.70 -> -0.44)：吻端微扁收尖、鳃盖饱满宽肩、高隆背脊平滑收至尾柄
  const bodyLenSegs = 26;
  const bodyRadSegs = 18;
  const bPos: number[] = [];
  const bUvs: number[] = [];
  const bIdx: number[] = [];

  const evalBodySection = (tBody: number) => {
    // 全段光滑流线纺锤轮廓：吻端柔和微扁收尖 -> 肩背饱满圆润过渡 -> 腰尾修长收束至尾柄（零分段折角）
    const headProfile = Math.pow(Math.sin(Math.min(1.0, tBody / 0.28) * Math.PI * 0.5), 0.68);
    const waistTaper = 1.0 - 0.83 * smooth(clamp01((tBody - 0.25) / 0.75));
    const rx = tBody <= 0.001 ? 0.0 : 0.160 * headProfile * waistTaper;
    const ryTop = rx * (0.76 + 0.30 * Math.sin(Math.pow(tBody, 0.62) * Math.PI * 0.88));
    const ryBot = rx * (0.68 + 0.18 * Math.sin(Math.pow(tBody, 0.65) * Math.PI * 0.90));
    const spineLift = 0.020 * Math.sin(tBody * Math.PI);
    return { rx, ryTop, ryBot, spineLift };
  };

  for (let il = 0; il <= bodyLenSegs; il++) {
    const tBody = il / bodyLenSegs;
    const u = tBody * 0.72;
    const z = (0.44 - u) * 1.58;
    const { rx, ryTop, ryBot, spineLift } = evalBodySection(tBody);

    for (let ir = 0; ir <= bodyRadSegs; ir++) {
      const v = ir / bodyRadSegs;
      const theta = v * Math.PI * 2;
      const cx = Math.cos(theta);
      const sy = Math.sin(theta);
      const ry = sy >= 0 ? ryTop : ryBot;
      // 背脊两侧微鼓的鲤鱼肌肉棱感
      const flankFullness = 1.0 + 0.05 * Math.sin(theta * 2.0) * smooth(clamp01(tBody / 0.2)) * (1.0 - tBody);
      bPos.push(cx * rx * flankFullness, sy * ry + spineLift, z);
      bUvs.push(u, v);
    }
  }

  const bStride = bodyRadSegs + 1;
  for (let il = 0; il < bodyLenSegs; il++) {
    for (let ir = 0; ir < bodyRadSegs; ir++) {
      const a = il * bStride + ir;
      const b = a + 1;
      const c = (il + 1) * bStride + ir;
      const d = c + 1;
      bIdx.push(a, c, b, b, c, d);
    }
  }
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
  bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bUvs, 2));
  bodyGeo.setIndex(bIdx);
  bodyGeo.computeVertexNormals();
  parts.push(bodyGeo.toNonIndexed());

  // 1b) 锦鲤标志性嘴角一对灵动龙须 / 吻须 (Barbels, uv.y = 0.50, u in [0.02, 0.08])
  for (const side of [-1, 1]) {
    const wPos: number[] = [];
    const wUvs: number[] = [];
    const wIdx: number[] = [];
    const segs = 5;
    for (let i = 0; i <= segs; i++) {
      const k = i / segs;
      const u = 0.02 + k * 0.055;
      const cx = side * (0.036 + 0.068 * Math.pow(k, 0.85));
      const cy = -0.016 - 0.020 * k;
      const cz = (0.44 - u) * 1.58 - 0.035 * k * k;
      const rBarbel = 0.0085 * (1.0 - 0.78 * k);
      wPos.push(cx, cy + rBarbel, cz, cx, cy - rBarbel, cz, cx + side * rBarbel * 0.6, cy, cz - rBarbel);
      wUvs.push(u, 0.5, u, 0.5, u, 0.5);
    }
    for (let i = 0; i < segs; i++) {
      const b0 = i * 3;
      const b1 = (i + 1) * 3;
      wIdx.push(
        b0, b1, b0 + 1, b0 + 1, b1, b1 + 1,
        b0 + 1, b1 + 1, b0 + 2, b0 + 2, b1 + 1, b1 + 2,
        b0 + 2, b1 + 2, b0, b0, b1 + 2, b1,
      );
    }
    const wGeo = new THREE.BufferGeometry();
    wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
    wGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUvs, 2));
    wGeo.setIndex(wIdx);
    wGeo.computeVertexNormals();
    parts.push(wGeo.toNonIndexed());
  }

  // 2) 双叶深 V 分叉蝴蝶燕尾纱鳍 (u in [0.67, 1.00], uv.y in [1.10, 1.90])
  // 从尾柄无缝柔和舒展为宽逸双叶燕尾，俯视与侧视皆飘逸如轻罗团扇
  for (const wingSide of [-1, 1]) {
    const uSegs = 9;
    const vSegs = 9;
    const tPos: number[] = [];
    const tUvs: number[] = [];
    const tIdx: number[] = [];

    for (let iu = 0; iu <= uSegs; iu++) {
      const k = iu / uSegs; // 0 = 尾柄根部, 1 = 燕尾末梢
      const u = lerp(0.67, 1.0, k);
      for (let iv = 0; iv <= vSegs; iv++) {
        const lobeF = iv / vSegs; // 0 = 中央深 V 分叉内缘, 1 = 燕尾外翼前缘
        // 真实燕尾后缘深 V 缺刻与圆润双叶弧度
        const vNotch = (1.0 - smooth(clamp01(lobeF * 1.75))) * 0.21 * k * k;
        const tipRound = Math.sin(Math.pow(lobeF, 0.72) * Math.PI * 0.90);
        const z = (0.44 - u) * 1.58 + vNotch + (1.0 - tipRound) * 0.06 * k;

        const spreadR = lerp(0.016, 0.285, Math.pow(k, 0.82)) * (0.10 + 0.90 * tipRound);
        const wingX = wingSide * spreadR * (0.72 + 0.24 * k);
        // 尾叶呈柔美微波曲面水平偏上舒展，不会僵硬下戳水底
        const wingY = (lobeF - 0.34) * lerp(0.032, 0.19, Math.pow(k, 0.78))
                    + Math.sin(k * Math.PI * 1.15) * 0.018;

        tPos.push(wingX, wingY, z);
        tUvs.push(u, 1.10 + lobeF * 0.80);
      }
    }
    const tStride = vSegs + 1;
    for (let iu = 0; iu < uSegs; iu++) {
      for (let iv = 0; iv < vSegs; iv++) {
        const a = iu * tStride + iv;
        const b = a + 1;
        const c = (iu + 1) * tStride + iv;
        const d = c + 1;
        tIdx.push(a, c, b, b, c, d);
      }
    }
    const tailGeo = new THREE.BufferGeometry();
    tailGeo.setAttribute('position', new THREE.Float32BufferAttribute(tPos, 3));
    tailGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tUvs, 2));
    tailGeo.setIndex(tIdx);
    tailGeo.computeVertexNormals();
    parts.push(tailGeo.toNonIndexed());
  }

  // 3) 水平舒展扇形蝴蝶双胸鳍与腹鳍 (uv.y in [2.10, 2.90])
  // uv.y 小数编码展向位置，并通过 vLocalOrig 保留前后缘信息以刻画胸鳍前缘硬骨
  const addPairedFins = (
    uRootStart: number,
    uRootEnd: number,
    rootX: number,
    rootY: number,
    spanX: number,
    sweepU: number,
    droopY: number,
  ) => {
    for (const side of [-1, 1]) {
      const sSegs = 7;
      const cSegs = 7;
      const fPos: number[] = [];
      const fUvs: number[] = [];
      const fIdx: number[] = [];

      for (let is = 0; is <= sSegs; is++) {
        const s = is / sSegs; // 0 = 鱼体附着根部, 1 = 扇形鳍尖外缘
        const chordWidth = Math.sin(Math.pow(s, 0.58) * Math.PI * 0.94);
        for (let ic = 0; ic <= cSegs; ic++) {
          const c = ic / cSegs; // 0 = 胸鳍前缘主骨, 1 = 胸鳍后缘薄纱
          const uBase = lerp(uRootStart, uRootEnd, c);
          const u = uBase + s * sweepU * (0.32 + 0.82 * c) + (c - 0.45) * chordWidth * 0.075;
          const z = (0.44 - u) * 1.58;
          const x = side * (rootX * (1.0 - 0.14 * c) + Math.sin(s * Math.PI * 0.56) * spanX * (0.76 + 0.24 * Math.sin(c * Math.PI)));
          // 水平优雅平展微拱，消除过度下垂，使俯视与平视皆如灵蝶振翅
          const arch = Math.sin(s * Math.PI) * 0.016 - s * s * droopY - c * s * 0.012;
          const y = rootY + arch;

          fPos.push(x, y, z);
          fUvs.push(clamp01(u), 2.10 + s * 0.80);
        }
      }
      const fStride = cSegs + 1;
      for (let is = 0; is < sSegs; is++) {
        for (let ic = 0; ic < cSegs; ic++) {
          const a = is * fStride + ic;
          const b = a + 1;
          const c = (is + 1) * fStride + ic;
          const d = c + 1;
          fIdx.push(a, c, b, b, c, d);
        }
      }
      const finGeo = new THREE.BufferGeometry();
      finGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
      finGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fUvs, 2));
      finGeo.setIndex(fIdx);
      finGeo.computeVertexNormals();
      parts.push(finGeo.toNonIndexed());
    }
  };

  // 鳃后宽大水平蝴蝶胸鳍 + 腰腹灵巧腹鳍
  addPairedFins(0.16, 0.29, 0.122, -0.018, 0.285, 0.13, 0.014);
  addPairedFins(0.41, 0.50, 0.068, -0.030, 0.135, 0.09, 0.012);

  // 4) 背脊高扬流线旗状背鳍 (u in [0.24, 0.58], uv.y in [3.10, 3.90])
  {
    const dLen = 9;
    const dH = 4;
    const dPos: number[] = [];
    const dUvs: number[] = [];
    const dIdx: number[] = [];
    for (let il = 0; il <= dLen; il++) {
      const kl = il / dLen;
      const uBase = lerp(0.24, 0.58, kl);
      const tBody = uBase / 0.72;
      const { ryTop, spineLift } = evalBodySection(tBody);
      const baseTopY = ryTop * 0.96 + spineLift;
      const maxH = 0.138 * Math.sin(Math.pow(kl, 0.52) * Math.PI * 0.95);

      for (let ih = 0; ih <= dH; ih++) {
        const kh = ih / dH;
        const u = uBase + kh * 0.068;
        const z = (0.44 - u) * 1.58;
        const x = Math.sin(kl * Math.PI) * kh * 0.010;
        const y = baseTopY + kh * maxH;
        dPos.push(x, y, z);
        dUvs.push(u, 3.10 + kh * 0.80);
      }
    }
    const dStride = dH + 1;
    for (let il = 0; il < dLen; il++) {
      for (let ih = 0; ih < dH; ih++) {
        const a = il * dStride + ih;
        const b = a + 1;
        const c = (il + 1) * dStride + ih;
        const d = c + 1;
        dIdx.push(a, c, b, b, c, d);
      }
    }
    const dorsalGeo = new THREE.BufferGeometry();
    dorsalGeo.setAttribute('position', new THREE.Float32BufferAttribute(dPos, 3));
    dorsalGeo.setAttribute('uv', new THREE.Float32BufferAttribute(dUvs, 2));
    dorsalGeo.setIndex(dIdx);
    dorsalGeo.computeVertexNormals();
    parts.push(dorsalGeo.toNonIndexed());
  }

  return mergeGeometries(parts, false);
}

// ======================== 着色器源码 ========================

/** 瑶池苍穹星夜与千灯暖霞天幕着色器 */
const CELESTIAL_SKY_VERT = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

const CELESTIAL_SKY_FRAG = /* glsl */ `
  uniform mat4 uInvVP;
  uniform vec3 uCamPos;
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uGoldColor;
  uniform float uTime;
  uniform float uLanternWarmth;
  varying vec2 vNdc;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  void main() {
    vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
    vec3 dir = normalize(w.xyz / w.w - uCamPos);
    float elev = clamp(dir.y, -0.25, 1.0);

    vec3 col = mix(uHorizonColor, uZenithColor, smoothstep(-0.04, 0.58, elev));
    // 千灯升腾映暖低空云霞
    float horizonGlow = exp(-abs(elev - 0.04) * 5.2) * (0.28 + 0.35 * uLanternWarmth);
    col += uGoldColor * horizonGlow * 0.38;

    // 天顶稀疏清澈星辰
    if (elev > 0.06) {
      vec2 starUv = vec2(atan(dir.x, -dir.z) * 520.0, elev * 520.0);
      vec2 cell = floor(starUv);
      vec2 f = fract(starUv) - 0.5;
      float rnd = hash21(cell);
      if (rnd > 0.9975) {
        float twinkle = 0.65 + 0.35 * sin(uTime * 2.4 + rnd * 91.7);
        float spot = smoothstep(0.38, 0.05, length(f)) * smoothstep(0.06, 0.28, elev);
        col += mix(vec3(0.82), uGoldColor, 0.35) * spot * twinkle * 0.55;
      }
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** 三维立体宣纸孔明灯（次表面透光 + 竹篾灯骨筋脉 + 底口立体跃动火苗芯）着色器 */
const SKY_LANTERN_VERT = /* glsl */ `
  attribute vec4 aLanternPos;   // xyz: 世界坐标, w: 尺寸缩放
  attribute vec4 aLanternState; // x: 亮度(0..1.4), y: 倾角X, z: 倾角Z, w: 随机种子

  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying float vBright;
  varying float vSeed;

  void main() {
    float bright = aLanternState.x;
    if (bright <= 1e-3 || aLanternPos.w <= 1e-3) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    vUv = uv;
    vBright = bright;
    vSeed = aLanternState.w;

    vec3 p = position;
    // 内部立体火苗随热流高频轻颤升腾
    if (uv.y < 0.0) {
      float fh = clamp((uv.y + 1.02), 0.0, 1.0);
      float sway = sin(uTime * 13.5 + vSeed * 43.0 + fh * 3.2) * 0.022 * fh;
      float stretch = 0.88 + 0.22 * sin(uTime * 17.0 + vSeed * 29.0);
      p.x += sway;
      p.y = -0.621 + (p.y + 0.621) * stretch;
    }

    // 随微风缓慢自转与钟摆微倾
    float yaw = vSeed * 6.28318 + uTime * (0.18 + 0.14 * fract(vSeed * 7.3));
    float cy = cos(yaw);
    float sy = sin(yaw);
    vec3 pr = vec3(p.x * cy - p.z * sy, p.y, p.x * sy + p.z * cy);
    vec3 nr = vec3(normal.x * cy - normal.z * sy, normal.y, normal.x * sy + normal.z * cy);

    float tx = aLanternState.y;
    float tz = aLanternState.z;
    // 小角度物理钟摆旋转近似并归一化
    vec3 tiltedPos = vec3(
      pr.x + pr.y * tz,
      pr.y - pr.x * tz - pr.z * tx,
      pr.z + pr.y * tx
    );
    vec3 tiltedNorm = normalize(vec3(
      nr.x + nr.y * tz,
      nr.y - nr.x * tz - nr.z * tx,
      nr.z + nr.y * tx
    ));

    vec3 wp = aLanternPos.xyz + tiltedPos * aLanternPos.w;
    vWorldPos = wp;
    vNormalW = tiltedNorm;

    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const SKY_LANTERN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCamPos;
  uniform vec3 uFlameCore;
  uniform vec3 uGoldColor;
  uniform vec3 uMainColor;
  uniform vec3 uFogColor;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying float vBright;
  varying float vSeed;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float paperNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    float flicker = 0.90 + 0.10 * sin(uTime * 9.2 + vSeed * 53.1) * cos(uTime * 14.7 - vSeed * 21.4);

    // 1) 底口内部跃动明火烛芯
    if (vUv.y < 0.0) {
      float fy = clamp(vUv.y + 1.02, 0.0, 1.0);
      float fx = (vUv.x - 0.5) * 2.0;
      // 泪滴形烛火包络：下部圆润、顶部收尖
      float halfW = mix(0.68, 0.05, pow(fy, 0.85)) * sin(clamp(fy * 3.1 + 0.25, 0.0, 3.14159));
      float d = abs(fx) / max(halfW, 0.04);
      if (d > 1.0 || fy > 0.98) discard;
      float core = exp(-d * d * 2.6) * (1.0 - pow(fy, 1.8));
      vec3 flameCol = mix(uGoldColor, uFlameCore, clamp(core * 1.25, 0.0, 1.0)) * (2.6 + 2.4 * core) * vBright * flicker;
      gl_FragColor = vec4(flameCol, clamp((1.0 - d) * 1.4, 0.0, 1.0));
      return;
    }

    // 2) 熟宣/油纸半透明灯罩次表面透射模型
    float h = clamp(vUv.y, 0.0, 1.0);
    vec3 viewDir = normalize(uCamPos - vWorldPos);
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    float facing = abs(dot(N, viewDir));

    // 内部底口火焰向上照射的平方反比透射光强（灯腹下部最暖最亮，向顶部柔和递减）
    float fireDist2 = (h - 0.16) * (h - 0.16) * 2.65 + 0.16;
    float sss = (0.28 / fireDist2) * (0.68 + 0.32 * facing);

    // 八道纤细纵向竹篾灯骨与上下收口竹箍剪影（真实灯笼灵魂骨感）
    float ribWave = abs(sin(vUv.x * 3.14159265 * 8.0));
    float vertRib = 1.0 - 0.30 * smoothstep(0.11, 0.0, ribWave);
    float hoop1 = 1.0 - 0.18 * exp(-pow((h - 0.36) / 0.012, 2.0));
    float hoop2 = 1.0 - 0.16 * exp(-pow((h - 0.70) / 0.012, 2.0));
    float rimCollar = smoothstep(0.0, 0.032, h) * (0.58 + 0.42 * smoothstep(1.0, 0.94, h));
    float frameMask = vertRib * hoop1 * hoop2 * (0.38 + 0.62 * rimCollar);

    // 手工云龙宣纸纤维微透光肌理
    vec2 fiberUv = vec2(vUv.x * 26.0 + vSeed * 11.0, h * 18.0);
    float fiber = 0.91 + 0.14 * paperNoise(fiberUv) + 0.05 * paperNoise(fiberUv * 2.7);

    // 色彩层次：火芯正对处透出炽白暖金 -> 灯身中段温润鎏金 -> 顶部沉淀封面主色
    // 淡入淡出仅驱动 alpha 透明度，保持宣纸自发光暖色温不变黑灰，根除半透明灰暗薄壳圈
    float energyGlow = max(vBright, 0.82);
    vec3 paperBase = mix(uMainColor * 0.98, uGoldColor * 1.15, smoothstep(0.90, 0.16, h));
    vec3 hotSpot = uFlameCore * exp(-pow((h - 0.16) * 3.1, 2.0)) * (0.48 + 0.52 * facing);
    vec3 litPaper = (paperBase * (0.42 + sss * 0.98) + hotSpot * 0.95) * frameMask * fiber * flicker * energyGlow;

    // 宣纸边缘轻微丝绒散射轮廓光
    float rimScatter = pow(1.0 - facing, 2.4) * 0.24 * energyGlow;
    litPaper += uGoldColor * rimScatter * frameMask;

    // 远景大气云雾自然融合
    float dist = length(uCamPos - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * 0.0068, 1.75));
    vec3 col = mix(litPaper, uFogColor + uGoldColor * 0.10, clamp(fog * 0.72, 0.0, 0.78));

    float alpha = clamp(vBright * 1.12, 0.0, 0.96) * (1.0 - clamp(fog, 0.0, 0.92) * 0.35);
    gl_FragColor = vec4(col, alpha);
  }
`;

/** 孔明灯外围温暖大气柔光晕 (Billboard Volumetric Halo) */
const LANTERN_HALO_VERT = /* glsl */ `
  attribute vec4 aLanternPos;
  attribute vec4 aLanternState;

  varying vec2 vQuad;
  varying float vBright;
  varying float vSeed;
  varying float vDist;

  void main() {
    float bright = aLanternState.x;
    if (bright <= 1e-3 || aLanternPos.w <= 1e-3) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vQuad = position.xy;
    vBright = bright;
    vSeed = aLanternState.w;

    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float haloR = aLanternPos.w * 2.15;
    vec3 center = aLanternPos.xyz + vec3(0.0, -0.06 * aLanternPos.w, 0.0);
    vec4 mv = viewMatrix * vec4(center, 1.0);
    vDist = -mv.z;

    vec3 wp = center + camRight * (position.x * haloR) + camUp * (position.y * haloR);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const LANTERN_HALO_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uFlameCore;
  uniform vec3 uGoldColor;
  uniform vec3 uMainColor;

  varying vec2 vQuad;
  varying float vBright;
  varying float vSeed;
  varying float vDist;

  void main() {
    float r = length(vQuad);
    if (r >= 1.0) discard;

    float flick = 0.92 + 0.08 * sin(uTime * 8.5 + vSeed * 47.0);
    // 双指数大气散射晕：远景灯海融合为温润星云，近景柔和不遮挡宣纸灯骨细节
    float nearSuppress = smoothstep(4.0, 22.0, vDist);
    float inner = exp(-r * r * 6.5) * (0.20 + 0.22 * nearSuppress);
    float outer = pow(1.0 - r, 3.0) * 0.16;
    vec3 col = mix(uMainColor, uGoldColor, 0.68) * outer + mix(uGoldColor, uFlameCore, 0.45) * inner;
    gl_FragColor = vec4(col * vBright * flick, 1.0);
  }
`;

/** 飞檐与池栏古典六角鎏金宫灯着色器（绢纱透光 + 楠木描金灯框 + 随风摇曳丝绦流苏） */
const PALACE_LANTERN_VERT = /* glsl */ `
  attribute vec4 aAnchor; // xyz: 挂点偏移, w: 缩放
  attribute vec2 aSwing;  // x: 相位, y: 摆幅系数

  uniform float uTime;
  uniform float uDropIgnite;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying float vPhase;

  void main() {
    vUv = uv;
    vPhase = aSwing.x;

    vec3 p = position;
    // 流苏丝穗底部随仙风柔顺滞后拂动
    if (uv.y < 0.0) {
      float tasselDepth = clamp(-uv.y, 0.0, 1.0);
      float breezeX = sin(uTime * 2.3 + vPhase * 6.283 + tasselDepth * 1.8) * 0.075 * tasselDepth * tasselDepth;
      float breezeZ = cos(uTime * 1.85 + vPhase * 4.712 + tasselDepth * 1.5) * 0.055 * tasselDepth * tasselDepth;
      p.x += breezeX;
      p.z += breezeZ;
    }

    // 整盏宫灯绕顶部挂钩 (y = +0.98) 做轻微物理钟摆摇曳
    float pivotY = 0.98;
    float swingAngX = sin(uTime * 1.45 + vPhase * 6.283) * 0.052 * aSwing.y;
    float swingAngZ = cos(uTime * 1.18 + vPhase * 3.91) * 0.062 * aSwing.y;
    float dy = p.y - pivotY;
    vec3 swung = vec3(
      p.x - dy * swingAngZ,
      pivotY + dy,
      p.z + dy * swingAngX
    );

    vec4 localWp = vec4(aAnchor.xyz + swung * aAnchor.w, 1.0);
    vec4 wp = modelMatrix * localWp;
    vWorldPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const PALACE_LANTERN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCamPos;
  uniform vec3 uFlameCore;
  uniform vec3 uGoldColor;
  uniform vec3 uMainColor;
  uniform vec3 uLacquerColor;
  uniform float uMelodyGlow;
  uniform float uDropIgnite;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying float vPhase;

  void main() {
    vec3 viewDir = normalize(uCamPos - vWorldPos);
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    float flick = 0.92 + 0.08 * sin(uTime * 10.5 + vPhase * 37.0) * cos(uTime * 6.8 + vPhase * 19.0);
    float energyBoost = 1.0 + 0.28 * uMelodyGlow + 0.42 * uDropIgnite;

    if (vUv.y > 1.05) {
      // 1) 朱檀描金灯冠、楠木立骨与鎏金宝珠挂链
      float goldTrim = smoothstep(1.76, 1.84, vUv.y);
      float upLit = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
      // 下表面受宫灯自身暖光强烈映亮
      float underWarm = clamp(-N.y * 0.65 + 0.35, 0.0, 1.0);
      vec3 woodBase = mix(uLacquerColor * 0.55, uGoldColor * 0.95, goldTrim);
      vec3 H = normalize(viewDir + normalize(vec3(0.2, 0.8, 0.5)));
      float spec = pow(max(dot(N, H), 0.0), 24.0) * (0.25 + 0.65 * goldTrim);
      vec3 col = woodBase * (0.35 + 0.45 * upLit) + uGoldColor * underWarm * 0.48 * flick + uFlameCore * spec * 0.45;
      gl_FragColor = vec4(col, 1.0);
      return;
    }

    if (vUv.y < 0.0) {
      // 2) 宫绦金红丝穗流苏（细腻纵向丝线光泽 + 顶部受宫灯底光温暖映照）
      float tDepth = clamp(-vUv.y, 0.0, 1.0);
      float threads = 0.80 + 0.20 * sin(vUv.x * 6.28318 * 28.0);
      float topLit = exp(-tDepth * 2.2) * 0.85 + 0.22;
      vec3 silkBase = mix(uMainColor * 0.92, uGoldColor, exp(-tDepth * 3.5) * 0.55);
      vec3 col = silkBase * threads * topLit * flick * (0.95 + 0.30 * uDropIgnite);
      gl_FragColor = vec4(col, 0.95);
      return;
    }

    // 3) 六面熟绢宫灯罩：中心烛火暖白透射 + 绢纱经纬暗金云纹 + 六角木框内缘微暗过渡
    float v = clamp(vUv.y, 0.0, 1.0);
    float panelF = fract(vUv.x * 6.0);
    float panelEdge = smoothstep(0.0, 0.14, panelF) * smoothstep(1.0, 0.86, panelF);
    float vertEdge = smoothstep(0.0, 0.12, v) * smoothstep(1.0, 0.88, v);

    // 绢面中心团花暗纹与经纬丝绸细纹
    vec2 medUv = vec2((panelF - 0.5) * 2.0, (v - 0.5) * 2.0);
    float medR = length(medUv);
    float brocade = 0.93 + 0.07 * sin(medR * 18.0) * cos(atan(medUv.y, medUv.x) * 6.0);
    float silkWeave = 0.96 + 0.04 * sin(vUv.x * 220.0) * sin(v * 90.0);

    // 内部烛芯径向透光：灯肚中心炽白暖亮，向四周温润渐变为鎏金与封面主色
    float candleCore = exp(-(medUv.x * medUv.x * 1.8 + (v - 0.44) * (v - 0.44) * 5.2));
    float frameShadow = 0.52 + 0.48 * panelEdge * vertEdge;

    vec3 shadeTint = mix(uMainColor * 0.95, uGoldColor * 1.15, 0.45 + 0.45 * candleCore);
    vec3 col = (shadeTint * (0.68 + 0.95 * candleCore) + uFlameCore * pow(candleCore, 2.2) * 1.35)
             * frameShadow * brocade * silkWeave * flick * energyBoost;

    gl_FragColor = vec4(col, 0.97);
  }
`;

/** 天池双层盛开莲花河灯着色器 */
const LOTUS_LANTERN_VERT = /* glsl */ `
  attribute vec4 aLotus; // xyz: 世界坐标, w: 尺寸与相位打包 (整数部分/100=相位, 小数=缩放? 直接分离更稳)
  attribute vec2 aLotusMeta; // x: 缩放, y: 随机种子

  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying float vSeed;

  void main() {
    vUv = uv;
    vSeed = aLotusMeta.y;

    float yaw = vSeed * 6.28318 + uTime * 0.12;
    float c = cos(yaw);
    float s = sin(yaw);
    vec3 p = position * aLotusMeta.x;
    vec3 pr = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
    vec3 nr = vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);

    // 随水波微微摇晃
    float rockX = sin(uTime * 1.8 + vSeed * 19.0) * 0.05;
    float rockZ = cos(uTime * 1.5 + vSeed * 27.0) * 0.05;
    pr.y += pr.x * rockZ + pr.z * rockX;

    vec3 wp = aLotus.xyz + pr;
    vWorldPos = wp;
    vNormalW = normalize(nr);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const LOTUS_LANTERN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCamPos;
  uniform vec3 uFlameCore;
  uniform vec3 uGoldColor;
  uniform vec3 uMainColor;
  uniform float uMelodyGlow;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  varying float vSeed;

  void main() {
    float flick = 0.90 + 0.10 * sin(uTime * 11.0 + vSeed * 41.3);
    if (vUv.y < 0.0) {
      // 莲心烛火明珠
      vec3 col = mix(uGoldColor, uFlameCore, 0.72) * (2.6 + 0.6 * uMelodyGlow) * flick;
      gl_FragColor = vec4(col, 1.0);
      return;
    }

    // 莲花瓣次表面透光：根部受花心烛火映成暖白金，向瓣尖渐变为柔润主色，带细腻莲瓣叶脉
    float v = clamp(vUv.y, 0.0, 1.0);
    float u = vUv.x;
    float veins = 0.92 + 0.08 * cos((u - 0.5) * 34.0 * (1.0 - 0.35 * v));
    float rootGlow = exp(-v * 2.4);
    float tipRim = smoothstep(0.65, 1.0, v) * 0.35;

    vec3 petalTint = mix(uGoldColor * 1.15, uMainColor * 1.05, smoothstep(0.10, 0.85, v));
    vec3 col = (petalTint * (0.48 + 1.15 * rootGlow + tipRim) + uFlameCore * pow(rootGlow, 2.0) * 0.95)
             * veins * flick * (1.0 + 0.25 * uMelodyGlow);

    gl_FragColor = vec4(col, 0.95);
  }
`;

/** 东方古建重檐八角水榭与汉白玉栏杆多源灯火着色器（彻底消除无光源纯黑剪影） */
const PAVILION_ARCH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying vec3 vNormalW;

  void main() {
    vUv = uv;
    vLocalPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const PAVILION_ARCH_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCamPos;
  uniform vec3 uBaseColor;
  uniform vec3 uGoldColor;
  uniform vec3 uMainColor;
  uniform vec3 uFlameCore;
  uniform vec3 uFogColor;
  uniform float uStyleKind; // 0=深朱檀漆木/直棂栏杆, 1=皇家琉璃筒瓦屋面, 2=夜色雕花青白石, 3=雕塑鎏金相轮宝顶, 4=御窑墨玉金砖铺地, 5=立体琉璃垂脊描金脊梁
  uniform float uMelodyGlow;
  uniform float uDropIgnite;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying vec3 vNormalW;

  float archHash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float archNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(archHash(i), archHash(i + vec2(1.0, 0.0)), u.x),
      mix(archHash(i + vec2(0.0, 1.0)), archHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    vec3 viewDir = normalize(uCamPos - vWorldPos);
    vec2 relXZ = vWorldPos.xz - vec2(0.0, -32.0);
    float rHoriz = length(relXZ);
    vec3 outRadDir = normalize(vec3(relXZ.x, 0.0, relXZ.y) + vec3(1e-4, 0.0, 0.0));
    vec3 tangDir = normalize(vec3(-relXZ.y, 0.0, relXZ.x) + vec3(0.0, 0.0, 1e-4));

    vec3 albedo = uBaseColor;
    float roughness = 0.52;
    float archAO = 1.0;
    float lightGain = 1.0;
    bool isGlazedRoof = false;

    if (uStyleKind < 0.5) {
      // 0: 深朱檀漆木（金柱、斗拱、镂空直棂勾栏、束腰格眼框）
      float woodGrain = 0.88 + 0.12 * archNoise(vec2(vWorldPos.x * 9.0 + vWorldPos.z * 9.0, vWorldPos.y * 26.0));
      albedo *= woodGrain;
      roughness = 0.46;
      lightGain = 0.88;
    } else if (uStyleKind < 1.5) {
      // 1: 皇家琉璃阴阳筒瓦屋面（每扇 13 垄放射圆拱筒瓦 + 18 层错缝叠瓦阶梯 + 团花滴水瓦当 + 真实切向曲面法线）
      isGlazedRoof = true;
      float secIdx = floor(vUv.x);
      float secF = fract(vUv.x);
      float slopeV = clamp(vUv.y, 0.0, 1.0);

      // 越靠近攒尖顶瓦垄稍微收密，向飞檐自然舒展
      float tileCoord = secF * 13.0;
      float tileId = floor(tileCoord);
      float tileFrac = fract(tileCoord) - 0.5; // [-0.5, +0.5]

      // 阳瓦（半圆凸起筒瓦）与阴瓦（平凹板瓦沟底）截面轮廓
      float capArc = clamp(1.0 - pow(tileFrac * 2.55, 2.0), 0.0, 1.0);
      float isCap = step(abs(tileFrac), 0.39);
      float capHeight = sqrt(capArc) * isCap;

      // 18 层横向叠瓦搭接阶梯缝（筒瓦与底瓦错半格搭接，还原真实古建叠瓦工艺）
      float rowCoord = slopeV * 18.0 + (1.0 - isCap) * 0.45;
      float rowId = floor(rowCoord);
      float rowFrac = fract(rowCoord);
      float overlapLip = smoothstep(0.80, 0.96, rowFrac);
      float overlapShadow = 1.0 - 0.42 * smoothstep(0.83, 0.99, rowFrac);

      // 单片琉璃瓦微窑变釉色丰富度与细微冰裂釉纹
      float kilnVar = 0.86 + 0.24 * archHash(vec2(tileId + secIdx * 17.0, rowId));
      float glazeCraze = 0.94 + 0.06 * archNoise(vec2(secF * 48.0, slopeV * 56.0));
      // 筒瓦釉色温润透亮，底瓦沟槽深沉浓郁
      vec3 valleyTint = albedo * 0.68;
      vec3 capTint = mix(albedo * 1.22, mix(albedo, uMainColor * 0.48, 0.35), 0.65);
      albedo = mix(valleyTint, capTint, isCap * (0.55 + 0.45 * capHeight)) * kilnVar * glazeCraze;

      // 沿八角坡面真实周向切线 (tangDir) 与顺坡径向 (outRadDir) 偏转三维瓦垄法线
      float dCap = -tileFrac * 2.75 * isCap;
      float dRow = overlapLip * 0.48 - 0.09;
      N = normalize(N + tangDir * (dCap * 0.46) + outRadDir * (dRow * 0.24));

      // 沟底积聚环境光遮蔽 AO + 叠瓦阶梯深影
      archAO = (0.48 + 0.52 * mix(0.35, capHeight, isCap)) * overlapShadow;

      // 檐口立体封边唇与 13 枚温润同色系浮雕圆瓦当 / 细金边团花滴水（消除刺眼浅亮斑，古雅浑然一体）
      if (vUv.y > 0.94) {
        float lipLocal = clamp((vUv.y - 0.94) / 0.12, 0.0, 1.0);
        float wadangDist = length(vec2(tileFrac * 2.35, (lipLocal - 0.50) * 2.15));
        float wadangDisc = smoothstep(0.66, 0.44, wadangDist);
        float wadangRing = smoothstep(0.56, 0.47, wadangDist) * smoothstep(0.36, 0.45, wadangDist);
        float wadangCenter = smoothstep(0.22, 0.08, wadangDist);
        vec3 wadangTint = mix(capTint * 0.88, uGoldColor * 0.62, (wadangRing * 0.65 + wadangCenter * 0.45));
        albedo = mix(albedo * 0.76, wadangTint, wadangDisc);
        archAO = mix(archAO * 0.85, 0.78 + 0.20 * (wadangRing + wadangCenter), wadangDisc);
      }

      roughness = 0.22;
      lightGain = 1.08;
    } else if (uStyleKind < 2.5) {
      // 2: 夜色雕花青白石 / 苍青石须弥座与望柱（细腻石脉、凿石颗粒、砌石暗缝与结构遮蔽 AO，严禁泛白过曝）
      vec2 stoneUv = vec2(vWorldPos.x * 1.65 + vWorldPos.z * 1.35, vWorldPos.y * 2.8);
      float vein1 = archNoise(stoneUv * 1.8);
      float vein2 = archNoise(stoneUv * 5.4 + vec2(vein1 * 1.7, -vein1 * 1.3));
      float grain = archNoise(stoneUv * 24.0);
      float stoneTex = 0.76 + 0.22 * vein2 + 0.10 * grain;

      // 古建青石分块砌缝与水平线脚凹影
      float angSeg = fract(atan(relXZ.y, relXZ.x) * 8.0 / 6.28318);
      float vertJoint = smoothstep(0.0, 0.035, angSeg) * smoothstep(1.0, 0.965, angSeg);
      float horizCourse = 0.88 + 0.12 * smoothstep(0.06, 0.22, abs(fract(vWorldPos.y * 3.6) - 0.5));
      albedo *= stoneTex * (0.86 + 0.14 * vertJoint) * horizCourse;

      // 石雕微凹凸法线扰动，消除光滑白塑料感
      float dNx = archNoise(stoneUv * 14.0 + vec2(0.08, 0.0)) - archNoise(stoneUv * 14.0 - vec2(0.08, 0.0));
      float dNy = archNoise(stoneUv * 14.0 + vec2(0.0, 0.08)) - archNoise(stoneUv * 14.0 - vec2(0.0, 0.08));
      N = normalize(N + vec3(dNx, dNy, -dNx) * 0.22);

      // 须弥座内凹束腰阴影带 + 浮空底座阴面自遮挡 AO，上沿斜挑面保留温润石雕线脚层次
      float waistBand = exp(-pow((vLocalPos.y + 2.04) / 0.16, 2.0)) * smoothstep(4.58, 4.32, rHoriz);
      float underShadow = mix(1.0, 0.28 + 0.38 * smoothstep(1.5, 4.65, rHoriz), clamp(-N.y, 0.0, 1.0));
      float topBevelLift = 1.0 + 0.22 * clamp(N.y, 0.0, 1.0);
      archAO = (1.0 - 0.54 * waistBand) * underShadow * topBevelLift;
      roughness = 0.58;
      lightGain = 0.65;
    } else if (uStyleKind < 3.5) {
      // 3: 雕塑级皇家纯金覆钵仰覆莲相轮宝顶（真实立体明暗过渡、拉丝金高光与凹槽古铜暗金 AO，告别平涂死白剪影）
      float upLit = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
      float sideLit = clamp(dot(N, normalize(vec3(0.45, 0.68, 0.58))), 0.0, 1.0);
      float backFill = clamp(dot(N, normalize(vec3(-0.55, 0.35, -0.45))), 0.0, 1.0);
      float fluteGroove = 0.86 + 0.14 * sin(atan(relXZ.y, relXZ.x) * 16.0);

      vec3 H1 = normalize(viewDir + normalize(vec3(0.35, 0.82, 0.45)));
      vec3 H2 = normalize(viewDir + normalize(vec3(-0.48, 0.72, 0.50)));
      float specSharp = pow(max(dot(N, H1), 0.0), 46.0) + pow(max(dot(N, H2), 0.0), 34.0) * 0.65;
      float specBroad = pow(max(dot(N, H1), 0.0), 9.0);
      float rimGold = pow(1.0 - max(dot(N, viewDir), 0.0), 2.8);

      vec3 antiqueShadow = uGoldColor * 0.26;
      vec3 warmGoldBody = uGoldColor * (0.38 + 0.52 * sideLit + 0.26 * upLit + 0.18 * backFill) * fluteGroove;
      vec3 goldCol = mix(antiqueShadow, warmGoldBody, 0.85)
                   + mix(uGoldColor, uFlameCore, 0.55) * (specSharp * 0.85 + specBroad * 0.28)
                   + uGoldColor * rimGold * (0.32 + 0.35 * uDropIgnite + 0.18 * uMelodyGlow);
      goldCol = goldCol / (vec3(1.0) + goldCol * 0.42);
      gl_FragColor = vec4(goldCol, 1.0);
      return;
    } else if (uStyleKind < 4.5) {
      // 4: 亭心御窑墨玉金砖铺地（错缝方砖暗格与温润水磨微反光）
      vec2 brickUv = relXZ * 1.45;
      float rowShift = mod(floor(brickUv.y), 2.0) * 0.5;
      vec2 bf = abs(fract(vec2(brickUv.x + rowShift, brickUv.y)) - 0.5);
      float seam = smoothstep(0.485, 0.440, max(bf.x, bf.y));
      float tileTone = 0.84 + 0.16 * archHash(floor(vec2(brickUv.x + rowShift, brickUv.y)));
      albedo *= (0.48 + 0.52 * seam) * tileTone;
      archAO = 0.65 + 0.35 * smoothstep(4.6, 1.6, rHoriz);
      roughness = 0.34;
      lightGain = 0.68;
    } else {
      // 5: 十六道立体攒尖琉璃垂脊、仙人走兽与皇家描金压脊线（赋予俯视屋顶苍劲的八芒放射骨感）
      isGlazedRoof = true;
      float ridgeSeg = 0.82 + 0.18 * sin(vUv.y * 6.28318 * 24.0);
      float crownGoldMask = smoothstep(0.22, 0.07, abs(vUv.x - 0.5));
      float tipBeastGlow = smoothstep(0.74, 0.95, vUv.y) * 0.35;
      vec3 ridgeBase = mix(uBaseColor * 1.35, uMainColor * 0.45, 0.32) * ridgeSeg;
      albedo = mix(ridgeBase, uGoldColor * 0.88, crownGoldMask * 0.72 + tipBeastGlow * crownGoldMask);
      N = normalize(N + outRadDir * (cos(vUv.y * 6.28318 * 24.0) * 0.18));
      archAO = 0.72 + 0.28 * crownGoldMask;
      roughness = 0.20;
      lightGain = 1.12;
    }

    // 1) 苍穹星夜漫射顶光
    float skyUp = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 skyAmb = mix(uFogColor * 1.35, mix(vec3(0.14, 0.17, 0.24), uMainColor * 0.28, 0.5), skyUp) * albedo * 1.15 * archAO;

    // 2) 下方天池丝绸画卷与莲花河灯仰射柔光（克制掠射台基外缘棱角与飞檐底面，绝不把底座冲白）
    vec3 poolCenter = vec3(0.0, 0.1, -32.0);
    vec3 toPool = poolCenter - vWorldPos;
    float poolDist = length(toPool);
    vec3 poolDir = toPool / max(poolDist, 0.01);
    float nDotPool = max(dot(N, poolDir), 0.0) * 0.72 + 0.28 * clamp(-N.y, 0.0, 1.0);
    float poolAtten = 1.0 / (1.0 + 0.018 * poolDist * poolDist);
    vec3 poolBounce = mix(uMainColor, uGoldColor, 0.52) * albedo * nDotPool * poolAtten
                    * (1.35 + 0.65 * uDropIgnite + 0.32 * uMelodyGlow) * lightGain * archAO;

    // 3) 双层八角飞檐悬挂宫灯环形暖光源（精准照亮飞檐翘角底部、廊柱上部与雕花围栏上沿）
    float dLowerRing = length(vec2(rHoriz - 6.35, vWorldPos.y - 6.35));
    float dUpperRing = length(vec2(rHoriz - 4.75, vWorldPos.y - 8.25));
    float dRailRing  = length(vec2(rHoriz - 14.1, vWorldPos.y - 1.25));

    float lanternWrap = 0.42 + 0.58 * clamp(dot(N, outRadDir) * 0.65 - N.y * 0.45, 0.0, 1.0);
    float lanternAtten = 1.25 / (1.0 + 0.18 * dLowerRing * dLowerRing)
                       + 0.98 / (1.0 + 0.22 * dUpperRing * dUpperRing)
                       + 0.68 / (1.0 + 0.25 * dRailRing * dRailRing);
    float candleFlick = 0.94 + 0.06 * sin(uTime * 8.0 + rHoriz);
    vec3 lanternWarm = mix(uGoldColor, uFlameCore, 0.24) * lanternAtten * lanternWrap * candleFlick
                     * (albedo * 2.05 * lightGain) * archAO;

    // 4) 漫天千灯高空暖霞顶光 + 皇家琉璃瓦清漆釉面多方位高光（专门激活俯视视角下饱满的琉璃瓦垄光泽）
    vec3 topGlazeTerm = vec3(0.0);
    if (isGlazedRoof) {
      float upFace = clamp(N.y * 0.75 + 0.25, 0.0, 1.0);
      vec3 skyLanternDiff = mix(uMainColor, uGoldColor, 0.56) * albedo * upFace
                          * (1.42 + 0.48 * uMelodyGlow + 0.55 * uDropIgnite) * archAO;
      vec3 L1 = normalize(vec3(0.55, 0.78, 0.30));
      vec3 L2 = normalize(vec3(-0.62, 0.74, 0.26));
      vec3 L3 = normalize(vec3(0.04, 0.76, -0.65));
      float gSpec = pow(max(dot(N, normalize(viewDir + L1)), 0.0), 34.0)
                  + pow(max(dot(N, normalize(viewDir + L2)), 0.0), 30.0) * 0.88
                  + pow(max(dot(N, normalize(viewDir + L3)), 0.0), 28.0) * 0.82;
      float broadSheen = pow(max(dot(N, normalize(viewDir + vec3(0.0, 0.90, 0.42))), 0.0), 7.5);
      vec3 glazeSpec = (mix(uGoldColor, uFlameCore, 0.36) * gSpec * 0.38
                     + mix(uMainColor, uGoldColor, 0.48) * broadSheen * 0.18) * (0.35 + 0.65 * archAO);
      topGlazeTerm = skyLanternDiff + glazeSpec * candleFlick;
    }

    // 5) 漫天千灯环境侧逆微高光
    vec3 rimLightDir = normalize(vec3(0.0, 0.65, -0.76));
    vec3 H = normalize(viewDir + rimLightDir);
    float specPow = mix(42.0, 12.0, roughness);
    float specStrength = (1.0 - roughness * 0.82) * lightGain;
    float spec = pow(max(dot(N, H), 0.0), specPow) * specStrength;
    float fresnel = pow(1.0 - max(dot(N, viewDir), 0.0), 3.4) * (1.0 - roughness * 0.72) * lightGain;

    vec3 col = skyAmb + poolBounce + lanternWarm + topGlazeTerm
             + uGoldColor * (spec * 0.34 + fresnel * 0.12 * (1.0 + 0.6 * uDropIgnite)) * archAO;

    // 胶片级柔和肩部压限，确保古建基座、栏杆与琉璃瓦面温润润泽绝不泛白过曝
    col = col / (vec3(1.0) + col * 0.58);

    float dist = length(uCamPos - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * 0.0068, 1.8));
    col = mix(col, uFogColor, clamp(fog, 0.0, 0.92));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class PavilionScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.1, 350);
  private rig: LyricRig;

  // 预烘焙音频与天灯放飞事件
  private kickTimes: Float64Array;
  private kickAmps: Float32Array;
  private snareTimes: Float64Array;
  private downbeatTimes: Float64Array;
  private ambientSkyLanterns: AmbientSkyLanternSpec[] = [];
  readonly releasedSkyLanterns: ReleasedSkyLanternEvent[] = [];
  private releasedLanternTimes = new Float64Array(0);
  private lotusSpecs: LotusLanternSpec[] = [];

  // 场景核心组件
  readonly pavilionGroup = new THREE.Group();
  private skyDomeMesh: THREE.Mesh;
  private skyDomeUniforms: {
    uInvVP: { value: THREE.Matrix4 };
    uCamPos: { value: THREE.Vector3 };
    uZenithColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uGoldColor: { value: THREE.Color };
    uTime: { value: number };
    uLanternWarmth: { value: number };
  };
  private silkPoolMesh: THREE.Mesh;
  private silkPoolMaterial: THREE.ShaderMaterial;
  private cloudsFloorMesh: THREE.Mesh;
  private cloudsFloorMaterial: THREE.ShaderMaterial;
  private stringsLines: THREE.Line[];
  readonly koiInstanced: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly koiMaterial: THREE.ShaderMaterial;
  private koiRipplesInstanced: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private koiStates: KoiState[] = [];
  readonly firefliesPoints: THREE.Points;
  readonly firefliesMaterial: THREE.ShaderMaterial;
  private fireflyBasePos: Float32Array;
  private lightPillarMesh: THREE.Mesh;
  private lightPillarMaterial: THREE.ShaderMaterial;

  // 三维灯火系统核心公开网格（供自动化测试与视觉核验检视）
  readonly skyLanternsMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly skyLanternHalosMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly palaceLanternsPavilionMesh!: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly palaceLanternsPoolMesh!: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly lotusLanternsMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private skyLanternPosAttr: THREE.InstancedBufferAttribute;
  private skyLanternStateAttr: THREE.InstancedBufferAttribute;
  private lotusPosAttr: THREE.InstancedBufferAttribute;
  private reusableDummy = new THREE.Object3D();

  // 色彩基调（严格遵循 R5 同色系微调与黑白中性灰 S <= 0.05 保护规则）
  readonly colorGold: THREE.Color;
  readonly colorMain: THREE.Color;
  readonly colorDeep: THREE.Color;
  readonly colorFlameCore: THREE.Color;
  readonly colorLacquer: THREE.Color;
  readonly colorRoofTile: THREE.Color;
  readonly colorJade: THREE.Color;

  private uniforms: {
    uTime: { value: number };
    uCamPos: { value: THREE.Vector3 };
    uCover: { value: THREE.Texture };
    uMelodyGlow: { value: number };
    uDropIgnite: { value: number };
    uPillarIgnite: { value: number };
    uFireflyAscent: { value: number };
    uKickPulse: { value: number };
    uGoldColor: { value: THREE.Color };
    uMainColor: { value: THREE.Color };
    uFlameCore: { value: THREE.Color };
    uFogColor: { value: THREE.Color };
  };

  constructor(private init: SceneInit, _look?: string) {
    // 1. 色彩提取与微调（严格遵循同色系微调与黑白中性灰保护）
    const tone = extractCoverTone(init);
    const isMono = tone.mono || init.palette.mono;
    const seed = init.seed ?? 1001;
    const seedRand = rng((seed ^ 0x77aa88ff) >>> 0);
    const deltaHue = isMono ? 0 : (seedRand() < 0.5 ? -1 : 1) * (6 + 10 * seedRand());

    const stopMain = tuneCoverStop(tone.mid, tone, 0.46, 0.76, 0.42, 0.90, deltaHue);
    const stopDeep = tuneCoverStop(tone.dark, tone, 0.05, 0.16, 0.18, 0.55, deltaHue);
    const stopGold = tuneCoverStop(tone.highlight, tone, 0.68, 0.94, 0.58, 0.96, deltaHue);

    this.colorMain = isMono ? colorFromHsl(0, 0, stopMain.l) : colorFromHsl(stopMain.h, stopMain.s, stopMain.l);
    this.colorDeep = isMono ? colorFromHsl(0, 0, stopDeep.l) : colorFromHsl(stopDeep.h, stopDeep.s, stopDeep.l);
    this.colorGold = isMono ? colorFromHsl(0, 0, stopGold.l) : colorFromHsl(stopGold.h, stopGold.s, stopGold.l);
    this.colorFlameCore = isMono
      ? colorFromHsl(0, 0, 0.97)
      : colorFromHsl(stopGold.h, Math.min(0.32, stopGold.s * 0.36), 0.96);
    this.colorLacquer = isMono
      ? colorFromHsl(0, 0, 0.22)
      : colorFromHsl(stopMain.h, Math.min(0.68, stopMain.s * 0.85 + 0.12), 0.24);
    this.colorRoofTile = isMono
      ? colorFromHsl(0, 0, 0.19)
      : colorFromHsl(stopDeep.h, Math.min(0.48, stopDeep.s * 0.85 + 0.08), 0.21);
    this.colorJade = isMono
      ? colorFromHsl(0, 0, 0.33)
      : colorFromHsl(stopDeep.h, Math.min(0.16, stopDeep.s * 0.38), 0.34);

    const fogColor = this.colorDeep.clone().multiplyScalar(0.34);
    this.scene.background = fogColor.clone();
    this.scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0068);

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
    this.snareTimes = new Float64Array(snares.length);
    for (let i = 0; i < snares.length; i++) this.snareTimes[i] = snares[i][0];
    this.downbeatTimes = new Float64Array(downbeats.length);
    for (let i = 0; i < downbeats.length; i++) this.downbeatTimes[i] = downbeats[i];

    // 3. 着色器共享 Uniforms
    this.uniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3(0, 3.75, -14) },
      uCover: { value: init.cover },
      uMelodyGlow: { value: 0 },
      uDropIgnite: { value: 0 },
      uPillarIgnite: { value: 0 },
      uFireflyAscent: { value: 0 },
      uKickPulse: { value: 0 },
      uGoldColor: { value: this.colorGold },
      uMainColor: { value: this.colorMain },
      uFlameCore: { value: this.colorFlameCore },
      uFogColor: { value: fogColor },
    };

    // 4. 瑶池星汉夜空天幕 (Celestial Night Sky Dome)
    const skyTri = new THREE.BufferGeometry();
    skyTri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const zenithCol = fogColor.clone().multiplyScalar(0.58);
    const horizonCol = fogColor.clone().lerp(this.colorMain, 0.16).multiplyScalar(0.95);
    this.skyDomeUniforms = {
      uInvVP: { value: new THREE.Matrix4() },
      uCamPos: this.uniforms.uCamPos,
      uZenithColor: { value: zenithCol },
      uHorizonColor: { value: horizonCol },
      uGoldColor: this.uniforms.uGoldColor,
      uTime: this.uniforms.uTime,
      uLanternWarmth: { value: 0.5 },
    };
    this.skyDomeMesh = new THREE.Mesh(
      skyTri,
      new THREE.ShaderMaterial({
        uniforms: this.skyDomeUniforms,
        vertexShader: CELESTIAL_SKY_VERT,
        fragmentShader: CELESTIAL_SKY_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.skyDomeMesh.frustumCulled = false;
    this.skyDomeMesh.renderOrder = -10;
    this.skyDomeMesh.onBeforeRender = (_r, _s, cam) => {
      cam.updateMatrixWorld();
      this.skyDomeUniforms.uInvVP.value
        .multiplyMatrices((cam as THREE.PerspectiveCamera).projectionMatrix, cam.matrixWorldInverse)
        .invert();
    };
    this.scene.add(this.skyDomeMesh);

    // 5. 流光翻涌东方云海基底 (Volumetric Sea of Clouds at Y = -3.8m)
    const cloudsGeo = new THREE.PlaneGeometry(320, 320, 48, 48);
    this.cloudsFloorMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCamPos: this.uniforms.uCamPos,
        uGoldColor: this.uniforms.uGoldColor,
        uMainColor: this.uniforms.uMainColor,
        uFogColor: this.uniforms.uFogColor,
        uDropIgnite: this.uniforms.uDropIgnite,
        uMelodyGlow: this.uniforms.uMelodyGlow,
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying float vBillow;

        float h21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float n2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
                     mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec2 cuv = wp.xz * 0.045 + vec2(uTime * 0.028, -uTime * 0.018);
          float b = n2(cuv) * 0.65 + n2(cuv * 2.3 + 4.1) * 0.35;
          // 避开中央天池区域，在外围云海掀起柔和云涛起伏
          float poolClear = smoothstep(13.0, 24.0, length(wp.xz - vec2(0.0, -32.0)));
          wp.y += (b - 0.35) * 3.2 * poolClear;
          vBillow = b;
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform vec3 uGoldColor;
        uniform vec3 uMainColor;
        uniform vec3 uFogColor;
        uniform float uDropIgnite;
        uniform float uMelodyGlow;
        varying vec3 vWorldPos;
        varying float vBillow;

        float h21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }
        float n2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
                     mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        void main() {
          vec2 cuv = vWorldPos.xz * 0.08 + vec2(uTime * 0.035, -uTime * 0.022);
          float detail = n2(cuv) * 0.6 + n2(cuv * 2.4 - 3.7) * 0.4;
          float cloudCrest = smoothstep(0.32, 0.84, vBillow * 0.6 + detail * 0.4);

          float rad = length(vWorldPos.xz - vec2(0.0, -32.0));
          // 天阙与漫天千灯向下方云海投射温暖的金色漫射霞光
          float pavilionGlow = exp(-rad * 0.032) * (0.55 + 0.45 * uDropIgnite + 0.25 * uMelodyGlow);
          float lanternDots = smoothstep(0.68, 0.95, n2(vWorldPos.xz * 0.16 + vec2(0.0, uTime * 0.05))) * exp(-rad * 0.012);

          vec3 baseCloud = mix(uFogColor * 0.85, mix(uFogColor * 2.1, uMainColor * 0.34, 0.55), cloudCrest);
          vec3 litCloud = baseCloud + mix(uMainColor, uGoldColor, 0.65) * cloudCrest * (pavilionGlow * 0.42 + lanternDots * 0.22);

          float dist = length(uCamPos - vWorldPos);
          float fog = 1.0 - exp(-pow(dist * 0.0068, 1.75));
          vec3 col = mix(litCloud, uFogColor, clamp(fog, 0.0, 0.96));
          gl_FragColor = vec4(col, 0.94);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.cloudsFloorMesh = new THREE.Mesh(cloudsGeo, this.cloudsFloorMaterial);
    this.cloudsFloorMesh.rotation.x = -Math.PI / 2;
    this.cloudsFloorMesh.position.set(0, -3.6, PAVILION_Z);
    this.scene.add(this.cloudsFloorMesh);

    // 6. 圆形瑶池清波水面映照画卷封面 + 菲涅尔夜水光学 + 宫灯/河灯涟漪倒影 (Silk Scroll Pool at Y = 0.05, Z = -32m)
    const poolGeo = new THREE.CircleGeometry(POOL_RADIUS, 72);
    this.silkPoolMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCover: this.uniforms.uCover,
        uTime: this.uniforms.uTime,
        uCamPos: this.uniforms.uCamPos,
        uMelodyGlow: this.uniforms.uMelodyGlow,
        uDropIgnite: this.uniforms.uDropIgnite,
        uGoldColor: this.uniforms.uGoldColor,
        uMainColor: this.uniforms.uMainColor,
        uFlameCore: this.uniforms.uFlameCore,
        uFogColor: this.uniforms.uFogColor,
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
        uniform sampler2D uCover;
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform float uMelodyGlow;
        uniform float uDropIgnite;
        uniform vec3 uGoldColor;
        uniform vec3 uMainColor;
        uniform vec3 uFlameCore;
        uniform vec3 uFogColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        float poolHash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }
        float poolNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(poolHash(i), poolHash(i + vec2(1.0, 0.0)), u.x),
                     mix(poolHash(i + vec2(0.0, 1.0)), poolHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        void main() {
          vec2 centered = vUv - vec2(0.5);
          float r = length(centered) * 2.0;

          // 多频清澈水波微折射（严格保持原封面空间色块拓扑连贯）
          float w1 = poolNoise(vWorldPos.xz * 0.85 + vec2(uTime * 0.36, -uTime * 0.28));
          float w2 = poolNoise(vWorldPos.xz * 1.95 - vec2(uTime * 0.44, uTime * 0.31));
          float ripple = sin(r * 22.0 - uTime * 3.2) * 0.0048 + (w1 + w2 - 1.0) * 0.0055;
          vec2 warpedUv = clamp(vUv + centered * ripple * 1.35, 0.0, 1.0);
          vec4 coverColor = texture2D(uCover, warpedUv);

          // 真实夜色瑶池深水透射与菲涅尔视角反射（既完整保留画卷封面连贯色块，又赋予幽静清波深水感）
          vec3 viewDir = normalize(uCamPos - vWorldPos);
          vec3 waterN = normalize(vec3((w1 - 0.5) * 0.10, 1.0, (w2 - 0.5) * 0.10));
          float fresnel = pow(1.0 - clamp(dot(waterN, viewDir), 0.0, 1.0), 3.0);
          float radialDepth = mix(0.76, 0.44, smoothstep(0.12, 0.96, r));
          vec3 nightWaterBed = mix(uFogColor * 1.15, coverColor.rgb * radialDepth, 0.86);

          // 八盏飞檐宫灯与外圈莲花河灯在水波上的拉丝柔光倒影与细密水纹丝光
          float ang = atan(vWorldPos.z + 32.0, vWorldPos.x);
          float eightFold = pow(0.5 + 0.5 * cos(ang * 8.0 + ripple * 20.0), 4.0);
          float eaveReflBand = exp(-pow((r - 0.48) * 5.4, 2.0)) * eightFold;
          float lotusReflBand = exp(-pow((r - 0.85) * 7.8, 2.0)) * (0.52 + 0.48 * sin(ang * 16.0 - uTime * 2.1));
          float fineRipples = (0.5 + 0.5 * sin(r * 42.0 - uTime * 3.8 + w1 * 3.0)) * 0.045;
          float shimmer = 0.82 + 0.18 * sin(r * 36.0 - uTime * 4.8 + ang * 4.0);
          vec3 lanternRefl = mix(uGoldColor, uFlameCore, 0.30) * (eaveReflBand * 0.34 + lotusReflBand * 0.40 + fineRipples) * shimmer;

          // 池畔温润石岸内缘暗金水际线与高潮水波律动
          float edgeRing = smoothstep(0.996, 0.948, r);
          float goldBorder = smoothstep(0.935, 0.962, r) * smoothstep(1.0, 0.980, r);
          float waveSurge = max(0.0, sin(r * 13.0 - uTime * 7.2)) * uDropIgnite * 0.18;

          vec3 skyRefl = mix(uFogColor * 1.6, uGoldColor * 0.28, 0.35) * fresnel * 0.65;
          vec3 finalRgb = (nightWaterBed + skyRefl + lanternRefl) * edgeRing;
          finalRgb += uGoldColor * (goldBorder * 0.95 + waveSurge + uMelodyGlow * 0.08) * edgeRing;

          gl_FragColor = vec4(finalRgb, edgeRing);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.silkPoolMesh = new THREE.Mesh(poolGeo, this.silkPoolMaterial);
    this.silkPoolMesh.rotation.x = -Math.PI / 2;
    this.silkPoolMesh.position.set(0, 0.05, PAVILION_Z);
    this.silkPoolMesh.renderOrder = 0;
    this.scene.add(this.silkPoolMesh);

    // 7. 重檐八角飞檐起翘天阙古建、汉白玉雕栏与 24 盏古典六角鎏金宫灯
    this.buildPavilionAndPalaceLanterns();
    this.pavilionGroup.position.set(0, 5.35, PAVILION_Z);
    this.scene.add(this.pavilionGroup);

    // 8. 漫天升腾三维宣纸孔明灯海（260 盏环绕常驻 + 最多 160 盏随音乐/歌词实时放飞）
    this.bakeSkyLanterns(seed ^ 0x39c4e2a1);
    const skyLanternGeo = new THREE.InstancedBufferGeometry();
    const baseSkyGeo = createSkyLanternGeometry();
    skyLanternGeo.index = baseSkyGeo.index;
    skyLanternGeo.attributes.position = baseSkyGeo.attributes.position;
    skyLanternGeo.attributes.normal = baseSkyGeo.attributes.normal;
    skyLanternGeo.attributes.uv = baseSkyGeo.attributes.uv;

    this.skyLanternPosAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SKY_LANTERNS * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.skyLanternStateAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SKY_LANTERNS * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    skyLanternGeo.setAttribute('aLanternPos', this.skyLanternPosAttr);
    skyLanternGeo.setAttribute('aLanternState', this.skyLanternStateAttr);
    skyLanternGeo.instanceCount = 0;

    const skyLanternMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCamPos: this.uniforms.uCamPos,
        uFlameCore: this.uniforms.uFlameCore,
        uGoldColor: this.uniforms.uGoldColor,
        uMainColor: this.uniforms.uMainColor,
        uFogColor: this.uniforms.uFogColor,
      },
      vertexShader: SKY_LANTERN_VERT,
      fragmentShader: SKY_LANTERN_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    this.skyLanternsMesh = new THREE.Mesh(skyLanternGeo, skyLanternMat);
    this.skyLanternsMesh.frustumCulled = false;
    this.skyLanternsMesh.renderOrder = 2;
    this.scene.add(this.skyLanternsMesh);

    // 配套孔明灯大气柔光晕实例网格（共享同一对动态属性缓冲，零额外 CPU 开销）
    const haloGeo = new THREE.InstancedBufferGeometry();
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    haloGeo.setIndex([0, 1, 2, 2, 1, 3]);
    haloGeo.setAttribute('aLanternPos', this.skyLanternPosAttr);
    haloGeo.setAttribute('aLanternState', this.skyLanternStateAttr);
    haloGeo.instanceCount = 0;

    const haloMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uFlameCore: this.uniforms.uFlameCore,
        uGoldColor: this.uniforms.uGoldColor,
        uMainColor: this.uniforms.uMainColor,
      },
      vertexShader: LANTERN_HALO_VERT,
      fragmentShader: LANTERN_HALO_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.skyLanternHalosMesh = new THREE.Mesh(haloGeo, haloMat);
    this.skyLanternHalosMesh.frustumCulled = false;
    this.skyLanternHalosMesh.renderOrder = 3;
    this.scene.add(this.skyLanternHalosMesh);

    // 9. 天池双层十六瓣盛开莲花河灯 (32 Floating Lotus Water Lanterns)
    const lotusBaseGeo = createLotusLanternGeometry();
    const lotusInstGeo = new THREE.InstancedBufferGeometry();
    lotusInstGeo.attributes.position = lotusBaseGeo.attributes.position;
    lotusInstGeo.attributes.normal = lotusBaseGeo.attributes.normal;
    lotusInstGeo.attributes.uv = lotusBaseGeo.attributes.uv;

    this.lotusPosAttr = new THREE.InstancedBufferAttribute(new Float32Array(NUM_LOTUS_LANTERNS * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    const lotusMetaArr = new Float32Array(NUM_LOTUS_LANTERNS * 2);
    const lotusRand = rng((seed ^ 0x8127bc45) >>> 0);
    for (let i = 0; i < NUM_LOTUS_LANTERNS; i++) {
      const innerRing = i < 20;
      const radius = innerRing ? 9.6 + lotusRand() * 3.3 : 15.2 + lotusRand() * 4.5;
      const angle0 = (i / (innerRing ? 20 : 12)) * Math.PI * 2 + (lotusRand() - 0.5) * 0.24;
      const omega = (innerRing ? 0.045 : -0.028) * (0.85 + 0.3 * lotusRand());
      const scale = (innerRing ? 0.78 : 0.92) * (0.88 + 0.25 * lotusRand());
      const s = lotusRand();
      this.lotusSpecs.push({ radius, angle0, omega, scale, seed: s });
      lotusMetaArr[i * 2] = scale;
      lotusMetaArr[i * 2 + 1] = s;
    }
    lotusInstGeo.setAttribute('aLotus', this.lotusPosAttr);
    lotusInstGeo.setAttribute('aLotusMeta', new THREE.InstancedBufferAttribute(lotusMetaArr, 2));
    lotusInstGeo.instanceCount = NUM_LOTUS_LANTERNS;

    const lotusMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCamPos: this.uniforms.uCamPos,
        uFlameCore: this.uniforms.uFlameCore,
        uGoldColor: this.uniforms.uGoldColor,
        uMainColor: this.uniforms.uMainColor,
        uMelodyGlow: this.uniforms.uMelodyGlow,
      },
      vertexShader: LOTUS_LANTERN_VERT,
      fragmentShader: LOTUS_LANTERN_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.lotusLanternsMesh = new THREE.Mesh(lotusInstGeo, lotusMat);
    this.lotusLanternsMesh.frustumCulled = false;
    this.scene.add(this.lotusLanternsMesh);

    // 10. 七弦流光古琴仙弦（两端柔和羽化渐隐 + 俯视自动收敛，避免生硬横线割裂池面构图）
    this.stringsLines = [];
    const stringMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCamPos: this.uniforms.uCamPos,
        uGoldColor: this.uniforms.uGoldColor,
        uMelodyGlow: this.uniforms.uMelodyGlow,
      },
      vertexShader: /* glsl */ `
        attribute float aStrT;
        varying float vStrT;
        varying vec3 vWorldPos;
        void main() {
          vStrT = aStrT;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform vec3 uGoldColor;
        uniform float uMelodyGlow;
        varying float vStrT;
        varying vec3 vWorldPos;
        void main() {
          float endFade = sin(vStrT * 3.14159265);
          endFade = endFade * endFade;
          // 俯视高机位时柔和收敛琴弦光丝，不干扰亭顶与池鱼观赏
          vec3 vDir = normalize(uCamPos - vWorldPos);
          float topSuppress = 1.0 - 0.78 * smoothstep(0.45, 0.85, abs(vDir.y));
          float wave = 0.72 + 0.28 * sin(vStrT * 18.0 - uTime * 4.2);
          float alpha = endFade * topSuppress * wave * (0.24 + 0.22 * uMelodyGlow);
          gl_FragColor = vec4(uGoldColor * alpha, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < NUM_STRINGS; i++) {
      const u = (i - (NUM_STRINGS - 1) * 0.5) * 1.5;
      const pts: THREE.Vector3[] = [];
      const strT: number[] = [];
      const numPts = 36;
      for (let p = 0; p <= numPts; p++) {
        const tVal = p / numPts;
        const x = lerp(-9.5, 9.5, tVal);
        const y = 1.95 + 0.32 * Math.sin(tVal * Math.PI) + (i % 2) * 0.16;
        const z = PAVILION_Z + u + Math.sin(tVal * Math.PI * 0.5) * 2.0;
        pts.push(new THREE.Vector3(x, y, z));
        strT.push(tVal);
      }
      const stringGeo = new THREE.BufferGeometry().setFromPoints(pts);
      stringGeo.setAttribute('aStrT', new THREE.Float32BufferAttribute(strT, 1));
      const strLine = new THREE.Line(stringGeo, stringMat);
      this.stringsLines.push(strLine);
      this.scene.add(strLine);
    }

    // 11. 三维解剖级东方灵韵锦鲤（半浸瑶池清波、红白/丹顶/鎏金花斑、吻须鳃盖、珠光鱼鳞、蝴蝶胸尾鳍与伴游涟漪）
    const koiGeo = createKoiGeometry();
    const koiMetaArr = new Float32Array(NUM_KOI * 2);
    for (let i = 0; i < NUM_KOI; i++) {
      const fishSeed = seedRand();
      const pattern = i % 3; // 0: 经典红白大云斑 (Kohaku), 1: 鸿运丹顶 (Tancho), 2: 璀璨黄金鲤 (Ogon)
      koiMetaArr[i * 2] = fishSeed;
      koiMetaArr[i * 2 + 1] = pattern;
      this.koiStates.push({
        speed: 0.34 + seedRand() * 0.22,
        phase: (i / NUM_KOI) * Math.PI * 2 + (seedRand() - 0.5) * 0.35,
        radiusX: 5.0 + seedRand() * 6.6,
        radiusZ: 4.8 + seedRand() * 6.3,
        // 半浸于 y = 0.05 水面之下：鱼背微贴清波映光，鱼腹与蝴蝶胸尾鳍自然浸没水中
        yBase: 0.012 + seedRand() * 0.026,
        scale: 0.80 + seedRand() * 0.30,
        seed: fishSeed,
        pattern,
      });
    }
    koiGeo.setAttribute('aKoiMeta', new THREE.InstancedBufferAttribute(koiMetaArr, 2));

    this.koiMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCamPos: this.uniforms.uCamPos,
        uGoldColor: this.uniforms.uGoldColor,
        uMainColor: this.uniforms.uMainColor,
        uFlameCore: this.uniforms.uFlameCore,
        uFogColor: this.uniforms.uFogColor,
        uMelodyGlow: this.uniforms.uMelodyGlow,
      },
      vertexShader: /* glsl */ `
        attribute vec2 aKoiMeta;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        varying vec3 vLocalOrig;
        varying vec2 vMeta;

        void main() {
          vUv = uv;
          vMeta = aKoiMeta;
          vLocalOrig = position;

          vec3 p = position;
          vec3 n = normal;
          float u = clamp(uv.x, 0.0, 1.0);
          float fishPhase = aKoiMeta.x * 37.699;

          // 胸鳍与腹鳍 (uv.y in [2.10, 2.90]) 随游弋做优雅柔和划水扇动
          if (uv.y > 2.05 && uv.y < 2.95) {
            float finSpan = clamp((uv.y - 2.10) / 0.80, 0.0, 1.0);
            float flap = sin(uTime * 5.2 + fishPhase - finSpan * 1.35) * 0.055 * finSpan * finSpan;
            p.y += flap;
            p.z -= abs(flap) * 0.20;
          }

          // 生物力学鲹科/鲤科行波S形推进曲线：头部稳健微摆，腰尾至双叶燕尾柔顺推进
          float waveArg = uTime * 6.2 - u * 5.2 + fishPhase;
          float amp = 0.014 + 0.21 * pow(u, 1.90);
          float dx = sin(waveArg) * amp;
          float slope = -5.2 * cos(waveArg) * amp * (1.0 / 1.58);
          float yawAng = clamp(atan(slope) * 0.65, -0.46, 0.46);
          float cy = cos(yawAng);
          float sy = sin(yawAng);

          // 横截面与表面法线随脊椎弯曲自然偏转，保持鱼体饱满圆润
          vec3 bentPos = vec3(p.x * cy + dx, p.y, -p.x * sy + p.z);
          vec3 bentNorm = normalize(vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy));

          vec4 wp = modelMatrix * instanceMatrix * vec4(bentPos, 1.0);
          vWorldPos = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix * instanceMatrix) * bentNorm);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform vec3 uGoldColor;
        uniform vec3 uMainColor;
        uniform vec3 uFlameCore;
        uniform vec3 uFogColor;
        uniform float uMelodyGlow;

        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        varying vec3 vLocalOrig;
        varying vec2 vMeta;

        float koiHash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        float koiNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(koiHash(i), koiHash(i + vec2(1.0, 0.0)), u.x),
            mix(koiHash(i + vec2(0.0, 1.0)), koiHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        void main() {
          vec3 N = normalize(vNormalW);
          if (!gl_FrontFacing) N = -N;
          vec3 viewDir = normalize(uCamPos - vWorldPos);
          float seed = vMeta.x;
          float pattern = vMeta.y;

          // 真实吃水线光学：水面在 y = 0.05，鱼背贴水湿亮，鱼腹与鱼鳍浸入清波带柔和折射水雾与弯月面水环
          float waterLevel = 0.052 + 0.005 * sin(vWorldPos.x * 3.5 + uTime * 3.0);
          float submerge = clamp((waterLevel - vWorldPos.y) / 0.145, 0.0, 1.0);
          float meniscus = exp(-pow((vWorldPos.y - waterLevel) / 0.011, 2.0));
          vec3 waterTint = mix(uFogColor * 1.45, uMainColor * 0.42, 0.48);

          // 温润暖玉象牙白底色与醇厚绯金/赤金锦斑（黑白封面下严格保持 S=0 水墨银鳞）
          vec3 ivoryWhite = mix(vec3(0.90), uFlameCore, 0.56);
          vec3 vermilionBrocade = mix(uMainColor * 1.25, uGoldColor * 0.92, 0.24);
          vec3 goldenBrocade = mix(uGoldColor * 1.12, uFlameCore, 0.20);

          // 1) 半透明丝绢鱼鳍（双叶燕尾 1.1..1.9 / 蝴蝶胸腹鳍 2.1..2.9 / 旗状背鳍 3.1..3.9）
          if (vUv.y > 1.05) {
            float finLocal = clamp(fract(vUv.y - 0.10) / 0.80, 0.0, 1.0);
            float rayCoord = (vUv.y < 2.0 ? finLocal * 24.0 : vUv.x * 48.0);
            float rays = 0.76 + 0.24 * pow(0.5 + 0.5 * sin(rayCoord * 6.28318), 1.5);
            float edgeFeather = smoothstep(1.0, 0.26, finLocal);
            float rootTint = exp(-finLocal * 2.4);

            vec3 finBase = mix(ivoryWhite * 0.96, pattern > 1.5 ? goldenBrocade : vermilionBrocade, rootTint * 0.52);
            float upLit = 0.68 + 0.32 * clamp(N.y, 0.0, 1.0);
            float rimGlow = pow(1.0 - abs(dot(N, viewDir)), 2.0) * 0.32;
            vec3 finCol = finBase * rays * upLit + uGoldColor * rimGlow;
            // 浸入水下的鱼鳍柔和融入瑶池清波色泽
            finCol = mix(finCol, mix(finCol, waterTint + uGoldColor * 0.14, 0.42), submerge);
            float alpha = clamp((0.16 + 0.66 * edgeFeather) * (0.82 + 0.18 * rays) * (1.0 - 0.22 * submerge), 0.05, 0.86);
            gl_FragColor = vec4(finCol, alpha);
            return;
          }

          // 2) 饱满流线鱼躯：名贵锦鲤“切边”花斑 + 鳃盖弧线 + 交错菱形珠光鱼鳞 + 乌润双眸 + 水线折射
          float u = clamp(vUv.x / 0.72, 0.0, 1.0); // 0=吻端与龙须, 1=尾柄
          float bellyMask = smoothstep(-0.18, 0.32, vLocalOrig.y / 0.15);

          float patchMask = 0.0;
          if (pattern < 0.5) {
            // 款式0：御苑红白锦鲤 (Kohaku) —— 大块圆润饱满的云朵状绯金斑块，边缘利落（Kiwa 切边）
            vec2 pUv = vec2(u * 3.8 + seed * 13.7, vLocalOrig.x * 5.2 + seed * 7.3);
            float n = koiNoise(pUv) * 0.70 + koiNoise(pUv * 2.2 + 3.1) * 0.30;
            patchMask = smoothstep(0.45, 0.52, n) * bellyMask;
          } else if (pattern < 1.5) {
            // 款式1：鸿运丹顶锦鲤 (Tancho) —— 欺霜赛雪玉白银鳞，额顶正中一轮圆润朱金丹印
            float crownDist = length(vec2((u - 0.135) * 5.4, vLocalOrig.x * 7.0));
            float crownSpot = smoothstep(0.56, 0.42, crownDist) * step(0.0, vLocalOrig.y);
            float tailSpot = smoothstep(0.86, 0.94, u) * bellyMask * 0.70;
            patchMask = clamp(crownSpot + tailSpot, 0.0, 1.0);
          } else {
            // 款式2：鎏金皇室黄金鲤 (Yamabuki Ogon) —— 满背璀璨鎏金锦鳞，腹部温润象牙白
            patchMask = smoothstep(0.12, 0.58, bellyMask);
          }

          vec3 bodyPalette = pattern > 1.5
            ? mix(ivoryWhite * 0.94, goldenBrocade, patchMask)
            : mix(ivoryWhite, vermilionBrocade, patchMask);

          // 鳃盖柔和弧缝细节 (u ≈ 0.185)
          float gillCurve = abs(u - 0.185 + 0.022 * clamp(vLocalOrig.y * 8.0, -1.0, 1.0));
          float gillLine = (1.0 - 0.18 * exp(-pow(gillCurve / 0.008, 2.0))) * step(-0.06, vLocalOrig.y);
          bodyPalette *= gillLine;

          // 交错菱形珠光鱼鳞网格（头盖 u < 0.19 光滑玉润，躯干 u >= 0.19 排布细密鱼鳞）
          float hasScales = smoothstep(0.17, 0.22, u);
          vec2 scaleGrid = vec2(u * 28.0, atan(vLocalOrig.y, vLocalOrig.x) * 4.5);
          scaleGrid.y += mod(floor(scaleGrid.x), 2.0) * 0.5;
          vec2 sf = fract(scaleGrid) - 0.5;
          float scaleArc = clamp(1.0 - dot(sf, sf) * 3.1, 0.0, 1.0);
          float scaleRim = smoothstep(0.18, 0.02, abs(length(sf) - 0.44)) * step(sf.x, 0.15);
          bodyPalette *= mix(1.0, 0.87 + 0.19 * scaleArc, hasScales);
          N = normalize(N + vec3(sf.x, sf.y, 0.0) * (0.18 * hasScales));

          // 头部两侧乌润灵动鱼眼与细金眼圈 (u ≈ 0.095, 侧上方)
          float sideX = abs(vLocalOrig.x);
          float eyeDist = length(vec2((u - 0.098) * 15.0, (vLocalOrig.y - 0.024) * 19.0));
          if (sideX > 0.042 && eyeDist < 0.52) {
            float pupil = smoothstep(0.32, 0.20, eyeDist);
            float goldRing = smoothstep(0.52, 0.36, eyeDist) * (1.0 - pupil);
            bodyPalette = mix(bodyPalette, uGoldColor * 1.18, goldRing * 0.92);
            bodyPalette = mix(bodyPalette, vec3(0.03), pupil * 0.96);
          }

          // 活鱼生物组织次表面暖玉透射 (SSS) + 清波涟漪焦散 + 水膜清漆高光
          float topLight = clamp(N.y * 0.55 + 0.45, 0.0, 1.0);
          float sssWarmth = 0.22 * (1.0 - topLight);
          float sideFill = 0.80 + 0.20 * clamp(dot(N, normalize(vec3(0.4, 0.78, 0.5))), 0.0, 1.0);
          float caustics = 0.5 + 0.5 * sin(vWorldPos.x * 5.8 + uTime * 3.8) * cos(vWorldPos.z * 5.8 - uTime * 3.1);

          vec3 H = normalize(viewDir + normalize(vec3(0.25, 0.88, 0.40)));
          float wetSpec = pow(max(dot(N, H), 0.0), 42.0) * (1.0 - 0.55 * submerge);
          float pearlGlint = pow(max(dot(N, H), 0.0), 13.0) * scaleRim * hasScales;

          vec3 col = bodyPalette * (0.42 + 0.68 * topLight * sideFill)
                   + mix(bodyPalette, uGoldColor, 0.45) * sssWarmth
                   + mix(uGoldColor, uFlameCore, 0.48) * (wetSpec * 0.62 + pearlGlint * 0.52 + meniscus * 0.28 + caustics * 0.11)
                   + bodyPalette * uMelodyGlow * 0.12;

          // 水下部分柔和融合清波深水色调，呈现真实“半浸瑶池清波”体积感
          col = mix(col, mix(col * 0.72, waterTint + caustics * uGoldColor * 0.12, 0.46), submerge);
          col = col / (vec3(1.0) + col * 0.36);

          float bodyAlpha = mix(0.99, 0.84, submerge);
          gl_FragColor = vec4(col, bodyAlpha);
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.koiInstanced = new THREE.InstancedMesh(koiGeo, this.koiMaterial, NUM_KOI);
    this.koiInstanced.frustumCulled = false;
    this.koiInstanced.renderOrder = 2;
    this.scene.add(this.koiInstanced);

    // 锦鲤伴游水波纹与水下柔影（紧贴 y = 0.054 水面，含鱼腹水下暗影、扩散金环与 V 形游鱼分水尾迹）
    const ripplePlane = new THREE.PlaneGeometry(1.95, 2.75);
    ripplePlane.rotateX(-Math.PI / 2);
    const koiRippleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uGoldColor: this.uniforms.uGoldColor,
        uFlameCore: this.uniforms.uFlameCore,
        uFogColor: this.uniforms.uFogColor,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uGoldColor;
        uniform vec3 uFlameCore;
        uniform vec3 uFogColor;
        varying vec2 vUv;
        void main() {
          // PlaneGeometry 绕 X 旋 -90° 后：vUv.y=0 为前方(+Z)，vUv.y=1 为后方(-Z)
          vec2 p = vec2((vUv.x - 0.5) * 2.0, (vUv.y - 0.38) * 1.65);
          float r = length(p);
          if (r > 1.05) discard;

          // 1) 鱼身正下方的水下柔和投影，使鱼体稳稳浸融于池水不再悬浮
          float shadowBody = exp(-(p.x * p.x * 16.0 + (p.y - 0.08) * (p.y - 0.08) * 5.2)) * 0.42;

          // 2) 两道向外轻柔扩散的同心椭圆涟漪 + V 形分水尾波
          float p1 = fract(uTime * 0.58);
          float p2 = fract(uTime * 0.58 + 0.5);
          float ring1 = exp(-pow((r - (0.16 + p1 * 0.78)) * 13.0, 2.0)) * (1.0 - p1);
          float ring2 = exp(-pow((r - (0.16 + p2 * 0.78)) * 13.0, 2.0)) * (1.0 - p2);
          float vWake = exp(-pow((abs(p.x) - max(0.0, p.y + 0.12) * 0.48) * 14.0, 2.0))
                      * smoothstep(-0.10, 0.15, p.y) * smoothstep(0.95, 0.25, r) * 0.55;

          float glint = (ring1 + ring2 + vWake) * smoothstep(1.02, 0.20, r) * 0.52;
          float alpha = clamp(shadowBody + glint, 0.0, 0.75);
          vec3 wakeCol = mix(uGoldColor, uFlameCore, 0.38);
          vec3 col = mix(uFogColor * 0.25, wakeCol, glint / max(alpha, 1e-4));
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.koiRipplesInstanced = new THREE.InstancedMesh(ripplePlane, koiRippleMat, NUM_KOI);
    this.koiRipplesInstanced.frustumCulled = false;
    this.koiRipplesInstanced.renderOrder = 1;
    this.scene.add(this.koiRipplesInstanced);

    // 12. 圆润晶莹高斯流萤金尘（自定义圆形柔光点精灵，彻底根除正方形像素块）
    const fireflyGeo = new THREE.BufferGeometry();
    this.fireflyBasePos = new Float32Array(NUM_FIREFLIES * 3);
    const fireflyPhase = new Float32Array(NUM_FIREFLIES * 2);
    for (let i = 0; i < NUM_FIREFLIES; i++) {
      const theta = seedRand() * Math.PI * 2;
      const rad = 2.5 + seedRand() * 17.5;
      this.fireflyBasePos[i * 3] = Math.cos(theta) * rad;
      this.fireflyBasePos[i * 3 + 1] = 0.35 + seedRand() * 9.5;
      this.fireflyBasePos[i * 3 + 2] = PAVILION_Z + Math.sin(theta) * rad;
      fireflyPhase[i * 2] = 0.55 + seedRand() * 0.90;
      fireflyPhase[i * 2 + 1] = seedRand();
    }
    fireflyGeo.setAttribute('position', new THREE.BufferAttribute(this.fireflyBasePos.slice(), 3));
    fireflyGeo.setAttribute('aSpark', new THREE.BufferAttribute(fireflyPhase, 2));
    this.firefliesMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uPixelScale: { value: 1.0 },
        uGoldColor: this.uniforms.uGoldColor,
        uFlameCore: this.uniforms.uFlameCore,
      },
      vertexShader: /* glsl */ `
        attribute vec2 aSpark; // x: 相对大小, y: 闪烁相位
        uniform float uTime;
        uniform float uPixelScale;
        varying float vTwinkle;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vTwinkle = 0.45 + 0.55 * sin(uTime * 3.4 + aSpark.y * 62.83);
          float ptSize = aSpark.x * (165.0 / max(-mv.z, 1.5)) * uPixelScale;
          gl_PointSize = clamp(ptSize, 2.5, 22.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uGoldColor;
        uniform vec3 uFlameCore;
        varying float vTwinkle;
        void main() {
          vec2 d = (gl_PointCoord - vec2(0.5)) * 2.0;
          float r = length(d);
          if (r >= 1.0) discard;
          // 圆润柔和的高斯晶核 + 指数柔边星晕（绝无方形硬边）
          float core = exp(-r * r * 9.5);
          float halo = pow(1.0 - r, 2.8) * 0.52;
          vec3 col = (uFlameCore * core * 1.45 + uGoldColor * halo) * vTwinkle;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.firefliesPoints = new THREE.Points(fireflyGeo, this.firefliesMaterial);
    this.firefliesPoints.onBeforeRender = renderer => {
      const rt = renderer.getRenderTarget();
      const h = rt ? rt.height : renderer.domElement.height;
      if (h > 0) this.firefliesMaterial.uniforms.uPixelScale.value = Math.max(0.5, h / 1080);
    };
    this.scene.add(this.firefliesPoints);

    // 13. 最高潮 (Drop) 冲天流光天柱（纤细仙光丝带，首尾柔和羽化，副歌不遮挡宝顶）
    const pillarGeo = new THREE.CylinderGeometry(0.68, 1.35, 86, 32, 16, true);
    this.lightPillarMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uPillarIgnite: this.uniforms.uPillarIgnite,
        uGoldColor: this.uniforms.uGoldColor,
        uFlameCore: this.uniforms.uFlameCore,
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
        uniform float uPillarIgnite;
        uniform vec3 uGoldColor;
        uniform vec3 uFlameCore;
        varying vec2 vUv;

        void main() {
          if (uPillarIgnite <= 1e-3) discard;
          float rim = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float vertFade = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
          float ribbon1 = 0.5 + 0.5 * sin(vUv.y * 24.0 - uTime * 6.2 + vUv.x * 6.28318 * 2.0);
          float ribbon2 = 0.5 + 0.5 * cos(vUv.y * 15.0 - uTime * 4.1 - vUv.x * 6.28318 * 2.0);
          float core = pow(max(0.0, rim), 4.6);
          float alpha = core * vertFade * (0.35 + 0.65 * ribbon1 * ribbon2) * uPillarIgnite;
          vec3 col = mix(uGoldColor, uFlameCore, 0.42 * core) * 1.35;
          gl_FragColor = vec4(col * alpha * 0.58, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.lightPillarMesh = new THREE.Mesh(pillarGeo, this.lightPillarMaterial);
    this.lightPillarMesh.position.set(0, 42, PAVILION_Z);
    this.scene.add(this.lightPillarMesh);

    // 14. 歌词装配
    this.rig = new LyricRig(init.palette, 'poem');
    this.scene.add(this.rig.group);
  }

  /**
   * 预烘焙 260 盏常驻云海环绕孔明灯 + 全曲随字词/音符实时放飞的天灯事件表
   */
  private bakeSkyLanterns(seed: number): void {
    const rand = rng(seed >>> 0);
    const { music, lyrics } = this.init;

    // 1) 260 盏多景深分层环绕孔明灯（近景两侧飞檐外、中景瑶池畔、远景浩瀚星穹灯海）
    for (let i = 0; i < NUM_AMBIENT_SKY_LANTERNS; i++) {
      let x: number;
      let z: number;
      let yMin: number;
      let ySpan: number;
      let size: number;

      if (i < 68) {
        // 近中景灯群：环绕天池两侧与水榭后侧（留出正前方中央视线走廊，既丰满入画又不挡亭台封面）
        let ang = rand() * Math.PI * 2;
        const rad = 15.2 + rand() * 19.5;
        x = Math.cos(ang) * rad;
        z = PAVILION_Z + Math.sin(ang) * rad;
        if (z > PAVILION_Z + 8.5 && Math.abs(x) < 8.8) {
          x = (x >= 0 ? 1 : -1) * (9.2 + rand() * 8.5);
        }
        yMin = -2.2 + rand() * 2.5;
        ySpan = 26.0 + rand() * 14.0;
        size = 0.72 + rand() * 0.34;
      } else if (i < 168) {
        // 中远景云海灯环
        const ang = rand() * Math.PI * 2;
        const rad = 34.0 + rand() * 36.0;
        x = Math.cos(ang) * rad;
        z = PAVILION_Z + Math.sin(ang) * rad * 0.85 - 6.0;
        yMin = -3.2 + rand() * 4.0;
        ySpan = 36.0 + rand() * 18.0;
        size = 0.82 + rand() * 0.42;
      } else {
        // 远景苍穹千灯背景星河（主要铺展在天阙后方视野扇区 z = -48 .. -145m）
        const fanAng = (rand() - 0.5) * 2.35;
        const dist = 46.0 + rand() * 78.0;
        x = Math.sin(fanAng) * dist * 1.15;
        z = PAVILION_Z - Math.cos(fanAng) * dist;
        yMin = -3.5 + rand() * 8.0;
        ySpan = 46.0 + rand() * 24.0;
        size = 0.92 + rand() * 0.55;
      }

      this.ambientSkyLanterns.push({
        baseX: x,
        baseZ: z,
        yMin,
        ySpan,
        speed: 0.52 + rand() * 0.55,
        phaseOffset: rand() * 40.0,
        swayAmp: 0.45 + rand() * 0.95,
        swayFreq: 0.35 + rand() * 0.42,
        size,
        seed: rand(),
      });
    }

    // 2) 随歌词字词、重拍与主旋律高光音符放飞的新天灯（自天池外圈冉冉升空）
    const rawTimes: Array<{ t0: number; boost: number }> = [];
    for (const line of lyrics.lines) {
      for (const w of line.words) {
        const sec = music.section(w.start);
        const loud = sec?.label === 'drop' || sec?.label === 'chorus';
        rawTimes.push({ t0: w.start, boost: loud ? 1.2 : 1.0 });
        if (loud && rand() < 0.65) {
          rawTimes.push({ t0: w.start + 0.14, boost: 1.15 });
        }
      }
    }

    let lastHit = -1;
    for (const [ht, strength] of music.highlightHits(0, music.duration)) {
      if (strength < 0.20 || ht - lastHit < 0.32) continue;
      rawTimes.push({ t0: ht, boost: 0.95 + 0.25 * strength });
      lastHit = ht;
    }

    if (rawTimes.length < 24) {
      for (let i = 0; i < this.downbeatTimes.length; i++) {
        rawTimes.push({ t0: this.downbeatTimes[i], boost: 1.05 });
      }
    }

    rawTimes.sort((a, b) => a.t0 - b.t0);
    for (let i = 0; i < rawTimes.length; i++) {
      const item = rawTimes[i];
      // 从瑶池四周与水榭飞檐两侧交替放飞
      const side = i % 2 === 0 ? 1 : -1;
      const sectorAng = side * (0.42 + rand() * 2.15);
      const rad = 14.2 + rand() * 16.5;
      const x0 = Math.sin(sectorAng) * rad;
      const z0 = PAVILION_Z + Math.cos(sectorAng) * rad * 0.82 - 2.5;
      this.releasedSkyLanterns.push({
        t0: item.t0,
        x0,
        y0: 0.35 + rand() * 1.4,
        z0,
        riseSpeed: (0.72 + rand() * 0.52) * item.boost,
        windX: (rand() - 0.5) * 0.18,
        windZ: -0.05 - rand() * 0.12,
        size: (0.68 + rand() * 0.28) * Math.min(1.15, item.boost),
        seed: rand(),
      });
    }

    this.releasedLanternTimes = new Float64Array(this.releasedSkyLanterns.length);
    for (let i = 0; i < this.releasedSkyLanterns.length; i++) {
      this.releasedLanternTimes[i] = this.releasedSkyLanterns[i].t0;
    }
  }

  /**
   * 构建重檐八角凹曲起翘天阙古建、汉白玉池栏与 24 盏古典六角鎏金宫灯（16 盏飞檐宫灯 + 8 盏望柱宫灯）
   */
  private buildPavilionAndPalaceLanterns(): void {
    const makeArchMat = (baseCol: THREE.Color, styleKind: number) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.uniforms.uTime,
          uCamPos: this.uniforms.uCamPos,
          uBaseColor: { value: baseCol },
          uGoldColor: this.uniforms.uGoldColor,
          uMainColor: this.uniforms.uMainColor,
          uFlameCore: this.uniforms.uFlameCore,
          uFogColor: this.uniforms.uFogColor,
          uStyleKind: { value: styleKind },
          uMelodyGlow: this.uniforms.uMelodyGlow,
          uDropIgnite: this.uniforms.uDropIgnite,
        },
        vertexShader: PAVILION_ARCH_VERT,
        fragmentShader: PAVILION_ARCH_FRAG,
        side: THREE.DoubleSide,
      });

    const lacquerMat = makeArchMat(this.colorLacquer, 0);
    const roofTileMat = makeArchMat(this.colorRoofTile, 1);
    const jadeMat = makeArchMat(this.colorJade, 2);
    const goldMat = makeArchMat(this.colorGold, 3);
    const floorBrickColor = this.colorRoofTile.clone().multiplyScalar(1.18);
    const floorBrickMat = makeArchMat(floorBrickColor, 4);

    // 1) 天池外围夜色青白石池沿、石雕莲瓣望柱与挑灯木臂（固定于池畔世界坐标）
    const poolCurbParts: THREE.BufferGeometry[] = [];
    const poolWoodParts: THREE.BufferGeometry[] = [];
    const curbOuter = new THREE.CylinderGeometry(POOL_RADIUS + 0.98, POOL_RADIUS + 1.28, 0.36, 64, 1, true);
    curbOuter.translate(0, 0.15, PAVILION_Z);
    poolCurbParts.push(curbOuter.toNonIndexed());
    const curbTop = new THREE.RingGeometry(POOL_RADIUS - 0.04, POOL_RADIUS + 1.02, 64);
    curbTop.rotateX(-Math.PI / 2);
    curbTop.translate(0, 0.33, PAVILION_Z);
    poolCurbParts.push(curbTop.toNonIndexed());

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const px = Math.cos(a) * (POOL_RADIUS + 0.62);
      const pz = PAVILION_Z + Math.sin(a) * (POOL_RADIUS + 0.62);
      const post = new THREE.CylinderGeometry(0.15, 0.18, 1.28, 8);
      post.translate(px, 0.82, pz);
      poolCurbParts.push(post.toNonIndexed());

      const postCap = new THREE.SphereGeometry(0.145, 10, 8);
      postCap.scale(1.0, 1.25, 1.0);
      postCap.translate(px, 1.54, pz);
      poolCurbParts.push(postCap.toNonIndexed());

      // 望柱伸出朱檀挑灯曲臂
      const arm = new THREE.CylinderGeometry(0.036, 0.046, 0.62, 6);
      arm.rotateZ(Math.PI * 0.42);
      arm.rotateY(-a);
      arm.translate(Math.cos(a) * (POOL_RADIUS + 0.35), 1.42, PAVILION_Z + Math.sin(a) * (POOL_RADIUS + 0.35));
      poolWoodParts.push(arm.toNonIndexed());
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(poolCurbParts, false), jadeMat));
    this.scene.add(new THREE.Mesh(mergeGeometries(poolWoodParts, false), lacquerMat));

    // 2) 水榭五层古典青石须弥座地基 + 亭心御窑墨玉金砖铺地 + 阶梯云托底座
    const pavJadeParts: THREE.BufferGeometry[] = [];
    const woodParts: THREE.BufferGeometry[] = [];
    const goldParts: THREE.BufferGeometry[] = [];

    // 亭心御窑金砖方格地面（深沉温润，避免近景地板泛白）
    const innerFloor = new THREE.CylinderGeometry(4.56, 4.56, 0.06, 8);
    innerFloor.translate(0, -1.70, 0);
    this.pavilionGroup.add(new THREE.Mesh(innerFloor.toNonIndexed(), floorBrickMat));

    // 须弥座五层石雕线脚：上枋挑檐 -> 上枭仰莲 -> 深凹束腰 -> 下枭覆莲 -> 下枋圭角
    const topFang = new THREE.CylinderGeometry(4.78, 4.68, 0.13, 8);
    topFang.translate(0, -1.77, 0);
    pavJadeParts.push(topFang.toNonIndexed());

    const upperLotus = new THREE.CylinderGeometry(4.62, 4.34, 0.10, 8);
    upperLotus.translate(0, -1.88, 0);
    pavJadeParts.push(upperLotus.toNonIndexed());

    const waistCore = new THREE.CylinderGeometry(4.26, 4.26, 0.24, 8);
    waistCore.translate(0, -2.04, 0);
    pavJadeParts.push(waistCore.toNonIndexed());

    const lowerLotus = new THREE.CylinderGeometry(4.34, 4.66, 0.11, 8);
    lowerLotus.translate(0, -2.21, 0);
    pavJadeParts.push(lowerLotus.toNonIndexed());

    const bottomFang = new THREE.CylinderGeometry(4.70, 4.56, 0.13, 8);
    bottomFang.translate(0, -2.32, 0);
    pavJadeParts.push(bottomFang.toNonIndexed());

    // 底部多级内收玄石叠涩底座 + 朱檀云托与鎏金悬莲垂珠（仰视与平视皆具深邃层次）
    const stepTier1 = new THREE.CylinderGeometry(4.12, 3.18, 0.18, 8);
    stepTier1.translate(0, -2.47, 0);
    pavJadeParts.push(stepTier1.toNonIndexed());

    const stepTier2 = new THREE.CylinderGeometry(2.96, 1.88, 0.18, 8);
    stepTier2.translate(0, -2.64, 0);
    pavJadeParts.push(stepTier2.toNonIndexed());

    const bottomWoodHub = new THREE.CylinderGeometry(1.68, 0.52, 0.18, 8);
    bottomWoodHub.translate(0, -2.78, 0);
    woodParts.push(bottomWoodHub.toNonIndexed());

    const pendantOrb = new THREE.SphereGeometry(0.15, 10, 8);
    pendantOrb.translate(0, -2.92, 0);
    goldParts.push(pendantOrb.toNonIndexed());

    // 3) 水榭古典雕花勾栏（青石地栿与莲瓣望柱 + 深朱檀木寻杖、横桪与镂空直棂格栅）
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2;
      const a1 = ((i + 1) / 8) * Math.PI * 2;
      const rRail = 4.56;
      const x0 = Math.cos(a0) * rRail;
      const z0 = Math.sin(a0) * rRail;
      const x1 = Math.cos(a1) * rRail;
      const z1 = Math.sin(a1) * rRail;
      const midX = (x0 + x1) * 0.5;
      const midZ = (z0 + z1) * 0.5;
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      const segYaw = -Math.atan2(z1 - z0, x1 - x0);

      // 须弥座八面深凹束腰镶嵌朱檀格眼雕花框与转角短柱
      const wFactor = 4.30 / rRail;
      const waistFrame = new THREE.BoxGeometry(segLen * wFactor * 0.78, 0.15, 0.06);
      waistFrame.rotateY(segYaw);
      waistFrame.translate(midX * wFactor, -2.04, midZ * wFactor);
      woodParts.push(waistFrame.toNonIndexed());

      const waistPost = new THREE.CylinderGeometry(0.06, 0.06, 0.24, 6);
      waistPost.translate(Math.cos(a0) * 4.32, -2.04, Math.sin(a0) * 4.32);
      woodParts.push(waistPost.toNonIndexed());

      // 转角青石望柱 + 颈环与莲瓣云罐柱头
      const baluster = new THREE.CylinderGeometry(0.095, 0.11, 0.86, 8);
      baluster.translate(x0, -1.27, z0);
      pavJadeParts.push(baluster.toNonIndexed());

      const neckRing = new THREE.CylinderGeometry(0.125, 0.095, 0.05, 8);
      neckRing.translate(x0, -0.82, z0);
      pavJadeParts.push(neckRing.toNonIndexed());

      const lotusCap = new THREE.SphereGeometry(0.095, 10, 8);
      lotusCap.scale(1.0, 1.28, 1.0);
      lotusCap.translate(x0, -0.73, z0);
      pavJadeParts.push(lotusCap.toNonIndexed());

      // 底层青石压栏地栿石
      const groundSill = new THREE.BoxGeometry(segLen * 0.94, 0.09, 0.13);
      groundSill.rotateY(segYaw);
      groundSill.translate(midX, -1.66, midZ);
      pavJadeParts.push(groundSill.toNonIndexed());

      // 深朱檀木寻杖扶手、束绦中桪与下桪（石木相间，通透雅致）
      const topHandrail = new THREE.BoxGeometry(segLen * 0.96, 0.085, 0.105);
      topHandrail.rotateY(segYaw);
      topHandrail.translate(midX, -0.95, midZ);
      woodParts.push(topHandrail.toNonIndexed());

      const midRail = new THREE.BoxGeometry(segLen * 0.94, 0.052, 0.072);
      midRail.rotateY(segYaw);
      midRail.translate(midX, -1.11, midZ);
      woodParts.push(midRail.toNonIndexed());

      const botRail = new THREE.BoxGeometry(segLen * 0.94, 0.058, 0.078);
      botRail.rotateY(segYaw);
      botRail.translate(midX, -1.53, midZ);
      woodParts.push(botRail.toNonIndexed());

      // 寻杖与中桪之间的三根净瓶荷叶短蜀柱
      for (let s = 1; s <= 3; s++) {
        const f = s / 4;
        const sx = lerp(x0, x1, f);
        const sz = lerp(z0, z1, f);
        const shortPost = new THREE.CylinderGeometry(0.032, 0.042, 0.14, 6);
        shortPost.translate(sx, -1.03, sz);
        woodParts.push(shortPost.toNonIndexed());
      }

      // 中桪与下桪之间的等距镂空竖向直棂条（彻底取代原先刺眼的实心大白板）
      const numSpindles = 9;
      for (let k = 1; k <= numSpindles; k++) {
        const f = k / (numSpindles + 1);
        const kx = lerp(x0, x1, f);
        const kz = lerp(z0, z1, f);
        const spindle = new THREE.BoxGeometry(0.036, 0.40, 0.044);
        spindle.rotateY(segYaw);
        spindle.translate(kx, -1.32, kz);
        woodParts.push(spindle.toNonIndexed());
      }
    }

    // 4) 朱漆八根外檐金柱、青石鼓镜柱础、内圈擎檐柱、阑额普拍枋与斗拱层
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const aNext = ((i + 1) / 8) * Math.PI * 2;
      const rCol = 4.18;
      const cx = Math.cos(a) * rCol;
      const cz = Math.sin(a) * rCol;
      const nx = Math.cos(aNext) * rCol;
      const nz = Math.sin(aNext) * rCol;

      // 青石鼓镜柱础
      const plinth = new THREE.CylinderGeometry(0.25, 0.29, 0.14, 12);
      plinth.translate(cx, -1.63, cz);
      pavJadeParts.push(plinth.toNonIndexed());

      // 下檐主柱
      const col = new THREE.CylinderGeometry(0.20, 0.24, 3.22, 12);
      col.translate(cx, 0.02, cz);
      woodParts.push(col.toNonIndexed());

      // 上檐擎檐柱
      const upCol = new THREE.CylinderGeometry(0.15, 0.18, 1.85, 10);
      upCol.translate(Math.cos(a) * 2.95, 2.55, Math.sin(a) * 2.95);
      woodParts.push(upCol.toNonIndexed());

      // 阑额横梁与花芽雀替
      const beamLen = Math.hypot(nx - cx, nz - cz);
      const beam = new THREE.BoxGeometry(beamLen, 0.28, 0.24);
      beam.rotateY(-Math.atan2(nz - cz, nx - cx));
      beam.translate((cx + nx) * 0.5, 1.38, (cz + nz) * 0.5);
      woodParts.push(beam.toNonIndexed());

      // 斗拱挑檐垫层
      const dougong = new THREE.BoxGeometry(0.62, 0.32, 0.72);
      dougong.rotateY(-a + Math.PI * 0.5);
      dougong.translate(Math.cos(a) * 4.35, 1.62, Math.sin(a) * 4.35);
      woodParts.push(dougong.toNonIndexed());
    }

    // 下层重檐内口八角平座暗层围墙与围脊压边（彻底封堵下檐顶口镂空，令俯视严丝合缝）
    const mezzanineWall = new THREE.CylinderGeometry(2.92, 2.98, 0.55, 8);
    mezzanineWall.translate(0, 3.16, 0);
    woodParts.push(mezzanineWall.toNonIndexed());
    const mezzanineCollar = new THREE.CylinderGeometry(3.08, 2.96, 0.14, 8);
    mezzanineCollar.translate(0, 3.04, 0);
    pavJadeParts.push(mezzanineCollar.toNonIndexed());

    this.pavilionGroup.add(new THREE.Mesh(mergeGeometries(pavJadeParts, false), jadeMat));
    this.pavilionGroup.add(new THREE.Mesh(mergeGeometries(woodParts, false), lacquerMat));

    // 5) 双层八角凹曲反宇飞檐琉璃瓦顶 + 16 道立体攒尖垂脊走兽 + 6 层精雕鎏金覆钵仰覆莲相轮宝顶
    const lowerRoofGeo = createChineseOctagonalRoofGeometry(2.85, 6.75, 1.55, 0.62);
    lowerRoofGeo.translate(0, 1.52, 0);
    const upperRoofGeo = createChineseOctagonalRoofGeometry(0.36, 5.05, 2.15, 0.56);
    upperRoofGeo.translate(0, 3.32, 0);
    this.pavilionGroup.add(new THREE.Mesh(mergeGeometries([lowerRoofGeo.toNonIndexed(), upperRoofGeo.toNonIndexed()], false), roofTileMat));

    const ridgeMat = makeArchMat(this.colorRoofTile, 5);
    const lowerRidges = createOctagonalRoofRidgesGeometry(2.85, 6.75, 1.55, 0.62, 1.52);
    const upperRidges = createOctagonalRoofRidgesGeometry(0.36, 5.05, 2.15, 0.56, 3.32);
    this.pavilionGroup.add(new THREE.Mesh(mergeGeometries([lowerRidges, upperRidges], false), ridgeMat));

    // 六层精雕皇家鎏金覆钵仰覆莲相轮宝顶（双层厚实压脊莲座完全包覆脊顶消除穿模 -> 束腰仰莲 -> 饱满覆钵 -> 三重相轮 -> 摩尼宝珠 -> 火焰刹针）
    const finialSkirt = new THREE.CylinderGeometry(0.62, 0.84, 0.30, 8);
    finialSkirt.translate(0, 5.46, 0);
    goldParts.push(finialSkirt.toNonIndexed());

    const finialLotusPad = new THREE.CylinderGeometry(0.50, 0.64, 0.16, 16);
    finialLotusPad.translate(0, 5.66, 0);
    goldParts.push(finialLotusPad.toNonIndexed());

    const finialWaist = new THREE.CylinderGeometry(0.44, 0.35, 0.16, 16);
    finialWaist.translate(0, 5.80, 0);
    goldParts.push(finialWaist.toNonIndexed());

    const finialBowl = new THREE.SphereGeometry(0.38, 16, 12);
    finialBowl.scale(1.0, 0.74, 1.0);
    finialBowl.translate(0, 6.02, 0);
    goldParts.push(finialBowl.toNonIndexed());

    for (let ri = 0; ri < 3; ri++) {
      const rRing = 0.29 - ri * 0.04;
      const ring = new THREE.CylinderGeometry(rRing, rRing * 1.08, 0.055, 16);
      ring.translate(0, 6.30 + ri * 0.115, 0);
      goldParts.push(ring.toNonIndexed());
    }

    const finialOrb1 = new THREE.SphereGeometry(0.21, 16, 12);
    finialOrb1.translate(0, 6.72, 0);
    goldParts.push(finialOrb1.toNonIndexed());

    const finialSpire = new THREE.ConeGeometry(0.085, 0.68, 12);
    finialSpire.translate(0, 7.14, 0);
    goldParts.push(finialSpire.toNonIndexed());

    this.pavilionGroup.add(new THREE.Mesh(mergeGeometries(goldParts, false), goldMat));

    // 5) 24 盏精雕古典六角鎏金宫灯实例（水榭上下两层飞檐共 16 盏 + 汉白玉池栏 8 盏）
    const palaceBaseGeo = createPalaceLanternGeometry();
    const palaceMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCamPos: this.uniforms.uCamPos,
        uFlameCore: this.uniforms.uFlameCore,
        uGoldColor: this.uniforms.uGoldColor,
        uMainColor: this.uniforms.uMainColor,
        uLacquerColor: { value: this.colorLacquer },
        uMelodyGlow: this.uniforms.uMelodyGlow,
        uDropIgnite: this.uniforms.uDropIgnite,
      },
      vertexShader: PALACE_LANTERN_VERT,
      fragmentShader: PALACE_LANTERN_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const buildPalaceInstanced = (anchors: PalaceLanternAnchor[]) => {
      const g = new THREE.InstancedBufferGeometry();
      g.attributes.position = palaceBaseGeo.attributes.position;
      g.attributes.normal = palaceBaseGeo.attributes.normal;
      g.attributes.uv = palaceBaseGeo.attributes.uv;
      const n = anchors.length;
      const anchorArr = new Float32Array(n * 4);
      const swingArr = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const a = anchors[i];
        anchorArr[i * 4] = a.gx;
        anchorArr[i * 4 + 1] = a.gy;
        anchorArr[i * 4 + 2] = a.gz;
        anchorArr[i * 4 + 3] = a.scale;
        swingArr[i * 2] = a.phase;
        swingArr[i * 2 + 1] = a.chainLen;
      }
      g.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(anchorArr, 4));
      g.setAttribute('aSwing', new THREE.InstancedBufferAttribute(swingArr, 2));
      g.instanceCount = n;
      const mesh = new THREE.Mesh(g, palaceMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      return mesh;
    };

    const pavAnchors: PalaceLanternAnchor[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      // 下层八角飞檐翘角（翘角外扩 1.11 倍 r=7.49，宫灯垂挂于翘角尖端下方 r=6.85, y=1.18）
      pavAnchors.push({
        gx: Math.cos(a) * 6.85,
        gy: 1.15,
        gz: Math.sin(a) * 6.85,
        scale: 0.92,
        chainLen: 1.0,
        phase: i / 8,
        inPavilionGroup: true,
      });
      // 上层八角飞檐翘角（宫灯垂挂于 r=5.12, y=3.02）
      pavAnchors.push({
        gx: Math.cos(a) * 5.12,
        gy: 3.02,
        gz: Math.sin(a) * 5.12,
        scale: 0.72,
        chainLen: 0.85,
        phase: (i / 8 + 0.37) % 1.0,
        inPavilionGroup: true,
      });
    }
    const pavLanternMesh = buildPalaceInstanced(pavAnchors);
    (this as { palaceLanternsPavilionMesh: typeof pavLanternMesh }).palaceLanternsPavilionMesh = pavLanternMesh;
    this.pavilionGroup.add(pavLanternMesh);

    // 为水榭 16 盏飞檐宫灯配备温润柔光晕（随 pavilionGroup 同步起伏）
    const pavGlowGeo = new THREE.InstancedBufferGeometry();
    pavGlowGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    pavGlowGeo.setIndex([0, 1, 2, 2, 1, 3]);
    const glowPosArr = new Float32Array(pavAnchors.length * 4);
    const glowStateArr = new Float32Array(pavAnchors.length * 4);
    for (let i = 0; i < pavAnchors.length; i++) {
      const a = pavAnchors[i];
      glowPosArr[i * 4] = a.gx;
      glowPosArr[i * 4 + 1] = a.gy;
      glowPosArr[i * 4 + 2] = a.gz;
      glowPosArr[i * 4 + 3] = a.scale * 0.95;
      glowStateArr[i * 4] = 1.05;
      glowStateArr[i * 4 + 3] = a.phase;
    }
    pavGlowGeo.setAttribute('aLanternPos', new THREE.InstancedBufferAttribute(glowPosArr, 4));
    pavGlowGeo.setAttribute('aLanternState', new THREE.InstancedBufferAttribute(glowStateArr, 4));
    pavGlowGeo.instanceCount = pavAnchors.length;
    const pavGlowMesh = new THREE.Mesh(
      pavGlowGeo,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.uniforms.uTime,
          uFlameCore: this.uniforms.uFlameCore,
          uGoldColor: this.uniforms.uGoldColor,
          uMainColor: this.uniforms.uMainColor,
        },
        vertexShader: /* glsl */ `
          attribute vec4 aLanternPos;
          attribute vec4 aLanternState;
          varying vec2 vQuad;
          varying float vBright;
          varying float vSeed;
          varying float vDist;
          void main() {
            vQuad = position.xy;
            vBright = aLanternState.x;
            vSeed = aLanternState.w;
            vec4 worldCenter = modelMatrix * vec4(aLanternPos.xyz, 1.0);
            vec4 mv = viewMatrix * worldCenter;
            vDist = -mv.z;
            vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            float r = aLanternPos.w * 2.1;
            vec3 wp = worldCenter.xyz + camRight * (position.x * r) + camUp * (position.y * r);
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }
        `,
        fragmentShader: LANTERN_HALO_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    pavGlowMesh.frustumCulled = false;
    pavGlowMesh.renderOrder = 3;
    this.pavilionGroup.add(pavGlowMesh);

    // 天池汉白玉望柱挑臂悬挂 8 盏引路宫灯
    const poolAnchors: PalaceLanternAnchor[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      poolAnchors.push({
        gx: Math.cos(a) * (POOL_RADIUS + 0.15),
        gy: 1.05,
        gz: PAVILION_Z + Math.sin(a) * (POOL_RADIUS + 0.15),
        scale: 0.56,
        chainLen: 0.65,
        phase: (i / 8 + 0.19) % 1.0,
        inPavilionGroup: false,
      });
    }
    const poolLanternMesh = buildPalaceInstanced(poolAnchors);
    (this as { palaceLanternsPoolMesh: typeof poolLanternMesh }).palaceLanternsPoolMesh = poolLanternMesh;
    this.scene.add(poolLanternMesh);
  }

  /** 四组电影级运镜机位（pavilion / water / eaves / zenith）纯函数姿态求值 */
  private evalCameraPose(t: number, s: Shot, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const start = s.run?.start ?? s.start;
    const end = s.run?.end ?? s.end;
    const span = Math.max(0.8, end - start);
    const k = clamp01((t - start) / span);
    const e = inOutCubic(k);
    const dir = (stableShotSeed(s) & 1) === 0 ? 1 : -1;
    const variant = s.variant || 'pavilion';

    if (variant === 'water') {
      // 沿瑶池清波与盛开莲花河灯带弧线滑翔：尽览丝绸封面画卷、纤巧游弋金鲤、飞檐宫灯与远景千灯
      const x = lerp(6.8 * dir, -5.2 * dir, e);
      const y = 1.52 + 0.05 * Math.sin(t * 0.5);
      const z = lerp(-17.6, -21.2, e);
      poseLookAt(pos, quat, x, y, z, 0, 1.45, PAVILION_Z);
      return CAM_FOV - 1.0;
    } else if (variant === 'eaves') {
      // 近景仰拍雕梁起翘飞檐、六角鎏金宫灯丝穗与漫天升腾的宣纸孔明灯海
      const x = lerp(-8.2 * dir, -6.2 * dir, e);
      const y = lerp(5.8, 6.9, e);
      const z = lerp(-21.2, -24.0, e);
      poseLookAt(pos, quat, x, y, z, -1.0 * dir, 7.0, PAVILION_Z - 2.0);
      return CAM_FOV + 1.0;
    } else if (variant === 'zenith') {
      // 凌霄环绕俯瞰视点：尽览重檐八角放射琉璃筒瓦、16 道描金垂脊走兽、鎏金相轮宝顶与环池游鲤莲灯
      const ang = lerp(-0.34 * dir, 0.34 * dir, e);
      const rad = lerp(9.6, 7.2, e);
      const x = Math.sin(ang) * rad;
      const y = lerp(23.2, 19.6, e);
      const z = PAVILION_Z + Math.cos(ang) * rad;
      poseLookAt(pos, quat, x, y, z, 0, 3.1, PAVILION_Z);
      return CAM_FOV + 2.0;
    } else {
      // pavilion: 正面全景黄金构图（默认）
      const theta = lerp(-0.20 * dir, 0.20 * dir, e);
      const rad = lerp(18.8, 15.6, e);
      const x = Math.sin(theta) * rad;
      const y = 3.75 + 0.10 * Math.sin(t * 0.4);
      const z = PAVILION_Z + Math.cos(theta) * rad;
      poseLookAt(pos, quat, x, y, z, 0, 4.85, PAVILION_Z);
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

  /** 纯函数计算当前时刻所有常驻与新放飞的三维宣纸孔明灯实例姿态及亮度 */
  private updateSkyAndLotusLanterns(t: number, melodyGlow: number, dropIgnite: number, isBreak: boolean): number {
    const posArr = this.skyLanternPosAttr.array as Float32Array;
    const stateArr = this.skyLanternStateAttr.array as Float32Array;
    const energyGain = 0.92 + 0.24 * melodyGlow + 0.30 * dropIgnite;
    const ascentBoost = isBreak ? 1.25 : 1.0;

    let count = 0;

    // 1) 更新 260 盏常驻云海环绕孔明灯（纯函数周期相位，顶底平滑淡入淡出绝不跳变）
    for (let i = 0; i < this.ambientSkyLanterns.length && count < MAX_SKY_LANTERNS; i++) {
      const sp = this.ambientSkyLanterns[i];
      const rawPhase = ((t * sp.speed * ascentBoost + sp.phaseOffset) / sp.ySpan) % 1.0;
      const phase = rawPhase < 0 ? rawPhase + 1.0 : rawPhase;
      const y = sp.yMin + phase * sp.ySpan;

      const fade = smooth(phase / 0.12) * (1.0 - smooth((phase - 0.84) / 0.16));
      if (fade <= 0.005) continue;

      const swayArg = t * sp.swayFreq + sp.seed * 31.4159;
      const dx = Math.sin(swayArg) * sp.swayAmp;
      const dz = Math.cos(swayArg * 0.83 + 1.1) * sp.swayAmp * 0.78;
      // 水平速度导数驱动灯笼随风自然轻倾
      const vx = Math.cos(swayArg) * sp.swayAmp * sp.swayFreq;
      const vz = -Math.sin(swayArg * 0.83 + 1.1) * sp.swayAmp * 0.78 * sp.swayFreq * 0.83;

      const o4 = count * 4;
      posArr[o4] = sp.baseX + dx;
      posArr[o4 + 1] = y;
      posArr[o4 + 2] = sp.baseZ + dz;
      posArr[o4 + 3] = sp.size;

      stateArr[o4] = fade * energyGain;
      stateArr[o4 + 1] = Math.max(-0.14, Math.min(0.14, vz * 0.13));
      stateArr[o4 + 2] = Math.max(-0.14, Math.min(0.14, -vx * 0.13));
      stateArr[o4 + 3] = sp.seed;
      count++;
    }

    // 2) 二分检索 [t - SKY_LANTERN_LIFE, t] 窗口内由歌词字词/旋律音符实时放飞的孔明灯
    if (this.releasedLanternTimes.length > 0) {
      let idx = lastIndex(this.releasedLanternTimes, t);
      let relAdded = 0;
      while (idx >= 0 && relAdded < MAX_RELEASED_SKY_LANTERNS && count < MAX_SKY_LANTERNS) {
        const ev = this.releasedSkyLanterns[idx];
        const age = t - ev.t0;
        if (age > SKY_LANTERN_LIFE) break;
        if (age >= 0) {
          // 热空气加热初段柔和起步，随后稳步加速腾空
          const climb = ev.riseSpeed * (age - 1.6 * (1.0 - Math.exp(-age / 1.6)));
          const y = ev.y0 + climb;
          const fade = smooth(age / 0.85) * (1.0 - smooth((age - (SKY_LANTERN_LIFE - 5.0)) / 5.0)) * (1.0 - smooth((y - 52.0) / 10.0));
          if (fade > 0.005) {
            const wArg = age * 0.72 + ev.seed * 25.13;
            const swayFactor = smooth(age / 3.0) * (0.45 + 0.45 * melodyGlow);
            const x = ev.x0 + ev.windX * age + Math.sin(wArg) * swayFactor;
            const z = ev.z0 + ev.windZ * age + Math.cos(wArg * 0.85) * swayFactor * 0.8;
            const vx = ev.windX + Math.cos(wArg) * 0.72 * swayFactor;
            const vz = ev.windZ - Math.sin(wArg * 0.85) * 0.61 * swayFactor;

            const o4 = count * 4;
            posArr[o4] = x;
            posArr[o4 + 1] = y;
            posArr[o4 + 2] = z;
            posArr[o4 + 3] = ev.size * (0.94 + 0.08 * melodyGlow);

            stateArr[o4] = fade * (energyGain + 0.18 * Math.exp(-age / 2.2));
            stateArr[o4 + 1] = Math.max(-0.15, Math.min(0.15, vz * 0.14));
            stateArr[o4 + 2] = Math.max(-0.15, Math.min(0.15, -vx * 0.14));
            stateArr[o4 + 3] = ev.seed;
            count++;
            relAdded++;
          }
        }
        idx--;
      }
    }

    if (count > 0) {
      for (const attr of [this.skyLanternPosAttr, this.skyLanternStateAttr]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, count * 4);
        attr.needsUpdate = true;
      }
    }
    this.skyLanternsMesh.geometry.instanceCount = count;
    this.skyLanternHalosMesh.geometry.instanceCount = count;

    // 3) 更新天池 32 盏莲花河灯随波轻漾与环池缓漂位置
    const lotusArr = this.lotusPosAttr.array as Float32Array;
    for (let i = 0; i < NUM_LOTUS_LANTERNS; i++) {
      const ls = this.lotusSpecs[i];
      const ang = ls.angle0 + t * ls.omega;
      const rBob = ls.radius + 0.18 * Math.sin(t * 0.65 + ls.seed * 18.0);
      const lx = Math.cos(ang) * rBob;
      const lz = PAVILION_Z + Math.sin(ang) * rBob;
      const ly = (ls.radius < POOL_RADIUS ? 0.075 : -0.15) + 0.032 * Math.sin(t * 2.1 + ls.seed * 31.4);
      const o4 = i * 4;
      lotusArr[o4] = lx;
      lotusArr[o4 + 1] = ly;
      lotusArr[o4 + 2] = lz;
      lotusArr[o4 + 3] = 1.0;
    }
    this.lotusPosAttr.needsUpdate = true;

    return count;
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, fx } = ctx;
    const curSec = music.section(t);
    const label = curSec?.label ?? shot.section.label;
    const isDrop = label === 'drop';
    const isChorus = label === 'chorus';
    const isBreak = label === 'break' || label === 'bridge';

    // 1. 相机纯函数更新与世界坐标同步
    this.updateCamera(t, shot);
    this.uniforms.uCamPos.value.copy(this.camera.position);

    // 2. 音频包络与能量
    const kickPulse = this.evalPulse(this.kickTimes, this.kickAmps, t, 0.25);
    const melodyGlow = music.foregroundAt(t).level;
    const dropIgnite = isDrop ? 1.0 : isChorus ? 0.45 : 0.0;
    const pillarIgnite = isDrop ? 1.0 : 0.0;
    const fireflyAscent = isBreak ? 1.0 : 0.0;

    // 3. 水榭与飞檐宫灯仙气微浮
    this.pavilionGroup.position.y = 5.35 + Math.sin(t * 0.65) * 0.16 + kickPulse * 0.10;

    // 4. 更新三维孔明灯海与莲花河灯
    const activeLanterns = this.updateSkyAndLotusLanterns(t, melodyGlow, dropIgnite, isBreak);
    this.skyDomeUniforms.uLanternWarmth.value = clamp01(activeLanterns / 240) * (0.75 + 0.45 * melodyGlow);

    // 5. 更新贴水游弋真锦鲤与伴游水纹涟漪（自然游鱼蜿蜒巡游轨迹，紧贴瑶池清波）
    const dummy = this.reusableDummy;
    const evalKoiPos = (ks: KoiState, tau: number, idx: number, out: THREE.Vector3) => {
      const th = tau * ks.speed + ks.phase;
      const wanderR = 1.0 + 0.14 * Math.sin(tau * 0.37 + ks.seed * 19.0);
      const x = Math.cos(th) * ks.radiusX * wanderR;
      const z = PAVILION_Z + Math.sin(th) * ks.radiusZ * wanderR;
      const y = ks.yBase + Math.sin(tau * 1.35 + idx * 1.7) * 0.012 + (isDrop ? 0.022 : 0.0);
      out.set(x, y, z);
    };
    const curKoiPos = new THREE.Vector3();
    const nxtKoiPos = new THREE.Vector3();
    for (let i = 0; i < NUM_KOI; i++) {
      const ks = this.koiStates[i];
      evalKoiPos(ks, t, i, curKoiPos);
      evalKoiPos(ks, t + 0.05, i, nxtKoiPos);

      dummy.position.copy(curKoiPos);
      dummy.lookAt(nxtKoiPos);
      const s = ks.scale;
      dummy.scale.set(s, s, s * (1.0 + kickPulse * 0.08));
      dummy.updateMatrix();
      this.koiInstanced.setMatrixAt(i, dummy.matrix);

      // 伴游水波纹紧贴水面 y = 0.054 跟随鱼身水平朝向
      dummy.position.set(curKoiPos.x, 0.054, curKoiPos.z);
      dummy.lookAt(nxtKoiPos.x, 0.054, nxtKoiPos.z);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this.koiRipplesInstanced.setMatrixAt(i, dummy.matrix);
    }
    this.koiInstanced.instanceMatrix.needsUpdate = true;
    this.koiRipplesInstanced.instanceMatrix.needsUpdate = true;

    // 6. 更新圆润高斯流萤金尘纯函数飘升轨迹
    const posAttr = this.firefliesPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;
    for (let i = 0; i < NUM_FIREFLIES; i++) {
      const bx = this.fireflyBasePos[i * 3];
      const by = this.fireflyBasePos[i * 3 + 1];
      const bz = this.fireflyBasePos[i * 3 + 2];

      const driftY = ((t * 0.75 + i * 0.37) % 16.0 + 16.0) % 16.0;
      posArray[i * 3] = bx + Math.sin(t * 0.72 + i * 1.7) * 0.48;
      posArray[i * 3 + 1] = by + (isBreak ? driftY * 1.45 : Math.sin(t * 1.15 + i * 0.6) * 0.55);
      posArray[i * 3 + 2] = bz + Math.cos(t * 0.72 + i * 1.7) * 0.48;
    }
    posAttr.needsUpdate = true;

    // 7. 着色器 Uniforms 同步
    this.uniforms.uTime.value = t;
    this.uniforms.uMelodyGlow.value = melodyGlow;
    this.uniforms.uDropIgnite.value = dropIgnite;
    this.uniforms.uPillarIgnite.value = pillarIgnite;
    this.uniforms.uFireflyAscent.value = fireflyAscent;
    this.uniforms.uKickPulse.value = kickPulse;

    // 8. 后期调优（温润克制的东方灯火泛光，保留绢纱与竹骨清晰层次）
    fx.bloom = 0.28 + 0.12 * dropIgnite + 0.08 * melodyGlow;
    fx.vignette = 0.40;
    fx.letterbox = 0;

    // 9. 歌词
    const energy = isDrop ? 1.0 : isChorus ? 0.82 : 0.45;
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
