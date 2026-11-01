import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ANALYSIS_VERSION } from '../src/analysis/index.ts';
import {
  deserializeAnalysis,
  lyricFingerprint,
  readAnalysisCache,
  serializeAnalysis,
  writeAnalysisCache,
  type AnalysisCacheMeta,
} from '../src/plugin/analysis-cache.ts';
import { LyricTrack } from '../src/director/lyrics.ts';
import { Music } from '../src/director/music.ts';
import type { Palette } from '../src/render/palette.ts';
import { armillarySpec } from '../src/sigil/armillary.ts';
import type { Analysis, LyricLine } from '../src/types.ts';
import type { MvScene, SceneInit } from '../src/scenes/types.ts';
import { PhoenixScene } from '../src/scenes/phoenix.ts';
import { City } from '../src/scenes/city.ts';
import { SunsetScene } from '../src/scenes/sunset.ts';
import { VelvetScene } from '../src/scenes/velvet.ts';
import { Menger } from '../src/scenes/menger.ts';
import { Sierpinski } from '../src/scenes/sierpinski.ts';
import { Cantor } from '../src/scenes/cantor.ts';
import { Ripple } from '../src/scenes/ripple.ts';
import { Channel } from '../src/scenes/channel.ts';
import { Orb } from '../src/scenes/orb.ts';
import { Pillars } from '../src/scenes/pillars.ts';
import { CanvasScene } from '../src/scenes/canvas.ts';

function makeSampleAnalysis(): Analysis {
  const n = 24;
  const f32 = (seed: number) => Float32Array.from({ length: n }, (_, i) => Math.fround(Math.sin(i * 0.37 + seed) * 0.5 + 0.5));
  return {
    version: ANALYSIS_VERSION,
    duration: 215.42,
    bpm: 128,
    namedBpm: 128,
    meter: 4,
    beats: [0, 0.46875, 0.9375, 1.40625, 1.875],
    beatInBar: [0, 1, 2, 3, 0],
    tempo: [128, 128, 128, 128, 128],
    downbeats: [0, 1.875],
    sections: [
      { start: 0, end: 30, label: 'intro', energy: 0.25, group: 0, vocal: false },
      { start: 30, end: 120, label: 'verse', energy: 0.55, group: 1, vocal: true },
      { start: 120, end: 215.42, label: 'chorus', energy: 0.95, group: 2, vocal: true },
    ],
    env: {
      fps: 100,
      rms: f32(1),
      low: f32(2),
      mid: f32(3),
      high: f32(4),
      onset: f32(5),
      chroma: Float32Array.from({ length: 12 * 4 }, (_, i) => Math.fround((i % 12) / 12)),
      lead: f32(6),
      leadAttack: f32(7),
      leadBrightness: f32(8),
    },
    timbre: {
      fps: 60,
      bands: 64,
      hz: Float32Array.from({ length: 64 }, (_, i) => Math.fround(30 * Math.pow(300, i / 63))),
      spectrum: Float32Array.from({ length: 64 * 4 }, (_, i) => Math.fround((i % 17) / 17)),
      synthStab: f32(9),
      bassStab: f32(10),
      lead: f32(11),
      leadAttack: f32(12),
      melodyAttack: f32(13),
      leadBrightness: f32(14),
      leadPresence: f32(15),
      confidence: f32(16),
      brightness: f32(17),
    },
    hits: {
      kick: [[0, 0.9], [0.9375, 0.85]],
      snare: [[0.46875, 0.8]],
      hat: [[0.234375, 0.4]],
      accent: [[120, 1.0]],
      keys: [[30.5, 0.72]],
    },
  };
}

function makeSampleLines(): LyricLine[] {
  return [
    {
      start: 30.0,
      end: 34.5,
      text: '穿过霓虹与暮色',
      timedWords: true,
      words: [
        { text: '穿过', start: 30.0, end: 31.1 },
        { text: '霓虹', start: 31.1, end: 32.4 },
        { text: '与暮色', start: 32.4, end: 34.5 },
      ],
    },
  ];
}

function assertFloat32BitExact(a: Float32Array | undefined, b: Float32Array | undefined, label: string): void {
  assert.equal(Boolean(a), Boolean(b), `${label} 存在性不一致`);
  if (!a || !b) return;
  assert.ok(b instanceof Float32Array, `${label} 反序列化后必须是 Float32Array`);
  assert.equal(a.length, b.length, `${label} 长度不一致`);
  for (let i = 0; i < a.length; i++) {
    assert.ok(Object.is(a[i], b[i]), `${label}[${i}] 精度不一致: ${a[i]} !== ${b[i]}`);
  }
}

test('Analysis 序列化与反序列化保持 IEEE-754 Float32 逐比特无损，并在元信息失配时严格失效', () => {
  const analysis = makeSampleAnalysis();
  const lines = makeSampleLines();
  const meta: AnalysisCacheMeta = {
    audioBytes: 8_388_608,
    duration: analysis.duration,
    lyricFingerprint: lyricFingerprint(lines),
    wikiBpm: 128,
    chorus: [120, 165],
  };

  const raw = serializeAnalysis(analysis, meta);
  const restored = deserializeAnalysis(raw, meta);
  assert.ok(restored, '元信息完全匹配时应成功还原 Analysis');
  assert.equal(restored.version, ANALYSIS_VERSION);
  assert.equal(restored.bpm, 128);
  assert.deepEqual(restored.sections, analysis.sections);
  assert.deepEqual(restored.hits, analysis.hits);

  for (const key of ['rms', 'low', 'mid', 'high', 'onset', 'chroma', 'lead', 'leadAttack', 'leadBrightness'] as const) {
    assertFloat32BitExact(analysis.env[key], restored.env[key], `env.${key}`);
  }
  assert.ok(restored.timbre, '嵌套 timbre 应完整还原');
  for (const key of ['hz', 'spectrum', 'synthStab', 'bassStab', 'lead', 'leadAttack', 'melodyAttack', 'leadBrightness', 'leadPresence', 'confidence', 'brightness'] as const) {
    assertFloat32BitExact(analysis.timbre![key], restored.timbre![key], `timbre.${key}`);
  }

  // 任意一项缓存键变化都必须拒绝命中
  assert.equal(deserializeAnalysis(raw, { ...meta, audioBytes: meta.audioBytes + 1 }), null);
  assert.equal(deserializeAnalysis(raw, { ...meta, duration: meta.duration + 0.5 }), null);
  assert.equal(deserializeAnalysis(raw, { ...meta, wikiBpm: 64 }), null);
  assert.equal(deserializeAnalysis(raw, { ...meta, chorus: [121, 165] }), null);

  const editedLines = structuredClone(lines);
  editedLines[0].words[1].start += 0.05;
  assert.notEqual(lyricFingerprint(editedLines), meta.lyricFingerprint);
  assert.equal(deserializeAnalysis(raw, { ...meta, lyricFingerprint: lyricFingerprint(editedLines) }), null);
});

test('磁盘缓存读写端到端命中并在超出容量上限时按 LRU 自动清理旧条目', async () => {
  const files = new Map<string, string>();
  const removed: string[] = [];
  const prevBetterNcm = (globalThis as Record<string, unknown>).betterncm;
  (globalThis as Record<string, unknown>).betterncm = {
    app: { getDataPath: async () => 'C:/BetterNCM' },
    fs: {
      exists: async (p: string) => files.has(p) || p.endsWith('/BetterMV') || p.endsWith('/analysis-cache'),
      mkdir: async () => true,
      readFileText: async (p: string) => {
        const v = files.get(p);
        if (v === undefined) throw new Error(`missing: ${p}`);
        return v;
      },
      writeFileText: async (p: string, content: string) => {
        files.set(p, content);
        return true;
      },
      remove: async (p: string) => {
        files.delete(p);
        removed.push(p);
        return true;
      },
    },
  };

  try {
    const analysis = makeSampleAnalysis();
    const meta: AnalysisCacheMeta = {
      audioBytes: 1024,
      duration: analysis.duration,
      lyricFingerprint: 'deadbeef01234567',
    };
    for (let id = 1; id <= 82; id++) {
      await writeAnalysisCache(id, meta, analysis);
    }
    // 最早写入的 1、2 号应被淘汰删除，最新的 82 号应命中
    assert.ok(removed.some(p => p.endsWith('/1.json')), '超出 80 条上限后应淘汰最旧的 1.json');
    assert.ok(removed.some(p => p.endsWith('/2.json')), '超出 80 条上限后应淘汰最旧的 2.json');
    assert.equal(await readAnalysisCache(1, meta), null);
    const hit = await readAnalysisCache(82, meta);
    assert.ok(hit && hit.bpm === 128);
  } finally {
    if (prevBetterNcm === undefined) delete (globalThis as Record<string, unknown>).betterncm;
    else (globalThis as Record<string, unknown>).betterncm = prevBetterNcm;
  }
});

function makePalette(kind: 'cool' | 'warm'): Palette {
  if (kind === 'cool') {
    return {
      ink: new THREE.Color(0x050814),
      paper: new THREE.Color(0xf2f6ff),
      signal: new THREE.Color(0x00e5ff),
      accent: new THREE.Color(0xff2a85),
      light: false,
      backdrop: new THREE.Color(0x050814),
      graphic: false,
      complexity: 0.42,
      mono: false,
      css: { ink: '#050814', paper: '#f2f6ff', signal: '#00e5ff', accent: '#ff2a85' },
    };
  }
  return {
    ink: new THREE.Color(0x1b0d06),
    paper: new THREE.Color(0xfff5e4),
    signal: new THREE.Color(0xff8c1a),
    accent: new THREE.Color(0x2cd483),
    light: true,
    backdrop: new THREE.Color(0xe8d5b7),
    graphic: true,
    complexity: 0.12,
    mono: false,
    css: { ink: '#1b0d06', paper: '#fff5e4', signal: '#ff8c1a', accent: '#2cd483' },
  };
}

function makeSceneInit(palette: Palette, brightnessBias: number): SceneInit {
  const coverSize = 16;
  const coverPixels = new Uint8ClampedArray(coverSize * coverSize * 4);
  for (let i = 0; i < coverSize * coverSize; i++) {
    const v = Math.max(0, Math.min(255, Math.round(brightnessBias + (i % 16) * 8)));
    coverPixels[i * 4] = v;
    coverPixels[i * 4 + 1] = Math.min(255, v + 20);
    coverPixels[i * 4 + 2] = Math.max(0, v - 15);
    coverPixels[i * 4 + 3] = 255;
  }
  const analysis = makeSampleAnalysis();
  return {
    cover: new THREE.Texture(),
    coverPixels,
    coverSize,
    palette,
    music: new Music(analysis),
    lyrics: new LyricTrack(makeSampleLines()),
    aspect: 16 / 9,
    title: 'Test Song',
    artists: ['Artist'],
    seed: 12345,
    armillary: armillarySpec(analysis, 10001),
  };
}

function collectShaderSources(plate: { scene: THREE.Scene; offscreen?: readonly THREE.Object3D[] }): Array<{ vert: string; frag: string }> {
  const list: Array<{ vert: string; frag: string }> = [];
  for (const root of [plate.scene, ...(plate.offscreen ?? [])]) {
    root.traverse(obj => {
      const raw = (obj as THREE.Mesh).material;
      const mats = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const m of mats) {
        if (m instanceof THREE.ShaderMaterial) {
          list.push({ vert: m.vertexShader, frag: m.fragmentShader });
        }
      }
    });
  }
  return list;
}

test('所有自定义着色器跨不同歌曲调色板与封面亮度保持 100% 静态源码一致，且重型场景具备防展开保护', () => {
  const prevDoc = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      width: 64,
      height: 64,
      getContext: () => ({
        font: '',
        textBaseline: 'top',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        measureText: (t: string) => ({ width: t.length * 16 }),
        fillText: () => {},
        fillRect: () => {},
        clearRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
        moveTo: () => {},
        lineTo: () => {},
        quadraticCurveTo: () => {},
        bezierCurveTo: () => {},
        closePath: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => {},
      }),
    }),
  };

  try {
    const initCool = makeSceneInit(makePalette('cool'), 20);
    const initWarm = makeSceneInit(makePalette('warm'), 140);

    const factories: Array<[string, (i: SceneInit) => MvScene]> = [
      ['phoenix', (i: SceneInit) => new PhoenixScene(i)],
      ['city', (i: SceneInit) => new City(i)],
      ['sunset', (i: SceneInit) => new SunsetScene(i)],
      ['velvet', (i: SceneInit) => new VelvetScene(i)],
      ['menger', (i: SceneInit) => new Menger(i)],
      ['sierpinski', (i: SceneInit) => new Sierpinski(i)],
      ['cantor', (i: SceneInit) => new Cantor(i)],
      ['ripple', (i: SceneInit) => new Ripple(i)],
      ['channel', (i: SceneInit) => new Channel(i)],
      ['orb', (i: SceneInit) => new Orb(i)],
      ['pillars', (i: SceneInit) => new Pillars(i)],
      ['canvas', (i: SceneInit) => new CanvasScene(i)],
    ];

    const fragByScene = new Map<string, string>();

    for (const [name, create] of factories) {
      const a = create(initCool);
      const b = create(initWarm);
      const sa = collectShaderSources(a);
      const sb = collectShaderSources(b);
      assert.ok(sa.length > 0, `${name} 应至少包含 1 个 ShaderMaterial`);
      assert.equal(sa.length, sb.length, `${name} 的 ShaderMaterial 数量不一致`);
      for (let i = 0; i < sa.length; i++) {
        assert.equal(sa[i].vert, sb[i].vert, `${name}[${i}] 顶点着色器源码不应随歌曲调色板变化`);
        assert.equal(sa[i].frag, sb[i].frag, `${name}[${i}] 片元着色器源码不应随歌曲调色板变化`);
      }
      fragByScene.set(name, sa.map(s => s.frag).join('\n'));
    }

    for (const heavy of ['phoenix', 'city', 'sunset', 'velvet', 'menger']) {
      const frag = fragByScene.get(heavy)!;
      assert.ok(frag.includes('uniform int uZero;'), `${heavy} 片元着色器必须包含 uniform int uZero 防静态展开声明`);
    }

    // 验证 sunset / velvet / phoenix 的巨型子函数不再发生多重调用点内联膨胀
    const sunsetFrag = fragByScene.get('sunset')!;
    assert.equal((sunsetFrag.match(/renderSunsetSky\s*\(/g) ?? []).length, 2, 'sunsetFrag 中 renderSunsetSky 应仅有 1 处定义 + 1 处调用');

    const velvetFrag = fragByScene.get('velvet')!;
    assert.equal((velvetFrag.match(/renderLoungeUpper\s*\(/g) ?? []).length, 2, 'velvetFrag 中 renderLoungeUpper 应仅有 1 处定义 + 1 处调用');

    const phoenixFrag = fragByScene.get('phoenix')!;
    const phxTest = new PhoenixScene(initCool);
    assert.equal(collectShaderSources(phxTest).length, 4, 'PhoenixScene 应拆分为地面、上半舞台、舞台烟雾与火凤叠加 4 个轻量 ShaderMaterial');
    const phxOrders: number[] = [];
    phxTest.scene.traverse(o => {
      if ((o as THREE.Mesh).isMesh) phxOrders.push(o.renderOrder);
    });
    assert.deepEqual(phxOrders, [-10, -9, -8.5, -8], 'PhoenixScene 4 层网格必须按从底到顶的 renderOrder 严格排列');
    assert.equal((phoenixFrag.match(/evalMeditatorSdf\s*\(/g) ?? []).length, 2, 'phoenixFrag 中 evalMeditatorSdf 应仅有 1 处定义 + 1 处循环内调用');
    assert.equal((phoenixFrag.match(/evaluateGiantSpeaker\s*\(/g) ?? []).length, 2, 'phoenixFrag 中 evaluateGiantSpeaker 应仅有 1 处定义 + 1 处循环内调用');
    assert.equal((phoenixFrag.match(/evaluatePhoenixAndFire\s*\(/g) ?? []).length, 2, 'phoenixFrag 中 evaluatePhoenixAndFire 应仅有 1 处定义 + 1 处调用');

    const cityFrag = fragByScene.get('city')!;
    assert.ok((cityFrag.match(/lightRow\s*\(/g) ?? []).length <= 4, 'cityFrag 中 lightRow 应收敛至 <= 4 处（1 处定义 + 3 处动态循环调用点）');
  } finally {
    if (prevDoc === undefined) delete (globalThis as Record<string, unknown>).document;
    else (globalThis as Record<string, unknown>).document = prevDoc;
  }
});

test('textTexture 共享文字纹理按 LRU 复用与裁剪，并标记 userData.sharedText 防止切歌误删', async () => {
  const prevDoc = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        font: '',
        textBaseline: 'top',
        fillStyle: '',
        measureText: (t: string) => ({ width: t.length * 16 }),
        fillText: () => {},
      }),
    }),
  };

  try {
    const { textTexture, trimTextCache, disposeText } = await import('../src/render/text.ts');
    disposeText();
    const t1 = textTexture('第一句', 'bold', 32);
    const t2 = textTexture('第二句', 'bold', 32);
    const t3 = textTexture('第三句', 'bold', 32);
    assert.equal(t1.texture.userData.sharedText, true);

    // 再次访问 t1，使其跃升为最新使用项；随后裁剪至 2 项时，最旧的 t2 应被淘汰，t1 与 t3 保留复用
    const t1Again = textTexture('第一句', 'bold', 32);
    assert.equal(t1Again.texture, t1.texture);

    trimTextCache(2);
    assert.equal(textTexture('第一句', 'bold', 32).texture, t1.texture, '最近访问的 t1 应保留在缓存中');
    assert.equal(textTexture('第三句', 'bold', 32).texture, t3.texture, '较新的 t3 应保留在缓存中');
    assert.notEqual(textTexture('第二句', 'bold', 32).texture, t2.texture, '最久未访问的 t2 应已被淘汰重建');
    disposeText();
  } finally {
    if (prevDoc === undefined) delete (globalThis as Record<string, unknown>).document;
    else (globalThis as Record<string, unknown>).document = prevDoc;
  }
});
