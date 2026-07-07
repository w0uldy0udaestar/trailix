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

test('excludes trailix self-invocations from scoring (pollution filter)', async () => {
  const stats = await parseSessionLines(session(
    bash('npx trailix --done'),
    bash('git commit -m "mention trailix in a message"'),
  ));
  assert.equal(stats.selfEventCount, 1);
  assert.equal(stats.events.length, 1);
  assert.match(stats.events[0]?.command ?? '', /git commit/);
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
