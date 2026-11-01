// A contrastive arrangement model for bass music whose loud, sustained vocal accompaniment and risers can be
// louder than its releases. This is evidence about the recording, not an artist/genre/song-name switch.
import { quantile } from './util.ts';

export interface ContrastInput {
  low?: Float32Array;
  fps: number;
  time: number[];
  end: number;
  bass: Float64Array;
  treble: Float64Array;
  db: Float64Array;
  sung: Float64Array;
  similarity: Float64Array;
  /** Kicks + half the snares per second, independent of the beat-grid octave. */
  drive: Float64Array;
}

export interface ContrastForm {
  /** Deep bass modulation per bar, in dB. Sustained sub-bass alone is not a percussive release. */
  articulation: Float64Array;
  /** Repeated, full-band release regions, in bars; empty when the contrast evidence is insufficient. */
  releases: Array<[number, number]>;
}

export function contrastForm(x: ContrastInput): ContrastForm {
  const n = x.time.length, articulation = new Float64Array(n), none = { articulation, releases: [] as Array<[number, number]> };
  if (!x.low || n < 16 || !x.fps || !Number.isFinite(x.fps)) return none;
  const bassRef = quantile(x.bass, .9), trebleRef = quantile(x.treble, .9), levelRef = quantile(x.db, .9);
  if (bassRef < -70 || trebleRef < -75) return none;
  const candidate = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    const frames = x.low.subarray(Math.max(0, Math.floor(x.time[j] * x.fps)), Math.min(x.low.length, Math.floor((x.time[j + 1] ?? x.end) * x.fps)));
    // A fixed numerical floor prevents silence/noise from looking like extreme modulation.
    articulation[j] = 10 * Math.log10((quantile(frames, .9) + 1e-8) / (quantile(frames, .1) + 1e-8));
    candidate[j] = +(x.bass[j] >= bassRef - 5 && x.treble[j] >= trebleRef - 3.5 && x.db[j] >= levelRef - 5 && articulation[j] >= 10 && x.sung[j] < .35 && x.drive[j] >= .5);
  }
  // At least three of four bars: single drum fills, pickup notes and an isolated bass note cannot establish a form.
  const mask = new Uint8Array(n);
  for (let j = 0; j + 4 <= n; j++) {
    let count = 0; for (let q = j; q < j + 4; q++) count += candidate[q];
    if (count >= 3) for (let q = j; q < j + 4; q++) if (candidate[q] || (x.bass[q] >= bassRef - 5 && x.treble[q] >= trebleRef - 3.5 && x.sung[q] < .35)) mask[q] = 1;
  }
  const releases: Array<[number, number]> = [];
  for (let j = 0; j < n;) {
    if (!mask[j]) { j++; continue; }
    const a = j; while (j < n && mask[j]) j++;
    if (j - a >= 4) releases.push([a, j]);
  }
  // Require separate returns and a contrasting, equally loud but continuous-bass accompaniment. Insufficient
  // contrast leaves the existing analysis alone; a four-on-the-floor groove or an acoustic solo is not evidence.
  if (releases.length < 2 || !releases.some(([a], i) => i > 0 && a - releases[i - 1][1] >= 4)) return none;
  // Two noisy/high-crest passages are insufficient: the release must actually return with the same timbral and
  // rhythmic phrase. Compare aligned bars, allowing a short pickup/tail on either copy.
  const repeated = new Set<number>();
  for(let p=0;p<releases.length;p++) for(let q=p+1;q<releases.length;q++) {
    const [a,b]=releases[p], [c,d]=releases[q], len=Math.max(4,Math.floor(.75*Math.min(b-a,d-c)));
    let best=-1;
    for(let da=0;da+len<=b-a;da++) for(let dc=0;dc+len<=d-c;dc++) {
      let score=0; for(let j=0;j<len;j++) score+=x.similarity[(a+da+j)*n+c+dc+j]/len;
      best=Math.max(best,score);
    }
    if(best>=.6) { repeated.add(p); repeated.add(q); }
  }
  const returns=releases.filter((_,i)=>repeated.has(i));
  if(returns.length<2) return none;
  const releaseBars = returns.flatMap(([a, b]) => Array.from({ length: b - a }, (_, q) => a + q));
  const releaseArt = quantile(releaseBars.map(j => articulation[j]), .5);
  const releaseHigh = quantile(releaseBars.map(j => x.treble[j]), .5);
  const sustained = Array.from({ length: n }, (_, j) => j).filter(j => !mask[j] && x.bass[j] >= bassRef - 5 && x.db[j] >= levelRef - 4 && articulation[j] <= releaseArt - 6 && x.treble[j] <= releaseHigh - 2);
  if (sustained.length < 4) return none;
  return { articulation, releases: returns };
}

/** Share of a bar span that belongs to a verified release. */
export function releaseShare(form: ContrastForm, a: number, b: number): number {
  let count = 0;
  for (const [p, q] of form.releases) count += Math.max(0, Math.min(b, q) - Math.max(a, p));
  return count / Math.max(1, b - a);
}
