import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook } from '../src/hook.ts';
import { agent, bash, edit, read, session } from './helpers/fixture.ts';

function transcript(lines: string[]): string {
  const p = join(mkdtempSync(join(tmpdir(), 'trailix-hook-')), 'session.jsonl');
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

test('delegation turn (subagent) → systemMessage card', async () => {
  const p = transcript(session(agent('a'), agent('b'), read('/p/out.md')));
  const out = await runHook(JSON.stringify({ transcript_path: p }), { LANG: 'en' });
  const parsed = JSON.parse(out) as { systemMessage: string };
  assert.equal(typeof parsed.systemMessage, 'string');
  assert.equal(parsed.systemMessage.startsWith('\n'), true); // hook contract
  assert.equal(parsed.systemMessage.includes('trailix'), true);
});

test('delegation turn (>=10 tools) → card', async () => {
  const many = Array.from({ length: 11 }, (_, i) => read(`/p/f${i}.ts`)).flat();
  const out = await runHook(JSON.stringify({ transcript_path: transcript(session(...many.map((l) => [l]))) }), {});
  assert.notEqual(out, '');
});

test('chat turn (few tools, no subagent) → silent', async () => {
  const p = transcript(session(read('/p/a.ts'), bash('ls')));
  const out = await runHook(JSON.stringify({ transcript_path: p }), {});
  assert.equal(out, '');
});

test('a new human input resets the turn: a chat turn after a delegation turn stays silent', async () => {
  const p = transcript([
    ...session(agent('a'), agent('b')), // delegation turn
    ...session(read('/p/a.ts')), // then a fresh chat turn (new human input)
  ]);
  const out = await runHook(JSON.stringify({ transcript_path: p }), {});
  assert.equal(out, ''); // last turn is the chat turn
});

test('bad stdin JSON → silent, never throws', async () => {
  assert.equal(await runHook('not json', {}), '');
  assert.equal(await runHook('{}', {}), '');
  assert.equal(await runHook(JSON.stringify({ transcript_path: '/does/not/exist.jsonl' }), {}), '');
});
