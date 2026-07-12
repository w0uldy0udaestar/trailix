/**
 * Core types for the trailix engine (surface-independent).
 *
 * The session JSONL format is undocumented and may change between Claude Code
 * releases — every field here was verified against real logs (v2.1.119–2.1.195)
 * during the Day 1 spike. Parse leniently; prefer "no verdict" over a wrong one.
 */

/** One tool invocation observed in the session, in logical (issuance) order. */
export interface ToolEvent {
  /** Logical sequence number (tool_use issuance order, not file line order). */
  seq: number;
  /** Tool name as recorded, e.g. "Read", "Edit", "Write", "Bash", "Agent". */
  tool: string;
  /** input.file_path when present (Read/Edit/Write family). */
  filePath?: string;
  /** input.command for Bash (capped — we never keep large payloads). */
  command?: string;
  /** input.limit for Read (partial-read signal for rule ③). */
  readLimit?: number;
  /** input.offset for Read (partial-read signal for rule ③). */
  readOffset?: number;
  /** input.url for WebFetch (source domain for rule ②). */
  url?: string;
  /** Result metadata, joined by tool_use_id even when lines are out of order. */
  result?: ToolResultMeta;
  /** True when this event was caused by trailix itself (excluded from scoring). */
  self: boolean;

  // ── scope-mode extras (populated only when parsing with { scope: true }) ──
  /** Record timestamp (epoch ms) — the map's time axis. */
  ts?: number;
  /** 1-based turn this call was issued in (0 = before the first human input). */
  turnIndex?: number;
  /** WebSearch input.query (capped). */
  query?: string;
  /** Grep/Glob input.pattern (capped). */
  pattern?: string;
  /** Agent/Task input.description (capped). */
  agentDesc?: string;
  /** Agent/Task input.subagent_type. */
  agentType?: string;
  /** Skill input.skill. */
  skillName?: string;
  /** Write: line count of input.content (counted at ingest, content discarded). */
  inputLines?: number;
  /** AskUserQuestion input.questions (question/header/option labels, capped). */
  questions?: QuestionScope[];
  /** tool_use id, kept for subagent tools only — links to .meta.json toolUseId. */
  toolUseId?: string;
  /** TodoWrite: how this call reshaped the list vs the previous one. */
  todoReorg?: { before: number; after: number; removed: number };
}

/** One decision point put to the user (AskUserQuestion, scope mode). */
export interface QuestionScope {
  question: string;
  header?: string;
  options: string[];
}

export interface ToolResultMeta {
  isError: boolean;
  /** Edit rejected by the harness with "File has not been read yet". */
  unreadEditError: boolean;
  /** toolUseResult.type for Write: "create" | "update" (when recorded). */
  writeKind?: 'create' | 'update';
  /** Character length of the textual result content (length only, by design). */
  contentLength: number;

  // ── scope-mode extras (populated only when parsing with { scope: true }) ──
  /** Read result: lines actually returned (toolUseResult.file.numLines). */
  readNumLines?: number;
  /** Read result: total lines in the file (toolUseResult.file.totalLines). */
  readTotalLines?: number;
  /** Lines added, from toolUseResult.structuredPatch (counted, not stored). */
  linesAdded?: number;
  /** Lines removed, from toolUseResult.structuredPatch (counted, not stored). */
  linesRemoved?: number;
  /** AskUserQuestion result excerpt — carries the chosen answers (capped). */
  answerPreview?: string;
}

/** Per-turn aggregates (one human input opens one turn; scope mode only). */
export interface TurnScope {
  /** 1-based; 0 is the synthetic pre-input turn (rare). */
  index: number;
  /** Timestamp of the human input that opened the turn (epoch ms). */
  ts?: number;
  /** First line of the human prompt, capped — the map's turn label. */
  promptPreview: string;
  promptChars: number;
  /** Wall-clock of the turn from the system turn_duration record. */
  durationMs?: number;
  thinkingBlocks: number;
  thinkingChars: number;
  /** Real output tokens (message.usage, deduped by message id). */
  outputTokens: number;
}

/** Session-level extras captured in scope mode. Raw bodies are never kept. */
export interface ScopeExtras {
  turns: TurnScope[];
  /** Session title from the ai-title record. */
  title?: string;
  gitBranch?: string;
  cwd?: string;
  /** Claude Code version string from records. */
  version?: string;
  /** Model id seen on assistant records (last wins). */
  model?: string;
  /** The model's final text message (its own report, capped) — appendix. */
  lastReport?: string;
  /** Real token totals from message.usage, deduped by message id. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}

/** Aggregates for one session file. Raw lines are never retained. */
export interface SessionStats {
  /** Tool events in logical order, self-events excluded (see selfEvents). */
  events: ToolEvent[];
  /** Count of events filtered out as trailix-caused. */
  selfEventCount: number;
  /** True human inputs (not tool_result carriers / notifications / meta). */
  humanInputCount: number;
  /** Subagent (Agent/Task/Workflow) use anywhere in the session. */
  usedSubagents: boolean;
  totalLines: number;
  parsedRecords: number;
  malformedLines: number;
  /** Record `type` values we do not recognize (counted, then passed over). */
  unknownTypeCount: number;
  /** The trailing line failed to parse — file was mid-write; ignored silently. */
  incompleteLastLine: boolean;
  /** unknownTypeCount / parsedRecords; > threshold ⇒ session is unscorable. */
  unknownRatio: number;
  /** Event cap hit — session is unscorable rather than partially scored. */
  eventsTruncated: boolean;
  /** Earliest record timestamp (epoch ms), for session duration. */
  firstTs?: number;
  /** Latest record timestamp (epoch ms), for session duration. */
  lastTs?: number;
  /** Tool calls since the last human input (the just-ended turn). */
  lastTurnToolCount: number;
  /** A subagent was spawned in the just-ended turn. */
  lastTurnUsedSubagents: boolean;
  /** Map extras — present only when parsed with { scope: true }. */
  scope?: ScopeExtras;
}

export type Verdict = 'pass' | 'caution' | 'poor' | 'no_verdict';

/**
 * A visual metric for a rule's first verdict line. Two kinds only, both
 * "higher is better" so a longer/fuller bar ALWAYS reads as good — polarity is
 * unified across rules (rule5 stores efficiency = 1 − waste, never waste).
 *   gauge — a 0..1 fill ratio (rule3 deep-share, rule5 efficiency). `display`
 *           is the language-neutral figure shown after the bar ("5:0", "30%").
 *   count — a bar of n filled cells (rule2 sources, rule4 subagents). The bar
 *           itself is the number, so there is no separate value.
 * rule1 opts out entirely: its evidence is file-path data, not prose, so it
 * stays as text at full width (never clamped behind a bar).
 */
export type Metric =
  | { kind: 'gauge'; value: number; display: string }
  | { kind: 'count'; n: number };

export interface RuleResult {
  ruleId: string;
  verdict: Verdict;
  /** Human-readable evidence lines — a verdict never ships without them. */
  evidence: string[];
  /**
   * Confidence caveats, e.g. untracked Bash/subagent reads. Any annotation
   * caps the verdict at "caution" (honest floor: never "poor" on a guess).
   */
  annotations: string[];
  /** Optional visual metric, bound to the first evidence line by the card. */
  metric?: Metric;
}

export type Lang = 'en' | 'ko';
