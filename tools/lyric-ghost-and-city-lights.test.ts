import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNeteaseLyric } from '../src/lyrics/parse.ts';
import { applyAlignment, type AlignResult } from '../src/plugin/aligner.ts';
import { LyricTrack } from '../src/director/lyrics.ts';
import { TOWER_VERT, towerFrag } from '../src/scenes/cityTowers.ts';

test('声学对齐后句尾随真实末词与下句新起点收敛，不再产生跨句重叠重影', () => {
  // 复现《Easier to Love You》在线 LRC + 声学对齐产生重影的真实时序形态
  const doc = {
    lrc: {
      lyric: [
        '[00:26.576]Easier to love you',
        '[00:33.451]Harder to let you go',
        '[00:40.120]Waiting by the window',
      ].join('\n'),
    },
    tlyric: {
      lyric: [
        '[00:26.576]爱你本该更容易',
        '[00:33.451]放手却如此艰难',
        '[00:40.120]在窗边独自守候',
      ].join('\n'),
    },
  };
  const lines = parseNeteaseLyric(doc, 60);
  assert.equal(lines.length, 3);
  // 对齐前 LRC 默认将第 0 句 end 延展到第 1 句原始时间戳 33.451
  assert.ok(lines[0].end > 33.4);

  const align: AlignResult = {
    version: 1,
    id: 1001,
    lines: [
      { conf: 0.85, words: [[26.42, 26.68], [26.70, 26.82], [26.85, 27.05], [27.08, 27.35]] },
      { conf: 0.88, words: [[32.90, 33.18], [33.20, 33.32], [33.35, 33.52], [33.55, 33.72], [33.75, 34.10]] },
      // 第 2 句模拟未对齐回退行（conf 低）
      { conf: 0.01, words: [] },
    ],
  };

  const changed = applyAlignment(lines, align);
  assert.equal(changed, 2);
  // 第 1 句起点提前到 32.90，第 0 句句尾已收敛至真实末词附近，绝不越过 32.90
  assert.equal(lines[1].start, 32.90);
  assert.ok(lines[0].end < lines[1].start, `期望第 0 句 end (${lines[0].end}) < 第 1 句 start (${lines[1].start})`);

  const track = new LyricTrack(lines);
  for (let t = 25; t <= 45; t += 0.01) {
    const vis = track.visible(t);
    const stationary = vis.filter(s => s.exit === 0 && t >= s.line.start - 0.04);
    assert.ok(stationary.length <= 1, `时刻 t=${t.toFixed(2)}s 存在 ${stationary.length} 条原位未退场歌词叠印`);
  }
});

test('原生逐字歌词 YRC 存在尾音拖长与下句重叠时，LyricTrack 依然提前退场不叠字', () => {
  const lines = [
    {
      start: 10.0,
      end: 15.6, // 主唱尾音拖过下一句起点
      text: 'Hold on to the night',
      timedWords: true,
      translation: '紧握这片夜色',
      backing: false,
      words: [
        { text: 'Hold', start: 10.0, end: 10.5 },
        { text: 'on', start: 10.5, end: 11.0 },
        { text: 'to', start: 11.0, end: 11.4 },
        { text: 'the', start: 11.4, end: 11.8 },
        { text: 'night', start: 11.8, end: 15.6 },
      ],
    },
    {
      start: 14.8,
      end: 18.2,
      text: 'Until the morning light',
      timedWords: true,
      translation: '直到晨光降临',
      backing: false,
      words: [
        { text: 'Until', start: 14.8, end: 15.3 },
        { text: 'the', start: 15.3, end: 15.6 },
        { text: 'morning', start: 15.6, end: 16.4 },
        { text: 'light', start: 16.4, end: 18.2 },
      ],
    },
  ];
  const track = new LyricTrack(lines);
  assert.ok(track.leaveAt(0) <= lines[1].start - 0.06);
  // 在新句正式开唱时刻 14.8s，上一句 exit 必须已达到 1（或已离开 visible）
  const atNewStart = track.visible(14.8);
  assert.equal(atNewStart.length, 1);
  assert.equal(atNewStart[0].index, 1);
});

test('同时间戳双语 LRC 自动合并为原文与译文，不拆成两条同屏重影行', () => {
  const doc = {
    lrc: {
      lyric: [
        '[00:13.90]Easier to love you',
        '[00:13.90]爱你更容易',
        '[00:18.20]Harder to let go',
        '[00:18.20]放手却更难',
      ].join('\n'),
    },
  };
  const lines = parseNeteaseLyric(doc, 30);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'Easier to love you');
  assert.equal(lines[0].translation, '爱你更容易');
  assert.ok(lines[0].end > 15.0, '合并后第一句应当持续到下一句而非零时长');
  assert.equal(lines[1].text, 'Harder to let go');
  assert.equal(lines[1].translation, '放手却更难');
});

test('夜城建筑移除高度伸缩跳动，改为立面旋律流光与顶冠灯光响应', () => {
  assert.ok(!TOWER_VERT.includes('uLeadSwell'), 'TOWER_VERT 不应再包含 uLeadSwell');
  assert.ok(!/wp\.y\s*\*=/.test(TOWER_VERT), 'TOWER_VERT 不应对建筑高度 wp.y 做缩放形变');

  const frag = towerFrag('uniform float uLeadGlow, uLeadPulse, uLeadFlow;');
  assert.ok(frag.includes('uLeadGlow') && frag.includes('uLeadPulse') && frag.includes('uLeadFlow'));

  const towersSrc = readFileSync(new URL('../src/scenes/cityTowers.ts', import.meta.url), 'utf8');
  const citySrc = readFileSync(new URL('../src/scenes/city.ts', import.meta.url), 'utf8');
  assert.ok(!towersSrc.includes('uLeadSwell') && !citySrc.includes('uLeadSwell'));
  assert.ok(!/wp\.y\s*\*=/.test(towersSrc), '航空灯与建筑均不应对 wp.y 做高度缩放');
});
