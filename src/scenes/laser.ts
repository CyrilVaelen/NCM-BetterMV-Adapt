// 激光舞台 · 镭射穹廊 (Warehouse Laser Arena): 专为 EDM 电音节高潮 Drop 量身打造的工业级体积激光秀场景。
// 空间架构（Awakenings / Afterlife 室内巨型仓库纵深桁架风，100% 纯时间函数 f(t) 驱动，零帧间状态累积）：
// 1. 纵深工业重型桁架走廊：7 道门式四弦铝合金方管桁架（Portal Box Truss）从远景舞台（z=-52m）延伸至镜头上方（z=+11m），
//    横梁与立柱挂载 28 组四眼卤素观众盲眼灯（Blinders），随底鼓重拍泛起 3500K->2000K 真实钨丝热惯性余晖；
// 2. 舞台中央视觉核心与镜面黑金地坪：远景舞台矗立 1:1 巨幅微距 RGB LED 点阵封面主屏与两侧 12 半音色度频谱灯塔，
//    下方设发光装甲轮廓 DJ 控台与逆光控场 DJ 剪影；全场铺设湿润黑曜石反光地面，1:1 菲涅尔拉丝倒映漫天激光与巨幕；
// 3. 四大标志性现场灯光秀系统（按 4 小节控台 Cue 自动变阵）：
//    - 振镜扫描体积光膜（Liquid Sky & Fan Sheets）：带振镜折返驻留亮边、扫描丝与 3D 干冰烟雾湍流云纹，压低掠过镜头；
//    - 军鼓/重音 X 型交叉铡刀快切（Chopper Single Beams）：36 束高锐度脉冲激光（含发射口变形宽银幕眩光）按节拍追逐对切；
//    - 旋转空心激光锥笼（Laser Cone Tunnel）：双层反向旋转断线激光圆锥体积笼，将镜头包裹于旋转几何光网中心；
//    - Drop 入拍前缘 CO2 低温白雾喷射气柱（Cryo Jets）：Drop 首拍前瞬时收暗蓄力，入拍瞬间 8 道高压白雾冲天喷发并实时染光。
import * as THREE from 'three';
import type { FrameCtx, MvScene, SceneInit, Shot } from './types.ts';
import { clamp01, inOutCubic, lerp, rng, smooth } from './types.ts';
import { LyricRig } from './lyricRig.ts';
import { voiceFaces } from './lyricBlock.ts';
import { lastIndex, type Music } from '../director/music.ts';
import type { Palette } from '../render/palette.ts';
import { colorFromHsl, extractCoverTone, linearVec3FromHsl, rgbToHsl, type CoverToneStops } from './coverTone.ts';
import { buildLeadColorTrack, extractLeadColorGroups, sampleTrack, type LeadColorTrack } from './phoenixLeadColor.ts';

/** 纵深门式桁架龙门数量与世界坐标参数 */
const PORTAL_Z = [-52.0, -41.5, -31.0, -20.5, -10.0, 0.5, 11.0] as const;
const PORTAL_HALF_W = 17.2;
const PORTAL_H = 17.6;

/** 舞台与中央巨幅微距 LED 主屏几何常量 */
const STAGE_Z = -54.5;
const SCREEN_SIZE = 15.6;
const SCREEN_CENTER_Y = 10.1;
const STAGE_DECK_H = 1.82;
const STAGE_LIP_Z = -46.8;

/** 四大灯光系统实例容量（均含天空本体 + 湿润地面 1:1 镜像对偶） */
const SHEET_EMITTER_COUNT = 14;
const BEAM_EMITTER_COUNT = 36;
const CONE_LAYER_COUNT = 2;
const CRYO_JET_COUNT = 8;
const BLINDER_COUNT = 28;
const CAM_FOV = 52;

/** 预构建的军鼓/合成器重音激光快切脉冲事件 */
interface ChopperHitEvent {
  /** 触发时间戳（秒） */
  t: number;
  /** 脉冲强度 [0..1.3] */
  amp: number;
  /** 控台快切阵型模式：0=X剪刀对切, 1=中心向外波浪, 2=顶棚铡刀下劈, 3=对称点射矩阵 */
  pattern: number;
  /** 左右交替极性 (-1 或 +1) */
  parity: number;
  /** 主导半音索引 [0..11] */
  note: number;
}

/** 预构建的舞台前缘 CO2 低温气柱喷发事件 */
interface CryoBlastEvent {
  /** 喷发起始时刻（秒） */
  t: number;
  /** 喷射持续时长（秒） */
  dur: number;
  /** 喷射高度强度系数 [0.7..1.25] */
  strength: number;
  /** 喷发编组：0=全场8柱齐射, 1=内侧4柱冲天, 2=由内向外极速排射 */
  mode: number;
}

/** 激光发射台静态布局描述 */
interface SheetEmitterSpec {
  x: number;
  y: number;
  z: number;
  /** 0=舞台正前主排(Liquid Sky), 1=走廊左侧翼下倾, 2=走廊右侧翼下倾 */
  bank: number;
  /** 组内序号 */
  idx: number;
  /** 默认偏航角（弧度，0 表示朝 +Z 观众席正前方） */
  baseYaw: number;
  /** 默认俯仰角（弧度，负值向下压） */
  basePitch: number;
  /** 光幕长度（米） */
  length: number;
}

interface BeamEmitterSpec {
  x: number;
  y: number;
  z: number;
  /** 0=舞台顶排下劈, 1=舞台前缘上挑, 2=左翼龙门斜切, 3=右翼龙门斜切 */
  group: number;
  /** 组内序号 */
  slot: number;
  /** 归一化横向位置 [-1..1] */
  normX: number;
}

/** 计算两个色相角之间的最短有向差 (-180..180) */
function shortestHueDelta(a: number, b: number): number {
  return ((b - a) % 360 + 540) % 360 - 180;
}

const wrapHue = (deg: number): number => ((deg % 360) + 360) % 360;
const clampRange = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/**
 * 为单一色系专辑封面计算和谐同系副激光色相（带色域护栏）：
 * 严格保持在同一审美色系内做 18°~22° 冷暖光影微偏，严禁将火红/金橙偏进草绿或将深蓝/冰青偏进绿色。
 */
function computeSameFamilySecondaryHue(h1: number, tones: CoverToneStops): number {
  const h = wrapHue(h1);
  // 1. 赤红 - 烈焰橙 - 琥珀金带 (336°..360° 或 0°..50°) -> 统一到连续轴 [-24°, +50°]
  if (h >= 336 || h <= 50) {
    const signedH = h >= 336 ? h - 360 : h;
    const candidate = signedH + 20 <= 48 ? signedH + 20 : signedH - 20;
    return wrapHue(candidate);
  }
  // 2. 明黄 - 暖金带 (50°..74°) -> 向琥珀暖橙侧回靠，绝不踏入草绿区
  if (h > 50 && h <= 74) {
    return wrapHue(h - 20);
  }
  // 3. 翡翠绿 - 森林绿 - 青绿带 (74°..172°) -> 仅真绿色封面在绿青带内自然舒展
  if (h > 74 && h <= 172) {
    return h + 20 <= 168 ? h + 20 : h - 20;
  }
  // 4. 冰青 - 天蓝 - 深海钴蓝带 (172°..256°) -> 严守 [186°, 250°] 纯正蓝青区间，绝不掉入绿色
  if (h > 172 && h <= 256) {
    if (h < 198) return h + 20;
    if (h > 234) return h - 20;
    const naturalDir = shortestHueDelta(h, tones.highHue) >= 0 ? 1 : -1;
    return h + naturalDir * 20;
  }
  // 5. 电光紫 - 洋红 - 樱花粉带 (256°..336°) -> 在 [262°, 342°] 内顺应封面高光色相偏移
  if (h < 274) return h + 20;
  if (h > 322) return h - 20;
  const dir = shortestHueDelta(h, tones.highHue) >= 0 ? 1 : -1;
  return wrapHue(h + dir * 20);
}

/**
 * 从专辑封面提取 100% 忠实于封面原生色彩基因的全套激光舞台光学色板：
 * - 黑白/无彩色封面：纯粹铂银白与钛灰银影调（Nothing is invented）；
 * - 双色撞色封面（OKLab accent 与 k-means 双色簇同时确认）：忠实还原封面两大真实主色相；
 * - 单一主色系封面（如黑底烈焰橙、纯冰海蓝、樱花粉霞）：在同色系护栏内构建深浅冷暖双波长，绝不串色。
 */
function buildCoverLaserColors(init: SceneInit) {
  const tones = extractCoverTone(init);
  if (tones.mono || init.palette.mono) {
    return {
      mono: true,
      lyricHue: 215,
      laserPrimary: linearVec3FromHsl(214, 0.04, 0.72),
      laserSecondary: linearVec3FromHsl(218, 0.06, 0.54),
      laserPrimaryCore: linearVec3FromHsl(214, 0.03, 0.92),
      laserSecondaryCore: linearVec3FromHsl(218, 0.04, 0.85),
      blinderWarm: linearVec3FromHsl(212, 0.05, 0.76),
      coverGlow: linearVec3FromHsl(215, 0.04, 0.44),
      envDark: new THREE.Vector3(0.0015, 0.0016, 0.0019),
      bgHex: colorFromHsl(216, 0.06, 0.015),
    };
  }

  const sigRgb = { r: 0, g: 0, b: 0 };
  const accRgb = { r: 0, g: 0, b: 0 };
  init.palette.signal.getRGB(sigRgb, THREE.SRGBColorSpace);
  init.palette.accent.getRGB(accRgb, THREE.SRGBColorSpace);
  const sigHsl = rgbToHsl(sigRgb.r, sigRgb.g, sigRgb.b);
  const accHsl = rgbToHsl(accRgb.r, accRgb.g, accRgb.b);

  const groups = extractLeadColorGroups(init, tones);

  // 严格判定封面是否真正包含第二独立发光色相（extractLeadColorGroups 已滤除暗黑背景并校验双簇面积 >=12% 与饱和度 >=0.28）
  const groupHueSep = Math.abs(shortestHueDelta(groups.info.hueA, groups.info.hueB));
  const paletteHueSep = Math.abs(shortestHueDelta(sigHsl.h, accHsl.h));
  const hasGroupDualHue = groups.info.split === 'hue' && groupHueSep >= 26;
  const hasPaletteDualHue =
    !hasGroupDualHue &&
    sigHsl.s >= 0.28 &&
    accHsl.s >= Math.max(0.36, sigHsl.s * 0.62) &&
    accHsl.l >= 0.18 &&
    paletteHueSep >= 34;
  const hasTrueDualHue = hasGroupDualHue || hasPaletteDualHue;

  // 主激光色相：优先采用发光像素聚类主色或 OKLab 高显著度 signal（精准锁定黑底封面上的核心图案色彩）
  let h1 = tones.mainHue;
  if (hasGroupDualHue) {
    h1 = groups.info.hueA;
  } else if (groups.info.split === 'lightness') {
    h1 = sigHsl.s >= 0.24 && Math.abs(shortestHueDelta(sigHsl.h, groups.info.hueA)) <= 28
      ? wrapHue(groups.info.hueA + shortestHueDelta(groups.info.hueA, sigHsl.h) * 0.45)
      : groups.info.hueA;
  } else if (sigHsl.s >= 0.22) {
    h1 = sigHsl.h;
  }

  let h2: number;
  if (hasGroupDualHue) {
    // 封面本身具有鲜明双色撞色（如赛博青+洋红、冰蓝+烈焰橙）：100% 忠实还原封面第二发光主色
    h2 = groups.info.hueB;
  } else if (hasPaletteDualHue) {
    h2 = accHsl.h;
  } else {
    // 单一主色系封面：严格在同色系护栏内生成自然冷暖光影副色（火橙配鎏金、深蓝配冰青、樱花粉配珊瑚玫红）
    h2 = computeSameFamilySecondaryHue(h1, tones);
  }

  const coverPeakSat = Math.max(sigHsl.s, tones.mid.s, tones.bright.s);
  const sat1 = clampRange(0.36 + 0.62 * coverPeakSat, 0.42, 0.96);
  const sat2 = clampRange(0.34 + 0.62 * (hasTrueDualHue ? Math.max(accHsl.s, coverPeakSat * 0.85) : coverPeakSat), 0.40, 0.95);

  const blinderHue = hasTrueDualHue ? wrapHue(h1 + shortestHueDelta(h1, h2) * 0.35) : h2;

  return {
    mono: false,
    lyricHue: h1,
    laserPrimary: linearVec3FromHsl(h1, sat1, 0.52),
    laserSecondary: linearVec3FromHsl(h2, sat2, 0.54),
    laserPrimaryCore: linearVec3FromHsl(wrapHue(h1 + shortestHueDelta(h1, h2) * 0.18), clampRange(sat1 * 0.88, 0.38, 0.90), 0.75),
    laserSecondaryCore: linearVec3FromHsl(wrapHue(h2 - shortestHueDelta(h1, h2) * 0.15), clampRange(sat2 * 0.88, 0.38, 0.90), 0.77),
    blinderWarm: linearVec3FromHsl(blinderHue, clampRange(sat1 * 0.86, 0.36, 0.92), 0.58),
    coverGlow: linearVec3FromHsl(h1, clampRange(coverPeakSat * 0.90, 0.36, 0.92), 0.46),
    envDark: linearVec3FromHsl(tones.deepHue, clampRange(coverPeakSat * 0.55, 0.14, 0.52), 0.022),
    bgHex: colorFromHsl(tones.deepHue, clampRange(coverPeakSat * 0.45, 0.10, 0.45), 0.013),
  };
}

/** 构建 14 座高功率振镜扫描光幕发射台坐标 */
function buildSheetEmitters(): SheetEmitterSpec[] {
  const list: SheetEmitterSpec[] = [];
  // 0..5: 远景舞台巨幕顶梁与 DJ 台主炮（6 台正前宽幅 Liquid Sky 发射器）
  const stageXs = [-12.6, -7.2, -2.4, 2.4, 7.2, 12.6];
  for (let i = 0; i < 6; i++) {
    const x = stageXs[i];
    const isInner = Math.abs(x) < 4.0;
    list.push({
      x,
      y: isInner ? 18.05 : 17.55,
      z: -52.4,
      bank: 0,
      idx: i,
      baseYaw: -x * 0.016,
      basePitch: isInner ? -0.14 : -0.18,
      length: 72.0,
    });
  }
  // 6..9: 左侧纵深桁架立柱高处内倾激光台
  const bayZs = [-41.5, -31.0, -20.5, -10.0];
  for (let i = 0; i < 4; i++) {
    list.push({
      x: -16.4,
      y: 15.2,
      z: bayZs[i],
      bank: 1,
      idx: i,
      baseYaw: 0.62,
      basePitch: -0.28,
      length: 48.0,
    });
  }
  // 10..13: 右侧纵深桁架立柱高处内倾激光台
  for (let i = 0; i < 4; i++) {
    list.push({
      x: 16.4,
      y: 15.2,
      z: bayZs[i],
      bank: 2,
      idx: i,
      baseYaw: -0.62,
      basePitch: -0.28,
      length: 48.0,
    });
  }
  return list;
}

/** 构建 36 座高锐度单束铡刀激光发射头坐标 */
function buildBeamEmitters(): BeamEmitterSpec[] {
  const list: BeamEmitterSpec[] = [];
  // Group 0 (12 束): 舞台顶梁高密矩阵排
  for (let i = 0; i < 12; i++) {
    const u = (i / 11) * 2 - 1;
    list.push({ x: u * 15.2, y: 17.35, z: -51.8, group: 0, slot: i, normX: u });
  }
  // Group 1 (12 束): 舞台前缘低位仰射激光排（紧贴 Stage Lip）
  for (let i = 0; i < 12; i++) {
    const u = (i / 11) * 2 - 1;
    list.push({ x: u * 13.8, y: STAGE_DECK_H + 0.18, z: STAGE_LIP_Z + 0.25, group: 1, slot: i, normX: u });
  }
  // Group 2 (6 束): 走廊左侧龙门架斜切排
  const sideZs = [-41.5, -31.0, -20.5, -10.0, 0.5, -46.8];
  for (let i = 0; i < 6; i++) {
    list.push({ x: -16.6, y: 12.8 + (i % 2) * 3.4, z: sideZs[i], group: 2, slot: i, normX: -1 });
  }
  // Group 3 (6 束): 走廊右侧龙门架斜切排
  for (let i = 0; i < 6; i++) {
    list.push({ x: 16.6, y: 12.8 + (i % 2) * 3.4, z: sideZs[i], group: 3, slot: i, normX: 1 });
  }
  return list;
}

/** 预构建全曲确定性激光快切事件与 Drop 前缘 CO2 气柱喷发事件 */
function buildLaserShowEvents(music: Music, seed: number): {
  choppers: ChopperHitEvent[];
  chopperTimes: Float64Array;
  cryos: CryoBlastEvent[];
  cryoTimes: Float64Array;
} {
  const rand = rng((seed ^ 0x7a5e91b3) >>> 0);
  const dur = Math.max(1, music.duration);
  const env = music.a.env;
  const fps = env.fps || 100;
  const chroma = env.chroma;

  // 融合 synthStab（主军鼓/重音和弦刺）与 lead 强起音，若稀疏则用节拍补齐
  const stabs = music.roleHits('synthStab', 0, dur);
  const leads = music.roleHits('lead', 0, dur);
  const snares = music.a.hits.snare ?? [];

  const merged: Array<{ t: number; amp: number; kind: number }> = [];
  for (const [t, s] of stabs) if (s > 0.18) merged.push({ t, amp: s * 1.12, kind: 0 });
  for (const [t, s] of snares) if (s > 0.22) merged.push({ t, amp: s * 1.05, kind: 1 });
  for (const [t, s] of leads) if (s > 0.28) merged.push({ t, amp: s * 0.92, kind: 2 });
  merged.sort((a, b) => a.t - b.t);

  const choppers: ChopperHitEvent[] = [];
  let lastT = -1;
  let parity = 1;

  for (const item of merged) {
    const sec = music.section(item.t);
    const isClimax = sec.label === 'drop' || sec.label === 'chorus';
    const minGap = isClimax ? 0.085 : 0.16;
    if (item.t - lastT < minGap) continue;
    lastT = item.t;
    parity = -parity;

    // 读取主导色度音高
    let bestNote = Math.floor(rand() * 12);
    if (chroma && chroma.length >= 12) {
      const nChromaFrames = Math.floor(chroma.length / 12);
      const f = Math.min(nChromaFrames - 1, Math.max(0, Math.round((item.t / dur) * (nChromaFrames - 1))));
      let bestVal = -1;
      for (let c = 0; c < 12; c++) {
        const v = chroma[f * 12 + c] ?? 0;
        if (v > bestVal) {
          bestVal = v;
          bestNote = c;
        }
      }
    }

    const barIdx = Math.max(0, music.at(item.t).bar);
    // 每 2 小节顺滑轮换快切几何花式，重拍军鼓优先触发 X 剪刀或顶棚铡刀
    const pattern = item.kind === 1
      ? (barIdx % 2 === 0 ? 0 : 2)
      : (barIdx + (item.kind === 2 ? 1 : 0)) % 4;

    choppers.push({
      t: item.t,
      amp: Math.min(1.3, item.amp * (isClimax ? 1.15 : 0.78)),
      pattern,
      parity,
      note: bestNote,
    });
  }

  // 保底：若某段 Drop 极度缺乏离散重音事件，按每拍注入干净的控台节拍追逐束
  for (const sec of music.a.sections) {
    if (sec.label !== 'drop' && sec.label !== 'chorus') continue;
    let countInSec = 0;
    for (const c of choppers) if (c.t >= sec.start && c.t < sec.end) countInSec++;
    if (countInSec < Math.max(4, (sec.end - sec.start) * 1.1)) {
      for (const bt of music.beats) {
        if (bt < sec.start || bt >= sec.end) continue;
        parity = -parity;
        const barIdx = Math.max(0, music.at(bt).bar);
        choppers.push({
          t: bt,
          amp: 0.92,
          pattern: barIdx % 4,
          parity,
          note: Math.round(bt * 4) % 12,
        });
      }
    }
  }
  choppers.sort((a, b) => a.t - b.t);

  // 构建 CO2 低温白雾气柱喷发时间表：每个 Drop / Chorus 开场首拍必炸 + 段内每 8 小节下拍二次助推
  const cryos: CryoBlastEvent[] = [];
  for (let si = 0; si < music.a.sections.length; si++) {
    const sec = music.a.sections[si];
    if (sec.label !== 'drop' && sec.label !== 'chorus') continue;
    const isDrop = sec.label === 'drop';
    cryos.push({
      t: sec.start,
      dur: isDrop ? 1.55 : 1.25,
      strength: isDrop ? 1.22 : 0.96,
      mode: 0, // 开场 8 柱齐射
    });

    // 段内每 8 小节（32 拍）在紧邻的小节下拍喷射助推气柱
    const downs = music.downbeats;
    let barCounter = 0;
    for (let di = 0; di < downs.length; di++) {
      const dt = downs[di];
      if (dt <= sec.start + 1.2 || dt >= sec.end - 1.5) continue;
      barCounter++;
      if (barCounter % 8 === 0) {
        cryos.push({
          t: dt,
          dur: 1.28,
          strength: isDrop ? 1.08 : 0.85,
          mode: (barCounter / 8) % 2 === 1 ? 2 : 1,
        });
      }
    }
  }
  cryos.sort((a, b) => a.t - b.t);

  return {
    choppers,
    chopperTimes: Float64Array.from(choppers, c => c.t),
    cryos,
    cryoTimes: Float64Array.from(cryos, c => c.t),
  };
}

// ============================================================================
// GLSL 公共噪声与干冰烟雾湍流函数库（无保留字，适配 WebGL2 / D3D11）
// ============================================================================
const GLSL_HAZE_COMMON = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 三层快速干冰体积烟雾云纹（零循环展开负担）
float hazeFbm(vec2 p) {
  float v = 0.52 * noise2D(p);
  p = mat2(0.80, -0.60, 0.60, 0.80) * p * 2.03 + vec2(11.7, 5.3);
  v += 0.31 * noise2D(p);
  p = mat2(0.80, 0.60, -0.60, 0.80) * p * 2.07 + vec2(3.1, 17.9);
  v += 0.17 * noise2D(p);
  return v;
}
`;

// ============================================================================
// 1. 巨型工业仓库穹顶与体积干冰雾背板着色器 (WAREHOUSE_BACKDROP)
// ============================================================================
const BACKDROP_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BACKDROP_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSectionEnergy;
uniform float uDropPower;
uniform float uBlinderGlow;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uCoverGlow;
uniform vec3 uBlinderWarm;
uniform vec3 uEnvDark;
varying vec3 vWorldPos;
${GLSL_HAZE_COMMON}

void main() {
  vec3 dir = normalize(vWorldPos - cameraPosition);
  float up = clamp(dir.y, -0.25, 1.0);

  // 浸润于专辑封面深部色调的深邃工业混凝土暗底色
  vec3 base = uEnvDark * 0.65;

  // 仓库侧墙与顶棚工业肋柱极微弱轮廓，绝不泛亮抢戏
  float wallRibs = pow(0.5 + 0.5 * cos(vWorldPos.x * 1.15), 8.0) * smoothstep(22.0, 4.0, abs(vWorldPos.y - 9.0));
  float roofDeck = pow(0.5 + 0.5 * cos(vWorldPos.z * 1.8), 6.0) * smoothstep(0.15, 0.65, up);
  base += uEnvDark * 1.25 * (wallRibs * 0.35 + roofDeck * 0.30);

  // 远景主舞台方向（-Z）的局部丁达尔背光晕（严格收敛在舞台主屏后方，保持侧墙与顶棚深黑高反差）
  vec3 stageCenter = vec3(0.0, 9.5, ${STAGE_Z.toFixed(1)});
  vec3 toStage = normalize(stageCenter - cameraPosition);
  float stageAlign = max(0.0, dot(dir, toStage));

  vec2 hazeUv = dir.xy * 3.4 + vec2(uTime * 0.045, -uTime * 0.028);
  float mist = hazeFbm(hazeUv);
  float mistDetail = hazeFbm(hazeUv * 2.3 - vec2(uTime * 0.07, 0.0));
  float hazeDensity = mix(0.62, 1.28, mist * 0.65 + mistDetail * 0.35);

  // 主副激光波长仅在远景舞台轴心周围产生克制的大气散射
  vec3 laserHaze = mix(uLaserPrimary, uLaserSecondary, clamp(0.5 + 0.5 * sin(dir.x * 3.2 + uTime * 0.5), 0.0, 1.0));
  float stageHalo = pow(stageAlign, 16.0) * (0.032 + 0.072 * uDropPower + 0.024 * uSectionEnergy);
  float skyScatter = smoothstep(0.02, 0.52, up) * pow(stageAlign, 6.0) * (0.008 + 0.022 * uDropPower);

  vec3 col = base;
  col += uCoverGlow * pow(stageAlign, 20.0) * (0.042 + 0.045 * uSectionEnergy) * hazeDensity;
  col += laserHaze * (stageHalo + skyScatter) * hazeDensity;

  // 桁架频闪盲眼灯触发时在舞台纵深走廊上方勾勒封面同源余晖
  float blinderScatter = pow(stageAlign, 4.0) * smoothstep(-0.05, 0.55, up) * uBlinderGlow;
  col += uBlinderWarm * blinderScatter * 0.028 * hazeDensity;

  // Drop 前瞬时收暗蓄力阀门
  col *= (1.0 - 0.86 * uBlackout);

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// ============================================================================
// 2. 工业重型四弦方管门式桁架着色器 (TRUSS_GANTRY)
// ============================================================================
const TRUSS_VERT = /* glsl */ `
attribute vec4 aTrussMeta; // x: 构件长度(米), y: 截面宽度(米), z: 0=立柱/横梁, 1=舞台背架, w: 所属龙门序号
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec4 vMeta;

void main() {
  vLocalPos = position;
  vMeta = aTrussMeta;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TRUSS_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDropPower;
uniform float uBlinderGlow;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uBlinderWarm;
uniform vec3 uEnvDark;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec4 vMeta;

void main() {
  // 在盒体两个侧面雕刻真实的铝合金四弦重型方管桁架（主弦杆 + Warren 斜腹杆镂空）
  float spanCoord = (vLocalPos.y + 0.5) * vMeta.x;
  vec2 crossUv = abs(vLocalPos.xz) * 2.0; // [0..1] 距中心轴偏移
  float faceEdge = max(crossUv.x, crossUv.y);

  // 四角主弦杆（外侧 22% 宽度为实心铝合金立管）
  float mainChord = smoothstep(0.74, 0.80, faceEdge);
  // 每隔 1.6m 一道横向加强横隔框
  float rung = smoothstep(0.84, 0.92, abs(cos(spanCoord * 3.14159265 / 1.6)));
  // 45° Warren 三角交叉斜腹杆
  float zig = abs(fract(spanCoord / 1.6) * 2.0 - 1.0) * 2.0 - 1.0;
  float faceCoord = abs(vWorldNormal.x) > 0.5 ? vLocalPos.z * 2.0 : vLocalPos.x * 2.0;
  float brace = 1.0 - smoothstep(0.11, 0.17, abs(faceCoord - zig * 0.78));

  float metalMask = max(mainChord, max(rung, brace));
  if (metalMask < 0.25) discard;

  // 拉丝铝合金高光受舞台激光、封面主屏与头顶盲眼灯三重照明
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 toStage = normalize(vec3(0.0, 10.0, ${STAGE_Z.toFixed(1)}) - vWorldPos);
  vec3 H1 = normalize(toStage + V);
  float specStage = pow(max(0.0, dot(vWorldNormal, H1)), 22.0);

  vec3 upLight = normalize(vec3(0.0, 1.0, 0.25));
  float rim = pow(1.0 - max(0.0, dot(vWorldNormal, V)), 2.5);
  float chordHighlight = smoothstep(0.80, 0.96, faceEdge);

  vec3 baseMetal = (uEnvDark * 3.2 + vec3(0.003)) * (0.55 + 0.65 * chordHighlight);
  vec3 laserTint = mix(uLaserPrimary, uLaserSecondary, 0.5 + 0.5 * sin(vWorldPos.z * 0.14 + uTime * 1.4));

  vec3 col = baseMetal;
  col += laserTint * (specStage * 0.45 + rim * 0.16) * (0.25 + 0.75 * uDropPower);
  // 盲眼灯近场封面高光色照亮金属横梁与腹杆边缘
  float nearTop = smoothstep(6.0, 17.5, vWorldPos.y);
  col += uBlinderWarm * uBlinderGlow * (0.14 + 0.28 * nearTop) * (0.25 + 0.75 * max(0.0, dot(vWorldNormal, upLight) * 0.5 + 0.5));

  // 远景雾化衰减
  float dist = length(vWorldPos - cameraPosition);
  col *= exp(-dist * 0.0085);
  col *= (1.0 - 0.82 * uBlackout);

  gl_FragColor = vec4(col, 1.0);
}
`;

// ============================================================================
// 3. 远景巨幅微距 LED 点阵封面主屏与两侧 12 半音频谱灯塔着色器 (LED_MONOLITH)
// ============================================================================
const LED_WALL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const LED_MAIN_FRAG = /* glsl */ `
uniform sampler2D uCover;
uniform float uTime;
uniform float uSectionEnergy;
uniform float uKickPunch;
uniform float uDropPower;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uEnvDark;
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  // 外围窄金属发光包边（外侧 2.2%）
  vec2 edgeDist = min(vUv, 1.0 - vUv);
  float borderMetric = min(edgeDist.x, edgeDist.y);
  if (borderMetric < 0.018) {
    float chase = 0.5 + 0.5 * sin((vUv.x + vUv.y) * 18.0 - uTime * 6.0);
    vec3 frameCol = mix(uEnvDark * 8.0 + vec3(0.01), mix(uLaserPrimary, uLaserSecondary, chase), 0.48 + 0.52 * uDropPower);
    frameCol *= (0.35 + 0.85 * smoothstep(0.004, 0.016, borderMetric)) * (1.0 - 0.85 * uBlackout);
    gl_FragColor = vec4(frameCol, 1.0);
    return;
  }

  // 内部 1:1 完整封面采样（uCover 已为 SRGBColorSpace 硬件解码线性纹理，无需重复 pow 压暗）
  vec2 innerUv = (vUv - 0.018) / 0.964;
  vec2 centered = innerUv - 0.5;
  float zoom = 1.0 - 0.018 * uKickPunch;
  vec2 sampleUv = clamp(centered * zoom + 0.5, 0.002, 0.998);

  float chromaShift = 0.0030 * uKickPunch * uDropPower;
  float r = texture2D(uCover, clamp(sampleUv + vec2(chromaShift, 0.0), 0.002, 0.998)).r;
  float g = texture2D(uCover, sampleUv).g;
  float b = texture2D(uCover, clamp(sampleUv - vec2(chromaShift, 0.0), 0.002, 0.998)).b;
  vec3 texLinear = max(vec3(r, g, b), vec3(0.0));

  // 微距 SMD LED 灯珠晶格：近距离呈现细腻点阵颗粒，远距离基于距离平滑收敛防摩尔纹
  float camDist = length(vWorldPos - cameraPosition);
  float ledDetailFade = 1.0 - smoothstep(18.0, 52.0, camDist);
  vec2 cell = fract(innerUv * 192.0) - 0.5;
  float diode = 1.0 - smoothstep(0.28, 0.52, length(cell));
  float ledMask = mix(1.0, 0.78 + 0.34 * diode, ledDetailFade * 0.72);

  // 扫描刷新微光波纹
  float scanWave = 0.97 + 0.03 * sin(innerUv.y * 90.0 - uTime * 8.0);

  // 亮度控制：保证封面色彩 100% 原汁原味且不过曝洗白
  float gain = (0.72 + 0.20 * uSectionEnergy + 0.10 * uKickPunch) * (1.0 - 0.72 * uBlackout);
  vec3 col = texLinear * ledMask * scanWave * gain;

  // 屏幕内侧边缘柔和暗角压边，增强巨幕立体厚度
  float innerVig = smoothstep(0.0, 0.045, min(min(innerUv.x, 1.0 - innerUv.x), min(innerUv.y, 1.0 - innerUv.y)));
  col *= mix(0.45, 1.0, innerVig);

  gl_FragColor = vec4(col, 1.0);
}
`;

const LED_TOWER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDropPower;
uniform float uKickPunch;
uniform float uBlackout;
uniform vec4 uChroma0;
uniform vec4 uChroma1;
uniform vec4 uChroma2;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uLaserPrimaryCore;
uniform vec3 uEnvDark;
varying vec2 vUv;

float readChroma(int idx) {
  if (idx < 4) return idx == 0 ? uChroma0.x : idx == 1 ? uChroma0.y : idx == 2 ? uChroma0.z : uChroma0.w;
  if (idx < 8) return idx == 4 ? uChroma1.x : idx == 5 ? uChroma1.y : idx == 6 ? uChroma1.z : uChroma1.w;
  return idx == 8 ? uChroma2.x : idx == 9 ? uChroma2.y : idx == 10 ? uChroma2.z : uChroma2.w;
}

void main() {
  // 12 层垂直半音色度能量灯格 + 中轴律动激光条
  float rowF = vUv.y * 12.0;
  int noteIdx = clamp(int(floor(rowF)), 0, 11);
  vec2 cellUv = vec2(vUv.x, fract(rowF));

  float edgeX = smoothstep(0.06, 0.14, min(cellUv.x, 1.0 - cellUv.x));
  float edgeY = smoothstep(0.08, 0.18, min(cellUv.y, 1.0 - cellUv.y));
  float padMask = edgeX * edgeY;

  float noteEnergy = readChroma(noteIdx);
  float barFill = smoothstep(0.5 - 0.42 * clamp(noteEnergy * 1.15 + 0.15 * uKickPunch, 0.05, 1.0), 0.5, 1.0 - abs(cellUv.x - 0.5));

  vec3 tint = mix(uLaserPrimary, uLaserSecondary, float(noteIdx) / 11.0);
  tint = mix(tint, uLaserPrimaryCore, clamp(noteEnergy * 0.35, 0.0, 0.45));
  vec3 darkFrame = uEnvDark * 4.2 + vec3(0.004);
  float lit = padMask * barFill * (0.24 + 0.88 * noteEnergy + 0.30 * uDropPower);

  vec3 col = darkFrame + tint * lit * (1.0 + 0.30 * uKickPunch);
  col *= (1.0 - 0.85 * uBlackout);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ============================================================================
// 4. 湿润黑金反光舞台与场馆地面着色器 (WET_OBSIDIAN_FLOOR)
// ============================================================================
const FLOOR_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FLOOR_FRAG = /* glsl */ `
uniform sampler2D uCover;
uniform float uTime;
uniform float uSectionEnergy;
uniform float uDropPower;
uniform float uKickPunch;
uniform float uBlinderGlow;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uBlinderWarm;
uniform vec3 uEnvDark;
varying vec3 vWorldPos;
varying vec2 vUv;
${GLSL_HAZE_COMMON}

void main() {
  vec3 P = vWorldPos;
  vec3 V = normalize(cameraPosition - P);
  float cosTheta = max(0.02, V.y);

  // 工业黑金混凝土地坪铺装接缝（宽 4.3m × 长 5.25m 矩形地砖）+ 微细粗糙颗粒 + 低频底鼓声压波纹
  vec2 tile = abs(fract(vec2(P.x / 4.3 + 0.5, P.z / 5.25)) - 0.5);
  float seam = 1.0 - smoothstep(0.478, 0.496, max(tile.x, tile.y));
  float microGrain = noise2D(P.xz * 3.8);
  float puddles = smoothstep(0.32, 0.72, hazeFbm(P.xz * 0.14 + vec2(0.0, 2.3)));

  // 底鼓声压从舞台前缘向外扩散的微细水面涟漪
  float distStage = length(vec2(P.x * 0.75, P.z - (${STAGE_LIP_Z.toFixed(1)})));
  float bassWave = sin(distStage * 2.6 - uTime * 11.0) * exp(-distStage * 0.045) * (0.25 + 0.75 * uKickPunch);

  vec3 N = normalize(vec3(
    (microGrain - 0.5) * 0.032 + bassWave * 0.015 * sign(P.x),
    1.0,
    (noise2D(P.xz * 3.8 + 19.1) - 0.5) * 0.032 + bassWave * 0.018
  ));

  // 菲涅尔反射率：水膜积水区（puddles）如黑镜般高反，干燥混凝土区柔和漫反
  float fresnel = 0.06 + 0.94 * pow(1.0 - max(0.0, dot(N, V)), 4.2);
  float reflectivity = mix(0.28, 0.86, puddles) * fresnel * seam;

  // 解析计算远景巨幅 LED 封面主屏在湿润地面上的 1:1 垂直拉丝镜面反射
  vec3 R = reflect(-V, N);
  vec3 screenRefl = vec3(0.0);
  if (R.z < -0.02) {
    float tPlane = (${STAGE_Z.toFixed(1)} - P.z) / R.z;
    if (tPlane > 0.0) {
      vec3 hit = P + R * tPlane;
      // 湿润粗糙表面的各向异性纵向拉丝模糊（3 抽头近似）
      float halfS = ${(SCREEN_SIZE * 0.5).toFixed(2)};
      // 平面镜像中等效虚拟屏幕中心在 y = -SCREEN_CENTER_Y，反射射线 hit.y > 0 对应屏幕高度 hit.y
      vec2 mirrorUv = vec2((hit.x + halfS) / ${SCREEN_SIZE.toFixed(2)}, (hit.y - ${(SCREEN_CENTER_Y - SCREEN_SIZE * 0.5).toFixed(2)}) / ${SCREEN_SIZE.toFixed(2)});
      float inX = smoothstep(-0.08, 0.04, mirrorUv.x) * (1.0 - smoothstep(0.96, 1.08, mirrorUv.x));
      float inY = smoothstep(-0.18, 0.05, mirrorUv.y) * (1.0 - smoothstep(0.95, 1.18, mirrorUv.y));
      if (inX * inY > 0.002) {
        vec2 cUv0 = clamp(mirrorUv, 0.01, 0.99);
        vec2 cUv1 = clamp(mirrorUv + vec2(0.0, 0.045), 0.01, 0.99);
        vec2 cUv2 = clamp(mirrorUv - vec2(0.0, 0.045), 0.01, 0.99);
        vec3 s0 = max(texture2D(uCover, cUv0).rgb, vec3(0.0));
        vec3 s1 = max(texture2D(uCover, cUv1).rgb, vec3(0.0));
        vec3 s2 = max(texture2D(uCover, cUv2).rgb, vec3(0.0));
        screenRefl = (s0 * 0.5 + (s1 + s2) * 0.25) * inX * inY * (0.48 + 0.28 * uSectionEnergy);
      }

      // 两侧频谱灯塔柔和倒影光带
      float towerMask = (exp(-pow((abs(hit.x) - 10.6) * 0.55, 2.0))) * smoothstep(0.0, 4.0, hit.y) * (1.0 - smoothstep(14.0, 19.0, hit.y));
      screenRefl += mix(uLaserPrimary, uLaserSecondary, clamp(hit.y / 16.0, 0.0, 1.0)) * towerMask * (0.18 + 0.32 * uDropPower);
    }
  }

  // 两侧走廊地面工业导光槽（随节拍流淌微光）
  float aisleLine = exp(-pow((abs(P.x) - 16.2) * 3.8, 2.0)) * (0.35 + 0.65 * sin(P.z * 0.4 - uTime * 5.0) * 0.5 + 0.5);
  vec3 floorBase = (uEnvDark * 0.85 + vec3(0.0008)) * (0.65 + 0.55 * microGrain) * seam;
  floorBase += mix(uLaserPrimary, uLaserSecondary, 0.5) * aisleLine * 0.065 * (0.25 + 0.75 * uDropPower);

  // 盲眼灯与顶棚环境光在湿润地面的克制漫射高光带
  float centerGlint = exp(-pow(P.x * 0.085, 2.0)) * smoothstep(22.0, -50.0, P.z);
  vec3 blinderFloor = uBlinderWarm * uBlinderGlow * (0.025 + 0.065 * puddles) * centerGlint;

  // 地面低空流淌的薄纱干冰贴地冷雾（Dry Ice Low-Lying Fog）
  float lowFog = hazeFbm(P.xz * 0.09 + vec2(uTime * 0.08, -uTime * 0.14));
  float stageNear = smoothstep(8.0, -48.0, P.z);
  vec3 groundMist = mix(uLaserPrimary, uLaserSecondary, lowFog) * pow(lowFog, 1.6) * (0.012 + 0.036 * uDropPower) * stageNear;

  // 远距离边界柔和渐隐融入仓库暗底
  float edgeFade = (1.0 - smoothstep(28.0, 35.5, abs(P.x))) * (1.0 - smoothstep(20.0, 31.0, P.z)) * (1.0 - smoothstep(-66.0, -75.0, P.z));

  // 半透明混合：alpha 控制地面遮挡度，使 y < 0 的 1:1 激光/光幕/气柱镜像自然透出并叠加菲涅尔质感！
  vec3 col = (floorBase + screenRefl * reflectivity + blinderFloor + groundMist) * edgeFade;
  col *= (1.0 - 0.85 * uBlackout);

  float floorOpacity = mix(0.84, 0.56, reflectivity * (0.55 + 0.45 * puddles));
  gl_FragColor = vec4(col, floorOpacity);
}
`;

// ============================================================================
// 5. 舞台底座、发光轮廓 DJ 控台与逆光 DJ 剪影着色器 (DJ_STAGE_UNIT)
// ============================================================================
const STAGE_DECK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDropPower;
uniform float uKickPunch;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uEnvDark;
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  // 暗黑金属装甲底色 + 边缘霓虹灯条勾勒
  vec2 edge = min(vUv, 1.0 - vUv);
  float rimX = 1.0 - smoothstep(0.0, 0.025, edge.x);
  float rimY = 1.0 - smoothstep(0.0, 0.055, edge.y);
  float topLip = smoothstep(0.88, 0.98, vUv.y);

  // 水平声波频闪跑马条纹
  float wave = 0.5 + 0.5 * cos(vWorldPos.x * 0.85 - uTime * 9.0);
  float centerChevron = 1.0 - smoothstep(0.02, 0.05, abs(vUv.y - 0.52 - abs(vUv.x - 0.5) * 0.65));

  vec3 neon = mix(uLaserPrimary, uLaserSecondary, wave);
  vec3 col = uEnvDark * 2.8 + vec3(0.002);
  col += neon * (topLip * (0.45 + 0.75 * uKickPunch) + (rimX + rimY) * 0.35 + centerChevron * 0.55 * (0.3 + 0.7 * uDropPower));
  col *= (1.0 - 0.85 * uBlackout);
  gl_FragColor = vec4(col, 1.0);
}
`;

const DJ_SILHOUETTE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBeatPos;
uniform float uDropPower;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uEnvDark;
varying vec2 vUv;

float sdSegment(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(1e-4, dot(ba, ba)), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

void main() {
  // 坐标系 [-1..1] 绘制背靠巨幕强光的 DJ 剪影（头戴耳机 + 随节拍微点头 + 右手高举控场）
  vec2 p = (vUv - 0.5) * 2.0;
  float nod = sin(uBeatPos * 3.14159265 * 2.0) * 0.025 * (0.35 + 0.65 * uDropPower);
  float armPump = sin(uBeatPos * 3.14159265) * 0.08 * uDropPower;

  // 头部与耳机
  vec2 headC = vec2(0.0, 0.34 + nod);
  float dHead = length(p - headC) - 0.145;
  float dPhones = abs(length(p - (headC + vec2(0.0, 0.02))) - 0.165) - 0.024;
  if (p.y < headC.y - 0.02) dPhones = 1.0;

  // 肩部与躯干（倒梯形夹克剪影）
  float torsoY = clamp((p.y + 0.95) / 1.12, 0.0, 1.0);
  float halfTorsoW = mix(0.24, 0.36, smoothstep(0.0, 0.85, torsoY)) * (1.0 - 0.35 * smoothstep(0.85, 1.0, torsoY));
  float dTorso = max(abs(p.x) - halfTorsoW, max(p.y - 0.18, -0.95 - p.y));

  // 左手扶打碟机旋钮，右手随 Drop 高举带气氛
  float dArmL = sdSegment(p, vec2(-0.28, 0.10), vec2(-0.46, -0.32), 0.068);
  vec2 handR = mix(vec2(0.44, -0.22), vec2(0.46, 0.72 + armPump), smoothstep(0.15, 0.75, uDropPower));
  vec2 elbowR = mix(vec2(0.38, -0.05), vec2(0.38, 0.34 + armPump * 0.5), smoothstep(0.15, 0.75, uDropPower));
  float dArmR1 = sdSegment(p, vec2(0.28, 0.10), elbowR, 0.068);
  float dArmR2 = sdSegment(p, elbowR, handR, 0.060);

  float d = min(min(dHead, dPhones), min(dTorso, min(dArmL, min(dArmR1, dArmR2))));
  float alpha = 1.0 - smoothstep(-0.015, 0.022, d);
  if (alpha < 0.01) discard;

  // 剪影内部极暗并融入封面环境暗调，外缘泛起巨幕背光散射的锐利轮廓光（Rim Light）
  float rim = smoothstep(-0.055, -0.004, d);
  vec3 rimTint = mix(uLaserPrimary, uLaserSecondary, 0.5 + 0.5 * p.x);
  vec3 col = uEnvDark * 2.2 + vec3(0.002) + rimTint * rim * (0.45 + 0.60 * uDropPower) * (1.0 - 0.8 * uBlackout);

  gl_FragColor = vec4(col, alpha);
}
`;

// ============================================================================
// 6. 桁架四眼观众盲眼灯着色器 (BLINDER_FLARE — 封面同源热惯性色温余晖)
// ============================================================================
const BLINDER_VERT = /* glsl */ `
attribute vec4 aBlinderPos;   // xyz: 世界坐标, w: 0=天空本体, 1=地面镜像
attribute vec4 aBlinderState; // x: 当前亮度强度 [0..1.4], y: 灯丝色温冷却度 [0=炽亮核..1=封面余晖色], z: 尺寸缩放, w: 相位种子
varying vec2 vQuad;
varying float vPower;
varying float vCool;
varying float vMirror;

void main() {
  vQuad = position.xy;
  vPower = aBlinderState.x;
  vCool = aBlinderState.y;
  vMirror = aBlinderPos.w;

  if (vPower < 0.005) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec3 wp = aBlinderPos.xyz;
  if (vMirror > 0.5) wp.y = -wp.y;

  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float s = aBlinderState.z * (0.75 + 0.85 * min(1.3, vPower));
  // 地面倒影纵向微微拉长以模拟湿润粗糙度拉伸
  vec3 worldVert = wp + camRight * (position.x * s * 1.45) + camUp * (position.y * s * (vMirror > 0.5 ? 1.55 : 0.95));
  gl_Position = projectionMatrix * viewMatrix * vec4(worldVert, 1.0);
}
`;

const BLINDER_FRAG = /* glsl */ `
uniform float uBlackout;
uniform vec3 uBlinderWarm;
uniform vec3 uLaserPrimaryCore;
varying vec2 vQuad;
varying float vPower;
varying float vCool;
varying float vMirror;

void main() {
  float d = length(vQuad);
  if (d > 1.0) discard;

  // 2x2 四眼灯杯亮核 + 精致变形宽银幕水平拉丝眩光（克制光晕半径，避免连片泛白）
  vec2 cell = abs(vQuad) - vec2(0.11, 0.11);
  float pod = exp(-dot(cell, cell) * 76.0);
  float halo = exp(-d * 6.0) * 0.28;
  float streak = exp(-abs(vQuad.y) * 30.0) * pow(max(0.0, 1.0 - abs(vQuad.x)), 2.2) * 0.62;

  // 自适应封面色温热惯性：起音瞬间为封面同色系炽亮核，余晖尾部沉淀为浓郁 uBlinderWarm（黑白封面自动呈铂银白）
  vec3 hotCore = mix(uLaserPrimaryCore, vec3(1.0), 0.38);
  vec3 filamentCol = mix(hotCore, uBlinderWarm, clamp(vCool, 0.0, 1.0));
  vec3 col = mix(filamentCol, mix(uLaserPrimaryCore, vec3(1.0), 0.62), clamp(pod * (1.0 - vCool * 0.75), 0.0, 0.72));

  float intensity = (pod * 1.15 + halo + streak * (1.0 - 0.45 * vCool)) * vPower * 0.62;
  if (vMirror > 0.5) intensity *= 0.32;
  intensity *= (1.0 - 0.88 * uBlackout);

  if (intensity < 0.003) discard;
  gl_FragColor = vec4(col * intensity, 1.0);
}
`;

// ============================================================================
// 7. 振镜扫描体积光膜着色器 (LASER_SHEET — Liquid Sky & Volumetric Fan)
// ============================================================================
const SHEET_VERT = /* glsl */ `
attribute vec4 aSheetOrigin; // xyz: 发射口世界坐标, w: 0=天空本体, 1=地面镜像
attribute vec4 aSheetAngles; // x: yaw(偏航), y: pitch(俯仰), z: roll(滚转), w: spread(半张角 tan)
attribute vec4 aSheetStyle;  // x: 光幕长度(米), y: 功率强度 [0..1.4], z: 色彩混合 [0..1], w: 波浪折痕幅度
uniform float uTime;
varying vec2 vSheetUv; // x ∈ [-1..1] 扇面横向归一化角, y ∈ [0..1] 沿射程距离
varying vec3 vWorldPos;
varying vec3 vOrigin;
varying float vPower;
varying float vColorMix;
varying float vMirror;
varying float vWaveAmp;

void main() {
  // 基础几何体为细分扇形网格：position.x ∈ [-1..1] 横向展开，position.z ∈ [0..1] 沿射程延伸
  vSheetUv = vec2(position.x, position.z);
  vPower = aSheetStyle.y;
  vColorMix = aSheetStyle.z;
  vMirror = aSheetOrigin.w;
  vWaveAmp = aSheetStyle.w;

  if (vPower < 0.008) {
    vWorldPos = vec3(0.0);
    vOrigin = vec3(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float dist = position.z * aSheetStyle.x;
  float lateral = position.x * dist * aSheetAngles.w;
  // Liquid Sky 液态天幕：振镜正弦调制赋予光膜丝绸般起伏的法向波浪折痕
  float waveY = sin(position.x * 4.5 + uTime * 5.2 + aSheetOrigin.x * 0.4) * vWaveAmp * dist * 0.065;

  // 局部射线在 +Z 朝向（由舞台射向观众席），依次应用 roll -> pitch -> yaw 欧拉旋转
  vec3 local = vec3(lateral, waveY, dist);

  float cr = cos(aSheetAngles.z), sr = sin(aSheetAngles.z);
  local.xy = mat2(cr, -sr, sr, cr) * local.xy;

  float cp = cos(aSheetAngles.y), sp = sin(aSheetAngles.y);
  local.yz = mat2(cp, -sp, sp, cp) * local.yz;

  float cy = cos(aSheetAngles.x), sy = sin(aSheetAngles.x);
  local.xz = mat2(cy, sy, -sy, cy) * local.xz;

  vec3 orig = aSheetOrigin.xyz;
  vec3 wp = orig + local;
  if (vMirror > 0.5) {
    orig.y = -orig.y;
    wp.y = -wp.y;
  }

  vOrigin = orig;
  vWorldPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SHEET_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uLaserPrimaryCore;
uniform vec3 uLaserSecondaryCore;
varying vec2 vSheetUv;
varying vec3 vWorldPos;
varying vec3 vOrigin;
varying float vPower;
varying float vColorMix;
varying float vMirror;
varying float vWaveAmp;
${GLSL_HAZE_COMMON}

void main() {
  if (vPower < 0.008) discard;
  // 严格裁剪地面穿透：天空本体只渲染在 y >= 0，地面镜像只渲染在 y <= 0
  if (vMirror < 0.5 && vWorldPos.y < -0.02) discard;
  if (vMirror > 0.5 && vWorldPos.y > 0.02) discard;

  float u = vSheetUv.x; // [-1..1]
  float r = vSheetUv.y; // [0..1]

  // 1. 振镜折返边缘驻留增亮（Galvo Dwell）：扇面左右两端减速折返锐利明亮，内部底膜晶莹通透绝不糊死背景巨幕
  float absU = abs(u);
  float edgeOuter = exp(-pow((1.0 - absU) * 34.0, 2.0)) * 1.08;
  float interiorFill = (1.0 - smoothstep(0.96, 1.0, absU)) * (0.056 + 0.062 * pow(absU, 2.0));

  // 2. 振镜高速离散扫描丝与角度光束手指（Laser Fingers / Blanked Sub-rays）
  float fingers = pow(0.5 + 0.5 * cos(u * 32.0 + sin(uTime * 3.0) * 1.5), 7.0) * 0.38;
  float highFreqScan = 0.90 + 0.10 * sin(u * 110.0 - uTime * 38.0);

  // 3. 3D 干冰烟雾湍流云纹（FBM Volumetric Haze）：烟雾浓处丁达尔散射如液态丝绸，淡处通透深邃
  vec2 hazeCoord = vWorldPos.xz * 0.085 + vec2(vWorldPos.y * 0.06, -uTime * 0.22);
  float haze1 = hazeFbm(hazeCoord);
  float haze2 = hazeFbm(hazeCoord * 2.1 + vec2(uTime * 0.15, 4.7));
  float smokeDensity = 0.24 + 1.30 * pow(haze1 * 0.65 + haze2 * 0.35, 1.55);

  // 4. 发射口近端能量亮星 + 远端柔和消散
  float originBoost = 0.055 / (0.085 + r * r) * exp(-absU * 5.5);
  float distAtten = (1.0 - smoothstep(0.62, 1.0, r)) * smoothstep(0.0, 0.015, r);

  // 5. 镜头迎面掠过前向散射微增亮（Liquid Sky 贴近视线高度时更具包裹感）
  float eyeProx = exp(-abs(vWorldPos.y - cameraPosition.y) * 0.45) * (1.0 - vMirror);
  float mieBoost = 1.0 + 0.38 * eyeProx;

  float mixU = clamp(vColorMix + u * 0.16, 0.0, 1.0);
  vec3 baseLaser = mix(uLaserPrimary, uLaserSecondary, mixU);
  vec3 baseCore = mix(uLaserPrimaryCore, uLaserSecondaryCore, mixU);
  float density = (interiorFill + fingers + edgeOuter) * highFreqScan * smokeDensity * distAtten * mieBoost + originBoost * 0.24;
  // 由高饱和基色向同色相高明度亮核过渡，杜绝白芯泛滥洗淡封面原生色彩
  vec3 col = mix(baseLaser, baseCore, clamp(edgeOuter * 0.58 + originBoost * 0.48, 0.0, 0.84))
           + vec3(0.10) * clamp(originBoost * 0.35, 0.0, 0.16);

  float alpha = density * vPower * 0.165;
  if (vMirror > 0.5) alpha *= 0.38;
  alpha *= (1.0 - 0.88 * uBlackout);

  if (alpha < 0.002) discard;
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

// ============================================================================
// 8. 军鼓 / 重音 X 型交叉铡刀单束快切着色器 (LASER_BEAM — 含发射口宽银幕眩光)
// ============================================================================
const BEAM_VERT = /* glsl */ `
attribute vec4 aBeamStart; // xyz: 发射口世界坐标, w: 0=天空本体, 1=地面镜像
attribute vec4 aBeamEnd;   // xyz: 终点世界坐标, w: 光束半宽(米)
attribute vec4 aBeamStyle; // x: 脉冲亮度 [0..1.4], y: 色彩权重 [0..1], z: 脉冲行进相位, w: 种子
varying vec2 vBeamUv;      // x ∈ [0..1] 沿光束轴向, y ∈ [-1..1] 横向截面
varying vec3 vWorldPos;
varying float vPower;
varying float vColorMix;
varying float vPulsePhase;
varying float vMirror;

void main() {
  vBeamUv = vec2(uv.x, (uv.y - 0.5) * 2.0);
  vPower = aBeamStyle.x;
  vColorMix = aBeamStyle.y;
  vPulsePhase = aBeamStyle.z;
  vMirror = aBeamStart.w;

  if (vPower < 0.01) {
    vWorldPos = vec3(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec3 p0 = aBeamStart.xyz;
  vec3 p1 = aBeamEnd.xyz;
  if (vMirror > 0.5) {
    p0.y = -p0.y;
    p1.y = -p1.y;
  }

  vec3 spine = mix(p0, p1, uv.x);
  vec3 beamDir = normalize(p1 - p0);
  vec3 toCam = normalize(cameraPosition - spine);
  vec3 side = cross(beamDir, toCam);
  float sideLen = length(side);
  side = sideLen > 1e-4 ? side / sideLen : vec3(1.0, 0.0, 0.0);

  // 起点发射口处稍微放宽以容纳水平变形眩光，远端微微扩散
  float halfW = aBeamEnd.w * (1.0 + 0.55 * uv.x) * (0.85 + 0.45 * min(1.2, vPower));
  vec3 wp = spine + side * (vBeamUv.y * halfW);
  vWorldPos = wp;

  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uLaserPrimaryCore;
uniform vec3 uLaserSecondaryCore;
varying vec2 vBeamUv;
varying vec3 vWorldPos;
varying float vPower;
varying float vColorMix;
varying float vPulsePhase;
varying float vMirror;
${GLSL_HAZE_COMMON}

void main() {
  if (vPower < 0.01) discard;
  if (vMirror < 0.5 && vWorldPos.y < -0.02) discard;
  if (vMirror > 0.5 && vWorldPos.y > 0.02) discard;

  float s = vBeamUv.x;        // [0..1] 射程进度
  float d = abs(vBeamUv.y);   // [0..1] 离中心轴距离

  // 锐利同色系亮芯 + 宽阔浓郁的丁达尔窄带激光色晕，确保单束激光一眼呈现饱满封面色
  float core = exp(-d * d * 86.0);
  float corona = exp(-d * 3.5) * 0.66;

  // 发射口起点高强星芒能量点
  float emitterHotspot = exp(-s * 34.0) * exp(-d * d * 18.0) * 1.15;
  // 光速脉冲团沿射线疾驰而过
  float packet = exp(-pow((s - vPulsePhase) * 5.5, 2.0)) * 0.48;

  // 穿过空间干冰烟雾时的丁达尔明暗起伏
  float mist = 0.50 + 0.72 * hazeFbm(vWorldPos.xz * 0.11 + vec2(vWorldPos.y * 0.09, -uTime * 0.25));
  float endFade = (1.0 - smoothstep(0.75, 1.0, s)) * smoothstep(0.0, 0.008, s);

  vec3 tint = mix(uLaserPrimary, uLaserSecondary, vColorMix);
  vec3 tintCore = mix(uLaserPrimaryCore, uLaserSecondaryCore, vColorMix);
  vec3 col = mix(tint, tintCore, clamp(core * 0.80 + emitterHotspot * 0.45, 0.0, 0.90))
           + vec3(0.14) * pow(core, 3.6);

  float alpha = ((core * 1.15 + corona) * (1.0 + packet) * mist * endFade + emitterHotspot * 0.42) * vPower * 0.76;
  if (vMirror > 0.5) alpha *= 0.42;
  alpha *= (1.0 - 0.88 * uBlackout);

  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

// ============================================================================
// 9. 旋转空心断线激光锥笼着色器 (LASER_CONE — 包裹镜头的几何激光隧道)
// ============================================================================
const CONE_VERT = /* glsl */ `
attribute vec4 aConeSpec; // x: 末端半径缩放, y: 旋转角速度符号/倍率, z: 功率强度 [0..1.3], w: 0=天空本体, 1=地面镜像
uniform float uTime;
uniform float uConePitch;
varying vec2 vConeUv; // x: 圆周角 [0..1], y: 轴向进度 [0..1] (0=舞台顶点, 1=观众席大口)
varying vec3 vWorldPos;
varying float vConePower;
varying float vSpinDir;
varying float vMirror;

void main() {
  vConeUv = uv;
  vConePower = aConeSpec.z;
  vSpinDir = aConeSpec.y;
  vMirror = aConeSpec.w;

  if (vConePower < 0.01) {
    vWorldPos = vec3(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // 圆锥起点自舞台主屏外围空心光环发散（不糊死屏幕中心封面），向 +Z 观众席延伸 70m 包裹镜头
  float s = uv.y; // [0..1]
  float theta = uv.x * 6.2831853;
  float r = (1.65 + s * 16.8) * aConeSpec.x;

  vec3 apex = vec3(0.0, 8.6, -52.2);
  vec3 axisDir = normalize(vec3(0.0, uConePitch, 1.0));
  vec3 right = vec3(1.0, 0.0, 0.0);
  vec3 upOrtho = normalize(cross(axisDir, right));

  vec3 wp = apex + axisDir * (s * 70.0) + (right * cos(theta) + upOrtho * sin(theta)) * r;
  if (vMirror > 0.5) wp.y = -wp.y;

  vWorldPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const CONE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uConeSpin;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uLaserPrimaryCore;
uniform vec3 uLaserSecondaryCore;
varying vec2 vConeUv;
varying vec3 vWorldPos;
varying float vConePower;
varying float vSpinDir;
varying float vMirror;
${GLSL_HAZE_COMMON}

void main() {
  if (vConePower < 0.01) discard;
  if (vMirror < 0.5 && vWorldPos.y < -0.02) discard;
  if (vMirror > 0.5 && vWorldPos.y > 0.02) discard;

  float theta = vConeUv.x * 6.2831853 + uConeSpin * vSpinDir;
  float s = vConeUv.y;

  // Pangolin BEYOND 标志性断线圆锥花式（Blanked Laser Cone）：24 束刀锋般离散射线 + 极薄丁达尔锥壁
  float rayWave = cos(theta * 24.0);
  float sharpRay = pow(max(0.0, rayWave), 28.0);
  float softSheet = 0.018 + 0.036 * pow(max(0.0, rayWave), 3.0);

  // 断续脉冲门控（Blanking Gate）沿圆锥高速向前奔涌
  float axialPulse = 0.35 + 0.85 * smoothstep(-0.2, 0.45, sin(s * 26.0 - uTime * 12.0 + vSpinDir * 1.5));
  float mist = 0.44 + 0.82 * hazeFbm(vWorldPos.xz * 0.09 + vec2(vWorldPos.y * 0.08, -uTime * 0.24));

  float ringOrigin = 0.035 * exp(-s * 16.0);
  float distFade = (1.0 - smoothstep(0.68, 1.0, s)) * smoothstep(0.008, 0.055, s);

  float colorSel = clamp((vSpinDir > 0.0 ? 0.08 : 0.92) + 0.14 * sin(theta * 3.0), 0.0, 1.0);
  vec3 tint = mix(uLaserPrimary, uLaserSecondary, colorSel);
  vec3 tintCore = mix(uLaserPrimaryCore, uLaserSecondaryCore, colorSel);
  vec3 col = mix(tint, tintCore, clamp(sharpRay * 0.78, 0.0, 0.88)) + vec3(0.10) * pow(sharpRay, 2.4);

  float alpha = ((sharpRay * 1.65 + softSheet) * axialPulse * mist * distFade + ringOrigin) * vConePower * 0.27;
  if (vMirror > 0.5) alpha *= 0.36;
  alpha *= (1.0 - 0.88 * uBlackout);

  if (alpha < 0.002) discard;
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

// ============================================================================
// 10. 舞台前缘 CO2 低温白雾喷射气柱着色器 (CRYO_JET — 高压射流 + 实时激光染光)
// ============================================================================
const CRYO_VERT = /* glsl */ `
attribute vec4 aCryoBase;  // xyz: 喷嘴世界坐标, w: 0=天空本体, 1=地面镜像
attribute vec4 aCryoState; // x: 归一化喷发年龄 [0..1], y: 强度 [0..1.3], z: 喷柱最大高度(米), w: 随机种子
varying vec2 vCryoUv;      // x ∈ [-1..1] 横向宽度, y ∈ [0..1] 自喷口向上高度
varying vec3 vWorldPos;
varying float vAge;
varying float vStrength;
varying float vSeed;
varying float vMirror;

void main() {
  vCryoUv = vec2((uv.x - 0.5) * 2.0, uv.y);
  vAge = aCryoState.x;
  vStrength = aCryoState.y;
  vSeed = aCryoState.w;
  vMirror = aCryoBase.w;

  if (vStrength < 0.01) {
    vWorldPos = vec3(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // 喷柱在 0.12 归一化时间内极速冲顶，随后向上膨胀扩散消散
  float reach = smoothstep(0.0, 0.16, vAge) * (0.85 + 0.25 * vAge);
  float h = uv.y * aCryoState.z * reach;
  // 底部喷口紧束（0.22m），中上部湍流膨胀至 2.4m..3.5m
  float plumeHalfW = mix(0.22, 2.35 + 1.15 * vAge, pow(uv.y, 0.72));

  vec3 basePos = aCryoBase.xyz;
  float dirY = vMirror > 0.5 ? -1.0 : 1.0;
  if (vMirror > 0.5) basePos.y = -basePos.y;

  vec3 spine = basePos + vec3(0.0, dirY * h, 0.0);
  vec3 toCam = cameraPosition - spine;
  toCam.y = 0.0;
  vec3 right = length(toCam) > 1e-4 ? normalize(cross(vec3(0.0, 1.0, 0.0), toCam)) : vec3(1.0, 0.0, 0.0);

  vec3 wp = spine + right * (vCryoUv.x * plumeHalfW);
  vWorldPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const CRYO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBlinderGlow;
uniform float uBlackout;
uniform vec3 uLaserPrimary;
uniform vec3 uLaserSecondary;
uniform vec3 uBlinderWarm;
varying vec2 vCryoUv;
varying vec3 vWorldPos;
varying float vAge;
varying float vStrength;
varying float vSeed;
varying float vMirror;
${GLSL_HAZE_COMMON}

void main() {
  if (vStrength < 0.01) discard;
  if (vMirror < 0.5 && vWorldPos.y < -0.02) discard;
  if (vMirror > 0.5 && vWorldPos.y > 0.02) discard;

  float x = vCryoUv.x; // [-1..1]
  float y = vCryoUv.y; // [0..1]

  // 高速向上翻滚的高压低温水雾噪声
  vec2 flowUv = vec2(x * 1.6 + vSeed * 7.3, y * 3.4 - uTime * 7.5);
  float turb1 = hazeFbm(flowUv);
  float turb2 = hazeFbm(flowUv * 2.2 - vec2(0.0, uTime * 4.5));
  float billow = turb1 * 0.62 + turb2 * 0.38;

  // 横向高斯核心 + 湍流边缘蚕食，避免生硬矩形感
  float radial = max(0.0, 1.0 - abs(x) - (1.0 - billow) * 0.48 * smoothstep(0.05, 0.65, y));
  radial = smoothstep(0.0, 0.55, radial);

  // 喷嘴根部超音速高压白芯 + 随年龄底部先断气、顶部云团升空消散
  float cutoffBottom = smoothstep(max(0.0, (vAge - 0.32) * 1.15), max(0.08, (vAge - 0.32) * 1.15 + 0.28), y);
  float topSoft = 1.0 - smoothstep(0.68, 1.0, y);
  float nozzleCore = exp(-y * 10.0) * exp(-x * x * 8.0) * (1.0 - smoothstep(0.28, 0.52, vAge)) * 1.8;

  float lifeFade = (1.0 - smoothstep(0.45, 1.0, vAge));
  float density = (radial * billow * cutoffBottom * topSoft * 1.35 + nozzleCore) * vStrength * lifeFade;

  // 低温白雾被上方封面双色激光与同系盲眼灯实时穿透染色
  vec3 laserMix = mix(uLaserPrimary, uLaserSecondary, clamp(y * 0.85 + 0.15 * x, 0.0, 1.0));
  vec3 steamBase = vec3(0.86, 0.88, 0.91);
  vec3 litColor = steamBase * 0.26 + laserMix * 0.92 + uBlinderWarm * uBlinderGlow * 0.30;
  vec3 col = mix(litColor, mix(laserMix, vec3(1.0), 0.72), clamp(nozzleCore * 0.52, 0.0, 0.72));

  float alpha = density * (vMirror > 0.5 ? 0.20 : 0.46) * (1.0 - 0.85 * uBlackout);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

// ============================================================================
// 主场景类：LaserScene（激光舞台 · 镭射穹廊）
// ============================================================================
export class LaserScene implements MvScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly rig: LyricRig;
  private readonly soft: boolean;
  private readonly colorTrack: LeadColorTrack;

  private readonly sheetSpecs: SheetEmitterSpec[];
  private readonly beamSpecs: BeamEmitterSpec[];
  private readonly choppers: ChopperHitEvent[];
  private readonly chopperTimes: Float64Array;
  private readonly cryos: CryoBlastEvent[];
  private readonly cryoTimes: Float64Array;

  private readonly uniforms: Record<string, THREE.IUniform>;

  private readonly blinderPosAttr: THREE.InstancedBufferAttribute;
  private readonly blinderStateAttr: THREE.InstancedBufferAttribute;
  private readonly blinderCoords: Array<{ x: number; y: number; z: number; portalIdx: number; side: number }>;

  private readonly sheetAnglesAttr: THREE.InstancedBufferAttribute;
  private readonly sheetStyleAttr: THREE.InstancedBufferAttribute;

  private readonly beamStartAttr: THREE.InstancedBufferAttribute;
  private readonly beamEndAttr: THREE.InstancedBufferAttribute;
  private readonly beamStyleAttr: THREE.InstancedBufferAttribute;

  private readonly coneSpecAttr: THREE.InstancedBufferAttribute;
  private readonly cryoStateAttr: THREE.InstancedBufferAttribute;

  constructor(init: SceneInit, look: 'pulse' | 'ballad' = 'pulse') {
    this.soft = look === 'ballad';
    const pal = buildCoverLaserColors(init);
    this.scene.background = pal.bgHex;
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, init.aspect, 0.2, 240);
    this.scene.add(this.camera);

    // 1. 构建主音色主导 / 人声融合时间轨，驱动封面主副激光色随编曲声部有机流转
    this.colorTrack = buildLeadColorTrack(init.music, init.lyrics);

    this.uniforms = {
      uCover: { value: init.cover },
      uTime: { value: 0 },
      uBeatPos: { value: 0 },
      uSectionEnergy: { value: 0.7 },
      uDropPower: { value: 0 },
      uKickPunch: { value: 0 },
      uBlinderGlow: { value: 0 },
      uBlackout: { value: 0 },
      uConeSpin: { value: 0 },
      uConePitch: { value: -0.075 },
      uChroma0: { value: new THREE.Vector4(0.3, 0.3, 0.3, 0.3) },
      uChroma1: { value: new THREE.Vector4(0.3, 0.3, 0.3, 0.3) },
      uChroma2: { value: new THREE.Vector4(0.3, 0.3, 0.3, 0.3) },
      uLaserPrimary: { value: pal.laserPrimary },
      uLaserSecondary: { value: pal.laserSecondary },
      uLaserPrimaryCore: { value: pal.laserPrimaryCore },
      uLaserSecondaryCore: { value: pal.laserSecondaryCore },
      uCoverGlow: { value: pal.coverGlow },
      uBlinderWarm: { value: pal.blinderWarm },
      uEnvDark: { value: pal.envDark },
    };

    // 2. 预计算发射器坐标与确定性控台事件表
    this.sheetSpecs = buildSheetEmitters();
    this.beamSpecs = buildBeamEmitters();
    const ev = buildLaserShowEvents(init.music, init.seed ?? 1);
    this.choppers = ev.choppers;
    this.chopperTimes = ev.chopperTimes;
    this.cryos = ev.cryos;
    this.cryoTimes = ev.cryoTimes;

    // 3. 构建巨型仓库穹顶与体积雾背板（renderOrder = -2）
    const backdropGeo = new THREE.BoxGeometry(110, 68, 165);
    const backdropMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    const backdropMesh = new THREE.Mesh(backdropGeo, backdropMat);
    backdropMesh.position.set(0, 12, -24);
    backdropMesh.renderOrder = -2;
    backdropMesh.frustumCulled = false;
    this.scene.add(backdropMesh);

    // 4. 构建湿润黑金反光舞台与场馆地坪（y = 0, renderOrder = -1, depthWrite = false 以透出下方镜像激光）
    const floorGeo = new THREE.PlaneGeometry(76, 114, 1, 1);
    floorGeo.rotateX(-Math.PI * 0.5);
    const floorMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      depthWrite: false,
      depthTest: true,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(0, 0, -22);
    floorMesh.renderOrder = -1;
    floorMesh.frustumCulled = false;
    this.scene.add(floorMesh);

    // 5. 构建 7 道工业重型四弦铝合金门式桁架龙门 + 2 条贯通顶棚主轨 + 舞台屏幕背架（renderOrder = 0）
    this.buildTrussArchitecture();

    // 6. 构建远景舞台高台、巨幅微距 LED 封面主屏、两侧 12 半音频谱副屏、DJ 控台与逆光 DJ 剪影
    this.buildStageCenterpiece();

    // 7. 构建 28 组四眼卤素观众盲眼灯（×2 本体+镜像 = 56 实例）
    const blinders = this.buildBlinderSystem();
    this.blinderPosAttr = blinders.posAttr;
    this.blinderStateAttr = blinders.stateAttr;
    this.blinderCoords = blinders.coords;

    // 8. 构建 14 座振镜扫描体积光膜（Liquid Sky & Fan Sheets，×2 本体+镜像 = 28 实例）
    const sheets = this.buildLaserSheets();
    this.sheetAnglesAttr = sheets.anglesAttr;
    this.sheetStyleAttr = sheets.styleAttr;

    // 9. 构建 36 束军鼓/重音 X 型交叉铡刀单束激光（×2 本体+镜像 = 72 实例）
    const beams = this.buildLaserBeams();
    this.beamStartAttr = beams.startAttr;
    this.beamEndAttr = beams.endAttr;
    this.beamStyleAttr = beams.styleAttr;

    // 10. 构建双层反向旋转空心断线激光锥笼（×2 本体+镜像 = 4 实例）
    this.coneSpecAttr = this.buildLaserCones();

    // 11. 构建舞台前缘 8 座 CO2 低温白雾喷射气柱（×2 本体+镜像 = 16 实例）
    this.cryoStateAttr = this.buildCryoJets();

    // 12. 挂载三维双语歌词排版系统（底部 caption 干净呈现，严格同步封面色系；黑白封面保持纯正铂银白）
    const lyricPalette: Palette = {
      ...init.palette,
      ink: colorFromHsl(pal.lyricHue, pal.mono ? 0.04 : 0.48, 0.05),
      paper: new THREE.Color('#f8fbff'),
      signal: colorFromHsl(pal.lyricHue, pal.mono ? 0.06 : 0.92, pal.mono ? 0.88 : 0.70),
      light: false,
    };
    this.rig = new LyricRig(lyricPalette, 'caption');
    this.rig.faces = voiceFaces(look, init.seed ?? 1);
    this.rig.layoutFov = CAM_FOV;
    this.scene.add(this.rig.group);
  }

  /** 构建纵深工业重型四弦方管桁架结构 */
  private buildTrussArchitecture(): void {
    const parts: Array<{ pos: [number, number, number]; rotZ: number; rotX: number; scale: [number, number, number]; meta: [number, number, number, number] }> = [];
    const trussW = 0.88;

    PORTAL_Z.forEach((z, idx) => {
      // 左立柱
      parts.push({
        pos: [-PORTAL_HALF_W, PORTAL_H * 0.5, z],
        rotZ: 0,
        rotX: 0,
        scale: [trussW, PORTAL_H, trussW],
        meta: [PORTAL_H, trussW, 0, idx],
      });
      // 右立柱
      parts.push({
        pos: [PORTAL_HALF_W, PORTAL_H * 0.5, z],
        rotZ: 0,
        rotX: 0,
        scale: [trussW, PORTAL_H, trussW],
        meta: [PORTAL_H, trussW, 0, idx],
      });
      // 顶横梁
      const spanW = PORTAL_HALF_W * 2 + trussW;
      parts.push({
        pos: [0, PORTAL_H + trussW * 0.35, z],
        rotZ: Math.PI * 0.5,
        rotX: 0,
        scale: [trussW, spanW, trussW],
        meta: [spanW, trussW, 0, idx],
      });
      // 两侧高空斜撑角隅加固杆（Knee Braces）
      parts.push({
        pos: [-PORTAL_HALF_W + 2.2, PORTAL_H - 1.8, z],
        rotZ: -Math.PI * 0.25,
        rotX: 0,
        scale: [0.58, 5.2, 0.58],
        meta: [5.2, 0.58, 0, idx],
      });
      parts.push({
        pos: [PORTAL_HALF_W - 2.2, PORTAL_H - 1.8, z],
        rotZ: Math.PI * 0.25,
        rotX: 0,
        scale: [0.58, 5.2, 0.58],
        meta: [5.2, 0.58, 0, idx],
      });
    });

    // 两条纵贯仓库顶棚的主吊挂长梁（x = ±8.6m）
    for (const sx of [-8.6, 8.6]) {
      parts.push({
        pos: [sx, PORTAL_H - 0.35, -20.5],
        rotZ: 0,
        rotX: Math.PI * 0.5,
        scale: [0.68, 68.0, 0.68],
        meta: [68.0, 0.68, 0, 0],
      });
    }

    // 远景巨幕两侧竖向重型背架立塔
    for (const sx of [-13.4, 13.4]) {
      parts.push({
        pos: [sx, 9.6, STAGE_Z - 0.6],
        rotZ: 0,
        rotX: 0,
        scale: [0.95, 19.2, 0.95],
        meta: [19.2, 0.95, 1, 0],
      });
    }

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const trussMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: TRUSS_VERT,
      fragmentShader: TRUSS_FRAG,
      side: THREE.DoubleSide,
    });

    const instMesh = new THREE.InstancedMesh(boxGeo, trussMat, parts.length);
    const metaArr = new Float32Array(parts.length * 4);
    const dummy = new THREE.Object3D();

    parts.forEach((p, i) => {
      dummy.position.set(p.pos[0], p.pos[1], p.pos[2]);
      dummy.rotation.set(p.rotX, 0, p.rotZ);
      dummy.scale.set(p.scale[0], p.scale[1], p.scale[2]);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);
      metaArr.set(p.meta, i * 4);
    });

    boxGeo.setAttribute('aTrussMeta', new THREE.InstancedBufferAttribute(metaArr, 4));
    instMesh.instanceMatrix.needsUpdate = true;
    instMesh.frustumCulled = false;
    instMesh.renderOrder = 0;
    this.scene.add(instMesh);
  }

  /** 构建中央巨幅微距 LED 封面主屏、频谱灯塔、舞台底座、DJ 控台与逆光 DJ 剪影 */
  private buildStageCenterpiece(): void {
    // 1. 中央 1:1 巨幅微距 LED 点阵封面主屏
    const screenGeo = new THREE.PlaneGeometry(SCREEN_SIZE, SCREEN_SIZE);
    const screenMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: LED_WALL_VERT,
      fragmentShader: LED_MAIN_FRAG,
    });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(0, SCREEN_CENTER_Y, STAGE_Z);
    screenMesh.renderOrder = 0;
    this.scene.add(screenMesh);

    // 2. 两侧 12 半音色度频谱副屏灯塔（微微向内折角 12°）
    const towerGeo = new THREE.PlaneGeometry(2.55, 14.8);
    const towerMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: LED_WALL_VERT,
      fragmentShader: LED_TOWER_FRAG,
    });
    for (const sign of [-1, 1]) {
      const tower = new THREE.Mesh(towerGeo, towerMat);
      tower.position.set(sign * 10.65, 9.75, STAGE_Z + 0.65);
      tower.rotation.y = -sign * 0.21;
      tower.renderOrder = 0;
      this.scene.add(tower);
    }

    // 3. 舞台底座高台（Stage Riser）与装甲发光轮廓 DJ 控台（DJ Booth）
    const deckMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: LED_WALL_VERT,
      fragmentShader: STAGE_DECK_FRAG,
    });
    const stageRiser = new THREE.Mesh(new THREE.BoxGeometry(31.0, STAGE_DECK_H, 9.4), deckMat);
    stageRiser.position.set(0, STAGE_DECK_H * 0.5, STAGE_LIP_Z - 4.7);
    stageRiser.renderOrder = 0;
    this.scene.add(stageRiser);

    const djBooth = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.38, 1.85), deckMat);
    djBooth.position.set(0, STAGE_DECK_H + 0.69, -49.2);
    djBooth.renderOrder = 0;
    this.scene.add(djBooth);

    // 4. 逆光控场 DJ 剪影（立于 DJ 控台后方，背对巨幕强光）
    const djGeo = new THREE.PlaneGeometry(2.3, 2.3);
    const djMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: LED_WALL_VERT,
      fragmentShader: DJ_SILHOUETTE_FRAG,
      transparent: true,
      depthWrite: true,
    });
    const djMesh = new THREE.Mesh(djGeo, djMat);
    djMesh.position.set(0, STAGE_DECK_H + 1.68, -50.25);
    djMesh.renderOrder = 1;
    this.scene.add(djMesh);
  }

  /** 构建 28 组四眼卤素观众盲眼灯系统（含地面镜像） */
  private buildBlinderSystem() {
    const coords: Array<{ x: number; y: number; z: number; portalIdx: number; side: number }> = [];
    // 前 5 道主视野龙门桁架每道挂载 4 组顶梁盲眼灯 + 2 组侧柱盲眼灯（5×5 + 3 = 28 组）
    for (let p = 0; p < 6; p++) {
      const z = PORTAL_Z[p];
      const xs = p < 4 ? [-11.8, -4.6, 4.6, 11.8] : [-10.5, 10.5];
      xs.forEach((x, k) => {
        coords.push({ x, y: PORTAL_H - 0.35, z: z + 0.3, portalIdx: p, side: k % 2 === 0 ? -1 : 1 });
      });
    }
    // 补齐至 BLINDER_COUNT (28) 组：舞台前缘两侧低位观众暖光灯
    while (coords.length < BLINDER_COUNT) {
      const idx = coords.length - 20;
      const u = ((idx % 4) / 3) * 2 - 1;
      coords.push({ x: u * 12.8, y: STAGE_DECK_H + 0.35, z: STAGE_LIP_Z + 0.3, portalIdx: 0, side: u < 0 ? -1 : 1 });
    }

    const total = BLINDER_COUNT * 2;
    const baseQuad = new THREE.PlaneGeometry(2, 2);
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = baseQuad.index;
    instGeo.attributes.position = baseQuad.attributes.position;
    instGeo.instanceCount = total;

    const posArr = new Float32Array(total * 4);
    const stateArr = new Float32Array(total * 4);
    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < BLINDER_COUNT; i++) {
        const slot = (mirror * BLINDER_COUNT + i) * 4;
        const c = coords[i];
        posArr[slot] = c.x;
        posArr[slot + 1] = c.y;
        posArr[slot + 2] = c.z;
        posArr[slot + 3] = mirror;

        stateArr[slot] = 0;
        stateArr[slot + 1] = 0.5;
        stateArr[slot + 2] = c.y < 4.0 ? 0.85 : 1.06;
        stateArr[slot + 3] = (i * 0.37) % 1;
      }
    }

    const posAttr = new THREE.InstancedBufferAttribute(posArr, 4);
    const stateAttr = new THREE.InstancedBufferAttribute(stateArr, 4);
    stateAttr.setUsage(THREE.DynamicDrawUsage);
    instGeo.setAttribute('aBlinderPos', posAttr);
    instGeo.setAttribute('aBlinderState', stateAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BLINDER_VERT,
      fragmentShader: BLINDER_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(instGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.scene.add(mesh);

    return { posAttr, stateAttr, coords };
  }

  /** 构建振镜扫描体积光膜网格（横向 36 段细分以呈现丝滑的正弦波浪 Liquid Sky 折痕） */
  private buildLaserSheets() {
    const segX = 36;
    const segZ = 16;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let iz = 0; iz <= segZ; iz++) {
      const rz = iz / segZ;
      for (let ix = 0; ix <= segX; ix++) {
        const rx = (ix / segX) * 2 - 1;
        positions.push(rx, 0, rz);
      }
    }
    const stride = segX + 1;
    for (let iz = 0; iz < segZ; iz++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = iz * stride + ix;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const total = SHEET_EMITTER_COUNT * 2;
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    instGeo.setIndex(indices);
    instGeo.instanceCount = total;

    const originArr = new Float32Array(total * 4);
    const anglesArr = new Float32Array(total * 4);
    const styleArr = new Float32Array(total * 4);

    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < SHEET_EMITTER_COUNT; i++) {
        const slot = (mirror * SHEET_EMITTER_COUNT + i) * 4;
        const sp = this.sheetSpecs[i];
        originArr[slot] = sp.x;
        originArr[slot + 1] = sp.y;
        originArr[slot + 2] = sp.z;
        originArr[slot + 3] = mirror;

        anglesArr[slot] = sp.baseYaw;
        anglesArr[slot + 1] = sp.basePitch;
        anglesArr[slot + 2] = 0;
        anglesArr[slot + 3] = 0.42;

        styleArr[slot] = sp.length;
        styleArr[slot + 1] = 0;
        styleArr[slot + 2] = i % 2;
        styleArr[slot + 3] = 0.5;
      }
    }

    const originAttr = new THREE.InstancedBufferAttribute(originArr, 4);
    const anglesAttr = new THREE.InstancedBufferAttribute(anglesArr, 4);
    const styleAttr = new THREE.InstancedBufferAttribute(styleArr, 4);
    anglesAttr.setUsage(THREE.DynamicDrawUsage);
    styleAttr.setUsage(THREE.DynamicDrawUsage);

    instGeo.setAttribute('aSheetOrigin', originAttr);
    instGeo.setAttribute('aSheetAngles', anglesAttr);
    instGeo.setAttribute('aSheetStyle', styleAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(instGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);

    return { anglesAttr, styleAttr };
  }

  /** 构建 36 束高锐度 X 型交叉铡刀单束激光（含地面镜像） */
  private buildLaserBeams() {
    const basePlane = new THREE.PlaneGeometry(1, 1, 8, 1);
    basePlane.translate(0.5, 0, 0);

    const total = BEAM_EMITTER_COUNT * 2;
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = basePlane.index;
    instGeo.attributes.position = basePlane.attributes.position;
    instGeo.attributes.uv = basePlane.attributes.uv;
    instGeo.instanceCount = total;

    const startArr = new Float32Array(total * 4);
    const endArr = new Float32Array(total * 4);
    const styleArr = new Float32Array(total * 4);

    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < BEAM_EMITTER_COUNT; i++) {
        const slot = (mirror * BEAM_EMITTER_COUNT + i) * 4;
        const b = this.beamSpecs[i];
        startArr[slot] = b.x;
        startArr[slot + 1] = b.y;
        startArr[slot + 2] = b.z;
        startArr[slot + 3] = mirror;

        endArr[slot] = 0;
        endArr[slot + 1] = 2;
        endArr[slot + 2] = 10;
        endArr[slot + 3] = 0.24;

        styleArr[slot] = 0;
        styleArr[slot + 1] = (i % 2);
        styleArr[slot + 2] = 0;
        styleArr[slot + 3] = (i * 0.618) % 1;
      }
    }

    const startAttr = new THREE.InstancedBufferAttribute(startArr, 4);
    const endAttr = new THREE.InstancedBufferAttribute(endArr, 4);
    const styleAttr = new THREE.InstancedBufferAttribute(styleArr, 4);
    endAttr.setUsage(THREE.DynamicDrawUsage);
    styleAttr.setUsage(THREE.DynamicDrawUsage);

    instGeo.setAttribute('aBeamStart', startAttr);
    instGeo.setAttribute('aBeamEnd', endAttr);
    instGeo.setAttribute('aBeamStyle', styleAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(instGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.scene.add(mesh);

    return { startAttr, endAttr, styleAttr };
  }

  /** 构建双层反向旋转空心断线激光锥笼（含地面镜像） */
  private buildLaserCones(): THREE.InstancedBufferAttribute {
    const baseGrid = new THREE.PlaneGeometry(1, 1, 72, 20);
    baseGrid.translate(0.5, 0.5, 0);

    const total = CONE_LAYER_COUNT * 2;
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = baseGrid.index;
    instGeo.attributes.position = baseGrid.attributes.position;
    instGeo.attributes.uv = baseGrid.attributes.uv;
    instGeo.instanceCount = total;

    const specArr = new Float32Array(total * 4);
    for (let mirror = 0; mirror < 2; mirror++) {
      // 外锥（主激光色，正向旋转）+ 内锥（副激光色，反向旋转）
      specArr.set([1.05, 1.0, 0.0, mirror], (mirror * CONE_LAYER_COUNT + 0) * 4);
      specArr.set([0.58, -1.35, 0.0, mirror], (mirror * CONE_LAYER_COUNT + 1) * 4);
    }

    const specAttr = new THREE.InstancedBufferAttribute(specArr, 4);
    specAttr.setUsage(THREE.DynamicDrawUsage);
    instGeo.setAttribute('aConeSpec', specAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: CONE_VERT,
      fragmentShader: CONE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(instGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);

    return specAttr;
  }

  /** 构建舞台前缘 8 座 CO2 低温白雾喷射气柱（含地面镜像） */
  private buildCryoJets(): THREE.InstancedBufferAttribute {
    const basePlane = new THREE.PlaneGeometry(1, 1, 6, 18);
    basePlane.translate(0, 0.5, 0);

    const jetXs = [-14.2, -10.4, -6.8, -3.2, 3.2, 6.8, 10.4, 14.2];
    const total = CRYO_JET_COUNT * 2;
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = basePlane.index;
    instGeo.attributes.position = basePlane.attributes.position;
    instGeo.attributes.uv = basePlane.attributes.uv;
    instGeo.instanceCount = total;

    const baseArr = new Float32Array(total * 4);
    const stateArr = new Float32Array(total * 4);
    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < CRYO_JET_COUNT; i++) {
        const slot = (mirror * CRYO_JET_COUNT + i) * 4;
        baseArr[slot] = jetXs[i];
        baseArr[slot + 1] = STAGE_DECK_H + 0.1;
        baseArr[slot + 2] = STAGE_LIP_Z + 0.35;
        baseArr[slot + 3] = mirror;

        stateArr[slot] = 0;
        stateArr[slot + 1] = 0;
        stateArr[slot + 2] = 15.2;
        stateArr[slot + 3] = (i * 0.29 + 0.13) % 1;
      }
    }

    const baseAttr = new THREE.InstancedBufferAttribute(baseArr, 4);
    const stateAttr = new THREE.InstancedBufferAttribute(stateArr, 4);
    stateAttr.setUsage(THREE.DynamicDrawUsage);
    instGeo.setAttribute('aCryoBase', baseAttr);
    instGeo.setAttribute('aCryoState', stateAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: CRYO_VERT,
      fragmentShader: CRYO_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(instGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.scene.add(mesh);

    return stateAttr;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 四组电影级电音节现场运镜（纯时间函数 f(t)） */
  private poseCamera(t: number, shot: Shot, shotT: number, kickPunch: number, dropPower: number): void {
    const dur = Math.max(1.2, shot.end - shot.start);
    const u = clamp01(shotT / dur);
    const easeU = inOutCubic(u);
    const r = rng((shot.seed ^ 0x4c19a2d1) >>> 0);
    const sideSign = r() < 0.5 ? -1 : 1;

    // 低频底鼓物理空气声压微震（受控克制，绝不晃晕歌词）
    const bassShakeY = Math.sin(t * 46.0) * 0.032 * kickPunch * (0.4 + 0.6 * dropPower);
    const bassShakeX = Math.cos(t * 37.0) * 0.022 * kickPunch * dropPower;

    let cx = 0, cy = 3.0, cz = 2.0;
    let tx = 0, ty = 8.4, tz = STAGE_Z;
    let roll = 0;
    let fov = CAM_FOV;

    switch (shot.variant) {
      case 'tunnel': {
        // 激光锥笼穿行视角：抬升至旋转激光圆锥笼轴心高度，伴随呼吸式微倾角向前穿梭
        cx = Math.sin(t * 0.38) * 1.45;
        cy = lerp(5.3, 6.2, easeU) + Math.cos(t * 0.55) * 0.25;
        cz = lerp(5.5, -13.5, u);
        tx = Math.sin(t * 0.28) * 0.65;
        ty = lerp(8.6, 8.9, easeU);
        tz = STAGE_Z;
        roll = Math.sin(t * 0.62) * 0.055 * (0.4 + 0.6 * dropPower);
        fov = CAM_FOV + 3.5 + kickPunch * 1.4;
        break;
      }
      case 'booth': {
        // 前排护栏仰视压迫视角：逼近舞台前缘，近距离仰望 CO2 冲天气柱、巨幕微距 LED 与瀑布般倾泻的天幕扇
        cx = sideSign * lerp(3.8, -2.4, easeU);
        cy = lerp(1.78, 2.25, easeU);
        cz = lerp(-18.5, -26.5, u);
        tx = sideSign * -0.6;
        ty = lerp(9.4, 10.6, easeU);
        tz = STAGE_Z;
        roll = sideSign * 0.025;
        fov = CAM_FOV + 2.0 + kickPunch * 1.2;
        break;
      }
      case 'rig': {
        // 高空桁架斜向航拍巡礼视角：紧贴门式铝合金灯架与盲眼灯眩光，俯瞰全场立体交织激光网与黑金地面倒影
        cx = sideSign * lerp(11.4, 6.2, easeU);
        cy = lerp(11.8, 7.6, easeU);
        cz = lerp(-1.5, -17.5, u);
        tx = sideSign * -1.5;
        ty = lerp(5.8, 7.4, easeU);
        tz = STAGE_Z + 4.0;
        roll = -sideSign * 0.045;
        fov = CAM_FOV + kickPunch * 1.0;
        break;
      }
      case 'arena':
      default: {
        // 池座中轴黄金纵深主视角：上方 6 道重型桁架透视汇聚，下方湿润黑金地面 1:1 对称反射巨幕与漫天激光
        cx = sideSign * Math.sin(u * Math.PI) * 1.65;
        cy = lerp(2.65, 3.35, easeU);
        cz = lerp(4.2, -8.8, u);
        tx = 0;
        ty = lerp(8.1, 8.8, easeU);
        tz = STAGE_Z;
        roll = Math.sin(t * 0.42) * 0.018;
        fov = CAM_FOV + kickPunch * 1.15;
        break;
      }
    }

    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(cx + bassShakeX, cy + bassShakeY, cz);
    this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    this.camera.lookAt(tx, ty, tz);
  }

  update(ctx: FrameCtx): void {
    const { t, music, shot, shotT, fx } = ctx;
    const sec = shot.section;
    const beatInfo = music.at(t);
    const beatDur = 60 / Math.max(40, beatInfo.bpm);

    // 1. 解析当前段落能量与控台主状态（Drop / Chorus 全功率炸场，Build 蓄能收束，Break 静谧液态天幕）
    const isDrop = sec.label === 'drop';
    const isChorus = sec.label === 'chorus';
    const isBuild = sec.label === 'build' || sec.label === 'pre';
    const isBreak = sec.label === 'break' || sec.label === 'bridge' || sec.label === 'intro' || sec.label === 'outro';

    const buildProgress = isBuild ? clamp01((t - sec.start) / Math.max(1.0, sec.end - sec.start)) : 0;
    const dropPower = isDrop ? 1.0 : isChorus ? 0.84 : isBuild ? 0.25 + 0.55 * buildProgress : isBreak ? 0.18 : 0.46;

    // Drop 入拍前最后 90ms 瞬时收暗蓄力（Pre-Drop Blackout Choke），入拍首帧轰然全开！
    let blackout = 0;
    const nextSec = music.a.sections[shot.sectionIndex + 1];
    if (isBuild && nextSec && nextSec.label === 'drop') {
      const rem = sec.end - t;
      if (rem >= 0 && rem < 0.14) {
        blackout = smooth(1.0 - Math.abs(rem - 0.055) / 0.085);
      }
    }

    // 2. 提取音频脉冲与 12 半音色度包络
    const kickPunch = clamp01(music.pulse('kick', t, 0.13) * 1.12);
    const snarePunch = clamp01(music.pulse('snare', t, 0.11));
    const hatSparkle = clamp01(music.pulse('hat', t, 0.07));
    const fg = music.foregroundAt(t);
    const leadMotion = music.foregroundMotion(t, 0.20);

    const env = music.a.env;
    const chromaTotalFrames = env.chroma ? Math.floor(env.chroma.length / 12) : 0;
    const cIdx = chromaTotalFrames > 0
      ? Math.min(chromaTotalFrames - 1, Math.max(0, Math.round((t / Math.max(0.1, music.duration)) * (chromaTotalFrames - 1))))
      : 0;
    const readChroma = (c: number): number => {
      if (!env.chroma || chromaTotalFrames < 1) return 0.35;
      return clamp01((env.chroma[cIdx * 12 + c] ?? 0) * 1.15);
    };

    // 3. 灯光师 4 小节自动轮换 Cue 表（仅由段落内小节序号纯函数决定）
    // Cue 0: LIQUID_HORIZON（宽幅液态天幕扇 + X 型军鼓快切）
    // Cue 1: CONE_VORTEX（双层反向旋转断线激光锥笼 + 侧翼内收束）
    // Cue 2: CATHEDRAL_CROWN（纵深多层龙门架交织穹顶皇冠 + 12 音阶波浪）
    // Cue 3: BICHROME_CHOPPER（双色分束高密铡刀对切 + 压顶俯冲天幕）
    const barsIntoSec = Math.max(0, Math.floor((t - sec.start) / Math.max(0.5, beatDur * music.meter)));
    const cueMode = isDrop || isChorus
      ? (shot.variant === 'tunnel' ? 1 : barsIntoSec >= 2 ? Math.floor(barsIntoSec / 4) % 4 : 0)
      : -1;

    // 4. 更新相机位姿
    this.poseCamera(t, shot, shotT, kickPunch, dropPower);

    // 5. 更新 28 组四眼卤素观众盲眼灯（3500K -> 2000K 热惯性余晖 + 重拍短促爆闪点缀）
    const blinderArr = this.blinderStateAttr.array as Float32Array;
    const barDownAge = (beatInfo.inBar * beatDur);
    const downbeatFlash = Math.exp(-barDownAge / 0.14);
    const kickFilament = Math.max(kickPunch * 0.62, downbeatFlash * (isDrop ? 0.96 : 0.55));

    let totalBlinderEnergy = 0;
    for (let i = 0; i < BLINDER_COUNT; i++) {
      const c = this.blinderCoords[i];
      // 沿走廊由舞台向观众席传播的光波相位
      const chaseWave = Math.pow(0.5 + 0.5 * Math.cos(beatInfo.pos * Math.PI - c.portalIdx * 0.95), 2.0);
      let power = kickFilament * (0.25 + 0.75 * chaseWave) * (0.22 + 0.78 * dropPower);
      if (isBuild && buildProgress > 0.65) {
        // Build 末段高频交替频闪升温
        const buildStrobe = Math.pow(0.5 + 0.5 * Math.cos(t * (22.0 + 28.0 * buildProgress) + i * 1.7), 3.0);
        power = Math.max(power, buildStrobe * buildProgress * 0.82);
      }
      power = Math.min(1.15, power);
      // 强度越高灯丝温度越炽白（cool -> 0），衰减尾部滑向 2000K 琥珀红（cool -> 1）
      const cool = clamp01(1.0 - power * 0.92);
      totalBlinderEnergy += power;

      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * BLINDER_COUNT + i) * 4;
        blinderArr[slot] = power;
        blinderArr[slot + 1] = cool;
      }
    }
    this.blinderStateAttr.needsUpdate = true;
    const avgBlinderGlow = clamp01((totalBlinderEnergy / BLINDER_COUNT) * 0.95);

    // 6. 更新 14 座振镜扫描体积光膜（Liquid Sky & Volumetric Fan Sheets）
    // 结合 LeadColorTrack 声部主导占比（shareB）与人声融合度（fusion），让封面主副激光色随主奏/伴奏/人声动态呼吸
    const rawShareB = sampleTrack(this.colorTrack.shareB, this.colorTrack.fps, t);
    const fusion = sampleTrack(this.colorTrack.fusion, this.colorTrack.fps, t);
    const shareB = clamp01(rawShareB * (1 - 0.38 * fusion) + 0.5 * 0.38 * fusion);
    const tintSlot = (isSlotB: boolean): number => {
      if (isSlotB) {
        return clamp01(lerp(0.68 + 0.28 * shareB, 0.52, fusion * 0.55));
      }
      return clamp01(lerp(0.03 + 0.30 * Math.max(0, shareB - 0.35), 0.44, fusion * 0.55));
    };

    const sAngles = this.sheetAnglesAttr.array as Float32Array;
    const sStyle = this.sheetStyleAttr.array as Float32Array;
    const sweepClock = t * 0.85 + leadMotion * 0.24;

    for (let i = 0; i < SHEET_EMITTER_COUNT; i++) {
      const sp = this.sheetSpecs[i];
      let yaw = sp.baseYaw;
      let pitch = sp.basePitch;
      let roll = 0;
      let spread = 0.44;
      let power = 0;
      let colorMix = tintSlot(i % 3 === 1);
      let waveAmp = 0.45 + 0.45 * fg.level;

      if (sp.bank === 0) {
        // 舞台正前 6 台主 Liquid Sky 发射台
        const symSign = sp.x < 0 ? -1 : 1;
        const pairIdx = Math.min(2, Math.floor(Math.abs(i - 2.5)));

        if (isBreak) {
          // 间奏空灵段：仅开启内侧 4 台慢速丝绸液态天幕，安静呼吸
          const activeBreak = pairIdx <= 1 ? 1.0 : 0.25;
          yaw = sp.baseYaw + Math.sin(t * 0.35 + i) * 0.12;
          pitch = -0.15 + Math.sin(t * 0.48 + pairIdx * 0.8) * 0.055;
          roll = symSign * Math.sin(t * 0.32) * 0.10;
          spread = 0.52;
          power = activeBreak * (0.48 + 0.25 * fg.level);
          waveAmp = 0.72;
        } else if (isBuild) {
          // 铺垫蓄能段：扇面逐渐收窄并压低向舞台前缘聚拢，让出巨幕中心视野
          yaw = lerp(sp.baseYaw, -sp.x * 0.022, buildProgress);
          pitch = lerp(-0.24, -0.14, buildProgress) + Math.sin(t * (3.0 + 8.0 * buildProgress) + i) * 0.03;
          roll = symSign * (1.0 - buildProgress) * 0.22;
          spread = lerp(0.44, 0.18, buildProgress);
          power = 0.36 + 0.48 * buildProgress;
          waveAmp = 0.35 * (1.0 - buildProgress);
        } else {
          // Drop / Chorus / Verse 主秀：随控台 Cue 阵型切换
          const leadSweep = Math.sin(sweepClock * 1.35 + pairIdx * 0.65);
          if (cueMode === 1) {
            // CONE_VORTEX 期间：退让中央主视野给空心旋转激光锥笼，仅保留外侧贴地薄光幕烘托
            yaw = sp.baseYaw + symSign * 0.16;
            pitch = pairIdx === 0 ? -0.26 + 0.02 * leadSweep : -0.18 + 0.04 * leadSweep;
            roll = symSign * (0.42 + 0.16 * Math.sin(sweepClock));
            spread = pairIdx === 0 ? 0.36 : 0.30;
            power = (pairIdx === 0 ? 0.18 : 0.34) * dropPower + 0.12 * kickPunch;
          } else if (cueMode === 2) {
            // CATHEDRAL_CROWN：交错大倾角斜切搭建哥特式激光穹顶
            yaw = sp.baseYaw - symSign * 0.16;
            pitch = -0.14 + 0.06 * Math.cos(beatInfo.pos * 0.5 * Math.PI + i);
            roll = symSign * 0.52 * (i % 2 === 0 ? 1 : -0.65);
            spread = 0.48;
            power = (0.88 + 0.24 * kickPunch) * dropPower;
            colorMix = tintSlot((barsIntoSec + i) % 3 === 1);
          } else {
            // LIQUID_HORIZON & BICHROME_CHOPPER：经典超宽水平波浪天幕压低掠过镜头头顶！
            yaw = sp.baseYaw + Math.sin(sweepClock * 0.8 + i * 0.7) * 0.14;
            pitch = -0.175 + 0.065 * Math.sin(sweepClock * 1.45 + pairIdx * 0.55) - 0.025 * kickPunch;
            roll = symSign * Math.sin(sweepClock * 0.95 + pairIdx) * (cueMode === 3 ? 0.28 : 0.14);
            spread = 0.56 + 0.08 * fg.level;
            power = (0.94 + 0.24 * kickPunch + 0.16 * fg.attack) * dropPower;
            waveAmp = 0.65 + 0.45 * fg.level;
            colorMix = cueMode === 3 ? tintSlot(sp.x >= 0) : tintSlot(pairIdx === 1);
          }
        }
      } else {
        // 走廊左右侧翼龙门架 8 台内倾激光光幕（bank 1 & 2）
        const sideSign = sp.bank === 1 ? 1 : -1;
        if (isBreak) {
          power = 0.0;
        } else if (isBuild) {
          yaw = sideSign * 0.72;
          pitch = lerp(-0.38, -0.16, buildProgress);
          roll = sideSign * 0.25;
          spread = 0.26;
          power = Math.max(0, (buildProgress - 0.42) * 0.65);
        } else {
          const bayWave = 0.5 + 0.5 * Math.sin(beatInfo.pos * Math.PI * 0.5 - sp.idx * 0.9);
          yaw = sp.baseYaw + sideSign * Math.sin(sweepClock + sp.idx) * 0.18;
          pitch = -0.26 + 0.08 * Math.cos(sweepClock * 1.2 + sp.idx * 0.8);
          roll = sideSign * (cueMode === 2 ? 0.48 : 0.22);
          spread = cueMode === 2 ? 0.40 : 0.30;
          power = (cueMode === 1 ? 0.28 : 0.62) * dropPower * (0.40 + 0.60 * bayWave);
          colorMix = tintSlot((sp.idx + (sp.bank === 1 ? 0 : 1)) % 3 === 1);
        }
      }

      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * SHEET_EMITTER_COUNT + i) * 4;
        sAngles[slot] = yaw;
        sAngles[slot + 1] = pitch;
        sAngles[slot + 2] = roll;
        sAngles[slot + 3] = spread;

        sStyle[slot] = sp.length;
        sStyle[slot + 1] = power;
        sStyle[slot + 2] = colorMix;
        sStyle[slot + 3] = waveAmp;
      }
    }
    this.sheetAnglesAttr.needsUpdate = true;
    this.sheetStyleAttr.needsUpdate = true;

    // 7. 更新 36 束军鼓/重音 X 型交叉铡刀单束快切激光（Chopper Single Beams）
    const bEnd = this.beamEndAttr.array as Float32Array;
    const bStyle = this.beamStyleAttr.array as Float32Array;

    // 查找最近一次快切重音脉冲
    let latestHit: ChopperHitEvent | null = null;
    let hitAge = 99;
    const hitIdx = lastIndex(this.chopperTimes, t);
    if (hitIdx >= 0) {
      latestHit = this.choppers[hitIdx];
      hitAge = t - latestHit.t;
    }
    const hitEnv = latestHit && hitAge >= 0 && hitAge < 0.42
      ? latestHit.amp * Math.exp(-hitAge / (isDrop ? 0.145 : 0.19))
      : 0;
    const activePattern = latestHit ? latestHit.pattern : (barsIntoSec % 4);
    const activeParity = latestHit ? latestHit.parity : 1;
    const pulseTravel = clamp01(hitAge / 0.22);

    for (let i = 0; i < BEAM_EMITTER_COUNT; i++) {
      const b = this.beamSpecs[i];
      let tx = 0, ty = 1.5, tz = 10.0;
      let beamPower = 0;
      let colorMix = tintSlot(i % 3 === 1);

      if (isBreak) {
        // 间奏段仅保留舞台前缘极微弱的静态定格皇冠星束
        if (b.group === 1 && (b.slot === 0 || b.slot === 5 || b.slot === 6 || b.slot === 11)) {
          tx = b.x * 1.45;
          ty = 16.5;
          tz = -18.0;
          beamPower = 0.24 + 0.15 * hatSparkle;
        }
      } else if (isBuild) {
        // Build 蓄能：36 束激光随十六分音符依次快闪并向 DJ 控台上空聚拢，不遮挡巨幕主封面
        const step16 = Math.floor(beatInfo.pos * 4) % 12;
        const matchSlot = (i % 12) === step16 ? 1.0 : 0.14;
        tx = lerp(b.x * 0.85, 0.0, buildProgress);
        ty = lerp(1.2, 4.4, buildProgress);
        tz = lerp(-5.0, -32.0, buildProgress);
        beamPower = (0.22 + 0.88 * buildProgress) * matchSlot;
        colorMix = tintSlot(i % 3 === 1);
      } else {
        // Drop / Chorus / Verse：4 套控台追逐快切花式
        const pat = cueMode === 3 ? 0 : activePattern;
        const noteVal = readChroma(i % 12);

        if (b.group === 0) {
          // 舞台顶梁 12 束高能主排
          if (pat === 0) {
            // X-Scissors（左右交叉剪刀对切）：左半排斜劈右下，右半排斜劈左下，按奇偶拍高速交替！
            const isLeft = b.normX < 0;
            const bankActive = (activeParity > 0 ? isLeft : !isLeft) ? 1.0 : 0.28;
            tx = -b.normX * 19.5 + Math.sin(t * 2.4 + b.slot) * 1.8;
            ty = 0.15;
            tz = -6.0 + Math.abs(b.normX) * 16.0;
            beamPower = (hitEnv * 1.18 + 0.24 * dropPower) * bankActive;
            colorMix = cueMode === 3 ? tintSlot(!isLeft) : tintSlot(b.slot % 3 === 1);
          } else if (pat === 1) {
            // Center-Out Wave（中心向外 12 音阶扇形排射）
            const distCenter = Math.abs(b.normX);
            const wavePhase = clamp01(1.0 - Math.abs(distCenter - ((beatInfo.pos * 0.85) % 1.0)) * 2.6);
            tx = b.normX * 24.0;
            ty = 1.2 + 4.5 * noteVal;
            tz = 12.0;
            beamPower = (0.35 + 0.85 * wavePhase + 0.45 * hitEnv) * dropPower;
            colorMix = clamp01(distCenter * (0.65 + 0.35 * shareB));
          } else if (pat === 2) {
            // Guillotine（平行垂直铡刀齐劈地面）
            tx = b.x * 1.08;
            ty = 0.05;
            tz = -12.0 + Math.sin(beatInfo.pos * Math.PI * 0.5 + Math.abs(b.normX) * 2.0) * 14.0;
            beamPower = (0.32 + 0.95 * hitEnv + 0.35 * kickPunch) * dropPower;
          } else {
            // Strobe Matrix（对称高密点射）
            const pairOn = ((b.slot + Math.floor(beatInfo.pos * 4)) % 3 === 0) ? 1.0 : 0.22;
            tx = -b.normX * 12.0;
            ty = 2.8 + (b.slot % 3) * 2.6;
            tz = 14.0;
            beamPower = (0.38 + 0.88 * hitEnv) * pairOn * dropPower;
          }
        } else if (b.group === 1) {
          // 舞台前缘低位仰射 12 束（从脚底斜向高空射穿烟雾，与顶梁形成上下双层立体菱形笼！）
          const symActive = ((b.slot + (activeParity > 0 ? 0 : 1)) % 2 === 0) ? 1.0 : 0.32;
          tx = b.normX * (cueMode === 2 ? -18.5 : 21.0);
          ty = 13.5 + 4.2 * noteVal;
          tz = 8.0;
          beamPower = (0.28 + 0.85 * hitEnv + 0.30 * snarePunch) * symActive * dropPower;
          colorMix = tintSlot(i % 3 === 0);
        } else {
          // 走廊左右两侧龙门立柱 12 束横跨场馆的斜切激光刃（group 2 & 3）
          const sideSign = b.group === 2 ? -1 : 1;
          const bankHit = (activeParity * sideSign > 0) ? 1.0 : 0.35;
          tx = -sideSign * 15.5;
          ty = 0.25 + (b.slot % 2) * 2.4;
          tz = b.z + 16.5;
          beamPower = (0.26 + 0.92 * hitEnv) * bankHit * (cueMode === 1 ? 0.55 : 1.0) * dropPower;
          colorMix = cueMode === 3 ? tintSlot(sideSign > 0) : tintSlot(b.slot % 3 === 1);
        }
      }

      beamPower = Math.min(1.38, beamPower);
      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * BEAM_EMITTER_COUNT + i) * 4;
        bEnd[slot] = tx;
        bEnd[slot + 1] = ty;
        bEnd[slot + 2] = tz;
        bEnd[slot + 3] = b.group === 0 ? 0.195 : 0.160;

        bStyle[slot] = beamPower;
        bStyle[slot + 1] = colorMix;
        bStyle[slot + 2] = pulseTravel;
      }
    }
    this.beamEndAttr.needsUpdate = true;
    this.beamStyleAttr.needsUpdate = true;

    // 8. 更新双层反向旋转空心断线激光锥笼（Laser Cone Tunnel）
    const cSpec = this.coneSpecAttr.array as Float32Array;
    let outerConePower = 0;
    let innerConePower = 0;
    if (isDrop || isChorus) {
      if (cueMode === 1) {
        // CONE_VORTEX 主场：内外双锥满功率反向高速旋转包裹镜头！
        outerConePower = (1.05 + 0.25 * kickPunch) * dropPower;
        innerConePower = (0.88 + 0.22 * fg.level) * dropPower;
      } else if (cueMode === 2) {
        // CATHEDRAL_CROWN：保留一层柔和中心内锥作为中轴圣光柱骨架
        outerConePower = 0.28 * dropPower;
        innerConePower = 0.55 * dropPower;
      }
    } else if (isBuild && buildProgress > 0.45) {
      // Build 后半程内锥逐渐显现蓄势旋转
      innerConePower = (buildProgress - 0.45) * 1.15;
    }

    for (let mirror = 0; mirror < 2; mirror++) {
      const slot0 = (mirror * CONE_LAYER_COUNT + 0) * 4;
      const slot1 = (mirror * CONE_LAYER_COUNT + 1) * 4;
      cSpec[slot0] = 1.02 + 0.08 * kickPunch;
      cSpec[slot0 + 2] = outerConePower;
      cSpec[slot1] = 0.54 + 0.06 * fg.level;
      cSpec[slot1 + 2] = innerConePower;
    }
    this.coneSpecAttr.needsUpdate = true;

    // 9. 更新舞台前缘 8 座 CO2 低温白雾喷射气柱（Cryo Jets）
    const cryoArr = this.cryoStateAttr.array as Float32Array;
    let activeCryo: CryoBlastEvent | null = null;
    let cryoAge = 99;
    const cryoIdx = lastIndex(this.cryoTimes, t);
    if (cryoIdx >= 0) {
      const evCryo = this.cryos[cryoIdx];
      const age = t - evCryo.t;
      if (age >= 0 && age <= evCryo.dur) {
        activeCryo = evCryo;
        cryoAge = age;
      }
    }

    for (let i = 0; i < CRYO_JET_COUNT; i++) {
      let normAge = 0;
      let jetStrength = 0;
      if (activeCryo) {
        const distCenter = Math.abs(i - 3.5); // 0.5, 1.5, 2.5, 3.5
        // mode 2 为中心向外极速排射（延迟 0..0.14s）
        const stagger = activeCryo.mode === 2 ? (distCenter - 0.5) * 0.045 : 0;
        const localAge = cryoAge - stagger;
        const activeMask = activeCryo.mode === 1 ? (distCenter < 2.0 ? 1.0 : 0.0) : 1.0;
        if (localAge >= 0 && localAge <= activeCryo.dur && activeMask > 0) {
          normAge = clamp01(localAge / activeCryo.dur);
          jetStrength = activeCryo.strength * activeMask;
        }
      }

      for (let mirror = 0; mirror < 2; mirror++) {
        const slot = (mirror * CRYO_JET_COUNT + i) * 4;
        cryoArr[slot] = normAge;
        cryoArr[slot + 1] = jetStrength;
      }
    }
    this.cryoStateAttr.needsUpdate = true;

    // 10. 同步全局着色器 Uniforms
    const u = this.uniforms;
    u.uTime.value = t;
    u.uBeatPos.value = beatInfo.pos;
    u.uSectionEnergy.value = clamp01(sec.energy);
    u.uDropPower.value = dropPower;
    u.uKickPunch.value = kickPunch;
    u.uBlinderGlow.value = avgBlinderGlow;
    u.uBlackout.value = blackout;
    u.uConeSpin.value = t * 1.15 + leadMotion * 0.32;
    u.uConePitch.value = -0.068 + Math.sin(t * 0.45) * 0.015;
    (u.uChroma0.value as THREE.Vector4).set(readChroma(0), readChroma(1), readChroma(2), readChroma(3));
    (u.uChroma1.value as THREE.Vector4).set(readChroma(4), readChroma(5), readChroma(6), readChroma(7));
    (u.uChroma2.value as THREE.Vector4).set(readChroma(8), readChroma(9), readChroma(10), readChroma(11));

    // 11. 后期效果调优：全画幅 16:9 展现顶棚桁架与地面镜像，保留纯粹窄带双色激光波长，克制泛光防过曝
    fx.letterbox = 0;
    fx.invert = 0;
    fx.duotone = 0;
    fx.glitch = Math.min(fx.glitch, 0.08);
    fx.zoom = Math.min(fx.zoom, 0.05 + 0.05 * kickPunch * dropPower);
    fx.bloom = (this.soft ? 0.20 : 0.22) + 0.05 * dropPower + 0.02 * avgBlinderGlow;
    fx.vignette = 0.44;
    fx.grain = 0.035;

    // 12. 更新底部双语歌词排版
    this.rig.update(this.camera, ctx.lyrics, t, ctx.aspect, sec.energy * 0.8);
  }
}
