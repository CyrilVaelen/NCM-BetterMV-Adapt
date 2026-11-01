import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import ffmpeg from 'ffmpeg-static';
const out=path.resolve('../exports/Timbre-highlights-20261018'),rows=[];
for(const file of ['particles-101.083-before-peak.png','particles-101.083333-after.png','particles-100.1-after.png','particles-burst-101.083333-after.png']) {
  const r=spawnSync(ffmpeg,['-v','error','-i',path.join(out,file),'-f','rawvideo','-pix_fmt','gray','pipe:1'],{windowsHide:true,maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr.toString());
  rows.push({file,pixels:r.stdout.length,brightPixels:r.stdout.reduce((n,v)=>n+(v>210),0)});
}
assert.ok(rows[1].brightPixels>3*rows[0].brightPixels+100,'accepted note did not visibly light the foreground');
assert.ok(rows[1].brightPixels>5*rows[2].brightPixels+100,'note and between-note light have insufficient contrast');
assert.ok(rows[3].brightPixels>100,'burst pushed the highlight out of frame');
await fs.writeFile(path.join(out,'image-verification.json'),JSON.stringify({rows,method:'Decoded grayscale pixels > 210; same source interval and viewport, with actual renderer snapshots'},null,2));console.log(JSON.stringify(rows));
