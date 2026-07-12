import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Lang, ScopeExtras, SessionStats, ToolEvent, TurnScope, Verdict } from './types.ts';
import { parseSessionFile } from './parser.ts';
import { buildCard, type Card } from './card.ts';
import { evaluateAll } from './rules/index.ts';
import { aggregate } from './aggregate.ts';

/**
 * Map model — everything the "session map" HTML needs, assembled from a
 * scope-mode parse. Same honesty contract as the card engine: rule-based
 * counts only, estimates labelled by the renderer, missing data stays
 * missing (undefined), never guessed. All strings here are raw session
 * data; localisation happens in the renderer.
 */

export type ActivityCat = 'research' | 'decide' | 'work' | 'exec' | 'delegate' | 'other';

/** Read-only Bash commands — counted as research, listed as 조회/inspect. */
const CMD_INSPECT = /^\s*(?:cat|head|tail|less|wc|stat|file|ls|tree|pwd|which|grep|rg|ag|ack|find|fd|ripgrep|git\s+(?:status|log|diff|show|branch)|ps|df|du|env|printenv)\b/;
const CMD_SEARCH = /^\s*(?:grep|rg|ag|ack|find|fd|ripgrep)\b/;
const CMD_TEST = /^\s*(?:npx\s+)?(?:npm\s+(?:run\s+)?test|yarn\s+test|pnpm\s+test|jest|vitest|pytest|go\s+test|cargo\s+test|node\s+--test)\b/;
const CMD_BUILD = /^\s*(?:npx\s+)?(?:npm\s+run\s+build|yarn\s+build|pnpm\s+build|tsc\b|make\b|cargo\s+build|go\s+build|gradle|mvn|webpack|vite\s+build)/;

const RESEARCH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'ToolSearch']);
const WORK_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write']);
const DELEGATE_TOOLS = new Set(['Agent', 'Task', 'Workflow']);
/** Watching delegated/background work — coloured as delegation, not "other". */
const DELEGATE_WAIT_TOOLS = new Set(['TaskOutput', 'TaskGet', 'TaskList', 'Monitor', 'SendMessage']);
const DECIDE_TOOLS = new Set(['AskUserQuestion', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'EnterPlanMode', 'ExitPlanMode', 'exit_plan_mode']);

/** Activity category for the timeline ribbon and rollups. */
export function categorize(e: ToolEvent): ActivityCat {
  if (RESEARCH_TOOLS.has(e.tool)) return 'research';
  if (WORK_TOOLS.has(e.tool)) return 'work';
  if (DELEGATE_TOOLS.has(e.tool) || DELEGATE_WAIT_TOOLS.has(e.tool)) return 'delegate';
  if (DECIDE_TOOLS.has(e.tool)) return 'decide';
  if (e.tool === 'Bash') {
    if (e.command !== undefined && CMD_INSPECT.test(e.command)) return 'research';
    return 'exec';
  }
  return 'other';
}

export type CommandKind = 'test' | 'build' | 'inspect' | 'other';

export function classifyCommand(command: string): CommandKind {
  if (CMD_TEST.test(command)) return 'test';
  if (CMD_BUILD.test(command)) return 'build';
  if (CMD_INSPECT.test(command)) return 'inspect';
  return 'other';
}

export type ReadDepth = 'deep' | 'partial' | 'skim' | 'unknown';

export interface FileReadScope {
  path: string;
  /** Cumulative lines returned across reads (from toolUseResult.file). */
  linesRead: number;
  totalLines?: number;
  count: number;
  depth: ReadDepth;
}

export interface FileEditScope {
  path: string;
  adds: number;
  dels: number;
  editCount: number;
  created: boolean;
  /** False when no structuredPatch was recorded — adds/dels are then 0-partial. */
  countsKnown: boolean;
}

export interface DecisionScope {
  num: number;
  /** asked = put to the user (◇) · self = decided alone, estimated (◆). */
  kind: 'asked' | 'plan' | 'self';
  ts?: number;
  turnIndex?: number;
  title: string;
  header?: string;
  options: string[];
  /** Chosen option labels, parsed from the result (asked kind only). */
  chosen: string[];
  /** Extra note, e.g. the todo-reshuffle evidence for a self decision. */
  note?: string;
}

export interface SubagentSummary {
  agentType?: string;
  desc?: string;
  spawnDepth?: number;
  toolUseId?: string;
  isWorkflow: boolean;
  /** Workflow run id (wf_…) — workflow agents are grouped under it. */
  groupId?: string;
  startTs?: number;
  endTs?: number;
  toolTotal: number;
  reads: number;
  searches: number;
  edits: number;
  execs: number;
}

export interface TimelinePoint {
  ts: number;
  cat: ActivityCat;
}

/** One row of the turn list — a TurnScope plus its activity rollup. */
export interface TurnRow {
  index: number;
  ts?: number;
  durationMs?: number;
  promptPreview: string;
  toolTotal: number;
  reads: number;
  searches: number;
  edits: number;
  adds: number;
  dels: number;
  execs: number;
  spawns: number;
  /** Decision numbers (DecisionScope.num) raised in this turn. */
  decisionNums: number[];
  outputTokens: number;
  thinkingChars: number;
}

export interface MapModel {
  lang: Lang;
  sessionId: string;
  sourcePath: string;
  meta: {
    title?: string;
    projectLabel?: string;
    gitBranch?: string;
    model?: string;
    startTs?: number;
    endTs?: number;
    durationMin?: number;
    turns: number;
    toolCalls: number;
    records: number;
    version?: string;
  };
  usage?: ScopeExtras['usage'];
  thinking: { blocks: number; chars: number };
  research: {
    files: FileReadScope[];
    totalReads: number;
    deep: number;
    partial: number;
    skim: number;
    unknownDepth: number;
    codeSearches: { label: string; count: number }[];
    webSearches: string[];
    domains: { domain: string; count: number }[];
    webFetches: number;
    bashReads: number;
  };
  decisions: DecisionScope[];
  work: {
    files: FileEditScope[];
    totalAdds: number;
    totalDels: number;
    newFiles: number;
    commands: { test: number; build: number; inspect: number; other: number; total: number };
    commandSamples: string[];
  };
  delegation: {
    agents: SubagentSummary[];
    spawns: number;
    truncated: boolean;
  };
  timeline: {
    points: TimelinePoint[];
    turns: TurnScope[];
    turnRows: TurnRow[];
    hasTs: boolean;
  };
  lastReport?: string;
  card: Card;
  assessment: {
    overall: Verdict;
    scoredCount: number;
    passCount: number;
    noVerdictCount: number;
  };
}

const WEB_SEARCH_MAX = 50;
const COMMAND_SAMPLES_MAX = 20;
const COMMAND_SAMPLE_LEN = 100;
const SUBAGENT_FILES_MAX = 150;

function normalizeDomain(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return undefined;
  }
}

/** Read depth from cumulative coverage; unknown when the log has no line data. */
function depthOf(linesRead: number, totalLines: number | undefined, sawFullRead: boolean): ReadDepth {
  if (totalLines !== undefined && totalLines > 0) {
    const ratio = Math.min(1, linesRead / totalLines);
    if (ratio >= 0.7) return 'deep';
    if (ratio < 0.3) return 'skim';
    return 'partial';
  }
  // No line counts in the log (older versions): a no-limit Read is a full read.
  return sawFullRead ? 'deep' : 'unknown';
}

/** Answers ride in the AskUserQuestion result text as `"question"="answer"`. */
function parseChosen(answerPreview: string | undefined): string[] {
  if (answerPreview === undefined) return [];
  const out: string[] = [];
  const re = /="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answerPreview)) !== null) out.push(m[1] as string);
  return out;
}

/**
 * Scan `<dir>/<sessionId>/subagents/**` for agent transcripts. Read-only and
 * fail-soft: any unreadable file is skipped; more than SUBAGENT_FILES_MAX
 * files reports truncated=true (the map says so instead of pretending).
 */
export async function collectSubagentSummaries(sessionFilePath: string): Promise<{ agents: SubagentSummary[]; truncated: boolean }> {
  const sessionId = basename(sessionFilePath).replace(/\.jsonl$/, '');
  const rootDir = join(sessionFilePath, '..', sessionId, 'subagents');
  const files: { path: string; isWorkflow: boolean; groupId?: string }[] = [];
  const walk = (dir: string, inWorkflows: boolean, groupId: string | undefined, depth: number): void => {
    if (depth > 3 || files.length > SUBAGENT_FILES_MAX) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (files.length > SUBAGENT_FILES_MAX) return;
      const p = join(dir, name);
      if (name.startsWith('agent-') && name.endsWith('.jsonl')) {
        files.push({ path: p, isWorkflow: inWorkflows, groupId });
      } else {
        try {
          if (statSync(p).isDirectory()) {
            if (name === 'workflows') walk(p, true, undefined, depth + 1);
            else walk(p, inWorkflows, inWorkflows ? (groupId ?? name) : groupId, depth + 1);
          }
        } catch {
          /* unreadable entry — skip */
        }
      }
    }
  };
  walk(rootDir, false, undefined, 0);

  const truncated = files.length > SUBAGENT_FILES_MAX;
  const agents: SubagentSummary[] = [];
  for (const f of files.slice(0, SUBAGENT_FILES_MAX)) {
    try {
      const stats = await parseSessionFile(f.path);
      const summary: SubagentSummary = {
        isWorkflow: f.isWorkflow,
        groupId: f.groupId,
        startTs: stats.firstTs,
        endTs: stats.lastTs,
        toolTotal: stats.events.length,
        reads: 0,
        searches: 0,
        edits: 0,
        execs: 0,
      };
      for (const e of stats.events) {
        const cat = categorize(e);
        if (e.tool === 'Grep' || e.tool === 'Glob' || e.tool === 'WebSearch' || (e.tool === 'Bash' && e.command !== undefined && CMD_SEARCH.test(e.command))) summary.searches += 1;
        else if (cat === 'research') summary.reads += 1;
        else if (cat === 'work') summary.edits += 1;
        else if (cat === 'exec') summary.execs += 1;
      }
      try {
        const metaRaw: unknown = JSON.parse(readFileSync(f.path.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
        if (metaRaw !== null && typeof metaRaw === 'object') {
          const meta = metaRaw as { agentType?: unknown; description?: unknown; spawnDepth?: unknown; toolUseId?: unknown };
          if (typeof meta.agentType === 'string') summary.agentType = meta.agentType;
          if (typeof meta.description === 'string') summary.desc = meta.description.slice(0, 200);
          if (typeof meta.spawnDepth === 'number') summary.spawnDepth = meta.spawnDepth;
          if (typeof meta.toolUseId === 'string') summary.toolUseId = meta.toolUseId;
        }
      } catch {
        /* no meta.json — keep transcript-derived summary */
      }
      agents.push(summary);
    } catch {
      /* unreadable transcript — skip */
    }
  }
  agents.sort((a, b) => (a.startTs ?? 0) - (b.startTs ?? 0));
  return { agents, truncated };
}

export interface BuildMapOptions {
  lang: Lang;
  sessionId: string;
  sourcePath: string;
  /** Home dir for ~-shortening display paths (injected, no env read here). */
  home?: string;
  subagents?: { agents: SubagentSummary[]; truncated: boolean };
}

export function buildMapModel(stats: SessionStats, options: BuildMapOptions): MapModel {
  const lang = options.lang;
  const scope = stats.scope;
  const turns: TurnScope[] = scope?.turns ?? [];

  // ── research rollup ──
  const readByFile = new Map<string, { linesRead: number; totalLines?: number; count: number; sawFullRead: boolean }>();
  const searchByLabel = new Map<string, number>();
  const domains = new Map<string, number>();
  const webSearches: string[] = [];
  let webFetches = 0;
  let bashReads = 0;

  // ── work rollup ──
  const editByFile = new Map<string, FileEditScope>();
  const commands = { test: 0, build: 0, inspect: 0, other: 0, total: 0 };
  const commandSamples: string[] = [];
  const seenCommands = new Set<string>();

  // ── decisions + timeline ──
  const decisions: DecisionScope[] = [];
  const points: TimelinePoint[] = [];

  for (const e of stats.events) {
    const cat = categorize(e);
    if (e.ts !== undefined) points.push({ ts: e.ts, cat });

    if (e.tool === 'Read' && e.filePath !== undefined && e.result !== undefined && !e.result.isError) {
      const entry = readByFile.get(e.filePath) ?? { linesRead: 0, count: 0, sawFullRead: false };
      entry.count += 1;
      entry.linesRead += e.result.readNumLines ?? 0;
      if (e.result.readTotalLines !== undefined) {
        entry.totalLines = Math.max(entry.totalLines ?? 0, e.result.readTotalLines);
      }
      if (e.readLimit === undefined && e.readOffset === undefined) entry.sawFullRead = true;
      readByFile.set(e.filePath, entry);
    } else if ((e.tool === 'Grep' || e.tool === 'Glob') && e.pattern !== undefined) {
      const label = `${e.tool} ${e.pattern}`;
      searchByLabel.set(label, (searchByLabel.get(label) ?? 0) + 1);
    } else if (e.tool === 'WebSearch') {
      if (e.query !== undefined && webSearches.length < WEB_SEARCH_MAX) webSearches.push(e.query);
    } else if (e.tool === 'WebFetch') {
      webFetches += 1;
      const domain = e.url !== undefined ? normalizeDomain(e.url) : undefined;
      if (domain !== undefined) domains.set(domain, (domains.get(domain) ?? 0) + 1);
    } else if (e.tool === 'Bash' && e.command !== undefined) {
      const kind = classifyCommand(e.command);
      commands[kind] += 1;
      commands.total += 1;
      if (kind === 'inspect') bashReads += 1;
      const sample = e.command.split('\n')[0]?.slice(0, COMMAND_SAMPLE_LEN) ?? '';
      if (sample !== '' && !seenCommands.has(sample) && commandSamples.length < COMMAND_SAMPLES_MAX) {
        seenCommands.add(sample);
        commandSamples.push(sample);
      }
    } else if (e.filePath !== undefined && e.result !== undefined && !e.result.isError && (WORK_TOOLS.has(e.tool))) {
      const isCreate = e.tool === 'Write' && e.result.writeKind === 'create';
      const isUpdate = e.tool !== 'Write' || e.result.writeKind === 'update' || e.result.writeKind === undefined;
      if (isCreate || isUpdate) {
        const entry = editByFile.get(e.filePath) ?? { path: e.filePath, adds: 0, dels: 0, editCount: 0, created: false, countsKnown: false };
        entry.editCount += 1;
        if (isCreate) entry.created = true;
        if (e.result.linesAdded !== undefined || e.result.linesRemoved !== undefined) {
          entry.adds += e.result.linesAdded ?? 0;
          entry.dels += e.result.linesRemoved ?? 0;
          entry.countsKnown = true;
        } else if (isCreate && e.inputLines !== undefined) {
          entry.adds += e.inputLines;
          entry.countsKnown = true;
        }
        editByFile.set(e.filePath, entry);
      }
    }

    // decision points (order of appearance; numbered later)
    if (e.tool === 'AskUserQuestion' && e.questions !== undefined) {
      const chosen = parseChosen(e.result?.answerPreview);
      e.questions.forEach((q, qi) => {
        decisions.push({
          num: 0,
          kind: 'asked',
          ts: e.ts,
          turnIndex: e.turnIndex,
          title: q.question,
          header: q.header,
          options: q.options,
          chosen: chosen[qi] !== undefined ? [chosen[qi] as string] : [],
        });
      });
    } else if ((e.tool === 'ExitPlanMode' || e.tool === 'exit_plan_mode') && e.result !== undefined && !e.result.isError) {
      decisions.push({
        num: 0,
        kind: 'plan',
        ts: e.ts,
        turnIndex: e.turnIndex,
        title: '',
        options: [],
        chosen: [],
      });
    } else if (e.tool === 'TodoWrite' && e.todoReorg !== undefined && e.todoReorg.removed >= 2) {
      decisions.push({
        num: 0,
        kind: 'self',
        ts: e.ts,
        turnIndex: e.turnIndex,
        title: '',
        options: [],
        chosen: [],
        note: `${e.todoReorg.before}→${e.todoReorg.after}·${e.todoReorg.removed}`,
      });
    }
  }
  decisions.forEach((d, i) => {
    d.num = i + 1;
  });

  // ── per-turn rollup for the turn list (the JS-free layer of the timeline) ──
  const rowByIndex = new Map<number, TurnRow>();
  for (const t of turns) {
    rowByIndex.set(t.index, {
      index: t.index,
      ts: t.ts,
      durationMs: t.durationMs,
      promptPreview: t.promptPreview,
      toolTotal: 0,
      reads: 0,
      searches: 0,
      edits: 0,
      adds: 0,
      dels: 0,
      execs: 0,
      spawns: 0,
      decisionNums: [],
      outputTokens: t.outputTokens,
      thinkingChars: t.thinkingChars,
    });
  }
  for (const e of stats.events) {
    if (e.turnIndex === undefined) continue;
    const row = rowByIndex.get(e.turnIndex);
    if (row === undefined) continue;
    row.toolTotal += 1;
    const cat = categorize(e);
    if (e.tool === 'Grep' || e.tool === 'Glob' || e.tool === 'WebSearch' || (e.tool === 'Bash' && e.command !== undefined && CMD_SEARCH.test(e.command))) row.searches += 1;
    else if (cat === 'research') row.reads += 1;
    else if (cat === 'work') {
      row.edits += 1;
      row.adds += e.result?.linesAdded ?? (e.result?.writeKind === 'create' ? e.inputLines ?? 0 : 0);
      row.dels += e.result?.linesRemoved ?? 0;
    } else if (cat === 'exec') row.execs += 1;
    else if (cat === 'delegate') row.spawns += 1;
  }
  for (const d of decisions) {
    if (d.turnIndex === undefined) continue;
    rowByIndex.get(d.turnIndex)?.decisionNums.push(d.num);
  }
  const turnRows = [...rowByIndex.values()].sort((a, b) => a.index - b.index);

  // display paths: project-relative when under cwd, ~ for the home dir
  const cwd = scope?.cwd;
  const home = options.home;
  const rel = (p: string): string => {
    if (cwd !== undefined && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1);
    if (home !== undefined && home !== '' && p.startsWith(home + '/')) return '~/' + p.slice(home.length + 1);
    return p;
  };

  const files: FileReadScope[] = [...readByFile.entries()]
    .map(([path, r]) => ({
      path: rel(path),
      linesRead: r.linesRead,
      totalLines: r.totalLines,
      count: r.count,
      depth: depthOf(r.linesRead, r.totalLines, r.sawFullRead),
    }))
    .sort((a, b) => b.linesRead - a.linesRead || b.count - a.count);
  let deep = 0;
  let partial = 0;
  let skim = 0;
  let unknownDepth = 0;
  for (const f of files) {
    if (f.depth === 'deep') deep += 1;
    else if (f.depth === 'partial') partial += 1;
    else if (f.depth === 'skim') skim += 1;
    else unknownDepth += 1;
  }

  const editFiles = [...editByFile.values()]
    .map((f) => ({ ...f, path: rel(f.path) }))
    .sort((a, b) => b.adds + b.dels - (a.adds + a.dels) || b.editCount - a.editCount);
  let totalAdds = 0;
  let totalDels = 0;
  let newFiles = 0;
  for (const f of editFiles) {
    totalAdds += f.adds;
    totalDels += f.dels;
    if (f.created) newFiles += 1;
  }

  // a spawn the harness rejected (validation error) never delegated anything
  const spawns = stats.events.filter((e) => DELEGATE_TOOLS.has(e.tool) && e.result?.isError !== true).length;

  // ── verdict layer (existing engine, reused verbatim) ──
  const card = buildCard(stats, { lang });
  const rules = evaluateAll(stats, { lang });
  const assessment = aggregate(rules);
  const passCount = assessment.scored.filter((r) => r.verdict === 'pass').length;

  const durationMin =
    stats.firstTs !== undefined && stats.lastTs !== undefined && stats.lastTs > stats.firstTs
      ? Math.round((stats.lastTs - stats.firstTs) / 60000)
      : undefined;

  const thinking = { blocks: 0, chars: 0 };
  for (const t of turns) {
    thinking.blocks += t.thinkingBlocks;
    thinking.chars += t.thinkingChars;
  }

  return {
    lang,
    sessionId: options.sessionId,
    sourcePath: options.sourcePath,
    meta: {
      title: scope?.title,
      projectLabel: scope?.cwd !== undefined ? basename(scope.cwd) : undefined,
      gitBranch: scope?.gitBranch,
      model: scope?.model,
      startTs: stats.firstTs,
      endTs: stats.lastTs,
      durationMin,
      turns: stats.humanInputCount,
      toolCalls: stats.events.length,
      records: stats.parsedRecords,
      version: scope?.version,
    },
    usage: scope?.usage,
    thinking,
    research: {
      files,
      totalReads: files.reduce((n, f) => n + f.count, 0),
      deep,
      partial,
      skim,
      unknownDepth,
      codeSearches: [...searchByLabel.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      webSearches,
      domains: [...domains.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count),
      webFetches,
      bashReads,
    },
    decisions,
    work: {
      files: editFiles,
      totalAdds,
      totalDels,
      newFiles,
      commands,
      commandSamples,
    },
    delegation: {
      agents: options.subagents?.agents ?? [],
      spawns,
      truncated: options.subagents?.truncated ?? false,
    },
    timeline: {
      points,
      turns,
      turnRows,
      hasTs: points.length > 0,
    },
    lastReport: scope?.lastReport,
    card,
    assessment: {
      overall: assessment.overall,
      scoredCount: assessment.scored.length,
      passCount,
      noVerdictCount: assessment.noVerdict.length,
    },
  };
}
