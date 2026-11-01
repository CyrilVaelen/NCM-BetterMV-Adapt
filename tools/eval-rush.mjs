import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'vite';

const PROJECT = process.cwd();
const ffmpeg = path.join(PROJECT, 'node_modules/ffmpeg-static/ffmpeg.exe');
const mp3Path = 'D:\\CloudMusic\\Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3';

console.log('Building analyze bundle with Vite...');
await build({
  root: PROJECT,
  configFile: path.resolve(PROJECT, 'vite.analysis.config.ts'),
});

console.log('Decoding audio with ffmpeg...');
const pcmBuffer = await new Promise((resolve, reject) => {
  const child = spawn(ffmpeg, ['-i', mp3Path, '-ac', '1', '-ar', '22050', '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const chunks = [];
  child.stdout.on('data', c => chunks.push(c));
  child.on('close', code => {
    if (code === 0) resolve(Buffer.concat(chunks));
    else reject(new Error('ffmpeg failed with code ' + code));
  });
});

console.log('Decoded samples:', pcmBuffer.length / 4, 'Rate: 22050');
const samples = new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 4);

console.log('Importing analysis module...');
const moduleUrl = new URL('file:///' + path.join(PROJECT, 'dist/eval-temp/analysis.mjs').replace(/\\/g, '/')).href;
const { analyze } = await import(moduleUrl);

console.log('Running analyze...');
const start = Date.now();
const res = analyze(samples, 22050);
console.log('Analysis finished in', (Date.now() - start) / 1000, 's');

console.log('\n--- Basic Info ---');
console.log('BPM:', res.bpm, 'Named BPM:', res.namedBpm, 'Meter:', res.meter);
console.log('Sections:');
res.sections.forEach((s, idx) => {
  console.log(`  #${idx} [${s.label}] ${s.start.toFixed(2)}s - ${s.end.toFixed(2)}s (energy: ${s.energy.toFixed(3)})`);
});

console.log('\n--- Detail in Drop #5 (102s - 118s) ---');
for (let t = 102; t <= 118; t += 0.25) {
  const f = Math.floor(t * res.env.fps);
  const rms = res.env.rms[f];
  const mid = res.env.mid[f];
  const lead = res.env.lead ? res.env.lead[f] : 0;
  const leadAtk = res.env.leadAttack ? res.env.leadAttack[f] : 0;
  const hasKick = res.hits.kick.some(h => Math.abs(h[0] - t) < 0.05) ? ' [KICK]' : '';
  const hasKey = (res.hits.keys || []).some(h => Math.abs(h[0] - t) < 0.05) ? ' [KEY]' : '';
  console.log(`t=${t.toFixed(2)}s | RMS: ${rms.toFixed(2)}, Mid: ${mid.toFixed(2)} | Lead: ${lead.toFixed(2)}, Atk: ${leadAtk.toFixed(2)}${hasKick}${hasKey}`);
}

