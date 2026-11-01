// Install only over the freshly audited .21 package/runtime; preserve a standalone rollback package.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const root = path.resolve('..');
const baseline = path.join(root, 'state/before-rush-input-fix-20261020/baseline');
const state = path.join(root, 'state/rush-local-input-fix-20261020');
const version = '0.9.0-local-export.22';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const candidate = await fs.readFile(path.join(root, 'BetterMV-0.9.0-local-export.plugin'));
const zip = await JSZip.loadAsync(candidate);
const js = await zip.file('bettermv.js').async('nodebuffer');
const manifest = await zip.file('manifest.json').async('nodebuffer');
assert.equal(JSON.parse(manifest).version, version);
for (const token of ['paired-local-file', '歌词已更新，正在使用本曲音频重新分析段落', '本地 LRC 同名音频文件', version]) {
  assert.ok(js.includes(Buffer.from(token)), `built plugin missing ${token}`);
}

const targets = [
  ['BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin', 'installed/BetterMV-0.9.0-local-export.plugin', candidate],
  ['BetterNCM/plugins_runtime/ncm-better-mv/bettermv.js', 'installed/bettermv.js', js],
  ['BetterNCM/plugins_runtime/ncm-better-mv/manifest.json', 'installed/manifest.json', manifest],
];
for (const [target, backup] of targets) {
  assert.equal(hash(await fs.readFile(path.join(root, target))), hash(await fs.readFile(path.join(baseline, backup))), `${target} changed after baseline`);
}

const standalone = path.join(root, 'BetterMV-0.9.0-local-export.22-rush-local-audio.plugin');
try { await fs.access(standalone); throw new Error(`rollback package already exists: ${standalone}`); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
await fs.writeFile(standalone, candidate);
const installed = [];
for (const [target, , bytes] of targets) {
  const file = path.join(root, target);
  await fs.writeFile(file, bytes);
  assert.equal(hash(await fs.readFile(file)), hash(bytes), `read-back failed: ${file}`);
  installed.push({ file, sha256: hash(bytes), length: bytes.length });
}

const sources = {};
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else sources[path.relative(path.resolve(root, 'NCM-BetterMV-0.9.0'), file).replaceAll('\\', '/')] = hash(await fs.readFile(file));
  }
}
await walk(path.resolve(root, 'NCM-BetterMV-0.9.0/src'));
await fs.mkdir(state, { recursive: true });
const report = {
  version, analysisVersion: 9, standalone, pluginSha256: hash(candidate), installed,
  sources, settingsChanged: false, originalAudioOrLrcWritten: false, requiresRestart: true,
  fix: 'For a local NetEase track with a bound LRC, analyse the same-stem local audio; lyric reloads rerun section analysis on the current audio.',
  input: 'D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3',
  validation: path.join(root, 'exports/Rush-local-input-fix-20261020/validation.json'),
};
await fs.writeFile(path.join(state, 'delivery.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ version, standalone, pluginSha256: report.pluginSha256, installedFilesVerified: installed.length, sourceFiles: Object.keys(sources).length }));
