import type { RuleResult, Verdict } from './types.ts';

/**
 * worst-of aggregation over scored rules.
 *
 * no_verdict rules are excluded from the grade entirely (not a penalty —
 * "honest floor over false precision"). If every rule is no_verdict, the whole
 * assessment is no_verdict. Individual rules already cap themselves at caution
 * when annotated, so the aggregate is a plain worst-of; but we re-assert the
 * cap here too (defence in depth): a poor verdict carrying annotations is
 * downgraded to caution.
 */

const RANK: Record<Exclude<Verdict, 'no_verdict'>, number> = { pass: 0, caution: 1, poor: 2 };
const BY_RANK: Array<Exclude<Verdict, 'no_verdict'>> = ['pass', 'caution', 'poor'];

export interface Assessment {
  overall: Verdict;
  /** All rule results in evaluation order (including no_verdict). */
  rules: RuleResult[];
  /** Rules that produced a grade (pass/caution/poor). */
  scored: RuleResult[];
  /** Rules that abstained. */
  noVerdict: RuleResult[];
  /** True if any scored rule carried an annotation (grade held to caution). */
  cappedByAnnotation: boolean;
}

function effectiveVerdict(r: RuleResult): Exclude<Verdict, 'no_verdict'> | null {
  if (r.verdict === 'no_verdict') return null;
  if (r.verdict === 'poor' && r.annotations.length > 0) return 'caution';
  return r.verdict;
}

export function aggregate(rules: RuleResult[]): Assessment {
  const scored = rules.filter((r) => r.verdict !== 'no_verdict');
  const noVerdict = rules.filter((r) => r.verdict === 'no_verdict');

  let worst = -1;
  let cappedByAnnotation = false;
  for (const r of scored) {
    const eff = effectiveVerdict(r);
    if (eff === null) continue;
    if (r.verdict === 'poor' && eff === 'caution') cappedByAnnotation = true;
    if (RANK[eff] > worst) worst = RANK[eff];
  }

  const overall: Verdict = worst < 0 ? 'no_verdict' : BY_RANK[worst] as Verdict;
  return { overall, rules, scored, noVerdict, cappedByAnnotation };
}
