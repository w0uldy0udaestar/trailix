# trailix

> How thorough was your AI agent, really?

**trailix** grades the thoroughness of delegated Claude Code work — a rule-based report card with evidence lines, rendered entirely inside your terminal and Claude Code session.

```
╭─ trailix · session · 12 turns ── 07-07 · 22m ─╮
│  ! caution  wide sweep, thin cross-checking   │
╰───────────────────────────────────────────────╯
 verdicts
   ✓ 19 sources — 7 papers (4 deep · 3 skimmed) + 12 web
   ! 1 unique source domain — cross-validation is thin
   ! 3 blind-edit attempts — blocked by the harness
 facts
   read 12 · edited 3 · searches ≥7 (est.) · ~84k tok
```

## Status

**Pre-release — under active development.** Design approved, implementation in progress.

- Grade: 3 levels (`✓ pass` / `! caution` / `✗ poor`), worst-of over ≤5 structural rules
- Every verdict ships with an evidence line — no vibes, no LLM judging
- Read-only observer: never writes to, blocks, or pollutes your sessions
- Surfaces: `npx trailix` CLI · `/trailix` skill · automatic Stop-hook report card
- Zero runtime dependencies · local only (no telemetry, nothing leaves your machine)

## License

[MIT](./LICENSE)
