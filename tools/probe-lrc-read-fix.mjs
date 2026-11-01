import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { PROJECT, loadSettings, startServer } from '../exporter/server.mjs';
const source = 'D:/CloudMusic/VipSongsDownload/NURKO,Neriah - Love Is A Highway.lrc';
const bytes = await fs.readFile(source), digest = b => createHash('sha256').update(b).digest('hex');
const out = path.resolve(PROJECT, '../exports/Local-LRC-read-fix-20261018'); await fs.mkdir(out, { recursive: true });
const settings = await loadSettings(), app = await startServer({ settings: { ...settings, port: 5206, jobDir: path.join(out, 'jobs'), outputDir: out } });
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1120, height: 880 } });
  await context.request.get(app.baseUrl + '/api/health', { headers: { 'X-BetterMV-Token': settings.token } });
  await context.route('**/test-lrc-bytes', r => r.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  const page = await context.newPage(), errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  await page.goto(app.baseUrl + '/tools/lead-preview.html');
  await page.evaluate(async source => {
    window.STATE = { store: {}, mode: 'valid', picked: source, nativePickerCalls: 0, reloadCalls: 0, parsed: 0, reads: 0 };
    window.plugin = { getConfig: (k, d) => STATE.store[k] ?? d, setConfig: (k, v) => { STATE.store[k] = v; } };
    window.betterncm = { app: {}, fs: {
      exists: async p => p === source,
      readFileText: async () => '', // Faithfully reproduce an empty successful HTTP/text return.
      readFile: async () => { STATE.reads++; return STATE.mode === 'empty' ? new Blob([]) : (await fetch('/test-lrc-bytes')).blob(); },
    } };
    const { loadConfig, settingsView } = await import('/src/plugin/ui.ts');
    const { readLocalLrcText, parseLocalLrc } = await import('/src/lyrics/local.ts');
    const config = loadConfig(); STATE.config = config;
    const view = settingsView(config, () => {}, async () => null, false, { id: 2052331548, name: 'Love Is A Highway' }, {
      reloadLyrics: async p => { STATE.reloadCalls++; STATE.parsed = parseLocalLrc(await readLocalLrcText(p), 234.736).length; },
    }); document.body.style.overflow = 'auto'; document.body.append(view);
  }, source);
  await page.getByRole('button', { name: '导入本地 LRC', exact: true }).click();
  const input = page.getByPlaceholder(/输入或粘贴 .lrc/);
  // Standard browser File objects provide a filename but no native absolute path.
  await page.locator('input[type=file]').setInputFiles({ name: 'Love Is A Highway.lrc', mimeType: 'text/plain', buffer: bytes });
  await page.getByText(/未获得完整路径/).waitFor(); assert.equal(await input.inputValue(), '');
  await input.fill('Love Is A Highway.lrc');
  await page.getByRole('button', { name: '确定导入', exact: true }).click();
  await page.getByText(/导入失败：需要完整文件路径/).waitFor();
  assert.deepEqual(await page.evaluate(() => STATE.config.localLrcPaths), {});
  await page.evaluate(() => { betterncm.app.openFileDialog = async () => { STATE.nativePickerCalls++; return STATE.picked; }; });
  await page.getByRole('button', { name: '浏览…', exact: true }).click();
  await page.waitForFunction(source => document.querySelector('input[type=text][placeholder]')?.value === source, source);
  await page.getByRole('button', { name: '确定导入', exact: true }).click();
  await page.getByRole('button', { name: '重新读取文件', exact: true }).waitFor();
  const valid = await page.evaluate(() => ({ bound: STATE.config.localLrcPaths['2052331548'], parsed: STATE.parsed, picker: STATE.nativePickerCalls, reloads: STATE.reloadCalls }));
  assert.equal(valid.bound, source); assert.equal(valid.parsed, 53); assert.equal(valid.picker, 1);
  await page.getByRole('button', { name: '重新读取文件', exact: true }).click();
  await page.getByRole('button', { name: '已重新读取', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => STATE.parsed), 53);
  await page.getByText('更改文件', { exact: true }).click();
  await input.fill('D:/missing-song.lrc');
  await page.getByRole('button', { name: '确定导入', exact: true }).click();
  await page.getByText(/导入失败：找不到本地 LRC 文件/).waitFor();
  assert.equal(await page.evaluate(() => STATE.config.localLrcPaths['2052331548']), source);
  await input.fill(source); await page.evaluate(() => { STATE.mode = 'empty'; });
  await page.getByRole('button', { name: '确定导入', exact: true }).click();
  await page.getByText(/导入失败：本地 LRC 读取结果为空/).waitFor();
  assert.equal(await page.evaluate(() => STATE.config.localLrcPaths['2052331548']), source);
  await page.evaluate(() => { STATE.mode = 'valid'; });
  await page.getByRole('button', { name: '确定导入', exact: true }).click();
  await page.getByRole('button', { name: '重新读取文件', exact: true }).waitFor();
  await page.getByText('本地逐字对齐', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'local-lrc-read-fixed.png') });
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, []); assert.equal(digest(await fs.readFile(source)), digest(bytes));
  const report = { source, sourceSha256: digest(bytes), parsedSentences: 53, browserFileWithoutNativePathRejected: true, nativePickerFullPathPersisted: true, missingAndEmptyReadsPreservePreviousBinding: true, sharedReaderAndReloadPassed: true, textEndpointEmptyDoesNotBlockBinaryRead: true, errors, dialogs, limit: 'Real settings UI and real LRC bytes in Edge; BetterNCM API adapter follows official 1.3.4 contract. Running NetEase was not controlled.' };
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser?.close(); await app.close(); }
