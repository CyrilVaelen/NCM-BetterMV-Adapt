// 琉璃圣堂 (Cathedral): 宏大哥特挑高拱顶、黑曜石水镜长廊与彩绘琉璃玫瑰花窗。
// 适配曲风：Melodic Bass, Trance, 史诗纯音乐 (Epic Orchestral), 空灵女声 (Ethereal Vocals)。
// 100% 确定性纯时间函数 f(t) 驱动，零累积状态，支持任意 seek 与离线 MP4 导出。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { lastIndex, type Music } from '../director/music.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl, tuneCoverStop } from './coverTone.ts';
import { blendCameraPose, poseLookAt, stableShotSeed } from './cameraBlend.ts';

const MAX_BEAMS = 16;
const MAX_RIPPLES = 24;
const ORGAN_PIPES_PER_SIDE = 24;
const CAM_FOV = 48;

interface RippleEvent {
  t: number;
  x: number;
  z: number;
  amp: number;
  speed: number;
  decay: number;
}

export class CathedralScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.1, 320);
  private rig: LyricRig;

  // 预烘焙音频事件
  private kickTimes: Float64Array;
  private kickAmps: Float32Array;
  private snareTimes: Float64Array;
  private downbeatTimes: Float64Array;
  private chromaBuf = new Float32Array(12);
  private rippleEvents: RippleEvent[] = [];
  private rippleTimes: Float64Array;

  // 场景网格与材质
  private roseWindowMesh: THREE.Mesh;
  private roseMaterial: THREE.ShaderMaterial;
  private waterMirrorMesh: THREE.Mesh;
  private waterMaterial: THREE.ShaderMaterial;
  private piersInstanced: THREE.InstancedMesh;
  private vaultRibsMesh: THREE.LineSegments;
  private organPipesLeft: THREE.InstancedMesh;
  private organPipesRight: THREE.InstancedMesh;
  private organGlowLeft: THREE.InstancedMesh;
  private organGlowRight: THREE.InstancedMesh;
  private organMaterial: THREE.MeshStandardMaterial;
  private organGlowMaterial: THREE.MeshBasicMaterial;
  private beamMeshes: THREE.Mesh[] = [];
  private beamMaterials: THREE.ShaderMaterial[] = [];
  private ambientLight: THREE.AmbientLight;
  private altarLight: THREE.PointLight;

  // 色彩基调（严格遵循 R5 同色系微调）
  private colorMain: THREE.Color;
  private colorDeep: THREE.Color;
  private colorBright: THREE.Color;
  private colorAccent: THREE.Color;
  private colorBeamVecs: THREE.Vector3[] = [];

  // 着色器 Uniforms 引用
  private uniforms: {
    uTime: { value: number };
    uCover: { value: THREE.Texture };
    uVocalGlow: { value: number };
    uDropFlash: { value: number };
    uHighEnergy: { value: number };
    uMainColor: { value: THREE.Color };
    uAccentColor: { value: THREE.Color };
    uWaterRipples: { value: THREE.Vector4[] }; // (x, z, age, amp)
    uRippleCount: { value: number };
  };

  constructor(private init: SceneInit, _look?: string) {
    this.scene.fog = new THREE.FogExp2(0x04060c, 0.012);

    // 1. 色彩提取与微调（遵循 R5 规则）
    const tone = extractCoverTone(init);
    const seed = init.seed ?? 1001;
    const seedRand = rng((seed ^ 0x9e3779b9) >>> 0);
    const deltaHue = (seedRand() < 0.5 ? -1 : 1) * (6 + 10 * seedRand());
    const mono = tone.mono || init.palette.mono;

    const stopMain = tuneCoverStop(tone.mid, tone, 0.45, 0.75, 0.35, 0.90, deltaHue);
    const stopDeep = tuneCoverStop(tone.dark, tone, 0.08, 0.25, 0.20, 0.60, deltaHue);
    const stopBright = tuneCoverStop(tone.highlight, tone, 0.70, 0.96, 0.30, 0.85, deltaHue);
    const stopAccent = tuneCoverStop(tone.bright, tone, 0.55, 0.85, 0.40, 0.95, deltaHue);

    this.colorMain = colorFromHsl(stopMain.h, stopMain.s, stopMain.l);
    this.colorDeep = colorFromHsl(stopDeep.h, stopDeep.s, stopDeep.l);
    this.colorBright = colorFromHsl(stopBright.h, stopBright.s, stopBright.l);
    this.colorAccent = colorFromHsl(stopAccent.h, stopAccent.s, stopAccent.l);

    // 预备 16 束丁达尔圣光的微调线性向量
    for (let i = 0; i < MAX_BEAMS; i++) {
      const hOffset = mono ? 0 : Math.sin(i * 1.618) * 12.0;
      const bColor = linearVec3FromHsl(stopMain.h + hOffset, mono ? 0.02 : stopMain.s * 0.9, 0.65 + 0.25 * Math.sin(i));
      this.colorBeamVecs.push(bColor);
    }

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
      // 预构水面涟漪事件
      this.rippleEvents.push({
        t: kicks[i][0],
        x: (seedRand() - 0.5) * 8.0,
        z: -10.0 - seedRand() * 25.0,
        amp: kicks[i][1] * 0.85,
        speed: 7.5 + seedRand() * 2.0,
        decay: 1.85,
      });
    }

    this.rippleEvents.sort((a, b) => a.t - b.t);
    this.rippleTimes = new Float64Array(this.rippleEvents.map(r => r.t));

    this.snareTimes = new Float64Array(snares.length);
    for (let i = 0; i < snares.length; i++) this.snareTimes[i] = snares[i][0];

    this.downbeatTimes = new Float64Array(downbeats.length);
    for (let i = 0; i < downbeats.length; i++) this.downbeatTimes[i] = downbeats[i];

    // 3. 构建着色器 Uniforms
    const rippleVecs: THREE.Vector4[] = [];
    for (let i = 0; i < MAX_RIPPLES; i++) rippleVecs.push(new THREE.Vector4(0, 0, 0, 0));

    this.uniforms = {
      uTime: { value: 0 },
      uCover: { value: init.cover },
      uVocalGlow: { value: 0 },
      uDropFlash: { value: 0 },
      uHighEnergy: { value: 0 },
      uMainColor: { value: this.colorMain },
      uAccentColor: { value: this.colorAccent },
      uWaterRipples: { value: rippleVecs },
      uRippleCount: { value: 0 },
    };

    // 4. 灯光系统
    this.ambientLight = new THREE.AmbientLight(this.colorDeep, 0.45);
    this.scene.add(this.ambientLight);

    this.altarLight = new THREE.PointLight(this.colorBright, 2.5, 90, 1.2);
    this.altarLight.position.set(0, 12, -56);
    this.scene.add(this.altarLight);

    // 5. 玫瑰花窗 (Rose Window at Z = -58, Y = 12)
    const roseRadius = 8.4;
    const roseGeo = new THREE.CircleGeometry(roseRadius, 64);
    this.roseMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCover: this.uniforms.uCover,
        uTime: this.uniforms.uTime,
        uVocalGlow: this.uniforms.uVocalGlow,
        uDropFlash: this.uniforms.uDropFlash,
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uCover;
        uniform float uTime;
        uniform float uVocalGlow;
        uniform float uDropFlash;
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        varying vec2 vUv;
        varying vec3 vPos;

        void main() {
          vec2 center = vec2(0.5, 0.5);
          vec2 d = vUv - center;
          float r = length(d) * 2.0;
          float angle = atan(d.y, d.x);

          // 保持专辑封面原始空间拓扑
          vec4 coverColor = texture2D(uCover, vUv);

          // 哥特石质窗格花饰 (Tracery) 遮罩
          float petal = cos(angle * 16.0);
          float ring1 = abs(r - 0.42);
          float ring2 = abs(r - 0.72);
          float ring3 = abs(r - 0.98);
          float bars = min(ring1, min(ring2, ring3));
          float spoke = abs(sin(angle * 8.0));
          float tracery = smoothstep(0.02, 0.045, bars) * smoothstep(0.04, 0.08, spoke);

          // 透光与高光强化
          float glow = 1.0 + 1.8 * uVocalGlow + 4.5 * uDropFlash;
          vec3 tinted = mix(coverColor.rgb, uMainColor * (0.8 + 0.4 * petal), 0.18);
          vec3 finalRgb = tinted * glow * tracery;

          // 石雕深色边框
          if (tracery < 0.2) finalRgb = mix(vec3(0.03, 0.04, 0.06), finalRgb, tracery * 5.0);

          gl_FragColor = vec4(finalRgb, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    this.roseWindowMesh = new THREE.Mesh(roseGeo, this.roseMaterial);
    this.roseWindowMesh.position.set(0, 12, -58);
    this.scene.add(this.roseWindowMesh);

    // 玫瑰花窗外围石质立体拱套与同心石环
    const outerRingGeo = new THREE.RingGeometry(roseRadius, roseRadius + 1.2, 64);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x181c24,
      roughness: 0.85,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
    const outerRingMesh = new THREE.Mesh(outerRingGeo, stoneMat);
    outerRingMesh.position.set(0, 12, -57.8);
    this.scene.add(outerRingMesh);

    // 6. 黑曜石水镜长廊 (Obsidian Water Mirror Floor)
    const floorWidth = 36;
    const floorLength = 110;
    const floorGeo = new THREE.PlaneGeometry(floorWidth, floorLength, 64, 128);
    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uCover: this.uniforms.uCover,
        uVocalGlow: this.uniforms.uVocalGlow,
        uDropFlash: this.uniforms.uDropFlash,
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
        uWaterRipples: this.uniforms.uWaterRipples,
        uRippleCount: this.uniforms.uRippleCount,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uCover;
        uniform float uVocalGlow;
        uniform float uDropFlash;
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        uniform vec4 uWaterRipples[24];
        uniform int uRippleCount;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          // 底鼓激发的解析式同心水面涟漪法线扰动
          vec2 rippleNorm = vec2(0.0);
          for (int i = 0; i < 24; i++) {
            if (i >= uRippleCount) break;
            vec4 rp = uWaterRipples[i];
            vec2 center = rp.xy;
            float age = rp.z;
            float amp = rp.w;
            if (amp > 0.001 && age > 0.0) {
              float d = distance(vWorldPos.xz, center);
              float waveFront = age * 8.2;
              float distDiff = d - waveFront;
              if (abs(distDiff) < 4.5) {
                float env = exp(-age * 1.35) * exp(-distDiff * distDiff * 0.35);
                float wave = sin(d * 3.5 - age * 18.0) * amp * env;
                vec2 dir = normalize(vWorldPos.xz - center + vec2(1e-4));
                rippleNorm += dir * wave * 0.06;
              }
            }
          }

          // 地砖微缝隙几何
          vec2 tileUv = fract(vWorldPos.xz * 0.25);
          float tileEdge = smoothstep(0.0, 0.04, tileUv.x) * smoothstep(1.0, 0.96, tileUv.x) *
                           smoothstep(0.0, 0.04, tileUv.y) * smoothstep(1.0, 0.96, tileUv.y);

          // 菲涅尔倒影投影（反射上方玫瑰花窗与拱顶）
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 normal = normalize(vec3(rippleNorm.x, 1.0, rippleNorm.y));
          float fresnel = pow(1.0 - max(0.0, dot(viewDir, normal)), 3.5) * 0.75 + 0.25;

          // 水面下倒映的专辑封面彩绘琉璃
          float zDist = abs(vWorldPos.z - (-58.0));
          vec2 reflUv = vec2(
            clamp(0.5 + (vWorldPos.x + rippleNorm.x * 2.5) / 22.0, 0.0, 1.0),
            clamp(0.5 + (vWorldPos.y + 12.0 - zDist * 0.15) / 20.0, 0.0, 1.0)
          );
          vec3 coverRefl = texture2D(uCover, reflUv).rgb;

          // 黑曜石深色底质 + 水面高光与倒影
          vec3 baseObsidian = vec3(0.015, 0.02, 0.035) * (0.8 + 0.2 * tileEdge);
          vec3 reflColor = mix(coverRefl, uMainColor, 0.25) * (1.2 + 2.0 * uDropFlash + 0.8 * uVocalGlow);
          vec3 finalRgb = mix(baseObsidian, reflColor, fresnel * 0.65);

          // Drop 圣光扫荡时的金色水浪高光
          float waveGlitter = pow(max(0.0, dot(reflect(-viewDir, normal), vec3(0.0, 0.8, -0.6))), 16.0);
          finalRgb += (uAccentColor * 1.5 + vec3(0.8)) * waveGlitter * (0.4 + 1.2 * uDropFlash);

          gl_FragColor = vec4(finalRgb, 1.0);
        }
      `,
    });
    this.waterMirrorMesh = new THREE.Mesh(floorGeo, this.waterMaterial);
    this.waterMirrorMesh.rotation.x = -Math.PI / 2;
    this.waterMirrorMesh.position.set(0, 0, -5);
    this.scene.add(this.waterMirrorMesh);

    // 7. 哥特挑高束柱群 (Gothic Clustered Piers)
    const pierGeo = new THREE.CylinderGeometry(0.72, 0.88, 18, 16);
    const pierMat = new THREE.MeshStandardMaterial({
      color: 0x222632,
      roughness: 0.72,
      metalness: 0.28,
    });
    const pierPairs = 10;
    this.piersInstanced = new THREE.InstancedMesh(pierGeo, pierMat, pierPairs * 2);
    const dummy = new THREE.Object3D();
    const pierZStart = -52;
    const pierZSpacing = 8.5;
    for (let i = 0; i < pierPairs; i++) {
      const z = pierZStart + i * pierZSpacing;
      // 左侧柱
      dummy.position.set(-14, 9, z);
      dummy.updateMatrix();
      this.piersInstanced.setMatrixAt(i * 2, dummy.matrix);
      // 右侧柱
      dummy.position.set(14, 9, z);
      dummy.updateMatrix();
      this.piersInstanced.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    this.piersInstanced.instanceMatrix.needsUpdate = true;
    this.scene.add(this.piersInstanced);

    // 8. 交叉尖拱交叉肋骨拱顶 (Ribbed Vaults)
    const ribLinePositions: number[] = [];
    for (let i = 0; i < pierPairs; i++) {
      const z = pierZStart + i * pierZSpacing;
      // 横向尖拱曲线
      const segments = 24;
      for (let s = 0; s < segments; s++) {
        const u0 = s / segments;
        const u1 = (s + 1) / segments;
        const x0 = lerp(-14, 14, u0);
        const x1 = lerp(-14, 14, u1);
        const y0 = 16 + Math.sin(u0 * Math.PI) * 7.5;
        const y1 = 16 + Math.sin(u1 * Math.PI) * 7.5;
        ribLinePositions.push(x0, y0, z, x1, y1, z);
      }
      // 纵向连接脊梁
      if (i < pierPairs - 1) {
        const nextZ = pierZStart + (i + 1) * pierZSpacing;
        ribLinePositions.push(0, 23.5, z, 0, 23.5, nextZ);
        // 对角交叉肋骨
        ribLinePositions.push(-14, 16, z, 0, 23.5, (z + nextZ) * 0.5);
        ribLinePositions.push(14, 16, z, 0, 23.5, (z + nextZ) * 0.5);
        ribLinePositions.push(0, 23.5, (z + nextZ) * 0.5, -14, 16, nextZ);
        ribLinePositions.push(0, 23.5, (z + nextZ) * 0.5, 14, 16, nextZ);
      }
    }
    const ribGeo = new THREE.BufferGeometry();
    ribGeo.setAttribute('position', new THREE.Float32BufferAttribute(ribLinePositions, 3));
    const ribMat = new THREE.LineBasicMaterial({
      color: this.colorAccent,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
    });
    this.vaultRibsMesh = new THREE.LineSegments(ribGeo, ribMat);
    this.scene.add(this.vaultRibsMesh);

    // 9. 管风琴音柱 (Pipe Organ Sound Columns)
    const organPipeGeo = new THREE.CylinderGeometry(0.24, 0.28, 1, 16);
    this.organMaterial = new THREE.MeshStandardMaterial({
      color: 0x8894a6,
      roughness: 0.22,
      metalness: 0.88,
    });
    this.organPipesLeft = new THREE.InstancedMesh(organPipeGeo, this.organMaterial, ORGAN_PIPES_PER_SIDE);
    this.organPipesRight = new THREE.InstancedMesh(organPipeGeo, this.organMaterial, ORGAN_PIPES_PER_SIDE);

    const glowTorusGeo = new THREE.TorusGeometry(0.32, 0.05, 8, 16);
    this.organGlowMaterial = new THREE.MeshBasicMaterial({
      color: this.colorBright,
      transparent: true,
      opacity: 0.85,
    });
    this.organGlowLeft = new THREE.InstancedMesh(glowTorusGeo, this.organGlowMaterial, ORGAN_PIPES_PER_SIDE);
    this.organGlowRight = new THREE.InstancedMesh(glowTorusGeo, this.organGlowMaterial, ORGAN_PIPES_PER_SIDE);

    for (let i = 0; i < ORGAN_PIPES_PER_SIDE; i++) {
      // 对数阶梯高度排列 4m ~ 13m
      const h = 4.2 + Math.log2(1 + (i / ORGAN_PIPES_PER_SIDE) * 7.0) * 3.2;
      const z = -46 + i * 0.65;
      const xLeft = -11.5;
      const xRight = 11.5;

      // 左侧音柱
      dummy.position.set(xLeft, h * 0.5, z);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      this.organPipesLeft.setMatrixAt(i, dummy.matrix);

      dummy.position.set(xLeft, 0.8, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this.organGlowLeft.setMatrixAt(i, dummy.matrix);

      // 右侧音柱
      dummy.position.set(xRight, h * 0.5, z);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      this.organPipesRight.setMatrixAt(i, dummy.matrix);

      dummy.position.set(xRight, 0.8, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this.organGlowRight.setMatrixAt(i, dummy.matrix);
    }
    this.organPipesLeft.instanceMatrix.needsUpdate = true;
    this.organPipesRight.instanceMatrix.needsUpdate = true;
    this.organGlowLeft.instanceMatrix.needsUpdate = true;
    this.organGlowRight.instanceMatrix.needsUpdate = true;
    this.scene.add(this.organPipesLeft);
    this.scene.add(this.organPipesRight);
    this.scene.add(this.organGlowLeft);
    this.scene.add(this.organGlowRight);

    // 10. 16 束丁达尔体积圣光 (Tyndall Volumetric Light Beams)
    // 根部锚定在玫瑰花窗花瓣，呈锥形/光幕向前穿透整座大殿
    for (let i = 0; i < MAX_BEAMS; i++) {
      const beamAngle = (i / MAX_BEAMS) * Math.PI * 2;
      const r0 = 4.2;
      const rootX = Math.cos(beamAngle) * r0;
      const rootY = 12 + Math.sin(beamAngle) * r0;
      const rootZ = -57.5;

      // 目标终点朝大殿前方与水面发散
      const targetX = Math.cos(beamAngle) * (14.0 + (i % 3) * 4.0);
      const targetY = 0.5 + (i % 4) * 2.5;
      const targetZ = 10.0 + (i % 5) * 6.0;

      const beamLen = Math.hypot(targetX - rootX, targetY - rootY, targetZ - rootZ);
      const beamRadius = 1.8 + (i % 2) * 0.8;

      // 细长圆台几何体模拟体积光束
      const beamGeo = new THREE.CylinderGeometry(0.4, beamRadius, beamLen, 16, 1, true);
      beamGeo.translate(0, beamLen * 0.5, 0);
      beamGeo.rotateX(Math.PI * 0.5);

      const bColor = this.colorBeamVecs[i];
      const beamMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.uniforms.uTime,
          uBeamColor: { value: bColor },
          uIntensity: { value: 0.35 },
          uDropFlash: this.uniforms.uDropFlash,
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vPos;
          void main() {
            vUv = uv;
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uBeamColor;
          uniform float uIntensity;
          uniform float uDropFlash;
          varying vec2 vUv;
          varying vec3 vPos;

          void main() {
            // 沿光束纵向与横向的平滑渐变
            float lengthFade = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
            float rim = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float softRim = pow(max(0.0, rim), 2.2);

            // 空气微粒流动感
            float dust = 0.85 + 0.15 * sin(vUv.y * 35.0 - uTime * 2.5);

            float alpha = lengthFade * softRim * (uIntensity + uDropFlash * 1.5) * dust;
            vec3 col = uBeamColor * (1.0 + uDropFlash * 2.2);

            gl_FragColor = vec4(col, alpha * 0.42);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const beamMesh = new THREE.Mesh(beamGeo, beamMat);
      beamMesh.position.set(rootX, rootY, rootZ);
      beamMesh.lookAt(targetX, targetY, targetZ);

      this.beamMeshes.push(beamMesh);
      this.beamMaterials.push(beamMat);
      this.scene.add(beamMesh);
    }

    // 11. 歌词装配
    this.rig = new LyricRig(init.palette, 'caption');
    this.scene.add(this.rig.group);
  }

  /** 四组电影级运镜机位（sanctuary / aisle / organ / soar）纯函数姿态求值 */
  private evalCameraPose(t: number, s: Shot, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const start = s.run?.start ?? s.start;
    const end = s.run?.end ?? s.end;
    const span = Math.max(0.8, end - start);
    const k = clamp01((t - start) / span);
    const e = inOutCubic(k);
    const dir = (stableShotSeed(s) & 1) === 0 ? 1 : -1;
    const variant = s.variant || 'sanctuary';

    if (variant === 'aisle') {
      // 超低机位贴地水镜滑行：强调黑曜石倒影与长廊纵深
      const x = lerp(-2.5 * dir, 2.5 * dir, e);
      const y = 1.25 + 0.08 * Math.sin(t * 0.4);
      const z = lerp(16.0, 2.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 8.5, -58.0);
      return CAM_FOV - 2.0;
    } else if (variant === 'organ') {
      // 侧后仰拍管风琴音柱与斜切穿透的丁达尔光束
      const x = lerp(9.5 * dir, 7.2 * dir, e);
      const y = lerp(2.2, 4.0, e);
      const z = lerp(-22.0, -32.0, e);
      poseLookAt(pos, quat, x, y, z, -11.5 * dir, 10.0, -42.0);
      return CAM_FOV + 1.5;
    } else if (variant === 'soar') {
      // 高空俯仰环视：穿行于肋骨挑高拱顶与圣光之间
      const theta = lerp(-0.25 * dir, 0.25 * dir, e);
      const rad = lerp(18.0, 14.0, e);
      const x = Math.sin(theta) * rad;
      const y = lerp(16.5, 13.0, e);
      const z = lerp(4.0, -12.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 6.0, -56.0);
      return CAM_FOV + 3.0;
    } else {
      // sanctuary: 主轴正前黄金构图（默认）
      const x = lerp(-1.2 * dir, 1.2 * dir, e);
      const y = 3.6 + 0.12 * Math.sin(t * 0.35);
      const z = lerp(22.0, 8.5, e);
      poseLookAt(pos, quat, x, y, z, 0, 11.5, -58.0);
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

    // 2. 音频能量包络计算
    const kickPulse = this.evalPulse(this.kickTimes, this.kickAmps, t, 0.28);
    const highEnv = music.env('high', t);
    const vocalGlow = music.foregroundAt(t).level;

    // Drop 圣光爆发瞬态 (Holy Flash)
    let dropFlash = 0;
    if (isDrop && curSec) {
      const dropAge = t - curSec.start;
      if (dropAge >= 0 && dropAge < 3.2) {
        dropFlash = Math.exp(-dropAge / 0.85);
      }
    }

    // 3. 填充活跃水面涟漪（最多 24 个）
    let rCount = 0;
    const rVecs = this.uniforms.uWaterRipples.value;
    for (let i = lastIndex(this.rippleTimes, t); i >= 0 && rCount < MAX_RIPPLES; i--) {
      const rp = this.rippleEvents[i];
      const age = t - rp.t;
      if (age < 0) continue;
      if (age > rp.decay * 2.5) break;
      const curAmp = rp.amp * Math.exp(-age / rp.decay);
      if (curAmp > 0.01) {
        rVecs[rCount].set(rp.x, rp.z, age, curAmp);
        rCount++;
      }
    }
    for (let i = rCount; i < MAX_RIPPLES; i++) {
      rVecs[i].set(0, 0, 0, 0);
    }
    this.uniforms.uRippleCount.value = rCount;

    // 4. 同步管风琴音柱色度（映射 12 半音 Chroma）
    music.chromaAt(t, this.chromaBuf);
    let maxC = 0.001;
    for (let k = 0; k < 12; k++) if (this.chromaBuf[k] > maxC) maxC = this.chromaBuf[k];

    // 更新管风琴光环透明度
    const glowLMat = this.organGlowMaterial;
    glowLMat.opacity = clamp01(0.35 + 0.65 * (maxC * 0.8 + kickPulse * 0.3));

    // 5. 更新丁达尔体积圣光强度与横扫
    const beamBaseIntensity = 0.28 + 0.45 * vocalGlow + 0.35 * highEnv;
    for (let i = 0; i < MAX_BEAMS; i++) {
      const mat = this.beamMaterials[i];
      mat.uniforms.uIntensity.value = beamBaseIntensity * (0.8 + 0.4 * Math.sin(t * 1.5 + i));
      mat.uniforms.uDropFlash.value = dropFlash;
      // Drop 时光束轻微外展横扫
      if (dropFlash > 0.01) {
        const mesh = this.beamMeshes[i];
        mesh.rotation.z = Math.sin(t * 3.0 + i) * 0.15 * dropFlash;
      }
    }

    // 6. 更新全局着色器 Uniforms
    this.uniforms.uTime.value = t;
    this.uniforms.uVocalGlow.value = vocalGlow;
    this.uniforms.uDropFlash.value = dropFlash;
    this.uniforms.uHighEnergy.value = highEnv;

    // 7. 灯光与后期调优
    this.altarLight.intensity = 2.0 + 3.0 * dropFlash + 1.2 * vocalGlow;
    fx.bloom = 0.32 + 0.16 * dropFlash + 0.08 * highEnv;
    fx.vignette = 0.42;
    fx.letterbox = 0;

    // 8. 歌词渲染
    const energy = isDrop ? 1.0 : isChorus ? 0.82 : 0.45;
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, energy);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
