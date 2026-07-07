import type { Card, VerdictLine } from '../card.ts';
import type { Verdict } from '../types.ts';
import { msg } from '../messages.ts';
import { boxHeader } from './box.ts';
import { clampWidth, stringWidth, wrapText } from './width.ts';
import {
  colorForVerdict,
  colorizeInline,
  glyph,
  glyphFor,
  paint,
  resolveColor,
  type PaletteOptions,
} from './palette.ts';

/** Card width ceiling (design rule 3A) and the hook ⎿-gutter reserve. */
export const MAX_CARD_WIDTH = 80;
export const HOOK_GUTTER = 5;
/** Below this terminal width the box is dropped for plain mode (design 3A). */
export const BOX_MIN_TERM = 80;
export const HOOK_MAX_CHARS = 10_000;
const EVIDENCE_MAX = 76;

interface RenderOpts extends PaletteOptions {
  width: number;
  boxed: boolean;
}

function gradeWord(v: Verdict, opts: PaletteOptions, lang: string): string {
  const key = `grade.${v}` as 'grade.pass';
  const word = msg(key, {}, lang as 'en');
  return paint(word, colorForVerdict(v), opts);
}

function headerBody(card: Card, inner: number, opts: PaletteOptions): string[] {
  const g = glyphFor(card.overall, opts);
  const gGlyph = paint(g, colorForVerdict(card.overall), opts);
  if (card.state === 'normal') {
    const prefix = `${gGlyph} ${gradeWord(card.overall, opts, card.lang)}  `;
    const prefixW = stringWidth(prefix);
    const wrapped = wrapText(card.headline, Math.max(8, inner - prefixW));
    return wrapped.map((line, i) => (i === 0 ? prefix + line : '  ' + line));
  }
  // no_verdict / empty: the headline is the message itself
  const wrapped = wrapText(card.headline, Math.max(8, inner - 2));
  return wrapped.map((line, i) => (i === 0 ? `${gGlyph} ${line}` : `  ${line}`));
}

function sectionLabel(key: 'section.verdicts' | 'section.facts' | 'section.next', lang: string, opts: PaletteOptions): string {
  return ' ' + paint(msg(key, {}, lang as 'en'), 'gray', opts);
}

function verdictRow(v: VerdictLine, width: number, opts: PaletteOptions): string {
  const gPlain = glyphFor(v.verdict, opts);
  const budget = Math.min(EVIDENCE_MAX, width - 3 - stringWidth(gPlain) - 1);
  const g = paint(gPlain, colorForVerdict(v.verdict), opts);
  return `   ${g} ${colorizeInline(clampWidth(v.text, budget), opts)}`;
}

function factRow(text: string, width: number, opts: PaletteOptions): string {
  return '   ' + colorizeInline(clampWidth(text, width - 3), opts);
}

function noteRow(text: string, width: number, opts: PaletteOptions): string {
  const dot = glyph('dim', opts);
  const budget = width - 3 - stringWidth(dot) - 1;
  return '   ' + paint(`${dot} ${clampWidth(text, budget)}`, 'gray', opts);
}

function renderCard(card: Card, o: RenderOpts): string {
  const opts: PaletteOptions = { ascii: o.ascii, color: o.color };
  const lang = card.lang;
  const out: string[] = [];

  // ── header ──
  const title =
    `trailix · ${card.scope}` +
    (card.dateLabel !== undefined ? ` ─ ${card.dateLabel}` : '') +
    (card.durationLabel !== undefined ? ` · ${card.durationLabel}` : '');

  if (o.boxed) {
    out.push(...boxHeader(clampWidth(title, o.width - 6), headerBody(card, o.width - 4, opts), o.width));
  } else {
    out.push(paint(clampWidth(title, o.width), 'gray', opts));
    for (const line of headerBody(card, o.width, opts)) out.push(line);
  }

  // ── verdicts ──
  if (card.verdicts.length > 0) {
    out.push(sectionLabel('section.verdicts', lang, opts));
    for (const v of card.verdicts) out.push(verdictRow(v, o.width, opts));
  }

  // ── facts ──
  if (card.facts.length > 0) {
    out.push(sectionLabel('section.facts', lang, opts));
    for (const f of card.facts) out.push(factRow(f, o.width, opts));
  }

  // ── dim notes ──
  for (const n of card.notes) out.push(noteRow(n, o.width, opts));

  // ── next ──
  if (card.next !== undefined) {
    out.push(sectionLabel('section.next', lang, opts));
    // colourize the whole string first, THEN wrap: colorizeInline matches
    // closed `command` spans, which a per-line wrap could split (leaking
    // literal backticks). Painted spans are ANSI-aware for the wrap width.
    for (const line of wrapText(colorizeInline(card.next, opts), o.width - 3)) out.push('   ' + line);
  }

  return out.join('\n');
}

export interface CliRenderOptions {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  termWidth?: number;
  ascii?: boolean;
}

/**
 * Fold non-glyph unicode punctuation to ASCII for --ascii. Every replacement is
 * width-preserving (1 col → 1 col) so a line clamped before folding still fits;
 * box chars only appear when boxed, which --ascii disables.
 */
function asciiFold(s: string): string {
  return s
    .replace(/[╭╮╰╯│]/g, '')
    .replace(/[─·—]/g, '-')
    .replace(/…/g, '.');
}

/** CLI (TTY): ANSI colour + unicode box, NO_COLOR / --ascii aware. */
export function renderCli(card: Card, options: CliRenderOptions = {}): string {
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? false;
  const term = options.termWidth ?? 80;
  const width = Math.min(term, MAX_CARD_WIDTH);
  const ascii = options.ascii === true || (env['TRAILIX_ASCII'] !== undefined && env['TRAILIX_ASCII'] !== '');
  const out = renderCard(card, {
    width,
    boxed: term >= BOX_MIN_TERM && !ascii, // --ascii promises no box (help text)
    ascii,
    color: resolveColor(env, isTTY),
  });
  return ascii ? asciiFold(out) : out;
}

/**
 * Stop-hook systemMessage: colourless unicode, starts with "\n" (so the
 * "Stop says: " prefix does not shove the box right), width reserves the
 * ⎿ gutter, hard-capped at 10,000 chars (Day 1 spike: verified code limit).
 */
export function renderHook(card: Card, options: { termWidth?: number } = {}): string {
  const term = options.termWidth ?? 80;
  const width = Math.min(term - HOOK_GUTTER, MAX_CARD_WIDTH);
  const body = renderCard(card, { width, boxed: term >= BOX_MIN_TERM, ascii: false, color: false });
  const out = '\n' + body;
  return out.length > HOOK_MAX_CHARS ? out.slice(0, HOOK_MAX_CHARS - 1) + '…' : out;
}

/** /trailix skill: markdown (Claude Code chat rendering). */
export function renderSkill(card: Card): string {
  const lang = card.lang;
  const out: string[] = [];
  const g = glyphFor(card.overall, {});
  const header =
    card.state === 'normal'
      ? `**${g} ${msg(`grade.${card.overall}` as 'grade.pass', {}, lang)} — ${card.headline}**`
      : `**${g} ${card.headline}**`;
  const meta = [card.scope, card.dateLabel, card.durationLabel].filter((x) => x !== undefined).join(' · ');
  out.push(`${header}  ·  ${meta}`, '');

  if (card.verdicts.length > 0) {
    out.push(`**${msg('section.verdicts', {}, lang)}**`);
    for (const v of card.verdicts) out.push(`- ${glyphFor(v.verdict, {})} ${v.text}`);
    out.push('');
  }
  if (card.facts.length > 0) {
    out.push(`**${msg('section.facts', {}, lang)}**`);
    for (const f of card.facts) out.push(`- ${f}`);
    out.push('');
  }
  for (const n of card.notes) out.push(`> ${glyph('dim', {})} ${n}`);
  if (card.next !== undefined) out.push('', `_${card.next}_`);
  return out.join('\n').trimEnd();
}
