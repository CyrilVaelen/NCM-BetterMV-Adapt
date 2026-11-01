import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import ffmpeg from 'ffmpeg-static';
import {PROJECT} from '../exporter/server.mjs';

const root=path.resolve(PROJECT,'..'),output=path.join(root,'exports/Cant-Let-You-Go-drop-response');
const id='19191169-1600-4000-8000-000000000006';
const directories=await fs.readdir('D:/',{withFileTypes:true});
const directory=directories.find(d=>d.isDirectory()&&d.name.includes('\u91ce\u8471'));
if(!directory)throw new Error('Audio directory missing');
const files=[];
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.name==="ARMNHMR,Abandoned,RYNN - Can't Let You Go.mp3")files.push(p);}}
await walk(path.join('D:/',directory.name));
if(files.length!==1)throw new Error(`Expected one source MP3, found ${files.length}`);
const fixture=path.join(output,'fixture',id);await fs.mkdir(fixture,{recursive:true});
await fs.copyFile(files[0],path.join(fixture,'audio.bin'));
// A fixed existing cover keeps A/B geometry and colour identical, offline.
const oldFixture=path.join(root,'exports/Sunshine-keyboard-response/fixture/17285341-0000-4000-8000-000000000004');
await fs.copyFile(path.join(oldFixture,'cover.image'),path.join(fixture,'cover.image'));
const previous=JSON.parse(await fs.readFile(path.join(oldFixture,'input.json'),'utf8'));
const input={song:{id:1919116916,name:"Can't Let You Go",artists:['ARMNHMR','Abandoned','RYNN'],duration:228.8},lines:[],config:{...previous.config,seed:1919116916},format:{width:1280,height:720,fps:30,start:0,duration:4},audioUrl:`/api/jobs/${id}/audio.bin`,coverUrl:`/api/jobs/${id}/cover.image`};
await fs.writeFile(path.join(fixture,'input.json'),JSON.stringify(input));
await fs.writeFile(path.join(fixture,'status.json'),JSON.stringify({id,state:'completed',progress:1,name:input.song.name,outputName:'fixture-only.mp4'}));
const pcm=path.join(output,'mono.f32');
const child=spawn(ffmpeg,['-y','-v','error','-i',files[0],'-ac','1','-ar','22050','-f','f32le',pcm],{windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);
if((await once(child,'close'))[0])throw new Error(error);
await fs.writeFile(path.join(output,'fixture.json'),JSON.stringify({source:files[0],fixture,id,pcm,cover:'Existing Sunshine cover used only as a fixed offline QA palette'},null,2));
console.log(JSON.stringify({source:files[0],fixture,seconds:(await fs.stat(pcm)).size/4/22050}));
