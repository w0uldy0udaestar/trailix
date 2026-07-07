import type { Lang, RuleResult, SessionStats, ToolEvent } from '../types.ts';
import { fileList, msg } from '../messages.ts';

/**
 * Rule ① "edit without reading", split into two signals (Day 1 spike finding:
 * the harness itself enforces read-before-edit, so *successful* blind edits
 * are nearly always false positives — the real signal is in blocked attempts).
 *
 *  ①-a  blind-edit attempts: Edit calls the harness rejected with
 *       "File has not been read yet" — measured at 32/87 sessions. → caution.
 *  ①-b  edits that succeeded with no trace of reading through any accepted
 *       channel (below). Rare by construction; the only path to "poor".
 *
 * Accepted read channels (6): Read tool · Bash read commands (heuristic) ·
 * Bash output containing the target (NOT trackable in streaming v1 —
 * annotated instead) · auto-injected context files · subagent reads (NOT
 * trackable from the main file in v1 — annotated instead) · files created by
 * Write in-session.
 *
 * Honesty floor: any annotation caps the verdict at caution; "poor" requires
 * ≥3 clean unread files in a session with no untracked-read possibility.
 */

export const RULE1_POOR_THRESHOLD = 3;

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);

/** Files whose content Claude Code injects at session start (no Read needed). */
const INJECTED_PATTERNS = [/\/CLAUDE\.md$/i, /\/MEMORY\.md$/i, /\/memory\/[^/]+\.md$/i, /\/CLAUDE\.local\.md$/i];

const BASH_READ_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'grep', 'rg', 'wc', 'nl', 'strings', 'jq', 'xxd', 'hexdump', 'diff']);

function isInjectedFile(path: string): boolean {
  return INJECTED_PATTERNS.some((p) => p.test(path));
}

/**
 * Paths a Bash command plausibly read. Heuristic on purpose: token appears
 * after a known read command and looks like a path. Used only to *excuse*
 * files (reduce false firing), never to accuse — so over-matching is the
 * safe direction.
 */
export function bashReadPaths(command: string): string[] {
  const paths: string[] = [];
  for (const segment of command.split(/(?:\|{1,2}|;|&&|\n)/)) {
    const tokens = segment.trim().split(/\s+/);
    const cmdIndex = tokens.findIndex((t) => BASH_READ_COMMANDS.has(t.replace(/^.*\//, '')));
    if (cmdIndex === -1) continue;
    for (const token of tokens.slice(cmdIndex + 1)) {
      if (token.startsWith('-') || token.startsWith('$') || token.length < 2) continue;
      const cleaned = token.replace(/^['"]|['"]$/g, '');
      if (cleaned.includes('/') || /\.[a-z0-9]{1,8}$/i.test(cleaned)) paths.push(cleaned);
    }
  }
  return paths;
}

/** A path is "excused" by a bash-read if it matches exactly or by suffix. */
function bashExcuses(bashRead: Set<string>, filePath: string): boolean {
  if (bashRead.has(filePath)) return true;
  for (const p of bashRead) {
    if (filePath.endsWith('/' + p) || p.endsWith('/' + filePath)) return true;
    const base = p.replace(/^.*\//, '');
    if (base !== '' && filePath.endsWith('/' + base)) return true;
  }
  return false;
}

export interface Rule1Breakdown {
  blockedAttempts: number;
  unreadFiles: string[];
  bashUsed: boolean;
  usedSubagents: boolean;
}

export function analyzeRule1(stats: SessionStats): Rule1Breakdown {
  const known = new Set<string>();
  const bashRead = new Set<string>();
  const unread = new Set<string>();
  let blockedAttempts = 0;
  let bashUsed = false;

  // Events are iterated in logical order, so `known`/`bashRead` only ever
  // contain reads that happened *before* the edit being judged. A read that
  // happens after an unread edit does not un-fire it.
  for (const event of stats.events) {
    const { tool, filePath, command, result } = event;

    if (tool === 'Bash' && command !== undefined) {
      bashUsed = true;
      if (result === undefined || !result.isError) {
        for (const p of bashReadPaths(command)) bashRead.add(p);
      }
      continue;
    }
    if (filePath === undefined) continue;

    if (tool === 'Read') {
      if (result === undefined || !result.isError) known.add(filePath);
      continue;
    }
    if (tool === 'Write') {
      if (result !== undefined && result.isError) continue;
      const isUpdate = result?.writeKind === 'update';
      if (isUpdate && !isKnown(filePath)) unread.add(filePath);
      // after any successful Write the full content is known
      known.add(filePath);
      continue;
    }
    if (EDIT_TOOLS.has(tool)) {
      if (result?.unreadEditError === true) {
        blockedAttempts += 1;
        continue;
      }
      if (result !== undefined && result.isError) continue;
      if (!isKnown(filePath)) unread.add(filePath);
      continue;
    }
  }

  function isKnown(filePath: string): boolean {
    return known.has(filePath) || isInjectedFile(filePath) || bashExcuses(bashRead, filePath);
  }

  return {
    blockedAttempts,
    unreadFiles: [...unread],
    bashUsed,
    usedSubagents: stats.usedSubagents,
  };
}

export interface Rule1Options {
  lang?: Lang;
  /** Session is a resume/compaction descendant — prior reads unverifiable. */
  derivedSession?: boolean;
}

export function evaluateRule1(stats: SessionStats, options: Rule1Options = {}): RuleResult {
  const lang: Lang = options.lang ?? 'en';
  const b = analyzeRule1(stats);

  const editAttempted = b.blockedAttempts > 0 || stats.events.some(
    (e: ToolEvent) => (EDIT_TOOLS.has(e.tool) || e.tool === 'Write') && e.filePath !== undefined,
  );
  if (!editAttempted) {
    return { ruleId: 'rule1', verdict: 'no_verdict', evidence: [], annotations: [] };
  }

  const annotations: string[] = [];
  if (b.unreadFiles.length > 0 && b.bashUsed) annotations.push(msg('annotation.bashUntracked', {}, lang));
  if (b.unreadFiles.length > 0 && b.usedSubagents) annotations.push(msg('annotation.subagentUntracked', {}, lang));
  if (options.derivedSession === true) annotations.push(msg('annotation.priorSessionUnknown', {}, lang));

  const evidence: string[] = [];
  if (b.blockedAttempts > 0) {
    evidence.push(msg('rule1.attempts', { n: b.blockedAttempts }, lang));
  }
  if (b.unreadFiles.length > 0) {
    const key = annotations.length > 0 ? 'rule1.unread.estimated' : 'rule1.unread';
    evidence.push(msg(key, { n: b.unreadFiles.length, files: fileList(b.unreadFiles, lang) }, lang));
  }

  let verdict: RuleResult['verdict'];
  if (b.unreadFiles.length >= RULE1_POOR_THRESHOLD && annotations.length === 0) {
    verdict = 'poor';
  } else if (b.unreadFiles.length > 0 || b.blockedAttempts > 0) {
    verdict = 'caution';
  } else {
    verdict = 'pass';
    evidence.push(msg('rule1.pass', {}, lang));
  }

  return { ruleId: 'rule1', verdict, evidence, annotations };
}
