// 千灯天阙 (Pavilion): 3D 国风与国潮电音大场面。
// 适配曲风：国风电音 (Guofeng EDM), 大气古风 (Epic Traditional), 戏腔燃曲 (Opera Electronic)。
// 100% 确定性纯时间函数 f(t) 驱动，零累积状态，支持任意 seek 与离线 MP4 导出。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex } from '../director/music.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl, tuneCoverStop } from './coverTone.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';

const NUM_STRINGS = 7;
const NUM_KOI = 10;
const NUM_FIREFLIES = 160;
const CAM_FOV = 46;

interface KoiState {
  speed: number;
  phase: number;
  radiusX: number;
  radiusZ: number;
  yBase: number;
}

export class PavilionScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.1, 350);
  private rig: LyricRig;

  // 预烘焙音频事件
  private kickTimes: Float64Array;
  private kickAmps: Float32Array;
  private snareTimes: Float64Array;
  private downbeatTimes: Float64Array;
  private chromaBuf = new Float32Array(12);

  // 场景核心组件
  private pavilionGroup = new THREE.Group();
  private silkPoolMesh: THREE.Mesh;
  private silkPoolMaterial: THREE.ShaderMaterial;
  private stringsLines: THREE.Line[];
  private koiInstanced: THREE.InstancedMesh;
  private koiStates: KoiState[] = [];
  private firefliesPoints: THREE.Points;
  private fireflyBasePos: Float32Array;
  private lightPillarMesh: THREE.Mesh;
  private lightPillarMaterial: THREE.ShaderMaterial;
  private cloudsFloorMesh: THREE.Mesh;

  // 色彩基调（遵循 R5 规则）
  private colorGold: THREE.Color;
  private colorMain: THREE.Color;
  private colorDeep: THREE.Color;
  private colorJade: THREE.Color;

  private uniforms: {
    uTime: { value: number };
    uCover: { value: THREE.Texture };
    uMelodyGlow: { value: number };
    uDropIgnite: { value: number };
    uFireflyAscent: { value: number };
    uGoldColor: { value: THREE.Color };
    uMainColor: { value: THREE.Color };
  };

  constructor(private init: SceneInit, _look?: string) {
    this.scene.fog = new THREE.FogExp2(0x060710, 0.010);

    // 1. 色彩提取与微调（遵循 R5 同色系微调规则）
    const tone = extractCoverTone(init);
    const seed = init.seed ?? 1001;
    const seedRand = rng((seed ^ 0x77aa88ff) >>> 0);
    const deltaHue = (seedRand() < 0.5 ? -1 : 1) * (6 + 10 * seedRand());

    const stopMain = tuneCoverStop(tone.mid, tone, 0.45, 0.75, 0.40, 0.90, deltaHue);
    const stopDeep = tuneCoverStop(tone.dark, tone, 0.06, 0.20, 0.20, 0.60, deltaHue);
    const stopGold = tuneCoverStop(tone.highlight, tone, 0.65, 0.95, 0.60, 0.98, deltaHue);
    const stopJade = tuneCoverStop(tone.bright, tone, 0.50, 0.85, 0.45, 0.90, deltaHue + 12.0);

    this.colorMain = colorFromHsl(stopMain.h, stopMain.s, stopMain.l);
    this.colorDeep = colorFromHsl(stopDeep.h, stopDeep.s, stopDeep.l);
    this.colorGold = colorFromHsl(stopGold.h, stopGold.s, stopGold.l);
    this.colorJade = colorFromHsl(stopJade.h, stopJade.s, stopJade.l);

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

    // 3. 着色器 Uniforms
    this.uniforms = {
      uTime: { value: 0 },
      uCover: { value: init.cover },
      uMelodyGlow: { value: 0 },
      uDropIgnite: { value: 0 },
      uFireflyAscent: { value: 0 },
      uGoldColor: { value: this.colorGold },
      uMainColor: { value: this.colorMain },
    };

    // 4. 云海基底 (Cloud Sea Floor at Y = -4.5m)
    const cloudsGeo = new THREE.PlaneGeometry(300, 300, 32, 32);
    const cloudsMat = new THREE.MeshBasicMaterial({
      color: 0x0c121e,
      transparent: true,
      opacity: 0.85,
    });
    this.cloudsFloorMesh = new THREE.Mesh(cloudsGeo, cloudsMat);
    this.cloudsFloorMesh.rotation.x = -Math.PI / 2;
    this.cloudsFloorMesh.position.set(0, -4.5, -35);
    this.scene.add(this.cloudsFloorMesh);

    // 5. 圆形天池水面平铺丝绸画卷封面 (Silk Scroll in Circular Sky Pool at Y = 0, Z = -32m)
    const poolRadius = 13.5;
    const poolGeo = new THREE.CircleGeometry(poolRadius, 64);
    this.silkPoolMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCover: this.uniforms.uCover,
        uTime: this.uniforms.uTime,
        uMelodyGlow: this.uniforms.uMelodyGlow,
        uDropIgnite: this.uniforms.uDropIgnite,
        uGoldColor: this.uniforms.uGoldColor,
        uMainColor: this.uniforms.uMainColor,
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
        uniform float uMelodyGlow;
        uniform float uDropIgnite;
        uniform vec3 uGoldColor;
        uniform vec3 uMainColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          vec2 center = vec2(0.5, 0.5);
          float r = length(vUv - center) * 2.0;

          // 水面微折射波纹
          float wave = sin(r * 22.0 - uTime * 4.0) * 0.008;
          vec2 warpedUv = vUv + vec2(wave);

          // 保持专辑封面原始空间拓扑与色块连贯
          vec4 coverColor = texture2D(uCover, clamp(warpedUv, 0.0, 1.0));

          // 丝绸画卷经纬光泽
          float silkGrain = 0.94 + 0.06 * sin(vWorldPos.x * 120.0) * cos(vWorldPos.z * 120.0);

          // 圆形汉白玉与鎏金天池边缘
          float edgeRing = smoothstep(0.98, 0.93, r);
          float goldBorder = smoothstep(0.92, 0.95, r) * smoothstep(1.0, 0.98, r);

          // 高潮 Drop 金色太极水浪
          float waveSurge = sin(r * 12.0 - uTime * 8.0) * uDropIgnite * 0.35;
          vec3 finalRgb = coverColor.rgb * silkGrain * edgeRing;
          finalRgb += uGoldColor * (goldBorder * 2.0 + waveSurge + uMelodyGlow * 0.25);

          gl_FragColor = vec4(finalRgb, edgeRing);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.silkPoolMesh = new THREE.Mesh(poolGeo, this.silkPoolMaterial);
    this.silkPoolMesh.rotation.x = -Math.PI / 2;
    this.silkPoolMesh.position.set(0, 0.05, -32);
    this.scene.add(this.silkPoolMesh);

    // 汉白玉圆形池沿
    const poolRingGeo = new THREE.RingGeometry(poolRadius, poolRadius + 1.2, 64);
    const poolRingMat = new THREE.MeshStandardMaterial({
      color: 0xd4dadc,
      roughness: 0.65,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    const poolRingMesh = new THREE.Mesh(poolRingGeo, poolRingMat);
    poolRingMesh.rotation.x = -Math.PI / 2;
    poolRingMesh.position.set(0, 0.1, -32);
    this.scene.add(poolRingMesh);

    // 6. 核心悬浮天阙水榭 (Floating Celestial Pavilion at Z = -32m, Y = 4.5m)
    this.buildPavilionArchitecture();
    this.pavilionGroup.position.set(0, 4.5, -32);
    this.scene.add(this.pavilionGroup);

    // 7. 七弦发光古琴琴弦 (7 Luminous Zither Strings)
    this.stringsLines = [];
    const stringMat = new THREE.LineBasicMaterial({
      color: this.colorGold,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < NUM_STRINGS; i++) {
      const u = (i - (NUM_STRINGS - 1) * 0.5) * 1.5;
      const pts: THREE.Vector3[] = [];
      const numPts = 32;
      for (let p = 0; p <= numPts; p++) {
        const tVal = p / numPts;
        const x = lerp(-9.0, 9.0, tVal);
        const y = 2.2 + 0.3 * Math.sin(tVal * Math.PI) + (i % 2) * 0.2;
        const z = -32.0 + u + Math.sin(tVal * Math.PI * 0.5) * 2.0;
        pts.push(new THREE.Vector3(x, y, z));
      }
      const stringGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const strLine = new THREE.Line(stringGeo, stringMat);
      this.stringsLines.push(strLine);
      this.scene.add(strLine);
    }

    // 8. 游弋流光金鲤 (Swimming Golden Koi Streams)
    const koiGeo = new THREE.ConeGeometry(0.35, 1.4, 8);
    koiGeo.rotateX(Math.PI * 0.5);
    const koiMat = new THREE.MeshBasicMaterial({
      color: this.colorGold,
      transparent: true,
      opacity: 0.85,
    });
    this.koiInstanced = new THREE.InstancedMesh(koiGeo, koiMat, NUM_KOI);
    for (let i = 0; i < NUM_KOI; i++) {
      this.koiStates.push({
        speed: 0.65 + seedRand() * 0.45,
        phase: (i / NUM_KOI) * Math.PI * 2,
        radiusX: 6.0 + seedRand() * 5.5,
        radiusZ: 5.5 + seedRand() * 5.0,
        yBase: 0.2 + seedRand() * 1.5,
      });
    }
    this.scene.add(this.koiInstanced);

    // 9. 漫天轻盈流萤粒子 (Firefly Particles)
    const fireflyGeo = new THREE.BufferGeometry();
    this.fireflyBasePos = new Float32Array(NUM_FIREFLIES * 3);
    for (let i = 0; i < NUM_FIREFLIES; i++) {
      const theta = seedRand() * Math.PI * 2;
      const rad = 2.0 + seedRand() * 14.0;
      this.fireflyBasePos[i * 3] = Math.cos(theta) * rad;
      this.fireflyBasePos[i * 3 + 1] = 0.5 + seedRand() * 8.0;
      this.fireflyBasePos[i * 3 + 2] = -32.0 + Math.sin(theta) * rad;
    }
    fireflyGeo.setAttribute('position', new THREE.BufferAttribute(this.fireflyBasePos.slice(), 3));
    const fireflyMat = new THREE.PointsMaterial({
      color: this.colorGold,
      size: 0.45,
      transparent: true,
      opacity: 0.80,
      blending: THREE.AdditiveBlending,
    });
    this.firefliesPoints = new THREE.Points(fireflyGeo, fireflyMat);
    this.scene.add(this.firefliesPoints);

    // 10. 高潮冲天太极天光柱 (Climax Soaring Light Pillar)
    const pillarGeo = new THREE.CylinderGeometry(1.6, 2.8, 85, 24, 1, true);
    this.lightPillarMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uDropIgnite: this.uniforms.uDropIgnite,
        uGoldColor: this.uniforms.uGoldColor,
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
        uniform float uDropIgnite;
        uniform vec3 uGoldColor;
        varying vec2 vUv;

        void main() {
          float rim = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float spiral = sin(vUv.y * 18.0 - uTime * 6.0 + vUv.x * 6.28);
          float alpha = pow(max(0.0, rim), 2.5) * (0.8 + 0.2 * spiral) * uDropIgnite;
          gl_FragColor = vec4(uGoldColor * 1.5, alpha * 0.75);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.lightPillarMesh = new THREE.Mesh(pillarGeo, this.lightPillarMaterial);
    this.lightPillarMesh.position.set(0, 40, -32);
    this.scene.add(this.lightPillarMesh);

    // 11. 歌词装配
    this.rig = new LyricRig(init.palette, 'poem');
    this.scene.add(this.rig.group);
  }

  /** 构建重檐歇山顶水榭古典建筑结构 (斗拱、飞檐翘角、四角宫灯) */
  private buildPavilionArchitecture(): void {
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x5a2d1e,
      roughness: 0.7,
      metalness: 0.15,
    });
    const goldEdgeMat = new THREE.MeshBasicMaterial({
      color: this.colorGold,
    });

    // 台基
    const baseGeo = new THREE.CylinderGeometry(5.2, 5.6, 0.8, 8);
    const baseMesh = new THREE.Mesh(baseGeo, woodMat);
    baseMesh.position.y = -2.2;
    this.pavilionGroup.add(baseMesh);

    // 8 根朱红立柱
    const colGeo = new THREE.CylinderGeometry(0.22, 0.24, 3.8, 12);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const colMesh = new THREE.Mesh(colGeo, woodMat);
      colMesh.position.set(Math.cos(a) * 4.2, 0.0, Math.sin(a) * 4.2);
      this.pavilionGroup.add(colMesh);
    }

    // 下层重檐飞檐
    const lowerRoofGeo = new THREE.ConeGeometry(6.8, 1.8, 8);
    const lowerRoof = new THREE.Mesh(lowerRoofGeo, woodMat);
    lowerRoof.position.y = 2.4;
    this.pavilionGroup.add(lowerRoof);

    // 上层重檐与飞檐翘角
    const upperRoofGeo = new THREE.ConeGeometry(5.2, 2.2, 8);
    const upperRoof = new THREE.Mesh(upperRoofGeo, woodMat);
    upperRoof.position.y = 4.2;
    this.pavilionGroup.add(upperRoof);

    // 飞檐微晶金丝发光边
    const roofRingGeo = new THREE.RingGeometry(6.6, 6.9, 8);
    const roofRing = new THREE.Mesh(roofRingGeo, goldEdgeMat);
    roofRing.rotation.x = -Math.PI / 2;
    roofRing.position.y = 1.55;
    this.pavilionGroup.add(roofRing);

    // 四角鎏金宫灯
    const lanternGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.6, 6);
    const lanternMat = new THREE.MeshBasicMaterial({ color: 0xffaa33 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const lantern = new THREE.Mesh(lanternGeo, lanternMat);
      lantern.position.set(Math.cos(a) * 6.4, 1.1, Math.sin(a) * 6.4);
      this.pavilionGroup.add(lantern);
    }
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
      // 贴着丝绸封面水面贴地滑翔：观察游弋金鲤与金色水纹折射
      const x = lerp(4.5 * dir, -3.5 * dir, e);
      const y = 0.95 + 0.05 * Math.sin(t * 0.5);
      const z = lerp(-20.0, -28.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 1.2, -32.0);
      return CAM_FOV - 2.0;
    } else if (variant === 'eaves') {
      // 特写雕梁画栋与飞檐宫灯，背景是浩瀚云海
      const x = lerp(-6.5 * dir, -5.0 * dir, e);
      const y = lerp(6.2, 5.0, e);
      const z = lerp(-25.0, -28.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 4.6, -32.0);
      return CAM_FOV + 1.0;
    } else if (variant === 'zenith') {
      // 凌霄俯瞰视点：垂直凝视展开的丝绸封面画卷与金色太极波纹
      const x = lerp(-1.0 * dir, 1.0 * dir, e);
      const y = lerp(22.0, 18.0, e);
      const z = lerp(-31.5, -32.5, e);
      poseLookAt(pos, quat, x, y, z, 0, 0, -32.0);
      return CAM_FOV + 3.0;
    } else {
      // pavilion: 正面全景黄金构图（默认）
      const theta = lerp(-0.18 * dir, 0.18 * dir, e);
      const rad = lerp(18.0, 15.0, e);
      const x = Math.sin(theta) * rad;
      const y = 3.6 + 0.10 * Math.sin(t * 0.4);
      const z = -32.0 + Math.cos(theta) * rad;
      poseLookAt(pos, quat, x, y, z, 0, 4.2, -32.0);
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
    const isBreak = label === 'break' || label === 'bridge';

    // 1. 相机更新
    this.updateCamera(t, shot);

    // 2. 音频包络与能量
    const kickPulse = this.evalPulse(this.kickTimes, this.kickAmps, t, 0.25);
    const melodyGlow = music.foregroundAt(t).level;
    const dropIgnite = isDrop ? 1.0 : isChorus ? 0.45 : 0.0;
    const fireflyAscent = isBreak ? 1.0 : 0.0;

    // 3. 水榭仙气起伏
    this.pavilionGroup.position.y = 4.5 + Math.sin(t * 0.65) * 0.18 + kickPulse * 0.12;

    // 4. 更新游弋金鲤流光位置与朝向
    const dummy = new THREE.Object3D();
    for (let i = 0; i < NUM_KOI; i++) {
      const ks = this.koiStates[i];
      const theta = t * ks.speed + ks.phase;
      const x = Math.cos(theta) * ks.radiusX;
      const z = -32.0 + Math.sin(theta) * ks.radiusZ;
      const y = ks.yBase + Math.sin(t * 1.5 + i) * 0.35 + (isDrop ? 1.2 : 0.0);

      // 计算切线方向作为朝向
      const nextTheta = theta + 0.05;
      const nextX = Math.cos(nextTheta) * ks.radiusX;
      const nextZ = -32.0 + Math.sin(nextTheta) * ks.radiusZ;

      dummy.position.set(x, y, z);
      dummy.lookAt(nextX, y, nextZ);
      dummy.scale.set(1.0, 1.0, 1.0 + kickPulse * 0.4);
      dummy.updateMatrix();
      this.koiInstanced.setMatrixAt(i, dummy.matrix);
    }
    this.koiInstanced.instanceMatrix.needsUpdate = true;

    // 5. 更新流萤粒子位置（间奏时缓缓腾空升起）
    const posAttr = this.firefliesPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;
    for (let i = 0; i < NUM_FIREFLIES; i++) {
      const bx = this.fireflyBasePos[i * 3];
      const by = this.fireflyBasePos[i * 3 + 1];
      const bz = this.fireflyBasePos[i * 3 + 2];

      const driftY = (t * 0.8 + i * 0.35) % 18.0;
      posArray[i * 3] = bx + Math.sin(t * 0.8 + i) * 0.4;
      posArray[i * 3 + 1] = by + (isBreak ? driftY * 1.8 : Math.sin(t * 1.2 + i * 0.5) * 0.5);
      posArray[i * 3 + 2] = bz + Math.cos(t * 0.8 + i) * 0.4;
    }
    posAttr.needsUpdate = true;

    // 6. 着色器 Uniforms
    this.uniforms.uTime.value = t;
    this.uniforms.uMelodyGlow.value = melodyGlow;
    this.uniforms.uDropIgnite.value = dropIgnite;
    this.uniforms.uFireflyAscent.value = fireflyAscent;

    // 7. 后期调优
    fx.bloom = 0.30 + 0.16 * dropIgnite + 0.08 * melodyGlow;
    fx.vignette = 0.42;
    fx.letterbox = 0;

    // 8. 歌词
    const energy = isDrop ? 1.0 : isChorus ? 0.82 : 0.45;
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
