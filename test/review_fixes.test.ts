import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionLines } from '../src/parser.ts';
import { buildCard } from '../src/card.ts';
import { renderHook } from '../src/render/index.ts';
import { evaluateRule2 } from '../src/rules/rule2.ts';
import { evaluateRule3 } from '../src/rules/rule3.ts';
import { formatDuration } from '../src/facts.ts';
import { fileList, msg } from '../src/messages.ts';
import { clampWidth, middleEllipsis, stringWidth, stripAnsi, wrapText } from '../src/render/width.ts';
import { colorizeInline } from '../src/render/palette.ts';
import { edit, read, readPartial, session, webFetch, webSearch, write } from './helpers/fixture.ts';

const parse = (lines: string[]) => parseSessionLines(lines);

// ── rule2: search-only no longer a "0 sources" false positive ────────────────

test('rule2: two fetches one domain → caution; search-only → no verdict', async () => {
  const caution = evaluateRule2(await parse(session(webFetch('https://a.com/1'), webFetch('https://a.com/2'))));
  assert.equal(caution.verdict, 'caution');
  const searchOnly = evaluateRule2(await parse(session(webSearch(), webSearch(), webSearch())));
  assert.equal(searchOnly.verdict, 'no_verdict');
});

// ── rule3: Write-create is not an edit (matches facts.ts) ────────────────────

test('rule3: partial read then Write-create is not a skim', async () => {
  const r = evaluateRule3(await parse(session(
    readPartial('/p/a.ts'), write('/p/a.ts', 'create'),
    read('/p/b.ts'), edit('/p/b.ts'),
    read('/p/c.ts'), edit('/p/c.ts'),
    read('/p/d.ts'), edit('/p/d.ts'),
  )));
  assert.equal(r.verdict, 'pass'); // a.ts create excluded, rest deep
});

test('rule3: partial read then Write-update still counts as a skim', async () => {
  const r = evaluateRule3(await parse(session(
    readPartial('/p/a.ts'), write('/p/a.ts', 'update'),
    readPartial('/p/b.ts'), write('/p/b.ts', 'update'),
    readPartial('/p/c.ts'), write('/p/c.ts', 'update'),
  )));
  assert.equal(r.verdict, 'caution');
});

// ── width utilities ──────────────────────────────────────────────────────────

test('clampWidth is ANSI-aware: keeps visible budget and closes open colour', () => {
  const colored = '\x1b[36m/very/long/path/to/some/file.ts\x1b[0m';
  const out = clampWidth(colored, 12);
  assert.equal(stringWidth(out) <= 12, true);
  assert.equal(out.endsWith('\x1b[0m'), true); // no colour bleed
  assert.equal(stripAnsi(out).length > 0, true);
});

test('wrapText clamps an over-long leading word to the budget', () => {
  for (const line of wrapText('supercalifragilisticexpialidocious tail', 10)) {
    assert.equal(stringWidth(line) <= 10, true);
  }
});

test('middleEllipsis keeps the filename tail and never exceeds max', () => {
  const p = '/home/me/proj/src/app/(dashboard)/settings/page.tsx';
  const out = middleEllipsis(p, 24);
  assert.equal(stringWidth(out) <= 24, true);
  assert.equal(out.includes('page.tsx'), true);
  assert.equal(stringWidth(middleEllipsis(p, 3)) <= 3, true);
});

test('fileList middle-elides long paths, preserving filenames', () => {
  const out = fileList(['/a/very/deeply/nested/directory/tree/parser.ts'], 'en');
  assert.equal(out.includes('parser.ts'), true);
});

// ── colorizeInline: no corruption of paths after a `command` span ────────────

test('colorizeInline (colour) paints command + path without injecting stray SGR digits', () => {
  const out = colorizeInline('run `trailix last` on src/parser.ts now', { color: true });
  // stripping ANSI must recover the exact original text (no orphaned "36m" etc.)
  assert.equal(stripAnsi(out), 'run trailix last on src/parser.ts now');
});

test('colorizeInline (no colour) strips backticks', () => {
  assert.equal(colorizeInline('see `trailix last`', {}), 'see trailix last');
});

// ── hook: onboarding hint has no literal backtick leak at any width ──────────

test('hook onboarding card never leaks literal backticks across wrap widths', async () => {
  const card = buildCard(await parse([]), { lang: 'en' });
  for (const term of [20, 34, 48, 60, 80]) {
    const out = renderHook(card, { termWidth: term });
    assert.equal(out.includes('`'), false, `leaked backtick at term=${term}`);
  }
});

// ── duration roll-up ─────────────────────────────────────────────────────────

test('formatDuration rolls minutes up to hours/days', () => {
  assert.equal(formatDuration(45, 'en'), '45m');
  assert.match(formatDuration(200, 'en'), /~3h/);
  assert.match(formatDuration(62827, 'en'), /~44d/);
  assert.match(formatDuration(200, 'ko'), /약 3시간/);
});

// ── card: 0-event unscorable → no_verdict, not the empty onboarding card ─────

test('zero-event unscorable session is no_verdict, not empty', async () => {
  const unknown = JSON.stringify({ type: 'brand-new-record-kind', x: 1 });
  const card = buildCard(await parse([unknown, unknown, unknown]), { lang: 'en' });
  assert.equal(card.state, 'no_verdict');
});
