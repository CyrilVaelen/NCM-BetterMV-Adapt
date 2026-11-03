// 同场景连续切镜（相邻镜头共享同一 MvScene 实例）的纯函数相机与视角参数平滑工具。
// 所有函数均为 (t, shot) 的确定性纯函数，不依赖上一帧可变历史状态，保证进度条任意跳转（seek）、
// 转场首帧冻结与离线逐帧导出 MP4 严格一致且无视角瞬移。
import * as THREE from 'three';
import type { Shot } from './types.ts';
import { clamp01, inOutCubic, lerp } from './types.ts';

const _posA = new THREE.Vector3();
const _posB = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _cPosA = new THREE.Vector3();
const _cPosB = new THREE.Vector3();
const _cQuatA = new THREE.Quaternion();
const _cQuatB = new THREE.Quaternion();
const _fwdA = new THREE.Vector3();
const _fwdB = new THREE.Vector3();
const _helperCam = new THREE.PerspectiveCamera();
const _defaultFovs = new WeakMap<THREE.PerspectiveCamera, number>();

/**
 * 使用与 Three.js Camera.lookAt 完全一致的局部坐标系约定，计算相机在 (ex, ey, ez) 注视 (tx, ty, tz) 时的位置与朝向四元数。
 */
export function poseLookAt(
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  ex: number,
  ey: number,
  ez: number,
  tx: number,
  ty: number,
  tz: number,
  upX = 0,
  upY = 1,
  upZ = 0,
): void {
  _helperCam.up.set(upX, upY, upZ).normalize();
  _helperCam.position.set(ex, ey, ez);
  _helperCam.lookAt(tx, ty, tz);
  pos.copy(_helperCam.position);
  quat.copy(_helperCam.quaternion);
}

/** 获取镜头稳定随机种子（加速段 Shot.run 内统一使用首镜种子，避免每拍翻转运镜方向或相位）。 */
export function stableShotSeed(shot: Shot): number {
  return shot.run?.seed ?? shot.seed;
}

/** 获取连续同场景镜头链首镜的稳定种子，用于同场景连切时保持结构形态或全局旋向不突变。 */
export function firstSameSeed(shot: Shot): number {
  let cur: Shot = shot;
  while (cur.prevSame) cur = cur.prevSame;
  return stableShotSeed(cur);
}

/** 获取连续同场景镜头链首镜的起始时刻（首次切入该场景的起点）。 */
export function firstSameStart(shot: Shot): number {
  let cur: Shot = shot;
  while (cur.prevSame) cur = cur.prevSame;
  return cur.run?.start ?? cur.start;
}

/**
 * 计算当前时刻 t 在同场景切点后的平滑过渡权重。
 * 若不存在紧邻前序同场景镜头，或已度过切点平滑窗口，则返回 null。
 * 过渡窗口严格不超过前后镜头各自实际时长的 45%，确保前序镜头自身的过渡在当前切点前早已收敛为 1，无需递归求值。
 */
export function sameSceneBlend(t: number, shot: Shot, maxDur = 1.4): { prev: Shot; w: number } | null {
  const prev = shot.prevSame;
  if (!prev) return null;
  const cutStart = shot.cutStart ?? shot.start;
  const cutEnd = shot.cutEnd ?? shot.end;
  const since = t - cutStart;
  if (since < 0) return { prev, w: 0 };
  const prevStart = prev.cutStart ?? prev.start;
  const prevEnd = prev.cutEnd ?? prev.end;
  const dur = Math.min(
    maxDur,
    Math.max(0.12, (cutEnd - cutStart) * 0.45),
    Math.max(0.12, (prevEnd - prevStart) * 0.45),
  );
  if (!(dur > 1e-4) || since >= dur) return null;
  return { prev, w: inOutCubic(clamp01(since / dur)) };
}

/**
 * 对透视相机的三维位置、朝向四元数与视场角（FOV）执行跨同场景切点的纯函数平滑混合。
 * `evalPose` 根据给定 `(t, s)` 将目标位置与朝向写入 `(pos, quat)`，并可选返回该机位的目标 FOV。
 * 当切点两侧机位空间跨度超过 `maxDist` 时跳过插值（交由导演层黑场呼吸处理，防止高速穿模）。
 * 返回混合进度 `w`（0..1，未处于过渡期时返回 1）。
 */
export function blendCameraPose(
  evalPose: (t: number, s: Shot, pos: THREE.Vector3, quat: THREE.Quaternion) => number | void,
  t: number,
  shot: Shot,
  camera: THREE.PerspectiveCamera,
  maxDur = 1.4,
  maxDist = Infinity,
): number {
  let defaultFov = _defaultFovs.get(camera);
  if (defaultFov === undefined) {
    defaultFov = camera.fov;
    _defaultFovs.set(camera, defaultFov);
  }
  const fovB = evalPose(t, shot, _posB, _quatB) ?? defaultFov;
  const blend = sameSceneBlend(t, shot, maxDur);
  let finalFov = fovB;
  let weight = 1;

  if (blend) {
    const fovA = evalPose(t, blend.prev, _posA, _quatA) ?? defaultFov;
    if (_posA.distanceTo(_posB) <= maxDist) {
      weight = blend.w;
      camera.position.lerpVectors(_posA, _posB, weight);
      // 确保四元数走最短球面弧插值，避免 ±q 双覆盖引起相机翻滚一圈
      if (_quatA.dot(_quatB) < 0) {
        _quatA.set(-_quatA.x, -_quatA.y, -_quatA.z, -_quatA.w);
      }
      camera.quaternion.slerpQuaternions(_quatA, _quatB, weight);
      finalFov = lerp(fovA, fovB, weight);
    } else {
      camera.position.copy(_posB);
      camera.quaternion.copy(_quatB);
    }
  } else {
    camera.position.copy(_posB);
    camera.quaternion.copy(_quatB);
  }

  if (camera.fov !== finalFov) {
    camera.fov = finalFov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
  return weight;
}

/**
 * 沿同场景 `prevSame` 链回溯覆盖指定时刻 `time` 的同场景镜头，
 * 供世界空间 3D 歌词台（Stands）在跨同场景切点时以歌词实际出场时刻的机位稳定求解锚点。
 */
export function shotInSameChain(shot: Shot, time: number): Shot {
  let cur: Shot = shot;
  while (cur.prevSame) {
    const cs = cur.cutStart ?? cur.start;
    if (time < cs - 1e-4) cur = cur.prevSame;
    else break;
  }
  return cur;
}

/**
 * 为跨越同场景切点仍在演唱的世界空间 3D 歌词行寻找稳定的锚定镜头起始时刻（`Stands.get` 的 `shotStart` 键）。
 * 若 `canBridge(prev, next)` 返回 false（例如大跨度城市切镜），则在切点处停止回溯以重建新歌词台。
 */
export function lineAnchorShotStart(
  shot: Shot,
  appearTime: number,
  canBridge?: (prev: Shot, curr: Shot) => boolean,
): number {
  let cur: Shot = shot;
  while (cur.prevSame) {
    const cs = cur.cutStart ?? cur.start;
    if (appearTime < cs - 1e-4) {
      if (canBridge && !canBridge(cur.prevSame, cur)) break;
      cur = cur.prevSame;
    } else {
      break;
    }
  }
  return cur.cutStart ?? cur.start;
}

/**
 * 沿同场景 `prevSame` 链求值任意时刻 `time` 处的平滑相机姿态（供世界空间 3D 歌词台 `Stands` / `PoseFn` 使用）。
 * 自动定位覆盖 `time` 的所属同场景镜头并叠加与主相机一致的切点平滑插值。
 */
export function evalChainPose(
  evalPose: (t: number, s: Shot, pos: THREE.Vector3, quat: THREE.Quaternion) => number | void,
  time: number,
  shot: Shot,
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  maxDur = 1.4,
  maxDist = Infinity,
): void {
  const owner = shotInSameChain(shot, time);
  evalPose(time, owner, _cPosB, _cQuatB);
  const blend = sameSceneBlend(time, owner, maxDur);
  if (blend) {
    evalPose(time, blend.prev, _cPosA, _cQuatA);
    if (_cPosA.distanceTo(_cPosB) <= maxDist) {
      pos.lerpVectors(_cPosA, _cPosB, blend.w);
      if (_cQuatA.dot(_cQuatB) < 0) {
        _cQuatA.set(-_cQuatA.x, -_cQuatA.y, -_cQuatA.z, -_cQuatA.w);
      }
      quat.slerpQuaternions(_cQuatA, _cQuatB, blend.w);
      return;
    }
  }
  pos.copy(_cPosB);
  quat.copy(_cQuatB);
}

/**
 * 为世界空间 3D 歌词台（`Stands.get`）计算稳定的锚定镜头起始时间键 `shotStart`：
 * 当切点两侧机位空间距离不超过 `maxDist` 且前向视线夹角余弦 `>= minCos`（默认 0.45，约 63° 内）时，
 * 跨越切点正在演唱的歌词保持原世界锚点不瞬移；当发生远距跳切或大角度掉头回望时，自动切换至新机位视野内。
 */
export function standShotStart(
  evalPose: (t: number, s: Shot, pos: THREE.Vector3, quat: THREE.Quaternion) => number | void,
  shot: Shot,
  appearTime: number,
  maxDist = Infinity,
  minCos = 0.45,
): number {
  return lineAnchorShotStart(shot, appearTime, (prev, curr) => {
    const cs = curr.cutStart ?? curr.start;
    evalPose(cs, prev, _cPosA, _cQuatA);
    evalPose(cs, curr, _cPosB, _cQuatB);
    if (_cPosA.distanceTo(_cPosB) > maxDist) return false;
    _fwdA.set(0, 0, -1).applyQuaternion(_cQuatA);
    _fwdB.set(0, 0, -1).applyQuaternion(_cQuatB);
    return _fwdA.dot(_fwdB) >= minCos;
  });
}
