// Install the Rush Over Me Drop entrance fix to the verified BetterNCM profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const project = process.cwd();
const root = path.resolve(project, '..');
const version = '0.9.0-local-export.24';
const candidatePath = path.join(root, 'BetterMV-0.9.0-local-export.plugin');
const standalone = path.join(root, `BetterMV-${version}-rush-drop-entry.plugin`);
const active = path.join(root, 'BetterNCM');
const state = path.join(root, 'state/before-rush-drop-entry-20261020');
const targets = [
  { file: path.join(active, 'plugins/BetterMV-0.9.0-local-export.plugin'), backup: 'installed-baseline/BetterMV-0.9.0-local-export.plugin', kind: 'plugin' },
  { file: path.join(active, 'plugins_runtime/ncm-better-mv/bettermv.js'), backup: 'installed-baseline/bettermv.js', kind: 'javascript' },
  { file: path.join(active, 'plugins_runtime/ncm-better-mv/manifest.json'), backup: 'installed-baseline/manifest.json', kind: 'manifest' },
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const candidate = await fs.readFile(candidatePath);
const archive = await JSZip.loadAsync(candidate);
const manifestBytes = await archive.file('manifest.json').async('nodebuffer');
const jsBytes = await archive.file('bettermv.js').async('nodebuffer');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
assert.equal(manifest.version, version, 'Candidate package version mismatch');
assert.equal(manifest.require_restart, true, 'Candidate must retain its restart requirement');
assert.equal(sha(jsBytes), sha(await fs.readFile(path.join(project, 'dist/plugin/bettermv.js'))), 'Packaged JS differs from the built source bundle');
assert.ok(jsBytes.includes(Buffer.from(version)), 'Built runtime is missing its version marker');

const previous = JSON.parse(await fs.readFile(path.join(root, 'state/before-rush-outro-20261020/delivery.json'), 'utf8'));
const currentManifest = JSON.parse(await fs.readFile(targets[2].file, 'utf8'));
assert.equal(currentManifest.version, '0.9.0-local-export.23', 'The active runtime changed since the .23 audit');
const oldFiles = new Map();
for (const target of targets) {
  const bytes = await fs.readFile(target.file);
  const known = previous.installed.find(item => item.kind === target.kind);
  assert.ok(known, `No .23 baseline hash for ${target.kind}`);
  assert.equal(sha(bytes), known.sha256, `Active ${target.kind} differs from the verified .23 baseline`);
  oldFiles.set(target.file, bytes);
  const backup = path.join(state, target.backup);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.writeFile(backup, bytes, { flag: 'wx' });
}
await fs.mkdir(path.join(state, 'source-at-install'), { recursive: true });
await fs.writeFile(path.join(state, 'source-at-install/underwater.ts'), await fs.readFile(path.join(project, 'src/scenes/underwater.ts')), { flag: 'wx' });
await fs.writeFile(standalone, candidate, { flag: 'wx' });

const replacements = [candidate, jsBytes, manifestBytes];
try {
  for (let i = 0; i < targets.length; i++) {
    await fs.writeFile(targets[i].file, replacements[i]);
    assert.equal(sha(await fs.readFile(targets[i].file)), sha(replacements[i]), `Installed read-back mismatch: ${targets[i].file}`);
  }
} catch (error) {
  for (const [file, bytes] of oldFiles) await fs.writeFile(file, bytes);
  throw error;
}

const installed = await Promise.all(targets.map(async target => {
  const bytes = await fs.readFile(target.file);
  return { file: target.file, kind: target.kind, bytes: bytes.length, sha256: sha(bytes) };
}));
const audio = 'D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3';
const lrc = 'D:/CloudMusic/Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.lrc';
const report = {
  version,
  analysisVersion: 10,
  analysisVersionChanged: false,
  standalone,
  pluginSha256: sha(candidate),
  installed,
  changedSource: { file: 'src/scenes/underwater.ts', sha256: sha(await fs.readFile(path.join(project, 'src/scenes/underwater.ts'))) },
  activePaths: targets.map(target => target.file),
  backupDirectory: state,
  inputAudio: audio,
  inputAudioSha256: sha(await fs.readFile(audio)),
  inputLrc: lrc,
  inputLrcSha256: sha(await fs.readFile(lrc)),
  validation: path.join(root, 'exports/Rush-form-20261020/regression.json'),
  settingsChanged: false,
  inputAudioOrLrcWritten: false,
  requiresRestart: true,
  liveProcessLoaded: false,
};
await fs.writeFile(path.join(state, 'delivery.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ version, pluginSha256: report.pluginSha256, installed, standalone, backupDirectory: state }));
