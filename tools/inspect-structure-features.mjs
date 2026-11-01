import fs from 'node:fs/promises';
import { deserialize } from 'node:v8';
import { quantile } from '../src/analysis/util.ts';
const name = process.argv[2] || 'love';
const x = deserialize(await fs.readFile('../exports/Melodic-structure-20261018/' + name + '-input.bin'));
const report = JSON.parse(await fs.readFile('../exports/Melodic-structure-20261018/' + name + '-before.json'));
const round = x => Math.round(x * 100) / 100;
const rows = report.bars.map(b => {
  const a = Math.floor(b.t * x.fps), z = Math.floor(b.end * x.fps), low = x.low.slice(a, z), high = x.high.slice(a, z);
  let punch = 0, stable = 0;
  for (const [t, strength] of b.kicks) {
    const f = Math.round(t * x.fps), before = quantile(x.low.slice(Math.max(0, f - 12), f - 3), .5);
    const peak = quantile(x.low.slice(f, f + 8), .8), tail = quantile(x.low.slice(f + 12, f + 24), .5);
    if (peak > 2 * before && peak > 1.5 * tail) punch++;
    if (strength >= .5) stable++;
  }
  return Object.fromEntries(Object.entries({ i: b.i, t: b.t, low: b.low, high: b.high, tilt: b.high - b.low, db: b.db, crest: 10 * Math.log10((quantile(low, .9) + 1e-12) / (quantile(low, .1) + 1e-12)), K: b.kicks.length, S: b.snares.length, punch, stable }).map(([k, v]) => [k, round(v)]));
});
console.table(rows);
