---
name: Rule suggestion
about: Propose something trailix should grade
labels: rule-idea
---

**What should it catch?**
<!-- The thoroughness signal you want graded, in one sentence. -->

**What's the observable evidence in a session log?**
<!-- trailix is rule-based and evidence-backed, so a rule needs a concrete,
     structural signal in the JSONL (tool calls, files, sizes, timing) — not a
     semantic judgment. What would the evidence line say? -->

**When should it stay silent?**
<!-- Every rule must abstain cleanly (no verdict) when it can't be sure, and
     avoid false positives. When would this rule NOT apply? -->
