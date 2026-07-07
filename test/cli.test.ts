import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, type CliIO } from '../src/cli.ts';
import { cwdToDirName, selectLatestSession, listProjectSessions, runningSessionIds } from '../src/session-select.ts';
import { humanInput, read, edit, session } from './helpers/fixture.ts';

// A throwaway ~/.claude/projects tree with one project + N sessions.
function makeHome(projectCwd: string, sessions: Record<string, string[]>): { home: string } {
  const home = mkdtempSync(join(tmpdir(), 'trailix-home-'));
  const dir = join(home, '.claude', 'projects', cwdToDirName(projectCwd));
  mkdirSync(dir, { recursive: true });
  let t = 1_700_000_000; // ascending mtimes, seconds
  for (const [id, lines] of Object.entries(sessions)) {
    const p = join(dir, `${id}.jsonl`);
    writeFileSync(p, lines.join('\n') + '\n');
    utimesSync(p, t, t);
    t += 100;
  }
  return { home };
}

const io = (over: Partial<CliIO>): CliIO => ({
  argv: [], env: {}, cwd: '/home/u/proj', isTTY: false, termWidth: 80, ...over,
});

test('cwdToDirName matches the real projects naming scheme', () => {
  assert.equal(cwdToDirName('/home/rladn/projects/range'), '-home-rladn-projects-range');
  assert.equal(cwdToDirName('/home/u/clother-ai-e2e'), '-home-u-clother-ai-e2e');
});

test('selectLatestSession picks the newest by mtime', () => {
  const { home } = makeHome('/home/u/proj', {
    older: session(read('/p/a.ts'), edit('/p/a.ts')),
    newer: session(read('/p/b.ts'), edit('/p/b.ts')),
  });
  const picked = selectLatestSession({ cwd: '/home/u/proj', home });
  assert.equal(picked?.sessionId, 'newer');
});

test('trailix last renders the newest session card', async () => {
  const { home } = makeHome('/home/u/proj', {
    s1: session(read('/p/a.ts'), read('/p/b.ts'), read('/p/c.ts'), edit('/p/a.ts')),
  });
  const r = await runCli(io({ argv: ['last', '--lang', 'en'], env: { HOME: home } }));
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /trailix · session/);
});

test('trailix last --ascii is pure ASCII with no box', async () => {
  const { home } = makeHome('/home/u/proj', {
    s1: session(read('/p/a.ts'), read('/p/b.ts'), read('/p/c.ts'), edit('/p/a.ts')),
  });
  const r = await runCli(io({ argv: ['--ascii', '--lang', 'en'], env: { HOME: home } }));
  // eslint-disable-next-line no-control-regex
  assert.equal(/[^\x00-\x7f]/.test(r.stdout), false);
  assert.equal(r.stdout.includes('╭'), false);
});

test('trailix list shows recent session ids, newest first', async () => {
  const { home } = makeHome('/home/u/proj', {
    aaa11111: session(read('/p/a.ts')),
    bbb22222: session(read('/p/b.ts')),
  });
  const r = await runCli(io({ argv: ['list'], env: { HOME: home }, cwd: '/home/u/proj' }), 1_700_000_500_000);
  assert.match(r.stdout, /recent sessions/);
  assert.equal(r.stdout.indexOf('bbb22222') < r.stdout.indexOf('aaa11111'), true);
});

test('no sessions → friendly guidance, exit 0 (never an error)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'trailix-empty-'));
  const r = await runCli(io({ argv: ['last'], env: { HOME: home }, cwd: '/home/u/nowhere' }));
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /no session history/);
});

test('runningSessionIds detects a live session via /proc starttime (string procStart)', () => {
  // Registry stores procStart as a STRING; compare it against this live process.
  const home = mkdtempSync(join(tmpdir(), 'trailix-reg-'));
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true });
  const starttime = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const procStart = starttime.slice(starttime.lastIndexOf(')') + 2).split(' ')[19] as string;
  writeFileSync(
    join(home, '.claude', 'sessions', `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId: 'live-session', procStart }), // string!
  );
  // a dead/foreign entry that must NOT be included
  writeFileSync(
    join(home, '.claude', 'sessions', '999999.json'),
    JSON.stringify({ pid: 999999, sessionId: 'dead-session', procStart: '1' }),
  );
  const running = runningSessionIds(home);
  assert.equal(running.has('live-session'), true, '--done guard must detect the live session');
  assert.equal(running.has('dead-session'), false);
});

test('--done excludes the running session and picks the previous one', () => {
  const home = mkdtempSync(join(tmpdir(), 'trailix-done-'));
  const dir = join(home, '.claude', 'projects', cwdToDirName('/home/u/proj'));
  mkdirSync(dir, { recursive: true });
  const older = join(dir, 'older.jsonl');
  const running = join(dir, `${process.pid}live.jsonl`); // newest, but "running"
  writeFileSync(older, session(read('/p/a.ts'), edit('/p/a.ts')).join('\n'));
  writeFileSync(running, session(read('/p/b.ts'), edit('/p/b.ts')).join('\n'));
  utimesSync(older, 1000, 1000);
  utimesSync(running, 2000, 2000);
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true });
  const st = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const procStart = st.slice(st.lastIndexOf(')') + 2).split(' ')[19] as string;
  writeFileSync(
    join(home, '.claude', 'sessions', `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId: `${process.pid}live`, procStart }),
  );
  const plain = selectLatestSession({ cwd: '/home/u/proj', home });
  const done = selectLatestSession({ cwd: '/home/u/proj', home, excludeRunning: true });
  assert.equal(plain?.sessionId, `${process.pid}live`);
  assert.equal(done?.sessionId, 'older'); // running one excluded
});

test('--self --format md grades the current session as markdown', async () => {
  const { home } = makeHome('/home/u/proj', {
    livesession: session(read('/p/a.ts'), read('/p/b.ts'), read('/p/c.ts'), edit('/p/a.ts')),
  });
  const r = await runCli(io({
    argv: ['--self', '--format', 'md', '--lang', 'en'],
    env: { HOME: home, CLAUDE_CODE_SESSION_ID: 'livesession' },
    cwd: '/home/u/proj',
  }));
  assert.match(r.stdout, /\*\*facts\*\*|\*\*verdicts\*\*/); // markdown, not a box
  assert.equal(r.stdout.includes('╭'), false);
});

test('--self falls back to the latest session when no session id is set', async () => {
  const { home } = makeHome('/home/u/proj', { only: session(read('/p/a.ts'), edit('/p/a.ts')) });
  const r = await runCli(io({ argv: ['--self', '--md'], env: { HOME: home }, cwd: '/home/u/proj' }));
  assert.equal(r.exitCode, 0);
  assert.notEqual(r.stdout.trim(), '');
});

test('demo renders a self-contained caution card with edits counted', async () => {
  const r = await runCli(io({ argv: ['demo'], env: { NO_COLOR: '1' }, isTTY: true }));
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /caution/);
  assert.match(r.stdout, /edited 4/); // guards the tool_use/result id-pairing bug
  assert.match(r.stdout, /deep 1 · skim 3/);
});

test('--help prints usage', async () => {
  const r = await runCli(io({ argv: ['--help'] }));
  assert.match(r.stdout, /usage:/);
});
