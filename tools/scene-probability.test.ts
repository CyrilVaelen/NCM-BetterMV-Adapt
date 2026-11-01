// 导演层场景加权概率调度与歌曲多维气质偏置测试：
// 验证用户选定（或自动匹配）母风格后，插件能根据歌曲子流派与声学特征动态调整各场景的首镜与轮换概率，
// 同时严格保持跨段首镜防撞车、段内相邻去重、标志性主场保底以及同随机种子 100% 确定性。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planShots } from '../src/director/director.ts';
import { Music } from '../src/director/music.ts';
import {
  analyzeSongVibe,
  BALLAD,
  chooseStyle,
  chooseStyleForVibePreset,
  INK,
  PULSE,
  sceneAffinity,
  VELVET,
  VIBE_PRESETS,
  WORD,
  type SongTraits,
} from '../src/style/style.ts';
import type { Analysis, Hit, Section } from '../src/types.ts';
import type { SceneId } from '../src/scenes/types.ts';

const NO_DECOR = new Set<string>(['cards', 'canvas', 'crystal']);

/** 构造具备典型段落结构与可调声学参数的测试曲目分析对象 */
function makeSongAnalysis(opts: {
  bpm: number;
  namedBpm?: number;
  hasDrops?: boolean;
  kickRate?: number;
  snareRate?: number;
  meanLow?: number;
  meanMid?: number;
  meanHigh?: number;
  meanOnset?: number;
  leadLevel?: number;
}): Analysis {
  const {
    bpm,
    namedBpm,
    hasDrops = true,
    kickRate = 1.6,
    snareRate = 0.8,
    meanLow = 0.55,
    meanMid = 0.45,
    meanHigh = 0.35,
    meanOnset = 0.28,
    leadLevel = 0.3,
  } = opts;

  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const sections: Section[] = [
    { start: 0, end: 4 * barSec, label: 'intro', energy: 0.35, group: 0, vocal: false },
    { start: 4 * barSec, end: 12 * barSec, label: 'verse', energy: 0.52, group: 1, vocal: true },
    { start: 12 * barSec, end: 20 * barSec, label: 'chorus', energy: 0.82, group: 2, vocal: true },
    { start: 20 * barSec, end: 24 * barSec, label: 'build', energy: 0.68, group: 3, vocal: false },
    { start: 24 * barSec, end: 32 * barSec, label: hasDrops ? 'drop' : 'chorus', energy: 0.96, group: 4, vocal: !hasDrops },
    { start: 32 * barSec, end: 40 * barSec, label: 'verse', energy: 0.55, group: 1, vocal: true },
    { start: 40 * barSec, end: 44 * barSec, label: 'build', energy: 0.70, group: 3, vocal: false },
    { start: 44 * barSec, end: 52 * barSec, label: hasDrops ? 'drop' : 'chorus', energy: 0.98, group: 4, vocal: !hasDrops },
    { start: 52 * barSec, end: 58 * barSec, label: 'outro', energy: 0.32, group: 5, vocal: false },
  ];
  const duration = sections[sections.length - 1].end;
  const beats: number[] = [];
  for (let t = 0; t < duration - 0.02; t += beatSec) beats.push(+t.toFixed(4));
  const beatInBar = beats.map((_, i) => i % 4);
  const downbeats = beats.filter((_, i) => i % 4 === 0);

  const kicks: Hit[] = [];
  const snares: Hit[] = [];
  if (kickRate > 0) {
    const step = 1 / kickRate;
    for (let t = 0.2; t < duration - 0.2; t += step) kicks.push([+t.toFixed(3), 0.78]);
  }
  if (snareRate > 0) {
    const step = 1 / snareRate;
    for (let t = 0.5; t < duration - 0.2; t += step) snares.push([+t.toFixed(3), 0.72]);
  }

  const fps = 50;
  const frames = Math.ceil(duration * fps);
  const rms = new Float32Array(frames).fill(0.62);
  const low = new Float32Array(frames).fill(meanLow);
  const mid = new Float32Array(frames).fill(meanMid);
  const high = new Float32Array(frames).fill(meanHigh);
  const onset = new Float32Array(frames).fill(meanOnset);
  const lead = new Float32Array(frames).fill(leadLevel);

  return {
    version: 9,
    duration,
    bpm,
    namedBpm,
    meter: 4,
    beats,
    beatInBar,
    tempo: beats.map(() => bpm),
    downbeats,
    sections,
    env: { fps, rms, low, mid, high, onset, lead },
    hits: { kick: kicks, snare: snares, hat: [], accent: [] },
  };
}

test('多维音乐气质画像（SongVibe）：准确识别旋律史诗、硬核疾速、国风跨界、摇滚构成与原声治愈', () => {
  // 1. 硬核音游 / Neurofunk（半速网格 87 BPM、通行 174 BPM，高密度冲击）
  const hardA = makeSongAnalysis({ bpm: 87, namedBpm: 174, kickRate: 2.6, snareRate: 1.6, meanHigh: 0.66, meanOnset: 0.55 });
  const hardVibe = analyzeSongVibe(hardA, { graphic: false, lyrics: false, wiki: { genres: ['电子-鼓打贝斯'], tags: ['激昂'] } });
  assert.ok(hardVibe.hardCyber > 0.75, `预期高 hardCyber，实际 ${hardVibe.hardCyber}`);
  assert.ok(hardVibe.hardCyber > hardVibe.melodicEpic);

  // 2. 恢弘旋律贝斯 / Future Bass
  const melodicA = makeSongAnalysis({ bpm: 140, kickRate: 1.2, snareRate: 0.6, meanMid: 0.58, meanHigh: 0.34, leadLevel: 0.68 });
  const melodicVibe = analyzeSongVibe(melodicA, { graphic: false, lyrics: true, wiki: { genres: ['电子-未来贝斯'], tags: ['大气', '梦幻'] } });
  assert.ok(melodicVibe.melodicEpic > 0.75, `预期高 melodicEpic，实际 ${melodicVibe.melodicEpic}`);
  assert.ok(melodicVibe.melodicEpic > melodicVibe.hardCyber);

  // 3. 国风电音跨界（同时具备东方意韵与旋律史诗）
  const orientalEdmVibe = analyzeSongVibe(melodicA, { graphic: false, lyrics: true, wiki: { genres: ['电子-未来贝斯', '国风'], tags: ['古风', '壮阔'] } });
  assert.ok(orientalEdmVibe.oriental > 0.75 && orientalEdmVibe.melodicEpic > 0.7);

  // 4. 独立摇滚（无电子标签时也能联合标签与真鼓声学特征提振 indieRock）
  const rockA = makeSongAnalysis({ bpm: 126, hasDrops: false, kickRate: 1.1, snareRate: 0.9, meanMid: 0.52, meanHigh: 0.42 });
  const rockVibe = analyzeSongVibe(rockA, { graphic: false, lyrics: true, wiki: { genres: ['摇滚-独立摇滚'], tags: [] } });
  assert.ok(rockVibe.indieRock > 0.75);

  // 5. 纯声学无标签慢速原声民谣（如本地导入无百科歌曲）
  const folkA = makeSongAnalysis({ bpm: 78, hasDrops: false, kickRate: 0.3, snareRate: 0.15, meanMid: 0.42, meanHigh: 0.18 });
  const folkVibe = analyzeSongVibe(folkA, { graphic: true, lyrics: true });
  assert.ok(folkVibe.acousticWarm > 0.5, `无标签慢歌应自动推断出较高原声温暖度，实际 ${folkVibe.acousticWarm}`);
});

test('同在「律动 (PULSE)」风格下，不同子流派的 Drop 首镜与段内场景概率发生显著定向偏移，且解锁推进隧道首镜', () => {
  const hardMusic = new Music(makeSongAnalysis({ bpm: 87, namedBpm: 174, kickRate: 2.7, snareRate: 1.5, meanHigh: 0.65, meanOnset: 0.55 }));
  const hardTraits: SongTraits = { graphic: false, lyrics: false, wiki: { genres: ['Drum & Bass', 'Hardcore'], tags: ['狂欢', '疾速'] } };

  const melodicMusic = new Music(makeSongAnalysis({ bpm: 140, kickRate: 1.1, snareRate: 0.5, meanMid: 0.6, meanHigh: 0.32, leadLevel: 0.72 }));
  const melodicTraits: SongTraits = { graphic: false, lyrics: true, wiki: { genres: ['Melodic Dubstep', 'Future Bass'], tags: ['史诗', '梦幻'] } };

  const countDropHeroes = (music: Music, traits: SongTraits, runs = 240) => {
    const counts = new Map<SceneId, number>();
    for (let seed = 1; seed <= runs; seed++) {
      const shots = planShots(music, PULSE, seed * 977, traits, NO_DECOR);
      const dropShots = shots.filter(s => s.section.label === 'drop');
      assert.equal(dropShots.length, 2, '测试曲包含两段独立 Drop');
      // 同一首歌的两段独立 Drop 绝不使用同一个首镜场景
      assert.notEqual(dropShots[0].scene, dropShots[1].scene, `seed=${seed} 的两段 Drop 首镜不应重复`);
      for (const ds of dropShots) counts.set(ds.scene, (counts.get(ds.scene) ?? 0) + 1);
    }
    return counts;
  };

  const hardCounts = countDropHeroes(hardMusic, hardTraits);
  const melodicCounts = countDropHeroes(melodicMusic, melodicTraits);
  const get = (m: Map<SceneId, number>, k: SceneId) => m.get(k) ?? 0;

  // 1. 推进隧道 (drive) 与声道 (channel) 重新解锁 Drop 首镜登场能力（过去被锁死为 0）
  assert.ok(get(hardCounts, 'drive') > 60, `硬核曲目中 drive 应高频担任 Drop 首镜，实际 ${get(hardCounts, 'drive')}/480`);
  assert.ok(get(hardCounts, 'channel') > 40, `硬核曲目中 channel 应高频担任 Drop 首镜，实际 ${get(hardCounts, 'channel')}/480`);

  // 2. 硬核曲目抽中硬核穿梭首镜（drive + channel + shatter）的概率显著高于旋律曲目
  const hardCyberShare = get(hardCounts, 'drive') + get(hardCounts, 'channel') + get(hardCounts, 'shatter');
  const melodicCyberShare = get(melodicCounts, 'drive') + get(melodicCounts, 'channel') + get(melodicCounts, 'shatter');
  assert.ok(hardCyberShare > melodicCyberShare * 1.45, `硬核曲目硬核首镜数 (${hardCyberShare}) 应显著高于旋律曲 (${melodicCyberShare})`);

  // 3. 旋律史诗曲目抽中奇观世界首镜（phoenix + sunset + underwater）的概率显著高于硬核曲目
  const melodicWorldShare = get(melodicCounts, 'phoenix') + get(melodicCounts, 'sunset') + get(melodicCounts, 'underwater');
  const hardWorldShare = get(hardCounts, 'phoenix') + get(hardCounts, 'sunset') + get(hardCounts, 'underwater');
  assert.ok(melodicWorldShare > hardWorldShare * 1.45, `旋律曲目世界首镜数 (${melodicWorldShare}) 应显著高于硬核曲 (${hardWorldShare})`);
});

test('用户自选风格时：摇滚曲目在律动风格下显著提升平面与山脊肌理，慢歌在抒情风格下优先意境世界', () => {
  const rockMusic = new Music(makeSongAnalysis({ bpm: 128, hasDrops: false, kickRate: 1.2, snareRate: 0.9, meanMid: 0.55, meanHigh: 0.42 }));
  const rockTraits: SongTraits = { graphic: false, lyrics: true, wiki: { genres: ['摇滚-后朋克', 'Indie Rock'], tags: [] } };
  const dreamTraits: SongTraits = { graphic: false, lyrics: true, wiki: { genres: ['Future Bass'], tags: ['梦幻', '空灵'] } };

  const rockTextureSet = new Set<SceneId>(['ridges', 'halftone', 'poster', 'shatter', 'vinyl']);
  let rockHits = 0, dreamHits = 0;
  for (let seed = 1; seed <= 160; seed++) {
    const rShots = planShots(rockMusic, PULSE, seed * 131, rockTraits, NO_DECOR);
    const dShots = planShots(rockMusic, PULSE, seed * 131, dreamTraits, NO_DECOR);
    rockHits += rShots.filter(s => rockTextureSet.has(s.scene)).length;
    dreamHits += dShots.filter(s => rockTextureSet.has(s.scene)).length;
  }
  assert.ok(rockHits > dreamHits * 1.5, `摇滚曲目在律动风格下的山脊/网点/海报/黑胶总频次 (${rockHits}) 应显著高于梦幻电音 (${dreamHits})`);

  // 抒情风格副歌：极光/灯海/晚霞/云海/雨窗/光斑的出现频次远高于分形与翻牌点缀
  const balladMusic = new Music(makeSongAnalysis({ bpm: 76, hasDrops: false, kickRate: 0.35, snareRate: 0.2, meanMid: 0.45, meanHigh: 0.2 }));
  const balladTraits: SongTraits = { graphic: false, lyrics: true, wiki: { genres: ['民谣'], tags: ['治愈', '温暖'] } };
  const poeticWorlds = new Set<SceneId>(['aurora', 'lanterns', 'sunset', 'clouds', 'rain', 'bokeh']);
  const rareAccents = new Set<SceneId>(['sierpinski', 'cantor', 'flip', 'orb']);
  let poeticCount = 0, accentCount = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const bShots = planShots(balladMusic, BALLAD, seed * 313, balladTraits, NO_DECOR).filter(s => s.section.label === 'chorus');
    poeticCount += bShots.filter(s => poeticWorlds.has(s.scene)).length;
    accentCount += bShots.filter(s => rareAccents.has(s.scene)).length;
  }
  assert.ok(poeticCount > accentCount * 6, `抒情副歌意境世界镜头 (${poeticCount}) 应远超低频几何点缀 (${accentCount})`);
});

test('标志性灵魂场景保底、相邻去重与确定性契约：微醺必含 velvet，墨必含 ink，同种子复算完全一致', () => {
  const music = new Music(makeSongAnalysis({ bpm: 118, hasDrops: true }));
  const traits: SongTraits = { graphic: false, lyrics: true };

  for (let seed = 1; seed <= 80; seed++) {
    const vShots = planShots(music, VELVET, seed, traits, NO_DECOR);
    assert.ok(vShots.some(s => s.scene === 'velvet'), `微醺风格 seed=${seed} 必须包含暗涌水廊 (velvet)`);
    assert.deepEqual(planShots(music, VELVET, seed, traits, NO_DECOR), vShots, '同种子重算必须 100% 确定一致');

    const iShots = planShots(music, INK, seed, traits, NO_DECOR);
    assert.ok(iShots.some(s => s.scene === 'ink'), `墨风格 seed=${seed} 必须包含宣纸水墨 (ink)`);

    // 检查段内非短切相邻镜头不重复同一场景
    for (let k = 1; k < vShots.length; k++) {
      if (vShots[k].section === vShots[k - 1].section && !vShots[k].run) {
        assert.notEqual(vShots[k].scene, vShots[k - 1].scene, `段内相邻常规镜头不应重复同一场景 (seed=${seed})`);
      }
    }
  }

  // 验证 sceneAffinity 数值始终有限且处于合理正区间
  const vibe = analyzeSongVibe(music.a, traits);
  assert.ok(sceneAffinity('phoenix', music.a.sections[4], PULSE, vibe, traits) > 0.2);
});

test('右侧设置面板手动选择「音乐风格」预设（vibePreset）：同一首歌切换不同预设可显著改变各场景出现概率，并联动自动母风格', () => {
  // 模拟同一首 122 BPM 歌曲（如 Sultan + Shepard - Raye），甚至带有干扰标签
  const music = new Music(makeSongAnalysis({ bpm: 122, hasDrops: true, kickRate: 1.8, snareRate: 0.9, meanHigh: 0.45 }));
  const baseWiki = { genres: ['电子'], tags: [] };

  // 1. 验证预设列表包含 8 个完整选项（适配 4×2 网格）
  assert.equal(VIBE_PRESETS.length, 8);

  // 2. 当母风格锁定为「律动 (PULSE)」时，切换手动音乐风格预设，场景出现概率显著定向迁移
  const countScenes = (vibePreset: SongTraits['vibePreset'], targetScenes: ReadonlySet<SceneId>) => {
    let hits = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const shots = planShots(music, PULSE, seed * 257, { graphic: false, lyrics: true, wiki: baseWiki, vibePreset }, NO_DECOR);
      hits += shots.filter(s => targetScenes.has(s.scene)).length;
    }
    return hits;
  };

  const cyberSet = new Set<SceneId>(['drive', 'channel', 'menger', 'sierpinski', 'orb', 'shatter', 'debug']);
  const urbanSet = new Set<SceneId>(['velvet', 'city', 'vinyl', 'neon', 'rain', 'bokeh']);
  const orientalSet = new Set<SceneId>(['ink', 'papercut', 'lanterns', 'phoenix', 'clouds']);
  const rapSet = new Set<SceneId>(['typewall', 'neon', 'poster', 'halftone']);

  assert.ok(countScenes('cyber', cyberSet) > countScenes('urban', cyberSet) * 1.8, '手动选硬核电音应大幅提升赛博/隧道/分形场景概率');
  assert.ok(countScenes('urban', urbanSet) > countScenes('cyber', urbanSet) * 1.8, '手动选浩室微醺即使在律动下也应大幅提升水廊/夜城/黑胶/霓虹概率');
  assert.ok(countScenes('oriental', orientalSet) > countScenes('cyber', orientalSet) * 2.0, '手动选国风古韵应大幅提升水墨/窗花/灯海/火凤概率');
  assert.ok(countScenes('rap', rapSet) > countScenes('melodic', rapSet) * 1.8, '手动选说唱街头应大幅提升字墙/霓虹/海报/网点概率');

  // 3. 当上方母风格设为「自动」时，手动选择音乐风格预设同步匹配最契合的默认母风格
  const autoBase = chooseStyle(music.a, baseWiki, true);
  assert.equal(chooseStyleForVibePreset('urban', true, autoBase).style, VELVET);
  assert.equal(chooseStyleForVibePreset('oriental', true, autoBase).style, INK);
  assert.equal(chooseStyleForVibePreset('acoustic', true, autoBase).style, BALLAD);
  assert.equal(chooseStyleForVibePreset('rap', true, autoBase).style, WORD);
  assert.equal(chooseStyleForVibePreset('rap', false, autoBase).style, PULSE, '关闭歌词或纯音乐时说唱预设自动退回律动母风格');
  assert.equal(chooseStyleForVibePreset('melodic', true, autoBase).style, PULSE);
});
