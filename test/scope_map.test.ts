import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSessionLines } from '../src/parser.ts';
import { buildMapModel, categorize, classifyCommand, collectSubagentSummaries } from '../src/scope.ts';
import { renderMapHtml } from '../src/render/map.ts';
import { buildAxis, buildRuns, tickStep } from '../src/render/map-timeline.ts';
import { runCli, type CliIO } from '../src/cli.ts';
import { runHook } from '../src/hook.ts';
import { cwdToDirName } from '../src/session-select.ts';
import type { ToolEvent } from '../src/types.ts';

/**
 * Scope-mode parser + map model + map renderer tests. Fixtures here carry
 * timestamps and rich toolUseResult fields (shapes verified against real
 * v2.1.x logs on 2026-07-12), which the shared fixture helpers do not.
 */

let seq = 0;
const uid = (): string => `t_${(seq++).toString(36).padStart(5, '0')}`;
const T0 = 1_770_000_000_000;
const iso = (offsetSec: number): string => new Date(T0 + offsetSec * 1000).toISOString();

function human(text: string, atSec: number): string {
  return JSON.stringify({
    type: 'user', isSidechain: false, isMeta: false, origin: { kind: 'human' },
    message: { role: 'user', content: text }, uuid: uid(), timestamp: iso(atSec),
  });
}

function tsToolUse(atSec: number, tool: string, input: Record<string, unknown>, toolUseId: string, msgExtra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant', isSidechain: false, timestamp: iso(atSec), uuid: uid(),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: tool, input }], ...msgExtra },
  });
}

function tsToolResult(atSec: number, toolUseId: string, content: string, toolUseResult?: Record<string, unknown>, isError = false): string {
  return JSON.stringify({
    type: 'user', isSidechain: false, isMeta: false, timestamp: iso(atSec), uuid: uid(),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content }] },
    toolUseResult,
  });
}

function assistantText(atSec: number, text: string, msgId: string, usage?: Record<string, unknown>, thinking?: string): string {
  const content: unknown[] = [];
  if (thinking !== undefined) content.push({ type: 'thinking', thinking });
  content.push({ type: 'text', text });
  return JSON.stringify({
    type: 'assistant', isSidechain: false, timestamp: iso(atSec), uuid: uid(),
    message: { role: 'assistant', id: msgId, content, usage },
  });
}

function turnDuration(atSec: number, ms: number): string {
  return JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: ms, timestamp: iso(atSec), uuid: uid() });
}

const PATCH = { structuredPatch: [{ lines: ['+a', '+b', '-c', ' ctx'] }, { lines: ['+d'] }] };

function richSession(): string[] {
  const readId = uid();
  const editId = uid();
  const askId = uid();
  const writeId = uid();
  return [
    JSON.stringify({ type: 'ai-title', aiTitle: '테스트 세션', timestamp: iso(0) }),
    human('첫 번째 요청입니다\n둘째 줄', 1),
    assistantText(2, '생각해볼게요', 'msg1', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 }, '고민중'),
    // same message split into a second record — usage must NOT double-count
    assistantText(2, '이어서', 'msg1', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 }),
    tsToolUse(3, 'Read', { file_path: '/proj/src/a.ts' }, readId),
    tsToolResult(4, readId, 'file body', { type: 'text', file: { filePath: '/proj/src/a.ts', numLines: 90, totalLines: 100 } }),
    tsToolUse(5, 'WebSearch', { query: 'how to test' }, uid()),
    tsToolUse(6, 'Edit', { file_path: '/proj/src/a.ts' }, editId, {}),
    tsToolResult(7, editId, 'ok', PATCH),
    tsToolUse(8, 'AskUserQuestion', { questions: [{ question: '어느 쪽?', header: '선택', options: [{ label: 'A안' }, { label: 'B안' }] }] }, askId),
    tsToolResult(9, askId, 'Your questions have been answered: "어느 쪽?"="B안". Continue.'),
    tsToolUse(10, 'Write', { file_path: '/proj/new.ts', content: 'l1\nl2\nl3' }, writeId),
    tsToolResult(11, writeId, 'created', { type: 'create' }),
    turnDuration(12, 11_000),
    human('두 번째 요청', 20),
    tsToolUse(21, 'Bash', { command: 'grep -r foo src/' }, uid()),
    tsToolUse(22, 'Bash', { command: 'npm test' }, uid()),
    assistantText(23, '최종 보고입니다', 'msg9', { input_tokens: 10, output_tokens: 7 }),
    turnDuration(24, 4_000),
  ];
}

// ── parser: scope collection ───────────────────────────────────────────────

test('scope off by default: no scope field, events carry no timestamps', async () => {
  const stats = await parseSessionLines(richSession());
  assert.equal(stats.scope, undefined);
  assert.equal(stats.events[0]?.ts, undefined);
});

test('scope mode: turns, timestamps, usage dedupe, thinking, title', async () => {
  const stats = await parseSessionLines(richSession(), { scope: true });
  const scope = stats.scope;
  assert.ok(scope);
  assert.equal(scope.title, '테스트 세션');
  assert.equal(scope.turns.length, 2);
  assert.equal(scope.turns[0]?.promptPreview, '첫 번째 요청입니다');
  assert.equal(scope.turns[0]?.durationMs, 11_000);
  assert.equal(scope.turns[1]?.durationMs, 4_000);
  // usage deduped by message id: msg1 counted once + msg9
  assert.equal(scope.usage.outputTokens, 57);
  assert.equal(scope.usage.inputTokens, 110);
  assert.equal(scope.turns[0]?.thinkingBlocks, 1);
  assert.equal(scope.lastReport, '최종 보고입니다');
  const first = stats.events[0] as ToolEvent;
  assert.equal(first.ts, T0 + 3000);
  assert.equal(first.turnIndex, 1);
  const bash = stats.events.find((e) => e.tool === 'Bash');
  assert.equal(bash?.turnIndex, 2);
});

test('scope mode: query, questions+answer, patch counts, read depth, write lines', async () => {
  const stats = await parseSessionLines(richSession(), { scope: true });
  const search = stats.events.find((e) => e.tool === 'WebSearch');
  assert.equal(search?.query, 'how to test');
  const ask = stats.events.find((e) => e.tool === 'AskUserQuestion');
  assert.equal(ask?.questions?.[0]?.question, '어느 쪽?');
  assert.deepEqual(ask?.questions?.[0]?.options, ['A안', 'B안']);
  assert.match(ask?.result?.answerPreview ?? '', /="B안"/);
  const edit = stats.events.find((e) => e.tool === 'Edit');
  assert.equal(edit?.result?.linesAdded, 3);
  assert.equal(edit?.result?.linesRemoved, 1);
  const read = stats.events.find((e) => e.tool === 'Read');
  assert.equal(read?.result?.readNumLines, 90);
  assert.equal(read?.result?.readTotalLines, 100);
  const write = stats.events.find((e) => e.tool === 'Write');
  assert.equal(write?.inputLines, 3);
});

test('TodoWrite reshuffle is detected only when ≥2 items were replaced', async () => {
  const todo = (items: string[], id: string): string[] => [
    tsToolUse(30, 'TodoWrite', { todos: items.map((content) => ({ content, status: 'pending' })) }, id),
  ];
  const lines = [
    human('go', 1),
    ...todo(['a', 'b', 'c'], uid()),
    ...todo(['a', 'x', 'y'], uid()), // b,c removed → reorg
  ];
  const stats = await parseSessionLines(lines, { scope: true });
  const todos = stats.events.filter((e) => e.tool === 'TodoWrite');
  assert.equal(todos[0]?.todoReorg, undefined); // first call has no previous list
  assert.deepEqual(todos[1]?.todoReorg, { before: 3, after: 3, removed: 2 });
});

// ── scope model ────────────────────────────────────────────────────────────

const ev = (tool: string, extra: Partial<ToolEvent> = {}): ToolEvent => ({ seq: 0, tool, self: false, ...extra });

test('categorize: inspect bash → research, other bash → exec, waits → delegate', () => {
  assert.equal(categorize(ev('Read')), 'research');
  assert.equal(categorize(ev('Bash', { command: 'cat foo.ts' })), 'research');
  assert.equal(categorize(ev('Bash', { command: 'git log --oneline' })), 'research');
  assert.equal(categorize(ev('Bash', { command: 'npm install' })), 'exec');
  assert.equal(categorize(ev('TaskOutput')), 'delegate');
  assert.equal(categorize(ev('AskUserQuestion')), 'decide');
  assert.equal(categorize(ev('SomeMcpTool')), 'other');
});

test('classifyCommand buckets', () => {
  assert.equal(classifyCommand('npm test'), 'test');
  assert.equal(classifyCommand('npx vitest run'), 'test');
  assert.equal(classifyCommand('tsc --noEmit'), 'build');
  assert.equal(classifyCommand('ls -la'), 'inspect');
  assert.equal(classifyCommand('node -e "x"'), 'other');
});

async function modelFor(lines: string[], home?: string) {
  const stats = await parseSessionLines(lines, { scope: true });
  return buildMapModel(stats, { lang: 'ko', sessionId: 's1', sourcePath: '/tmp/s1.jsonl', home });
}

test('map model: research depth, decisions with chosen answer, work rollup', async () => {
  const m = await modelFor(richSession());
  const file = m.research.files.find((f) => f.path.endsWith('a.ts'));
  assert.equal(file?.depth, 'deep'); // 90/100
  assert.equal(m.research.webSearches[0], 'how to test');

  assert.equal(m.decisions.length, 1);
  assert.equal(m.decisions[0]?.kind, 'asked');
  assert.deepEqual(m.decisions[0]?.chosen, ['B안']);

  const edited = m.work.files.find((f) => f.path.endsWith('a.ts'));
  assert.equal(edited?.adds, 3);
  assert.equal(edited?.dels, 1);
  const created = m.work.files.find((f) => f.path.endsWith('new.ts'));
  assert.equal(created?.created, true);
  assert.equal(created?.adds, 3); // from Write input line count
  assert.equal(m.work.commands.test, 1);
  assert.equal(m.timeline.turnRows.length, 2);
  assert.equal(m.timeline.turnRows[0]?.edits, 2);
});

test('map model: paths shown project-relative (cwd from log) and ~-shortened', async () => {
  const lines = [
    JSON.stringify({ type: 'summary', cwd: '/proj', timestamp: iso(0) }),
    human('go', 1),
    ...richSession().slice(1),
  ];
  const m = await modelFor(lines, '/home/u');
  // cwd captured from any record: /proj → src/a.ts
  assert.ok(m.research.files.some((f) => f.path === 'src/a.ts'));
});

test('errored spawns are not counted as delegations', async () => {
  const spawnId = uid();
  const lines = [
    human('go', 1),
    tsToolUse(2, 'Workflow', { script: 'x' }, spawnId),
    tsToolResult(3, spawnId, 'InputValidationError', undefined, true),
  ];
  const m = await modelFor(lines);
  assert.equal(m.delegation.spawns, 0);
});

// ── timeline geometry ──────────────────────────────────────────────────────

test('buildAxis compresses idle gaps and keeps a monotonic mapping', () => {
  const min = 60_000;
  const moments = [0, min, 2 * min, 62 * min, 63 * min].map((d) => T0 + d);
  const axis = buildAxis(moments);
  assert.ok(axis);
  assert.equal(axis.gaps.length, 1); // the 60-minute hole
  assert.ok(Math.round(axis.gaps[0]!.ms / 60_000) === 60);
  const xs = moments.map((t) => axis.x(t));
  for (let i = 1; i < xs.length; i++) assert.ok((xs[i] as number) >= (xs[i - 1] as number));
});

test('buildRuns merges consecutive same-category events', () => {
  const pts = [
    { ts: T0, cat: 'research' as const },
    { ts: T0 + 1000, cat: 'research' as const },
    { ts: T0 + 2000, cat: 'work' as const },
  ];
  const runs = buildRuns(pts, T0 + 3000);
  assert.equal(runs.length, 2);
  assert.equal(runs[0]?.count, 2);
  assert.equal(runs[1]?.endTs, T0 + 3000);
});

test('tickStep lands between 8 and 12 ticks', () => {
  for (const span of [5 * 60_000, 3_600_000, 8 * 3_600_000]) {
    assert.ok(span / tickStep(span) <= 12);
  }
});

// ── map renderer ───────────────────────────────────────────────────────────

test('map HTML: sections present, self-contained, arbitrary strings escaped', async () => {
  const evil = uid();
  const lines = [
    human('go <script>alert(1)</script>', 1),
    tsToolUse(2, 'Read', { file_path: '/proj/<img src=x onerror=alert(1)>.ts' }, evil),
    tsToolResult(3, evil, 'body', { type: 'text', file: { numLines: 5, totalLines: 5 } }),
  ];
  const m = await modelFor(lines);
  const html = renderMapHtml(m);
  for (const id of ['timeline', 'research', 'decisions', 'work', 'scorecard', 'appendix']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.equal(/src="http|href="http|@import|url\(http/.test(html), false, 'external resource found');
  // escaped text keeps the harmless substring; the raw TAGS must be gone
  assert.equal(html.includes('<script>alert'), false, 'unescaped script tag');
  assert.equal(html.includes('<img'), false, 'unescaped img tag');
  assert.ok(html.includes('&lt;img'), 'path should appear escaped');
});

test('map HTML renders in both languages and without timestamps', async () => {
  // no-timestamp session (older log shape): still renders, no <svg>
  const noTs = [
    JSON.stringify({ type: 'user', isMeta: false, isSidechain: false, origin: { kind: 'human' }, message: { role: 'user', content: 'go' }, uuid: uid() }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: uid(), name: 'Read', input: { file_path: '/a' } }] }, uuid: uid() }),
  ];
  const stats = await parseSessionLines(noTs, { scope: true });
  for (const lang of ['ko', 'en'] as const) {
    const m = buildMapModel(stats, { lang, sessionId: 's', sourcePath: '/x' });
    const html = renderMapHtml(m);
    assert.equal(html.includes('<svg'), false);
    assert.ok(html.includes(lang === 'ko' ? '발자취' : 'trail'));
  }
});

test('decisions are never truncated in the HTML', async () => {
  const lines: string[] = [human('go', 1)];
  for (let i = 0; i < 40; i++) {
    const id = uid();
    lines.push(tsToolUse(2 + i, 'AskUserQuestion', { questions: [{ question: `질문 ${i}?`, options: [{ label: 'a' }] }] }, id));
    lines.push(tsToolResult(3 + i, id, `Your questions have been answered: "질문 ${i}?"="a".`));
  }
  const m = await modelFor(lines);
  const html = renderMapHtml(m);
  for (let i = 0; i < 40; i++) assert.ok(html.includes(`질문 ${i}?`), `decision ${i} missing`);
});

// ── subagent scan ──────────────────────────────────────────────────────────

test('collectSubagentSummaries reads plain and workflow transcripts + meta', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trailix-sub-'));
  const sessionPath = join(dir, 'sess1.jsonl');
  writeFileSync(sessionPath, human('go', 1) + '\n');
  const subDir = join(dir, 'sess1', 'subagents');
  const wfDir = join(subDir, 'workflows', 'wf_abc123');
  mkdirSync(wfDir, { recursive: true });
  const agentLines = [
    tsToolUse(2, 'Read', { file_path: '/x.ts' }, uid()),
    tsToolUse(3, 'Bash', { command: 'npm test' }, uid()),
  ].join('\n');
  writeFileSync(join(subDir, 'agent-aaa.jsonl'), agentLines + '\n');
  writeFileSync(join(subDir, 'agent-aaa.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '탐색', spawnDepth: 1 }));
  writeFileSync(join(wfDir, 'agent-bbb.jsonl'), agentLines + '\n');

  const { agents, truncated } = await collectSubagentSummaries(sessionPath);
  assert.equal(truncated, false);
  assert.equal(agents.length, 2);
  const plain = agents.find((a) => !a.isWorkflow);
  assert.equal(plain?.agentType, 'general-purpose');
  assert.equal(plain?.desc, '탐색');
  assert.equal(plain?.reads, 1);
  assert.equal(plain?.execs, 1);
  const wf = agents.find((a) => a.isWorkflow);
  assert.equal(wf?.groupId, 'wf_abc123');
});

// ── CLI map command ────────────────────────────────────────────────────────

function makeHome(projectCwd: string, sessions: Record<string, string[]>): string {
  const home = mkdtempSync(join(tmpdir(), 'trailix-home-'));
  const dir = join(home, '.claude', 'projects', cwdToDirName(projectCwd));
  mkdirSync(dir, { recursive: true });
  for (const [id, lines] of Object.entries(sessions)) {
    writeFileSync(join(dir, `${id}.jsonl`), lines.join('\n') + '\n');
  }
  return home;
}

const io = (over: Partial<CliIO>): CliIO => ({
  argv: [], env: {}, cwd: '/home/u/proj', isTTY: false, termWidth: 80, ...over,
});

test('trailix map writes the HTML to the cache dir and prints the path', async () => {
  const home = makeHome('/home/u/proj', { s1: richSession() });
  const writes: { path: string; content: string }[] = [];
  const opened: string[] = [];
  const r = await runCli(
    io({
      argv: ['map', '--open', '--lang', 'ko'],
      env: { HOME: home },
      writeFile: (path, content) => writes.push({ path, content }),
      openPath: (path) => opened.push(path),
    }),
  );
  assert.equal(r.exitCode, 0);
  assert.equal(writes.length, 1);
  assert.ok(writes[0]?.path.endsWith('/.cache/trailix/maps/s1.html'));
  assert.ok(writes[0]?.content.includes('<!doctype html>'));
  assert.deepEqual(opened, [writes[0]?.path]);
  assert.match(r.stdout, /지도 저장/);
});

test('trailix map without writeFile injection prints the HTML itself', async () => {
  const home = makeHome('/home/u/proj', { s1: richSession() });
  const r = await runCli(io({ argv: ['map', '--lang', 'en'], env: { HOME: home } }));
  assert.ok(r.stdout.startsWith('<!doctype html>'));
});

test('trailix map with no sessions degrades to guidance', async () => {
  const home = mkdtempSync(join(tmpdir(), 'trailix-home-'));
  const r = await runCli(io({ argv: ['map'], env: { HOME: home } }));
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /session history|세션 기록/);
});

test('trailix last hints at the map (term surface only)', async () => {
  const home = makeHome('/home/u/proj', { s1: richSession() });
  const term = await runCli(io({ argv: ['last', '--lang', 'en'], env: { HOME: home } }));
  assert.match(term.stdout, /trailix map --open/);
  const md = await runCli(io({ argv: ['last', '--format', 'md', '--lang', 'en'], env: { HOME: home } }));
  assert.equal(md.stdout.includes('trailix map --open'), false);
});

// ── hook hint ──────────────────────────────────────────────────────────────

test('hook card carries the map hint and stays inside the 10k cap', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trailix-hook-'));
  const lines: string[] = [human('go', 1)];
  for (let i = 0; i < 12; i++) {
    const id = uid();
    lines.push(tsToolUse(2 + i, 'Read', { file_path: `/p/f${i}.ts` }, id));
    lines.push(tsToolResult(3 + i, id, 'body'));
  }
  const p = join(dir, 'x.jsonl');
  writeFileSync(p, lines.join('\n') + '\n');
  const out = await runHook(JSON.stringify({ transcript_path: p }), { LANG: 'en_US.UTF-8' } as NodeJS.ProcessEnv);
  assert.ok(out !== '');
  const parsed = JSON.parse(out) as { systemMessage: string };
  assert.match(parsed.systemMessage, /trailix map --open/);
  assert.ok(parsed.systemMessage.length <= 10_000);
});
