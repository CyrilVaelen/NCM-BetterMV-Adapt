// Install the verified late-boundary Drop-entry correction to the confirmed BetterNCM profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const project = process.cwd();
const root = path.resolve(project, '..');
const version = '0.9.0-local-export.26';
const candidatePath = path.join(root, 'BetterMV-0.9.0-local-export.plugin');
const standalone = path.join(root, 'BetterMV-0.9.0-local-export.26-rush-late-boundary.plugin');
const active = path.join(root, 'BetterNCM');
const state = path.join(root, 'state/rush-drop-late-boundary-20261020');
const targets = [
  { file: path.join(active, 'plugins/BetterMV-0.9.0-local-export.plugin'), backup: 'installed-before/plugin.plugin', kind: 'plugin' },
  { file: path.join(active, 'plugins_runtime/ncm-better-mv/bettermv.js'), backup: 'installed-before/bettermv.js', kind: 'javascript' },
  { file: path.join(active, 'plugins_runtime/ncm-better-mv/manifest.json'), backup: 'installed-before/manifest.json', kind: 'manifest' },
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const candidate = await fs.readFile(candidatePath);
const archive = await JSZip.loadAsync(candidate);
const manifestBytes = await archive.file('manifest.json').async('nodebuffer');
const jsBytes = await archive.file('bettermv.js').async('nodebuffer');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
assert.equal(manifest.version, version, 'Candidate package version mismatch');
assert.equal(manifest.require_restart, true, 'Candidate must retain its restart requirement');
assert.equal(sha(jsBytes), sha(await fs.readFile(path.join(project, 'dist/plugin/bettermv.js'))), 'Package differs from the built runtime');
assert.ok(jsBytes.includes(Buffer.from(version)), 'Runtime bundle is missing its version marker');

const previous = JSON.parse(await fs.readFile(path.join(root, 'state/rush-live-section-diagnostic-20261020/delivery.json'), 'utf8'));
const activeManifest = JSON.parse(await fs.readFile(targets[2].file, 'utf8'));
assert.equal(activeManifest.version, '0.9.0-local-export.25', 'Active runtime is no longer the diagnosed .25 build');
assert.equal(sha(await fs.readFile(targets[0].file)), previous.pluginSha256.toLowerCase(), 'Active plugin package differs from the diagnosed .25 package');
assert.equal(sha(await fs.readFile(targets[1].file)), previous.expectedBundleSha256.toLowerCase(), 'Active runtime differs from the diagnosed .25 bundle');

const regressionPath = path.join(root, 'exports/Rush-form-20261020/regression.json');
const regression = JSON.parse(await fs.readFile(regressionPath, 'utf8'));
const rush = regression.results.find(item => item.name === 'local');
assert.ok(rush?.lateCutRecovery, 'The D: Rush Over Me late-cut regression did not complete');
assert.ok(Math.abs(rush.lateCutRecovery.detected - 192) < .08, 'D: audio late-cut recovery is outside the accepted timing window');

await fs.mkdir(path.join(state, 'installed-before'), { recursive: true });
const oldFiles = new Map();
for (const target of targets) {
  const bytes = await fs.readFile(target.file);
  oldFiles.set(target.file, bytes);
  await fs.writeFile(path.join(state, target.backup), bytes, { flag: 'wx' });
}
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
const report = {
  version,
  installedAt: new Date().toISOString(),
  rootCause: 'The late coarse Drop boundary was accepted as active without searching backward for the sustained low-frequency release.',
  fix: 'Backscan up to one bar for a kick-supported bass and RMS attack, then confirm sustained low, high and full-band levels.',
  standalone,
  pluginSha256: sha(candidate),
  runtimeBundleSha256: sha(jsBytes),
  installed,
  activePaths: targets.map(target => target.file),
  backupDirectory: path.join(state, 'installed-before'),
  inputAudio: audio,
  inputAudioSha256: sha(await fs.readFile(audio)),
  regression: regressionPath,
  lateCutRecovery: rush.lateCutRecovery,
  requiresRestart: true,
  liveProcessLoaded: false,
};
await fs.writeFile(path.join(state, 'delivery.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ version, pluginSha256: report.pluginSha256, runtimeBundleSha256: report.runtimeBundleSha256, installed, standalone, backupDirectory: report.backupDirectory }));
