/**
 * Display-width engine. CJK / fullwidth glyphs occupy 2 terminal columns;
 * getting this right is what keeps a Korean card's box from tearing (design
 * rule 3A). No dependency — a compact East Asian Width table.
 */

/** Ranges of code points that render 2 columns wide. */
const WIDE: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi
  [0x3041, 0x33ff], // Hiragana, Katakana, CJK symbols
  [0x3400, 0x4dbf], // CJK ext A
  [0x4e00, 0x9fff], // CJK unified
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe4f], // CJK compatibility forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1faff], // emoji / pictographs (banned in cards, handled for safety)
  [0x20000, 0x3fffd], // CJK ext B+
];

/** Zero-width: combining marks, ZWJ, variation selectors. */
const ZERO: Array<[number, number]> = [
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0xfe00, 0xfe0f],
  [0x1ab0, 0x1aff],
];

function inRanges(cp: number, ranges: Array<[number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}

export function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0; // control chars
  if (inRanges(cp, ZERO)) return 0;
  if (inRanges(cp, WIDE)) return 2;
  return 1;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip SGR colour escapes so width/pad math ignores them. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function stringWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0) as number);
  return w;
}

/** Truncate to a max display width, appending "…" (kept within the budget). */
export function clampWidth(s: string, max: number): string {
  if (stringWidth(s) <= max) return s;
  if (max <= 1) return '…';
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0) as number);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

/** Middle-ellipsis a path: "src/…/parser.ts" keeping head and tail. */
export function middleEllipsis(path: string, max: number): string {
  if (stringWidth(path) <= max) return path;
  const parts = path.split('/');
  if (parts.length <= 2) return clampWidth(path, max);
  const tail = parts[parts.length - 1] as string;
  const head = parts[0] as string;
  const candidate = `${head}/…/${tail}`;
  if (stringWidth(candidate) <= max) return candidate;
  return `…/${clampWidth(tail, max - 2)}`;
}

export function padEndWidth(s: string, width: number): string {
  const gap = width - stringWidth(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

/** Greedy word-wrap on plain text to a max display width. */
export function wrapText(s: string, width: number): string[] {
  if (width <= 0) return [s];
  const words = s.split(/\s+/).filter((w) => w !== '');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (stringWidth(candidate) > width && line !== '') {
      lines.push(line);
      line = stringWidth(word) > width ? clampWidth(word, width) : word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines.length > 0 ? lines : [''];
}
