// Legacy filename: parser checks only. Real model/browser probe: probe-local-word-alignment.mjs.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseLocalLrc } from '../src/lyrics/local.ts';
import { applyLockedAlignment } from '../src/plugin/aligner.ts';
const text = await fs.readFile('D:/CloudMusic/VipSongsDownload/NURKO,Neriah - Love Is A Highway.lrc', 'utf8');
const lines = parseLocalLrc(text, 234.736, { yrc: { lyric: '[0,5000](0,5000,0)Wrong online words' }, tlyric: { lyric: '[00:00.162]我想我的爱是一条公路' } });
assert.equal(lines.length, 53); assert.equal(lines[0].start, 0.162);
assert.equal(lines[0].text, 'Guess my love is a highway');
assert.equal(lines[0].translation, '我想我的爱是一条公路');
assert.ok(lines.every(l => !l.timedWords));
const original = structuredClone(lines);
const badFit = { version: 1, id: 2052331548, lines: lines.map(l => ({ conf: 0.9, words: l.words.map(w => [w.start + 20, w.end + 20] as [number, number]) })) };
assert.equal(applyLockedAlignment(lines, badFit).aligned, 0); assert.deepEqual(lines, original);
console.log('Local LRC parser checks passed (53 sentences; online YRC excluded; invalid fits rejected).');
