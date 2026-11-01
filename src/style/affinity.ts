// 歌曲子流派与声学气质画像引擎：
// 从音频分析特征与可选的网易云百科标签中提取连续的多维音乐气质向量（SongVibe），
// 并在不打破用户所选母风格（剪辑节奏、转场物理、胶片质感）边界的前提下，动态调整各场景在首镜与段内轮换中的出现概率。
import type { Analysis, Hit, Section } from '../types.ts';
import type { SceneId } from '../scenes/types.ts';
import type { SongTraits, Style } from './style.ts';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);

function nearestTimeDist(sorted: Float64Array | number[], t: number): number {
  const n = sorted.length;
  if (!n) return Infinity;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  let best = Math.abs(sorted[lo] - t);
  if (lo > 0) best = Math.min(best, Math.abs(sorted[lo - 1] - t));
  return best;
}

/**
 * 声学四四拍浩室律动检测（Four-on-the-Floor Deep House Groove Detector）：
 * 仅在 4/4 拍、115–126 BPM 经典区间内触发，要求偶拍（1、3 拍）与奇拍（2、4 拍）同时具备高规律底鼓，
 * 且切分碎拍占比低、高频不过度刺耳。此判据可精准识别无标签或仅标“电子”的 Deep House，
 * 同时确保半拍律动的 Melodic Dubstep（如 125/140 BPM 半拍重音）与常规摇滚/流行保持在“律动 (pulse)”。
 */
export function isSteadyHouseGroove(a: Analysis, bpm: number): boolean {
  if ((a.meter || 4) !== 4 || bpm < 115 || bpm > 126 || a.beats.length < 24) return false;
  const kicks = a.hits.kick.filter(h => h[1] > 0.22).map(h => h[0]);
  if (kicks.length < 16) return false;

  let active = a.sections.filter(s => s.label === 'drop' || s.label === 'chorus');
  const activeSpan = active.reduce((acc, s) => acc + (s.end - s.start), 0);
  if (activeSpan < 12) active = a.sections.filter(s => s.energy >= 0.6 && s.label !== 'intro' && s.label !== 'outro');
  if (!active.length) active = a.sections.filter(s => s.label !== 'intro' && s.label !== 'outro');
  if (!active.length) active = a.sections;

  const inActive = (t: number) => active.some(s => t >= s.start + 0.05 && t <= s.end - 0.05);

  let evenTotal = 0, evenHit = 0, oddTotal = 0, oddHit = 0;
  for (let i = 0; i < a.beats.length; i++) {
    const bt = a.beats[i];
    if (!inActive(bt)) continue;
    const pos = (a.beatInBar[i] ?? (i % 4)) % 4;
    const hit = nearestTimeDist(kicks, bt) <= 0.095;
    if (pos % 2 === 0) {
      evenTotal++;
      if (hit) evenHit++;
    } else {
      oddTotal++;
      if (hit) oddHit++;
    }
  }
  if (evenTotal < 8 || oddTotal < 8) return false;
  if (evenHit / evenTotal < 0.62 || oddHit / oddTotal < 0.58) return false;

  const activeKicks = kicks.filter(inActive);
  if (activeKicks.length < 12) return false;
  const offGrid = activeKicks.filter(kt => nearestTimeDist(a.beats, kt) > 0.11).length;
  if (offGrid / activeKicks.length > 0.28) return false;

  const { fps, low, high } = a.env;
  if (fps > 0 && low.length && high.length) {
    let lowSum = 0, highSum = 0, frames = 0;
    for (const s of active) {
      const i0 = Math.max(0, Math.floor(s.start * fps));
      const i1 = Math.min(low.length, high.length, Math.ceil(s.end * fps));
      for (let i = i0; i < i1; i++) {
        lowSum += low[i];
        highSum += high[i];
        frames++;
      }
    }
    if (frames > 0) {
      const meanLow = lowSum / frames;
      const meanHigh = highSum / frames;
      if (meanLow < 0.18 || meanHigh > Math.max(0.56, meanLow * 1.08)) return false;
    }
  }

  return true;
}

/** 用户可在设置面板「画面 → 音乐风格」中手动选择的音乐曲风预设（驱动各场景出现概率） */
export type VibePresetId =
  | 'auto'
  | 'melodic'
  | 'cyber'
  | 'urban'
  | 'rock'
  | 'acoustic'
  | 'oriental'
  | 'rap';

export interface VibePresetMeta {
  id: VibePresetId;
  /** 面板按钮上的简短中文名称（适配右侧 380px 抽屉的 4×2 网格） */
  label: string;
  /** 选择该音乐风格后的详细概率调整说明 */
  note: string;
  /** 当上方视觉「风格」设为「自动」时，该音乐风格默认匹配的母风格 */
  preferredStyle?: 'pulse' | 'velvet' | 'ballad' | 'word' | 'ink';
}

export const VIBE_PRESETS: readonly VibePresetMeta[] = [
  {
    id: 'auto',
    label: '自动',
    note: '自动识别歌曲曲风百科与鼓组声学特征，动态调节 42 个场景在首镜与段内轮换中的出现概率。',
  },
  {
    id: 'melodic',
    label: '旋律电音',
    note: '适合 Melodic Bass / Future Bass / Progressive / Trance：大幅提升涅槃舞台、晚霞水台、花坛喷泉、深海奇观、极光天幕、云海与粒子概率，压低硬核分形与机械读数。',
    preferredStyle: 'pulse',
  },
  {
    id: 'cyber',
    label: '硬核电音',
    note: '适合 Dubstep / DnB / Techno / Hardcore / 音游疾速：大幅提升推进隧道、音频通道、门格海绵、谢尔宾斯基、碎裂解构、能量球与示波器概率，压低柔光慢景。',
    preferredStyle: 'pulse',
  },
  {
    id: 'urban',
    label: '浩室微醺',
    note: '适合 House / Synthwave / R&B / City Pop / Funk：大幅提升暗涌水廊、夜城天际、琥珀黑胶、霓虹街牌、散景光斑与夜雨车窗概率，减少激烈爆裂镜头。',
    preferredStyle: 'velvet',
  },
  {
    id: 'rock',
    label: '摇滚独立',
    note: '适合摇滚 / 乐队 / 朋克 / 后摇 / 独立另类：大幅提升山脊线框、碎裂封面、网点印刷、海报构成、黑胶唱盘、示波器与翻转矩阵概率，突出粗粝张力。',
    preferredStyle: 'pulse',
  },
  {
    id: 'acoustic',
    label: '民谣抒情',
    note: '适合民谣 / 流行慢歌 / 钢琴弦乐 / 纯音乐 / 爵士：大幅提升夜雨窗前、孔明灯海、极光湖面、微缩景箱、散景光斑、云海与油画画布概率，避开高频闪烁。',
    preferredStyle: 'ballad',
  },
  {
    id: 'oriental',
    label: '国风古韵',
    note: '适合国风 / 古风 / 戏腔 / 民乐 / 国风电音：大幅提升宣纸水墨、剪纸窗花、孔明灯海、涅槃火凤、云海远山与丹青画布概率，兼顾古韵与国潮律动。',
    preferredStyle: 'ink',
  },
  {
    id: 'rap',
    label: '说唱街头',
    note: '适合说唱 / Hip-Hop / Trap / 街头潮流：大幅提升字墙冲击、霓虹街区、海报排版、网点印刷、夜城俯瞰、碎裂封面与黑胶概率，强化节奏与文字张力。',
    preferredStyle: 'word',
  },
];

export const VIBE_PRESET_MAP: Record<VibePresetId, VibePresetMeta> = {
  auto: VIBE_PRESETS[0],
  melodic: VIBE_PRESETS[1],
  cyber: VIBE_PRESETS[2],
  urban: VIBE_PRESETS[3],
  rock: VIBE_PRESETS[4],
  acoustic: VIBE_PRESETS[5],
  oriental: VIBE_PRESETS[6],
  rap: VIBE_PRESETS[7],
};

export function isVibePresetId(value: unknown): value is VibePresetId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VIBE_PRESET_MAP, value);
}

/** 各手动预设在 7 个气质维度上的目标引导向量：[melodicEpic, hardCyber, urbanGroove, indieRock, acousticWarm, oriental, vocalLyric] */
const PRESET_VECTORS: Record<Exclude<VibePresetId, 'auto'>, readonly [number, number, number, number, number, number, number]> = {
  melodic:  [1.00, 0.06, 0.14, 0.00, 0.22, 0.08, 0.12],
  cyber:    [0.04, 1.00, 0.04, 0.18, 0.00, 0.00, 0.06],
  urban:    [0.16, 0.00, 1.00, 0.04, 0.24, 0.00, 0.20],
  rock:     [0.06, 0.24, 0.12, 1.00, 0.04, 0.00, 0.28],
  acoustic: [0.24, 0.00, 0.16, 0.00, 1.00, 0.12, 0.24],
  oriental: [0.24, 0.00, 0.00, 0.04, 0.28, 1.00, 0.18],
  rap:      [0.00, 0.28, 0.34, 0.36, 0.00, 0.00, 1.00],
};

/** 连续多维音乐气质画像（各维度取值 0..1），同时支持用户手动选择、百科标签引导与纯声学推断 */
export interface SongVibe {
  /** 恢弘旋律 / 旋律贝斯 / Future Bass / Progressive / Trance */
  melodicEpic: number;
  /** 硬核疾速 / 赛博电子 / Dubstep / DnB / 音游曲 / Techno / Phonk */
  hardCyber: number;
  /** 都市微醺 / 浩室 / 放克 / 复古合成器 / R&B / 夜色律动 */
  urbanGroove: number;
  /** 摇滚乐队 / 朋克 / 独立另类 / 粗粝平面构成 */
  indieRock: number;
  /** 原声温暖 / 民谣 / 钢琴弦乐 / 爵士蓝调 / 治愈慢歌 */
  acousticWarm: number;
  /** 东方意韵 / 国风古风 / 戏腔民乐（含国风电子等跨界曲目） */
  oriental: number;
  /** 人声词作主导度（仅在开启歌词且有词时生效） */
  vocalLyric: number;
  /** 主导编排倾向的中文简述，用于设置与悬停提示 */
  summary: string;
}

type VibeDim = 'melodicEpic' | 'hardCyber' | 'urbanGroove' | 'indieRock' | 'acousticWarm' | 'oriental' | 'vocalLyric';

const VIBE_LABELS: Record<VibeDim, string> = {
  melodicEpic: '旋律史诗',
  hardCyber: '硬核疾速',
  urbanGroove: '都市律动',
  indieRock: '摇滚构成',
  acousticWarm: '原声治愈',
  oriental: '东方意韵',
  vocalLyric: '词作叙事',
};

const MELODIC_EPIC_GENRES = /旋律回响贝斯|未来贝斯|渐进浩室|出神舞曲|旋律浩室|热带浩室|Melodic\s*(?:Dubstep|Bass|Techno|House)|Future\s*Bass|Progressive\s*(?:House|Trance)|Uplifting\s*Trance|\bTrance\b|Orchestral|Cinematic/i;
const EPIC_MOOD_TAGS = /史诗|壮阔|大气|空灵|梦幻|华丽|震撼|飞翔|治愈电音|星辰|银河|宇宙/;
const HARD_CYBER_GENRES = /鼓打贝斯|神经放克|硬核|速核|快乐硬核|碎拍|科技舞曲|迷幻舞曲|中速节奏|大空间浩室|电子浩室|低音浩室|陷阱|回响贝斯|Dubstep|Brostep|Riddim|Drum\s*(?:&|and|\+)?\s*Bass|\bDnB\b|Neurofunk|Jungle|Hardcore|Hardstyle|Speedcore|Frenchcore|Artcore|Breakbeat|Breakcore|Midtempo|Techno|Psytrance|Bass\s*House|Electro\s*House|Big\s*Room|\bTrap\b|Phonk|Glitch|Chiptune|8[\s-]?Bit|Cyberpunk|音游/i;
const CYBER_MOOD_TAGS = /狂欢|极限运动|激昂|炸裂|疾速|赛博|科技|战斗|电竞/;
const URBAN_GROOVE_GENRES = /深邃浩室|浩室舞曲|浩室|放克|灵魂|迪斯科|新迪斯科|合成器浪潮|蒸汽波|都市|节奏布鲁斯|低保真|弛放|沙发音乐|神游舞曲|缓拍|House|Disco|Nu[\s-]?Disco|Funk|Soul|R&B|RnB|Synthwave|Retrowave|Vaporwave|Chillwave|City\s*Pop|Lounge|Lo[\s-]?Fi|Chillhop|Trip[\s-]?Hop|Downtempo/i;
const URBAN_MOOD_TAGS = /微醺|深夜|慵懒|霓虹|复古|小酒馆|咖啡厅|浪漫|迷幻|夜晚|兜风/;
const INDIE_ROCK_GENRES = /摇滚|金属|朋克|后朋克|后摇|独立|另类|英伦|车库|硬摇滚|迷幻摇滚|流行朋克|Rock|Metal|Punk|Post[\s-]?Punk|Post[\s-]?Rock|Indie|Alternative|Grunge|Shoegaze|Britpop|Garage|Emo/i;
const ACOUSTIC_WARM_GENRES = /民谣|古典|轻音乐|纯音乐|新世纪|原声|钢琴|吉他|弦乐|大提琴|小提琴|室内乐|爵士|蓝调|波萨诺瓦|乡村|Folk|Classical|Acoustic|Piano|Guitar|Strings|Chamber|Soundtrack|New\s*Age|Jazz|Blues|Bossa|Country|Ballad/i;
const WARM_MOOD_TAGS = /治愈|温暖|安静|平静|伤感|思念|孤独|怀旧|感动|温柔|散步|午后/;
const ORIENTAL_GENRES = /国风|古风|中国风|戏腔|戏曲|民乐|民族|古筝|琵琶|二胡|竹笛|洞箫|武侠|仙侠|东方|新中式/;
const RAP_GENRES = /说唱|嘻哈|饶舌|\bRap\b|Hip[\s-]?Hop|Drill|Grime|Boom\s*Bap/i;

/** 对浮点数组执行等步长快速均值统计，控制单曲画像耗时在 0.05 ms 以内 */
function sampledMean(arr: Float32Array | undefined, from = 0, to = arr ? arr.length : 0): number {
  if (!arr || !arr.length) return 0;
  const start = Math.max(0, from), end = Math.min(arr.length, to);
  const span = end - start;
  if (span <= 0) return 0;
  const step = Math.max(1, Math.floor(span / 320));
  let sum = 0, count = 0;
  for (let i = start; i < end; i += step) {
    const v = arr[i];
    if (Number.isFinite(v)) { sum += v; count++; }
  }
  return count > 0 ? sum / count : 0;
}

/** 从音频分析特征与可选百科标签中提取本曲的多维气质画像 */
export function analyzeSongVibe(a: Analysis, song?: Partial<SongTraits>): SongVibe {
  const genres = song?.wiki?.genres?.join(' ') ?? '';
  const tags = song?.wiki?.tags?.join(' ') ?? '';
  const allMeta = `${genres} ${tags}`;
  const hasLyrics = song?.lyrics !== false;
  const gridBpm = song?.wiki?.bpm ?? a.bpm ?? 120;
  const citedBpm = a.namedBpm ?? gridBpm;
  const duration = Math.max(1, a.duration || 1);

  const countStrong = (hits?: Hit[]) => (hits ? hits.filter(h => h[1] > 0.3).length : 0);
  const kicksPerSec = countStrong(a.hits?.kick) / duration;
  const snaresPerSec = countStrong(a.hits?.snare) / duration;
  const drumsPerSec = kicksPerSec + 0.5 * snaresPerSec;
  const sections = a.sections ?? [];
  const drops = sections.filter(s => s.label === 'drop').length;
  const houseGroove = isSteadyHouseGroove(a, gridBpm);

  // 计算活跃段落的频段均值、旋律在场度与动态起伏
  const meanLow = sampledMean(a.env?.low);
  const meanMid = sampledMean(a.env?.mid);
  const meanHigh = sampledMean(a.env?.high);
  const meanOnset = sampledMean(a.env?.onset);
  const leadPresence = a.timbre?.leadPresence
    ? sampledMean(a.timbre.leadPresence)
    : a.env?.lead
      ? sampledMean(a.env.lead)
      : clamp01((meanMid - 0.22) * 1.1);
  const stabIntensity = a.timbre
    ? Math.max(sampledMean(a.timbre.bassStab), sampledMean(a.timbre.synthStab)) * 2.2
    : clamp01((meanOnset - 0.2) * 1.4);

  let maxEnergy = 0, minBodyEnergy = 1, vocalTime = 0, bodyTime = 0;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const len = Math.max(0, s.end - s.start);
    if (s.energy > maxEnergy) maxEnergy = s.energy;
    if (s.label !== 'intro' && s.label !== 'outro') {
      if (s.energy < minBodyEnergy) minBodyEnergy = s.energy;
      bodyTime += len;
      if (s.vocal) vocalTime += len;
    }
  }
  const energyRange = maxEnergy > minBodyEnergy ? maxEnergy - minBodyEnergy : 0;
  const vocalShare = bodyTime > 0 ? vocalTime / bodyTime : 0;

  const isMelodicGenre = MELODIC_EPIC_GENRES.test(genres);
  const isPureMelodicDub = /旋律回响贝斯|Melodic\s*(?:Dubstep|Bass)/i.test(genres);
  const isHardGenre = HARD_CYBER_GENRES.test(genres) && !isPureMelodicDub;

  // 1. 恢弘旋律 / 史诗感
  let melodicEpic = 0;
  if (isMelodicGenre) melodicEpic += 0.65;
  if (EPIC_MOOD_TAGS.test(allMeta)) melodicEpic += 0.28;
  if (drops > 0 || maxEnergy >= 0.82) {
    melodicEpic += 0.30 * clamp01((leadPresence - 0.16) / 0.42);
    melodicEpic += 0.22 * clamp01((energyRange - 0.20) / 0.38);
    if (meanHigh < 0.58) melodicEpic += 0.12 * clamp01((meanMid - 0.30) / 0.35);
  }
  melodicEpic = clamp01(melodicEpic);

  // 2. 硬核疾速 / 赛博电子
  let hardCyber = 0;
  if (isHardGenre) hardCyber += 0.68;
  else if (isPureMelodicDub) hardCyber += 0.24;
  if (CYBER_MOOD_TAGS.test(allMeta)) hardCyber += 0.18;
  hardCyber += 0.28 * clamp01((citedBpm - 134) / 40);
  hardCyber += 0.22 * clamp01((drumsPerSec - 1.55) / 1.5);
  hardCyber += 0.18 * clamp01((meanHigh - 0.38) / 0.34);
  hardCyber += 0.18 * clamp01(stabIntensity);
  if (houseGroove && !isHardGenre) hardCyber *= 0.32;
  if (ACOUSTIC_WARM_GENRES.test(genres) && !isHardGenre) hardCyber *= 0.25;
  hardCyber = clamp01(hardCyber);

  // 3. 都市律动 / 微醺复古
  let urbanGroove = 0;
  if (URBAN_GROOVE_GENRES.test(genres) && !isHardGenre) urbanGroove += 0.65;
  if (URBAN_MOOD_TAGS.test(allMeta) && !isHardGenre) urbanGroove += 0.25;
  if (houseGroove) urbanGroove += 0.55;
  if (citedBpm >= 92 && citedBpm <= 128 && meanHigh < 0.52 && drumsPerSec >= 0.7) {
    urbanGroove += 0.20 * clamp01((meanLow + meanMid) * 0.5 - 0.22);
  }
  urbanGroove = clamp01(urbanGroove);

  // 4. 摇滚乐队 / 独立构成
  let indieRock = 0;
  if (INDIE_ROCK_GENRES.test(genres)) indieRock += 0.75;
  if (!houseGroove && drops === 0 && snaresPerSec >= 0.42 && drumsPerSec >= 1.0 && meanMid >= 0.38 && meanHigh >= 0.28) {
    indieRock += 0.36;
  }
  indieRock = clamp01(indieRock);

  // 5. 原声温暖 / 治愈慢歌
  let acousticWarm = 0;
  if (ACOUSTIC_WARM_GENRES.test(genres) && !isHardGenre) acousticWarm += 0.65;
  if (WARM_MOOD_TAGS.test(allMeta) && !isHardGenre) acousticWarm += 0.24;
  acousticWarm += 0.28 * clamp01((1.15 - drumsPerSec) / 0.95);
  acousticWarm += 0.20 * clamp01((106 - citedBpm) / 34);
  if (drops === 0) acousticWarm += 0.12;
  if ((a.meter || 4) === 3) acousticWarm += 0.14;
  if (isHardGenre || INDIE_ROCK_GENRES.test(genres)) acousticWarm *= 0.25;
  acousticWarm = clamp01(acousticWarm);

  // 6. 东方意韵（支持纯古风与国风电音跨界曲目）
  let oriental = 0;
  if (ORIENTAL_GENRES.test(allMeta)) oriental += 0.85;
  oriental = clamp01(oriental);

  // 7. 人声词作主导度
  let vocalLyric = 0;
  if (hasLyrics) {
    if (RAP_GENRES.test(genres)) vocalLyric += 0.68;
    vocalLyric += 0.40 * clamp01(vocalShare / 0.68);
  }
  vocalLyric = clamp01(vocalLyric);

  // 若用户在右侧「设置 → 画面 → 音乐风格」中手动指定了曲风预设，则以用户所选曲风为主导调节各场景出现概率，
  // 同时仅保留微弱的本曲实时动态特征（避免网易云错误曲风标签冲淡用户的手动选择）
  const preset = song?.vibePreset;
  if (preset && preset !== 'auto' && isVibePresetId(preset)) {
    const pv = PRESET_VECTORS[preset];
    const blend = (target: number, autoVal: number) => clamp01(0.88 * target + (target > 0.15 ? 0.14 : 0.06) * autoVal);
    return {
      melodicEpic: blend(pv[0], melodicEpic),
      hardCyber: blend(pv[1], hardCyber),
      urbanGroove: blend(pv[2], urbanGroove),
      indieRock: blend(pv[3], indieRock),
      acousticWarm: blend(pv[4], acousticWarm),
      oriental: blend(pv[5], oriental),
      vocalLyric: hasLyrics ? blend(pv[6], vocalLyric) : 0,
      summary: VIBE_PRESET_MAP[preset].label,
    };
  }

  // 提取前两个显著倾向生成可读摘要
  const ranked = (Object.keys(VIBE_LABELS) as VibeDim[])
    .map(k => ({ k, v: ({ melodicEpic, hardCyber, urbanGroove, indieRock, acousticWarm, oriental, vocalLyric })[k] }))
    .filter(item => item.v >= 0.38)
    .sort((x, y) => y.v - x.v);
  const summary = ranked.length
    ? ranked.slice(0, 2).map(item => VIBE_LABELS[item.k]).join(' · ')
    : '均衡编排';

  return { melodicEpic, hardCyber, urbanGroove, indieRock, acousticWarm, oriental, vocalLyric, summary };
}

/** 获取不叠加手动预设时本曲自动识别出的音乐气质摘要（用于在设置面板展示「自动识别：…」） */
export function autoSongVibeSummary(a: Analysis, song?: Partial<SongTraits>): string {
  return analyzeSongVibe(a, song ? { ...song, vibePreset: 'auto' } : undefined).summary;
}

/**
 * 42 个场景在 7 个气质维度上的美学契合向量：
 * [melodicEpic, hardCyber, urbanGroove, indieRock, acousticWarm, oriental, vocalLyric]
 * 正值表示该类音乐提升场景出现概率，负值表示自动退让，0 表示中性百搭。
 */
const SCENE_PROFILE: Record<SceneId, readonly [number, number, number, number, number, number, number]> = {
  // 隧道与线条
  drive:      [-0.40,  1.45, -0.25,  0.20, -0.75, -0.20,  0.00],
  tunnel:     [ 0.10,  0.85,  0.25,  0.20, -0.35, -0.15,  0.00],
  rings:      [ 0.20,  0.45,  0.60,  0.15,  0.10,  0.00,  0.00],
  ridges:     [-0.25,  0.00,  0.15,  1.35,  0.40,  0.90,  0.15],
  // 封面解构
  shatter:    [-0.15,  1.05, -0.20,  0.95, -0.50, -0.10,  0.20],
  flip:       [-0.15,  0.35,  0.45,  0.75, -0.25, -0.15,  0.15],
  align:      [ 0.25,  0.35,  0.15,  0.55,  0.00,  0.00,  0.10],
  kaleido:    [ 0.30,  0.40,  0.20,  0.40, -0.05,  0.10,  0.00],
  halftone:   [-0.65,  0.15,  0.35,  1.35, -0.20, -0.30,  0.65],
  particles:  [ 0.70,  0.20,  0.20,  0.00,  0.55,  0.30,  0.00],
  relief:     [ 0.35,  0.45,  0.15,  0.35,  0.05,  0.10,  0.15],
  diorama:    [ 0.15, -0.60,  0.10,  0.35,  0.90,  0.50,  0.15],
  bokeh:      [ 0.35, -0.70,  0.65, -0.30,  0.95,  0.30,  0.10],
  ink:        [ 0.10, -0.80, -0.25, -0.15,  0.50,  1.45,  0.15],
  papercut:   [ 0.10, -0.75, -0.25, -0.15,  0.40,  1.35,  0.10],
  vinyl:      [-0.35, -0.65,  1.00,  1.05,  0.65, -0.10,  0.35],
  clouds:     [ 0.85, -0.70,  0.15, -0.15,  0.80,  1.00,  0.00],
  // 世界奇观
  city:       [ 0.20,  0.35,  1.05,  0.30,  0.05, -0.45,  0.45],
  aurora:     [ 1.05, -0.65,  0.30, -0.45,  0.80,  0.25,  0.00],
  pillars:    [ 0.35,  0.40,  0.45,  0.40,  0.10,  0.00,  0.10],
  canvas:     [ 0.30, -0.45,  0.20,  0.75,  0.80,  0.90,  0.15],
  rain:       [ 0.25, -0.80,  0.75, -0.15,  1.05,  0.20,  0.40],
  lanterns:   [ 0.65, -0.85,  0.10, -0.50,  0.95,  1.05,  0.30],
  underwater: [ 1.15, -0.15,  0.40, -0.55,  0.40,  0.30,  0.00],
  sunset:     [ 1.30, -0.80,  0.65, -0.45,  0.65,  0.60,  0.10],
  phoenix:    [ 1.35, -0.10, -0.30,  0.25, -0.50,  1.10,  0.05],
  velvet:     [ 0.15, -0.85,  1.35, -0.40,  0.35, -0.25,  0.10],
  fountain:   [ 1.20, -0.75,  0.70, -0.45,  0.85,  0.55,  0.20],
  // 音乐可视化
  ripple:     [ 0.40,  0.45,  0.35,  0.20,  0.05,  0.00,  0.00],
  channel:    [-0.30,  1.30,  0.15,  0.15, -0.65, -0.25,  0.00],
  orb:        [-0.10,  1.05,  0.05,  0.35, -0.55, -0.20,  0.00],
  scope:      [-0.35,  0.95,  0.15,  0.70, -0.35, -0.30,  0.00],
  // 分形穿梭
  menger:     [-0.35,  1.20,  0.00,  0.20, -0.65, -0.30,  0.00],
  sierpinski: [ 0.05,  1.15, -0.05,  0.15, -0.55, -0.20,  0.00],
  cantor:     [ 0.10,  0.95,  0.15,  0.15, -0.45, -0.20,  0.00],
  // 歌词排版
  poster:     [-0.45,  0.15,  0.35,  1.25,  0.05, -0.20,  0.90],
  typewall:   [-0.35,  0.45,  0.25,  0.45, -0.35, -0.25,  1.25],
  neon:       [-0.15,  0.25,  0.95,  0.30,  0.00, -0.30,  1.05],
  // 浑天仪与读数
  cards:      [ 0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00],
  crystal:    [ 0.30,  0.30,  0.10,  0.10,  0.10,  0.00,  0.00],
  subdivide:  [ 0.15,  0.65,  0.10,  0.20,  0.10, -0.15,  0.00],
  debug:      [-0.50,  1.10, -0.20,  0.60, -0.65, -0.35,  0.00],
};

const SPECTACLE_PLATES: ReadonlySet<SceneId> = new Set<SceneId>([
  'phoenix', 'drive', 'sunset', 'fountain', 'underwater', 'city', 'channel', 'shatter', 'aurora',
]);
const VOCAL_STAGE_PLATES: ReadonlySet<SceneId> = new Set<SceneId>([
  'poster', 'typewall', 'neon', 'rain', 'lanterns', 'city', 'shatter', 'vinyl',
]);
const INSTRUMENTAL_PLATES: ReadonlySet<SceneId> = new Set<SceneId>([
  'menger', 'sierpinski', 'cantor', 'channel', 'orb', 'scope', 'aurora', 'clouds', 'underwater', 'pillars',
]);
const GRAPHIC_COVER_PLATES: ReadonlySet<SceneId> = new Set<SceneId>([
  'diorama', 'papercut', 'poster', 'halftone',
]);

/**
 * 计算某个场景在当前段落、母风格与歌曲气质下的概率权重乘数（范围约 0.25 ~ 3.5）。
 * 保持纯函数与确定性，零随机状态。
 */
export function sceneAffinity(
  scene: SceneId,
  section: Section,
  style: Style,
  vibe: SongVibe,
  song?: Partial<SongTraits>,
): number {
  const p = SCENE_PROFILE[scene];
  if (!p) return 1;

  const dot =
    vibe.melodicEpic * p[0] +
    vibe.hardCyber * p[1] +
    vibe.urbanGroove * p[2] +
    vibe.indieRock * p[3] +
    vibe.acousticWarm * p[4] +
    vibe.oriental * p[5] +
    vibe.vocalLyric * p[6];

  let mult = clamp(Math.exp(1.15 * dot), 0.14, 5.0);

  // 结合当前段落自身的局部声学状态（高能量爆发 / 是否有主唱 / 封面图形特征）做细粒度微调
  if (section.energy >= 0.85 && SPECTACLE_PLATES.has(scene)) mult *= 1.16;
  if (section.vocal && song?.lyrics !== false && VOCAL_STAGE_PLATES.has(scene)) mult *= 1.12;
  if (!section.vocal && INSTRUMENTAL_PLATES.has(scene)) mult *= 1.14;
  if (song?.graphic && GRAPHIC_COVER_PLATES.has(scene)) mult *= 1.28;

  // 尊重母风格灵魂主场：在微醺与墨风格下保护其标志性视觉主体不被跨曲风偏置压低
  if (style.id === 'velvet' && scene === 'velvet') mult = Math.max(mult, 1.35);
  if (style.id === 'ink' && (scene === 'ink' || scene === 'papercut')) mult = Math.max(mult, 1.35);

  return clamp(mult, 0.12, 5.5);
}
