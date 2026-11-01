// A style is a whole visual language: which scenes, which cameras, how fast to cut, how cuts land.
// The plugin picks one per song from the analysis (drums, drops, tempo); the user can override it.
import type { Analysis, Section } from '../types.ts';
import type { SceneId } from '../scenes/types.ts';
import { TransitionKind } from '../render/shots.ts';
import type { Finish } from '../render/engine.ts';

export type StyleId = 'pulse' | 'velvet' | 'ballad' | 'word' | 'ink';

/** A plate the director may cut to, with the camera setups it offers. */
export interface Plate { scene: SceneId; variants: string[] }

/** What about a song changes its plates: a flat graphic cover (paper-cut suits it), and whether it has lyrics. */
export interface SongTraits { graphic: boolean; lyrics: boolean }

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
   * Plates a section rotates through, a new one every `baseBars` (the idea of the user's 《三角》: one motif
   * retold in many visual languages). Consecutive shots never repeat a plate while the pool has others.
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

const P = (scene: SceneId, ...variants: string[]): Plate => ({ scene, variants });

/** Without lyrics the word plates drop out; a pool left with a single plate is topped up from `fill`. */
function forSong(pool: Plate[], song: SongTraits, fill: Plate[]): Plate[] {
  if (song.lyrics) return pool;
  const out = pool.filter(p => !LYRIC_PLATES.has(p.scene));
  for (const f of fill) if (out.length < 2 && !out.some(p => p.scene === f.scene)) out.push(f);
  return out;
}

export const PULSE: Style = {
  id: 'pulse',
  name: '律动',
  look: 'pulse',
  glyph: '△',
  pool: (s, song) => forSong(pulsePool(s), song, [P('kaleido', 'petal', 'spiral'), P('flip', 'wave', 'burst')]),
  baseBars: s => {
    switch (s.label) {
      case 'build': case 'pre': case 'chorus': case 'drop': return 2;
      default: return 4;
    }
  },
  // A drop opens on the push tunnel (or the spectrum tube) and stays in it long enough to pick up speed.
  heroBars: s => (s.label === 'drop' ? 4 : undefined),
  accelerate: true,
  transitions: { flash: true, glitch: true, dropPunch: true, dip: 0 },
  fx: { bloom: 0.35, grain: 0.04, vignette: 0.5 },
  finish: { contrast: 1.2, halation: 0.6, lens: 2.5, sharpen: 0.6, tone: 1.3, grain: 2.2, shutter: 1 / 48 },
};

function pulsePool(s: Section): Plate[] {
  switch (s.label) {
    case 'intro': return [P('relief', 'rise'), P('city', 'high', 'horizon'), P('pillars', 'orbit', 'top'), P('rings', 'front', 'tilt'), P('ridges', 'front', 'drift'), P('particles', 'hold'), P('scope', 'wave', 'xy'), P('vinyl', 'top', 'tilt'), P('aurora', 'wide'), P('ripple', 'face', 'tilt'), P('orb', 'wide', 'orbit')];
    case 'outro': return [P('relief', 'rise'), P('aurora', 'wide', 'lake'), P('rings', 'tilt'), P('ridges', 'drift'), P('particles', 'hold', 'vortex'), P('scope', 'xy', 'wave'), P('clouds', 'over'), P('ripple', 'face', 'tilt')];
    // Builds run down the tunnel and burst out through the cover into the chorus/drop.
    case 'build': case 'pre': return [P('tunnel', 'rush', 'roll', 'wall')];
    // The city powers up on a chorus's first downbeat; choruses take turns opening on it and on the shard wall.
    case 'chorus': return [
      P('city', 'canyon', 'glide', 'horizon'), P('shatter', 'wall', 'wall-close', 'wall-dutch', 'wall-edge'), P('pillars', 'orbit', 'top', 'low'), P('canvas', 'high', 'chase', 'front'),
      P('phoenix', 'stage', 'soar', 'sonic', 'altar'),
      P('sunset', 'horizon', 'beam', 'drift', 'halo'),
      P('underwater', 'canyon', 'dive', 'orbit'),
      P('kaleido', 'petal', 'spiral'), P('poster', 'stack', 'slab', 'split'), P('halftone', 'in', 'fine'), P('flip', 'wave', 'burst'), P('particles', 'burst', 'vortex'), P('debug', 'orbit', 'low', 'top'), P('align', 'swing'),
      P('ripple', 'tilt', 'face', 'low'), P('orb', 'orbit', 'close'), P('channel', 'axis', 'roll', 'wall'),
      P('menger', 'glide', 'look'), P('sierpinski', 'glide', 'look'), P('cantor', 'glide', 'look'),
    ];
    // Drops (the climaxes) take turns opening on the push tunnel of the user's 《游戏是你的解药吗？》 and on the
    // spectrum tube, then go round the strongest plates: the sound made visible, the city, the shards bursting.
    case 'drop': return [
      P('phoenix', 'stage', 'soar', 'sonic', 'altar'),
      P('sunset', 'horizon', 'beam', 'drift', 'halo'),
      P('underwater', 'dive', 'canyon', 'orbit', 'abyss'),
      P('drive', 'push', 'roll'), P('channel', 'axis', 'roll', 'wall'),
      P('shatter', 'swarm-a', 'swarm-d', 'swarm-b', 'swarm-c'), P('ripple', 'tilt', 'low'), P('orb', 'close', 'orbit'), P('city', 'canyon', 'glide'),
      P('pillars', 'top', 'orbit'), P('particles', 'burst', 'vortex'), P('kaleido', 'spiral', 'petal'),
      P('menger', 'glide', 'look'), P('sierpinski', 'glide'),
    ];
    case 'break': return [P('aurora', 'wide', 'lake'), P('poster', 'slab', 'stack'), P('pillars', 'orbit', 'low'), P('clouds', 'over', 'skim'), P('ridges', 'front', 'low'), P('rings', 'front'), P('halftone', 'pan'), P('scope', 'wave', 'xy'), P('vinyl', 'groove', 'top'), P('ripple', 'face', 'tilt'), P('orb', 'wide', 'orbit'), P('cantor', 'glide', 'look'), P('velvet', 'skim', 'gallery')];
    case 'bridge': return [P('aurora', 'lake', 'wide'), P('poster', 'split', 'stack'), P('canvas', 'high', 'side'), P('pillars', 'orbit', 'top'), P('clouds', 'rise', 'skim'), P('ridges', 'drift', 'low'), P('kaleido', 'petal'), P('halftone', 'pan', 'out'), P('rings', 'tilt'), P('debug', 'top', 'orbit'), P('subdivide', 'ball'), P('ripple', 'face', 'tilt'), P('orb', 'wide'), P('cantor', 'glide'), P('menger', 'look'), P('velvet', 'lounge', 'platter')];
    default: return [
      P('relief', 'fly', 'crane', 'side', 'dive', 'low'), P('city', 'horizon', 'canyon', 'glide', 'high'), P('canvas', 'chase', 'high', 'side', 'front'), P('pillars', 'low', 'orbit'),
      P('underwater', 'canyon', 'orbit'),
      P('ridges', 'front', 'low', 'drift'), P('poster', 'stack', 'split', 'slab'),
      P('halftone', 'pan', 'in'), P('flip', 'wave'), P('rings', 'tilt', 'front'), P('particles', 'hold'), P('subdivide', 'ball'), P('align', 'swing'),
      P('vinyl', 'tilt', 'groove', 'top'), P('ripple', 'face', 'tilt', 'low'), P('orb', 'orbit', 'wide'), P('channel', 'axis', 'wall'),
      P('menger', 'glide', 'look'), P('cantor', 'glide'),
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
  pool: (s, song) => forSong(velvetPool(s), song, [P('velvet', 'lounge', 'skim', 'platter', 'gallery'), P('vinyl', 'tilt', 'groove')]),
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
      P('velvet', 'lounge', 'skim'), P('vinyl', 'tilt', 'top'), P('rain', 'pane', 'clear'),
      P('bokeh', 'haze'), P('city', 'horizon', 'high'), P('aurora', 'lake', 'wide'),
    ];
    case 'outro': return [
      P('velvet', 'skim', 'lounge'), P('sunset', 'drift', 'horizon'), P('vinyl', 'tilt', 'groove'),
      P('aurora', 'lake', 'wide'), P('rain', 'clear'),
    ];
    case 'build': case 'pre': return [
      P('velvet', 'skim', 'gallery'), P('city', 'glide', 'horizon'),
      P('rings', 'tilt', 'front'), P('pillars', 'low', 'orbit'),
    ];
    case 'chorus': return [
      P('velvet', 'lounge', 'platter', 'gallery', 'skim'), P('sunset', 'horizon', 'drift', 'halo'),
      P('city', 'glide', 'horizon', 'high'), P('vinyl', 'groove', 'tilt', 'top'),
      P('underwater', 'canyon', 'orbit'), P('pillars', 'orbit', 'low'),
      P('aurora', 'lake', 'wide'), P('bokeh', 'focus', 'orbit'), P('ripple', 'tilt', 'face'),
    ];
    case 'drop': return [
      P('velvet', 'lounge', 'skim', 'platter', 'gallery'), P('sunset', 'horizon', 'beam', 'drift'),
      P('underwater', 'canyon', 'orbit', 'dive'), P('city', 'glide', 'canyon', 'horizon'),
      P('vinyl', 'groove', 'tilt'), P('pillars', 'orbit', 'top'), P('ripple', 'tilt', 'low'),
    ];
    case 'break': case 'bridge': return [
      P('velvet', 'gallery', 'skim'), P('rain', 'pane', 'close', 'clear'), P('vinyl', 'groove', 'tilt'),
      P('bokeh', 'haze', 'rise'), P('clouds', 'skim', 'over'), P('aurora', 'lake'), P('underwater', 'abyss', 'orbit'),
    ];
    default: return [
      P('velvet', 'platter', 'lounge', 'skim', 'gallery'), P('vinyl', 'tilt', 'top', 'groove'),
      P('rain', 'pane', 'clear'), P('city', 'horizon', 'high', 'glide'),
      P('sunset', 'drift', 'horizon'), P('pillars', 'low', 'orbit'),
      P('bokeh', 'focus', 'rise'), P('aurora', 'lake', 'wide'), P('ripple', 'face', 'tilt'),
    ];
  }
}

export const BALLAD: Style = {
  id: 'ballad',
  name: '抒情',
  look: 'ballad',
  glyph: '○',
  pool: (s, song) => forSong(balladPool(s, song), song, [P('rings', 'front', 'tilt'), P('bokeh', 'rise')]),
  baseBars: s => (s.label === 'intro' || s.label === 'outro' ? 4 : 2),
  accelerate: false,
  transitions: { flash: false, glitch: false, dropPunch: false, dip: 0 },
  fx: { bloom: 0.5, grain: 0.055, vignette: 0.6 },
  finish: { contrast: 1.12, halation: 0.7, lens: 2, sharpen: 0.4, tone: 1.3, grain: 2, shutter: 1 / 40 },
};

// Paper-cut only suits flat graphic covers; photos and paintings get the slow ring tunnel instead.
function balladPool(s: Section, song: SongTraits): Plate[] {
  const quiet = song.graphic ? P('diorama', 'drift', 'push', 'truck', 'tilt') : P('tunnel', 'rush', 'wall', 'roll');
  switch (s.label) {
    case 'intro': return [P('bokeh', 'haze'), P('rain', 'pane', 'clear'), P('lanterns', 'wide'), P('aurora', 'wide', 'lake'), P('pillars', 'orbit', 'top'), P('clouds', 'over'), P('particles', 'hold'), P('scope', 'xy'), P('ripple', 'face')];
    case 'outro': return [song.graphic ? P('diorama', 'pullback') : P('tunnel', 'roll'), P('lanterns', 'rise', 'wide'), P('aurora', 'wide'), P('rain', 'clear')];
    // Choruses take turns opening under the aurora (looking up into it) and among the lanterns the words send up.
    case 'chorus': case 'drop': return [P('phoenix', 'stage', 'soar', 'sonic', 'altar'), P('sunset', 'horizon', 'beam', 'drift', 'halo'), P('underwater', 'canyon', 'orbit', 'dive'), P('aurora', 'up', 'wide'), P('lanterns', 'shore', 'rise', 'wide'), P('bokeh', 'focus', 'orbit', 'rise'), P('rain', 'pane', 'close'), P('pillars', 'orbit', 'top'), P('canvas', 'high', 'chase', 'side'), P('clouds', 'rise', 'over', 'skim'), P('city', 'horizon', 'high'), P('particles', 'rain', 'vortex'), P('kaleido', 'petal', 'spiral'), P('flip', 'wave'), P('poster', 'stack', 'split'), P('align', 'swing'), P('ripple', 'face', 'tilt'), P('orb', 'orbit', 'wide'), P('sierpinski', 'glide'), P('cantor', 'glide', 'look'), P('velvet', 'lounge', 'skim', 'platter')];
    case 'bridge': case 'break': return [P('city', 'high', 'horizon'), P('poster', 'split', 'stack'), P('rain', 'clear', 'pane'), P('lanterns', 'wide', 'rise'), P('canvas', 'high', 'side'), P('pillars', 'orbit', 'low'), P('clouds', 'over', 'rise'), P('aurora', 'lake'), P('bokeh', 'rise'), P('ridges', 'drift'), P('halftone', 'pan'), P('rings', 'front'), P('subdivide', 'ball'), P('orb', 'wide', 'orbit'), P('menger', 'glide'), P('velvet', 'gallery', 'skim')];
    // Verses take turns opening in the quiet plate and at the rainy window, where the lines are written in the fog.
    default: return [quiet, P('rain', 'pane', 'close', 'clear'), P('lanterns', 'shore', 'wide'), P('vinyl', 'top', 'tilt'), P('canvas', 'high', 'side', 'chase'), P('pillars', 'low', 'orbit'), P('aurora', 'lake', 'wide'), P('poster', 'stack', 'split', 'slab'), P('halftone', 'in', 'pan'), P('rings', 'tilt', 'front'), P('ridges', 'front', 'drift'), P('flip', 'wave'), P('subdivide', 'ball'), P('ripple', 'face', 'tilt'), P('velvet', 'lounge', 'platter')];
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
  pool: (s, song) => forSong(wordPool(s), song, [P('halftone', 'pan', 'in', 'out'), P('ridges', 'front', 'low')]),
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
    case 'intro': return [P('halftone', 'out', 'in'), P('neon', 'walk', 'up'), P('ridges', 'front', 'low'), P('city', 'high', 'horizon'), P('vinyl', 'top'), P('scope', 'wave')];
    case 'outro': return [P('halftone', 'out'), P('neon', 'up', 'walk'), P('ridges', 'drift'), P('city', 'horizon'), P('vinyl', 'top', 'tilt')];
    case 'build': case 'pre': return [P('typewall', 'solo'), P('tunnel', 'rush', 'roll')];
    case 'chorus': return [
      P('typewall', 'stack', 'split'), P('city', 'canyon', 'glide', 'horizon'), P('neon', 'walk', 'low', 'up'), P('pillars', 'orbit', 'top', 'low'), P('poster', 'slab', 'stack', 'split'), P('halftone', 'fine', 'in'), P('vinyl', 'groove', 'top', 'tilt'),
      P('shatter', 'wall', 'wall-close', 'wall-dutch'), P('flip', 'burst', 'wave'), P('debug', 'orbit', 'top'), P('align', 'swing'),
      P('ripple', 'tilt', 'face'), P('channel', 'axis', 'roll'),
    ];
    case 'drop': return [P('phoenix', 'stage', 'soar', 'sonic', 'altar'), P('sunset', 'horizon', 'beam', 'drift', 'halo'), P('drive', 'push', 'roll'), P('channel', 'axis', 'roll'), P('typewall', 'stack', 'solo'), P('halftone', 'fine'), P('shatter', 'swarm-a', 'swarm-b'), P('ripple', 'tilt', 'low')];
    case 'break': case 'bridge': return [P('halftone', 'pan', 'out'), P('neon', 'low', 'up'), P('ridges', 'front', 'drift'), P('poster', 'split', 'slab'), P('city', 'high', 'horizon'), P('vinyl', 'groove', 'top'), P('pillars', 'orbit'), P('scope', 'wave', 'xy')];
    // Verses take turns opening on the wall of words and walking down the street of neon signs.
    default: return [P('typewall', 'split', 'stack', 'solo'), P('neon', 'walk', 'low', 'up'), P('city', 'horizon', 'canyon', 'glide', 'high'), P('pillars', 'low', 'orbit'), P('canvas', 'chase', 'high', 'side'), P('vinyl', 'top', 'tilt', 'groove'), P('halftone', 'pan', 'in', 'fine'), P('poster', 'stack', 'slab', 'split'), P('subdivide', 'ball'), P('ripple', 'face', 'tilt')];
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
  pool: (s, song) => forSong(inkPool(s, song), song, [P('ink', 'scroll', 'mist'), P('bokeh', 'rise', 'haze')]),
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
    case 'intro': return [P('ink', 'bloom'), P('clouds', 'over'), P('ridges', 'front', 'drift'), P('bokeh', 'haze')];
    case 'outro': return [P('ink', 'mist', 'scroll'), P('ridges', 'drift', 'front'), P('clouds', 'over')];
    // Choruses take turns opening on the ink spreading and on climbing out of the clouds into the light.
    // (No particles: they are drawn on black, which tore the paper open in the middle of a song.)
    case 'chorus': case 'drop': return [P('ink', 'bloom', 'scroll'), P('clouds', 'rise', 'over', 'skim'), P('papercut', 'bloom', 'turn'), P('canvas', 'high', 'chase', 'side'), P('bokeh', 'focus', 'orbit')];
    case 'bridge': case 'break': return [P('clouds', 'skim', 'over'), P('ink', 'mist'), P('ridges', 'drift', 'low'), P('papercut', 'turn'), P('bokeh', 'rise')];
    default: return [
      P('ink', 'scroll', 'mist'), P('ridges', 'front', 'drift', 'low'), P('canvas', 'chase', 'side', 'high'), P('papercut', 'turn'),
      song.graphic ? P('diorama', 'drift', 'truck') : P('bokeh', 'rise', 'focus'),
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
