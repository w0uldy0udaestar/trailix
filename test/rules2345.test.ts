import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionLines } from '../src/parser.ts';
import { evaluateRule2 } from '../src/rules/rule2.ts';
import { evaluateRule3 } from '../src/rules/rule3.ts';
import { evaluateRule4 } from '../src/rules/rule4.ts';
import { evaluateRule5 } from '../src/rules/rule5.ts';
import { agent, bash, edit, read, readPartial, session, webFetch, webSearch } from './helpers/fixture.ts';

const parse = (lines: string[]) => parseSessionLines(lines);

// ── rule ② source cross-check ───────────────────────────────────────────────

test('rule2: no web activity → no verdict', async () => {
  const r = evaluateRule2(await parse(session(read('/p/a.ts'))));
  assert.equal(r.verdict, 'no_verdict');
});

test('rule2: one domain across many fetches → caution (thin)', async () => {
  const r = evaluateRule2(await parse(session(
    webFetch('https://arxiv.org/abs/1'), webFetch('https://arxiv.org/abs/2'),
  )));
  assert.equal(r.verdict, 'caution');
  assert.match(r.evidence[0] ?? '', /1 unique source domain/);
});

test('rule2: search-only (no fetches) → no verdict (domains unavailable, not "0 sources")', async () => {
  const r = evaluateRule2(await parse(session(webSearch(), webSearch())));
  assert.equal(r.verdict, 'no_verdict');
});

test('rule2: a single incidental web action → no verdict (not a research turn)', async () => {
  const r = evaluateRule2(await parse(session(read('/p/a.ts'), webSearch())));
  assert.equal(r.verdict, 'no_verdict');
});

test('rule2: two distinct domains → pass', async () => {
  const r = evaluateRule2(await parse(session(
    webFetch('https://arxiv.org/x'), webFetch('https://github.com/y'),
  )));
  assert.equal(r.verdict, 'pass');
});

test('rule2: www. is stripped so it does not inflate domain count', async () => {
  const r = evaluateRule2(await parse(session(
    webFetch('https://www.example.com/a'), webFetch('https://example.com/b'),
  )));
  assert.equal(r.verdict, 'caution'); // both are example.com → 1 domain
});

// ── rule ③ deep vs skim ─────────────────────────────────────────────────────

test('rule3: fewer than 3 reads → no verdict', async () => {
  const r = evaluateRule3(await parse(session(read('/p/a.ts'), edit('/p/a.ts'))));
  assert.equal(r.verdict, 'no_verdict');
});

test('rule3: mostly skims before edits → caution', async () => {
  const r = evaluateRule3(await parse(session(
    readPartial('/p/a.ts'), edit('/p/a.ts'),
    readPartial('/p/b.ts'), edit('/p/b.ts'),
    readPartial('/p/c.ts'), edit('/p/c.ts'),
  )));
  assert.equal(r.verdict, 'caution');
  assert.match(r.evidence[0] ?? '', /skim 3/);
});

test('rule3: full reads before edits → pass', async () => {
  const r = evaluateRule3(await parse(session(
    read('/p/a.ts'), edit('/p/a.ts'),
    read('/p/b.ts'), edit('/p/b.ts'),
    read('/p/c.ts'), edit('/p/c.ts'),
  )));
  assert.equal(r.verdict, 'pass');
});

test('rule3: partial read that is never edited is not a skim', async () => {
  const r = evaluateRule3(await parse(session(
    readPartial('/p/a.ts'), readPartial('/p/b.ts'), readPartial('/p/c.ts'),
    read('/p/d.ts'), edit('/p/d.ts'),
  )));
  assert.equal(r.verdict, 'pass'); // only d.ts is read-then-edited, read fully
});

test('rule3: a revisited (paginated) file counts as deep, not skim', async () => {
  const r = evaluateRule3(await parse(session(
    readPartial('/p/a.ts', { offset: 0 }), readPartial('/p/a.ts', { offset: 40 }), edit('/p/a.ts'),
    read('/p/b.ts'), edit('/p/b.ts'),
    read('/p/c.ts'), edit('/p/c.ts'),
  )));
  assert.equal(r.verdict, 'pass');
});

// ── rule ④ post-delegation cross-check ──────────────────────────────────────

test('rule4: one subagent → no verdict', async () => {
  const r = evaluateRule4(await parse(session(agent())));
  assert.equal(r.verdict, 'no_verdict');
});

test('rule4: two subagents, no follow-up → caution', async () => {
  const r = evaluateRule4(await parse(session(agent('a'), agent('b'))));
  assert.equal(r.verdict, 'caution');
  assert.match(r.evidence[0] ?? '', /2 subagents/);
});

test('rule4: two subagents then a read/test → pass (cross-checked)', async () => {
  const r = evaluateRule4(await parse(session(agent('a'), agent('b'), read('/p/out.md'))));
  assert.equal(r.verdict, 'pass');
});

test('rule4: activity BEFORE the last delegation does not count as cross-check', async () => {
  const r = evaluateRule4(await parse(session(agent('a'), read('/p/x.md'), agent('b'))));
  assert.equal(r.verdict, 'caution');
});

// ── rule ⑤ repeat-read waste ────────────────────────────────────────────────

test('rule5: no tool output measured → no verdict', async () => {
  const stats = await parse(session(agent()));
  const r = evaluateRule5(stats);
  assert.equal(r.verdict, 'no_verdict');
});

test('rule5: same file re-read 3x dominating output → caution', async () => {
  const big = 'x'.repeat(4000);
  const r = evaluateRule5(await parse(session(
    read('/p/a.ts', big), read('/p/a.ts', big), read('/p/a.ts', big),
    read('/p/b.ts', 'y'.repeat(100)),
  )));
  assert.equal(r.verdict, 'caution');
  assert.match(r.evidence[0] ?? '', /repeat reads are \d+% of tool output/);
});

test('rule5: file re-read only twice (under the 3x threshold) → pass', async () => {
  const r = evaluateRule5(await parse(session(
    read('/p/a.ts', 'x'.repeat(100)), read('/p/a.ts', 'x'.repeat(100)),
  )));
  assert.equal(r.verdict, 'pass');
});

test('rule5: no file read more than once → no verdict (nothing to assess)', async () => {
  const r = evaluateRule5(await parse(session(
    read('/p/a.ts', 'x'.repeat(100)), read('/p/b.ts', 'y'.repeat(100)),
  )));
  assert.equal(r.verdict, 'no_verdict');
});
