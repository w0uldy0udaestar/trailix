import { parseSessionFile } from './parser.ts';
import { buildCard } from './card.ts';
import { renderCli, renderSkill } from './render/index.ts';
import { renderMapHtml } from './render/map.ts';
import { buildMapModel, collectSubagentSummaries } from './scope.ts';
import { detectLang, msg } from './messages.ts';
import { demoCard } from './demo.ts';
import { listProjectSessions, selectLatestSession, selfSession, type SessionFile } from './session-select.ts';
import type { Lang } from './types.ts';

/**
 * `trailix` CLI. Pure I/O in → string out, so it is testable without a TTY.
 * Read-only and fail-soft: a missing session prints guidance, never an error.
 * Side-effects (map file write, browser open) are injected by the bin wrapper
 * so runCli itself stays a pure function.
 */

export interface CliIO {
  argv: string[]; // already stripped of node + script path
  env: NodeJS.ProcessEnv;
  cwd: string;
  isTTY: boolean;
  termWidth: number;
  /** Injected by bin: write the map HTML. Absent (tests/pipes) → stdout. */
  writeFile?: (path: string, content: string) => void;
  /** Injected by bin: open a file in the platform browser (fail-soft). */
  openPath?: (path: string) => void;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
}

const HELP = `trailix — how thorough was your delegated Claude Code work?

usage:
  trailix [last]        grade the most recent session in this project
  trailix map           build the session map (self-contained HTML, at a glance)
  trailix list          list recent sessions in this project
  trailix demo          show an example card (no session needed)
  trailix --help        show this help

options:
  --done                exclude the still-running session (grade the one that just ended)
  --open                with map: open the HTML in your browser
  --ascii               ASCII glyphs and no box (portable output)
  --lang <en|ko>        force card language (default: auto from LANG)
`;

interface ParsedArgs {
  command: 'last' | 'list' | 'help' | 'demo' | 'map';
  done: boolean;
  ascii: boolean;
  self: boolean;
  open: boolean;
  format: 'term' | 'md';
  lang?: Lang;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: 'last', done: false, ascii: false, self: false, open: false, format: 'term' };
  let sawCommand = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--help' || a === '-h') out.command = 'help';
    else if (a === '--done') out.done = true;
    else if (a === '--ascii') out.ascii = true;
    else if (a === '--self') out.self = true;
    else if (a === '--open') out.open = true;
    else if (a === '--format' || a === '--format=md' || a === '--format=term') {
      const v = a.includes('=') ? a.slice('--format='.length) : argv[++i];
      if (v === 'md' || v === 'term') out.format = v;
    } else if (a === '--md') out.format = 'md';
    else if (a === '--lang') {
      const v = argv[++i];
      if (v === 'en' || v === 'ko') out.lang = v;
    } else if (a.startsWith('--lang=')) {
      const v = a.slice('--lang='.length);
      if (v === 'en' || v === 'ko') out.lang = v;
    } else if (!a.startsWith('-') && !sawCommand) {
      sawCommand = true;
      if (a === 'list') out.command = 'list';
      else if (a === 'last') out.command = 'last';
      else if (a === 'help') out.command = 'help';
      else if (a === 'demo') out.command = 'demo';
      else if (a === 'map') out.command = 'map';
    }
  }
  return out;
}

function relTime(mtimeMs: number, now: number): string {
  const s = Math.max(0, Math.round((now - mtimeMs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

async function renderSession(file: SessionFile, io: CliIO, args: ParsedArgs, lang: Lang): Promise<string> {
  const stats = await parseSessionFile(file.path);
  const card = buildCard(stats, { lang });
  if (args.format === 'md') return renderSkill(card);
  return renderCli(card, { env: io.env, isTTY: io.isTTY, termWidth: io.termWidth, ascii: args.ascii });
}

/** `trailix map`: build the session-map HTML into ~/.cache/trailix/maps/. */
async function runMap(file: SessionFile, io: CliIO, args: ParsedArgs, lang: Lang): Promise<CliResult> {
  const stats = await parseSessionFile(file.path, { scope: true });
  const subagents = await collectSubagentSummaries(file.path);
  const model = buildMapModel(stats, { lang, sessionId: file.sessionId, sourcePath: file.path, home: io.env['HOME'], subagents });
  const html = renderMapHtml(model);

  if (io.writeFile === undefined) return { exitCode: 0, stdout: html };

  const cacheRoot = io.env['XDG_CACHE_HOME'] !== undefined && io.env['XDG_CACHE_HOME'] !== ''
    ? io.env['XDG_CACHE_HOME']
    : `${io.env['HOME'] ?? '~'}/.cache`;
  const outPath = `${cacheRoot}/trailix/maps/${file.sessionId}.html`;
  io.writeFile(outPath, html);

  const lines = [msg('map.cli.saved', { path: outPath }, lang)];
  if (args.open && io.openPath !== undefined) {
    io.openPath(outPath);
    lines.push(msg('map.cli.opening', {}, lang));
  }
  return { exitCode: 0, stdout: lines.join('\n') + '\n' };
}

function noSessionMessage(lang: Lang): string {
  return lang === 'ko'
    ? 'trailix: 이 프로젝트에 아직 세션 기록이 없어요. 작업을 좀 하고 다시 실행해 보세요.'
    : 'trailix: no session history for this project yet. Do some work and re-run.';
}

export async function runCli(io: CliIO, now = Date.now()): Promise<CliResult> {
  const args = parseArgs(io.argv);
  const lang: Lang = args.lang ?? detectLang(io.env);

  if (args.command === 'help') return { exitCode: 0, stdout: HELP };

  if (args.command === 'demo') {
    const card = await demoCard(lang);
    return { exitCode: 0, stdout: renderCli(card, { env: io.env, isTTY: io.isTTY, termWidth: io.termWidth, ascii: args.ascii }) + '\n' };
  }

  if (args.command === 'list') {
    const sessions = listProjectSessions({ cwd: io.cwd, home: io.env['HOME'] });
    if (sessions.length === 0) return { exitCode: 0, stdout: noSessionMessage(lang) + '\n' };
    const rows = sessions
      .slice(0, 10)
      .map((s) => `  ${s.sessionId.slice(0, 8)}  ${relTime(s.mtimeMs, now)}`)
      .join('\n');
    return { exitCode: 0, stdout: `${lang === 'ko' ? '최근 세션' : 'recent sessions'}:\n${rows}\n` };
  }

  // --self (the /trailix skill's path): grade the running session via
  // $CLAUDE_CODE_SESSION_ID, degrading to the newest session if unavailable.
  const session = args.self
    ? selfSession(io.env, { cwd: io.cwd, home: io.env['HOME'] }) ??
      selectLatestSession({ cwd: io.cwd, home: io.env['HOME'] })
    : selectLatestSession({ cwd: io.cwd, home: io.env['HOME'], excludeRunning: args.done });
  if (session === undefined) return { exitCode: 0, stdout: noSessionMessage(lang) + '\n' };
  try {
    if (args.command === 'map') return await runMap(session, io, args, lang);
    const card = await renderSession(session, io, args, lang);
    // discoverability: the card points at its own map (term surface only)
    const hint = args.format === 'term' ? `\n   ${msg('map.hint', {}, lang)}` : '';
    return { exitCode: 0, stdout: card + hint + '\n' };
  } catch {
    // session file vanished or became unreadable between selection and parse —
    // degrade to guidance, never a stack trace (cli.ts fail-soft contract)
    return { exitCode: 0, stdout: noSessionMessage(lang) + '\n' };
  }
}
