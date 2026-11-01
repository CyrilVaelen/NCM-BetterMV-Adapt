import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import JSZip from 'jszip';
import ffmpeg from 'ffmpeg-static';
import { loadSettings, PROJECT } from './server.mjs';

const phoenixPreview = path.join(PROJECT, 'public/previews/phoenix.webp');
const phoenixPng = path.resolve(PROJECT, '../exports/phoenix-beautiful-creatures-drop/02_drop1_blast_downstroke.png');
try {
  await fs.access(phoenixPng);
  execFileSync(ffmpeg, ['-y', '-i', phoenixPng, '-vf', 'scale=320:180', '-quality', '85', phoenixPreview], { stdio: 'ignore' });
} catch {}

const velvetPreview = path.join(PROJECT, 'public/previews/velvet.webp');
const velvetPng = path.resolve(PROJECT, '../exports/velvet-deep-house-20261030/01_velvet_lounge_hero.png');
try {
  await fs.access(velvetPng);
  execFileSync(ffmpeg, ['-y', '-i', velvetPng, '-vf', 'scale=480:270:flags=lanczos', '-quality', '85', velvetPreview], { stdio: 'ignore' });
} catch {}

const VERSION = '0.9.0-local-export.41';
const settings=await loadSettings();
await build({root:PROJECT,configFile:path.join(PROJECT,'vite.plugin.config.ts'),define:{__BMV_EXPORT_TOKEN__:JSON.stringify(settings.token),__VERSION__:JSON.stringify(VERSION)}});
const zip=new JSZip();
const manifest=JSON.parse(await fs.readFile(path.join(PROJECT,'plugin/manifest.json'),'utf8'));
manifest.name='BetterMV（本地增强版）';
manifest.version=VERSION;
manifest.description='大幅提速画面准备与切歌速度（音频分析磁盘缓存、常驻 WebGL 着色器保活池、全场景静态着色器与 D3D11 编译加速、场景懒实例化与前瞻渐进预热，实现秒开秒切）；保留全链路歌词防重影与夜城灯光效果。';
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
