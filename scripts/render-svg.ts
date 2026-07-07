#!/usr/bin/env node
/**
 * Renders the demo card to a static colour SVG for the README hero. GitHub
 * shows SVGs as images, so the semantic colours (green ✓, yellow !, cyan
 * paths) survive — unlike a plain code block. Pure Node, no external tools.
 *
 *   node scripts/render-svg.ts > docs/demo-card.svg
 *
 * Reuses renderCli (colour on) and re-skins the ANSI runs as <tspan>s, so all
 * layout/width logic is shared with the real renderer.
 */
import { demoCard } from '../src/demo.ts';
import { renderCli } from '../src/render/index.ts';
import { charWidth } from '../src/render/width.ts';

const COLORS: Record<string, string> = {
  '0': '#cdd6f4', // reset → default text (Catppuccin text)
  '31': '#f38ba8', // red
  '32': '#a6e3a1', // green
  '33': '#f9e2af', // yellow
  '36': '#89dcfb', // cyan
  '90': '#6c7086', // gray (dim)
};

const CELL_W = 8.4;
const LINE_H = 20;
const PAD_X = 20;
const PAD_Y = 18;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Run { text: string; color: string }

function parseLine(line: string): Run[] {
  const runs: Run[] = [];
  let color = COLORS['0'] as string;
  let i = 0;
  const re = /\x1b\[([0-9;]*)m/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) runs.push({ text: line.slice(last, m.index), color });
    const code = (m[1] as string).split(';').pop() ?? '0';
    color = COLORS[code] ?? (COLORS['0'] as string);
    last = re.lastIndex;
    i++;
  }
  if (last < line.length) runs.push({ text: line.slice(last), color });
  return runs;
}

function colWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0) as number);
  return w;
}

const card = await demoCard('en');
const ansi = renderCli(card, { env: { FORCE_COLOR: '1' }, isTTY: true, termWidth: 80 });
const lines = ansi.split('\n');

const cols = 82;
const width = Math.round(cols * CELL_W + PAD_X * 2);
const height = lines.length * LINE_H + PAD_Y * 2;

const body: string[] = [];
lines.forEach((line, row) => {
  const y = PAD_Y + row * LINE_H + 14;
  let col = 0;
  const spans: string[] = [];
  for (const run of parseLine(line)) {
    if (run.text === '') continue;
    const x = PAD_X + col * CELL_W;
    const w = colWidth(run.text);
    // textLength pins each run to an exact width so the box aligns regardless
    // of the viewer's monospace advance width.
    spans.push(`<tspan x="${x.toFixed(1)}" y="${y}" textLength="${(w * CELL_W).toFixed(1)}" lengthAdjust="spacingAndGlyphs" fill="${run.color}">${esc(run.text)}</tspan>`);
    col += w;
  }
  if (spans.length > 0) body.push(spans.join(''));
});

// No whitespace between tspans: with xml:space="preserve" any newline/indent
// between them would render as visible text.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace" font-size="14"><rect width="${width}" height="${height}" rx="10" fill="#1e1e2e"/><text xml:space="preserve" font-variant-ligatures="none">${body.join('')}</text></svg>
`;
process.stdout.write(svg);
