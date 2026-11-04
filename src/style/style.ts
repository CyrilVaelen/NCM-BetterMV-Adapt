// A style is a whole visual language: which scenes, which cameras, how fast to cut, how cuts land.
// The plugin picks one per song from the analysis (drums, drops, tempo); the user can override it.
// Within any chosen style, each plate carries a base weight and hero-shot eligibility, further modulated
// by the song's sub-genre & acoustic vibe (src/style/affinity.ts).
import type { Analysis, Section } from '../types.ts';
import type { SceneId } from '../scenes/types.ts';
import { TransitionKind } from '../render/shots.ts';
import type { Finish } from '../render/engine.ts';
import { isSteadyHouseGroove, VIBE_PRESET_MAP, type VibePresetId } from './affinity.ts';
export {
  analyzeSongVibe,
  autoSongVibeSummary,
  isSteadyHouseGroove,
  isTranceHypnoticDrive,
  isVibePresetId,
  sceneAffinity,
  VIBE_PRESET_MAP,
  VIBE_PRESETS,
  type SongVibe,
  type VibePresetId,
  type VibePresetMeta,
} from './affinity.ts';

export type StyleId = 'pulse' | 'velvet' | 'ballad' | 'word' | 'ink';

/** A plate the director may cut to, with the camera setups it offers and its base probability weights. */
export interface Plate {
  scene: SceneId;
  variants: string[];
  /** 在当前母风格与段落下的基础轮换权重（默认 1.0；核心重磅场景 > 1，点缀调剂场景 < 1） */
  weight?: number;
  /** 作为段落开场主镜头（Hero Shot）的候选权重（> 0 时进入首镜加权抽取池，未设置或 0 则仅参与段内轮换） */
  hero?: number;
}

/** What about a song changes its plates: a flat graphic cover, whether it has lyrics, and optional genre/mood metadata. */
export interface SongTraits {
  graphic: boolean;
  lyrics: boolean;
  /** 可选的网易云百科曲风、情绪标签与 BPM，供导演层细化同风格内的各场景出现概率 */
  wiki?: { genres: string[]; tags: string[]; bpm?: number };
  /** 用户在右侧设置面板手动选择的音乐风格预设（用于动态调节各场景出现概率） */
  vibePreset?: VibePresetId;
}

/** Plates built around the sung words. A song without lyrics (pure music) never gets them. */
export const LYRIC_PLATES: ReadonlySet<SceneId> = new Set<SceneId>(['poster', 'typewall', 'neon']);

export interface Style {
  id: StyleId;
  /** Name shown to users. */
  name: string;
  /** How the plates the styles share are drawn: hard and glowing on the beat, or soft and slow. */
  look: 'pulse' | 'ballad';
  /** The mark before the bar counter. */
  glyph: string;
  /**
   * Plates a section draws from using weighted probability sampling with cooldowns (the idea of the user's 《三角》:
   * one motif retold in many visual languages, weighted by the song's sub-genre and acoustic character).
   */
  pool(section: Section, song: SongTraits): Plate[];
  /** Bars per shot before any speeding up. */
  baseBars(section: Section): number;
  /** Bars the section's opening (hero) shot holds before the rotation starts, when longer than baseBars. */
  heroBars?(section: Section): number | undefined;
  /** Cuts speed up towards a louder section (bars → single bars → beats). */
  accelerate: boolean;
  transitions: {
    /** Flash into a louder section. */
    flash: boolean;
    /** Slice glitch on cuts inside loud sections. */
    glitch: boolean;
    /** Briefly blend into a Drop before its beat, then zoom-punch on the entry. */
    dropPunch: boolean;
    /** Seconds of dip to ink around a cut between sections (0 = hard cut). */
    dip: number;
    /** Ways a cut inside a section may land (default: the house wipes for pulse, soft ones for ballad). */
    within?: TransitionKind[];
    /** How a new section comes in when the style doesn't dip or punch into it. */
    between?: TransitionKind;
  };
  fx: { bloom: number; grain: number; vignette: number };
  /** The finish on every frame (src/render/engine.ts FinishShader): grade, halation, lens, sharpening. */
  finish: Finish;
}

const P = (scene: SceneId, ...variants: string[]): Plate => ({ scene, variants, weight: 1 });
const W = (weight: number, scene: SceneId, ...variants: string[]): Plate => ({ scene, variants, weight });
const H = (weight: number, hero: number, scene: SceneId, ...variants: string[]): Plate => ({ scene, variants, weight, hero });

/** Without lyrics the word plates drop out; a pool left with a single plate is topped up from `fill`. */
function forSong(pool: Plate[], song: SongTraits, fill: Plate[]): Plate[] {
  if (song.lyrics) return pool;
  const out = pool.filter(p => !LYRIC_PLATES.has(p.scene));
  for (const f of fill) if (out.length < 2 && !out.some(p => p.scene === f.scene)) out.push(f);
  return out;
}

/**
 * 当用户手动锁定了「律动 (PULSE)」剪辑节奏，但又在「音乐风格」中手动选择了微醺、国风、民谣或说唱时，
 * 按需将对应曲风的标志性场景注入候选池（保持 auto 下零变动，同时让跨风格混搭如“国风电音”“踩拍微醺”自然生效）。
 */
function withPulseVibePlates(base: Plate[], s: Section, song: SongTraits): Plate[] {
  const preset = song.vibePreset;
  if (!preset || preset === 'auto' || s.label === 'build' || s.label === 'pre') return base;
  const extras: Plate[] = [];
  if (preset === 'urban') {
    extras.push(
      H(2.2, 2.5, 'highway', 'cockpit', 'chase', 'bridge', 'warp'),
      H(2.1, 2.4, 'velvet', 'lounge', 'skim', 'platter', 'gallery'),
      W(1.5, 'fountain', 'courtyard', 'orbit', 'skim'),
      W(1.5, 'neon', 'walk', 'low', 'up'),
      W(1.4, 'rain', 'pane', 'clear'),
      W(1.2, 'bokeh', 'focus', 'orbit'),
    );
  } else if (preset === 'oriental') {
    extras.push(
      H(2.3, 2.6, 'pavilion', 'pavilion', 'water', 'eaves', 'zenith'),
      H(2.2, 2.5, 'ink', 'bloom', 'scroll', 'mist'),
      H(1.9, 2.1, 'papercut', 'bloom', 'turn'),
      H(1.9, 2.1, 'lanterns', 'shore', 'rise', 'wide'),
      H(1.75, 1.9, 'fountain', 'courtyard', 'crown', 'orbit'),
      W(1.6, 'clouds', 'rise', 'over', 'skim'),
    );
  } else if (preset === 'acoustic') {
    extras.push(
      H(2.0, 2.3, 'cathedral', 'sanctuary', 'aisle', 'organ'),
      H(2.0, 2.3, 'rain', 'pane', 'close', 'clear'),
      H(2.0, 2.3, 'lanterns', 'shore', 'rise', 'wide'),
      H(1.9, 2.1, 'fountain', 'courtyard', 'orbit', 'skim'),
      H(1.8, 2.0, 'aurora', 'wide', 'lake'),
      H(1.8, 2.0, 'starry', 'mirror', 'astrolabe', 'glide'),
      H(1.75, 1.95, 'blackhole', 'observatory', 'astrolabe', 'glide'),
      W(1.6, 'bokeh', 'focus', 'rise'),
      W(1.5, 'clouds', 'over', 'rise'),
    );
  } else if (preset === 'rap') {
    extras.push(
      H(2.3, 2.6, 'typewall', 'stack', 'split', 'solo'),
      H(2.1, 2.4, 'neon', 'walk', 'low', 'up'),
    );
  }
  if (!extras.length) return base;
  const seen = new Set(base.map(p => p.scene));
  const merged = [...base];
  for (const e of extras) if (!seen.has(e.scene)) merged.push(e);
  return merged;
}

export const PULSE: Style = {
  id: 'pulse',
  name: '律动',
  look: 'pulse',
  glyph: '△',
  pool: (s, song) => forSong(withPulseVibePlates(pulsePool(s), s, song), song, [W(1.1, 'kaleido', 'petal', 'spiral'), W(1.0, 'flip', 'wave', 'burst')]),
  baseBars: s => {
    switch (s.label) {
      case 'build': case 'pre': case 'chorus': case 'drop': return 2;
      default: return 4;
    }
  },
  // A drop opens on a weighted hero plate and stays in it long enough to pick up speed.
  heroBars: s => (s.label === 'drop' ? 4 : undefined),
  accelerate: true,
  transitions: { flash: true, glitch: true, dropPunch: true, dip: 0 },
  fx: { bloom: 0.35, grain: 0.04, vignette: 0.5 },
  finish: { contrast: 1.2, halation: 0.6, lens: 2.5, sharpen: 0.6, tone: 1.3, grain: 2.2, shutter: 1 / 48 },
};

function pulsePool(s: Section): Plate[] {
  switch (s.label) {
    case 'intro': return [
      H(1.8, 2.2, 'relief', 'rise'), H(1.8, 2.0, 'city', 'high', 'horizon'), H(1.5, 1.6, 'pillars', 'orbit', 'top'),
      H(1.4, 1.4, 'aurora', 'wide'), H(1.65, 1.85, 'starry', 'mirror', 'astrolabe'), H(1.68, 1.88, 'blackhole', 'observatory', 'astrolabe'), W(1.3, 'ridges', 'front', 'drift'), W(1.2, 'rings', 'front', 'tilt'),
      W(1.1, 'vinyl', 'top', 'tilt'), W(1.0, 'particles', 'hold'), W(0.95, 'ripple', 'face', 'tilt'),
      W(0.85, 'scope', 'wave', 'xy'), W(0.85, 'orb', 'wide', 'orbit'),
    ];
    case 'outro': return [
      H(1.8, 2.2, 'relief', 'rise'), H(1.75, 2.05, 'starry', 'mirror', 'zenith'), H(1.78, 2.08, 'blackhole', 'observatory', 'horizon'), H(1.7, 2.0, 'aurora', 'wide', 'lake'), H(1.5, 1.6, 'clouds', 'over'),
      W(1.3, 'ridges', 'drift'), W(1.1, 'rings', 'tilt'), W(1.0, 'particles', 'hold', 'vortex'),
      W(0.9, 'ripple', 'face', 'tilt'), W(0.8, 'scope', 'xy', 'wave'),
    ];
    // Builds run down the tunnel and burst out through the cover into the chorus/drop.
    case 'build': case 'pre': return [H(3.0, 3.0, 'tunnel', 'rush', 'roll', 'wall')];
    // Choruses draw hero shots from worlds & bold cover architecture, weighted by melodic/cyber/rock vibe.
    case 'chorus': return [
      H(2.0, 2.3, 'city', 'canyon', 'glide', 'horizon'),
      H(1.9, 2.1, 'shatter', 'wall', 'wall-close', 'wall-dutch', 'wall-edge'),
      H(1.85, 2.1, 'phoenix', 'stage', 'soar', 'sonic', 'altar'),
      H(1.95, 2.25, 'starry', 'mirror', 'glide', 'zenith', 'astrolabe'),
      H(2.0, 2.3, 'blackhole', 'observatory', 'glide', 'horizon', 'astrolabe'),
      H(1.85, 2.05, 'laser', 'arena', 'rig', 'booth', 'tunnel'),
      H(1.95, 2.25, 'cathedral', 'sanctuary', 'aisle', 'organ', 'soar'),
      H(2.0, 2.3, 'highway', 'cockpit', 'chase', 'bridge', 'warp'),
      H(1.9, 2.2, 'pavilion', 'pavilion', 'water', 'eaves', 'zenith'),
      H(1.95, 2.25, 'eclipse', 'canyon', 'corona', 'ridge', 'abyss'),
      H(1.8, 2.0, 'fountain', 'courtyard', 'orbit', 'skim', 'crown'),
      H(1.75, 1.9, 'sunset', 'horizon', 'beam', 'drift', 'halo'),
      H(1.7, 1.8, 'underwater', 'canyon', 'dive', 'orbit'),
      H(1.6, 1.6, 'pillars', 'orbit', 'top', 'low'),
      H(1.4, 1.4, 'poster', 'stack', 'slab', 'split'),
      W(1.35, 'canvas', 'high', 'chase', 'front'),
      W(1.25, 'channel', 'axis', 'roll', 'wall'),
      W(1.2, 'ripple', 'tilt', 'face', 'low'),
      W(1.15, 'halftone', 'in', 'fine'),
      W(1.1, 'align', 'swing'),
      W(1.0, 'particles', 'burst', 'vortex'),
      W(0.95, 'kaleido', 'petal', 'spiral'),
      W(0.9, 'flip', 'wave', 'burst'),
      W(0.9, 'orb', 'orbit', 'close'),
      W(0.85, 'debug', 'orbit', 'low', 'top'),
      W(0.85, 'menger', 'glide', 'look'),
      W(0.8, 'sierpinski', 'glide', 'look'),
      W(0.75, 'cantor', 'glide', 'look'),
    ];
    // Drops unlock all climax centerpieces as Hero candidates: hard/fast tracks naturally gravitate to drive/channel/shatter,
    // while melodic/oriental tracks gravitate to phoenix/sunset/underwater.
    case 'drop': return [
      H(2.2, 2.5, 'drive', 'push', 'roll'),
      H(2.25, 2.55, 'laser', 'arena', 'tunnel', 'booth', 'rig'),
      H(2.1, 2.4, 'cathedral', 'sanctuary', 'soar', 'organ'),
      H(2.25, 2.55, 'highway', 'warp', 'cockpit', 'chase'),
      H(2.1, 2.4, 'pavilion', 'zenith', 'water', 'pavilion'),
      H(2.2, 2.5, 'eclipse', 'corona', 'canyon', 'abyss'),
      H(1.85, 2.0, 'channel', 'axis', 'roll', 'wall'),
      H(1.9, 2.1, 'sunset', 'horizon', 'beam', 'drift', 'halo'),
      H(1.9, 2.1, 'underwater', 'dive', 'canyon', 'orbit', 'abyss'),
      H(1.85, 2.0, 'fountain', 'courtyard', 'skim', 'crown', 'orbit'),
      H(2.1, 2.4, 'phoenix', 'stage', 'soar', 'sonic', 'altar'),
      H(2.15, 2.45, 'starry', 'mirror', 'glide', 'zenith', 'astrolabe'),
      H(2.2, 2.5, 'blackhole', 'observatory', 'horizon', 'glide', 'astrolabe'),
      H(1.65, 1.7, 'shatter', 'swarm-a', 'swarm-d', 'swarm-b', 'swarm-c'),
      W(1.45, 'city', 'canyon', 'glide'),
      W(1.3, 'ripple', 'tilt', 'low'),
      W(1.25, 'orb', 'close', 'orbit'),
      W(1.2, 'pillars', 'top', 'orbit'),
      W(1.15, 'menger', 'glide', 'look'),
      W(1.05, 'sierpinski', 'glide'),
      W(1.0, 'particles', 'burst', 'vortex'),
      W(0.85, 'kaleido', 'spiral', 'petal'),
    ];
    case 'break': return [
      H(1.9, 2.2, 'aurora', 'wide', 'lake'), H(1.95, 2.25, 'starry', 'mirror', 'astrolabe', 'zenith'), H(1.95, 2.25, 'blackhole', 'observatory', 'astrolabe'), H(1.6, 1.8, 'clouds', 'over', 'skim'),
      H(1.5, 1.6, 'pillars', 'orbit', 'low'), H(1.4, 1.5, 'poster', 'slab', 'stack'),
      W(1.3, 'ridges', 'front', 'low'), W(1.25, 'fountain', 'courtyard', 'orbit'), W(1.2, 'vinyl', 'groove', 'top'), W(1.15, 'velvet', 'skim', 'gallery'),
      W(1.0, 'rings', 'front'), W(0.95, 'halftone', 'pan'), W(0.9, 'ripple', 'face', 'tilt'),
      W(0.8, 'orb', 'wide', 'orbit'), W(0.75, 'scope', 'wave', 'xy'), W(0.75, 'cantor', 'glide', 'look'),
    ];
    case 'bridge': return [
      H(1.9, 2.2, 'aurora', 'lake', 'wide'), H(1.95, 2.25, 'starry', 'mirror', 'glide', 'zenith'), H(1.95, 2.25, 'blackhole', 'observatory', 'glide'), H(1.7, 1.9, 'canvas', 'high', 'side'),
      H(1.6, 1.7, 'clouds', 'rise', 'skim'), H(1.5, 1.6, 'poster', 'split', 'stack'),
      W(1.4, 'pillars', 'orbit', 'top'), W(1.3, 'ridges', 'drift', 'low'), W(1.25, 'fountain', 'orbit', 'crown'), W(1.15, 'velvet', 'lounge', 'platter'),
      W(1.0, 'halftone', 'pan', 'out'), W(0.95, 'rings', 'tilt'), W(0.9, 'kaleido', 'petal'),
      W(0.85, 'ripple', 'face', 'tilt'), W(0.8, 'subdivide', 'ball'), W(0.75, 'debug', 'top', 'orbit'),
      W(0.75, 'orb', 'wide'), W(0.7, 'cantor', 'glide'), W(0.7, 'menger', 'look'),
    ];
    default: return [
      H(2.0, 2.3, 'relief', 'fly', 'crane', 'side', 'dive', 'low'),
      H(2.0, 2.3, 'city', 'horizon', 'canyon', 'glide', 'high'),
      H(1.7, 1.9, 'canvas', 'chase', 'high', 'side', 'front'),
      H(1.65, 1.8, 'ridges', 'front', 'low', 'drift'),
      H(1.55, 1.65, 'fountain', 'courtyard', 'orbit', 'skim'),
      H(1.68, 1.82, 'starry', 'mirror', 'glide', 'astrolabe'),
      H(1.72, 1.88, 'blackhole', 'observatory', 'glide', 'astrolabe'),
      H(1.55, 1.6, 'pillars', 'low', 'orbit'),
      H(1.5, 1.6, 'underwater', 'canyon', 'orbit'),
      W(1.35, 'vinyl', 'tilt', 'groove', 'top'),
      W(1.3, 'poster', 'stack', 'split', 'slab'),
      W(1.2, 'halftone', 'pan', 'in'),
      W(1.1, 'rings', 'tilt', 'front'),
      W(1.05, 'ripple', 'face', 'tilt', 'low'),
      W(1.0, 'align', 'swing'),
      W(0.9, 'flip', 'wave'),
      W(0.9, 'particles', 'hold'),
      W(0.85, 'channel', 'axis', 'wall'),
      W(0.8, 'orb', 'orbit', 'wide'),
      W(0.75, 'subdivide', 'ball'),
      W(0.75, 'menger', 'glide', 'look'),
      W(0.7, 'cantor', 'glide'),
    ];
  }
}

/**
 * 微醺 (Deep House / Melodic House / Lounge / Nu-Disco): 都市午夜微醺视觉语言。
 * 摒弃高频硬切、双色爆闪与故障切片，以 4–8 小节丝滑长镜头推进，核心聚焦「暗涌水廊 (velvet)」的玄武岩水面重力波、
 * 12 半音电钢琴发光磨砂玻璃光栅、悬浮烟熏琥珀黑胶与光学侧链呼吸，转场全部采用柔和叠化与封面遮罩。
 */
export const VELVET: Style = {
  id: 'velvet',
  name: '微醺',
  look: 'ballad',
  glyph: '◇',
  pool: (s, song) => forSong(velvetPool(s), song, [H(3.0, 3.5, 'velvet', 'lounge', 'skim', 'platter', 'gallery'), W(1.8, 'vinyl', 'tilt', 'groove')]),
  baseBars: s => {
    switch (s.label) {
      case 'intro': case 'outro': case 'break': case 'bridge': return 8;
      default: return 4;
    }
  },
  heroBars: s => (s.label === 'chorus' ? 8 : undefined),
  accelerate: false,
  transitions: {
    flash: false, glitch: false, dropPunch: false, dip: 0,
    within: [TransitionKind.dissolve, TransitionKind.matte, TransitionKind.zoom],
    between: TransitionKind.dissolve,
  },
  fx: { bloom: 0.28, grain: 0.036, vignette: 0.46 },
  finish: { contrast: 1.14, halation: 0.52, lens: 1.6, sharpen: 0.48, tone: 1.18, grain: 1.8, shutter: 1 / 42 },
};

function velvetPool(s: Section): Plate[] {
  switch (s.label) {
    case 'intro': return [
      H(3.0, 3.6, 'velvet', 'lounge', 'skim'), H(1.8, 1.8, 'vinyl', 'tilt', 'top'), H(1.6, 1.6, 'rain', 'pane', 'clear'),
      W(1.3, 'bokeh', 'haze'), W(1.3, 'city', 'horizon', 'high'), W(1.1, 'aurora', 'lake', 'wide'),
    ];
    case 'outro': return [
      H(2.8, 3.2, 'velvet', 'skim', 'lounge'), H(1.8, 2.0, 'sunset', 'drift', 'horizon'), H(1.6, 1.6, 'vinyl', 'tilt', 'groove'),
      W(1.5, 'fountain', 'courtyard', 'orbit'), W(1.2, 'aurora', 'lake', 'wide'), W(1.2, 'rain', 'clear'),
    ];
    case 'build': case 'pre': return [
      H(2.8, 3.2, 'velvet', 'skim', 'gallery'), H(1.7, 1.8, 'city', 'glide', 'horizon'),
      W(1.2, 'rings', 'tilt', 'front'), W(1.1, 'pillars', 'low', 'orbit'),
    ];
    case 'chorus': return [
      H(3.2, 3.8, 'velvet', 'lounge', 'platter', 'gallery', 'skim'), H(2.0, 2.2, 'sunset', 'horizon', 'drift', 'halo'),
      H(1.85, 2.0, 'fountain', 'courtyard', 'orbit', 'skim', 'crown'), H(1.8, 1.9, 'city', 'glide', 'horizon', 'high'), H(1.8, 2.0, 'highway', 'cockpit', 'chase', 'bridge'), H(1.6, 1.6, 'vinyl', 'groove', 'tilt', 'top'),
      W(1.4, 'underwater', 'canyon', 'orbit'), W(1.2, 'pillars', 'orbit', 'low'),
      W(1.15, 'aurora', 'lake', 'wide'), W(1.05, 'bokeh', 'focus', 'orbit'), W(0.9, 'ripple', 'tilt', 'face'),
    ];
    case 'drop': return [
      H(3.4, 4.0, 'velvet', 'lounge', 'skim', 'platter', 'gallery'), H(2.0, 2.2, 'sunset', 'horizon', 'beam', 'drift'),
      H(1.85, 2.0, 'fountain', 'courtyard', 'skim', 'crown', 'orbit'), H(1.85, 1.95, 'blackhole', 'observatory', 'glide', 'astrolabe'), H(1.8, 1.9, 'underwater', 'canyon', 'orbit', 'dive'), H(1.75, 1.85, 'laser', 'arena', 'rig', 'booth'), H(1.7, 1.7, 'city', 'glide', 'canyon', 'horizon'),
      W(1.4, 'vinyl', 'groove', 'tilt'), W(1.2, 'pillars', 'orbit', 'top'), W(1.0, 'ripple', 'tilt', 'low'),
    ];
    case 'break': case 'bridge': return [
      H(2.8, 3.2, 'velvet', 'gallery', 'skim'), H(1.9, 2.0, 'rain', 'pane', 'close', 'clear'), H(1.6, 1.6, 'vinyl', 'groove', 'tilt'),
      W(1.35, 'fountain', 'courtyard', 'orbit'), W(1.3, 'bokeh', 'haze', 'rise'), W(1.2, 'clouds', 'skim', 'over'), W(1.15, 'aurora', 'lake'), W(1.1, 'underwater', 'abyss', 'orbit'),
    ];
    default: return [
      H(3.2, 3.8, 'velvet', 'platter', 'lounge', 'skim', 'gallery'), H(1.9, 2.0, 'vinyl', 'tilt', 'top', 'groove'),
      H(1.7, 1.8, 'rain', 'pane', 'clear'), H(1.6, 1.6, 'city', 'horizon', 'high', 'glide'),
      W(1.5, 'sunset', 'drift', 'horizon'), W(1.45, 'fountain', 'courtyard', 'orbit', 'skim'), W(1.15, 'pillars', 'low', 'orbit'),
      W(1.1, 'bokeh', 'focus', 'rise'), W(1.05, 'aurora', 'lake', 'wide'), W(0.85, 'ripple', 'face', 'tilt'),
    ];
  }
}

export const BALLAD: Style = {
  id: 'ballad',
  name: '抒情',
  look: 'ballad',
  glyph: '○',
  pool: (s, song) => forSong(balladPool(s, song), song, [W(1.2, 'rings', 'front', 'tilt'), W(1.4, 'bokeh', 'rise')]),
  baseBars: s => (s.label === 'intro' || s.label === 'outro' ? 4 : 2),
  accelerate: false,
  transitions: { flash: false, glitch: false, dropPunch: false, dip: 0 },
  fx: { bloom: 0.5, grain: 0.055, vignette: 0.6 },
  finish: { contrast: 1.12, halation: 0.7, lens: 2, sharpen: 0.4, tone: 1.3, grain: 2, shutter: 1 / 40 },
};

// Paper-cut only suits flat graphic covers; photos and paintings get the slow ring tunnel instead.
function balladPool(s: Section, song: SongTraits): Plate[] {
  const quiet = song.graphic
    ? H(2.2, 2.6, 'diorama', 'drift', 'push', 'truck', 'tilt')
    : H(1.4, 1.5, 'tunnel', 'rush', 'wall', 'roll');
  switch (s.label) {
    case 'intro': return [
      H(2.0, 2.4, 'bokeh', 'haze'), H(2.0, 2.4, 'rain', 'pane', 'clear'), H(1.8, 2.0, 'lanterns', 'wide'),
      H(1.7, 1.9, 'aurora', 'wide', 'lake'), W(1.5, 'fountain', 'courtyard', 'orbit'), W(1.4, 'clouds', 'over'), W(1.2, 'pillars', 'orbit', 'top'),
      W(1.0, 'particles', 'hold'), W(0.75, 'ripple', 'face'), W(0.65, 'scope', 'xy'),
    ];
    case 'outro': return [
      song.graphic ? H(2.2, 2.5, 'diorama', 'pullback') : H(1.3, 1.4, 'tunnel', 'roll'),
      H(2.0, 2.3, 'lanterns', 'rise', 'wide'), H(1.9, 2.1, 'aurora', 'wide'), H(1.8, 2.0, 'rain', 'clear'), H(1.75, 1.9, 'fountain', 'courtyard', 'crown'),
    ];
    // Choruses elevate poetic worlds (aurora, lanterns, sunset, fountain, clouds, rain, bokeh) while keeping geometric/fractal scenes as rare accents.
    case 'chorus': case 'drop': return [
      H(2.2, 2.5, 'aurora', 'up', 'wide'),
      H(2.2, 2.5, 'lanterns', 'shore', 'rise', 'wide'),
      H(2.0, 2.3, 'sunset', 'horizon', 'beam', 'drift', 'halo'),
      H(2.0, 2.3, 'cathedral', 'sanctuary', 'aisle', 'organ'),
      H(1.95, 2.2, 'pavilion', 'pavilion', 'water', 'eaves', 'zenith'),
      H(2.05, 2.35, 'starry', 'mirror', 'glide', 'zenith', 'astrolabe'),
      H(2.05, 2.35, 'blackhole', 'observatory', 'glide', 'horizon', 'astrolabe'),
      H(1.95, 2.2, 'fountain', 'courtyard', 'orbit', 'crown', 'skim'),
      H(1.85, 2.0, 'clouds', 'rise', 'over', 'skim'),
      H(1.8, 1.9, 'rain', 'pane', 'close'),
      H(1.75, 1.8, 'bokeh', 'focus', 'orbit', 'rise'),
      H(1.65, 1.7, 'underwater', 'canyon', 'orbit', 'dive'),
      H(1.5, 1.6, 'phoenix', 'stage', 'soar', 'sonic', 'altar'),
      W(1.5, 'canvas', 'high', 'chase', 'side'),
      W(1.35, 'city', 'horizon', 'high'),
      W(1.25, 'pillars', 'orbit', 'top'),
      W(1.2, 'velvet', 'lounge', 'skim', 'platter'),
      W(1.1, 'particles', 'rain', 'vortex'),
      W(0.95, 'poster', 'stack', 'split'),
      W(0.8, 'ripple', 'face', 'tilt'),
      W(0.75, 'align', 'swing'),
      W(0.65, 'kaleido', 'petal', 'spiral'),
      W(0.6, 'flip', 'wave'),
      W(0.55, 'orb', 'orbit', 'wide'),
      W(0.45, 'sierpinski', 'glide'),
      W(0.45, 'cantor', 'glide', 'look'),
    ];
    case 'bridge': case 'break': return [
      H(2.0, 2.3, 'rain', 'clear', 'pane'), H(1.9, 2.2, 'lanterns', 'wide', 'rise'),
      H(1.8, 2.0, 'clouds', 'over', 'rise'), H(1.85, 2.05, 'starry', 'mirror', 'astrolabe'), H(1.85, 2.05, 'blackhole', 'observatory', 'astrolabe'), H(1.75, 1.9, 'aurora', 'lake'),
      H(1.6, 1.7, 'canvas', 'high', 'side'), W(1.5, 'fountain', 'courtyard', 'orbit'), W(1.45, 'city', 'high', 'horizon'),
      W(1.4, 'bokeh', 'rise'), W(1.25, 'ridges', 'drift'), W(1.2, 'velvet', 'gallery', 'skim'),
      W(1.1, 'pillars', 'orbit', 'low'), W(1.0, 'poster', 'split', 'stack'),
      W(0.8, 'halftone', 'pan'), W(0.75, 'rings', 'front'),
      W(0.6, 'subdivide', 'ball'), W(0.55, 'orb', 'wide', 'orbit'), W(0.45, 'menger', 'glide'),
    ];
    default: return [
      quiet,
      H(2.2, 2.5, 'rain', 'pane', 'close', 'clear'),
      H(2.0, 2.3, 'lanterns', 'shore', 'wide'),
      H(1.8, 2.0, 'aurora', 'lake', 'wide'),
      H(1.75, 1.9, 'canvas', 'high', 'side', 'chase'),
      H(1.7, 1.85, 'fountain', 'courtyard', 'orbit'),
      H(1.65, 1.8, 'vinyl', 'top', 'tilt'),
      W(1.3, 'velvet', 'lounge', 'platter'),
      W(1.25, 'ridges', 'front', 'drift'),
      W(1.15, 'pillars', 'low', 'orbit'),
      W(1.0, 'poster', 'stack', 'split', 'slab'),
      W(0.85, 'rings', 'tilt', 'front'),
      W(0.8, 'halftone', 'in', 'pan'),
      W(0.75, 'ripple', 'face', 'tilt'),
      W(0.65, 'flip', 'wave'),
      W(0.55, 'subdivide', 'ball'),
    ];
  }
}

/**
 * 字 (rap): the words are the picture. Verses take turns opening on the type wall and walking down the street of neon
 * signs (each chunk a sign that strikes on as it is rapped), between halftone prints and posters; builds slam one
 * word at a time; choruses cut every two bars between walls of words, the neon street, posters, prints and shards.
 */
export const WORD: Style = {
  id: 'word',
  name: '字',
  look: 'pulse',
  glyph: '□',
  pool: (s, song) => forSong(wordPool(s), song, [W(1.4, 'halftone', 'pan', 'in', 'out'), W(1.2, 'ridges', 'front', 'low')]),
  baseBars: s => (s.label === 'intro' || s.label === 'outro' ? 4 : 2),
  heroBars: s => (s.label === 'verse' || s.label === 'chorus' ? 4 : undefined),
  accelerate: true,
  transitions: {
    flash: true, glitch: true, dropPunch: true, dip: 0,
    within: [TransitionKind.whip, TransitionKind.slices, TransitionKind.whip, TransitionKind.zoom, TransitionKind.wipe],
  },
  fx: { bloom: 0.3, grain: 0.05, vignette: 0.45 },
  finish: { contrast: 1.2, halation: 0.45, lens: 1.8, sharpen: 0.6, tone: 1, grain: 2, shutter: 1 / 60 },
};

function wordPool(s: Section): Plate[] {
  switch (s.label) {
    case 'intro': return [
      H(2.0, 2.3, 'halftone', 'out', 'in'), H(2.0, 2.3, 'neon', 'walk', 'up'), H(1.6, 1.7, 'city', 'high', 'horizon'),
      W(1.4, 'vinyl', 'top'), W(1.2, 'ridges', 'front', 'low'), W(0.9, 'scope', 'wave'),
    ];
    case 'outro': return [
      H(2.0, 2.3, 'neon', 'up', 'walk'), H(1.9, 2.1, 'halftone', 'out'), H(1.6, 1.7, 'vinyl', 'top', 'tilt'),
      W(1.5, 'city', 'horizon'), W(1.2, 'ridges', 'drift'),
    ];
    case 'build': case 'pre': return [H(2.6, 3.0, 'typewall', 'solo'), H(1.6, 1.6, 'tunnel', 'rush', 'roll')];
    case 'chorus': return [
      H(2.6, 3.0, 'typewall', 'stack', 'split'),
      H(2.3, 2.6, 'neon', 'walk', 'low', 'up'),
      H(2.0, 2.2, 'poster', 'slab', 'stack', 'split'),
      H(1.9, 2.0, 'city', 'canyon', 'glide', 'horizon'),
      W(1.65, 'halftone', 'fine', 'in'),
      W(1.5, 'shatter', 'wall', 'wall-close', 'wall-dutch'),
      W(1.4, 'vinyl', 'groove', 'top', 'tilt'),
      W(1.25, 'pillars', 'orbit', 'top', 'low'),
      W(1.0, 'flip', 'burst', 'wave'),
      W(0.95, 'align', 'swing'),
      W(0.9, 'channel', 'axis', 'roll'),
      W(0.85, 'ripple', 'tilt', 'face'),
      W(0.8, 'debug', 'orbit', 'top'),
    ];
    case 'drop': return [
      H(2.2, 2.5, 'drive', 'push', 'roll'),
      H(2.25, 2.55, 'laser', 'arena', 'tunnel', 'booth', 'rig'),
      H(2.0, 2.3, 'typewall', 'stack', 'solo'),
      H(1.9, 2.1, 'phoenix', 'stage', 'soar', 'sonic', 'altar'),
      H(1.8, 1.9, 'channel', 'axis', 'roll'),
      H(1.7, 1.8, 'sunset', 'horizon', 'beam', 'drift', 'halo'),
      W(1.5, 'shatter', 'swarm-a', 'swarm-b'),
      W(1.3, 'halftone', 'fine'),
      W(1.1, 'ripple', 'tilt', 'low'),
    ];
    case 'break': case 'bridge': return [
      H(2.0, 2.3, 'neon', 'low', 'up'), H(1.9, 2.1, 'halftone', 'pan', 'out'),
      H(1.7, 1.8, 'poster', 'split', 'slab'), W(1.5, 'vinyl', 'groove', 'top'),
      W(1.4, 'city', 'high', 'horizon'), W(1.2, 'ridges', 'front', 'drift'),
      W(1.0, 'pillars', 'orbit'), W(0.8, 'scope', 'wave', 'xy'),
    ];
    default: return [
      H(2.6, 3.0, 'typewall', 'split', 'stack', 'solo'),
      H(2.4, 2.8, 'neon', 'walk', 'low', 'up'),
      H(1.9, 2.0, 'poster', 'stack', 'slab', 'split'),
      H(1.8, 1.9, 'city', 'horizon', 'canyon', 'glide', 'high'),
      W(1.65, 'halftone', 'pan', 'in', 'fine'),
      W(1.5, 'vinyl', 'top', 'tilt', 'groove'),
      W(1.3, 'canvas', 'chase', 'high', 'side'),
      W(1.2, 'pillars', 'low', 'orbit'),
      W(0.9, 'ripple', 'face', 'tilt'),
      W(0.75, 'subdivide', 'ball'),
    ];
  }
}

/**
 * 墨 (国风 / 古风): the cover painted in ink on rice paper, the words in vertical columns, the view travelling
 * along it like a scroll; around it the plates that have a version of their own on paper — ranges of ink mountains
 * (ridges), a sea of clouds with a red sun and far peaks (clouds), the song writing its cover with a brush (canvas),
 * a window flower cut from red paper (papercut) — and soft light. Long shots, soft dissolves, ink seeping in at
 * the cuts.
 */
export const INK: Style = {
  id: 'ink',
  name: '墨',
  look: 'ballad',
  glyph: '〇',
  pool: (s, song) => forSong(inkPool(s, song), song, [H(3.0, 3.5, 'ink', 'scroll', 'mist'), W(1.2, 'bokeh', 'rise', 'haze')]),
  baseBars: s => (s.label === 'chorus' || s.label === 'drop' ? 2 : 4),
  accelerate: false,
  // Ink seeps in from a blot, or the cover's own shapes, or a round moon gate opens; sections change by seeping.
  transitions: {
    flash: false, glitch: false, dropPunch: false, dip: 0,
    within: [TransitionKind.ink, TransitionKind.matte, TransitionKind.iris], between: TransitionKind.ink,
  },
  fx: { bloom: 0.3, grain: 0.04, vignette: 0.45 },
  finish: { contrast: 1.08, halation: 0, lens: 0.8, sharpen: 0.4, tone: 0.8, grain: 1.6, shutter: 1 / 40 },
};

function inkPool(s: Section, song: SongTraits): Plate[] {
  switch (s.label) {
    case 'intro': return [
      H(3.0, 3.5, 'ink', 'bloom'), H(2.0, 2.2, 'clouds', 'over'),
      H(1.8, 1.8, 'ridges', 'front', 'drift'), W(1.0, 'bokeh', 'haze'),
    ];
    case 'outro': return [
      H(2.8, 3.2, 'ink', 'mist', 'scroll'), H(2.0, 2.2, 'ridges', 'drift', 'front'), H(1.8, 1.8, 'clouds', 'over'),
    ];
    // Choruses focus on ink spreading, sea of clouds, red paper-cut and calligraphy brush canvas.
    case 'chorus': case 'drop': return [
      H(3.0, 3.5, 'ink', 'bloom', 'scroll'),
      H(2.3, 2.6, 'clouds', 'rise', 'over', 'skim'),
      H(2.2, 2.5, 'pavilion', 'pavilion', 'water', 'eaves', 'zenith'),
      H(2.0, 2.2, 'papercut', 'bloom', 'turn'),
      H(1.9, 2.0, 'canvas', 'high', 'chase', 'side'),
      W(1.0, 'bokeh', 'focus', 'orbit'),
    ];
    case 'bridge': case 'break': return [
      H(2.4, 2.8, 'clouds', 'skim', 'over'), H(2.4, 2.8, 'ink', 'mist'),
      H(1.9, 2.0, 'ridges', 'drift', 'low'), W(1.6, 'papercut', 'turn'), W(1.0, 'bokeh', 'rise'),
    ];
    default: return [
      H(3.0, 3.5, 'ink', 'scroll', 'mist'),
      H(2.1, 2.3, 'ridges', 'front', 'drift', 'low'),
      H(1.9, 2.0, 'canvas', 'chase', 'side', 'high'),
      W(1.7, 'papercut', 'turn'),
      song.graphic ? W(1.4, 'diorama', 'drift', 'truck') : W(1.0, 'bokeh', 'rise', 'focus'),
    ];
  }
}

export const STYLES: Record<StyleId, Style> = { pulse: PULSE, velvet: VELVET, ballad: BALLAD, word: WORD, ink: INK };

export interface StyleChoice {
  style: Style;
  /** Why, in a few words (for the debug line and the settings page). */
  reason: string;
  features: { bpm: number; drumsPerSecond: number; drops: number };
}

const WORD_GENRES = /说唱|嘻哈|饶舌|Rap|Hip[\s-]?Hop|Drill|Grime/i;
const INK_GENRES = /国风|古风|中国风|戏腔|戏曲|民族/;
const VELVET_GENRES = /深邃浩室|旋律浩室|热带浩室|爵士浩室|灵魂浩室|放克浩室|科技浩室|有机浩室|浩室舞曲|浩室|弛放|沙发音乐|合成器浪潮|蒸汽波|新迪斯科|缓拍|神游舞曲|低保真|Deep[\s-]?House|Chill[\s-]?House|Melodic[\s-]?House|Jazz[\s-]?House|Soulful[\s-]?House|Tropical[\s-]?House|Organic[\s-]?House|Afro[\s-]?House|Tech[\s-]?House|Future[\s-]?House|Progressive[\s-]?House|Lounge|Chillout|Nu[\s-]?Disco|Synthwave|Vaporwave|Chillwave|Downtempo|Lo[\s-]?Fi|Trip[\s-]?Hop/i;
const HOUSE_PLAIN = /\bHouse\b/i;
const HARD_PULSE_GENRES = /回响贝斯|鼓打贝斯|未来贝斯|中速节奏|碎拍|硬核|硬派舞曲|出神舞曲|迷幻舞曲|科技舞曲|大空间浩室|电子浩室|低音浩室|陷阱|Trap|Dubstep|Brostep|Riddim|Future[\s-]?Bass|Midtempo|Breakbeat|Hardstyle|Hardcore|Techno|Trance|Psytrance|Big[\s-]?Room|Electro[\s-]?House|Bass[\s-]?House|Drum\s*(?:&|and|\+)?\s*Bass|DnB|Jungle|摇滚|金属|朋克|Phonk/i;
const PULSE_GENRES = /电子|舞曲|电音|浩室|House|回响贝斯|鼓打贝斯|未来贝斯|中速节奏|陷阱|Trap|Dubstep|Techno|Trance|摇滚|金属|朋克|Phonk/i;
const BALLAD_GENRES = /民谣|古典|轻音乐|新世纪|纯音乐|氛围|爵士|蓝调/;
const CALM_TAGS = /治愈|平静|伤感|浪漫|放松|安静|思念|孤独|温暖|感动|怀旧|深夜|失恋|抒情|慵懒/;
const VELVET_MOOD_TAGS = /深夜|微醺|慵懒|放松|浪漫|安静|治愈|复古|迷幻|氛围|小酒馆|咖啡厅/;
const RAVE_TAGS = /活力|狂欢|燃|兴奋|激昂|运动|极限运动|派对|动感|嗨/;
const LIVELY_TAGS = /活力|狂欢|燃|兴奋|激昂|律动|派对|运动|极限运动|动感|嗨/;

/**
 * NetEase's genre and mood tags first (they are curated and reliable); the audio only when a song has none:
 * drops or a steady drum pulse mean pulse, steady 4/4 Deep House groove means velvet, anything else gets the ballad language.
 * Rap gets the word style when it has lyrics to set; 国风 gets the ink style unless it is dance music.
 */
export function chooseStyle(a: Analysis, wiki?: { genres: string[]; tags: string[]; bpm?: number }, hasLyrics = true): StyleChoice {
  const strong = (hits: Array<[number, number]>) => hits.filter(h => h[1] > 0.3).length;
  const drumsPerSecond = (strong(a.hits.kick) + 0.5 * strong(a.hits.snare)) / Math.max(1, a.duration);
  const drops = a.sections.filter(s => s.label === 'drop').length;
  const bpm = wiki?.bpm ?? a.bpm;
  const features = { bpm: Math.round(bpm), drumsPerSecond: +drumsPerSecond.toFixed(2), drops };
  const genres = wiki?.genres.join(' ') ?? '';
  const tags = wiki?.tags.join(' ') ?? '';
  if (genres) {
    const genre = wiki!.genres[0].split('-').pop();
    const byGenre = `曲风：${genre}`;
    if (WORD_GENRES.test(genres) && hasLyrics) return { style: WORD, reason: byGenre, features };
    if (INK_GENRES.test(genres) && !PULSE_GENRES.test(genres)) return { style: INK, reason: byGenre, features };
    if (!HARD_PULSE_GENRES.test(genres)) {
      if (VELVET_GENRES.test(genres)) return { style: VELVET, reason: byGenre, features };
      if (HOUSE_PLAIN.test(genres) && !(RAVE_TAGS.test(tags) && !VELVET_MOOD_TAGS.test(tags) && bpm >= 128)) {
        return { style: VELVET, reason: byGenre, features };
      }
      if (/电子|舞曲|电音/.test(genres)) {
        if (VELVET_MOOD_TAGS.test(tags) && !RAVE_TAGS.test(tags) && bpm >= 106 && bpm <= 128) {
          return { style: VELVET, reason: `${byGenre} · ${wiki!.tags.slice(0, 2).join('、')}`, features };
        }
        if (isSteadyHouseGroove(a, bpm)) {
          return { style: VELVET, reason: `${byGenre} · 四四拍浩室`, features };
        }
      }
    }
    if (BALLAD_GENRES.test(genres) && !PULSE_GENRES.test(genres)) return { style: BALLAD, reason: byGenre, features };
    if (PULSE_GENRES.test(genres) || WORD_GENRES.test(genres)) return { style: PULSE, reason: byGenre, features };
    // Pop and the rest: mood tags, then tempo.
    const calm = CALM_TAGS.test(tags), lively = LIVELY_TAGS.test(tags);
    if (calm && !lively) return { style: BALLAD, reason: `标签：${wiki!.tags.slice(0, 2).join('、')}`, features };
    if (lively && !calm) return { style: PULSE, reason: `标签：${wiki!.tags.slice(0, 2).join('、')}`, features };
    return bpm < 100 ? { style: BALLAD, reason: `${genre}，${Math.round(bpm)} BPM`, features } : { style: PULSE, reason: `${genre}，${Math.round(bpm)} BPM`, features };
  }
  if (isSteadyHouseGroove(a, bpm)) return { style: VELVET, reason: '四四拍微醺律动', features };
  if (drops > 0) return { style: PULSE, reason: '含 drop', features };
  if (drumsPerSecond >= 1.6) return { style: PULSE, reason: '鼓点密集', features };
  return { style: BALLAD, reason: '鼓点稀疏、无 drop', features };
}

/**
 * 当视觉母风格设为「自动」且用户在右侧手动指定了「音乐风格」预设时，
 * 同步映射到最契合该音乐风格的默认母风格（同时保留用户在上方手动锁定母风格的高优先级）。
 */
export function chooseStyleForVibePreset(preset: VibePresetId | undefined, hasLyrics: boolean, base: StyleChoice): StyleChoice {
  if (!preset || preset === 'auto') return base;
  const meta = VIBE_PRESET_MAP[preset];
  if (!meta?.preferredStyle) return base;
  const styleId: StyleId = meta.preferredStyle === 'word' && !hasLyrics ? 'pulse' : meta.preferredStyle;
  return {
    style: STYLES[styleId],
    reason: `音乐风格：${meta.label}`,
    features: base.features,
  };
}
