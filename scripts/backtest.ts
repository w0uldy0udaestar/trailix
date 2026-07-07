#!/usr/bin/env node
/**
 * Full-history backtest gate (design Next Steps 5 / T4).
 *
 * Runs the REAL engine (evaluateAll → aggregate → buildCard) over every session
 * under ~/.claude/projects, and reports per-rule fire rates, the overall grade
 * distribution, unscorable/crash counts, parse-time budget compliance, and
 * sample firings for manual FP spot-checking.
 *
 * Read-only. This is the pre-release calibration gate: fire rates that are
 * absurdly high (noisy rule) or ~0 (dead rule) mean thresholds need tuning.
 *
 * Usage: node scripts/backtest.ts [--examples N]
 */
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseSessionFile, isScorable } from '../src/parser.ts';
import { evaluateAll } from '../src/rules/index.ts';
import { aggregate } from '../src/aggregate.ts';
import { buildCard } from '../src/card.ts';
import type { RuleResult, Verdict } from '../src/types.ts';

const EXAMPLES = (() => {
  const i = process.argv.indexOf('--examples');
  return i >= 0 ? Number(process.argv[i + 1]) : 4;
})();

const RULES = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5'] as const;
type RuleId = (typeof RULES)[number];

function allSessionFiles(): string[] {
  const root = join(homedir(), '.claude', 'projects');
  const files: string[] = [];
  for (const d of readdirSync(root)) {
    const dir = join(root, d);
    try {
      for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) files.push(join(dir, f));
    } catch {
      /* skip */
    }
  }
  return files;
}

interface RuleStat {
  pass: number;
  caution: number;
  poor: number;
  no_verdict: number;
  annotated: number;
  examples: Array<{ file: string; verdict: Verdict; evidence: string[] }>;
}

const emptyStat = (): RuleStat => ({ pass: 0, caution: 0, poor: 0, no_verdict: 0, annotated: 0, examples: [] });

async function main(): Promise<void> {
  const files = allSessionFiles();
  const ruleStats: Record<RuleId, RuleStat> = {
    rule1: emptyStat(), rule2: emptyStat(), rule3: emptyStat(), rule4: emptyStat(), rule5: emptyStat(),
  };
  const overall: Record<Verdict, number> = { pass: 0, caution: 0, poor: 0, no_verdict: 0 };
  const cardState: Record<string, number> = {};
  let scanned = 0, crashed = 0, unscorable = 0, edited = 0, biggestMs = 0, biggestFile = '';
  const times: number[] = [];

  for (const file of files) {
    let sizeMB = 0;
    try {
      sizeMB = statSync(file).size / 1e6;
    } catch {
      /* ignore */
    }
    try {
      const t0 = performance.now();
      const stats = await parseSessionFile(file);
      const rules = evaluateAll(stats, { lang: 'en' });
      const assessment = aggregate(rules);
      const card = buildCard(stats, { lang: 'en' });
      const ms = performance.now() - t0;
      times.push(ms);
      if (ms > biggestMs) { biggestMs = ms; biggestFile = `${file.split('/').slice(-2).join('/')} (${sizeMB.toFixed(1)}MB)`; }

      scanned++;
      if (!isScorable(stats)) unscorable++;
      overall[assessment.overall]++;
      cardState[card.state] = (cardState[card.state] ?? 0) + 1;
      const anyEdit = rules.find((r) => r.ruleId === 'rule1')?.verdict !== 'no_verdict';
      if (anyEdit) edited++;

      for (const r of rules as RuleResult[]) {
        const st = ruleStats[r.ruleId as RuleId];
        st[r.verdict]++;
        if (r.annotations.length > 0) st.annotated++;
        if ((r.verdict === 'caution' || r.verdict === 'poor') && st.examples.length < EXAMPLES) {
          st.examples.push({ file: file.split('/').slice(-2).join('/'), verdict: r.verdict, evidence: r.evidence });
        }
      }
    } catch (e) {
      crashed++;
      console.error('CRASH', file, (e as Error).message);
    }
  }

  times.sort((a, b) => a - b);
  const pct = (p: number): number => times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? 0;

  const pctOf = (n: number, d: number): string => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);

  console.log(`\n═══ trailix backtest — ${scanned} sessions (${crashed} crashed, ${unscorable} unscorable) ═══\n`);
  console.log(`overall grade:  pass ${overall.pass} · caution ${overall.caution} · poor ${overall.poor} · no_verdict ${overall.no_verdict}`);
  console.log(`card states:    ${JSON.stringify(cardState)}`);
  console.log(`edit sessions:  ${edited} (rule① scorable)`);
  console.log(`parse time:     p50 ${pct(0.5).toFixed(0)}ms · p95 ${pct(0.95).toFixed(0)}ms · max ${biggestMs.toFixed(0)}ms  [${biggestFile}]`);
  console.log(`budget check:   p95<=200ms ${pct(0.95) <= 200 ? 'OK' : 'FAIL'} · max<=1000ms ${biggestMs <= 1000 ? 'OK' : 'FAIL'}\n`);

  console.log('per-rule verdicts (fire = caution+poor):');
  for (const id of RULES) {
    const s = ruleStats[id];
    const scored = s.pass + s.caution + s.poor;
    const fire = s.caution + s.poor;
    console.log(
      `  ${id}: fire ${fire} (${pctOf(fire, scored)} of ${scored} scored) · ` +
      `pass ${s.pass} caution ${s.caution} poor ${s.poor} n/v ${s.no_verdict} · annotated ${s.annotated}`,
    );
  }

  console.log('\nsample firings (spot-check for false positives):');
  for (const id of RULES) {
    const s = ruleStats[id];
    if (s.examples.length === 0) continue;
    console.log(`  [${id}]`);
    for (const ex of s.examples) console.log(`    ${ex.verdict}  ${ex.file}\n       ${ex.evidence.join(' | ')}`);
  }
}

await main();
