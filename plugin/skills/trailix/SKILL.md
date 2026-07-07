---
name: trailix
description: Grade the thoroughness of the current Claude Code session — a report card with a verdict (pass/caution/poor) and evidence lines (read-vs-edited, source cross-checking, delegation review, token waste). Use when the user asks "how thorough was that?", "grade this session", "did you actually read what you edited?", "/trailix", or wants an honest audit of delegated work.
---

# trailix — session thoroughness report card

Run trailix against the **current session** and show the result verbatim.

## What to do

1. Run this command (it reads the live session via `$CLAUDE_CODE_SESSION_ID` and prints a Markdown card):

   ```bash
   npx trailix --self --format md
   ```

   If `npx trailix` is not available, fall back to the plugin's bundled entry:

   ```bash
   node "$CLAUDE_PLUGIN_ROOT/../bin/trailix.ts" --self --format md
   ```

2. Show the command's output **exactly as printed** — it is already a formatted report card (verdict, evidence lines, facts). Do not summarize, reword, or add interpretation unless the user asks a follow-up.

3. If the output says there is no verdict yet or no session history, relay that plainly — trailix abstains on purpose when there isn't enough to grade ("honest floor over false precision").

## What trailix is

A read-only observer. It never modifies session data, never blocks the session, and excludes its own activity from scoring. Every verdict ships with an evidence line — no vibes, no LLM judging. The grade is the worst of ≤5 structural rules, and any rule that can't be judged is shown as "no verdict", not guessed.
