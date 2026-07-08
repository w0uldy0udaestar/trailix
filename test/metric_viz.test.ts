import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMetric, GAUGE_WIDTH, COUNT_CAP } from '../src/render/metric.ts';
import { parseSessionLines } from '../src/parser.ts';
import { evaluateRule1 } from '../src/rules/rule1.ts';
import { evaluateRule2 } from '../src/rules/rule2.ts';
import { evaluateRule3 } from '../src/rules/rule3.ts';
import { evaluateRule4 } from '../src/rules/rule4.ts';
import { evaluateRule5 } from '../src/rules/rule5.ts';
import { buildCard } from '../src/card.ts';
import { renderCli, renderHook, renderSkill } from '../src/render/index.ts';
import { stringWidth } from '../src/render/width.ts';
import { agent, edit, read, readPartial, session, webFetch } from './helpers/fixture.ts';

const parse = (lines: string[]) => parseSessionLines(lines);

// ── renderMetric (pure) ──────────────────────────────────────────────────────

test('renderMetric gauge: fill is round(value·W), display kept', () => {
  const r = renderMetric({ kind: 'gauge', value: 0.3, display: '3:7' }, 'caution', {});
  assert.equal(r.bar, '███░░░░░░░'); // round(3.0) = 3
  assert.equal(r.value, '3:7');
});

test('renderMetric gauge: clamps out-of-range value', () => {
  assert.equal(renderMetric({ kind: 'gauge', value: 0, display: '' }, 'poor', {}).bar, '░'.repeat(GAUGE_WIDTH));
  assert.equal(renderMetric({ kind: 'gauge', value: 1, display: '' }, 'pass', {}).bar, '█'.repeat(GAUGE_WIDTH));
  assert.equal(renderMetric({ kind: 'gauge', value: 2, display: '' }, 'pass', {}).bar, '█'.repeat(GAUGE_WIDTH));
});

test('renderMetric count: bar length IS n, no value', () => {
  const r = renderMetric({ kind: 'count', n: 3 }, 'pass', {});
  assert.equal(r.bar, '███');
  assert.equal(r.value, '');
});

test('renderMetric count: caps at COUNT_CAP with a trailing +', () => {
  assert.equal(renderMetric({ kind: 'count', n: 12 }, 'pass', {}).bar, '█'.repeat(COUNT_CAP) + '+');
  assert.equal(renderMetric({ kind: 'count', n: COUNT_CAP }, 'pass', {}).bar, '█'.repeat(COUNT_CAP));
});

test('renderMetric ascii: # and -, never block chars', () => {
  assert.equal(renderMetric({ kind: 'gauge', value: 0.3, display: '3:7' }, 'caution', { ascii: true }).bar, '###-------');
  assert.equal(renderMetric({ kind: 'count', n: 3 }, 'pass', { ascii: true }).bar, '###');
});

test('renderMetric color: bar wrapped in ANSI, width ignores it', () => {
  const r = renderMetric({ kind: 'count', n: 2 }, 'pass', { color: true });
  assert.match(r.bar, /\x1b\[32m/); // green = pass
  assert.equal(stringWidth(r.bar), 2);
});

test('renderMetric bars are display-width 1 per cell (alignment safety, no ●)', () => {
  assert.equal(stringWidth(renderMetric({ kind: 'gauge', value: 0.5, display: '' }, 'pass', {}).bar), GAUGE_WIDTH);
  assert.equal(stringWidth(renderMetric({ kind: 'count', n: 4 }, 'pass', {}).bar), 4);
});

test('renderMetric polarity: more waste → shorter efficiency bar', () => {
  // rule5 stores efficiency = 1 − waste; 50% waste → half-full bar
  assert.equal(renderMetric({ kind: 'gauge', value: 0.5, display: '50%' }, 'caution', {}).bar, '█████░░░░░');
});

// ── rule metrics (polarity: higher = better) ─────────────────────────────────

test('rule2 metric: count of unique source domains', async () => {
  const r = evaluateRule2(await parse(session(webFetch('https://a.com/1'), webFetch('https://a.com/2'))));
  assert.deepEqual(r.metric, { kind: 'count', n: 1 });
});

test('rule3 metric: gauge = deep share, display = deep:skim', async () => {
  const r = evaluateRule3(await parse(session(
    read('/p/a.ts'), edit('/p/a.ts'), // 1 deep
    readPartial('/p/b.ts'), edit('/p/b.ts'),
    readPartial('/p/c.ts'), edit('/p/c.ts'),
    readPartial('/p/d.ts'), edit('/p/d.ts'), // 3 skims
  )));
  assert.equal(r.verdict, 'caution');
  assert.ok(r.metric !== undefined && r.metric.kind === 'gauge');
  if (r.metric.kind === 'gauge') {
    assert.equal(r.metric.display, '1:3');
    assert.ok(Math.abs(r.metric.value - 0.25) < 1e-9); // deep 1 / (1+3)
  }
});

test('rule4 metric: count of subagents (colour carries cross-check verdict)', async () => {
  const r = evaluateRule4(await parse(session(agent(), agent())));
  assert.deepEqual(r.metric, { kind: 'count', n: 2 });
});

test('rule5 metric: gauge = efficiency (1 − waste), display is waste %', async () => {
  const big = 'x'.repeat(1000);
  const r = evaluateRule5(await parse(session(read('/p/a.ts', big), read('/p/a.ts', big), read('/p/a.ts', big))));
  assert.equal(r.verdict, 'caution');
  assert.ok(r.metric !== undefined && r.metric.kind === 'gauge');
  if (r.metric.kind === 'gauge') {
    assert.ok(r.metric.value < 0.5); // ~2000/3000 waste → ~33% efficiency
    assert.ok(r.metric.display.endsWith('%'));
  }
});

test('rule1 opts out of visualization (no metric)', async () => {
  const r = evaluateRule1(await parse(session(read('/p/a.ts'), edit('/p/a.ts'))));
  assert.equal(r.metric, undefined);
});

// ── card render integration ──────────────────────────────────────────────────

/** A session that fires rule3 (caution) + rule4 (pass) → mixed metric card. */
function mixedCardStats() {
  return parse(session(
    read('/p/a.ts'), edit('/p/a.ts'),
    readPartial('/p/b.ts'), edit('/p/b.ts'),
    readPartial('/p/c.ts'), edit('/p/c.ts'),
    readPartial('/p/d.ts'), edit('/p/d.ts'),
    agent(), agent(), read('/p/verify.ts'), // 2 subagents then a read → rule4 pass
  ));
}

test('all 3 serializers include the bar', async () => {
  const card = buildCard(await mixedCardStats(), { lang: 'en' });
  assert.ok(renderCli(card, { isTTY: false, termWidth: 120 }).includes('█'));
  assert.ok(renderHook(card, { termWidth: 120 }).includes('█'));
  assert.ok(renderSkill(card).includes('█'));
});

test('metric rows share a bar column (alignment)', async () => {
  const card = buildCard(await mixedCardStats(), { lang: 'en' });
  const out = renderCli(card, { isTTY: false, termWidth: 120 }); // colourless → clean indexOf
  const barLines = out.split('\n').filter((l) => l.includes('█'));
  assert.ok(barLines.length >= 2);
  const cols = barLines.map((l) => stringWidth(l.slice(0, l.indexOf('█'))));
  assert.ok(cols.every((c) => c === cols[0]), `bar columns differ: ${cols.join(',')}`);
});

test('Korean card aligns too (CJK label width honoured)', async () => {
  const card = buildCard(await mixedCardStats(), { lang: 'ko' });
  const out = renderCli(card, { isTTY: false, termWidth: 120 });
  const barLines = out.split('\n').filter((l) => l.includes('█'));
  const cols = barLines.map((l) => stringWidth(l.slice(0, l.indexOf('█'))));
  assert.ok(cols.every((c) => c === cols[0]), `KO bar columns differ: ${cols.join(',')}`);
});

test('no_verdict card carries no bars (regression)', async () => {
  const card = buildCard(await parse(session(read('/p/a.ts'))), { lang: 'en' });
  assert.equal(card.state, 'no_verdict');
  assert.ok(!renderCli(card, { isTTY: false, termWidth: 120 }).includes('█'));
});

test('--ascii card has no block chars anywhere', async () => {
  const card = buildCard(await mixedCardStats(), { lang: 'en' });
  const out = renderCli(card, { isTTY: false, termWidth: 120, ascii: true });
  assert.ok(!out.includes('█') && !out.includes('░'));
  assert.ok(out.includes('#')); // count/gauge fill folded to #
});
