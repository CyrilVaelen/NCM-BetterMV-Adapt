// Install the verified Rush Over Me section/scene fix to the confirmed BetterNCM loading paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const project = process.cwd();
const root = path.resolve(project, '..');
const version = '0.9.0-local-export.23';
const pluginPath = path.join(root, 'BetterMV-0.9.0-local-export.plugin');
const standalone = path.join(root, 'BetterMV-0.9.0-local-export.23-rush-outro.plugin');
const state = path.join(root, 'state/before-rush-outro-20261020');
const active = path.join(root, 'BetterNCM');
const targets = [
  { file: path.join(active, 'plugins/BetterMV-0.9.0-local-export.plugin'), backup: 'installed-baseline/BetterMV-0.9.0-local-export.plugin', kind: 'plugin' },
  { file: path.join(active, 'plugins_runtime/ncm-better-mv/bettermv.js'), backup: 'installed-baseline/bettermv.js', kind: 'javascript' },
  { file: path.join(active, 'plugins_runtime/ncm-better-mv/manifest.json'), backup: 'installed-baseline/manifest.json', kind: 'manifest' },
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const candidate = await fs.readFile(pluginPath);
const archive = await JSZip.loadAsync(candidate);
const manifestBytes = await archive.file('manifest.json').async('nodebuffer');
const jsBytes = await archive.file('bettermv.js').async('nodebuffer');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
assert.equal(manifest.version, version, 'Candidate package version mismatch');
assert.equal(manifest.require_restart, true, 'Candidate must retain its restart requirement');
assert.equal(sha(jsBytes), sha(await fs.readFile(path.join(project, 'dist/plugin/bettermv.js'))), 'Packaged JS does not match the just-built source bundle');
assert.ok(jsBytes.includes(Buffer.from(version)), 'Built runtime is missing its version marker');

const currentManifest = JSON.parse(await fs.readFile(targets[2].file, 'utf8'));
assert.equal(currentManifest.version, '0.9.0-local-export.22', 'The active runtime changed since the .22 baseline audit');
const oldFiles = new Map();
for (const target of targets) {
  const bytes = await fs.readFile(target.file);
  oldFiles.set(target.file, bytes);
  const backup = path.join(state, target.backup);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.writeFile(backup, bytes, { flag: 'wx' });
}
await fs.writeFile(standalone, candidate, { flag: 'wx' });

const replacements = [candidate, jsBytes, manifestBytes];
try {
  for (let i = 0; i < targets.length; i++) {
    await fs.writeFile(targets[i].file, replacements[i]);
    const readback = await fs.readFile(targets[i].file);
    assert.equal(sha(readback), sha(replacements[i]), `Installed read-back mismatch: ${targets[i].file}`);
  }
} catch (error) {
  for (const [file, bytes] of oldFiles) await fs.writeFile(file, bytes);
  throw error;
}

const installed = await Promise.all(targets.map(async target => {
  const bytes = await fs.readFile(target.file);
  return { file: target.file, kind: target.kind, bytes: bytes.length, sha256: sha(bytes) };
}));
const sources = {};
async function walk(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await walk(file);
    else sources[path.relative(project, file).replaceAll('\\', '/')] = sha(await fs.readFile(file));
  }
}
await walk(path.join(project, 'src'));
const report = {
  version,
  analysisVersion: 10,
  standalone,
  pluginSha256: sha(candidate),
  installed,
  sources,
  activePaths: targets.map(target => target.file),
  backupDirectory: state,
  inputAudio: 'D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3',
  inputLrc: 'D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.lrc',
  validation: path.join(root, 'exports/Rush-form-20261020/regression.json'),
  settingsChanged: false,
  inputAudioOrLrcWritten: false,
  requiresRestart: true,
  liveProcessLoaded: false,
};
await fs.writeFile(path.join(state, 'delivery.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ version, pluginSha256: report.pluginSha256, installed, standalone, backupDirectory: state }));
