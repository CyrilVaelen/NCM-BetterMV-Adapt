// 午夜高架 (Highway): 第一人称极速跨海大桥与复古未来流光。
// 适配曲风：Synthwave, House, City Pop, Phonk, Drum & Bass (DnB)。
// 100% 确定性纯时间函数 f(t) 驱动，零累积状态，支持任意 seek 与离线 MP4 导出。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex } from '../director/music.ts';
import { colorFromHsl, extractCoverTone, tuneCoverStop } from './coverTone.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';

const STREETLIGHT_SPACING = 18.0;
const NUM_STREETLIGHTS = 20;
const GUARD_POST_SPACING = 6.0;
const NUM_GUARD_POSTS = 54;
const TOWER_SPAN = 112.0;
const NUM_TOWER_SPANS = 3;
const NUM_WARP_STREAKS = 56;
const NUM_TRAFFIC_CARS = 6;
const BASE_FOV = 56;
// 天穹封面明月锚定参数：置于 315m 高空天球，屏幕水平居中 (ndcX = 0)、夜空偏上黄金位 (ndcY = 0.46)、恒定视觉半径 (0.28)
const MOON_DISTANCE = 315.0;
const MOON_NDC_Y = 0.46;
const MOON_SCREEN_RADIUS = 0.28;

// 路灯与护栏横断面精确工程基准参数（左右对称）
const POLE_BASE_X = 10.18;     // 灯杆中心距道路中线横向坐标 (m)，立于混凝土防撞墙顶面平台
const LAMP_LOCAL_X = -2.56;    // 灯具光学中心相对灯杆根部的内悬挑偏移 -> 世界坐标 |x| = 7.62m
const LAMP_HEIGHT_Y = 7.68;    // 灯具光学出光面离桥面高度 (m)
const CONE_GROUND_LOCAL_X = -4.18; // 光锥轴线落地中心相对灯杆偏移 -> 世界坐标 |x| = 6.00m

interface StreakSeed {
  x: number;
  y: number;
  zPhase: number;
  lenScale: number;
}

interface TrafficSeed {
  laneX: number;
  zPhase: number;
  relSpeed: number;
  width: number;
}

interface PartSpec {
  geo: THREE.BufferGeometry;
  partId?: number;
}

/** 合并多个子几何体为单一非索引 BufferGeometry（支持写入 aPart 部件材质标记，保持 1 次 DrawCall） */
function mergePartGeometries(specs: PartSpec[]): THREE.BufferGeometry {
  const nonIndexed: { pos: THREE.BufferAttribute; norm: THREE.BufferAttribute; uv: THREE.BufferAttribute | null; partId: number; count: number }[] = [];
  let totalVerts = 0;

  for (const spec of specs) {
    const g = spec.geo.index ? spec.geo.toNonIndexed() : spec.geo.clone();
    if (!g.getAttribute('normal')) {
      g.computeVertexNormals();
    }
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const norm = g.getAttribute('normal') as THREE.BufferAttribute;
    const uv = (g.getAttribute('uv') as THREE.BufferAttribute) ?? null;
    nonIndexed.push({ pos, norm, uv, partId: spec.partId ?? 0, count: pos.count });
    totalVerts += pos.count;
    spec.geo.dispose();
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const parts = new Float32Array(totalVerts);

  let offset = 0;
  for (const item of nonIndexed) {
    for (let i = 0; i < item.count; i++) {
      const v3 = (offset + i) * 3;
      const v2 = (offset + i) * 2;
      positions[v3] = item.pos.getX(i);
      positions[v3 + 1] = item.pos.getY(i);
      positions[v3 + 2] = item.pos.getZ(i);
      normals[v3] = item.norm.getX(i);
      normals[v3 + 1] = item.norm.getY(i);
      normals[v3 + 2] = item.norm.getZ(i);
      if (item.uv) {
        uvs[v2] = item.uv.getX(i);
        uvs[v2 + 1] = item.uv.getY(i);
      }
      parts[offset + i] = item.partId;
    }
    offset += item.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setAttribute('aPart', new THREE.BufferAttribute(parts, 1));
  return merged;
}

/** 构造两点之间的渐变圆管段 */
function createTaperedStrut(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  r0: number,
  r1: number,
  radialSegs = 10,
): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, radialSegs, 1, false);
  const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const mat = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(mat);
  return geo;
}

/**
 * 构建真实跨海大桥重工流线型路灯金属结构（局部原点在 (±POLE_BASE_X, 0, zPos)，挑臂朝向 -X 车道中心）：
 * - 八角重型锚固法兰底盘 + 十字三角加强筋护套
 * - 12边形高圆滑渐变锥形立杆 + 双道金属抱箍环
 * - 鹅颈大弧度渐变悬挑主臂 + 抗台风斜拉副撑杆
 * - 压铸铝流线眼镜蛇灯头背壳与散热顶脊（partId = 1）
 */
function buildRealisticStreetlightGeometry(): THREE.BufferGeometry {
  const specs: PartSpec[] = [];

  // 1. 八角法兰底盘与压紧螺母台（立在 y = 0.54m 混凝土防撞墙顶面）
  const basePlate = new THREE.CylinderGeometry(0.24, 0.26, 0.08, 8);
  basePlate.translate(0, 0.58, 0);
  specs.push({ geo: basePlate, partId: 0 });

  const collarRing = new THREE.CylinderGeometry(0.185, 0.22, 0.14, 10);
  collarRing.translate(0, 0.69, 0);
  specs.push({ geo: collarRing, partId: 0 });

  // 2. 十字放射加劲肋板 (Gusset Fins) + 收腰柱础套筒
  const finX = new THREE.BoxGeometry(0.38, 0.48, 0.026);
  finX.translate(0, 0.96, 0);
  specs.push({ geo: finX, partId: 0 });

  const finZ = new THREE.BoxGeometry(0.026, 0.48, 0.38);
  finZ.translate(0, 0.96, 0);
  specs.push({ geo: finZ, partId: 0 });

  const lowerSleeve = new THREE.CylinderGeometry(0.135, 0.178, 1.05, 12);
  lowerSleeve.translate(0, 1.24, 0);
  specs.push({ geo: lowerSleeve, partId: 0 });

  // 3. 高耸渐变锥形主灯杆 (y = 1.76 -> 6.48m) + 锥形封顶帽
  const mainShaft = new THREE.CylinderGeometry(0.086, 0.135, 4.74, 12);
  mainShaft.translate(0, 4.13, 0);
  specs.push({ geo: mainShaft, partId: 0 });

  const poleCap = new THREE.CylinderGeometry(0.024, 0.088, 0.20, 12);
  poleCap.translate(0, 6.60, 0);
  specs.push({ geo: poleCap, partId: 0 });

  // 两道机械抱箍卡环（副拉杆节点 & 主悬臂节点）
  for (const clampY of [5.22, 6.18]) {
    const clampGeo = new THREE.CylinderGeometry(0.118, 0.118, 0.12, 12);
    clampGeo.translate(0, clampY, 0);
    specs.push({ geo: clampGeo, partId: 1 });
  }

  // 4. 优雅鹅颈弧形悬挑主臂（9 段三次贝塞尔平滑渐变圆弧管）
  const armCurve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(-0.04, 6.18, 0),
    new THREE.Vector3(-0.36, 7.16, 0),
    new THREE.Vector3(-1.22, 7.64, 0),
    new THREE.Vector3(-2.12, 7.75, 0),
  );
  const armSegs = 9;
  for (let s = 0; s < armSegs; s++) {
    const t0 = s / armSegs;
    const t1 = (s + 1) / armSegs;
    const r0 = lerp(0.072, 0.045, t0);
    const r1 = lerp(0.072, 0.045, t1);
    specs.push({
      geo: createTaperedStrut(armCurve.getPoint(t0), armCurve.getPoint(t1), r0, r1, 10),
      partId: 0,
    });
  }

  // 5. 抗风三角斜撑副拉杆（连接主杆 y=5.22 与挑臂中段）+ 中段连接箍
  const tieTarget = armCurve.getPoint(0.56);
  specs.push({
    geo: createTaperedStrut(new THREE.Vector3(-0.06, 5.22, 0), tieTarget, 0.036, 0.030, 8),
    partId: 0,
  });
  const midJoint = new THREE.SphereGeometry(0.062, 8, 6);
  midJoint.translate(tieTarget.x, tieTarget.y, 0);
  specs.push({ geo: midJoint, partId: 1 });

  // 6. 流线型压铸铝眼镜蛇灯具背壳（微微上仰 9.5° 朝向车道中心，上部散热脊壳 + 下缘遮光罩框，不透光）
  const tilt = -0.165;
  const housingMat4 = new THREE.Matrix4()
    .makeTranslation(LAMP_LOCAL_X, LAMP_HEIGHT_Y + 0.09, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(tilt));

  // 主流线梯形铝壳顶盖
  const upperHood = new THREE.BoxGeometry(1.08, 0.085, 0.42);
  upperHood.applyMatrix4(housingMat4);
  specs.push({ geo: upperHood, partId: 1 });

  // 顶部流线散热凸脊
  const dorsalFin = new THREE.BoxGeometry(0.82, 0.055, 0.22);
  const finMat4 = housingMat4.clone().multiply(new THREE.Matrix4().makeTranslation(0.04, 0.062, 0));
  dorsalFin.applyMatrix4(finMat4);
  specs.push({ geo: dorsalFin, partId: 1 });

  // 套管尾座接头
  const neckCollar = new THREE.BoxGeometry(0.28, 0.11, 0.20);
  const neckMat4 = housingMat4.clone().multiply(new THREE.Matrix4().makeTranslation(0.52, -0.01, 0));
  neckCollar.applyMatrix4(neckMat4);
  specs.push({ geo: neckCollar, partId: 1 });

  // 前后两侧遮光边框裙翼（包住内部下嵌 LED 发光透镜模组，杜绝侧面生硬方块感）
  for (const zSide of [-0.195, 0.195]) {
    const skirt = new THREE.BoxGeometry(1.04, 0.065, 0.036);
    const sMat = housingMat4.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.052, zSide));
    skirt.applyMatrix4(sMat);
    specs.push({ geo: skirt, partId: 1 });
  }

  return mergePartGeometries(specs);
}

/** 构建嵌入压铸铝灯壳下凹槽内的光学透镜 LED 发光面板几何体 */
function buildLuminaireLensGeometry(): THREE.BufferGeometry {
  const tilt = -0.165;
  const lensGeo = new THREE.BoxGeometry(0.94, 0.042, 0.34, 4, 1, 2);
  const mat4 = new THREE.Matrix4()
    .makeTranslation(LAMP_LOCAL_X, LAMP_HEIGHT_Y + 0.02, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(tilt));
  lensGeo.applyMatrix4(mat4);
  return lensGeo;
}

/**
 * 构建双层同轴三维锥形丁达尔体积光束几何体（Open-ended Dual-Shell Volumetric Cone）：
 * - 顶口精确贴合灯具出光透镜 (LAMP_LOCAL_X, LAMP_HEIGHT_Y, 0)
 * - 底口斜向车道内侧投射至桥面 (CONE_GROUND_LOCAL_X, 0.02, 0)
 * - 外层广角柔雾光锥 (aPart = 0) + 内层高聚光核心束 (aPart = 1)，无封底硬盖，解析精确外法线
 */
function buildVolumetricLampConeGeometry(): THREE.BufferGeometry {
  const radialSegs = 32;
  const heightSegs = 10;
  const shells = [
    // 外层广角空气丁达尔散射光锥
    { topRx: 0.45, topRz: 0.18, botRx: 3.92, botRz: 3.45, shellId: 0.0 },
    // 内层高聚光中心灯芯光柱
    { topRx: 0.28, topRz: 0.11, botRx: 1.88, botRz: 1.65, shellId: 1.0 },
  ];

  const posArr: number[] = [];
  const normArr: number[] = [];
  const uvArr: number[] = [];
  const partArr: number[] = [];

  const samplePoint = (sh: typeof shells[0], u: number, v: number, target: THREE.Vector3) => {
    const theta = u * Math.PI * 2.0;
    // v = 1 在顶端灯头，v = 0 在桥面沥青
    const cx = lerp(CONE_GROUND_LOCAL_X, LAMP_LOCAL_X, v);
    const cy = lerp(0.02, LAMP_HEIGHT_Y, v);
    const spread = 1.0 - Math.pow(v, 0.96);
    const rx = lerp(sh.topRx, sh.botRx, spread);
    const rz = lerp(sh.topRz, sh.botRz, spread);
    target.set(cx + Math.cos(theta) * rx, cy, Math.sin(theta) * rz);
  };

  const p00 = new THREE.Vector3();
  const p10 = new THREE.Vector3();
  const p01 = new THREE.Vector3();
  const p11 = new THREE.Vector3();
  const duVec = new THREE.Vector3();
  const dvVec = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  const evalNormal = (sh: typeof shells[0], u: number, v: number, outN: THREE.Vector3) => {
    const epsU = 0.005;
    const epsV = 0.01;
    samplePoint(sh, u + epsU, v, tmpA);
    samplePoint(sh, u - epsU, v, tmpB);
    duVec.subVectors(tmpA, tmpB);

    const vHi = Math.min(1.0, v + epsV);
    const vLo = Math.max(0.0, v - epsV);
    samplePoint(sh, u, vHi, tmpA);
    samplePoint(sh, u, vLo, tmpB);
    dvVec.subVectors(tmpA, tmpB);

    // 外向侧面法线：随 theta 指向圆锥外侧
    outN.crossVectors(dvVec, duVec).normalize();
    // 校验径向朝外符号
    const cx = lerp(CONE_GROUND_LOCAL_X, LAMP_LOCAL_X, v);
    samplePoint(sh, u, v, tmpA);
    if (outN.x * (tmpA.x - cx) + outN.z * tmpA.z < 0) {
      outN.negate();
    }
  };

  const n00 = new THREE.Vector3();
  const n10 = new THREE.Vector3();
  const n01 = new THREE.Vector3();
  const n11 = new THREE.Vector3();

  const pushVert = (p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, sid: number) => {
    posArr.push(p.x, p.y, p.z);
    normArr.push(n.x, n.y, n.z);
    uvArr.push(u, v);
    partArr.push(sid);
  };

  for (const sh of shells) {
    for (let iv = 0; iv < heightSegs; iv++) {
      const v0 = iv / heightSegs;
      const v1 = (iv + 1) / heightSegs;
      for (let iu = 0; iu < radialSegs; iu++) {
        const u0 = iu / radialSegs;
        const u1 = (iu + 1) / radialSegs;

        samplePoint(sh, u0, v0, p00);
        samplePoint(sh, u1, v0, p10);
        samplePoint(sh, u0, v1, p01);
        samplePoint(sh, u1, v1, p11);

        evalNormal(sh, u0, v0, n00);
        evalNormal(sh, u1, v0, n10);
        evalNormal(sh, u0, v1, n01);
        evalNormal(sh, u1, v1, n11);

        pushVert(p00, n00, u0, v0, sh.shellId);
        pushVert(p10, n10, u1, v0, sh.shellId);
        pushVert(p11, n11, u1, v1, sh.shellId);

        pushVert(p00, n00, u0, v0, sh.shellId);
        pushVert(p11, n11, u1, v1, sh.shellId);
        pushVert(p01, n01, u0, v1, sh.shellId);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(partArr, 1));
  return geo;
}

/**
 * 沿 Z 轴拉伸任意 2D 横截面轮廓（左右对称生成两侧实体长梁，保证双侧外向法线严格朝外）
 */
function buildSymmetricExtrudedProfile(
  profileRight: [number, number][],
  zMin: number,
  zMax: number,
  zSegs: number,
  closed: boolean,
  partId: number,
): THREE.BufferGeometry {
  const posArr: number[] = [];
  const normArr: number[] = [];
  const uvArr: number[] = [];
  const partArr: number[] = [];

  const segCount = closed ? profileRight.length : profileRight.length - 1;

  for (const side of [-1, 1]) {
    for (let p = 0; p < segCount; p++) {
      const [rx0, ry0] = profileRight[p];
      const [rx1, ry1] = profileRight[(p + 1) % profileRight.length];
      const x0 = side * rx0;
      const y0 = ry0;
      const x1 = side * rx1;
      const y1 = ry1;

      // 计算右侧剖面外法线：假设 profileRight 按逆时针定义右侧横截面（在 XY 平面上外法线为 +(dy, -dx) 或 -(dy, -dx)）
      // 对右侧：从外底 (10.50, -0.55) -> 外顶 (10.46, 0.54) -> 内顶 (9.80, 0.54) -> 内坡底 (9.52, 0.0) 为逆时针，外法线为 (+dy, -dx)
      const dx = rx1 - rx0;
      const dy = ry1 - ry0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = side * (dy / len);
      const ny = -dx / len;

      const u0 = p / segCount;
      const u1 = (p + 1) / segCount;

      for (let iz = 0; iz < zSegs; iz++) {
        const f0 = iz / zSegs;
        const f1 = (iz + 1) / zSegs;
        const z0 = lerp(zMin, zMax, f0);
        const z1 = lerp(zMin, zMax, f1);

        // 根据 side 调整绕序以确保正面三角面与 (nx, ny, 0) 一致
        if (side > 0) {
          posArr.push(x0, y0, z0, x0, y0, z1, x1, y1, z1);
          posArr.push(x0, y0, z0, x1, y1, z1, x1, y1, z0);
        } else {
          posArr.push(x0, y0, z0, x1, y1, z1, x0, y0, z1);
          posArr.push(x0, y0, z0, x1, y1, z0, x1, y1, z1);
        }
        for (let k = 0; k < 6; k++) {
          normArr.push(nx, ny, 0);
          partArr.push(partId);
        }
        if (side > 0) {
          uvArr.push(u0, f0, u0, f1, u1, f1, u0, f0, u1, f1, u1, f0);
        } else {
          uvArr.push(u0, f0, u1, f1, u0, f1, u0, f0, u1, f0, u1, f1);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(partArr, 1));
  return geo;
}

/**
 * 构建跨海大桥两侧重工复合防撞护栏长梁系统（覆盖 z ∈ [-315, +22]）：
 * - Part 0: 钢筋混凝土新泽西防撞墙基座 + 桥面外侧厚翼缘悬臂边梁
 * - Part 1: 三维凹凸双波纹热浸镀锌防撞钢梁 (W-Beam Corrugated Guardrail)
 * - Part 2: 顶部高强圆管金属扶手横梁 + 中部副横管
 */
function buildBridgeBarrierGeometry(): THREE.BufferGeometry {
  const zMin = -315.0;
  const zMax = 22.0;
  const zSegs = 48;
  const specs: PartSpec[] = [];

  // 1. 新泽西混凝土防撞基座与桥面板厚悬臂翼缘（逆时针闭合剖面，法线朝外/朝上/朝车道内侧）
  const concreteProfile: [number, number][] = [
    [9.52, 0.0],     // 紧贴沥青桥面内缘根部
    [9.52, -0.56],   // 桥面板结构厚度底缘
    [10.50, -0.56],  // 桥面外悬臂底板外缘
    [10.58, -0.06],  // 悬臂翼缘斜折角
    [10.48, 0.50],   // 外侧壁上沿
    [10.44, 0.54],   // 防撞墙顶平台外倒角
    [9.80, 0.54],    // 防撞墙顶平台内沿（宽 0.64m，承托工字钢立柱与路灯法兰底盘）
    [9.70, 0.24],    // 新泽西防撞墙上段陡坡（朝向车道中心与上方）
    [9.54, 0.04],    // 新泽西防撞墙下段导流斜坡
  ];
  specs.push({
    geo: buildSymmetricExtrudedProfile(concreteProfile, zMin, zMax, zSegs, true, 0.0),
    partId: 0.0,
  });

  // 2. 真实凹凸折面双波纹金属防撞梁 (W-Beam Corrugated Steel Guardrail, y ∈ [0.67, 1.01])
  const wBeamProfile: [number, number][] = [
    [9.86, 0.67],    // 下卷边底背部
    [9.89, 0.72],    // 背部下支撑面
    [9.89, 0.96],    // 背部上支撑面
    [9.86, 1.01],    // 上卷边顶峰
    [9.72, 0.94],    // 上波峰凸脊（迎车面强烈受光与拉丝高光折角）
    [9.82, 0.84],    // 中央深 V 波谷凹槽（产生天然机械明暗对比）
    [9.72, 0.74],    // 下波峰凸脊
  ];
  specs.push({
    geo: buildSymmetricExtrudedProfile(wBeamProfile, zMin, zMax, zSegs, true, 1.0),
    partId: 1.0,
  });

  // 3. 顶部粗壮重工合金圆管扶手横梁 (y = 1.26, r = 0.058) + 中部副横管 (y = 1.09, r = 0.032)
  const makeTubeProfile = (cx: number, cy: number, rx: number, ry: number, segs: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i < segs; i++) {
      // 逆时针角度使法线朝外
      const a = (i / segs) * Math.PI * 2.0;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return pts;
  };
  specs.push({
    geo: buildSymmetricExtrudedProfile(makeTubeProfile(9.92, 1.26, 0.062, 0.058, 10), zMin, zMax, zSegs, true, 2.0),
    partId: 2.0,
  });
  specs.push({
    geo: buildSymmetricExtrudedProfile(makeTubeProfile(9.89, 1.09, 0.034, 0.032, 8), zMin, zMax, zSegs, true, 2.0),
    partId: 2.0,
  });

  return mergePartGeometries(specs);
}

/**
 * 构建重工 H 型工字钢护栏立柱 + 法兰底盘 + 六角防阻块几何体（局部原点在 (±9.94, 0, zPost)，立柱扎根于 y = 0.54 混凝土台面）
 */
function buildSteelGuardPostGeometry(): THREE.BufferGeometry {
  const specs: PartSpec[] = [];

  // 1. 底座锚固法兰钢板 + 两侧螺栓凸耳
  const flange = new THREE.BoxGeometry(0.24, 0.036, 0.26);
  flange.translate(0, 0.558, 0);
  specs.push({ geo: flange, partId: 0 });

  for (const bx of [-0.08, 0.08]) {
    for (const bz of [-0.085, 0.085]) {
      const bolt = new THREE.CylinderGeometry(0.016, 0.018, 0.028, 6);
      bolt.translate(bx, 0.586, bz);
      specs.push({ geo: bolt, partId: 1 });
    }
  }

  // 2. H 型钢立柱：前后双翼缘板 + 中央腹板 (y = 0.56 -> 1.27m，与顶部圆管横梁严密咬合)
  const postH = 0.71;
  const postCenterY = 0.56 + postH * 0.5;
  for (const fz of [-0.072, 0.072]) {
    const flangePlate = new THREE.BoxGeometry(0.15, postH, 0.024);
    flangePlate.translate(0, postCenterY, fz);
    specs.push({ geo: flangePlate, partId: 0 });
  }
  const webPlate = new THREE.BoxGeometry(0.028, postH, 0.13);
  webPlate.translate(0, postCenterY, 0);
  specs.push({ geo: webPlate, partId: 0 });

  // 3. 顶部圆管鞍座抱箍帽
  const topCap = new THREE.BoxGeometry(0.165, 0.045, 0.165);
  topCap.translate(-0.01, 1.265, 0);
  specs.push({ geo: topCap, partId: 1 });

  // 4. 朝向车道内侧 (-X) 支撑波形护栏板的防阻托架块 (Spacer Block)
  const spacer = new THREE.BoxGeometry(0.13, 0.25, 0.14);
  spacer.translate(-0.085, 0.84, 0);
  specs.push({ geo: spacer, partId: 1 });

  return mergePartGeometries(specs);
}

/** 构建镶嵌在工字钢立柱迎车侧的高强棱镜反光轮廓标（小巧精致梯形反光片） */
function buildPostReflectorGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(0.024, 0.135, 0.055);
  // 贴合在防阻块内侧边缘（局部 x = -0.15 -> 世界 |x| = 9.94 - 0.15 = 9.79，略探出波谷迎光闪烁）
  geo.translate(-0.152, 0.84, 0);
  return geo;
}

export class HighwayScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.1, 500);
  private rig: LyricRig;

  // 确定性距离积分表（0.05s 采样步长，确保单调递增且任意 seek 严格一致）
  private distanceTable: Float64Array;
  private speedTable: Float32Array;
  private tableDt = 0.05;
  private duration: number;

  // 预烘焙音频事件
  private kickTimes: Float64Array;
  private kickAmps: Float32Array;
  private snareTimes: Float64Array;
  private snareAmps: Float32Array;

  // 网格与材质（保持公开/内部字段兼容测试访问）
  readonly moonMesh: THREE.Mesh;
  private moonMaterial: THREE.ShaderMaterial;
  readonly moonHaloMesh: THREE.Mesh;
  private camForward = new THREE.Vector3();
  private camUp = new THREE.Vector3();
  private roadMesh: THREE.Mesh;
  private roadMaterial: THREE.ShaderMaterial;
  private oceanMesh: THREE.Mesh;
  private oceanMaterial: THREE.ShaderMaterial;
  readonly bridgeTowersGroup = new THREE.Group();
  readonly towerUnits: THREE.Group[] = [];

  // 工业级路灯系统：金属复合灯杆 + 下嵌光学 LED 灯芯 + 双层三维丁达尔体积光锥
  readonly streetlightsInstanced: THREE.InstancedMesh;
  private poleMaterial: THREE.ShaderMaterial;
  readonly lampHeadsInstanced: THREE.InstancedMesh;
  private lampHeadMaterial: THREE.ShaderMaterial;
  readonly lampConesInstanced: THREE.InstancedMesh;
  private lampConeMaterial: THREE.ShaderMaterial;

  // 重工复合桥梁护栏系统：混凝土防撞基座 + 立体波形钢梁 + 顶部圆管 + H型工字钢立柱 + 棱镜反光标
  readonly guardBarrierMesh: THREE.Mesh;
  private barrierMaterial: THREE.ShaderMaterial;
  readonly guardPostsInstanced: THREE.InstancedMesh;
  private guardPostMaterial: THREE.ShaderMaterial;
  readonly guardReflectorsInstanced: THREE.InstancedMesh;
  private guardReflectorMaterial: THREE.MeshBasicMaterial;

  readonly tailLightsMesh: THREE.LineSegments;
  private tailPositions: Float32Array;
  private trafficSeeds: TrafficSeed[] = [];
  readonly warpStreaksInstanced: THREE.InstancedMesh;
  private warpMaterial: THREE.MeshBasicMaterial;
  private streakSeeds: StreakSeed[] = [];
  private underglowMesh: THREE.Mesh;
  private headlightMaterial: THREE.ShaderMaterial;
  private reusableDummy = new THREE.Object3D();

  // 色彩（严格遵循 R5 同色系微调与黑白中性灰保护规范）
  readonly colorMain: THREE.Color;
  readonly colorDeep: THREE.Color;
  readonly colorBright: THREE.Color;
  readonly colorAccent: THREE.Color;
  readonly colorLampWarm: THREE.Color;

  private uniforms: {
    uTime: { value: number };
    uCover: { value: THREE.Texture };
    uDistance: { value: number };
    uSpeed: { value: number };
    uKickSurge: { value: number };
    uSnareFlash: { value: number };
    uWarpDash: { value: number };
    uIsMono: { value: number };
    uCamPos: { value: THREE.Vector3 };
    uMainColor: { value: THREE.Color };
    uAccentColor: { value: THREE.Color };
    uBrightColor: { value: THREE.Color };
    uLampColor: { value: THREE.Color };
    uFogColor: { value: THREE.Color };
  };

  constructor(private init: SceneInit, _look?: string) {
    // 1. 色彩提取与同色系微调（±6°~±16°，黑白封面保持 0 饱和度中性灰）
    const tone = extractCoverTone(init);
    const isMono = tone.mono || init.palette.mono;
    const seed = init.seed ?? 1001;
    const seedRand = rng((seed ^ 0xabcdef01) >>> 0);
    const deltaHue = isMono ? 0 : (seedRand() < 0.5 ? -1 : 1) * (6 + 10 * seedRand());

    const stopMain = tuneCoverStop(tone.mid, tone, 0.45, 0.75, 0.40, 0.95, deltaHue);
    const stopDeep = tuneCoverStop(tone.dark, tone, 0.04, 0.14, 0.20, 0.65, deltaHue);
    const stopBright = tuneCoverStop(tone.highlight, tone, 0.78, 0.98, 0.42, 0.92, deltaHue);
    const stopAccent = tuneCoverStop(tone.bright, tone, 0.55, 0.88, 0.50, 0.95, deltaHue);

    this.colorMain = isMono ? colorFromHsl(0, 0, stopMain.l) : colorFromHsl(stopMain.h, stopMain.s, stopMain.l);
    this.colorDeep = isMono ? colorFromHsl(0, 0, Math.min(0.08, stopDeep.l)) : colorFromHsl(stopDeep.h, stopDeep.s * 0.75, Math.min(0.09, stopDeep.l));
    this.colorBright = isMono ? colorFromHsl(0, 0, stopBright.l) : colorFromHsl(stopBright.h, stopBright.s, stopBright.l);
    this.colorAccent = isMono ? colorFromHsl(0, 0, stopAccent.l) : colorFromHsl(stopAccent.h, stopAccent.s, stopAccent.l);
    // 路灯出光色：在保持封面同色系的前提下融入真实高显指 LED 纯净白炽核心，使灯光既真实通透又与夜色浑然一体（黑白模式下严格 S=0）
    this.colorLampWarm = isMono
      ? colorFromHsl(0, 0, Math.max(0.88, stopBright.l))
      : this.colorBright.clone().lerp(new THREE.Color(1.0, 0.98, 0.95), 0.52);

    const fogColor = this.colorDeep.clone().multiplyScalar(0.55);
    this.scene.background = fogColor;
    this.scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0062);

    // 场景高空月光与近景补光（照亮跨海斜拉桥主塔结构）
    const ambientLight = new THREE.AmbientLight(this.colorBright, 0.88);
    this.scene.add(ambientLight);
    const moonDirLight = new THREE.DirectionalLight(this.colorAccent, 2.2);
    moonDirLight.position.set(0, 95, -160);
    this.scene.add(moonDirLight);
    const fillLight = new THREE.DirectionalLight(this.colorMain, 1.05);
    fillLight.position.set(14, 22, 32);
    this.scene.add(fillLight);

    // 2. 预烘焙音频事件
    const { music } = init;
    const kicks = music.a.hits.kick ?? [];
    const snares = music.a.hits.snare ?? [];

    this.kickTimes = new Float64Array(kicks.length);
    this.kickAmps = new Float32Array(kicks.length);
    for (let i = 0; i < kicks.length; i++) {
      this.kickTimes[i] = kicks[i][0];
      this.kickAmps[i] = kicks[i][1];
    }
    this.snareTimes = new Float64Array(snares.length);
    this.snareAmps = new Float32Array(snares.length);
    for (let i = 0; i < snares.length; i++) {
      this.snareTimes[i] = snares[i][0];
      this.snareAmps[i] = snares[i][1];
    }

    // 3. 构建全曲平滑单调距离积分表与速度表 (Deterministic Travel Distance & Velocity)
    this.duration = Math.max(10, music.duration);
    const tableLen = Math.ceil(this.duration / this.tableDt) + 2;
    this.distanceTable = new Float64Array(tableLen);
    this.speedTable = new Float32Array(tableLen);
    let accumDist = 0;
    let smoothVel = 46.0;
    for (let i = 0; i < tableLen; i++) {
      const sampleT = i * this.tableDt;
      const sec = music.section(sampleT);
      const label = sec?.label ?? 'verse';
      const secEnergy = sec?.energy ?? 0.5;
      const boost = label === 'drop' ? 48.0 : label === 'chorus' ? 24.0 : label === 'build' || label === 'pre' ? 16.0 : 0.0;
      const targetVel = 44.0 + 26.0 * secEnergy + boost;
      smoothVel = i === 0 ? targetVel : lerp(smoothVel, targetVel, 0.18);
      this.speedTable[i] = smoothVel;
      if (i > 0) accumDist += smoothVel * this.tableDt;
      this.distanceTable[i] = accumDist;
    }

    // 4. 全局共享 Uniforms
    this.uniforms = {
      uTime: { value: 0 },
      uCover: { value: init.cover },
      uDistance: { value: 0 },
      uSpeed: { value: 52 },
      uKickSurge: { value: 0 },
      uSnareFlash: { value: 0 },
      uWarpDash: { value: 0 },
      uIsMono: { value: isMono ? 1.0 : 0.0 },
      uCamPos: { value: new THREE.Vector3(0, 1.2, 0) },
      uMainColor: { value: this.colorMain },
      uAccentColor: { value: this.colorAccent },
      uBrightColor: { value: this.colorBright },
      uLampColor: { value: this.colorLampWarm },
      uFogColor: { value: fogColor },
    };

    // 5. 午夜天穹专辑封面明月 (Celestial Cover Moon：单位半径圆盘，在 update 中精确锚定天球无穷远视锥，100% 静止不后退)
    const moonGeo = new THREE.CircleGeometry(1.0, 72);
    this.moonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCover: this.uniforms.uCover,
        uKickSurge: this.uniforms.uKickSurge,
        uWarpDash: this.uniforms.uWarpDash,
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
        uBrightColor: this.uniforms.uBrightColor,
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
        uniform float uKickSurge;
        uniform float uWarpDash;
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        uniform vec3 uBrightColor;
        varying vec2 vUv;

        void main() {
          vec4 coverCol = texture2D(uCover, vUv);
          float r = length(vUv - vec2(0.5)) * 2.0;

          float discMask = 1.0 - smoothstep(0.965, 1.0, r);
          float innerLimb = smoothstep(0.76, 0.985, r) * discMask;

          vec3 limbTint = mix(uBrightColor, vec3(1.0), 0.45);
          vec3 finalRgb = coverCol.rgb * (1.02 + 0.08 * uKickSurge) + limbTint * innerLimb * (0.24 + 0.12 * uWarpDash);

          gl_FragColor = vec4(finalRgb, discMask);
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, this.moonMaterial);
    this.moonMesh.renderOrder = -2;
    this.moonMesh.frustumCulled = false;
    this.scene.add(this.moonMesh);

    // 明月外围静谧大气月晕
    const haloGeo = new THREE.PlaneGeometry(3.2, 3.2);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: {
        uAccentColor: this.uniforms.uAccentColor,
        uBrightColor: this.uniforms.uBrightColor,
        uKickSurge: this.uniforms.uKickSurge,
        uWarpDash: this.uniforms.uWarpDash,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uAccentColor;
        uniform vec3 uBrightColor;
        uniform float uKickSurge;
        uniform float uWarpDash;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - vec2(0.5)) * 2.0;
          float outerCorona = exp(-max(0.0, d - 0.56) * 3.8) * smoothstep(1.0, 0.35, d);
          float rimRing = exp(-pow((d - 0.62) * 7.5, 2.0)) * 0.35;
          float glow = (outerCorona * 0.32 + rimRing) * (1.0 + 0.28 * uKickSurge + 0.25 * uWarpDash);
          vec3 col = mix(uAccentColor, uBrightColor, 0.55) * glow;
          gl_FragColor = vec4(col, clamp(glow, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.moonHaloMesh = new THREE.Mesh(haloGeo, haloMat);
    this.moonHaloMesh.renderOrder = -3;
    this.moonHaloMesh.frustumCulled = false;
    this.scene.add(this.moonHaloMesh);

    // 6. 桥面多车道湿润沥青公路（精确对齐三维路灯光锥落点 |x|=6.0m，区分地面真实椭圆受光池与湿润沥青镜面光柱）
    const roadWidth = 19.6;
    const roadLength = 340.0;
    const roadGeo = new THREE.PlaneGeometry(roadWidth, roadLength, 24, 96);
    this.roadMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCover: this.uniforms.uCover,
        uDistance: this.uniforms.uDistance,
        uKickSurge: this.uniforms.uKickSurge,
        uSnareFlash: this.uniforms.uSnareFlash,
        uWarpDash: this.uniforms.uWarpDash,
        uIsMono: this.uniforms.uIsMono,
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
        uBrightColor: this.uniforms.uBrightColor,
        uLampColor: this.uniforms.uLampColor,
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
        uniform float uTime;
        uniform sampler2D uCover;
        uniform float uDistance;
        uniform float uKickSurge;
        uniform float uSnareFlash;
        uniform float uWarpDash;
        uniform float uIsMono;
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        uniform vec3 uBrightColor;
        uniform vec3 uLampColor;
        uniform vec3 uFogColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          float roadZ = vWorldPos.z - uDistance;
          float xPos = vWorldPos.x;

          // 1) 高频沥青矿料微纹理、排水沟暗影与轮胎压痕
          float grain = hash12(floor(vec2(xPos * 20.0, roadZ * 3.8)));
          float microGrain = hash12(floor(vec2(xPos * 52.0, roadZ * 11.0)));
          float tireTrack = exp(-pow((abs(xPos) - 2.4) * 0.88, 2.0)) * 0.38 + exp(-pow((abs(xPos) - 6.8) * 0.88, 2.0)) * 0.28;
          float streakMicro = 0.5 + 0.5 * sin(roadZ * 1.4 + sin(xPos * 3.2));
          // 靠近混凝土防撞墙根部 (|x| -> 9.52m) 的真实路缘环境遮蔽暗边 (Curb AO)
          float curbAo = smoothstep(9.62, 8.85, abs(xPos));

          // 2) 国标级高对比分道虚线与外侧路肩导流实线
          float dashCycle = fract(roadZ / 10.0);
          float dashMask = smoothstep(0.0, 0.04, dashCycle) * (1.0 - smoothstep(0.38, 0.42, dashCycle));
          float centerDouble = smoothstep(0.11, 0.04, abs(abs(xPos) - 0.22));
          float laneDiv = (smoothstep(0.12, 0.04, abs(xPos - 4.6)) + smoothstep(0.12, 0.04, abs(xPos + 4.6))) * dashMask;
          float shoulderLine = smoothstep(0.17, 0.055, abs(abs(xPos) - 9.05));
          // 路肩高频反光猫眼道钉（每 6m 一颗）
          float studZ = fract((roadZ + 2.0) / 6.0) * 6.0 - 3.0;
          float studs = exp(-(pow(abs(xPos) - 9.05, 2.0) * 42.0 + studZ * studZ * 9.5)) * 2.1;

          // 3) 每 28m 一道跨海大桥横向梳齿钢伸缩缝
          float jointLocal = fract(roadZ / 28.0) * 28.0;
          float expansionJoint = exp(-pow((jointLocal - 14.0) * 5.2, 2.0)) * (0.48 + 0.42 * uKickSurge);

          // 4) 与头顶三维路灯锥形光束（间距 18m，落地中心 |x| = 6.0m）100% 严丝合缝对齐的桥面真实受光光池
          float lampCellZ = mod(roadZ - 14.0, 18.0);
          if (lampCellZ > 9.0) lampCellZ -= 18.0;
          float dxLamp = (abs(xPos) - 6.0) / 3.75;
          float dzLamp = lampCellZ / 3.45;
          float coneDist2 = dxLamp * dxLamp + dzLamp * dzLamp;
          // 地面直接照度池（无论干湿均照亮沥青纹理与标线：内圈聚光核 + 外圈柔化漫反射）
          float coneCorePool = exp(-coneDist2 * 3.1);
          float coneWidePool = exp(-coneDist2 * 0.92);
          // 湿滑沥青朝向镜头的纵向拉长高光柱（Anisotropic Wet Specular Streak）
          float specStreak = exp(-pow((abs(xPos) - 6.25) * 0.52, 2.0)) * exp(-pow(lampCellZ * 0.16, 2.0));

          // 5) 雨夜桥面水洼分布与天穹封面明月清辉倒影（压低中心大面积平涂紫光，凸显两侧路灯光池对比度）
          float puddleWave = sin(xPos * 0.55 + sin(roadZ * 0.09)) * cos(roadZ * 0.11 - xPos * 0.25);
          float wetness = clamp(0.36 + 0.48 * puddleWave + 0.22 * tireTrack, 0.08, 0.96);
          float moonRefl = exp(-abs(xPos) * 0.24) * wetness;
          vec2 coverUv = vec2(clamp(0.5 + xPos / 22.0 + 0.012 * sin(roadZ * 0.45), 0.02, 0.98), clamp(0.35 + 0.18 * sin(roadZ * 0.05), 0.1, 0.9));
          vec3 moonlightCol = texture2D(uCover, coverUv).rgb;

          vec3 baseTone = mix(vec3(0.016, 0.019, 0.026), vec3(0.020), uIsMono);
          vec3 asphaltLit = baseTone + (0.015 * grain + 0.009 * microGrain + 0.008 * streakMicro * tireTrack);
          // 路灯光锥直接照亮地面沥青矿料颗粒，呈现极真实的受光质感
          float lampPulse = 1.0 + 0.28 * uKickSurge + 0.22 * uWarpDash;
          vec3 lampGroundDiffuse = uLampColor * (0.20 * coneWidePool + 0.34 * coneCorePool) * (0.65 + 0.75 * grain) * lampPulse;
          vec3 lampWetSpec = mix(uLampColor, uAccentColor, 0.25) * (0.36 * coneCorePool + 0.42 * specStreak) * wetness * lampPulse;

          float markBoost = 1.0 + 0.55 * coneWidePool;
          vec3 centerCol = mix(uAccentColor, uBrightColor, 0.55) * centerDouble * (0.82 + 0.50 * uKickSurge) * markBoost;
          vec3 whiteMarks = mix(vec3(0.90), uBrightColor, 0.32) * (laneDiv + shoulderLine * 0.92) * (1.02 + 0.45 * uKickSurge) * markBoost;
          vec3 studCol = uAccentColor * studs * (1.05 + 0.75 * uSnareFlash + 0.55 * uWarpDash);
          vec3 jointCol = uMainColor * expansionJoint * 0.52;
          vec3 moonRoadReflCol = mix(moonlightCol, uBrightColor, 0.30) * moonRefl * (0.42 + 0.38 * uWarpDash);

          vec3 col = (asphaltLit * (1.0 - 0.22 * wetness) + lampGroundDiffuse + lampWetSpec) * (0.35 + 0.65 * curbAo)
                   + centerCol + whiteMarks + studCol + jointCol + moonRoadReflCol;

          float fogDist = length(vWorldPos - vec3(0.0, 1.5, 0.0));
          float fogFactor = 1.0 - exp(-pow(fogDist * 0.0056, 2.0));
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.roadMesh = new THREE.Mesh(roadGeo, this.roadMaterial);
    this.roadMesh.rotation.x = -Math.PI / 2;
    this.roadMesh.position.set(0, 0, -135);
    this.scene.add(this.roadMesh);

    // 7. 辽阔大洋水面 (Ocean Water beneath Bridge at Y = -6.5m)
    const oceanGeo = new THREE.PlaneGeometry(420, 440, 24, 24);
    this.oceanMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uDistance: this.uniforms.uDistance,
        uIsMono: this.uniforms.uIsMono,
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
        uBrightColor: this.uniforms.uBrightColor,
        uFogColor: this.uniforms.uFogColor,
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
        uniform float uTime;
        uniform float uDistance;
        uniform float uIsMono;
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        uniform vec3 uBrightColor;
        uniform vec3 uFogColor;
        varying vec3 vWorldPos;

        void main() {
          float seaZ = vWorldPos.z - uDistance * 0.95;
          float wave1 = sin(vWorldPos.x * 0.14 + uTime * 1.6) * cos(seaZ * 0.18 + uTime * 0.9);
          float wave2 = sin(vWorldPos.x * 0.32 - seaZ * 0.36 + uTime * 2.1);
          float crest = smoothstep(0.35, 0.95, 0.5 + 0.3 * wave1 + 0.25 * wave2);
          float moonPath = exp(-abs(vWorldPos.x) * 0.032);
          vec3 seaInk = mix(vec3(0.008, 0.013, 0.024), vec3(0.014), uIsMono);
          vec3 baseOcean = mix(seaInk, uMainColor * 0.12, 0.5);
          vec3 spec = mix(uAccentColor, uBrightColor, 0.42) * (moonPath * (0.32 + 0.52 * crest) + 0.06 * crest);
          vec3 col = baseOcean + spec;

          float fogDist = length(vWorldPos);
          float fogFactor = 1.0 - exp(-pow(fogDist * 0.0052, 2.0));
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMaterial);
    this.oceanMesh.rotation.x = -Math.PI / 2;
    this.oceanMesh.position.set(0, -6.5, -165);
    this.scene.add(this.oceanMesh);

    // 8. 跨海斜拉桥循环主塔与放射发光钢索
    const towerMat = new THREE.MeshStandardMaterial({
      color: isMono ? 0x2a2a2a : 0x1e2534,
      emissive: this.colorDeep,
      emissiveIntensity: 0.9,
      roughness: 0.45,
      metalness: 0.65,
    });
    const neonCableMat = new THREE.LineBasicMaterial({
      color: this.colorAccent,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const towerStripMat = new THREE.MeshBasicMaterial({
      color: this.colorBright,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const towerPillarGeo = new THREE.CylinderGeometry(0.75, 1.15, 48, 8);
    const upperBeamGeo = new THREE.BoxGeometry(17.2, 1.15, 1.5);
    const midBeamGeo = new THREE.BoxGeometry(20.2, 0.9, 1.3);
    const stripGeo = new THREE.BoxGeometry(0.18, 42, 0.22);

    const cablePositions: number[] = [];
    const numCables = 12;
    for (let c = 0; c < numCables; c++) {
      const frac = (c + 1) / numCables;
      const offsetZ = 5.0 + frac * 31.0;
      const topY = 27.0 + frac * 14.5;
      const topX = 9.8 - (topY / 48.0) * 3.1;
      for (const signZ of [-1, 1]) {
        cablePositions.push(-topX, topY, 0, -10.1, 0.65, signZ * offsetZ);
        cablePositions.push(topX, topY, 0, 10.1, 0.65, signZ * offsetZ);
      }
    }
    const cableGeo = new THREE.BufferGeometry();
    cableGeo.setAttribute('position', new THREE.Float32BufferAttribute(cablePositions, 3));

    for (let tIdx = 0; tIdx < NUM_TOWER_SPANS; tIdx++) {
      const unit = new THREE.Group();

      const leftPillar = new THREE.Mesh(towerPillarGeo, towerMat);
      leftPillar.position.set(-10.2, 20, 0);
      leftPillar.rotation.z = -0.11;
      unit.add(leftPillar);

      const rightPillar = new THREE.Mesh(towerPillarGeo, towerMat);
      rightPillar.position.set(10.2, 20, 0);
      rightPillar.rotation.z = 0.11;
      unit.add(rightPillar);

      const leftStrip = new THREE.Mesh(stripGeo, towerStripMat);
      leftStrip.position.set(-9.45, 20, 0.68);
      leftStrip.rotation.z = -0.11;
      unit.add(leftStrip);

      const rightStrip = new THREE.Mesh(stripGeo, towerStripMat);
      rightStrip.position.set(9.45, 20, 0.68);
      rightStrip.rotation.z = 0.11;
      unit.add(rightStrip);

      const upperBeam = new THREE.Mesh(upperBeamGeo, towerMat);
      upperBeam.position.set(0, 35.5, 0);
      unit.add(upperBeam);

      const midBeam = new THREE.Mesh(midBeamGeo, towerMat);
      midBeam.position.set(0, 21.0, 0);
      unit.add(midBeam);

      const cables = new THREE.LineSegments(cableGeo, neonCableMat);
      unit.add(cables);

      this.towerUnits.push(unit);
      this.bridgeTowersGroup.add(unit);
    }
    this.scene.add(this.bridgeTowersGroup);

    // 9. 重工复合桥梁防撞护栏系统（混凝土新泽西基座 + 立体双波纹镀锌钢梁 + 顶部合金横管 + H型工字钢立柱 + 嵌入式反光轮廓标）
    const barrierGeo = buildBridgeBarrierGeometry();
    this.barrierMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uDistance: this.uniforms.uDistance,
        uKickSurge: this.uniforms.uKickSurge,
        uSnareFlash: this.uniforms.uSnareFlash,
        uWarpDash: this.uniforms.uWarpDash,
        uIsMono: this.uniforms.uIsMono,
        uCamPos: this.uniforms.uCamPos,
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
        uBrightColor: this.uniforms.uBrightColor,
        uLampColor: this.uniforms.uLampColor,
        uFogColor: this.uniforms.uFogColor,
      },
      vertexShader: /* glsl */ `
        attribute float aPart;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vPart;
        void main() {
          vPart = aPart;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDistance;
        uniform float uKickSurge;
        uniform float uSnareFlash;
        uniform float uWarpDash;
        uniform float uIsMono;
        uniform vec3 uCamPos;
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        uniform vec3 uBrightColor;
        uniform vec3 uLampColor;
        uniform vec3 uFogColor;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vPart;

        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 V = normalize(uCamPos - vWorldPos);
          float roadZ = vWorldPos.z - uDistance;

          // 每 6.0m 对齐工字钢立柱的伸缩沉降缝与护栏板拼接缝
          float postMod = mod(roadZ - 12.0 + 3.0, 6.0) - 3.0;
          float seamGroove = 1.0 - 0.62 * exp(-pow(postMod * 18.0, 2.0));

          // 最近一盏头顶路灯 (|x| = 7.62, y = 7.68, 周期 18m) 对护栏表面的三维实时点光照明与流动金属高光
          float lampRelZ = mod(roadZ - 14.0 + 9.0, 18.0) - 9.0;
          float sideSign = vWorldPos.x >= 0.0 ? 1.0 : -1.0;
          vec3 lampOffset = vec3(sideSign * 7.62 - vWorldPos.x, 7.68 - vWorldPos.y, -lampRelZ);
          float lampDist = length(lampOffset);
          vec3 L = lampOffset / max(0.001, lampDist);
          vec3 H = normalize(L + V);
          float atten = 1.0 / (1.0 + 0.022 * lampDist * lampDist);
          float ndl = max(0.0, dot(N, L));

          // 自车前照大灯对前方近景护栏 (-38m ~ 0m) 的真实扫掠补光
          vec3 headPos = vec3(uCamPos.x, 0.82, uCamPos.z + 1.2);
          vec3 headVec = headPos - vWorldPos;
          float headDist = length(headVec);
          vec3 Lh = headVec / max(0.001, headDist);
          float forwardMask = smoothstep(2.0, -4.0, vWorldPos.z - uCamPos.z);
          float headAtten = forwardMask / (1.0 + 0.012 * headDist * headDist);
          float ndlh = max(0.0, dot(N, Lh));

          // 月光与天光边缘菲涅尔轮廓
          vec3 moonL = normalize(vec3(-sideSign * 0.35, 0.78, -0.52));
          float moonDiff = max(0.0, dot(N, moonL));
          float fresnel = pow(1.0 - max(0.0, dot(N, V)), 3.0);

          vec3 col;
          float lampPulse = 1.0 + 0.25 * uKickSurge + 0.20 * uWarpDash;

          if (vPart < 0.5) {
            // Part 0: 钢筋混凝土新泽西防撞基座与厚翼缘桥面板（扎实深灰水泥颗粒 + 顶部湿润微反光 + 根部导流警示斜纹）
            float grit = hash12(floor(vec2((vWorldPos.x + vWorldPos.y) * 42.0, roadZ * 16.0)));
            float fineGrit = hash12(floor(vec2(vWorldPos.y * 95.0, roadZ * 42.0)));
            vec3 concBase = mix(vec3(0.032, 0.036, 0.046), vec3(0.038), uIsMono) * (0.76 + 0.36 * grit + 0.18 * fineGrit);

            // 基座底部 (y ∈ [0.02, 0.14]) 斜纹反光导流踢脚带（仅内坡迎车面）
            float innerFace = smoothstep(0.08, 0.55, -sideSign * N.x);
            float curbBandMask = smoothstep(0.015, 0.035, vWorldPos.y) * (1.0 - smoothstep(0.125, 0.145, vWorldPos.y)) * innerFace;
            float chevron = smoothstep(-0.12, 0.12, sin((roadZ + vWorldPos.y * 2.6) * 3.14159 * 0.9));
            vec3 hazardBright = mix(uLampColor, uAccentColor, 0.38) * (0.36 + 0.95 * atten + 0.75 * headAtten);
            vec3 hazardCol = mix(concBase * 0.25, hazardBright, chevron);

            float topEdge = smoothstep(0.49, 0.535, vWorldPos.y) * max(0.0, N.y);
            float specConc = pow(max(0.0, dot(N, H)), 24.0) * (0.28 + 0.35 * topEdge);
            vec3 litConc = concBase * (0.22 + 0.38 * moonDiff + 0.25 * max(0.0, N.y))
                         + uLampColor * atten * (0.95 * ndl + specConc) * lampPulse
                         + uLampColor * headAtten * (0.62 * ndlh)
                         + mix(uMainColor, vec3(0.8), 0.35) * (fresnel * 0.09 + topEdge * 0.04);
            col = mix(litConc, hazardCol, curbBandMask * 0.88) * seamGroove;
          } else {
            // Part 1 & Part 2: 热浸镀锌拉丝双波纹钢护栏 (W-Beam) 与顶部高强合金圆管横梁（高对比冷冽重工金属质感）
            float brushed = 0.82 + 0.18 * sin(roadZ * 48.0 + vWorldPos.y * 150.0);
            float isTopTube = step(1.5, vPart);
            vec3 steelTint = mix(vec3(0.065, 0.078, 0.105), vec3(0.082), uIsMono) * brushed;

            // 每 6m 立柱拼接处的钢板搭接黑缝与双排镀铬铆钉高光颗粒
            float lapSeam = 1.0 - 0.78 * exp(-pow(postMod * 26.0, 2.0));
            float boltRow = exp(-pow(abs(vWorldPos.y - 0.76) * 34.0, 2.0)) + exp(-pow(abs(vWorldPos.y - 0.92) * 34.0, 2.0));
            float boltBump = exp(-pow((abs(postMod) - 0.12) * 36.0, 2.0)) * boltRow * (1.0 - isTopTube);

            // 强烈区分朝上折面（映天光与路灯）与朝下背阴面（深邃暗钢色）+ 中央深 V 凹槽机械 AO
            float skyFacing = clamp(0.5 + 0.5 * N.y, 0.0, 1.0);
            float grooveAo = isTopTube > 0.5 ? 1.0 : (0.26 + 0.74 * smoothstep(0.008, 0.075, abs(vWorldPos.y - 0.84)));

            // 高锐度各向异性拉丝金属高光：头顶路灯扫过时在凹凸波形脊线与圆管上拉出璀璨银白/同色流光带
            vec3 Hh = normalize(Lh + V);
            float shininess = mix(42.0, 72.0, isTopTube);
            float anisoSpec = pow(max(0.0, dot(N, H)), shininess) * mix(1.95, 2.65, isTopTube)
                            + pow(max(0.0, 1.0 - abs(N.y - H.y)), 18.0) * max(0.0, dot(N, L)) * 0.42;
            float specHead = pow(max(0.0, dot(N, Hh)), shininess * 0.75) * 1.55;
            float specSky = pow(skyFacing, 3.2) * (0.14 + 0.12 * isTopTube);

            vec3 specularTint = mix(uLampColor, vec3(1.0), 0.42);
            col = steelTint * (0.16 + 0.42 * moonDiff + 0.35 * skyFacing) * grooveAo
                + mix(uBrightColor, vec3(0.95), 0.5) * specSky * grooveAo
                + specularTint * atten * (0.78 * ndl + anisoSpec) * lampPulse * (0.45 + 0.55 * grooveAo)
                + specularTint * headAtten * (0.58 * ndlh + specHead)
                + mix(uAccentColor, uBrightColor, 0.65) * fresnel * mix(0.18, 0.34, isTopTube) * skyFacing
                + specularTint * boltBump * (0.45 + 1.25 * atten + 0.85 * headAtten);
            col *= mix(lapSeam, seamGroove, isTopTube);
          }

          float fogDist = length(vWorldPos - vec3(0.0, 1.5, 0.0));
          float fogFactor = 1.0 - exp(-pow(fogDist * 0.0056, 2.0));
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.guardBarrierMesh = new THREE.Mesh(barrierGeo, this.barrierMaterial);
    this.guardBarrierMesh.frustumCulled = false;
    this.scene.add(this.guardBarrierMesh);

    // H型工字钢护栏立柱实例化网格（受路灯与前大灯真实金属高光照射）
    const guardPostGeo = buildSteelGuardPostGeometry();
    this.guardPostMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uDistance: this.uniforms.uDistance,
        uKickSurge: this.uniforms.uKickSurge,
        uIsMono: this.uniforms.uIsMono,
        uCamPos: this.uniforms.uCamPos,
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
        uBrightColor: this.uniforms.uBrightColor,
        uLampColor: this.uniforms.uLampColor,
        uFogColor: this.uniforms.uFogColor,
      },
      vertexShader: /* glsl */ `
        attribute float aPart;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vPart;
        void main() {
          vPart = aPart;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDistance;
        uniform float uKickSurge;
        uniform float uIsMono;
        uniform vec3 uCamPos;
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        uniform vec3 uBrightColor;
        uniform vec3 uLampColor;
        uniform vec3 uFogColor;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vPart;

        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 V = normalize(uCamPos - vWorldPos);
          float roadZ = vWorldPos.z - uDistance;
          float sideSign = vWorldPos.x >= 0.0 ? 1.0 : -1.0;

          float lampRelZ = mod(roadZ - 14.0 + 9.0, 18.0) - 9.0;
          vec3 lampOffset = vec3(sideSign * 7.62 - vWorldPos.x, 7.68 - vWorldPos.y, -lampRelZ);
          float lampDist = length(lampOffset);
          vec3 L = lampOffset / max(0.001, lampDist);
          vec3 H = normalize(L + V);
          float atten = 1.0 / (1.0 + 0.022 * lampDist * lampDist);

          vec3 moonL = normalize(vec3(-sideSign * 0.3, 0.8, -0.5));
          float moonDiff = max(0.0, dot(N, moonL));
          float spec = pow(max(0.0, dot(N, H)), 48.0) * 1.95;
          float rim = pow(1.0 - max(0.0, dot(N, V)), 3.0);

          vec3 steelBase = mix(vec3(0.055, 0.068, 0.092), vec3(0.068), uIsMono) * (1.0 + 0.28 * vPart);
          vec3 col = steelBase * (0.22 + 0.55 * moonDiff)
                   + mix(uLampColor, vec3(1.0), 0.35) * atten * (0.85 * max(0.0, dot(N, L)) + spec) * (1.0 + 0.25 * uKickSurge)
                   + mix(uMainColor, uBrightColor, 0.55) * rim * 0.24;

          float fogDist = length(vWorldPos - vec3(0.0, 1.5, 0.0));
          float fogFactor = 1.0 - exp(-pow(fogDist * 0.0056, 2.0));
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.guardPostsInstanced = new THREE.InstancedMesh(guardPostGeo, this.guardPostMaterial, NUM_GUARD_POSTS * 2);
    this.guardPostsInstanced.frustumCulled = false;
    this.scene.add(this.guardPostsInstanced);

    // 工字钢立柱迎车侧镶嵌的精致高强反光轮廓标（小巧棱镜，高速清脆掠过）
    const reflectorGeo = buildPostReflectorGeometry();
    this.guardReflectorMaterial = new THREE.MeshBasicMaterial({
      color: this.colorLampWarm.clone().lerp(this.colorAccent, 0.45),
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.guardReflectorsInstanced = new THREE.InstancedMesh(reflectorGeo, this.guardReflectorMaterial, NUM_GUARD_POSTS * 2);
    this.guardReflectorsInstanced.frustumCulled = false;
    this.scene.add(this.guardReflectorsInstanced);

    // 10. 真实工业级流线型路灯杆 + 光学阵列 LED 灯芯 + 双层三维锥形丁达尔体积光束
    const poleGeo = buildRealisticStreetlightGeometry();
    this.poleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uKickSurge: this.uniforms.uKickSurge,
        uIsMono: this.uniforms.uIsMono,
        uCamPos: this.uniforms.uCamPos,
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
        uBrightColor: this.uniforms.uBrightColor,
        uLampColor: this.uniforms.uLampColor,
        uFogColor: this.uniforms.uFogColor,
      },
      vertexShader: /* glsl */ `
        attribute float aPart;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;
        varying vec3 vWorldNormal;
        varying float vPart;
        void main() {
          vPart = aPart;
          vLocalPos = position;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uKickSurge;
        uniform float uIsMono;
        uniform vec3 uCamPos;
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        uniform vec3 uBrightColor;
        uniform vec3 uLampColor;
        uniform vec3 uFogColor;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;
        varying vec3 vWorldNormal;
        varying float vPart;

        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 V = normalize(uCamPos - vWorldPos);
          float sideSign = vWorldPos.x >= 0.0 ? 1.0 : -1.0;

          // 1) 自家 LED 灯头（局部 (-2.56, 7.62, 0)）对挑臂、斜撑拉杆与灯杆内侧上半截的真实近场强照明与圆柱金属高光
          vec3 ownLampLocal = vec3(-2.56, 7.56, 0.0);
          vec3 toLampLocal = ownLampLocal - vLocalPos;
          float dOwn = length(toLampLocal);
          vec3 Lown = normalize(vec3(-sideSign * toLampLocal.x, toLampLocal.y, -sideSign * toLampLocal.z));
          vec3 Hown = normalize(Lown + V);
          float ownAtten = 1.0 / (0.28 + 0.32 * dOwn * dOwn);
          float ownDiff = max(0.0, dot(N, Lown));
          float ownSpec = pow(max(0.0, dot(N, Hown)), 48.0) * 2.1;

          // 2) 高对比深枪灰钛金属烤漆 + 圆柱侧面锐利月光/天光高光脊线（告别平涂浅灰）
          vec3 moonL = normalize(vec3(-sideSign * 0.52, 0.68, -0.52));
          vec3 rimLightDir = normalize(vec3(-sideSign * 0.72, 0.22, 0.65));
          float moonDiff = max(0.0, dot(N, moonL));
          float innerDiff = max(0.0, dot(N, rimLightDir));
          float fresnel = pow(1.0 - max(0.0, dot(N, V)), 3.2);
          float cylinderSpec = pow(max(0.0, dot(N, normalize(rimLightDir + V))), 42.0);
          float moonSpec = pow(max(0.0, dot(N, normalize(moonL + V))), 32.0);

          vec3 poleAlbedo = mix(vec3(0.058, 0.070, 0.098), vec3(0.072), uIsMono);
          vec3 hoodAlbedo = mix(vec3(0.036, 0.042, 0.062), vec3(0.045), uIsMono);
          vec3 metalBase = mix(poleAlbedo, hoodAlbedo, vPart);

          // 灯杆根部受路面反光微暖补光，中段深邃冷冽，上段弯臂受自家 LED 灯芯近距离映亮
          float groundBounce = exp(-max(0.0, vWorldPos.y - 0.5) * 0.55) * (0.5 + 0.5 * innerDiff);
          vec3 col = metalBase * (0.18 + 0.42 * moonDiff + 0.24 * innerDiff)
                   + mix(uLampColor, vec3(1.0), 0.35) * ownAtten * (0.95 * ownDiff + ownSpec) * (1.0 + 0.25 * uKickSurge)
                   + mix(uBrightColor, vec3(0.96), 0.5) * (0.48 * cylinderSpec + 0.28 * moonSpec + 0.22 * fresnel * (0.35 + 0.65 * innerDiff))
                   + mix(uAccentColor, uLampColor, 0.4) * groundBounce * 0.14;

          float fogDist = length(vWorldPos - vec3(0.0, 1.5, 0.0));
          float fogFactor = 1.0 - exp(-pow(fogDist * 0.0056, 2.0));
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.streetlightsInstanced = new THREE.InstancedMesh(poleGeo, this.poleMaterial, NUM_STREETLIGHTS * 2);
    this.streetlightsInstanced.frustumCulled = false;
    this.scene.add(this.streetlightsInstanced);

    // 下嵌式多核光学透镜 LED 发光模组（取代原先扁平纯色大方块）
    const lampLensGeo = buildLuminaireLensGeometry();
    this.lampHeadMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uKickSurge: this.uniforms.uKickSurge,
        uWarpDash: this.uniforms.uWarpDash,
        uLampColor: this.uniforms.uLampColor,
        uAccentColor: this.uniforms.uAccentColor,
        uFogColor: this.uniforms.uFogColor,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;
        void main() {
          vUv = uv;
          vLocalNormal = normal;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uKickSurge;
        uniform float uWarpDash;
        uniform vec3 uLampColor;
        uniform vec3 uAccentColor;
        uniform vec3 uFogColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;

        void main() {
          // 模拟 8×3 颗高功率光学透镜 LED 灯珠矩阵与柔光漫射玻璃罩
          vec2 cell = fract(vUv * vec2(8.0, 3.0)) - 0.5;
          float emitter = exp(-dot(cell, cell) * 14.0);
          vec2 edge = abs(vUv - 0.5) * 2.0;
          float bezelMask = 1.0 - smoothstep(0.78, 1.0, max(edge.x, edge.y));
          // 底面为主出光窗口，边缘微弱散射
          float bottomWeight = smoothstep(-0.2, -0.8, vLocalNormal.y) * 0.75 + 0.25;

          float intensity = (0.78 + 0.52 * emitter) * (0.45 + 0.55 * bezelMask) * bottomWeight;
          intensity *= (1.05 + 0.32 * uKickSurge + 0.18 * uWarpDash);

          vec3 coreWhite = mix(uLampColor, vec3(1.0), 0.55);
          vec3 col = mix(uAccentColor, coreWhite, clamp(0.45 + 0.55 * bezelMask * (0.6 + 0.4 * emitter), 0.0, 1.0)) * intensity;

          float fogDist = length(vWorldPos - vec3(0.0, 1.5, 0.0));
          float fogFactor = exp(-pow(fogDist * 0.0054, 2.0));
          gl_FragColor = vec4(col * fogFactor, 1.0);
        }
      `,
    });
    this.lampHeadsInstanced = new THREE.InstancedMesh(lampLensGeo, this.lampHeadMaterial, NUM_STREETLIGHTS * 2);
    this.lampHeadsInstanced.frustumCulled = false;
    this.scene.add(this.lampHeadsInstanced);

    // 双层三维锥形丁达尔体积光束（从灯具透镜一直斜射照到桥面沥青光池上！）
    const lampConeGeo = buildVolumetricLampConeGeometry();
    this.lampConeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uDistance: this.uniforms.uDistance,
        uKickSurge: this.uniforms.uKickSurge,
        uWarpDash: this.uniforms.uWarpDash,
        uCamPos: this.uniforms.uCamPos,
        uLampColor: this.uniforms.uLampColor,
        uAccentColor: this.uniforms.uAccentColor,
      },
      vertexShader: /* glsl */ `
        attribute float aPart;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vShell;
        void main() {
          vUv = uv;
          vShell = aPart;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uDistance;
        uniform float uKickSurge;
        uniform float uWarpDash;
        uniform vec3 uCamPos;
        uniform vec3 uLampColor;
        uniform vec3 uAccentColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vShell;

        void main() {
          vec3 V = normalize(uCamPos - vWorldPos);
          vec3 N = normalize(vWorldNormal);

          // 1) 视角菲涅尔软边缘积分：圆锥两侧切线边缘 ndv -> 0，100% 消除多边形硬折边
          float ndv = abs(dot(N, V));
          float edgeSoft = pow(ndv, mix(1.50, 1.95, vShell));

          // 2) 纵向配光衰减：vUv.y = 1 紧贴灯头亮核，向下斜射延伸为清晰修长的锥形丁达尔光束，触地前柔和汇入地面椭圆光池
          float topJoin = smoothstep(1.0, 0.965, vUv.y);
          float heightFalloff = mix(0.26, 1.0, pow(vUv.y, 1.25));
          float sourceGlow = 0.42 * exp(-pow((1.0 - vUv.y) * 8.5, 2.0));
          float groundBlend = smoothstep(0.0, 0.075, vUv.y);

          // 3) 跨海夜雾丁达尔光缕微纹理（随圆锥母线角度与海风细微流动）
          float angle = vUv.x * 6.2831853;
          float rays = 0.86 + 0.14 * sin(angle * 7.0 + vUv.y * 2.5) * cos(angle * 4.0 - uTime * 0.85);
          float seaMist = 0.90 + 0.10 * sin((vWorldPos.z - uDistance) * 0.16 + vWorldPos.y * 0.6 + uTime * 1.1);

          // 4) 远景雾化与贴近镜头防刺眼淡出（避免斜向机位远端多盏光锥视线重叠过曝，近中景 6~85m 保持饱满清晰）
          float camDist = length(vWorldPos - uCamPos);
          float nearFade = smoothstep(1.8, 6.2, camDist);
          float farFade = exp(-pow(camDist * 0.0085, 2.0));

          // 注意：Three.js AdditiveBlending 为 srcRGB * srcAlpha + dstRGB，alpha 通道置 1.0 避免二次平方衰减！
          float baseGain = mix(0.088, 0.135, vShell);
          float energy = (baseGain * heightFalloff + sourceGlow * (0.5 + 0.5 * vShell))
                       * edgeSoft * topJoin * groundBlend * rays * seaMist * nearFade * farFade;
          energy *= (1.0 + 0.28 * uKickSurge + 0.16 * uWarpDash);

          vec3 beamTint = mix(mix(uAccentColor, uLampColor, 0.65), uLampColor, 0.45 * vUv.y + 0.48 * vShell);
          gl_FragColor = vec4(beamTint * energy, 1.0);
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.lampConesInstanced = new THREE.InstancedMesh(lampConeGeo, this.lampConeMaterial, NUM_STREETLIGHTS * 2);
    this.lampConesInstanced.frustumCulled = false;
    this.lampConesInstanced.renderOrder = 2;
    this.scene.add(this.lampConesInstanced);

    // 11. 动态穿梭超车的车流尾灯流光残影与自车双前照大灯铺路柔光（消除原先路面中央生硬的纯色矩形色块！）
    const trafficRand = rng((seed ^ 0x7711cc99) >>> 0);
    const lanes = [-6.8, -2.5, 2.5, 6.8];
    for (let i = 0; i < NUM_TRAFFIC_CARS; i++) {
      this.trafficSeeds.push({
        laneX: lanes[i % lanes.length] + (trafficRand() - 0.5) * 0.4,
        zPhase: trafficRand() * 240.0,
        relSpeed: 0.42 + trafficRand() * 0.36,
        width: 0.78 + trafficRand() * 0.18,
      });
    }
    this.tailPositions = new Float32Array(NUM_TRAFFIC_CARS * 4 * 3);
    const tailLinesGeo = new THREE.BufferGeometry();
    tailLinesGeo.setAttribute('position', new THREE.BufferAttribute(this.tailPositions, 3));
    const tailColor = isMono
      ? colorFromHsl(0, 0.0, 0.86)
      : colorFromHsl((stopAccent.h + 10) % 360, Math.max(0.68, stopAccent.s), Math.max(0.62, stopAccent.l));
    const tailMat = new THREE.LineBasicMaterial({
      color: tailColor,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.tailLightsMesh = new THREE.LineSegments(tailLinesGeo, tailMat);
    this.tailLightsMesh.frustumCulled = false;
    this.scene.add(this.tailLightsMesh);

    // 第一人称自车前照双锥铺路柔光（100% 径向与扇形高斯羽化，彻底告别硬边粉红方块！）
    const underglowGeo = new THREE.PlaneGeometry(9.0, 26.0);
    this.headlightMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uLampColor: this.uniforms.uLampColor,
        uAccentColor: this.uniforms.uAccentColor,
        uKickSurge: this.uniforms.uKickSurge,
        uWarpDash: this.uniforms.uWarpDash,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uLampColor;
        uniform vec3 uAccentColor;
        uniform float uKickSurge;
        uniform float uWarpDash;
        varying vec2 vUv;
        void main() {
          // vUv.y: 1.0 在车头近处，0.0 在前方远端；左右双车灯扇形柔和展开并在四周平滑归零
          float fwd = 1.0 - vUv.y;
          float beamSpread = 0.09 + fwd * 0.28;
          float leftBeam = exp(-pow((vUv.x - (0.41 - fwd * 0.06)) / beamSpread, 2.0));
          float rightBeam = exp(-pow((vUv.x - (0.59 + fwd * 0.06)) / beamSpread, 2.0));
          float edgeMaskX = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
          float edgeMaskY = smoothstep(0.0, 0.22, fwd) * exp(-fwd * 2.4) * smoothstep(1.0, 0.82, fwd);
          float glow = (leftBeam + rightBeam) * edgeMaskX * edgeMaskY * (0.20 + 0.08 * uKickSurge + 0.06 * uWarpDash);
          vec3 col = mix(uLampColor, uAccentColor, 0.30) * glow;
          gl_FragColor = vec4(col, glow);
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.underglowMesh = new THREE.Mesh(underglowGeo, this.headlightMaterial);
    this.underglowMesh.rotation.x = -Math.PI / 2;
    this.underglowMesh.position.set(0, 0.04, -14.5);
    this.scene.add(this.underglowMesh);

    // 12. 高速迎面流光拉丝
    const streakGeo = new THREE.CylinderGeometry(0.035, 0.035, 7.5, 4);
    streakGeo.rotateX(Math.PI * 0.5);
    this.warpMaterial = new THREE.MeshBasicMaterial({
      color: this.colorBright,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.warpStreaksInstanced = new THREE.InstancedMesh(streakGeo, this.warpMaterial, NUM_WARP_STREAKS);
    this.warpStreaksInstanced.frustumCulled = false;
    const streakRand = rng((seed ^ 0x55aa3311) >>> 0);
    for (let i = 0; i < NUM_WARP_STREAKS; i++) {
      const side = streakRand() < 0.5 ? -1 : 1;
      const x = side * (3.2 + streakRand() * 9.5);
      const y = 0.6 + streakRand() * 8.2;
      this.streakSeeds.push({
        x,
        y,
        zPhase: streakRand() * 180.0,
        lenScale: 0.7 + streakRand() * 1.1,
      });
    }
    this.scene.add(this.warpStreaksInstanced);

    // 13. 歌词
    this.rig = new LyricRig(init.palette, 'caption');
    this.scene.add(this.rig.group);
  }

  /** 查询给定时刻 t 的单调行驶距离 (O(1) 确定性插值) */
  getDistanceAt(t: number): number {
    if (t <= 0) return 0;
    const idx = Math.floor(t / this.tableDt);
    if (idx >= this.distanceTable.length - 1) {
      const extraT = t - (this.distanceTable.length - 1) * this.tableDt;
      const lastSpeed = this.speedTable[this.speedTable.length - 1] || 50;
      return this.distanceTable[this.distanceTable.length - 1] + Math.max(0, extraT) * lastSpeed;
    }
    const frac = (t - idx * this.tableDt) / this.tableDt;
    return lerp(this.distanceTable[idx], this.distanceTable[idx + 1], frac);
  }

  /** 查询给定时刻 t 的瞬时行驶速度（m/s） */
  getSpeedAt(t: number): number {
    if (t <= 0) return this.speedTable[0] || 46;
    const idx = Math.min(this.speedTable.length - 1, Math.floor(t / this.tableDt));
    const next = Math.min(this.speedTable.length - 1, idx + 1);
    const frac = clamp01((t - idx * this.tableDt) / this.tableDt);
    return lerp(this.speedTable[idx], this.speedTable[next], frac);
  }

  /** 四组电影级运镜机位（cockpit / chase / bridge / warp）纯函数姿态求值 */
  private evalCameraPose(t: number, s: Shot, kickSurge: number, isWarp: boolean, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const start = s.run?.start ?? s.start;
    const end = s.run?.end ?? s.end;
    const span = Math.max(0.8, end - start);
    const k = clamp01((t - start) / span);
    const e = inOutCubic(k);
    const dir = (stableShotSeed(s) & 1) === 0 ? 1 : -1;
    const variant = s.variant || 'cockpit';
    const roadVibY = 0.022 * Math.sin(t * 5.2) + 0.015 * Math.cos(t * 8.3);

    if (variant === 'chase') {
      const laneX = Math.sin(t * 0.55) * 2.1 * dir;
      const x = lerp(laneX - 0.9 * dir, laneX + 0.9 * dir, e);
      const y = 1.68 + 0.06 * Math.sin(t * 0.7) + roadVibY;
      const z = 3.8;
      poseLookAt(pos, quat, x, y, z, laneX * 0.45, 1.35, -62.0, -0.025 * Math.cos(t * 0.55) * dir, 1.0, 0.0);
      return BASE_FOV + 2.0 + kickSurge * 4.5;
    } else if (variant === 'bridge') {
      const x = lerp(-8.2 * dir, -5.8 * dir, e);
      const y = lerp(6.8, 4.6, e) + roadVibY;
      const z = lerp(-6.0, -16.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 3.2, -98.0);
      return BASE_FOV - 2.0 + kickSurge * 3.5;
    } else if (variant === 'warp') {
      const x = lerp(-2.2 * dir, 2.2 * dir, e);
      const y = 1.08 + 0.04 * Math.sin(t * 1.4) + roadVibY;
      const z = 1.0;
      poseLookAt(pos, quat, x, y, z, x * 0.25, 1.25, -88.0, 0.075 * dir, 1.0, 0.0);
      return BASE_FOV + 9.0 + kickSurge * 5.5;
    } else {
      const weaveX = Math.sin(t * 0.42) * 1.35 * dir;
      const x = weaveX + lerp(-0.6 * dir, 0.6 * dir, e);
      const y = 1.02 + 0.035 * Math.sin(t * 0.9) + roadVibY;
      const z = 0.0;
      poseLookAt(pos, quat, x, y, z, weaveX * 0.3, 1.18, -82.0);
      return BASE_FOV + kickSurge * 5.0 + (isWarp ? 5.0 : 0.0);
    }
  }

  /** 同场景切点纯函数相机平滑过渡 */
  private updateCamera(t: number, shot: Shot, kickSurge: number, isWarp: boolean): void {
    blendCameraPose(
      (tau, s, pos, quat) => this.evalCameraPose(tau, s, kickSurge, isWarp, pos, quat),
      t,
      shot,
      this.camera,
      1.45,
    );
  }

  /** 将专辑封面明月与月晕 100% 锁定在天球视锥正上方黄金位 */
  private anchorCelestialMoon(): void {
    const cam = this.camera;
    this.camForward.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.camUp.set(0, 1, 0).applyQuaternion(cam.quaternion);

    const halfH = MOON_DISTANCE * Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5));
    const screenRadius = cam.aspect < 1 ? MOON_SCREEN_RADIUS * cam.aspect : MOON_SCREEN_RADIUS;
    const moonRadius = screenRadius * halfH;

    this.moonMesh.position
      .copy(cam.position)
      .addScaledVector(this.camForward, MOON_DISTANCE)
      .addScaledVector(this.camUp, MOON_NDC_Y * halfH);
    this.moonMesh.scale.setScalar(moonRadius);
    this.moonMesh.quaternion.copy(cam.quaternion);

    const haloDist = MOON_DISTANCE + 2.0;
    const haloScale = haloDist / MOON_DISTANCE;
    this.moonHaloMesh.position
      .copy(cam.position)
      .addScaledVector(this.camForward, haloDist)
      .addScaledVector(this.camUp, MOON_NDC_Y * halfH * haloScale);
    this.moonHaloMesh.scale.setScalar(moonRadius * haloScale);
    this.moonHaloMesh.quaternion.copy(cam.quaternion);
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
    const isBuild = label === 'build' || label === 'pre';

    // 1. 行驶距离、瞬时速度与鼓点脉冲（100% 纯函数 f(t)）
    const distance = this.getDistanceAt(t);
    const speed = this.getSpeedAt(t);
    const kickPulse = this.evalPulse(this.kickTimes, this.kickAmps, t, 0.22);
    const snarePulse = this.evalPulse(this.snareTimes, this.snareAmps, t, 0.16);
    const warpDash = isDrop ? 1.0 : isChorus ? 0.52 : isBuild ? 0.28 : 0.0;

    // 2. 相机更新与封面明月锁定
    if (Math.abs(this.camera.aspect - ctx.aspect) > 1e-6) {
      this.camera.aspect = ctx.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.updateCamera(t, shot, kickPulse, isDrop);
    this.camera.updateMatrixWorld(true);
    this.anchorCelestialMoon();
    this.uniforms.uCamPos.value.copy(this.camera.position);

    const dummy = this.reusableDummy;

    // 3. 更新 3 组跨海斜拉桥主塔与放射钢索
    const totalTowerCycle = NUM_TOWER_SPANS * TOWER_SPAN;
    for (let k = 0; k < NUM_TOWER_SPANS; k++) {
      const raw = ((distance + k * TOWER_SPAN) % totalTowerCycle + totalTowerCycle) % totalTowerCycle;
      const zTower = -298.0 + raw;
      this.towerUnits[k].position.set(0, 0, zTower);
    }

    // 4. 刚体同步更新两侧流线型路灯杆、光学 LED 灯芯与三维锥形丁达尔体积光束（零相对位移、零缩放畸变）
    const lampForward = ((distance % STREETLIGHT_SPACING) + STREETLIGHT_SPACING) % STREETLIGHT_SPACING;
    dummy.scale.set(1, 1, 1);
    for (let i = 0; i < NUM_STREETLIGHTS; i++) {
      const zPos = 14.0 + lampForward - (i + 1) * STREETLIGHT_SPACING;

      // 左侧路灯组（绕 Y 轴旋转 180°，使鹅颈挑臂、灯具与倾斜光锥精准朝向 +X 车道内侧，且保持正向法线）
      dummy.position.set(-POLE_BASE_X, 0, zPos);
      dummy.rotation.set(0, Math.PI, 0);
      dummy.updateMatrix();
      this.streetlightsInstanced.setMatrixAt(i * 2, dummy.matrix);
      this.lampHeadsInstanced.setMatrixAt(i * 2, dummy.matrix);
      this.lampConesInstanced.setMatrixAt(i * 2, dummy.matrix);

      // 右侧路灯组（朝向 -X 车道内侧）
      dummy.position.set(POLE_BASE_X, 0, zPos);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      this.streetlightsInstanced.setMatrixAt(i * 2 + 1, dummy.matrix);
      this.lampHeadsInstanced.setMatrixAt(i * 2 + 1, dummy.matrix);
      this.lampConesInstanced.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    this.streetlightsInstanced.instanceMatrix.needsUpdate = true;
    this.lampHeadsInstanced.instanceMatrix.needsUpdate = true;
    this.lampConesInstanced.instanceMatrix.needsUpdate = true;

    // 5. 更新桥侧高频 H 型工字钢护栏立柱与嵌入式棱镜反光轮廓标（每 6m 一对沿 +Z 飞掠）
    const postForward = ((distance % GUARD_POST_SPACING) + GUARD_POST_SPACING) % GUARD_POST_SPACING;
    dummy.scale.set(1, 1, 1);
    for (let i = 0; i < NUM_GUARD_POSTS; i++) {
      const zPost = 12.0 + postForward - (i + 1) * GUARD_POST_SPACING;

      // 左侧立柱与内向反光标
      dummy.position.set(-9.94, 0, zPost);
      dummy.rotation.set(0, Math.PI, 0);
      dummy.updateMatrix();
      this.guardPostsInstanced.setMatrixAt(i * 2, dummy.matrix);
      this.guardReflectorsInstanced.setMatrixAt(i * 2, dummy.matrix);

      // 右侧立柱与内向反光标
      dummy.position.set(9.94, 0, zPost);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      this.guardPostsInstanced.setMatrixAt(i * 2 + 1, dummy.matrix);
      this.guardReflectorsInstanced.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    this.guardPostsInstanced.instanceMatrix.needsUpdate = true;
    this.guardReflectorsInstanced.instanceMatrix.needsUpdate = true;
    this.guardReflectorMaterial.opacity = 0.72 + 0.28 * kickPulse;

    // 6. 更新桥面多车道被高速追越的前车尾灯流光残影
    const trafficCycle = 240.0;
    const streakLen = 6.5 + 14.0 * warpDash + 9.0 * kickPulse;
    for (let c = 0; c < NUM_TRAFFIC_CARS; c++) {
      const seed = this.trafficSeeds[c];
      const relTravel = distance * seed.relSpeed + seed.zPhase;
      const zCar = -222.0 + ((relTravel % trafficCycle) + trafficCycle) % trafficCycle;
      const swayX = seed.laneX + 0.18 * Math.sin(t * 0.9 + c * 1.7);
      const yTail = 0.72;
      const base = c * 12;
      this.tailPositions[base + 0] = swayX - seed.width;
      this.tailPositions[base + 1] = yTail;
      this.tailPositions[base + 2] = zCar;
      this.tailPositions[base + 3] = swayX - seed.width;
      this.tailPositions[base + 4] = yTail;
      this.tailPositions[base + 5] = zCar - streakLen;

      this.tailPositions[base + 6] = swayX + seed.width;
      this.tailPositions[base + 7] = yTail;
      this.tailPositions[base + 8] = zCar;
      this.tailPositions[base + 9] = swayX + seed.width;
      this.tailPositions[base + 10] = yTail;
      this.tailPositions[base + 11] = zCar - streakLen;
    }
    (this.tailLightsMesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // 自车前照大灯铺路柔光同步跟随相机 X/Z 坐标
    this.underglowMesh.position.set(this.camera.position.x * 0.85, 0.03, this.camera.position.z - 14.5);

    // 7. 更新高速氮气流光拉丝
    const warpCycle = 180.0;
    const streakStretch = isDrop ? 2.4 + 0.8 * kickPulse : isChorus ? 1.45 : 0.85;
    dummy.rotation.set(0, 0, 0);
    for (let i = 0; i < NUM_WARP_STREAKS; i++) {
      const st = this.streakSeeds[i];
      const travelZ = distance * 1.45 + st.zPhase;
      const zStreak = -166.0 + ((travelZ % warpCycle) + warpCycle) % warpCycle;
      dummy.position.set(st.x, st.y, zStreak);
      dummy.scale.set(1.0, 1.0, st.lenScale * streakStretch);
      dummy.updateMatrix();
      this.warpStreaksInstanced.setMatrixAt(i, dummy.matrix);
    }
    this.warpStreaksInstanced.instanceMatrix.needsUpdate = true;
    this.warpMaterial.opacity = isDrop ? 0.68 : isChorus ? 0.34 : isBuild ? 0.18 : 0.08;

    // 8. 全局着色器 Uniforms
    this.uniforms.uTime.value = t;
    this.uniforms.uDistance.value = distance;
    this.uniforms.uSpeed.value = speed;
    this.uniforms.uKickSurge.value = kickPulse;
    this.uniforms.uSnareFlash.value = snarePulse;
    this.uniforms.uWarpDash.value = warpDash;

    // 9. 后期与物理推进速度参数
    fx.travel = speed * 0.35;
    fx.bloom = 0.34 + 0.16 * warpDash + 0.08 * kickPulse;
    fx.vignette = 0.44;
    fx.letterbox = 0;

    // 10. 歌词
    const energy = isDrop ? 1.0 : isChorus ? 0.85 : 0.52;
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
