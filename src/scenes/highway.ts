// 午夜高架 (Highway): 第一人称极速跨海大桥与复古未来流光。
// 适配曲风：Synthwave, House, City Pop, Phonk, Drum & Bass (DnB)。
// 100% 确定性纯时间函数 f(t) 驱动，零累积状态，支持任意 seek 与离线 MP4 导出。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex } from '../director/music.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl, tuneCoverStop } from './coverTone.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';

const STREETLIGHT_SPACING = 18.0;
const NUM_STREETLIGHTS = 18;
const NUM_WARP_STREAKS = 48;
const BASE_FOV = 54;

export class HighwayScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.1, 450);
  private rig: LyricRig;

  // 确定性距离积分表（0.1s 采样步长，确保单调递增且任意 seek 严格一致）
  private distanceTable: Float64Array;
  private tableDt = 0.1;
  private duration: number;

  // 预烘焙音频事件
  private kickTimes: Float64Array;
  private kickAmps: Float32Array;
  private snareTimes: Float64Array;
  private downbeatTimes: Float64Array;

  // 网格与材质
  private sunsetMesh: THREE.Mesh;
  private sunsetMaterial: THREE.ShaderMaterial;
  private roadMesh: THREE.Mesh;
  private roadMaterial: THREE.ShaderMaterial;
  private oceanMesh: THREE.Mesh;
  private oceanMaterial: THREE.ShaderMaterial;
  private bridgeTowersGroup = new THREE.Group();
  private streetlightsInstanced: THREE.InstancedMesh;
  private tailLightsMesh: THREE.LineSegments;
  private warpStreaksInstanced: THREE.InstancedMesh;
  private warpMaterial: THREE.MeshBasicMaterial;
  private underglowMesh: THREE.Mesh;

  // 色彩（遵循 R5 规则）
  private colorMain: THREE.Color;
  private colorDeep: THREE.Color;
  private colorBright: THREE.Color;
  private colorAccent: THREE.Color;

  private uniforms: {
    uTime: { value: number };
    uCover: { value: THREE.Texture };
    uDistance: { value: number };
    uSpeed: { value: number };
    uKickSurge: { value: number };
    uWarpDash: { value: number };
    uMainColor: { value: THREE.Color };
    uAccentColor: { value: THREE.Color };
  };

  constructor(private init: SceneInit, _look?: string) {
    this.scene.fog = new THREE.FogExp2(0x050711, 0.007);

    // 1. 色彩提取与微调
    const tone = extractCoverTone(init);
    const seed = init.seed ?? 1001;
    const seedRand = rng((seed ^ 0xabcdef01) >>> 0);
    const deltaHue = (seedRand() < 0.5 ? -1 : 1) * (6 + 10 * seedRand());

    const stopMain = tuneCoverStop(tone.mid, tone, 0.45, 0.75, 0.40, 0.95, deltaHue);
    const stopDeep = tuneCoverStop(tone.dark, tone, 0.06, 0.22, 0.25, 0.70, deltaHue);
    const stopBright = tuneCoverStop(tone.highlight, tone, 0.75, 0.98, 0.45, 0.95, deltaHue);
    const stopAccent = tuneCoverStop(tone.bright, tone, 0.55, 0.88, 0.50, 0.95, deltaHue);

    this.colorMain = colorFromHsl(stopMain.h, stopMain.s, stopMain.l);
    this.colorDeep = colorFromHsl(stopDeep.h, stopDeep.s, stopDeep.l);
    this.colorBright = colorFromHsl(stopBright.h, stopBright.s, stopBright.l);
    this.colorAccent = colorFromHsl(stopAccent.h, stopAccent.s, stopAccent.l);

    // 2. 预烘焙音频事件
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

    // 3. 构建全曲平滑单调距离积分表 (Deterministic Travel Distance)
    this.duration = Math.max(10, music.duration);
    const tableLen = Math.ceil(this.duration / this.tableDt) + 2;
    this.distanceTable = new Float64Array(tableLen);
    let accumDist = 0;
    for (let i = 0; i < tableLen; i++) {
      const sampleT = i * this.tableDt;
      const sec = music.section(sampleT);
      const isDrop = sec?.label === 'drop';
      const isChorus = sec?.label === 'chorus';
      const secEnergy = sec?.energy ?? 0.5;
      const baseVel = 38.0 + 24.0 * secEnergy + (isDrop ? 36.0 : isChorus ? 18.0 : 0.0);
      accumDist += baseVel * this.tableDt;
      this.distanceTable[i] = accumDist;
    }

    // 4. Uniforms
    this.uniforms = {
      uTime: { value: 0 },
      uCover: { value: init.cover },
      uDistance: { value: 0 },
      uSpeed: { value: 45 },
      uKickSurge: { value: 0 },
      uWarpDash: { value: 0 },
      uMainColor: { value: this.colorMain },
      uAccentColor: { value: this.colorAccent },
    };

    // 5. 远景全息封面落日 (Holographic Sunset Cover at Z = -180m, Y = 14m)
    const sunsetRadius = 28.0;
    const sunsetGeo = new THREE.CircleGeometry(sunsetRadius, 64);
    this.sunsetMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCover: this.uniforms.uCover,
        uTime: this.uniforms.uTime,
        uKickSurge: this.uniforms.uKickSurge,
        uWarpDash: this.uniforms.uWarpDash,
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
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
        uniform float uKickSurge;
        uniform float uWarpDash;
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        varying vec2 vUv;

        void main() {
          // 封面色彩（严格保持原封面色彩空间拓扑）
          vec4 coverCol = texture2D(uCover, vUv);

          // 复古未来全息 CRT 水平扫描线
          float scanline = sin(vUv.y * 360.0 + uTime * 6.0) * 0.12;
          float vignette = smoothstep(1.0, 0.45, length(vUv - vec2(0.5)) * 2.0);

          // 边缘色散与霓虹外光晕
          vec3 tinted = mix(coverCol.rgb, uAccentColor, 0.22);
          vec3 finalRgb = (tinted + scanline) * (1.1 + 0.4 * uKickSurge + 0.8 * uWarpDash);

          gl_FragColor = vec4(finalRgb, vignette);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.sunsetMesh = new THREE.Mesh(sunsetGeo, this.sunsetMaterial);
    this.sunsetMesh.position.set(0, 14, -180);
    this.scene.add(this.sunsetMesh);

    // 6. 桥面多车道公路 (Highway Road Deck with Wet Reflections)
    const roadWidth = 20.0;
    const roadLength = 260.0;
    const roadGeo = new THREE.PlaneGeometry(roadWidth, roadLength, 32, 128);
    this.roadMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCover: this.uniforms.uCover,
        uDistance: this.uniforms.uDistance,
        uKickSurge: this.uniforms.uKickSurge,
        uWarpDash: this.uniforms.uWarpDash,
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
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
        uniform float uWarpDash;
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          // 纯时间函数驱动车道纹理推进
          float zOffset = vWorldPos.z - uDistance;
          float xPos = vWorldPos.x;

          // 车道标线（中间虚线，两侧实线）
          float centerLine = smoothstep(0.18, 0.08, abs(xPos)) * step(0.4, fract(zOffset * 0.12));
          float laneLeft = smoothstep(0.14, 0.06, abs(xPos - 5.0)) * step(0.55, fract(zOffset * 0.12));
          float laneRight = smoothstep(0.14, 0.06, abs(xPos + 5.0)) * step(0.55, fract(zOffset * 0.12));
          float sideLines = smoothstep(0.22, 0.08, abs(abs(xPos) - 9.2));

          float lines = max(centerLine, max(laneLeft, max(laneRight, sideLines)));

          // 雨后湿润水洼与粗糙度高光
          float puddle = sin(xPos * 0.45) * cos(zOffset * 0.06);
          float wetness = clamp(0.45 + 0.45 * puddle, 0.0, 1.0);

          // 远方全息封面落日长条拉丝倒影
          float sunsetRefl = exp(-abs(xPos) * 0.18) * wetness;
          vec2 coverUv = vec2(clamp(0.5 + xPos / 24.0, 0.0, 1.0), 0.35);
          vec3 sunsetCol = texture2D(uCover, coverUv).rgb;

          // 基础沥青色 + 标线 + 倒影高光
          vec3 asphalt = vec3(0.02, 0.025, 0.035);
          vec3 lineCol = vec3(0.95, 0.92, 0.82) * lines * (1.2 + 0.6 * uKickSurge);
          vec3 reflCol = mix(sunsetCol, uAccentColor, 0.3) * sunsetRefl * (1.2 + 1.5 * uWarpDash);

          vec3 finalRgb = asphalt + lineCol + reflCol;
          gl_FragColor = vec4(finalRgb, 1.0);
        }
      `,
    });
    this.roadMesh = new THREE.Mesh(roadGeo, this.roadMaterial);
    this.roadMesh.rotation.x = -Math.PI / 2;
    this.roadMesh.position.set(0, 0, -90);
    this.scene.add(this.roadMesh);

    // 7. 辽阔大洋水面 (Ocean Water beneath Bridge at Y = -6m)
    const oceanGeo = new THREE.PlaneGeometry(350, 400, 32, 32);
    this.oceanMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCover: this.uniforms.uCover,
        uAccentColor: this.uniforms.uAccentColor,
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
        uniform vec3 uAccentColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          float wave = sin(vWorldPos.x * 0.08 + uTime * 1.5) * cos(vWorldPos.z * 0.05 + uTime * 1.2);
          float sunsetStripe = exp(-abs(vWorldPos.x) * 0.035);
          vec3 baseOcean = vec3(0.01, 0.018, 0.03);
          vec3 refl = uAccentColor * sunsetStripe * 0.65;
          gl_FragColor = vec4(baseOcean + refl * (0.8 + 0.2 * wave), 1.0);
        }
      `,
    });
    this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMaterial);
    this.oceanMesh.rotation.x = -Math.PI / 2;
    this.oceanMesh.position.set(0, -6.0, -140);
    this.scene.add(this.oceanMesh);

    // 8. 跨海斜拉桥双塔与放射钢索 (Cable-Stayed Bridge Towers & Cables)
    const towerZPositions = [-60, -140];
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x1b202c,
      roughness: 0.65,
      metalness: 0.45,
    });
    const neonTowerEdgeMat = new THREE.LineBasicMaterial({
      color: this.colorAccent,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });

    for (const tz of towerZPositions) {
      // A 型主塔
      const towerPillarGeo = new THREE.CylinderGeometry(0.85, 1.2, 52, 8);
      const leftPillar = new THREE.Mesh(towerPillarGeo, towerMat);
      leftPillar.position.set(-9.5, 20, tz);
      leftPillar.rotation.z = -0.14;
      this.bridgeTowersGroup.add(leftPillar);

      const rightPillar = new THREE.Mesh(towerPillarGeo, towerMat);
      rightPillar.position.set(9.5, 20, tz);
      rightPillar.rotation.z = 0.14;
      this.bridgeTowersGroup.add(rightPillar);

      // 横梁
      const beamGeo = new THREE.BoxGeometry(18, 1.2, 1.6);
      const beam = new THREE.Mesh(beamGeo, towerMat);
      beam.position.set(0, 36, tz);
      this.bridgeTowersGroup.add(beam);

      // 放射状斜拉钢索
      const cablePositions: number[] = [];
      const numCables = 14;
      for (let c = 0; c < numCables; c++) {
        const u = c / (numCables - 1);
        const bridgeZ = tz - 35.0 + u * 70.0;
        const towerTopY = 38.0 + u * 4.0;
        // 左索
        cablePositions.push(-1.2, towerTopY, tz, -9.8, 0.5, bridgeZ);
        // 右索
        cablePositions.push(1.2, towerTopY, tz, 9.8, 0.5, bridgeZ);
      }
      const cableGeo = new THREE.BufferGeometry();
      cableGeo.setAttribute('position', new THREE.Float32BufferAttribute(cablePositions, 3));
      const cableLines = new THREE.LineSegments(cableGeo, neonTowerEdgeMat);
      this.bridgeTowersGroup.add(cableLines);
    }
    this.scene.add(this.bridgeTowersGroup);

    // 9. 呼啸掠过的流线型路灯 (Rhythmically Whizzing Streetlights)
    const streetlightGeo = new THREE.CylinderGeometry(0.12, 0.18, 7.5, 8);
    const streetlightMat = new THREE.MeshStandardMaterial({
      color: 0x303648,
      roughness: 0.5,
      metalness: 0.6,
    });
    this.streetlightsInstanced = new THREE.InstancedMesh(streetlightGeo, streetlightMat, NUM_STREETLIGHTS * 2);
    this.scene.add(this.streetlightsInstanced);

    // 10. 前车尾灯流光残影与车辆 Underglow
    const tailLinesGeo = new THREE.BufferGeometry();
    const tailPositions = new Float32Array([
      // 左尾灯拉丝
      -1.25, 0.85, -8.0, -1.25, 0.85, -28.0,
      // 右尾灯拉丝
      1.25, 0.85, -8.0, 1.25, 0.85, -28.0,
    ]);
    tailLinesGeo.setAttribute('position', new THREE.BufferAttribute(tailPositions, 3));
    const tailMat = new THREE.LineBasicMaterial({
      color: 0xff1844,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    this.tailLightsMesh = new THREE.LineSegments(tailLinesGeo, tailMat);
    this.scene.add(this.tailLightsMesh);

    // 底盘霓虹光晕 (Underglow)
    const underglowGeo = new THREE.PlaneGeometry(3.6, 5.5);
    const underglowMat = new THREE.MeshBasicMaterial({
      color: this.colorAccent,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    this.underglowMesh = new THREE.Mesh(underglowGeo, underglowMat);
    this.underglowMesh.rotation.x = -Math.PI / 2;
    this.underglowMesh.position.set(0, 0.15, -12.0);
    this.scene.add(this.underglowMesh);

    // 11. Drop/Warp 高速氮气流光拉丝 (Nitro Warp Dash Streaks)
    const streakGeo = new THREE.CylinderGeometry(0.04, 0.04, 8.0, 4);
    streakGeo.rotateX(Math.PI * 0.5);
    this.warpMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
    });
    this.warpStreaksInstanced = new THREE.InstancedMesh(streakGeo, this.warpMaterial, NUM_WARP_STREAKS);
    const streakRand = rng((seed ^ 0x55aa3311) >>> 0);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < NUM_WARP_STREAKS; i++) {
      dummy.position.set(
        (streakRand() - 0.5) * 22.0,
        0.5 + streakRand() * 6.5,
        -10.0 - streakRand() * 90.0,
      );
      dummy.updateMatrix();
      this.warpStreaksInstanced.setMatrixAt(i, dummy.matrix);
    }
    this.warpStreaksInstanced.instanceMatrix.needsUpdate = true;
    this.scene.add(this.warpStreaksInstanced);

    // 12. 歌词
    this.rig = new LyricRig(init.palette, 'caption');
    this.scene.add(this.rig.group);
  }

  /** 查询给定时刻 t 的单调行驶距离 (O(1) 确定性插值) */
  private getDistanceAt(t: number): number {
    const idx = Math.floor(t / this.tableDt);
    if (idx < 0) return 0;
    if (idx >= this.distanceTable.length - 1) return this.distanceTable[this.distanceTable.length - 1];
    const frac = (t - idx * this.tableDt) / this.tableDt;
    return lerp(this.distanceTable[idx], this.distanceTable[idx + 1], frac);
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

    if (variant === 'chase') {
      // 低角度车尾追焦视角，伴随轻微平滑变道漂移
      const laneX = Math.sin(t * 0.45) * 1.6 * dir;
      const x = lerp(laneX - 0.8 * dir, laneX + 0.8 * dir, e);
      const y = 1.95 + 0.08 * Math.sin(t * 0.6);
      const z = 4.2;
      poseLookAt(pos, quat, x, y, z, laneX * 0.5, 1.4, -45.0);
      return BASE_FOV + kickSurge * 5.0;
    } else if (variant === 'bridge') {
      // 宏大桥塔高空斜侧俯掠视角
      const x = lerp(-10.5 * dir, -7.5 * dir, e);
      const y = lerp(9.5, 7.0, e);
      const z = lerp(-14.0, -32.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 3.5, -95.0);
      return BASE_FOV - 4.0;
    } else if (variant === 'warp') {
      // 氮气极速飞驰荷兰角冲刺视角
      const x = lerp(-1.8 * dir, 1.8 * dir, e);
      const y = 1.35 + 0.05 * Math.sin(t * 1.2);
      const z = 1.2;
      // 轻微横滚角
      poseLookAt(pos, quat, x, y, z, 0, 1.3, -80.0, 0.08 * dir, 1.0, 0.0);
      return BASE_FOV + 8.0 + kickSurge * 6.0;
    } else {
      // cockpit: 第一人称贴地兜风主景（默认）
      const x = lerp(-0.5 * dir, 0.5 * dir, e);
      const y = 1.15 + 0.04 * Math.sin(t * 0.8);
      const z = 0.0;
      poseLookAt(pos, quat, x, y, z, 0, 1.2, -75.0);
      return BASE_FOV + kickSurge * 5.5 + (isWarp ? 4.0 : 0.0);
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

    // 1. 距离与速度计算
    const distance = this.getDistanceAt(t);
    const kickPulse = this.evalPulse(this.kickTimes, this.kickAmps, t, 0.22);
    const warpDash = isDrop ? 1.0 : isChorus ? 0.45 : 0.0;

    // 2. 相机更新
    this.updateCamera(t, shot, kickPulse, isDrop);

    // 3. 更新两侧循环呼啸路灯实例
    const dummy = new THREE.Object3D();
    const cycleLen = NUM_STREETLIGHTS * STREETLIGHT_SPACING;
    const baseZOffset = -(distance % STREETLIGHT_SPACING);

    for (let i = 0; i < NUM_STREETLIGHTS; i++) {
      const zPos = baseZOffset - i * STREETLIGHT_SPACING;
      // 左侧路灯
      dummy.position.set(-10.2, 3.75, zPos);
      dummy.updateMatrix();
      this.streetlightsInstanced.setMatrixAt(i * 2, dummy.matrix);
      // 右侧路灯
      dummy.position.set(10.2, 3.75, zPos);
      dummy.updateMatrix();
      this.streetlightsInstanced.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    this.streetlightsInstanced.instanceMatrix.needsUpdate = true;

    // 4. 更新尾灯残影与 Underglow
    this.underglowMesh.position.x = Math.sin(t * 0.45) * 1.2;
    this.tailLightsMesh.position.x = this.underglowMesh.position.x;

    // 5. 更新 Warp 氮气拉丝可见度与流动
    this.warpMaterial.opacity = isDrop ? 0.75 : isChorus ? 0.35 : 0.0;

    // 6. 全局着色器 Uniforms
    this.uniforms.uTime.value = t;
    this.uniforms.uDistance.value = distance;
    this.uniforms.uKickSurge.value = kickPulse;
    this.uniforms.uWarpDash.value = warpDash;

    // 7. 后期调优
    fx.bloom = 0.34 + 0.18 * warpDash + 0.08 * kickPulse;
    fx.vignette = 0.44;
    fx.letterbox = 0;

    // 8. 歌词
    const energy = isDrop ? 1.0 : isChorus ? 0.85 : 0.50;
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
