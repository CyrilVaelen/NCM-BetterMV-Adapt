import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { PROJECT, loadSettings, startServer } from '../exporter/server.mjs';
const out = path.resolve(PROJECT, '../exports/Love-Is-A-Highway-local-words');
const settings = await loadSettings();
const app = await startServer({ settings: { ...settings, port: 5205, jobDir: path.join(out, 'ui-jobs'), outputDir: out } });
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1050, height: 820 } });
  await context.request.get(app.baseUrl + '/api/health', { headers: { 'X-BetterMV-Token': settings.token } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(app.baseUrl + '/tools/lead-preview.html');
  await page.evaluate(async () => {
    const store = {}; window.plugin = { getConfig: (k, d) => store[k] ?? d, setConfig: (k, v) => { store[k] = v; } };
    const { loadConfig, settingsView } = await import('/src/plugin/ui.ts');
    const config = loadConfig(); config.localLrcPaths['2052331548'] = 'D:\\lyrics\\Love Is A Highway.lrc';
    window.UI_TEST = { config, store, failRestore: true, alignmentCalls: 0, restoreCalls: 0 };
    const view = settingsView(config, () => {}, async () => null, false, { id: 2052331548, name: 'Love Is A Highway' }, {
      alignmentStatus: () => '本地 LRC：本次对齐 36/53 句；其余 17 句保留原词时间，句子时间不变',
      alignLyrics: async () => { UI_TEST.alignmentCalls++; return '本次对齐 36/53 句，句子时间不变'; },
      reloadLyrics: async () => { UI_TEST.restoreCalls++; if (UI_TEST.failRestore) throw new Error('模拟网络失败'); },
    }); document.body.style.overflow = 'auto'; document.body.append(view);
  });
  await page.getByRole('button', { name: '按音频重新逐字对齐', exact: true }).click();
  assert.equal(await page.evaluate(() => UI_TEST.alignmentCalls), 1);
  await page.getByRole('button', { name: '恢复网易云歌词', exact: true }).click();
  await page.getByText('恢复失败，保留本地 LRC', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => UI_TEST.config.localLrcPaths['2052331548']));
  await page.locator('text=本地逐字对齐').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'local-lyrics-settings.png') });
  await page.evaluate(() => { UI_TEST.failRestore = false; });
  await page.getByRole('button', { name: '恢复网易云歌词', exact: true }).click();
  await page.getByText('网易云在线歌词', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => UI_TEST.config.localLrcPaths['2052331548']), undefined);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out, 'ui-verification.json'), JSON.stringify({ actualSettingsButtons: true, manualActionCalled: true, failedRestorePreservesBinding: true, successfulRestoreClearsBinding: true, errors }, null, 2));
  console.log('Local lyric settings UI checks passed');
} finally { await browser?.close(); await app.close(); }
