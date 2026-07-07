# Changelog

All notable changes to trailix. Threshold changes from backtest calibration are
recorded here (design requirement: "조정 이력은 CHANGELOG에 남긴다").

## [Unreleased]

### Calibrated — 2026-07-08 (full-history backtest gate, T4)

Ran the engine over the full local session corpus (88 sessions) to measure
per-rule fire rates and spot-check false positives before release.

- **Rule ①-a (blind-edit attempts): caution threshold 1 → 3.**
  At ≥1, the rule fired on 61% of edit sessions — almost all were a single
  blocked-then-corrected edit (1 attempt: 25 sessions, 2: 7), i.e. normal
  self-correction, not a thoroughness problem. Firing on the majority made
  "caution" meaningless. At ≥3 it fires on ~13% and flags genuine blind-edit
  thrashing. Matches the design's own "시도 3회" evidence example.

Post-calibration corpus distribution: pass 58 · caution 11 · poor 0 ·
no_verdict 19. Per-rule fire rates: ① 13.4%, ② 0% (rarely applicable, 4
scored), ③ 1.6%, ④ 3.0%, ⑤ 0%. Sampled firings of ①/③/④ were all confirmed
true positives against the transcripts.

Performance across the corpus: parse p95 41ms, max 49ms (9.3 MB file) — inside
the ≤200ms non-delegation and ≤1s card budgets, so no incremental-parse cache
is needed for v1. Zero crashes, zero unscorable sessions.

Known-conservative: rule ⑤ (repeat-read waste) fired on 0 sessions — either
genuinely rare here or the "≥25% of all tool output" bar is strict; kept as-is
for v1 (0 false positives; "honest floor over false precision"). Revisit with
more data as a v1.1 calibration candidate.

### Added
- Streaming session parser; rules ①–⑤; worst-of aggregation; fact lines.
- Card model + three serializers (CLI, Stop-hook, /trailix skill markdown).
- CLI (`last`/`list`/`--done`/`--ascii`/`--lang`/`--self`/`--format`), fail-
  silent Stop hook, plugin manifest.
