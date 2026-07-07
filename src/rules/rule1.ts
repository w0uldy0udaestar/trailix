import type { Lang, RuleResult, SessionStats, ToolEvent } from '../types.ts';
import { fileList, msg } from '../messages.ts';

/**
 * Rule ① "edit without reading", split into two signals (Day 1 spike finding:
 * the harness itself enforces read-before-edit, so *successful* blind edits
 * are nearly always false positives — the real signal is in blocked attempts).
 *
 *  ①-a  blind-edit attempts: Edit/Write calls the harness rejected with
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
 * Edits whose outcome was never recorded (live/aborted session) are never
 * counted as unread — the result may well have been a harness rejection.
 */

export const RULE1_POOR_THRESHOLD = 3;

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * Files whose content Claude Code injects at session start (no Read needed).
 * Kept narrow on purpose: auto-memory lives under the ~/.claude tree, and a
 * repo's own memory/ directory is NOT injected — must not be excused.
 */
const INJECTED_PATTERNS = [
  /\/CLAUDE\.md$/i,
  /\/CLAUDE\.local\.md$/i,
  /\/\.claude\/(?:projects\/[^/]+\/)?memory\/[^/]+\.md$/i,
];

/** Commands whose non-flag operands are read directly (cat Makefile). */
const DIRECT_READ_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'nl', 'strings', 'xxd', 'hexdump', 'wc', 'diff']);
/** Commands whose FIRST non-flag operand is a pattern/script, not a path. */
const PATTERN_READ_COMMANDS = new Set(['grep', 'rg', 'sed', 'awk', 'jq']);

function isInjectedFile(path: string): boolean {
  return INJECTED_PATTERNS.some((p) => p.test(path));
}

interface Token {
  text: string;
  /** Token contained a quoted span — likely a pattern/message, not a flag. */
  quoted: boolean;
}

/**
 * Shell-ish tokenizer: splits a command into segments at unquoted
 * | ; & and newlines, keeping quoted spans (with their separators and
 * whitespace) inside a single token. Not a full shell parser — just enough
 * that `grep 'a|b' file` is one segment and 'a|b' one token.
 */
function tokenizeSegments(command: string): Token[][] {
  const segments: Token[][] = [];
  let tokens: Token[] = [];
  let text = '';
  let quoted = false;
  let quote: '"' | "'" | null = null;

  const endToken = (): void => {
    if (text !== '') tokens.push({ text, quoted });
    text = '';
    quoted = false;
  };
  const endSegment = (): void => {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;
    if (quote !== null) {
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        text += command[++i];
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      text += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      text += command[++i];
      continue;
    }
    if (ch === '|' || ch === ';' || ch === '&' || ch === '\n') {
      endSegment();
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      endToken();
      continue;
    }
    text += ch;
  }
  endSegment();
  return segments;
}

const basename = (p: string): string => p.replace(/^.*\//, '');

/**
 * Paths a Bash command plausibly read. Heuristic on purpose, and used only to
 * *excuse* files (reduce false firing), never to accuse — so over-matching is
 * the safe direction. Pattern-first commands (grep/sed/awk/jq) skip their
 * pattern/script operand so a filename-shaped search pattern cannot excuse a
 * genuinely unread file.
 */
export function bashReadPaths(command: string): string[] {
  const paths: string[] = [];
  for (const tokens of tokenizeSegments(command)) {
    const cmdIndex = tokens.findIndex(
      (t) => !t.quoted && (DIRECT_READ_COMMANDS.has(basename(t.text)) || PATTERN_READ_COMMANDS.has(basename(t.text))),
    );
    if (cmdIndex === -1) continue;
    const direct = DIRECT_READ_COMMANDS.has(basename((tokens[cmdIndex] as Token).text));
    let patternSkipped = direct; // pattern-first commands still owe one skip
    let skipNext = false;
    for (const token of tokens.slice(cmdIndex + 1)) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      const t = token.text;
      if (!token.quoted && t.startsWith('-')) {
        // -e/-f take a pattern(-file) value in the next token
        if (/^-(?:e|f|-regexp|-file)$/.test(t)) skipNext = true;
        continue;
      }
      if (!patternSkipped) {
        patternSkipped = true;
        continue;
      }
      if (t.startsWith('$') || t.length < 2) continue;
      // unquoted globs are expanded by the shell — the literal token is not a
      // real path. Quoted tokens are literal: (), [] are legit in paths
      // (Next.js route groups, dynamic segments) and must NOT be dropped.
      if (!token.quoted && /[*?]/.test(t)) continue;
      if (direct || t.includes('/') || /\.[a-z0-9]{1,8}$/i.test(t)) paths.push(t);
    }
  }
  return paths;
}

/** A path is "excused" by a bash-read if it matches exactly or by suffix. */
function bashExcuses(bashRead: Set<string>, filePath: string): boolean {
  if (bashRead.has(filePath)) return true;
  for (const p of bashRead) {
    if (filePath.endsWith('/' + p) || p.endsWith('/' + filePath)) return true;
    const base = basename(p);
    if (base !== '' && filePath.endsWith('/' + base)) return true;
  }
  return false;
}

export interface Rule1Breakdown {
  blockedAttempts: number;
  unreadFiles: string[];
  /** Edits whose result was never recorded (live/aborted session). */
  unresolvedEdits: number;
  bashUsed: boolean;
  usedSubagents: boolean;
}

export function analyzeRule1(stats: SessionStats): Rule1Breakdown {
  const known = new Set<string>();
  const bashRead = new Set<string>();
  const unread = new Set<string>();
  let blockedAttempts = 0;
  let unresolvedEdits = 0;
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
      // the harness also rejects blind overwrites — that is signal ①-a too
      if (result?.unreadEditError === true) {
        blockedAttempts += 1;
        continue;
      }
      if (result !== undefined && result.isError) continue;
      const isUpdate = result?.writeKind === 'update';
      if (isUpdate && !isKnown(filePath)) unread.add(filePath);
      // after a Write (attempted or confirmed) the full content is known
      known.add(filePath);
      continue;
    }
    if (EDIT_TOOLS.has(tool)) {
      if (result?.unreadEditError === true) {
        blockedAttempts += 1;
        continue;
      }
      if (result === undefined) {
        // outcome never observed (flush boundary / aborted session) — it may
        // well have been a harness rejection; never counted as unread
        unresolvedEdits += 1;
        continue;
      }
      if (result.isError) continue;
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
    unresolvedEdits,
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

  // Only resolved edit activity grants a verdict: a session whose edits all
  // went unrecorded — or that only created new files — is honestly unscorable.
  const editAttempted =
    b.blockedAttempts > 0 ||
    b.unreadFiles.length > 0 ||
    stats.events.some(
      (e: ToolEvent) =>
        e.filePath !== undefined &&
        ((EDIT_TOOLS.has(e.tool) && e.result !== undefined && !e.result.isError) ||
          (e.tool === 'Write' && e.result?.writeKind === 'update')),
    );
  if (!editAttempted) {
    return { ruleId: 'rule1', verdict: 'no_verdict', evidence: [], annotations: [] };
  }

  const annotations: string[] = [];
  if (b.unreadFiles.length > 0 && b.bashUsed) annotations.push(msg('annotation.bashUntracked', {}, lang));
  if (b.unreadFiles.length > 0 && b.usedSubagents) annotations.push(msg('annotation.subagentUntracked', {}, lang));
  if (b.unresolvedEdits > 0) annotations.push(msg('annotation.editUnresolved', { n: b.unresolvedEdits }, lang));
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
