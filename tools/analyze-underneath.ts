// Analyze Underneath The Waves to locate Drop and musical sections
import { spawn } from 'node:child_process';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { analyzeSteps } from '../src/analysis/index.ts';

const audioFile = 'D:/野葱视频转换器/音频转换/Last Heroes,Monika Santucci - Underneath The Waves (feat. Monika Santucci).mp3';

async function decodePcm(file: string, sampleRate = 44100): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath!, [
      '-i', file,
      '-ac', '1',
      '-ar', String(sampleRate),
      '-f', 'f32le',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', c => chunks.push(c));
    child.on('close', code => {
      if (code !== 0) return reject(new Error('FFmpeg decode failed'));
      const buf = Buffer.concat(chunks);
      const floatArr = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
      resolve(floatArr);
    });
  });
}

console.log('正在解码音频...');
const samples = await decodePcm(audioFile, 44100);
console.log(`解码完成: ${samples.length} samples, 时长: ${(samples.length / 44100).toFixed(2)}s`);

console.log('正在分析歌曲结构与 Drop...');
const gen = analyzeSteps(samples, 44100, { sliceMs: 2000 });
let result = gen.next();
while (!result.done) {
  result = gen.next();
}
const analysis = result.value;

console.log('\n=== 分析结果 ===');
console.log(`BPM: ${analysis.bpm} (named: ${analysis.namedBpm})`);
console.log(`总时长: ${analysis.duration.toFixed(2)}s`);
console.log('段落分布:');
analysis.sections.forEach((s, idx) => {
  const isDrop = s.label === 'drop';
  console.log(`  [${idx}] ${s.label.padEnd(8)}: ${s.start.toFixed(2)}s - ${s.end.toFixed(2)}s (能量: ${s.energy.toFixed(2)})${isDrop ? '  <--- DROP' : ''}`);
});

