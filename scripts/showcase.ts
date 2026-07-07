#!/usr/bin/env node
/**
 * Renders example cards from SYNTHETIC sessions (fake paths, real renderer) for
 * the README hero. No real session data is read — safe to publish. Output is
 * copied verbatim into README.md.
 */
import { parseSessionLines } from '../src/parser.ts';
import { buildCard } from '../src/card.ts';
import { renderCli } from '../src/render/index.ts';

let seq = 0;
const id = (p: string): string => `${p}_${(seq++).toString(36)}`;
const human = (t: string): string => JSON.stringify({ type: 'user', isSidechain: false, isMeta: false, origin: { kind: 'human' }, message: { role: 'user', content: t }, uuid: id('u') });
const use = (name: string, input: Record<string, unknown>, tid: string): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: tid, name, input }] }, uuid: id('a') });
const res = (tid: string, content: string, isError = false, extra?: Record<string, unknown>): string =>
  JSON.stringify({ type: 'user', isSidechain: false, isMeta: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, is_error: isError, content }] }, ...extra, uuid: id('u') });
const call = (name: string, input: Record<string, unknown>, content = 'ok', extra?: Record<string, unknown>): string[] => {
  const tid = id('t');
  return [use(name, input, tid), res(tid, content, false, extra)];
};
const K = (n: number): string => 'x'.repeat(n * 1024);
const read = (f: string, opts: Record<string, unknown> = {}, kb = 8): string[] => call('Read', { file_path: f, ...opts }, K(kb));
const edit = (f: string): string[] => call('Edit', { file_path: f }, 'edited');
const fetch = (u: string): string[] => call('WebFetch', { url: u }, K(10));
const agent = (): string => use('Agent', { prompt: 'research' }, id('t'));

async function show(title: string, lines: string[], over = {}): Promise<void> {
  const stats = await parseSessionLines(lines);
  const card = buildCard(stats, { lang: 'en', dateLabel: '07-08', durationLabel: '22m', ...over });
  console.log(`\n### ${title}\n`);
  console.log(renderCli(card, { env: { NO_COLOR: '1' }, isTTY: true, termWidth: 80 }));
}

// A research delegation session: broad but thin sourcing, some skims, agents
// checked. Multiple human turns so the scope reads like a real session.
await show('caution', [
  human('research the retrieval-augmented eval literature'),
  ...fetch('https://arxiv.org/abs/2401.1'), ...fetch('https://arxiv.org/abs/2401.2'), ...fetch('https://arxiv.org/abs/2401.3'),
  human('now wire the findings into our eval harness'),
  ...read('src/eval/harness.ts', {}, 12), ...edit('src/eval/harness.ts'),
  ...read('src/eval/metrics.ts', { limit: 40 }, 3), ...edit('src/eval/metrics.ts'),
  ...read('src/eval/report.ts', { limit: 30 }, 3), ...edit('src/eval/report.ts'),
  human('and update the runner'),
  ...read('src/eval/runner.ts', { limit: 25 }, 2), ...edit('src/eval/runner.ts'),
  agent(), agent(), agent(),
  ...read('notes/subagent-out.md', {}, 6),
]);

// A thorough coding session: everything read first, sources cross-checked.
await show('pass', [
  human('fix the flaky retry logic'),
  ...read('src/net/retry.ts', {}, 9), ...edit('src/net/retry.ts'),
  ...read('src/net/backoff.ts', {}, 6), ...edit('src/net/backoff.ts'),
  human('add a regression test and verify'),
  ...read('test/retry.test.ts', {}, 5), ...edit('test/retry.test.ts'),
  ...fetch('https://nodejs.org/api/timers'), ...fetch('https://developer.mozilla.org/x'),
  agent(), agent(),
  ...call('Bash', { command: 'npm test' }, 'ok'),
]);
