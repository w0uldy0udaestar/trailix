import { parseSessionFile } from './parser.ts';
import { buildCard } from './card.ts';
import { renderHook } from './render/index.ts';
import { detectLang } from './messages.ts';

/**
 * Stop-hook body. Reads the hook's stdin JSON, and — only when the just-ended
 * turn was a delegation turn — prints a `{ systemMessage }` card.
 *
 * Delegation turn (Day 1 spike / design): the last turn used a subagent, or
 * made >=10 tool calls. Everything else stays silent.
 *
 * Contract: read-only, and NEVER throws. The caller also guards, but this
 * returns '' (silent) on any bad input so the worst case is always "no card",
 * never a disrupted session. A full parse is <=120ms worst-case (spike), inside
 * both the <=200ms non-delegation and <=1s card budgets — no cache needed yet.
 */

export const DELEGATION_MIN_TOOLS = 10;

interface HookStdin {
  transcript_path?: unknown;
  cwd?: unknown;
}

export async function runHook(stdinText: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  let input: HookStdin;
  try {
    const parsed: unknown = JSON.parse(stdinText);
    // JSON.parse('null') succeeds and returns null; guard before dereferencing
    // so the documented "never throws" invariant holds here, not just in bin.
    if (parsed === null || typeof parsed !== 'object') return '';
    input = parsed as HookStdin;
  } catch {
    return '';
  }
  const path = input.transcript_path;
  if (typeof path !== 'string' || path === '') return '';

  let stats;
  try {
    stats = await parseSessionFile(path);
  } catch {
    return '';
  }

  const isDelegation = stats.lastTurnUsedSubagents || stats.lastTurnToolCount >= DELEGATION_MIN_TOOLS;
  if (!isDelegation) return '';

  const card = buildCard(stats, { lang: detectLang(env) });
  if (card.state === 'empty') return ''; // never reachable on a delegation turn, but defensive

  const body = renderHook(card, { termWidth: 80 });
  return JSON.stringify({ systemMessage: body });
}
