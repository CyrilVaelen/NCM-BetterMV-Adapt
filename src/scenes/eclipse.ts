// 日蚀裂谷 (Eclipse): 摇滚/金属/暗黑电音专属 3D 世界。
// 适配曲风：摇滚 (Rock), 后摇 (Post-Rock), 金属 (Metal), 暗黑 Trap / Dubstep。
// 100% 确定性纯时间函数 f(t) 驱动，零累积状态，支持任意 seek 与离线 MP4 导出。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex } from '../director/music.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl, tuneCoverStop } from './coverTone.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';

const NUM_FLOATING_ROCKS = 32;
const CAM_FOV = 50;

interface RockInitState {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotSpeed: number;
  phase: number;
}

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
  private canyonWallsMesh!: THREE.Mesh;
  private canyonMaterial!: THREE.ShaderMaterial;
  private rocksInstanced: THREE.InstancedMesh;
  private rockStates: RockInitState[] = [];
  private lightningLines: THREE.LineSegments;
  private lightningMaterial: THREE.LineBasicMaterial;
  private shockwaveRingMesh: THREE.Mesh;
  private shockwaveMaterial: THREE.ShaderMaterial;

  // 色彩基调（遵循 R5 规则）
  private colorCorona: THREE.Color;
  private colorMagma: THREE.Color;
  private colorObsidian: THREE.Color;
  private colorLightning: THREE.Color;

  private uniforms: {
    uTime: { value: number };
    uCover: { value: THREE.Texture };
    uKickPulse: { value: number };
    uSnareFlash: { value: number };
    uDropShock: { value: number };
    uCoronaColor: { value: THREE.Color };
    uMagmaColor: { value: THREE.Color };
  };

  constructor(private init: SceneInit, _look?: string) {
    this.scene.fog = new THREE.FogExp2(0x050508, 0.009);

    // 1. 色彩提取与微调（遵循 R5 规则）
    const tone = extractCoverTone(init);
    const seed = init.seed ?? 1001;
    const seedRand = rng((seed ^ 0x66cc4422) >>> 0);
    const deltaHue = (seedRand() < 0.5 ? -1 : 1) * (6 + 10 * seedRand());

    const stopCorona = tuneCoverStop(tone.highlight, tone, 0.65, 0.96, 0.60, 0.98, deltaHue);
    const stopMagma = tuneCoverStop(tone.bright, tone, 0.50, 0.85, 0.70, 0.98, deltaHue - 8.0);
    const stopDeep = tuneCoverStop(tone.dark, tone, 0.04, 0.16, 0.15, 0.50, deltaHue);

    this.colorCorona = colorFromHsl(stopCorona.h, stopCorona.s, stopCorona.l);
    this.colorMagma = colorFromHsl(stopMagma.h, stopMagma.s, stopMagma.l);
    this.colorObsidian = colorFromHsl(stopDeep.h, stopDeep.s, stopDeep.l);
    this.colorLightning = colorFromHsl(stopCorona.h + 25.0, 0.45, 0.92);

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

    // 3. 着色器 Uniforms
    this.uniforms = {
      uTime: { value: 0 },
      uCover: { value: init.cover },
      uKickPulse: { value: 0 },
      uSnareFlash: { value: 0 },
      uDropShock: { value: 0 },
      uCoronaColor: { value: this.colorCorona },
      uMagmaColor: { value: this.colorMagma },
    };

    // 4. 苍穹日全食纯黑月轮与暗调浮雕封面 (Embossed Dark Moon Disk at Z = -120m, Y = 36m)
    const moonRadius = 14.5;
    const moonGeo = new THREE.CircleGeometry(moonRadius, 64);
    this.moonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCover: this.uniforms.uCover,
        uTime: this.uniforms.uTime,
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
        uniform float uDropShock;
        varying vec2 vUv;

        void main() {
          // 纯黑月轮中心隐约透出低明度浮雕质感封面
          vec4 coverCol = texture2D(uCover, vUv);
          float lum = dot(coverCol.rgb, vec3(0.299, 0.587, 0.114));

          // 微妙玄武岩浮雕暗纹
          vec3 darkRelief = vec3(0.012, 0.014, 0.02) + vec3(lum * 0.06);

          gl_FragColor = vec4(darkRelief, 1.0);
        }
      `,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, this.moonMaterial);
    this.moonMesh.position.set(0, 36, -120);
    this.scene.add(this.moonMesh);

    // 5. 狂暴日冕能量环与贝利珠耀斑 (Solar Corona Ring & Baily's Beads)
    const coronaGeo = new THREE.RingGeometry(moonRadius * 0.98, moonRadius * 2.8, 64);
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
          vec2 center = vec2(0.5, 0.5);
          vec2 d = vUv - center;
          float r = length(d) * 2.0;
          float angle = atan(d.y, d.x);

          // 日冕扰动流线
          float noise = sin(angle * 12.0 + uTime * 2.5) * 0.15 + sin(angle * 28.0 - uTime * 4.0) * 0.08;
          float innerEdge = smoothstep(0.32, 0.38 + noise * 0.1, r);
          float outerFalloff = smoothstep(1.0, 0.40, r);

          // Drop 瞬间边缘迸发贝利珠钻石环耀斑 (Baily's Beads)
          float beads = pow(max(0.0, sin(angle * 16.0 + uTime * 0.5)), 32.0) * uDropShock * 3.5;

          float intensity = innerEdge * outerFalloff * (1.2 + 0.6 * uKickPulse + 2.0 * uDropShock) + beads;
          vec3 col = uCoronaColor * (1.0 + beads * 1.5);

          gl_FragColor = vec4(col, intensity * 0.85);
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

    // 6. 谷底液态熔金河 (Molten Gold Magma River at Y = -6.0m)
    const riverGeo = new THREE.PlaneGeometry(28, 160, 32, 64);
    this.magmaRiverMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uMagmaColor: this.uniforms.uMagmaColor,
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
        uniform vec3 uMagmaColor;
        uniform float uKickPulse;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          // 熔岩流动对流纹理
          float flowZ = vWorldPos.z * 0.08 - uTime * 0.6;
          float cell = sin(vWorldPos.x * 0.35 + sin(flowZ)) * cos(flowZ * 1.5);
          float crust = smoothstep(0.15, 0.35, abs(cell));

          // 炽热裂缝与翻滚热浪
          vec3 crustCol = vec3(0.04, 0.02, 0.015);
          vec3 moltenCol = uMagmaColor * (1.8 + 0.8 * uKickPulse);
          vec3 finalRgb = mix(moltenCol, crustCol, crust * 0.75);

          gl_FragColor = vec4(finalRgb, 1.0);
        }
      `,
    });
    this.magmaRiverMesh = new THREE.Mesh(riverGeo, this.magmaRiverMaterial);
    this.magmaRiverMesh.rotation.x = -Math.PI / 2;
    this.magmaRiverMesh.position.set(0, -6.0, -50);
    this.scene.add(this.magmaRiverMesh);

    // 7. 黑曜石裂谷两侧峭壁与地脉光纹 (Obsidian Canyon Walls & Magma Veins)
    this.buildCanyonWalls();

    // 8. 悬浮反重力玄武巨石 (Anti-gravity Floating Rocks)
    const rockGeo = new THREE.DodecahedronGeometry(1.2, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x14161a,
      roughness: 0.85,
      metalness: 0.25,
      flatShading: true,
    });
    this.rocksInstanced = new THREE.InstancedMesh(rockGeo, rockMat, NUM_FLOATING_ROCKS);
    for (let i = 0; i < NUM_FLOATING_ROCKS; i++) {
      const rx = (seedRand() < 0.5 ? -1 : 1) * (5.5 + seedRand() * 9.5);
      const ry = 0.5 + seedRand() * 22.0;
      const rz = -15.0 - seedRand() * 85.0;
      this.rockStates.push({
        x: rx,
        y: ry,
        z: rz,
        scale: 0.8 + seedRand() * 1.8,
        rotSpeed: 0.2 + seedRand() * 0.4,
        phase: seedRand() * Math.PI * 2,
      });
    }
    this.scene.add(this.rocksInstanced);

    // 9. 军鼓劈落闪电电弧 (Snare Branched Lightning Strikes)
    const lightningGeo = new THREE.BufferGeometry();
    const lPos: number[] = [];
    // 预备两组闪电分叉几何
    for (let side = -1; side <= 1; side += 2) {
      let curX = 0;
      let curY = 36.0;
      let curZ = -118.0;
      for (let s = 0; s < 12; s++) {
        const nextX = curX + side * (1.2 + seedRand() * 2.5);
        const nextY = curY - (2.5 + seedRand() * 1.5);
        const nextZ = curZ + (6.0 + seedRand() * 4.0);
        lPos.push(curX, curY, curZ, nextX, nextY, nextZ);
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

  /** 构建峡谷峭壁及大地熔岩光脉 */
  private buildCanyonWalls(): void {
    const wallGeo = new THREE.BoxGeometry(12, 45, 160);
    this.canyonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uMagmaColor: this.uniforms.uMagmaColor,
        uKickPulse: this.uniforms.uKickPulse,
        uSnareFlash: this.uniforms.uSnareFlash,
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
        uniform vec3 uMagmaColor;
        uniform float uKickPulse;
        uniform float uSnareFlash;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          // 嶙峋玄武岩峭壁与熔岩裂纹 (Magma Veins)
          float vein = sin(vWorldPos.y * 0.45 + sin(vWorldPos.z * 0.15)) * cos(vWorldPos.z * 0.25);
          float isVein = smoothstep(0.08, 0.02, abs(vein));

          // 熔岩脉络充能 (Kick Pulse 驱动向前传导)
          float pulseWave = sin(vWorldPos.z * 0.2 - uTime * 12.0) * 0.5 + 0.5;
          vec3 veinCol = uMagmaColor * (0.8 + 1.8 * uKickPulse * pulseWave);

          // 峭壁岩体与闪电电弧瞬间照亮
          vec3 rockCol = vec3(0.03, 0.035, 0.045) + vec3(0.4) * uSnareFlash;
          vec3 finalRgb = mix(rockCol, veinCol, isVein);

          gl_FragColor = vec4(finalRgb, 1.0);
        }
      `,
    });
    this.canyonWallsMesh = new THREE.Mesh(wallGeo, this.canyonMaterial);
    // 左壁
    const leftWall = this.canyonWallsMesh;
    leftWall.position.set(-20, 16, -50);
    this.scene.add(leftWall);

    // 右壁
    const rightWall = new THREE.Mesh(wallGeo, this.canyonMaterial);
    rightWall.position.set(20, 16, -50);
    this.scene.add(rightWall);
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
      const x = lerp(-3.5 * dir, 3.5 * dir, e);
      const y = 1.45 + 0.08 * Math.sin(t * 0.4);
      const z = lerp(-15.0, -28.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 36.0, -120.0);
      return CAM_FOV + 2.0;
    } else if (variant === 'ridge') {
      // 绝壁边缘悬停视角，展现断崖嶙峋与深渊熔金
      const x = lerp(17.5 * dir, 14.5 * dir, e);
      const y = lerp(18.5, 15.0, e);
      const z = lerp(-28.0, -45.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 12.0, -90.0);
      return CAM_FOV - 3.0;
    } else if (variant === 'abyss') {
      // 深渊仰攻机位，贴近熔金河表面，仰望嶙峋断崖与闪电
      const x = lerp(-2.2 * dir, 2.2 * dir, e);
      const y = -4.2 + 0.05 * Math.sin(t * 0.6);
      const z = lerp(-8.0, -22.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 18.0, -85.0);
      return CAM_FOV + 4.0;
    } else {
      // canyon: 穿梭于黑曜石峡谷中轴（默认）
      const x = lerp(-1.2 * dir, 1.2 * dir, e);
      const y = 4.5 + 0.10 * Math.sin(t * 0.35);
      const z = lerp(12.0, -8.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 26.0, -120.0);
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

    // 1. 相机更新
    this.updateCamera(t, shot);

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

    // 3. 更新悬浮反重力玄武巨石（底鼓震颤与 Drop 冲击波向外推开）
    const dummy = new THREE.Object3D();
    for (let i = 0; i < NUM_FLOATING_ROCKS; i++) {
      const rs = this.rockStates[i];
      // 底鼓垂直高频震颤
      const kickJolt = Math.sin(t * 32.0 + i) * 0.35 * kickPulse;
      // Drop 冲击波推离
      const pushX = (rs.x > 0 ? 1 : -1) * dropShock * 3.5;
      const y = rs.y + Math.sin(t * 0.8 + rs.phase) * 0.6 + kickJolt;

      dummy.position.set(rs.x + pushX, y, rs.z);
      dummy.rotation.set(t * rs.rotSpeed, t * rs.rotSpeed * 0.8, rs.phase);
      dummy.scale.setScalar(rs.scale);
      dummy.updateMatrix();
      this.rocksInstanced.setMatrixAt(i, dummy.matrix);
    }
    this.rocksInstanced.instanceMatrix.needsUpdate = true;

    // 4. 更新军鼓闪电劈落电弧透明度
    this.lightningMaterial.opacity = clamp01(snareFlash * 1.5);

    // 5. 更新 Drop 日冕冲击波环尺度
    if (dropShock > 0.01) {
      const shockScale = 1.0 + (1.0 - dropShock) * 22.0;
      this.shockwaveRingMesh.scale.set(shockScale, shockScale, 1.0);
    }

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
