import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadSettings, PROJECT } from './server.mjs';

const settings=await loadSettings();
let running=false;
let oldVersion=false;
try{
  const response=await fetch(`http://127.0.0.1:${settings.port}/api/health`,{headers:{'X-BetterMV-Token':settings.token},signal:AbortSignal.timeout(1500)});
  if(response.ok){
    const body=await response.json();
    running=body.ok===true;
    oldVersion=Number(body.version??'1')<3;
  }
}catch{}
if(running){
  const url=`http://127.0.0.1:${settings.port}/exporter/dashboard.html#${settings.token}`;
  spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}).unref();
  if(oldVersion){
    console.log('检测到旧版 MV 导出工具仍在后台运行。请先关闭旧的“MV 导出工具”窗口后再重新运行本脚本，以启用 HEVC 10-bit 小体积与 2K 导出。');
  }else{
    console.log('MV 导出工具已在运行。请在网易云的 MV 页面点击“导出视频”。');
  }
}else{
  const child=spawn(process.execPath,[path.join(PROJECT,'exporter/server.mjs'),'--open'],{stdio:'inherit',windowsHide:true,cwd:PROJECT});
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
}
