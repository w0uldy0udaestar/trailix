import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionLines } from '../src/parser.ts';
import { evaluateRule1, bashReadPaths } from '../src/rules/rule1.ts';
import { assistantToolUse, bash, danglingEdit, edit, editBlockedUnread, notebookEdit, read, session, write, writeBlockedUnread } from './helpers/fixture.ts';

async function rule1For(lines: string[], options = {}) {
  return evaluateRule1(await parseSessionLines(lines), options);
}

// ── firing ────────────────────────────────────────────────────────────────

test('①-a fires only at >=3 blocked attempts (T4 calibration)', async () => {
  const three = await rule1For(session(
    editBlockedUnread('/p/a.ts'), editBlockedUnread('/p/a.ts'), editBlockedUnread('/p/a.ts'),
    read('/p/a.ts'), edit('/p/a.ts'),
  ));
  assert.equal(three.verdict, 'caution');
  assert.match(three.evidence[0] ?? '', /3 blind-edit attempt/);
});

test('1-2 blocked attempts then corrected = normal self-correction → pass', async () => {
  const r = await rule1For(session(
    editBlockedUnread('/p/a.ts'), editBlockedUnread('/p/a.ts'),
    read('/p/a.ts'), edit('/p/a.ts'),
  ));
  assert.equal(r.verdict, 'pass');
});

test('①-b fires on a successful edit with no trace of reading (clean session)', async () => {
  const r = await rule1For(session(edit('/p/never-read.ts')));
  assert.equal(r.verdict, 'caution');
  assert.match(r.evidence[0] ?? '', /no trace of reading/);
  assert.match(r.evidence[0] ?? '', /never-read\.ts/);
  assert.equal(r.annotations.length, 0);
});

test('①-b reaches poor only with ≥3 clean unread files and no annotations', async () => {
  const clean = await rule1For(session(edit('/p/a.ts'), edit('/p/b.ts'), edit('/p/c.ts')));
  assert.equal(clean.verdict, 'poor');

  // same three files, but the session used Bash → untracked-read possibility
  // → annotation → capped at caution ("no wrong verdicts on a guess")
  const annotated = await rule1For(session(
    bash('echo hello'),
    edit('/p/a.ts'), edit('/p/b.ts'), edit('/p/c.ts'),
  ));
  assert.equal(annotated.verdict, 'caution');
  assert.equal(annotated.annotations.length, 1);
  assert.match(annotated.evidence[0] ?? '', /\(est\.\)/);
});

test('unread Write-update counts like an edit (overwrite loophole closed)', async () => {
  const r = await rule1For(session(write('/p/existing.ts', 'update')));
  assert.equal(r.verdict, 'caution');
});

test('subagent usage annotates and caps at caution', async () => {
  const r = await rule1For(session(
    [assistantToolUse({ tool: 'Agent', input: { prompt: 'refactor' } })],
    edit('/p/a.ts'), edit('/p/b.ts'), edit('/p/c.ts'),
  ));
  assert.equal(r.verdict, 'caution');
  assert.equal(r.annotations.length, 1);
});

test('①-a also counts blocked blind Write (overwrite rejection)', async () => {
  const r = await rule1For(session(
    writeBlockedUnread('/p/a.ts'), writeBlockedUnread('/p/b.ts'), writeBlockedUnread('/p/c.ts'),
  ));
  assert.equal(r.verdict, 'caution');
  assert.match(r.evidence[0] ?? '', /3 blind-edit attempt/);
});

test('unread NotebookEdit fires ①-b via notebook_path', async () => {
  const r = await rule1For(session(notebookEdit('/p/analysis.ipynb')));
  assert.equal(r.verdict, 'caution');
  assert.match(r.evidence[0] ?? '', /analysis\.ipynb/);
});

test('dangling edits (no recorded outcome) never count as unread', async () => {
  // review finding: a truncated parallel edit batch produced a false 'poor'
  const withOthers = await rule1For(session(
    read('/p/a.ts'), edit('/p/a.ts'),
    danglingEdit('/p/x.ts'), danglingEdit('/p/y.ts'), danglingEdit('/p/z.ts'),
  ));
  assert.equal(withOthers.verdict, 'pass');
  assert.equal(withOthers.annotations.some((a) => /unrecorded/.test(a)), true);

  const onlyDangling = await rule1For(session(danglingEdit('/p/x.ts')));
  assert.equal(onlyDangling.verdict, 'no_verdict');
});

test('Write-create-only session gets no verdict, not a false pass', async () => {
  const r = await rule1For(session(write('/p/new.ts', 'create')));
  assert.equal(r.verdict, 'no_verdict');
  assert.equal(r.evidence.length, 0);
});

// ── not firing (read channels) ────────────────────────────────────────────

test('Read before Edit passes', async () => {
  const r = await rule1For(session(read('/p/a.ts'), edit('/p/a.ts')));
  assert.equal(r.verdict, 'pass');
  assert.equal(r.evidence.length, 1);
});

test('a read AFTER the edit does not un-fire it', async () => {
  const r = await rule1For(session(edit('/p/a.ts'), read('/p/a.ts')));
  assert.equal(r.verdict, 'caution');
});

test('failed Read does not count as reading', async () => {
  const lines = session(
    [assistantToolUse({ tool: 'Read', input: { file_path: '/p/a.ts' }, toolUseId: 'toolu_fr' })],
    [JSON.stringify({
      type: 'user', isSidechain: false, isMeta: false,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fr', is_error: true, content: 'File does not exist.' }] },
    })],
    edit('/p/a.ts'),
  );
  const r = await rule1For(lines);
  assert.equal(r.verdict, 'caution');
});

test('Bash read command excuses the file (channel 2)', async () => {
  const r = await rule1For(session(bash('cat /p/a.ts'), edit('/p/a.ts')));
  assert.equal(r.verdict, 'pass');
});

test('Bash read via sed/grep with relative path excuses by suffix', async () => {
  const r = await rule1For(session(
    bash("sed -n '10,40p' src/parser.ts && grep -n TODO src/parser.ts"),
    edit('/home/me/proj/src/parser.ts'),
  ));
  assert.equal(r.verdict, 'pass');
});

test('files created by Write in-session are exempt (nothing existed to read)', async () => {
  const r = await rule1For(session(write('/p/new.ts', 'create'), edit('/p/new.ts')));
  assert.equal(r.verdict, 'pass');
});

test('auto-injected context files are exempt (CLAUDE.md / auto-memory)', async () => {
  const r = await rule1For(session(
    edit('/home/me/proj/CLAUDE.md'),
    edit('/home/me/.claude/projects/x/memory/MEMORY.md'),
  ));
  assert.equal(r.verdict, 'pass');
});

test("a repo's own memory/ directory is NOT the injected auto-memory", async () => {
  // review finding: the old wildcard excused any project's memory/*.md
  const r = await rule1For(session(edit('/home/me/proj/memory/notes.md')));
  assert.equal(r.verdict, 'caution');
});

test('quoted pipes/semicolons in patterns do not break path extraction', async () => {
  // review finding: 2 of 3 real-corpus ①-b firings were this false positive
  const r = await rule1For(session(
    bash("grep -n 'foo|bar' /p/a.ts; sed -n '1,10p;20p' /p/b.ts"),
    edit('/p/a.ts'),
    edit('/p/b.ts'),
  ));
  assert.equal(r.verdict, 'pass');
});

test('filename-shaped grep PATTERN cannot excuse a genuinely unread file', async () => {
  // review finding: pattern operand was collected as a path (missed firing)
  const r = await rule1For(session(
    bash('grep unread.ts src/other.txt'),
    edit('/p/unread.ts'),
  ));
  assert.equal(r.verdict, 'caution');
});

test('extensionless direct reads excuse the file (cat Makefile)', async () => {
  const r = await rule1For(session(bash('cat Makefile'), edit('/p/Makefile')));
  assert.equal(r.verdict, 'pass');
});

test('quoted paths with parentheses/brackets are real paths, not patterns', async () => {
  // real-corpus regression: cat "src/app/(dashboard)/settings/page.tsx"
  const r = await rule1For(session(
    bash('cat "src/app/(dashboard)/settings/page.tsx" && cat "src/pages/[id].tsx"'),
    edit('/home/me/proj/src/app/(dashboard)/settings/page.tsx'),
    edit('/home/me/proj/src/pages/[id].tsx'),
  ));
  assert.equal(r.verdict, 'pass');
});

test('unquoted shell globs are not collected as paths', () => {
  const paths = bashReadPaths('cat src/*.ts');
  assert.equal(paths.length, 0);
});

test('order-inverted Read result still excuses the later edit', async () => {
  // tool_result line lands before its tool_use line (real corpus anomaly)
  const readUse = assistantToolUse({ tool: 'Read', input: { file_path: '/p/a.ts' }, toolUseId: 'toolu_oi' });
  const readResult = JSON.stringify({
    type: 'user', isSidechain: false, isMeta: false,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_oi', is_error: false, content: 'contents' }] },
  });
  const r = await rule1For(session([readResult, readUse], edit('/p/a.ts')));
  assert.equal(r.verdict, 'pass');
});

// ── no verdict ────────────────────────────────────────────────────────────

test('no edits at all → no verdict, never a grade', async () => {
  const r = await rule1For(session(read('/p/a.ts'), bash('ls')));
  assert.equal(r.verdict, 'no_verdict');
  assert.equal(r.evidence.length, 0);
});

// ── i18n + derived sessions ───────────────────────────────────────────────

test('korean catalog renders korean evidence', async () => {
  const r = await rule1For(session(
    editBlockedUnread('/p/a.ts'), editBlockedUnread('/p/a.ts'), editBlockedUnread('/p/a.ts'),
  ), { lang: 'ko' });
  assert.match(r.evidence[0] ?? '', /읽지 않고 수정 시도 3회/);
});

test('resume/compaction descendants get the prior-session annotation', async () => {
  const r = await rule1For(session(edit('/p/a.ts')), { derivedSession: true });
  assert.equal(r.verdict, 'caution');
  assert.equal(r.annotations.length >= 1, true);
});

// ── bash path heuristic unit cases ────────────────────────────────────────

test('bashReadPaths extracts plausible paths, skips flags and variables', () => {
  const paths = bashReadPaths("cat -n src/a.ts | grep -v foo && head -5 $HOME/x.md; echo done");
  assert.deepEqual(paths.includes('src/a.ts'), true);
  assert.equal(paths.some((p) => p.startsWith('-')), false);
  assert.equal(paths.some((p) => p.startsWith('$')), false);
});
