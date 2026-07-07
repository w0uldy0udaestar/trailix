import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionLines } from '../src/parser.ts';
import { buildCard } from '../src/card.ts';
import { renderCli, renderHook, renderSkill, HOOK_MAX_CHARS } from '../src/render/index.ts';
import { stringWidth, middleEllipsis, clampWidth, wrapText } from '../src/render/width.ts';
import { agent, bash, edit, editBlockedUnread, read, session, webFetch } from './helpers/fixture.ts';

const parse = (lines: string[]) => parseSessionLines(lines);

// ── card model states ───────────────────────────────────────────────────────

test('empty session → empty card with onboarding next-step', async () => {
  const card = buildCard(await parse([]), { lang: 'en' });
  assert.equal(card.state, 'empty');
  assert.equal(card.overall, 'no_verdict');
  assert.match(card.next ?? '', /trailix list/);
});

test('activity but every rule abstains → no_verdict card keeps facts', async () => {
  const card = buildCard(await parse(session(read('/p/a.ts'), read('/p/b.ts'))), { lang: 'en' });
  assert.equal(card.state, 'no_verdict');
  assert.equal(card.facts.length > 0, true); // facts always print
});

test('normal card carries verdicts + facts + notes', async () => {
  const card = buildCard(await parse(session(
    editBlockedUnread('/p/a.ts'), read('/p/a.ts'), edit('/p/a.ts'),
    webFetch('https://one.com/x'),
    agent('a'), agent('b'),
  )), { lang: 'ko', dateLabel: '07-07', durationLabel: '22분' });
  assert.equal(card.state, 'normal');
  assert.equal(card.overall, 'caution');
  assert.equal(card.verdicts.length > 0, true);
  assert.equal(card.facts.length > 0, true);
});

// ── CLI serializer ──────────────────────────────────────────────────────────

test('CLI boxed at 80 cols with NO_COLOR has no ANSI and aligned box', async () => {
  const card = buildCard(await parse(session(read('/p/a.ts'), read('/p/b.ts'), read('/p/c.ts'), edit('/p/a.ts'))), { lang: 'en' });
  const out = renderCli(card, { env: { NO_COLOR: '1' }, isTTY: true, termWidth: 80 });
  assert.equal(out.includes('\x1b['), false);
  const top = out.split('\n')[0] as string;
  const bottom = out.split('\n').find((l) => l.startsWith('╰')) as string;
  assert.equal(stringWidth(top), 80);
  assert.equal(stringWidth(bottom), 80);
});

test('CLI applies ANSI colour when TTY and colour allowed', async () => {
  const card = buildCard(await parse(session(read('/p/a.ts'), read('/p/b.ts'), read('/p/c.ts'), edit('/p/a.ts'))), { lang: 'en' });
  const out = renderCli(card, { env: {}, isTTY: true, termWidth: 80 });
  assert.equal(out.includes('\x1b['), true);
});

test('CLI --ascii is pure ASCII (glyphs + no box + folded punctuation)', async () => {
  const card = buildCard(await parse(session(editBlockedUnread('/p/a.ts'), read('/p/a.ts'), edit('/p/a.ts'))), { lang: 'en' });
  const out = renderCli(card, { env: { NO_COLOR: '1' }, isTTY: false, termWidth: 60, ascii: true });
  assert.equal(out.includes('╭'), false);
  assert.equal(/\[OK\]|\[!\]|\[X\]/.test(out), true);
  // eslint-disable-next-line no-control-regex
  assert.equal(/[^\x00-\x7f]/.test(out), false); // no unicode survives --ascii
  for (const line of out.split('\n')) assert.equal(stringWidth(line) <= 60, true);
});

test('CLI Korean box stays aligned (wcwidth)', async () => {
  const card = buildCard(await parse(session(read('/p/a.ts'), read('/p/b.ts'), read('/p/c.ts'), edit('/p/a.ts'))), { lang: 'ko', durationLabel: '22분' });
  const out = renderCli(card, { env: { NO_COLOR: '1' }, isTTY: true, termWidth: 80 });
  const boxLines = out.split('\n').filter((l) => l.startsWith('│') || l.startsWith('╭') || l.startsWith('╰'));
  for (const l of boxLines) assert.equal(stringWidth(l), 80);
});

test('CLI header grade word follows the card language, not the env', async () => {
  const card = buildCard(await parse(session(editBlockedUnread('/p/a.ts'), read('/p/a.ts'), edit('/p/a.ts'))), { lang: 'ko' });
  const out = renderCli(card, { env: { NO_COLOR: '1', LANG: 'en_US.UTF-8' }, isTTY: true, termWidth: 80 });
  assert.match(out, /주의/);
  assert.equal(/caution/.test(out.split('\n').slice(0, 3).join('')), false);
});

// ── hook serializer ─────────────────────────────────────────────────────────

test('hook output starts with newline, no ANSI, reserves the gutter', async () => {
  const card = buildCard(await parse(session(read('/p/a.ts'), read('/p/b.ts'), read('/p/c.ts'), edit('/p/a.ts'))), { lang: 'en' });
  const out = renderHook(card, { termWidth: 80 });
  assert.equal(out.startsWith('\n'), true);
  assert.equal(out.includes('\x1b['), false);
  for (const line of out.split('\n')) assert.equal(stringWidth(line) <= 75, true);
});

test('hook output is hard-capped at 10k chars', async () => {
  const card = buildCard(await parse(session(read('/p/a.ts'), read('/p/b.ts'), read('/p/c.ts'), edit('/p/a.ts'))), { lang: 'en' });
  card.facts = Array.from({ length: 5000 }, (_, i) => `fact ${i}`);
  const out = renderHook(card, { termWidth: 80 });
  assert.equal(out.length <= HOOK_MAX_CHARS, true);
});

// ── skill serializer ────────────────────────────────────────────────────────

test('skill renders markdown with glyphs and sections', async () => {
  const card = buildCard(await parse(session(read('/p/a.ts'), read('/p/b.ts'), read('/p/c.ts'), edit('/p/a.ts'))), { lang: 'en' });
  const out = renderSkill(card);
  assert.match(out, /\*\*verdicts\*\*|\*\*facts\*\*/);
  assert.equal(out.includes('\x1b['), false);
});

// ── width utilities ─────────────────────────────────────────────────────────

test('stringWidth counts CJK as 2 and ignores ANSI', () => {
  assert.equal(stringWidth('세션'), 4);
  assert.equal(stringWidth('\x1b[32m✓\x1b[0m'), 1);
});

test('middleEllipsis keeps head and tail', () => {
  assert.equal(middleEllipsis('src/deep/nested/parser.ts', 18), 'src/…/parser.ts');
  assert.equal(stringWidth(middleEllipsis('a/b/c/d/e/file.ts', 10)) <= 10, true);
});

test('clampWidth respects a CJK budget', () => {
  assert.equal(stringWidth(clampWidth('세션 누적 열두 턴입니다', 10)) <= 10, true);
});

test('wrapText never exceeds the width budget', () => {
  for (const line of wrapText('the quick brown fox jumps over the lazy dog', 12)) {
    assert.equal(stringWidth(line) <= 12, true);
  }
});
