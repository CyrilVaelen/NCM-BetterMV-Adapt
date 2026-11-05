// NetEase lyric JSON (/api/song/lyric/v1) → timed lines and words.
// Word times come from yrc when NetEase has it; otherwise each line's words are spread over the line by syllable count.
import type { LyricLine, LyricWord } from '../types.ts';

export interface NeteaseLyric {
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  yrc?: { lyric?: string };
  pureMusic?: boolean;
  nolyric?: boolean;
  uncollected?: boolean;
}

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const LEAD = /^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/;
/** 行内逐字时间帧匹配正则（支持 `[mm:ss.xx]` 与 `<mm:ss.xx>` 格式）。 */
const INLINE_WORD_STAMP = /[\[<](\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?[\]>]/g;
const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const YRC_WORD = /\((\d+),(\d+),\d+\)([^(]*)/g;
// NetEase's placeholder for pure music ("纯音乐，请欣赏~", "此歌曲为没有填词的纯音乐，请您欣赏"…).
const INSTRUMENTAL = /^纯音乐[，,\s]*请您?欣赏|没有填词的纯音乐/;
// Notices written into the lyrics ("【未经著作权人许可 不得翻唱 翻录或使用】").
const NOTICE = /未经.{0,12}许可|不得翻唱|不得翻录/;
// Credits written as ordinary timed lines ("作词 : …", "吉他Guitar：…", "Mixed by …").
const CREDIT = /^[^:：]{0,30}(作词|作曲|编曲|词|曲|制作|监制|出品|统筹|企划|发行|版权|策划|吉他|贝斯|鼓|键盘|钢琴|弦乐|和声|琵琶|古筝|二胡|笛|箫|扬琴|唢呐|提琴|打击乐|合成器|编程|采样|配唱|总监|混音|母带|录音|人声|演唱|原唱|翻唱|OP|SP|ISRC|Producer|Produced|Arrange|Compose|Lyric|Written|Mix|Master|Guitar|Bass|Drum|Keyboard|Piano|String|Vocal|Record|Engineer|Pipa|Guzheng|Erhu|Flute|Cello|Violin|Viola|Percussion|Synth|Programming|Director|Supervisor)[^:：]{0,30}[:：]/i;
const COMPANY = /(Co\.,? ?Ltd|Entertainment|Records|Publishing|有限公司|工作室|唱片公司)/i;
const isCredit = (text: string) => (CREDIT.test(text) && text.length < 200) || COMPANY.test(text) || NOTICE.test(text) || INSTRUMENTAL.test(text) || !/[\p{L}\p{N}]/u.test(text);

const seconds = (m: string, s: string, f?: string) => Number(m) * 60 + Number(s) + (f ? Number(f.padEnd(3, '0')) / 1000 : 0);
const key = (t: number) => Math.round(t * 100);

/** [time, text] pairs of an LRC document; credits written as JSON lines and [xx:…] tags are dropped. */
function lrcEntries(text: string | undefined): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '{') continue;
    const lead = line.match(LEAD);
    if (!lead) continue;
    const words = line.slice(lead[0].length).trim();
    const leadMatches = Array.from(lead[0].matchAll(STAMP));
    // 若行首含多个连续时间戳且正文内仍有逐字时间戳（如 `[00:13.90][00:13.95]Your [00:14.10]fingertips`），
    // 第一个时间戳作为整行起始时间，最后一个行首时间戳保留给首词，避免误判为副歌重复行。
    if (leadMatches.length > 1 && /[\[<]\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?[\]>]/.test(words)) {
      const first = leadMatches[0];
      const lastTag = leadMatches[leadMatches.length - 1][0];
      out.push([seconds(first[1], first[2], first[3]), `${lastTag}${words}`]);
    } else {
      for (const [, m, s, f] of leadMatches) out.push([seconds(m, s, f), words]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const PUNCT = /^[\p{P}\p{S}]+$/u;
/** Opening brackets and quotes: they belong to the word after them. */
const OPENING = /^[\p{Ps}\p{Pi}]+$/u;

/**
 * Punctuation never stands as a word of its own (NetEase's word-timed lyrics often give "(" or "," their own slot):
 * an opening bracket or quote joins the word after it, anything else the word before it. Works on plain tokens and
 * on timed words (a joined mark takes no time of its own).
 */
function joinPunctuation<T>(items: T[], text: (x: T) => string, withText: (x: T, s: string) => T): T[] {
  const out: T[] = [];
  let pending = '';
  for (const it of items) {
    const s = text(it).trim();
    if (!s) continue;
    if (PUNCT.test(s)) {
      if (OPENING.test(s) || !out.length) pending += s;
      else out[out.length - 1] = withText(out[out.length - 1], text(out[out.length - 1]) + s);
    } else {
      out.push(withText(it, pending + s));
      pending = '';
    }
  }
  return out;
}

/** Words of a line: Latin runs split on spaces, each CJK character on its own; punctuation joins a neighbour. */
export function tokenize(text: string): string[] {
  // 兜底剥离行内时间标签，确保任何调用路径下时间帧都不会被当作歌词文本分词显示
  const cleaned = text.replace(INLINE_WORD_STAMP, ' ');
  const re = /[㐀-鿿豈-﫿぀-ヿ가-힯]|[^\s㐀-鿿豈-﫿぀-ヿ가-힯]+/g;
  return joinPunctuation(Array.from(cleaned.matchAll(re), m => m[0]), t => t, (_, s) => s);
}

/** Scripts written without spaces between words: each character is a word of its own. */
const SPACELESS = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

const WRAPPED = /^\s*[(（[【]\s*(.*?)\s*[)）\]】]\s*$/;
/** A line sung wholly in brackets is backing vocals: shown without the brackets, and flagged for the analysis. */
function unwrap(text: string): { text: string; backing: boolean } {
  const m = text.match(WRAPPED);
  return m && m[1] ? { text: m[1], backing: true } : { text, backing: false };
}

/** A line's text tidied: strips any inline word timestamps, removes space before punctuation or after an opening bracket. */
const tidy = (text: string) => text
  .replace(/\uFEFF/g, '')
  .replace(INLINE_WORD_STAMP, ' ')
  .replace(/\s+([,.!?;:，。！？；：、)）\]】])/g, '$1')
  .replace(/([(（[【])\s+/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

export function syllables(word: string): number {
  if (/[㐀-鿿豈-﫿぀-ヿ가-힯]/.test(word)) return 1;
  const groups = word.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Spread a line's words over its sung span, weighted by syllables. */
export function spreadWords(text: string, start: number, end: number): LyricWord[] {
  const tokens = tokenize(text);
  if (!tokens.length) return [];
  const weights = tokens.map(syllables);
  const total = weights.reduce((a, b) => a + b, 0);
  // Singers rarely fill the whole gap to the next line: about 0.4 s per syllable, never past the gap.
  const sung = Math.min(end - start, Math.max(0.6, total * 0.4));
  const words: LyricWord[] = [];
  let t = start;
  for (let i = 0; i < tokens.length; i++) {
    const d = (sung * weights[i]) / total;
    words.push({ text: tokens[i], start: t, end: t + d });
    t += d;
  }
  return words;
}

function translations(doc: NeteaseLyric): Map<number, string> {
  const map = new Map<number, string>();
  for (const [t, raw] of lrcEntries(doc.tlyric?.lyric)) {
    const text = tidy(raw);
    if (text && text !== '//') map.set(key(t), text);
  }
  return map;
}

/**
 * 检测未真实打轴、而是由工具将长跨度行（含大段器乐间奏）按词/分片数机械等分填充的伪逐字 YRC 行。
 * 例如 21.33s 的 `[106120,21330]` 被均分为 4 个 5.332s 的分片：真实演唱不可能出现多词毫秒级等长且语速极慢的情况。
 */
function isUniformSyntheticYrc(
  pieces: Array<{ text: string; start: number; end: number }>,
  words: LyricWord[],
  span: number,
): boolean {
  if (words.length < 2 || span < 6) return false;
  const totalSyl = words.reduce((s, w) => s + syllables(w.text), 0);
  const voicedSum = words.reduce((s, w) => s + Math.max(0, w.end - w.start), 0);
  if (voicedSum / Math.max(1, totalSyl) < 1.2 || voicedSum / words.length < 1.4) return false;
  const uniform = (durs: number[]) => {
    if (durs.length < 2) return false;
    const mean = durs.reduce((a, b) => a + b, 0) / durs.length;
    return mean >= 1.2 && Math.max(...durs) - Math.min(...durs) <= Math.max(0.04, 0.06 * mean);
  };
  const nonEmptyPieces = pieces.filter(p => p.text.replace(/\uFEFF/g, '').trim().length > 0);
  return uniform(words.map(w => w.end - w.start)) || uniform(nonEmptyPieces.map(p => p.end - p.start));
}

function fromYrc(doc: NeteaseLyric, trans: Map<number, string>): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of String(doc.yrc?.lyric || '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = raw.trim().match(YRC_LINE);
    if (!m) continue;
    const start = Number(m[1]) / 1000, end = start + Number(m[2]) / 1000;
    const pieces = Array.from(m[3].matchAll(YRC_WORD), ([, ws, wd, text]) => ({ text, start: Number(ws) / 1000, end: (Number(ws) + Number(wd)) / 1000 }))
      .filter(p => p.text);
    // NetEase splits some words into timed syllables with nothing between them ("Pastell" "é, ", "N" "-" "now "):
    // pieces not parted by a space are one word — except in scripts written without spaces, a character a word.
    const words: LyricWord[] = [];
    let open = false;
    for (const p of pieces) {
      const body = p.text.replace(/\uFEFF/g, '').trim(), last = words[words.length - 1];
      if (body && open && last && !/^\s/.test(p.text) && !SPACELESS.test(last.text.slice(-1)) && !SPACELESS.test(body[0])) {
        last.text += body;
        // 独立标点时间槽（如 `, ` 吞入数秒器乐间奏）不延长前词发音结束时间，与 joinPunctuation 语义保持一致
        if (!PUNCT.test(body)) last.end = p.end;
      } else if (body) words.push({ text: body, start: p.start, end: p.end });
      open = !!body && !/\s$/.test(p.text);
    }
    const spaceless = SPACELESS.test(m[3]);
    const { text, backing } = unwrap(tidy(spaceless ? words.map(w => w.text).join('') : pieces.map(p => p.text).join('')));
    if (!text || isCredit(text)) continue;
    const joined = joinPunctuation(words, w => w.text, (w, t) => ({ ...w, text: t }));
    if (backing && joined.length) {
      joined[0] = { ...joined[0], text: joined[0].text.replace(/^[(（[【]+/, '') };
      const last = joined.length - 1;
      joined[last] = { ...joined[last], text: joined[last].text.replace(/[)）\]】]+$/, '') };
    }
    const cleanWords = joined.filter(w => w.text);
    if (isUniformSyntheticYrc(pieces, cleanWords, end - start)) {
      // 伪逐字线性均分行回退为按音节自然时长分布，避免将后续数十秒器乐 Drop 误标为持续人声演唱
      const needed = Math.max(2.5, cleanWords.reduce((n, w) => n + syllables(w.text), 0) * 0.42);
      const naturalEnd = Math.min(end, start + needed * 1.4);
      lines.push({
        start,
        end: naturalEnd,
        text,
        words: spreadWords(text, start, naturalEnd),
        timedWords: false,
        translation: nearest(trans, start),
        backing,
      });
      continue;
    }
    lines.push({ start, end, text, words: cleanWords, timedWords: true, translation: nearest(trans, start), backing });
  }
  return lines;
}

/** The translation whose stamp is closest to t (NetEase's translation stamps drift by tens of ms), within 0.35 s. */
function nearest(trans: Map<number, string>, t: number): string | undefined {
  const k = key(t);
  const exact = trans.get(k);
  if (exact !== undefined) return exact;
  let best: string | undefined, bestD = 36;
  for (const [stamp, text] of trans) { const d = Math.abs(stamp - k); if (d < bestD) { bestD = d; best = text; } }
  return best;
}

/**
 * 解析逐字 LRC 行内的时间标签（支持 `[mm:ss.xx]` 或 `<mm:ss.xx>` 逐词标记及句尾结束时间戳）。
 * 若行内不含逐词时间标签则返回 null，回退至常规按音节均匀分配逻辑。
 */
function parseInlineWords(rawText: string, lineStart: number, fallbackEnd: number, nextSung: number): {
  start: number;
  end: number;
  text: string;
  backing: boolean;
  words: LyricWord[];
} | null {
  const matches = Array.from(rawText.matchAll(INLINE_WORD_STAMP));
  if (!matches.length) return null;

  const segments: Array<{ time: number; text: string }> = [];
  const firstIdx = matches[0].index ?? 0;
  const prefix = rawText.slice(0, firstIdx);
  if (prefix.trim()) segments.push({ time: lineStart, text: prefix });

  for (let k = 0; k < matches.length; k++) {
    const m = matches[k];
    const t = seconds(m[1], m[2], m[3]);
    const segStartIdx = (m.index ?? 0) + m[0].length;
    const segEndIdx = k + 1 < matches.length ? (matches[k + 1].index ?? rawText.length) : rawText.length;
    segments.push({ time: t, text: rawText.slice(segStartIdx, segEndIdx) });
  }

  let explicitEnd: number | undefined;
  while (segments.length) {
    const tail = segments[segments.length - 1].text.trim();
    if (!tail) {
      explicitEnd = segments.pop()!.time;
    } else if (segments.length > 1 && PUNCT.test(tail) && !OPENING.test(tail)) {
      // 若句尾时间标签后紧跟右引号或句末标点（如 `[00:54.62]inside[00:56.40]"`），将标点归并给前一词并以该时间作为句尾结束时间
      const popped = segments.pop()!;
      segments[segments.length - 1].text += popped.text;
      explicitEnd = popped.time;
    } else {
      break;
    }
  }
  if (!segments.length) return null;

  const cleanRaw = segments.map(s => s.text.trim()).filter(Boolean).join(SPACELESS.test(rawText) ? '' : ' ');
  const { text, backing } = unwrap(tidy(cleanRaw));
  if (!text || INSTRUMENTAL.test(text) || isCredit(text)) return null;

  const rawWords: LyricWord[] = [];
  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k];
    const sText = tidy(seg.text);
    if (!sText) continue;
    const sStart = Math.max(0, seg.time);
    const nextTime = k + 1 < segments.length
      ? segments[k + 1].time
      : explicitEnd !== undefined
        ? explicitEnd
        : Math.min(fallbackEnd, Math.max(sStart + 0.2, sStart + syllables(sText) * 0.38));
    const sEnd = Math.max(sStart + 0.02, nextTime);
    const tokens = tokenize(sText);
    if (tokens.length <= 1) {
      rawWords.push({ text: tokens[0] ?? sText, start: sStart, end: sEnd });
    } else {
      rawWords.push(...spreadWords(sText, sStart, sEnd));
    }
  }

  const joined = joinPunctuation(rawWords, w => w.text, (w, t) => ({ ...w, text: t })).filter(w => w.text);
  if (!joined.length) return null;
  if (backing) {
    joined[0] = { ...joined[0], text: joined[0].text.replace(/^[(（[【]+/, '') };
    const lastIdx = joined.length - 1;
    joined[lastIdx] = { ...joined[lastIdx], text: joined[lastIdx].text.replace(/[)）\]】]+$/, '') };
  }
  const finalWords = joined.filter(w => w.text);
  if (!finalWords.length) return null;

  const start = Math.min(lineStart, finalWords[0].start);
  const lastWordEnd = finalWords[finalWords.length - 1].end;
  const end = Math.min(nextSung, Math.max(lastWordEnd, explicitEnd ?? lastWordEnd));
  return { start, end, text, backing, words: finalWords };
}

function fromLrc(doc: NeteaseLyric, trans: Map<number, string>, duration: number): LyricLine[] {
  const entries = lrcEntries(doc.lrc?.lyric);
  const lines: LyricLine[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [start, rawText] = entries[i];
    if (!rawText) continue;
    const primaryClean = unwrap(tidy(rawText)).text;
    // 识别同时间戳（≤20ms）的重复行或双语伴随译文行，合并为单句原文+译文，避免拆成两条同时显示的叠字行
    let inlineTrans: string | undefined;
    while (i + 1 < entries.length && Math.abs(entries[i + 1][0] - start) <= 0.02) {
      const nextRaw = entries[i + 1][1];
      if (!nextRaw) { i++; continue; }
      const nextClean = unwrap(tidy(nextRaw)).text;
      if (!nextClean || INSTRUMENTAL.test(nextClean) || isCredit(nextClean) || nextClean === primaryClean) {
        i++;
        continue;
      }
      if (!/[\[<]\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?[\]>]/.test(nextRaw)) {
        inlineTrans ??= nextClean;
        i++;
        continue;
      }
      break;
    }

    // A line lasts until the next sung line. NetEase often puts an empty stamp right after a line; trust it as the
    // end only when it leaves the line enough time for its syllables (it frequently cuts a long last word short).
    let j = i + 1;
    while (j < entries.length && !entries[j][1]) j++;
    const nextSung = j < entries.length ? entries[j][0] : duration;
    const blank = i + 1 < j ? entries[i + 1][0] : Infinity;

    const inline = parseInlineWords(rawText, start, Math.min(nextSung, Number.isFinite(blank) ? blank : nextSung), nextSung);
    if (inline) {
      lines.push({
        start: inline.start,
        end: inline.end,
        text: inline.text,
        words: inline.words,
        timedWords: true,
        translation: nearest(trans, inline.start) ?? inlineTrans,
        backing: inline.backing,
      });
      continue;
    }

    const { text, backing } = unwrap(tidy(rawText));
    if (!text || INSTRUMENTAL.test(text) || isCredit(text)) continue;
    // Slow songs spend well over 0.3 s a syllable; err long (the display bridges short gaps anyway).
    const needed = Math.max(2.5, tokenize(text).reduce((n, w) => n + syllables(w), 0) * 0.42);
    const end = Math.min(nextSung, start + 12, blank >= start + needed ? blank : start + needed * 1.4);
    lines.push({ start, end, text, words: spreadWords(text, start, end), timedWords: false, translation: nearest(trans, start) ?? inlineTrans, backing });
  }
  return lines;
}

/**
 * How far NetEase's word-level lyric (yrc) runs late, judged against its own line-level lyric (lrc): 0 unless it is
 * clearly and steadily late, then the shift that brings it back to the usual gap. Over 63 cached songs with both, yrc
 * starts a line between 0.4 s before and 0.3 s after lrc (about +0.15 s in the middle) and neither is always the
 * right one; a few run late on every line (《Cytus II Opening - The Whole Rest》: +0.42 to +0.99 s, the user heard
 * every word late). Only those are moved: at least 8 lines, the median over 0.4 s, nine lines in ten late.
 */
export function yrcLag(lines: LyricLine[], doc: NeteaseLyric): number {
  const stamps = lrcEntries(doc.lrc?.lyric).filter(([, text]) => text).map(([t]) => t);
  if (lines.length < 8 || !stamps.length) return 0;
  const d: number[] = [];
  for (const l of lines) {
    let best = Infinity;
    for (const s of stamps) if (Math.abs(l.start - s) < Math.abs(best)) best = l.start - s;
    if (Math.abs(best) < 2) d.push(best);
  }
  if (d.length < 8) return 0;
  d.sort((a, b) => a - b);
  const median = d[d.length >> 1];
  const late = d.filter(x => x > 0).length / d.length;
  return median > 0.4 && late >= 0.9 ? median - 0.15 : 0;
}

/** Moves every time in the lines `by` seconds (negative = earlier). */
export function shiftLines(lines: LyricLine[], by: number): void {
  for (const l of lines) {
    l.start += by;
    l.end += by;
    for (const w of l.words) { w.start += by; w.end += by; }
  }
}

export function parseNeteaseLyric(doc: NeteaseLyric, duration: number): LyricLine[] {
  if (!doc || doc.pureMusic || doc.nolyric || doc.uncollected) return [];
  const trans = translations(doc);
  const timed = fromYrc(doc, trans);
  if (!timed.length) return fromLrc(doc, trans, duration);
  // A yrc that runs late is brought back, and its translations matched again at the corrected times (they follow
  // the lrc's stamps, so a late line had lost its translation).
  const lag = yrcLag(timed, doc);
  if (lag > 0) {
    shiftLines(timed, -lag);
    for (const l of timed) l.translation ??= nearest(trans, l.start);
  }
  return timed;
}
