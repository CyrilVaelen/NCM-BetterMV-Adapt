// BetterMV plugin entry. Opens a full-window MV for the song NetEase is playing: gathers the song (cached audio,
// lyrics, wiki, cover), analyses it in slices between frames, then renders at the time NetEase reports.
import { loadFonts } from '../render/text.ts';
import { prepareSong, reanalyzePreparedSong, styleChoiceFor, styleFor, Cancelled, whenIdle, yieldToPage, type PreparedSong, type Stage } from '../app/prepare.ts';
import { MvPlayer } from '../app/player.ts';
import {
  findClient, isMaximized, nextSong, liked, listTrack, minimizeWindow, playingIndex, playingSong, playItem, playList, playMode, seek, setPlayMode,
  setVolume, skip, toggleLike, toggleMaximize, togglePlay, volume, type Client, type PlayingSong,
} from './client.ts';
import { ProgressClock } from './clock.ts';
import { importPictureCalibration, pictureDelayMs } from './playback-sync.ts';
import { VideoExporter } from './export.ts';
import { fetchChorus, fetchLyric, fetchWiki, getAudio, loadCover, type AudioSource } from './source.ts';
import { lyricFingerprint, readAnalysisCache, writeAnalysisCache } from './analysis-cache.ts';
import { alignSong, applyAlignment, applyLockedAlignment, cachedAlignment, checkPack, needsAlignment } from './aligner.ts';
import { parseLocalLrc, readLocalLrcText } from '../lyrics/local.ts';
import { parseNeteaseLyric } from '../lyrics/parse.ts';
import { analyzeSongVibe, autoSongVibeSummary, chooseStyle, LYRIC_PLATES, VIBE_PRESET_MAP } from '../style/style.ts';
import { isRecordingKeys, keyCombo, loadConfig, mvButton, Overlay, pixelRatio, settingsView, type BarSection, type Config, type QueueTrack, type SettingsActions } from './ui.ts';
import type { SectionLabel } from '../types.ts';

const KEY = '__betterMv';
const SECTION: Record<SectionLabel, string> = { intro: '前奏', verse: '主歌', pre: '预副歌', chorus: '副歌', drop: '高潮', build: '铺垫', break: '间奏', bridge: '桥段', outro: '尾奏' };
const AUDIO_SOURCE_LABEL: Record<AudioSource, string> = {
  'paired-local-file': '分析音频：本地 LRC 同名音频文件',
  'netease-cache': '分析音频：网易云完整缓存',
  'netease-stream': '分析音频：网易云在线音源',
};
const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

async function readPluginFile(rel: string): Promise<ArrayBuffer> {
  const base = plugin.pluginPath.replace(/[\\/]+$/, '');
  return (await betterncm.fs.readFile(`${base}/${rel}`)).arrayBuffer();
}

// Settings exist before the client is found, so the settings page is registered at load time.
const config: Config = loadConfig();
const listeners: Array<(c: Config) => void> = [];
// Each scene's (and look's) sketch for the settings page (previews/<scene>.webp, previews/look-<id>.webp in the plugin
// folder), read once.
const sketches = new Map<string, Promise<string | null>>();
const sketch = (id: string) => {
  let url = sketches.get(id);
  if (!url) {
    url = readPluginFile(`previews/${id}.webp`).then(b => URL.createObjectURL(new Blob([b], { type: 'image/webp' })), () => null);
    sketches.set(id, url);
  }
  return url;
};
let currentActiveClient: Client | null = null;
let currentActivePlayer: MvPlayer | null = null;
let settingsActionsFor: (id: number) => SettingsActions = () => ({});
const changed = (c: Config) => listeners.forEach(fn => fn(c));
plugin.onConfig(() => {
  const song = currentActivePlayer?.song
    ? { id: currentActivePlayer.song.id, name: currentActivePlayer.song.name ?? '' }
    : (currentActiveClient ? playingSong(currentActiveClient.store) : null);
  return settingsView(config, changed, sketch, false, song ? { id: song.id, name: song.name } : undefined, song ? settingsActionsFor(song.id) : {});
});

/**
 * 将 BetterNCM 插件管理器的默认展示页设为 BetterMV（并将左侧列表项置顶），
 * 用户在管理面板内仍可随时手动点击切换到 PluginMarket 或其他插件。
 */
(function preferBetterMvInManager() {
  const ensureListOrderStyle = () => {
    const id = 'bmv-bncm-mgr-order';
    if (document.getElementById(id) || !document.head) return;
    const st = document.createElement('style');
    st.id = id;
    st.textContent =
      '.better-ncm-manager .loaded-plugins-list > div > div { display: flex; flex-direction: column; }' +
      '.better-ncm-manager .loaded-plugins-list .plugin-btn[data-plugin-slug="ncm-better-mv"] { order: -1; }';
    document.head.append(st);
  };
  ensureListOrderStyle();

  const selectBetterMv = (): boolean => {
    ensureListOrderStyle();
    const btn = document.querySelector<HTMLElement>(
      '.better-ncm-manager .loaded-plugins-list .plugin-btn[data-plugin-slug="ncm-better-mv"]',
    );
    if (!btn) return false;
    if (!btn.classList.contains('selected')) btn.click();
    return btn.classList.contains('selected');
  };

  let tries = 0;
  let manualSelect = false;
  window.addEventListener(
    'click',
    e => {
      const target = e.target as Element | null;
      if (target?.closest?.('.better-ncm-manager .loaded-plugins-list') && e.isTrusted) {
        manualSelect = true;
        return;
      }
      if (target?.closest?.('[title="BetterNCM"]')) {
        requestAnimationFrame(() => {
          const mgr = document.querySelector('.better-ncm-manager');
          if (mgr?.classList.contains('ncmm-show')) selectBetterMv();
        });
        return;
      }
      if (target?.closest?.('.better-ncm-manager') && target.textContent?.includes('开始使用 BetterNCM')) {
        window.setTimeout(selectBetterMv, 30);
      }
    },
    true,
  );

  const pollInitial = () => {
    if (manualSelect || selectBetterMv() || ++tries > 50) return;
    window.setTimeout(pollInitial, 150);
  };
  if (typeof plugin.onAllPluginsLoaded === 'function') {
    plugin.onAllPluginsLoaded(() => {
      tries = 0;
      pollInitial();
    });
  }
  pollInitial();
})();

void checkPack();

/** A song being prepared: the one to show (urgent), or the next one ahead. */
interface Job { id: number; cancelled: boolean; urgent: boolean; progress?: (stage: Stage, progress: number) => void }
/** A song read and prepared, with its audio (for the aligner pack) and whether its word times came from the pack. */
interface Gathered { song: PreparedSong; audio: ArrayBuffer; audioSource: AudioSource; wordsFromPack: boolean; alignmentDetail?: string }
interface Ahead { job: Job; done: Promise<Gathered | null> }

function start(client: Client): void {
  currentActiveClient = client;
  const clock = new ProgressClock();
  clock.offset = pictureDelayMs(config) / 1000;
  client.bridge.appendRegisterCall('PlayProgress', 'audioplayer', clock.onProgress);
  client.bridge.appendRegisterCall('PlayState', 'audioplayer', clock.onState);

  let player: MvPlayer | null = null;
  window.addEventListener('resize', () => player?.resize());
  let fonts: Promise<void> | null = null;
  let preparing: Job | null = null;
  /** The next song being prepared in the background (prefetchNext). */
  let ahead: Ahead | null = null;
  const ready = new Map<number, PreparedSong>();
  /** Songs whose word times are being found by the aligner pack, or were. */
  const aligned = new WeakMap<PreparedSong, 'aligning' | 'aligned'>();
  const alignmentDetail = new WeakMap<PreparedSong, string>();
  const sectionRefresh = new WeakMap<PreparedSong, string>();
  /** Local sentence boundaries stay locked while the pack refines words inside them. */
  const isLocalLrcSong = new WeakSet<PreparedSong>();
  const songAudio = new WeakMap<PreparedSong, ArrayBuffer>();
  const songAudioSource = new WeakMap<PreparedSong, AudioSource>();
  const alignmentJobs = new WeakMap<PreparedSong, { lines: PreparedSong['lines']; done: Promise<string> }>();
  const settingsActions = (id: number): SettingsActions => ({
    alignmentStatus: () => alignmentDetail.get(ready.get(id)!) ?? '',
    vibeStatus: () => {
      const target = ready.get(id);
      return target
        ? autoSongVibeSummary(target.analysis, { graphic: target.palette.graphic, lyrics: config.showLyrics && target.lines.length > 0, wiki: target.wiki })
        : '';
    },
    alignLyrics: async () => {
      const target = ready.get(id);
      if (!target || !isLocalLrcSong.has(target)) throw new Error('请先打开这首歌的 MV 并导入本地 LRC');
      return alignIfNeeded(target, true);
    },
    reloadLyrics: async (localPath?: string | null) => {
      const target = ready.get(id);
      const previous = target?.lines;
      const text = localPath ? await readLocalLrcText(localPath) : null;
      // With no prepared MV, the saved binding is read the next time the song is prepared.
      if (!target) return;
      const online = await fetchLyric(id);
      const lines = text !== null ? parseLocalLrc(text, target.duration, online) : online ? parseNeteaseLyric(online, target.duration) : null;
      if (!lines?.length) throw new Error(localPath ? 'LRC 有时间标签，但没有可显示的歌词正文；保留原歌词' : '未获得可用的网易云歌词；保留原歌词');
      if (ready.get(id) !== target || target.lines !== previous) throw new Error('歌曲或歌词已被另一次操作更改，请重新读取');
      target.lines = lines;
      if (localPath) isLocalLrcSong.add(target); else isLocalLrcSong.delete(target);
      aligned.delete(target);
      alignmentDetail.delete(target);
      sectionRefresh.set(target, '歌词已更新，正在使用本曲音频重新分析段落…');
      if (player?.song === target) describe(target);
      if (localPath && lines.some(l => l.timedWords)) {
        aligned.set(target, 'aligned');
        alignmentDetail.set(target, `本地逐字 LRC：已直接载入 ${lines.filter(l => l.timedWords).length}/${lines.length} 句逐词时间`);
      }
      const audio = songAudio.get(target);
      if (!audio) {
        sectionRefresh.set(target, '歌词已更新，但没有可复用音频；请重新打开本曲 MV 以刷新段落');
        if (player?.song === target) describe(target);
        return;
      }
      const lyricFp = lyricFingerprint(lines);
      const cacheMeta = { audioBytes: audio.byteLength, duration: target.duration, lyricFingerprint: lyricFp, wikiBpm: target.wiki?.bpm, chorus: target.chorus };
      try {
        const cached = await readAnalysisCache(id, cacheMeta);
        if (cached) {
          target.analysis = cached;
          target.analysisLines = lines.map(l => ({ ...l, words: l.words.map(w => ({ ...w })) }));
          target.choice = chooseStyle(cached, target.wiki, lines.length > 0);
        } else {
          await reanalyzePreparedSong(target, audio, lines, {
            pause: () => yieldToPage(),
            sliceMs: 8,
            cancelled: () => target.lines !== lines || ready.get(id) !== target,
          });
          if (target.lines === lines && ready.get(id) === target) {
            void writeAnalysisCache(id, cacheMeta, target.analysis);
          }
        }
      } catch (e) {
        if (e instanceof Cancelled) return;
        console.warn('[BetterMV] 更新歌词后的段落分析失败', e);
        sectionRefresh.set(target, '歌词已更新，但段落重算失败；请重新打开本曲 MV');
        if (player?.song === target) describe(target);
        return;
      }
      if (target.lines !== lines || ready.get(id) !== target) return;
      sectionRefresh.delete(target);
      if (player?.song === target) {
        plan(target, config);
        updateStructure(target);
        describe(target);
        void player.warm(nextFrame, () => player?.song !== target, { progressive: true, startTime: Math.max(0, clock.now()) });
      }
      void alignIfNeeded(target);
    },
  });
  settingsActionsFor = settingsActions;
  let raf = 0;
  let last = 0;
  /** With a frame cap: when the next picture is due (the schedule the cap keeps). */
  let due = 0;
  /** NetEase's play list as the list panel shows it: its entries (to play one), their names, the playing one. */
  const queue = { list: [] as readonly any[], tracks: [] as QueueTrack[], at: -2 };

  /**
   * Whether NetEase is playing: its store's play state (2 = playing), the clock only when the store has none. The
   * clock counts as playing only within 350 ms of a progress event (none yet just after a resume or a seek, or when a
   * heavy frame holds them up), so the pause button asked it, sent a resume to a playing song and the first press did
   * nothing (the user: “暂停键有时候第一次按下不起效果”).
   */
  const isPlaying = () => {
    const state = client.store.getState()?.playing?.playingState;
    return typeof state === 'number' ? state === 2 : clock.playing;
  };
  const exporter = new VideoExporter(client, () => {
    const song = playingSong(client.store);
    if (!song) return null;
    const shown = player?.song?.id === song.id ? player : null;
    const prepared = shown?.song ?? ready.get(song.id) ?? null;
    const memAudio = prepared ? songAudio.get(prepared) : undefined;
    return {
      song, config, seed: shown?.seed,
      lines: prepared?.lines, analysisLines: prepared?.analysisLines,
      wiki: prepared?.wiki, chorus: prepared?.chorus,
      audio: memAudio && memAudio.byteLength > 32 ? memAudio : undefined,
      duration: prepared?.duration ?? song.duration,
      sections: prepared?.analysis?.sections,
      currentTime: clock.time(),
    };
  });
  const overlay = new Overlay({
    exportView: () => exporter.view(),
    onClose: () => close(),
    // The picture stops (or jumps) on the click, not when NetEase's events catch up.
    onTogglePlay: () => {
      const playing = isPlaying();
      if (playing) clock.pause();
      togglePlay(client.store, playing);
    },
    onPrev: () => skip(client.store, -1),
    onNext: () => skip(client.store, 1),
    onVolume: v => setVolume(client.store, v),
    onToggleLike: () => toggleLike(client.store),
    onPlayMode: mode => setPlayMode(client.store, mode),
    onPlayAt: i => { const item = queue.list[i]; if (item) playItem(client.store, item); },
    onSeek: s => {
      const to = Math.min(Math.max(0, s), duration() - 0.5);
      clock.seek(to);
      seek(client.store, to);
    },
    // What NetEase's own title bar calls (its window has no system frame).
    onDragWindow: () => { try { void Promise.resolve(client.bridge.call('winhelper.dragWindow')).catch(() => {}); } catch { /* no such call */ } },
    // And what its resize grips call.
    onResizeWindow: edge => { try { void Promise.resolve(client.bridge.call('winhelper.sizeWindow', edge)).catch(() => {}); } catch { /* no such call */ } },
    onMinimize: () => minimizeWindow(client.store),
    onToggleMaximize: () => toggleMaximize(client.store),
    onRetry: () => {
      contextRetryCount = 0;
      clearTimeout(contextRetryTimer);
      void prepareCurrent();
    },
    // The same settings, in a panel on the MV page (tried out while watching).
    settings: () => settingsView(config, changed, sketch, true, player?.song ? { id: player.song.id, name: player.song.name ?? '' } : undefined, {
      ...settingsActions(player?.song?.id ?? 0),
      // The playing song arranged anew, now.
      reroll: () => {
        const song = player?.song;
        if (!song || !player) return;
        plan(song, config, true);
        describe(song);
        void player.warm(nextFrame, () => player?.song !== song, { progressive: true, startTime: Math.max(0, clock.now()) });
      },
    }),
  });
  const updateStructure = (song: PreparedSong) => overlay.setStructure(
    song.analysis.sections.map((x): BarSection => ({ start: x.start, end: x.end, name: SECTION[x.label], loud: x.label === 'chorus' || x.label === 'drop' })),
    song.palette.css.signal,
  );
  overlay.showControls = config.controls;
  overlay.setKeys(config.keys);
  const duration = () => player?.song?.duration || playingSong(client.store)?.duration || 0;
  // What the loaded MV was planned with: a settings change replans it only when the style, the scenes or looks, the
  // arrangement mode or this song's lyric delay changed.
  let plannedWith = '';
  const planKey = (c: Config, id = player?.song?.id) => `${c.style}|${c.vibe}|${c.off.join(',')}|${c.offLooks.join(',')}|${id ? c.lyricDelays[id] ?? 0 : 0}|${c.arrange}`;
  /**
   * The arrangement's seed: a fixed one per song when its arrangement is kept, a new one when asked for (`fresh`),
   * else the player's own (drawn anew for each play of a song, kept while it plays).
   */
  const seedFor = (song: PreparedSong, c: Config, fresh: boolean) =>
    fresh ? (Math.random() * 4294967296) >>> 0 : c.arrange === 'fixed' ? Math.imul(song.id ^ 0x9e3779b9, 2654435761) >>> 0 : undefined;
  const plan = (song: PreparedSong, c: Config, fresh = false) => {
    plannedWith = planKey(c, song.id);
    player!.load(song, styleFor(song, c.style, c.showLyrics, c.vibe), new Set([...c.off, ...c.offLooks]), undefined, undefined, (c.lyricDelays[song.id] ?? 0) / 1000, seedFor(song, c, fresh), undefined, c.showLyrics, c.vibe);
  };
  /** 判断切换歌词显示开关后是否需要重新编排镜头（如当前存在纯文字版式场景或自动风格需切离“字”风格） */
  const needsLyricReplan = (song: PreparedSong, c: Config): boolean => {
    if (!player) return false;
    if (player.style?.id !== styleFor(song, c.style, c.showLyrics, c.vibe).id) return true;
    if (!c.showLyrics && player.shots.some(s => LYRIC_PLATES.has(s.scene))) return true;
    return false;
  };
  /** The MV's style beside the volume (and why, when chosen automatically), and how the lyrics' word times stand. */
  const describe = (song: PreparedSong) => {
    const vibe = analyzeSongVibe(song.analysis, { graphic: song.palette.graphic, lyrics: config.showLyrics && song.lines.length > 0, wiki: song.wiki, vibePreset: config.vibe });
    const manualVibe = config.vibe !== 'auto' ? VIBE_PRESET_MAP[config.vibe]?.label : undefined;
    overlay.mvInfo({
      style: player!.style!.name,
      why: config.style === 'auto' ? styleChoiceFor(song, config.showLyrics, config.vibe).reason : null,
      bpm: song.analysis.namedBpm ?? song.analysis.bpm,
      vibeBadge: manualVibe,
      vibeDetail: manualVibe
        ? `音乐风格：${manualVibe}（手动指定，已按该曲风动态调整各场景出现概率）`
        : `音乐风格：自动识别为 ${vibe.summary}（按本曲气质动态调节场景出现概率）`,
      lyrics: config.showLyrics ? (aligned.get(song) ?? null) : null,
      lyricDetail: !config.showLyrics ? '歌词：已关闭显示' : (sectionRefresh.get(song) ?? alignmentDetail.get(song)),
      audioDetail: AUDIO_SOURCE_LABEL[songAudioSource.get(song) ?? 'netease-stream'],
    });
  };
  /** Hands NetEase's play list to the list panel, read again only when it (or the playing track) changed. */
  const syncQueue = (): boolean => {
    const list = playList(client.store), at = playingIndex(client.store, list);
    if (list === queue.list && at === queue.at) return false;
    if (list !== queue.list) { queue.list = list; queue.tracks = list.map(listTrack); }
    queue.at = at;
    overlay.queue(queue.tracks, at);
    return true;
  };
  let replan = 0;
  let button: HTMLButtonElement | null = config.button ? mvButton(() => open()) : null;

  function loop(now: number): void {
    raf = 0;
    if (!overlay.visible || !player) return;
    // With a frame cap the picture is drawn only once its time has come (a millisecond early is fine: the screen's
    // own beat decides when it shows); the controls follow every frame. The next one is due a period after this one
    // was due, not after now, so the cap holds on average whatever the screen's rate: at 120 on a 144 Hz screen five
    // frames in six are drawn (counting from now, every other one would be, 72 a second). After a stall (more than a
    // period late) the schedule starts again from now.
    const cap = config.fpsCap, period = cap ? 1000 / cap : 0;
    if (!cap || !last || now >= due - 1) {
      if (cap) due = (now - due > period ? now : due) + period;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      // Only draw the song the MV was made for; while NetEase switches songs or warms shaders the last frame stays.
      if (!preparing && !player.warming && !player.engine.isContextLost() && player.song && (clock.songId === player.song.id || !clock.playId)) {
        clock.offset = pictureDelayMs(config, player.song.id) / 1000;
        player.frame(Math.max(0, clock.now()), dt);
      }
    }
    overlay.progress(clock.time(), duration(), isPlaying());
    overlay.volume(volume(client.store));
    overlay.playState(liked(client.store), playMode(client.store));
    player.hud.visible = !(overlay.awake && overlay.showControls);
    raf = requestAnimationFrame(loop);
  }

  /**
   * Reads a song (audio, lyrics, wiki, cover) and prepares it. Urgent (the song to show): as fast as the page allows;
   * otherwise (the next song, ahead) in short slices in the time the MV's frames leave over.
   */
  async function gather(song: PlayingSong, job: Job): Promise<Gathered> {
    const localPath = config.localLrcPaths?.[String(song.id)];
    let localLrcText: string | null = null;
    if (localPath) {
      try {
        localLrcText = await readLocalLrcText(localPath);
      } catch (e) {
        console.warn('[BetterMV] 读取本地 LRC 失败，将使用在线歌词', e);
      }
    }

    const [audioAsset, lyric, wiki, chorus, cover] = await Promise.all([
      getAudio(client, song.id, () => job.cancelled, song.local ? localPath : undefined), fetchLyric(song.id), fetchWiki(song.id), fetchChorus(song.id), loadCover(song.cover),
    ]);
    if (job.cancelled) throw new Cancelled();
    const audio = audioAsset.audio;

    const lyricInput = localLrcText
      ? {
          lrc: { lyric: localLrcText },
          tlyric: lyric?.tlyric,
          // Explicitly omit yrc so parseNeteaseLyric does not override local LRC with online yrc
        }
      : lyric;

    let wordsFromPack = false;
    let detail: string | undefined;
    const rushDiagnosticSong=/rush\s*over\s*me/i.test(song.name);
    const rushEntryTrace:Record<string,unknown>[]=[];
    let rushRawSectionTrace:Record<string,unknown>|undefined;
    let rushFinalSectionTrace:unknown;
    const sectionDebugHooks=globalThis as typeof globalThis & {
      __bmvDropEntryDebug?: (record:Record<string,unknown>)=>void;
      __bmvSectionDebug?: (record:Record<string,ArrayLike<number>>)=>void;
      __bmvSectionInfo?: (record:unknown)=>void;
    };
    const previousDropEntryDebug=sectionDebugHooks.__bmvDropEntryDebug;
    const previousSectionDebug=sectionDebugHooks.__bmvSectionDebug;
    const previousSectionInfo=sectionDebugHooks.__bmvSectionInfo;
    if(rushDiagnosticSong){
      sectionDebugHooks.__bmvDropEntryDebug=record=>{rushEntryTrace.push(record);previousDropEntryDebug?.(record);};
      sectionDebugHooks.__bmvSectionDebug=record=>{
        const array=(key:string)=>Array.from(record[key]??[],Number);
        const time=array('time'),fields=['nov','cue','lowDb','sung','z4','z8','zj','zb','zh'];
        const vectors=Object.fromEntries(fields.map(key=>[key,array(key)])) as Record<string,number[]>;
        const bars=time.flatMap((t,i)=>t>=184&&t<=199?[{time:t,...Object.fromEntries(fields.map(key=>[key,vectors[key][i]??null]))}]:[]);
        rushRawSectionTrace={cuts:array('cuts'),bars,releases:array('releases'),prelude:array('prelude')};
        previousSectionDebug?.(record);
      };
      sectionDebugHooks.__bmvSectionInfo=record=>{rushFinalSectionTrace=record;previousSectionInfo?.(record);};
    }
    let prepared:PreparedSong;
    let analysisLyricFp = '';
    let analysisCacheHit = false;
    try{
      prepared=await prepareSong(
        { id: song.id, name: song.name, artists: song.artists, audio, lyric: lyricInput, wiki, chorus, cover },
        {
          pause: () => (job.urgent ? yieldToPage() : whenIdle()),
          sliceMs: job.urgent ? 20 : 3,
          cancelled: () => job.cancelled,
          onProgress: (stage, p) => job.progress?.(stage, p),
          // Word times found before (aligner pack) go in before the analysis reads the lyrics.
          refineLines: async lines => {
            // Local word calibration is presentation-only, including on a later cache hit.
            if (localLrcText) return;
            const r = await cachedAlignment(song.id, lines);
            wordsFromPack = !!r && applyAlignment(lines, r) > 0;
          },
          analysis: rushDiagnosticSong ? undefined : async (lines, dur) => {
            analysisLyricFp = lyricFingerprint(lines);
            const hit = await readAnalysisCache(song.id, {
              audioBytes: audio.byteLength,
              duration: dur,
              lyricFingerprint: analysisLyricFp,
              wikiBpm: wiki?.bpm,
              chorus,
            });
            if (hit) analysisCacheHit = true;
            return hit;
          },
        },
      );
      if (!rushDiagnosticSong && !analysisCacheHit && !job.cancelled) {
        void writeAnalysisCache(
          song.id,
          {
            audioBytes: audio.byteLength,
            duration: prepared.duration,
            lyricFingerprint: analysisLyricFp || lyricFingerprint(prepared.lines),
            wikiBpm: wiki?.bpm,
            chorus,
          },
          prepared.analysis,
        );
      }
    }finally{
      if(rushDiagnosticSong){
        if(previousDropEntryDebug)sectionDebugHooks.__bmvDropEntryDebug=previousDropEntryDebug;else delete sectionDebugHooks.__bmvDropEntryDebug;
        if(previousSectionDebug)sectionDebugHooks.__bmvSectionDebug=previousSectionDebug;else delete sectionDebugHooks.__bmvSectionDebug;
        if(previousSectionInfo)sectionDebugHooks.__bmvSectionInfo=previousSectionInfo;else delete sectionDebugHooks.__bmvSectionInfo;
      }
    }
    if (/rush\s*over\s*me/i.test(song.name)) {
      const sectionAt = (seconds: number) => prepared.analysis.sections.find(s => s.start <= seconds && seconds < s.end)?.label ?? null;
      const diagnostic = {
        capturedAt: new Date().toISOString(),
        runtimeVersion: typeof __VERSION__ === 'string' ? __VERSION__ : null,
        song: { id: song.id, name: song.name, duration: prepared.duration },
        audio: { source: audioAsset.source, bytes: audio.byteLength },
        lyrics: {
          source: localLrcText ? 'bound-local-lrc' : lyric ? 'netease' : 'none',
          localBindingFound: !!localPath,
          localLrcRead: localLrcText !== null,
          onlineLrcPresent: !!lyric?.lrc?.lyric,
          onlineYrcPresent: !!lyric?.yrc?.lyric,
          parsedLines: prepared.lines.length,
          timedWordLines: prepared.lines.filter(line => line.timedWords).length,
        },
        metadata: { wikiBpm: wiki?.bpm ?? null, chorusHint: chorus ?? null },
        analysis: {
          version: prepared.analysis.version,
          bpm: prepared.analysis.bpm,
          namedBpm: prepared.analysis.namedBpm,
          meter: prepared.analysis.meter,
          sections: prepared.analysis.sections.map(({ start, end, label }) => ({ start, end, label })),
          labelAt: Object.fromEntries([190, 191, 192, 193, 194, 220, 221].map(t => [t, sectionAt(t)])),
          sectionTrace:{rawStructure:rushRawSectionTrace,dropEntry:rushEntryTrace,finalLabels:rushFinalSectionTrace},
        },
        display: {
          requestedStyle: config.style,
          resolvedStyle: styleFor(prepared, config.style).id,
          deviceOffsetSeconds: clock.offset,
          configuredSongOffsetSeconds: pictureDelayMs(config, song.id) / 1000,
        },
      };
      try {
        const root = (await betterncm.app.getDataPath()).replace(/[\\/]+$/, '');
        const directory = `${root}/BetterMV`;
        await betterncm.fs.mkdir(directory);
        const written = await betterncm.fs.writeFileText(`${directory}/rush-over-me-live-analysis.json`, JSON.stringify(diagnostic, null, 2));
        if (!written) console.warn('[BetterMV] Rush Over Me 段落诊断写入失败');
      } catch (error) {
        console.warn('[BetterMV] Rush Over Me 段落诊断写入失败', error);
      }
    }
    prepared.analysisLines = prepared.lines.map(l => ({ ...l, words: l.words.map(w => ({ ...w })) }));
    if (localLrcText) {
      isLocalLrcSong.add(prepared);
      const inlineCount = prepared.lines.filter(l => l.timedWords).length;
      if (inlineCount === prepared.lines.length && inlineCount > 0) {
        wordsFromPack = true;
        detail = `本地逐字 LRC：已直接载入 ${inlineCount}/${prepared.lines.length} 句逐词时间`;
      } else {
        const r = await cachedAlignment(song.id, prepared.lines, 'local-locked');
        if (r) {
          const counts = applyLockedAlignment(prepared.lines, r);
          wordsFromPack = true;
          detail = localAlignmentSummary(counts);
        } else if (inlineCount > 0) {
          wordsFromPack = true;
          detail = `本地逐字 LRC：已直接载入 ${inlineCount}/${prepared.lines.length} 句逐词时间`;
        }
      }
    }
    return { song: prepared, audio, audioSource: audioAsset.source, wordsFromPack, alignmentDetail: detail };
  }

  /** Into the last few prepared songs. */
  function keep(g: Gathered): void {
    if (ready.has(g.song.id)) ready.delete(g.song.id);
    ready.set(g.song.id, g.song);
    songAudio.set(g.song, g.audio);
    songAudioSource.set(g.song, g.audioSource);
    if (g.alignmentDetail) alignmentDetail.set(g.song, g.alignmentDetail);
    if (g.wordsFromPack) aligned.set(g.song, 'aligned');
    while (ready.size > 8) ready.delete(ready.keys().next().value as number);
  }
  /**
   * The first time a song is shown, its word times are found by the aligner pack: the MV starts with the estimate and
   * the found times replace it in place when the pack is done.
   */
  function localAlignmentSummary(c: { aligned: number; total: number }): string {
    return `本地 LRC：本次对齐 ${c.aligned}/${c.total} 句；其余 ${c.total - c.aligned} 句保留原词时间，句子时间不变`;
  }
  async function alignIfNeeded(target: PreparedSong, force = false): Promise<string> {
    const lines = target.lines, local = isLocalLrcSong.has(target);
    const pending = alignmentJobs.get(target);
    if (pending?.lines === lines) return pending.done;
    if (!force && (aligned.get(target) === 'aligned' || !needsAlignment(lines))) return alignmentDetail.get(target) ?? '';
    const audio = songAudio.get(target);
    if (!audio) return '没有可用音频，请重新打开本曲 MV';
    // Register before any await so a repeated click cannot enqueue the same job twice.
    const done = (async () => {
      if (!await checkPack()) {
        if (target.lines === lines) alignmentDetail.set(target, '请先在下方安装逐字对齐包');
        return '请先在下方安装逐字对齐包';
      }
      if (target.lines !== lines) return '歌词已更改，本次结果不再使用';
      aligned.set(target, 'aligning');
      alignmentDetail.set(target, '正在按音频逐字对齐…');
      if (player?.song === target && player.style) describe(target);
      const result = await alignSong(target.id, lines, target.duration, audio, undefined, { mode: local ? 'local-locked' : 'online', force });
      // Import/reload/restore can finish while recognition runs. Never apply an obsolete result.
      if (target.lines !== lines) return '歌词已更改，本次结果不再使用';
      const counts = result && local ? applyLockedAlignment(lines, result) : null;
      const count = counts ? counts.aligned : result ? applyAlignment(lines, result) : 0;
      const message = !result ? '逐字对齐失败，可重试；保留原歌词' : counts ? localAlignmentSummary(counts) : `已按音频对齐 ${count}/${lines.length} 句`;
      if (result) aligned.set(target, 'aligned'); else aligned.delete(target);
      alignmentDetail.set(target, message);
      if (player?.song === target) {
        // Rebuild delayed copies and scene lyric tracks with the same seed and audio analysis.
        if (count) {
          plan(target, config);
          void player.warm(nextFrame, () => player?.song !== target, { progressive: true, startTime: Math.max(0, clock.now()) });
        }
        describe(target);
      }
      return message;
    })();
    alignmentJobs.set(target, { lines, done });
    try { return await done; }
    finally { if (alignmentJobs.get(target)?.done === done) alignmentJobs.delete(target); }
  }

  /**
   * With “提前分析下一首” on, the song after this one in the play list is read and prepared ahead while the MV plays,
   * so it shows at once when it comes (taken over at full speed if it comes first).
   */
  function prefetchNext(): void {
    if (!config.prefetch || !overlay.visible || preparing || !player?.song) return;
    const next = nextSong(client.store);
    if (!next || next.id === player.song.id || ready.has(next.id) || ahead?.job.id === next.id) return;
    if (ahead) ahead.job.cancelled = true;
    const job: Job = { id: next.id, cancelled: false, urgent: false };
    const entry: Ahead = {
      job,
      done: gather(next, job).then(g => {
        if (!job.urgent && !job.cancelled) keep(g);
        return g;
      }, () => null).finally(() => { if (ahead === entry) ahead = null; }),
    };
    ahead = entry;
  }

  let contextRetryCount = 0;
  let contextRetryTimer = 0;

  async function prepareCurrent(): Promise<void> {
    const song = playingSong(client.store);
    if (!song) { overlay.song(null); overlay.mvInfo(null); overlay.status('请先在网易云音乐中播放歌曲'); return; }
    livePlayer();
    // Already showing this song (reopened after closing): just take the loading note away.
    if (player?.song?.id === song.id && !player.warming && !player.engine.isContextLost()) { overlay.status(null); return; }
    if (preparing?.id === song.id && !preparing.cancelled) return;
    if (preparing) preparing.cancelled = true;
    // The song prepared ahead is this one: it goes on at full speed. Ahead of another song, it is dropped.
    const taken = ahead?.job.id === song.id ? ahead : null;
    if (ahead && !taken) ahead.job.cancelled = true;
    ahead = null;
    const job: Job = taken?.job ?? { id: song.id, cancelled: false, urgent: true };
    job.urgent = true;
    preparing = job;
    overlay.setBackdrop(song.cover || null);
    overlay.setStructure([], '#ffffff');
    overlay.song({ name: song.name, artists: song.artists, cover: song.cover || null });
    overlay.mvInfo(null);
    try {
      let prepared = ready.get(song.id);
      if (!prepared) {
        overlay.status('正在读取歌曲…', { progress: 0.03 });
        job.progress = (stage, p) => overlay.status(stage === 'decode' ? '正在解码音频…' : '正在分析节拍与段落…', { progress: stage === 'decode' ? 0.08 : 0.15 + 0.73 * p });
        const g = (taken && await taken.done) || await gather(song, job);
        if (job.cancelled) return;
        keep(g);
        prepared = g.song;
      }
      void alignIfNeeded(prepared);
      if (job.cancelled || !player || player.engine.isContextLost()) return;
      plan(prepared, config);
      // The progress bar shows the song's structure: its sections, the choruses and drops in the cover's colour.
      updateStructure(prepared);
      overlay.status('正在准备画面…', { progress: 0.9 });
      await player.warm(yieldToPage, () => job.cancelled, { progressive: true, startTime: Math.max(0, clock.now()) });
      if (job.cancelled || !player || player.engine.isContextLost()) return;
      contextRetryCount = 0;
      overlay.status(null);
      describe(prepared);
      preparing = null;
      prefetchNext();
    } catch (e) {
      // (The song comes off the player: 重试 used to find it “already showing” and uncover a dead canvas — black.)
      if (!(e instanceof Cancelled)) { player?.unload(); failed(e); }
    } finally {
      if (preparing === job) preparing = null;
    }
  }

  /** A failure on the waiting view, with 重试. A lost WebGL context says so (the retry makes the renderer anew). */
  function failed(e: unknown): void {
    if (player?.engine.isContextLost()) overlay.status('画面中断：显卡被重置', { error: true, hint: '点重试会重新生成画面。' });
    else overlay.status('无法生成 MV：' + ((e as Error)?.message || e), { error: true, hint: '若重试仍失败，请先在网易云中完整播放这首歌，缓存完成后再试。' });
  }

  /**
   * The MV's player, made anew when its WebGL context is lost (the GPU was reset by the driver or by another
   * program's load: every shader compiled after it fails, “parameter 1 is not of type 'WebGLShader'”, and the
   * canvas stays black until the renderer is replaced).
   */
  function livePlayer(): MvPlayer {
    if (player && player.engine.isContextLost()) {
      try { player.dispose(); } catch { /* a lost context */ }
      currentActivePlayer = player = null;
    }
    if (!player) {
      const p = player = new MvPlayer(overlay.stage, pixelRatio(config.quality));
      p.showLyrics = config.showLyrics;
      currentActivePlayer = p;
      p.resize();
      // Lost while playing: the song comes off it, and we automatically attempt recovery before falling back to manual retry.
      p.engine.renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        p.engine.contextLost = true;
        console.warn('[BetterMV] WebGL context lost; prevented default to permit recovery.');
        if (player !== p) return;
        if (preparing) {
          preparing.cancelled = true;
          preparing = null;
        }
        p.unload();
        clearTimeout(contextRetryTimer);
        if (overlay.visible && contextRetryCount < 2) {
          contextRetryCount++;
          overlay.status('正在恢复画面…', { progress: 0.5 });
          contextRetryTimer = window.setTimeout(() => {
            if (overlay.visible && player === p) void prepareCurrent();
          }, 600);
        } else {
          failed(null);
        }
      });
      p.engine.renderer.domElement.addEventListener('webglcontextrestored', () => {
        console.info('[BetterMV] WebGL context restored; recovering player.');
        if (player === p && overlay.visible) {
          clearTimeout(contextRetryTimer);
          void prepareCurrent();
        }
      });
    }
    return player;
  }

  async function open(): Promise<void> {
    overlay.maximized = isMaximized(client.store);
    syncQueue();
    overlay.show();
    overlay.status('正在准备…', { progress: 0 });
    fonts ??= loadFonts(file => readPluginFile('fonts/' + file));
    await fonts;
    livePlayer().resize();
    last = due = 0;
    if (!raf) raf = requestAnimationFrame(loop);
    await prepareCurrent();
  }

  function close(): void {
    overlay.hide();
    clearTimeout(contextRetryTimer);
    if (preparing) preparing.cancelled = true;
    if (ahead) { ahead.job.cancelled = true; ahead = null; }
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // Follow song changes while the MV is open.
  client.store.subscribe(() => {
    // NetEase's play state (2 = playing) changes the moment anything pauses it — its own controls, a media key, the
    // tray — well before the PlayState event: the picture stops with it.
    const state = client.store.getState()?.playing?.playingState;
    if (typeof state === 'number') clock.onState('', '', state === 2 ? 1 : 0);
    overlay.maximized = isMaximized(client.store);
    if (!overlay.visible) return;
    const moved = syncQueue();
    const s = playingSong(client.store);
    if (s && s.id !== player?.song?.id && s.id !== preparing?.id) void prepareCurrent();
    // (The list or the place in it changed: what comes next may have.)
    else if (moved) prefetchNext();
  });

  // Opening and leaving the MV page, from anywhere in NetEase (the key as set; not while the settings take a new one).
  window.addEventListener('keydown', e => {
    if (isRecordingKeys() || keyCombo(e) !== config.keys.toggle) return;
    e.preventDefault();
    overlay.visible ? close() : void open();
  });

  listeners.push(c => {
    clock.offset = pictureDelayMs(c, player?.song?.id) / 1000;
    overlay.showControls = c.controls;
    overlay.setKeys(c.keys);
    if (c.button && !button) button = mvButton(() => open());
    if (!c.button && button) { button.remove(); button = null; }
    if (player) {
      player.setShowLyrics(c.showLyrics);
      if (player.song && player.style) describe(player.song);
    }
    const pr = pixelRatio(c.quality);
    if (player && pr !== player.engine.renderer.getPixelRatio()) { player.engine.setPixelRatio(pr); player.resize(); }
    if (!c.prefetch && ahead) { ahead.job.cancelled = true; ahead = null; }
    prefetchNext();
    // Replanned a moment after the last change (a few scenes clicked off in a row load once).
    clearTimeout(replan);
    replan = window.setTimeout(() => {
      const song = player?.song;
      if (!song || !player || (planKey(config) === plannedWith && !needsLyricReplan(song, config))) return;
      plan(song, config);
      describe(song);
      void player.warm(nextFrame, () => player?.song !== song, { progressive: true, startTime: Math.max(0, clock.now()) });
    }, 350);
  });

  (window as any)[KEY] = { open, close, clock, get player() { return player; } };
}

plugin.onLoad(() => {
  if ((window as any)[KEY]) return;
  (window as any)[KEY] = {};
  Promise.all([findClient(), importPictureCalibration(config)]).then(([client]) => {
    if (client) start(client);
    else console.warn('[BetterMV] 未找到网易云的内部模块，插件未启动');
  });
});
