import type { Lang, Metric, RuleResult, SessionStats } from '../types.ts';
import { msg } from '../messages.ts';
import { estTokens, compactCount, succeeded } from './shared.ts';

/**
 * Rule ⑤ repeat-read waste (same unit, per external voice #6).
 *
 * Fires caution when some file was re-read ≥3 times AND the characters spent on
 * re-reads are ≥25% of all tool-result output. The ratio is chars ÷ chars only
 * (never mixing estimates with measured values); the token figure is display-
 * only and always labelled "(est.)" because Korean packs more tokens per char.
 *
 * No verdict when tool-result sizes could not be aggregated (all zero).
 */

export const RULE5_MIN_REREADS = 3;
export const RULE5_WASTE_RATIO = 0.25;

export interface Rule5Breakdown {
  maxReadsOfAFile: number;
  rereadChars: number;
  totalResultChars: number;
}

export function analyzeRule5(stats: SessionStats): Rule5Breakdown {
  const readCountByFile = new Map<string, number>();
  let rereadChars = 0;
  let totalResultChars = 0;
  let maxReadsOfAFile = 0;

  for (const e of stats.events) {
    const len = e.result?.contentLength ?? 0;
    totalResultChars += len;
    if (e.tool !== 'Read' || e.filePath === undefined || !succeeded(e)) continue;
    const prior = readCountByFile.get(e.filePath) ?? 0;
    const now = prior + 1;
    readCountByFile.set(e.filePath, now);
    if (now > maxReadsOfAFile) maxReadsOfAFile = now;
    if (now >= 2) rereadChars += len; // 2nd+ read of a file = a re-read
  }
  return { maxReadsOfAFile, rereadChars, totalResultChars };
}

export function evaluateRule5(stats: SessionStats, options: { lang?: Lang } = {}): RuleResult {
  const lang: Lang = options.lang ?? 'en';
  const b = analyzeRule5(stats);

  // No verdict unless repetition was even possible to assess: sizes must be
  // measurable AND some file must have been read more than once.
  if (b.totalResultChars === 0 || b.maxReadsOfAFile < 2) {
    return { ruleId: 'rule5', verdict: 'no_verdict', evidence: [], annotations: [] };
  }
  const ratio = b.rereadChars / b.totalResultChars;
  const pct = Math.round(ratio * 100);
  // gauge = efficiency (1 − waste), so a fuller bar is better; display the waste %.
  const metric: Metric = { kind: 'gauge', value: 1 - ratio, display: `${pct}%` };
  if (b.maxReadsOfAFile >= RULE5_MIN_REREADS && ratio >= RULE5_WASTE_RATIO) {
    const tok = compactCount(estTokens(b.rereadChars));
    return { ruleId: 'rule5', verdict: 'caution', evidence: [msg('rule5.waste', { pct, tok }, lang)], annotations: [], metric };
  }
  return { ruleId: 'rule5', verdict: 'pass', evidence: [msg('rule5.pass', {}, lang)], annotations: [], metric };
}
