// Template copied to the full bundle root. Uses only generated test audio.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ROOT,configurePortable,checkRuntime} from './start-service.mjs';
import {startServer} from './NCM-BetterMV-0.9.0/exporter/server.mjs';

const baseSettings=await configurePortable(),runtime=await checkRuntime(baseSettings);
const settings={...baseSettings,port:29519,jobDir:path.join(ROOT,'verification/jobs'),outputDir:path.join(ROOT,'verification/exports')};
const wav=Buffer.alloc(44+22050*2*2),rate=22050;
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<rate*2;i++){const t=i/rate,age=t%.25,hz=Math.floor(t/.25)%2?660:440;const sample=.25*Math.exp(-age*10)*Math.sin(2*Math.PI*hz*t)+.2*Math.exp(-age*40)*Math.sin(2*Math.PI*65*t);wav.writeInt16LE(Math.round(sample*32767),44+i*2);}
const catalog=await fs.readFile(path.join(ROOT,'NCM-BetterMV-0.9.0/src/scenes/catalog.ts'),'utf8');
const off=[...new Set([...catalog.matchAll(/id:\s*'([^']+)'/g)].map(m=>m[1]))].filter(id=>id!=='rings');
const metadata={song:{id:900000001,name:'Complete-package-generated-test',artists:['Local test'],duration:2},lines:[],config:{style:'pulse',quality:'low',off,offLooks:[],seed:1},format:{width:1280,height:720,fps:30,duration:1}};
const cover=await fs.readFile(path.join(ROOT,'NCM-BetterMV-0.9.0/plugin/preview.jpg'));
let app;
try{
  app=await startServer({settings});
  const html=await(await fetch(app.baseUrl+'/exporter/render.html')).text();assert.ok(!html.includes('/@vite/client'),'Development socket client was injected');
  const headers={'X-BetterMV-Token':settings.token};
  assert.equal((await fetch(app.baseUrl+'/api/health')).status,401);
  const form=new FormData();form.append('metadata',JSON.stringify(metadata));form.append('audio',new Blob([wav]),'generated.wav');form.append('cover',new Blob([cover]),'cover.jpg');
  const response=await fetch(app.baseUrl+'/api/exports',{method:'POST',headers,body:form});assert.equal(response.status,202);const submitted=await response.json();
  let status,prior='';const deadline=Date.now()+240000;
  while(Date.now()<deadline){
    status=await(await fetch(app.baseUrl+'/api/exports/'+submitted.id,{headers})).json();
    const progress=`${status.state}:${status.frames??0}`;if(progress!==prior){console.log(JSON.stringify({state:status.state,frames:status.frames,totalFrames:status.totalFrames}));prior=progress;}
    if(status.state==='completed'||status.state==='failed')break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.equal(status?.state,'completed',status?.error??'Timed out');assert.equal(status.result.frames,30);assert.equal(status.result.validation.videoCodec,'h264');assert.equal(status.result.validation.audioCodec,'aac');
  const video=await fetch(app.baseUrl+`/api/exports/${submitted.id}/video`,{headers:{...headers,Range:'bytes=0-31'}});assert.equal(video.status,206);assert.equal((await video.arrayBuffer()).byteLength,32);
  const result={runtime,export:{outputPath:status.result.outputPath,width:1280,height:720,frames:30,duration:status.result.duration,validation:status.result.validation,pageErrors:status.result.pageErrors,consoleErrors:status.result.consoleErrors},generatedAudioOnly:true};
  assert.deepEqual(result.export.pageErrors,[]);assert.deepEqual(result.export.consoleErrors,[]);
  await fs.writeFile(path.join(ROOT,'verification/full-package-test.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({complete:true,file:status.result.outputPath,frames:30}));
}finally{await app?.close();}
