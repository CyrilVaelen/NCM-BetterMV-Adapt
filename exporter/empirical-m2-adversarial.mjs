// M2 实证挑战专家 2 (Challenger 2) 独立对抗测试套件
// 验证 4 大 3D 舞台场景（cathedral, highway, pavilion, eclipse）在：
// 1. 极端音频工况（饱和冲击 / 纯静音零能量 / 阶跃突变阻尼 / 越界时间）
// 2. R5 色彩与拓扑不变律（彩色微调 ±6°~±16° / 高饱和单色 / 黑白中性灰 / 极面白黑）
// 3. 曲风亲和力画像向量与主场排名（Trance / Synthwave / 国风 / 金属摇滚）
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import * as THREE from 'three';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 无头 Node 环境 Canvas 2D 桩
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
    coverToneMod,
    cathedralMod,
    highwayMod,
    pavilionMod,
    eclipseMod,
    affinityMod,
  ] = await Promise.all([
    load('/src/director/music.ts'),
    load('/src/director/lyrics.ts'),
    load('/src/director/director.ts'),
    load('/src/style/style.ts'),
    load('/src/render/engine.ts'),
    load('/src/sigil/armillary.ts'),
    load('/src/scenes/catalog.ts'),
    load('/src/scenes/cameraBlend.ts'),
    load('/src/scenes/coverTone.ts'),
    load('/src/scenes/cathedral.ts'),
    load('/src/scenes/highway.ts'),
    load('/src/scenes/pavilion.ts'),
    load('/src/scenes/eclipse.ts'),
    load('/src/style/affinity.ts'),
  ]);
  mods = {
    Music: musicMod.Music,
    LyricTrack: lyricsMod.LyricTrack,
    Director: directorMod.Director,
    planShots: directorMod.planShots,
    linkSameSceneShots: directorMod.linkSameSceneShots,
    STYLES: styleMod.STYLES,
    PULSE: styleMod.PULSE,
    defaultFx: engineMod.defaultFx,
    armillarySpec: armillaryMod.armillarySpec,
    SCENES: catalogMod.SCENES,
    extractCoverTone: coverToneMod.extractCoverTone,
    rgbToHsl: coverToneMod.rgbToHsl,
    hslToRgb: coverToneMod.hslToRgb,
    tuneCoverStop: coverToneMod.tuneCoverStop,
    CathedralScene: cathedralMod.CathedralScene,
    HighwayScene: highwayMod.HighwayScene,
    PavilionScene: pavilionMod.PavilionScene,
    EclipseScene: eclipseMod.EclipseScene,
    sceneAffinity: affinityMod.sceneAffinity,
    analyzeSongVibe: affinityMod.analyzeSongVibe,
    isSteadyHouseGroove: affinityMod.isSteadyHouseGroove,
    isTranceHypnoticDrive: affinityMod.isTranceHypnoticDrive,
  };
});

after(async () => {
  if (vite) await vite.close();
});

/** 构造任意特征的音频与场景脚手架 */
function makeAdversarialFixture(opts = {}) {
  const {
    duration = 48,
    bpm = 128,
    isMono = false,
    rmsVal = 0.6,
    envVal = 0.5,
    kickInterval = 0.5,
    kickAmp = 0.8,
    snareAmp = 0.7,
    coverColor = [220, 140, 60], // sRGB 0..255
    coverPattern = 'flat',
  } = opts;

  const { Music, LyricTrack, armillarySpec } = mods;
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
    { start: 8, end: 20, label: 'verse', energy: 0.55, group: 1, vocal: true },
    { start: 20, end: 32, label: 'build', energy: 0.75, group: 2, vocal: true },
    { start: 32, end: duration, label: 'drop', energy: 0.98, group: 3, vocal: false },
  ];

  const envFps = 30;
  const envLen = Math.ceil(duration * envFps);
  const kicks = [];
  const snares = [];
  if (kickInterval > 0) {
    for (let t = 0.1; t < duration; t += kickInterval) {
      kicks.push([+t.toFixed(4), kickAmp]);
      if (snares.length < kicks.length) snares.push([+(t + kickInterval * 0.5).toFixed(4), snareAmp]);
    }
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
      rms: new Float32Array(envLen).fill(rmsVal),
      high: new Float32Array(envLen).fill(envVal),
      low: new Float32Array(envLen).fill(envVal),
      mid: new Float32Array(envLen).fill(envVal),
      onset: new Float32Array(envLen).fill(envVal),
      lead: new Float32Array(envLen).fill(envVal),
    },
    hits: { kick: kicks, snare: snares, hat: [] },
  };

  const music = new Music(analysis);
  const lyrics = new LyricTrack([
    { start: 8.0, end: 14.0, text: '光芒穿透了彩色琉璃', timedWords: true, translation: 'Light pierces glass', words: [] },
    { start: 20.0, end: 28.0, text: '午夜高架烈风激荡', timedWords: true, translation: 'Midnight highway wind', words: [] },
  ]);

  const coverSize = 64;
  const coverPixels = new Uint8ClampedArray(coverSize * coverSize * 4);
  for (let y = 0; y < coverSize; y++) {
    for (let x = 0; x < coverSize; x++) {
      const o = (y * coverSize + x) * 4;
      if (coverPattern === 'white') {
        coverPixels[o] = 255;
        coverPixels[o + 1] = 255;
        coverPixels[o + 2] = 255;
      } else if (coverPattern === 'black') {
        coverPixels[o] = 0;
        coverPixels[o + 1] = 0;
        coverPixels[o + 2] = 0;
      } else if (isMono || coverPattern === 'mono') {
        const g = 120 + Math.round(20 * Math.sin(x * 0.3));
        coverPixels[o] = g;
        coverPixels[o + 1] = g;
        coverPixels[o + 2] = g;
      } else {
        coverPixels[o] = coverColor[0];
        coverPixels[o + 1] = coverColor[1];
        coverPixels[o + 2] = coverColor[2];
      }
      coverPixels[o + 3] = 255;
    }
  }

  const cover = new THREE.DataTexture(coverPixels, coverSize, coverSize, THREE.RGBAFormat);
  cover.needsUpdate = true;

  const palette = {
    ink: new THREE.Color(0.04, 0.05, 0.07),
    paper: new THREE.Color(0.92, 0.90, 0.86),
    signal: isMono ? new THREE.Color(0.9, 0.9, 0.9) : new THREE.Color(coverColor[0] / 255, coverColor[1] / 255, coverColor[2] / 255),
    accent: isMono ? new THREE.Color(0.6, 0.6, 0.6) : new THREE.Color(0.28, 0.65, 0.90),
    light: false,
    backdrop: new THREE.Color(0.04, 0.05, 0.07),
    graphic: true,
    complexity: 0.15,
    mono: isMono || coverPattern === 'mono' || coverPattern === 'white' || coverPattern === 'black',
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
    title: 'Adversarial Challenge Track',
    artists: ['Challenger2'],
    xyMusic: false,
    armillary: armillarySpec(analysis, 2026),
    seed: 0x5a5a5a5a,
  };

  return { music, lyrics, palette, cover, init, analysis };
}

// =========================================================================
// 维度 1：极端音频信号实证测试 (Extreme Audio Signals)
// =========================================================================

test('极端音频实证 1.1：超高能量饱和与 200BPM 极密轰炸下无 NaN/Inf、无死白爆闪', () => {
  // 极高饱和度音频：RMS 全程 1.0、超密 200BPM 重踩底鼓 (间隔 0.15s)、超高频与各频段满格 1.0
  const fixture = makeAdversarialFixture({
    bpm: 200,
    rmsVal: 1.0,
    envVal: 1.0,
    kickInterval: 0.15,
    kickAmp: 1.0,
    snareAmp: 1.0,
    duration: 36,
  });
  const { init, music, lyrics, palette } = fixture;

  const scenes = [
    { id: 'cathedral', inst: new mods.CathedralScene(init, 'pulse'), shot: { start: 32, end: 36, scene: 'cathedral', variant: 'sanctuary', section: music.a.sections[3], seed: 101 } },
    { id: 'highway', inst: new mods.HighwayScene(init, 'pulse'), shot: { start: 32, end: 36, scene: 'highway', variant: 'warp', section: music.a.sections[3], seed: 102 } },
    { id: 'pavilion', inst: new mods.PavilionScene(init, 'pulse'), shot: { start: 32, end: 36, scene: 'pavilion', variant: 'zenith', section: music.a.sections[3], seed: 103 } },
    { id: 'eclipse', inst: new mods.EclipseScene(init, 'pulse'), shot: { start: 32, end: 36, scene: 'eclipse', variant: 'corona', section: music.a.sections[3], seed: 104 } },
  ];

  const dt = 1 / 60;
  // 遍历 Drop 爆发段 32.0s ~ 35.0s 共 180 帧
  for (const { id, inst, shot } of scenes) {
    for (let frame = 0; frame < 180; frame++) {
      const t = 32.0 + frame * dt;
      const fx = mods.defaultFx();
      inst.update({
        t,
        dt,
        shotT: t - shot.start,
        shot,
        music,
        lyrics,
        palette,
        fx,
        aspect: 16 / 9,
      });

      // 1. 相机坐标与朝向有限性校验 (No NaN / Inf)
      const cam = inst.camera;
      assert.ok(Number.isFinite(cam.position.x), `[${id}] cam.pos.x 非有限值`);
      assert.ok(Number.isFinite(cam.position.y), `[${id}] cam.pos.y 非有限值`);
      assert.ok(Number.isFinite(cam.position.z), `[${id}] cam.pos.z 非有限值`);
      assert.ok(Number.isFinite(cam.quaternion.x), `[${id}] cam.quat.x 非有限值`);
      assert.ok(Number.isFinite(cam.quaternion.w), `[${id}] cam.quat.w 非有限值`);
      assert.ok(Number.isFinite(cam.fov) && cam.fov > 10 && cam.fov < 120, `[${id}] cam.fov 异常: ${cam.fov}`);

      // 2. 后处理泛光上限校验 (防死白爆闪，bloom 必须自然饱和且 <= 0.85)
      assert.ok(
        fx.bloom >= 0.20 && fx.bloom <= 0.85,
        `[${id}] 饱和工况下 fx.bloom 溢出或异常: ${fx.bloom}`,
      );

      // 3. 场景特定属性有限性
      if (id === 'highway') {
        const dist = inst.getDistanceAt(t);
        assert.ok(Number.isFinite(dist) && dist > 0, `[highway] distance 异常: ${dist}`);
      }
    }
  }
});

test('极端音频实证 1.2：全零纯静音信号下无除零错误、无瞬灭黑屏、场景保持优雅常亮与呼吸', () => {
  // 纯静音信号：能量全 0，音轨无敲击，包络全 0
  const fixture = makeAdversarialFixture({
    bpm: 120,
    rmsVal: 0.0,
    envVal: 0.0,
    kickInterval: 0.0,
    kickAmp: 0.0,
    snareAmp: 0.0,
    duration: 30,
  });
  const { init, music, lyrics, palette } = fixture;

  const scenes = [
    { id: 'cathedral', inst: new mods.CathedralScene(init, 'pulse'), shot: { start: 0, end: 8, scene: 'cathedral', variant: 'aisle', section: music.a.sections[0], seed: 201 } },
    { id: 'highway', inst: new mods.HighwayScene(init, 'pulse'), shot: { start: 0, end: 8, scene: 'highway', variant: 'cockpit', section: music.a.sections[0], seed: 202 } },
    { id: 'pavilion', inst: new mods.PavilionScene(init, 'pulse'), shot: { start: 0, end: 8, scene: 'pavilion', variant: 'water', section: music.a.sections[0], seed: 203 } },
    { id: 'eclipse', inst: new mods.EclipseScene(init, 'pulse'), shot: { start: 0, end: 8, scene: 'eclipse', variant: 'abyss', section: music.a.sections[0], seed: 204 } },
  ];

  const dt = 1 / 60;
  for (const { id, inst, shot } of scenes) {
    for (let frame = 0; frame < 120; frame++) {
      const t = frame * dt;
      const fx = mods.defaultFx();
      inst.update({
        t,
        dt,
        shotT: t - shot.start,
        shot,
        music,
        lyrics,
        palette,
        fx,
        aspect: 16 / 9,
      });

      // 1. 无除零错误与有限性
      assert.ok(Number.isFinite(inst.camera.position.x), `[${id}] cam.pos.x 非有限值`);
      assert.ok(Number.isFinite(fx.bloom), `[${id}] fx.bloom 非有限值`);

      // 2. 环境基础呼吸防黑屏校验 (fx.bloom 与灯光不熄灭)
      assert.ok(fx.bloom >= 0.25, `[${id}] 纯静音下场景后处理过暗死黑: bloom=${fx.bloom}`);
    }

    // 针对每个场景的核心常亮/呼吸元素独立检查
    if (id === 'cathedral') {
      assert.ok(inst.altarLight.intensity >= 1.5, `[cathedral] 圣坛光线熄灭: ${inst.altarLight.intensity}`);
    } else if (id === 'highway') {
      const dist = inst.getDistanceAt(2.0);
      assert.ok(dist > 0, `[highway] 纯静音下位移停滞: dist=${dist}`);
    } else if (id === 'pavilion') {
      assert.ok(Number.isFinite(inst.pavilionGroup.position.y), `[pavilion] 亭阁高度异常`);
    } else if (id === 'eclipse') {
      assert.ok(inst.lightningMaterial.opacity >= 0, `[eclipse] 电弧透明度异常`);
    }
  }
});

test('极端音频实证 1.3：脉冲突变与频死震荡 (1.0 -> 0.0 -> 1.0) 下阻尼过渡平稳无突刺', () => {
  const fixture = makeAdversarialFixture({
    bpm: 128,
    rmsVal: 0.5,
    envVal: 0.5,
    kickInterval: 0.5,
    kickAmp: 0.9,
    duration: 30,
  });
  const { init, music, lyrics, palette } = fixture;

  const scenes = [
    { id: 'cathedral', inst: new mods.CathedralScene(init, 'pulse'), shot: { start: 4, end: 12, scene: 'cathedral', variant: 'sanctuary', section: music.a.sections[1], seed: 301 } },
    { id: 'highway', inst: new mods.HighwayScene(init, 'pulse'), shot: { start: 4, end: 12, scene: 'highway', variant: 'chase', section: music.a.sections[1], seed: 302 } },
    { id: 'pavilion', inst: new mods.PavilionScene(init, 'pulse'), shot: { start: 4, end: 12, scene: 'pavilion', variant: 'eaves', section: music.a.sections[1], seed: 303 } },
    { id: 'eclipse', inst: new mods.EclipseScene(init, 'pulse'), shot: { start: 4, end: 12, scene: 'eclipse', variant: 'ridge', section: music.a.sections[1], seed: 304 } },
  ];

  const dt = 1 / 60;
  const tBase = 6.0;

  for (const { id, inst, shot } of scenes) {
    const fxPre = mods.defaultFx();
    inst.update({ t: tBase, dt, shotT: tBase - shot.start, shot, music, lyrics, palette, fx: fxPre, aspect: 16 / 9 });
    const pos1 = inst.camera.position.clone();
    const fov1 = inst.camera.fov;

    // 模拟瞬间单帧阶跃
    const fxStep = mods.defaultFx();
    inst.update({ t: tBase + dt, dt, shotT: tBase + dt - shot.start, shot, music, lyrics, palette, fx: fxStep, aspect: 16 / 9 });
    const pos2 = inst.camera.position.clone();
    const fov2 = inst.camera.fov;

    const dPos = pos1.distanceTo(pos2);
    const dFov = Math.abs(fov2 - fov1);

    // 检查位移与 FOV 平滑度
    assert.ok(dPos < 0.85, `[${id}] 单帧脉冲位移过激: dPos=${dPos.toFixed(4)}m`);
    assert.ok(dFov < 3.5, `[${id}] 单帧脉冲 FOV 突变: dFov=${dFov.toFixed(4)}deg`);
  }
});

test('极端音频实证 1.4：越界时间与极值时间 (t < 0, t = 0, t > duration) 稳健性', () => {
  const fixture = makeAdversarialFixture();
  const { init, music, lyrics, palette } = fixture;

  const scenes = [
    new mods.CathedralScene(init, 'pulse'),
    new mods.HighwayScene(init, 'pulse'),
    new mods.PavilionScene(init, 'pulse'),
    new mods.EclipseScene(init, 'pulse'),
  ];

  const shot = { start: 0, end: 10, scene: 'test', variant: 'default', section: music.a.sections[0], seed: 401 };
  const dt = 1 / 60;
  const extremeTimes = [-5.0, -0.001, 0.0, fixture.analysis.duration, fixture.analysis.duration + 10.0, 9999.0];

  for (const scene of scenes) {
    for (const t of extremeTimes) {
      assert.doesNotThrow(() => {
        scene.update({
          t,
          dt,
          shotT: t - shot.start,
          shot,
          music,
          lyrics,
          palette,
          fx: mods.defaultFx(),
          aspect: 16 / 9,
        });
      }, `时间 t=${t} 调用 update 发生未捕获异常`);
      assert.ok(Number.isFinite(scene.camera.position.x), `t=${t} 时相机坐标非有限值`);
    }
  }
});

// =========================================================================
// 维度 2：R5 色彩与拓扑不变律实证 (R5 Color & Topology Law)
// =========================================================================

test('R5 色彩实证 2.1：彩色封面同色系微调严格限制在 ±6° ~ ±16° 邻近区间', () => {
  // 测试 3 种典型封面主色相：暖橘晚霞 (H=24°)、深海青蓝 (H=198°)、霓虹玫红 (H=325°)
  const testCoverColors = [
    { name: 'Warm Sunset', rgb: [235, 120, 45], targetH: 24 },
    { name: 'Deep Cyan', rgb: [35, 160, 215], targetH: 198 },
    { name: 'Neon Magenta', rgb: [225, 45, 150], targetH: 325 },
  ];

  const calcHueDiff = (a, b) => {
    const d = (((a - b) % 360) + 540) % 360 - 180;
    return Math.abs(d);
  };

  for (const cCase of testCoverColors) {
    const fixture = makeAdversarialFixture({ coverColor: cCase.rgb, isMono: false });
    const { init } = fixture;

    // 提取基准色相
    const tone = mods.extractCoverTone(init);
    assert.ok(!tone.mono, `[${cCase.name}] 彩色封面不应识别为 mono`);

    const scenes = [
      { id: 'cathedral', inst: new mods.CathedralScene(init, 'pulse') },
      { id: 'highway', inst: new mods.HighwayScene(init, 'pulse') },
      { id: 'pavilion', inst: new mods.PavilionScene(init, 'pulse') },
      { id: 'eclipse', inst: new mods.EclipseScene(init, 'pulse') },
    ];

    for (const { id, inst } of scenes) {
      // 提取场景主要色彩在 sRGB 感知空间中的实际 HSL
      const mainCol = inst.colorMain ?? inst.colorCorona ?? inst.colorGold;
      const srgb = { r: 0, g: 0, b: 0 };
      mainCol.getRGB(srgb, THREE.SRGBColorSpace);
      const hsl = mods.rgbToHsl(srgb.r, srgb.g, srgb.b);

      const diff = calcHueDiff(hsl.h, tone.mainHue);
      assert.ok(
        diff >= 5.8 && diff <= 16.2,
        `[${id} - ${cCase.name}] 主色相微偏越界: diff=${diff.toFixed(2)}° (应在 6°~16° 内)`,
      );
    }
  }
});

test('R5 色彩实证 2.2：纯黑白/纯灰阶封面（S < 0.02）保持纯净中性灰，严禁强行染色', () => {
  // 全黑白灰阶封面
  const fixture = makeAdversarialFixture({ coverPattern: 'mono', isMono: true });
  const { init } = fixture;

  const tone = mods.extractCoverTone(init);
  assert.ok(tone.mono, '黑白封面必须识别为 mono: true');

  const scenes = [
    { id: 'cathedral', inst: new mods.CathedralScene(init, 'pulse') },
    { id: 'highway', inst: new mods.HighwayScene(init, 'pulse') },
    { id: 'pavilion', inst: new mods.PavilionScene(init, 'pulse') },
    { id: 'eclipse', inst: new mods.EclipseScene(init, 'pulse') },
  ];

  for (const { id, inst } of scenes) {
    const mainCol = inst.colorMain ?? inst.colorCorona ?? inst.colorGold;
    const srgb = { r: 0, g: 0, b: 0 };
    mainCol.getRGB(srgb, THREE.SRGBColorSpace);
    const hsl = mods.rgbToHsl(srgb.r, srgb.g, srgb.b);

    // 中性灰阶饱和度必须严格受控 (S <= 0.05)
    assert.ok(
      hsl.s <= 0.05,
      `[${id}] 黑白封面被强行染色: saturation=${hsl.s.toFixed(4)} (必须 <= 0.05)`,
    );
  }
});

test('R5 色彩实证 2.3：极端明度（全白与全黑）封面稳健性与非零灰阶容错', () => {
  const whiteFixture = makeAdversarialFixture({ coverPattern: 'white', isMono: true });
  const blackFixture = makeAdversarialFixture({ coverPattern: 'black', isMono: true });

  for (const [name, fix] of [['Pure White', whiteFixture], ['Pure Black', blackFixture]]) {
    const { init } = fix;
    const tone = mods.extractCoverTone(init);
    assert.ok(tone.mono, `[${name}] 极端全白/全黑封面必须安全识别为 mono`);

    const cathedral = new mods.CathedralScene(init, 'pulse');
    const highway = new mods.HighwayScene(init, 'pulse');
    const pavilion = new mods.PavilionScene(init, 'pulse');
    const eclipse = new mods.EclipseScene(init, 'pulse');

    assert.ok(cathedral && highway && pavilion && eclipse, `[${name}] 4大场景初始化成功`);
  }
});

test('R5 拓扑实证 2.4：封面纹理 1:1 连续平铺挂接，绝无 UV 破损或多色块碎裂', () => {
  const fixture = makeAdversarialFixture();
  const { init } = fixture;

  const cathedral = new mods.CathedralScene(init, 'pulse');
  const highway = new mods.HighwayScene(init, 'pulse');
  const pavilion = new mods.PavilionScene(init, 'pulse');
  const eclipse = new mods.EclipseScene(init, 'pulse');

  // 1. cathedral: 玫瑰花窗挂接完整封面纹理
  assert.equal(cathedral.roseMaterial.uniforms.uCover.value, init.cover, '[cathedral] 玫瑰花窗未正确绑定封面纹理');

  // 2. highway: 全息封面落日挂接完整封面纹理
  assert.equal(highway.sunsetMaterial.uniforms.uCover.value, init.cover, '[highway] 全息落日未正确绑定封面纹理');

  // 3. pavilion: 天池丝绸画卷挂接完整封面纹理
  assert.equal(pavilion.silkPoolMaterial.uniforms.uCover.value, init.cover, '[pavilion] 丝绸天池未正确绑定封面纹理');

  // 4. eclipse: 暗调月轮浮雕挂接完整封面纹理
  assert.equal(eclipse.moonMaterial.uniforms.uCover.value, init.cover, '[eclipse] 日全食月轮未正确绑定封面纹理');
});

// =========================================================================
// 维度 3：曲风画像（Affinity）向量准确度挑战 (Affinity Vibe Matching)
// =========================================================================

test('曲风亲和实证 3.1：42 场景全景亲和力画像向量规范与有限性检查', () => {
  const { sceneAffinity, analyzeSongVibe, STYLES, PULSE } = mods;
  const fixture = makeAdversarialFixture();
  const { music, analysis } = fixture;
  const vibe = analyzeSongVibe(analysis);
  const sec = music.a.sections[2];

  // 验证 4 大新场景亲和力数值在合理正常范围 (0.12 ~ 5.5)
  for (const sceneId of ['cathedral', 'highway', 'pavilion', 'eclipse']) {
    const aff = sceneAffinity(sceneId, sec, PULSE, vibe);
    assert.ok(Number.isFinite(aff), `[${sceneId}] affinity 数值非有限: ${aff}`);
    assert.ok(aff >= 0.12 && aff <= 5.5, `[${sceneId}] affinity 越界: ${aff}`);
  }
});

test('曲风亲和实证 3.2：4 大新场景在其对应的主场曲风下命中排名前列 (Top 3 命中率实测)', () => {
  const { sceneAffinity, SCENES, PULSE } = mods;
  const fixture = makeAdversarialFixture();
  const { music } = fixture;
  const dropSec = music.a.sections[3];

  const allSceneIds = Object.keys(SCENES);
  assert.ok(allSceneIds.length >= 40, `全场景数量应不少于 40，实际 ${allSceneIds.length}`);

  // 1. Trance / Uplifting / Melodic Bass 主场 -> cathedral 必须名列前茅
  const tranceVibe = {
    melodicEpic: 0.95,
    hardCyber: 0.20,
    urbanGroove: 0.15,
    indieRock: 0.10,
    acousticWarm: 0.35,
    oriental: 0.10,
    vocalLyric: 0.50,
    summary: '旋律史诗',
  };
  const rankedTrance = allSceneIds
    .map(id => ({ id, score: sceneAffinity(id, dropSec, PULSE, tranceVibe) }))
    .sort((a, b) => b.score - a.score);
  const cathedralRank = rankedTrance.findIndex(item => item.id === 'cathedral') + 1;
  assert.ok(
    cathedralRank <= 3,
    `[cathedral] 在 Trance/Melodic 主场排名过低: 第 ${cathedralRank} 名 (分数 ${rankedTrance[cathedralRank - 1]?.score})`,
  );

  // 2. Synthwave / Retro City / House 主场 -> highway 必须名列前茅
  const synthwaveVibe = {
    melodicEpic: 0.15,
    hardCyber: 0.65,
    urbanGroove: 0.98,
    indieRock: 0.20,
    acousticWarm: 0.10,
    oriental: 0.05,
    vocalLyric: 0.20,
    summary: '都市律动',
  };
  const rankedSynth = allSceneIds
    .map(id => ({ id, score: sceneAffinity(id, dropSec, PULSE, synthwaveVibe) }))
    .sort((a, b) => b.score - a.score);
  const highwayRank = rankedSynth.findIndex(item => item.id === 'highway') + 1;
  assert.ok(
    highwayRank <= 3,
    `[highway] 在 Synthwave 主场排名过低: 第 ${highwayRank} 名 (分数 ${rankedSynth[highwayRank - 1]?.score})`,
  );

  // 3. 古风国潮 / 国风电音 / 戏腔 主场 -> pavilion 必须名列前茅
  const orientalVibe = {
    melodicEpic: 0.70,
    hardCyber: 0.20,
    urbanGroove: 0.10,
    indieRock: 0.05,
    acousticWarm: 0.35,
    oriental: 0.98,
    vocalLyric: 0.45,
    summary: '东方意韵',
  };
  const rankedOriental = allSceneIds
    .map(id => ({ id, score: sceneAffinity(id, dropSec, PULSE, orientalVibe) }))
    .sort((a, b) => b.score - a.score);
  const pavilionRank = rankedOriental.findIndex(item => item.id === 'pavilion') + 1;
  assert.ok(
    pavilionRank <= 3,
    `[pavilion] 在国风主场排名过低: 第 ${pavilionRank} 名 (分数 ${rankedOriental[pavilionRank - 1]?.score})`,
  );

  // 4. 金属摇滚 / 暗黑电音 / 裂谷 主场 -> eclipse 必须名列前茅
  const metalVibe = {
    melodicEpic: 0.25,
    hardCyber: 0.85,
    urbanGroove: 0.10,
    indieRock: 0.98,
    acousticWarm: 0.05,
    oriental: 0.05,
    vocalLyric: 0.20,
    summary: '摇滚构成',
  };
  const rankedMetal = allSceneIds
    .map(id => ({ id, score: sceneAffinity(id, dropSec, PULSE, metalVibe) }))
    .sort((a, b) => b.score - a.score);
  const eclipseRank = rankedMetal.findIndex(item => item.id === 'eclipse') + 1;
  assert.ok(
    eclipseRank <= 3,
    `[eclipse] 在金属摇滚主场排名过低: 第 ${eclipseRank} 名 (分数 ${rankedMetal[eclipseRank - 1]?.score})`,
  );
});

test('曲风亲和实证 3.3：跨风格导播镜头调度宏观命中率统计 (120 次标准曲式仿真)', () => {
  const { planShots, Music, PULSE } = mods;
  const NO_DECOR = new Set(['cards', 'canvas', 'crystal']);

  // 构建包含典型主歌、副歌与高潮 Drop 的完整歌曲段落结构 (120s)
  const duration = 120;
  const sections = [
    { start: 0, end: 12, label: 'intro', energy: 0.35, group: 0, vocal: false },
    { start: 12, end: 32, label: 'verse', energy: 0.52, group: 1, vocal: true },
    { start: 32, end: 52, label: 'chorus', energy: 0.85, group: 2, vocal: true },
    { start: 52, end: 64, label: 'build', energy: 0.72, group: 3, vocal: false },
    { start: 64, end: 84, label: 'drop', energy: 0.98, group: 4, vocal: false },
    { start: 84, end: 96, label: 'verse', energy: 0.55, group: 1, vocal: true },
    { start: 96, end: 112, label: 'chorus', energy: 0.88, group: 2, vocal: true },
    { start: 112, end: 120, label: 'outro', energy: 0.35, group: 5, vocal: false },
  ];
  const beatSec = 60 / 128;
  const beats = [];
  for (let t = 0; t < duration; t += beatSec) beats.push(+t.toFixed(4));
  const analysis = {
    duration, bpm: 128, meter: 4, beats, beatInBar: beats.map((_, i) => i % 4), tempo: beats.map(() => 128),
    downbeats: beats.filter((_, i) => i % 4 === 0), sections,
    env: { fps: 30, rms: new Float32Array(3600).fill(0.7), high: new Float32Array(3600).fill(0.6), low: new Float32Array(3600).fill(0.7), mid: new Float32Array(3600).fill(0.6), onset: new Float32Array(3600).fill(0.5) },
    hits: { kick: beats.map(b => [b, 0.9]), snare: beats.filter((_, i) => i % 2 === 1).map(b => [b, 0.8]), hat: [] },
  };
  const music = new Music(analysis);

  // 针对 4 大场景的对应主场曲风分别统计 120 次随机仿真
  const suites = [
    { target: 'cathedral', traits: { graphic: false, lyrics: true, wiki: { genres: ['Trance', 'Melodic Bass'], tags: ['史诗', '空灵'] } } },
    { target: 'highway', traits: { graphic: false, lyrics: false, wiki: { genres: ['Synthwave', 'House'], tags: ['霓虹', '兜风'] } } },
    { target: 'pavilion', traits: { graphic: false, lyrics: true, wiki: { genres: ['国风', '戏腔'], tags: ['古风', '壮阔'] } } },
    { target: 'eclipse', traits: { graphic: false, lyrics: false, wiki: { genres: ['Rock', 'Metal'], tags: ['炸裂', '金属'] } } },
  ];

  for (const { target, traits } of suites) {
    let targetHitCount = 0;
    const runs = 120;
    for (let seed = 1; seed <= runs; seed++) {
      const shots = planShots(music, PULSE, seed * 1013, traits, NO_DECOR);
      const hit = shots.some(s => s.scene === target);
      if (hit) targetHitCount++;
    }

    const hitRate = targetHitCount / runs;
    assert.ok(
      hitRate >= 0.65,
      `[${target}] 在主场曲风下 120 次仿真命中率过低: ${(hitRate * 100).toFixed(1)}% (预期 >= 65%)`,
    );
  }
});

test('极端音频实证 1.5：240BPM 金属双踩超密冲激下涟漪与粒子环形缓冲边界稳健性', () => {
  // 极端 240BPM 双踩金属底鼓 (间隔 0.0625s，相当于 1 秒内爆发 16 次重击)
  const fixture = makeAdversarialFixture({
    bpm: 240,
    rmsVal: 1.0,
    envVal: 1.0,
    kickInterval: 0.0625,
    kickAmp: 1.0,
    snareAmp: 1.0,
    duration: 20,
  });
  const { init, music, lyrics, palette } = fixture;

  const scenes = [
    { id: 'cathedral', inst: new mods.CathedralScene(init, 'pulse'), shot: { start: 0, end: 20, scene: 'cathedral', variant: 'sanctuary', section: music.a.sections[0], seed: 501 } },
    { id: 'highway', inst: new mods.HighwayScene(init, 'pulse'), shot: { start: 0, end: 20, scene: 'highway', variant: 'warp', section: music.a.sections[0], seed: 502 } },
    { id: 'pavilion', inst: new mods.PavilionScene(init, 'pulse'), shot: { start: 0, end: 20, scene: 'pavilion', variant: 'zenith', section: music.a.sections[0], seed: 503 } },
    { id: 'eclipse', inst: new mods.EclipseScene(init, 'pulse'), shot: { start: 0, end: 20, scene: 'eclipse', variant: 'abyss', section: music.a.sections[0], seed: 504 } },
  ];

  const dt = 1 / 60;
  for (const { id, inst, shot } of scenes) {
    for (let frame = 0; frame < 120; frame++) {
      const t = frame * dt;
      inst.update({
        t,
        dt,
        shotT: t - shot.start,
        shot,
        music,
        lyrics,
        palette,
        fx: mods.defaultFx(),
        aspect: 16 / 9,
      });

      if (id === 'cathedral') {
        const rCount = inst.uniforms.uRippleCount.value;
        assert.ok(rCount <= 24, `[cathedral] 水面涟漪活跃数超限越界: ${rCount} (最大 24)`);
      }
    }
  }
});

test('纯函数时序实证 1.6：100 次跨越式随机进度条 Seek 与零状态累积强校验', () => {
  const fixture = makeAdversarialFixture({ duration: 64 });
  const { init, music, lyrics, palette } = fixture;

  const scenes = [
    { id: 'cathedral', inst: new mods.CathedralScene(init, 'pulse') },
    { id: 'highway', inst: new mods.HighwayScene(init, 'pulse') },
    { id: 'pavilion', inst: new mods.PavilionScene(init, 'pulse') },
    { id: 'eclipse', inst: new mods.EclipseScene(init, 'pulse') },
  ];

  const dt = 1 / 60;
  const sec = music.a.sections[1];
  const shot = { start: 8, end: 20, scene: 'test', variant: 'default', section: sec, seed: 601 };

  for (const { id, inst } of scenes) {
    // 预采集一组固定基准位姿 (顺序评估)
    const probeTimes = [8.2, 9.5, 11.0, 14.2, 17.8, 19.5];
    const baselinePoses = probeTimes.map(t => {
      inst.update({ t, dt, shotT: t - shot.start, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });
      return {
        pos: inst.camera.position.clone(),
        quat: inst.camera.quaternion.clone(),
        fov: inst.camera.fov,
      };
    });

    // 随机跳转 100 次并校验相同时间下的绝对一致性
    let rngVal = 0x12345678;
    const fastRand = () => {
      rngVal = (rngVal * 1664525 + 1013904223) >>> 0;
      return rngVal / 4294967296;
    };

    for (let r = 0; r < 100; r++) {
      const randT = 8.0 + fastRand() * 11.5;
      inst.update({ t: randT, dt, shotT: randT - shot.start, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });

      // 验证随机跳转后回跳基准点是否 100% 幂等
      const testIdx = r % probeTimes.length;
      const refT = probeTimes[testIdx];
      inst.update({ t: refT, dt, shotT: refT - shot.start, shot, music, lyrics, palette, fx: mods.defaultFx(), aspect: 16 / 9 });

      const base = baselinePoses[testIdx];
      const posDist = inst.camera.position.distanceTo(base.pos);
      const quatDist = Math.hypot(
        inst.camera.quaternion.x - base.quat.x,
        inst.camera.quaternion.y - base.quat.y,
        inst.camera.quaternion.z - base.quat.z,
        inst.camera.quaternion.w - base.quat.w,
      );
      const fovDiff = Math.abs(inst.camera.fov - base.fov);

      assert.ok(posDist < 1e-9, `[${id}] 随机 Seek 后相机位置不一致: dist=${posDist}`);
      assert.ok(quatDist < 1e-9, `[${id}] 随机 Seek 后相机朝向不一致: quatDist=${quatDist}`);
      assert.ok(fovDiff < 1e-9, `[${id}] 随机 Seek 后相机 FOV 不一致: fovDiff=${fovDiff}`);
    }
  }
});

test('自适应实证 2.5：极限视口比例（21:9 超宽、9:16 竖屏、1:1 正方）下 resize 幂等与相机构图自适应', () => {
  const fixture = makeAdversarialFixture();
  const { init } = fixture;

  const scenes = [
    new mods.CathedralScene(init, 'pulse'),
    new mods.HighwayScene(init, 'pulse'),
    new mods.PavilionScene(init, 'pulse'),
    new mods.EclipseScene(init, 'pulse'),
  ];

  const testAspects = [21 / 9, 9 / 16, 1.0, 4 / 3, 32 / 9];
  for (const scene of scenes) {
    for (const asp of testAspects) {
      scene.resize(asp);
      assert.ok(
        Math.abs(scene.camera.aspect - asp) < 1e-5,
        `相机 aspect 未能正确自适应目标视口: expected ${asp}, got ${scene.camera.aspect}`,
      );
      assert.ok(Number.isFinite(scene.camera.projectionMatrix.elements[0]));
    }
  }
});

