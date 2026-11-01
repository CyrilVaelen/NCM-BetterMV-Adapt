// Developer acceptance: submit a real, already complete NetEase cache entry without controlling the player.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadSettings } from './server.mjs';
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
const id=Number(option('id','0')),duration=Number(option('duration','10'));
if(!Number.isSafeInteger(id)||id<1||!Number.isFinite(duration)||duration<=0)throw new Error('Use --id SONG_ID --duration SECONDS');
const cache=option('cache',path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData/Local'),'NetEase/CloudMusic/Cache/Cache'));
let audio;
for(const name of (await fs.readdir(cache)).filter(n=>n.startsWith(id+'-')&&n.endsWith('.uc')).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]))){
  const idx=JSON.parse(await fs.readFile(path.join(cache,name.replace(/\.uc$/,'.idx')),'utf8'));
  if(idx.zone?.length!==1||idx.zone[0]!==`0 ${Number(idx.size)-1}`)continue;
  audio=await fs.readFile(path.join(cache,name));for(let i=0;i<audio.length;i++)audio[i]^=0xa3;break;
}
if(!audio)throw new Error('No complete cached audio for this song');
async function remote(url){const r=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error('Source HTTP '+r.status);return r;}
const detail=await(await remote(`https://music.163.com/api/song/detail/?ids=%5B${id}%5D`)).json();
const s=detail.songs?.[0];if(!s)throw new Error('Song metadata unavailable');
const coverUrl=(s.al??s.album)?.picUrl;if(!coverUrl)throw new Error('Cover unavailable');
const [lyric,wiki,chorus,cover]=await Promise.all([
  remote(`https://music.163.com/api/song/lyric/v1?lv=0&kv=0&yv=0&tv=0&id=${id}`).then(r=>r.json()).catch(()=>null),
  remote(`https://music.163.com/api/song/play/about/block/page?songId=${id}`).then(r=>r.json()).catch(()=>null),
  remote(`https://music.163.com/api/song/chorus?ids=%5B${id}%5D`).then(r=>r.json()).catch(()=>null),
  remote(coverUrl.replace(/^http:/,'https:')+'?param=1024y1024').then(r=>r.blob()),
]);
const metadata={song:{id,name:s.name,artists:(s.ar??s.artists??[]).map(a=>a.name),duration:(s.dt??s.duration)/1000},lyric,wiki,chorus,config:{style:'auto',quality:'high',seed:id>>>0},format:{width:1920,height:1080,fps:30,duration}};
const settings=await loadSettings(),base=`http://127.0.0.1:${settings.port}`,headers={'X-BetterMV-Token':settings.token};
const form=new FormData();form.append('metadata',JSON.stringify(metadata));form.append('audio',new Blob([audio]),'song.audio');form.append('cover',cover,'cover.image');
const response=await fetch(base+'/api/exports',{method:'POST',headers,body:form});
const job=await response.json();if(!response.ok)throw new Error(JSON.stringify(job));
console.log(JSON.stringify({submitted:job.id,name:metadata.song.name,duration}));
let prior='';
for(;;){
  const status=await(await fetch(base+'/api/exports/'+job.id,{headers})).json();
  const brief=JSON.stringify({state:status.state,percent:Math.floor((status.progress||0)*100),frames:status.frames,totalFrames:status.totalFrames});
  if(brief!==prior){console.log(brief);prior=brief;}
  if(status.state==='failed')throw new Error(status.error+' Job: '+job.id);
  if(status.state==='completed'){console.log(JSON.stringify({completed:job.id,file:path.join(settings.outputDir,status.outputName),result:status.result}));break;}
  await new Promise(resolve=>setTimeout(resolve,2000));
}
