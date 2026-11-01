import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import ffmpeg from 'ffmpeg-static';
import {PROJECT} from '../exporter/server.mjs';

const id=17285341,output=path.resolve(PROJECT,'../exports/Sunshine-keyboard-response');
const fixture=path.join(output,'fixture',String(id));await fs.mkdir(fixture,{recursive:true});
const cache='C:/Users/86137/AppData/Local/NetEase/CloudMusic/Cache/Cache/17285341-999-9066b1e6171ca66d467b844e7ec18635';
const index=JSON.parse(await fs.readFile(`${cache}.idx`,'utf8')),audio=await fs.readFile(`${cache}.uc`);
if(!index.t||Number(index.size)!==audio.length||index.zone.length!==1||index.zone[0]!==`0 ${audio.length-1}`)throw new Error('The local song cache is incomplete.');
for(let n=0;n<audio.length;n++)audio[n]^=0xa3;
await fs.writeFile(path.join(fixture,'audio.bin'),audio);
const doc=await(await fetch(`https://music.163.com/api/song/detail/?ids=[${id}]`)).json();
const song=doc.songs?.find(s=>s.id===id);if(!song||song.name!=='Sunshine')throw new Error('Wrong song metadata');
const coverUrl=song.album.picUrl.replace(/^http:/,'https:')+'?param=1024y1024';
const cover=await fetch(coverUrl);if(!cover.ok)throw new Error('Could not fetch the cover');
await fs.writeFile(path.join(fixture,'cover.image'),Buffer.from(await cover.arrayBuffer()));
const previous=JSON.parse(await fs.readFile(path.resolve(PROJECT,'../BetterNCM/export-jobs/741d3da3-67d0-405d-8b1f-9c06bce5230d/input.json'),'utf8'));
const input={song:{id,name:song.name,artists:song.artists.map(a=>a.name),album:song.album.name,duration:song.duration/1000},
  lines:[],config:{...previous.config,seed:id},format:{width:1280,height:720,fps:30,start:0,duration:4},
  audioUrl:`/api/jobs/${id}/audio.bin`,coverUrl:`/api/jobs/${id}/cover.image`};
await fs.writeFile(path.join(fixture,'input.json'),JSON.stringify(input));
await fs.writeFile(path.join(fixture,'status.json'),JSON.stringify({id,state:'completed',progress:1,name:song.name,outputName:'fixture-only.mp4'}));
const pcm=path.join(output,'sunshine-mono.f32');
const child=spawn(ffmpeg,['-y','-v','error','-i',path.join(fixture,'audio.bin'),'-ac','1','-ar','22050','-f','f32le',pcm],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let error='';child.stderr.on('data',x=>error+=x);const [code]=await once(child,'close');if(code)throw new Error(error);
console.log(JSON.stringify({song:input.song,bytes:audio.length,output,fixture,pcm}));
