// M2 4大新场景（cathedral, highway, pavilion, eclipse）实证集成与连续性/Seek一致性测试
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
    LOOKS: catalogMod.LOOKS,
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

test('M2 4大新场景：黑白封面中性灰保护真实饱和度断言 (S <= 0.05)', () => {
  const { init } = buildMockFixture(true); // isMono = true
  const cathedral = new mods.CathedralScene(init, 'pulse');
  const highway = new mods.HighwayScene(init, 'pulse');
  const pavilion = new mods.PavilionScene(init, 'pulse');
  const eclipse = new mods.EclipseScene(init, 'pulse');

  const calcSat = (color) => {
    const srgb = { r: 0, g: 0, b: 0 };
    color.getRGB(srgb, THREE.SRGBColorSpace);
    const max = Math.max(srgb.r, srgb.g, srgb.b);
    const min = Math.min(srgb.r, srgb.g, srgb.b);
    const d = max - min;
    const l = (max + min) * 0.5;
    if (d < 1e-5) return 0;
    return d / (1 - Math.abs(2 * l - 1) + 1e-6);
  };

  // 1. Cathedral 关键色彩与圣坛灯光饱和度断言
  const cathColors = [
    ['cathedral.colorMain', cathedral.colorMain],
    ['cathedral.colorAccent', cathedral.colorAccent],
    ['cathedral.colorBright', cathedral.colorBright],
    ['cathedral.altarLight.color', cathedral.altarLight.color],
  ];
  for (const [name, col] of cathColors) {
    const s = calcSat(col);
    assert.ok(s <= 0.05, `[${name}] 黑白模式下饱和度过高: ${s.toFixed(4)} (必须 <= 0.05)`);
  }

  // 2. Highway 关键色彩、路灯出光色与尾灯饱和度断言
  const highColors = [
    ['highway.colorMain', highway.colorMain],
    ['highway.colorAccent', highway.colorAccent],
    ['highway.colorBright', highway.colorBright],
    ['highway.colorLampWarm', highway.colorLampWarm],
    ['highway.tailLightsMesh.color', highway.tailLightsMesh.material.color],
    ['highway.guardReflectors.color', highway.guardReflectorsInstanced.material.color],
  ];
  for (const [name, col] of highColors) {
    const s = calcSat(col);
    assert.ok(s <= 0.05, `[${name}] 黑白模式下饱和度过高: ${s.toFixed(4)} (必须 <= 0.05)`);
  }

  // 3. Pavilion 关键色彩饱和度断言
  const pavColors = [
    ['pavilion.colorMain', pavilion.colorMain],
    ['pavilion.colorGold', pavilion.colorGold],
    ['pavilion.colorDeep', pavilion.colorDeep],
  ];
  for (const [name, col] of pavColors) {
    const s = calcSat(col);
    assert.ok(s <= 0.05, `[${name}] 黑白模式下饱和度过高: ${s.toFixed(4)} (必须 <= 0.05)`);
  }

  // 4. Eclipse 关键色彩（重点检查原先强行染色的 colorLightning、闪电材质及新增多层火山岩色阶）
  const eclipColors = [
    ['eclipse.colorCorona', eclipse.colorCorona],
    ['eclipse.colorMagma', eclipse.colorMagma],
    ['eclipse.colorObsidian', eclipse.colorObsidian],
    ['eclipse.colorRockMid', eclipse.colorRockMid],
    ['eclipse.colorRockLight', eclipse.colorRockLight],
    ['eclipse.colorLightning', eclipse.colorLightning],
    ['eclipse.lightningMaterial.color', eclipse.lightningMaterial.color],
  ];
  for (const [name, col] of eclipColors) {
    const s = calcSat(col);
    assert.ok(s <= 0.05, `[${name}] 黑白模式下饱和度过高: ${s.toFixed(4)} (必须 <= 0.05)`);
  }
});

test('M2 4大新场景：Cathedral 光束旋转与 Eclipse 冲击波尺度跨 Drop 与 Seek 严格幂等断言 (误差=0)', () => {
  const { music, lyrics, palette, init } = buildMockFixture();

  // 1. Cathedral 光束旋转角退出 Drop 与 Seek 严格幂等断言
  {
    const shot = { scene: 'cathedral', start: 40, end: 64, variant: 'sanctuary', seed: 1, section: music.a.sections[3], sectionIndex: 3 };
    const cDirect = new mods.CathedralScene(init, 'pulse');
    cDirect.update({ t: 45, dt: 1 / 60, shotT: 5, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
    const rotDirect = cDirect.beamMeshes[0].rotation.z;

    const cPlayed = new mods.CathedralScene(init, 'pulse');
    // 在 Drop 峰值时刻更新 (t=40.5, dropFlash 高)
    cPlayed.update({ t: 40.5, dt: 1 / 60, shotT: 0.5, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
    // 跨过 Drop 更新到 t=45 (dropFlash 归零)
    cPlayed.update({ t: 45, dt: 1 / 60, shotT: 5, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
    const rotPlayed = cPlayed.beamMeshes[0].rotation.z;

    assert.equal(
      Math.abs(rotDirect - rotPlayed),
      0,
      `Cathedral 光束旋转角退出 Drop 后残留误差必须为 0: direct=${rotDirect} vs played=${rotPlayed}`,
    );

    // Seek 回非 Drop 段落 (t=5s)
    const introShot = { scene: 'cathedral', start: 0, end: 8, variant: 'aisle', seed: 1, section: music.a.sections[0], sectionIndex: 0 };
    cPlayed.update({ t: 5, dt: 1 / 60, shotT: 5, shot: introShot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
    const cIntro = new mods.CathedralScene(init, 'pulse');
    cIntro.update({ t: 5, dt: 1 / 60, shotT: 5, shot: introShot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
    assert.equal(
      Math.abs(cIntro.beamMeshes[0].rotation.z - cPlayed.beamMeshes[0].rotation.z),
      0,
      'Cathedral 光束旋转角跳转回 Intro 必须恢复基底角度且误差为 0',
    );
  }

  // 2. Eclipse 冲击波尺度退出 Drop 与 Seek 严格幂等断言
  {
    const shot = { scene: 'eclipse', start: 40, end: 64, variant: 'canyon', seed: 1, section: music.a.sections[3], sectionIndex: 3 };
    const eDirect = new mods.EclipseScene(init, 'pulse');
    eDirect.update({ t: 45, dt: 1 / 60, shotT: 5, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
    const scaleDirect = eDirect.shockwaveRingMesh.scale.x;

    const ePlayed = new mods.EclipseScene(init, 'pulse');
    // 在 Drop 冲击波时刻更新 (t=41.5)
    ePlayed.update({ t: 41.5, dt: 1 / 60, shotT: 1.5, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
    // 跨过 Drop 更新到 t=45
    ePlayed.update({ t: 45, dt: 1 / 60, shotT: 5, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
    const scalePlayed = ePlayed.shockwaveRingMesh.scale.x;

    assert.equal(
      Math.abs(scaleDirect - scalePlayed),
      0,
      `Eclipse 冲击波环尺度退出 Drop 后残留误差必须为 0: direct=${scaleDirect} vs played=${scalePlayed}`,
    );
    assert.equal(scalePlayed, 1.0, 'Eclipse 冲击波环尺度在退出 Drop 后必须严格恢复为 1.0');

    // Seek 回非 Drop 段落 (t=5s)
    const introShot = { scene: 'eclipse', start: 0, end: 8, variant: 'corona', seed: 1, section: music.a.sections[0], sectionIndex: 0 };
    ePlayed.update({ t: 5, dt: 1 / 60, shotT: 5, shot: introShot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
    assert.equal(
      ePlayed.shockwaveRingMesh.scale.x,
      1.0,
      'Eclipse 冲击波环尺度跳转回非 Drop 段落必须严格等于 1.0',
    );
  }
});

test('HighwayScene：跨海桥塔、路灯、护栏立柱、氮气拉丝与前车尾灯严格沿 +Z 迎面飞驰（杜绝卡在原地或倒退）', () => {
  const { music, lyrics, palette, init } = buildMockFixture();
  const highway = new mods.HighwayScene(init, 'pulse');
  const shot = { scene: 'highway', start: 8, end: 24, variant: 'cockpit', seed: 7, section: music.a.sections[1], sectionIndex: 1 };

  // 验证场景包含真实光源，确保斜拉桥塔与路灯金属杆不会因无光沦为纯黑隐身
  let lightCount = 0;
  highway.scene.traverse((obj) => {
    if (obj.isLight) lightCount++;
  });
  assert.ok(lightCount >= 2, `HighwayScene 必须包含至少 2 盏光源以照亮桥塔与路灯，当前=${lightCount}`);

  // 采样两个紧邻时刻 t0 -> t1 (dt = 0.04s，避开周期回折点)，校验所有前景参照物均向 +Z（朝向相机）高速迎面推进
  const t0 = 10.12;
  const t1 = 10.16;
  const fx0 = mods.defaultFx();
  highway.update({ t: t0, dt: 1 / 60, shotT: t0 - shot.start, shot, music, lyrics, palette, fx: fx0, aspect: 16 / 9 });

  const m = new THREE.Matrix4();
  const getInstZ = (instMesh, idx) => {
    instMesh.getMatrixAt(idx, m);
    return m.elements[14];
  };

  const d0 = highway.getDistanceAt(t0);
  const towerZ0 = highway.towerUnits.map((u) => u.position.z);
  const lampZ0 = getInstZ(highway.streetlightsInstanced, 4);
  const headZ0 = getInstZ(highway.lampHeadsInstanced, 4);
  const coneZ0 = getInstZ(highway.lampConesInstanced, 4);
  const postZ0 = getInstZ(highway.guardPostsInstanced, 6);
  const reflZ0 = getInstZ(highway.guardReflectorsInstanced, 6);
  const streakZ0 = getInstZ(highway.warpStreaksInstanced, 0);
  const tailZ0 = highway.tailLightsMesh.geometry.attributes.position.getZ(0);

  // 校验三维锥形光束、流线型复合灯杆及重工复合防撞护栏几何体精细度
  assert.ok(highway.lampConesInstanced.geometry.attributes.position.count >= 3000, '路灯双层三维丁达尔体积光锥顶点数必须足够精细');
  assert.ok(highway.guardBarrierMesh.geometry.attributes.position.count >= 8000, '两侧混凝土防撞基座与立体双波纹金属护栏复合网格必须具备充足立体折面');

  const fx1 = mods.defaultFx();
  highway.update({ t: t1, dt: 1 / 60, shotT: t1 - shot.start, shot, music, lyrics, palette, fx: fx1, aspect: 16 / 9 });

  const d1 = highway.getDistanceAt(t1);
  const dd = d1 - d0;
  assert.ok(dd > 1.5, `行驶距离必须高速单调递增: d0=${d0.toFixed(3)}, d1=${d1.toFixed(3)}`);
  assert.ok(fx1.travel > 12, `fx.travel 必须写入真实前进速度以联动引擎动态模糊, 当前=${fx1.travel}`);

  // 周期循环下的精确正向模位移校验：正向推进 +dd 时，无论是否跨过周期回折点，((z1 - z0) mod P) 恒精确等于 dd
  const modAdvance = (z0, z1, period) => (((z1 - z0) % period) + period) % period;

  for (let idx = 0; idx < highway.towerUnits.length; idx++) {
    const adv = modAdvance(towerZ0[idx], highway.towerUnits[idx].position.z, 3 * 112.0);
    assert.ok(Math.abs(adv - dd) < 1e-4, `跨海斜拉桥主塔[${idx}]必须精确沿 +Z 迎面推进 dd=${dd.toFixed(4)}, 实测=${adv.toFixed(4)}`);
  }

  const lampAdv = modAdvance(lampZ0, getInstZ(highway.streetlightsInstanced, 4), 18.0);
  assert.ok(Math.abs(lampAdv - dd) < 1e-4, `路灯杆必须精确沿 +Z 迎面呼啸掠过: 期望=${dd.toFixed(4)}, 实测=${lampAdv.toFixed(4)}`);

  const headAdv = modAdvance(headZ0, getInstZ(highway.lampHeadsInstanced, 4), 18.0);
  assert.ok(Math.abs(headAdv - dd) < 1e-4, `路灯发光灯头必须精确沿 +Z 迎面掠过: 期望=${dd.toFixed(4)}, 实测=${headAdv.toFixed(4)}`);

  const coneAdv = modAdvance(coneZ0, getInstZ(highway.lampConesInstanced, 4), 18.0);
  assert.ok(Math.abs(coneAdv - dd) < 1e-4, `路灯三维锥形光束必须与灯头零误差同步沿 +Z 迎面掠过: 期望=${dd.toFixed(4)}, 实测=${coneAdv.toFixed(4)}`);

  const postAdv = modAdvance(postZ0, getInstZ(highway.guardPostsInstanced, 6), 6.0);
  const reflAdv = modAdvance(reflZ0, getInstZ(highway.guardReflectorsInstanced, 6), 6.0);
  assert.ok(Math.abs(postAdv - dd) < 1e-4 && Math.abs(reflAdv - dd) < 1e-4, `工字钢立柱与反光轮廓标必须精确沿 +Z 高速迎面掠过: 期望=${dd.toFixed(4)}, 实测=${postAdv.toFixed(4)}`);

  const streakAdv = modAdvance(streakZ0, getInstZ(highway.warpStreaksInstanced, 0), 180.0);
  assert.ok(Math.abs(streakAdv - dd * 1.45) < 1e-3, `氮气流光拉丝必须实时沿 +Z 穿梭运动: 期望=${(dd * 1.45).toFixed(4)}, 实测=${streakAdv.toFixed(4)}`);

  const tailAdv = modAdvance(tailZ0, highway.tailLightsMesh.geometry.attributes.position.getZ(0), 240.0);
  assert.ok(tailAdv > 0.5 && tailAdv < dd, `前车流光尾灯必须具备真实正向超车相对位移: 实测=${tailAdv.toFixed(4)}`);
});

test('HighwayScene：夜空专辑封面明月（moonMesh）跨全机位、鼓点 FOV 脉冲与荷兰角倾斜保持屏幕投影 100% 静止（零后退、零漂移、零旋转）', () => {
  const { music, lyrics, palette, init } = buildMockFixture();
  const highway = new mods.HighwayScene(init, 'pulse');
  const variants = ['cockpit', 'chase', 'bridge', 'warp'];
  const sampleTimes = [8.2, 10.0, 14.35, 26.8, 40.02, 41.4, 48.75];

  const shots = variants.map((variant, idx) => ({
    index: idx,
    start: 8 + idx * 12,
    end: 8 + (idx + 1) * 12,
    scene: 'highway',
    variant,
    section: idx >= 2 ? music.a.sections[3] : music.a.sections[1],
    sectionIndex: idx >= 2 ? 3 : 1,
    seed: 0x10203040 + idx,
    short: false,
  }));
  mods.linkSameSceneShots(shots);

  const aspect = 16 / 9;
  const projectMoonPoint = (lx, ly) => {
    const p = new THREE.Vector3(lx, ly, 0);
    highway.moonMesh.updateMatrixWorld(true);
    p.applyMatrix4(highway.moonMesh.matrixWorld);
    p.project(highway.camera);
    return p;
  };

  for (const shot of shots) {
    for (const offset of [0.0, 0.18, 1.35, 4.72, 9.88]) {
      const t = Math.min(63.5, shot.start + offset);
      highway.update({
        t,
        dt: 1 / 60,
        shotT: t - shot.start,
        shot,
        music,
        lyrics,
        palette,
        fx: mods.defaultFx(),
        aspect,
      });
      highway.camera.updateProjectionMatrix();
      highway.camera.updateMatrixWorld(true);

      const centerNdc = projectMoonPoint(0, 0);
      const topNdc = projectMoonPoint(0, 1);
      const rightNdc = projectMoonPoint(1, 0);

      assert.ok(
        Math.abs(centerNdc.x - 0.0) < 1e-6 && Math.abs(centerNdc.y - 0.46) < 1e-6,
        `[${shot.variant} @ t=${t.toFixed(2)}] 明月中心屏幕坐标必须恒定在 (0, 0.46)，实测=(${centerNdc.x.toFixed(6)}, ${centerNdc.y.toFixed(6)})`,
      );
      assert.ok(
        Math.abs((topNdc.y - centerNdc.y) - 0.28) < 1e-6 && Math.abs(topNdc.x - centerNdc.x) < 1e-6,
        `[${shot.variant} @ t=${t.toFixed(2)}] 明月顶端投影必须恒定正立且零后退缩放 (dy=0.28, dx=0)，实测=(dy=${(topNdc.y - centerNdc.y).toFixed(6)}, dx=${(topNdc.x - centerNdc.x).toFixed(6)})`,
      );
      assert.ok(
        Math.abs((rightNdc.x - centerNdc.x) - 0.28 / aspect) < 1e-6 && Math.abs(rightNdc.y - centerNdc.y) < 1e-6,
        `[${shot.variant} @ t=${t.toFixed(2)}] 明月横向视觉半径必须恒定不随 FOV 改变，实测 dx=${(rightNdc.x - centerNdc.x).toFixed(6)}`,
      );
    }
  }

  // 额外校验跨任意时间采样点的屏幕直径差严格为 0
  let refRadiusY = null;
  for (const t of sampleTimes) {
    const shot = shots[Math.min(shots.length - 1, Math.floor(Math.max(0, t - 8) / 12))];
    highway.update({ t, dt: 1 / 60, shotT: t - shot.start, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect });
    highway.camera.updateProjectionMatrix();
    highway.camera.updateMatrixWorld(true);
    const ry = projectMoonPoint(0, 1).y - projectMoonPoint(0, 0).y;
    if (refRadiusY === null) refRadiusY = ry;
    assert.ok(Math.abs(ry - refRadiusY) < 1e-7, `明月视觉半径在 t=${t} 发生漂移或后退缩放: ${ry} vs ${refRadiusY}`);
  }
});

test('EclipseScene：火山柱状玄武岩与黑曜石断崖立体几何、内向法线朝向与着色器多尺度岩层纹理校验', () => {
  const { music, lyrics, palette, init } = buildMockFixture();
  const eclipse = new mods.EclipseScene(init, 'pulse');

  // 1. 校验峡谷群组包含左右高精度雕刻断崖 + 至少 22 座凸出玄武岩柱与峡门巨峰（彻底告别平板 BoxGeometry）
  assert.ok(
    eclipse.canyonGroup.children.length >= 24,
    `canyonGroup 必须包含左右连续断崖与至少 22 座凸出玄武岩柱，实测=${eclipse.canyonGroup.children.length}`,
  );
  const leftWall = eclipse.canyonGroup.children[0];
  const rightWall = eclipse.canyonGroup.children[1];
  const leftPos = leftWall.geometry.attributes.position;
  const leftNorm = leftWall.geometry.attributes.normal;
  const rightNorm = rightWall.geometry.attributes.normal;

  assert.ok(leftPos.count >= 4000, `单侧雕刻峡谷地形顶点数必须足够精细 (>=4000)，实测=${leftPos.count}`);

  // 统计主断崖段（iu = 10..28）的平均法线 X/Y 分量，确保正面严格朝向峡谷内部与上方（杜绝背面剔除隐身或光照反向）
  let leftSumNx = 0;
  let leftSumNy = 0;
  let rightSumNx = 0;
  let rightSumNy = 0;
  const stride = 43; // uSegs(42) + 1
  for (let iz = 10; iz < 90; iz += 4) {
    for (let iu = 10; iu <= 28; iu += 2) {
      const idx = iz * stride + iu;
      leftSumNx += leftNorm.getX(idx);
      leftSumNy += leftNorm.getY(idx);
      rightSumNx += rightNorm.getX(idx);
      rightSumNy += rightNorm.getY(idx);
    }
  }
  assert.ok(leftSumNx > 0 && leftSumNy > 0, `左壁断崖法线必须朝向峡谷内侧 (+X) 与上方 (+Y): nx=${leftSumNx.toFixed(2)}, ny=${leftSumNy.toFixed(2)}`);
  assert.ok(rightSumNx < 0 && rightSumNy > 0, `右壁断崖法线必须朝向峡谷内侧 (-X) 与上方 (+Y): nx=${rightSumNx.toFixed(2)}, ny=${rightSumNy.toFixed(2)}`);

  // 2. 校验着色器包含 3D 有限差分微法线、柱状玄武岩节理、熔岩河仰射暖光与日冕黑曜石高光，且 uCamPos 随帧实时同步
  const frag = eclipse.canyonMaterial.fragmentShader;
  assert.ok(frag.includes('volcanicRockField') && frag.includes('fbm3D'), '峡谷着色器必须包含 3D 多尺度火山玄武岩高度场');
  assert.ok(frag.includes('magmaBounce') && frag.includes('obsidianSpec'), '峡谷着色器必须包含熔岩仰射暖光与黑曜石高光照明');

  const ridgeShot = { scene: 'eclipse', start: 16, end: 24, variant: 'ridge', seed: 3, section: music.a.sections[1], sectionIndex: 1 };
  eclipse.update({ t: 18.5, dt: 1 / 60, shotT: 2.5, shot: ridgeShot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
  assert.ok(
    eclipse.canyonMaterial.uniforms.uCamPos.value.distanceTo(eclipse.camera.position) < 1e-9,
    'canyonMaterial.uniforms.uCamPos 必须与相机世界坐标实时精确同步',
  );
  // 校验 ridge 机位处于峡谷净空内（|x| < 10.5m），绝不穿入两侧岩体
  assert.ok(Math.abs(eclipse.camera.position.x) < 10.5, `ridge 机位不得穿入峡谷岩体: x=${eclipse.camera.position.x.toFixed(3)}`);
});

test('设置面板缩略图完整性：全部 49 个场景与 6 种媒介滤镜在 public/previews 下均存在有效 WebP 示意图', () => {
  const previewDir = path.join(PROJECT, 'public/previews');
  for (const s of mods.SCENES) {
    const file = path.join(previewDir, `${s.id}.webp`);
    assert.ok(fs.existsSync(file), `缺少场景预览示意图: public/previews/${s.id}.webp (${s.name})`);
    const buf = fs.readFileSync(file);
    assert.ok(
      buf.length > 512 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP',
      `场景预览示意图不是有效的非空 WebP 文件: ${s.id}.webp`,
    );
  }
  for (const lk of mods.LOOKS) {
    const file = path.join(previewDir, `look-${lk.id}.webp`);
    assert.ok(fs.existsSync(file), `缺少媒介滤镜预览示意图: public/previews/look-${lk.id}.webp (${lk.name})`);
    const buf = fs.readFileSync(file);
    assert.ok(
      buf.length > 512 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP',
      `媒介滤镜预览示意图不是有效的非空 WebP 文件: look-${lk.id}.webp`,
    );
  }
});
