import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { startServer, validateMetadata, safeFilename } from './server.mjs';

test('local export API authenticates requests, rejects external origins and persists completed jobs', async () => {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'bmv-export-test-'));
  const settings={token:randomBytes(32).toString('hex'),port:29516,jobDir:path.join(temp,'jobs'),outputDir:path.join(temp,'outputs')};
  let calls=0;
  const runner=async(job,_options,update)=>{
    calls++;await update({state:'rendering',progress:.5,frames:5,totalFrames:10});
    await fs.writeFile(job.outputPath,'test-only-encoded-output');
    return {frames:10,duration:1};
  };
  let app;
  const headers={'X-BetterMV-Token':settings.token};
  try{
    app=await startServer({settings,runner,useVite:false});
    const base=app.baseUrl;
    assert.equal((await fetch(base+'/api/health')).status,401);
    assert.equal((await fetch(base+'/api/health',{headers:{...headers,Origin:'https://example.com'}})).status,403);
    const health=await fetch(base+'/api/health',{headers:{...headers,Origin:'orpheus://orpheus'}});
    assert.equal(health.status,200);assert.equal(health.headers.get('access-control-allow-origin'),'orpheus://orpheus');
    const cookie=health.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base+'/api/exports',{headers:{Cookie:cookie}})).status,200);
    assert.equal((await fetch(base+'/api/jobs/../../secret',{headers})).status,404);
    const metadata={song:{id:1,name:'../../CON:*?',artists:['Test']},format:{width:1280,height:720,fps:30,duration:1},lines:[],config:{seed:12}};
    const invalid=new FormData();invalid.append('metadata',JSON.stringify({...metadata,format:{width:123,height:720}}));
    assert.equal((await fetch(base+'/api/exports',{method:'POST',headers,body:invalid})).status,400);
    const form=new FormData();form.append('metadata',JSON.stringify(metadata));
    form.append('audio',new Blob([Buffer.alloc(64)]),'test.audio');
    form.append('cover',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=','base64')]),'test.png');
    const response=await fetch(base+'/api/exports',{method:'POST',headers,body:form});
    assert.equal(response.status,202);const job=await response.json();
    assert.ok(!job.outputName.includes('/'));assert.ok(!job.outputName.includes('\\'));
    let result;
    for(let n=0;n<100;n++){
      result=await(await fetch(base+'/api/exports/'+job.id,{headers})).json();
      if(result.state==='completed')break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(result.state,'completed');assert.equal(result.progress,1);assert.equal(calls,1);
    const input=await(await fetch(base+`/api/jobs/${job.id}/input.json`,{headers})).json();
    assert.equal(input.config.seed,12);assert.deepEqual(input.lines,[]);
    await app.jobs.get(job.id).saving;
    const saved=JSON.parse(await fs.readFile(path.join(settings.jobDir,job.id,'status.json'),'utf8'));
    assert.equal(saved.state,'completed');assert.equal(saved.progress,1);
    const video=await fetch(base+`/api/exports/${job.id}/video`,{headers:{Cookie:cookie,Range:'bytes=0-3'}});
    assert.equal(video.status,206);assert.equal((await video.arrayBuffer()).byteLength,4);
    await app.close();app=null;
    app=await startServer({settings,runner,useVite:false});
    assert.equal((await(await fetch(app.baseUrl+'/api/exports/'+job.id,{headers})).json()).state,'completed');
  }finally{
    if(app)await app.close();
    const real=await fs.realpath(temp),relative=path.relative(await fs.realpath(os.tmpdir()),real);
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(real).startsWith('bmv-export-test-'));
    await fs.rm(real,{recursive:true,force:true});
  }
});

test('submission rejects unsupported format and unsafe output names stay inside output folder',()=>{
  assert.throws(()=>validateMetadata({song:{id:1,name:'A',artists:[]},format:{width:1921,height:1080,fps:30}}));
  assert.throws(()=>validateMetadata({song:{id:1,name:'A',artists:[]},format:{start:-1}}));
  assert.equal(safeFilename('CON'),'BetterMV');
  assert.equal(safeFilename('a/b\\c:*?'),'a_b_c___');
});
