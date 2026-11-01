import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { decodeLocalLrc, localLrcPath, parseLocalLrc, readLocalLrcText } from '../src/lyrics/local.ts';

const realPath = 'D:/CloudMusic/VipSongsDownload/NURKO,Neriah - Love Is A Highway.lrc';
const sample = '[00:01.200]Hello world\n[00:04.300]My highway\n';
const utf8 = (s: string) => new TextEncoder().encode(s);
const globals = globalThis as typeof globalThis & { betterncm?: unknown };

test('full Windows paths, quotes, Unicode isolation and file URLs are normalized', () => {
  assert.equal(localLrcPath(' \u202a"D:\\CloudMusic\\song.lrc"\u202c '), 'D:/CloudMusic/song.lrc');
  assert.equal(localLrcPath('file:///D:/CloudMusic/Love%20Is%20A%20Highway.lrc'), 'D:/CloudMusic/Love Is A Highway.lrc');
  assert.equal(localLrcPath('\\\\server\\share\\song.lrc'), '//server/share/song.lrc');
  for (const p of ['song.lrc', 'D:foo.lrc', 'C:\\fakepath\\song.lrc', '', 'https://example.com/song.lrc']) {
    assert.throws(() => localLrcPath(p), /完整文件路径|请选择/);
  }
});
test('UTF-8, UTF-16 LE/BE and no-BOM UTF-16 preserve the same sentence times', () => {
  const le = new Uint8Array(Buffer.from(sample, 'utf16le'));
  const be = le.slice(); for (let i = 0; i < be.length; i += 2) [be[i], be[i + 1]] = [be[i + 1], be[i]];
  for (const b of [utf8(sample), new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(sample)]), le, be,
    new Uint8Array([0xff, 0xfe, ...le]), new Uint8Array([0xfe, 0xff, ...be])]) {
    assert.deepEqual(parseLocalLrc(decodeLocalLrc(b), 8).map(l => [l.start, l.text]), [[1.2, 'Hello world'], [4.3, 'My highway']]);
  }
  assert.equal(decodeLocalLrc(new Uint8Array([...utf8('[00:01.200]'), 0xc4, 0xe3, 0xba, 0xc3])), '[00:01.200]你好');
});
test('native bytes remain usable when the text endpoint returns an empty body', async () => {
  const bytes = await fs.readFile(realPath); let textCalls = 0, binaryCalls = 0;
  globals.betterncm = { fs: { exists: async () => true, readFileText: async () => { textCalls++; return ''; }, readFile: async (p: string) => {
    assert.equal(p, realPath); binaryCalls++; return new Blob([bytes]);
  } } };
  try {
    const text = await readLocalLrcText(realPath.replaceAll('/', '\\'));
    assert.equal(parseLocalLrc(text, 234.736).length, 53);
    assert.equal(binaryCalls, 1); assert.equal(textCalls, 0);
  } finally { delete globals.betterncm; }
});
test('missing files, empty API bodies and non-LRC files have distinct errors', async () => {
  try {
    globals.betterncm = { fs: { exists: async () => false, readFile: async () => { throw new Error('must not read'); } } };
    await assert.rejects(readLocalLrcText(realPath), /找不到本地 LRC 文件/);
    globals.betterncm = { fs: { exists: async () => true, readFile: async () => new Blob([]) } };
    await assert.rejects(readLocalLrcText(realPath), /读取结果为空/);
    globals.betterncm = { fs: { exists: async () => true, readFile: async () => new Blob(['<html>404</html>']) } };
    await assert.rejects(readLocalLrcText(realPath), /没有.*时间标签/);
    globals.betterncm = { fs: { exists: async () => true, readFileText: async () => sample } };
    assert.equal(await readLocalLrcText(realPath), sample);
  } finally { delete globals.betterncm; }
});
test('actual file still parses 53 calibrated sentences through the shared reader', async () => {
  const lines = parseLocalLrc(await readLocalLrcText(realPath), 234.736);
  assert.equal(lines.length, 53); assert.equal(lines[0].start, 0.162);
});
test('inline word-timed LRC parses per-word timestamps and preserves clean sentence text', async () => {
  const rushPath = 'D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.lrc';
  const lines = parseLocalLrc(await readLocalLrcText(rushPath), 259.556);
  assert.equal(lines.length, 28);
  assert.ok(lines.every(l => l.timedWords));
  assert.equal(lines[0].text, 'Your fingertips on my skin');
  assert.deepEqual(lines[0].words.map(w => [w.text, w.start, w.end]), [
    ['Your', 13.9, 14.1],
    ['fingertips', 14.1, 15.98],
    ['on', 15.98, 16.12],
    ['my', 16.12, 16.28],
    ['skin', 16.28, 16.88],
  ]);
  assert.equal(lines[8].text, '"I need tonight, just say goodbye');
  assert.deepEqual(lines[8].words.map(w => [w.text, w.start, w.end]), [
    ['"I', 42.6, 45.24],
    ['need', 45.24, 45.68],
    ['tonight,', 45.68, 47.44],
    ['just', 47.44, 47.68],
    ['say', 47.68, 48.18],
    ['goodbye', 48.18, 49.3],
  ]);
  assert.equal(lines[18].text, 'Cause I will miss you');
  assert.deepEqual(lines[18].words.map(w => [w.text, w.start, w.end]), [
    ['Cause', 100.82, 101.28],
    ['I', 101.28, 101.44],
    ['will', 101.44, 101.86],
    ['miss', 101.86, 102.4],
    ['you', 102.4, 102.84],
  ]);
  for (const l of lines) {
    assert.doesNotMatch(l.text, /\[\d|\]|<\d|>/);
    for (const w of l.words) assert.doesNotMatch(w.text, /\[\d|\]|<\d|>/);
  }
  const alt = parseLocalLrc('[00:10.00][00:10.12]Hello <00:10.50>world[00:11.20]"', 20);
  assert.equal(alt.length, 1);
  assert.equal(alt[0].text, 'Hello world"');
  assert.deepEqual(alt[0].words.map(w => [w.text, w.start, w.end]), [
    ['Hello', 10.12, 10.5],
    ['world"', 10.5, 11.2],
  ]);
});
