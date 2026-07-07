---
name: Bug report
about: A wrong verdict, a crash, or unexpected output
labels: bug
---

**What happened**
<!-- What did trailix show, and what did you expect? -->

**Session (sanitized)**
<!-- NEVER paste a raw session — it has your paths and prompts. Sanitize first:
     node scripts/sanitize.ts ~/.claude/projects/<proj>/<id>.jsonl > safe.jsonl
     It redacts secrets/paths and keeps the grade unchanged. Eyeball it, then
     attach safe.jsonl or paste the relevant lines. -->

**Environment**
- trailix version: <!-- npx trailix --help header, or the npm version -->
- Node version: <!-- node -v (must be 24+) -->
- OS:

**If it's a wrong verdict:** which rule, and why the transcript shows it should
have been graded differently.
