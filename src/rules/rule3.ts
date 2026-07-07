import type { Lang, RuleResult, SessionStats, ToolEvent } from '../types.ts';
import { msg } from '../messages.ts';
import { succeeded } from './shared.ts';

/**
 * Rule ③ deep-read vs skim.
 *
 * A "skim" is counted only under a combined condition (design: avoid double-
 * penalising with rule ⑤): a file read exactly once, that read being partial
 * (limit/offset set), and the file edited afterwards — i.e. glanced at the top
 * and changed it. Files read fully, or read more than once (paginated /
 * revisited), count as deep. Partial reads that are never edited don't count
 * at all — reading part of a huge file is not a skim.
 *
 * Fires caution when skim ratio > 70% over a meaningful sample. No verdict when
 * there are fewer than 3 read signals (design threshold).
 */

export const RULE3_SKIM_RATIO = 0.7;
export const RULE3_MIN_READS = 3;
export const RULE3_MIN_SAMPLE = 3;

interface FileReads {
  count: number;
  allPartial: boolean;
  firstEditSeq?: number;
  lastReadBeforeEdit?: ToolEvent;
}

export interface Rule3Breakdown {
  deep: number;
  skim: number;
  totalReads: number;
}

export function analyzeRule3(stats: SessionStats): Rule3Breakdown {
  // First pass: earliest edit seq per file. Write-create is excluded (nothing
  // existed to read — consistent with facts.ts); Write-update counts as an edit.
  const firstEdit = new Map<string, number>();
  const EDITS = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);
  for (const e of stats.events) {
    if (e.filePath === undefined || !succeeded(e)) continue;
    const isEdit = EDITS.has(e.tool) || (e.tool === 'Write' && e.result?.writeKind === 'update');
    if (isEdit && !firstEdit.has(e.filePath)) firstEdit.set(e.filePath, e.seq);
  }

  // Second pass: reads per file that occur before that file's first edit.
  const reads = new Map<string, FileReads>();
  let totalReads = 0;
  for (const e of stats.events) {
    if (e.tool !== 'Read' || e.filePath === undefined || !succeeded(e)) continue;
    totalReads += 1;
    const editSeq = firstEdit.get(e.filePath);
    if (editSeq === undefined || e.seq > editSeq) continue; // only reads before the edit matter
    const partial = e.readLimit !== undefined || e.readOffset !== undefined;
    const fr = reads.get(e.filePath) ?? { count: 0, allPartial: true };
    fr.count += 1;
    fr.allPartial = fr.allPartial && partial;
    reads.set(e.filePath, fr);
  }

  let deep = 0;
  let skim = 0;
  for (const [, fr] of reads) {
    if (fr.count === 1 && fr.allPartial) skim += 1;
    else deep += 1;
  }
  return { deep, skim, totalReads };
}

export function evaluateRule3(stats: SessionStats, options: { lang?: Lang } = {}): RuleResult {
  const lang: Lang = options.lang ?? 'en';
  const b = analyzeRule3(stats);

  const sample = b.deep + b.skim;
  if (b.totalReads < RULE3_MIN_READS || sample === 0) {
    return { ruleId: 'rule3', verdict: 'no_verdict', evidence: [], annotations: [] };
  }
  const ratio = b.skim / sample;
  if (sample >= RULE3_MIN_SAMPLE && ratio > RULE3_SKIM_RATIO) {
    return { ruleId: 'rule3', verdict: 'caution', evidence: [msg('rule3.skim', { deep: b.deep, skim: b.skim }, lang)], annotations: [] };
  }
  return { ruleId: 'rule3', verdict: 'pass', evidence: [msg('rule3.pass', { deep: b.deep, skim: b.skim }, lang)], annotations: [] };
}
