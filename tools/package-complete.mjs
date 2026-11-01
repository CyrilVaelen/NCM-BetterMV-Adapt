import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const project=process.cwd(),root=path.resolve('..'),version='0.9.0-local-export.15',prefix='BetterMV-Full/';
const report=JSON.parse(await fs.readFile(path.join(root,'BetterNCM/setup/all-scene-response-20261018.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const plugin=await fs.readFile(report.installed);assert.equal(hash(plugin),report.sha256);
const settings=JSON.parse(await fs.readFile(path.join(root,'BetterNCM/setup/export-settings.json'),'utf8'));
const inner=await JSZip.loadAsync(plugin);assert.ok((await inner.file('bettermv.js').async('string')).includes(settings.token));
const zip=new JSZip(),entries=[];let uncompressedBytes=0;
const addFile=async(source,target)=>{const size=(await fs.stat(source)).size;entries.push({path:target,bytes:size});uncompressedBytes+=size;zip.file(prefix+target,createReadStream(source));};
async function walk(directory,target,filter=()=>true){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    if(entry.isSymbolicLink())continue;
    const next=target+'/'+entry.name;if(!filter(next))continue;
    const source=path.join(directory,entry.name);
    if(entry.isDirectory())await walk(source,next,filter);else await addFile(source,next);
  }
}
const keep=name=>!/(?:^|\/)\.git(?:\/|$)/.test(name)&&!/(?:^|\/)tools\/\.(?:timbre-baseline|lead-redo-baseline|sunshine-redo-baseline|all-scene-response)(?:\/|$)/.test(name)&&!/(?:^|\/)node_modules\/(?:\.vite[^/]*|\.cache)(?:\/|$)/.test(name)&&!(/\/ffprobe-static\/bin\//.test(name)&&!(/\/ffprobe-static\/bin\/(?:win32(?:\/x64(?:\/|$))?)?$/.test(name)||/\/ffprobe-static\/bin\/win32\/x64\//.test(name)));
await walk(project,'NCM-BetterMV-0.9.0',name=>keep(name)&&!/(?:lights-out-priority-render|redo-lights-out-render|sunshine-redo-render|all-scene-response-render|sunshine-timbre-debug|sunshine-form-diagnose|sunshine-form-regression|\.lead-audit-[^/]+)\.mjs$/.test(name)&&!name.endsWith('/tools/sunshine-keys-probe.ts'));
const runtime=path.dirname(process.execPath);
for(const name of ['node.exe','npm.cmd','npx.cmd'])await addFile(path.join(runtime,name),'runtime/'+name);
await walk(path.join(runtime,'node_modules/npm'),'runtime/node_modules/npm');
zip.file(prefix+'runtime/LICENSE.node.txt',await fs.readFile(path.join(root,'state/node-runtime-LICENSE.txt')));
zip.file(prefix+'BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin',plugin);
zip.file(prefix+'BetterNCM/BetterMV/playback-sync.json',await fs.readFile(path.join(root,'BetterNCM/BetterMV/playback-sync.json')));
zip.file(prefix+'BetterNCM/setup/export-settings.json',JSON.stringify({token:settings.token,port:5196},null,2));
zip.file(prefix+'start-service.mjs',await fs.readFile('tools/complete-start.mjs'));
zip.file(prefix+'self-test.mjs',await fs.readFile('tools/complete-selftest.mjs'));
for(const [label,args,pause] of [['启动MV导出工具','',false],['检查运行环境',' --check',true]])zip.file(prefix+label+'.cmd',`@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\nset "PATH=%~dp0runtime;%PATH%"\r\ncd /d "%~dp0NCM-BetterMV-0.9.0"\r\n"%~dp0runtime\\node.exe" "%~dp0start-service.mjs"${args}\r\n${pause?'pause':'if errorlevel 1 pause'}\r\n`);
const guides=(await fs.readdir(root)).filter(n=>n.endsWith('.md'));
for(const name of guides)zip.file(prefix+'使用说明/'+name,await fs.readFile(path.join(root,name)));
zip.file(prefix+'安装与使用.txt','\ufeff'+`BetterMV 完整包 ${version}（Windows 64 位）

这份包含：修改后的插件、全部项目源码、MP4 导出服务、所需 Node.js/npm、Windows 依赖、FFmpeg/FFprobe、配置及说明。支持在 D 盘使用。

使用方法：
1. 完整解压，不要在 ZIP 内直接运行。建议解压到 D 盘较短路径，并保留文件夹结构。
2. 本机已经安装最新版插件，无需重复安装。恢复插件时：退出网易云，将 BetterNCM\\plugins 中的 .plugin 复制到实际 BetterNCM 数据目录的 plugins；将 BetterNCM\\BetterMV\\playback-sync.json 复制到其 BetterMV 文件夹，再启动网易云。不要同时保留两个 BetterMV 版本。
3. 双击“启动MV导出工具.cmd”。程序会自动按当前解压位置生成导出路径，不依赖原来的 D:\\NCM 目录，也不要求另装 Node.js。
4. 在网易云打开歌曲 MV，点击“导出视频”。本包独立运行时，视频写入本包的 exports 文件夹；如果原来的兼容导出服务已在运行，会复用它，导出目录以工具页面显示为准。
5. 可双击“检查运行环境.cmd”查看运行环境检查结果。导出过程中保留服务窗口。

需要已安装网易云音乐、BetterNCM 和 Microsoft Edge。这些宿主应用的安装程序不属于此包。

本版改动：保留之前的 MP4 导出、melodic dubstep 段落识别、本地 LRC 读取与声学逐字对齐。全场景主体音色响应：所有场景和外观，包括 Drop 以外段落，都从 synth stab、bass stab、lead 的声学估计获取相应高亮与主体运动。当明亮 lead 与 bass 起音同时出现时，lead 优先驱动画面主体和高亮；bass 单独出现时仍保留低频冲击。鼓点保留轻量节拍感，不能单独触发强高亮。声部分类是混合音频估计，不是分轨或具体乐器型号识别。详细记录在“使用说明”文件夹。

.8 修复本地 LRC 读取：使用 BetterNCM 原生文件选择器取得完整路径，不再把浏览器提供的文件名当作路径；读取前验证文件，直接解码文件字节，兼容 UTF-8 / UTF-16 与常见 Windows 中文编码。若旧绑定仅保存了文件名，请在设置中点“更改文件”重新选择。选错路径或读取失败时保留原绑定，并在设置内显示原因。

.9 修改底层段落识别：用重复出现的音色/节奏、鼓组、频带展开及低频发音起伏区分持续铺垫与真正 Drop，再结合演唱上下文区分主歌、预副歌和副歌。没有按歌名、ID 或指定时间写特例。Love Is A Highway 四处反馈已检查；现有其他八首录音的十一种输入与 .8 基线一致。安装后完全退出并重开网易云，再重新打开 MV 分析。详情见“本次更新说明.md”。

.10 首次增加主体声部的声学估计，主要应用于 Drop 高亮场景。

.11 将 synth stab、bass stab、lead 的估计信号接入全部场景和画面外观。低音短音控制冲击和波纹，合成器短音控制闪光和碎片，持续主奏控制全曲主体起伏与两侧旋律线；频谱纹理和非 Drop 段落也统一响应。鼓镲仍有轻量节拍感，不能单独触发强高亮。复杂重叠音色可能误判；本功能不是分轨。

.12 曾尝试调整 lead/bass 优先级；用户反馈未通过，已由 .13 取代，旧静帧检查不能证明连续观感正确。

.13 重做 lead 优先：高声部独立计算亮度与起音，短促 lead 不再被漏掉；整句旋律连续持有优先权，音符间隙也不让低音瞬时抢占。事件、衰减脉冲和频谱灯光统一仲裁，隧道与推进的主冲击和加速跟随主体音色。连续 Drop 保持场景、外观和相机时钟，取消推进内部定期换世界、全屏反色与闪回；只有全曲混音明确停顿才允许内部切镜。分析版本升为 7，重新打开 MV 后自动重算旧缓存。

.14 修复长器乐前奏被短段落规则误标、电钢琴与复音短和弦在选择性声部路径中丢失响应的问题。以本机《Sunshine》重新分析和连续音画对照，保留.13的明亮lead优先及连续Drop。分析版本升为8；完全退出并重开网易云，再重新打开MV。详细验证与边界见使用说明里的Sunshine更新说明。

.15 逐一补齐 37 个场景的持续旋律运动与起音高亮，柔和画风、原生水墨和无歌词状态均有主体响应。声道/分形的强运动不再仅在 Drop 有效，光柱强光环只接收通过仲裁的音色事件；示波器仍保留原始波形坐标，仅增强笔触与边框。保留全部以前改动。实际覆盖和验证边界见“全场景旋律响应更新说明.md”。无需清除音乐分析缓存，完全退出重开网易云即可加载新场景代码。

逐字对齐仍使用可选的约 400 MB 对齐包。本机已安装；这份 ZIP 不重复收录模型。换电脑后在插件设置中下载对齐包，再导入自己的本地 LRC。首次分析时等待完成后再导出，即可使用计算后的词时间。

源码位于 NCM-BetterMV-0.9.0，依赖已随包附带。runtime 内提供 Node.js/npm，项目 package-lock.json 保留。导出核心在 exporter，插件与分析、场景代码在 src。辅助回归脚本中需要原始音乐素材的检查仍须自行提供相应素材。使用说明中的历史 D:\\NCM 路径是原工作区记录，当前路径以解压位置及工具页面为准。导出服务已关闭不需要的开发通信连接，避免与原工作区的服务冲突。

本包不收录歌曲音频、网易云个人数据或已导出的视频。插件与导出服务配置已配对，请作为一套使用。
`);
const sourceHashes={};for(const file of ['src/analysis/entries.ts','src/analysis/index.ts','src/analysis/sections.ts','src/plugin/playback-sync.ts','exporter/server.mjs','exporter/runner.mjs','package-lock.json'])sourceHashes[file]=hash(await fs.readFile(file));
for(const [file,digest] of Object.entries(report.sourceHashes)){assert.equal(hash(await fs.readFile(file)),digest);sourceHashes[file]=digest;}
zip.file(prefix+'本次更新说明.md',await fs.readFile(path.join(root,'全场景旋律响应更新说明.md')));
const manifest={version,platform:'win32-x64',node:process.version,pluginSha256:report.sha256,sourceHashes,fileCount:entries.length,uncompressedSourceAndRuntimeBytes:uncompressedBytes,sourceFiles:entries.filter(e=>e.path.startsWith('NCM-BetterMV-0.9.0/')&&!e.path.includes('/node_modules/')).map(e=>e.path),foreignFfprobeBinariesExcluded:true,validation:{automated:report.validation.automated,visual:report.validation.visual.map(({scene,clip,frames,quality})=>({scene,clip,frames,quality})),limitations:report.limits}};
zip.file(prefix+'release.json',JSON.stringify(manifest,null,2));
const output=path.join(root,`BetterMV-${version}-complete-win64.zip`);
await pipeline(zip.generateNodeStream({type:'nodebuffer',streamFiles:true,compression:'DEFLATE',compressionOptions:{level:6}}),createWriteStream(output));
const bytes=await fs.readFile(output);const summary={output,topFolder:'BetterMV-Full',version,bytes:bytes.length,sha256:hash(bytes),fileCount:Object.values(zip.files).filter(e=>!e.dir).length,uncompressedSourceAndRuntimeBytes:uncompressedBytes};
await fs.writeFile(path.join(root,'state/full-package-build.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
