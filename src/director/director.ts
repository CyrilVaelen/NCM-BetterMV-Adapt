// Turns the analysis into shots for a style: which scene, which camera, cut on which beat, how each cut lands.
// With `accelerate`, builds speed up towards a louder section. A continuous Drop holds its scene and camera;
// only a clearly audible full-mix pause can open another shot inside it.
import * as THREE from 'three';
import type { Music } from './music.ts';
import type { LyricTrack } from './lyrics.ts';
import type { FrameCtx, LookId, MvScene, SceneId, Shot } from '../scenes/types.ts';
export type { LookId } from '../scenes/types.ts';
import { clamp01, rng, smooth } from '../scenes/types.ts';
import type { Palette } from '../render/palette.ts';
import { defaultFx, type Fx } from '../render/engine.ts';
import { THROUGH_CUT, TransitionKind, type Transition } from '../render/shots.ts';
import { PLATE_LENS } from '../render/lens.ts';
import { MgOverlay } from './overlay.ts';
import { Armillary, type ArmillarySpec } from '../sigil/armillary.ts';
import { SECTION_LABELS, type LyricLine, type Section } from '../types.ts';
import { norm } from './lyrics.ts';
import { analyzeSongVibe, sceneAffinity, STYLES, type Plate, type SongTraits, type Style } from '../style/style.ts';
import { lastIndex } from './music.ts';

/** A conservative full-mix pause detector: note gaps, missing kicks and a quieter bass are not edit points. */
function dropPauseCuts(music: Music, section: Section): number[] {
  const { rms, fps } = music.a.env;
  if (!(fps > 0) || !rms.length) return [];
  const first = Math.max(0, Math.ceil(section.start * fps)), end = Math.min(rms.length, Math.floor(section.end * fps));
  if (end <= first) return [];
  const quantile = (from: number, to: number, q: number): number => {
    const values = Array.from(rms.slice(Math.max(first, from), Math.min(end, to))).filter(Number.isFinite).sort((a, b) => a - b);
    return values.length ? values[Math.floor((values.length - 1) * q)] : 0;
  };
  const active = quantile(first, end, 0.7);
  // Missing/near-silent legacy envelopes provide no evidence for a cut.
  if (active < 0.08) return [];
  const quiet = Math.min(0.12, active * 0.18), cuts: number[] = [];
  let previous = section.start;
  for (let i = first; i < end;) {
    if (!Number.isFinite(rms[i]) || rms[i] > quiet) { i++; continue; }
    const from = i;
    while (i < end && Number.isFinite(rms[i]) && rms[i] <= quiet) i++;
    const to = i, t = (from + to) / (2 * fps);
    const beat = 60 / Math.max(40, music.at(t).bpm), bar = beat * music.meter;
    // The RMS follower already has a 90 ms release: a sustained low valley here is a real audible stop,
    // rather than the tiny valleys between normal rhythmic attacks.
    if ((to - from) / fps < Math.max(0.4, Math.min(0.8, beat * 0.9))) continue;
    if (t - previous < Math.max(2, bar * 2) || section.end - t < Math.max(1, bar)) continue;
    const flank = Math.round(Math.max(1, beat * 3) * fps);
    if (quantile(from - flank, from, 0.7) < active * 0.5 || quantile(to, to + flank, 0.7) < active * 0.5) continue;
    cuts.push(t);
    previous = t;
  }
  return cuts;
}

/** Cut times inside a section, on downbeats (and on beats at the end of a build). */
function cutTimes(music: Music, style: Style, section: Section, next: Section | undefined): number[] {
  if (section.label === 'drop') return [section.start, ...dropPauseCuts(music, section), section.end];
  const beats = Array.from(music.beats).filter(b => b > section.start + 0.05 && b < section.end - 0.05);
  const downs = Array.from(music.downbeats).filter(d => d > section.start + 0.05 && d < section.end - 0.05);
  const cuts = [section.start];
  const per = style.baseBars(section);
  const hero = style.heroBars?.(section) ?? per;
  const rising = style.accelerate && !!next && next.energy > section.energy + 0.08 && section.label !== 'intro';
  const accelFrom = rising ? Math.max(0, downs.length + 1 - 4) : Infinity;
  for (let i = 0; i < downs.length; i++) {
    const bar = i + 1;
    if (bar >= accelFrom || (bar >= hero && bar % per === 0)) cuts.push(downs[i]);
  }
  if (rising) {
    const lastTwo = downs.length >= 2 ? downs[downs.length - 2] : section.start;
    for (const b of beats) if (b > lastTwo + 0.05 && !cuts.some(c => Math.abs(c - b) < 0.05)) cuts.push(b);
  }
  cuts.sort((a, b) => a - b);
  cuts.push(section.end);
  return cuts;
}

/** 使用确定性伪随机数执行加权轮盘赌抽样 */
function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, rand: () => number): T {
  let total = 0;
  const weights: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const w = Math.max(0, weightOf(items[i]));
    weights.push(w);
    total += w;
  }
  if (!(total > 0)) return items[Math.floor(rand() * items.length)] ?? items[0];
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

const STYLE_SIGNATURE: Partial<Record<Style['id'], SceneId>> = {
  velvet: 'velvet',
  ink: 'ink',
};

/**
 * The plates a section may use once the ones the user turned off (the settings page) are taken out. A section left
 * with none borrows the plates this song's other sections use, then any style's (each borrowing section opening on a
 * different one); only when every plate is off does it keep its own.
 */
function allowed(pool: Plate[], off: ReadonlySet<string>, sections: Section[], index: number, style: Style, song: SongTraits): Plate[] {
  const keep = (list: Plate[]) => list.filter(p => !off.has(p.scene));
  const left = keep(pool);
  if (left.length || !off.size) return left;
  const spare = new Map<SceneId, Plate>();
  const others = Object.values(STYLES).filter(s => s !== style);
  for (const from of [style, ...others]) {
    for (const s of from === style ? sections : SECTION_LABELS.map(label => ({ ...sections[0], label }))) {
      for (const p of keep(from.pool(s, song))) if (!spare.has(p.scene)) spare.set(p.scene, p);
    }
    if (spare.size) break;
  }
  if (!spare.size) return pool;
  const list = [...spare.values()], k = index % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

/** `off`: plates the user turned off in the settings (the armillary's and the opening's own shots included). */
export function planShots(music: Music, style: Style, songSeed: number, song: SongTraits, off: ReadonlySet<string> = new Set()): Shot[] {
  const shots: Shot[] = [];
  const sections = music.a.sections;
  const vibe = analyzeSongVibe(music.a, song);
  const signature = STYLE_SIGNATURE[style.id];
  // Analysis may divide a Drop or Outro into repeated phrases. Those labels are not audible pauses: share one
  // section, scene, seed and camera clock over their whole uninterrupted span without rewriting the analysis itself.
  const spans: Array<{ section: Section; sectionIndex: number }> = [];
  sections.forEach((section, sectionIndex) => {
    const previous = spans[spans.length - 1];
    if ((section.label === 'drop' || section.label === 'outro') && previous?.section.label === section.label && Math.abs(previous.section.end - section.start) < 0.05) {
      previous.section = { ...previous.section, end: section.end, energy: Math.max(previous.section.energy, section.energy), vocal: previous.section.vocal || section.vocal };
    } else spans.push({ section, sectionIndex });
  });
  let prevScene = '', prevVariant = '';
  const used = new Map<string, number>(); // 场景全曲累计出场次数
  const usedVariants = new Map<string, number>(); // 场景机位全曲累计出场次数
  const sectionHeroes = new Map<string, Set<SceneId>>(); // 各段落类型已使用过的首镜场景，防止连续两次高潮撞同一首镜
  const barLen = (t: number) => (60 / Math.max(40, music.at(t).bpm)) * music.meter;
  spans.forEach(({ section, sectionIndex }, spanIndex) => {
    let pool = allowed(style.pool(section, song), off, sections, sectionIndex, style, song);
    const precedingDrop=section.label==='outro'?spans.slice(0,spanIndex).reverse().find(s=>s.section.label==='drop')?.section:undefined;
    if(precedingDrop){
      // The closing plate must differ from every plate used by the immediately preceding Drop, not just the last
      // shot. The section hero is selected independently, so the ordinary within-section no-repeat rule is not enough.
      const usedInDrop=new Set(shots.filter(s=>s.section.label==='drop'&&s.start<precedingDrop.end&&s.end>precedingDrop.start).map(s=>s.scene));
      const distinct=pool.filter(p=>!usedInDrop.has(p.scene));
      if(distinct.length)pool=distinct;
      else{
        const borrowed=Object.values(STYLES).flatMap(other=>other.pool(section,song))
          .filter(p=>!off.has(p.scene)&&!usedInDrop.has(p.scene));
        if(borrowed.length)pool=borrowed.filter((p,i)=>borrowed.findIndex(q=>q.scene===p.scene)===i);
      }
    }
    const cuts = cutTimes(music, style, section, spans[spanIndex + 1]?.section);
    const random = rng((songSeed ^ (sectionIndex * 2654435761)) >>> 0);

    // 段落首镜（Hero Shot）加权概率抽取：从母风格精英候选池中结合歌曲子流派/声学亲和度抽取，并规避同类型段落重复开场
    const heroEligible = pool.filter(p => (p.hero ?? 0) > 0);
    const rawHeroPool = heroEligible.length ? heroEligible : pool;
    const nonPrevHero = rawHeroPool.filter(p => p.scene !== prevScene);
    const heroCandidates = nonPrevHero.length ? nonPrevHero : rawHeroPool;
    const priorHeroes = sectionHeroes.get(section.label);
    let freshHeroes = priorHeroes ? heroCandidates.filter(p => !priorHeroes.has(p.scene)) : heroCandidates;
    if (!freshHeroes.length && priorHeroes) {
      priorHeroes.clear();
      freshHeroes = heroCandidates;
    }
    const activeHeroPool = freshHeroes;
    const sigPlate = signature && !(used.get(signature) ?? 0) && (section.label === 'chorus' || section.label === 'drop' || spanIndex >= spans.length - 2)
      ? activeHeroPool.find(p => p.scene === signature) ?? heroCandidates.find(p => p.scene === signature)
      : undefined;
    const hero = sigPlate ?? (activeHeroPool.length === 1
      ? activeHeroPool[0]
      : pickWeighted(activeHeroPool, p => {
        const base = p.hero ?? p.weight ?? 1;
        const aff = sceneAffinity(p.scene, section, style, vibe, song);
        const songDecay = Math.pow(0.72, used.get(p.scene) ?? 0);
        const sigBoost = signature === p.scene && !(used.get(p.scene) ?? 0) ? 1.8 : 1;
        return base * aff * songDecay * sigBoost;
      }, random));
    if (!priorHeroes) sectionHeroes.set(section.label, new Set<SceneId>([hero.scene]));
    else priorHeroes.add(hero.scene);

    let plate = hero;
    const here = new Map<string, number>([[hero.scene, 1]]);
    for (let i = 0; i + 1 < cuts.length; i++) {
      if (cuts[i + 1] - cuts[i] < 0.12) continue;
      // Shots shorter than a bar (the end of a build) keep the plate and only change the camera.
      const short = cuts[i + 1] - cuts[i] < barLen(cuts[i]) * 0.9;
      if (i === 0) plate = hero; // a section opens on its hero plate
      else if (!short) {
        // 段内后续镜头：结合母风格基础权重、歌曲声学/曲风亲和度、本段强冷却（0.16^n）与全曲温和冷却（0.68^n）加权采样
        const candidates = pool.length > 1 ? pool.filter(p => p.scene !== prevScene) : pool;
        plate = candidates.length <= 1
          ? (candidates[0] ?? pool[0])
          : pickWeighted(candidates, p => {
            const base = p.weight ?? 1;
            const aff = sceneAffinity(p.scene, section, style, vibe, song);
            const sectionDecay = Math.pow(0.16, here.get(p.scene) ?? 0);
            const songDecay = Math.pow(0.76, used.get(p.scene) ?? 0);
            return base * aff * sectionDecay * songDecay;
          }, random);
        here.set(plate.scene, (here.get(plate.scene) ?? 0) + 1);
      }
      const variants = plate.variants;
      const validVariants = plate.scene === prevScene && variants.length > 1
        ? variants.filter(v => v !== prevVariant)
        : variants;
      const variant = validVariants.length <= 1
        ? (validVariants[0] ?? variants[0])
        : pickWeighted(validVariants, v => Math.pow(0.45, usedVariants.get(`${plate.scene}:${v}`) ?? 0), random);
      used.set(plate.scene, (used.get(plate.scene) ?? 0) + 1);
      usedVariants.set(`${plate.scene}:${variant}`, (usedVariants.get(`${plate.scene}:${variant}`) ?? 0) + 1);
      prevScene = plate.scene;
      prevVariant = variant;
      shots.push({ scene: plate.scene, start: cuts[i], end: cuts[i + 1], section, sectionIndex, variant, seed: (songSeed * 131 + shots.length * 7919) >>> 0 });
    }
  });
  joinRuns(shots, barLen);
  // Most plays end on the canvas rising over the cover this song has painted; the others on the armillary closing up
  // (under ink the canvas is a brush writing the cover on rice paper, and there is no armillary).
  const lastTime=music.a.sections[music.a.sections.length-1]?.end;
  const outroSpanIndex=spans.findIndex(s=>s.section.label==='outro'&&s.section.end===lastTime);
  const closingDrop=outroSpanIndex>0?spans.slice(0,outroSpanIndex).reverse().find(s=>s.section.label==='drop')?.section:undefined;
  const closingDropScenes=new Set(closingDrop?shots.filter(s=>s.section.label==='drop'&&s.start<closingDrop.end&&s.end>closingDrop.start).map(s=>s.scene):[]);
  // Canvas is a Drop plate in some styles. If the closing Drop used it, choose a different ending image as well.
  const finaleRoll=rng((songSeed ^ 0xf1a1e) >>> 0)() < 0.6;
  const finale=finaleRoll&&!off.has('canvas')&&!closingDropScenes.has('canvas');
  if (!off.has('crystal')) placeArmillary(shots, music, style, songSeed, !finale);
  if (finale) placeFinale(shots, music, songSeed);
  return off.has('cards') ? shots : placeOpening(shots, music, songSeed);
}

/**
 * The speeding-up cuts at the end of a build keep the plate and change only the camera, and each shot used to start
 * its camera move afresh: the same move replayed on every beat, which the user saw as a twitch (“快速循环一个动作，看起来
 * 就和抽搐了一样”; the outro of a two-bar build cut eight times onto the one camera its plate has). Now consecutive
 * shots that would look the same (same plate and camera, same kind of section, one of them under a bar) are one shot,
 * and a run of shorter shots on one plate shares one clock for its moves (Shot.run).
 */
function joinRuns(shots: Shot[], barLen: (t: number) => number): void {
  const short = (s: Shot) => s.end - s.start < barLen(s.start) * 0.9;
  // (Whether a shot was cut under a bar, kept through the merging: joined pieces can add up to a bar.)
  const hurried = shots.map(short);
  for (let i = shots.length - 1; i > 0; i--) {
    const a = shots[i - 1], b = shots[i];
    if (a.scene === b.scene && a.variant === b.variant && a.section.label === b.section.label && (hurried[i - 1] || hurried[i])) {
      a.end = b.end;
      hurried[i - 1] = true;
      shots.splice(i, 1);
      hurried.splice(i, 1);
    }
  }
  for (let i = 0; i < shots.length;) {
    let j = i + 1;
    while (j < shots.length && shots[j].scene === shots[i].scene && shots[j].section === shots[i].section && short(shots[j])) j++;
    if (j - i >= 2) for (let k = i; k < j; k++) shots[k].run = { start: shots[i].start, end: shots[j - 1].end };
    i = j;
  }
}

/**
 * The opening cards over the intro's first two bars (one bar if that is all there is before anything else starts);
 * none when the song opens straight into something else.
 */
function placeOpening(shots: Shot[], music: Music, songSeed: number): Shot[] {
  const first = music.a.sections[0], downs = music.downbeats;
  if (!first || first.label !== 'intro' || !shots.length) return shots;
  const inIntro = Array.from(downs).filter(d => d > 0.3 && d <= first.end + 0.05);
  const end = inIntro.length >= 3 ? inIntro[2] : inIntro.length >= 2 ? inIntro[1] : NaN;
  if (!(end > 1.5)) return shots;
  const out: Shot[] = [{ scene: 'cards', start: 0, end, section: first, sectionIndex: 0, variant: 'stack', seed: (songSeed * 131 + 7) >>> 0 }];
  for (const s of shots) {
    if (s.end <= end + 1e-3) continue;
    out.push(s.start < end ? { ...s, start: end } : s);
  }
  return out;
}

/**
 * The song's armillary gets two shots of its own (scene id 'crystal', the figure it replaced): the last bar or two
 * before the first drop (bullet time round it, then the push down its rings, in the styles that punch into drops), and
 * the song's last bars (its rings closing up; not in ink, whose paper it would black out).
 */
/** Puts a shot of its own over [from, to), trimming the shots it overlaps. (Also the films' cuts, film/reel.ts.) */
export function carve(shots: Shot[], music: Music, scene: SceneId, from: number, to: number, sectionIndex: number, variant: string, songSeed: number): void {
  if (to - from < 0.8) return;
  const out: Shot[] = [];
  for (const s of shots) {
    if (s.end <= from + 1e-3 || s.start >= to - 1e-3) { out.push(s); continue; }
    // Shots overlapping the new one keep what lies outside it.
    if (s.start < from - 0.05) out.push({ ...s, end: from });
    if (s.end > to + 0.05) out.push({ ...s, start: to });
  }
  out.push({ scene, start: from, end: to, section: music.a.sections[sectionIndex], sectionIndex, variant, seed: (songSeed * 131 + Math.round(from * 1000)) >>> 0 });
  out.sort((a, b) => a.start - b.start);
  shots.length = 0;
  shots.push(...out);
}

/**
 * The canvas over the end of the song: from the start of a closing outro (if it is between 6 and 45 seconds long),
 * else the last 12 seconds or so, in one shot — the brush finishes and the camera rises over the whole picture.
 */
function placeFinale(shots: Shot[], music: Music, songSeed: number): void {
  const sections = music.a.sections, downs = music.downbeats;
  if (!sections.length) return;
  const end = sections[sections.length - 1].end, outro = music.ending;
  let from = Number.isFinite(outro) && end - outro >= 6 && end - outro <= 45 ? outro : downs[Math.max(0, lastIndex(downs, end - 12))] ?? end - 12;
  // A decorative finale must not replace the last seconds of a still-playing Drop.
  for (const s of sections) if (s.label === 'drop' && s.end > from && s.start < end) from = Math.max(from, s.end);
  const si = Math.max(0, sections.findIndex(s => from >= s.start - 0.05 && from < s.end));
  const variants = ['chase', 'high', 'side'];
  carve(shots, music, 'canvas', from, end, si, variants[Math.floor(rng((songSeed ^ 0xca5) >>> 0)() * variants.length)], songSeed);
}

/** `ending`: the armillary also closes up over the last bars (not when the canvas closes the song). */
function placeArmillary(shots: Shot[], music: Music, style: Style, songSeed: number, ending = true): Shot[] {
  const sections = music.a.sections, downs = music.downbeats;
  const armillary = (from: number, to: number, sectionIndex: number, variant: string) => carve(shots, music, 'crystal', from, to, sectionIndex, variant, songSeed);
  if (style.transitions.dropPunch) {
    // The signature run-in establishes the song once. Replaying it before every returning Drop hides the
    // preparation's final phrase behind the same spectacle; later Drops keep their own direct entry.
    const firstDrop = sections.findIndex(s => s.label === 'drop');
    sections.forEach((s, i) => {
      const next = sections[i + 1];
      if (i + 1 !== firstDrop || !next || next.label !== 'drop' || s.label === 'drop') return;
      const last = lastIndex(downs, s.end - 0.1);
      if (last < 0 || downs[last] <= s.start + 0.1) return; // a section of one bar keeps its own
      // The run-in (line up, step back, push in) takes two bars, unless one bar is already long.
      const two = last > 0 && downs[last - 1] > s.start + 0.1 && s.end - downs[last] < 3;
      armillary(downs[two ? last - 1 : last], s.end, i, 'orbit');
    });
  }
  if (ending && style.id !== 'ink' && sections.length) {
    const end = sections[sections.length - 1].end, bars = downs.length >= 5 ? 4 : 2;
    const from = downs[Math.max(0, lastIndex(downs, end - 0.1) - bars + 1)];
    const si = Math.max(0, sections.findIndex(s => from >= s.start && from < s.end));
    if (from !== undefined && end - from > 2 && !sections.some(s => s.label === 'drop' && s.end > from && s.start < end)) armillary(from, end, si, 'gather');
  }
  return shots;
}

/**
 * How a shot comes in: a transition from the one before (kind 0 = a cut), how long it runs before and after the cut
 * (seconds; only the ones that carry motion through the cut start before it), its shape and how far it moves.
 */
interface Cut { kind: TransitionKind | 0; pre: number; post: number; center: [number, number]; angle: number; amount: number; whip: [number, number] }

/**
 * Stutters: where the singer chops a word and repeats it three times or more, each short (≤ 0.45 s), or sings the
 * same short line twice or more back to back. From the second time on each repeat flashes back to the moment of the
 * first (see Director.flashback). [start, end, repeat length], seconds.
 */
function findStutters(lines: LyricLine[]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const l of lines) {
    const w = l.words;
    for (let i = 0; i < w.length;) {
      let j = i + 1;
      while (j < w.length && norm(w[j].text) === norm(w[i].text) && w[j].end - w[j].start <= 0.45) j++;
      if (j - i >= 3 && w[i].end - w[i].start <= 0.45 && norm(w[i].text)) {
        const u = (w[j - 1].start - w[i].start) / (j - 1 - i);
        if (u > 0.08) out.push([w[i].start, w[j - 1].end, u]);
      }
      i = j;
    }
  }
  for (let i = 0; i < lines.length;) {
    let j = i + 1;
    const short = (k: number) => lines[k].end - lines[k].start <= 1.5;
    while (j < lines.length && short(i) && short(j) && norm(lines[j].text) === norm(lines[i].text) && lines[j].start - lines[j - 1].end <= 0.35) j++;
    if (j - i >= 2) out.push([lines[i].start, lines[j - 1].end, (lines[j - 1].start - lines[i].start) / (j - 1 - i)]);
    i = j;
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Which sections are redrawn in another medium (src/render/looks.ts), so the song doesn't stay in one world. The
 * first verse and chorus keep the plates' own look (the song establishes itself); later verses and choruses, the
 * bridges and breaks, sometimes the intro and a later build, change medium. Never the drops (the push tunnel is the
 * climax), the ink style (its paper is its medium) or two sections in a row in the same look. Ballads only print
 * (riso), and less often; no look more than twice in a song. `off`: looks the user turned off.
 */
export function planLooks(sections: Section[], style: Style, songSeed: number, off: ReadonlySet<string> = new Set()): Array<LookId | null> {
  const out: Array<LookId | null> = sections.map(() => null);
  if (style.id === 'ink') return out;
  const random = rng((songSeed ^ 0x3c6ef372) >>> 0);
  const ballad = style.look === 'ballad';
  const seen = new Map<string, number>();
  let prev: LookId | null = null;
  const count = new Map<LookId, number>();
  sections.forEach((s, i) => {
    const nth = seen.get(s.label) ?? 0;
    seen.set(s.label, nth + 1);
    let options: LookId[] = [], chance = 0;
    switch (s.label) {
      case 'intro': options = ['hibit', 'ascii', 'vhs']; chance = i === 0 ? 0.45 : 0; break;
      case 'verse': options = ['riso', 'hibit']; chance = nth >= 1 ? 0.85 : 0; break;
      case 'chorus': options = ['hibit', 'riso']; chance = nth >= 1 ? 0.6 : 0; break;
      case 'bridge': case 'break': options = ['ascii', 'riso', 'vhs']; chance = 0.85; break;
      case 'build': case 'pre': options = ['ascii']; chance = nth >= 1 ? 0.5 : 0; break;
      case 'outro': options = ['riso', 'vhs']; chance = 0.35; break;
    }
    // (A ballad: only the print and the tape, the tape for its openings, bridges and endings.)
    if (style.id === 'velvet') {
      options = s.label === 'bridge' || s.label === 'break' || s.label === 'outro' ? options.filter(o => o === 'riso' || o === 'vhs') : [];
      chance *= 0.35;
    } else if (ballad) { options = options.filter(o => o === 'riso' || o === 'vhs'); chance *= 0.7; }
    options = options.filter(o => !off.has(o) && o !== prev && (count.get(o) ?? 0) < 2);
    const roll = random(), pick = random();
    const look = options.length && roll < chance ? options[Math.floor(pick * options.length)] : null;
    if (look) count.set(look, (count.get(look) ?? 0) + 1);
    out[i] = look;
    prev = look;
  });
  return out;
}

/**
 * Plates that get the tube without the characters: the ones that print their words into their own surface
 * (LyricLayer; the words can't be drawn apart), and the soft ones that fill the frame with haze (clouds, bokeh), which
 * characters turn into a wall of the same glyph.
 */
const NO_CHARACTERS: ReadonlySet<SceneId> = new Set<SceneId>(['flip', 'halftone', 'shatter', 'ink', 'rain', 'clouds', 'bokeh']);

/**
 * Where the picture goes to letterbox (2.39:1 bars in the cover's ink, under the overlay): the opening and the end of
 * a song, and its pauses — a ballad's bridge, the other styles' breaks. Neighbouring sections run together.
 */
function letterboxed(music: Music, style: Style): Array<[number, number]> {
  // (Ink first: it is drawn with the ballad look too, and used to fall into the ballad's bridges.)
  const labels = style.id === 'ink' ? ['intro', 'outro'] : style.id === 'velvet' ? ['intro', 'break', 'outro'] : style.look === 'ballad' ? ['intro', 'bridge', 'outro'] : ['intro', 'break', 'outro'];
  const out: Array<[number, number]> = [];
  for (const s of music.a.sections) {
    if (!labels.includes(s.label)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - s.start) < 0.05) last[1] = s.end;
    else out.push([s.start, s.end]);
  }
  return out;
}

/** Plates that show the cover itself large (its white is the picture's white; the canvas paints it). */
const COVER_PLATES: ReadonlySet<SceneId> = new Set<SceneId>(['flip', 'shatter', 'align', 'canvas']);

const { zoom, spin, whip } = TransitionKind;
/**
 * The way each plate moves, so a cut carries its motion on into the next shot: flights push on through, turning
 * plates spin on, flat pages whip across.
 */
const MOTION: Record<SceneId, TransitionKind[]> = {
  tunnel: [zoom], drive: [zoom], relief: [zoom], bokeh: [zoom], particles: [zoom, spin],
  kaleido: [spin], rings: [spin], shatter: [spin, zoom], flip: [whip, spin],
  poster: [whip], typewall: [whip], halftone: [whip, zoom], ridges: [whip, zoom], diorama: [whip, zoom], ink: [TransitionKind.ink],
  crystal: [zoom, spin], cards: [zoom], debug: [whip, zoom], scope: [zoom, whip], subdivide: [spin, zoom], align: [whip, spin],
  vinyl: [spin, zoom], clouds: [zoom], city: [zoom], aurora: [zoom], canvas: [zoom], pillars: [spin, zoom],
  ripple: [spin, zoom], channel: [zoom], orb: [spin, zoom],
  menger: [zoom], sierpinski: [zoom], cantor: [zoom], papercut: [spin, zoom], rain: [TransitionKind.matte, zoom], lanterns: [zoom], neon: [zoom, whip],
  underwater: [zoom, TransitionKind.matte],
  sunset: [zoom, TransitionKind.matte],
  phoenix: [zoom, TransitionKind.matte],
  velvet: [TransitionKind.matte, zoom],
  fountain: [zoom, TransitionKind.matte],
  starry: [zoom, TransitionKind.matte],
  laser: [zoom, TransitionKind.matte],
  blackhole: [zoom, TransitionKind.matte],
};
const SOFT: TransitionKind[] = [zoom, TransitionKind.matte, TransitionKind.iris, spin];

export interface Frame {
  scene: MvScene;
  fx: Fx;
  shot: Shot;
  transition: Transition | null;
}

export class Director {
  private starts: Float64Array;
  private cuts: Cut[];
  readonly overlay: MgOverlay;
  /** The song's armillary as the overlay's badge (its notation goes on the HUD). */
  readonly sigil: Armillary | null;
  constructor(
    readonly style: Style,
    readonly shots: Shot[],
    readonly scenes: Partial<Record<SceneId, MvScene>>,
    readonly music: Music,
    readonly lyrics: LyricTrack,
    readonly palette: Palette,
    sigil?: ArmillarySpec,
    cover?: THREE.Texture,
    /**
     * Nothing over the plates' own picture: no flashes, punches, glitches or whips at the cuts,
     * no post-effect moments, only the song's name in the overlay (oscilloscope music, where the picture is the
     * song's own and anything laid over it spoils it).
     */
    readonly pure = false,
    /** Each section's look (planLooks). */
    readonly looks: Array<LookId | null> = [],
  ) {
    this.starts = Float64Array.from(shots, s => s.start);
    // Each plate's lens (depth of field, motion blur), read by the engine's ShotPass off its scene.
    for (const [id, s] of Object.entries(scenes)) if (s) s.scene.userData.lens = PLATE_LENS[id as SceneId];
    this.cuts = this.planCuts();
    this.sigil = sigil && cover ? new Armillary(sigil, palette, cover) : null;
    this.overlay = new MgOverlay(palette, style, music, this.sigil);
    this.overlay.quiet = pure;
    this.stutters = findStutters(lyrics.lines);
    this.boxes = pure ? [] : letterboxed(music, style);
  }

  /** Stretches of the song in letterbox (letterboxed). */
  private boxes: Array<[number, number]>;
  private stutters: Array<[number, number, number]>;
  /** The stutter whose first moment the engine holds for its flashbacks (−1: none). */
  private remembered = -1;

  /** 动态切换是否隐藏画面中的歌词，并清空可能带有旧歌词画面的闪回缓存 */
  setLyricsHidden(hidden: boolean): void {
    this.lyrics.hidden = hidden;
    this.remembered = -1;
  }

  shotAt(t: number): Shot {
    return this.shots[Math.max(0, lastIndex(this.starts, t))];
  }

  /**
   * One transition per cut, decided up front so a frame is a pure function of t. Cuts flow: the ones inside a
   * section carry the outgoing plate's own motion on through the cut (a flight pushes on through, a turning plate
   * spins on, a flat page whips across), starting half their length before the beat so they move fastest on it.
   * Pulse: into a louder section a shape grows from the middle; a Drop blends briefly before its beat and arrives
   * fully on time, with its zoom punch. Other section
   * changes pass through the cover's shapes or carry on moving; the speeding-up cuts before a big section stay hard.
   * Ballad: the same moves, slower and shorter, and sections flow into each other instead of dipping to ink.
   * A cut that stays on the same plate (only the camera changes) whips the camera instead.
   */
  private planCuts(): Cut[] {
    const out: Cut[] = [];
    let last: TransitionKind | 0 = 0;
    const ballad = this.style.look === 'ballad';
    const tr = this.style.transitions;
    this.shots.forEach((shot, i) => {
      const random = rng((shot.seed ^ 0x5bd1e995) >>> 0);
      const beat = 60 / Math.max(40, this.music.at(shot.start + 0.01).bpm);
      const cut: Cut = { kind: 0, pre: 0, post: 0, center: [0.5, 0.5], angle: 0, amount: ballad ? 0.45 : 1, whip: [0, 0] };
      const prev = this.shots[i - 1];
      out.push(cut);
      if (!prev) return;
      if (!this.pure && tr.dropPunch && shot.section.label === 'drop' && prev.section.label !== 'drop' && prev.scene !== shot.scene) {
        // Finish the blend on the musical entry, not after it. The next scene is held at its first frame in frame().
        cut.kind = TransitionKind.dissolve;
        cut.pre = Math.min(0.18, beat * 0.25, (prev.end - prev.start) * 0.5);
        return;
      }
      const hurried = prev.end - prev.start < beat * this.music.meter * 0.9;
      if (prev.scene === shot.scene) {
        // (The speeding-up cuts of a build stay hard: a whip on every beat would blur them into mush.)
        if (!hurried) {
          const a = random() * Math.PI * 2;
          cut.whip = [Math.cos(a), Math.sin(a) * 0.6];
        }
        return;
      }
      const changes = prev.section !== shot.section;
      const louder = changes && shot.section.energy > prev.section.energy + 0.1;
      const pick = (from: TransitionKind[]) => {
        const choices = from.filter(k => k !== last);
        return choices.length ? choices[Math.floor(random() * choices.length)] : from[0];
      };
      // The outgoing plate's own way of moving most of the time, now and then another.
      const moving = () => pick(random() < 0.75 ? MOTION[prev.scene] : [zoom, spin, whip]);
      /** Beats a transition runs; the moving ones are split evenly around the cut. */
      const run = (kind: TransitionKind, beats: number) => {
        cut.kind = kind;
        if (THROUGH_CUT.has(kind)) cut.pre = cut.post = (beat * beats) / 2;
        else cut.post = beat * beats;
      };
      if (ballad) {
        if (changes) run(tr.between ?? (random() < 0.5 ? TransitionKind.matte : zoom), 2);
        else run(pick(tr.within ?? SOFT), 1.5);
      } else if (changes) {
        if (shot.section.label === 'drop') return;
        if (louder) run(random() < 0.5 ? TransitionKind.iris : TransitionKind.triangle, 0.5);
        else if (tr.between) run(tr.between, 1);
        else run(random() < 0.5 ? TransitionKind.matte : moving(), 1);
      } else {
        if (hurried) return; // the speeding-up cuts stay hard
        const k = tr.within ? pick(tr.within) : moving();
        run(k, THROUGH_CUT.has(k) ? (shot.section.energy > 0.8 ? 0.75 : 1) : shot.section.energy > 0.8 ? 0.25 : 0.5);
      }
      if (cut.kind === TransitionKind.iris || cut.kind === TransitionKind.triangle) {
        cut.center = random() < 0.6 ? [0.5, 0.5] : [0.3 + random() * 0.4, 0.35 + random() * 0.3];
      }
      cut.angle = cut.kind === spin ? (random() < 0.5 ? -1 : 1) : [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, (-3 * Math.PI) / 4][Math.floor(random() * 6)];
      last = cut.kind;
    });
    return out;
  }

  /**
   * Flashbacks where the voice stutters (findStutters). The frame at the first time is kept; on each repeat it comes
   * back over the picture — still, in the ink → signal duotone, only where it is lighter — holds a moment and fades
   * into the present, which runs on underneath. (Drawn a touch bigger, its words doubled the ones on screen.) (It used to loop the whole picture back with the voice; the
   * user: on loud songs that looked like a twitch, “也许可以做个闪回的效果”.) No white flash with it. Chops shorter
   * than a quarter second flash back every other time or less, never more than about four times a second.
   */
  private flashback(t: number, fx: Fx): void {
    if (this.remembered >= 0 && t < this.stutters[this.remembered][0]) this.remembered = -1;
    const soft = this.style.look === 'ballad';
    for (let i = 0; i < this.stutters.length; i++) {
      const [s, e, u] = this.stutters[i];
      if (t < s || t >= e + 0.8) continue;
      if (this.remembered !== i) { fx.remember = true; this.remembered = i; }
      const period = u * Math.max(1, Math.ceil(0.24 / u));
      const n = Math.min(Math.floor((t - s) / period), Math.floor((e - s - 1e-3) / period));
      if (n < 1) return;
      const age = t - s - n * period, line = u > 0.8;
      const hold = line ? 0.25 : period * 0.35, tau = line ? 0.3 : period * 0.25;
      const a = age < hold ? 1 : Math.exp(-(age - hold) / tau);
      fx.memory = Math.max(fx.memory, (soft ? 0.55 : 0.9) * a);
      return;
    }
  }

  frame(t: number, dt: number, aspect: number): Frame {
    const i = Math.max(0, lastIndex(this.starts, t));
    const shot = this.shots[i];
    const prev = this.shots[i - 1];
    const following = this.shots[i + 1];
    const scene = this.scenes[shot.scene]!;
    const { transitions: tr, fx: base } = this.style;
    const fx = Object.assign(defaultFx(), base);
    fx.cut = shot.start;
    const since = t - shot.start;
    const beat = 60 / Math.max(40, this.music.at(t).bpm);
    const cut = this.cuts[i];

    if (this.pure) {
      // (Nothing at the cuts.)
    } else if (prev && prev.section !== shot.section && shot.section.energy > prev.section.energy + 0.1) {
      const jump = Math.min(1, (shot.section.energy - prev.section.energy) * 2.2);
      // (The user: “有些时候的闪光效果太重了” — a lift of light, not a white-out.)
      // An impact frame (three frames of the cover's ink and signal colour, swapped every other section) marks the
      // entry: a change of colour and shape, not of light.
      if (tr.flash && shot.section.label !== 'drop' && jump > 0.3 && since < 0.05) { fx.impact = 1; fx.impactInvert = shot.sectionIndex % 2; }
      if (tr.dropPunch && shot.section.label === 'drop') fx.zoom = Math.exp(-since / 0.35) * 0.9;
    } else if (tr.glitch && prev && !(shot.section.label === 'drop' && prev.section.label !== 'drop') && shot.section.energy > 0.55 && since < 0.12 && !cut.kind && !(shot.run && shot.run.start < shot.start)) {
      // (Not on the cuts inside a run: a glitch on every beat is a twitch of its own.)
      fx.glitch = Math.exp(-since / 0.045) * (0.5 + shot.section.energy * 0.5);
    }
    // A cut on the same plate: the camera whips into the new setup.
    if (!this.pure && (cut.whip[0] || cut.whip[1])) {
      const w = Math.pow(1 - clamp01(since / (beat * 0.35)), 2) * (this.style.look === 'ballad' ? 0.03 : 0.09);
      fx.smearX = cut.whip[0] * w;
      fx.smearY = cut.whip[1] * w;
    }

    // Scenes see a shot inside a run as the whole run (Shot.run): its moves carry on across the cuts.
    const timed = (s: Shot): Shot => (s.run ? { ...s, start: s.run.start, end: s.run.end } : s);
    const own = timed(shot);
    const ctx: FrameCtx = { t, dt, music: this.music, lyrics: this.lyrics, palette: this.palette, shot: own, shotT: t - own.start, aspect, fx };
    scene.update(ctx);

    // Both shots keep moving under a transition; only the one on screen (the shot at t) sets the post effects and
    // shows its words. After the cut the outgoing shot runs on beneath the new one; before a cut that carries motion
    // through it, the next shot is already there, held on its first frame until its beat.
    let transition: Transition | null = null;
    let drawn = scene;
    const nextCut = following ? this.cuts[i + 1] : undefined;
    const join = (c: Cut, into: Shot) => ({
      kind: c.kind as TransitionKind, progress: (t - (into.start - c.pre)) / (c.pre + c.post), center: c.center,
      angle: c.angle, amount: c.amount, edge: this.palette.signal, seed: into.seed,
    });
    if (cut.kind && prev && since < cut.post) {
      const from = this.scenes[prev.scene]!;
      const before = timed(prev);
      from.update({ ...ctx, shot: before, shotT: t - before.start, fx: defaultFx() });
      transition = { from, hide: 'from', ...join(cut, shot) };
    } else if (nextCut && nextCut.kind && following && following.start - t < nextCut.pre) {
      drawn = this.scenes[following.scene]!;
      const after = timed(following);
      drawn.update({ ...ctx, t: following.start, shot: after, shotT: following.start - after.start, fx: defaultFx() });
      transition = { from: scene, hide: 'to', ...join(nextCut, following) };
    }

    // Dips to ink around cuts: full at section changes, half inside a section — unless a transition joins them.
    if (tr.dip > 0) {
      const depth = (a: Shot | undefined, b: Shot | undefined, c: Cut | undefined) => (!a || !b || b.section.label === 'drop' ? 0 : a.section !== b.section ? 1 : c && c.kind ? 0 : 0.55);
      const outOf = following ? depth(shot, following, this.cuts[i + 1]) * (1 - smooth((following.start - t) / tr.dip)) : 0;
      const into = depth(prev, shot, cut) * (1 - smooth(since / tr.dip));
      fx.fade = Math.max(fx.fade, outOf, into);
    }
    for (const [a, b] of this.boxes) {
      if (t < a || t >= b) continue;
      // The bars slide in over a bar and out over a bar (not at the very start or end of the song).
      const ramp = Math.min(beat * this.music.meter, (b - a) / 4);
      const din = a <= 0.1 ? 1 : smooth((t - a) / ramp), dout = b >= this.music.a.duration - 0.1 ? 1 : smooth((b - t) / ramp);
      if (shot.scene !== 'starry' && shot.scene !== 'laser' && shot.scene !== 'blackhole') fx.letterbox = Math.min(din, dout);
    }
    // A plate on paper: trails and the duotone would grey its darks, and the overlay's glowing lines would vanish.
    const bg = scene.scene.background;
    const light = bg instanceof THREE.Color && bg.r * 0.2126 + bg.g * 0.7152 + bg.b * 0.0722 > 0.45;
    // A light cover shown whole (tiles, shards, the aligned cover) is mostly near-white: held a step down and
    // without most of the glow it stays a picture instead of washing out (the user: “过曝+歌词看不清”).
    if (this.palette.light && COVER_PLATES.has(shot.scene) && this.style.id !== 'ink') { fx.exposure *= 0.72; fx.bloom *= 0.12; fx.flash *= 0.5; fx.vignette = Math.max(fx.vignette, 0.55); }
    if (!light && !this.pure) this.grade(t, shot, fx, beat);
    // Repeated/chopped vocals must not jump back to a remembered picture during an uninterrupted Drop.
    if (!this.pure && shot.section.label !== 'drop') this.flashback(t, fx);
    if (!this.pure && !light) this.applyLook(shot, fx);
    if (transition?.kind === TransitionKind.dissolve && transition.hide === 'to') {
      // A printed/CRT build must release its display treatment with the pictures, rather than snapping it off
      // on the final frame of an otherwise smooth blend. Drops use the unfiltered picture and normal finish.
      const blend = smooth(clamp01(transition.progress)), retain = 1 - blend;
      const hasLook = fx.riso + fx.hibit + fx.ascii + fx.crt + fx.vhs > 0;
      fx.riso *= retain; fx.hibit *= retain; fx.ascii *= retain; fx.crt *= retain; fx.vhs *= retain;
      fx.scan *= retain;
      fx.exposure = 1 + (fx.exposure - 1) * retain;
      if (hasLook) fx.film = Math.max(fx.film, blend);
    }
    this.overlay.update(t, shot, fx, light);
    return { scene: drawn, fx, shot, transition };
  }

  /**
   * The section's look on this shot. Not on the opening cards or the armillary (they are the song's own marks), nor on
   * the canvas (a medium of its own: printed over, its bare weave turned to a field of noise). Some
   * plates are on the tube without the characters (NO_CHARACTERS).
   * Trails, the duotone and the negative fight the media (a print has no glow), so they are left out under one.
   */
  private applyLook(shot: Shot, fx: Fx): void {
    const look = shot.look ?? this.looks[shot.sectionIndex];
    if (!look || shot.scene === 'cards' || shot.scene === 'crystal' || shot.scene === 'canvas') return;
    if (look === 'riso') { fx.riso = 1; fx.bloom *= 0.5; }
    else if (look === 'hibit') { fx.hibit = 1; }
    else if (look === 'vhs') { fx.vhs = 1; }
    else { fx.crt = 1; if (!NO_CHARACTERS.has(shot.scene)) fx.ascii = 1; }
    fx.echo = Math.min(fx.echo, look === 'hibit' ? 0.5 : 0);
    fx.duotone = 0;
    fx.invert = 0;
    fx.scan = 0;
    fx.grain = look === 'riso' ? 0 : fx.grain;
    fx.vignette = look === 'riso' ? 0 : fx.vignette;
    // A print or a screen is not film (the look keeps the plain picture's grain where it has any).
    fx.film = 0;
  }

  /**
   * Post-effect moments laid over the scenes' own settings, by section and beat. Pulse: drops trail light behind
   * the line plates without changing their layout or replaying frames; the last bar of a build pulses gently on
   * the eighths; a drop resolves out of big pixels on its first beat; breaks turn duotone
   * (the cover's ink → signal), bridges half so; choruses trail a little after each downbeat. Ballad: long soft
   * trails in choruses, a light duotone in bridges; no negatives, strobes or mirrors.
   */
  private grade(t: number, shot: Shot, fx: Fx, beat: number): void {
    const m = this.music, sec = shot.section, info = m.at(t);
    const ballad = this.style.look === 'ballad';
    const random = rng((shot.seed ^ 0x27d4eb2f) >>> 0);
    const intoSec = t - sec.start;
    // A small, shared bloom pulse follows the estimated foreground in every scene and section.
    if (m.selectiveAt(t) && shot.scene !== 'phoenix') fx.bloom = Math.min(1.1, fx.bloom + 0.08 * m.foregroundAt(t).attack);
    if (this.style.id === 'velvet') {
      if ((sec.label === 'chorus' || sec.label === 'drop') && (shot.scene === 'bokeh' || shot.scene === 'rings')) {
        fx.echo = Math.max(fx.echo, 0.48);
      }
      return;
    }
    if (ballad) {
      if (sec.label === 'chorus' || sec.label === 'drop') fx.echo = Math.max(fx.echo, shot.scene === 'bokeh' || shot.scene === 'kaleido' ? 0.86 : 0.7);
      if (sec.label === 'bridge' || sec.label === 'break') fx.duotone = Math.max(fx.duotone, 0.45);
      return;
    }
    const next = m.a.sections[shot.sectionIndex + 1];
    // Trails suit sparse bright lines; on a frame full of shards they only wash it grey.
    const sparse = shot.scene === 'drive' || shot.scene === 'tunnel' || shot.scene === 'rings' || shot.scene === 'kaleido';
    switch (sec.label) {
      case 'drop': {
        if (sparse && random() < 0.7) fx.echo = Math.max(fx.echo, 0.78);
        // A mirror would turn the words backwards: only while no line is on screen.
        // Dropping/reappearing lyrics used to toggle the whole picture into a mirror mid-shot. Keep the Drop's
        // spatial layout stable; foreground sound still drives its existing geometry and light response.
        // Resolve out of big pixels on the drop's first beat — not after the armillary's push, which lands the drop
        // with a clean cut on its kick, and not while a line is being sung over it (like the mirror: the pixels turned
        // the words into blocks; decided once for the beat, so it never switches off halfway).
        const pushedIn = this.shots.some(s => s.scene === 'crystal' && s.variant === 'orbit' && Math.abs(s.end - sec.start) < 0.05);
        const sungOver = this.lyrics.visible(sec.start + beat * 0.5).some(s => s.exit < 0.5);
        if (intoSec < beat && !pushedIn && !sungOver && shot.scene !== 'laser' && shot.scene !== 'blackhole') fx.pixel = Math.max(fx.pixel, 48 * Math.pow(1 - intoSec / beat, 2));
        // No phrase-triggered whole-frame negatives during a Drop: keep timbre accents inside the scene.
        break;
      }
      case 'build': case 'pre': {
        if (next && next.energy > sec.energy + 0.08 && sec.end - t < beat * m.meter && shot.scene !== 'crystal') {
          const eighth = info.pos * 2 - Math.floor(info.pos * 2);
          fx.exposure *= 1 + 0.1 * Math.cos(eighth * Math.PI * 2);
          fx.scan = Math.max(fx.scan, 0.3);
        }
        break;
      }
      case 'break': if (shot.scene !== 'starry' && shot.scene !== 'laser' && shot.scene !== 'blackhole') fx.duotone = Math.max(fx.duotone, 0.6); fx.scan = Math.max(fx.scan, 0.15); break;
      case 'bridge': if (shot.scene !== 'starry' && shot.scene !== 'laser' && shot.scene !== 'blackhole') fx.duotone = Math.max(fx.duotone, 0.4); break;
      case 'chorus': {
        const sinceDown = (info.inBar % m.meter) * beat;
        if (sparse && sinceDown < beat) fx.echo = Math.max(fx.echo, 0.6 * (1 - sinceDown / beat));
        break;
      }
    }
  }
}
