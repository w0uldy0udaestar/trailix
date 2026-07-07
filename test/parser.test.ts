import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionLines, isScorable } from '../src/parser.ts';
import { assistantToolUse, bash, edit, humanInput, read, session, toolResult } from './helpers/fixture.ts';

test('joins tool_use and tool_result written in normal order', async () => {
  const stats = await parseSessionLines(session(read('/p/a.ts')));
  assert.equal(stats.events.length, 1);
  assert.equal(stats.events[0]?.tool, 'Read');
  assert.equal(stats.events[0]?.filePath, '/p/a.ts');
  assert.equal(stats.events[0]?.result?.isError, false);
});

test('joins pairs even when tool_result precedes its tool_use (order inversion)', async () => {
  // Real corpus anomaly: 25 inverted pairs across 7 sessions.
  const lines = [
    humanInput('go'),
    toolResult({ toolUseId: 'toolu_inv', content: 'file contents' }),
    assistantToolUse({ tool: 'Read', input: { file_path: '/p/a.ts' }, toolUseId: 'toolu_inv' }),
  ];
  const stats = await parseSessionLines(lines);
  assert.equal(stats.events.length, 1);
  assert.equal(stats.events[0]?.result?.isError, false);
  assert.equal(stats.events[0]?.result?.contentLength, 'file contents'.length);
});

test('ignores a half-written trailing line silently (live session)', async () => {
  const lines = [...session(read('/p/a.ts')), '{"type":"assistant","message":{"role":"assis'];
  const stats = await parseSessionLines(lines);
  assert.equal(stats.incompleteLastLine, true);
  assert.equal(stats.malformedLines, 0);
  assert.equal(stats.events.length, 1);
});

test('counts malformed lines in the middle without dying', async () => {
  const lines = [humanInput('go'), 'not json at all', ...read('/p/a.ts')];
  const stats = await parseSessionLines(lines);
  assert.equal(stats.malformedLines, 1);
  assert.equal(stats.events.length, 1);
});

test('unknown record types are counted and passed over; ratio gates scoring', async () => {
  const unknown = JSON.stringify({ type: 'wholly-new-record-kind', data: 1 });
  const fine = await parseSessionLines([
    ...session(read('/p/a.ts'), read('/p/b.ts'), read('/p/c.ts'), edit('/p/a.ts')),
    unknown,
  ]);
  assert.equal(fine.unknownTypeCount, 1);
  assert.equal(isScorable(fine), true);

  const mostlyUnknown = await parseSessionLines([humanInput('go'), unknown, unknown, unknown]);
  assert.equal(isScorable(mostlyUnknown), false);
});

test('counts only true human inputs, not tool_result carriers or notifications', async () => {
  const notification = JSON.stringify({
    type: 'user', isSidechain: false, isMeta: false,
    origin: { kind: 'task-notification' },
    message: { role: 'user', content: '<task-notification>done</task-notification>' },
  });
  const stats = await parseSessionLines([...session(read('/p/a.ts')), notification]);
  assert.equal(stats.humanInputCount, 1);
});

test('slash-command and bash-mode records are not counted as human turns', async () => {
  // real logs: these arrive with no origin and reach the prefix check
  const slash = JSON.stringify({ type: 'user', isSidechain: false, isMeta: false, message: { role: 'user', content: '<command-name>/effort</command-name>\n  ' } });
  const bashIn = JSON.stringify({ type: 'user', isSidechain: false, isMeta: false, message: { role: 'user', content: '<bash-input> npm login</bash-input>' } });
  const stats = await parseSessionLines([...session(read('/p/a.ts')), slash, bashIn]);
  assert.equal(stats.humanInputCount, 1); // only the real "do the task" input
});

test('excludes trailix self-invocations from scoring (pollution filter)', async () => {
  const stats = await parseSessionLines(session(
    bash('npx trailix --done'),
    bash('git commit -m "mention trailix in a message"'),
  ));
  assert.equal(stats.selfEventCount, 1);
  assert.equal(stats.events.length, 1);
  assert.match(stats.events[0]?.command ?? '', /git commit/);
});

test('pollution filter ignores trailix after separators INSIDE quoted strings', async () => {
  // review finding: '; trailix' in a commit message flipped the whole Bash
  // event to self, silently deleting the bash-untracked annotation
  const stats = await parseSessionLines(session(
    bash('git commit -m "fix parser; trailix handles it"'),
    bash("echo 'run && trailix later'"),
  ));
  assert.equal(stats.selfEventCount, 0);
  assert.equal(stats.events.length, 2);
});

test('pollution filter catches multiline, runner and path-form self-invocations', async () => {
  const stats = await parseSessionLines(session(
    bash('npm test\nnpx trailix score'),
    bash('bunx trailix score'),
    bash('pnpm exec trailix score'),
    bash('node dist/trailix.js last'),
    bash('./trailix last'),
    bash('cat src/trailix.ts'), // reading trailix source is NOT an invocation
  ));
  assert.equal(stats.selfEventCount, 5);
  assert.equal(stats.events.length, 1);
  assert.match(stats.events[0]?.command ?? '', /cat src/);
});

test('NotebookEdit target is extracted from notebook_path', async () => {
  const stats = await parseSessionLines(session(
    [assistantToolUse({ tool: 'NotebookEdit', input: { notebook_path: '/p/analysis.ipynb' } })],
  ));
  assert.equal(stats.events[0]?.filePath, '/p/analysis.ipynb');
});

test('flags subagent usage', async () => {
  const stats = await parseSessionLines(session(
    [assistantToolUse({ tool: 'Agent', input: { prompt: 'go' } })],
  ));
  assert.equal(stats.usedSubagents, true);
});

test('never stores result bodies — only their length', async () => {
  const big = 'x'.repeat(50_000);
  const stats = await parseSessionLines(session(bash('ls -la', big)));
  assert.equal(stats.events[0]?.result?.contentLength, 50_000);
  const serialized = JSON.stringify(stats);
  assert.equal(serialized.includes('xxxxx'), false);
});
