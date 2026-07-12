---
name: trailix
description: See the scope of the current Claude Code session at a glance — a visual session map (research, decisions, file changes on a timeline, as HTML) and a thoroughness report card with a verdict and evidence lines. Use when the user asks "how much did you actually do?", "show me the session map", "how thorough was that?", "grade this session", "/trailix", or wants an honest audit of delegated work.
---

# trailix — session map + thoroughness report card

Run trailix against the **current session** and show the result verbatim.

## What to do

1. Decide which surface the user wants:
   - They ask **how much was done / to see the work / a map or visualization** → the session map (step 2).
   - They ask **how thorough / a grade / an audit** → the report card (step 3).
   - Unclear → do both: card first, then generate the map and give its path.

2. **Session map** (visual HTML, opens in the browser):

   ```bash
   node "$CLAUDE_PLUGIN_ROOT/bin/trailix.ts" map --self --open
   ```

   If that isn't available, fall back to `npx trailix map --self --open`.
   Relay the printed file path so the user can reopen it later. The map shows
   research volume (files read, with depth), every decision point verbatim,
   file changes (+/− lines), commands, subagent activity, and a timeline —
   generated from the local session log by fixed rules.

3. **Report card** (Markdown, inline):

   ```bash
   node "$CLAUDE_PLUGIN_ROOT/bin/trailix.ts" --self --format md
   ```

   If that isn't available, fall back to `npx trailix --self --format md`.

4. Show the card output **exactly as printed** — it is already a formatted report card (verdict, evidence lines, facts). Do not summarize, reword, or add interpretation unless the user asks a follow-up.

5. If the output says there is no verdict yet or no session history, relay that plainly — trailix abstains on purpose when there isn't enough to grade ("honest floor over false precision").

## What trailix is

A read-only observer. It never modifies session data, never blocks the session, and excludes its own activity from scoring. The only files it writes are its own map HTMLs under `~/.cache/trailix/`. Every verdict ships with an evidence line — no vibes, no LLM judging. The grade is the worst of ≤5 structural rules, and any rule that can't be judged is shown as "no verdict", not guessed. The map is counted from the log by fixed rules; estimates are labelled.
