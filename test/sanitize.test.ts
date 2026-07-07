import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSession, sanitizeLine, redactSecrets, genericizeHome } from '../src/sanitize.ts';
import { parseSessionLines } from '../src/parser.ts';
import { buildCard } from '../src/card.ts';

// Planted markers that MUST NOT survive sanitization (design T3).
const MARKERS = [
  'sk-ant-api03-ABCDEF0123456789abcdef0123456789',
  'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  'AKIAIOSFODNN7EXAMPLE',
  'secret.person@company.co.kr',
  '192.168.31.244',
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', // 32-hex
];

test('planted secret markers do not survive sanitization', () => {
  const session = [
    JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: `deploy with key ${MARKERS[0]} and token ${MARKERS[1]}` } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: `curl -H "auth: ${MARKERS[2]}" https://x` } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: `emailed ${MARKERS[3]} from ${MARKERS[4]}, hash ${MARKERS[5]}` }] } }),
    // a secret inside an ERROR result — content is preserved (not fillered) but
    // must still be redacted
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: `auth failed with ${MARKERS[1]}` }] } }),
  ].join('\n');

  const clean = sanitizeSession(session);
  for (const m of MARKERS) assert.equal(clean.includes(m), false, `marker survived: ${m}`);
  assert.equal(clean.includes('[REDACTED]'), true);
});

test('sanitization preserves the grade (structural signals kept)', async () => {
  // 3 blocked blind-edit attempts (error results) → rule ①-a caution. The error
  // content ("has not been read") must survive so the sanitized grade matches.
  const blocked = (id: string, f: string): string[] => [
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Edit', input: { file_path: `/home/rladn/proj/${f}` } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'File has not been read yet. Read it first.' }] } }),
  ];
  const raw = [
    JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'edit these' } }),
    ...blocked('t1', 'a.ts'), ...blocked('t2', 'b.ts'), ...blocked('t3', 'c.ts'),
  ].join('\n');

  const before = buildCard(await parseSessionLines(raw.split('\n')), { lang: 'en' });
  const after = buildCard(await parseSessionLines(sanitizeSession(raw).split('\n')), { lang: 'en' });
  assert.equal(before.overall, 'caution');
  assert.equal(after.overall, before.overall); // grade preserved
});

test('home paths are genericized', () => {
  assert.equal(genericizeHome('/home/rladn/projects/x/secret.ts', '/home/rladn'), '/home/user/projects/x/secret.ts');
  assert.equal(genericizeHome('/home/someoneelse/a', '/home/rladn'), '/home/user/a');
});

test('file_path is genericized but structure preserved', () => {
  const line = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/home/rladn/projects/app/src/db.ts' } }] } });
  const clean = sanitizeLine(line, '/home/rladn') as string;
  assert.equal(clean.includes('/home/rladn'), false);
  assert.equal(clean.includes('/home/user/projects/app/src/db.ts'), true);
});

test('redactSecrets leaves ordinary prose untouched', () => {
  const prose = 'read the parser and fix the retry logic';
  assert.equal(redactSecrets(prose), prose);
});

test('sanitized output is still valid, parseable JSONL with the same shape', async () => {
  const session = [
    JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'do the task' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/home/rladn/a.ts' } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'x'.repeat(500) }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/home/rladn/a.ts' } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', is_error: false, content: 'edited' }] } }),
  ].join('\n');

  const clean = sanitizeSession(session);
  const stats = await parseSessionLines(clean.split('\n'));
  assert.equal(stats.humanInputCount, 1);
  assert.equal(stats.events.length, 2); // Read + Edit preserved
  assert.equal(stats.events[1]?.filePath, '/home/user/a.ts');
  // the 500-char body's size is preserved (filler)
  assert.equal((stats.events[0]?.result?.contentLength ?? 0) >= 400, true);
});
