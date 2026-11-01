// Read-only production probe: actual local audio/LRC -> analysis -> automatic edit plan. No song-specific rules.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { serialize, deserialize } from 'node:v8';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ffmpeg from 'ffmpeg-static';
import { analyze } from '../src/analysis/index.ts';
import { parseNeteaseLyric } from '../src/lyrics/parse.ts';
import { planShots } from '../src/director/director.ts';
import { Music } from '../src/director/music.ts';
import { PULSE } from '../src/style/style.ts';
import type { Analysis } from '../src/types.ts';

const root = path.resolve('..'), state = path.join(root, 'state/redo-lead-priority-20261018/stable-drop');
const audioPath = 'D:/野葱视频转换器/音频转换/Blanke,RUNN - Lights Out.mp3';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/Blanke,RUNN - Lights Out.lrc';
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const [audio, lrc] = await Promise.all([fs.readFile(audioPath), fs.readFile(lrcPath)]);
const cached = path.join(state, 'actual-analysis.bin');
const browserFile = process.argv.find(a => a.startsWith('--analysis='))?.slice('--analysis='.length);
let analysis: Analysis, origin: string;
if (browserFile) {
  const bytes = await fs.readFile(browserFile);
  analysis = browserFile.endsWith('.json') ? JSON.parse(bytes.toString('utf8')) : deserialize(bytes);
  for (const container of [analysis.env, analysis.timbre]) {
    if (!container) continue;
    for (const [key, value] of Object.entries(container)) if (Array.isArray(value)) (container as unknown as Record<string, unknown>)[key] = Float32Array.from(value);
  }
  origin = 'actual browser full analysis supplied at ' + browserFile;
} else {
  try { analysis = deserialize(await fs.readFile(cached)); origin = 'cached independent actual-audio analysis'; }
  catch {
    const decoded = spawnSync(ffmpeg!, ['-v', 'error', '-i', audioPath, '-af', 'pan=mono|c0=0.5*c0+0.5*c1', '-ar', '22050', '-f', 'f32le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
    if (decoded.status !== 0) throw new Error(decoded.stderr?.toString() || 'decode failed');
    const bytes = decoded.stdout, pcm = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const lines = parseNeteaseLyric({ lrc: { lyric: lrc.toString('utf8') } }, pcm.length / 22050);
    console.log(JSON.stringify({ stage: 'analyzing', samples: pcm.length, rate: 22050, lyricLines: lines.length }));
    analysis = analyze(pcm, 22050, { lyrics: lines });
    await fs.writeFile(cached, serialize(analysis));
    origin = 'independent FFmpeg average-stereo decode at 22050 Hz; browser resampling may differ slightly';
  }
}
const music = new Music(analysis), seed = 20261018;
const shots = planShots(music, PULSE, seed, { graphic: false, lyrics: true });
const baselineDirectorPath = path.resolve('tools/.lead-redo-baseline/src/director/director.ts');
const baselineModule = await import(pathToFileURL(baselineDirectorPath).href);
const baselineShots: ReturnType<typeof planShots> = baselineModule.planShots(music, PULSE, seed, { graphic: false, lyrics: true });
const windows = [[62.298, 91.836], [154.603, 213.661]];
const worlds = ['well', 'rifling', 'hangar', 'road', 'pixels', 'triangle', 'strobe'];
let ordinal = 0;
const dropOrdinal = analysis.sections.map(s => s.label === 'drop' ? ordinal++ : ordinal);
const driveSource = await fs.readFile('src/scenes/drive.ts', 'utf8');
assert.ok(driveSource.includes("section.label==='drop'?dropWorld"));
assert.ok(driveSource.includes("stable==='strobe'?'well':stable"));
const results = windows.map(([start, end]) => {
  const within = shots.filter(s => s.section.label === 'drop' && s.end > start + 0.01 && s.start < end - 0.01);
  const plan = within.map(s => {
    const stable = worlds[((s.seed >>> 8) % 6 + 2 * dropOrdinal[s.sectionIndex]) % worlds.length];
    const world = stable === 'strobe' ? 'well' : stable;
    const frames = Array.from({ length: Math.ceil((Math.min(s.end, end) - Math.max(s.start, start)) * 24) }, (_, i) => Math.max(s.start, start) + i / 24);
    return {
      scene: s.scene, variant: s.variant, seed: s.seed, start: s.start, end: s.end,
      cameraClockStart: s.run?.start ?? s.start, sectionClockStart: s.section.start, sectionClockEnd: s.section.end, sectionIndex: s.sectionIndex,
      sampledFrames: frames.length, sourceDerivedDriveWorldIfForced: world,
      oldFourBarPhraseCount: new Set(frames.map(t => Math.floor((music.beatPos(t) - music.beatPos(s.section.start)) / (4 * music.meter)))).size,
      stableWorldCount: new Set(frames.map(() => world)).size,
    };
  });
  const previous = baselineShots.filter(s => s.section.label === 'drop' && s.end > start + 0.01 && s.start < end - 0.01);
  return {
    requestedWindow: [start, end], baselineShotCount: previous.length,
    baselineShots: previous.map(s => ({ start: s.start, end: s.end, scene: s.scene, variant: s.variant, seed: s.seed })),
    shotCount: plan.length, internalCuts: plan.slice(1).map(s => s.start), shots: plan,
  };
});
for (const result of results) assert.equal(result.shotCount, 1, 'actual continuous Drop unexpectedly cut');
const report = {
  audio: { path: audioPath, sha256: hash(audio) }, lrc: { path: lrcPath, sha256: hash(lrc) },
  origin, analysisVersion: analysis.version, duration: analysis.duration, bpm: analysis.bpm,
  sections: analysis.sections, seed, results,
  sourceSha256: { director: hash(await fs.readFile('src/director/director.ts')), baselineDirector: hash(await fs.readFile(baselineDirectorPath)), drive: hash(driveSource), music: hash(await fs.readFile('src/director/music.ts')) },
  limitations: ['Automatic plan and source-derived drive world continuity are verified; the source-derived world calculation is not a pixel/render observation.', 'Existing explicit retake hooks are outside automatic director planning.'],
};
await fs.writeFile(path.join(state, browserFile ? 'lights-out-browser-director-acceptance.json' : 'lights-out-director-acceptance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ origin, analysisVersion: analysis.version, duration: analysis.duration, bpm: analysis.bpm, results }, null, 2));
