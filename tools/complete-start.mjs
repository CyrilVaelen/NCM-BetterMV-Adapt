// Template copied to the full bundle root as start-service.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {loadSettings,startServer} from './NCM-BetterMV-0.9.0/exporter/server.mjs';
import ffmpeg from './NCM-BetterMV-0.9.0/node_modules/ffmpeg-static/index.js';
import ffprobe from './NCM-BetterMV-0.9.0/node_modules/ffprobe-static/index.js';

export const ROOT=path.dirname(fileURLToPath(import.meta.url));
export async function configurePortable(){
  const file=path.join(ROOT,'BetterNCM/setup/export-settings.json'),settings=await loadSettings(file);
  if(!/^[a-f0-9]{64}$/.test(settings.token))throw new Error('导出配置损坏，请重新解压完整包。');
  settings.port=5196;
  settings.jobDir=path.join(ROOT,'BetterNCM/export-jobs');
  settings.outputDir=path.join(ROOT,'exports');
  settings.ffmpegPath=ffmpeg;settings.ffprobePath=ffprobe.path;
  const edgeCandidates=[process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean).map(base=>path.join(base,'Microsoft/Edge/Application/msedge.exe'));
  let edge;
  for(const file of edgeCandidates){try{if((await fs.stat(file)).isFile()){edge=file;break;}}catch{}}
  if(!edge)throw new Error('未找到 Microsoft Edge。请先安装 Edge，再启动导出工具。');
  settings.edgePath=edge;
  await fs.mkdir(settings.jobDir,{recursive:true});await fs.mkdir(settings.outputDir,{recursive:true});
  await fs.writeFile(file,JSON.stringify(settings,null,2));
  return settings;
}
export async function checkRuntime(settings){
  if(process.platform!=='win32'||process.arch!=='x64')throw new Error('这个完整包适用于 Windows 64 位。');
  for(const executable of [process.execPath,ffmpeg,ffprobe.path,settings.edgePath])await fs.access(executable);
  for(const executable of [ffmpeg,ffprobe.path]){
    const result=spawnSync(executable,['-version'],{windowsHide:true,encoding:'utf8'});
    if(result.status!==0)throw new Error('视频工具无法运行：'+path.basename(executable));
  }
  return {ok:true,node:process.version,platform:process.platform,arch:process.arch,ffmpeg:true,ffprobe:true,edge:true,outputDir:settings.outputDir};
}
async function main(){
  const settings=await configurePortable(),report=await checkRuntime(settings);
  if(process.argv.includes('--check')){console.log(JSON.stringify(report));return;}
  const base=`http://127.0.0.1:${settings.port}`;let existing;
  try{const response=await fetch(base+'/api/health',{headers:{'X-BetterMV-Token':settings.token},signal:AbortSignal.timeout(1500)});if(response.ok)existing=await response.json();}catch{}
  let app;
  if(existing?.ok)console.log('MV 导出服务已经在运行。导出目录：'+existing.outputDir);
  else{
    app=await startServer({settings});console.log('MV 导出服务已启动。导出目录：'+settings.outputDir);
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void app.close().finally(()=>process.exit(0));});
  }
  console.log('回到网易云的 MV 页面，点击“导出视频”。关闭服务窗口后，新的导出任务将无法开始。');
  if(!process.argv.includes('--no-open'))spawn('rundll32.exe',['url.dll,FileProtocolHandler',base+'/exporter/dashboard.html#'+settings.token],{windowsHide:true,stdio:'ignore'}).unref();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('启动失败：'+error.message);process.exitCode=1;});
