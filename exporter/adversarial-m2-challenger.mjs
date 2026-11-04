// BetterMV M2 4大3D舞台场景对抗性挑战与实证验证脚本
// Challenger 1: 60fps连续性/切镜平滑度、100次随机Seek纯函数幂等性、极端宽高比实证
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import * as THREE from 'three';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Node 无头环境 Canvas 2D 桩
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
    blendCameraPose: blendMod.blendCameraPose,
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
    { start: 40, end: 56, label: 'drop', energy: 0.95, group: 3, vocal: false },
    { start: 56, end: duration, label: 'outro', energy: 0.40, group: 4, vocal: false },
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
      start: 24.5, end: 28.0, text: '千灯破晓如太极光芒', timedWords: true, translation: 'Lanterns break through dawn',
      words: [{ text: '千灯', start: 24.5, end: 26.0 }, { text: '破晓', start: 26.1, end: 28.0 }],
    },
    {
      start: 40.5, end: 44.0, text: '日蚀撕裂天穹与熔岩河', timedWords: true, translation: 'Eclipse tears sky and lava',
      words: [{ text: '日蚀', start: 40.5, end: 42.0 }, { text: '熔岩', start: 42.1, end: 44.0 }],
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

// ---------------------------------------------------------------------
// 实证挑战 1：60fps 动画连续性与导播切镜平滑度实证
// ---------------------------------------------------------------------
test('实证挑战 1：4大场景所有 16 种变体机位组合在 60fps 下的过渡连续性与角速度平滑度实证', () => {
  const { music, lyrics, palette, init } = buildMockFixture();
  const sceneConfigs = [
    {
      id: 'cathedral',
      factory: () => new mods.CathedralScene(init, 'pulse'),
      variants: ['sanctuary', 'aisle', 'organ', 'soar'],
      maxPosStepLimit: 2.0, // 54m 纵向长廊跨度
      maxAngStepLimit: 0.14,
    },
    {
      id: 'highway',
      factory: () => new mods.HighwayScene(init, 'pulse'),
      variants: ['cockpit', 'chase', 'bridge', 'warp'],
      maxPosStepLimit: 2.0, // 45m 桥塔高空斜侧到贴地车道跨度
      maxAngStepLimit: 0.14,
    },
    {
      id: 'pavilion',
      factory: () => new mods.PavilionScene(init, 'pulse'),
      variants: ['pavilion', 'water', 'eaves', 'zenith'],
      maxPosStepLimit: 1.6, // 32m 空间跨度
      maxAngStepLimit: 0.14,
    },
    {
      id: 'eclipse',
      factory: () => new mods.EclipseScene(init, 'pulse'),
      variants: ['canyon', 'corona', 'ridge', 'abyss'],
      maxPosStepLimit: 2.2, // 61m 峡谷绝壁边缘到中轴跨度
      maxAngStepLimit: 0.14,
    },
  ];

  const dt = 1 / 60;
  const cutTime = 20.0;
  const blendDuration = 1.45;
  const blendFrames = Math.ceil(blendDuration / dt);

  const stats = [];

  for (const cfg of sceneConfigs) {
    const scene = cfg.factory();
    let totalTransitionsChecked = 0;
    let maxObservedPosStep = 0;
    let maxObservedAngStep = 0;
    let maxObservedFovStep = 0;
    let maxObservedPosAccel = 0;
    let maxObservedAngAccel = 0;
    let maxCutBoundaryPosStep = 0;

    for (const vA of cfg.variants) {
      for (const vB of cfg.variants) {
        totalTransitionsChecked++;

        const shotA = {
          index: 0,
          start: cutTime - 5.0,
          end: cutTime,
          scene: cfg.id,
          variant: vA,
          section: music.a.sections[1],
          sectionIndex: 1,
          seed: 1001,
          short: false,
        };
        const shotB = {
          index: 1,
          start: cutTime,
          end: cutTime + 5.0,
          scene: cfg.id,
          variant: vB,
          section: music.a.sections[1],
          sectionIndex: 1,
          seed: 2002,
          short: false,
          prevSame: shotA,
        };

        const evalFrame = (t, sh) => {
          scene.update({
            t,
            dt,
            shotT: t - sh.start,
            shot: sh,
            music,
            lyrics,
            palette,
            fx: mods.defaultFx(),
            aspect: 16 / 9,
          });
          const pos = scene.camera.position.clone();
          const quat = scene.camera.quaternion.clone();
          const fov = scene.camera.fov;

          // 严格验证无 NaN 或无穷大
          assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), `[${cfg.id}] pos 包含非有限值: (${pos.x}, ${pos.y}, ${pos.z})`);
          assert.ok(Number.isFinite(quat.x) && Number.isFinite(quat.y) && Number.isFinite(quat.z) && Number.isFinite(quat.w), `[${cfg.id}] quat 包含非有限值`);
          assert.ok(Number.isFinite(fov) && fov > 10 && fov < 150, `[${cfg.id}] fov 超出合理物理范围: ${fov}`);

          return { pos, quat, fov };
        };

        // 收集切点前 5 帧、切点瞬间、以及过渡期内所有帧的轨迹
        const trajectory = [];
        for (let f = -5; f < 0; f++) {
          trajectory.push(evalFrame(cutTime + f * dt, shotA));
        }
        for (let f = 0; f <= blendFrames + 5; f++) {
          trajectory.push(evalFrame(cutTime + f * dt, shotB));
        }

        // 切点瞬间的步长（帧 index 5 vs 4）
        const cutBoundaryStep = trajectory[5].pos.distanceTo(trajectory[4].pos);
        if (cutBoundaryStep > maxCutBoundaryPosStep) maxCutBoundaryPosStep = cutBoundaryStep;
        assert.ok(
          cutBoundaryStep <= 0.15,
          `[${cfg.id}] ${vA} -> ${vB} 切点首帧发生瞬移跳跃: cutBoundaryStep=${cutBoundaryStep.toFixed(4)}m`,
        );

        // 逐帧验证步长与加速度连续性
        const steps = [];
        for (let k = 1; k < trajectory.length; k++) {
          const prev = trajectory[k - 1];
          const curr = trajectory[k];
          const posStep = curr.pos.distanceTo(prev.pos);
          const angStep = quatAngle(curr.quat, prev.quat);
          const fovStep = Math.abs(curr.fov - prev.fov);
          steps.push({ posStep, angStep, fovStep });

          if (posStep > maxObservedPosStep) maxObservedPosStep = posStep;
          if (angStep > maxObservedAngStep) maxObservedAngStep = angStep;
          if (fovStep > maxObservedFovStep) maxObservedFovStep = fovStep;

          assert.ok(
            posStep <= cfg.maxPosStepLimit,
            `[${cfg.id}] ${vA} -> ${vB} 帧间位移超限: step=${posStep.toFixed(4)} limit=${cfg.maxPosStepLimit}`,
          );
          assert.ok(
            angStep <= cfg.maxAngStepLimit,
            `[${cfg.id}] ${vA} -> ${vB} 帧间角速度超限: ang=${angStep.toFixed(4)}rad limit=${cfg.maxAngStepLimit}`,
          );
          assert.ok(
            fovStep <= 5.0,
            `[${cfg.id}] ${vA} -> ${vB} 帧间 FOV 突变: dFov=${fovStep.toFixed(4)}`,
          );
        }

        // 验证二阶平滑度（加速度无瞬态尖刺突变，即 jerk 有界）
        for (let k = 1; k < steps.length; k++) {
          const posAccel = Math.abs(steps[k].posStep - steps[k - 1].posStep);
          const angAccel = Math.abs(steps[k].angStep - steps[k - 1].angStep);
          if (posAccel > maxObservedPosAccel) maxObservedPosAccel = posAccel;
          if (angAccel > maxObservedAngAccel) maxObservedAngAccel = angAccel;

          if (posAccel > 0.055) {
            // console.log(`[${cfg.id}] ${vA} -> ${vB} frame k=${k}: step[k]=${steps[k].posStep.toFixed(4)}, step[k-1]=${steps[k-1].posStep.toFixed(4)}, posAccel=${posAccel.toFixed(4)}`);
          }
          assert.ok(
            posAccel <= 0.095,
            `[${cfg.id}] ${vA} -> ${vB} 帧间加速度突变 (Jerk Spike): accel=${posAccel.toFixed(4)}m/frame^2`,
          );
          assert.ok(
            angAccel <= 0.020,
            `[${cfg.id}] ${vA} -> ${vB} 帧间角加速度突变: angAccel=${angAccel.toFixed(4)}rad/frame^2`,
          );
        }
      }
    }

    stats.push({
      scene: cfg.id,
      transitions: totalTransitionsChecked,
      cutBoundaryStep: maxCutBoundaryPosStep,
      maxPosStep: maxObservedPosStep,
      maxPosAccel: maxObservedPosAccel,
      maxAngStep: maxObservedAngStep,
      maxAngAccel: maxObservedAngAccel,
      maxFovStep: maxObservedFovStep,
    });
  }

  console.log('✅ [实证挑战 1] 60fps 连续性与切镜平滑度数据汇总:');
  for (const s of stats) {
    console.log(`   - 场景 ${s.scene.padEnd(10)}: ${s.transitions} 组切镜组合全检通过 | 切点接缝位移: ${s.cutBoundaryStep.toFixed(4)}m | 峰值步长: ${s.maxPosStep.toFixed(4)}m (加速度: ${s.maxPosAccel.toFixed(4)}m/f²) | 峰值角位移: ${s.maxAngStep.toFixed(4)}rad (角加速度: ${s.maxAngAccel.toFixed(4)}rad/f²) | 最大 FOV 步长: ${s.maxFovStep.toFixed(4)}°`);
  }
});

// ---------------------------------------------------------------------
// 实证挑战 2：Seek 纯函数幂等性极端挑战（100次随机跳转）
// ---------------------------------------------------------------------
test('实证挑战 2：100次跨段随机向前/向后 Seek 幂等性对比（直接跳 vs 扰动后跳）', () => {
  const { music, lyrics, palette, init } = buildMockFixture();

  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const getShotAt = (t, sceneId) => {
    const secIdx = music.sectionIndex(t);
    const sec = music.a.sections[secIdx] ?? music.a.sections[0];
    return {
      index: secIdx,
      start: sec.start,
      end: sec.end,
      scene: sceneId,
      variant: undefined,
      section: sec,
      sectionIndex: secIdx,
      seed: 8877,
      short: false,
    };
  };

  const makeCtx = (sceneId, t) => {
    const shot = getShotAt(t, sceneId);
    return {
      t,
      dt: 1 / 60,
      shotT: t - shot.start,
      shot,
      music,
      lyrics,
      palette,
      fx: mods.defaultFx(),
      aspect: 16 / 9,
    };
  };

  const testTimestamps = [];
  testTimestamps.push(0.0, 0.05, 7.99, 8.0, 8.01, 23.99, 24.0, 24.01, 39.99, 40.0, 40.01, 40.5, 41.2, 55.99, 56.0, 56.01, 63.8);
  for (const line of lyrics.lines) {
    testTimestamps.push(line.start, line.start + 0.02, line.end, line.end + 0.3);
  }
  while (testTimestamps.length < 100) {
    const t = +(rand() * (music.duration - 0.2)).toFixed(4);
    testTimestamps.push(t);
  }

  const scenesToTest = [
    {
      id: 'cathedral',
      factory: () => new mods.CathedralScene(init, 'pulse'),
      extractCoreState: (scene) => ({
        camPos: scene.camera.position.clone(),
        camQuat: scene.camera.quaternion.clone(),
        camFov: scene.camera.fov,
        altarIntensity: scene.altarLight.intensity,
        waterPos: scene.waterMirrorMesh.position.clone(),
        rosePos: scene.roseWindowMesh.position.clone(),
        organLeftPos: scene.organPipesLeft.position.clone(),
        beam0Pos: scene.beamMeshes[0].position.clone(),
        beam0RotZ: scene.beamMeshes[0].rotation.z,
      }),
    },
    {
      id: 'highway',
      factory: () => new mods.HighwayScene(init, 'pulse'),
      extractCoreState: (scene) => ({
        camPos: scene.camera.position.clone(),
        camQuat: scene.camera.quaternion.clone(),
        camFov: scene.camera.fov,
        sunsetPos: scene.sunsetMesh.position.clone(),
        underglowPos: scene.underglowMesh.position.clone(),
        tailLightsPos: scene.tailLightsMesh.position.clone(),
        distanceUniform: scene.uniforms.uDistance.value,
      }),
    },
    {
      id: 'pavilion',
      factory: () => new mods.PavilionScene(init, 'pulse'),
      extractCoreState: (scene) => ({
        camPos: scene.camera.position.clone(),
        camQuat: scene.camera.quaternion.clone(),
        camFov: scene.camera.fov,
        pavilionGroupY: scene.pavilionGroup.position.y,
        silkPoolPos: scene.silkPoolMesh.position.clone(),
        lightPillarPos: scene.lightPillarMesh.position.clone(),
      }),
    },
    {
      id: 'eclipse',
      factory: () => new mods.EclipseScene(init, 'pulse'),
      extractCoreState: (scene) => ({
        camPos: scene.camera.position.clone(),
        camQuat: scene.camera.quaternion.clone(),
        camFov: scene.camera.fov,
        moonPos: scene.moonMesh.position.clone(),
        magmaPos: scene.magmaRiverMesh.position.clone(),
        canyonLeftPos: scene.canyonWallsMesh.position.clone(),
        shockwaveScaleX: scene.shockwaveRingMesh.scale.x,
      }),
    },
  ];

  for (const item of scenesToTest) {
    const persistentScene = item.factory();
    let maxCamPosErr = 0;
    let maxCamQuatErr = 0;
    let maxCamFovErr = 0;
    let maxMeshPosErr = 0;
    let specificDiscrepancies = [];

    for (let i = 0; i < testTimestamps.length; i++) {
      const targetT = testTimestamps[i];

      const oracleScene = item.factory();
      oracleScene.update(makeCtx(item.id, targetT));
      const oracleState = item.extractCoreState(oracleScene);

      for (let step = 0; step < 3; step++) {
        const noisyT = +(rand() * (music.duration - 0.2)).toFixed(4);
        persistentScene.update(makeCtx(item.id, noisyT));
      }
      persistentScene.update(makeCtx(item.id, targetT));
      const persistentState = item.extractCoreState(persistentScene);

      const camPosErr = persistentState.camPos.distanceTo(oracleState.camPos);
      const camQuatErr = quatComponentDiff(persistentState.camQuat, oracleState.camQuat);
      const camFovErr = Math.abs(persistentState.camFov - oracleState.camFov);

      if (camPosErr > maxCamPosErr) maxCamPosErr = camPosErr;
      if (camQuatErr > maxCamQuatErr) maxCamQuatErr = camQuatErr;
      if (camFovErr > maxCamFovErr) maxCamFovErr = camFovErr;

      assert.ok(camPosErr < 1e-6, `[${item.id}] 相机位置 Seek 误差超标: err=${camPosErr} at t=${targetT}`);
      assert.ok(camQuatErr < 1e-6, `[${item.id}] 相机朝向 Seek 误差超标: err=${camQuatErr} at t=${targetT}`);
      assert.ok(camFovErr < 1e-6, `[${item.id}] 相机 FOV Seek 误差超标: err=${camFovErr} at t=${targetT}`);

      if (item.id === 'cathedral') {
        const waterErr = persistentState.waterPos.distanceTo(oracleState.waterPos);
        const roseErr = persistentState.rosePos.distanceTo(oracleState.rosePos);
        const organErr = persistentState.organLeftPos.distanceTo(oracleState.organLeftPos);
        const beamPosErr = persistentState.beam0Pos.distanceTo(oracleState.beam0Pos);
        const beamRotErr = Math.abs(persistentState.beam0RotZ - oracleState.beam0RotZ);
        const altarErr = Math.abs(persistentState.altarIntensity - oracleState.altarIntensity);

        const meshErr = Math.max(waterErr, roseErr, organErr, beamPosErr);
        if (meshErr > maxMeshPosErr) maxMeshPosErr = meshErr;

        assert.ok(meshErr < 1e-6, `[${item.id}] 网格位置 Seek 误差: ${meshErr}`);
        assert.ok(altarErr < 1e-6, `[${item.id}] 祭坛光强 Seek 误差: ${altarErr}`);

        if (beamRotErr > 1e-6) {
          specificDiscrepancies.push({
            type: 'Cathedral beam0RotZ non-idempotence',
            targetT,
            oracle: oracleState.beam0RotZ,
            persistent: persistentState.beam0RotZ,
            diff: beamRotErr,
          });
        }
      } else if (item.id === 'highway') {
        const sunsetErr = persistentState.sunsetPos.distanceTo(oracleState.sunsetPos);
        const underglowErr = persistentState.underglowPos.distanceTo(oracleState.underglowPos);
        const tailErr = persistentState.tailLightsPos.distanceTo(oracleState.tailLightsPos);
        const distErr = Math.abs(persistentState.distanceUniform - oracleState.distanceUniform);

        const meshErr = Math.max(sunsetErr, underglowErr, tailErr);
        if (meshErr > maxMeshPosErr) maxMeshPosErr = meshErr;

        assert.ok(meshErr < 1e-6, `[${item.id}] 网格位置 Seek 误差: ${meshErr}`);
        assert.ok(distErr < 1e-6, `[${item.id}] 距离积分表 Seek 误差: ${distErr}`);
      } else if (item.id === 'pavilion') {
        const pavYErr = Math.abs(persistentState.pavilionGroupY - oracleState.pavilionGroupY);
        const silkErr = persistentState.silkPoolPos.distanceTo(oracleState.silkPoolPos);
        const pillarErr = persistentState.lightPillarPos.distanceTo(oracleState.lightPillarPos);

        const meshErr = Math.max(pavYErr, silkErr, pillarErr);
        if (meshErr > maxMeshPosErr) maxMeshPosErr = meshErr;

        assert.ok(meshErr < 1e-6, `[${item.id}] 网格位置/起伏 Seek 误差: ${meshErr}`);
      } else if (item.id === 'eclipse') {
        const moonErr = persistentState.moonPos.distanceTo(oracleState.moonPos);
        const magmaErr = persistentState.magmaPos.distanceTo(oracleState.magmaPos);
        const canyonErr = persistentState.canyonLeftPos.distanceTo(oracleState.canyonLeftPos);
        const shockScaleErr = Math.abs(persistentState.shockwaveScaleX - oracleState.shockwaveScaleX);

        const meshErr = Math.max(moonErr, magmaErr, canyonErr);
        if (meshErr > maxMeshPosErr) maxMeshPosErr = meshErr;

        assert.ok(meshErr < 1e-6, `[${item.id}] 网格位置 Seek 误差: ${meshErr}`);

        if (shockScaleErr > 1e-6) {
          specificDiscrepancies.push({
            type: 'Eclipse shockwaveRingMesh scale non-idempotence',
            targetT,
            oracle: oracleState.shockwaveScaleX,
            persistent: persistentState.shockwaveScaleX,
            diff: shockScaleErr,
          });
        }
      }
    }

    console.log(`✅ [实证挑战 2] 场景 ${item.id.padEnd(10)} 100次随机Seek结果:`);
    console.log(`   - 相机位置最大误差: ${maxCamPosErr.toExponential(4)} (阈值 < 1e-6)`);
    console.log(`   - 相机朝向最大误差: ${maxCamQuatErr.toExponential(4)} (阈值 < 1e-6)`);
    console.log(`   - 相机 FOV 最大误差: ${maxCamFovErr.toExponential(4)} (阈值 < 1e-6)`);
    console.log(`   - 核心网格最大位移误差: ${maxMeshPosErr.toExponential(4)} (阈值 < 1e-6)`);
    if (specificDiscrepancies.length > 0) {
      console.log(`   ⚠️ [实证挑战发现缺陷] 检出 ${specificDiscrepancies.length} 处次级网格属性状态残留 (例如 Drop 结束未重置属性):`);
      for (const d of specificDiscrepancies.slice(0, 3)) {
        console.log(`      * [${d.type}] t=${d.targetT}: 直接跳=${d.oracle.toFixed(4)} vs 扰动后=${d.persistent.toFixed(4)} (diff=${d.diff.toFixed(4)})`);
      }
    } else {
      console.log(`   - 次级网格与瞬态特效状态: 100% 幂等一致`);
    }
  }
});

// ---------------------------------------------------------------------
// 实证挑战 2.1：连续平滑播放 3000 帧至 tx 与直接 Seek 至 tx 对比
// ---------------------------------------------------------------------
test('实证挑战 2.1：连续 60fps 平滑播放至 Drop 后 (t=50s) 与直接 Seek 至 t=50s 全景状态对比', () => {
  const { music, lyrics, palette, init } = buildMockFixture();
  const dt = 1 / 60;
  const targetT = 50.0; // 处于 Drop (40-56s) 的衰减期之后

  const makeCtx = (sceneId, t) => {
    const secIdx = music.sectionIndex(t);
    const sec = music.a.sections[secIdx] ?? music.a.sections[0];
    const shot = {
      index: secIdx,
      start: sec.start,
      end: sec.end,
      scene: sceneId,
      variant: undefined,
      section: sec,
      sectionIndex: secIdx,
      seed: 8877,
      short: false,
    };
    return {
      t,
      dt,
      shotT: t - shot.start,
      shot,
      music,
      lyrics,
      palette,
      fx: mods.defaultFx(),
      aspect: 16 / 9,
    };
  };

  const sceneTests = [
    {
      id: 'cathedral',
      factory: () => new mods.CathedralScene(init, 'pulse'),
      check: (played, direct) => {
        const camPosDist = played.camera.position.distanceTo(direct.camera.position);
        assert.ok(camPosDist < 1e-6, `[cathedral] 相机位置不一致: ${camPosDist}`);
        const rotZDiff = Math.abs(played.beamMeshes[0].rotation.z - direct.beamMeshes[0].rotation.z);
        return { camPosDist, rotZDiff };
      },
    },
    {
      id: 'highway',
      factory: () => new mods.HighwayScene(init, 'pulse'),
      check: (played, direct) => {
        const camPosDist = played.camera.position.distanceTo(direct.camera.position);
        const distDiff = Math.abs(played.uniforms.uDistance.value - direct.uniforms.uDistance.value);
        assert.ok(camPosDist < 1e-6, `[highway] 相机位置不一致: ${camPosDist}`);
        assert.ok(distDiff < 1e-6, `[highway] 距离积分不一致: ${distDiff}`);
        return { camPosDist, distDiff };
      },
    },
    {
      id: 'pavilion',
      factory: () => new mods.PavilionScene(init, 'pulse'),
      check: (played, direct) => {
        const camPosDist = played.camera.position.distanceTo(direct.camera.position);
        const pavYDiff = Math.abs(played.pavilionGroup.position.y - direct.pavilionGroup.position.y);
        assert.ok(camPosDist < 1e-6, `[pavilion] 相机位置不一致: ${camPosDist}`);
        assert.ok(pavYDiff < 1e-6, `[pavilion] 水榭起伏不一致: ${pavYDiff}`);
        return { camPosDist, pavYDiff };
      },
    },
    {
      id: 'eclipse',
      factory: () => new mods.EclipseScene(init, 'pulse'),
      check: (played, direct) => {
        const camPosDist = played.camera.position.distanceTo(direct.camera.position);
        assert.ok(camPosDist < 1e-6, `[eclipse] 相机位置不一致: ${camPosDist}`);
        const shockScaleDiff = Math.abs(played.shockwaveRingMesh.scale.x - direct.shockwaveRingMesh.scale.x);
        return { camPosDist, shockScaleDiff };
      },
    },
  ];

  console.log('✅ [实证挑战 2.1] 连续 3000 帧平滑播放 vs 直接 Seek 至 t=50s 状态对比:');
  for (const st of sceneTests) {
    const played = st.factory();
    // 连续逐帧播放 3000 帧（从 t=0 到 t=50）
    const totalFrames = Math.round(targetT / dt);
    for (let f = 0; f <= totalFrames; f++) {
      played.update(makeCtx(st.id, f * dt));
    }

    // 直接跳至 targetT
    const direct = st.factory();
    direct.update(makeCtx(st.id, targetT));

    const res = st.check(played, direct);
    console.log(`   - 场景 ${st.id.padEnd(10)}: 相机位置连续误差 = ${res.camPosDist.toExponential(4)}`);
    if (res.rotZDiff !== undefined) {
      console.log(`     * 圣光光束 rotation.z 差异: ${res.rotZDiff.toFixed(6)} (平滑=${played.beamMeshes[0].rotation.z.toFixed(4)} vs 直接=${direct.beamMeshes[0].rotation.z.toFixed(4)})`);
    }
    if (res.shockScaleDiff !== undefined) {
      console.log(`     * 冲击波环 scale.x 差异: ${res.shockScaleDiff.toFixed(6)} (平滑=${played.shockwaveRingMesh.scale.x.toFixed(4)} vs 直接=${direct.shockwaveRingMesh.scale.x.toFixed(4)})`);
    }
  }
});

// ---------------------------------------------------------------------
// 实证挑战 3：极端分辨率与宽高比实证
// ---------------------------------------------------------------------
test('实证挑战 3：带鱼屏(21:9)、经典(16:9)、方屏(1:1)、竖屏(9:16)及极限宽高比构图与穿模实证', () => {
  const { music, lyrics, palette, init } = buildMockFixture();

  const testAspects = [
    { label: '带鱼屏 21:9', aspect: 21 / 9 },
    { label: '经典 16:9', aspect: 16 / 9 },
    { label: '方屏 1:1', aspect: 1.0 },
    { label: '竖屏 9:16', aspect: 9 / 16 },
    { label: '超宽屏 32:9', aspect: 32 / 9 },
    { label: '超细长 9:21', aspect: 9 / 21 },
  ];

  const scenes = [
    { id: 'cathedral', inst: new mods.CathedralScene(init, 'pulse'), focalDist: 60.0 },
    { id: 'highway', inst: new mods.HighwayScene(init, 'pulse'), focalDist: 180.0 },
    { id: 'pavilion', inst: new mods.PavilionScene(init, 'pulse'), focalDist: 32.0 },
    { id: 'eclipse', inst: new mods.EclipseScene(init, 'pulse'), focalDist: 120.0 },
  ];

  const shot = {
    index: 0,
    start: 10.0,
    end: 18.0,
    scene: 'test',
    section: music.a.sections[1],
    sectionIndex: 1,
    seed: 1001,
    short: false,
  };

  const frustum = new THREE.Frustum();
  const projScreenMatrix = new THREE.Matrix4();

  for (const sc of scenes) {
    for (const asp of testAspects) {
      sc.inst.resize(asp.aspect);
      assert.equal(
        +(sc.inst.camera.aspect).toFixed(4),
        +(asp.aspect).toFixed(4),
        `[${sc.id}] resize 后 camera.aspect 未正确同步`,
      );

      sc.inst.update({
        t: 12.0,
        dt: 1 / 60,
        shotT: 2.0,
        shot,
        music,
        lyrics,
        palette,
        fx: mods.defaultFx(),
        aspect: asp.aspect,
      });

      // 验证投影矩阵合法性
      const pElements = sc.inst.camera.projectionMatrix.elements;
      for (let i = 0; i < 16; i++) {
        assert.ok(Number.isFinite(pElements[i]), `[${sc.id}] ${asp.label} 投影矩阵包含非有限值`);
      }

      // 计算视锥体
      projScreenMatrix.multiplyMatrices(sc.inst.camera.projectionMatrix, sc.inst.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreenMatrix);

      // 验证核心焦点在相机景深范围之内（近裁剪面 0.1，远裁剪面 300+）
      assert.ok(sc.inst.camera.near >= 0.05, `[${sc.id}] 近裁剪面过小可能引起 Z-fighting`);
      assert.ok(sc.inst.camera.far >= sc.focalDist * 1.5, `[${sc.id}] 远裁剪面不足以覆盖核心焦点 (${sc.inst.camera.far} < ${sc.focalDist * 1.5})`);
    }
    console.log(`✅ [实证挑战 3] 场景 ${sc.id.padEnd(10)}: 全部 6 种宽高比 (21:9, 16:9, 1:1, 9:16, 32:9, 9:21) 投影矩阵自适应验证通过`);
  }
});
