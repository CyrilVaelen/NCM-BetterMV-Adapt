// Musical time for the renderer: beat/bar position at any song time, envelopes and decaying hit pulses.
// Everything is a pure function of t, so seeking and frame drops never desync the picture.
import type { Analysis, Envelopes, Hit, Section, SectionLabel } from '../types.ts';

const LEAD_GAIN: Record<SectionLabel, number> = {
  intro: 0.55, verse: 0.65, pre: 0.75, chorus: 0.9, drop: 1,
  build: 0.85, break: 0.45, bridge: 0.6, outro: 0.4,
};
const smoothUnit = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };

/** Index of the last element ≤ t, or −1. */
export function lastIndex(times: ArrayLike<number>, t: number): number {
  let lo = 0, hi = times.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

export interface BeatInfo {
  /** Continuous beat count (beat index + phase). */
  pos: number;
  /** Phase within the current beat, 0..1. */
  phase: number;
  /** Beat position inside the bar, 0..meter (fractional). */
  inBar: number;
  bar: number;
  /** Phase within the current bar, 0..1. */
  barPhase: number;
  /** 60 / the length of this beat of the grid: for timing. The number to show is `Music.shownBpm`. */
  bpm: number;
}

export type HitKind = keyof Analysis['hits'] | 'keys' | 'leads' | 'foreground' | 'synthStab' | 'bassStab' | 'leadRole';
export type TimbreRole = 'synthStab' | 'bassStab' | 'lead';
/** How long a hit's pulse takes to come up (seconds). */
const ATTACK = 0.03;
/** 音色角色分离器（60 fps 居中窗 + 2 帧后向差分 + 单向包络滤波）对真实瞬态峰值的固有滞后（秒）。 */
const TIMBRE_HIT_LATENCY = 0.015;
/** 主奏起音检测器（100 fps 居中窗 + 40 ms 通量差分 + 单向包络滤波）对真实瞬态峰值的固有滞后（秒）。 */
const LEAD_HIT_LATENCY = 0.012;

export class Music {
  readonly beats: Float64Array;
  readonly downbeats: Float64Array;
  readonly meter: number;
  private hitTimes = new Map<HitKind, Float64Array>();
  private hitLists = new Map<HitKind, Hit[]>();
  private leadFocus:Float32Array = new Float32Array();
  private foregroundLeads=new Set<number>();
  private motionCurves=new Map<number,Float64Array>();

  constructor(readonly a: Analysis) {
    this.beats = Float64Array.from(a.beats);
    this.downbeats = Float64Array.from(a.downbeats);
    this.meter = a.meter || 4;
    for (const kind of Object.keys(a.hits) as (keyof Analysis['hits'])[]) {
      const list = a.hits[kind];
      if (list) {
        this.hitLists.set(kind, list);
        this.hitTimes.set(kind, Float64Array.from(list, h => h[0]));
      }
    }
    const keysHits = (a.hits.keys && a.hits.keys.length) ? a.hits.keys : this.extractKeysHits();
    this.hitLists.set('keys', keysHits);
    this.hitTimes.set('keys', Float64Array.from(keysHits, h => h[0]));

    const leadHits = this.extractLeadHits();
    this.hitLists.set('leads', leadHits);
    this.hitTimes.set('leads', Float64Array.from(leadHits, h => h[0]));
    const foregroundHits:Hit[]=[];
    const timbre=a.timbre;
    if(timbre) {
      this.leadFocus=timbre.leadPresence??this.legacyLeadFocus();
      const melodic=timbre.melodyAttack??Float32Array.from(timbre.leadAttack,(v,i)=>Math.max(v,timbre.synthStab[i]??0));
      const timbreLatency = timbre.melodyAttack ? TIMBRE_HIT_LATENCY : 0;
      // Arbitrate before finding events. Every event query and decaying pulse consumes these same accepted hits,
      // so a rejected bass onset cannot return later through its unfiltered decay tail.
      for (const [kind, signal] of [['synthStab', timbre.synthStab], ['bassStab', timbre.bassStab], ['leadRole', melodic]] as const) {
        const roleHits: Hit[] = [];
        let previous = -Infinity;
        for (let i = 1; i + 1 < signal.length; i++) {
          const raw = signal[i] ?? 0;
          const rawT = i / timbre.fps;
          if (raw < 0.2 || raw < signal[i - 1] || raw < signal[i + 1] || rawT - previous < 0.075) continue;
          // Arbitrate a near-simultaneous onset before the smoothed owner rises, preserving its true timestamp.
          let eventFocus=this.leadFocus[i]??0;
          for(let j=i+1;j<Math.min(signal.length,i+1+Math.ceil(.075*timbre.fps));j++)eventFocus=Math.max(eventFocus,this.leadFocus[j]??0);
          const value=raw*(kind==='leadRole'?1:1-eventFocus);
          if(value<.2)continue;
          const t = Math.max(0, rawT - timbreLatency);
          roleHits.push([Math.round(t * 1000) / 1000, Math.round(value * 1000) / 1000]);
          previous = rawT;
        }
        this.hitLists.set(kind, roleHits);
        this.hitTimes.set(kind, Float64Array.from(roleHits, h => h[0]));
      }
      const candidates=(['bassStab','synthStab','leadRole'] as const).flatMap(kind=>(this.hitLists.get(kind)??[]).map(hit=>({hit,lead:kind==='leadRole'}))).sort((a,b)=>a.hit[0]-b.hit[0]);
      let cluster:typeof candidates=[];
      const emit=()=>{
        if(!cluster.length)return;
        const lead=cluster.filter(c=>c.lead&&this.leadOwnership(c.hit[0])>.35);
        const chosen=(lead.length?lead:cluster).reduce((a,b)=>a.hit[1]>=b.hit[1]?a:b);
        if(chosen.hit[1]>=.22){foregroundHits.push(chosen.hit);if(chosen.lead)this.foregroundLeads.add(chosen.hit[0]);}
      };
      for(const candidate of candidates){if(cluster.length&&candidate.hit[0]-cluster[0].hit[0]>.075){emit();cluster=[];}cluster.push(candidate);}emit();
    }
    this.hitLists.set('foreground',foregroundHits);
    this.hitTimes.set('foreground',Float64Array.from(foregroundHits,h=>h[0]));
  }

  /**
   * 从中频包络（150-2000 Hz）与起音通量中提取键盘/电钢琴/吉他等旋律性击弦起音。
   * 当歌曲缺少重击底鼓时，用此补齐律动感。
   */
  private extractKeysHits(): Hit[] {
    const env = this.a.env;
    if (!env || !env.mid || !env.mid.length) return [];
    const mid = env.mid, onset = env.onset, fps = env.fps || 100;
    const n = mid.length;
    const hits: Hit[] = [];
    const minGapFrames = Math.max(1, Math.round(fps * 0.075)); // 75 ms 最小按键间隔（快速弹奏）
    let lastFrame = -minGapFrames;

    for (let i = 2; i < n - 2; i++) {
      const m = mid[i];
      if (m < 0.04) continue; // 音量过低，跳过静音区

      // 考察 20-30 ms 内的中频抬升（Attack 瞬态）
      const pre = mid[Math.max(0, i - 2)];
      const dMid = m - pre;
      if (dMid <= 0.025) continue;

      const ons = onset ? onset[i] : 0;
      // 综合活跃度得分：中频正向差分 + 谱通量
      const score = dMid * 1.6 + ons * 0.45 * (m + 0.2);
      if (score < 0.12) continue;

      // 局部极大值判断
      if (mid[i] < mid[i - 1] || mid[i] < mid[i + 1]) continue;
      if (i - lastFrame < minGapFrames) continue;

      const t = Math.max(0, i / fps - 0.015); // 补偿约 15 ms 的检测延迟
      const strength = Math.min(1.0, Math.max(0.15, score * 1.6));
      hits.push([Math.round(t * 1000) / 1000, Math.round(strength * 1000) / 1000]);
      lastFrame = i;
    }
    return hits;
  }

  /**
   * 从主导音起音包络（leadAttack）中提取电子乐/流行乐的高能和弦切片、Supersaw Stab 与主奏瞬态点。
   */
  private extractLeadHits(): Hit[] {
    const env = this.a.env;
    if (!env || !env.leadAttack || !env.leadAttack.length) return [];
    const atk = env.leadAttack, fps = env.fps || 100;
    const n = atk.length;
    const hits: Hit[] = [];
    const minGapFrames = Math.max(1, Math.round(fps * 0.075)); // 75 ms 最小切片间隔
    let lastFrame = -minGapFrames;

    for (let i = 2; i < n - 2; i++) {
      const v = atk[i];
      if (v < 0.28) continue; // 忽略微弱泛音
      // 局部极大值判断
      if (v <= atk[i - 1] || v < atk[i + 1]) continue;
      if (i - lastFrame < minGapFrames) continue;

      const t = Math.max(0, i / fps - LEAD_HIT_LATENCY); // 补偿约 12 ms 的主奏起音检测滞后
      hits.push([Math.round(t * 1000) / 1000, Math.round(Math.min(1, v) * 1000) / 1000]);
      lastFrame = i;
    }
    return hits;
  }

  get duration(): number { return this.a.duration; }

  /** Where the song's closing outro starts (the run of outro sections at the very end), or Infinity if it has none. */
  get ending(): number {
    const s = this.a.sections;
    let i = s.length;
    while (i > 0 && s[i - 1].label === 'outro') i--;
    return i < s.length ? s[i].start : Infinity;
  }

  /** 0..1 through the closing outro (0 before it). */
  endingProgress(t: number): number {
    const from = this.ending;
    return t <= from ? 0 : Math.min(1, (t - from) / Math.max(1, this.duration - from - 1));
  }

  private period(i: number): number {
    const b = this.beats, n = b.length;
    if (n < 2) return 60 / (this.a.bpm || 120);
    const k = Math.max(0, Math.min(n - 2, i));
    return b[k + 1] - b[k];
  }

  beatPos(t: number): number {
    const b = this.beats, n = b.length;
    if (!n) return (t * (this.a.bpm || 120)) / 60;
    const i = lastIndex(b, t);
    if (i < 0) return (t - b[0]) / this.period(0);
    if (i >= n - 1) return n - 1 + (t - b[n - 1]) / this.period(n - 2);
    return i + (t - b[i]) / (b[i + 1] - b[i]);
  }

  timeOfBeat(pos: number): number {
    const b = this.beats, n = b.length;
    if (!n) return (pos * 60) / (this.a.bpm || 120);
    if (pos <= 0) return b[0] + pos * this.period(0);
    if (pos >= n - 1) return b[n - 1] + (pos - (n - 1)) * this.period(n - 2);
    const i = Math.floor(pos);
    return b[i] + (pos - i) * (b[i + 1] - b[i]);
  }

  at(t: number): BeatInfo {
    const pos = this.beatPos(t);
    const i = Math.floor(pos), phase = pos - i;
    const bi = Math.max(0, Math.min(this.a.beatInBar.length - 1, i));
    const inBarIndex = i < 0 ? ((i % this.meter) + this.meter) % this.meter : this.a.beatInBar[bi] ?? 0;
    const bar = Math.max(0, lastIndex(this.downbeats, t));
    const d = this.downbeats;
    const barStart = d.length ? d[bar] : 0;
    const barEnd = bar + 1 < d.length ? d[bar + 1] : barStart + this.period(i) * this.meter;
    return {
      pos, phase, inBar: inBarIndex + phase, bar,
      barPhase: Math.max(0, Math.min(1, (t - barStart) / Math.max(1e-3, barEnd - barStart))),
      bpm: 60 / this.period(i),
    };
  }

  /** Per beat, the tempo to show (see shownBpm); made on first use. */
  private shown?: Float32Array;

  /**
   * The tempo to show at t (the HUD, a plate's label), in named BPM: the song's tempo while the grid keeps within 3 %
   * of it, else the local tempo (the median of the 8 beat intervals around t). One beat's interval jitters by a few
   * per cent where the grid is the tracker's rather than a locked one; shown as it was, the number changed every beat.
   */
  shownBpm(t: number): number {
    if (!this.shown) {
      const b = this.beats, n = b.length, grid = this.a.bpm || 120, named = this.a.namedBpm || grid, scale = named / grid;
      const out = new Float32Array(Math.max(1, n - 1)).fill(named);
      const iv: number[] = [];
      for (let i = 0; i + 1 < n; i++) {
        iv.length = 0;
        for (let j = Math.max(0, i - 4); j < Math.min(n - 1, i + 4); j++) iv.push(b[j + 1] - b[j]);
        iv.sort((x, y) => x - y);
        const local = 60 / iv[iv.length >> 1];
        out[i] = Math.abs(local / grid - 1) <= 0.03 ? named : local * scale;
      }
      this.shown = out;
    }
    return this.shown[Math.max(0, Math.min(this.shown.length - 1, Math.floor(this.beatPos(t))))];
  }

  /** Envelope value with linear interpolation. */
  env(name: keyof Omit<Envelopes, 'fps'>, t: number): number {
    const e = this.a.env, arr = e[name];
    if (!arr) return 0;
    const x = t * e.fps;
    const i = Math.floor(x);
    if (i < 0) return arr[0] ?? 0;
    if (i >= arr.length - 1) return arr[arr.length - 1] ?? 0;
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  /** Extra physical movement inside a Drop; independent of playback history. */
  dropIntensity(t: number): number {
    const s = this.section(t);
    if (!s || s.label !== 'drop' || t < s.start || t >= s.end) return 0;
    return smoothUnit((t-s.start)/0.12) * smoothUnit((s.end-t)/0.18);
  }

  /** Whole-song melodic movement. Section gains crossfade without resetting a held note. */
  private sectionLeadGain(t: number): number {
    const sections = this.a.sections, i = this.sectionIndex(t), section = sections[i];
    if (!section || t < 0 || t >= this.duration) return 0;
    let gain = LEAD_GAIN[section.label];
    const previous = sections[i - 1], next = sections[i + 1];
    const halfWidth = (a: Section, b: Section) => Math.max(0.001, Math.min(0.45, (a.end-a.start)/4, (b.end-b.start)/4));
    if (previous) {
      const w = halfWidth(previous, section);
      const k = smoothUnit((t-section.start+w)/(2*w));
      gain = LEAD_GAIN[previous.label] + (gain-LEAD_GAIN[previous.label])*k;
    }
    if (next) {
      const w = halfWidth(section, next);
      const k = smoothUnit((t-section.end+w)/(2*w));
      gain += (LEAD_GAIN[next.label]-gain)*k;
    }
    gain *= smoothUnit(t/0.2) * smoothUnit((this.duration-t)/0.5);
    return gain;
  }

  leadAt(t: number): { level: number; attack: number; brightness: number } {
    const section = this.a.sections[this.sectionIndex(t)];
    if (!section || t < 0 || t >= this.duration) return {level:0,attack:0,brightness:0.5};
    const gain = this.sectionLeadGain(t);
    return {level:this.env('lead',t)*gain,attack:this.env('leadAttack',t)*gain,
      brightness:this.a.env.leadBrightness ? this.env('leadBrightness',t) : 0.5};
  }

  /** The role estimate drives accents in every section and every scene, including the softer looks. */
  selectiveAt(t:number):boolean { return !!this.a.timbre && t>=0 && t<this.duration; }

  /** Compatibility for v6 analyses. Newly analysed songs carry independent upper-voice ownership. */
  private legacyLeadFocus():Float32Array {
    const v=this.a.timbre!,out=new Float32Array(v.lead.length);
    let last=-Infinity,owner=false,value=0;
    for(let i=0;i<out.length;i++) {
      const brightness=v.leadBrightness?.[i]??this.env('leadBrightness',i/v.fps);
      if(v.lead[i]>=.2&&brightness>=.24){last=i;owner=true;}
      if(i-last>.26*v.fps)owner=false;
      value+=(Number(owner)-value)*(1-Math.exp(-1/(v.fps*(owner ? .025 : .13))));out[i]=value;
    }
    return out;
  }

  /** Stable voice ownership; seeking never changes this decision. */
  leadOwnership(t:number):number {
    const v=this.a.timbre;if(!v||t<0||t>=this.duration)return 0;
    const x=t*v.fps,i=Math.min(this.leadFocus.length-1,Math.floor(x)),f=x-i;
    return (this.leadFocus[i]??0)+((this.leadFocus[i+1]??this.leadFocus[i]??0)-(this.leadFocus[i]??0))*f;
  }

  timbreAt(t:number):{synthStab:number;bassStab:number;lead:number;leadAttack:number;accent:number;brightness:number;confidence:number} {
    const v=this.a.timbre;
    const off={synthStab:0,bassStab:0,lead:0,leadAttack:0,accent:0,brightness:.5,confidence:0};
    if(!v || t<0 || t>=this.duration)return off;
    const x=t*v.fps,i=Math.min(v.lead.length-1,Math.floor(x)),f=x-i;
    const read=(a:Float32Array)=>a[i]+((a[i+1]??a[i])-a[i])*f;
    const synthStab=read(v.synthStab),bassStab=read(v.bassStab),leadAttack=read(v.leadAttack);
    return {synthStab,bassStab,leadAttack,lead:read(v.lead),accent:smoothUnit((Math.max(synthStab,bassStab,leadAttack)-.15)/.7),brightness:read(v.brightness),confidence:read(v.confidence)};
  }

  foregroundAt(t:number):{level:number;attack:number;brightness:number} {
    if(!this.selectiveAt(t))return this.leadAt(t);
    const v=this.timbreAt(t),focus=this.leadOwnership(t),voice=this.a.timbre!;
    // The section controls atmosphere, not whether a confirmed leading instrument can move the subject.
    // A corrected long intro/outro must not mute the same keyboard phrase that was formerly labelled Drop.
    // Bass-only passages retain their section gain; preserve the existing start/end fades on every source.
    const melodicFloor=.85*focus*smoothUnit(t/.2)*smoothUnit((this.duration-t)/.5);
    const gain=Math.max(this.sectionLeadGain(t),melodicFloor);
    const x=t*voice.fps,i=Math.min(voice.lead.length-1,Math.floor(x)),f=x-i;
    const read=(a:Float32Array)=>a[i]+((a[i+1]??a[i])-a[i])*f;
    const attack=voice.melodyAttack?read(voice.melodyAttack):Math.max(v.leadAttack,v.synthStab);
    const brightness=voice.leadBrightness?read(voice.leadBrightness):this.leadAt(t).brightness;
    return {level:((1-focus)*Math.max(v.lead,.65*v.bassStab,.35*v.synthStab)+focus*v.lead)*gain,
      attack:((1-focus)*v.accent+focus*attack)*gain,brightness:(1-focus)*v.brightness+focus*brightness};
  }

  /** Bright-event candidates come from the estimated foreground throughout the song, never percussion alone. */
  highlightHits(t0:number,t1:number):Hit[] {
    if (this.a.timbre) return this.hitsBetween('foreground',t0,t1);
    return [...this.hitsBetween('leads',t0,t1), ...this.hitsBetween('keys',t0,t1)].sort((a,b)=>a[0]-b[0]);
  }

  /** Existing low-voice effects yield smoothly when a lead arrives, including rings already in flight. */
  foregroundEventWeight(eventTime:number,t:number):number {
    return !this.a.timbre||this.foregroundLeads.has(eventTime)?1:1-this.leadOwnership(t);
  }

  /** Integrate accepted velocity so a bass surge yielding to lead never moves the camera backwards on a seek. */
  foregroundSpeed(t:number,decay=.12):number {
    const hits=this.hitLists.get('foreground')??[],times=this.hitTimes.get('foreground')??[];
    let speed=0;
    for(let i=lastIndex(times,t);i>=0&&t-hits[i][0]<decay*9;i--){
      const h=hits[i];speed+=h[1]/decay*Math.exp(-(t-h[0])/decay)*this.foregroundEventWeight(h[0],t);
    }
    return speed;
  }
  foregroundMotion(t:number,decay=.12):number {
    const fps=120;
    let curve=this.motionCurves.get(decay);
    if(!curve){
      curve=new Float64Array(Math.ceil(this.duration*fps)+1);
      for(let i=1;i<curve.length;i++)curve[i]=curve[i-1]+this.foregroundSpeed((i-.5)/fps,decay)/fps;
      this.motionCurves.set(decay,curve);
    }
    const x=Math.max(0,Math.min(curve.length-1,t*fps)),i=Math.floor(x);
    return curve[i]+((curve[i+1]??curve[i])-curve[i])*(x-i);
  }

  /** Instrument-specific event times used by every scene's sharp accents and moving highlights. */
  roleHits(role:TimbreRole,t0:number,t1:number):Hit[] {
    if (this.a.timbre) {
      return this.hitsBetween(role === 'lead' ? 'leadRole' : role,t0,t1);
    }
    const kind = role === 'bassStab' ? 'kick' : role === 'synthStab' ? 'snare' : 'keys';
    if (role !== 'lead') return this.hitsBetween(kind,t0,t1);
    return [...this.hitsBetween('leads',t0,t1),...this.hitsBetween('keys',t0,t1)].sort((a,b)=>a[0]-b[0]);
  }

  /** 单一类型打击事件在 t 时刻的衰减脉冲强度（纯函数，0..1）。 */
  private rawPulse(kind: HitKind, t: number, decay: number): number {
    const times = this.hitTimes.get(kind);
    const list = this.hitLists.get(kind);
    if (!times || !times.length || !list) return 0;
    const i = lastIndex(times, t);
    if (i < 0) return 0;
    const at = (j: number): number => {
      const hit = list[j];
      if (!hit) return 0;
      const age = t - hit[0];
      const weight=kind==='foreground'?this.foregroundEventWeight(hit[0],t):1;
      if (age >= ATTACK) return weight * hit[1] * Math.exp(-(age - ATTACK) / decay);
      const x = age / ATTACK;
      return weight * hit[1] * x * x * (3 - 2 * x);
    };
    return i > 0 ? Math.max(at(i), at(i - 1)) : at(i);
  }

  /**
   * Strength of the latest hit of a kind, decaying exponentially (seconds). It comes up over 30 ms rather than in one
   * frame, and the hit before carries on decaying underneath, so nothing driven by it (a zoom, a swell, a light)
   * jumps: a punch on the beat, not a jolt (the user: “动画曲线不好”).
   *
   * 当查询 'kick' 时：若歌曲处于无底鼓段落（如电钢琴/键盘独奏、抒情主歌），自动融合中频键位起音（'keys'），
   * 使画面自然跟随电钢琴的弹奏律动起伏；有重底鼓时则依然保持底鼓的主导地位。
   */
  pulse(kind: HitKind, t: number, decay = 0.16): number {
    const raw = this.rawPulse(kind, t, decay);
    const focus=this.leadOwnership(t);
    if ((kind === 'bassStab'||kind==='synthStab')&&this.selectiveAt(t))return raw*(1-focus);
    if (kind === 'foreground' || kind === 'synthStab' || kind === 'bassStab' || kind === 'leadRole') return raw;
    if (this.selectiveAt(t)) {
      // Route each old percussion-shaped pulse to the closest musical voice, in every scene and section.
      const role: HitKind = kind === 'kick' ? 'bassStab' : kind === 'snare' ? 'synthStab' : 'leadRole';
      const voice=(1-focus)*this.rawPulse(role,t,decay)+focus*this.rawPulse('leadRole',t,decay);
      return Math.max(raw*(.12-.08*focus),voice);
    }
    if (kind === 'kick') {
      const keys = this.rawPulse('keys', t, decay);
      return Math.max(raw, keys * 0.75);
    }
    return raw;
  }

  /** Hits of a kind inside [t0, t1). */
  hitsBetween(kind: HitKind, t0: number, t1: number): Hit[] {
    const times = this.hitTimes.get(kind);
    const list = this.hitLists.get(kind);
    if (!times || !list) return [];
    const out: Hit[] = [];
    for (let i = Math.max(0, lastIndex(times, t0)); i < times.length && times[i] < t1; i++) {
      if (times[i] >= t0) out.push(list[i]);
    }
    return out;
  }

  sectionIndex(t: number): number {
    const s = this.a.sections;
    for (let i = 0; i < s.length; i++) if (t < s[i].end) return i;
    return s.length - 1;
  }

  section(t: number): Section {
    return this.a.sections[this.sectionIndex(t)];
  }

  downbeatAtOrAfter(t: number): number {
    const d = this.downbeats, i = lastIndex(d, t - 1e-6);
    return i + 1 < d.length ? d[i + 1] : this.duration;
  }

  /** Nearest downbeat to t. */
  snapToDownbeat(t: number): number {
    const d = this.downbeats;
    if (!d.length) return t;
    const i = Math.max(0, lastIndex(d, t));
    const a = d[i], b = i + 1 < d.length ? d[i + 1] : a;
    return Math.abs(t - a) <= Math.abs(b - t) ? a : b;
  }

  /**
   * 12 半音音高色度向量 (10 fps, 0=C, 1=C#, 2=D, ... 11=B)，每个分量 0..1。
   */
  chromaAt(t: number, out?: Float32Array): Float32Array {
    const res = out || new Float32Array(12);
    res.fill(0);
    const env = this.a.env;
    if (!env || !env.chroma || !env.chroma.length) return res;
    const chromaFps = 10;
    const x = t * chromaFps;
    const i = Math.floor(x);
    const u = x - i;
    const n = (env.chroma.length / 12) | 0;
    const i0 = Math.max(0, Math.min(n - 1, i));
    const i1 = Math.max(0, Math.min(n - 1, i + 1));
    const o0 = i0 * 12, o1 = i1 * 12;
    for (let k = 0; k < 12; k++) {
      res[k] = env.chroma[o0 + k] + (env.chroma[o1 + k] - env.chroma[o0 + k]) * u;
    }
    return res;
  }

  /**
   * 获取当前时刻的主音高信息（主音半音索引 0..11、能量强度 0..1、以及在 360° 环形空间上的质心方位角 0..2π）。
   */
  pitchAt(t: number): { note: number; strength: number; angle: number } {
    const c = this.chromaAt(t);
    let maxVal = 0, bestNote = 0;
    let sumX = 0, sumY = 0, sumVal = 0;
    for (let k = 0; k < 12; k++) {
      const v = c[k];
      if (v > maxVal) { maxVal = v; bestNote = k; }
      const rad = (k / 12) * Math.PI * 2;
      sumX += Math.cos(rad) * v;
      sumY += Math.sin(rad) * v;
      sumVal += v;
    }
    let angle = Math.atan2(sumY, sumX);
    if (angle < 0) angle += Math.PI * 2;
    const strength = Math.min(1, maxVal);
    return { note: bestNote, strength, angle };
  }
}
