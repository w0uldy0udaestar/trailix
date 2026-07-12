import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { QuestionScope, ScopeExtras, SessionStats, ToolEvent, ToolResultMeta, TurnScope } from './types.ts';

/**
 * Streaming session parser.
 *
 * Invariants (read-only observer, engineering review 5A):
 *  - one line in, aggregates updated, line discarded — no record array is kept
 *  - tool_result bodies are measured (length) and never stored
 *  - a trailing half-written line is ignored silently (live sessions)
 *  - unknown record types are counted and passed over, never fatal
 *
 * Real logs contain out-of-order pairs (tool_result written before its
 * tool_use — 25 pairs across 7 sessions in the spike corpus), so results are
 * joined by tool_use_id in both directions instead of trusting file order.
 */

/** Record `type` values observed in the wild (spike, v2.1.119–2.1.195). */
const KNOWN_TYPES = new Set([
  'user', 'assistant', 'system', 'summary',
  'mode', 'permission-mode', 'bridge-session', 'file-history-snapshot',
  'attachment', 'last-prompt', 'ai-title', 'queue-operation', 'agent-name',
  'pr-link',
]);

const SUBAGENT_TOOLS = new Set(['Agent', 'Task', 'Workflow']);

/** Threshold above which a session is "unscorable" (provisional, CHANGELOG'd). */
export const UNKNOWN_RATIO_LIMIT = 0.2;

const MAX_COMMAND_LENGTH = 2000;

/**
 * Hard cap on retained tool events (streaming-principle backstop; a real
 * session never comes close). Beyond it the session is honestly unscorable
 * rather than partially scored. Provisional — CHANGELOG on change.
 */
export const MAX_EVENTS = 200_000;

/**
 * Content prefixes that mark a user-role record as NOT a real human turn:
 * slash-command scaffolding, bash-mode I/O, and background notifications.
 * These arrive with no `origin`, so they reach the prefix check — and are
 * verified against real logs (v2.1.x). Checked before origin so a turn label
 * and the Stop-hook gate are never inflated/reset by command noise.
 */
const NOISE_PREFIXES = [
  '<task-notification>', '<local-command-stdout>', '<local-command-stderr>',
  '<local-command-caveat>', '<bash-stdout>', '<bash-stderr>', '<bash-input>',
  '<command-name>', '<command-message>', '<command-args>', '<command-contents>',
];

/**
 * trailix must not score its own footprint (read-only observer, principle ③).
 * A Bash event is "self" only when trailix is in command position — the word
 * appearing inside commit messages or file contents must not match, so quoted
 * spans are blanked before testing. Command position includes new lines,
 * subshells and common runners (npx/bunx/pnpm/yarn/node), and path-form
 * invocations (./trailix, dist/trailix.js).
 */
const SELF_INVOCATION = /(?:^|[;&|`\n(]|\$\()\s*(?:(?:npx|bunx|node|yarn(?:\s+dlx)?|pnpm\s+(?:dlx|exec))\s+)?(?:[^\s;&|'"`]*\/)?trailix(?:\.[cm]?js)?(?=\s|$)/;

function stripQuoted(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}

function isSelfEvent(tool: string, filePath?: string, command?: string): boolean {
  if (command !== undefined && SELF_INVOCATION.test(stripQuoted(command))) return true;
  if (filePath !== undefined && filePath.includes('/.cache/trailix/')) return true;
  return false;
}

function textLength(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const block of content) {
      if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
        n += ((block as { text: string }).text).length;
      }
    }
    return n;
  }
  return 0;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
      .join('\n');
  }
  return '';
}

interface Rec {
  [key: string]: unknown;
  type?: string;
  subtype?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  origin?: { kind?: string };
  promptSource?: string;
  message?: { role?: string; content?: unknown; id?: string; model?: string; usage?: UsageRec };
  toolUseResult?: ToolUseResultRec | string;
  durationMs?: number;
  aiTitle?: string;
  gitBranch?: string;
  cwd?: string;
  version?: string;
}

interface UsageRec {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ToolUseResultRec {
  type?: string;
  file?: { numLines?: number; totalLines?: number };
  structuredPatch?: { lines?: unknown[] }[];
}

/** Caps for scope-mode strings (labels, never bodies). */
const SCOPE_TEXT_CAP = 200;
const SCOPE_PREVIEW_CAP = 120;
const SCOPE_ANSWER_CAP = 300;
const SCOPE_REPORT_CAP = 4000;
const SCOPE_OPTIONS_CAP = 8;

export interface ParseOptions {
  /**
   * Collect the map's extra signals (timestamps, turns, real token usage,
   * search queries, patch line counts…). Off by default so the report-card
   * path keeps its strict "aggregates only" memory profile.
   */
  scope?: boolean;
}

/** Count added/removed lines in a structuredPatch without keeping any content. */
function patchLineCounts(patch: unknown): { added: number; removed: number } | undefined {
  if (!Array.isArray(patch)) return undefined;
  let added = 0;
  let removed = 0;
  for (const hunk of patch) {
    const lines = (hunk as { lines?: unknown })?.lines;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }
  }
  return { added, removed };
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return (nl === -1 ? text : text.slice(0, nl)).trim();
}

function isHumanInput(rec: Rec): boolean {
  if (rec.type !== 'user' || rec.isMeta === true || rec.isSidechain === true) return false;
  const message = rec.message;
  if (message === undefined || message.role !== 'user') return false;
  const content = message.content;
  if (Array.isArray(content) && content.some((b) => (b as { type?: string })?.type === 'tool_result')) return false;
  // Command/bash/notification noise is filtered by content prefix FIRST, so an
  // origin='human' command-output record can't be miscounted as a real turn.
  const text = textOf(content).trimStart();
  if (NOISE_PREFIXES.some((p) => text.startsWith(p))) return false;
  if (rec.origin !== undefined && rec.origin !== null) return rec.origin.kind === 'human';
  if (typeof rec.promptSource === 'string') return rec.promptSource !== 'system';
  return true;
}

export async function parseSessionFile(filePath: string, options: ParseOptions = {}): Promise<SessionStats> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  return parseSessionLines(rl, options);
}

export async function parseSessionLines(lines: AsyncIterable<string> | Iterable<string>, options: ParseOptions = {}): Promise<SessionStats> {
  const stats: SessionStats = {
    events: [],
    selfEventCount: 0,
    humanInputCount: 0,
    usedSubagents: false,
    totalLines: 0,
    parsedRecords: 0,
    malformedLines: 0,
    unknownTypeCount: 0,
    incompleteLastLine: false,
    unknownRatio: 0,
    eventsTruncated: false,
    lastTurnToolCount: 0,
    lastTurnUsedSubagents: false,
  };

  // ── scope-mode state (allocated only when requested) ──
  const scope: ScopeExtras | undefined = options.scope === true
    ? { turns: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } }
    : undefined;
  const seenUsageIds = new Set<string>();
  let usageFallbackCounter = 0;
  let lastReportMsgId: string | undefined;
  let recTs: number | undefined; // timestamp of the record being ingested

  const currentTurn = (): TurnScope | undefined => {
    if (scope === undefined) return undefined;
    if (scope.turns.length === 0) {
      // synthetic pre-input turn (rare: sdk/system-driven sessions)
      scope.turns.push({ index: 0, promptPreview: '', promptChars: 0, thinkingBlocks: 0, thinkingChars: 0, outputTokens: 0 });
    }
    return scope.turns[scope.turns.length - 1];
  };

  const eventById = new Map<string, ToolEvent>();
  const pendingResults = new Map<string, ToolResultMeta>();
  let seq = 0;
  // Previous TodoWrite list (item texts, capped) — diffed to spot plan reshuffles.
  let prevTodos: Set<string> | undefined;

  const ingestToolUse = (block: { id?: string; name?: string; input?: { file_path?: unknown; notebook_path?: unknown; command?: unknown; limit?: unknown; offset?: unknown; url?: unknown; query?: unknown; pattern?: unknown; description?: unknown; subagent_type?: unknown; skill?: unknown; content?: unknown; questions?: unknown } }): void => {
    const tool = typeof block.name === 'string' ? block.name : '(unknown)';
    // NotebookEdit records its target as notebook_path, not file_path
    const filePath = typeof block.input?.file_path === 'string'
      ? block.input.file_path
      : typeof block.input?.notebook_path === 'string' ? block.input.notebook_path : undefined;
    const rawCommand = typeof block.input?.command === 'string' ? block.input.command : undefined;
    const command = rawCommand?.slice(0, MAX_COMMAND_LENGTH);
    const readLimit = typeof block.input?.limit === 'number' ? block.input.limit : undefined;
    const readOffset = typeof block.input?.offset === 'number' ? block.input.offset : undefined;
    const url = typeof block.input?.url === 'string' ? block.input.url : undefined;

    if (SUBAGENT_TOOLS.has(tool)) stats.usedSubagents = true;

    // Track the just-ended turn (reset on each human input) for the Stop hook's
    // delegation-turn gate. Self events are excluded (counted below).
    if (isSelfEvent(tool, filePath, command)) {
      stats.selfEventCount += 1;
      return;
    }
    stats.lastTurnToolCount += 1;
    if (SUBAGENT_TOOLS.has(tool)) stats.lastTurnUsedSubagents = true;
    if (stats.events.length >= MAX_EVENTS) {
      stats.eventsTruncated = true;
      return;
    }
    const event: ToolEvent = { seq: seq++, tool, filePath, command, readLimit, readOffset, url, self: false };

    if (scope !== undefined) {
      if (recTs !== undefined) event.ts = recTs;
      event.turnIndex = currentTurn()?.index ?? 0;
      const input = block.input;
      if (typeof input?.query === 'string') event.query = input.query.slice(0, SCOPE_TEXT_CAP);
      if (typeof input?.pattern === 'string') event.pattern = input.pattern.slice(0, SCOPE_TEXT_CAP);
      if (typeof input?.description === 'string') event.agentDesc = input.description.slice(0, SCOPE_TEXT_CAP);
      if (typeof input?.subagent_type === 'string') event.agentType = input.subagent_type;
      if (typeof input?.skill === 'string') event.skillName = input.skill.slice(0, SCOPE_TEXT_CAP);
      // Write volume: count lines at ingest, discard the content itself
      if (tool === 'Write' && typeof input?.content === 'string') {
        let n = 1;
        for (let i = 0; i < input.content.length; i++) if (input.content.charCodeAt(i) === 10) n += 1;
        event.inputLines = n;
      }
      if (SUBAGENT_TOOLS.has(tool) && typeof block.id === 'string') event.toolUseId = block.id;
      if (tool === 'TodoWrite') {
        const todos = (input as { todos?: unknown })?.todos;
        if (Array.isArray(todos)) {
          const next = new Set<string>();
          for (const t of todos) {
            const content = (t as { content?: unknown })?.content;
            if (typeof content === 'string') next.add(content.slice(0, SCOPE_TEXT_CAP));
          }
          if (prevTodos !== undefined) {
            let removed = 0;
            for (const item of prevTodos) if (!next.has(item)) removed += 1;
            event.todoReorg = { before: prevTodos.size, after: next.size, removed };
          }
          prevTodos = next;
        }
      }
      if (tool === 'AskUserQuestion' && Array.isArray(input?.questions)) {
        const qs: QuestionScope[] = [];
        for (const raw of input.questions) {
          const q = raw as { question?: unknown; header?: unknown; options?: unknown };
          if (typeof q?.question !== 'string') continue;
          const options: string[] = [];
          if (Array.isArray(q.options)) {
            for (const o of q.options.slice(0, SCOPE_OPTIONS_CAP)) {
              const label = (o as { label?: unknown })?.label;
              if (typeof label === 'string') options.push(label.slice(0, SCOPE_PREVIEW_CAP));
            }
          }
          qs.push({
            question: q.question.slice(0, SCOPE_TEXT_CAP),
            header: typeof q.header === 'string' ? q.header.slice(0, SCOPE_PREVIEW_CAP) : undefined,
            options,
          });
        }
        if (qs.length > 0) event.questions = qs;
      }
    }

    if (typeof block.id === 'string') {
      const pending = pendingResults.get(block.id);
      if (pending !== undefined) {
        event.result = pending;
        pendingResults.delete(block.id);
      } else {
        eventById.set(block.id, event);
      }
    }
    stats.events.push(event);
  };

  const ingestToolResult = (rec: Rec, block: { tool_use_id?: string; is_error?: boolean; content?: unknown }): void => {
    if (typeof block.tool_use_id !== 'string') return;
    const text = textOf(block.content);
    const tur = typeof rec.toolUseResult === 'object' && rec.toolUseResult !== null ? rec.toolUseResult : undefined;
    const writeKindRaw = tur?.type;
    const meta: ToolResultMeta = {
      isError: block.is_error === true,
      unreadEditError: block.is_error === true && /has not been read/i.test(text),
      writeKind: writeKindRaw === 'create' || writeKindRaw === 'update' ? writeKindRaw : undefined,
      contentLength: textLength(block.content),
    };
    if (scope !== undefined && tur !== undefined) {
      if (typeof tur.file?.numLines === 'number') meta.readNumLines = tur.file.numLines;
      if (typeof tur.file?.totalLines === 'number') meta.readTotalLines = tur.file.totalLines;
      const patch = patchLineCounts(tur.structuredPatch);
      if (patch !== undefined) {
        meta.linesAdded = patch.added;
        meta.linesRemoved = patch.removed;
      }
    }
    const event = eventById.get(block.tool_use_id);
    if (event !== undefined) {
      // The chosen answers ride in the AskUserQuestion result text (kept only
      // for that tool, capped — the map's decision panel needs the choice).
      if (scope !== undefined && event.tool === 'AskUserQuestion' && text !== '') {
        meta.answerPreview = text.slice(0, SCOPE_ANSWER_CAP);
      }
      event.result = meta;
      eventById.delete(block.tool_use_id);
    } else {
      // tool_result arrived before its tool_use (real order inversion) —
      // stash and join when the tool_use line shows up.
      pendingResults.set(block.tool_use_id, meta);
    }
  };

  const ingest = (rec: Rec): void => {
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    recTs = Number.isNaN(ts) ? undefined : ts;
    if (!Number.isNaN(ts)) {
      if (stats.firstTs === undefined || ts < stats.firstTs) stats.firstTs = ts;
      if (stats.lastTs === undefined || ts > stats.lastTs) stats.lastTs = ts;
    }
    const type = rec.type;
    if (typeof type !== 'string') {
      stats.unknownTypeCount += 1;
      return;
    }
    if (!KNOWN_TYPES.has(type)) {
      stats.unknownTypeCount += 1;
      return;
    }
    if (scope !== undefined) {
      if (scope.gitBranch === undefined && typeof rec.gitBranch === 'string' && rec.gitBranch !== '') scope.gitBranch = rec.gitBranch;
      if (scope.cwd === undefined && typeof rec.cwd === 'string' && rec.cwd !== '') scope.cwd = rec.cwd;
      if (scope.version === undefined && typeof rec.version === 'string' && rec.version !== '') scope.version = rec.version;
      if (type === 'ai-title' && typeof rec.aiTitle === 'string') scope.title = rec.aiTitle.slice(0, SCOPE_TEXT_CAP);
      if (type === 'system' && rec.subtype === 'turn_duration' && typeof rec.durationMs === 'number') {
        // The duration record lands as its turn ends — attach to the newest
        // turn still missing one (walk back covers late arrivals).
        for (let i = scope.turns.length - 1; i >= 0; i--) {
          const turn = scope.turns[i] as TurnScope;
          if (turn.durationMs === undefined) {
            turn.durationMs = rec.durationMs;
            break;
          }
        }
      }
    }
    if (type === 'assistant') {
      const content = rec.message?.content;
      if (scope !== undefined) {
        if (typeof rec.message?.model === 'string') scope.model = rec.message.model;
        const usage = rec.message?.usage;
        if (usage !== undefined && typeof usage === 'object') {
          // The same message is split across several records, each repeating
          // usage — count once per message id (fallback: one synthetic id per
          // record, i.e. count each, when no id is present).
          const msgId = typeof rec.message?.id === 'string' ? rec.message.id : `#${usageFallbackCounter++}`;
          if (!seenUsageIds.has(msgId)) {
            seenUsageIds.add(msgId);
            scope.usage.inputTokens += typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
            scope.usage.outputTokens += typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
            scope.usage.cacheReadTokens += typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
            scope.usage.cacheCreationTokens += typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
            const turn = currentTurn();
            if (turn !== undefined) turn.outputTokens += typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
          }
        }
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          const blockType = (block as { type?: string })?.type;
          if (blockType === 'tool_use') ingestToolUse(block as Parameters<typeof ingestToolUse>[0]);
          else if (scope !== undefined && blockType === 'thinking') {
            const turn = currentTurn();
            if (turn !== undefined) {
              turn.thinkingBlocks += 1;
              const body = (block as { thinking?: unknown }).thinking;
              if (typeof body === 'string') turn.thinkingChars += body.length;
            }
          } else if (scope !== undefined && blockType === 'text') {
            // Keep the model's final report (its own words, capped) — the
            // map's appendix shows it verbatim next to the measured facts.
            const body = (block as { text?: unknown }).text;
            if (typeof body === 'string' && body.trim() !== '') {
              const msgId = typeof rec.message?.id === 'string' ? rec.message.id : undefined;
              if (msgId !== undefined && msgId === lastReportMsgId && scope.lastReport !== undefined) {
                scope.lastReport = (scope.lastReport + '\n' + body).slice(0, SCOPE_REPORT_CAP);
              } else {
                scope.lastReport = body.slice(0, SCOPE_REPORT_CAP);
                lastReportMsgId = msgId;
              }
            }
          }
        }
      }
      return;
    }
    if (type === 'user') {
      const content = rec.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if ((block as { type?: string })?.type === 'tool_result') ingestToolResult(rec, block as Parameters<typeof ingestToolResult>[1]);
        }
      }
      if (isHumanInput(rec)) {
        stats.humanInputCount += 1;
        stats.lastTurnToolCount = 0;
        stats.lastTurnUsedSubagents = false;
        if (scope !== undefined) {
          const text = textOf(content);
          scope.turns.push({
            index: stats.humanInputCount,
            ts: recTs,
            promptPreview: firstLine(text).slice(0, SCOPE_PREVIEW_CAP),
            promptChars: text.length,
            thinkingBlocks: 0,
            thinkingChars: 0,
            outputTokens: 0,
          });
        }
      }
      return;
    }
  };

  // One-line lookahead so a parse failure on the *final* line (a session being
  // written right now) is ignored instead of counted as malformed.
  let previous: string | undefined;
  const consume = (line: string, isLast: boolean): void => {
    stats.totalLines += 1;
    if (line.trim() === '') return;
    try {
      const rec: unknown = JSON.parse(line);
      stats.parsedRecords += 1;
      if (rec !== null && typeof rec === 'object') ingest(rec as Rec);
    } catch {
      if (isLast) stats.incompleteLastLine = true;
      else stats.malformedLines += 1;
    }
  };

  for await (const line of lines) {
    if (previous !== undefined) consume(previous, false);
    previous = line;
  }
  if (previous !== undefined) consume(previous, true);

  stats.unknownRatio = stats.parsedRecords === 0 ? 0 : stats.unknownTypeCount / stats.parsedRecords;
  if (scope !== undefined) stats.scope = scope;
  return stats;
}

export function isScorable(stats: SessionStats): boolean {
  return stats.unknownRatio <= UNKNOWN_RATIO_LIMIT && !stats.eventsTruncated;
}
