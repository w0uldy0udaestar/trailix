import type { Verdict } from '../types.ts';

/**
 * Semantic palette 3+1 (design 2A/T13): colour maps 1:1 to meaning, no
 * decorative colour, no emoji. Text glyphs only (terminal-stable widths).
 */

export type Glyph = 'pass' | 'caution' | 'poor' | 'dim';

const UNICODE_GLYPH: Record<Glyph, string> = {
  pass: '✓',
  caution: '!',
  poor: '✗',
  dim: '◌',
};

const ASCII_GLYPH: Record<Glyph, string> = {
  pass: '[OK]',
  caution: '[!]',
  poor: '[X]',
  dim: '[?]',
};

/** ANSI SGR codes. cyan is reserved for paths/commands (actionable). */
const ANSI: Record<string, string> = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

const VERDICT_GLYPH: Record<Verdict, Glyph> = {
  pass: 'pass',
  caution: 'caution',
  poor: 'poor',
  no_verdict: 'dim',
};

const GLYPH_COLOR: Record<Glyph, keyof typeof ANSI> = {
  pass: 'green',
  caution: 'yellow',
  poor: 'red',
  dim: 'gray',
};

export interface PaletteOptions {
  ascii?: boolean;
  color?: boolean;
}

export function glyphFor(verdict: Verdict, opts: PaletteOptions = {}): string {
  const g = VERDICT_GLYPH[verdict];
  return opts.ascii ? ASCII_GLYPH[g] : UNICODE_GLYPH[g];
}

export function glyph(g: Glyph, opts: PaletteOptions = {}): string {
  return opts.ascii ? ASCII_GLYPH[g] : UNICODE_GLYPH[g];
}

export function paint(text: string, color: keyof typeof ANSI, opts: PaletteOptions = {}): string {
  if (opts.color !== true) return text;
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

export function colorForVerdict(verdict: Verdict): keyof typeof ANSI {
  return GLYPH_COLOR[VERDICT_GLYPH[verdict]];
}

/** Resolve colour intent from environment (NO_COLOR convention + TTY). */
export function resolveColor(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return false;
  if (env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '') return true;
  return isTTY;
}

const BACKTICK_RE = /`[^`]+`/g;
// A single alternation over PLAIN text: `command` span OR a path token. One
// String.replace pass means the regex never re-scans painted ANSI (the source
// string is scanned, replacements are not), so escapes can't be matched into.
const INLINE_RE = /`[^`]+`|(?:\.{0,2}\/)?(?:[\w.@-]+\/)+[\w.@-]+(?::\d+)?/g;

/** Colour paths and `commands` cyan (actionable targets). No-op without color. */
export function colorizeInline(text: string, opts: PaletteOptions = {}): string {
  if (opts.color !== true) return text.replace(BACKTICK_RE, (m) => m.slice(1, -1));
  return text.replace(INLINE_RE, (m) => paint(m.startsWith('`') ? m.slice(1, -1) : m, 'cyan', opts));
}
