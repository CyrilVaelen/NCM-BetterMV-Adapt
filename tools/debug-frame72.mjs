import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { loadSettings, startServer } from '../exporter/server.mjs';

const audioPath = 'D:/野葱视频转换器/音频转换/ILLENIUM,MAX - Beautiful Creatures.mp3';
const lrcPath = 'D:/CloudMusic/VipSongsDownload/ILLENIUM,MAX - Beautiful Creatures.lrc';
const awakeCoverPath = 'D:/NCM/state/phoenix-lead-color-20261023/baseline/awake-cover.jpg';

const [audioBuf, lrcText, awakeCoverBuf] = await Promise.all([
  fs.readFile(audioPath),
  fs.readFile(lrcPath, 'utf8'),
  fs.readFile(awakeCoverPath),
]);

const settings = await loadSettings();
const app = await startServer({
  settings: {
    ...settings,
    port: 5277,
    jobDir: 'D:/NCM/state/debug-72/jobs',
    outputDir: 'D:/NCM/state/debug-72',
  },
});

let browser;
try {
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: [
      '--use-angle=d3d11',
      '--disable-gpu-watchdog',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  });

  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== app.baseUrl) return r.abort();
    if (u.pathname === '/bc-audio') return r.fulfill({ body: audioBuf, contentType: 'audio/mpeg' });
    if (u.pathname === '/awake-cover') return r.fulfill({ body: awakeCoverBuf, contentType: 'image/jpeg' });
    return r.continue();
  });

  const page = await context.newPage();
  page.on('console', m => console.log('PAGE LOG:', m.type(), m.text()));
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  await page.goto(app.baseUrl + '/tools/lead-preview.html');

  await page.evaluate(async ({ lrc }) => {
    const [{ prepareSong, styleFor, yieldToPage }, { MvPlayer }, { loadFonts }] = await Promise.all([
      import('/src/app/prepare.ts'),
      import('/src/app/player.ts'),
      import('/src/render/text.ts'),
    ]);

    const img = new Image();
    img.src = '/awake-cover';
    await img.decode();

    const [audio] = await Promise.all([
      fetch('/bc-audio').then(r => r.arrayBuffer()),
      loadFonts('/fonts/'),
    ]);

    const song = await prepareSong({
      id: 20261021,
      name: 'Beautiful Creatures',
      artists: ['ILLENIUM', 'MAX'],
      audio: audio.slice(0),
      cover: img,
      lyric: { lrc: { lyric: lrc } },
    }, { pause: yieldToPage });

    const stage = document.createElement('div');
    stage.style.cssText = 'width:1920px;height:1080px;position:absolute;left:0;top:0';
    document.body.innerHTML = '';
    document.body.append(stage);

    const player = new MvPlayer(stage, 1);
    player.hud.visible = false;
    player.load(
      song,
      styleFor(song, 'pulse'),
      new Set(),
      { scene: 'phoenix', variants: ['stage'] },
      'none',
      0,
      20261021,
    );
    await player.warm(yieldToPage);

    const domCanvas = player.engine.renderer.domElement;
    domCanvas.addEventListener('webglcontextlost', (e) => {
      console.error('WEBGL CONTEXT LOST EVENT FIRED!', e);
    });

    window.TEST_RUN = {
      player,
      gl: player.engine.renderer.getContext(),
      render(t) {
        player.frame(t, 1 / 30);
        const err = this.gl.getError();
        const lost = this.gl.isContextLost();
        // Read active uniforms from scene if available
        const scene = player.scene;
        const mat = scene?.mesh?.material;
        return {
          err,
          lost,
          hasScene: !!scene,
          uniforms: mat?.uniforms ? {
            uTime: mat.uniforms.uTime?.value,
            uColorFusion: mat.uniforms.uColorFusion?.value,
            uLeadWeightB: mat.uniforms.uLeadWeightB?.value,
            uBass: mat.uniforms.uBass?.value,
            uEnergy: mat.uniforms.uEnergy?.value,
            uDropImpact: mat.uniforms.uDropImpact?.value,
            uSpeakerPulse: mat.uniforms.uSpeakerPulse?.value,
          } : null,
        };
      }
    };
  }, { lrc: lrcText });

  console.log('Setup finished, running frames 65 to 75...');
  for (let i = 65; i <= 75; i++) {
    const t = 90.0 + i / 30;
    const res = await page.evaluate(time => window.TEST_RUN.render(time), t);
    console.log(`Frame ${i} (t=${t.toFixed(3)}): err=${res.err}, lost=${res.lost}, uniforms:`, JSON.stringify(res.uniforms));
    if (res.lost) {
      console.error(`CONTEXT LOST OCCURRED AT FRAME ${i}!`);
      break;
    }
  }

} finally {
  await browser?.close();
  await app.close();
}
