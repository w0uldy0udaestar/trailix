import type { Lang, RuleResult, SessionStats } from '../types.ts';
import { msg } from '../messages.ts';
import { CROSS_CHECK_TOOLS, DELEGATION_TOOLS } from './shared.ts';

/**
 * Rule ④ post-delegation cross-check.
 *
 * Spawning ≥2 subagents and then doing nothing to verify their output is a
 * caution. "Cross-check" (whitelist) = any main-thread source-consulting
 * action after the last delegation: reading a file, running a Bash test,
 * searching. A tool_result auto-flowing back does NOT count as cross-checking —
 * and it never appears as a tool_use, so looking only at post-delegation
 * tool_use events handles that for free.
 *
 * No verdict when ≤1 subagent was spawned.
 */

export const RULE4_MIN_SUBAGENTS = 2;

export interface Rule4Breakdown {
  subagents: number;
  crossChecked: boolean;
}

export function analyzeRule4(stats: SessionStats): Rule4Breakdown {
  let subagents = 0;
  let lastDelegationSeq = -1;
  for (const e of stats.events) {
    if (DELEGATION_TOOLS.has(e.tool)) {
      subagents += 1;
      if (e.seq > lastDelegationSeq) lastDelegationSeq = e.seq;
    }
  }
  const crossChecked = stats.events.some(
    (e) => e.seq > lastDelegationSeq && lastDelegationSeq >= 0 && CROSS_CHECK_TOOLS.has(e.tool),
  );
  return { subagents, crossChecked };
}

export function evaluateRule4(stats: SessionStats, options: { lang?: Lang } = {}): RuleResult {
  const lang: Lang = options.lang ?? 'en';
  const b = analyzeRule4(stats);

  if (b.subagents < RULE4_MIN_SUBAGENTS) {
    return { ruleId: 'rule4', verdict: 'no_verdict', evidence: [], annotations: [] };
  }
  if (!b.crossChecked) {
    return { ruleId: 'rule4', verdict: 'caution', evidence: [msg('rule4.unchecked', { n: b.subagents }, lang)], annotations: [] };
  }
  return { ruleId: 'rule4', verdict: 'pass', evidence: [msg('rule4.pass', { n: b.subagents }, lang)], annotations: [] };
}
