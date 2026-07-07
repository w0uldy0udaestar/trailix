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
  /** Result metadata, joined by tool_use_id even when lines are out of order. */
  result?: ToolResultMeta;
  /** True when this event was caused by trailix itself (excluded from scoring). */
  self: boolean;
}

export interface ToolResultMeta {
  isError: boolean;
  /** Edit rejected by the harness with "File has not been read yet". */
  unreadEditError: boolean;
  /** toolUseResult.type for Write: "create" | "update" (when recorded). */
  writeKind?: 'create' | 'update';
  /** Character length of the textual result content (length only, by design). */
  contentLength: number;
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
}

export type Verdict = 'pass' | 'caution' | 'poor' | 'no_verdict';

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
}

export type Lang = 'en' | 'ko';
