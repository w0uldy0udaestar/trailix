import { parseSessionFile } from './parser.ts';
import { buildCard } from './card.ts';
import { renderCli, renderSkill } from './render/index.ts';
import { detectLang } from './messages.ts';
import { listProjectSessions, selectLatestSession, selfSession, type SessionFile } from './session-select.ts';
import type { Lang } from './types.ts';

/**
 * `trailix` CLI. Pure I/O in → string out, so it is testable without a TTY.
 * Read-only and fail-soft: a missing session prints guidance, never an error.
 */

export interface CliIO {
  argv: string[]; // already stripped of node + script path
  env: NodeJS.ProcessEnv;
  cwd: string;
  isTTY: boolean;
  termWidth: number;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
}

const HELP = `trailix — how thorough was your delegated Claude Code work?

usage:
  trailix [last]        grade the most recent session in this project
  trailix list          list recent sessions in this project
  trailix --help        show this help

options:
  --done                exclude the still-running session (grade the one that just ended)
  --ascii               ASCII glyphs and no box (portable output)
  --lang <en|ko>        force card language (default: auto from LANG)
`;

interface ParsedArgs {
  command: 'last' | 'list' | 'help';
  done: boolean;
  ascii: boolean;
  self: boolean;
  format: 'term' | 'md';
  lang?: Lang;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: 'last', done: false, ascii: false, self: false, format: 'term' };
  let sawCommand = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--help' || a === '-h') out.command = 'help';
    else if (a === '--done') out.done = true;
    else if (a === '--ascii') out.ascii = true;
    else if (a === '--self') out.self = true;
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

function noSessionMessage(lang: Lang): string {
  return lang === 'ko'
    ? 'trailix: 이 프로젝트에 아직 세션 기록이 없어요. 작업을 좀 하고 다시 실행해 보세요.'
    : 'trailix: no session history for this project yet. Do some work and re-run.';
}

export async function runCli(io: CliIO, now = Date.now()): Promise<CliResult> {
  const args = parseArgs(io.argv);
  const lang: Lang = args.lang ?? detectLang(io.env);

  if (args.command === 'help') return { exitCode: 0, stdout: HELP };

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
  return { exitCode: 0, stdout: (await renderSession(session, io, args, lang)) + '\n' };
}
