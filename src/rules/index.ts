import type { Lang, RuleResult, SessionStats } from '../types.ts';
import { evaluateRule1, type Rule1Options } from './rule1.ts';
import { evaluateRule2 } from './rule2.ts';
import { evaluateRule3 } from './rule3.ts';
import { evaluateRule4 } from './rule4.ts';
import { evaluateRule5 } from './rule5.ts';

export interface EvaluateOptions extends Rule1Options {
  lang?: Lang;
}

/** Run all v1 rules in fixed order (rule ① first — it is the flagship). */
export function evaluateAll(stats: SessionStats, options: EvaluateOptions = {}): RuleResult[] {
  return [
    evaluateRule1(stats, options),
    evaluateRule2(stats, options),
    evaluateRule3(stats, options),
    evaluateRule4(stats, options),
    evaluateRule5(stats, options),
  ];
}

export { evaluateRule1, evaluateRule2, evaluateRule3, evaluateRule4, evaluateRule5 };
