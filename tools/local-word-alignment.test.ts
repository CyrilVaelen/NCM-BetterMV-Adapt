import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalLrc } from '../src/lyrics/local.ts';
import { applyLockedAlignment, jobKey, jobLines, type AlignResult } from '../src/plugin/aligner.ts';

const make = () => parseLocalLrc('[00:10.000]Hello my world\n[00:14.000]\n[00:20.000]Hello my world\n[00:24.000]', 30);
const result = (): AlignResult => ({ version: 1, id: 1, lines: [
  { conf: 0.8, words: [[10.12, 10.52], [10.82, 11.06], [11.6, 12.5]] },
  { conf: 0.8, words: [[20.14, 20.4], [21.2, 21.4], [22.1, 23.1]] },
] });
test('local acoustic words change while sentence boundaries, text and translations stay exact', () => {
  const lines = make(), before = structuredClone(lines);
  lines[0].translation = '你好';
  assert.deepEqual(applyLockedAlignment(lines, result()), { aligned: 2, total: 2 });
  assert.deepEqual(lines.map(l => [l.start, l.end, l.text]), before.map(l => [l.start, l.end, l.text]));
  assert.equal(lines[0].translation, '你好');
  assert.equal(lines[0].words[1].start, 10.82);
  assert.notEqual(lines[0].words[1].start - lines[0].words[0].start, lines[1].words[1].start - lines[1].words[0].start);
  assert.ok(lines.every(l => l.timedWords && l.words.every(w => w.start >= l.start && w.end <= l.end && w.end > w.start)));
});
test('weak, wrong-repeat, malformed and out-of-bounds fits do not become fake aligned words', () => {
  for (const alter of [
    (r: AlignResult) => { r.lines[0].conf = 0.001; },
    (r: AlignResult) => { r.lines[0].conf = NaN; },
    (r: AlignResult) => { r.lines[0].words[0] = [20.1, 20.3]; },
    (r: AlignResult) => { r.lines[0].words[2] = [11.6, 16]; },
    (r: AlignResult) => { r.lines[0].words[0] = [11.9, 12]; },
    (r: AlignResult) => { r.lines[0].words = [null, null, [11.6, 12.5]]; },
    (r: AlignResult) => { r.lines[0].words[1] = [NaN, NaN]; r.lines[0].words[0] = null; },
  ]) {
    const lines = make(), before = structuredClone(lines[0]), r = result(); alter(r);
    assert.equal(applyLockedAlignment(lines, r).aligned, 1);
    assert.deepEqual(lines[0], before);
  }
});
test('tiny CTC edge rounding clamps inside a sentence and retains exact sentence times', () => {
  const lines = make(), r = result(); r.lines[0].words[0] = [9.96, 10.2];
  assert.equal(applyLockedAlignment(lines, r).aligned, 2);
  assert.equal(lines[0].start, 10); assert.equal(lines[0].words[0].start, 10);
});
test('local cache is separate from online, sensitive to ends/text, and stable after word calibration', () => {
  const lines = make(), k = jobKey(1, lines, 'local-locked');
  assert.notEqual(k, jobKey(1, lines));
  applyLockedAlignment(lines, result()); assert.equal(k, jobKey(1, lines, 'local-locked'));
  lines[0].end -= 0.001; assert.notEqual(k, jobKey(1, lines, 'local-locked'));
  const other = make(); other[0].words[1].text = 'your'; assert.notEqual(k, jobKey(1, other, 'local-locked'));
  assert.equal(jobLines(make(), 30, 'local-locked')[0].next, 14);
  assert.equal(jobLines(make(), 30)[0].next, 20);
});
