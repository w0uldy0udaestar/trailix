import type { Lang, RuleResult, SessionStats } from '../types.ts';
import { msg } from '../messages.ts';
import { domainOf } from './shared.ts';

/**
 * Rule ② source cross-check (count proxy).
 *
 * Signal: unique source domains from WebFetch URLs. A research turn that
 * consulted fewer than two distinct sources gets a caution — thin
 * cross-validation. Non-research turns (no web activity at all) get no verdict.
 *
 * Deliberately NOT judged: whether opposing views were sought — that is a
 * semantic call, out of scope for a rule-based v1 (backlog).
 */

export const RULE2_MIN_DOMAINS = 2;
/** Below this many web actions it is an incidental lookup, not a research turn. */
export const RULE2_MIN_WEB_SIGNALS = 2;

export interface Rule2Breakdown {
  domains: string[];
  webSignals: number;
}

export function analyzeRule2(stats: SessionStats): Rule2Breakdown {
  const domains = new Set<string>();
  let webSignals = 0;
  for (const e of stats.events) {
    if (e.tool === 'WebFetch') {
      webSignals += 1;
      if (e.url !== undefined) {
        const d = domainOf(e.url);
        if (d !== undefined) domains.add(d);
      }
    } else if (e.tool === 'WebSearch') {
      webSignals += 1;
    }
  }
  return { domains: [...domains], webSignals };
}

export function evaluateRule2(stats: SessionStats, options: { lang?: Lang } = {}): RuleResult {
  const lang: Lang = options.lang ?? 'en';
  const b = analyzeRule2(stats);

  if (b.webSignals < RULE2_MIN_WEB_SIGNALS) {
    return { ruleId: 'rule2', verdict: 'no_verdict', evidence: [], annotations: [] };
  }
  const n = b.domains.length;
  if (n < RULE2_MIN_DOMAINS) {
    return { ruleId: 'rule2', verdict: 'caution', evidence: [msg('rule2.thin', { n }, lang)], annotations: [] };
  }
  return { ruleId: 'rule2', verdict: 'pass', evidence: [msg('rule2.pass', { n }, lang)], annotations: [] };
}
