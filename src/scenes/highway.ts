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
  readonly streetlightsInstanced: THREE.InstancedMesh;
  readonly lampHeadsInstanced: THREE.InstancedMesh;
  private lampHeadMaterial: THREE.MeshBasicMaterial;
  private guardRailsMesh: THREE.LineSegments;
  readonly guardPostsInstanced: THREE.InstancedMesh;
  private guardPostMaterial: THREE.MeshBasicMaterial;
  readonly tailLightsMesh: THREE.LineSegments;
  private tailPositions: Float32Array;
  private trafficSeeds: TrafficSeed[] = [];
  readonly warpStreaksInstanced: THREE.InstancedMesh;
  private warpMaterial: THREE.MeshBasicMaterial;
  private streakSeeds: StreakSeed[] = [];
  private underglowMesh: THREE.Mesh;
  private reusableDummy = new THREE.Object3D();

  // 色彩（严格遵循 R5 同色系微调与黑白中性灰保护规范）
  readonly colorMain: THREE.Color;
  readonly colorDeep: THREE.Color;
  readonly colorBright: THREE.Color;
  readonly colorAccent: THREE.Color;

  private uniforms: {
    uTime: { value: number };
    uCover: { value: THREE.Texture };
    uDistance: { value: number };
    uSpeed: { value: number };
    uKickSurge: { value: number };
    uSnareFlash: { value: number };
    uWarpDash: { value: number };
    uMainColor: { value: THREE.Color };
    uAccentColor: { value: THREE.Color };
    uBrightColor: { value: THREE.Color };
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
    const stopBright = tuneCoverStop(tone.highlight, tone, 0.76, 0.98, 0.45, 0.95, deltaHue);
    const stopAccent = tuneCoverStop(tone.bright, tone, 0.55, 0.88, 0.50, 0.95, deltaHue);

    this.colorMain = isMono ? colorFromHsl(0, 0, stopMain.l) : colorFromHsl(stopMain.h, stopMain.s, stopMain.l);
    this.colorDeep = isMono ? colorFromHsl(0, 0, Math.min(0.08, stopDeep.l)) : colorFromHsl(stopDeep.h, stopDeep.s * 0.75, Math.min(0.09, stopDeep.l));
    this.colorBright = isMono ? colorFromHsl(0, 0, stopBright.l) : colorFromHsl(stopBright.h, stopBright.s, stopBright.l);
    this.colorAccent = isMono ? colorFromHsl(0, 0, stopAccent.l) : colorFromHsl(stopAccent.h, stopAccent.s, stopAccent.l);

    const fogColor = this.colorDeep.clone().multiplyScalar(0.55);
    this.scene.background = fogColor;
    this.scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0062);

    // 补齐场景高空月光与环境照明，使跨海大桥立柱、横梁与路灯金属结构清晰立体可见
    const ambientLight = new THREE.AmbientLight(this.colorBright, 0.85);
    this.scene.add(ambientLight);
    const moonDirLight = new THREE.DirectionalLight(this.colorAccent, 2.2);
    moonDirLight.position.set(0, 95, -160);
    this.scene.add(moonDirLight);
    const fillLight = new THREE.DirectionalLight(this.colorMain, 0.9);
    fillLight.position.set(12, 18, 24);
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

    // 4. Uniforms
    this.uniforms = {
      uTime: { value: 0 },
      uCover: { value: init.cover },
      uDistance: { value: 0 },
      uSpeed: { value: 52 },
      uKickSurge: { value: 0 },
      uSnareFlash: { value: 0 },
      uWarpDash: { value: 0 },
      uMainColor: { value: this.colorMain },
      uAccentColor: { value: this.colorAccent },
      uBrightColor: { value: this.colorBright },
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
          // 完整纯净呈现专辑封面图案，无扫描条纹或内部位移，严格保持原封面空间拓扑与明度
          vec4 coverCol = texture2D(uCover, vUv);
          float r = length(vUv - vec2(0.5)) * 2.0;

          // 月轮边缘清辉（Lunar Limb Glow）与平滑抗锯齿圆盘边界
          float discMask = 1.0 - smoothstep(0.965, 1.0, r);
          float innerLimb = smoothstep(0.76, 0.985, r) * discMask;

          // 保持封面原色清晰干净，仅在月轮最外缘镀一圈柔和月华清辉
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

    // 明月外围静谧大气月晕（单位平面，跟随月亮同步锁定天球位置，仅光晕随节拍温润呼吸）
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
          // 柔和环状月华：中心留给封面本体避免发白雾化，外圈向夜空丝滑衰减
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

    // 6. 桥面多车道湿润沥青公路 (Highway Road Deck with Wet Reflections, Expansion Joints & Lamp Pools)
    const roadWidth = 20.4;
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
        uMainColor: this.uniforms.uMainColor,
        uAccentColor: this.uniforms.uAccentColor,
        uBrightColor: this.uniforms.uBrightColor,
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
        uniform vec3 uMainColor;
        uniform vec3 uAccentColor;
        uniform vec3 uBrightColor;
        uniform vec3 uFogColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          // vWorldPos.z - uDistance 使路面花纹以 +uDistance 速度向 +Z（镜头前方至车底）极速迎面掠过
          float roadZ = vWorldPos.z - uDistance;
          float xPos = vWorldPos.x;

          // 1) 高频沥青纵向微纹理与轮胎压痕（提供极强的近场贴地速度参照）
          float grain = hash12(floor(vec2(xPos * 18.0, roadZ * 3.5)));
          float tireTrack = exp(-pow((abs(xPos) - 2.4) * 0.85, 2.0)) * 0.35 + exp(-pow((abs(xPos) - 6.8) * 0.85, 2.0)) * 0.25;
          float streakMicro = 0.5 + 0.5 * sin(roadZ * 1.4 + sin(xPos * 3.2));

          // 2) 国标级高对比分道虚线（周期 10m：4m 标线 + 6m 间隔）与外侧双导流实线
          float dashCycle = fract(roadZ / 10.0);
          float dashMask = smoothstep(0.0, 0.04, dashCycle) * (1.0 - smoothstep(0.38, 0.42, dashCycle));
          float centerDouble = smoothstep(0.11, 0.04, abs(abs(xPos) - 0.22));
          float laneDiv = (smoothstep(0.12, 0.04, abs(xPos - 4.6)) + smoothstep(0.12, 0.04, abs(xPos + 4.6))) * dashMask;
          float shoulderLine = smoothstep(0.18, 0.06, abs(abs(xPos) - 9.15));
          // 路肩高频反光猫眼道钉（每 6m 一颗迎面闪过）
          float studZ = fract((roadZ + 2.0) / 6.0) * 6.0 - 3.0;
          float studs = exp(-(pow(abs(xPos) - 9.15, 2.0) * 36.0 + studZ * studZ * 9.0)) * 2.2;

          // 3) 每 28m 一道跨海大桥横向金属伸缩缝（高速咔哒掠过车底）
          float jointLocal = fract(roadZ / 28.0) * 28.0;
          float expansionJoint = exp(-pow((jointLocal - 14.0) * 4.5, 2.0)) * (0.45 + 0.45 * uKickSurge);

          // 4) 与头顶路灯（间距 18m）100% 同步移动的桥面湿滑路灯光池倒影
          float lampCellZ = mod(roadZ - 14.0, 18.0);
          if (lampCellZ > 9.0) lampCellZ -= 18.0;
          float lampPool = exp(-(lampCellZ * lampCellZ) * 0.045) * exp(-pow((abs(xPos) - 7.8) * 0.36, 2.0));

          // 5) 雨夜桥面水洼分布与天穹封面明月清辉倒影
          float puddleWave = sin(xPos * 0.55 + sin(roadZ * 0.09)) * cos(roadZ * 0.11 - xPos * 0.25);
          float wetness = clamp(0.42 + 0.48 * puddleWave + 0.2 * tireTrack, 0.08, 0.98);
          float moonRefl = exp(-abs(xPos) * 0.18) * wetness;
          vec2 coverUv = vec2(clamp(0.5 + xPos / 22.0 + 0.012 * sin(roadZ * 0.45), 0.02, 0.98), clamp(0.35 + 0.18 * sin(roadZ * 0.05), 0.1, 0.9));
          vec3 moonlightCol = texture2D(uCover, coverUv).rgb;

          vec3 asphalt = (vec3(0.018, 0.022, 0.032) + 0.016 * grain + 0.008 * streakMicro * tireTrack) * (1.0 - 0.25 * wetness);
          vec3 centerCol = mix(uAccentColor, uBrightColor, 0.55) * centerDouble * (0.85 + 0.55 * uKickSurge);
          vec3 whiteMarks = mix(vec3(0.90), uBrightColor, 0.35) * (laneDiv + shoulderLine * 0.9) * (1.05 + 0.5 * uKickSurge);
          vec3 studCol = uAccentColor * studs * (1.1 + 0.8 * uSnareFlash + 0.6 * uWarpDash);
          vec3 jointCol = uMainColor * expansionJoint * 0.55;
          vec3 lampReflCol = mix(uBrightColor, uAccentColor, 0.4) * lampPool * wetness * (0.85 + 0.45 * uKickSurge + 0.45 * uWarpDash);
          vec3 moonRoadReflCol = mix(moonlightCol, uBrightColor, 0.32) * moonRefl * (0.62 + 0.55 * uWarpDash);

          vec3 col = asphalt + centerCol + whiteMarks + studCol + jointCol + lampReflCol + moonRoadReflCol;

          // 远景指数雾平滑融入天际线
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

    // 7. 辽阔大洋水面 (Ocean Water beneath Bridge at Y = -6.5m，海浪随 uDistance 高速向后飞掠)
    const oceanGeo = new THREE.PlaneGeometry(420, 440, 24, 24);
    this.oceanMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uDistance: this.uniforms.uDistance,
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
          vec3 baseOcean = mix(vec3(0.008, 0.013, 0.024), uMainColor * 0.12, 0.5);
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

    // 8. 跨海斜拉桥循环主塔与放射发光钢索 (3 组模块化桥塔，随行驶距离迎面呼啸穿过头顶并无缝循环)
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

    // 预构造单座桥塔斜拉索几何体（前后对称跨度 ±34m）
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

      // 桥塔内侧霓虹导光灯带（令巨塔迎面掠过时轮廓分明）
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

    // 9. 桥侧双层防撞护栏导轨 + 迎面高频掠过的发光轮廓立柱
    const railPositions: number[] = [
      -9.85, 0.45, 16, -9.85, 0.45, -310,
      -9.85, 0.92, 16, -9.85, 0.92, -310,
      9.85, 0.45, 16, 9.85, 0.45, -310,
      9.85, 0.92, 16, 9.85, 0.92, -310,
    ];
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPositions, 3));
    const railMat = new THREE.LineBasicMaterial({
      color: this.colorMain,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.guardRailsMesh = new THREE.LineSegments(railGeo, railMat);
    this.scene.add(this.guardRailsMesh);

    const guardPostGeo = new THREE.BoxGeometry(0.14, 0.95, 0.22);
    this.guardPostMaterial = new THREE.MeshBasicMaterial({
      color: this.colorAccent,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.guardPostsInstanced = new THREE.InstancedMesh(guardPostGeo, this.guardPostMaterial, NUM_GUARD_POSTS * 2);
    this.guardPostsInstanced.frustumCulled = false;
    this.scene.add(this.guardPostsInstanced);

    // 10. 呼啸掠过的流线型路灯杆 + 悬臂高光灯头 (Rhythmically Whizzing Streetlights & Glowing Lamp Heads)
    const poleGeo = new THREE.CylinderGeometry(0.10, 0.16, 7.2, 6);
    const poleMat = new THREE.MeshStandardMaterial({
      color: isMono ? 0x454545 : 0x38435a,
      emissive: this.colorMain,
      emissiveIntensity: 0.28,
      roughness: 0.4,
      metalness: 0.7,
    });
    this.streetlightsInstanced = new THREE.InstancedMesh(poleGeo, poleMat, NUM_STREETLIGHTS * 2);
    this.streetlightsInstanced.frustumCulled = false;
    this.scene.add(this.streetlightsInstanced);

    // 伸向车道的发光灯具头（高可见度掠顶流光）
    const lampHeadGeo = new THREE.BoxGeometry(1.55, 0.18, 0.46);
    this.lampHeadMaterial = new THREE.MeshBasicMaterial({
      color: this.colorBright,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lampHeadsInstanced = new THREE.InstancedMesh(lampHeadGeo, this.lampHeadMaterial, NUM_STREETLIGHTS * 2);
    this.lampHeadsInstanced.frustumCulled = false;
    this.scene.add(this.lampHeadsInstanced);

    // 11. 动态穿梭超车的车流尾灯流光残影与近景车辆 Underglow
    const trafficRand = rng((seed ^ 0x7711cc99) >>> 0);
    const lanes = [-6.8, -2.5, 2.5, 6.8];
    for (let i = 0; i < NUM_TRAFFIC_CARS; i++) {
      this.trafficSeeds.push({
        laneX: lanes[i % lanes.length] + (trafficRand() - 0.5) * 0.4,
        zPhase: trafficRand() * 240.0,
        relSpeed: 0.42 + trafficRand() * 0.36, // 被第一人称高速追越的相对速度系数
        width: 0.78 + trafficRand() * 0.18,
      });
    }
    // 每辆前车左/右两道尾灯长拉丝（共 NUM_TRAFFIC_CARS * 2 条线段 = NUM_TRAFFIC_CARS * 4 个顶点）
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

    // 近景底盘霓虹导流光晕 (Underglow)
    const underglowGeo = new THREE.PlaneGeometry(3.8, 6.0);
    const underglowMat = new THREE.MeshBasicMaterial({
      color: this.colorAccent,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.underglowMesh = new THREE.Mesh(underglowGeo, underglowMat);
    this.underglowMesh.rotation.x = -Math.PI / 2;
    this.underglowMesh.position.set(0, 0.12, -9.5);
    this.scene.add(this.underglowMesh);

    // 12. 高速迎面流光拉丝 (Dynamic Speed & Nitro Warp Streaks，全段落随速度流动，副歌/Drop 倍增拉长)
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
      // 避开正中心视线遮挡，分布在车道两侧与上空形成高速流光隧道感
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
    // 高速贴地微幅悬挂呼吸（平滑连续，不破坏切点角速度约束）
    const roadVibY = 0.022 * Math.sin(t * 5.2) + 0.015 * Math.cos(t * 8.3);

    if (variant === 'chase') {
      // 低角度车流追焦视角，伴随丝滑变道超车横移
      const laneX = Math.sin(t * 0.55) * 2.1 * dir;
      const x = lerp(laneX - 0.9 * dir, laneX + 0.9 * dir, e);
      const y = 1.68 + 0.06 * Math.sin(t * 0.7) + roadVibY;
      const z = 3.8;
      poseLookAt(pos, quat, x, y, z, laneX * 0.45, 1.35, -62.0, -0.025 * Math.cos(t * 0.55) * dir, 1.0, 0.0);
      return BASE_FOV + 2.0 + kickSurge * 4.5;
    } else if (variant === 'bridge') {
      // 贴近桥侧栏杆掠过主塔与斜拉索的速度感斜侧机位
      const x = lerp(-8.2 * dir, -5.8 * dir, e);
      const y = lerp(6.8, 4.6, e) + roadVibY;
      const z = lerp(-6.0, -16.0, e);
      poseLookAt(pos, quat, x, y, z, 0, 3.2, -98.0);
      return BASE_FOV - 2.0 + kickSurge * 3.5;
    } else if (variant === 'warp') {
      // 氮气极速飞驰贴地广角荷兰角冲刺视角
      const x = lerp(-2.2 * dir, 2.2 * dir, e);
      const y = 1.08 + 0.04 * Math.sin(t * 1.4) + roadVibY;
      const z = 1.0;
      poseLookAt(pos, quat, x, y, z, x * 0.25, 1.25, -88.0, 0.075 * dir, 1.0, 0.0);
      return BASE_FOV + 9.0 + kickSurge * 5.5;
    } else {
      // cockpit: 第一人称超低机位贴地狂飙主景（距沥青仅 1.02m，近场速度感最强）
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

  /**
   * 将专辑封面明月与月晕 100% 锁定在天球视锥正上方黄金位：
   * - 无论车辆前后飞驰、左右变道、俯仰起伏或荷兰角倾斜，明月在屏幕上的位置 (ndcX = 0, ndcY = 0.46)、
   *   视觉半径 (ndcRadiusY = 0.28) 与正立角度均恒定为零误差静止，彻底消除任何“往后退”、缩放或晃动；
   * - 物理深度置于 315m 夜空（开启 depthTest），供前景跨海斜拉桥主塔与拉索高速迎面掠过时产生真实的遮挡纵深对比。
   */
  private anchorCelestialMoon(): void {
    const cam = this.camera;
    this.camForward.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.camUp.set(0, 1, 0).applyQuaternion(cam.quaternion);

    const halfH = MOON_DISTANCE * Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5));
    const screenRadius = cam.aspect < 1 ? MOON_SCREEN_RADIUS * cam.aspect : MOON_SCREEN_RADIUS;
    const moonRadius = screenRadius * halfH;

    // 明月圆盘严格锁定在相机视锥正上方天穹，屏幕投影 0 位移、0 缩放、0 旋转
    this.moonMesh.position
      .copy(cam.position)
      .addScaledVector(this.camForward, MOON_DISTANCE)
      .addScaledVector(this.camUp, MOON_NDC_Y * halfH);
    this.moonMesh.scale.setScalar(moonRadius);
    this.moonMesh.quaternion.copy(cam.quaternion);

    // 月晕同步同心锁定在明月正后方 2m 处
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

    // 2. 相机更新，并同步将专辑封面明月精确锁定在天球视锥上方（消除一切后退缩放、变道视差与旋转晃动）
    if (Math.abs(this.camera.aspect - ctx.aspect) > 1e-6) {
      this.camera.aspect = ctx.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.updateCamera(t, shot, kickPulse, isDrop);
    this.camera.updateMatrixWorld(true);
    this.anchorCelestialMoon();

    const dummy = this.reusableDummy;

    // 3. 更新 3 组跨海斜拉桥主塔与放射钢索：由远端天际 (-298m) 沿 +Z 迎面冲过头顶至身后 (+38m) 无缝循环
    const totalTowerCycle = NUM_TOWER_SPANS * TOWER_SPAN; // 336m
    for (let k = 0; k < NUM_TOWER_SPANS; k++) {
      const raw = ((distance + k * TOWER_SPAN) % totalTowerCycle + totalTowerCycle) % totalTowerCycle;
      const zTower = -298.0 + raw; // 随 distance 单调增加向 +Z 迎面驶来
      this.towerUnits[k].position.set(0, 0, zTower);
    }

    // 4. 更新两侧迎面呼啸掠过的路灯杆与悬臂发光灯头（修复原负号倒退 Bug，现严格沿 +Z 迎面飞掠）
    const lampForward = ((distance % STREETLIGHT_SPACING) + STREETLIGHT_SPACING) % STREETLIGHT_SPACING;
    dummy.rotation.set(0, 0, 0);
    for (let i = 0; i < NUM_STREETLIGHTS; i++) {
      const zPos = 14.0 + lampForward - (i + 1) * STREETLIGHT_SPACING;
      // 左右路灯立杆
      dummy.scale.set(1, 1, 1);
      dummy.position.set(-10.15, 3.6, zPos);
      dummy.updateMatrix();
      this.streetlightsInstanced.setMatrixAt(i * 2, dummy.matrix);

      dummy.position.set(10.15, 3.6, zPos);
      dummy.updateMatrix();
      this.streetlightsInstanced.setMatrixAt(i * 2 + 1, dummy.matrix);

      // 左右伸向桥面内侧的发光灯具头（随底鼓微胀发光）
      const headScaleZ = 1.0 + 0.55 * warpDash + 0.35 * kickPulse;
      dummy.scale.set(1, 1, headScaleZ);
      dummy.position.set(-9.1, 7.15, zPos);
      dummy.updateMatrix();
      this.lampHeadsInstanced.setMatrixAt(i * 2, dummy.matrix);

      dummy.position.set(9.1, 7.15, zPos);
      dummy.updateMatrix();
      this.lampHeadsInstanced.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    this.streetlightsInstanced.instanceMatrix.needsUpdate = true;
    this.lampHeadsInstanced.instanceMatrix.needsUpdate = true;
    this.lampHeadMaterial.opacity = Math.min(1.0, 0.82 + 0.18 * kickPulse);

    // 5. 更新桥侧高频防撞护栏发光轮廓标（近场高速擦肩参照物，每 6m 一对沿 +Z 飞掠）
    const postForward = ((distance % GUARD_POST_SPACING) + GUARD_POST_SPACING) % GUARD_POST_SPACING;
    dummy.scale.set(1, 1, 1.0 + 0.8 * warpDash);
    for (let i = 0; i < NUM_GUARD_POSTS; i++) {
      const zPost = 12.0 + postForward - (i + 1) * GUARD_POST_SPACING;
      dummy.position.set(-9.82, 0.52, zPost);
      dummy.updateMatrix();
      this.guardPostsInstanced.setMatrixAt(i * 2, dummy.matrix);

      dummy.position.set(9.82, 0.52, zPost);
      dummy.updateMatrix();
      this.guardPostsInstanced.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    this.guardPostsInstanced.instanceMatrix.needsUpdate = true;
    this.guardPostMaterial.opacity = 0.68 + 0.28 * kickPulse;

    // 6. 更新桥面多车道被我们高速追越的前车尾灯流光残影（沿 +Z 迎面拉近超车掠过）
    const trafficCycle = 240.0;
    const streakLen = 6.5 + 14.0 * warpDash + 9.0 * kickPulse;
    for (let c = 0; c < NUM_TRAFFIC_CARS; c++) {
      const seed = this.trafficSeeds[c];
      const relTravel = distance * seed.relSpeed + seed.zPhase;
      const zCar = -222.0 + ((relTravel % trafficCycle) + trafficCycle) % trafficCycle; // [-222, +18] 沿 +Z 被我们超越
      const swayX = seed.laneX + 0.18 * Math.sin(t * 0.9 + c * 1.7);
      const yTail = 0.72;
      const base = c * 12;
      // 左侧尾灯拉丝线段
      this.tailPositions[base + 0] = swayX - seed.width;
      this.tailPositions[base + 1] = yTail;
      this.tailPositions[base + 2] = zCar;
      this.tailPositions[base + 3] = swayX - seed.width;
      this.tailPositions[base + 4] = yTail;
      this.tailPositions[base + 5] = zCar - streakLen;
      // 右侧尾灯拉丝线段
      this.tailPositions[base + 6] = swayX + seed.width;
      this.tailPositions[base + 7] = yTail;
      this.tailPositions[base + 8] = zCar;
      this.tailPositions[base + 9] = swayX + seed.width;
      this.tailPositions[base + 10] = yTail;
      this.tailPositions[base + 11] = zCar - streakLen;
    }
    (this.tailLightsMesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // 近景底盘霓虹导流光随横向漂移同步跟随相机 X 轴
    this.underglowMesh.position.x = this.camera.position.x * 0.65;
    (this.underglowMesh.material as THREE.MeshBasicMaterial).opacity = 0.32 + 0.25 * kickPulse + 0.22 * warpDash;

    // 7. 更新高速氮气流光拉丝（全曲随行驶距离向 +Z 极速穿梭，进入 Chorus/Drop 时拉长加密，退出时显式幂等归一）
    const warpCycle = 180.0;
    const streakStretch = isDrop ? 2.4 + 0.8 * kickPulse : isChorus ? 1.45 : 0.85;
    for (let i = 0; i < NUM_WARP_STREAKS; i++) {
      const st = this.streakSeeds[i];
      const travelZ = distance * 1.45 + st.zPhase;
      const zStreak = -166.0 + ((travelZ % warpCycle) + warpCycle) % warpCycle; // [-166, +14] 沿 +Z 高速射过镜头两侧
      dummy.position.set(st.x, st.y, zStreak);
      dummy.scale.set(1.0, 1.0, st.lenScale * streakStretch);
      dummy.updateMatrix();
      this.warpStreaksInstanced.setMatrixAt(i, dummy.matrix);
    }
    this.warpStreaksInstanced.instanceMatrix.needsUpdate = true;
    this.warpMaterial.opacity = isDrop ? 0.78 : isChorus ? 0.38 : isBuild ? 0.22 : 0.12;

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
