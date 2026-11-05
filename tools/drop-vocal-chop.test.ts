import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNeteaseLyric } from '../src/lyrics/parse.ts';
import { findSections, makeBars, sungLines, type SectionInput } from '../src/analysis/sections.ts';
import { N_MFCC, type BeatFeatures } from '../src/analysis/features.ts';
import type { Hit, LyricLine } from '../src/types.ts';

/** 构造用于结构分段回归测试的合成节拍特征与包络输入（无外部音频依赖）。 */
function buildSyntheticSong(lyrics: LyricLine[], chorus?: [number, number]): SectionInput {
  // 85.7 BPM 半拍感（每拍 0.7s，每小节 4 拍 = 2.8s），共 80 小节 = 224s
  const nb = 80;
  const beatsPerBar = 4;
  const beatDur = 0.7;
  const nBeats = nb * beatsPerBar;
  const beats = Array.from({ length: nBeats }, (_, i) => i * beatDur);
  const beatInBar = beats.map((_, i) => i % beatsPerBar);
  const duration = nBeats * beatDur;
  const bars = makeBars(beats, beatInBar, duration);
  const fps = 100;
  const totalFrames = Math.ceil(duration * fps);
  const rms = new Float32Array(totalFrames);
  const low = new Float32Array(totalFrames);
  const high = new Float32Array(totalFrames);

  const chroma = new Float32Array(nBeats * 12);
  const bass = new Float32Array(nBeats * 12);
  const mfcc = new Float32Array(nBeats * N_MFCC);
  const db = new Float32Array(nBeats);
  const bright = new Float32Array(nBeats);
  const kick = new Float32Array(nBeats);
  const snare = new Float32Array(nBeats);
  const hat = new Float32Array(nBeats);
  const flux = new Float32Array(nBeats);
  const density = new Float32Array(nBeats);
  const kicks: Hit[] = [];
  const snares: Hit[] = [];

  // 曲式布局（小节索引）：
  // 0..4: intro (0..11.2s)
  // 4..16: verse 1 (11.2..44.8s)
  // 16..28: pre/chorus build (44.8..78.4s, 第27小节做 drop 前静默跌落)
  // 28..36: drop 1 (78.4..100.8s, 约 1:18..1:41)
  // 36..52: verse 2 (100.8..145.6s)
  // 52..65: chorus / build 2 (145.6..182.0s)
  // 65..73: drop 2 (182.0..204.4s, 约 3:02..3:24)
  // 73..80: outro (204.4..224.0s)
  for (let bar = 0; bar < nb; bar++) {
    const isIntro = bar < 4;
    const isDrop = (bar >= 28 && bar < 36) || (bar >= 65 && bar < 73);
    const isPreDip = bar === 27 || bar === 64;
    const isChorus = (bar >= 16 && bar < 27) || (bar >= 52 && bar < 64);
    const isOutro = bar >= 73;

    const barRms = isDrop ? 0.92 : isPreDip ? 0.14 : isChorus ? 0.48 : isIntro || isOutro ? 0.16 : 0.36;
    const barLow = isDrop ? 0.9 : isPreDip ? 0.002 : isChorus ? 0.06 : isIntro || isOutro ? 0.01 : 0.08;
    const barHigh = isDrop ? 0.45 : isChorus ? 0.12 : 0.05;
    const barDb = isDrop ? -1 : isPreDip ? -18 : isChorus ? -7 : isIntro || isOutro ? -16 : -10;

    const f0 = Math.floor(bar * beatsPerBar * beatDur * fps);
    const f1 = Math.min(totalFrames, Math.floor((bar + 1) * beatsPerBar * beatDur * fps));
    for (let f = f0; f < f1; f++) {
      rms[f] = barRms;
      // 模拟半拍感重低音颗粒切分（articulated bass）
      low[f] = isDrop ? ((f - f0) % 70 < 40 ? barLow : 0.02) : barLow;
      high[f] = barHigh;
    }

    for (let b = 0; b < beatsPerBar; b++) {
      const bi = bar * beatsPerBar + b;
      const t = beats[bi];
      const root = isDrop ? 0 : isChorus ? 5 : isOutro ? 9 : 2;
      chroma[bi * 12 + root] = 1;
      bass[bi * 12 + root] = 1;
      mfcc[bi * N_MFCC] = barDb;
      mfcc[bi * N_MFCC + 1] = isDrop ? 12 : isChorus ? 2 : -4;
      db[bi] = barDb;
      bright[bi] = isDrop ? -4 : -10;
      density[bi] = isDrop ? 3.2 : isChorus ? 1.5 : 0.9;
      flux[bi] = density[bi];
      if (isDrop) {
        if (b === 0 || b === 1 || b === 3) {
          kick[bi] = 0.9;
          kicks.push([t, 0.9]);
        }
        if (b === 2) {
          snare[bi] = 0.95;
          snares.push([t, 0.95]);
        }
        hat[bi] = 0.6;
      } else if (!isIntro && !isOutro && !isPreDip) {
        if (b === 0) {
          kick[bi] = 0.45;
          kicks.push([t, 0.45]);
        }
        if (b === 2) {
          snare[bi] = 0.4;
          snares.push([t, 0.4]);
        }
      }
    }
  }

  const features: BeatFeatures = { n: nBeats, chroma, bass, mfcc, db, bright, kick, snare, hat, flux, density };
  return { features, beats, bars, duration, rms, fps, lyrics, hits: { kick: kicks, snare: snares }, chorus, low, high };
}

test('YRC 独立标点时间槽不拉长前词结束时间，且忽略行尾 BOM 空白词块', () => {
  const yrc = [
    '[72760,24030](72760,180,0)Take (72940,2640,0)you (75580,3150,0)down(78730,0,0), (78730,6090,0)take (84820,330,0)you (85150,330,0)down(85480,8160,0), (93640,2490,0)take (96130,330,0)you (96460,330,0)down',
    '[125470,60150](125470,500,0)far (125970,600,0)away (126570,500,0)from (127070,56060,0)me(183130,2490,0)\uFEFF',
  ].join('\n');

  const lines = parseNeteaseLyric({ yrc: { lyric: yrc } }, 220);
  assert.equal(lines.length, 2);

  // 第二个 "down," 后接 8.16s 的 ", " 标点槽，其发音结束时间必须停留在 85.48s 而非 93.64s
  const secondDown = lines[0].words[5];
  assert.equal(secondDown.text, 'down,');
  assert.ok(Math.abs(secondDown.end - 85.48) < 1e-6);

  // BOM 词块被过滤，不生成空尾词
  assert.equal(lines[1].words.length, 4);
  assert.equal(lines[1].words[3].text, 'me');
});

test('sungLines 拆分跨间奏重复人声切片行，同时保留慢唱异文分句不拆分', () => {
  const doc = {
    yrc: {
      lyric: [
        '[72760,24030](72760,180,0)Take (72940,2640,0)you (75580,3150,0)down(78730,0,0), (78730,6090,0)take (84820,330,0)you (85150,330,0)down(85480,8160,0), (93640,2490,0)take (96130,330,0)you (96460,330,0)down',
        '[302560,4860](302560,420,0)Since (302980,210,0)I (303190,660,0)pushed (303850,420,0)it (304270,480,0)all(304750,1960,0), (306710,240,0)far (306950,240,0)away (307190,230,0)from (307420,300,0)me',
      ].join('\n'),
    },
  };
  const parsed = parseNeteaseLyric(doc, 320);
  const sung = sungLines(parsed);

  // 第一行含 3 次重复的 "Take you down"，应拆分为 3 条独立短句，且子句首词前导长静音已被剥离
  const chops = sung.filter(l => l.text.toLowerCase().includes('take you down'));
  assert.equal(chops.length, 3);
  assert.ok(chops[1].start >= 84.0, `第二处切片起唱时间应剥离静音（实际 ${chops[1].start}）`);
  assert.ok(chops[2].start >= 95.3, `第三处切片起唱时间应剥离静音（实际 ${chops[2].start}）`);

  // 第二行为前后异文的慢唱完整句（间隔约 1.96s），保持整句不拆分以维持副歌复唱统计
  const slow = sung.filter(l => l.text.toLowerCase().includes('pushed it all'));
  assert.equal(slow.length, 1);
  assert.ok(slow[0].text.toLowerCase().includes('far away from me'));
});

test('跨器乐间奏合并的 YRC 切片与孤立复唱钩子不会掩盖双 Drop 识别，同时连贯副歌仍保持 chorus', () => {
  const yrcLines = [
    // Verse 1 (12..42s): 不重复主歌行
    '[12000,4000](12000,800,0)ash (12800,800,0)in (13600,1000,0)the (14600,1400,0)morning',
    '[18000,4000](18000,800,0)cold (18800,800,0)on (19600,1000,0)the (20600,1400,0)floor',
    '[24000,4000](24000,800,0)shadows (24800,800,0)are (25600,1000,0)falling',
    '[30000,4000](30000,800,0)behind (30800,800,0)every (31600,1400,0)door',
    // Pre / Chorus 1 (45..78s) + 跨入 Drop 1 (78.4..100.8s) 的合并 YRC 切片行
    '[46000,4500](46000,1000,0)I (47000,1000,0)do (48000,1000,0)not (49000,1500,0)wanna (50500,1200,0)pull (51700,1200,0)you (52900,1400,0)under',
    '[56000,4500](56000,1200,0)stay (57200,1200,0)away (58400,1000,0)from (59400,1500,0)the (60900,1600,0)flame',
    '[65000,5000](65000,1000,0)I (66000,1000,0)do (67000,1000,0)not (68000,1500,0)wanna (69500,1200,0)pull (70700,1200,0)you (71900,1400,0)under',
    '[73500,23300](73500,300,0)pull (73800,2000,0)you (75800,2200,0)under(78000,0,0), (78000,6400,0)pull (84400,350,0)you (84750,350,0)under(85100,8200,0), (93300,2500,0)pull (95800,350,0)you (96150,350,0)under',
    // Verse 2 (104..140s)
    '[105000,4000](105000,800,0)glass (105800,800,0)on (106600,1000,0)the (107600,1400,0)table',
    '[112000,4000](112000,800,0)smoke (112800,800,0)in (113600,1000,0)the (114600,1400,0)air',
    '[120000,4000](120000,800,0)words (120800,800,0)left (121600,1000,0)unspoken',
    '[128000,4000](128000,800,0)heavy (128800,800,0)to (129600,1400,0)bear',
    // Chorus 2 (146..181s)
    '[147000,6000](147000,1000,0)I (148000,1000,0)do (149000,1000,0)not (150000,1000,0)wanna (151000,1000,0)pull (152000,1000,0)you (153000,1200,0)under',
    '[156000,6000](156000,1200,0)stay (157200,1200,0)away (158400,1000,0)from (159400,1200,0)the (160600,1400,0)flame',
    '[165000,5000](165000,900,0)pull (165900,1200,0)you (167100,1400,0)under',
    '[174500,5000](174500,700,0)I (175200,700,0)do (175900,700,0)not (176600,700,0)wanna (177300,700,0)pull (178000,700,0)you (178700,800,0)under',
    // Drop 2 (182.0..204.4s) 中央孤立复唱钩子（两侧各有 > 5s 器乐间奏）+ 尾部收束短句
    '[187000,4800](187000,650,0)I (187650,650,0)do (188300,650,0)not (188950,650,0)wanna (189600,700,0)pull (190300,700,0)you (191000,800,0)under',
    '[200500,3500](200500,800,0)pull (201300,1200,0)you (202500,1500,0)under',
  ].join('\n');

  const lyrics = parseNeteaseLyric({ yrc: { lyric: yrcLines } }, 224);
  const secs = findSections(buildSyntheticSong(lyrics, [146, 190]));
  const labelAt = (t: number) => {
    const hit = secs.find(s => t >= s.start && t < s.end);
    return hit ? hit.label : '';
  };

  assert.equal(labelAt(88), 'drop', '1:28 (Drop 1) 应识别为 drop');
  assert.equal(labelAt(192), 'drop', '3:12 (Drop 2) 应识别为 drop');

  // 对照验证：若 182..204s 全程连贯密集演唱副歌且无鼓组低频颗粒切分，则仍应识别为 chorus
  const denseChorusYrc = [
    ...yrcLines.split('\n').slice(0, -2),
    '[182500,5000](182500,700,0)I (183200,700,0)do (183900,700,0)not (184600,700,0)wanna (185300,700,0)pull (186000,700,0)you (186700,800,0)under',
    '[188000,5000](188000,1000,0)stay (189000,1000,0)away (190000,1000,0)from (191000,1000,0)the (192000,1000,0)flame',
    '[193500,5000](193500,700,0)I (194200,700,0)do (194900,700,0)not (195600,700,0)wanna (196300,700,0)pull (197000,700,0)you (197700,800,0)under',
    '[199000,5000](199000,1000,0)stay (200000,1000,0)away (201000,1000,0)from (202000,1000,0)the (203000,1000,0)flame',
  ].join('\n');
  const denseInp = buildSyntheticSong(parseNeteaseLyric({ yrc: { lyric: denseChorusYrc } }, 224));
  // 令低频持续平直（非电子切分 release）且鼓点普通，模拟真实流行连贯高能副歌
  if (denseInp.low) denseInp.low.fill(0.15);
  denseInp.hits = { kick: [], snare: [] };
  const denseSecs = findSections(denseInp);
  const denseAt192 = denseSecs.find(s => 192 >= s.start && 192 < s.end);
  assert.equal(denseAt192?.label, 'chorus', '密集连贯演唱的副歌应保持为 chorus');
});

test('半拍 Drop 后半程叠加连贯副歌人声且全频段伴奏未衰减时保持 drop，伴奏撤出时归为 chorus', () => {
  // 构造双 Drop 合成曲目（80 小节 × 2.8s = 224s）：
  // Drop 1 为 [28..36) 纯器乐 + [36..44) 密集主唱叠加的 Vocal Drop 下半程；Drop 2 为 [65..73) 纯器乐，用于同时覆盖 contrastForm 的 nextRelease 路径
  const nb = 80, beatsPerBar = 4, beatDur = 0.7, nBeats = nb * beatsPerBar, duration = nBeats * beatDur, fps = 100;
  const beats = Array.from({ length: nBeats }, (_, i) => i * beatDur);
  const beatInBar = beats.map((_, i) => i % beatsPerBar);
  const bars = makeBars(beats, beatInBar, duration);
  const totalFrames = Math.ceil(duration * fps);

  const makeCase = (keepFullBandOnVocalHalf: boolean): SectionInput => {
    const rms = new Float32Array(totalFrames);
    const low = new Float32Array(totalFrames);
    const high = new Float32Array(totalFrames);
    const chroma = new Float32Array(nBeats * 12);
    const bass = new Float32Array(nBeats * 12);
    const mfcc = new Float32Array(nBeats * N_MFCC);
    const db = new Float32Array(nBeats);
    const bright = new Float32Array(nBeats);
    const kick = new Float32Array(nBeats);
    const snare = new Float32Array(nBeats);
    const hat = new Float32Array(nBeats);
    const flux = new Float32Array(nBeats);
    const density = new Float32Array(nBeats);
    const kicks: Hit[] = [];
    const snares: Hit[] = [];

    for (let bar = 0; bar < nb; bar++) {
      const isIntro = bar < 4;
      const isOutro = bar >= 73;
      const isInstDrop = (bar >= 28 && bar < 36) || (bar >= 65 && bar < 73);
      const isVocalHalf = bar >= 36 && bar < 44;
      const isActiveDrop = isInstDrop || (isVocalHalf && keepFullBandOnVocalHalf);
      const isChorus = (bar >= 16 && bar < 27) || (bar >= 52 && bar < 64) || (isVocalHalf && !keepFullBandOnVocalHalf);
      const isPreDip = bar === 27 || bar === 64;

      const barRms = isActiveDrop ? 0.92 : isPreDip ? 0.14 : isChorus ? 0.56 : isIntro || isOutro ? 0.14 : 0.36;
      const barLow = isActiveDrop ? 0.88 : isPreDip ? 0.002 : isChorus ? 0.05 : isIntro || isOutro ? 0.01 : 0.07;
      const barHigh = isActiveDrop ? 0.44 : isChorus ? 0.11 : 0.05;
      const barDb = isActiveDrop ? -1 : isPreDip ? -18 : isChorus ? -7 : isIntro || isOutro ? -16 : -10;

      const f0 = Math.floor(bar * beatsPerBar * beatDur * fps);
      const f1 = Math.min(totalFrames, Math.floor((bar + 1) * beatsPerBar * beatDur * fps));
      for (let f = f0; f < f1; f++) {
        rms[f] = barRms;
        low[f] = isActiveDrop ? ((f - f0) % 70 < 40 ? barLow : 0.02) : barLow;
        high[f] = barHigh;
      }

      for (let b = 0; b < beatsPerBar; b++) {
        const bi = bar * beatsPerBar + b;
        const t = beats[bi];
        const root = isActiveDrop ? 0 : isChorus ? 5 : isOutro ? 9 : 2;
        chroma[bi * 12 + root] = 1;
        bass[bi * 12 + root] = 1;
        mfcc[bi * N_MFCC] = barDb;
        mfcc[bi * N_MFCC + 1] = isActiveDrop ? 12 : isChorus ? 2 : -4;
        db[bi] = barDb;
        bright[bi] = isActiveDrop ? -4 : -10;
        density[bi] = isActiveDrop ? 3.0 : isChorus ? 1.5 : 0.9;
        flux[bi] = density[bi];
        if (isInstDrop) {
          // 半拍器乐 Drop：每小节 2 kicks + 1 snare -> perc = 2.5 / 2.8 ≈ 0.89..1.07
          if (b === 0 || b === 1) { kick[bi] = 0.85; kicks.push([t, 0.85]); }
          if (b === 2) { snare[bi] = 0.9; snares.push([t, 0.9]); }
          hat[bi] = 0.6;
        } else if (isVocalHalf && keepFullBandOnVocalHalf) {
          // 半拍 Vocal Drop（人声掩蔽）：每小节 1 kick + 2 snares -> perc = 2.0 / 2.8 ≈ 0.71 (< 0.9)
          if (b === 0) { kick[bi] = 0.82; kicks.push([t, 0.82]); }
          if (b === 2 || b === 3) { snare[bi] = 0.85; snares.push([t, 0.85]); }
          hat[bi] = 0.58;
        } else if (!isIntro && !isOutro && !isPreDip && !isVocalHalf) {
          if (b === 0) { kick[bi] = 0.4; kicks.push([t, 0.4]); }
        }
      }
    }

    const lrc = [
      '[00:12.00]Walking in the quiet shadow',
      '[00:18.00]Waiting for a distant spark',
      '[00:24.00]Tracing lines across the window',
      '[00:30.00]Fading out into the dark',
      '[00:46.00]Let me be forgotten',
      '[00:52.00]Just leave me in your wake',
      '[00:58.00]Never know the bottom of my heart',
      '[01:05.00]Never read a caution from the start',
      // [36..44) = 100.8s..123.2s：紧跟在纯器乐 Drop [78.4..100.8s) 之后的密集副歌人声
      '[01:41.50]Let me be forgotten',
      '[01:46.80]Just leave me in your wake',
      '[01:52.20]Never know the bottom of my heart',
      '[01:57.60]Never read a caution from the start',
      '[02:06.00]Broken echoes on the water',
      '[02:13.00]Drifting past another shore',
      '[02:27.00]Let me be forgotten',
      '[02:33.00]Just leave me in your wake',
      '[02:40.00]Never know the bottom of my heart',
      '[02:47.00]Never read a caution from the start',
    ].join('\n');
    const lyrics = parseNeteaseLyric({ lrc: { lyric: lrc } }, duration);
    const features: BeatFeatures = { n: nBeats, chroma, bass, mfcc, db, bright, kick, snare, hat, flux, density };
    return { features, beats, bars, duration, rms, fps, lyrics, hits: { kick: kicks, snare: snares }, low, high };
  };

  const vocalDropSecs = findSections(makeCase(true));
  const atVocalDrop = vocalDropSecs.find(s => 110 >= s.start && 110 < s.end);
  assert.equal(atVocalDrop?.label, 'drop', '全频段半拍重鼓未衰减的 Vocal Drop 下半程应保持为 drop');

  const repriseChorusSecs = findSections(makeCase(false));
  const atRepriseChorus = repriseChorusSecs.find(s => 110 >= s.start && 110 < s.end);
  assert.equal(atRepriseChorus?.label, 'chorus', '重低音与高频撤出后的副歌复唱应归为 chorus');
});
