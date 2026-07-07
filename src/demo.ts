import { parseSessionLines } from './parser.ts';
import { buildCard, type Card } from './card.ts';
import type { Lang } from './types.ts';

/**
 * A built-in example card, rendered through the real engine from a synthetic
 * session (fake paths, no real data). Powers `trailix demo` — an instant
 * first-run preview before the user has any sessions, and the source for the
 * README/GIF. Kept here (not in test helpers) so it ships with the CLI.
 */

let seq = 0;
const id = (p: string): string => `${p}_${(seq++).toString(36)}`;
const human = (t: string): string =>
  JSON.stringify({ type: 'user', isSidechain: false, isMeta: false, origin: { kind: 'human' }, message: { role: 'user', content: t }, uuid: id('u') });
const use = (name: string, input: Record<string, unknown>, tid: string): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: tid, name, input }] }, uuid: id('a') });
const res = (tid: string, content: string): string =>
  JSON.stringify({ type: 'user', isSidechain: false, isMeta: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, is_error: false, content }] }, uuid: id('u') });
const call = (name: string, input: Record<string, unknown>, kb = 8): string[] => {
  const tid = id('t');
  return [use(name, input, tid), res(tid, 'x'.repeat(kb * 1024))];
};
const read = (f: string, opts: Record<string, unknown> = {}, kb = 8): string[] => call('Read', { file_path: f, ...opts }, kb);
const edit = (f: string): string[] => {
  const tid = id('t');
  return [use('Edit', { file_path: f }, tid), res(tid, 'edited')];
};
const fetch = (u: string): string[] => call('WebFetch', { url: u }, 10);
const agent = (): string => use('Agent', { prompt: 'research' }, id('t'));

const DEMO_SESSION: string[] = [
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
];

export async function demoCard(lang: Lang): Promise<Card> {
  seq = 0;
  const stats = await parseSessionLines(DEMO_SESSION);
  return buildCard(stats, { lang, dateLabel: '07-08', durationLabel: '22m' });
}
