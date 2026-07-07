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
/**
 * The rule needs ≥2 actual source fetches to judge cross-validation. Domains
 * only come from WebFetch URLs — WebSearch results are not parsed — so a
 * search-only turn has domains structurally unavailable and must NOT be
 * reported as "0 sources" (that was a systematic false positive).
 */
export const RULE2_MIN_FETCHES = 2;

export interface Rule2Breakdown {
  domains: string[];
  fetches: number;
  searches: number;
}

export function analyzeRule2(stats: SessionStats): Rule2Breakdown {
  const domains = new Set<string>();
  let fetches = 0;
  let searches = 0;
  for (const e of stats.events) {
    if (e.tool === 'WebFetch') {
      fetches += 1;
      if (e.url !== undefined) {
        const d = domainOf(e.url);
        if (d !== undefined) domains.add(d);
      }
    } else if (e.tool === 'WebSearch') {
      searches += 1;
    }
  }
  return { domains: [...domains], fetches, searches };
}

export function evaluateRule2(stats: SessionStats, options: { lang?: Lang } = {}): RuleResult {
  const lang: Lang = options.lang ?? 'en';
  const b = analyzeRule2(stats);

  // Only judged when sources were actually fetched. Search-only research is a
  // backlog concern (results aren't parsed), never a "0 sources" caution.
  if (b.fetches < RULE2_MIN_FETCHES) {
    return { ruleId: 'rule2', verdict: 'no_verdict', evidence: [], annotations: [] };
  }
  const n = b.domains.length;
  if (n < RULE2_MIN_DOMAINS) {
    const key = n === 1 ? 'rule2.thin.one' : 'rule2.thin';
    return { ruleId: 'rule2', verdict: 'caution', evidence: [msg(key, { n }, lang)], annotations: [] };
  }
  return { ruleId: 'rule2', verdict: 'pass', evidence: [msg('rule2.pass', { n }, lang)], annotations: [] };
}
