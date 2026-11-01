import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseLocalLrc } from '../src/lyrics/local.ts';
import { parseNeteaseLyric } from '../src/lyrics/parse.ts';
import { parseWiki } from '../src/meta/wiki.ts';
import { parseChorus } from '../src/plugin/source.ts';

const project = process.cwd(), root = path.resolve('..');
const backup = path.join(root, 'state/before-melodic-structure-20261018');
const out = path.join(root, 'exports/Melodic-structure-20261018');
await fs.mkdir(out, { recursive: true });
try { await fs.access(path.join(backup, 'baseline.json')); } catch {
  await fs.mkdir(backup, { recursive: true });
  const hashes = {};
  for (const file of ['src', 'tools/package-complete.mjs', 'exporter/build-plugin.mjs', 'TASK.md', 'STATUS.md', 'PROJECT.md', 'ACCEPTANCE.md']) {
    await fs.cp(path.join(project, file), path.join(backup, 'source', file), { recursive: true, force: false, errorOnExist: true });
  }
  for (const file of ['src/analysis/sections.ts', 'src/analysis/index.ts', '../BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin', '../BetterNCM/plugins_runtime/ncm-better-mv/bettermv.js']) {
    const b = await fs.readFile(file); hashes[file] = createHash('sha256').update(b).digest('hex');
    if (file.startsWith('../')) await fs.writeFile(path.join(backup, path.basename(file)), b, { flag: 'wx' });
  }
  await fs.writeFile(path.join(backup, 'baseline.json'), JSON.stringify(hashes, null, 2), { flag: 'wx' });
}
// Run the frozen pre-change pipeline while capturing its segmentation inputs for quick, exact replay.
const captureFile = path.join(backup, 'capture-index.ts');
let source = await fs.readFile(path.join(backup, 'source/src/analysis/index.ts'), 'utf8');
source = source.replace(/from '(\.\.?\/[^']+)'/g, (_, specifier) => `from './${path.posix.normalize('source/src/analysis/'+specifier)}'`);
source = source.replace('const sections = findSections({', 'const sections = captureSections({');
source += '\nfunction captureSections(input: any) { (globalThis as any).__captureSections?.(input); return findSections(input); }\n';
await fs.writeFile(captureFile, source);
const baseline = await import(pathToFileURL(captureFile).href);
const current = await import('../src/analysis/sections.ts');
const previous = await import(pathToFileURL(path.join(backup,'source/src/analysis/sections.ts')).href);
const ffmpeg = (await import('ffmpeg-static')).default;
const songs = {
  love: { mp3: 'D:/野葱视频转换器/音频转换/NURKO,Neriah - Love Is A Highway.mp3', lrc: 'D:/CloudMusic/VipSongsDownload/NURKO,Neriah - Love Is A Highway.lrc' },
  sunshine: { pcm: path.join(root, 'exports/Sunshine-keyboard-response/sunshine-mono.f32') },
  homura: { pcm: path.join(root, 'exports/Sunshine-keyboard-response/homura-regression.f32'), input: path.join(root, 'BetterNCM/export-jobs/741d3da3-67d0-405d-8b1f-9c06bce5230d/input.json') },
  cant: { pcm: path.join(root, 'exports/Cant-Let-You-Go-drop-response/mono.f32'), input: path.join(root, 'exports/Cant-Let-You-Go-drop-response/fixture/19191169-1600-4000-8000-000000000006/input.json') },
  fellow: { mp3: 'D:/野葱视频转换器/音频转换/Porter Robinson - Fellow Feeling.mp3', input: path.join(root, 'exports/Fellow-Feeling-lyric-probe/fixture/28912014-0000-4000-8000-000000000007/input.json') },
  conan: { mp3: 'D:/野葱视频转换器/音频转换/「名探偵コナン」~メインテーマ.mp3' },
  timeflies: { mp3: 'D:/野葱视频转换器/音频转换/水仙LONE,水仙LONE - Time Flies.mp3' },
  loveeasy: { mp3: 'D:/野葱视频转换器/音频转换/爱，很简单.mp3' },
  already: { mp3: 'D:/野葱视频转换器/音频转换/Already Gone.mp3' },
};
songs['love-live']={...songs.love, pcm:path.join(out,'love-mono.f32'),metadata:path.join(out,'love-metadata.json'),id:2052331548};
songs['love-online']={...songs['love-live'],lrc:undefined};
songs['love-no-lyrics']={...songs['love-live'],lrc:undefined,metadata:undefined};
songs['homura-live']={...songs.homura};
songs['cant-live']={...songs.cant,metadata:path.join(root,'exports/Cant-Let-You-Go-drop-response/metadata.json'),id:1919116916};
songs['fellow-live']={...songs.fellow,metadata:path.join(root,'exports/Fellow-Feeling-lyric-probe/metadata.json'),id:28912014};
const names = process.argv.slice(2).filter(x => !x.startsWith('--'));
for (const name of names.length ? names : ['love']) {
  const song = songs[name]; if (!song) throw new Error('Unknown fixture: ' + name);
  const cache = path.join(out, name + '-input.bin'); let input;
  try { input = deserialize(await fs.readFile(cache)); } catch {
    const pcmPath = song.pcm || path.join(out, name + '-mono.f32');
    if (!song.pcm) { const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', song.mp3, '-ac', '1', '-ar', '22050', '-f', 'f32le', pcmPath]); if (r.status) throw new Error(r.stderr?.toString()); }
    const bytes = await fs.readFile(pcmPath), pcm = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const opts = {};
    if (song.lrc) opts.lyrics = parseLocalLrc(await fs.readFile(song.lrc, 'utf8'), pcm.length / 22050);
    if (song.input) { const doc = JSON.parse(await fs.readFile(song.input, 'utf8')); opts.lyrics = doc.analysisLines || doc.lines; opts.bpmHint = doc.wiki?.bpm; opts.chorusHint = doc.chorus; }
    if(song.metadata) {const doc=JSON.parse(await fs.readFile(song.metadata,'utf8')); if(!song.lrc) opts.lyrics=parseNeteaseLyric(doc.lyric,pcm.length/22050);opts.bpmHint=parseWiki(doc.wiki).bpm;opts.chorusHint=parseChorus(doc.chorus,song.id);console.log(JSON.stringify({name,hints:{bpm:opts.bpmHint,chorus:opts.chorusHint},lyrics:opts.lyrics?.length}));}
    globalThis.__captureSections = x => input = x;
    console.log('Analyzing ' + name);
    const analysis = baseline.analyze(pcm, 22050, opts); delete globalThis.__captureSections;
    if (!input) throw new Error('No section input');
    await fs.writeFile(cache, serialize(input));
    await fs.writeFile(path.join(out, name + '-analysis-before.bin'), serialize(analysis));
  }
  let debug, info;
  globalThis.__bmvSectionDebug = x => debug = x;
  globalThis.__bmvSectionInfo = x => info = x;
  const secs = (process.argv.includes('--after') ? current : previous).findSections(input);
  delete globalThis.__bmvSectionDebug; delete globalThis.__bmvSectionInfo;
  const avg = (arr, a, b) => { let sum = 0; for (let i = a; i < b; i++) sum += arr[i] || 0; return sum / Math.max(1, b - a); };
  const report = { name, duration: input.duration, sections: secs, info, articulation:Array.from(debug.articulation||[]),releases:Array.from(debug.releases||[]), similarity:Array.from(debug.similarity||[]), bars: debug.time.map((t, i) => {
    const end = debug.time[i + 1] ?? input.duration, a = input.bars.start[i], b = input.bars.start[i + 1] ?? input.features.n;
    const f = input.features, low = debug.lowDb[i], high = 10 * Math.log10(avg(input.high, Math.floor(t * input.fps), Math.floor(end * input.fps)) + 1e-12);
    return { i, t, end, low, high, db: avg(f.db, a, b), density: avg(f.density, a, b), kick: avg(f.kick, a, b), snare: avg(f.snare, a, b), kicks: input.hits.kick.filter(x => x[0] >= t && x[0] < end), snares: input.hits.snare.filter(x => x[0] >= t && x[0] < end), nov: debug.nov[i], sung: debug.sung[i] };
  }) };
  await fs.writeFile(path.join(out, name + (process.argv.includes('--after') ? '-after' : '-before') + '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ name, sections: secs.map(s=>[+s.start.toFixed(3),+s.end.toFixed(3),s.label]), releases:report.releases }));
}
