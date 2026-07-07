import { homedir } from 'node:os';

/**
 * Session sanitizer (design T3). Turns a real session JSONL into a shareable
 * one: redacts secret-shaped tokens, genericizes home paths, and replaces
 * free-text content (human prompts, tool_result bodies) with same-length
 * filler so the SHAPE that trailix scores (tool sequence, sizes, structure) is
 * preserved while identifying content is gone.
 *
 * Used to produce public fixtures and to let users share sessions in bug
 * reports. A planted-marker test guarantees markers don't survive.
 */

/** Secret-shaped patterns → [REDACTED]. Order matters (specific before generic). */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // email
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, // IPv4
  /\b[A-Fa-f0-9]{32,}\b/g, // long hex (hashes, keys)
];

export function redactSecrets(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

/** Replace the real home dir (and any /home/<user>) with a generic one. */
export function genericizeHome(s: string, home = homedir()): string {
  return s.replaceAll(home, '/home/user').replace(/\/home\/[^/\s"]+/g, '/home/user');
}

/** Same-length filler so measured sizes (rule ⑤, facts) stay realistic. */
function filler(len: number): string {
  return 'x'.repeat(Math.max(0, len));
}

/** Sanitize a free-text string: redact secrets, genericize home, then keep
 *  a short readable head and pad to the original length with filler. */
function sanitizeText(s: string, home: string): string {
  const cleaned = genericizeHome(redactSecrets(s), home);
  // If it's short, keep it (already secret-free); if long (a body), collapse to
  // filler of the same length so nothing identifying survives but size holds.
  if (cleaned.length <= 40) return cleaned;
  return filler(cleaned.length);
}

// Paths and signal-bearing fields keep their structure (redact + genericize
// only) so the rules still see them — e.g. a `cat src/foo.ts` command must
// stay recognizable or rule ① loses a read channel and the grade shifts.
const STRUCTURAL_KEYS = new Set(['file_path', 'notebook_path', 'cwd', 'transcript_path', 'command', 'url']);
// Free-text bodies: redact + genericize, then collapse to same-length filler.
const BODY_KEYS = new Set(['description', 'content', 'text', 'prompt']);

function walk(value: unknown, key: string | undefined, home: string): unknown {
  if (typeof value === 'string') {
    if (key !== undefined && STRUCTURAL_KEYS.has(key)) return genericizeHome(redactSecrets(value), home);
    if (key !== undefined && BODY_KEYS.has(key)) return sanitizeText(value, home);
    return genericizeHome(redactSecrets(value), home);
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, key, home));
  if (value !== null && typeof value === 'object') {
    // Error tool_results carry harness signals ("File has not been read yet"
    // for rule ①-a) and are not user data, so preserve their content text
    // instead of fillering it — otherwise the sanitized grade drifts.
    const preserveContent = (value as { is_error?: unknown }).is_error === true;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // keys can be paths too (e.g. trackedFileBackups is keyed by file path)
      const sk = genericizeHome(redactSecrets(k), home);
      if (k === 'content' && preserveContent && typeof v === 'string') {
        out[sk] = genericizeHome(redactSecrets(v), home);
      } else {
        out[sk] = walk(v, k, home); // original key drives structural/body decisions
      }
    }
    return out;
  }
  return value;
}

/** Sanitize one JSONL line. Unparseable lines are dropped (returns undefined). */
export function sanitizeLine(line: string, home = homedir()): string | undefined {
  const trimmed = line.trim();
  if (trimmed === '') return undefined;
  try {
    const rec: unknown = JSON.parse(trimmed);
    return JSON.stringify(walk(rec, undefined, home));
  } catch {
    return undefined;
  }
}

/** Sanitize a whole session text (newline-delimited JSONL). */
export function sanitizeSession(text: string, home = homedir()): string {
  return text
    .split('\n')
    .map((l) => sanitizeLine(l, home))
    .filter((l): l is string => l !== undefined)
    .join('\n') + '\n';
}
