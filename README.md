# trailix

[![CI](https://github.com/w0uldy0udaestar/trailix/actions/workflows/ci.yml/badge.svg)](https://github.com/w0uldy0udaestar/trailix/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/trailix)](https://www.npmjs.com/package/trailix)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**How thorough was your AI agent, really?**

You delegate a task to Claude Code, it works for twenty minutes, and hands back
a result. But *how* did it get there? Did it read the files it edited? Did it
cross-check its sources, or lean on one? Did it verify what its subagents
produced — or just trust them? trailix answers that, as a report card, right in
your terminal.

<p align="center">
  <img src="./docs/demo-card.svg" alt="trailix example card: a 'caution' verdict — every edited file was read first (pass), only 1 unique source domain so cross-validation is thin (caution), deep 1 skim 3 (caution), 3 subagents results cross-checked (pass), plus a facts line." width="729">
</p>

<p align="center"><sub><code>npx trailix demo</code> prints this card — no session needed.</sub></p>

Every verdict ships with an evidence line — no vibes, no LLM judging. The grade
is the **worst of ≤5 structural rules**, and any rule that can't be judged is
shown as `◌ no verdict`, never guessed.

## Try it

```bash
npx trailix demo      # show an example card (no session needed)
npx trailix           # grade the most recent session in this project
npx trailix --done    # grade the session that just ended (from a new terminal)
npx trailix list      # list recent sessions
npx trailix --ascii   # portable ASCII output (no box, ASCII glyphs)
npx trailix --lang ko # 한국어 카드
```

Requires **Node 24+**. Nothing to configure — trailix reads your local Claude
Code session logs directly.

## The automatic report card

Install the Claude Code plugin and trailix posts a card **automatically** when a
delegation turn ends (a turn that used a subagent or made ≥10 tool calls) — no
command needed. It also adds the `/trailix` skill to grade the current session
on demand.

The card appears through the Stop hook's `systemMessage`: it's shown to you, and
never enters the model's context — trailix watches, it doesn't participate.

## What it checks (v1)

| Rule | Flags when… |
|---|---|
| **blind edits** | files were edited without being read first (or repeated blind-edit attempts the harness had to block) |
| **source cross-check** | a research turn leaned on too few distinct sources |
| **read depth** | files were skimmed (a partial read) right before being edited |
| **delegation review** | subagents were spawned but their output was never verified |
| **repeat reads** | the same file was re-read enough times to waste real tokens |

Thresholds are calibrated against real session history and recorded in the
[CHANGELOG](./CHANGELOG.md) — the goal is **zero false positives**: an audit tool
that cries wolf is worse than none.

## Principles

trailix is a **read-only observer**. It follows three invariants:

1. **Never modifies your session data** — it only reads `~/.claude/projects`.
2. **Never blocks or slows a session** — the hook is fail-silent (always exits
   0; a bug means "no card", never a stuck session).
3. **Never pollutes the conversation** — the card is display-only, and trailix
   excludes its own activity from scoring.

Local only. Zero runtime dependencies. Nothing leaves your machine.

## FAQ

**Does it send my code or sessions anywhere?**
No. trailix reads your local session logs and prints to your terminal. There is
no network call, no telemetry, no account. (To share a session in a bug report,
`node scripts/sanitize.ts` redacts secrets and paths first.)

**Won't a rule-based grader produce false positives?**
That's the failure mode it's designed against. Every threshold is calibrated
against real session history (see the [CHANGELOG](./CHANGELOG.md) and
`scripts/backtest.ts`), a rule that can't be sure returns `no verdict` instead
of guessing, and anything uncertain is capped at `caution` — never `poor` on a
hunch. The flagship rule was retuned when the backtest showed it firing on 61%
of sessions; it now fires on ~13%, all genuine.

**Why rules instead of asking an LLM to judge the session?**
Because you can't audit an audit you can't reproduce. Rules are deterministic,
every verdict cites the exact evidence from your log, there's no token cost, and
the result is the same every run. An LLM judge would be a vibe with extra steps.

## Status

**v0.1.0 — first release, live on npm.** Engine, CLI, Stop hook and skill are
implemented and tested (110+ tests, CI green), with thresholds calibrated
against a full-history backtest. Early days — feedback on the rules is very
welcome (see the rule-suggestion issue template).

## License

[MIT](./LICENSE)
