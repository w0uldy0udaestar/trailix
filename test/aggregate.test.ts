import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../src/aggregate.ts';
import type { RuleResult } from '../src/types.ts';

const rr = (ruleId: string, verdict: RuleResult['verdict'], annotations: string[] = []): RuleResult => ({
  ruleId, verdict, evidence: verdict === 'no_verdict' ? [] : ['e'], annotations,
});

test('worst-of picks the harshest scored verdict', () => {
  const a = aggregate([rr('rule1', 'pass'), rr('rule2', 'caution'), rr('rule3', 'pass')]);
  assert.equal(a.overall, 'caution');
});

test('poor beats caution', () => {
  const a = aggregate([rr('rule1', 'poor'), rr('rule2', 'caution')]);
  assert.equal(a.overall, 'poor');
});

test('no_verdict rules are excluded, not penalised', () => {
  const a = aggregate([rr('rule1', 'pass'), rr('rule2', 'no_verdict'), rr('rule3', 'no_verdict')]);
  assert.equal(a.overall, 'pass');
  assert.equal(a.scored.length, 1);
  assert.equal(a.noVerdict.length, 2);
});

test('all no_verdict → overall no_verdict', () => {
  const a = aggregate([rr('rule1', 'no_verdict'), rr('rule2', 'no_verdict')]);
  assert.equal(a.overall, 'no_verdict');
});

test('annotated poor is capped to caution at the aggregate too (defence in depth)', () => {
  const a = aggregate([rr('rule1', 'poor', ['reads via Bash not tracked'])]);
  assert.equal(a.overall, 'caution');
  assert.equal(a.cappedByAnnotation, true);
});
