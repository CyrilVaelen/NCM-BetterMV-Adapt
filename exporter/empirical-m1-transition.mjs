// Empirical challenge script for Milestone 1 Transition Postprocessing (Build collapse & Drop shockwave)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal canvas stub for Node
if (typeof globalThis.document === 'undefined') {
  const makeCtx2d = (canvas) => ({
    canvas,
    font: '16px sans-serif',
    fillStyle: '#fff',
    strokeStyle: '#000',
    lineWidth: 1,
    textBaseline: 'alphabetic',
    textAlign: 'left',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
    save() {},
    restore() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    clip() {},
    scale() {},
    translate() {},
    rotate() {},
    setTransform() {},
    drawImage() {},
    fillText() {},
    strokeText() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    getImageData(_x, _y, w, h) { return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }; },
    putImageData() {},
    measureText(str) {
      const len = Array.from(String(str ?? '')).length;
      return { width: Math.max(8, len * 24), actualBoundingBoxAscent: 22, actualBoundingBoxDescent: 6, actualBoundingBoxLeft: 0, actualBoundingBoxRight: Math.max(8, len * 24) };
    },
  });
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') {
        const c = { width: 64, height: 64, style: {}, getContext(kind) { return kind === '2d' ? makeCtx2d(c) : null; } };
        return c;
      }
      return { style: {}, appendChild() {}, removeChild() {}, setAttribute() {} };
    },
    fonts: { add() {}, load: async () => [] },
  };
}

async function runEmpiricalChallenge() {
  console.log('=== STARTING EMPIRICAL CHALLENGE FOR MILESTONE 1 (TRANSITIONS) ===');
  console.log('Root:', PROJECT);

  const vite = await createServer({
    root: PROJECT,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
  });

  const { Director } = await vite.ssrLoadModule('/src/director/director.ts');
  const { defaultFx } = await vite.ssrLoadModule('/src/render/engine.ts');
  const { Music } = await vite.ssrLoadModule('/src/director/music.ts');
  const { LyricTrack } = await vite.ssrLoadModule('/src/director/lyrics.ts');
  const { LOOKS } = await vite.ssrLoadModule('/src/scenes/catalog.ts');
  const { LookPass } = await vite.ssrLoadModule('/src/render/looks.ts');

  const results = {
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    metrics: {},
  };

  function testCase(name, fn) {
    results.totalTests++;
    try {
      fn();
      results.passedTests++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      results.failedTests++;
      console.error(`  [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // Helper to create analysis and mock director context
  function createTestEnvironment(bpm = 120, meter = 4) {
    const beatSec = 60 / bpm;
    const barSec = beatSec * meter;

    const sections = [
      { start: 0, end: barSec * 8, label: 'verse', energy: 0.4 },
      { start: barSec * 8, end: barSec * 16, label: 'build', energy: 0.7 },
      { start: barSec * 16, end: barSec * 24, label: 'drop', energy: 0.95 },
      { start: barSec * 24, end: barSec * 28, label: 'pre', energy: 0.65 },
      { start: barSec * 28, end: barSec * 36, label: 'drop', energy: 0.98 },
      { start: barSec * 36, end: barSec * 40, label: 'outro', energy: 0.3 },
    ];
    const totalDuration = barSec * 40;
    const totalBeats = Math.floor(totalDuration / beatSec);

    const beats = Array.from({ length: totalBeats }, (_, i) => i * beatSec);
    const downbeats = Array.from({ length: Math.floor(totalBeats / meter) }, (_, i) => i * barSec);
    const beatInBar = Array.from({ length: totalBeats }, (_, i) => i % meter);

    const analysis = {
      version: 2,
      duration: totalDuration,
      bpm,
      meter,
      beats,
      downbeats,
      beatInBar,
      sections,
      hits: { kick: [], snare: [], vocal: [], leads: [], keys: [] },
      env: { fps: 60, rms: new Float32Array(Math.floor(totalDuration * 60)).fill(0.5) },
    };

    const music = new Music(analysis);
    const lyrics = new LyricTrack([], 60);
    const style = { id: 'neon', look: 'neon' };

    // Build shots corresponding to sections
    const shots = sections.map((sec, idx) => ({
      scene: 'drive',
      start: sec.start,
      end: sec.end,
      variant: 'front',
      seed: idx + 100,
      section: sec,
      sectionIndex: idx,
    }));

    // Mock director context for grade() invocation
    const mockDirector = {
      music,
      style,
      shots,
      lyrics,
    };

    const evalGrade = (t) => {
      const shotIdx = shots.findIndex(s => t >= s.start && t < s.end);
      const shot = shotIdx >= 0 ? shots[shotIdx] : shots[shots.length - 1];
      const fx = defaultFx();
      const beat = 60 / Math.max(40, music.at(t).bpm);
      Director.prototype['grade'].call(mockDirector, t, shot, fx, beat);
      return { fx, shot, beat };
    };

    return { music, shots, mockDirector, evalGrade, beatSec, barSec, sections };
  }

  // ==========================================
  // SUITE 1: Build Collapse Window
  // ==========================================
  console.log('\n--- SUITE 1: Build Collapse Window ---');
  {
    const env = createTestEnvironment(120, 4);
    const buildSec = env.sections[1]; // start: 16s, end: 32s (16s long = 8 bars)
    const windowStart = buildSec.end - env.barSec * 2; // 32 - 4 = 28s

    testCase('Build section: fx.collapse evaluates strictly to 0 prior to window', () => {
      // Sample 50 points from 16.0s to 27.99s
      const samples = 50;
      for (let i = 0; i < samples; i++) {
        const t = buildSec.start + (windowStart - 0.01 - buildSec.start) * (i / (samples - 1));
        const { fx } = env.evalGrade(t);
        assert.equal(fx.collapse, 0, `fx.collapse at t=${t.toFixed(4)}s must be 0, got ${fx.collapse}`);
      }
    });

    testCase('Build section: fx.collapse activates strictly during last 2 bars', () => {
      // Boundary point at windowStart (remain = 4.0, p = 0)
      const atBoundary = env.evalGrade(windowStart);
      assert.equal(atBoundary.fx.collapse, 0, `At window boundary t=${windowStart}s, collapse must be 0`);

      // Inside window: from 28.01s to 31.99s
      const steps = 40;
      let prevCollapse = -1;
      for (let i = 1; i <= steps; i++) {
        const t = windowStart + (buildSec.end - 0.001 - windowStart) * (i / steps);
        const { fx } = env.evalGrade(t);
        assert(fx.collapse > 0, `Inside window at t=${t.toFixed(3)}s, collapse must be > 0, got ${fx.collapse}`);
        assert(fx.collapse <= 1.0, `Inside window at t=${t.toFixed(3)}s, collapse must be <= 1.0, got ${fx.collapse}`);
        assert(fx.collapse >= prevCollapse, `fx.collapse must monotonically increase: prev=${prevCollapse}, curr=${fx.collapse}`);
        prevCollapse = fx.collapse;
      }
      results.metrics.maxBuildCollapse = prevCollapse;
    });

    testCase('Pre section: activates collapse in last 2 bars identically', () => {
      const preSec = env.sections[3]; // start: 48s, end: 56s
      const preWindowStart = preSec.end - env.barSec * 2; // 52s
      const { fx: fxBefore } = env.evalGrade(preWindowStart - 0.5);
      assert.equal(fxBefore.collapse, 0, 'Pre section before window must have collapse=0');

      const { fx: fxInside } = env.evalGrade(preWindowStart + 2.0); // 1 bar in
      assert(fxInside.collapse > 0.2 && fxInside.collapse < 0.4, `Pre section inside window collapse=${fxInside.collapse}`);
    });

    testCase('Non-build sections (verse, drop, outro) evaluate collapse to strictly 0', () => {
      for (const s of [env.sections[0], env.sections[2], env.sections[5]]) {
        for (let t = s.start; t < s.end; t += (s.end - s.start) / 10) {
          const { fx } = env.evalGrade(t);
          assert.equal(fx.collapse, 0, `Section ${s.label} at t=${t.toFixed(2)}s had collapse=${fx.collapse}`);
        }
      }
    });

    testCase('Different tempo (BPM 150) and meter (3/4 time) scales window proportionally', () => {
      const env34 = createTestEnvironment(150, 3);
      // beat = 60/150 = 0.4s. barSec = 0.4 * 3 = 1.2s. 2 bars = 2.4s.
      const bSec = env34.sections[1];
      const wStart = bSec.end - 2.4;
      const { fx: fxOutside } = env34.evalGrade(wStart - 0.1);
      assert.equal(fxOutside.collapse, 0, 'BPM150 3/4 outside window collapse must be 0');
      const { fx: fxInside } = env34.evalGrade(wStart + 1.2);
      assert(fxInside.collapse > 0.2 && fxInside.collapse < 0.35, `BPM150 3/4 inside window collapse=${fxInside.collapse}`);
    });
  }

  // ==========================================
  // SUITE 2: Progressive CA
  // ==========================================
  console.log('\n--- SUITE 2: Progressive CA ---');
  {
    const env = createTestEnvironment(120, 4);
    const buildSec = env.sections[1];
    const windowStart = buildSec.end - env.barSec * 2; // 28s
    const windowDuration = env.barSec * 2; // 4s

    testCase('Progressive CA increases monotonically with collapse in build window', () => {
      let prevCA = -1;
      const samples = 100;
      const caReadings = [];
      for (let i = 0; i < samples; i++) {
        const t = windowStart + (windowDuration - 0.002) * (i / (samples - 1));
        const remain = Math.max(0, buildSec.end - t);
        const expectedP = Math.max(0, Math.min(1, 1 - remain / windowDuration));
        const expectedCollapse = Math.pow(expectedP, 1.8);
        const expectedCA = expectedP * 0.85;

        const { fx } = env.evalGrade(t);
        assert(Math.abs(fx.collapse - expectedCollapse) < 1e-6, `Collapse mismatch at t=${t}: got ${fx.collapse}, expected ${expectedCollapse}`);
        assert(Math.abs(fx.ca - expectedCA) < 1e-6, `CA mismatch at t=${t}: got ${fx.ca}, expected ${expectedCA}`);
        assert(fx.ca >= prevCA, `CA did not increase monotonically: prev=${prevCA}, curr=${fx.ca}`);
        prevCA = fx.ca;
        caReadings.push({ t, p: expectedP, collapse: fx.collapse, ca: fx.ca });
      }
      results.metrics.maxCA = prevCA;
      results.metrics.sampleReadings = caReadings.filter((_, idx) => idx % 25 === 0);

      // Verify exact boundary transition at t = buildSec.end (cut to drop)
      const { fx: fxDropCut } = env.evalGrade(buildSec.end);
      assert.equal(fxDropCut.collapse, 0, 'At section end t=buildSec.end (drop entry), collapse must be 0');
      assert.equal(fxDropCut.shockwave, 0, 'At section end t=buildSec.end (drop entry), shockwave progress is 0');
      assert.equal(fxDropCut.shockwaveAmp, 1.0, 'At section end t=buildSec.end (drop entry), shockwaveAmp is 1.0');
    });

    testCase('CA outside build collapse window evaluates to baseline 0', () => {
      const { fx: fxBefore } = env.evalGrade(windowStart - 1.0);
      assert.equal(fxBefore.ca, 0, `CA before window must be 0, got ${fxBefore.ca}`);
    });
  }

  // ==========================================
  // SUITE 3: Drop Shockwave
  // ==========================================
  console.log('\n--- SUITE 3: Drop Shockwave ---');
  {
    const env = createTestEnvironment(120, 4);
    const dropSec = env.sections[2]; // start: 32s, end: 48s
    const shockDuration = env.beatSec * 1.25; // 0.5 * 1.25 = 0.625s

    testCase('Shockwave triggers at Drop start (intoSec = 0)', () => {
      const { fx } = env.evalGrade(dropSec.start);
      assert.equal(fx.shockwave, 0, `At drop start intoSec=0, progress should be 0, got ${fx.shockwave}`);
      assert.equal(fx.shockwaveAmp, 1.0, `At drop start intoSec=0, amp should be 1.0, got ${fx.shockwaveAmp}`);
    });

    testCase('Shockwave progresses strictly 0->1 and shockwaveAmp decays monotonically', () => {
      const samples = 50;
      let prevProgress = -1;
      let prevAmp = 2;
      for (let i = 1; i < samples; i++) {
        const intoSec = shockDuration * (i / samples);
        const t = dropSec.start + intoSec;
        const p = intoSec / shockDuration;
        const expectedAmp = Math.pow(1 - p, 1.8);

        const { fx } = env.evalGrade(t);
        assert(Math.abs(fx.shockwave - p) < 1e-6, `Shockwave progress mismatch at intoSec=${intoSec}: got ${fx.shockwave}, expected ${p}`);
        assert(Math.abs(fx.shockwaveAmp - expectedAmp) < 1e-6, `Shockwave amp mismatch at intoSec=${intoSec}: got ${fx.shockwaveAmp}, expected ${expectedAmp}`);

        assert(fx.shockwave > prevProgress, `Shockwave progress must strictly increase: prev=${prevProgress}, curr=${fx.shockwave}`);
        assert(fx.shockwaveAmp < prevAmp, `Shockwave amp must strictly decay: prev=${prevAmp}, curr=${fx.shockwaveAmp}`);

        prevProgress = fx.shockwave;
        prevAmp = fx.shockwaveAmp;
      }
    });

    testCase('Shockwave clears completely after shockDuration', () => {
      const testTimes = [
        dropSec.start + shockDuration, // boundary
        dropSec.start + shockDuration + 0.001,
        dropSec.start + shockDuration + 0.1,
        dropSec.start + env.beatSec * 2,
        dropSec.end - 0.1,
      ];
      for (const t of testTimes) {
        const { fx } = env.evalGrade(t);
        assert.equal(fx.shockwave, 0, `Shockwave at t=${t}s must be cleared (0), got ${fx.shockwave}`);
        assert.equal(fx.shockwaveAmp, 0, `ShockwaveAmp at t=${t}s must be cleared (0), got ${fx.shockwaveAmp}`);
      }
    });

    testCase('Shockwave does not trigger in other sections', () => {
      for (const s of [env.sections[0], env.sections[1], env.sections[3], env.sections[5]]) {
        const { fx } = env.evalGrade(s.start + 0.1);
        assert.equal(fx.shockwave, 0, `Section ${s.label} shockwave must be 0`);
        assert.equal(fx.shockwaveAmp, 0, `Section ${s.label} shockwaveAmp must be 0`);
      }
    });
  }

  // ==========================================
  // SUITE 4: Seek Idempotency (Pure Function Invariance)
  // ==========================================
  console.log('\n--- SUITE 4: Seek Idempotency ---');
  {
    const env = createTestEnvironment(120, 4);

    // Create 60 diverse sampling points spanning all sections & phases
    const testPoints = [];
    const buildSec = env.sections[1];
    const dropSec = env.sections[2];
    const shockDur = env.beatSec * 1.25;

    // Normal points
    testPoints.push(1.0, 5.0, 10.0, 15.0);
    // Build before collapse
    testPoints.push(16.5, 20.0, 25.0, 27.9);
    // Build inside collapse
    for (let f = 0; f <= 1.0; f += 0.1) testPoints.push(28.0 + f * 4.0 - 0.001);
    // Exact section transition
    testPoints.push(31.999, 32.0, 32.001);
    // Drop inside shockwave
    for (let f = 0; f <= 1.0; f += 0.1) testPoints.push(32.0 + f * shockDur);
    // Drop after shockwave
    testPoints.push(32.0 + shockDur + 0.01, 33.0, 35.0, 40.0, 47.9);
    // Outro
    testPoints.push(72.0, 75.0, 79.5);

    testCase('1,000 Random Cross-Boundary Seeks produce bitwise identical Fx results', () => {
      // 1. Establish ground truth by single sequential pass
      const groundTruth = new Map();
      for (const t of testPoints) {
        const { fx } = env.evalGrade(t);
        groundTruth.set(t, { ...fx });
      }

      // 2. Perform 1000 random seeks jumping across timestamps
      let comparisons = 0;
      for (let run = 0; run < 1000; run++) {
        // Pick random timestamp from testPoints
        const t = testPoints[Math.floor(Math.random() * testPoints.length)];
        const { fx } = env.evalGrade(t);
        const expected = groundTruth.get(t);

        assert.equal(fx.collapse, expected.collapse, `Collapse state leaked on seek to ${t}`);
        assert.equal(fx.shockwave, expected.shockwave, `Shockwave state leaked on seek to ${t}`);
        assert.equal(fx.shockwaveAmp, expected.shockwaveAmp, `ShockwaveAmp state leaked on seek to ${t}`);
        assert.equal(fx.ca, expected.ca, `CA state leaked on seek to ${t}`);
        assert.equal(fx.pixel, expected.pixel, `Pixel state leaked on seek to ${t}`);
        comparisons++;
      }
      console.log(`    Validated ${comparisons} random seeks across section boundaries with 100% identity`);
      results.metrics.seekComparisons = comparisons;
    });
  }

  // ==========================================
  // SUITE 5: Pixel Suppression During Drop Shockwave
  // ==========================================
  console.log('\n--- SUITE 5: Pixel Suppression ---');
  {
    const env = createTestEnvironment(120, 4);
    const dropSec = env.sections[2]; // start = 32s
    const beat = env.beatSec; // 0.5s

    testCase('fx.pixel is suppressed (evaluates to 0) during drop shockwave on first beat', () => {
      // On the first beat (intoSec < beat = 0.5s), normal code without shockwave would compute:
      // basePixel = 48 * Math.pow(1 - intoSec / beat, 2) which is up to 48.
      // But because shockwaveAmp > 0.01, pixelDamp is 0, suppressing basePixel!
      const steps = 25;
      for (let i = 0; i < steps; i++) {
        const intoSec = (beat - 0.001) * (i / steps);
        const t = dropSec.start + intoSec;
        const { fx } = env.evalGrade(t);
        assert(fx.shockwaveAmp > 0.01, `shockwaveAmp should be > 0.01 during first beat, got ${fx.shockwaveAmp}`);
        assert.equal(fx.pixel, 0, `fx.pixel at intoSec=${intoSec.toFixed(3)}s was not suppressed, got ${fx.pixel}`);
      }
    });

    testCase('Shockwave amp threshold suppresses pixel strictly when shockwaveAmp > 0.01', () => {
      // Verify theoretical damp behavior:
      // At intoSec = 0.1, basePixel would be 48 * (1 - 0.1/0.5)^2 = 48 * 0.64 = 30.72.
      const { fx } = env.evalGrade(dropSec.start + 0.1);
      assert.equal(fx.pixel, 0, `Pixel at intoSec=0.1 must be 0, got ${fx.pixel}`);
      assert(fx.shockwaveAmp > 0.5, `ShockwaveAmp at intoSec=0.1 is ${fx.shockwaveAmp}`);
    });
  }

  // ==========================================
  // SUITE 6: Engine GradeShader & Uniforms Contract
  // ==========================================
  console.log('\n--- SUITE 6: Engine GradeShader Contract ---');
  {
    const fs = await import('node:fs');
    const engineSrc = fs.readFileSync(path.join(PROJECT, 'src/render/engine.ts'), 'utf-8');

    testCase('defaultFx() initializes collapse, shockwave, shockwaveAmp to 0', () => {
      const fx = defaultFx();
      assert.equal(fx.collapse, 0, 'defaultFx collapse must be 0');
      assert.equal(fx.shockwave, 0, 'defaultFx shockwave must be 0');
      assert.equal(fx.shockwaveAmp, 0, 'defaultFx shockwaveAmp must be 0');
      assert.equal(fx.stained, 0, 'defaultFx stained must be 0');
      assert.equal(fx.blueprint, 0, 'defaultFx blueprint must be 0');
    });

    testCase('GradeShader uniforms declare uCollapse, uShockwaveProgress, uShockwaveAmp', () => {
      assert(engineSrc.includes('uCollapse: { value: 0 }'), 'GradeShader missing uCollapse in engine.ts');
      assert(engineSrc.includes('uShockwaveProgress: { value: 0 }'), 'GradeShader missing uShockwaveProgress in engine.ts');
      assert(engineSrc.includes('uShockwaveAmp: { value: 0 }'), 'GradeShader missing uShockwaveAmp in engine.ts');
      assert(engineSrc.includes('u.uCollapse.value = fx.collapse;'), 'Engine render missing fx.collapse assignment');
      assert(engineSrc.includes('u.uShockwaveProgress.value = fx.shockwave;'), 'Engine render missing fx.shockwave assignment');
      assert(engineSrc.includes('u.uShockwaveAmp.value = fx.shockwaveAmp;'), 'Engine render missing fx.shockwaveAmp assignment');
    });

    testCase('GradeShader fragmentShader contains mirror protection and shockwave C1 formula', () => {
      assert(engineSrc.includes('vec2 mirror(vec2 p)'), 'GradeShader missing mirror boundary function');
      assert(engineSrc.includes('uCollapse > 0.001'), 'GradeShader missing uCollapse branch');
      assert(engineSrc.includes('uShockwaveAmp > 0.001'), 'GradeShader missing uShockwaveAmp branch');
      assert(engineSrc.includes('pow(uShockwaveProgress, 0.65) * 1.45'), 'GradeShader missing Taylor-Sedov 0.65 expansion formula');
      assert(engineSrc.includes('uWordsOn > 0.5'), 'GradeShader missing unwarped vUv lyrics layer');
      assert(engineSrc.includes('uv = mirror(uv)'), 'GradeShader missing mirror UV clamp');
    });
  }

  // ==========================================
  // SUITE 7: Boundary Conditions & Hostile Inputs
  // ==========================================
  console.log('\n--- SUITE 7: Boundary Conditions & Hostile Inputs ---');
  {
    testCase('Extreme BPM (300 BPM) and Slow BPM (40 BPM) compute stable finite numbers', () => {
      for (const bpm of [40, 60, 180, 240, 300]) {
        const env = createTestEnvironment(bpm, 4);
        for (const s of env.sections) {
          const { fx } = env.evalGrade(s.start + 0.05);
          assert(Number.isFinite(fx.collapse), `Collapse not finite at BPM ${bpm}`);
          assert(Number.isFinite(fx.shockwave), `Shockwave not finite at BPM ${bpm}`);
          assert(Number.isFinite(fx.shockwaveAmp), `ShockwaveAmp not finite at BPM ${bpm}`);
          assert(Number.isFinite(fx.ca), `CA not finite at BPM ${bpm}`);
          assert(Number.isFinite(fx.pixel), `Pixel not finite at BPM ${bpm}`);
        }
      }
    });

    testCase('Short Build Section (1 bar total duration < 2 bars window) clamps cleanly without NaN', () => {
      const beatSec = 0.5;
      const barSec = 2.0;
      const analysis = {
        version: 2, bpm: 120, meter: 4, duration: 40,
        beats: Array.from({ length: 80 }, (_, i) => i * beatSec),
        downbeats: Array.from({ length: 20 }, (_, i) => i * barSec),
        beatInBar: Array.from({ length: 80 }, (_, i) => i % 4),
        sections: [
          { start: 0, end: 10, label: 'verse', energy: 0.4 },
          { start: 10, end: 12, label: 'build', energy: 0.7 }, // Only 2s long (1 bar)!
          { start: 12, end: 20, label: 'drop', energy: 0.95 },
        ],
        hits: { kick: [], snare: [], vocal: [], leads: [], keys: [] },
        env: { fps: 60, rms: new Float32Array(2400).fill(0.5) },
      };
      const music = new Music(analysis);
      const lyrics = new LyricTrack([], 60);
      const shots = analysis.sections.map((sec, idx) => ({ scene: 'drive', start: sec.start, end: sec.end, seed: idx, section: sec, sectionIndex: idx }));
      const mock = { music, style: { id: 'neon' }, shots, lyrics };

      // At start of 1-bar build (t = 10.0), remain = 2.0s, barLen*2 = 4.0s.
      // p = 1 - 2.0/4.0 = 0.5.
      const fx10 = defaultFx();
      Director.prototype['grade'].call(mock, 10.0, shots[1], fx10, beatSec);
      assert(Number.isFinite(fx10.collapse) && fx10.collapse > 0.2, `Short build start collapse=${fx10.collapse}`);

      // At end of short build (t = 11.99)
      const fx119 = defaultFx();
      Director.prototype['grade'].call(mock, 11.99, shots[1], fx119, beatSec);
      assert(Number.isFinite(fx119.collapse) && fx119.collapse > 0.9, `Short build end collapse=${fx119.collapse}`);
    });
  }

  // ==========================================
  // SUITE 8: Real Director.frame() End-to-End Integration
  // ==========================================
  console.log('\n--- SUITE 8: Real Director.frame() End-to-End Integration ---');
  {
    const { STYLES } = await vite.ssrLoadModule('/src/style/style.ts');

    const env = createTestEnvironment(120, 4);
    const mockScene = {
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500),
      update: () => {},
    };
    const scenes = { drive: mockScene };
    const palette = {
      ink: new THREE.Color(0x0a0a0b),
      paper: new THREE.Color(0xf0f0f0),
      signal: new THREE.Color(0x00ffcc),
      accent: new THREE.Color(0xff0066),
      light: false,
      backdrop: new THREE.Color(0x000000),
      graphic: true,
      complexity: 0.1,
      mono: false,
      css: { ink: '#0a0a0b', paper: '#f0f0f0', signal: '#00ffcc', accent: '#ff0066' },
    };

    const director = new Director(
      STYLES.pulse,
      env.shots,
      scenes,
      env.music,
      new LyricTrack([], 60),
      palette,
      undefined,
      undefined,
      false,
      [],
    );

    testCase('Director.frame() correctly drives build collapse and CA end-to-end', () => {
      // Build section is 16s..32s, collapse window is 28s..32s
      const fPre = director.frame(26.0, 1 / 60, 16 / 9);
      assert.equal(fPre.fx.collapse, 0, `Pre-window collapse must be 0, got ${fPre.fx.collapse}`);

      const fMid = director.frame(30.0, 1 / 60, 16 / 9); // half-way in 4s window (p = 0.5)
      assert(fMid.fx.collapse > 0.25 && fMid.fx.collapse < 0.35, `Mid-window collapse expected ~0.29, got ${fMid.fx.collapse}`);
      assert(fMid.fx.ca > 0.4 && fMid.fx.ca < 0.45, `Mid-window CA expected ~0.425, got ${fMid.fx.ca}`);

      const fEnd = director.frame(31.99, 1 / 60, 16 / 9); // near end of window
      assert(fEnd.fx.collapse > 0.95, `End-window collapse expected >0.95, got ${fEnd.fx.collapse}`);
      assert(fEnd.fx.ca > 0.8, `End-window CA expected >0.8, got ${fEnd.fx.ca}`);
    });

    testCase('Director.frame() correctly drives drop shockwave and clears after duration', () => {
      // Drop section is 32s..48s, shockDuration is 0.5 * 1.25 = 0.625s (32.0s .. 32.625s)
      const fDrop0 = director.frame(32.0, 1 / 60, 16 / 9);
      assert.equal(fDrop0.fx.collapse, 0, 'Collapse must reset to 0 at drop start');
      assert.equal(fDrop0.fx.shockwave, 0, 'Shockwave progress at t=32 must be 0');
      assert.equal(fDrop0.fx.shockwaveAmp, 1.0, 'ShockwaveAmp at t=32 must be 1.0');
      assert.equal(fDrop0.fx.pixel, 0, 'Pixel must be suppressed at drop start');

      const fDropMid = director.frame(32.3125, 1 / 60, 16 / 9); // exactly half-way
      assert(Math.abs(fDropMid.fx.shockwave - 0.5) < 0.01, `Mid shockwave progress expected 0.5, got ${fDropMid.fx.shockwave}`);
      assert(fDropMid.fx.shockwaveAmp > 0.25 && fDropMid.fx.shockwaveAmp < 0.32, `Mid shockwaveAmp expected ~0.287, got ${fDropMid.fx.shockwaveAmp}`);
      assert.equal(fDropMid.fx.pixel, 0, 'Pixel must be suppressed during mid-shockwave');

      const fDropCleared = director.frame(32.65, 1 / 60, 16 / 9); // after 0.625s
      assert.equal(fDropCleared.fx.shockwave, 0, 'Shockwave must clear after duration');
      assert.equal(fDropCleared.fx.shockwaveAmp, 0, 'ShockwaveAmp must clear after duration');
    });

    testCase('Director.frame() 10,000 subframe continuous Seek stress testing', () => {
      const timestamps = [10.0, 27.5, 29.0, 31.0, 31.99, 32.0, 32.1, 32.5, 33.0, 50.0];
      const baselines = timestamps.map(t => director.frame(t, 1 / 60, 16 / 9));

      for (let i = 0; i < 10000; i++) {
        const idx = Math.floor(Math.random() * timestamps.length);
        const t = timestamps[idx];
        const f = director.frame(t, 1 / 60, 16 / 9);
        const base = baselines[idx];

        assert.equal(f.fx.collapse, base.fx.collapse, `Frame collapse mismatch at t=${t}`);
        assert.equal(f.fx.shockwave, base.fx.shockwave, `Frame shockwave mismatch at t=${t}`);
        assert.equal(f.fx.shockwaveAmp, base.fx.shockwaveAmp, `Frame shockwaveAmp mismatch at t=${t}`);
        assert.equal(f.fx.ca, base.fx.ca, `Frame CA mismatch at t=${t}`);
        assert.equal(f.fx.pixel, base.fx.pixel, `Frame pixel mismatch at t=${t}`);
      }
      console.log('    Validated 10,000 high-frequency Director.frame() calls with 100% determinism');
    });
  }

  await vite.close();

  console.log('\n=============================================');
  console.log(`SUMMARY: ${results.passedTests}/${results.totalTests} tests PASSED (0 failures)`);
  console.log('Key Metrics:');
  console.log('  Max Build Collapse reached:', results.metrics.maxBuildCollapse);
  console.log('  Max CA reached:', results.metrics.maxCA);
  console.log('  Seek Idempotency Invariance checks: 1000 + 10000 (frame level)');
  console.log('  Sample progressive curve:');
  for (const s of results.metrics.sampleReadings) {
    console.log(`    p=${s.p.toFixed(2)} => collapse=${s.collapse.toFixed(4)}, ca=${s.ca.toFixed(4)}`);
  }
  console.log('=============================================');
}

runEmpiricalChallenge().catch((err) => {
  console.error('Empirical challenge failed with error:', err);
  process.exit(1);
});
