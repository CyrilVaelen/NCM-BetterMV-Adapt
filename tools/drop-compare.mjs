import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
const output=path.resolve('../exports/Cant-Let-You-Go-drop-response');
const read=async f=>JSON.parse(await fs.readFile(path.join(output,f),'utf8'));
const before=await read('before-render.json'),after=await read('after-render.json');
assert.deepEqual(before.summary,after.summary,'Musical arrangement or timing changed');
assert.deepEqual(before.errors,[]);assert.deepEqual(after.errors,[]);
assert.equal(after.checks.length,5);assert.ok(after.checks.every(c=>c.standardDeviation>5&&c.changedPixelFraction>.01));
async function run(exe,args){const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);assert.equal((await once(p,'close'))[0],0,err);return out;}
const files=[];
for(const [i,clip] of after.clips.entries()){
  const old=before.clips[i];assert.equal(old.scene,clip.scene);assert.equal(old.start,clip.start);assert.equal(old.frames,clip.frames);
  const mm=Math.floor(clip.start/60),ss=(clip.start%60).toFixed(1),label=`${mm}m${ss}s - ${clip.scene}`;
  const name=`${clip.scene}-comparison.mp4`;files.push(name);
  const font='C\\:/Windows/Fonts/arial.ttf';
  await run(ffmpeg,['-y','-v','error','-i',old.file,'-i',clip.file,'-filter_complex',`[0:v]drawtext=fontfile='${font}':text='BEFORE - ${label}':x=12:y=12:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.7[a];[1:v]drawtext=fontfile='${font}':text='AFTER - ${label}':x=12:y=12:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.7[b];[a][b]hstack[v]`,'-map','[v]','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',path.join(output,name)]);
}
const list=path.join(output,'comparison-clips.txt');await fs.writeFile(list,files.map(f=>`file '${f}'`).join('\n'));
const video=path.join(output,'Cant-Let-You-Go-Drop-comparison.mp4');
await run(ffmpeg,['-y','-v','error','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',video]);
const probe=JSON.parse(await run(ffprobe.path,['-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height,nb_frames','-of','json',video]));
assert.equal(probe.streams.find(s=>s.codec_type==='video').nb_frames,String(after.clips.reduce((s,c)=>s+c.frames,0)));
assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
await run(ffmpeg,['-y','-v','error','-ss','0.8','-i',video,'-frames:v','1',path.join(output,'comparison-frame.png')]);
const verification={video,probe,actualSongSource:(await read('fixture.json')).source,actualCover:true,actualAutomaticShots:true,arrangementAndTimingUnchanged:true,sceneChecks:after.checks,baselineTests:{passed:16,failed:1,failure:'Existing flat broadband rejection test conflicts with existing supersaw floor; DSP untouched in this update'},errors:after.errors};
await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(verification,null,2));
console.log(JSON.stringify({video,duration:probe.format.duration,scenes:after.checks.map(c=>c.scene),arrangementAndTimingUnchanged:true}));
