import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SessionStats, ToolEvent, ToolResultMeta } from './types.ts';

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

/** Non-human user-record content prefixes (pre-`origin` log versions). */
const NOISE_PREFIXES = [
  '<task-notification>', '<local-command-stdout>', '<local-command-stderr>',
  '<local-command-caveat>', '<bash-stdout>', '<bash-stderr>',
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
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  origin?: { kind?: string };
  promptSource?: string;
  message?: { role?: string; content?: unknown };
  toolUseResult?: { type?: string } | string;
}

function isHumanInput(rec: Rec): boolean {
  if (rec.type !== 'user' || rec.isMeta === true || rec.isSidechain === true) return false;
  const message = rec.message;
  if (message === undefined || message.role !== 'user') return false;
  const content = message.content;
  if (Array.isArray(content) && content.some((b) => (b as { type?: string })?.type === 'tool_result')) return false;
  if (rec.origin !== undefined) return rec.origin.kind === 'human';
  if (typeof rec.promptSource === 'string') return rec.promptSource !== 'system';
  const text = textOf(content).trimStart();
  return !NOISE_PREFIXES.some((p) => text.startsWith(p));
}

export async function parseSessionFile(filePath: string): Promise<SessionStats> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  return parseSessionLines(rl);
}

export async function parseSessionLines(lines: AsyncIterable<string> | Iterable<string>): Promise<SessionStats> {
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
  };

  const eventById = new Map<string, ToolEvent>();
  const pendingResults = new Map<string, ToolResultMeta>();
  let seq = 0;

  const ingestToolUse = (block: { id?: string; name?: string; input?: { file_path?: unknown; notebook_path?: unknown; command?: unknown; limit?: unknown; offset?: unknown; url?: unknown } }): void => {
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

    if (isSelfEvent(tool, filePath, command)) {
      stats.selfEventCount += 1;
      return;
    }
    if (stats.events.length >= MAX_EVENTS) {
      stats.eventsTruncated = true;
      return;
    }
    const event: ToolEvent = { seq: seq++, tool, filePath, command, readLimit, readOffset, url, self: false };
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
    const writeKindRaw = typeof rec.toolUseResult === 'object' && rec.toolUseResult !== null ? rec.toolUseResult.type : undefined;
    const meta: ToolResultMeta = {
      isError: block.is_error === true,
      unreadEditError: block.is_error === true && /has not been read/i.test(text),
      writeKind: writeKindRaw === 'create' || writeKindRaw === 'update' ? writeKindRaw : undefined,
      contentLength: textLength(block.content),
    };
    const event = eventById.get(block.tool_use_id);
    if (event !== undefined) {
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
    if (type === 'assistant') {
      const content = rec.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if ((block as { type?: string })?.type === 'tool_use') ingestToolUse(block as Parameters<typeof ingestToolUse>[0]);
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
      if (isHumanInput(rec)) stats.humanInputCount += 1;
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
  return stats;
}

export function isScorable(stats: SessionStats): boolean {
  return stats.unknownRatio <= UNKNOWN_RATIO_LIMIT && !stats.eventsTruncated;
}
