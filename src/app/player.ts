// One renderer for the whole session; per song it builds the scenes the song's style needs and a director.
import * as THREE from 'three';
import { Engine, defaultFx } from '../render/engine.ts';
import { disposeText, trimTextCache } from '../render/text.ts';
import { Music } from '../director/music.ts';
import { LyricTrack } from '../director/lyrics.ts';
import { Director, planLooks, planShots, type LookId } from '../director/director.ts';
import { Relief } from '../scenes/relief.ts';
import { Shatter } from '../scenes/shatter.ts';
import { Diorama } from '../scenes/diorama.ts';
import { Bokeh } from '../scenes/bokeh.ts';
import { Tunnel } from '../scenes/tunnel.ts';
import { VOICES, voiceFor } from '../scenes/lyricBlock.ts';
import { Drive } from '../scenes/drive.ts';
import { Kaleido } from '../scenes/kaleido.ts';
import { Flip } from '../scenes/flip.ts';
import { Rings } from '../scenes/rings.ts';
import { Poster } from '../scenes/poster.ts';
import { Ridges } from '../scenes/ridges.ts';
import { Halftone } from '../scenes/halftone.ts';
import { Particles } from '../scenes/particles.ts';
import { TypeWall } from '../scenes/typewall.ts';
import { Ink } from '../scenes/ink.ts';
import { ArmillaryScene } from '../scenes/armillary.ts';
import { CardsScene } from '../scenes/cards.ts';
import { DebugScene } from '../scenes/debug.ts';
import { SubdivideScene } from '../scenes/subdivide.ts';
import { AlignScene } from '../scenes/align.ts';
import { ScopeScene } from '../scenes/scope.ts';
import { Vinyl } from '../scenes/vinyl.ts';
import { Clouds } from '../scenes/clouds.ts';
import { City } from '../scenes/city.ts';
import { Aurora } from '../scenes/aurora.ts';
import { CanvasScene } from '../scenes/canvas.ts';
import { Pillars } from '../scenes/pillars.ts';
import { Ripple } from '../scenes/ripple.ts';
import { Channel } from '../scenes/channel.ts';
import { Orb } from '../scenes/orb.ts';
import { Menger } from '../scenes/menger.ts';
import { Sierpinski } from '../scenes/sierpinski.ts';
import { Cantor } from '../scenes/cantor.ts';
import { PaperCut } from '../scenes/papercut.ts';
import { RainScene } from '../scenes/rain.ts';
import { LanternScene } from '../scenes/lanterns.ts';
import { NeonScene } from '../scenes/neon.ts';
import { UnderwaterScene } from '../scenes/underwater.ts';
import { SunsetScene } from '../scenes/sunset.ts';
import { PhoenixScene } from '../scenes/phoenix.ts';
import { VelvetScene } from '../scenes/velvet.ts';
import { FractalPlate } from '../scenes/fractal.ts';
import { armillarySpec } from '../sigil/armillary.ts';
import type { MvScene, SceneId, SceneInit, Shot } from '../scenes/types.ts';
import type { Style, VibePresetId } from '../style/style.ts';
import type { PreparedSong } from './prepare.ts';
import { Hud } from './hud.ts';

function disposeScene(root: THREE.Object3D, keep: THREE.Texture): void {
  const textures = new Set<THREE.Texture>();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of materials) {
      for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) textures.add(v);
      const uniforms = (m as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) if (u.value instanceof THREE.Texture) textures.add(u.value);
      m.dispose();
    }
  });
  for (const t of textures) if (t !== keep && !t.userData?.sharedText) t.dispose();
}

export interface WarmOptions {
  /** 当前播放起始时间（秒），用于优先编译与预热当前及即将出场的镜头场景。 */
  startTime?: number;
  /** 启用首镜秒开渐进预热：仅阻塞预热当前急需的 1~2 个场景即刻开播，其余场景在后台逐帧异步编译与预热。 */
  progressive?: boolean;
}

/**
 * Oscilloscope music: the whole MV is the scope in XY mode drawing the song's pictures, its framing changing at the
 * planned cuts but no more often than every 6 s (the speeding-up cuts of a build would only jolt the picture).
 */
function scopeOnly(shots: Shot[]): Shot[] {
  const out: Shot[] = [];
  for (const s of shots) {
    const last = out[out.length - 1];
    if (last && s.start - last.start < 6) { last.end = s.end; continue; }
    out.push({ ...s, run: undefined });
  }
  const framings = ['xy', 'xy-near', 'xy', 'xy-angle'];
  out.forEach((s, i) => { s.scene = 'scope'; s.variant = framings[i % framings.length]; });
  return out;
}

export class MvPlayer {
  readonly engine: Engine;
  readonly hud: Hud;
  private loadedScenes: Partial<Record<SceneId, MvScene>> = {};
  private sceneFactories: Partial<Record<SceneId, () => MvScene>> = {};
  private scenes: Partial<Record<SceneId, MvScene>> = {};
  private warmedScenes = new Set<SceneId>();
  private director: Director | null = null;
  private music: Music | null = null;
  song: PreparedSong | null = null;
  /** The lines as shown (moved by the song's lyric delay). */
  private lines: PreparedSong['lines'] = [];
  /** 是否在 MV 画面中显示歌词 */
  showLyrics = true;
  style: Style | null = null;
  /**
   * This play's seed: plates, cameras, cuts and looks are drawn from it, so a song plays differently each time (the
   * user: “还要随机性”). Reloading the same song for a settings change keeps it.
   */
  seed = 0;
  private seedFor = -1;
  /** 是否正处于异步着色器编译与离屏预热阶段（预热完成前禁止并发渲染） */
  warming = false;
  private warmToken = 0;
  /** 最近一次已知的歌曲播放时间（供后台渐进预热计算前瞻距离） */
  private lastPlayTime = 0;

  constructor(container: HTMLElement, pixelRatio?: number) {
    this.engine = new Engine(container, pixelRatio);
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.hud = new Hud(container);
    this.scenes = this.createScenesProxy();
  }

  private createScenesProxy(): Partial<Record<SceneId, MvScene>> {
    return new Proxy(this.loadedScenes, {
      get: (target, prop, receiver) => {
        if (typeof prop === 'string' && !(prop in target) && prop in this.sceneFactories) {
          return this.ensureScene(prop as SceneId);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  private ensureScene(id: SceneId): MvScene | undefined {
    const existing = this.loadedScenes[id];
    if (existing) return existing;
    const factory = this.sceneFactories[id];
    if (!factory) return undefined;
    const created = factory();
    this.loadedScenes[id] = created;
    this.applySceneViewport(id, created);
    return created;
  }

  private applySceneViewport(id: SceneId, s: MvScene): void {
    s.resize(this.engine.aspect);
    const canvas = this.engine.renderer.domElement;
    const pr = this.engine.renderer.getPixelRatio();
    if (id === 'bokeh') (s as Bokeh).setViewportHeight(canvas.height);
    else if (id === 'tunnel') (s as Tunnel).setViewport(canvas.width, canvas.height, pr);
    else if (id === 'drive') (s as Drive).setViewport(canvas.width, canvas.height, pr);
    else if (id === 'rings') (s as Rings).setViewport(canvas.width, canvas.height, pr);
    else if (id === 'ridges') (s as Ridges).setViewport(canvas.width, canvas.height, pr);
    else if (id === 'halftone') (s as Halftone).setViewport(canvas.width, canvas.height);
    else if (id === 'particles') (s as Particles).setViewportHeight(canvas.height);
    else if (id === 'ink') (s as Ink).setViewport(canvas.width, canvas.height);
    else if (id === 'crystal') (s as ArmillaryScene).setViewport(canvas.width, canvas.height, pr);
    else if (id === 'cards') (s as CardsScene).setViewport(canvas.width, canvas.height, pr);
    else if (id === 'debug') (s as DebugScene).setViewport(canvas.width, canvas.height);
    else if (id === 'align') (s as AlignScene).setViewport(canvas.width, canvas.height, pr);
    else if (id === 'scope') (s as ScopeScene).setViewport(canvas.width, canvas.height, pr);
    else if (id === 'orb') (s as Orb).setViewport(canvas.width, canvas.height, pr);
    else if (id === 'clouds') (s as Clouds).setViewport(canvas.width, canvas.height, pr);
    else if (id === 'city') (s as City).setViewport(canvas.width, canvas.height);
    if (s instanceof FractalPlate) s.setViewport(canvas.width, canvas.height, pr);
  }

  /** 当前已懒实例化的场景数量（供测试与性能剖析观测） */
  get instantiatedSceneCount(): number {
    return Object.keys(this.loadedScenes).length;
  }

  /** 当前已完成离屏预热的场景数量（供测试与性能剖析观测） */
  get warmedSceneCount(): number {
    return this.warmedScenes.size;
  }

  /** 动态切换是否在 MV 画面中显示歌词（即时生效，不中断正在播放的镜头） */
  setShowLyrics(show: boolean): void {
    if (this.showLyrics === show && this.director?.lyrics.hidden === !show) return;
    this.showLyrics = show;
    this.director?.setLyricsHidden(!show);
    if (this.song && this.director && this.director.looks.includes('ascii')) {
      this.engine.setLooks(
        this.song.palette,
        show ? this.song.lines.map(l => l.text + (l.translation ?? '')).join('') : '',
        true,
      );
    }
  }

  /**
   * `off`: plates and looks the user turned off in the settings. `only` (development): every shot on this plate,
   * cycling through the given camera setups; `forceLook` (development) puts every section but the drops in that look.
   * `lyricDelay`: seconds this song's words show later (negative: earlier), the user's per-song setting. `retake`
   * (development): rewrites the planned shots before the scenes are built (a film's own cuts, film/reel.ts).
   */
  load(song: PreparedSong, style: Style, off: ReadonlySet<SceneId | LookId> = new Set(), only?: { scene: SceneId; variants: string[] }, forceLook?: LookId | 'none', lyricDelay = 0, seed?: number, retake?: (shots: Shot[], music: Music) => Shot[], showLyrics = this.showLyrics, vibePreset: VibePresetId = 'auto'): void {
    if (this.seedFor !== song.id || seed !== undefined) {
      this.seed = seed ?? (Math.random() * 4294967296) >>> 0;
      this.seedFor = song.id;
    }
    this.unload();
    this.song = song;
    this.style = style;
    this.showLyrics = showLyrics;
    this.engine.setPalette(song.palette.ink, song.palette.signal);
    this.engine.setFinish(song.palette, style.finish);
    this.engine.setCover(song.cover);
    const music = this.music = new Music(song.analysis);
    this.hud.glyph = style.glyph;
    // (A copy moved by the delay: the song's own lines stay as parsed, for the next load.)
    const lines = lyricDelay ? song.lines.map(l => ({ ...l, start: l.start + lyricDelay, end: l.end + lyricDelay, words: l.words.map(w => ({ ...w, start: w.start + lyricDelay, end: w.end + lyricDelay })) })) : song.lines;
    this.lines = lines;
    const lyrics = new LyricTrack(lines);
    lyrics.hidden = !showLyrics;
    const init: SceneInit = {
      cover: song.cover, coverPixels: song.coverPixels, coverSize: song.coverSize, palette: song.palette,
      music, lyrics, aspect: this.engine.aspect, title: song.name, artists: song.artists, stereo: song.stereo, xyMusic: song.xyMusic, armillary: armillarySpec(song.analysis, song.id), seed: this.seed,
    };
    // Pure music, a song whose lyrics NetEase doesn't have, or hidden lyrics gets no word plates.
    let shots = planShots(music, style, this.seed, { graphic: song.palette.graphic, lyrics: showLyrics && song.lines.length > 0, wiki: song.wiki, vibePreset }, off);
    if (only) shots.forEach((sh, i) => { sh.scene = only.scene; sh.variant = only.variants[i % only.variants.length]; });
    else if (song.xyMusic) shots = scopeOnly(shots);
    if (retake) shots = retake(shots, music);
    const look = style.look;
    // The plates with a version of their own on rice paper (the 墨 style); the rest draw ink as they draw a ballad.
    const paper = style.id === 'ink' ? 'ink' : look;
    const make: Record<SceneId, () => MvScene> = {
      relief: () => new Relief(init), shatter: () => new Shatter(init), diorama: () => new Diorama(init), bokeh: () => new Bokeh(init),
      tunnel: () => new Tunnel(init, look), drive: () => new Drive(init), kaleido: () => new Kaleido(init, look), flip: () => new Flip(init, look),
      rings: () => new Rings(init, look), poster: () => new Poster(init, look), ridges: () => new Ridges(init, paper), halftone: () => new Halftone(init, look), particles: () => new Particles(init, look),
      typewall: () => new TypeWall(init), ink: () => new Ink(init, song.name), crystal: () => new ArmillaryScene(init), cards: () => new CardsScene(init), debug: () => new DebugScene(init), subdivide: () => new SubdivideScene(init, look), align: () => new AlignScene(init), scope: () => new ScopeScene(init),
      vinyl: () => new Vinyl(init, look), clouds: () => new Clouds(init, paper), city: () => new City(init, look), aurora: () => new Aurora(init, look),
      canvas: () => new CanvasScene(init, paper, init.seed), pillars: () => new Pillars(init, look, init.seed),
      ripple: () => new Ripple(init, look), channel: () => new Channel(init, look), orb: () => new Orb(init, look),
      menger: () => new Menger(init, look), sierpinski: () => new Sierpinski(init, look), cantor: () => new Cantor(init, look),
      papercut: () => new PaperCut(init), rain: () => new RainScene(init), lanterns: () => new LanternScene(init), neon: () => new NeonScene(init),
      underwater: () => new UnderwaterScene(init, look),
      sunset: () => new SunsetScene(init, look),
      phoenix: () => new PhoenixScene(init, look),
      velvet: () => new VelvetScene(init, style.id === 'velvet' ? 'velvet' : look),
    };
    for (const id of new Set(shots.map(s => s.scene))) this.sceneFactories[id] = make[id];
    const sections = song.analysis.sections;
    const looks = song.xyMusic || forceLook === 'none' ? [] : forceLook ? sections.map(s => (s.label === 'drop' ? null : forceLook)) : planLooks(sections, style, this.seed, off);
    const needsAscii = looks.includes('ascii');
    this.engine.setLooks(song.palette, needsAscii && showLyrics ? song.lines.map(l => l.text + (l.translation ?? '')).join('') : '', needsAscii);
    this.director = new Director(style, shots, this.scenes, music, lyrics, song.palette, init.armillary, song.cover, !only && song.xyMusic, looks);
    this.hud.sigilLabel = this.director.sigil?.label ?? '';
    const last = lines[lines.length - 1];
    const opening = this.director.shots[0]?.scene !== 'cards';
    // The name in the leaned-on face of the song's lyric voice: pulse's condensed capitals, a ballad's serif, ink's
    // Garamond and Kai.
    const voice = VOICES[voiceFor(style.id === 'ink' ? 'ink' : look, this.seed)];
    this.director.overlay.setCredits(song.name ?? '', song.artists ?? [], lines[0]?.start ?? Infinity, last?.end ?? 0, song.duration, opening, voice.faces[1], 0.11 * voice.scale);
    this.resize();
  }

  unload(): void {
    this.warmToken++;
    this.warming = false;
    this.lastPlayTime = 0;
    const keep = this.song?.cover;
    if (!this.engine.isContextLost()) {
      for (const s of Object.values(this.loadedScenes)) if (s && keep) disposeScene(s.scene, keep);
      if (this.director && keep) disposeScene(this.director.overlay.scene, keep);
      this.engine.setCover(null);
      if (this.song) this.song.cover.dispose();
    }
    this.loadedScenes = {};
    this.sceneFactories = {};
    this.scenes = this.createScenesProxy();
    this.warmedScenes.clear();
    this.director = null;
    this.song = null;
    if (this.engine.isContextLost()) disposeText(true);
    else trimTextCache(256);
  }

  resize(): void {
    this.engine.resize();
    for (const [id, s] of Object.entries(this.loadedScenes) as Array<[SceneId, MvScene | undefined]>) {
      if (s) this.applySceneViewport(id, s);
    }
    const canvas = this.engine.renderer.domElement;
    const pr = this.engine.renderer.getPixelRatio();
    this.director?.overlay.resize(this.engine.aspect);
    this.director?.overlay.setViewport(canvas.width, canvas.height, pr);
  }

  /** Renders song time t; returns the shot on screen, or null when nothing is loaded. */
  frame(t: number, dt: number): Shot | null {
    if (!this.director || this.warming || this.engine.isContextLost()) return null;
    this.lastPlayTime = t;
    this.director.overlay.showBadge = this.hud.visible;
    const { scene, fx, shot, transition } = this.director.frame(t, dt, this.engine.aspect);
    // 若用户手动跳转到了后台渐进预热尚未抵达的镜头，在首帧上屏前即时完成单场景离屏预热
    if (!this.warmedScenes.has(shot.scene)) {
      this.engine.warm(scene.scene, scene.camera);
      this.warmedScenes.add(shot.scene);
    }
    if (transition) {
      for (const [id, s] of Object.entries(this.loadedScenes) as Array<[SceneId, MvScene | undefined]>) {
        if (s && s.scene === transition.from.scene && !this.warmedScenes.has(id)) {
          this.engine.warm(s.scene, s.camera);
          this.warmedScenes.add(id);
          break;
        }
      }
    }
    for (const s of Object.values(this.loadedScenes)) s?.keepUp?.(t, this.engine.renderer);
    this.engine.render(scene.scene, scene.camera, fx, t, transition, this.director.overlay);
    const info = this.music!.at(t);
    this.hud.update(shot, this.director.shots.indexOf(shot), this.director.shots.length, info.bar + 1, this.music!.shownBpm(t));
    return shot;
  }

  private poseSceneForWarm(id: SceneId, director: Director, music: Music, song: PreparedSong, lyrics: LyricTrack, preferredShot?: Shot): MvScene | null {
    const scene = this.ensureScene(id);
    if (!scene) return null;
    const shot = preferredShot ?? director.shots.find(s => s.scene === id);
    if (!shot) return null;
    const t = Math.min(shot.start + 0.2, (shot.start + shot.end) / 2);
    scene.update({ t, dt: 1 / 60, music, lyrics, palette: song.palette, shot, shotT: t - shot.start, aspect: this.engine.aspect, fx: defaultFx() });
    return scene;
  }

  /**
   * Readies every plate before the MV shows (each posed at its first shot and drawn off screen), then the motion
   * graphics layer and the transition quad, a plate between `pause`s — so no cut stalls on a plate's first
   * appearance. When `opts.progressive` is true (live playback), only the active shot's scene(s) block opening while
   * remaining scenes are lazily constructed, compiled, and warmed in the background ahead of their scheduled cuts.
   */
  async warm(pause: () => Promise<void>, cancelled: () => boolean = () => false, opts?: WarmOptions): Promise<void> {
    const director = this.director, music = this.music, song = this.song;
    if (!director || !music || !song || this.engine.isContextLost()) return;
    const token = ++this.warmToken;
    this.warming = true;
    const aborted = () => cancelled() || this.director !== director || this.warmToken !== token || this.engine.isContextLost();

    const shots = director.shots;
    const startTime = Math.max(0, opts?.startTime ?? 0);
    this.lastPlayTime = startTime;
    let startIdx = shots.findIndex(s => s.end > startTime);
    if (startIdx < 0) startIdx = Math.max(0, shots.length - 1);

    // 按从当前播放位置向后的实际出场顺序排列唯一场景，使渐进预热始终优先准备即将切到的下一镜
    const orderedIds: SceneId[] = [];
    const seen = new Set<SceneId>();
    const pushId = (id: SceneId | undefined) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        orderedIds.push(id);
      }
    };
    for (let i = startIdx; i < shots.length; i++) pushId(shots[i].scene);
    for (let i = 0; i < startIdx; i++) pushId(shots[i].scene);

    const lyrics = new LyricTrack(this.lines);

    if (opts?.progressive && shots.length > 0) {
      const urgentSet = new Set<SceneId>();
      const curShot = shots[startIdx];
      if (curShot) {
        urgentSet.add(curShot.scene);
        if (startIdx > 0 && startTime - curShot.start < 0.55) urgentSet.add(shots[startIdx - 1].scene);
        if (curShot.end - startTime < 0.55 && shots[startIdx + 1]) urgentSet.add(shots[startIdx + 1].scene);
      }
      const urgentIds = [...urgentSet];
      const remainingIds = orderedIds.filter(id => !urgentSet.has(id));

      try {
        const urgentEntries: Array<{ id: SceneId; scene: MvScene }> = [];
        for (const id of urgentIds) {
          const pref = curShot?.scene === id ? curShot : undefined;
          const s = this.poseSceneForWarm(id, director, music, song, lyrics, pref);
          if (s) urgentEntries.push({ id, scene: s });
        }
        await Promise.all([
          this.engine.compile(director.overlay.scene, director.overlay.camera),
          this.engine.compilePost(),
          ...urgentEntries.map(e => this.engine.compile(e.scene.scene, e.scene.camera, e.scene.offscreen)),
        ]);
        if (aborted()) return;
        for (const e of urgentEntries) {
          if (aborted()) return;
          this.engine.warm(e.scene.scene, e.scene.camera);
          this.warmedScenes.add(e.id);
        }
        this.engine.warm(director.overlay.scene, director.overlay.camera);
        this.engine.warm();
        this.engine.renderer.getContext().flush();
      } finally {
        if (this.warmToken === token) this.warming = false;
      }

      if (!aborted() && remainingIds.length > 0) {
        void this.warmRemainingInBackground(remainingIds, director, music, song, lyrics, pause, aborted);
      }
      return;
    }

    try {
      const posed: Array<{ id: SceneId; scene: MvScene }> = [];
      for (const id of orderedIds) {
        const s = this.poseSceneForWarm(id, director, music, song, lyrics);
        if (s) posed.push({ id, scene: s });
      }
      // 分批并行异步编译（每批 4 个场景，充分利用 KHR_parallel_shader_compile 后台编译线程池，同时避免单帧涌入过多着色器导致 GPU 进程超时），随后逐个离屏预热
      await Promise.all([
        this.engine.compile(director.overlay.scene, director.overlay.camera),
        this.engine.compilePost(),
      ]);
      if (aborted()) return;
      await pause();
      const batchSize = 4;
      for (let i = 0; i < posed.length; i += batchSize) {
        if (aborted()) return;
        const batch = posed.slice(i, i + batchSize);
        await Promise.all(batch.map(e => this.engine.compile(e.scene.scene, e.scene.camera, e.scene.offscreen)));
        if (aborted()) return;
        await pause();
      }
      for (const e of posed) {
        if (aborted()) return;
        this.engine.warm(e.scene.scene, e.scene.camera);
        this.warmedScenes.add(e.id);
        this.engine.renderer.getContext().flush();
        await pause();
      }
      if (aborted()) return;
      this.engine.warm(director.overlay.scene, director.overlay.camera);
      this.engine.warm();
      this.engine.renderer.getContext().flush();
    } finally {
      if (this.warmToken === token) this.warming = false;
    }
  }

  private async warmRemainingInBackground(
    ids: readonly SceneId[],
    director: Director,
    music: Music,
    song: PreparedSong,
    lyrics: LyricTrack,
    pause: () => Promise<void>,
    aborted: () => boolean,
  ): Promise<void> {
    const openedAt = performance.now();
    const waitMs = async (ms: number): Promise<boolean> => {
      const deadline = performance.now() + ms;
      while (performance.now() < deadline) {
        if (aborted()) return false;
        await new Promise<void>(r => setTimeout(r, Math.min(80, Math.max(16, deadline - performance.now()))));
        if (aborted()) return false;
        await pause();
      }
      return !aborted();
    };

    // 切歌防抖冷静窗：刚开播前 500ms 不向 GPU 编译队列塞入后台着色器，保证快速连按切歌 100% 零排队
    if (!(await waitMs(500))) return;

    const pending = new Set<SceneId>(ids);
    const secondsUntilScene = (id: SceneId, nowT: number): number => {
      let best = Infinity;
      for (const sh of director.shots) {
        if (sh.scene !== id) continue;
        if (sh.end > nowT) {
          const lead = Math.max(0, sh.start - nowT);
          if (lead < best) best = lead;
        }
      }
      return best;
    };

    // 前瞻窗口（秒）：优先把即将登场的近期镜头预热完毕；远期重型镜头待本曲稳定播放满 5.5s 后再逐材质增量预热
    const LOOKAHEAD_SEC = 20;
    const SETTLE_ALL_MS = 5500;

    while (pending.size > 0) {
      if (aborted()) return;
      for (const doneId of [...pending]) {
        if (this.warmedScenes.has(doneId)) pending.delete(doneId);
      }
      if (pending.size === 0) break;

      const nowT = this.lastPlayTime;
      let nextId: SceneId | null = null;
      let minLead = Infinity;
      for (const id of pending) {
        const lead = secondsUntilScene(id, nowT);
        if (lead < minLead) {
          minLead = lead;
          nextId = id;
        }
      }
      if (!nextId) nextId = pending.values().next().value ?? null;
      if (!nextId) break;

      const settledLongEnough = performance.now() - openedAt >= SETTLE_ALL_MS;
      if (minLead > LOOKAHEAD_SEC && !settledLongEnough) {
        if (!(await waitMs(180))) return;
        continue;
      }

      const scene = this.poseSceneForWarm(nextId, director, music, song, lyrics);
      if (!scene) {
        pending.delete(nextId);
        continue;
      }
      await pause();
      if (aborted()) return;

      const ok = await this.engine.compileIncremental(
        scene.scene,
        scene.camera,
        scene.offscreen,
        pause,
        aborted,
      );
      if (!ok || aborted()) return;

      if (!this.warmedScenes.has(nextId)) {
        this.engine.warm(scene.scene, scene.camera);
        this.warmedScenes.add(nextId);
        this.engine.renderer.getContext().flush();
      }
      pending.delete(nextId);
      await pause();
    }
  }

  get shots(): Shot[] { return this.director?.shots ?? []; }

  dispose(): void {
    this.unload();
    disposeText(this.engine.isContextLost());
    this.hud.dispose();
    this.engine.dispose();
  }
}
