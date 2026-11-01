// Real offline MP4 render from the verified current-MV lyric snapshot.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PROJECT, loadSettings, startServer } from '../exporter/server.mjs';
const out = path.resolve(PROJECT, '../exports/Love-Is-A-Highway-local-words');
const probe = JSON.parse(await fs.readFile(path.join(out, 'verification.json'), 'utf8'));
const settings = await loadSettings();
const app = await startServer({ settings: { ...settings, port: 5204, jobDir: path.join(out, 'export-jobs'), outputDir: out } });
try {
  const catalog = await fs.readFile('src/scenes/catalog.ts', 'utf8');
  const off = [...new Set([...catalog.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]))].filter(id => id !== 'rings');
  const metadata = { song: { id: 2052331548, name: 'Love Is A Highway-local-words-check', artists: ['NURKO', 'Neriah'], duration: 234.736 },
    lines: structuredClone(probe.after.lines), analysisLines: structuredClone(probe.after.analysisLines),
    lyric: { yrc: { lyric: '[0,5000](0,5000,0)Online wrong words' } },
    config: { style: 'pulse', quality: 'low', off, offLooks: [], seed: 2052331548, lyricDelays: { 2052331548: 1600 } },
    format: { width: 1280, height: 720, fps: 30, start: 8, duration: 1 } };
  const form = new FormData(); form.append('metadata', JSON.stringify(metadata));
  form.append('audio', new Blob([await fs.readFile(probe.audio)]), 'song.mp3');
  form.append('cover', new Blob([await fs.readFile('plugin/preview.jpg')]), 'cover.jpg');
  const headers = { 'X-BetterMV-Token': settings.token };
  const response = await fetch(app.baseUrl + '/api/exports', { method: 'POST', headers, body: form });
  assert.equal(response.status, 202); const job = await response.json();
  // Editing the live data after submission must not mutate the saved job.
  metadata.lines[2].words[0].start += 9;
  let result, previous = ''; const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    result = await (await fetch(app.baseUrl + '/api/exports/' + job.id, { headers })).json();
    const state = `${result.state}:${result.frames ?? 0}`;
    if (state !== previous) { console.log(state); previous = state; }
    if (['completed', 'failed'].includes(result.state)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert.equal(result?.state, 'completed', result?.error ?? 'Timed out');
  assert.equal(result.result.frames, 30); assert.equal(result.result.validation.videoCodec, 'h264'); assert.equal(result.result.validation.audioCodec, 'aac');
  assert.deepEqual(result.result.pageErrors, []); assert.deepEqual(result.result.consoleErrors, []);
  const input = JSON.parse(await fs.readFile(path.join(out, 'export-jobs', job.id, 'input.json'), 'utf8'));
  assert.deepEqual(input.lines, probe.after.lines); assert.deepEqual(input.analysisLines, probe.after.analysisLines);
  const evidence = { actualMp4: result.result.outputPath, frames: 30, validation: result.result.validation, sameEffectiveWordsAsLiveProbe: true, frozenSnapshot: true, separateAnalysisLyrics: true, sourceSong: probe.audio, config: input.config, errors: [], limit: 'Offline renderer used the verified live snapshot; export submission UI was not driven in the running NetEase app.' };
  await fs.writeFile(path.join(out, 'export-verification.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await app.close(); }
