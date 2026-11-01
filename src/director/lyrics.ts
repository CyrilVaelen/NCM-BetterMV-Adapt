// Which lyric lines are on screen at a song time, and how far each word has been sung.
// A line stays until the next one has begun (they cross-fade), so the screen never goes blank between two sung
// lines; only before a real gap does a line leave on its own, a little after it ends.
import type { LyricLine, LyricWord } from '../types.ts';
import { lastIndex } from './music.ts';

export interface WordState {
  word: LyricWord;
  index: number;
  /** Seconds since the word started (negative = not yet sung). */
  age: number;
  /** 0 before the word, 0..1 while it is sung, 1 after. */
  progress: number;
}

export interface LineState {
  line: LyricLine;
  index: number;
  /** Seconds since the line started (negative while it is entering early). */
  age: number;
  /** 0..1 fade-out once the line is over (1 = gone). */
  exit: number;
  words: WordState[];
  /** 0..1 how much of the translation to reveal (it has no word times, so it follows the line). */
  translationProgress: number;
}

/** Gaps shorter than this between two lines are bridged: the earlier line waits for the next. */
const BRIDGE_GAP = 2.5;

export class LyricTrack {
  private starts: Float64Array;
  /** 是否隐藏画面中的歌词显示（保留原始歌词行供声学与段落色彩分析，仅屏蔽视觉歌词渲染） */
  hidden = false;
  constructor(readonly lines: LyricLine[], readonly lead = 0.5, readonly tail = 0.8, readonly exitTime = 0.3) {
    this.starts = Float64Array.from(lines, l => l.start);
  }

  /** When line i starts to leave. */
  leaveAt(i: number): number {
    const line = this.lines[i], next = this.lines[i + 1];
    // 在下一句开唱前提前启动退场，使新句进入时旧句已完成退场让位；即使原始句尾晚于下一句起点也绝不延迟退场造成叠字重影
    if (next && next.start - line.end < BRIDGE_GAP) {
      const nextWordStart = next.words.length ? Math.min(next.start, next.words[0].start) : next.start;
      const minHold = line.start + Math.min(0.18, Math.max(0.05, (nextWordStart - line.start) * 0.45));
      return Math.max(line.start, Math.min(Math.max(minHold, nextWordStart - this.exitTime), nextWordStart - 0.06));
    }
    return line.end + this.tail;
  }

  /** Lines on screen at t, oldest first: at most the leaving line and the entering one. */
  visible(t: number): LineState[] {
    if (this.hidden) return [];
    const out: LineState[] = [];
    for (let i = lastIndex(this.starts, t + this.lead); i >= 0 && out.length < 2; i--) {
      const leave = this.leaveAt(i);
      if (t >= leave + this.exitTime) break;
      out.unshift(this.state(i, t, Math.max(0, Math.min(1, (t - leave) / this.exitTime))));
    }
    return out;
  }

  /** The newest line on screen. */
  current(t: number): LineState | null {
    const v = this.visible(t);
    return v.length ? v[v.length - 1] : null;
  }

  state(i: number, t: number, exit = 0): LineState {
    const line = this.lines[i];
    const words = line.words.map((word, index) => ({
      word, index, age: t - word.start,
      progress: t < word.start ? 0 : t >= word.end ? 1 : (t - word.start) / Math.max(1e-3, word.end - word.start),
    }));
    const sungEnd = line.words.length ? line.words[line.words.length - 1].end : line.end;
    return {
      line, index: i, age: t - line.start, exit, words,
      translationProgress: Math.max(0, Math.min(1, (t - line.start) / Math.max(0.4, sungEnd - line.start))),
    };
  }

  /** Lines whose text appears more than once: the hooks. */
  hooks(): Set<string> {
    const count = new Map<string, number>();
    for (const l of this.lines) count.set(norm(l.text), (count.get(norm(l.text)) || 0) + 1);
    return new Set(Array.from(count).filter(([, n]) => n > 1).map(([k]) => k));
  }
}

export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
