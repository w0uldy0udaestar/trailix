import type { Lang, SessionStats } from './types.ts';
import { msg } from './messages.ts';
import { analyzeRule2 } from './rules/rule2.ts';
import { analyzeRule4 } from './rules/rule4.ts';
import { estTokens, compactCount, succeeded } from './rules/shared.ts';

/**
 * Fact lines — the no-verdict truths that always print, even when every rule
 * abstains. This is the direct answer to the original pain ("how much did it
 * actually read?"). Every figure here must be literally true; estimated ones
 * are labelled.
 */

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);
const BASH_SEARCH = /^\s*(?:grep|rg|ag|ack|find|fd|ripgrep)\b/;

export interface FactCounts {
  sources: number;
  reads: number;
  edits: number;
  searches: number;
  searchEstimated: boolean;
  subagents: number;
  durationMin?: number;
  estTok: number;
}

export function computeFactCounts(stats: SessionStats): FactCounts {
  const editedFiles = new Set<string>();
  let reads = 0;
  let webSearches = 0;
  let bashSearches = 0;
  let totalResultChars = 0;

  for (const e of stats.events) {
    totalResultChars += e.result?.contentLength ?? 0;
    if (e.tool === 'Read' && succeeded(e)) reads += 1;
    else if (e.tool === 'WebSearch') webSearches += 1;
    else if (e.tool === 'Bash' && e.command !== undefined && BASH_SEARCH.test(e.command)) bashSearches += 1;
    else if (e.filePath !== undefined && succeeded(e) && (EDIT_TOOLS.has(e.tool) || (e.tool === 'Write' && e.result?.writeKind === 'update'))) {
      editedFiles.add(e.filePath);
    }
  }

  const { domains } = analyzeRule2(stats);
  const { subagents } = analyzeRule4(stats);
  const durationMin =
    stats.firstTs !== undefined && stats.lastTs !== undefined && stats.lastTs > stats.firstTs
      ? Math.round((stats.lastTs - stats.firstTs) / 60000)
      : undefined;

  return {
    sources: domains.length,
    reads,
    edits: editedFiles.size,
    searches: webSearches + bashSearches,
    searchEstimated: bashSearches > 0,
    subagents,
    durationMin,
    estTok: estTokens(totalResultChars),
  };
}

/** Fact lines for the card (≤2 lines): a sources line and an activity line. */
export function factLines(stats: SessionStats, lang: Lang): string[] {
  const f = computeFactCounts(stats);
  const lines: string[] = [];

  if (f.sources > 0) lines.push(msg('fact.sources', { n: f.sources }, lang));

  const activity: string[] = [];
  if (f.reads > 0) activity.push(msg('fact.read', { n: f.reads }, lang));
  if (f.edits > 0) activity.push(msg('fact.edited', { n: f.edits }, lang));
  if (f.searches > 0) {
    activity.push(msg(f.searchEstimated ? 'fact.searched.est' : 'fact.searched', { n: f.searches }, lang));
  }
  if (f.subagents > 0) activity.push(msg('fact.subagents', { n: f.subagents }, lang));
  if (f.durationMin !== undefined && f.durationMin > 0) activity.push(msg('fact.duration', { n: f.durationMin }, lang));
  if (f.estTok > 0) activity.push(msg('fact.tokens', { n: compactCount(f.estTok) }, lang));

  if (activity.length > 0) lines.push(activity.join(' · '));
  return lines;
}
