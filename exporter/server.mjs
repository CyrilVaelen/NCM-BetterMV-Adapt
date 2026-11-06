import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer as createViteServer } from 'vite';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { renderJob } from './runner.mjs';

export const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SETTINGS = path.resolve(PROJECT, '../BetterNCM/setup/export-settings.json');
const MAX_BODY = 150 * 1024 * 1024;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const terminal = state => state === 'completed' || state === 'failed';

export async function loadSettings(file = SETTINGS) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const settings = {
    token: crypto.randomBytes(32).toString('hex'), port: 5196,
    outputDir: path.resolve(PROJECT, '../exports'),
    jobDir: path.resolve(PROJECT, '../BetterNCM/export-jobs'),
  };
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(settings, null, 2), { flag: 'wx' });
  return settings;
}

export function safeFilename(name) {
  const clean = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 90);
  return !clean || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(clean) ? 'BetterMV' : clean;
}

export function validateMetadata(data) {
  const s = data?.song, f = data?.format ?? {};
  if (!s || !Number.isSafeInteger(s.id) || s.id < 1 || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 500) throw new Error('歌曲信息不完整');
  if (!Array.isArray(s.artists) || s.artists.length > 30 || s.artists.some(a => typeof a !== 'string' || a.length > 200)) throw new Error('歌手信息不正确');
  const width = f.width ?? 1920, height = f.height ?? 1080, fps = f.fps ?? 30;
  if (![[1280, 720], [1920, 1080], [2560, 1440]].some(([w,h]) => width === w && height === h) || ![24,30,60].includes(fps)) throw new Error('请选择 720p、1080p 或 1440p（2K），以及 24、30 或 60 帧');
  const encoding = f.encoding ?? 'hevc';
  if (!['hevc', 'standard', 'grain'].includes(encoding)) throw new Error('导出编码画质模式不正确');
  const start = f.start ?? 0, duration = f.duration, visualLeadMs = f.visualLeadMs;
  if (!Number.isFinite(start) || start < 0 || start > 7200 || (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || duration > 7200))) throw new Error('导出时间范围不正确');
  if (visualLeadMs !== undefined && (!Number.isFinite(visualLeadMs) || visualLeadMs < 0 || visualLeadMs > 200)) throw new Error('导出音画同步补偿范围不正确');
  if (data.lines !== undefined && (!Array.isArray(data.lines) || data.lines.length > 30000)) throw new Error('歌词数据不正确');
  if (data.analysisLines !== undefined && (!Array.isArray(data.analysisLines) || data.analysisLines.length > 30000)) throw new Error('歌词分析数据不正确');
  if (data.config !== undefined && (!data.config || typeof data.config !== 'object' || Array.isArray(data.config))) throw new Error('画面设置不正确');
  return { ...data, song: { id:s.id, name:s.name, artists:s.artists, duration:s.duration }, format:{width,height,fps,encoding,start,...(duration === undefined ? {} : {duration}),...(visualLeadMs === undefined ? {} : {visualLeadMs: Math.round(visualLeadMs)})} };
}

function json(res, code, value) {
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(value));
}
async function readBody(req) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw new Error('歌曲文件超过 150 MB，暂时无法导出');
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) throw new Error('歌曲文件超过 150 MB，暂时无法导出');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function tokenMatches(value, token) {
  const a = Buffer.from(String(value ?? '')), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
function publicJob(job) {
  const {id,state,progress,name,outputName,error,createdAt,frames,totalFrames,result} = job;
  return {id,state,progress,name,outputName,error,createdAt,frames,totalFrames,result};
}
function stamp() {
  return new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replace(/[^0-9]/g,'');
}

export async function startServer({ settings: supplied, settingsPath = SETTINGS, runner = renderJob, useVite = true } = {}) {
  const settings = supplied ?? await loadSettings(settingsPath);
  if (!/^[a-f0-9]{64}$/.test(settings.token) || !Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535) throw new Error('导出工具配置不正确');
  for (const dir of [settings.jobDir, settings.outputDir]) await fsp.mkdir(dir, {recursive:true});
  const jobs = new Map(), queue = [];
  let active = false, closing = false, activeController;
  const baseUrl = `http://127.0.0.1:${settings.port}`;
  const allowedOrigins = new Set(['orpheus://orpheus','null',baseUrl,`http://localhost:${settings.port}`]);
  const vite = useVite ? await createViteServer({
    configFile:false, root:PROJECT, publicDir:path.join(PROJECT,'public'),
    server:{middlewareMode:true,hmr:false,ws:false,host:'127.0.0.1',fs:{strict:true,allow:[PROJECT]}},
    // This is an export service, not a development page. Vite 8 still injects
    // its socket client with HMR/WS disabled; remove that unused HTML entry so
    // an unrelated local dev server cannot break a render with a socket error.
    plugins:[{name:'export-without-dev-client',transformIndexHtml:{order:'post',handler:html=>html.replace(/<script\b[^>]*\bsrc=["']\/@vite\/client["'][^>]*>\s*<\/script>/g,'')}}],
    define:{__VERSION__:JSON.stringify(JSON.parse(fs.readFileSync(path.join(PROJECT,'plugin/manifest.json'),'utf8')).version)}, logLevel:'warn',
  }) : null;
  const save = job => {
    const snapshot=JSON.stringify(publicJob(job),null,2);
    job.saving=(job.saving??Promise.resolve()).catch(()=>{}).then(async()=>{
      const temp=path.join(job.dir,'status.tmp');
      await fsp.writeFile(temp,snapshot);await fsp.rename(temp,path.join(job.dir,'status.json'));
    });
    return job.saving;
  };
  for (const id of await fsp.readdir(settings.jobDir)) {
    if (!JOB_ID.test(id)) continue;
    try {
      const dir = path.join(settings.jobDir,id), saved = JSON.parse(await fsp.readFile(path.join(dir,'status.json'),'utf8'));
      const input = JSON.parse(await fsp.readFile(path.join(dir,'input.json'),'utf8'));
      const job = {...saved,id,dir,input,format:input.format,outputPath:path.join(settings.outputDir,path.basename(saved.outputName ?? 'invalid.mp4'))};
      if (!terminal(job.state)) { job.state='failed';job.error='上次导出被中断，请重新导出';await save(job); }
      jobs.set(id,job);
    } catch { /* A partial submission is never treated as a completed export. */ }
  }
  async function drain() {
    if (active || closing) return;
    const job = queue.shift(); if (!job) return;
    active=true;activeController=new AbortController();let lastSave=0;
    try {
      const result = await runner(job,{baseUrl,token:settings.token,ffmpegPath:settings.ffmpegPath ?? ffmpegPath,ffprobePath:settings.ffprobePath ?? ffprobe.path,edgePath:settings.edgePath,signal:activeController.signal},patch => {
        Object.assign(job,patch);job.progress=Math.max(0,Math.min(.999,job.progress || 0));
        if(Date.now()-lastSave>1500){lastSave=Date.now();void save(job).catch(console.error);}
      });
      job.state='completed';job.progress=1;job.result=result;
    } catch(error) {
      job.state='failed';
      const detail=error instanceof Error?error.message:String(error);
      job.error='导出未完成，请查看“MV导出工具”的窗口提示后重试。';
      await fsp.writeFile(path.join(job.dir,'error.log'),detail);
      console.error(`Export ${job.id}: ${detail}`);
    } finally { try{await save(job);}finally{active=false;activeController=null;void drain();} }
  }
  async function submit(req,res) {
    if (queue.length + Number(active) >= 3) return json(res,429,{error:'已有三个导出任务，请等待完成后重试'});
    const contentType=req.headers['content-type'] ?? '';
    if (!contentType.startsWith('multipart/form-data;')) return json(res,415,{error:'需要歌曲和封面文件'});
    const body=await readBody(req);
    const form=await new Request(baseUrl,{method:'POST',headers:{'Content-Type':contentType},body}).formData();
    const raw=form.get('metadata');if(typeof raw!=='string'||Buffer.byteLength(raw)>3*1024*1024) throw new Error('歌曲信息不正确或过大');
    const metadata=validateMetadata(JSON.parse(raw));
    const audio=form.get('audio'),cover=form.get('cover');
    if (!audio || typeof audio.arrayBuffer!=='function' || audio.size<32 || audio.size>140*1024*1024) throw new Error('无法读取完整歌曲音频');
    if (!cover || typeof cover.arrayBuffer!=='function' || cover.size<32 || cover.size>12*1024*1024) throw new Error('未能读取歌曲封面，请稍后重试');
    const coverBytes=Buffer.from(await cover.arrayBuffer());
    const imageOK=coverBytes.subarray(0,3).equals(Buffer.from([255,216,255]))||coverBytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(coverBytes.toString('ascii',0,4)==='RIFF'&&coverBytes.toString('ascii',8,12)==='WEBP');
    if(!imageOK) throw new Error('封面不是支持的图片格式');
    const id=crypto.randomUUID(),dir=path.join(settings.jobDir,id);
    await fsp.mkdir(dir);
    const input={...metadata,audioUrl:`/api/jobs/${id}/audio.bin`,coverUrl:`/api/jobs/${id}/cover.image`};
    await Promise.all([fsp.writeFile(path.join(dir,'audio.bin'),Buffer.from(await audio.arrayBuffer())),fsp.writeFile(path.join(dir,'cover.image'),coverBytes),fsp.writeFile(path.join(dir,'input.json'),JSON.stringify(input))]);
    const outputName=`${safeFilename(metadata.song.name)}-${stamp()}-${id.slice(0,8)}.mp4`;
    const job={id,dir,input,format:metadata.format,outputName,outputPath:path.join(settings.outputDir,outputName),name:metadata.song.name,state:'queued',progress:0,createdAt:new Date().toISOString()};
    jobs.set(id,job);queue.push(job);await save(job);json(res,202,publicJob(job));void drain();
  }
  function streamFile(req,res,file,type,downloadName) {
    const stat=fs.statSync(file),headers={'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
    if(downloadName) headers['Content-Disposition']=`attachment; filename="BetterMV.mp4"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
    const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if(match){
      const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;
      if(start>=stat.size||end<start){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}
      res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${stat.size}`});fs.createReadStream(file,{start,end}).pipe(res);
    }else{res.writeHead(200,{...headers,'Content-Length':stat.size});fs.createReadStream(file).pipe(res);}
  }
  const server=http.createServer(async(req,res)=>{
    try {
      if(![`127.0.0.1:${settings.port}`,`localhost:${settings.port}`].includes(req.headers.host)) return json(res,403,{error:'只允许本机访问'});
      const origin=req.headers.origin;
      if(origin&&!allowedOrigins.has(origin)) return json(res,403,{error:'不允许此页面访问导出工具'});
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      res.setHeader('Access-Control-Allow-Headers','X-BetterMV-Token, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Private-Network','true');
      if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
      const url=new URL(req.url,baseUrl),p=url.pathname;
      if(p.startsWith('/api/')){
        const cookie=/(?:^|;\s*)bmv_export_session=([a-f0-9]+)/.exec(req.headers.cookie??'')?.[1];
        const headerOK=tokenMatches(req.headers['x-bettermv-token'],settings.token);
        if(!headerOK&&!(req.method==='GET'&&tokenMatches(cookie,settings.token)))return json(res,401,{error:'导出工具连接验证失败'});
        if(p==='/api/health'&&req.method==='GET'){
          if(headerOK)res.setHeader('Set-Cookie',`bmv_export_session=${settings.token}; HttpOnly; SameSite=Strict; Path=/`);
          return json(res,200,{ok:true,version:'3',outputDir:settings.outputDir});
        }
        if(p==='/api/exports'&&req.method==='POST')return await submit(req,res);
        if(p==='/api/exports'&&req.method==='GET')return json(res,200,[...jobs.values()].map(publicJob).reverse());
        const status=/^\/api\/exports\/([^/]+)(\/video)?$/.exec(p);
        if(status&&req.method==='GET'){
          const job=jobs.get(status[1]);if(!job)return json(res,404,{error:'未找到这个导出任务'});
          if(!status[2])return json(res,200,publicJob(job));
          if(job.state!=='completed'||!fs.existsSync(job.outputPath))return json(res,409,{error:'视频尚未完成'});
          return streamFile(req,res,job.outputPath,'video/mp4',job.outputName);
        }
        const media=/^\/api\/jobs\/([^/]+)\/(input\.json|audio\.bin|cover\.image)$/.exec(p);
        if(media&&req.method==='GET'&&JOB_ID.test(media[1])){
          const job=jobs.get(media[1]);if(!job)return json(res,404,{error:'未找到这个导出任务'});
          return streamFile(req,res,path.join(job.dir,media[2]),media[2]==='input.json'?'application/json':media[2]==='audio.bin'?'application/octet-stream':'image/jpeg');
        }
        return json(res,404,{error:'未找到这个功能'});
      }
      if(p==='/'){res.writeHead(302,{Location:'/exporter/dashboard.html'});return res.end();}
      if(vite)return vite.middlewares(req,res,()=>json(res,404,{error:'页面不存在'}));
      return json(res,404,{error:'页面不存在'});
    }catch(error){if(!res.headersSent)json(res,400,{error:error instanceof Error?error.message:String(error)});else res.destroy();}
  });
  server.requestTimeout=180000;server.headersTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(settings.port,'127.0.0.1',resolve);});
  return {server,settings,jobs,baseUrl,async close(){
    closing=true;activeController?.abort();
    while(active)await new Promise(resolve=>setTimeout(resolve,100));
    await Promise.all([...jobs.values()].map(job=>job.saving).filter(Boolean));
    await vite?.close();await new Promise(resolve=>server.close(resolve));
  }};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const settings=await loadSettings();
  const app=await startServer({settings});
  console.log('MV 导出工具已启动。请在网易云的 MV 页面点击“导出视频”。');
  console.log(`视频保存到：${settings.outputDir}`);
  console.log('导出期间请保留本窗口；关闭窗口会停止导出工具。');
  if(process.argv.includes('--open')){
    const url=`${app.baseUrl}/exporter/dashboard.html#${settings.token}`;
    spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}).unref();
  }
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void app.close().finally(()=>process.exit(0));});
}
