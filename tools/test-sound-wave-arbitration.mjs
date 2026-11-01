import fs from 'node:fs/promises';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const phoenixPath = 'D:/NCM/NCM-BetterMV-0.9.0/src/scenes/phoenix.ts';
const typesPath = 'D:/NCM/NCM-BetterMV-0.9.0/src/scenes/types.ts';
const [phoenixSource, typesSource] = await Promise.all([
  fs.readFile(phoenixPath, 'utf8'),
  fs.readFile(typesPath, 'utf8'),
]);

const functionStart = phoenixSource.indexOf('function buildSoundWaves(');
const functionEnd = phoenixSource.indexOf('\nconst VERT', functionStart);
const waveFunction = phoenixSource.slice(functionStart, functionEnd).trim();

const rngStart = typesSource.indexOf('export function rng(');
const rngEnd = typesSource.indexOf('\nexport const clamp01', rngStart);
const rngFunction = typesSource.slice(rngStart, rngEnd).trim();

const extracted = `${rngFunction}\n\n${waveFunction}\n`;
const executable = stripTypeScriptTypes(extracted.replace('export function rng', 'function rng'), { mode: 'strip' });
const context = vm.createContext({});
vm.runInContext(`${executable}\nglobalThis.extractedBuildSoundWaves=buildSoundWaves;`, context);
const buildSoundWaves = context.extractedBuildSoundWaves;

const makeMusic = (kick, lead) => ({
  duration: 4,
  a: { hits: { kick, snare: [] } },
  beats: [], downbeats: [],
  roleHits(role) { return role === 'lead' ? lead : []; },
  highlightHits() { return []; },
  leadOwnership() { return 1; },
  section() { return { start: 0, end: 4, label: 'drop' }; },
  pitchAt() { return { note: 60 }; },
});

const seed = 123456;
const cases = [
  { name: 'lead_only_at_1', kick: [], lead: [[1, 0.9]] },
  { name: 'kick_and_lead_at_1', kick: [[1, 0.4]], lead: [[1, 0.9]] },
  { name: 'kick_at_1_lead_at_1_1', kick: [[1, 0.4]], lead: [[1.1, 0.9]] },
  { name: 'control_kick_at_1_lead_at_1_17', kick: [[1, 0.4]], lead: [[1.17, 0.9]] },
];

for (const c of cases) {
  const events = buildSoundWaves(makeMusic(c.kick, c.lead), seed);
  console.log(`Case ${c.name}: count=${events.length}`);
  events.forEach((e, idx) => {
    console.log(`  [${idx}] t=${e.t.toFixed(3)}, strength=${e.strength.toFixed(3)}, tau=${e.tau.toFixed(3)}, freq=${e.freq.toFixed(1)}`);
  });
}
