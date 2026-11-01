import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Director, planShots } from '../src/director/director.ts';
import { Music } from '../src/director/music.ts';
import { STYLES, PULSE, type Style } from '../src/style/style.ts';
import { underwaterDiveEntryProgress } from '../src/scenes/underwater.ts';
import type { Analysis, Section } from '../src/types.ts';
import type { FrameCtx, Shot } from '../src/scenes/types.ts';

const traits = { graphic: false, lyrics: true };
const off = new Set(['cards', 'canvas', 'crystal']);
function fixture(adjacent = true): Music {
  const duration = 72, fps = 100;
  const zero = new Float32Array(duration * fps), rms = new Float32Array(duration * fps).fill(0.8);
  const section = (start: number, end: number, label: Section['label']): Section => ({ start, end, label, energy: label === 'drop' ? 1 : 0.5, group: start, vocal: false });
  const sections = [section(0, 8, 'verse'), section(8, adjacent ? 24 : 40, 'drop')];
  if (adjacent) sections.push(section(24, 40, 'drop'));
  sections.push(section(40, 72, 'outro'));
  const beats = Array.from({ length: duration * 2 }, (_, i) => i * 0.5);
  const a: Analysis = {
    version: 4, duration, bpm: 120, meter: 4, beats, beatInBar: beats.map((_, i) => i % 4), tempo: beats.map(() => 120),
    downbeats: beats.filter((_, i) => i % 4 === 0), sections,
    env: { fps, rms, low: new Float32Array(duration * fps).fill(0.8), mid: zero, high: zero, onset: zero }, hits: { kick: [], snare: [], hat: [], accent: [] },
  };
  return new Music(a);
}
const drops = (music: Music, style: Style = PULSE, disabled = off): Shot[] => planShots(music, style, 99, traits, disabled).filter(s => s.section.label === 'drop');

test('an uninterrupted Drop keeps one scene, variant, seed and camera clock across adjacent analysis sections', () => {
  const music = fixture(), original = structuredClone(music.a.sections);
  for (const style of Object.values(STYLES)) {
    const result = drops(music, style);
    assert.equal(result.length, 1, style.id);
    assert.deepEqual([result[0].start, result[0].end, result[0].section.start, result[0].section.end], [8, 40, 8, 40]);
    assert.equal(result[0].sectionIndex, 1);
    assert.deepEqual(drops(music, style), result, 'planning remains seekable/deterministic');
  }
  assert.deepEqual(music.a.sections, original, 'shot continuity must not rewrite song structure');
});

test('an Underwater Dive Drop reaches its full drop depth on the entry frame', () => {
  assert.equal(underwaterDiveEntryProgress(0, true), 1);
  assert.equal(underwaterDiveEntryProgress(0.4, true), 1);
  assert.equal(underwaterDiveEntryProgress(0, false), 0);
  assert.equal(underwaterDiveEntryProgress(1.2, false), 0.5);
  assert.equal(underwaterDiveEntryProgress(2.4, false), 1);
});

test('a clear full-mix pause allows one cut inside the quiet valley, without beat snapping', () => {
  const music = fixture();
  music.a.env.rms.fill(0.025, 2000, 2080);
  const result = drops(music);
  assert.equal(result.length, 2);
  assert.equal(result[0].end, 20.4);
  assert.equal(result[1].start, 20.4);
  assert.notEqual(result[0].scene, result[1].scene);
  assert.equal(result[0].section, result[1].section, 'camera clock metadata covers the same continuous Drop');
});

test('short note gaps, bass-only gaps, modest energy dips and absent envelopes never cause an internal cut', () => {
  for (const kind of ['short', 'bass-only', 'modest', 'missing', 'silence']) {
    const music = fixture();
    if (kind === 'short') music.a.env.rms.fill(0.02, 2000, 2020);
    if (kind === 'bass-only') music.a.env.low.fill(0, 2000, 2100);
    if (kind === 'modest') music.a.env.rms.fill(0.24, 2000, 2150);
    if (kind === 'missing') music.a.env.rms = new Float32Array();
    if (kind === 'silence') music.a.env.rms.fill(0);
    assert.equal(drops(music).length, 1, kind);
  }
});

test('repeated micro-stops cannot turn a Drop into rapid cuts, and song ending decorations cannot interrupt it', () => {
  const music = fixture();
  for (const t of [12, 13, 14, 15, 16]) music.a.env.rms.fill(0.01, t * 100, t * 100 + 60);
  const result = drops(music);
  for (let i = 1; i < result.length; i++) assert.ok(result[i].start - result[i - 1].start >= 4);
  const finalDrop = fixture(false);
  finalDrop.a.sections = [finalDrop.a.sections[0], { ...finalDrop.a.sections[1], end: 72 }];
  for (let seed = 0; seed < 20; seed++) {
    const ending = planShots(finalDrop, PULSE, seed, traits);
    assert.equal(ending.filter(s => s.start >= 8).length, 1);
    assert.equal(ending[ending.length - 1].end, 72);
    assert.equal(ending[ending.length - 1].section.label, 'drop');
  }
});

test('non-Drop cadence still uses regular style/bar cuts', () => {
  const music = fixture();
  music.a.sections[1].label = 'chorus';
  music.a.sections[2].label = 'chorus';
  const chorus = planShots(music, PULSE, 99, traits, off).filter(s => s.section.label === 'chorus');
  assert.ok(chorus.length >= 8);
  assert.ok(chorus.some(s => s.start === 24), 'ordinary section boundaries stay independent');
});

test('Drop vocals and phrase accents do not replay, mirror or invert the whole picture', () => {
  const music = fixture(), shot = drops(music)[0];
  // Run the real frame orchestration with a minimal scene to isolate shared edit/post-effect behavior.
  const director = Object.assign(Object.create(Director.prototype), {
    style: PULSE, shots: [shot], starts: Float64Array.of(shot.start), cuts: [{ kind: 0, pre: 0, post: 0, whip: [0, 0] }],
    scenes: { [shot.scene]: { scene: { background: null }, update: (_: FrameCtx) => {} } },
    music, lyrics: { visible: () => [] }, palette: { light: false }, pure: false, boxes: [], looks: [],
    overlay: { update: () => {} }, remembered: -1, stutters: [[20, 22, 0.3]],
  }) as Director;
  for (const t of [20.65, 26.01, 32.01, 35.25]) {
    const frame = director.frame(t, 1 / 60, 16 / 9);
    assert.equal(frame.fx.memory, 0);
    assert.equal(frame.fx.remember, false);
    assert.equal(frame.fx.mirror, 0);
    assert.equal(frame.fx.invert, 0);
    assert.equal(frame.transition, null);
  }
  const foreground = music.foregroundAt(26);
  music.selectiveAt = () => true;
  music.foregroundAt = () => ({ ...foreground, attack: 0.2 });
  let rawAccentReads = 0;
  const timbre = music.timbreAt(26);
  music.timbreAt = () => { rawAccentReads++; return { ...timbre, accent: 1 }; };
  assert.ok(Math.abs(director.frame(26, 1 / 60, 16 / 9).fx.bloom - (PULSE.fx.bloom + 0.08 * 0.2)) < 1e-8);
  assert.equal(rawAccentReads, 0, 'global bloom must respect the shared foreground source instead of raw mixed accents');
});
