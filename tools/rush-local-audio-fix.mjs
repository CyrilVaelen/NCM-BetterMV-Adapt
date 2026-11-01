import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import { analyzeAudioSamples } from '../src/app/prepare.ts';
import { decodeLocalLrc, parseLocalLrc } from '../src/lyrics/local.ts';
import { getAudio } from '../src/plugin/source.ts';

const audioPath = 'D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3';
const lrcPath = audioPath.replace(/\.mp3$/i, '.lrc');
const output = path.resolve('../exports/Rush-local-input-fix-20261020');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

const asset = await getAudio({}, 434659448, () => false, lrcPath);
assert.equal(asset.source, 'paired-local-file', 'local playback with a bound LRC must use its same-stem audio');
const expectedAudio = await fs.readFile(audioPath);
assert.equal(hash(new Uint8Array(asset.audio)), hash(expectedAudio), 'the selected plugin input must be the exact D: MP3');

const decoded = spawnSync(ffmpeg, ['-v', 'error', '-i', audioPath, '-ac', '1', '-ar', '22050', '-f', 'f32le', 'pipe:1'], {
  maxBuffer: 128 * 1024 * 1024,
});
assert.equal(decoded.status, 0, decoded.stderr?.toString() || 'ffmpeg failed');
assert.equal(decoded.stdout.length % 4, 0);
const samples = new Float32Array(decoded.stdout.buffer.slice(decoded.stdout.byteOffset, decoded.stdout.byteOffset + decoded.stdout.byteLength));
const duration = samples.length / 22050;
const lrcText = decodeLocalLrc(new Uint8Array(await fs.readFile(lrcPath)));
const lyrics = parseLocalLrc(lrcText, duration);
const analysis = await analyzeAudioSamples(samples, 22050, lyrics, undefined, undefined, { pause: async () => {}, sliceMs: 4 });
const at = t => analysis.sections.find(s => t >= s.start && t < s.end)?.label;
for (const t of [100.82, 101, 102.8, 175.8, 189.8, 191.7]) assert.equal(at(t), 'build', `${t}s should remain build`);
for (const t of [103.3, 192.2]) assert.equal(at(t), 'drop', `${t}s should be a Drop`);

const result = {
  audioPath, lrcPath, audioSource: asset.source, audioSha256: hash(new Uint8Array(asset.audio)),
  lrcSha256: hash(await fs.readFile(lrcPath)), duration, lyricLines: lyrics.length,
  sections: analysis.sections, checks: [100.82, 101, 102.8, 103.3, 175.8, 189.8, 191.7, 192.2].map(t => ({ time: t, label: at(t) })),
};
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ audioSource: result.audioSource, audioSha256: result.audioSha256, duration, sections: result.sections.map(s => [s.start, s.end, s.label]), checks: result.checks }));
process.exit(0);
