# Contributing to trailix

Thanks for your interest. trailix is small, dependency-free, and deliberately
conservative — the bar for a change is "does this make the verdict more honest?"

## Ground rules

trailix is a **read-only observer**. Any change must keep all three invariants:

1. Never writes to or modifies session data (`~/.claude/projects`).
2. Never blocks or slows a session — the Stop hook is fail-silent (always
   exits 0; a bug means "no card", never a stuck session).
3. Never pollutes the conversation — the card is display-only.

And two more:

- **Zero runtime dependencies.** The only devDependency is TypeScript.
- **Honest floor over false precision.** A rule that can't be sure returns
  `no_verdict`, never a guess. New rules must abstain cleanly.

## Setup

Requires **Node 24+** (native TypeScript type stripping — no build step).

```bash
npm install        # installs the one devDependency (typescript)
npm test           # node --test over test/**/*.ts
npm run typecheck  # tsc --noEmit
```

## Working on rules

Each rule lives in `src/rules/ruleN.ts` and returns
`{ verdict, evidence, annotations }`. When you change a threshold, it must be
justified against real data:

```bash
node scripts/backtest.ts        # fire rates + FP spot-check over your sessions
```

Record any threshold change in [CHANGELOG.md](./CHANGELOG.md) with the fire-rate
before/after — this is a hard requirement, not a nicety. An audit tool that
cries wolf is worse than none.

## Sharing a session in an issue

Never paste a raw session — it contains your paths and prompts. Sanitize first:

```bash
node scripts/sanitize.ts ~/.claude/projects/<proj>/<id>.jsonl > safe.jsonl
```

It redacts secrets, genericizes home paths, and preserves the structure trailix
scores (verified to keep the grade unchanged). Eyeball it before posting.

## Pull requests

- Add a test for every behavior change (`test/`), including a regression test
  for any bug fix.
- Keep the diff minimal and match the surrounding style.
- CI (Node 24: typecheck + test) must pass.
