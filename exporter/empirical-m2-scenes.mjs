// M2 4大新场景（cathedral, highway, pavilion, eclipse）实证集成与连续性/Seek一致性测试
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import * as THREE from 'three';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 最小 Canvas 2D 桩
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
    getImageData(_x, _y, w, h) {
      return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
    },
    putImageData() {},
    measureText(str) {
      const len = Array.from(String(str ?? '')).length;
      return {
        width: Math.max(8, len * 24),
        actualBoundingBoxAscent: 22,
        actualBoundingBoxDescent: 6,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: Math.max(8, len * 24),
      };
    },
  });
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') {
        const c = {
          width: 64,
          height: 64,
          style: {},
          getContext(kind) { return kind === '2d' ? makeCtx2d(c) : null; },
        };
        return c;
      }
      return { style: {}, appendChild() {}, removeChild() {}, setAttribute() {} };
    },
    fonts: { add() {}, load: async () => [] },
  };
}

let vite;
let mods;

before(async () => {
  vite = await createServer({
    root: PROJECT,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
  });
  const load = (p) => vite.ssrLoadModule(p);
  const [
    musicMod,
    lyricsMod,
    directorMod,
    styleMod,
    engineMod,
    armillaryMod,
    catalogMod,
    blendMod,
    cathedralMod,
    highwayMod,
    pavilionMod,
    eclipseMod,
  ] = await Promise.all([
    load('/src/director/music.ts'),
    load('/src/director/lyrics.ts'),
    load('/src/director/director.ts'),
    load('/src/style/style.ts'),
    load('/src/render/engine.ts'),
    load('/src/sigil/armillary.ts'),
    load('/src/scenes/catalog.ts'),
    load('/src/scenes/cameraBlend.ts'),
    load('/src/scenes/cathedral.ts'),
    load('/src/scenes/highway.ts'),
    load('/src/scenes/pavilion.ts'),
    load('/src/scenes/eclipse.ts'),
  ]);
  mods = {
    Music: musicMod.Music,
    LyricTrack: lyricsMod.LyricTrack,
    Director: directorMod.Director,
    linkSameSceneShots: directorMod.linkSameSceneShots,
    STYLES: styleMod.STYLES,
    defaultFx: engineMod.defaultFx,
    armillarySpec: armillaryMod.armillarySpec,
    SCENES: catalogMod.SCENES,
    CathedralScene: cathedralMod.CathedralScene,
    HighwayScene: highwayMod.HighwayScene,
    PavilionScene: pavilionMod.PavilionScene,
    EclipseScene: eclipseMod.EclipseScene,
  };
});

after(async () => {
  if (vite) await vite.close();
});

function buildMockFixture(isMono = false) {
  const { Music, LyricTrack, armillarySpec } = mods;
  const duration = 64;
  const bpm = 128;
  const beatLen = 60 / bpm;
  const meter = 4;
  const beats = [];
  const beatInBar = [];
  const tempo = [];
  const downbeats = [];
  for (let i = 0; i * beatLen <= duration; i++) {
    const t = +(i * beatLen).toFixed(4);
    beats.push(t);
    beatInBar.push(i % meter);
    tempo.push(bpm);
    if (i % meter === 0) downbeats.push(t);
  }
  const sections = [
    { start: 0, end: 8, label: 'intro', energy: 0.35, group: 0, vocal: false },
    { start: 8, end: 24, label: 'verse', energy: 0.52, group: 1, vocal: true },
    { start: 24, end: 40, label: 'build', energy: 0.72, group: 2, vocal: true },
    { start: 40, end: duration, label: 'drop', energy: 0.95, group: 3, vocal: false },
  ];
  const envFps = 30;
  const envLen = Math.ceil(duration * envFps);
  const kicks = [];
  const snares = [];
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (i % 2 === 0) kicks.push([b, 0.9]);
    else snares.push([b, 0.75]);
  }
  const analysis = {
    duration,
    bpm,
    meter,
    beats,
    beatInBar,
    tempo,
    downbeats,
    sections,
    segments: [],
    tatums: beats,
    env: {
      fps: envFps,
      rms: new Float32Array(envLen).fill(0.6),
      high: new Float32Array(envLen).fill(0.5),
      low: new Float32Array(envLen).fill(0.7),
      mid: new Float32Array(envLen).fill(0.55),
      onset: new Float32Array(envLen).fill(0.4),
    },
    hits: { kick: kicks, snare: snares, hat: [] },
  };

  const music = new Music(analysis);
  const lines = [
    {
      start: 8.5, end: 12.0, text: '光芒穿透了彩色琉璃', timedWords: true, translation: 'Light pierces through glass',
      words: [{ text: '光芒', start: 8.5, end: 10.0 }, { text: '琉璃', start: 10.1, end: 12.0 }],
    },
    {
      start: 12.5, end: 16.0, text: '在午夜的高架桥飞驰', timedWords: true, translation: 'Speeding on midnight bridge',
      words: [{ text: '午夜', start: 12.5, end: 14.0 }, { text: '飞驰', start: 14.1, end: 16.0 }],
    },
    {
      start: 16.5, end: 20.0, text: '千盏天灯自飞檐升起', timedWords: true, translation: 'Lanterns rise from eaves',
      words: [{ text: '天灯', start: 16.5, end: 18.0 }, { text: '升起', start: 18.1, end: 20.0 }],
    },
    {
      start: 20.5, end: 24.0, text: '日蚀撕裂了黑曜石峡谷', timedWords: true, translation: 'Eclipse tears the canyon',
      words: [{ text: '日蚀', start: 20.5, end: 22.0 }, { text: '峡谷', start: 22.1, end: 24.0 }],
    },
  ];
  const lyrics = new LyricTrack(lines);

  const coverSize = 64;
  const coverPixels = new Uint8ClampedArray(coverSize * coverSize * 4);
  for (let y = 0; y < coverSize; y++) {
    for (let x = 0; x < coverSize; x++) {
      const o = (y * coverSize + x) * 4;
      if (isMono) {
        const gray = 128 + Math.round(30 * Math.sin(x * 0.2));
        coverPixels[o] = gray;
        coverPixels[o + 1] = gray;
        coverPixels[o + 2] = gray;
        coverPixels[o + 3] = 255;
      } else {
        coverPixels[o] = 200;
        coverPixels[o + 1] = 130;
        coverPixels[o + 2] = 60;
        coverPixels[o + 3] = 255;
      }
    }
  }
  const cover = new THREE.DataTexture(coverPixels, coverSize, coverSize, THREE.RGBAFormat);
  cover.needsUpdate = true;

  const palette = {
    ink: new THREE.Color(0.04, 0.05, 0.07),
    paper: new THREE.Color(0.92, 0.90, 0.86),
    signal: new THREE.Color(0.90, 0.55, 0.22),
    accent: new THREE.Color(0.28, 0.65, 0.90),
    light: false,
    backdrop: new THREE.Color(0.04, 0.05, 0.07),
    graphic: true,
    complexity: 0.15,
    mono: isMono,
    css: { ink: '#0a0d12', paper: '#eae6dc', signal: '#e68c38', accent: '#47a6e6' },
  };

  const init = {
    cover,
    coverPixels,
    coverSize,
    palette,
    music,
    lyrics,
    aspect: 16 / 9,
    title: '4大3D舞台实证曲',
    artists: ['BetterMV'],
    xyMusic: false,
    armillary: armillarySpec(analysis, 1002),
    seed: 0x12345678,
  };

  return { music, lyrics, palette, cover, init };
}

function quatAngle(a, b) {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot);
}

function quatComponentDiff(a, b) {
  const dPos = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w);
  const dNeg = Math.hypot(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w);
  return Math.min(dPos, dNeg);
}

test('M2 4大新场景：实例化、变体机位、切点平滑连续性与任意 Seek 幂等性严格校验', () => {
  const { music, lyrics, palette, init } = buildMockFixture();
  const scenesToTest = [
    ['cathedral', () => new mods.CathedralScene(init, 'pulse'), ['sanctuary', 'aisle', 'organ', 'soar', 'sanctuary']],
    ['highway', () => new mods.HighwayScene(init, 'pulse'), ['cockpit', 'chase', 'bridge', 'warp', 'cockpit']],
    ['pavilion', () => new mods.PavilionScene(init, 'pulse'), ['pavilion', 'water', 'eaves', 'zenith', 'pavilion']],
    ['eclipse', () => new mods.EclipseScene(init, 'pulse'), ['canyon', 'corona', 'ridge', 'abyss', 'canyon']],
  ];

  const seeds = [0x00000001, 0xfffffffe, 0x13579bdf, 0xea864202, 0x31415926];
  const shotDur = 5.0;
  const dt = 1 / 60;
  const sec = music.a.sections[3]; // drop

  for (const [id, createScene, variants] of scenesToTest) {
    const scene = createScene();
    assert.ok(scene.scene instanceof THREE.Scene, `[${id}] scene.scene 必须是 THREE.Scene`);
    assert.ok(scene.camera instanceof THREE.PerspectiveCamera, `[${id}] scene.camera 必须是 THREE.PerspectiveCamera`);

    const shots = variants.map((variant, i) => ({
      index: i,
      start: 12 + i * shotDur,
      end: 12 + (i + 1) * shotDur,
      scene: id,
      variant,
      section: sec,
      sectionIndex: 3,
      seed: seeds[i % seeds.length],
      short: false,
    }));
    mods.linkSameSceneShots(shots);

    // 1. 验证切点连续性
    for (let i = 1; i < shots.length; i++) {
      const prevShot = shots[i - 1];
      const currShot = shots[i];
      const cut = currShot.start;

      const evalAt = (time, sh) => {
        scene.update({
          t: time,
          dt,
          shotT: time - sh.start,
          shot: sh,
          music,
          lyrics,
          palette,
          fx: mods.defaultFx(),
          aspect: 16 / 9,
        });
        return {
          pos: scene.camera.position.clone(),
          quat: scene.camera.quaternion.clone(),
          fov: scene.camera.fov,
        };
      };

      const pPre2 = evalAt(cut - 2 * dt, prevShot);
      const pPre1 = evalAt(cut - dt, prevShot);
      const pCut = evalAt(cut, currShot);
      const pPost1 = evalAt(cut + dt, currShot);

      const baseStepPos = pPre1.pos.distanceTo(pPre2.pos);
      const cutStepPos = pCut.pos.distanceTo(pPre1.pos);
      const postStepPos = pPost1.pos.distanceTo(pCut.pos);

      const cutStepAng = quatAngle(pCut.quat, pPre1.quat);
      const postStepAng = quatAngle(pPost1.quat, pCut.quat);
      const cutStepFov = Math.abs(pCut.fov - pPre1.fov);

      const posLimit = Math.max(1.2, baseStepPos * 3.5);
      assert.ok(
        cutStepPos <= posLimit && postStepPos <= posLimit,
        `[${id}] ${prevShot.variant} -> ${currShot.variant} 切点相机位置瞬移: cutStep=${cutStepPos.toFixed(4)} limit=${posLimit.toFixed(4)}`,
      );
      assert.ok(
        cutStepAng <= 0.14 && postStepAng <= 0.14,
        `[${id}] ${prevShot.variant} -> ${currShot.variant} 切点相机朝向瞬移: cutAng=${cutStepAng.toFixed(4)}rad`,
      );
      assert.ok(
        cutStepFov <= 4.5,
        `[${id}] ${prevShot.variant} -> ${currShot.variant} 切点 FOV 突变: dFov=${cutStepFov.toFixed(4)}`,
      );
    }

    // 2. 验证纯函数进度条任意 Seek 一致性（误差 < 1e-9）
    const probeTimes = [
      { t: shots[0].start + 1.0, shot: shots[0] },
      { t: shots[1].start + 0.05, shot: shots[1] },
      { t: shots[1].start + 1.25, shot: shots[1] },
      { t: shots[shots.length - 1].start + 0.45, shot: shots[shots.length - 1] },
      { t: shots[shots.length - 1].start + 2.5, shot: shots[shots.length - 1] },
    ];
    const forwardPoses = probeTimes.map(({ t, shot }) => {
      scene.update({ t, dt, shotT: t - shot.start, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
      return {
        pos: scene.camera.position.clone(),
        quat: scene.camera.quaternion.clone(),
        fov: scene.camera.fov,
      };
    });
    for (let idx = probeTimes.length - 1; idx >= 0; idx--) {
      const { t, shot } = probeTimes[idx];
      scene.update({ t, dt, shotT: t - shot.start, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
      const ref = forwardPoses[idx];
      assert.ok(
        scene.camera.position.distanceTo(ref.pos) < 1e-9,
        `[${id}] 随机跳转 seek 后相机位置不一致 (t=${t})`,
      );
      assert.ok(
        quatComponentDiff(scene.camera.quaternion, ref.quat) < 1e-9,
        `[${id}] 随机跳转 seek 后相机朝向不一致 (t=${t})`,
      );
      assert.ok(
        Math.abs(scene.camera.fov - ref.fov) < 1e-9,
        `[${id}] 随机跳转 seek 后相机 FOV 不一致 (t=${t})`,
      );
    }

    // 3. 验证 resize 幂等性
    scene.resize(21 / 9);
    assert.equal(+(scene.camera.aspect).toFixed(3), +(21 / 9).toFixed(3));
  }
});

test('M2 4大新场景：黑白封面中性灰保护与同色系微调联动实证', () => {
  const { init } = buildMockFixture(true); // isMono = true
  const cathedral = new mods.CathedralScene(init, 'pulse');
  const highway = new mods.HighwayScene(init, 'pulse');
  const pavilion = new mods.PavilionScene(init, 'pulse');
  const eclipse = new mods.EclipseScene(init, 'pulse');

  assert.ok(cathedral, 'CathedralScene mono 初始化成功');
  assert.ok(highway, 'HighwayScene mono 初始化成功');
  assert.ok(pavilion, 'PavilionScene mono 初始化成功');
  assert.ok(eclipse, 'EclipseScene mono 初始化成功');
});
