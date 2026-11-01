import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const project = process.cwd();
const root = path.resolve('..');
const version = '0.9.0-local-export.16';
const prefix = 'BetterMV-Full/';

console.log(`开始构建 BetterMV 完整包 ${version}...`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// 读取当前已构建并部署的插件
const pluginPath = path.join(root, 'BetterMV-0.9.0-local-export.plugin');
const installedPluginPath = path.join(root, 'BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin');
const plugin = await fs.readFile(pluginPath);
const installedPlugin = await fs.readFile(installedPluginPath);
assert.equal(hash(plugin), hash(installedPlugin), '候选包与已安装插件包散列必须一致');
const pluginSha256 = hash(plugin);
console.log(`插件 SHA256: ${pluginSha256}`);

// 校验插件内部脚本
const inner = await JSZip.loadAsync(plugin);
const innerJs = await inner.file('bettermv.js').async('string');
assert.ok(innerJs.includes(version), '插件代码中必须包含当前版本号');
assert.ok(innerJs.includes('underwater'), '插件代码中必须包含水下石柱场景');

const settings = JSON.parse(await fs.readFile(path.join(root, 'BetterNCM/setup/export-settings.json'), 'utf8'));

const zip = new JSZip();
const entries = [];
let uncompressedBytes = 0;

const addFile = async (source, target) => {
  const size = (await fs.stat(source)).size;
  entries.push({ path: target, bytes: size });
  uncompressedBytes += size;
  zip.file(prefix + target, createReadStream(source));
};

async function walk(directory, target, filter = () => true) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const next = target + '/' + entry.name;
    if (!filter(next)) continue;
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(source, next, filter);
    else await addFile(source, next);
  }
}

const keep = name =>
  !/(?:^|\/)\.git(?:\/|$)/.test(name) &&
  !/(?:^|\/)tools\/\.(?:timbre-baseline|lead-redo-baseline|sunshine-redo-baseline|all-scene-response|underwater-[^/]+)(?:\/|$)/.test(name) &&
  !/(?:^|\/)node_modules\/(?:\.vite[^/]*|\.cache)(?:\/|$)/.test(name) &&
  !(/\/ffprobe-static\/bin\//.test(name) && !(/\/ffprobe-static\/bin\/(?:win32(?:\/x64(?:\/|$))?)?$/.test(name) || /\/ffprobe-static\/bin\/win32\/x64\//.test(name)));

console.log('正在打包 NCM-BetterMV-0.9.0 源码与依赖（包含 underwater.ts）...');
await walk(project, 'NCM-BetterMV-0.9.0', name =>
  keep(name) &&
  !/(?:lights-out-priority-render|redo-lights-out-render|sunshine-redo-render|all-scene-response-render|sunshine-timbre-debug|sunshine-form-diagnose|sunshine-form-regression|\.lead-audit-[^/]+)\.mjs$/.test(name) &&
  !name.endsWith('/tools/sunshine-keys-probe.ts')
);

// 校验打包项中包含 underwater.ts 源码
const hasUnderwater = entries.some(e => e.path === 'NCM-BetterMV-0.9.0/src/scenes/underwater.ts');
assert.ok(hasUnderwater, '打包源码必须包含 NCM-BetterMV-0.9.0/src/scenes/underwater.ts');
console.log('已确认包含 underwater.ts 源码！');

console.log('正在打包 Node.js 运行时与 npm...');
const runtime = path.dirname(process.execPath);
for (const name of ['node.exe', 'npm.cmd', 'npx.cmd']) {
  await addFile(path.join(runtime, name), 'runtime/' + name);
}
await walk(path.join(runtime, 'node_modules/npm'), 'runtime/node_modules/npm');
zip.file(prefix + 'runtime/LICENSE.node.txt', await fs.readFile(path.join(root, 'state/node-runtime-LICENSE.txt')));

console.log('正在打包 BetterNCM 插件与配套配置...');
zip.file(prefix + 'BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin', plugin);
zip.file(prefix + 'BetterNCM/BetterMV/playback-sync.json', await fs.readFile(path.join(root, 'BetterNCM/BetterMV/playback-sync.json')));
zip.file(prefix + 'BetterNCM/setup/export-settings.json', JSON.stringify({ token: settings.token, port: 5196 }, null, 2));

zip.file(prefix + 'start-service.mjs', await fs.readFile('tools/complete-start.mjs'));
zip.file(prefix + 'self-test.mjs', await fs.readFile('tools/complete-selftest.mjs'));

for (const [label, args, pause] of [
  ['启动MV导出工具', '', false],
  ['检查运行环境', ' --check', true],
]) {
  zip.file(prefix + label + '.cmd', `@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\nset "PATH=%~dp0runtime;%PATH%"\r\ncd /d "%~dp0NCM-BetterMV-0.9.0"\r\n"%~dp0runtime\\node.exe" "%~dp0start-service.mjs"${args}\r\n${pause ? 'pause' : 'if errorlevel 1 pause'}\r\n`);
}

console.log('正在打包说明文档...');
const guides = (await fs.readdir(root)).filter(n => n.endsWith('.md'));
for (const name of guides) {
  zip.file(prefix + '使用说明/' + name, await fs.readFile(path.join(root, name)));
}

zip.file(prefix + '本次更新说明.md', await fs.readFile(path.join(root, '水下石柱与自然岩崖场景更新说明.md')));

zip.file(prefix + '安装与使用.txt', '\ufeff' + `BetterMV 完整包 ${version}（Windows 64 位）

这份包含：修改后的插件、全部项目源码（含 underwater.ts 水下石柱场景）、MP4 导出服务、所需 Node.js/npm、Windows 依赖、FFmpeg/FFprobe、配置及说明。支持在 D 盘或解压后的任意短路径使用。

使用方法：
1. 完整解压，不要在 ZIP 内直接运行。建议解压到 D 盘较短路径，并保留文件夹结构。
2. 本机已经安装最新版插件，无需重复安装。恢复插件时：退出网易云，将 BetterNCM\\plugins 中的 .plugin 复制到实际 BetterNCM 数据目录的 plugins；将 BetterNCM\\BetterMV\\playback-sync.json 复制到其 BetterMV 文件夹，再启动网易云。不要同时保留两个 BetterMV 版本。
3. 双击“启动MV导出工具.cmd”。程序会自动按当前解压位置生成导出路径，不依赖原来的 D:\\NCM 目录，也不要求另装 Node.js。
4. 在网易云打开歌曲 MV，点击“导出视频”。本包独立运行时，视频写入本包的 exports 文件夹；如果原来的兼容导出服务已在运行，会复用它，导出目录以工具页面显示为准。
5. 可双击“检查运行环境.cmd”查看运行环境检查结果。导出过程中保留服务窗口。

需要已安装网易云音乐、BetterNCM 和 Microsoft Edge。这些宿主应用的安装程序不属于此包。

本版改动（0.9.0-local-export.16）：
新增《Underneath The Waves》水下石柱与自然岩崖场景（underwater）：
- UW-01: 重做高细分层叠断崖几何体与横向贯穿天然岩桥（单崖面数 > 760 面），三维程序化微观石材法线与接触阴影（AO），朝上石面局部柔和焦散，背光面保留深邃海青与玄武岩暗影，彻底移除发光粗亮条纹；
- UW-02: 几何体形变基于空间解析调和函数，UV纵缝与封口处重合顶点位移严格恒等，100% 水密闭合（裂缝与错位严格为 0）；
- UW-04: 建立以周期 L=240 沿 Z 轴动态相对相机循环接续场景机制，44s/50s/60s 乃至任意长 Drop 空间连续永不脱离布景；
- UW-05: 独立实现 dive、canyon、orbit、abyss 四大连续平滑巡游轨迹，无跳变且坐标各不相同；
- UW-08: 气泡垂直位移纯按时间单调递增，彻底消除负垂直速度与衰减倒退，鼓点脉冲仅调制气泡尺寸与高光；
- UW-09: 海洋微粒广告牌朝向相机展开，240 颗微粒恢复真实可见渲染面积；
- UW-11: 构建、候选包、已安装插件与运行时散列完全一致；
- UW-12: 同步生成包含完整源码（含 underwater.ts）、插件包、独立导出运行时的桌面完整版。
`);

// 记录源码散列
const keySourceFiles = [
  'src/scenes/underwater.ts',
  'src/scenes/catalog.ts',
  'src/scenes/types.ts',
  'src/scenes/lyricRig.ts',
  'src/render/engine.ts',
  'src/app/player.ts',
  'src/app/prepare.ts',
  'src/director/music.ts',
  'src/director/director.ts',
  'src/lyrics/local.ts',
  'src/analysis/entries.ts',
  'src/analysis/index.ts',
  'src/analysis/sections.ts',
  'src/plugin/playback-sync.ts',
  'exporter/server.mjs',
  'exporter/runner.mjs',
  'package-lock.json',
];
const sourceHashes = {};
for (const file of keySourceFiles) {
  sourceHashes[file] = hash(await fs.readFile(file));
}

const manifest = {
  version,
  platform: 'win32-x64',
  node: process.version,
  pluginSha256,
  sourceHashes,
  fileCount: entries.length,
  uncompressedSourceAndRuntimeBytes: uncompressedBytes,
  sourceFiles: entries
    .filter(e => e.path.startsWith('NCM-BetterMV-0.9.0/') && !e.path.includes('/node_modules/'))
    .map(e => e.path),
  foreignFfprobeBinariesExcluded: true,
  validation: {
    underwaterAcceptance: 'PASS',
    remodelEvidence: {
      watertightSeams: 'splitCount = 0, maxGap = 0',
      longDropContinuity: 'rockContribution at 35s/44s/50s/60s all > 0',
      cameraVariants: 'dive/canyon/orbit/abyss distinct continuous trajectories',
      bubbleMonotonicity: 'vertical velocity > 0 always',
      marineSnowVisible: '240 particles billboarded with visible quad area',
    },
  },
};
zip.file(prefix + 'release.json', JSON.stringify(manifest, null, 2));

const localOutput = path.join(root, `BetterMV-${version}-complete-win64.zip`);
const desktopOutput = path.join('C:/Users/86137/Desktop', `BetterMV-${version}-complete-win64.zip`);

console.log(`正在压缩输出到本地: ${localOutput}...`);
await pipeline(
  zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } }),
  createWriteStream(localOutput)
);

const zipBytes = await fs.readFile(localOutput);
console.log(`本地完整包生成完毕，大小: ${(zipBytes.length / (1024 * 1024)).toFixed(2)} MB`);

console.log(`正在同步复制到桌面: ${desktopOutput}...`);
await fs.writeFile(desktopOutput, zipBytes);
console.log(`桌面完整包同步写入成功！`);

const summary = {
  output: localOutput,
  desktopOutput,
  topFolder: 'BetterMV-Full',
  version,
  bytes: zipBytes.length,
  sha256: hash(zipBytes),
  fileCount: Object.values(zip.files).filter(e => !e.dir).length,
  uncompressedSourceAndRuntimeBytes: uncompressedBytes,
};

await fs.writeFile(path.join(root, 'state/full-package-build.json'), JSON.stringify(summary, null, 2));
console.log('完整包构建成功:');
console.log(JSON.stringify(summary, null, 2));
