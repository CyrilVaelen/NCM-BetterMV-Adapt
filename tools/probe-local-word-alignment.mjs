// Actual plugin entry/UI + real ONNX inference through an isolated BetterNCM host adapter.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { PROJECT, loadSettings, startServer } from '../exporter/server.mjs';
const out = path.resolve(PROJECT, '../exports/Love-Is-A-Highway-local-words');
const realPack = path.resolve(PROJECT, '../BetterNCM/BetterMV/aligner');
const host = await fs.mkdtemp(path.resolve(PROJECT, '../state/local-words-host-'));
const pack = path.join(host, 'BetterMV/aligner'); await fs.mkdir(pack, { recursive: true });
for (const n of ['align.py', 'fa.py', 'installed.json']) await fs.copyFile(path.join(realPack, n), path.join(pack, n));
await fs.mkdir(out, { recursive: true });
const audioPath = 'D:/野葱视频转换器/音频转换/NURKO,Neriah - Love Is A Highway.mp3';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/NURKO,Neriah - Love Is A Highway.lrc';
const hash = b => createHash('sha256').update(b).digest('hex');
const lrc = await fs.readFile(lrcPath), beforeLrc = hash(lrc), audio = await fs.readFile(audioPath);
const uc = Buffer.from(audio); for (let i = 0; i < uc.length; i++) uc[i] ^= 0xa3;
const cache = path.join(host, 'Audio/Cache'), id = 2052331548;
const settings = await loadSettings();
const app = await startServer({ settings: { ...settings, port: 5203, jobDir: path.join(host, 'jobs'), outputDir: out } });
const errors = [], launches = [], processes = new Set(); let browser;
const below = (p, r) => p === r || p.startsWith(r + path.sep);
const writeScope = p => { const q = path.resolve(p); assert.ok(below(q, host), 'Write outside test host'); return q; };
const readScope = p => { const q = path.resolve(p); assert.ok(below(q, host) || below(q, path.join(PROJECT, 'public')) || q === path.resolve(lrcPath), 'Unexpected read: ' + q); return q; };
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await context.request.get(app.baseUrl + '/api/health', { headers: { 'X-BetterMV-Token': settings.token } });
  const cover = await fs.readFile(path.join(PROJECT, 'plugin/preview.jpg'));
  await context.route('**/*', async r => {
    const u = new URL(r.request().url());
    if(u.origin === app.baseUrl && u.pathname === '/probe-audio.uc') return r.fulfill({contentType:'application/octet-stream',body:uc});
    if (u.origin === app.baseUrl) return r.continue();
    if (u.hostname === 'fixture.invalid') return r.fulfill({ contentType: 'image/jpeg', body: cover });
    if (u.pathname.includes('/api/song/lyric')) return r.fulfill({ json: { lrc: { lyric: '[00:00.000]Online wrong sentence' }, yrc: { lyric: '[0,5000](0,2000,0)Online (2000,3000,0)wrong' } } });
    return r.fulfill({ json: {} });
  });
  const page = await context.newPage(); page.setDefaultTimeout(180000);
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR: ' + e.message); }); page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('CONSOLE ERROR: ' + m.text()); } if(m.type()==='warning'||m.text().startsWith('MV state:'))console.log(m.text()); });
  await page.exposeFunction('hostFile', async (op, p, value) => {
    const q = path.resolve(p);
    if (op === 'exists') return below(q, cache) || q === cache || await fs.stat(q).then(() => true, () => false);
    if (op === 'readDir' && q === cache) return [`${id}-1.uc`];
    if (op === 'readFileText' && q === path.join(cache, `${id}-1.idx`)) return JSON.stringify({ size: audio.length, zone: [`0 ${audio.length - 1}`] });
    if (op === 'readFile' && q === path.join(cache, `${id}-1.uc`)) return uc.toString('base64');
    if (op === 'readFileText') return fs.readFile(readScope(p), 'utf8');
    if (op === 'readFile') return (await fs.readFile(readScope(p))).toString('base64');
    if (op === 'mkdir') return fs.mkdir(writeScope(p), { recursive: true });
    if (op === 'writeFileText') return fs.writeFile(writeScope(p), value);
    if (op === 'writeFile') return fs.writeFile(writeScope(p), Buffer.from(value, 'base64'));
    if (op === 'remove') return fs.unlink(writeScope(p));
    throw new Error('Unsupported operation: ' + op);
  });
  await page.exposeFunction('hostExec', async cmd => {
    const m = cmd.match(/^cmd \/c start "" \/b "([^"]+)" "([^"]+)" "([^"]+)"$/); assert.ok(m, 'Unexpected process request');
    assert.equal(path.resolve(m[1]), path.join(pack, 'python/pythonw.exe')); assert.equal(path.resolve(m[2]), path.join(pack, 'align.py'));
    const jobPath = writeScope(m[3]), job = JSON.parse(await fs.readFile(jobPath, 'utf8'));
    // Runtime mapping only; audio, lines and algorithm come from the plugin unchanged.
    job.model = path.join(realPack, 'models/mms_fa.onnx'); job.device = 'cpu'; job.threads = 4;
    await fs.writeFile(jobPath, JSON.stringify(job));
    const run = { lines: job.lines, started: Date.now(), key: path.basename(job.out) }; launches.push(run);
    console.log(JSON.stringify({ stage: 'actual-onnx-start', run: launches.length, sentences: job.lines.length }));
    const child = spawn(path.join(realPack, 'python/python.exe'), [path.join(pack, 'align.py'), jobPath], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    processes.add(child); child.on('close', code => { processes.delete(child); console.log(JSON.stringify({ stage: 'actual-onnx-exit', code, elapsed: Date.now() - run.started })); });
    return '';
  });
  await page.goto(app.baseUrl + '/tools/lead-preview.html');
  console.log('Browser ready; loading actual plugin entry');
  await page.evaluate(async ({ host, cache, id, lrcPath, publicPath }) => {
    const { SCENES } = await import('/src/scenes/catalog.ts');
    const config = { style: 'pulse', quality: 'low', prefetch: false, button: false, offScenes: SCENES.filter(s => s.id !== 'rings').map(s => s.id).join(','), lyricDelays: JSON.stringify({ [id]: 1600 }), localLrcPaths: JSON.stringify({ [id]: lrcPath }) };
    const encode = b => { let s = ''; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s); };
    const decode = s => new Blob([Uint8Array.from(atob(s), c => c.charCodeAt(0))]);
    window.plugin = { pluginPath: publicPath, getConfig: (k, d) => config[k] ?? d, setConfig: (k, v) => { config[k] = v; }, onConfig: f => { window.configView = f; }, onLoad: f => { window.loadPlugin = f; } };
    window.betterncm = { app: { getDataPath: async () => host, exec: cmd => window.hostExec(cmd) }, fs: {
      exists: p => window.hostFile('exists', p), readDir: p => window.hostFile('readDir', p), mkdir: p => window.hostFile('mkdir', p), readFileText: p => window.hostFile('readFileText', p), readFile: async p => {
        const staticPart=p.replace(/\\/g,'/').split('/public/')[1];
        if(staticPart)return (await fetch('/'+staticPart)).blob();
        if(p.endsWith('.uc'))return (await fetch('/probe-audio.uc')).blob();
        return decode(await window.hostFile('readFile', p));
      },
      writeFileText: (p, v) => window.hostFile('writeFileText', p, v), writeFile: async (p, b) => window.hostFile('writeFile', p, encode(await b.arrayBuffer())), remove: p => window.hostFile('remove', p),
    } };
    const state = { playing: { resourceTrackId: String(id), resourceName: 'Love Is A Highway', resourceArtists: [{ name: 'NURKO' }, { name: 'Neriah' }], resourceCoverUrl: 'https://fixture.invalid/cover.jpg', curTrack: { duration: 234736 }, playingState: 1 }, app: {}, playingList: {} };
    const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} }, Bridge = { appendRegisterCall: () => {}, call: async () => {} };
    const loader = { c: { sdk: { exports: { Bridge, Storage: { cacheDir: cache.replace(/[\\/]Cache$/, '') } } }, dva: { exports: { a: { inited: true, app: { _store: store }, getStore: () => store } } } } };
    window.webpackJsonp = []; window.webpackJsonp.push = chunk => Object.values(chunk[1]).forEach(f => f({}, {}, loader)); window.TEST_CONFIG = config;
    await import('/src/plugin/main.ts'); window.loadPlugin();
  }, { host, cache, id, lrcPath, publicPath: path.join(PROJECT, 'public') });
  console.log('Plugin module loaded; waiting for client adapter');
  await page.waitForFunction(() => typeof window.__betterMv?.open === 'function');
  console.log('Client found; opening MV with real audio');
  await page.evaluate(() => { window.PROBE_TIMER = setInterval(() => console.log('MV state: '+document.body.innerText.slice(-450)), 15000); });
  let prepareTimer;
  try { await Promise.race([page.evaluate(() => window.__betterMv.open()), new Promise((_,reject)=>{prepareTimer=setTimeout(()=>reject(new Error('MV prepare timeout')),240000);})]); }
  finally { clearTimeout(prepareTimer); }
  await page.evaluate(() => window.__betterMv.close());
  await page.evaluate(() => clearInterval(window.PROBE_TIMER));
  const before = await page.evaluate(() => {
    const p = window.__betterMv.player;
    window.BEFORE = { analysis: p.song.analysis, analysisJson: JSON.stringify(p.song.analysis), seed: p.seed, shots: JSON.stringify(p.director.shots), music: [8, 22, 60, 131, 185].map(t => ({ t, lead: p.music.leadAt(t), beat: p.music.at(t) })), lines: structuredClone(p.song.analysisLines) };
    return { sentences: p.song.lines.length, estimates: p.song.lines.filter(l => !l.timedWords).length, first: p.song.lines[0].start };
  }); assert.equal(before.sentences, 53);
  await page.waitForFunction(() => window.__betterMv.player.song.lines.some(l => l.timedWords), undefined, { timeout: 180000 });
  const after = await page.evaluate(async () => {
    const p = window.__betterMv.player, b = window.BEFORE, local = await import('/src/lyrics/local.ts'), a = await import('/src/plugin/aligner.ts');
    const cached = await a.cachedAlignment(p.song.id, b.lines, 'local-locked');
    const reloaded = local.parseLocalLrc(await betterncm.fs.readFileText(JSON.parse(TEST_CONFIG.localLrcPaths)[p.song.id]), p.song.duration);
    const cacheCounts = a.applyLockedAlignment(reloaded, cached);
    const view = window.configView(); document.body.append(view);
    return { lines: p.song.lines, analysisLines: p.song.analysisLines, cacheCounts,
      sameAnalysisObject: p.song.analysis === b.analysis, sameAnalysis: JSON.stringify(p.song.analysis) === b.analysisJson, sameSeed: p.seed === b.seed, sameShots: JSON.stringify(p.director.shots) === b.shots,
      sameMusic: JSON.stringify([8, 22, 60, 131, 185].map(t => ({ t, lead: p.music.leadAt(t), beat: p.music.at(t) }))) === JSON.stringify(b.music),
      cacheSame: JSON.stringify(reloaded.map(l => l.words)) === JSON.stringify(p.song.lines.map(l => l.words)),
      delayedCopiesRefreshed: p.lines.every((l, i) => l.start === p.song.lines[i].start + 1.6 && l.words.every((w, j) => w.start === p.song.lines[i].words[j].start + 1.6 && w.end === p.song.lines[i].words[j].end + 1.6)), summary: view.innerText };
  });
  for (const k of ['sameAnalysisObject', 'sameAnalysis', 'sameSeed', 'sameShots', 'sameMusic', 'cacheSame', 'delayedCopiesRefreshed']) assert.equal(after[k], true, k);
  assert.ok(after.cacheCounts.aligned >= 25, 'Too few real acoustic fits');
  assert.deepEqual(after.lines.map(l => [l.start, l.end]), after.analysisLines.map(l => [l.start, l.end]));
  assert.ok(after.lines.every(l => l.words.every(w => w.start >= l.start && w.end <= l.end)));
  assert.equal(launches.length, 1); console.log(JSON.stringify({ stage: 'automatic-alignment-passed', counts: after.cacheCounts }));
  await page.getByRole('button', { name: '重新读取文件', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('已重新读取'));
  await page.waitForFunction(() => window.__betterMv.player.song.lines.some(l => l.timedWords)); assert.equal(launches.length, 1, 'Reload must reuse local cache');
  await page.getByRole('button', { name: '按音频重新逐字对齐', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('正在按音频逐字对齐…'));
  const retryDeadline = Date.now() + 30000;
  while(launches.length < 2 && Date.now() < retryDeadline) await new Promise(r=>setTimeout(r,100));
  assert.equal(launches.length, 2, 'Manual retry did not launch inference');
  // Restore while the second inference runs; its obsolete result must be discarded.
  await page.getByRole('button', { name: '恢复网易云歌词', exact: true }).click();
  await page.waitForFunction(() => window.__betterMv.player.song.lines[0]?.text === 'Online wrong');
  while (processes.size || launches.length < 2) await new Promise(r => setTimeout(r, 500));
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__betterMv.player.song.lines[0].text), 'Online wrong'); assert.equal(launches.length, 2, 'Retry must bypass cache');
  assert.deepEqual(errors, []); assert.equal(hash(await fs.readFile(lrcPath)), beforeLrc);
  const report = { song: 'Love Is A Highway', audio: audioPath, audioSha256: hash(audio), lrc: lrcPath, lrcSha256: beforeLrc, before, after, modelRuns: launches.length, launches, obsoleteResultDiscarded: true, cachedReload: true, errors, host, limits: 'Actual plugin main/settings in Edge with isolated BetterNCM adapter; installed Python/ONNX model on CPU with 4 threads. Running NetEase was not controlled.' };
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, counts: after.cacheCounts, modelRuns: launches.length, report: path.join(out, 'verification.json') }));
} catch(e) { console.error(e); throw e; }
finally { for (const p of processes) p.kill(); console.log('Closing test browser'); await browser?.close(); console.log('Closing isolated service'); await app.close(); }
