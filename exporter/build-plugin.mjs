import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import JSZip from 'jszip';
import { loadSettings, PROJECT } from './server.mjs';

const VERSION = '0.9.0-local-export.84';
const PLUGIN_NAME = 'BetterMV（增强定制版）';
const PLUGIN_AUTHOR = 'CyrilVaelen (基于 XIAOMING6680 v0.9.0 原版定制)';
const PLUGIN_REPO = 'https://github.com/CyrilVaelen/NCM-BetterMV-Adapt';

// 同步更新 plugin/manifest.json、package.json 与 README.md 中的版本号及仓库元数据
const manifestPath = path.join(PROJECT, 'plugin/manifest.json');
const baseManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (baseManifest.version !== VERSION || baseManifest.name !== PLUGIN_NAME || baseManifest.author !== PLUGIN_AUTHOR || baseManifest.author_link !== PLUGIN_REPO) {
  baseManifest.name = PLUGIN_NAME;
  baseManifest.version = VERSION;
  baseManifest.author = PLUGIN_AUTHOR;
  baseManifest.author_link = PLUGIN_REPO;
  await fs.writeFile(manifestPath, JSON.stringify(baseManifest, null, 2) + '\n');
}
const pkgPath = path.join(PROJECT, 'package.json');
const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
if (pkg.version !== VERSION) {
  pkg.version = VERSION;
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
const readmePath = path.join(PROJECT, 'README.md');
try {
  const readme = await fs.readFile(readmePath, 'utf8');
  const nextReadme = readme.replace(/0\.9\.0-local-export\.\d+/g, VERSION);
  if (nextReadme !== readme) await fs.writeFile(readmePath, nextReadme);
} catch {}

const settings=await loadSettings();
await build({root:PROJECT,configFile:path.join(PROJECT,'vite.plugin.config.ts'),define:{__BMV_EXPORT_TOKEN__:JSON.stringify(settings.token),__VERSION__:JSON.stringify(VERSION)}});
const zip=new JSZip();
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
manifest.name=PLUGIN_NAME;
manifest.version=VERSION;
manifest.author=PLUGIN_AUTHOR;
manifest.author_link=PLUGIN_REPO;
manifest.description='大幅提速画面准备与切歌速度（音频分析磁盘缓存、常驻 WebGL 着色器保活池、全场景静态着色器与 D3D11 编译加速、场景懒实例化与前瞻渐进预热，实现秒开秒切）；内置 49 个实时 3D 舞台场景（完整集成琉璃圣堂、午夜高架、千灯天阙、日蚀裂谷 4 大新场景）、全局铺垫坍缩与 Drop 折射冲击波后处理转场、段落媒介滤镜（彩绘镶嵌玻璃、工程蓝图线稿）、5 种母风格，支持手动选择音乐风格并动态调整各场景出现概率。';
const manifestJson = JSON.stringify(manifest,null,2);
zip.file('manifest.json',manifestJson);
for(const [source,target] of [['dist/plugin/bettermv.js','bettermv.js'],['plugin/preview.jpg','preview.jpg'],['LICENSE','LICENSE']])zip.file(target,await fs.readFile(path.join(PROJECT,source)));
for(const dir of ['fonts','previews'])for(const name of await fs.readdir(path.join(PROJECT,'public',dir))){
  if(dir==='fonts'&&!/\.(ttf|woff2|txt)$/i.test(name))continue;
  if(dir==='previews'&&!/\.webp$/i.test(name))continue;
  zip.file(`${dir}/${name}`,await fs.readFile(path.join(PROJECT,'public',dir,name)));
}
const pluginBuf = await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
const output=path.resolve(PROJECT,'../BetterMV-0.9.0-local-export.plugin');
await fs.writeFile(output, pluginBuf);
console.log(`Export plugin built: ${output}`);

// 同步部署到 BetterNCM 插件目录与运行目录
const bncmRoot = process.env.BETTERNCM_PROFILE || path.resolve(PROJECT, '../BetterNCM');
try {
  const pluginsDir = path.join(bncmRoot, 'plugins');
  await fs.access(pluginsDir);
  const installedPlugin = path.join(pluginsDir, 'BetterMV-0.9.0-local-export.plugin');
  await fs.writeFile(installedPlugin, pluginBuf);
  console.log(`Deployed to BetterNCM plugins: ${installedPlugin}`);

  const runtimeDir = path.join(bncmRoot, 'plugins_runtime', 'ncm-better-mv');
  await fs.mkdir(path.join(runtimeDir, 'previews'), { recursive: true });
  await fs.writeFile(path.join(runtimeDir, 'manifest.json'), manifestJson);
  await fs.copyFile(path.join(PROJECT, 'dist/plugin/bettermv.js'), path.join(runtimeDir, 'bettermv.js'));
  for (const name of await fs.readdir(path.join(PROJECT, 'public/previews'))) {
    if (/\.webp$/i.test(name)) {
      await fs.copyFile(path.join(PROJECT, 'public/previews', name), path.join(runtimeDir, 'previews', name));
    }
  }
  console.log(`Synced BetterNCM runtime: ${runtimeDir}`);
} catch (e) {
  console.warn('Skip BetterNCM sync:', e.message);
}
