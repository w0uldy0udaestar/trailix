import type { Lang, Metric, RuleResult, SessionStats, Verdict } from './types.ts';
import { msg } from './messages.ts';
import { isScorable } from './parser.ts';
import { evaluateAll, type EvaluateOptions } from './rules/index.ts';
import { aggregate, type Assessment } from './aggregate.ts';
import { factLines, formatDuration } from './facts.ts';

/**
 * The single structured card model. Every surface (CLI, hook, skill) renders
 * from this — serializers put clothes on it, they never recompute. Scope is
 * always the whole session ("session · N turns"), never just one turn.
 */

export type CardState = 'normal' | 'no_verdict' | 'empty';

export interface VerdictLine {
  verdict: Verdict;
  text: string;
  /** Visual metric — set only on a rule's first evidence line. */
  metric?: Metric;
  /** Short viz label for the metric column (undefined when no metric). */
  label?: string;
}

export interface Card {
  state: CardState;
  overall: Verdict;
  headline: string;
  scope: string;
  dateLabel?: string;
  durationLabel?: string;
  verdicts: VerdictLine[];
  /** Dim lines: annotations + which rules abstained. */
  notes: string[];
  facts: string[];
  next?: string;
  lang: Lang;
}

const HEADLINE_KEY: Record<Verdict, 'headline.pass' | 'headline.caution' | 'headline.poor' | 'headline.no_verdict'> = {
  pass: 'headline.pass',
  caution: 'headline.caution',
  poor: 'headline.poor',
  no_verdict: 'headline.no_verdict',
};

function buildNotes(assessment: Assessment, lang: Lang): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const r of assessment.scored) {
    for (const a of r.annotations) {
      if (!seen.has(a)) {
        seen.add(a);
        notes.push(a);
      }
    }
  }
  if (assessment.noVerdict.length > 0) {
    const names = assessment.noVerdict.map((r) => msg(`rulename.${r.ruleId}` as 'rulename.rule1', {}, lang));
    notes.push(msg('note.not_applicable', { rules: names.join(', ') }, lang));
  }
  return notes;
}

function verdictLines(assessment: Assessment, lang: Lang): VerdictLine[] {
  const lines: VerdictLine[] = [];
  for (const r of assessment.scored) {
    r.evidence.forEach((text, i) => {
      // The metric (and its label) binds to the first evidence line only; later
      // lines (rule1's file list) render as plain text.
      const withMetric = i === 0 && r.metric !== undefined;
      lines.push({
        verdict: r.verdict,
        text,
        metric: withMetric ? r.metric : undefined,
        label: withMetric ? msg(`viz.${r.ruleId}` as 'viz.rule2', {}, lang) : undefined,
      });
    });
  }
  return lines;
}

export interface BuildCardOptions extends EvaluateOptions {
  /** Session date label, e.g. "07-07". Passed in (no clock in the engine). */
  dateLabel?: string;
  durationLabel?: string;
}

/** MM-DD from an epoch-ms timestamp taken from a record (no wall clock). */
function dateLabelFrom(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

export function buildCard(stats: SessionStats, options: BuildCardOptions = {}): Card {
  const lang: Lang = options.lang ?? 'en';
  const scope = stats.humanInputCount === 1
    ? msg('scope.session.one', {}, lang)
    : msg('scope.session', { n: stats.humanInputCount }, lang);
  const facts = factLines(stats, lang);

  const dateLabel = options.dateLabel ?? (stats.firstTs !== undefined ? dateLabelFrom(stats.firstTs) : undefined);
  const durationMin =
    stats.firstTs !== undefined && stats.lastTs !== undefined && stats.lastTs > stats.firstTs
      ? Math.round((stats.lastTs - stats.firstTs) / 60000)
      : undefined;
  const durationLabel = options.durationLabel ?? (durationMin !== undefined && durationMin > 0 ? formatDuration(durationMin, lang) : undefined);

  // Empty: nothing happened this session. Guarded on scorability so a session
  // that is unscorable (e.g. all-unknown records) but has 0 events falls
  // through to the honest no_verdict state instead of the onboarding message.
  if (stats.events.length === 0 && isScorable(stats)) {
    return {
      state: 'empty',
      overall: 'no_verdict',
      headline: msg('state.empty.title', {}, lang),
      scope,
      dateLabel,
      durationLabel,
      verdicts: [],
      notes: [],
      facts,
      next: `${msg('next.after_work', {}, lang)} · ${msg('next.list_hint', {}, lang)}`,
      lang,
    };
  }

  const rules: RuleResult[] = evaluateAll(stats, options);
  const assessment = aggregate(rules);

  // Unscorable data, or every rule abstained → honest no-verdict state.
  if (!isScorable(stats) || assessment.overall === 'no_verdict') {
    return {
      state: 'no_verdict',
      overall: 'no_verdict',
      headline: msg('state.no_verdict', {}, lang),
      scope,
      dateLabel,
      durationLabel,
      verdicts: [],
      notes: buildNotes(assessment, lang),
      facts,
      next: msg('next.after_work', {}, lang),
      lang,
    };
  }

  return {
    state: 'normal',
    overall: assessment.overall,
    headline: msg(HEADLINE_KEY[assessment.overall], {}, lang),
    scope,
    dateLabel,
    durationLabel,
    verdicts: verdictLines(assessment, lang),
    notes: buildNotes(assessment, lang),
    facts,
    lang,
  };
}
