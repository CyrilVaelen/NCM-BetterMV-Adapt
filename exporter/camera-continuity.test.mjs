// 同场景连续切镜（含单开「暗涌水廊」与全场景池）的相机连续性与纯函数进度条跳转（seek）回归测试。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import * as THREE from 'three';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 为无头 Node 环境提供最小 Canvas 2D 桩，使 3D 歌词纹理与印章生成在单元测试中可完整运行
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
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
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
          getContext(kind) {
            return kind === '2d' ? makeCtx2d(c) : null;
          },
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
    reliefMod,
    shatterMod,
    dioramaMod,
    bokehMod,
    tunnelMod,
    driveMod,
    kaleidoMod,
    flipMod,
    ringsMod,
    posterMod,
    ridgesMod,
    halftoneMod,
    particlesMod,
    typewallMod,
    inkMod,
    armSceneMod,
    cardsMod,
    debugMod,
    subdivideMod,
    alignMod,
    scopeMod,
    vinylMod,
    cloudsMod,
    cityMod,
    auroraMod,
    canvasMod,
    pillarsMod,
    rippleMod,
    channelMod,
    orbMod,
    mengerMod,
    sierpinskiMod,
    cantorMod,
    papercutMod,
    rainMod,
    lanternsMod,
    neonMod,
    underwaterMod,
    sunsetMod,
    phoenixMod,
    velvetMod,
    fountainMod,
    starryMod,
    laserMod,
    blackholeMod,
  ] = await Promise.all([
    load('/src/director/music.ts'),
    load('/src/director/lyrics.ts'),
    load('/src/director/director.ts'),
    load('/src/style/style.ts'),
    load('/src/render/engine.ts'),
    load('/src/sigil/armillary.ts'),
    load('/src/scenes/catalog.ts'),
    load('/src/scenes/cameraBlend.ts'),
    load('/src/scenes/relief.ts'),
    load('/src/scenes/shatter.ts'),
    load('/src/scenes/diorama.ts'),
    load('/src/scenes/bokeh.ts'),
    load('/src/scenes/tunnel.ts'),
    load('/src/scenes/drive.ts'),
    load('/src/scenes/kaleido.ts'),
    load('/src/scenes/flip.ts'),
    load('/src/scenes/rings.ts'),
    load('/src/scenes/poster.ts'),
    load('/src/scenes/ridges.ts'),
    load('/src/scenes/halftone.ts'),
    load('/src/scenes/particles.ts'),
    load('/src/scenes/typewall.ts'),
    load('/src/scenes/ink.ts'),
    load('/src/scenes/armillary.ts'),
    load('/src/scenes/cards.ts'),
    load('/src/scenes/debug.ts'),
    load('/src/scenes/subdivide.ts'),
    load('/src/scenes/align.ts'),
    load('/src/scenes/scope.ts'),
    load('/src/scenes/vinyl.ts'),
    load('/src/scenes/clouds.ts'),
    load('/src/scenes/city.ts'),
    load('/src/scenes/aurora.ts'),
    load('/src/scenes/canvas.ts'),
    load('/src/scenes/pillars.ts'),
    load('/src/scenes/ripple.ts'),
    load('/src/scenes/channel.ts'),
    load('/src/scenes/orb.ts'),
    load('/src/scenes/menger.ts'),
    load('/src/scenes/sierpinski.ts'),
    load('/src/scenes/cantor.ts'),
    load('/src/scenes/papercut.ts'),
    load('/src/scenes/rain.ts'),
    load('/src/scenes/lanterns.ts'),
    load('/src/scenes/neon.ts'),
    load('/src/scenes/underwater.ts'),
    load('/src/scenes/sunset.ts'),
    load('/src/scenes/phoenix.ts'),
    load('/src/scenes/velvet.ts'),
    load('/src/scenes/fountain.ts'),
    load('/src/scenes/starry.ts'),
    load('/src/scenes/laser.ts'),
    load('/src/scenes/blackhole.ts'),
  ]);
  mods = {
    Music: musicMod.Music,
    LyricTrack: lyricsMod.LyricTrack,
    Director: directorMod.Director,
    linkSameSceneShots: directorMod.linkSameSceneShots,
    toTimedShot: directorMod.toTimedShot,
    planShots: directorMod.planShots,
    STYLES: styleMod.STYLES,
    defaultFx: engineMod.defaultFx,
    armillarySpec: armillaryMod.armillarySpec,
    SCENES: catalogMod.SCENES,
    blendCameraPose: blendMod.blendCameraPose,
    poseLookAt: blendMod.poseLookAt,
    sameSceneBlend: blendMod.sameSceneBlend,
    Relief: reliefMod.Relief,
    Shatter: shatterMod.Shatter,
    Diorama: dioramaMod.Diorama,
    Bokeh: bokehMod.Bokeh,
    Tunnel: tunnelMod.Tunnel,
    Drive: driveMod.Drive,
    Kaleido: kaleidoMod.Kaleido,
    Flip: flipMod.Flip,
    Rings: ringsMod.Rings,
    Poster: posterMod.Poster,
    Ridges: ridgesMod.Ridges,
    Halftone: halftoneMod.Halftone,
    Particles: particlesMod.Particles,
    TypeWall: typewallMod.TypeWall,
    Ink: inkMod.Ink,
    ArmillaryScene: armSceneMod.ArmillaryScene,
    CardsScene: cardsMod.CardsScene,
    DebugScene: debugMod.DebugScene,
    SubdivideScene: subdivideMod.SubdivideScene,
    AlignScene: alignMod.AlignScene,
    ScopeScene: scopeMod.ScopeScene,
    Vinyl: vinylMod.Vinyl,
    Clouds: cloudsMod.Clouds,
    City: cityMod.City,
    Aurora: auroraMod.Aurora,
    CanvasScene: canvasMod.CanvasScene,
    Pillars: pillarsMod.Pillars,
    Ripple: rippleMod.Ripple,
    Channel: channelMod.Channel,
    Orb: orbMod.Orb,
    Menger: mengerMod.Menger,
    Sierpinski: sierpinskiMod.Sierpinski,
    Cantor: cantorMod.Cantor,
    PaperCut: papercutMod.PaperCut,
    RainScene: rainMod.RainScene,
    LanternScene: lanternsMod.LanternScene,
    NeonScene: neonMod.NeonScene,
    UnderwaterScene: underwaterMod.UnderwaterScene,
    SunsetScene: sunsetMod.SunsetScene,
    PhoenixScene: phoenixMod.PhoenixScene,
    VelvetScene: velvetMod.VelvetScene,
    FountainScene: fountainMod.FountainScene,
    StarryScene: starryMod.StarryScene,
    LaserScene: laserMod.LaserScene,
    BlackHoleScene: blackholeMod.BlackHoleScene,
  };
});

after(async () => {
  if (vite) await vite.close();
});

/** 构造具有代表性段落起伏（含非整数小节余拍与加速段）的测试歌曲分析数据。 */
function buildMockFixture() {
  const { Music, LyricTrack, armillarySpec } = mods;
  const duration = 98;
  const bpm = 120;
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
  // 故意构造含“4.5 小节”（如 verse 8..17s，末尾剩半小节余拍）与“build 升入 drop”的段落，复现切点边界场景
  const sections = [
    { start: 0, end: 8, label: 'intro', energy: 0.28, group: 0, vocal: false },
    { start: 8, end: 17, label: 'verse', energy: 0.46, group: 1, vocal: true },
    { start: 17, end: 33, label: 'build', energy: 0.62, group: 2, vocal: true },
    { start: 33, end: 57, label: 'drop', energy: 0.92, group: 3, vocal: false },
    { start: 57, end: 74, label: 'chorus', energy: 0.78, group: 4, vocal: true },
    { start: 74, end: 88, label: 'bridge', energy: 0.42, group: 5, vocal: true },
    { start: 88, end: duration, label: 'outro', energy: 0.25, group: 6, vocal: false },
  ];
  const envFps = 30;
  const envLen = Math.ceil(duration * envFps);
  const makeCurve = (base, amp, freq) => {
    const arr = new Float32Array(envLen);
    for (let i = 0; i < envLen; i++) {
      const t = i / envFps;
      const sec = sections.find((s) => t >= s.start && t < s.end) ?? sections[sections.length - 1];
      arr[i] = Math.max(0.02, Math.min(1, base * sec.energy + amp * (0.5 + 0.5 * Math.sin(t * freq))));
    }
    return arr;
  };
  const kicks = [];
  const snares = [];
  const hats = [];
  const accents = [];
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    kicks.push([b, 0.85]);
    if (i % 2 === 1) snares.push([b, 0.75]);
    if (i % meter === 0) accents.push([b, 0.9]);
    hats.push([b + beatLen * 0.5, 0.55]);
  }
  const analysis = {
    version: 1,
    duration,
    bpm,
    namedBpm: bpm,
    meter,
    beats,
    beatInBar,
    tempo,
    downbeats,
    sections,
    hits: { kick: kicks, snare: snares, hat: hats, accent: accents },
    env: {
      fps: envFps,
      rms: makeCurve(0.85, 0.15, 2.3),
      low: makeCurve(0.8, 0.2, 1.9),
      mid: makeCurve(0.7, 0.2, 3.1),
      high: makeCurve(0.55, 0.2, 4.7),
      onset: makeCurve(0.4, 0.25, 6.2),
    },
  };
  const music = new Music(analysis);

  const lines = [];
  for (let s = 4; s < duration - 6; s += 5.5) {
    const w0 = { text: '暗涌', start: s, end: s + 1.2 };
    const w1 = { text: '流光', start: s + 1.25, end: s + 2.6 };
    const w2 = { text: '夜色', start: s + 2.65, end: s + 4.1 };
    lines.push({
      start: s,
      end: s + 4.2,
      text: '暗涌流光夜色',
      timedWords: true,
      translation: 'Velvet current in the night',
      words: [w0, w1, w2],
    });
  }
  const lyrics = new LyricTrack(lines);

  const coverSize = 32;
  const coverPixels = new Uint8ClampedArray(coverSize * coverSize * 4);
  for (let y = 0; y < coverSize; y++) {
    for (let x = 0; x < coverSize; x++) {
      const o = (y * coverSize + x) * 4;
      const cx = x / coverSize - 0.5;
      const cy = y / coverSize - 0.5;
      const r = Math.hypot(cx, cy);
      coverPixels[o] = r < 0.28 ? 225 : 24;
      coverPixels[o + 1] = r < 0.28 ? 145 : 32;
      coverPixels[o + 2] = r < 0.28 ? 72 : 58;
      coverPixels[o + 3] = 255;
    }
  }
  const cover = new THREE.DataTexture(coverPixels, coverSize, coverSize, THREE.RGBAFormat);
  cover.needsUpdate = true;

  const palette = {
    ink: new THREE.Color(0.03, 0.04, 0.06),
    paper: new THREE.Color(0.94, 0.92, 0.88),
    signal: new THREE.Color(0.92, 0.52, 0.22),
    accent: new THREE.Color(0.24, 0.62, 0.88),
    light: false,
    backdrop: new THREE.Color(0.03, 0.04, 0.06),
    graphic: true,
    complexity: 0.12,
    mono: false,
    css: { ink: '#080a0f', paper: '#f0ebe0', signal: '#eb8538', accent: '#3d9ee0' },
  };

  const sampleRate = 8000;
  const totalSamples = sampleRate * 12;
  const left = new Int16Array(totalSamples);
  const right = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    left[i] = Math.round(Math.sin(i * 0.09) * 14000);
    right[i] = Math.round(Math.cos(i * 0.09) * 14000);
  }
  const stereo = { left, right, rate: sampleRate };

  const init = {
    cover,
    coverPixels,
    coverSize,
    palette,
    music,
    lyrics,
    aspect: 16 / 9,
    title: '暗涌水廊测试曲',
    artists: ['BetterMV'],
    stereo,
    xyMusic: false,
    armillary: armillarySpec(analysis, 1001),
    seed: 0x9e3779b9,
  };

  return { analysis, music, lyrics, palette, cover, init };
}

/** 计算两个单位四元数之间的最小旋转夹角（弧度，0..π）。 */
function quatAngle(a, b) {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot);
}

/** 计算两个四元数（忽略 ±q 符号）的分量欧氏差。 */
function quatComponentDiff(a, b) {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  return Math.hypot(a.x - sign * b.x, a.y - sign * b.y, a.z - sign * b.z, a.w - sign * b.w);
}

test('cameraBlend 基础算子：poseLookAt 与最短球面弧插值在切点严格连续', () => {
  const { poseLookAt, blendCameraPose, sameSceneBlend, linkSameSceneShots } = mods;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const refCam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500);
  refCam.up.set(0, 0, 1);
  refCam.position.set(4.2, -7.5, 3.1);
  refCam.lookAt(0.5, 0.1, 0);
  poseLookAt(pos, quat, 4.2, -7.5, 3.1, 0.5, 0.1, 0, 0, 0, 1);
  assert.ok(pos.distanceTo(refCam.position) < 1e-9);
  assert.ok(quatComponentDiff(quat, refCam.quaternion) < 1e-9);

  // 构造两个反号四元数机位，验证跨越 cutStart 前后 0.1ms 无翻滚跳变
  const sec = { start: 0, end: 16, label: 'chorus', energy: 0.8, group: 0, vocal: true };
  const s1 = { index: 0, start: 0, end: 8, scene: 'velvet', variant: 'platter', section: sec, sectionIndex: 0, seed: 11, short: false };
  const s2 = { index: 1, start: 8, end: 16, scene: 'velvet', variant: 'sanctuary', section: sec, sectionIndex: 0, seed: 22, short: false };
  linkSameSceneShots([s1, s2]);

  const evalTest = (t, s, outPos, outQuat) => {
    if (s.variant === 'platter') {
      poseLookAt(outPos, outQuat, 0.5, 3.8, -t * 2.3 + 2.4, 0, 0.5, -t * 2.3 - 3.5);
      return 48;
    }
    poseLookAt(outPos, outQuat, -1.6, 0.72, -t * 2.3 + 4.8, 0.2, 2.6, -t * 2.3 - 10.5);
    outQuat.set(-outQuat.x, -outQuat.y, -outQuat.z, -outQuat.w); // 故意反号测试双覆盖最短弧保护
    return 54;
  };

  const cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 500);
  blendCameraPose(evalTest, 8 - 1e-4, s1, cam, 1.5);
  const beforePos = cam.position.clone();
  const beforeQuat = cam.quaternion.clone();
  const beforeFov = cam.fov;

  blendCameraPose(evalTest, 8 + 1e-4, s2, cam, 1.5);
  assert.ok(cam.position.distanceTo(beforePos) < 0.005, '切点前后位置必须平滑衔接');
  assert.ok(quatAngle(cam.quaternion, beforeQuat) < 0.002, '切点前后朝向四元数必须走最短弧平滑衔接');
  assert.ok(Math.abs(cam.fov - beforeFov) < 0.01, '切点前后 FOV 必须平滑衔接');
  assert.equal(sameSceneBlend(9.8, s2, 1.5), null, '超出平滑窗口后应完全收敛至目标机位');
});

test('Director 镜头调度：消除段尾硬切碎镜、正确挂接同场景 prevSame 链并移除同场景甩镜干扰', () => {
  const { Director, planShots, toTimedShot, STYLES, SCENES, VelvetScene } = mods;
  const { music, lyrics, palette, cover, init } = buildMockFixture();
  const allSceneIds = SCENES.map((s) => s.id);

  // 1. 遍历全部 5 种母风格验证常规混排调度
  for (const style of Object.values(STYLES)) {
    const shots = planShots(music, style, 0x12345678, { graphic: true, lyrics: true });
    assert.ok(shots.length >= 6);
    for (let i = 0; i < shots.length; i++) {
      const sh = shots[i];
      if (!sh.run) {
        assert.ok(sh.end - sh.start >= 0.84, `风格 ${style.id} 存在非加速串的亚秒级残片镜头: ${sh.scene} len=${sh.end - sh.start}`);
      }
      if (i > 0 && shots[i - 1].scene === sh.scene) {
        assert.ok(sh.prevSame, `同场景连续镜头必须挂接 prevSame (${sh.scene})`);
        const expectedPrev = toTimedShot(shots[i - 1]);
        assert.equal(sh.prevSame.scene, expectedPrev.scene);
        assert.equal(sh.prevSame.variant, expectedPrev.variant);
        assert.equal(sh.prevSame.start, expectedPrev.start);
        assert.equal(sh.prevSame.end, expectedPrev.end);
      } else {
        assert.equal(sh.prevSame, undefined, `跨场景镜头不应挂接 prevSame`);
      }
    }
  }

  // 2. 验证用户单开「暗涌水廊」(velvet) 时的全曲同场景连续调度
  const offAllExceptVelvet = new Set(allSceneIds.filter((id) => id !== 'velvet'));
  const velvetShots = planShots(music, STYLES.velvet, 0xabcdef01, { graphic: false, lyrics: true }, offAllExceptVelvet);
  const velvetScene = new VelvetScene(init, 'velvet');
  const director = new Director(
    STYLES.velvet,
    velvetShots,
    { velvet: velvetScene },
    music,
    lyrics,
    palette,
    init.armillary,
    cover,
    false,
    [],
  );

  // 检查 build 段末尾（17..33s）暗涌水廊不会产生每拍碎切，且所有相邻 velvet 镜头无 whip 甩镜或故障跳变
  let velvetPairs = 0;
  for (let i = 1; i < director.shots.length; i++) {
    const prev = director.shots[i - 1];
    const curr = director.shots[i];
    if (prev.scene === 'velvet' && curr.scene === 'velvet') {
      velvetPairs++;
      assert.ok(curr.prevSame, '相邻暗涌水廊镜头必须挂接 prevSame');
      assert.equal(curr.run, undefined, '暗涌水廊在加速段应合并保持连续运镜，不产生每拍碎切');
      assert.ok(curr.end - curr.start >= 0.84, '暗涌水廊镜头时长不应存在亚秒碎切');
      const f = director.frame((curr.cutStart ?? curr.start) + 0.01, 1 / 60, 16 / 9);
      assert.equal(f.fx.smearX, 0, '同场景平滑切点不应叠加横向 whip 甩镜');
      assert.equal(f.fx.smearY, 0, '同场景平滑切点不应叠加纵向 whip 甩镜');
      assert.equal(f.fx.glitch, 0, '同场景平滑切点不应叠加 glitch 故障跳变');
    }
  }
  assert.ok(velvetPairs >= 3, '单开暗涌水廊时应形成多段同场景连续切镜链');

  // 3. 验证城市天际（City）跨城区远距同场景切镜由导演层施加柔和暗场呼吸衔接，避免飞穿摩天楼硬闪
  const citySec = music.a.sections[1];
  const cityShots = [
    { scene: 'city', start: 8, end: 12, section: citySec, sectionIndex: 1, variant: 'high', seed: 101 },
    { scene: 'city', start: 12, end: 17, section: citySec, sectionIndex: 1, variant: 'horizon', seed: 202 },
  ];
  const cityDirector = new Director(
    STYLES.pulse,
    cityShots,
    { city: new mods.City(init, 'pulse') },
    music,
    lyrics,
    palette,
    init.armillary,
    cover,
    false,
    [],
  );
  const cityCutFrame = cityDirector.frame(12.01, 1 / 60, 16 / 9);
  assert.ok(cityCutFrame.fx.fade > 0.85, 'City 跨城区远距同场景切镜切点应有柔和暗场呼吸遮蔽');
});

test('全场景（36 场景）同场景连续切镜 60fps 相机连续性与随机进度条 Seek 纯函数一致性', () => {
  const m = mods;
  const { music, lyrics, palette, init } = buildMockFixture();
  const sceneSpecs = [
    ['velvet', () => new m.VelvetScene(init, 'velvet'), ['lounge', 'skim', 'platter', 'gallery', 'skim', 'lounge']],
    ['sunset', () => new m.SunsetScene(init, 'pulse'), ['horizon', 'beam', 'drift', 'halo', 'horizon']],
    ['phoenix', () => new m.PhoenixScene(init, 'pulse'), ['stage', 'soar', 'sonic', 'altar', 'stage']],
    ['underwater', () => new m.UnderwaterScene(init, 'pulse'), ['canyon', 'dive', 'orbit', 'abyss', 'canyon']],
    ['blackhole', () => new m.BlackHoleScene(init, 'pulse'), ['observatory', 'glide', 'horizon', 'astrolabe', 'observatory']],
    ['aurora', () => new m.Aurora(init, 'pulse'), ['wide', 'lake', 'up', 'wide']],
    ['fountain', () => new m.FountainScene(init, 'pulse'), ['courtyard', 'orbit', 'skim', 'crown', 'courtyard']],
    ['starry', () => new m.StarryScene(init, 'pulse'), ['mirror', 'glide', 'zenith', 'astrolabe', 'mirror']],
    ['laser', () => new m.LaserScene(init, 'pulse'), ['arena', 'rig', 'booth', 'tunnel', 'arena']],
    ['clouds', () => new m.Clouds(init, 'pulse'), ['over', 'rise', 'skim', 'over']],
    ['clouds-ink', () => new m.Clouds(init, 'ink'), ['over', 'rise', 'skim', 'over']],
    ['pillars', () => new m.Pillars(init, 'pulse', init.seed), ['orbit', 'top', 'low', 'orbit']],
    ['lanterns', () => new m.LanternScene(init), ['shore', 'rise', 'wide', 'shore']],
    ['ridges', () => new m.Ridges(init, 'pulse'), ['front', 'low', 'drift', 'front']],
    ['ridges-ink', () => new m.Ridges(init, 'ink'), ['front', 'low', 'drift', 'front']],
    ['neon', () => new m.NeonScene(init), ['walk', 'low', 'up', 'walk']],
    ['channel', () => new m.Channel(init, 'pulse'), ['axis', 'roll', 'wall', 'axis']],
    ['menger', () => new m.Menger(init, 'pulse'), ['glide', 'look', 'glide', 'look']],
    ['sierpinski', () => new m.Sierpinski(init, 'pulse'), ['glide', 'look', 'glide', 'look']],
    ['cantor', () => new m.Cantor(init, 'pulse'), ['glide', 'look', 'glide', 'look']],
    ['canvas', () => new m.CanvasScene(init, 'pulse', init.seed), ['high', 'chase', 'side', 'front', 'high']],
    ['canvas-ink', () => new m.CanvasScene(init, 'ink', init.seed), ['high', 'chase', 'side', 'high']],
    ['drive', () => new m.Drive(init), ['push', 'roll', 'push', 'roll']],
    ['tunnel', () => new m.Tunnel(init, 'pulse'), ['rush', 'roll', 'wall', 'rush']],
    ['orb', () => new m.Orb(init, 'pulse'), ['wide', 'orbit', 'close', 'wide']],
    ['ripple', () => new m.Ripple(init, 'pulse'), ['face', 'tilt', 'low', 'face']],
    ['subdivide', () => new m.SubdivideScene(init, 'pulse'), ['ball', 'ball', 'ball']],
    ['rings', () => new m.Rings(init, 'pulse'), ['front', 'tilt', 'front', 'tilt']],
    ['diorama', () => new m.Diorama(init), ['drift', 'push', 'truck', 'tilt', 'pullback', 'drift']],
    ['vinyl', () => new m.Vinyl(init, 'pulse'), ['tilt', 'groove', 'top', 'tilt']],
    ['bokeh', () => new m.Bokeh(init), ['haze', 'focus', 'orbit', 'rise', 'haze']],
    ['particles', () => new m.Particles(init, 'pulse'), ['hold', 'burst', 'vortex', 'rain', 'hold']],
    ['relief', () => new m.Relief(init), ['fly', 'crane', 'side', 'dive', 'low', 'rise', 'fly']],
    ['shatter', () => new m.Shatter(init), ['wall', 'wall-close', 'wall-dutch', 'wall-edge', 'swarm-a', 'swarm-d', 'swarm-b', 'swarm-c', 'wall']],
    ['halftone', () => new m.Halftone(init, 'pulse'), ['in', 'pan', 'out', 'fine', 'in']],
    ['rain', () => new m.RainScene(init), ['pane', 'close', 'clear', 'pane']],
    ['papercut', () => new m.PaperCut(init), ['turn', 'bloom', 'turn', 'bloom']],
    ['scope', () => new m.ScopeScene(init), ['wave', 'xy', 'wave', 'xy']],
    ['flip', () => new m.Flip(init, 'pulse'), ['wave', 'burst', 'wave', 'burst']],
    ['align', () => new m.AlignScene(init), ['swing', 'swing', 'swing']],
    ['kaleido', () => new m.Kaleido(init, 'pulse'), ['petal', 'spiral', 'petal', 'spiral']],
    ['ink', () => new m.Ink(init, init.title), ['scroll', 'bloom', 'mist', 'scroll']],
    ['crystal', () => new m.ArmillaryScene(init), ['orbit', 'gather', 'orbit']],
    ['debug', () => new m.DebugScene(init), ['low', 'orbit', 'top', 'low']],
    ['typewall', () => new m.TypeWall(init), ['stack', 'split', 'solo', 'stack']],
    ['poster', () => new m.Poster(init, 'pulse'), ['stack', 'slab', 'split', 'stack']],
    ['cards', () => new m.CardsScene(init), ['stack', 'stack']],
    // City 近距同走廊机位验证平滑，跨城区远距切镜由导演层施加暗场呼吸保护防穿楼
    ['city-canyon', () => new m.City(init, 'pulse'), ['canyon', 'canyon', 'canyon']],
  ];

  // 精心挑选一组奇偶与高位交替翻转的种子，确保 side = random() < 0.5 ? -1 : 1 在相邻镜头间发生正负切换
  const seeds = [0x00000001, 0xfffffffe, 0x13579bdf, 0xea864202, 0x31415926, 0xcafe0001, 0x77777777, 0x88888888, 0x12348765];
  const shotDur = 5.0;
  const dt = 1 / 60;
  const sec = music.a.sections[3];

  for (const [label, createScene, variants] of sceneSpecs) {
    const sceneId = label.split('-')[0];
    const scene = createScene();
    const shots = variants.map((variant, i) => ({
      index: i,
      start: 12 + i * shotDur,
      end: 12 + (i + 1) * shotDur,
      scene: sceneId,
      variant,
      section: sec,
      sectionIndex: 3,
      seed: seeds[i % seeds.length],
      short: false,
    }));
    m.linkSameSceneShots(shots);

    // 1. 切点前后 ±2 帧（60fps）逐步推进，断言切点帧不发生视角瞬移
    for (let i = 1; i < shots.length; i++) {
      const prevShot = shots[i - 1];
      const currShot = shots[i];
      const cut = currShot.start;

      const evalAt = (time, sh) => {
        const fx = m.defaultFx();
        scene.update({
          t: time,
          dt,
          shotT: time - sh.start,
          shot: sh,
          music,
          lyrics,
          palette,
          fx,
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

      // Cards 是全曲唯一片头单镜（不参与连切），Poster 为平面网格排版（静态正交般机位），其余全部严格校验连续性
      if (label !== 'cards') {
        const posLimit = Math.max(1.2, baseStepPos * 3.5);
        assert.ok(
          cutStepPos <= posLimit && postStepPos <= posLimit,
          `[${label}] ${prevShot.variant} -> ${currShot.variant} 切点发生相机位置瞬移: cutStep=${cutStepPos.toFixed(4)} postStep=${postStepPos.toFixed(4)} (limit=${posLimit.toFixed(4)})`,
        );
        assert.ok(
          cutStepAng <= 0.14 && postStepAng <= 0.14,
          `[${label}] ${prevShot.variant} -> ${currShot.variant} 切点发生相机朝向瞬移: cutAng=${cutStepAng.toFixed(4)}rad postAng=${postStepAng.toFixed(4)}rad`,
        );
        assert.ok(
          cutStepFov <= 4.5,
          `[${label}] ${prevShot.variant} -> ${currShot.variant} 切点发生 FOV 突变: dFov=${cutStepFov.toFixed(4)}`,
        );
      }
    }

    // 2. 验证纯函数进度条任意 Seek 一致性（顺序求值 vs 逆序乱序求值误差 < 1e-9）
    const probeTimes = [
      { t: shots[0].start + 1.2, shot: shots[0] },
      { t: shots[1].start + 0.02, shot: shots[1] },
      { t: shots[1].start + 0.55, shot: shots[1] },
      { t: shots[shots.length - 1].start + 0.35, shot: shots[shots.length - 1] },
      { t: shots[shots.length - 1].start + 2.4, shot: shots[shots.length - 1] },
    ];
    const forwardPoses = probeTimes.map(({ t, shot }) => {
      scene.update({ t, dt, shotT: t - shot.start, shot, music, lyrics, palette, fx: m.defaultFx(), aspect: 16 / 9 });
      return {
        pos: scene.camera.position.clone(),
        quat: scene.camera.quaternion.clone(),
        fov: scene.camera.fov,
      };
    });
    for (let idx = probeTimes.length - 1; idx >= 0; idx--) {
      const { t, shot } = probeTimes[idx];
      scene.update({ t, dt, shotT: t - shot.start, shot, music, lyrics, palette, fx: m.defaultFx(), aspect: 16 / 9 });
      const ref = forwardPoses[idx];
      assert.ok(
        scene.camera.position.distanceTo(ref.pos) < 1e-9,
        `[${label}] 随机跳转 seek 后相机位置不一致 (t=${t})`,
      );
      assert.ok(
        quatComponentDiff(scene.camera.quaternion, ref.quat) < 1e-9,
        `[${label}] 随机跳转 seek 后相机朝向不一致 (t=${t})`,
      );
      assert.ok(
        Math.abs(scene.camera.fov - ref.fov) < 1e-9,
        `[${label}] 随机跳转 seek 后相机 FOV 不一致 (t=${t})`,
      );
    }
  }
});

test('LaserScene 激光舞台：圆锥激光发射源位于顶部桁架且 DJ 挥手动作幅度收敛自然', () => {
  const m = mods;
  const { music, lyrics, palette, init } = buildMockFixture();
  const laser = new m.LaserScene(init, 'pulse');

  // 1. 验证激光发射机位：顶部桁架而非专辑封面正中央 (y=8.6)
  assert.ok(
    laser.uniforms.uConePitch.value < -0.15,
    `uConePitch 初始值应为顶部桁架下倾角 (< -0.15)，实测为 ${laser.uniforms.uConePitch.value}`,
  );

  let coneMeshFound = false;
  laser.scene.traverse((obj) => {
    if (obj.material && obj.material.vertexShader && obj.material.vertexShader.includes('aConeSpec')) {
      coneMeshFound = true;
      assert.ok(
        !obj.material.vertexShader.includes('8.6'),
        '激光圆锥顶点着色器不应包含中心封面高度 8.6',
      );
      assert.ok(
        obj.material.vertexShader.includes('18.05'),
        '激光圆锥顶点着色器应发射自舞台顶部桁架机位 (y=18.05)',
      );
    }
  });
  assert.ok(coneMeshFound, '应找到激光圆锥网格对象');

  // 2. 验证 DJ 挥舞动作收敛与全运镜稳定性：在所有镜头变体（arena, tunnel, booth, rig）与曲目全段落连续采样，手臂绝不出现伸直成棍 (>175°) 或狂甩指挥家姿态 (shoulderZ > 1.6 rad)
  const dj = laser.djNodes;
  const variants = ['arena', 'tunnel', 'booth', 'rig'];
  for (const variant of variants) {
    for (let secIdx = 0; secIdx < music.a.sections.length; secIdx++) {
      const sec = music.a.sections[secIdx];
      const shot = {
        index: secIdx,
        start: sec.start,
        end: sec.end,
        scene: 'laser',
        variant,
        section: sec,
        sectionIndex: secIdx,
        seed: 12345 + secIdx,
        short: false,
      };

      const duration = sec.end - sec.start;
      const steps = Math.max(10, Math.floor(duration * 10));
      for (let step = 0; step < steps; step++) {
        const t = sec.start + (step / steps) * duration;
        laser.update({
          t,
          dt: 0.1,
          shotT: t - shot.start,
          shot,
          music,
          lyrics,
          palette,
          fx: m.defaultFx(),
          aspect: 16 / 9,
        });

        // 验证相机机位与朝向数值合法（无 NaN/无穷大）
        assert.ok(!Number.isNaN(laser.camera.position.x), `[${variant}] 相机 X 坐标不应为 NaN (t=${t})`);
        assert.ok(!Number.isNaN(laser.camera.position.y), `[${variant}] 相机 Y 坐标不应为 NaN (t=${t})`);
        assert.ok(!Number.isNaN(laser.camera.fov), `[${variant}] 相机 FOV 不应为 NaN (t=${t})`);

        // 检查右手（严禁绕 Z 轴向左右两侧横撇抬手，必须沿 X 轴往正前上方抬举）
        const rShZ = dj.shoulderR.rotation.z;
        const rElBend = Math.hypot(dj.elbowR.rotation.x, dj.elbowR.rotation.z);
        assert.ok(
          Math.abs(rShZ) < 0.25,
          `[${variant}:${sec.label}] DJ 右肩禁止向侧面外展挥手 (|rShZ|=${Math.abs(rShZ).toFixed(3)} >= 0.25) (t=${t.toFixed(2)})`,
        );
        assert.ok(
          rElBend > 0.6,
          `[${variant}:${sec.label}] DJ 右肘应保持自然屈肘 (rElBend=${rElBend.toFixed(3)} <= 0.6)，不应伸直成棍 (t=${t.toFixed(2)})`,
        );

        // 检查左手（严禁绕 Z 轴向左右两侧横撇抬手）
        const lShZ = dj.shoulderL.rotation.z;
        const lElBend = Math.hypot(dj.elbowL.rotation.x, dj.elbowL.rotation.z);
        assert.ok(
          Math.abs(lShZ) < 0.25,
          `[${variant}:${sec.label}] DJ 左肩禁止向侧面外展挥手 (|lShZ|=${Math.abs(lShZ).toFixed(3)} >= 0.25) (t=${t.toFixed(2)})`,
        );
        assert.ok(
          lElBend > 0.6,
          `[${variant}:${sec.label}] DJ 左肘应保持自然屈肘 (lElBend=${lElBend.toFixed(3)} <= 0.6)，不应伸直成棍 (t=${t.toFixed(2)})`,
        );
      }
    }
  }
});

test('LaserScene 激光舞台：极端音频工况（超高速 BPM 200 / 极慢 BPM 50 / 极端连续底鼓军鼓冲击 / 随机跳转）动作与发射源稳健性', () => {
  const m = mods;
  const bpmCases = [200, 50];
  for (const bpm of bpmCases) {
    const { lyrics, palette, init } = buildMockFixture();
    const duration = 60;
    const beatLen = 60 / bpm;
    const beats = [];
    const downbeats = [];
    for (let i = 0; i * beatLen <= duration; i++) {
      const t = +(i * beatLen).toFixed(4);
      beats.push(t);
      if (i % 4 === 0) downbeats.push(t);
    }
    const sections = [
      { start: 0, end: 15, label: 'build', energy: 0.7, group: 0, vocal: false },
      { start: 15, end: 45, label: 'drop', energy: 1.0, group: 1, vocal: false },
      { start: 45, end: duration, label: 'outro', energy: 0.3, group: 2, vocal: false },
    ];
    const kicks = beats.map((b) => [b, 1.0]);
    const snares = beats.filter((_, i) => i % 2 === 1).map((b) => [b, 1.0]);
    const mockMusic = new m.Music({
      duration,
      bpm,
      namedBpm: bpm,
      meter: 4,
      beats,
      beatInBar: beats.map((_, i) => i % 4),
      tempo: beats.map(() => bpm),
      downbeats,
      sections,
      hits: { kick: kicks, snare: snares },
      roles: {
        kick: kicks,
        snare: snares,
        synthStab: kicks,
        lead: kicks,
      },
      env: {
        kick: new Float32Array(Math.ceil(duration * 30)).fill(0.9),
        bass: new Float32Array(Math.ceil(duration * 30)).fill(0.95),
        snare: new Float32Array(Math.ceil(duration * 30)).fill(0.85),
        vocal: new Float32Array(Math.ceil(duration * 30)).fill(0.1),
        chroma: new Float32Array(Math.ceil(duration * 30) * 12).fill(0.5),
      },
    });

    const laser = new m.LaserScene({ ...init, music: mockMusic }, 'pulse');
    const dj = laser.djNodes;
    const variants = ['arena', 'tunnel', 'booth', 'rig'];

    for (const variant of variants) {
      const shot = {
        index: 0,
        start: 0,
        end: duration,
        scene: 'laser',
        variant,
        section: sections[1],
        sectionIndex: 1,
        seed: 9999,
        short: false,
      };

      const testTimes = [
        ...Array.from({ length: 30 }, (_, i) => 15 + i * 0.9),
        25.0, 16.0, 38.0, 18.5, 42.0,
      ];

      for (const t of testTimes) {
        laser.update({
          t,
          dt: 0.05,
          shotT: t - shot.start,
          shot,
          music: mockMusic,
          lyrics,
          palette,
          fx: m.defaultFx(),
          aspect: 16 / 9,
        });

        assert.ok(!Number.isNaN(laser.camera.position.x), `相机 X 坐标不应为 NaN`);
        assert.ok(!Number.isNaN(laser.camera.position.y), `相机 Y 坐标不应为 NaN`);
        assert.ok(!Number.isNaN(laser.camera.fov), `相机 FOV 不应为 NaN`);

        const rShZ = dj.shoulderR.rotation.z;
        const lShZ = dj.shoulderL.rotation.z;
        assert.ok(Math.abs(rShZ) < 0.25, `极端工况下 DJ 右肩禁止往侧面抬手 (|rShZ|=${Math.abs(rShZ).toFixed(3)} >= 0.25)`);
        assert.ok(Math.abs(lShZ) < 0.25, `极端工况下 DJ 左肩禁止往侧面抬手 (|lShZ|=${Math.abs(lShZ).toFixed(3)} >= 0.25)`);

        const rElBend = Math.hypot(dj.elbowR.rotation.x, dj.elbowR.rotation.z);
        const lElBend = Math.hypot(dj.elbowL.rotation.x, dj.elbowL.rotation.z);
        assert.ok(rElBend >= 0.65 && rElBend <= 1.35, `极端工况下 DJ 右肘屈曲度异常 (${rElBend.toFixed(3)})`);
        assert.ok(lElBend >= 0.65 && lElBend <= 1.35, `极端工况下 DJ 左肘屈曲度异常 (${lElBend.toFixed(3)})`);

        assert.ok(dj.shoulderR.rotation.x < -0.5, `DJ 右臂大臂应往前方抬起 (rotX=${dj.shoulderR.rotation.x.toFixed(3)})`);
        assert.ok(dj.shoulderL.rotation.x < -0.5, `DJ 左臂大臂应往前方抬起 (rotX=${dj.shoulderL.rotation.x.toFixed(3)})`);

        // 当右手完全抬起律动时，验证三维运动学坐标严格满足“往前往上抬，而非往左往右抬”
        if (laser.djArmRaiseR > 0.85) {
          dj.root.updateMatrixWorld(true);
          const invSpine = dj.spine.matrixWorld.clone().invert();
          const shLocal = new THREE.Vector3().setFromMatrixPosition(dj.shoulderR.matrixWorld).applyMatrix4(invSpine);
          const wristLocal = new THREE.Vector3().setFromMatrixPosition(dj.handR.matrixWorld).applyMatrix4(invSpine);
          const dx = wristLocal.x - shLocal.x;
          const dy = wristLocal.y - shLocal.y;
          const dz = wristLocal.z - shLocal.z;
          assert.ok(dz > 0.28, `DJ 抬手时手腕必须位于肩部正前方 (dz=${dz.toFixed(3)} <= 0.28)`);
          assert.ok(dy > 0.08, `DJ 抬手时手腕必须往肩部上方抬起 (dy=${dy.toFixed(3)} <= 0.08)`);
          assert.ok(Math.abs(dx) < 0.06, `DJ 抬手时严禁往左右两侧横撇 (|dx|=${Math.abs(dx).toFixed(3)} >= 0.06)`);
        }
      }
    }
  }
});

test('LaserScene 激光舞台：Drop 能量骤降时强度与光束动态回落 & 激光颜色严格绑定每句歌词开头切换', () => {
  const m = mods;
  const { music, lyrics, palette, init } = buildMockFixture();

  // 1. 验证 Drop 能量动态回落逻辑（如《Nothing Ever After》3:25 处能量暴跌场景）
  const duration = 60;
  const bpm = 120;
  const beatLen = 60 / bpm; // 0.5s
  const beats = [];
  const downbeats = [];
  for (let i = 0; i * beatLen <= duration; i++) {
    const t = +(i * beatLen).toFixed(4);
    beats.push(t);
    if (i % 4 === 0) downbeats.push(t);
  }
  const sections = [
    { start: 0, end: 10, label: 'verse', energy: 0.5, group: 0, vocal: true },
    { start: 10, end: 40, label: 'drop', energy: 0.95, group: 1, vocal: false },
    { start: 40, end: duration, label: 'outro', energy: 0.3, group: 2, vocal: false },
  ];
  const envFps = 30;
  const envLen = Math.ceil(duration * envFps);
  const lowArr = new Float32Array(envLen).fill(0.85); // 默认高能
  const rmsArr = new Float32Array(envLen).fill(0.90);
  // 在 25s ~ 32s 模拟 Drop 段内能量骤降（low 暴跌至 0.08，rms 降至 0.42）
  for (let i = Math.round(25 * envFps); i < Math.round(32 * envFps); i++) {
    lowArr[i] = 0.08;
    rmsArr[i] = 0.42;
  }
  const kicks = beats.map((b) => [b, (b >= 25 && b < 32) ? 0 : 0.9]); // 能量骤降时底鼓停歇
  const snares = beats.filter((_, i) => i % 2 === 1).map((b) => [b, (b >= 25 && b < 32) ? 0 : 0.8]);

  const dropTestMusic = new m.Music({
    version: 1,
    duration,
    bpm,
    namedBpm: bpm,
    meter: 4,
    beats,
    beatInBar: beats.map((_, i) => i % 4),
    tempo: beats.map(() => bpm),
    downbeats,
    sections,
    hits: { kick: kicks, snare: snares },
    roles: { kick: kicks, snare: snares, synthStab: kicks, lead: kicks },
    env: {
      fps: envFps,
      rms: rmsArr,
      low: lowArr,
      mid: new Float32Array(envLen).fill(0.5),
      high: new Float32Array(envLen).fill(0.4),
      onset: new Float32Array(envLen).fill(0.3),
    },
  });

  // 构造明确起止的两句歌词：第一句 [12.0s, 17.0s]，第二句 [19.0s, 24.0s]
  const lyricLines = [
    { start: 12.0, end: 17.0, text: '第一句开唱到结尾', timedWords: true, words: [{ text: '开唱', start: 12.0, end: 13.5 }, { text: '结尾', start: 15.0, end: 17.0 }] },
    { start: 19.0, end: 24.0, text: '第二句换色再开唱', timedWords: true, words: [{ text: '换色', start: 19.0, end: 20.5 }, { text: '再唱', start: 22.0, end: 24.0 }] },
  ];
  const lyricTrack = new m.LyricTrack(lyricLines);

  const laser = new m.LaserScene({ ...init, music: dropTestMusic, lyrics: lyricTrack }, 'pulse');
  const dropShot = {
    index: 1,
    start: 10,
    end: 40,
    scene: 'laser',
    variant: 'arena',
    section: sections[1],
    sectionIndex: 1,
    seed: 1234,
    short: false,
  };

  const updateAt = (t) => {
    laser.update({
      t,
      dt: 0.05,
      shotT: t - dropShot.start,
      shot: dropShot,
      music: dropTestMusic,
      lyrics: lyricTrack,
      palette,
      fx: m.defaultFx(),
      aspect: 16 / 9,
    });
  };

  // (1) 测试 Drop 高能爆发期 (t = 15.0s)
  updateAt(15.0);
  const powerClimax = laser.uniforms.uDropPower.value;
  assert.ok(powerClimax >= 0.85, `Drop 高潮期 dropPower 应处于高位 (>=0.85)，实测为 ${powerClimax.toFixed(3)}`);

  // (2) 测试 Drop 能量骤降期 (t = 28.0s，模拟 3:25 处低频塌缩与底鼓停顿)
  updateAt(28.0);
  const powerDrop = laser.uniforms.uDropPower.value;
  assert.ok(
    powerDrop >= 0.35 && powerDrop <= 0.48,
    `Drop 能量骤降时 dropPower 应动态回落至 0.35~0.48 范围，实测为 ${powerDrop.toFixed(3)}`,
  );
  assert.ok(
    powerDrop < powerClimax * 0.65,
    `Drop 骤降期功率相比高潮期应有明显回落 (powerDrop=${powerDrop.toFixed(3)}, powerClimax=${powerClimax.toFixed(3)})`,
  );

  // (3) 测试无 low/rms 的 mock 音频保底兼容性
  const mockNoEnvMusic = new m.Music({
    version: 1,
    duration,
    bpm,
    namedBpm: bpm,
    meter: 4,
    beats,
    beatInBar: beats.map((_, i) => i % 4),
    tempo: beats.map(() => bpm),
    downbeats,
    sections,
    hits: { kick: kicks, snare: snares },
    roles: { kick: kicks, snare: snares, synthStab: kicks, lead: kicks },
    env: { kick: new Float32Array(10), snare: new Float32Array(10) }, // 无 low/rms
  });
  laser.update({
    t: 28.0,
    dt: 0.05,
    shotT: 18.0,
    shot: dropShot,
    music: mockNoEnvMusic,
    lyrics: lyricTrack,
    palette,
    fx: m.defaultFx(),
    aspect: 16 / 9,
  });
  assert.equal(laser.uniforms.uDropPower.value, 1.0, '无 low/rms 包络的 mock 音频应安全保底为 1.0');

  // 2. 验证激光颜色切换时机严格绑定每句歌词开头时间戳
  // 采样第一句歌词开头时刻 (t = 12.0s)
  updateAt(12.0);
  const colorAtLine0Start = laser.uniforms.uLaserPrimary.value.clone();
  const palBaseLine0Start = laser.uniforms.uPalBase.value;

  // 采样第一句歌词中途时刻 (t = 13.5s、t = 15.0s、t = 16.5s)
  // 无论期间军鼓如何击打，颜色槽必须严格保持恒定不变
  for (const midT of [13.5, 15.0, 16.5]) {
    updateAt(midT);
    const colorMid = laser.uniforms.uLaserPrimary.value;
    const palBaseMid = laser.uniforms.uPalBase.value;
    assert.equal(
      palBaseMid,
      palBaseLine0Start,
      `在第一句歌词唱诵中途 (t=${midT}s)，色彩基槽 uPalBase 应绝对锁定在句首色彩，不得突变跳色`,
    );
    assert.ok(
      colorMid.distanceTo(colorAtLine0Start) < 1e-4,
      `在第一句歌词唱诵中途 (t=${midT}s)，主激光色彩 uLaserPrimary 应与句首一致`,
    );
  }

  // 采样第二句歌词开头时刻 (t = 19.0s)
  updateAt(19.0);
  const palBaseLine1Start = laser.uniforms.uPalBase.value;
  assert.notEqual(
    palBaseLine1Start,
    palBaseLine0Start,
    `第二句歌词开头时刻 (t=19.0s) 应精准推进切换为下一个色槽`,
  );

  // 采样第二句歌词中途时刻 (t = 21.0s、t = 23.0s)
  for (const midT of [21.0, 23.0]) {
    updateAt(midT);
    const palBaseMid = laser.uniforms.uPalBase.value;
    assert.equal(
      palBaseMid,
      palBaseLine1Start,
      `在第二句歌词唱诵中途 (t=${midT}s)，色彩槽应锁定在第二句句首色彩`,
    );
  }

  // 3. 验证纯音乐（无歌词 lines: []）时按 4 小节乐句下拍推进
  const emptyLyricTrack = new m.LyricTrack([]);
  laser.update({
    t: 0.1,
    dt: 0.05,
    shotT: 0.1,
    shot: { ...dropShot, section: sections[0] },
    music: dropTestMusic,
    lyrics: emptyLyricTrack,
    palette,
    fx: m.defaultFx(),
    aspect: 16 / 9,
  });
  const colorBar0 = laser.uniforms.uPalBase.value;
  // 在前 3 个小节内（t < 8.0s），纯音乐不应高频跳切
  laser.update({
    t: 3.5,
    dt: 0.05,
    shotT: 3.5,
    shot: { ...dropShot, section: sections[0] },
    music: dropTestMusic,
    lyrics: emptyLyricTrack,
    palette,
    fx: m.defaultFx(),
    aspect: 16 / 9,
  });
  assert.equal(laser.uniforms.uPalBase.value, colorBar0, '纯音乐前 4 小节内应保持稳步色相，不因节拍高频跳变');
});

test('Challenger 2 对抗实证：100次随机跨越 Seek 幂等性、无歌词 Fallback 稳态与极端声学稳定性压测', () => {
  const m = mods;
  const fixture = buildMockFixture();
  const { music, lyrics, palette, init } = fixture;

  const getShotAt = (t) => {
    const secIdx = music.sectionIndex(t);
    const sec = music.a.sections[secIdx] ?? music.a.sections[0];
    return {
      index: secIdx,
      start: sec.start,
      end: sec.end,
      scene: 'laser',
      variant: 'arena',
      section: sec,
      sectionIndex: secIdx,
      seed: 9988,
      short: false,
    };
  };

  const makeCtx = (scene, t, customMusic = music, customLyrics = lyrics) => {
    const shot = getShotAt(t);
    return {
      t,
      dt: 0.05,
      shotT: t - shot.start,
      shot,
      music: customMusic,
      lyrics: customLyrics,
      palette,
      fx: m.defaultFx(),
      aspect: 16 / 9,
    };
  };

  // -------------------------------------------------------------
  // 实证压测 1：随机 Seek 幂等性检验（100 次跨时间段随机跨越）
  // -------------------------------------------------------------
  // 断言：同一时间戳 t 无论经过何种 Seek 路径到达，其计算出的 dropPower 与 activeUnisonSlot 必须完全相等（严格纯函数 f(t)，零状态残留）
  const persistentLaser = new m.LaserScene({ ...init, music, lyrics }, 'pulse');

  // 线性同余随机数发生器，确保 100 次压测结果具有严格可重现性
  let seed = 123456789;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // 生成 100 个随机 Seek 目标时间戳（全面覆盖 intro, verse, build, drop, chorus, bridge, outro 以及边界点）
  const testTimestamps = [];
  // 注入关键结构性边界点
  testTimestamps.push(0.0, 0.05, 7.99, 8.0, 8.01, 16.99, 17.0, 25.0, 32.99, 33.0, 33.01, 56.99, 57.0, 73.99, 74.0, 87.99, 88.0, 97.9);
  // 注入歌词起止边界点
  for (const line of lyrics.lines.slice(0, 5)) {
    testTimestamps.push(line.start, line.start + 0.01, line.end, line.end + 0.5, line.end + 1.25);
  }
  // 补足至 100 个随机分布时间戳
  while (testTimestamps.length < 100) {
    const t = +(rand() * (music.duration - 0.2)).toFixed(4);
    testTimestamps.push(t);
  }

  for (let idx = 0; idx < testTimestamps.length; idx++) {
    const targetT = testTimestamps[idx];

    // 基准 1：独立全新实例在 targetT 下的计算结果（绝对单点标准）
    const freshLaser = new m.LaserScene({ ...init, music, lyrics }, 'pulse');
    freshLaser.update(makeCtx(freshLaser, targetT));

    const expectedDropPower = freshLaser.uniforms.uDropPower.value;
    const expectedPalBase = freshLaser.uniforms.uPalBase.value;
    const expectedPalSpan = freshLaser.uniforms.uPalSpan.value;
    const expectedSheetSpread = freshLaser.uniforms.uSheetSpread.value;
    const expectedLaserPrimary = freshLaser.uniforms.uLaserPrimary.value.clone();
    const expectedBeamPower0 = freshLaser.beamStyleAttr.array[0];
    const expectedBeamMix0 = freshLaser.beamStyleAttr.array[1];

    // 路径扰动：让持久实例先经历 5 次随机跳跃（前跳、后跳、跨段大范围跳跃），制造潜在的时序状态污染
    for (let jump = 0; jump < 5; jump++) {
      const noisyT = +(rand() * (music.duration - 0.2)).toFixed(4);
      persistentLaser.update(makeCtx(persistentLaser, noisyT));
    }

    // 最终跳转到目标 targetT 进行求值
    persistentLaser.update(makeCtx(persistentLaser, targetT));

    const actualDropPower = persistentLaser.uniforms.uDropPower.value;
    const actualPalBase = persistentLaser.uniforms.uPalBase.value;
    const actualPalSpan = persistentLaser.uniforms.uPalSpan.value;
    const actualSheetSpread = persistentLaser.uniforms.uSheetSpread.value;
    const actualLaserPrimary = persistentLaser.uniforms.uLaserPrimary.value;
    const actualBeamPower0 = persistentLaser.beamStyleAttr.array[0];
    const actualBeamMix0 = persistentLaser.beamStyleAttr.array[1];

    // 严格断言零状态残留
    assert.ok(
      Math.abs(actualDropPower - expectedDropPower) < 1e-6,
      `[Seek 幂等性测试 #${idx}] t=${targetT}s 处 uDropPower 出现跨帧状态残留: actual=${actualDropPower}, expected=${expectedDropPower}`,
    );
    assert.equal(
      actualPalBase,
      expectedPalBase,
      `[Seek 幂等性测试 #${idx}] t=${targetT}s 处 uPalBase 色槽不一致: actual=${actualPalBase}, expected=${expectedPalBase}`,
    );
    assert.equal(
      actualPalSpan,
      expectedPalSpan,
      `[Seek 幂等性测试 #${idx}] t=${targetT}s 处 uPalSpan 渐变跨度不一致: actual=${actualPalSpan}, expected=${expectedPalSpan}`,
    );
    assert.ok(
      Math.abs(actualSheetSpread - expectedSheetSpread) < 1e-6,
      `[Seek 幂等性测试 #${idx}] t=${targetT}s 处 uSheetSpread 张角不一致: actual=${actualSheetSpread}, expected=${expectedSheetSpread}`,
    );
    assert.ok(
      actualLaserPrimary.distanceTo(expectedLaserPrimary) < 1e-5,
      `[Seek 幂等性测试 #${idx}] t=${targetT}s 处 uLaserPrimary 色彩向量不一致: dist=${actualLaserPrimary.distanceTo(expectedLaserPrimary)}`,
    );
    assert.ok(
      Math.abs(actualBeamPower0 - expectedBeamPower0) < 1e-5,
      `[Seek 幂等性测试 #${idx}] t=${targetT}s 处 beamStyle[0] 功率不一致: actual=${actualBeamPower0}, expected=${expectedBeamPower0}`,
    );
    assert.ok(
      Math.abs(actualBeamMix0 - expectedBeamMix0) < 1e-5,
      `[Seek 幂等性测试 #${idx}] t=${targetT}s 处 beamStyle[1] 颜色混合不一致: actual=${actualBeamMix0}, expected=${expectedBeamMix0}`,
    );
  }

  // -------------------------------------------------------------
  // 实证压测 2：纯音乐（无歌词 lines: []）稳态与节奏呼吸检验
  // -------------------------------------------------------------
  // 验证在纯音乐（lines: []）Drop 段落中，颜色槽位是否严格按 4 小节乐句下拍稳定推进，
  // 且在 32 秒内变色频率在合理乐理区间（120BPM 时约每 8 秒换一次色，共 3 次），绝无军鼓高频乱闪。
  const pureDropDuration = 32;
  const pureDropBpm = 120;
  const pureDropBeatLen = 60 / pureDropBpm; // 0.5s
  const pureDropBeats = [];
  const pureDropDownbeats = [];
  const aggressiveKicks = [];
  const aggressiveSnares = [];
  for (let i = 0; i * pureDropBeatLen <= pureDropDuration; i++) {
    const t = +(i * pureDropBeatLen).toFixed(4);
    pureDropBeats.push(t);
    if (i % 4 === 0) pureDropDownbeats.push(t);
    aggressiveKicks.push([t, 1.0]);
    // 注入密集的军鼓滚奏与切分重击（每半拍一击，测试军鼓是否会引发乱闪）
    aggressiveSnares.push([t + pureDropBeatLen * 0.5, 1.0]);
  }
  const pureDropMusic = new m.Music({
    version: 1,
    duration: pureDropDuration,
    bpm: pureDropBpm,
    namedBpm: pureDropBpm,
    meter: 4,
    beats: pureDropBeats,
    beatInBar: pureDropBeats.map((_, i) => i % 4),
    tempo: pureDropBeats.map(() => pureDropBpm),
    downbeats: pureDropDownbeats,
    sections: [{ start: 0, end: pureDropDuration, label: 'drop', energy: 0.95, group: 0, vocal: false }],
    hits: { kick: aggressiveKicks, snare: aggressiveSnares },
    roles: { kick: aggressiveKicks, snare: aggressiveSnares },
    env: {
      fps: 30,
      low: new Float32Array(pureDropDuration * 30).fill(0.85),
      rms: new Float32Array(pureDropDuration * 30).fill(0.90),
    },
  });

  const emptyLyrics = new m.LyricTrack([]);
  const pureDropLaser = new m.LaserScene({ ...init, music: pureDropMusic, lyrics: emptyLyrics }, 'pulse');
  const pureDropShot = {
    index: 0,
    start: 0,
    end: pureDropDuration,
    scene: 'laser',
    variant: 'arena',
    section: pureDropMusic.a.sections[0],
    sectionIndex: 0,
    seed: 5566,
    short: false,
  };

  // 在 32 秒纯乐 Drop 中，以 60 FPS (dt = 0.01667s) 高频连续推进，总计 1920 帧，检测色彩跳变事件
  const fps = 60;
  const frameDt = 1 / fps;
  const transitions = [];
  let prevSlot = null;

  for (let t = 0.0; t < pureDropDuration; t += frameDt) {
    const curT = +t.toFixed(4);
    pureDropLaser.update({
      t: curT,
      dt: frameDt,
      shotT: curT,
      shot: pureDropShot,
      music: pureDropMusic,
      lyrics: emptyLyrics,
      palette,
      fx: m.defaultFx(),
      aspect: 16 / 9,
    });
    const curSlot = pureDropLaser.uniforms.uPalBase.value;

    if (prevSlot === null) {
      prevSlot = curSlot;
    } else if (curSlot !== prevSlot) {
      transitions.push({ t: curT, from: prevSlot, to: curSlot });
      prevSlot = curSlot;
    }
  }

  // 断言 1：在 32 秒纯乐 Drop 区间内，色彩跳变次数必须严格处于合理乐理区间（在 120BPM 下每 8 秒换一次色，32 秒内切换 3 次）
  assert.equal(
    transitions.length,
    3,
    `纯乐 Drop 在 32 秒内变色次数应精准为 3 次 (实际检测到 ${transitions.length} 次)，杜绝军鼓高频乱闪。切换时点: ${JSON.stringify(transitions.map(x => x.t))}`,
  );

  // 断言 2：每次变色时点必须严格与 4 小节下拍对齐 (t 为 8.0s 的倍数点：8s, 16s, 24s, 32s)，误差不超过 1 帧
  for (const trans of transitions) {
    const expectedTimes = [8.0, 16.0, 24.0, 32.0];
    const isMatched = expectedTimes.some((et) => Math.abs(trans.t - et) <= frameDt * 1.5);
    assert.ok(
      isMatched,
      `变色时点 t=${trans.t}s 必须严格对齐 4 小节下拍周期点 (8s, 16s, 24s, 32s)`,
    );
  }

  // 断言 3：验证各乐句内部（如 0.5s~7.5s, 8.5s~15.5s, 16.5s~23.5s, 24.5s~31.5s），即使面对密集军鼓重击，色槽恒定不变
  for (const phraseWindow of [[0.5, 7.5], [8.5, 15.5], [16.5, 23.5], [24.5, 31.5]]) {
    const [wStart, wEnd] = phraseWindow;
    pureDropLaser.update({
      t: wStart,
      dt: 0.05,
      shotT: wStart,
      shot: pureDropShot,
      music: pureDropMusic,
      lyrics: emptyLyrics,
      palette,
      fx: m.defaultFx(),
      aspect: 16 / 9,
    });
    const slotStart = pureDropLaser.uniforms.uPalBase.value;

    for (let checkT = wStart + 0.5; checkT <= wEnd; checkT += 0.5) {
      pureDropLaser.update({
        t: checkT,
        dt: 0.05,
        shotT: checkT,
        shot: pureDropShot,
        music: pureDropMusic,
        lyrics: emptyLyrics,
        palette,
        fx: m.defaultFx(),
        aspect: 16 / 9,
      });
      assert.equal(
        pureDropLaser.uniforms.uPalBase.value,
        slotStart,
        `在乐句内部 [${wStart}s, ${wEnd}s] 的 t=${checkT}s 处，色槽必须严格稳定，不受连续军鼓干扰`,
      );
    }
  }

  // -------------------------------------------------------------
  // 实证压测 3：缺少声学包络 / 极端边界稳定性检验
  // -------------------------------------------------------------
  // Case 3.1: 完全缺失 low/rms 包络的 mock 音频
  const noEnvAnalysis = {
    ...music.a,
    env: { fps: 30 }, // 无 low, rms
  };
  const noEnvMusic = new m.Music(noEnvAnalysis);
  const robustLaser = new m.LaserScene({ ...init, music: noEnvMusic, lyrics: emptyLyrics }, 'pulse');

  // 无论在 drop 还是 chorus，均安全保底，不抛异常，不出现 NaN
  robustLaser.update(makeCtx(robustLaser, 35.0, noEnvMusic, emptyLyrics)); // Drop 段
  assert.equal(robustLaser.uniforms.uDropPower.value, 1.0, '缺少 low/rms 包络时 Drop 状态 dropPower 应安全保底为 1.0');

  robustLaser.update(makeCtx(robustLaser, 60.0, noEnvMusic, emptyLyrics)); // Chorus 段
  assert.equal(robustLaser.uniforms.uDropPower.value, 0.84, '缺少 low/rms 包络时 Chorus 状态 dropPower 应安全保底为 0.84');

  // Case 3.2: 空 Float32Array 包络防御 (low/rms 长度为 0)
  const emptyArrayAnalysis = {
    ...music.a,
    env: {
      fps: 30,
      low: new Float32Array(0),
      rms: new Float32Array(0),
    },
  };
  const emptyArrayMusic = new m.Music(emptyArrayAnalysis);
  robustLaser.update(makeCtx(robustLaser, 35.0, emptyArrayMusic, emptyLyrics));
  assert.equal(robustLaser.uniforms.uDropPower.value, 1.0, '包络数组长度为 0 时应安全保底为 1.0');

  // Case 3.3: 能量为 0 与超常能量边界值防御
  const zeroEnergySec = { start: 0, end: 10, label: 'drop', energy: 0.0, group: 0, vocal: false };
  const zeroEnergyShot = { ...getShotAt(5.0), section: zeroEnergySec };
  robustLaser.update({
    t: 5.0,
    dt: 0.05,
    shotT: 5.0,
    shot: zeroEnergyShot,
    music,
    lyrics: emptyLyrics,
    palette,
    fx: m.defaultFx(),
    aspect: 16 / 9,
  });
  const zeroEnergyPower = robustLaser.uniforms.uDropPower.value;
  assert.ok(
    Number.isFinite(zeroEnergyPower) && zeroEnergyPower >= 0.35 && zeroEnergyPower <= 1.0,
    `sec.energy=0 边界下 dropPower 必须为有效有限数值，实测为 ${zeroEnergyPower}`,
  );

  // Case 3.4: 极端 Drop 能量衰减下外围光束淡出至 discard 门限检查
  // 构造极端低能 Drop 音频 (lowEnv = 0, rmsEnv = 0, kicks = 0)
  const deadLowArr = new Float32Array(music.a.env.fps * 20).fill(0);
  const deadRmsArr = new Float32Array(music.a.env.fps * 20).fill(0);
  const deadDropMusic = new m.Music({
    ...music.a,
    duration: 20,
    sections: [{ start: 0, end: 20, label: 'drop', energy: 0.8, group: 0, vocal: false }],
    hits: { kick: [], snare: [], hat: [], accent: [] },
    roles: { kick: [], snare: [] },
    env: { fps: 30, low: deadLowArr, rms: deadRmsArr },
  });
  const deadDropShot = {
    index: 0,
    start: 0,
    end: 20,
    scene: 'laser',
    variant: 'arena',
    section: deadDropMusic.a.sections[0],
    sectionIndex: 0,
    seed: 4321,
    short: false,
  };
  robustLaser.update({
    t: 10.0,
    dt: 0.05,
    shotT: 10.0,
    shot: deadDropShot,
    music: deadDropMusic,
    lyrics: emptyLyrics,
    palette,
    fx: m.defaultFx(),
    aspect: 16 / 9,
  });
  const deadDropPower = robustLaser.uniforms.uDropPower.value;
  assert.equal(
    deadDropPower,
    0.35,
    `在低频与 RMS 完全为 0 且无底鼓冲击时，dropPower 应下潜至理论硬保底 0.35 (实测 ${deadDropPower})`,
  );

  // 验证全部 88 束对称激光（含左右各 18 束加密下射水面反射长廊）中，外围光束在 dropPower=0.35 时已完全衰减至 0 (触发 discard)
  const beamCount = robustLaser.beamStyleAttr.count / 2;
  assert.equal(beamCount, 88, '侧廊下射加密后单束激光本体数量应为 88 束');
  assert.equal(robustLaser.sheetStyleAttr.count / 2, 12, '扫描光幕本体数量应为 12 座');
  assert.equal(robustLaser.coneSpecAttr.count / 2, 2, '旋转锥笼本体应为 2 层');

  // 验证全部 88 束发射口坐标均不落在中央专辑封面可视盘面内部 (|x| < 7.5 && y ∈ [2.6, 17.6] && z <= -51.5)
  const beamStarts = robustLaser.beamStartAttr.array;
  for (let bIdx = 0; bIdx < beamCount; bIdx++) {
    const bx = beamStarts[bIdx * 4];
    const by = beamStarts[bIdx * 4 + 1];
    const bz = beamStarts[bIdx * 4 + 2];
    const insideCoverCenter = Math.abs(bx) < 7.5 && by > 2.6 && by < 17.6 && bz <= -51.5;
    assert.ok(!insideCoverCenter, `光束 #${bIdx} 发射点 (${bx}, ${by}, ${bz}) 不得位于专辑封面内部`);
  }

  const beamStyles = robustLaser.beamStyleAttr.array;
  let hasZeroedOuterBeam = false;
  let hasActiveCoreBeam = false;
  for (let bIdx = 0; bIdx < beamCount; bIdx++) {
    const power = beamStyles[bIdx * 4];
    assert.ok(Number.isFinite(power) && power >= 0, `光束 #${bIdx} 的功率必须为非负有限数，实测 ${power}`);
    if (power < 1e-4) {
      hasZeroedOuterBeam = true;
    } else {
      hasActiveCoreBeam = true;
    }
  }
  assert.ok(hasZeroedOuterBeam, '在 dropPower=0.35 极限衰减下，外围光束应平滑淡出至 0');
  assert.ok(hasActiveCoreBeam, '在 dropPower=0.35 极限衰减下，中央核心光束应保留柔和光感');

  // 验证高能 Drop 炸场期间单束激光具备强烈明暗追光对比度（同帧亮束峰值与暗侧底噪比 > 8:1）
  pureDropLaser.update({
    t: 2.0, // 正拍重击时刻
    dt: frameDt,
    shotT: 2.0,
    shot: pureDropShot,
    music: pureDropMusic,
    lyrics: emptyLyrics,
    palette,
    fx: m.defaultFx(),
    aspect: 16 / 9,
  });
  let maxBeamP = 0;
  let minBeamP = Infinity;
  for (let bIdx = 0; bIdx < beamCount; bIdx++) {
    const p = pureDropLaser.beamStyleAttr.array[bIdx * 4];
    if (p > maxBeamP) maxBeamP = p;
    if (p < minBeamP) minBeamP = p;
  }
  assert.ok(
    maxBeamP > 1.0 && minBeamP < 0.12 && maxBeamP / Math.max(1e-4, minBeamP) > 8.0,
    `高能 Drop 应呈现鲜明的追光亮灭反差 (max=${maxBeamP.toFixed(3)}, min=${minBeamP.toFixed(3)})`,
  );

  // 验证 cueMode=1（t=4.0s 圆锥隧道段）左右两侧高空向下射的激光已加密至 18+18=36 束，且全部精准穿过 y=0 水面以激发 V 形镜面折返反射束
  pureDropLaser.update({
    t: 4.0,
    dt: frameDt,
    shotT: 4.0,
    shot: pureDropShot,
    music: pureDropMusic,
    lyrics: emptyLyrics,
    palette,
    fx: m.defaultFx(),
    aspect: 16 / 9,
  });
  let corridorBounceCount = 0;
  for (let bIdx = 40; bIdx < 76; bIdx++) {
    const startY = pureDropLaser.beamStartAttr.array[bIdx * 4 + 1];
    const endY = pureDropLaser.beamEndAttr.array[bIdx * 4 + 1];
    const p = pureDropLaser.beamStyleAttr.array[bIdx * 4];
    if (startY > 10.0 && endY < -5.0 && p > 0.20) {
      corridorBounceCount++;
    }
  }
  assert.equal(corridorBounceCount, 36, `圆锥隧道段左右两侧应有全部 36 束 (18+18) 下射激光激活并触发水面镜面反射，实测 ${corridorBounceCount} 束`);
});



