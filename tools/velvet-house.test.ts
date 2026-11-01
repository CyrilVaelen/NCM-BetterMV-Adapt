// 微醺 (VELVET) 风格与「暗涌水廊 (velvet)」场景的单元测试：
// 验证 Deep House 曲风/声学四四拍自动识别、半拍 Melodic Dubstep 防误判、丝滑长镜头编排与零爆闪/零故障切帧保证。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deserialize } from 'node:v8';
import { test } from 'node:test';
import * as THREE from 'three';
import { Director, planLooks, planShots } from '../src/director/director.ts';
import { Music } from '../src/director/music.ts';
import { BALLAD, chooseStyle, INK, isSteadyHouseGroove, PULSE, VELVET, WORD } from '../src/style/style.ts';
import type { Analysis, Hit, Section } from '../src/types.ts';
import type { FrameCtx } from '../src/scenes/types.ts';

/** 构造可配置鼓组规律度与频段包络的分析样本 */
function buildSyntheticAnalysis(opts: {
  bpm: number;
  duration?: number;
  fourOnTheFloor: boolean;
  halfTimeDubstep?: boolean;
  meanLow?: number;
  meanHigh?: number;
}): Analysis {
  const {
    bpm,
    duration = 96,
    fourOnTheFloor,
    halfTimeDubstep = false,
    meanLow = 0.58,
    meanHigh = 0.34,
  } = opts;
  const fps = 50;
  const nFrames = Math.round(duration * fps);
  const beatSec = 60 / bpm;
  const beats: number[] = [];
  for (let t = 0; t < duration - 0.05; t += beatSec) beats.push(+t.toFixed(4));
  const beatInBar = beats.map((_, i) => i % 4);
  const downbeats = beats.filter((_, i) => i % 4 === 0);

  const barSec = beatSec * 4;
  const sections: Section[] = [
    { start: 0, end: 8 * barSec, label: 'intro', energy: 0.38, group: 0, vocal: false },
    { start: 8 * barSec, end: 16 * barSec, label: 'verse', energy: 0.56, group: 1, vocal: true },
    { start: 16 * barSec, end: 24 * barSec, label: 'build', energy: 0.68, group: 2, vocal: false },
    { start: 24 * barSec, end: 40 * barSec, label: 'drop', energy: 0.92, group: 3, vocal: true },
    { start: 40 * barSec, end: Math.max(duration, 48 * barSec), label: 'outro', energy: 0.35, group: 4, vocal: false },
  ];
  const actualDuration = sections[sections.length - 1].end;

  const kicks: Hit[] = [];
  const snares: Hit[] = [];
  const hats: Hit[] = [];
  beats.forEach((bt, idx) => {
    const pos = idx % 4;
    if (fourOnTheFloor) {
      // 经典 4/4 浩室：每拍稳定底鼓 + 2/4 拍轻拍手 + 反拍 (&) 开镲
      kicks.push([bt, 0.78]);
      if (pos === 1 || pos === 3) snares.push([bt, 0.45]);
      hats.push([+(bt + beatSec * 0.5).toFixed(4), 0.52]);
    } else if (halfTimeDubstep) {
      // 125 BPM 半拍重音 Dubstep：第 1 拍底鼓，第 3 拍军鼓，奇拍无四四拍底鼓
      if (pos === 0) kicks.push([bt, 0.92]);
      if (pos === 2) snares.push([bt, 0.88]);
      hats.push([bt, 0.65]);
    } else {
      // 常规流行/摇滚：1、3 拍底鼓，2、4 拍军鼓
      if (pos === 0 || pos === 2) kicks.push([bt, 0.72]);
      if (pos === 1 || pos === 3) snares.push([bt, 0.68]);
    }
  });

  const frames = Math.ceil(actualDuration * fps);
  const rms = new Float32Array(frames).fill(0.62);
  const low = new Float32Array(frames).fill(meanLow);
  const mid = new Float32Array(frames).fill(0.46);
  const high = new Float32Array(frames).fill(meanHigh);
  const onset = new Float32Array(frames).fill(0.28);

  return {
    version: 9,
    duration: actualDuration,
    bpm,
    meter: 4,
    beats,
    beatInBar,
    tempo: beats.map(() => bpm),
    downbeats,
    sections,
    env: { fps, rms, low, mid, high, onset },
    hits: { kick: kicks, snare: snares, hat: hats, accent: [] },
  };
}

test('曲风标签精确分流：Deep House / 浩室 / Lounge 选入微醺 (VELVET)，硬核电子与说唱/国风/民谣互不串味', () => {
  const base = buildSyntheticAnalysis({ bpm: 122, fourOnTheFloor: false });

  for (const genre of [
    '电子-深邃浩室', '电子-浩室舞曲', '电子-热带浩室', '电子-弛放', '电子-合成器浪潮', '电子-蒸汽波', '电子-新迪斯科',
    'Deep House', 'Melodic House', 'Chill House', 'Tropical House', 'Lounge', 'Nu-Disco', 'Lo-Fi',
  ]) {
    const res = chooseStyle(base, { genres: [genre], tags: [] });
    assert.equal(res.style, VELVET, `预期 ${genre} 选入 VELVET，实际为 ${res.style.id}`);
  }

  // 泛“电子”标签配合深夜/微醺情绪标签且处于中速区间 -> 微醺
  assert.equal(chooseStyle(base, { genres: ['电子'], tags: ['深夜', '放松'], bpm: 120 }).style, VELVET);

  // 网易云中文与英文硬核电子流派（旋律回响贝斯、鼓打贝斯、未来贝斯、中速节奏、大空间浩室等）绝不误入微醺，保持 PULSE
  for (const hard of [
    '电子-旋律回响贝斯', '电子-鼓打贝斯', '电子-未来贝斯', '电子-中速节奏', '电子-大空间浩室',
    'Dubstep', 'Melodic Dubstep', 'Future Bass', 'Techno', 'Trance', 'Hardstyle', 'Phonk', '摇滚', '朋克-流行朋克',
  ]) {
    const res = chooseStyle(base, { genres: [hard], tags: ['深夜', '浪漫', '放松', '活力'], bpm: 122 });
    assert.equal(res.style, PULSE, `预期 ${hard} 保持 PULSE，实际为 ${res.style.id}`);
  }
  // 泛“电子”+狂欢/活力高能标签保持 PULSE
  assert.equal(chooseStyle(base, { genres: ['电子'], tags: ['活力', '夜店', '狂欢'], bpm: 122 }).style, PULSE);
  assert.equal(chooseStyle(base, { genres: ['电子', 'Trap'], tags: ['深夜'], bpm: 124 }, false).style, PULSE);
  assert.notEqual(chooseStyle(base, { genres: ['电子', 'Trap'], tags: ['深夜'], bpm: 124 }, true).style, VELVET);

  // 说唱、国风、民谣保持各自专属风格
  assert.equal(chooseStyle(base, { genres: ['说唱'], tags: [] }, true).style, WORD);
  assert.equal(chooseStyle(base, { genres: ['国风'], tags: [] }, true).style, INK);
  assert.equal(chooseStyle(base, { genres: ['民谣'], tags: [] }, true).style, BALLAD);
});

test('声学四四拍浩室律动检测：无标签或仅标“电子”的 122 BPM Deep House 归入微醺，半拍 Dubstep 与 Rush Over Me 保持律动', () => {
  const deepHouse122 = buildSyntheticAnalysis({ bpm: 122, fourOnTheFloor: true, meanLow: 0.56, meanHigh: 0.34 });
  assert.equal(isSteadyHouseGroove(deepHouse122, 122), true);
  assert.equal(chooseStyle(deepHouse122).style, VELVET);
  assert.equal(chooseStyle(deepHouse122, { genres: ['电子'], tags: [] }).style, VELVET);

  // 模拟 125 BPM 半拍重音 Melodic Dubstep（如 Love Is A Highway）：绝不误判为微醺
  const halfTime125 = buildSyntheticAnalysis({ bpm: 125, fourOnTheFloor: false, halfTimeDubstep: true });
  assert.equal(isSteadyHouseGroove(halfTime125, 125), false);
  assert.equal(chooseStyle(halfTime125).style, PULSE);
  assert.equal(chooseStyle(halfTime125, { genres: ['电子'], tags: [] }).style, PULSE);

  // 常规 120 BPM 摇滚/流行鼓组（1、3 底鼓，2、4 军鼓）：保持 PULSE
  const popRock120 = buildSyntheticAnalysis({ bpm: 120, fourOnTheFloor: false });
  assert.equal(isSteadyHouseGroove(popRock120, 120), false);
  assert.equal(chooseStyle(popRock120).style, PULSE);

  // 真实已存盘的 Rush Over Me (Melodic Dubstep) 分析样本回归校验
  const rushBin = path.resolve('../exports/Rush-form-20261020/local-140-analysis-after.bin');
  if (fs.existsSync(rushBin)) {
    const rush = deserialize(fs.readFileSync(rushBin)) as Analysis;
    assert.equal(isSteadyHouseGroove(rush, rush.bpm), false);
    assert.equal(chooseStyle(rush).style, PULSE);
    assert.equal(chooseStyle(rush, { genres: ['电子'], tags: [] }).style, PULSE);
  }
});

test('微醺 (VELVET) 导演编排：4–8 小节丝滑长镜头、Build 末尾零碎拍抽搐、全程零爆闪/零故障/零马赛克', () => {
  const a = buildSyntheticAnalysis({ bpm: 122, fourOnTheFloor: true });
  const music = new Music(a);
  const off = new Set(['cards', 'canvas', 'crystal']);
  const shots = planShots(music, VELVET, 20261030, { graphic: false, lyrics: true }, off);

  // 1. 首选主场景包含 velvet (暗涌水廊)，且同一调用完全确定可寻址
  assert.ok(shots.some(s => s.scene === 'velvet'), '微醺编排必须调度暗涌水廊 (velvet) 主场景');
  assert.deepEqual(planShots(music, VELVET, 20261030, { graphic: false, lyrics: true }, off), shots);

  // 2. Build 段落绝不因 accelerate 产生小于 1 小节的碎切镜头
  const barSec = (60 / 122) * 4;
  const buildShots = shots.filter(s => s.section.label === 'build');
  assert.ok(buildShots.length >= 1);
  for (const s of buildShots) {
    assert.ok(s.end - s.start >= barSec * 3.8, `Build 镜头时长 (${(s.end - s.start).toFixed(2)}s) 应保持 4 小节以上长镜头`);
  }

  // 3. 主歌/高潮期间不叠加粗糙介质滤镜（CRT / ASCII / Hi-Bit）
  const looks = planLooks(a.sections, VELVET, 20261030);
  a.sections.forEach((sec, idx) => {
    if (sec.label === 'intro' || sec.label === 'verse' || sec.label === 'build' || sec.label === 'drop' || sec.label === 'chorus') {
      assert.equal(looks[idx], null, `${sec.label} 段落应保持纯净原片质感`);
    }
  });

  // 4. 逐帧遍历切点与高潮进入点：零 impact、零 glitch、零 pixel、零 scan、零 invert
  const stubPlate = () => ({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    update(_ctx: FrameCtx) {},
  });
  const scenes: Record<string, ReturnType<typeof stubPlate>> = {};
  for (const s of shots) if (!scenes[s.scene]) scenes[s.scene] = stubPlate();

  const director = Object.create(Director.prototype);
  Object.assign(director, {
    style: VELVET,
    shots,
    scenes,
    music,
    lyrics: { lines: [], visible: () => [] },
    palette: { ink: new THREE.Color(0.02, 0.03, 0.06), paper: new THREE.Color(0.98, 0.96, 0.92), signal: new THREE.Color(0.92, 0.65, 0.28), light: false },
    pure: false,
    looks,
    starts: Float64Array.from(shots, s => s.start),
    boxes: [],
    stutters: [],
    remembered: -1,
    overlay: { update() {} },
  });
  director.cuts = director.planCuts();

  for (const s of shots) {
    for (const offset of [-0.05, 0, 0.016, 0.08, 0.25]) {
      const t = Math.max(0, Math.min(a.duration - 0.01, s.start + offset));
      const frame = director.frame(t, 1 / 60, 16 / 9);
      assert.equal(frame.fx.impact, 0, `t=${t} 禁止双色冲击闪光`);
      assert.equal(frame.fx.glitch, 0, `t=${t} 禁止故障切片`);
      assert.equal(frame.fx.pixel, 0, `t=${t} 禁止马赛克像素块`);
      assert.equal(frame.fx.scan, 0, `t=${t} 禁止扫描线闪烁`);
      assert.equal(frame.fx.invert, 0, `t=${t} 禁止全画幅负片`);
      assert.equal(frame.fx.duotone, 0, `t=${t} 禁止双色调覆盖`);
    }
  }
});
