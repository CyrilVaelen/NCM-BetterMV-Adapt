// 暗涌水廊 (Velvet Lounge): 专为 Deep House / Melodic House / Jazz House 打造的都市午夜微醺场景。
// 空间构图：
// 1. 下方约三分之一 (vUv.y ∈ [0.0, 0.335])：漫过深色拉丝玄武岩的镜面浅水长廊，随贝斯暗涌 (Sub/Plucked Bass) 荡开高粘度液态重力波，
//    随反拍开镲 (Off-beat Open Hat) 掠过细碎香槟金焦散，并实时倒映上方的悬浮黑胶与两侧发光玻璃光栅；
// 2. 两侧透视回廊：左右对称向深处延伸的 12 片包豪斯半透明磨砂玻璃光栅 (对应 12 半音色度)，随电钢琴 (Rhodes/Keys) 与合成器切分和弦
//    逐片泛起次表面暖琥珀与封面色边缘流光；
// 3. 中央视觉焦点：悬浮缓转的半透明烟熏琥珀黑胶光盘，外圈刻有精密抗锯齿声槽与 DJ 频闪点，内圈端正呈现高保真专辑封面，配极简悬浮唱针星芒；
// 4. 核心律动灵魂：廊顶体积暖雾与环境辉光执行「光学侧链抽吸 (Optical Sidechain Ducking)」——底鼓瞬间微收下沉，半拍内如丝绒呼吸般膨胀回满，
//    同时空气通透度实时映射低通滤波器开合 (Filter Cutoff)。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { voiceFaces } from './lyricBlock.ts';
import { lastIndex, type Music } from '../director/music.ts';
import type { Palette } from '../render/palette.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl, tuneCoverStop } from './coverTone.ts';

/** 水面最大并发高粘度低频/和弦暗涌波包数量（轻量级解析求值，保障高帧率与零显卡超时风险） */
const MAX_SWELLS = 12;
/** 屏幕空间水廊地平线高度：下方 33.5% 为薄水玄武岩镜面，上方 66.5% 为挑高玻璃水廊与午夜都会景深 */
const WATER_HORIZON_Y = 0.335;
/** 摄像机垂直视场角与锁定三维水面地平线 (y=0) 至 vUv.y = 0.335 的俯仰角 */
const CAM_FOV = 46;
const HORIZON_PITCH = Math.atan((1 - 2 * WATER_HORIZON_Y) * Math.tan(THREE.MathUtils.degToRad(CAM_FOV * 0.5)));

interface BassSwellEvent {
  /** 事件起始音频时间（秒） */
  t: number;
  /** 归一化水廊横向位置 [0.16, 0.84] */
  x: number;
  /** 归一化水廊纵深位置 [0.14, 0.88]（0 靠近镜头底部，1 靠近地平线） */
  y: number;
  /** 最大扩散半径 */
  maxRadius: number;
  /** 涌浪振幅 */
  amp: number;
  /** 扩散时间常数（秒） */
  tau: number;
  /** 空间波数（Deep House 采用宽波长圆润液态重力波） */
  freq: number;
  /** 色彩暖度权重（0 偏封面主色，1 偏钨丝琥珀暖光） */
  warmth: number;
}

/**
 * 预提取全曲的低音暗涌（Bass Stab / Kick）与电钢琴和弦（Keys / Synth Stab）水面重力波事件。
 * 完全确定性、纯时间函数，保证拖动进度条与离线导出逐帧一致。
 */
function buildGrooveSwells(music: Music, seed: number): BassSwellEvent[] {
  const random = rng((seed ^ 0x7e1fe701) >>> 0);
  const out: BassSwellEvent[] = [];

  const bassHits = music.roleHits('bassStab', 0, music.duration);
  const synthHits = music.roleHits('synthStab', 0, music.duration);
  const leadHits = music.roleHits('lead', 0, music.duration);

  const candidates: Array<{ t: number; s: number; warmth: number }> = [];
  for (const [t, s] of bassHits) {
    if (s >= 0.18) candidates.push({ t, s: s * 1.08, warmth: 0.25 });
  }
  for (const [t, s] of synthHits) {
    if (s >= 0.20) candidates.push({ t, s: s * 0.92, warmth: 0.78 });
  }
  for (const [t, s] of leadHits) {
    if (s >= 0.24) candidates.push({ t, s: s * 0.88, warmth: 0.62 });
  }

  // 若旧分析或纯鼓曲目缺少角色事件，回退到底鼓脉冲
  if (candidates.length < 8) {
    for (const [t, s] of music.a.hits.kick ?? []) {
      if (s >= 0.28) candidates.push({ t, s: s * 0.9, warmth: 0.35 });
    }
  }

  candidates.sort((a, b) => a.t - b.t);

  const merged: Array<{ t: number; s: number; warmth: number }> = [];
  for (const c of candidates) {
    const prev = merged[merged.length - 1];
    if (prev && c.t - prev.t < 0.11) {
      if (c.s > prev.s) {
        prev.s = c.s;
        prev.warmth = c.warmth;
      }
      continue;
    }
    merged.push({ ...c });
  }

  let seq = 0;
  for (const item of merged) {
    const { t, s, warmth } = item;
    const pitch = music.pitchAt(t);
    const lane = seq % 4;
    seq++;
    // 结合音高色度角与黄金分割序列，使波包在水廊左中右及远近均匀舒展分布
    const xBase = 0.20 + lane * 0.165;
    const xJitter = ((seq * 0.6180339887 + pitch.note / 12.0 + random() * 0.22) % 1.0) * 0.13;
    const yPhi = (seq * 0.7548776662 + Math.cos(pitch.angle) * 0.16 + random() * 0.18) % 1.0;

    const x = Math.max(0.16, Math.min(0.84, xBase + xJitter));
    const y = 0.16 + 0.68 * yPhi;
    const fg = music.foregroundAt(t);
    const amp = Math.min(1.25, 0.46 + 0.62 * s + 0.20 * fg.level);
    const maxRadius = 0.18 + 0.16 * s + 0.04 * random();
    const tau = 0.72 + 0.26 * random();
    // 宽缓圆润的液态重力波波长（7.5..10.5 周期/单位半径），呈现丝绒般的粘稠流体质感
    const freq = 7.6 + 2.6 * (1.0 - s * 0.35) + 1.2 * warmth;

    out.push({ t, x, y, maxRadius, amp, tau, freq, warmth });
  }

  return out;
}

const VERT = /* glsl */ `precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uCover;
uniform float uTime;
uniform float uFlow;
uniform float uAspect;
// 运行时恒为 0 的动态循环屏障，阻止 D3D11 HLSL fxc 静态展开散景、光栅与水波循环
uniform int uZero;
uniform float uPlayProgress;   // 歌曲播放进度 0..1（驱动唱针在黑胶声槽上的推进位置）
uniform float uPlatterAngle;   // 黑胶外圈恒速旋转角（弧度）
uniform float uSidechain;      // 光学侧链呼吸系数（底鼓瞬间下潜 ~0.78，半拍内回升至 ~1.12）
uniform float uKickPunch;      // 底鼓瞬态微推力 0..1
uniform float uOffbeatHat;     // 反拍开镲高频微光 0..1
uniform float uBassLevel;      // 低频持续浑厚度 0..1
uniform float uKeysGlow;       // 电钢琴/和弦整体暖度 0..1
uniform float uLeadGlow;       // 主旋律/合成器主音持续能量 0..1
uniform float uLeadPulse;      // 主旋律/和弦音头脉冲 0..1
uniform float uFilterOpen;     // 低通滤波器开合度 0..1（0 深潜朦胧，1 晶莹通透）
uniform float uCamShift;       // 摄像机横向视差偏移
uniform float uCamLift;        // 摄像机纵向微俯仰偏移
uniform float uPlatterTilt;    // 黑胶圆盘透视微倾角

// 封面自适应午夜微醺色板（线性空间 RGB）
uniform vec3 uNightAbyss;      // 午夜深渊底色
uniform vec3 uNightFog;        // 丝绒冷雾与深海暗蓝
uniform vec3 uCoverDeep;       // 封面深色基调
uniform vec3 uCoverPrimary;    // 封面核心主色
uniform vec3 uCoverBright;     // 封面高光亮色
uniform vec3 uWarmAmber;       // 钨丝琥珀/香槟暖金辅色（平衡冷暖、点亮唱针与黄铜底座）

// 两侧 12 片磨砂玻璃光栅的实时发光强度（打包为 3 个 vec4，对应 C..B 十二半音）
uniform vec4 uLouvers0;
uniform vec4 uLouvers1;
uniform vec4 uLouvers2;

// 水廊液态暗涌波包：A = (x, y, age, amp), B = (maxRadius, freq, tau, warmth)
uniform vec4 uSwellA[${MAX_SWELLS}];
uniform vec4 uSwellB[${MAX_SWELLS}];

const float HORIZON_Y = ${WATER_HORIZON_Y.toFixed(4)};
const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float getLouverGlow(int idx) {
  if (idx < 4) return idx == 0 ? uLouvers0.x : idx == 1 ? uLouvers0.y : idx == 2 ? uLouvers0.z : uLouvers0.w;
  if (idx < 8) return idx == 4 ? uLouvers1.x : idx == 5 ? uLouvers1.y : idx == 6 ? uLouvers1.z : uLouvers1.w;
  return idx == 8 ? uLouvers2.x : idx == 9 ? uLouvers2.y : idx == 10 ? uLouvers2.z : uLouvers2.w;
}

/**
 * 渲染上半部挑高空间：都会午夜天际散景 + 廊顶侧链体积暖雾 + 12 片电钢琴磨砂玻璃光栅 + 悬浮琥珀黑胶光盘。
 * isReflection = true 时用于水面光学倒影采样（自动省去微细纹理开销并柔和化高频细节）。
 */
vec3 renderLoungeUpper(vec2 uv, bool isReflection) {
  float vanishX = 0.50 - uCamShift * 0.052;
  float vanishY = HORIZON_Y + uCamLift * 0.010;
  float skyH = max(0.0, (uv.y - HORIZON_Y) / (1.0 - HORIZON_Y));

  // ── 1. 都市午夜深邃天幕与低通滤波丝绒大气 ──
  vec3 bgCol = mix(uNightFog * (0.42 + 0.22 * uFilterOpen), uNightAbyss * 0.68, smoothstep(0.0, 0.88, skyH));
  // 地平线远处隐约的暖琥珀与封面色城市天际余晖（受光学侧链呼吸调制）
  float horizonBand = exp(-pow(skyH / (0.22 + 0.08 * uFilterOpen), 2.0));
  vec3 horizonTint = mix(uCoverDeep, uWarmAmber * 0.65, 0.38 + 0.22 * uKeysGlow);
  bgCol += horizonTint * horizonBand * (0.22 + 0.14 * uBassLevel) * uSidechain;

  // 远景双层立体都会天际线与动态建筑灯光（含远近视差、退台塔冠、呼吸窗格、音浪立面扫掠、竖向流光灯带、航空信标与水岸车流）
  if (skyH < 0.42) {
    float valley = 1.0 - 0.45 * exp(-pow((uv.x - vanishX) * 4.3, 2.0));
    float sideFromCenter = uv.x - vanishX;

    for (int layer = uZero; layer < 2; layer++) {
      float fl = float(layer); // 0 = 远景天际建筑群，1 = 中景地标塔楼群（双倍视差）
      float parallax = mix(0.011, 0.026, fl);
      float density = mix(21.0, 13.5, fl);
      float cityCoord = (uv.x - 0.5 - uCamShift * parallax) * uAspect * density + fl * 3.73;
      float towerCell = floor(cityCoord);
      float cellU = fract(cityCoord);

      vec2 tSeed = hash22(vec2(towerCell, 7.13 + fl * 19.7));
      float tRnd = hash12(vec2(towerCell * 1.73 + fl * 11.3, 3.91));

      // 错落建筑间距与宽窄变化：中景塔楼留出呼吸缝隙以透出后方远景楼群灯火，消除生硬连片贴纸感
      float present = step(mix(0.10, 0.26, fl), tSeed.x);
      if (present < 0.5) continue;

      float wSpan = mix(0.80 + 0.16 * tRnd, 0.56 + 0.30 * tRnd, fl);
      float cMid = 0.5 + (tSeed.y - 0.5) * (0.90 - wSpan);
      float bx = (cellU - (cMid - 0.5 * wSpan)) / wSpan;

      float baseH = (mix(0.068, 0.052, fl) + mix(0.19, 0.24, fl) * pow(tSeed.y, 1.50)) * valley;
      bool hasSetback = tSeed.y > 0.44;
      bool hasCrownTier = fl > 0.5 && tSeed.y > 0.72;
      float shaftH = baseH * (hasSetback ? 0.78 : 1.0);
      float tier2H = baseH * (hasCrownTier ? 1.10 : 1.0);

      // 阶梯退台轮廓：主楼身 + 退台塔冠 + 摩天楼顶层缩进段
      // 阶梯退台轮廓：主楼身 + 退台塔冠 + 摩天楼顶层缩进段（连续盒掩码取并集，零水平断层接缝）
      float edgeSoft = mix(0.045, 0.026, fl);
      float topBlur = mix(0.008, 0.004, fl);
      float boxShaft = smoothstep(0.0, edgeSoft, bx) * (1.0 - smoothstep(1.0 - edgeSoft, 1.0, bx))
                     * (1.0 - smoothstep(shaftH - topBlur, shaftH + topBlur, skyH));
      float boxSetback = hasSetback
        ? smoothstep(0.15, 0.15 + edgeSoft, bx) * (1.0 - smoothstep(0.85 - edgeSoft, 0.85, bx))
          * (1.0 - smoothstep(baseH - topBlur, baseH + topBlur, skyH))
        : 0.0;
      float boxCrown = hasCrownTier
        ? smoothstep(0.28, 0.28 + edgeSoft, bx) * (1.0 - smoothstep(0.72 - edgeSoft, 0.72, bx))
          * (1.0 - smoothstep(tier2H - topBlur, tier2H + topBlur, skyH))
        : 0.0;
      float inTower = max(boxShaft, max(boxSetback, boxCrown));
      float topAtX = shaftH;
      if (hasSetback && bx > 0.15 && bx < 0.85) topAtX = baseH;
      if (hasCrownTier && bx > 0.28 && bx < 0.72) topAtX = tier2H;

      // 绑定十二半音色度能量 + 由中心向外扩散的城市音浪波前，使天际大楼随和弦与底鼓产生空间联动
      int towerNote = int(mod(abs(towerCell) * 5.0 + fl * 4.0, 12.0));
      float chromaGlow = getLouverGlow(towerNote);
      float outwardPhase = fract(abs(sideFromCenter) * uAspect * 1.15 - uFlow * 0.28);
      float cityRipple = exp(-pow((outwardPhase - 0.35) / 0.18, 2.0)) * (0.35 * uBassLevel + 0.65 * uKeysGlow);
      float musicDrive = clamp(0.48 * chromaGlow + 0.38 * uKeysGlow + 0.38 * uLeadGlow + 0.52 * uLeadPulse + 0.42 * cityRipple, 0.0, 1.45);

      if (inTower > 0.004) {
        float hn = clamp(skyH / max(tier2H, 0.04), 0.0, 1.0);
        // 三维双立面受光转折：朝向中央琥珀黑胶的一侧受暖光漫射，背光侧沉入冷夜暗影，立面折角带微高光棱线
        float ridgeX = 0.34 + 0.32 * tRnd;
        float faceLit = sideFromCenter < 0.0 ? smoothstep(ridgeX - 0.05, ridgeX + 0.05, bx)
                                             : 1.0 - smoothstep(ridgeX - 0.05, ridgeX + 0.05, bx);
        float cornerRidge = exp(-pow((bx - ridgeX) / 0.036, 2.0));

        vec3 darkFacade = mix(uNightAbyss * mix(0.48, 0.30, fl), uNightFog * 0.40, 0.26 * (1.0 - fl));
        vec3 litFacade = mix(darkFacade, mix(uCoverDeep, uWarmAmber * 0.48, 0.44) * (0.36 + 0.16 * cityRipple), 0.38 + 0.36 * hn);
        vec3 hullCol = mix(darkFacade, litFacade, faceLit * (0.55 + 0.45 * uFilterOpen));
        hullCol += mix(uCoverPrimary, uWarmAmber, 0.58) * cornerRidge * (0.035 + 0.095 * musicDrive) * fl;

        // 沿楼体自下而上流淌的聚焦音浪扫掠光带（随和弦、主旋律与横向城市波前起伏唤醒幕墙）
        float sweepPos = fract(uFlow * (0.24 + 0.15 * tRnd) + tSeed.x);
        float dSweep = abs(hn - sweepPos);
        dSweep = min(dSweep, 1.0 - dSweep);
        float sweepBand = exp(-pow(dSweep / 0.095, 2.0)) * (0.30 + 0.85 * musicDrive);

        // 错落有致的动态窗格：含房间呼吸明灭、音浪扫掠逐层点亮与反拍星烁
        float bays = floor(3.0 + 4.0 * tRnd + fl * 2.0);
        float floorScale = mix(118.0, 88.0, fl);
        vec2 winGrid = vec2(bx * bays, skyH * floorScale);
        vec2 winId = floor(winGrid);
        vec2 winFrac = fract(winGrid);

        float floorHash = hash12(vec2(winId.y, towerCell * 2.3 + fl * 7.1));
        float cellHash = hash12(winId + vec2(towerCell * 3.1, 1.7 + fl * 5.3));
        // 双速动态窗灯：大多数房间慢速柔和呼吸，约 25% 活跃窗格随节拍与旋律灵动明灭
        float liveRate = cellHash > 0.74 ? (1.15 + 1.35 * floorHash) : (0.38 + 0.62 * cellHash);
        float slowWave = 0.5 + 0.5 * sin(uTime * liveRate + cellHash * TAU + floorHash * 4.0);
        float baseOcc = step(mix(0.77, 0.69, fl), cellHash * 0.72 + floorHash * 0.38) * smoothstep(0.18, 0.58, slowWave);
        float sweepWake = step(0.46, hash12(winId + 13.7)) * smoothstep(0.08, 0.36, sweepBand + 0.24 * chromaGlow);
        float winActive = max(baseOcc * (0.45 + 0.55 * slowWave), sweepWake);

        float winMaskX = isReflection ? 0.62
          : smoothstep(0.12, 0.26, winFrac.x) * (1.0 - smoothstep(0.74, 0.88, winFrac.x));
        float winMaskY = isReflection
          ? smoothstep(0.15, 0.42, winFrac.y) * (1.0 - smoothstep(0.62, 0.90, winFrac.y))
          : smoothstep(0.20, 0.36, winFrac.y) * (1.0 - smoothstep(0.68, 0.84, winFrac.y));

        float hatShimmer = 1.0 + step(0.76, cellHash) * uOffbeatHat * (0.65 + 0.55 * sin(uTime * 6.5 + cellHash * 19.0));
        vec3 baseWinCol = mix(uWarmAmber, mix(uCoverBright, vec3(1.0, 0.96, 0.88), 0.42), hash12(winId + 9.2) * 0.82);
        vec3 sweepWinCol = mix(uCoverBright, vec3(1.0, 0.94, 0.80), 0.45 + 0.35 * sin(hn * 4.0 + tSeed.x * TAU));
        vec3 winCol = mix(baseWinCol, sweepWinCol, clamp(sweepBand * 0.82, 0.0, 0.85));

        float winLum = (0.052 + 0.095 * uFilterOpen + 0.22 * sweepBand + 0.11 * chromaGlow + 0.07 * cityRipple) * hatShimmer * uSidechain;
        hullCol += winCol * winActive * winMaskX * winMaskY * winLum * mix(0.65, 1.0, fl);
        // 音浪扫过楼层时的幕墙玻璃柔和漫射光晕
        hullCol += sweepWinCol * sweepBand * (0.032 + 0.048 * musicDrive) * (0.45 + 0.55 * faceLit) * fl;

        // 地标高楼竖向棱角流光灯条 / 观光梯流光梭（沿立面折角或内侧边缘向上游走）
        if (fl > 0.5 && tSeed.y > 0.32 && tRnd > 0.28) {
          float stripPos = tRnd > 0.62 ? ridgeX : (sideFromCenter < 0.0 ? 0.80 : 0.20);
          float stripMask = exp(-pow((bx - stripPos) / (isReflection ? 0.048 : 0.022), 2.0));
          float shuttleDir = tRnd > 0.5 ? 1.0 : -1.0;
          float shuttlePos = fract(uFlow * shuttleDir * (0.28 + 0.16 * tRnd) + tSeed.y);
          float dShuttle = abs(hn - shuttlePos);
          dShuttle = min(dShuttle, 1.0 - dShuttle);
          float shuttle = 0.18 + 0.82 * exp(-pow(dShuttle / 0.11, 2.0));
          vec3 stripCol = mix(uWarmAmber, mix(uCoverBright, vec3(1.0, 0.96, 0.88), 0.35), 0.35 + 0.50 * chromaGlow);
          hullCol += stripCol * stripMask * shuttle * (0.065 + 0.24 * musicDrive + 0.08 * uFilterOpen) * uSidechain;
        }

        // 高层退台露台灯带与塔冠顶部水平轮廓光（Penthouse & Setback Terrace Trim）
        if (tSeed.y > 0.40) {
          float crownBand = exp(-pow((skyH - topAtX + 0.0042) / 0.0048, 2.0));
          if (hasSetback) {
            crownBand = max(crownBand, 0.72 * exp(-pow((skyH - shaftH + 0.0038) / 0.0042, 2.0)));
          }
          vec3 crownCol = mix(uWarmAmber, mix(uCoverBright, vec3(1.0, 0.95, 0.85), 0.35), 0.32 + 0.52 * tRnd);
          hullCol += crownCol * crownBand * (0.095 + 0.26 * chromaGlow + 0.18 * uLeadPulse + 0.10 * cityRipple) * mix(0.58, 1.0, fl) * uSidechain;
        }

        // 远近大气雾化遮挡融合：中景塔楼自然遮挡远景塔楼与夜空背景
        float hullAlpha = inTower * mix(0.66, 0.88, fl) * (0.52 + 0.48 * uFilterOpen);
        bgCol = mix(bgCol, hullCol, hullAlpha);
      }

      // 地标摩天楼顶柔和建筑天际投光束 + 航空障碍信标灯
      if (fl > 0.5 && tSeed.y > 0.56 && bx > -0.20 && bx < 1.20) {
        // 少数超高层塔冠向上散射的柔和建筑雾光柱（随和弦与主旋律微幅摇曳呼吸）
        if (tSeed.y > 0.68 && tRnd > 0.52 && skyH >= tier2H - 0.004) {
          float aboveH = skyH - tier2H;
          float sway = sin(uTime * (0.45 + 0.25 * tRnd) + towerCell * 1.9) * 0.18;
          float beamCenter = 0.5 + sway * aboveH * 3.2;
          float beamHalfW = 0.12 + aboveH * 1.35;
          float upBeam = exp(-pow((bx - beamCenter) / beamHalfW, 2.0)) * exp(-aboveH / 0.095);
          vec3 upCol = mix(uWarmAmber, uCoverBright, 0.45);
          bgCol += upCol * upBeam * (0.025 + 0.085 * musicDrive) * uFilterOpen * uSidechain;
        }

        bool hasSpire = tRnd > 0.44;
        float spireTop = tier2H + (hasSpire ? 0.026 + 0.022 * tRnd : 0.004);
        if (hasSpire && skyH >= tier2H - 0.002 && skyH <= spireTop) {
          float spireMask = exp(-pow((bx - 0.5) / 0.022, 2.0)) * (1.0 - smoothstep(spireTop - 0.006, spireTop, skyH));
          bgCol += mix(uNightFog, uWarmAmber, 0.58) * spireMask * (0.16 + 0.10 * musicDrive);
        }
        vec2 bDelta = vec2((cellU - cMid) / density * 14.0, (skyH - spireTop) * (1.0 - HORIZON_Y) * 14.0);
        float bDist2 = dot(bDelta, bDelta);
        if (bDist2 < 0.06) {
          float blinkWave = 0.5 + 0.5 * sin(uTime * (2.4 + 1.2 * tRnd) + towerCell * 2.37);
          float blink = pow(blinkWave, 6.0);
          blink = max(blink, (0.38 + 0.62 * blinkWave) * (0.50 * uKickPunch + 0.45 * uLeadPulse));
          float core = exp(-bDist2 / 0.0012);
          float halo = exp(-bDist2 / 0.012);
          vec3 beaconCol = mix(vec3(1.0, 0.38, 0.22), mix(uWarmAmber, uCoverBright, 0.5), 0.48);
          bgCol += beaconCol * (core * 0.42 + halo * 0.11) * blink * (0.55 + 0.45 * uFilterOpen);
        }
      }
    }

    // 远景水岸长桥与滨水大道缓慢流动的微型车河光珠（锚定建筑底部与水面交界，增添都会烟火气）
    if (skyH < 0.018) {
      float roadBand = exp(-pow((skyH - 0.0055) / 0.0042, 2.0)) * (0.45 + 0.55 * valley);
      float laneA = (uv.x - uCamShift * 0.022) * uAspect * 46.0 + uTime * 0.55;
      float laneB = (uv.x - uCamShift * 0.022) * uAspect * 54.0 - uTime * 0.48 + 11.3;
      float idA = floor(laneA), fA = fract(laneA);
      float idB = floor(laneB), fB = fract(laneB);
      float carA = step(0.62, hash12(vec2(idA, 31.7))) * exp(-pow((fA - 0.5) / 0.20, 2.0));
      float carB = step(0.66, hash12(vec2(idB, 47.3))) * exp(-pow((fB - 0.5) / 0.20, 2.0));
      vec3 headCol = mix(uWarmAmber, vec3(1.0, 0.96, 0.88), 0.45);
      vec3 tailCol = mix(uCoverPrimary, vec3(1.0, 0.42, 0.28), 0.42);
      bgCol += (headCol * carA * 0.10 + tailCol * carB * 0.085) * roadBand * (0.50 + 0.50 * uFilterOpen) * uSidechain;
    }
  }

  // ── 2. 变形宽银幕都会散景光斑 (Anamorphic Oval Bokeh) —— 随反拍开镲微闪 ──
  if (skyH < 0.72) {
    vec2 bokehSpace = vec2((uv.x - vanishX) * uAspect, skyH);
    for (int i = uZero; i < 10; i++) {
      float fi = float(i);
      vec2 seed = hash22(vec2(fi * 4.17 + 1.3, fi * 7.91 + 2.6));
      float bx = (seed.x - 0.5) * 1.55 + sin(uTime * 0.12 + fi * 1.7) * 0.025;
      float by = 0.04 + seed.y * 0.42 + cos(uTime * 0.10 + fi * 2.3) * 0.012;
      // 避开正中央黑胶核心区，营造通透环绕景深
      if (abs(bx) < 0.22 && by > 0.16 && by < 0.52) bx += (bx >= 0.0 ? 0.24 : -0.24);
      // 变形镜头竖向椭圆光斑 (Anamorphic 1 : 1.85)
      vec2 d = (bokehSpace - vec2(bx, by)) / vec2(0.030 + 0.024 * seed.y, 0.056 + 0.042 * seed.y);
      float r2 = dot(d, d);
      if (r2 < 1.35) {
        float disc = (1.0 - smoothstep(0.62, 1.05, sqrt(r2)));
        float softRing = 0.65 + 0.35 * smoothstep(0.35, 0.82, sqrt(r2));
        float hatTwinkle = 1.0 + (0.45 + 0.35 * sin(fi * 3.1 + uTime * 5.0)) * uOffbeatHat;
        vec3 bCol = mix(uWarmAmber, uCoverBright, fract(fi * 0.37));
        bgCol += bCol * disc * softRing * (0.055 + 0.065 * uFilterOpen) * hatTwinkle * uSidechain;
      }
    }
  }

  // ── 3. 廊顶天窗洒下的「光学侧链」丝绒体积光锥 (Optical Sidechain Volumetric Haze) ──
  float dxCenter = (uv.x - vanishX) * uAspect;
  float coneHalfW = mix(0.52, 0.24, skyH);
  float inCone = exp(-pow(dxCenter / coneHalfW, 2.0));
  float hazeNoise = noise2(vec2(dxCenter * 4.2 + uFlow * 0.06, skyH * 3.5 - uFlow * 0.08));
  float volumetricBeam = inCone * (0.68 + 0.32 * hazeNoise) * (0.32 + 0.68 * smoothstep(0.0, 0.95, skyH));
  // 侧链核心：采用非线性呼吸幂次，使底鼓瞬间体积光明显内敛深潜，反拍半拍丝滑舒展回满
  float scPower = pow(max(0.25, uSidechain), 1.85);
  vec3 beamTint = mix(uCoverPrimary * 0.65, uWarmAmber * 0.90, 0.46 + 0.22 * skyH);
  bgCol += beamTint * volumetricBeam * (0.14 + 0.11 * uFilterOpen + 0.08 * uKeysGlow) * scPower;

  // ── 4. 两侧透视纵深排列的 12 片包豪斯磨砂玻璃光栅 (12-Note Frosted Glass Louvers) ──
  // 空间包围盒早退：仅在左右廊道区域求值，中央黑胶舞台区域直接跳过
  float absCorridorX = abs(dxCenter);
  if (absCorridorX > 0.20 && absCorridorX < 0.96) {
    float side = dxCenter < 0.0 ? -1.0 : 1.0;
    int sideOffset = side < 0.0 ? 0 : 6;
    // 从远到近遍历单侧 6 片玻璃屏风，近处自然半透明叠盖远处
    for (int k = 5 + uZero; k >= 0; k--) {
      float fk = float(k); // 0 = 最靠近镜头外侧，5 = 最靠近远景内侧
      float depthT = fk / 5.0; // 0..1
      // 透视深度分布：近处宽大靠外，远处收拢向消失点
      float zPersp = mix(1.0, 2.85, depthT);
      float finCenterX = side * (0.82 / zPersp + 0.055);
      float finHalfW = 0.036 / zPersp;
      float finTopH = min(0.96, 0.86 / pow(zPersp, 0.58) + 0.06);

      float localX = (dxCenter - finCenterX) * (-side); // +1 朝向廊道内侧受光棱，-1 朝向外侧暗部
      if (abs(localX) <= finHalfW * 1.35 && skyH <= finTopH + 0.02) {
        int noteIdx = sideOffset + k;
        float noteGlow = getLouverGlow(noteIdx);

        // 斜切透视顶边（内侧略低、外侧略高，呈现立体建筑叶片内旋角度）
        float uAcross = clamp((localX + finHalfW) / (2.0 * finHalfW), 0.0, 1.0); // 0 外缘 -> 1 内侧倒角亮棱
        float topSlope = finTopH - 0.018 * (uAcross - 0.5) / zPersp;
        float inFinX = smoothstep(0.0, 0.06, uAcross) * (1.0 - smoothstep(0.94, 1.0, uAcross));
        float inFinY = 1.0 - smoothstep(topSlope - 0.008, topSlope + 0.004, skyH);
        float finMask = inFinX * inFinY;

        if (finMask > 0.004) {
          // 磨砂玻璃透射底色（柔和压暗后方背景，形成高级烟熏毛玻璃体积感）
          vec3 glassBase = mix(uNightAbyss * 0.72, uCoverDeep * 0.48, 0.35 + 0.25 * uFilterOpen);
          bgCol = mix(bgCol, glassBase, finMask * (0.48 + 0.16 * (1.0 - depthT)));

          // 次表面和弦暖光：由底部黄铜灯槽向上漫射，随对应半音电钢琴/和弦强度点亮
          float verticalFalloff = exp(-skyH / (0.28 + 0.34 * noteGlow));
          float idleWarmth = 0.10 + 0.08 * uSidechain;
          float activeGlow = idleWarmth + 1.25 * noteGlow;

          vec3 finHue = mix(uCoverPrimary, uWarmAmber, 0.45 + 0.35 * uAcross);
          vec3 subsurface = finHue * verticalFalloff * activeGlow * (0.36 + 0.44 * uAcross);

          // 朝向中央黑胶的 45° 精密光学倒角亮棱 (Beveled Inner Rim)
          float innerBevel = exp(-pow((uAcross - 0.93) / 0.055, 2.0)) * inFinY;
          vec3 bevelLight = mix(uWarmAmber, vec3(1.0, 0.96, 0.88), 0.38 * noteGlow)
                          * innerBevel * (0.20 * uSidechain + 0.95 * noteGlow);

          // 顶部倒角微光与底部拉丝暖黄铜卡槽 (Warm Brass Base Shoe)
          float topRim = exp(-pow((skyH - topSlope) / 0.005, 2.0)) * inFinX;
          float brassShoe = (1.0 - smoothstep(0.012 / zPersp, 0.020 / zPersp, skyH)) * inFinX;
          vec3 brassCol = mix(uWarmAmber * 0.55, vec3(0.95, 0.76, 0.45), 0.5) * (0.35 + 0.65 * noteGlow);

          bgCol += (subsurface + bevelLight + finHue * topRim * (0.12 + 0.35 * noteGlow)) * finMask;
          bgCol = mix(bgCol, brassCol, brassShoe * 0.85);
        }

        // 和弦强奏时玻璃屏风周围的柔和空气光晕
        if (noteGlow > 0.05) {
          float haloX = exp(-pow(localX / (finHalfW * 1.45), 2.0));
          float haloY = exp(-skyH / 0.42);
          bgCol += mix(uCoverPrimary, uWarmAmber, 0.55) * haloX * haloY * noteGlow * 0.14;
        }
      }
    }
  }

  // ── 5. 中央悬浮琥珀黑胶封面光学圆盘 (Floating Translucent Amber-Vinyl Cover Platter) ──
  vec2 platterCenter = vec2(vanishX, HORIZON_Y + 0.285 + uCamLift * 0.015 + 0.004 * sin(uTime * 1.35));
  float platterRadius = 0.215 + 0.005 * uKickPunch;

  // 包围盒早退：仅在圆盘与唱臂邻域内求值
  vec2 dpRaw = vec2((uv.x - platterCenter.x) * uAspect, uv.y - platterCenter.y);
  if (abs(dpRaw.x) < 0.34 && abs(dpRaw.y) < 0.31) {
    // 轻微三维透视微倾，展现悬浮装置的空间感
    vec2 dp = rot2(dpRaw, uPlatterTilt * 0.18);
    dp.y /= (1.0 - abs(uPlatterTilt) * 0.10);
    float r = length(dp) / platterRadius;
    float aa = max(fwidth(r), 0.0025);

    // 5A. 圆盘背后的「光学侧链」琥珀日冕柔光 (Sidechain Backlight Corona)
    if (r < 1.55) {
      float corona = exp(-pow(max(0.0, r - 0.82) / 0.28, 2.0)) * (1.0 - 0.35 * smoothstep(0.0, 0.85, r));
      vec3 coronaCol = mix(uCoverPrimary, uWarmAmber, 0.52);
      bgCol += coronaCol * corona * (0.26 + 0.18 * uBassLevel + 0.16 * uKeysGlow) * uSidechain;
    }

    // 5B. 黑胶本体与中央高保真封面盘心 (r <= 1.025)
    if (r <= 1.025) {
      float discAlpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
      float ang = atan(dp.y, dp.x);
      float scHalo = pow(max(0.25, uSidechain), 1.65);

      vec3 platterCol = uNightAbyss * 0.50;
      float labelRadius = 0.50; // 中央封面圆标占半径 50%，大而清晰，无重复文字鬼影

      if (r > 0.965) {
        // 外缘半透明烟熏琥珀倒角亮环 + DJ 测速频闪点阵 (Strobe Timing Dots)
        float rimGlow = exp(-pow((r - 0.988) / 0.015, 2.0));
        float strobeAng = ang - uPlatterAngle;
        float strobeDots = smoothstep(0.32, 0.68, sin(strobeAng * 96.0))
                         * smoothstep(0.968, 0.974, r) * (1.0 - smoothstep(0.990, 0.996, r));
        platterCol = mix(bgCol * 0.55 + uNightAbyss * 0.45, uWarmAmber, 0.38 * rimGlow + 0.46 * strobeDots * scHalo);
        platterCol += mix(uCoverBright, uWarmAmber, 0.65) * rimGlow * (0.44 * scHalo + 0.32 * uKickPunch);
      } else if (r >= labelRadius) {
        // 纯净半透明烟熏琥珀/茶晶黑胶声槽区：柔和折射后方廊道天际线与封面径向柔晕，杜绝重复封面文字重影
        float grooveU = (0.965 - r) / (0.965 - labelRadius); // 0 外缘开始 -> 1 内圈结束
        float innerWarmth = pow(grooveU, 1.5);
        vec3 smokedAcrylic = mix(uNightAbyss * 0.36, mix(uCoverDeep, uWarmAmber * 0.52, 0.52), 0.58);
        vec3 radialAura = mix(uWarmAmber * 0.22, uCoverPrimary * 0.38, innerWarmth);
        platterCol = bgCol * 0.38 + smokedAcrylic * 0.72 + radialAura * (0.45 + 0.35 * scHalo);

        if (!isReflection) {
          // 抗锯齿精密同心微声槽（fwidth 自动衰减避免摩尔纹）
          float grooveFreq = 205.0;
          float grooveFade = clamp(1.0 - fwidth(r * grooveFreq) * 1.45, 0.0, 1.0);
          float microGroove = sin((r * grooveFreq + uPlatterAngle * 0.15) * TAU) * grooveFade;
          platterCol *= 1.0 + 0.095 * microGroove;
        }

        // 双束各向异性黑胶丝缎反光扇（随顶光固定方向，声槽在其下恒速流转）
        float sheen1 = pow(max(0.0, cos(ang - 1.10)), 8.0);
        float sheen2 = pow(max(0.0, cos(ang + 2.04)), 10.0);
        float sheen = (sheen1 * 0.90 + sheen2 * 0.70) * (0.52 + 0.48 * uFilterOpen);
        platterCol += mix(uCoverBright, uWarmAmber, 0.62) * sheen * 0.28 * scHalo;

        // 正在播放的暖琥珀声轨能量环 & 低频脉冲波纹
        float playDist = abs(grooveU - uPlayProgress);
        float playTrack = exp(-pow(playDist / 0.020, 2.0));
        float bassRingPos = fract(uFlow * 0.30);
        float bassWave = exp(-pow((grooveU - bassRingPos) / 0.062, 2.0)) * uBassLevel;
        platterCol += uWarmAmber * playTrack * (0.45 + 0.40 * uKeysGlow + 0.28 * uOffbeatHat);
        platterCol += mix(uCoverPrimary, uWarmAmber, 0.4) * bassWave * 0.26 * scHalo;

        // 内外压环阴影过渡
        platterCol *= smoothstep(labelRadius - 0.004, labelRadius + 0.022, r);
      } else {
        // 中央高保真专辑封面盘心（端正清晰呈现，仅带极轻微呼吸角度，不天旋地转，保证封面构图优雅可读！）
        vec2 coverUv = clamp(dpRaw / (platterRadius * labelRadius * 1.96) + 0.5, 0.005, 0.995);
        vec3 coverTex = textureLod(uCover, coverUv, 0.0).rgb;
        // 保持封面原生鲜明色彩，仅在边缘做精致的黑胶圆标压纹暗角与黄铜金圈镶边
        float edgeVignette = 1.0 - 0.16 * smoothstep(labelRadius * 0.78, labelRadius, r);
        platterCol = coverTex * edgeVignette * (0.90 + 0.12 * scHalo);

        // 中心精密黑胶主轴孔 (Spindle) 与黄铜金属内环
        float spindleHole = 1.0 - smoothstep(0.026, 0.032 + aa, r);
        float spindleBrass = exp(-pow((r - 0.038) / 0.006, 2.0));
        platterCol = mix(platterCol, uNightAbyss * 0.35, spindleHole * 0.88);
        platterCol += uWarmAmber * spindleBrass * 0.52;
      }

      // 盘心与黑胶声槽交界处的拉丝香槟金压环 (Pressed Brass Collar)
      float labelCollar = exp(-pow((r - labelRadius) / 0.0070, 2.0));
      platterCol += mix(uWarmAmber, vec3(1.0, 0.94, 0.82), 0.38) * labelCollar * (0.42 + 0.26 * scHalo);

      bgCol = mix(bgCol, platterCol, discAlpha * 0.96);
    }

    // 5C. 右侧包豪斯精密悬浮唱臂与钨丝唱针星芒 (Audiophile Gimbal Tonearm & Warm Stylus Glint)
    if (!isReflection) {
      float stylusR = mix(0.945, 0.525, clamp(uPlayProgress, 0.0, 1.0));
      float stylusAng = -0.26; // 落在右侧偏下黄金视觉位
      vec2 stylusPos = vec2(cos(stylusAng), sin(stylusAng)) * (stylusR * platterRadius);
      vec2 pivotPos = vec2(0.262, 0.148); // 右上方悬浮万向节支点
      vec2 armDir = normalize(pivotPos - stylusPos);
      vec2 armNorm = vec2(-armDir.y, armDir.x);

      // 折角唱头壳拐点 (J-shaped Headshell Knee) + 后置配重锤端点 (Counterweight)
      vec2 kneePos = stylusPos + armDir * 0.034 + armNorm * 0.0065;
      vec2 counterEnd = pivotPos + armDir * 0.034;

      // 主唱臂管段 (pivot -> knee) 与配重延长段 (pivot -> counterEnd)
      vec2 pa1 = dp - kneePos, ba1 = counterEnd - kneePos;
      float h1 = clamp(dot(pa1, ba1) / dot(ba1, ba1), 0.0, 1.0);
      vec2 off1 = pa1 - ba1 * h1;
      float dArmMain = length(off1);

      // 唱头壳前段 (stylus -> knee)
      vec2 pa2 = dp - stylusPos, ba2 = kneePos - stylusPos;
      float h2 = clamp(dot(pa2, ba2) / dot(ba2, ba2), 0.0, 1.0);
      float dHead = length(pa2 - ba2 * h2);

      // 后置精密配重锤加粗段
      vec2 paCw = dp - (pivotPos + armDir * 0.012), baCw = armDir * 0.020;
      float hCw = clamp(dot(paCw, baCw) / dot(baCw, baCw), 0.0, 1.0);
      float dCw = length(paCw - baCw * hCw);

      float tubeMask = 1.0 - smoothstep(0.0020, 0.0036, dArmMain);
      float headMask = 1.0 - smoothstep(0.0032, 0.0050, dHead);
      float cwMask = 1.0 - smoothstep(0.0068, 0.0086, dCw);

      // 万向节双层金属支点座 (Gimbal Base Ring + Satin Cap)
      float dPivot = length(dp - pivotPos);
      float gimbalOuter = 1.0 - smoothstep(0.0155, 0.0178, dPivot);
      float gimbalRing = exp(-pow((dPivot - 0.0135) / 0.0022, 2.0));
      float gimbalCap = 1.0 - smoothstep(0.0075, 0.0095, dPivot);

      // 圆柱金属高光脊线
      float cylSpec = exp(-pow(dot(off1, armNorm) / 0.0014, 2.0));
      vec3 gunmetal = vec3(0.09, 0.095, 0.11);
      vec3 champagneBrass = mix(uWarmAmber * 0.85, vec3(0.96, 0.88, 0.72), 0.35);

      vec3 armCol = mix(gunmetal, champagneBrass, 0.38 + 0.48 * cylSpec);
      float totalArmMask = max(max(tubeMask, headMask), cwMask);
      bgCol = mix(bgCol, armCol, totalArmMask * 0.94);
      bgCol = mix(bgCol, mix(gunmetal, champagneBrass * 0.55, 0.25), gimbalOuter * 0.94);
      bgCol += champagneBrass * (gimbalRing * 0.65 + gimbalCap * 0.55);

      // 唱针钻石落点温暖钨丝星芒（随反拍开镲与电钢琴和弦闪耀）
      vec2 dStylus = dp - stylusPos;
      float stylusDist = length(dStylus);
      float needleCore = exp(-pow(stylusDist / 0.0060, 2.0));
      float needleFlareX = exp(-abs(dStylus.y) / 0.0016) * exp(-abs(dStylus.x) / 0.025);
      float needleFlareY = exp(-abs(dStylus.x) / 0.0016) * exp(-abs(dStylus.y) / 0.017);
      float glintBoost = 0.72 + 0.58 * uOffbeatHat + 0.45 * uKeysGlow + 0.30 * uKickPunch;
      vec3 glintCol = mix(uWarmAmber, vec3(1.0, 0.97, 0.90), 0.55);
      bgCol += glintCol * (needleCore * 1.15 + (needleFlareX + needleFlareY) * 0.46) * glintBoost;
    }
  }

  return max(bgCol, vec3(0.0));
}

struct BasaltWaterSurface {
  float waterDepth;
  float wx;
  float wz;
  float distFade;
  float ambientW1;
  float ambientW2;
  float causticEnergy;
  float swellWarmMix;
  vec2 waveGrad;
  vec3 basaltCol;
  vec2 reflUv;
};

/**
 * 预处理下方三分之一玄武岩薄水廊几何、贝斯暗涌波包与光学倒影 UV，
 * 以便在 main() 中与上半部空间共用单次 renderLoungeUpper 调用，消除 285 行上半场函数的双重内联。
 */
BasaltWaterSurface prepareBasaltWaterPool(vec2 uv) {
  float vanishX = 0.50 - uCamShift * 0.052;
  // waterDepth: 0 = 屏幕最底端近景，1 = 远处水廊地平线
  float waterDepth = clamp(uv.y / HORIZON_Y, 0.0, 0.996);
  // 真实三维射线-平面透视投影距离 zWorld (近处 ~1.0，地平线处平滑延伸至 ~15.0)
  float eyeDist = 1.0 / max(0.065, 1.0 - waterDepth * 0.935);
  float wx = (uv.x - vanishX) * uAspect * eyeDist;
  float wz = eyeDist + uFlow * 0.35;

  // ── 1. 深色拉丝玄武岩石板地基 (Dark Brushed-Basalt Architectural Floor) ──
  // 建筑石板宽幅接缝与各向异性微拉丝质感
  float seamX = exp(-pow( abs(fract(wx * 0.55 + 0.5) - 0.5) / (0.018 * eyeDist), 2.0 ));
  float seamZ = exp(-pow( abs(fract(wz * 0.35) - 0.5) / (0.022 * eyeDist), 2.0 ));
  float brushedGrain = noise2(vec2(wx * 22.0, wz * 3.5)) * 0.5 + noise2(vec2(wx * 48.0, wz * 7.0)) * 0.5;
  float distFade = exp(-0.18 * (eyeDist - 1.0));

  vec3 basaltCol = mix(uNightAbyss * 0.36, uCoverDeep * 0.22, 0.35);
  basaltCol *= 0.88 + 0.24 * brushedGrain * distFade;
  // 石板湿润暗缝
  basaltCol *= 1.0 - 0.28 * max(seamX, seamZ) * distFade;

  // ── 2. 双模态物理水波场：高粘度贝斯重力波 + 反拍高频焦散微澜 ──
  vec2 waveGrad = vec2(0.0);
  float causticEnergy = 0.0;
  float swellWarmMix = 0.4;

  // 2A. 连续微风与低频驻波底纹（丝滑大尺度涌动）
  float ambientW1 = sin(wx * 2.4 + wz * 1.6 - uFlow * 1.45);
  float ambientW2 = cos(wx * 1.7 - wz * 2.1 + uFlow * 1.15);
  waveGrad += vec2(
    cos(wx * 2.4 + wz * 1.6 - uFlow * 1.45) * 0.0085,
    sin(wx * 1.7 - wz * 2.1 + uFlow * 1.15) * 0.0065
  ) * (0.55 + 0.65 * uBassLevel) * distFade;

  // 2B. 预提取的贝斯/电钢琴高粘度重力暗涌波包
  vec2 poolPos = vec2(uv.x, waterDepth);
  for (int i = uZero; i < ${MAX_SWELLS}; i++) {
    vec4 a = uSwellA[i]; // (x, y, age, amp)
    if (a.w <= 0.002) continue;
    vec4 b = uSwellB[i]; // (maxRadius, freq, tau, warmth)

    // 透视椭圆度校正：越靠近地平线的波包在屏幕纵向上越扁平，符合真实三维水平水面透视！
    float perspSquash = mix(0.62, 0.20, a.y);
    vec2 dp = vec2((poolPos.x - a.x) * uAspect, (poolPos.y - a.y) / perspSquash);
    float dist = length(dp);
    float front = b.x * (1.0 - exp(-a.z / max(0.15, b.z)));

    if (dist < front + 0.14) {
      float env = exp(-a.z / (b.z * 2.1))
                * exp(-pow((dist - front * 0.78) / max(0.055, front * 0.48), 2.0))
                * (1.0 - smoothstep(front, front + 0.09, dist));
      float phase = (dist - front) * b.y * TAU;
      float dWave = cos(phase) * env * a.w;
      vec2 dir = dp / max(dist, 1e-4);
      waveGrad += dir * dWave * 0.022;
      causticEnergy += max(0.0, sin(phase)) * env * a.w;
      swellWarmMix = mix(swellWarmMix, b.w, clamp(env * a.w, 0.0, 0.6));
    }
  }

  // 2C. 反拍开镲 (Off-beat Open Hat) 细腻横向水纹微澜
  float hatRipple = sin(wz * 16.0 - uTime * 9.0 + wx * 3.0) * distFade;
  waveGrad.y += hatRipple * 0.0045 * (0.20 + 0.80 * uOffbeatHat);

  // ── 3. 全场景真实光学倒影与菲涅尔掠射混合 ──
  // 镜像纵坐标：以 HORIZON_Y 为轴翻转至上半部空间，并叠加透视衰减的水波折射偏移
  vec2 reflUv = vec2(
    clamp(uv.x + waveGrad.x * (0.85 - 0.45 * waterDepth), 0.004, 0.996),
    clamp(HORIZON_Y + (HORIZON_Y - uv.y) * 1.04 + waveGrad.y * 0.72, HORIZON_Y + 0.003, 0.995)
  );
  return BasaltWaterSurface(
    waterDepth,
    wx,
    wz,
    distFade,
    ambientW1,
    ambientW2,
    causticEnergy,
    swellWarmMix,
    waveGrad,
    basaltCol,
    reflUv
  );
}

vec3 shadeBasaltWaterPool(BasaltWaterSurface ws, vec3 reflCol) {
  float waterDepth = ws.waterDepth;
  float wx = ws.wx;
  float wz = ws.wz;
  float distFade = ws.distFade;
  float ambientW1 = ws.ambientW1;
  float ambientW2 = ws.ambientW2;
  float causticEnergy = ws.causticEnergy;
  float swellWarmMix = ws.swellWarmMix;
  vec2 waveGrad = ws.waveGrad;
  vec3 basaltCol = ws.basaltCol;

  // 菲涅尔反射率：镜头脚下近处透出深沉湿润玄武岩（反射约 0.34），向远处水廊地平线平滑升至镜面（反射约 0.86）
  float fresnel = mix(0.34, 0.86, pow(waterDepth, 1.25));
  vec3 waterCol = mix(basaltCol, reflCol * (0.78 + 0.16 * uSidechain), fresnel);

  // ── 4. 水波背坡暖琥珀焦散金边与反拍香槟微闪 (Caustics & Off-beat Glints) ──
  float backSlope = clamp(-waveGrad.y * 26.0 + abs(waveGrad.x) * 12.0, 0.0, 1.2);
  vec3 causticTint = mix(uCoverBright, uWarmAmber, 0.45 + 0.40 * swellWarmMix);
  waterCol += causticTint * (backSlope * 0.22 + causticEnergy * 0.16) * (0.65 + 0.35 * uFilterOpen) * uSidechain;

  // 反拍开镲在水面波峰激起的细腻星点微光
  if (uOffbeatHat > 0.02) {
    float sparkleField = noise2(vec2(wx * 9.5 + uFlow * 0.8, wz * 6.5 - uFlow * 1.2));
    float glint = smoothstep(0.76, 0.95, sparkleField + 0.10 * ambientW1 * ambientW2) * distFade;
    waterCol += mix(uWarmAmber, vec3(1.0, 0.97, 0.90), 0.5) * glint * uOffbeatHat * 0.34;
  }

  // 水陆交界处的柔和岸线微雾暗影过渡，彻底消除地平线硬切线
  float shoreMist = exp(-pow((1.0 - waterDepth) / 0.055, 2.0));
  vec3 horizonHaze = mix(uNightFog * 0.45, mix(uCoverDeep, uWarmAmber * 0.55, 0.42), 0.48) * uSidechain;
  waterCol = mix(waterCol, horizonHaze, shoreMist * 0.42);

  return max(waterCol, vec3(0.0));
}

void main() {
  bool isWater = vUv.y < HORIZON_Y;
  BasaltWaterSurface ws;
  vec2 upperUv = vUv;
  if (isWater) {
    ws = prepareBasaltWaterPool(vUv);
    upperUv = ws.reflUv;
  }
  vec3 upperCol = renderLoungeUpper(upperUv, isWater);
  vec3 col = isWater ? shadeBasaltWaterPool(ws, upperCol) : upperCol;
  fragColor = vec4(col, 1.0);
}
`;

export class VelvetScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: LyricRig;

  private readonly swells: BassSwellEvent[];
  private readonly swellTimes: Float64Array;
  private readonly swellA = Array.from({ length: MAX_SWELLS }, () => new THREE.Vector4());
  private readonly swellB = Array.from({ length: MAX_SWELLS }, () => new THREE.Vector4());

  private readonly rawKickTimes: Float64Array;
  private readonly rawKickVals: Float64Array;
  private readonly rawHatTimes: Float64Array;
  private readonly rawHatVals: Float64Array;
  private readonly keyHitTimes: Float64Array;
  private readonly keyHitVals: Float64Array;
  private readonly leadHitTimes: Float64Array;
  private readonly leadHitVals: Float64Array;

  private readonly chromaBuf = new Float32Array(12);
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly soft: boolean;

  constructor(private init: SceneInit, look: 'pulse' | 'ballad' | 'velvet' = 'velvet') {
    this.soft = look === 'ballad';
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, init.aspect, 0.1, 1000);

    const { palette, music } = init;
    const tone = extractCoverTone(init);
    this.scene.background = colorFromHsl(tone.deepHue, tone.mono ? 0.04 : 0.48, 0.06);

    this.swells = buildGrooveSwells(music, init.seed ?? 20261030);
    this.swellTimes = Float64Array.from(this.swells, s => s.t);

    const kicks = music.a.hits.kick ?? [];
    this.rawKickTimes = Float64Array.from(kicks, h => h[0]);
    this.rawKickVals = Float64Array.from(kicks, h => h[1]);

    const hats = music.a.hits.hat ?? [];
    this.rawHatTimes = Float64Array.from(hats, h => h[0]);
    this.rawHatVals = Float64Array.from(hats, h => h[1]);

    // 合并电钢琴和弦与合成器短音脉冲，驱动 12 片磨砂玻璃光栅与唱针暖光
    const synthHits = music.roleHits('synthStab', 0, music.duration);
    const keyHits = music.hitsBetween('keys', 0, music.duration);
    const mergedKeys = [...synthHits, ...keyHits].sort((a, b) => a[0] - b[0]);
    this.keyHitTimes = Float64Array.from(mergedKeys, h => h[0]);
    this.keyHitVals = Float64Array.from(mergedKeys, h => h[1]);

    const leadHits = music.roleHits('lead', 0, music.duration);
    this.leadHitTimes = Float64Array.from(leadHits, h => h[0]);
    this.leadHitVals = Float64Array.from(leadHits, h => h[1]);

    // 构建封面自适应「都市午夜微醺」色板：
    // 暗部沉入午夜靛蓝/浓缩暖黑；若封面偏冷，辅以温润钨丝琥珀色；若封面偏暖，保留醇厚琥珀并以冷夜雾衬底
    const mkLin = (stop: typeof tone.mid, minL: number, maxL: number, minS: number, maxS: number, bias = 0) => {
      const c = tuneCoverStop(stop, tone, minL, maxL, minS, maxS, bias);
      return linearVec3FromHsl(c.h, c.s, c.l);
    };

    const isWarmCover = (tone.mainHue >= 0 && tone.mainHue <= 68) || tone.mainHue >= 325;
    const nightFogHue = tone.mono ? 220 : isWarmCover ? 226 : tone.deepHue;
    const nightAbyss = linearVec3FromHsl(nightFogHue, tone.mono ? 0.05 : 0.42, 0.065);
    const nightFog = linearVec3FromHsl(nightFogHue, tone.mono ? 0.06 : 0.48, 0.16);

    const coverDeep = mkLin(tone.dark, 0.22, 0.30, 0.45, 0.76, -6);
    const coverPrimary = mkLin(tone.mid, 0.48, 0.58, 0.58, 0.88, 0);
    const coverBright = mkLin(tone.bright, 0.68, 0.78, 0.62, 0.90, 6);

    // 钨丝琥珀暖金辅色：使用圆周最短弧包裹插值（避免 350° 红粉封面与 36° 琥珀跨 180° 误插值成青色！），锁定温润香槟金/玫瑰金 (20°..52°)
    const dhAmber = ((tone.highHue - 36 + 540) % 360) - 180;
    const amberHue = isWarmCover ? ((36 + Math.max(-16, Math.min(16, dhAmber * 0.35)) + 360) % 360) : 36;
    const warmAmber = linearVec3FromHsl(amberHue, tone.mono ? 0.14 : 0.82, 0.68);

    this.uniforms = {
      uCover: { value: init.cover },
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uAspect: { value: init.aspect },
      uZero: { value: 0 },
      uPlayProgress: { value: 0 },
      uPlatterAngle: { value: 0 },
      uSidechain: { value: 1.0 },
      uKickPunch: { value: 0 },
      uOffbeatHat: { value: 0 },
      uBassLevel: { value: 0 },
      uKeysGlow: { value: 0 },
      uLeadGlow: { value: 0 },
      uLeadPulse: { value: 0 },
      uFilterOpen: { value: 0.5 },
      uCamShift: { value: 0 },
      uCamLift: { value: 0 },
      uPlatterTilt: { value: 0 },
      uNightAbyss: { value: nightAbyss },
      uNightFog: { value: nightFog },
      uCoverDeep: { value: coverDeep },
      uCoverPrimary: { value: coverPrimary },
      uCoverBright: { value: coverBright },
      uWarmAmber: { value: warmAmber },
      uLouvers0: { value: new THREE.Vector4(0.1, 0.1, 0.1, 0.1) },
      uLouvers1: { value: new THREE.Vector4(0.1, 0.1, 0.1, 0.1) },
      uLouvers2: { value: new THREE.Vector4(0.1, 0.1, 0.1, 0.1) },
      uSwellA: { value: this.swellA },
      uSwellB: { value: this.swellB },
    };

    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(
      tri,
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        depthTest: false,
        depthWrite: false,
      }),
    );
    quad.frustumCulled = false;
    quad.renderOrder = -10;
    this.scene.add(quad);

    // 清透高对比的微醺暖白歌词调色板：落于下方玄武岩镜面水廊区（caption），绝不遮挡中央悬浮琥珀黑胶封面，无霓虹频闪
    const lyricPalette: Palette = {
      ...palette,
      ink: colorFromHsl(nightFogHue, tone.mono ? 0.04 : 0.52, 0.06),
      paper: new THREE.Color('#fffcf5'),
      signal: colorFromHsl(tone.mono ? 38 : (isWarmCover ? tone.highHue : 38), tone.mono ? 0.18 : 0.86, 0.74),
      light: false,
    };
    this.rig = new LyricRig(lyricPalette, 'caption');
    this.rig.faces = voiceFaces(look === 'pulse' ? 'pulse' : 'ballad', init.seed);
    this.scene.add(this.rig.group);
    this.resize(init.aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.uniforms.uAspect.value = aspect;
  }

  /** 纯函数脉冲采样（带 28ms 柔顺起音阻尼，绝无突兀跳变） */
  private evalHitPulse(times: Float64Array, vals: Float64Array, t: number, decay: number): number {
    if (!times.length) return 0;
    const i = lastIndex(times, t);
    if (i < 0) return 0;
    const evalOne = (idx: number): number => {
      if (idx < 0 || idx >= times.length) return 0;
      const age = t - times[idx];
      if (age < 0) return 0;
      const v = vals[idx] ?? 0;
      if (age < 0.028) {
        const u = age / 0.028;
        return v * u * u * (3 - 2 * u);
      }
      return v * Math.exp(-(age - 0.028) / decay);
    };
    return Math.max(evalOne(i), evalOne(i - 1));
  }

  /**
   * 四组零顿挫丝滑长镜头轨道（lounge, skim, platter, gallery）：
   * 全部使用连续三角阻尼与平滑插值，契合 Deep House 催眠流动的长镜头呼吸感。
   */
  private updateCamera(t: number, shot: Shot): { camShift: number; camLift: number; platterTilt: number } {
    const k = clamp01((t - shot.start) / Math.max(0.8, shot.end - shot.start));
    const e = inOutCubic(k);
    const shotT = Math.max(0, t - shot.start);
    const variant = shot.variant || 'lounge';

    let camX = 0;
    let camY = 2.2;
    let camZ = -shotT * 2.4;
    let yaw = 0;
    let camLift = 0;
    let platterTilt = 0;

    if (variant === 'skim') {
      // 贴近薄水镜面低掠推进，强化玄武岩水波焦散与长倒影纵深
      camX = Math.sin(shotT * 0.22) * 1.4;
      camY = 1.65 + Math.sin(shotT * 0.28) * 0.12;
      camZ = -4.0 - shotT * 2.8;
      yaw = Math.sin(shotT * 0.16) * 0.028;
      camLift = -0.35 + 0.12 * Math.sin(shotT * 0.24);
      platterTilt = 0.22 * Math.sin(shotT * 0.20);
    } else if (variant === 'platter') {
      // 斜侧微倾凝视悬浮琥珀黑胶与唱针星芒，缓步横移
      camX = lerp(-3.8, 3.8, e);
      camY = 2.45 + Math.cos(shotT * 0.20) * 0.15;
      camZ = -2.0 - shotT * 2.0;
      yaw = lerp(0.055, -0.055, e);
      camLift = 0.22;
      platterTilt = lerp(-0.55, 0.55, e);
    } else if (variant === 'gallery') {
      // 宽幅巡礼两侧 12 片电钢琴发光磨砂玻璃光栅
      camX = lerp(4.2, -4.2, e) + Math.sin(shotT * 0.18) * 0.6;
      camY = 2.35 + Math.sin(shotT * 0.22) * 0.16;
      camZ = -6.0 - shotT * 2.2;
      yaw = lerp(-0.06, 0.06, e);
      camLift = 0.08 * Math.cos(shotT * 0.20);
      platterTilt = lerp(0.32, -0.32, e);
    } else {
      // lounge: 经典中轴微醺环绕，沉稳优雅
      camX = Math.sin(shotT * 0.18) * 2.1;
      camY = 2.15 + Math.sin(shotT * 0.25) * 0.14;
      camZ = -shotT * 2.3;
      yaw = Math.sin(shotT * 0.14) * 0.032;
      camLift = 0.10 * Math.sin(shotT * 0.19);
      platterTilt = 0.28 * Math.sin(shotT * 0.17);
    }

    this.camera.position.set(camX, camY, camZ);
    this.camera.quaternion.setFromEuler(new THREE.Euler(HORIZON_PITCH, yaw, 0, 'YXZ'));
    this.camera.updateMatrixWorld();

    return { camShift: camX * 0.12, camLift, platterTilt };
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, fx } = ctx;
    const { camShift, camLift, platterTilt } = this.updateCamera(t, shot);

    const beatInfo = music.at(t);
    const fg = music.foregroundAt(t);
    const timbre = music.timbreAt(t);

    const lowEnv = music.env('low', t);
    const midEnv = music.env('mid', t);
    const highEnv = music.env('high', t);

    // 1. 核心灵魂：光学侧链呼吸 (Optical Sidechain Ducking)
    // 当底鼓踩下时，环境体积光与背光日冕瞬间温柔内敛下沉，随后在半拍内按 S 曲线膨胀回满
    const rawKick = this.evalHitPulse(this.rawKickTimes, this.rawKickVals, t, 0.19);
    const phaseLift = smooth(clamp01((beatInfo.phase - 0.08) / 0.54)) * (1.0 - 0.28 * smooth(clamp01((beatInfo.phase - 0.72) / 0.28)));
    const duckDepth = (this.soft ? 0.14 : 0.22) * clamp01(rawKick * 1.15);
    const sidechain = clamp01(0.86 - duckDepth + (this.soft ? 0.14 : 0.22) * phaseLift * (0.45 + 0.55 * lowEnv)) + 0.08 * phaseLift;

    // 2. 反拍开镲微光 (Off-beat Open Hi-Hat Shimmer)：聚焦每拍后半拍 (& 拍: phase ∈ [0.36, 0.68])
    const rawHat = this.evalHitPulse(this.rawHatTimes, this.rawHatVals, t, 0.14);
    const offbeatWindow = Math.exp(-Math.pow((beatInfo.phase - 0.50) / 0.16, 2.0));
    const offbeatHat = clamp01(rawHat * (0.45 + 0.75 * offbeatWindow) + highEnv * offbeatWindow * 0.68);

    // 3. 浑厚贝斯能量、电钢琴切分和弦与主旋律包络（共同驱动前景光栅与远景天际大楼流光）
    const bassLevel = clamp01(Math.max(lowEnv * 0.92, timbre.bassStab * 0.95));
    const keysPulse = this.evalHitPulse(this.keyHitTimes, this.keyHitVals, t, 0.52);
    const keysGlow = clamp01(Math.max(keysPulse, timbre.synthStab * 0.85, fg.level * 0.72));
    const leadHit = this.evalHitPulse(this.leadHitTimes, this.leadHitVals, t, 0.34);
    const leadGlow = clamp01(Math.max(fg.level * 0.92, leadHit * 0.75));
    const leadPulse = clamp01(Math.max(leadHit, fg.attack * 0.90, keysPulse * 0.45));

    // 4. 低通滤波器开合度映射 (Filter Cutoff Sweep)：Intro/Break 朦胧深潜，主律动段晶莹通透
    const secLabel = shot.section.label;
    const secBaseOpen = secLabel === 'drop' || secLabel === 'chorus' ? 0.78
      : secLabel === 'intro' || secLabel === 'break' ? 0.34
      : secLabel === 'outro' ? 0.38
      : 0.56;
    const spectralTilt = clamp01((highEnv * 1.35 + midEnv * 0.55) / Math.max(0.18, lowEnv * 0.75 + midEnv + highEnv));
    const filterOpen = clamp01(secBaseOpen * 0.52 + spectralTilt * 0.32 + fg.brightness * 0.22);

    // 5. 驱动两侧 12 片包豪斯磨砂玻璃光栅（12 半音色度 × 电钢琴/和弦包络）
    music.chromaAt(t, this.chromaBuf);
    let maxChroma = 0.001;
    for (let k = 0; k < 12; k++) if (this.chromaBuf[k] > maxChroma) maxChroma = this.chromaBuf[k];
    const chordDrive = 0.28 + 0.85 * keysGlow + 0.30 * midEnv;
    const louverVal = (k: number) => {
      const normC = this.chromaBuf[k] / maxChroma;
      const shaped = normC * normC * (0.35 + 0.65 * this.chromaBuf[k]);
      return clamp01(shaped * chordDrive);
    };

    const u = this.uniforms;
    u.uTime.value = t;
    u.uFlow.value = t * 0.85 + music.foregroundMotion(t, 0.28) * 0.24;
    u.uPlayProgress.value = clamp01(t / Math.max(1, music.duration));
    // 黑胶外圈恒速优雅旋转：每小节转半圈（约 33⅓ RPM 的沉稳视觉节奏，绝不眩晕）
    u.uPlatterAngle.value = beatInfo.pos * (Math.PI / 4);
    u.uSidechain.value = sidechain;
    u.uKickPunch.value = clamp01(rawKick);
    u.uOffbeatHat.value = offbeatHat;
    u.uBassLevel.value = bassLevel;
    u.uKeysGlow.value = keysGlow;
    u.uLeadGlow.value = leadGlow;
    u.uLeadPulse.value = leadPulse;
    u.uFilterOpen.value = filterOpen;
    u.uCamShift.value = camShift;
    u.uCamLift.value = camLift;
    u.uPlatterTilt.value = platterTilt;

    (u.uLouvers0.value as THREE.Vector4).set(louverVal(0), louverVal(1), louverVal(2), louverVal(3));
    (u.uLouvers1.value as THREE.Vector4).set(louverVal(4), louverVal(5), louverVal(6), louverVal(7));
    (u.uLouvers2.value as THREE.Vector4).set(louverVal(8), louverVal(9), louverVal(10), louverVal(11));

    // 6. 填充活跃的高粘度水面低频/和弦重力波包（纯时间函数）
    let sCount = 0;
    for (let i = lastIndex(this.swellTimes, t); i >= 0 && sCount < MAX_SWELLS; i--) {
      const sw = this.swells[i];
      const age = t - sw.t;
      if (age < 0) continue;
      if (age > 3.6) break;
      const effAmp = sw.amp * (0.72 + 0.35 * bassLevel + 0.28 * keysGlow) * (this.soft ? 0.82 : 1.0);
      if (effAmp * Math.exp(-age / (sw.tau * 2.1)) < 0.015 && age > 0.9) continue;

      this.swellA[sCount].set(sw.x, sw.y, age, effAmp);
      this.swellB[sCount].set(sw.maxRadius, sw.freq, sw.tau, sw.warmth);
      sCount++;
    }
    for (let i = sCount; i < MAX_SWELLS; i++) {
      this.swellA[i].set(0, 0, 0, 0);
      this.swellB[i].set(0, 0, 0, 0);
    }

    // 7. 后期管线精控：杜绝刺眼双色闪光、故障撕裂、负片或过猛缩放，保留微醺胶片质感
    fx.impact = 0;
    fx.impactInvert = 0;
    fx.glitch = 0;
    fx.duotone = 0;
    fx.invert = 0;
    fx.pixel = 0;
    fx.scan = 0;
    fx.zoom = Math.min(fx.zoom, 0.04);
    fx.bloom = (this.soft ? 0.20 : 0.24) + 0.06 * keysGlow + 0.04 * offbeatHat;
    fx.vignette = 0.44;
    fx.grain = 0.032;

    // 8. 更新 3D 歌词排版
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, shot.section.energy * 0.75);
  }
}
