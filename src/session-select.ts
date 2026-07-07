import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Session-file selection per surface (design "표면별 세션 선택", Day 1 spike e4).
 *
 *  - CLI `trailix last`  : newest *.jsonl (by mtime) under the cwd's project
 *                          dir; `--done` excludes still-running sessions.
 *  - /trailix skill      : the current session, via $CLAUDE_CODE_SESSION_ID.
 *  - Stop hook           : the transcript_path handed in on stdin (not here).
 *
 * Everything is best-effort and read-only: any failure returns undefined/empty
 * rather than throwing (the observer must never disrupt a session).
 */

export function projectsRoot(home = homedir()): string {
  return join(home, '.claude', 'projects');
}

/**
 * cwd → project directory name. The transform is lossy/one-way (every
 * non-alphanumeric char → '-'), but the CLI always knows its cwd, so only the
 * forward direction is needed. Verified against 37 real directories.
 */
export function cwdToDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export interface SessionFile {
  path: string;
  sessionId: string;
  mtimeMs: number;
}

function listSessions(dir: string): SessionFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SessionFile[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      out.push({ path, sessionId: name.slice(0, -'.jsonl'.length), mtimeMs: st.mtimeMs });
    } catch {
      // vanished between readdir and stat — skip
    }
  }
  return out;
}

/**
 * Running interactive sessions, from ~/.claude/sessions/<PID>.json, each
 * validated against /proc so a stale registry entry (dead PID, or a PID reused
 * by another process) is not treated as live (Day 1 spike e4). Linux-only;
 * returns an empty set anywhere it can't verify (fail-safe: nothing excluded).
 */
export function runningSessionIds(home = homedir()): Set<string> {
  const ids = new Set<string>();
  let files: string[];
  try {
    files = readdirSync(join(home, '.claude', 'sessions'));
  } catch {
    return ids;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const reg = JSON.parse(readFileSync(join(home, '.claude', 'sessions', f), 'utf8')) as {
        pid?: number;
        sessionId?: string;
        procStart?: number;
      };
      if (typeof reg.pid !== 'number' || typeof reg.sessionId !== 'string') continue;
      if (procStartField(reg.pid) === reg.procStart) ids.add(reg.sessionId);
    } catch {
      // unreadable/foreign registry entry — ignore
    }
  }
  return ids;
}

/** /proc/<pid>/stat field 22 (starttime) — the PID-reuse guard. undefined if absent. */
function procStartField(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // comm (field 2) may contain spaces/parens; split after the closing ')'
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const starttime = rest[19]; // field 22 overall = index 19 after the (comm) split
    return starttime === undefined ? undefined : Number(starttime);
  } catch {
    return undefined;
  }
}

export interface SelectOptions {
  cwd?: string;
  home?: string;
  /** Exclude still-running sessions (CLI `--done`). */
  excludeRunning?: boolean;
}

/** Newest session for the cwd's project. undefined if none / all excluded. */
export function selectLatestSession(opts: SelectOptions = {}): SessionFile | undefined {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const dir = join(projectsRoot(home), cwdToDirName(cwd));
  let sessions = listSessions(dir);
  if (opts.excludeRunning === true) {
    const running = runningSessionIds(home);
    sessions = sessions.filter((s) => !running.has(s.sessionId));
  }
  if (sessions.length === 0) return undefined;
  return sessions.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
}

/** All sessions for the cwd's project, newest first (for `trailix list`). */
export function listProjectSessions(opts: SelectOptions = {}): SessionFile[] {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const dir = join(projectsRoot(home), cwdToDirName(cwd));
  return listSessions(dir).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** The current session's transcript, via $CLAUDE_CODE_SESSION_ID (skill path). */
export function selfSession(env: NodeJS.ProcessEnv = process.env, opts: SelectOptions = {}): SessionFile | undefined {
  const id = env['CLAUDE_CODE_SESSION_ID'];
  if (id === undefined || id === '') return undefined;
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const path = join(projectsRoot(home), cwdToDirName(cwd), `${id}.jsonl`);
  try {
    const st = statSync(path);
    if (st.isFile()) return { path, sessionId: id, mtimeMs: st.mtimeMs };
  } catch {
    // not found under this cwd
  }
  return undefined;
}
