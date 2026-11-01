import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foregroundBand } from '../src/scenes/viz.ts';
import type { Timbre } from '../src/analysis/timbre.ts';

test('accepted light interpolates in audio time and logarithmic frequency without using raw peaks', () => {
  const cue = {
    fps: 2, bands: 2, hz: new Float32Array([100, 400]), lead: new Float32Array(2),
    spectrum: new Float32Array([0, 1, 1, 0]),
  } as Timbre;
  assert.equal(foregroundBand(cue, 0, 100, 1), 0, 'a raw peak cannot restore rejected light');
  assert.equal(foregroundBand(cue, 0, 400, 0), 1);
  assert.equal(foregroundBand(cue, .25, 100, 0), .5);
  assert.equal(foregroundBand(cue, 0, 200, 0), .5, '200 Hz is the logarithmic midpoint');
  assert.equal(foregroundBand(cue, .25, 200, 1), .5);
  assert.equal(foregroundBand(cue, -.01, 200, 1), 0);
  assert.equal(foregroundBand(cue, 1, 200, 1), 0);
  cue.spectrum.fill(0);
  assert.equal(foregroundBand(cue, .25, 200, 1), 0, 'muting foreground leaves raw FFT untouched and unlit');
});

test('legacy spectra retain their original light when no separated cue exists', () => {
  assert.equal(foregroundBand(undefined, 2, 440, .73), .73);
});
