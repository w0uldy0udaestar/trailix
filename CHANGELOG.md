# Changelog

All notable changes to trailix. Threshold changes from backtest calibration are
recorded here (design requirement: "조정 이력은 CHANGELOG에 남긴다").

## [0.3.0] — 2026-07-12

### Added
- **The session map (`trailix map [--open]`)** — trailix's centre of gravity
  moves from "verdict card" to "see the whole scope of the work at a glance".
  One command builds a self-contained HTML page (zero external resources,
  readable without JavaScript, printable) into `~/.cache/trailix/maps/`:
  - a one-line summary and three evidence cards (research / decisions / work),
  - the **trail ribbon**: real-timestamp timeline with idle-gap compression
    ("≈ N분 대기" hatched cuts), per-turn hairlines, activity colouring
    (research/decide/edit/run), decision markers that are never dropped, a
    delegation track, and a JS-free turn list underneath,
  - research detail (per-file read depth from `numLines/totalLines` —
    deep ≥70%, skim <30%, else partial; web search queries verbatim; domains),
  - **decisions verbatim and never truncated** — every AskUserQuestion with all
    options and the user's choice, plan approvals, and "(est.)" self-decisions
    detected from todo reshuffles (≥2 items replaced),
  - work detail (per-file +added/−removed from `structuredPatch`, new-file
    badges, command classification test/build/inspect/other),
  - subagent summaries parsed from `subagents/**/agent-*.jsonl` (+ workflow
    fleets grouped per run), the existing 5-rule scorecard, and an appendix
    with the AI's own final report verbatim next to the measured facts.
- **Scope-mode parser** (`parseSessionFile(path, { scope: true })`) — opt-in
  collection of timestamps, turn boundaries + `turn_duration`, real token
  usage (deduped by message id — usage repeats across split records), thinking
  volume, search queries, question/answer excerpts and patch line counts. The
  default card path is unchanged (same aggregates-only memory profile).
- CLI/hook/skill wiring: `trailix map --self/--done/--open/--lang`, a map hint
  line on the card surfaces, and a map workflow in the `/trailix` skill.

### Changed
- Delegation spawn counts exclude harness-rejected calls (validation errors).
- plugin.json version synced with the package (was stuck at 0.1.0).

## [0.2.0] — 2026-07-08

### Added
- **Verdict-line visualization.** Each scored rule's first evidence line now
  carries a unicode metric: a gauge (rule ③ deep-read share, rule ⑤ efficiency)
  or a count bar (rule ② source domains, rule ④ subagents). Polarity is unified
  so a fuller/longer bar always means "better" — rule ⑤ stores efficiency
  (1 − waste), not waste. Only `█`/`░` are used (both East-Asian neutral width,
  so the Korean card stays aligned; `●` is ambiguous-width and was avoided).
  Bars render across all three surfaces — CLI colour, colourless Stop-hook, and
  the `/trailix` skill markdown as inline-code — with an `--ascii` fallback and
  CJK-aware column alignment. Rule ① opts out: its evidence is file-path data,
  kept at full width.

### Changed
- Tightened metric-row spacing and trimmed rule ②/⑤ evidence so verdict lines
  never clamp on an 80-column Stop-hook surface (verified with all rules firing).

## [0.1.0] — 2026-07-08

First public release. Grades delegated Claude Code work — CLI, automatic
Stop-hook card, and `/trailix` skill — from a rule-based engine with evidence
lines, thresholds calibrated against real session history.

### Calibrated (full-history backtest gate, T4)

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
