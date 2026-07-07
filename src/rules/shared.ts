import type { ToolEvent } from '../types.ts';

/** Tool names that delegate work to a subagent / orchestration. */
export const DELEGATION_TOOLS = new Set(['Agent', 'Task', 'Workflow']);

/** Tool names that count as "consulting a source" back in the main thread. */
export const CROSS_CHECK_TOOLS = new Set(['Read', 'Bash', 'Grep', 'Glob', 'WebSearch', 'WebFetch']);

const SUCCEEDED = (e: ToolEvent): boolean => e.result === undefined ? false : !e.result.isError;

/** A tool call that actually returned (used where a missing result ≠ success). */
export function succeeded(e: ToolEvent): boolean {
  return SUCCEEDED(e);
}

/** Registrable domain-ish host from a URL, lowercased, `www.` stripped. */
export function domainOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    const m = url.match(/^[a-z]+:\/\/([^/:?#]+)/i);
    if (m?.[1] === undefined) return undefined;
    const host = m[1].toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  }
}

/** Char → token rough estimate (chars/4). Always label the result "(est.)". */
export function estTokens(chars: number): number {
  return Math.round(chars / 4);
}

/** "31000" → "31k", "840" → "840". */
export function compactCount(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
