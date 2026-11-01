import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const mp4Path = 'D:/NCM/state/phoenix-lead-color-20261023/verification/renders/after-phoenix-stage-playback.mp4';

console.log('Running blackdetect on:', mp4Path);
const ff = spawn(ffmpeg, [
  '-i', mp4Path,
  '-vf', 'blackdetect=d=0.05:pix_th=0.08',
  '-f', 'null',
  '-'
]);

let stderr = '';
ff.stderr.on('data', d => { stderr += d.toString(); });

ff.on('close', code => {
  console.log('FFmpeg exit code:', code);
  const blackMatches = [...stderr.matchAll(/black_start:([0-9.]+) black_end:([0-9.]+) black_duration:([0-9.]+)/g)];
  if (blackMatches.length === 0) {
    console.log('PASSED: Zero black frames detected in the entire 8.0s video!');
  } else {
    console.log(`WARNING: Detected ${blackMatches.length} black intervals:`);
    for (const m of blackMatches) {
      console.log(`  start=${m[1]}, end=${m[2]}, duration=${m[3]}`);
    }
  }
});
