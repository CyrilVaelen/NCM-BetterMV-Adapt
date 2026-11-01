import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';

const root=path.resolve('..'),version='0.9.0-local-export.5';
const report=JSON.parse(await fs.readFile(path.join(root,'BetterNCM/setup/structure-response-20261016.json'),'utf8'));
const plugin=await fs.readFile(report.installed),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(report.version,version);assert.equal(hash(plugin),report.sha256);
const inner=await JSZip.loadAsync(plugin),code=await inner.file('bettermv.js').async('string');
assert.ok(code.includes(version));
const zip=new JSZip();
zip.file('BetterMV-0.9.0-local-export.plugin',plugin);
zip.file('BetterMV/playback-sync.json',await fs.readFile(path.join(root,'BetterNCM/BetterMV/playback-sync.json')));
zip.file('更新说明.md',await fs.readFile(path.join(root,'Sunshine电钢琴与同步更新说明.md')));
zip.file('安装说明.txt','\ufeff'+`BetterMV 本地增强版 ${version}

本压缩包保存了当前已安装并验证的插件。此电脑已安装，无需重复安装。

如需恢复安装：
1. 退出网易云音乐。
2. 把 BetterMV-0.9.0-local-export.plugin 放入 D:\\NCM\\BetterNCM\\plugins，替换同名插件；不要同时保留两个 BetterMV 版本。
3. 将压缩包内 BetterMV 文件夹中的 playback-sync.json 放入 D:\\NCM\\BetterNCM\\BetterMV。
4. 重新启动网易云音乐，点击 MV 或按 Ctrl+Shift+M。

本版保留电钢琴与全曲旋律响应，并校验实际鼓点对应的高潮入口，修正 Sunshine 四处提前进入高潮镜头的问题。已撤回上次 +1500 ms 的估计补偿；详见“更新说明.md”。

本地 MP4 导出仍需运行 D:\\NCM 下已有的 MV 导出服务。这个压缩包包含插件，不包含完整导出服务或网易云音乐、BetterNCM 安装程序。如移到其他电脑，需另行配置这些依赖。
`);
zip.file('SHA256.txt',`${report.sha256}  BetterMV-0.9.0-local-export.plugin\r\n`);
const output=path.join(root,`BetterMV-${version}.zip`);
await fs.writeFile(output,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}}));
const readback=await fs.readFile(output),checked=await JSZip.loadAsync(readback,{checkCRC32:true});
assert.equal(hash(await checked.file('BetterMV-0.9.0-local-export.plugin').async('nodebuffer')),report.sha256);
const calibration=JSON.parse(await checked.file('BetterMV/playback-sync.json').async('string'));
assert.equal(calibration.delaysMs['17285341'],0);
console.log(JSON.stringify({output,version,bytes:readback.length,sha256:hash(readback),files:Object.keys(checked.files)}));
