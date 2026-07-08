import type { Metric, Verdict } from '../types.ts';
import { colorForVerdict, paint, type PaletteOptions } from './palette.ts';

/**
 * Verdict-line metric rendering: a unicode bar plus an optional figure.
 *
 * Bars are "higher = better" (polarity is unified in the rules) and painted
 * with the verdict colour, so the fill also carries meaning in the colourless
 * hook. Only █ (fill) and ░ (empty) are used: both are East-Asian *neutral*
 * width (1 column), unlike ● which is East-Asian *ambiguous* and renders 2
 * columns in Korean-locale terminals — that would tear alignment on the exact
 * surface trailix ships a Korean card for.
 */

export const GAUGE_WIDTH = 10;
export const COUNT_CAP = 8;

function glyphs(ascii: boolean): { fill: string; empty: string } {
  return ascii ? { fill: '#', empty: '-' } : { fill: '█', empty: '░' };
}

export interface RenderedMetric {
  /** The bar, coloured when opts.color is set. */
  bar: string;
  /** Language-neutral figure after the bar ("5:0", "30%"); '' for count. */
  value: string;
}

export function renderMetric(m: Metric, verdict: Verdict, opts: PaletteOptions): RenderedMetric {
  const g = glyphs(opts.ascii === true);
  const color = colorForVerdict(verdict);
  if (m.kind === 'gauge') {
    const v = m.value < 0 ? 0 : m.value > 1 ? 1 : m.value;
    const fill = Math.round(v * GAUGE_WIDTH);
    const bar = g.fill.repeat(fill) + g.empty.repeat(GAUGE_WIDTH - fill);
    return { bar: paint(bar, color, opts), value: m.display };
  }
  // count: the bar length IS the number (capped, with a trailing + past the cap).
  const n = m.n < 0 ? 0 : m.n;
  const shown = n > COUNT_CAP ? COUNT_CAP : n;
  const bar = g.fill.repeat(shown) + (n > COUNT_CAP ? '+' : '');
  return { bar: paint(bar, color, opts), value: '' };
}
