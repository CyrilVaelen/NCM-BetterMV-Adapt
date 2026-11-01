import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const root = path.resolve('..');
const pluginFile = path.join(root, 'BetterMV-0.9.0-local-export.plugin');
const targetPlugin = path.join(root, 'BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin');
const runtimeDir = path.join(root, 'BetterNCM/plugins_runtime/ncm-better-mv');

console.log('同步部署插件到 BetterNCM...');
const buf = await fs.readFile(pluginFile);
await fs.writeFile(targetPlugin, buf);
console.log(`已写入插件包: ${targetPlugin}`);

// 确保 runtime 目录存在并解包更新 bettermv.js
await fs.mkdir(runtimeDir, { recursive: true });
const zip = await JSZip.loadAsync(buf);
const jsContent = await zip.file('bettermv.js').async('nodebuffer');
await fs.writeFile(path.join(runtimeDir, 'bettermv.js'), jsContent);
console.log(`已同步写入运行时: ${path.join(runtimeDir, 'bettermv.js')}`);

const manifest = await zip.file('manifest.json').async('nodebuffer');
await fs.writeFile(path.join(runtimeDir, 'manifest.json'), manifest);
console.log(`已同步写入清单: ${path.join(runtimeDir, 'manifest.json')}`);

console.log('BetterNCM 部署全部完成！');
