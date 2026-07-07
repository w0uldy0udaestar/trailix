# Launch copy (drafts) — review before posting

Ready to post — trailix is live: **npm** https://www.npmjs.com/package/trailix ·
**repo** https://github.com/w0uldy0udaestar/trailix. Nothing is posted
automatically; the launch is your call on timing.

---

## Show HN

**URL field:** `https://github.com/w0uldy0udaestar/trailix`

**Title options** (HN rewards plain and specific over clever):

1. `Show HN: Trailix – a thoroughness report card for Claude Code sessions`
2. `Show HN: Grade how thorough your AI coding agent actually was`
3. `Show HN: Trailix – did your AI agent read the files it edited?`

**Body:**

> I do a lot of "delegate a task to Claude Code and wait" coding. It hands back
> a result, but I never knew *how* it got there — did it read the files it
> edited, or edit blind? Did it cross-check sources or lean on one? Did it
> verify what its subagents produced?
>
> Trailix reads your local Claude Code session logs and grades the session: a
> verdict (pass / caution / poor) that's the worst of ≤5 structural rules, each
> with an evidence line. No LLM judging — the rules are deterministic, and any
> rule it can't be sure about says "no verdict" instead of guessing.
>
> It runs three ways: `npx trailix` in your terminal, a `/trailix` skill, and —
> the part I actually use — an automatic card that pops up when a delegation
> turn ends, via the Stop hook. It's a read-only observer: never writes to your
> sessions, never blocks them, never enters the model's context.
>
> Thresholds are calibrated against my full session history (the backtest is in
> the repo) — the goal is zero false positives, because an audit tool that cries
> wolf is worse than none. Node 24+, zero runtime deps, MIT.
>
> `npx trailix demo` shows an example card without needing a session. Feedback
> very welcome, especially on the rules — what would *you* want graded?

Notes: post 8–10am PT on a weekday. Reply to every comment in the first two
hours. Have the repo public + npm live + demo GIF in the README before posting.

---

## r/ClaudeAI

**Title:** `I built a tool that grades how thorough Claude Code was in a session (read-only, open source)`

**Body:**

> You know the feeling of delegating a task, getting a result back, and not
> knowing whether it actually read what it edited or just went for it? I built
> **trailix** to answer that.
>
> When a delegation turn ends, it drops a report card in your session:
>
> ```
> ! caution  some gaps worth a look
>    ✓ every edited file was read first
>    ! only 1 unique source domain — cross-validation is thin
>    ! deep 1 · skim 3 (partial reads before edit)
>    ✓ 3 subagents — results cross-checked
> ```
>
> Every line is evidence from your actual session log — no LLM judging. It's
> read-only (never touches your session data), fail-silent, and local. Install
> the plugin for the automatic card, or just `npx trailix demo` to see one.
>
> It's early and I'd love feedback on the rules.
> Repo: https://github.com/w0uldy0udaestar/trailix · `npx trailix demo`

Notes: r/ClaudeAI likes "read-only / local / open source" up front. Lead with
the card, not the pitch.

---

## Plugin marketplace submission (Claude Code)

The community directory is submit-by-form, not PR:
**https://clau.de/plugin-directory-submission** (sign in with your Claude
account). Everything is ready:

- **Repo URL:** `https://github.com/w0uldy0udaestar/trailix`
- Plugin validated: `.claude-plugin/plugin.json`, `hooks/hooks.json`,
  `.claude/skills/trailix/SKILL.md` all present at the repo root and confirmed
  working (the Stop-hook card was tested with `CLAUDE_PLUGIN_ROOT` set).
- **Category:** developer-tools · **Name:** trailix

This lists the automatic Stop-hook card + `/trailix` skill directly to Claude
Code users — the exact audience.

## One-liner (X / GitHub description / npm)

> Grades the thoroughness of delegated Claude Code work — a rule-based report
> card with evidence lines, right in your terminal. Read-only, local, MIT.
