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

test('跨器乐间奏机械均分的伪逐字 YRC 行回退为自然音节时长，不污染后续纯器乐 Drop', () => {
  const yrc = [
    // 真实逐字行：词长各异，必须保留 timedWords = true 与原始词时间戳
    '[12250,3300](12250,390,0)Jumping (12640,300,0)right (12940,210,0)off (13150,270,0)the (13420,2070,0)edge',
    // 伪逐字均分行：21.33s 的器乐 Drop 被机械四等分给每个分片（5332ms），必须回退为自然时长
    "[106120,21330](106120,5332,0)And (111452,5332,0)it's (116784,5332,0)gor(122116,5334,0)-",
  ].join('\n');
  const lines = parseNeteaseLyric({ yrc: { lyric: yrc } }, 240);
  assert.equal(lines.length, 2);

  assert.equal(lines[0].timedWords, true, '真实逐字行应保留 timedWords = true');
  assert.ok(Math.abs(lines[0].words[4].end - 15.49) < 1e-6);

  assert.equal(lines[1].timedWords, false, '机械等分伪逐字行应标记为 timedWords = false');
  const lastWordEnd = lines[1].words[lines[1].words.length - 1].end;
  assert.ok(lastWordEnd - lines[1].start <= 2.0, `伪逐字行发音跨度应收敛至自然时长（实际 ${lastWordEnd - lines[1].start}s）`);
});

test('伪逐字切音与末句 Pre-drop 人声不掩盖全曲多处 Drop 及下半场高潮，同时保留结尾收束型尾奏', () => {
  // 88 小节 × 2.7s = 237.6s（末句歌词后剩余 43.4s <= 22% 时长阈值，确保完整命入 refineTerminalOutro 分支）：
  // 0..4 intro | 4..16 verse 1 | 16..24 chorus 1 | 24..28 build 1 | 28..36 drop 1 (75.6..97.2s)
  // 36..48 verse 2 | 48..56 chorus 2 | 56..64 build 2 | 64..72 drop 2a (172.8..194.4s) | 72..80 drop 2b (194.4..216.0s) | 80..88 outro (216.0..237.6s)
  const nb = 88, beatsPerBar = 4, beatDur = 0.675, nBeats = nb * beatsPerBar, duration = nBeats * beatDur, fps = 100;
  const beats = Array.from({ length: nBeats }, (_, i) => i * beatDur);
  const beatInBar = beats.map((_, i) => i % beatsPerBar);
  const bars = makeBars(beats, beatInBar, duration);
  const totalFrames = Math.ceil(duration * fps);

  const buildCase = (climaxSecondHalf: boolean): SectionInput => {
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
      const isDrop1 = bar >= 28 && bar < 36;
      const isDrop2a = bar >= 64 && bar < 72;
      const isMidHitDip = climaxSecondHalf && bar === 71;
      const isPostTag = bar >= 72 && bar < 84;
      const isDrop2b = climaxSecondHalf && bar >= 72 && bar < 80;
      const isClosingTail = !climaxSecondHalf && isPostTag;
      const isSilenceEnd = !climaxSecondHalf && bar >= 84;
      const isAudibleOutro = climaxSecondHalf && bar >= 80;
      const isChorus = (bar >= 16 && bar < 24) || (bar >= 48 && bar < 56);
      const isBuild = (bar >= 24 && bar < 28) || (bar >= 56 && bar < 64);

      const isArticulatedDrop = isDrop1 || (isDrop2a && !isMidHitDip) || isDrop2b;
      const barRms = isDrop2b ? 0.98
        : isArticulatedDrop ? 0.90
        : isClosingTail ? 0.84
        : isMidHitDip ? 0.52
        : isChorus ? 0.66
        : isBuild ? 0.50
        : isAudibleOutro ? 0.28
        : isSilenceEnd ? 0.01
        : isIntro ? 0.18 : 0.36;
      const barLow = isArticulatedDrop ? 0.90
        : isClosingTail ? 0.55
        : isMidHitDip ? 0.04
        : isChorus ? 0.16
        : isBuild ? 0.02
        : isAudibleOutro ? 0.02
        : isSilenceEnd ? 1e-6 : 0.03;
      const barHigh = isArticulatedDrop || isClosingTail ? 0.45 : isChorus ? 0.14 : isBuild ? 0.22 : isSilenceEnd ? 1e-6 : 0.04;
      const barDb = isDrop2b ? -0.5
        : isArticulatedDrop ? -1.5
        : isClosingTail ? -2.2
        : isMidHitDip ? -8
        : isChorus ? -5.5
        : isBuild ? -8.5
        : isAudibleOutro ? -15
        : isSilenceEnd ? -65
        : isIntro ? -16 : -10;

      const f0 = Math.floor(bar * beatsPerBar * beatDur * fps);
      const f1 = Math.min(totalFrames, Math.floor((bar + 1) * beatsPerBar * beatDur * fps));
      for (let f = f0; f < f1; f++) {
        rms[f] = barRms;
        // 真实 Drop 具备低频颗粒切分；收束型尾奏为平直持续低音
        low[f] = isArticulatedDrop ? ((f - f0) % 68 < 36 ? barLow : 0.008) : barLow;
        high[f] = barHigh;
      }

      for (let b = 0; b < beatsPerBar; b++) {
        const bi = bar * beatsPerBar + b;
        const t = beats[bi];
        const root = isArticulatedDrop ? 0 : isClosingTail ? 7 : isChorus ? 5 : isAudibleOutro ? 9 : 2;
        chroma[bi * 12 + root] = 1;
        bass[bi * 12 + root] = 1;
        mfcc[bi * N_MFCC] = barDb;
        mfcc[bi * N_MFCC + 1] = isArticulatedDrop ? 12 : isChorus ? 3 : -4;
        db[bi] = barDb;
        bright[bi] = isArticulatedDrop ? -4 : -10;
        density[bi] = isArticulatedDrop ? 3.2 : isBuild ? 2.8 : isChorus ? 1.7 : 0.8;
        flux[bi] = density[bi];
        if (isArticulatedDrop || isClosingTail || isBuild) {
          if (b === 0 || b === 1 || b === 3) { kick[bi] = 0.88; kicks.push([t, 0.88]); }
          if (b === 2) { snare[bi] = 0.92; snares.push([t, 0.92]); }
          hat[bi] = 0.6;
        } else if (isChorus) {
          if (b === 0 || b === 2) { kick[bi] = 0.55; kicks.push([t, 0.55]); }
          if (b === 1 || b === 3) { snare[bi] = 0.5; snares.push([t, 0.5]); }
        }
      }
    }

    const yrc = [
      // Verse 1 (11..42s)
      '[12000,3500](12000,500,0)Jumping (12500,500,0)right (13000,500,0)off (13500,2000,0)edge',
      '[22000,3500](22000,500,0)Sleeping (22500,600,0)in (23100,600,0)the (23700,1800,0)deep',
      // Chorus 1 (43.2..64.8s): 4 句独立歌词，在 Chorus 2 完整重现（每句出现 2 次，hook = 0.33）
      '[43500,4500](43500,600,0)All (44100,600,0)those (44700,800,0)days (45500,2500,0)pass',
      '[48800,4500](48800,600,0)Still (49400,700,0)believe (50100,800,0)I (50900,2400,0)breathe',
      '[54000,4500](54000,600,0)Need (54600,700,0)the (55300,800,0)dark (56100,2400,0)shine',
      '[59200,4500](59200,600,0)See (59800,700,0)for (60500,800,0)first (61300,2400,0)time',
      '[66000,2000](66000,1200,0)Gorgeous',
      // Drop 1 (75.6..97.2s): 伪逐字机械等分切音行
      "[75200,21330](75200,5332,0)And (80532,5332,0)it's (85864,5332,0)gor(91196,5334,0)-",
      // Verse 2 (98..128s)
      '[99000,3500](99000,500,0)Seeing (99500,500,0)it (100000,500,0)for (100500,2000,0)miles',
      '[112000,3500](112000,500,0)Living (112500,600,0)with (113100,600,0)no (113700,1800,0)fear',
      // Chorus 2 (129.6..151.2s)
      '[130000,4500](130000,600,0)All (130600,600,0)those (131200,800,0)days (132000,2500,0)pass',
      '[135300,4500](135300,600,0)Still (135900,700,0)believe (136600,800,0)I (137400,2400,0)breathe',
      '[140500,4500](140500,600,0)Need (141100,700,0)the (141800,800,0)dark (142600,2400,0)shine',
      '[145700,4500](145700,600,0)See (146300,700,0)for (147000,800,0)first (147800,2400,0)time',
      '[153000,2000](153000,1200,0)Gorgeous',
      // Drop 2a (172.8..194.4s): 伪逐字机械等分切音行 + 193.5s 末句 Pre-drop/结尾人声
      "[177000,15030](177000,3006,0)And (180006,3006,0)it's (186018,3006,0)gor(189024,3006,0)-",
      '[193500,40000](193500,700,0)Gorgeous',
    ].join('\n');
    const lyrics = parseNeteaseLyric({ yrc: { lyric: yrc } }, duration);
    const features: BeatFeatures = { n: nBeats, chroma, bass, mfcc, db, bright, kick, snare, hat, flux, density };
    return { features, beats, bars, duration, rms, fps, lyrics, hits: { kick: kicks, snare: snares }, low, high };
  };

  const climaxSecs = findSections(buildCase(true));
  const atClimax = (t: number) => climaxSecs.find(s => t >= s.start && t < s.end)?.label;
  assert.equal(atClimax(52), 'chorus', '双遍 4 句人声副歌 1 应保持为 chorus');
  assert.equal(atClimax(138), 'chorus', '双遍 4 句人声副歌 2 应保持为 chorus');
  assert.equal(atClimax(85), 'drop', 'Drop 1 不得因伪逐字均分切音被误判为 chorus');
  assert.equal(atClimax(182), 'drop', 'Drop 2 前半程应识别为 drop');
  assert.equal(atClimax(202), 'drop', '末句 Pre-drop 人声引爆后的下半场高潮应保持为 drop 而非 outro');
  assert.equal(atClimax(225), 'outro', '高潮结束后的柔和收尾段应识别为 outro');

  const closingSecs = findSections(buildCase(false));
  const atClosing = (t: number) => closingSecs.find(s => t >= s.start && t < s.end)?.label;
  assert.equal(atClosing(202), 'outro', '能量回落、平直低音且末尾仅余静音尾垫的结尾段仍应识别为 outro');
});

test('单句长音循环型 Vocal-First Drop 上半场与前导低频抽空蓄力段正确识别，且多句高能真副歌不被误升格', () => {
  // 84 小节 × 3.0s = 252s（模拟 80 BPM 半拍感编曲）：
  // 0..5 intro (0..15s) | 5..22 verse 1 (15..66s) | 22..25 build 1 (66..75s)
  // 25..33 drop 1a 人声单句循环上半场 (75..99s) | 33..41 drop 1b 器乐下半场 (99..123s)
  // 41..47 verse 2 (123..141s) | 47..53 chorus (141..159s) | 53..56 build 2 (159..168s)
  // 56..64 drop 2a 器乐上半场 (168..192s) | 64..72 drop 2b 人声单句循环下半场 (192..216s) | 72..84 outro (216..252s)
  const nb = 84, beatsPerBar = 4, beatDur = 0.75, nBeats = nb * beatsPerBar, duration = nBeats * beatDur, fps = 100;
  const beats = Array.from({ length: nBeats }, (_, i) => i * beatDur);
  const beatInBar = beats.map((_, i) => i % beatsPerBar);
  const bars = makeBars(beats, beatInBar, duration);
  const totalFrames = Math.ceil(duration * fps);

  const buildVariant = (mode: 'four-repeat' | 'three-repeat' | 'multi-line-chorus'): SectionInput => {
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
      const isIntro = bar < 5;
      const isOutro = bar >= 72;
      const isBuild = (bar >= 22 && bar < 25) || (bar >= 53 && bar < 56);
      const isDrop1a = bar >= 25 && bar < 33;
      const isDrop1b = bar >= 33 && bar < 41;
      const isDrop2 = bar >= 56 && bar < 72;
      const isSoftChorus = bar >= 47 && bar < 53;
      const isFullDrop = isDrop1a || isDrop1b || isDrop2;

      const barRms = isFullDrop ? 0.94 : isBuild ? 0.66 : isSoftChorus ? 0.54 : isIntro || isOutro ? 0.16 : 0.58;
      const barLow = isFullDrop ? 0.90 : isBuild ? 0.025 : isSoftChorus ? 0.10 : isIntro || isOutro ? 0.01 : 0.28;
      const barHigh = isFullDrop ? 0.46 : isBuild ? 0.24 : isSoftChorus ? 0.12 : 0.05;
      const barDb = isFullDrop ? -1 : isBuild ? -6.5 : isSoftChorus ? -7.5 : isIntro || isOutro ? -16 : -6.8;

      const f0 = Math.floor(bar * beatsPerBar * beatDur * fps);
      const f1 = Math.min(totalFrames, Math.floor((bar + 1) * beatsPerBar * beatDur * fps));
      for (let f = f0; f < f1; f++) {
        rms[f] = barRms;
        low[f] = isFullDrop ? ((f - f0) % 75 < 42 ? barLow : 0.03) : barLow;
        high[f] = barHigh;
      }

      for (let b = 0; b < beatsPerBar; b++) {
        const bi = bar * beatsPerBar + b;
        const t = beats[bi];
        // 让 Drop 1a 与 Drop 1b 在音色特征上略有差异，使 DP 在第 33 小节自然切分为前后两个 8 小节半场
        const root = isDrop1a ? 0 : isDrop1b || isDrop2 ? 7 : isBuild ? 4 : isSoftChorus ? 5 : isOutro ? 9 : 2;
        chroma[bi * 12 + root] = 1;
        bass[bi * 12 + root] = 1;
        mfcc[bi * N_MFCC] = barDb;
        mfcc[bi * N_MFCC + 1] = isFullDrop ? 12 : isSoftChorus ? 2 : -4;
        db[bi] = barDb;
        bright[bi] = isFullDrop ? -4 : -10;
        density[bi] = isFullDrop ? 3.2 : isBuild ? 1.8 : 1.1;
        flux[bi] = density[bi];
        if (isFullDrop) {
          if (b === 0 || b === 1 || b === 3) { kick[bi] = 0.9; kicks.push([t, 0.9]); }
          if (b === 2) { snare[bi] = 0.92; snares.push([t, 0.92]); }
          hat[bi] = 0.6;
        } else if (!isIntro && !isOutro && !isBuild) {
          if (b === 0) { kick[bi] = 0.5; kicks.push([t, 0.5]); }
          if (b === 2) { snare[bi] = 0.45; snares.push([t, 0.45]); }
        }
      }
    }

    const drop1aLines = mode === 'four-repeat'
      ? [
          '[75400,4400](75400,800,0)now (76200,500,0)we (76700,2200,0)sleepwalk (78900,900,0)again',
          '[81300,4400](81300,800,0)now (82100,500,0)we (82600,2200,0)sleepwalk (84800,900,0)again',
          '[87300,4500](87300,800,0)now (88100,500,0)we (88600,2300,0)sleepwalk (90900,900,0)again',
          '[93300,5200](93300,800,0)now (94100,500,0)we (94600,3000,0)sleepwalk (97600,900,0)again',
        ]
      : mode === 'three-repeat'
      ? [
          '[76000,4600](76000,800,0)now (76800,500,0)we (77300,2400,0)sleepwalk (79700,900,0)again',
          '[83500,4600](83500,800,0)now (84300,500,0)we (84800,2400,0)sleepwalk (87200,900,0)again',
          '[91500,5200](91500,800,0)now (92300,500,0)we (92800,3000,0)sleepwalk (95800,900,0)again',
        ]
      : [
          '[75400,4800](75400,800,0)now (76200,800,0)we (77000,1600,0)sleepwalk (78600,1600,0)again',
          '[81200,4800](81200,800,0)hold (82000,800,0)the (82800,1600,0)fortress (84400,1600,0)tonight',
          '[87200,4800](87200,800,0)running (88000,800,0)out (88800,1600,0)of (90400,1600,0)the (92000,1)rain',
          '[93200,4800](93200,800,0)calling (94000,800,0)out (94800,1600,0)your (96400,1600,0)name',
        ];

    const chorus2Lines = mode === 'multi-line-chorus'
      ? [
          '[141500,4000](141500,700,0)now (142200,700,0)we (142900,1300,0)sleepwalk (144200,1300,0)again',
          '[145800,4000](145800,700,0)hold (146500,700,0)the (147200,1300,0)fortress (148500,1300,0)tonight',
          '[150200,4000](150200,700,0)running (150900,700,0)out (151600,1300,0)of (152900,1300,0)the (154200,1)rain',
          '[154600,4000](154600,700,0)calling (155300,700,0)out (156000,1300,0)your (157300,1300,0)name',
        ]
      : [
          '[141500,4500](141500,800,0)now (142300,500,0)we (142800,2200,0)sleepwalk (145000,1000,0)again',
          '[147500,5200](147500,800,0)now (148300,500,0)we (148800,2800,0)sleepwalk (151600,1100,0)again',
          '[154500,3200](154500,1400,0)sleepwalker (155900,1800,0)tonight',
        ];

    const yrc = [
      '[16000,4000](16000,800,0)wandering (16800,800,0)into (17600,1000,0)the (18600,1400,0)mist',
      '[24000,4000](24000,800,0)footprints (24800,800,0)fade (25600,1000,0)in (26600,1400,0)the (28000,1)sand',
      '[34000,4000](34000,800,0)voices (34800,800,0)under (35600,1000,0)the (36600,1400,0)bridge',
      '[48000,4000](48000,800,0)turning (48800,800,0)back (49600,1000,0)to (50600,1400,0)the (52000,1)land',
      '[67000,2200](67000,1000,0)sleepwalker (68000,1200,0)tonight',
      '[73200,1600](73200,500,0)where (73700,500,0)did (74200,600,0)you',
      ...drop1aLines,
      '[126000,3200](126000,1400,0)sleepwalker (127400,1800,0)tonight',
      ...chorus2Lines,
      '[166200,1500](166200,500,0)where (166700,500,0)did (167200,500,0)you',
      '[192400,4400](192400,800,0)now (193200,500,0)we (193700,2200,0)sleepwalk (195900,900,0)again',
      '[198300,4400](198300,800,0)now (199100,500,0)we (199600,2200,0)sleepwalk (201800,900,0)again',
      '[204300,4500](204300,800,0)now (205100,500,0)we (205600,2300,0)sleepwalk (207900,900,0)again',
      '[210300,5000](210300,800,0)now (211100,500,0)we (211600,2800,0)sleepwalk (214400,900,0)again',
    ].join('\n');

    const lyrics = parseNeteaseLyric({ yrc: { lyric: yrc } }, duration);
    const features: BeatFeatures = { n: nBeats, chroma, bass, mfcc, db, bright, kick, snare, hat, flux, density };
    return { features, beats, bars, duration, rms, fps, lyrics, hits: { kick: kicks, snare: snares }, chorus: [72, 100], low, high };
  };

  // 1) 4 连长音单句循环 Drop 上半场 + 低频抽空铺垫段
  const secs4 = findSections(buildVariant('four-repeat'));
  const at4 = (t: number) => secs4.find(s => t >= s.start && t < s.end)?.label;
  assert.equal(at4(70), 'build', '4 连循环模式：Drop 1 前低频抽空段应为 build');
  assert.equal(at4(85), 'drop', '4 连循环模式：Drop 1 单句循环上半场应为 drop');
  assert.equal(at4(110), 'drop', '4 连循环模式：Drop 1 器乐下半场应为 drop');
  assert.equal(at4(148), 'chorus', '4 连循环模式：中段柔和人声副歌应保持为 chorus');

  // 2) 3 连长音单句循环 Drop 上半场（覆盖 precedesVocalDrop + promoteLeadBuild 对称晋升路径）
  const secs3 = findSections(buildVariant('three-repeat'));
  const at3 = (t: number) => secs3.find(s => t >= s.start && t < s.end)?.label;
  assert.equal(at3(70), 'build', '3 连循环模式：前导低频抽空段应归位为 build');
  assert.equal(at3(85), 'drop', '3 连循环模式：单句循环上半场应对称晋升为 drop');
  assert.equal(at3(110), 'drop', '3 连循环模式：器乐下半场应为 drop');

  // 3) 对照保护：多句不同歌词的高能真副歌紧接器乐 Drop 时，真副歌必须保持为 chorus
  const secsMulti = findSections(buildVariant('multi-line-chorus'));
  const atMulti = (t: number) => secsMulti.find(s => t >= s.start && t < s.end)?.label;
  assert.equal(atMulti(85), 'chorus', '多句叙事高能真副歌不得被误升格为 drop');
  assert.equal(atMulti(110), 'drop', '紧随真副歌之后的器乐高潮仍应为 drop');
});

test('高能叙事主歌后的收暗纯器乐尾声与早期副歌提示框不会被误判为 Drop，且低通滚奏后真高潮正常识别', () => {
  const nb = 84, beatsPerBar = 4, beatDur = 0.7, nBeats = nb * beatsPerBar, duration = nBeats * beatDur, fps = 100;
  const beats = Array.from({ length: nBeats }, (_, i) => i * beatDur);
  const beatInBar = beats.map((_, i) => i % beatsPerBar);
  const bars = makeBars(beats, beatInBar, duration);
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

  // 曲式布局（每小节 2.8s）：
  // 0..4 (0..11.2s): intro
  // 4..9 (11.2..25.2s): 高能带鼓叙事主歌 Verse 1（4 句不重复歌词，全频段明亮）
  // 9..15 (25.2..42.0s): 主歌演唱结束后的纯器乐收束延续段（能量微降，高频收暗 > 6 dB）
  // 15..22 (42.0..61.6s): 抒情复唱副歌 Chorus 1
  // 22..28 (61.6..78.4s): 渐强器乐 Riser 铺垫（6 小节）
  // 28..33 (78.4..92.4s): 低通闷音底鼓军鼓滚奏 Build Roll（5 小节，高能但高频压暗）
  // 33..34 (92.4..95.2s): Drop 前人声留白谷（1 小节低频抽空）
  // 34..43 (95.2..120.4s): 全频段真高潮 Drop 1
  // 43..49 (120.4..137.2s): 叙事主歌 Verse 2
  // 49..56 (137.2..156.8s): 复唱副歌 Chorus 2
  // 56..61 (156.8..170.8s): 渐强 Build 2 + 留白谷
  // 61..74 (170.8..207.2s): 全频段真高潮 Drop 2
  // 74..84 (207.2..235.2s): Outro
  for (let bar = 0; bar < nb; bar++) {
    const isIntro = bar < 4;
    const isVerse1 = bar >= 4 && bar < 9;
    const isVerseTail = bar >= 9 && bar < 15;
    const isChorus = (bar >= 15 && bar < 22) || (bar >= 49 && bar < 56);
    const isRiser1 = bar >= 22 && bar < 28;
    const isRiser2 = bar >= 56 && bar < 60;
    const isRiser = isRiser1 || isRiser2;
    const isMuffledRoll = bar >= 28 && bar < 33;
    const isPreValley = bar === 33 || bar === 60;
    const isDrop = (bar >= 34 && bar < 43) || (bar >= 61 && bar < 74);
    const isVerse2 = bar >= 43 && bar < 49;
    const isOutro = bar >= 74;

    const riserProg = isRiser1 ? (bar - 22) / 5 : isRiser2 ? (bar - 56) / 3 : 0;
    const barRms = isDrop ? 0.92 : isMuffledRoll ? 0.95 : isVerse1 ? 0.90 : isVerseTail ? 0.86 : isVerse2 ? 0.78 : isRiser ? 0.42 + 0.26 * riserProg : isChorus ? 0.56 : isPreValley ? 0.20 : 0.14;
    const barLow = isDrop ? 0.88 : isMuffledRoll ? 0.82 : isVerse1 ? 0.72 : isVerseTail ? 0.68 : isVerse2 ? 0.58 : isRiser ? 0.12 + 0.18 * riserProg : isChorus ? 0.08 : 0.002;
    const barHigh = isDrop ? 0.48 : isVerse1 ? 0.38 : isVerse2 ? 0.30 : isVerseTail ? 0.07 : isMuffledRoll ? 0.05 : isChorus ? 0.10 : 0.03;
    const barDb = isDrop || isMuffledRoll ? -1 : isVerse1 ? -1.5 : isVerseTail ? -2.0 : isVerse2 ? -3.5 : isRiser ? -9 + 4 * riserProg : isChorus ? -7.5 : isPreValley ? -16 : -18;

    const f0 = Math.floor(bar * beatsPerBar * beatDur * fps);
    const f1 = Math.min(totalFrames, Math.floor((bar + 1) * beatsPerBar * beatDur * fps));
    for (let f = f0; f < f1; f++) {
      rms[f] = barRms;
      const articulatedGroove = isDrop || isVerse1 || isVerseTail || isVerse2;
      low[f] = articulatedGroove ? ((f - f0) % 70 < 40 ? barLow : 0.015) : isMuffledRoll ? ((f - f0) % 35 < 20 ? barLow : 0.04) : barLow;
      high[f] = barHigh;
    }

    for (let b = 0; b < beatsPerBar; b++) {
      const bi = bar * beatsPerBar + b;
      const t = beats[bi];
      const root = isDrop ? 0 : isMuffledRoll ? 3 : isVerse1 ? 2 : isVerseTail ? 4 : isChorus ? 5 : isOutro ? 9 : 7;
      chroma[bi * 12 + root] = 1;
      bass[bi * 12 + root] = 1;
      mfcc[bi * N_MFCC] = barDb;
      mfcc[bi * N_MFCC + 1] = isDrop ? 12 : isVerse1 ? 8 : isVerseTail ? -2 : isMuffledRoll ? -3 : 1;
      db[bi] = barDb;
      bright[bi] = isDrop || isVerse1 ? -4 : -12;
      density[bi] = isMuffledRoll ? 3.8 : isDrop ? 3.0 : isRiser ? 1.0 + 1.4 * riserProg : isVerse1 || isVerseTail ? 2.0 : 1.0;
      flux[bi] = density[bi];
      if (isMuffledRoll) {
        kick[bi] = 0.85; kicks.push([t, 0.85]);
        snare[bi] = 0.8; snares.push([t, 0.8]);
      } else if (isDrop) {
        if (b === 0 || b === 2) { kick[bi] = 0.92; kicks.push([t, 0.92]); }
        if (b === 2) { snare[bi] = 0.9; snares.push([t, 0.9]); }
        hat[bi] = 0.65;
      } else if (isVerse1 || isVerseTail || isVerse2) {
        if (b === 0 || b === 1) { kick[bi] = 0.72; kicks.push([t, 0.72]); }
        if (b === 2) { snare[bi] = 0.7; snares.push([t, 0.7]); }
      }
    }
  }

  const lrc = [
    '[00:11.500]Losing ourselves tonight',
    '[00:14.800]Barely standing in the rain',
    '[00:18.200]Shadows gather around',
    '[00:21.600]No soft landing remains',
    '[00:42.500]Let me be forgotten',
    '[00:47.500]Leave me in your wake',
    '[00:52.500]Never knew the bottom of my heart',
    '[00:57.000]Never read a caution from the start',
    '[01:32.600]Leave me in your wake',
    '[02:01.000]Confusion surrounds the night',
    '[02:05.000]Nothing left to understand',
    '[02:09.000]Drifting further out of sight',
    '[02:13.000]Stranded on an empty land',
    '[02:17.600]Let me be forgotten',
    '[02:22.500]Leave me in your wake',
    '[02:27.500]Never knew the bottom of my heart',
    '[02:32.000]Never read a caution from the start',
    '[02:48.200]Leave me in your wake',
  ].join('\n');

  const lyrics = parseNeteaseLyric({ lrc: { lyric: lrc } }, duration);
  const features: BeatFeatures = { n: nBeats, chroma, bass, mfcc, db, bright, kick, snare, hat, flux, density };
  // 附带框在开头主歌与收暗尾声上的早期 chorusHint 干扰
  const secs = findSections({
    features, beats, bars, duration, rms, fps, lyrics,
    hits: { kick: kicks, snare: snares },
    chorus: [10.5, 43.0],
    low, high,
  });
  const at = (t: number) => secs.find(s => t >= s.start && t < s.end)?.label;

  assert.equal(at(18), 'verse', '高能叙事主歌应为 verse');
  assert.equal(at(30), 'verse', '主歌后能量未升且高频收暗的纯器乐尾声不得被误判为 drop');
  assert.equal(at(38), 'verse', '主歌纯器乐尾声末尾仍应保持为 verse');
  assert.equal(at(50), 'chorus', '复唱副歌段应为 chorus');
  assert.equal(at(85), 'build', '低通闷音滚奏段应归为 build 而非提前进入 drop');
  assert.equal(at(93.5), 'build', 'Drop 前人声留白谷应归为 build');
  assert.equal(at(102), 'drop', '全频段 Drop 1 应准确识别为 drop');
  assert.equal(at(180), 'drop', '全频段 Drop 2 应准确识别为 drop');
});
