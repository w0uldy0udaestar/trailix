import type { Lang } from './types.ts';

/**
 * Message catalog (en/ko). All user-facing card strings live here, never in
 * rule/render code (T15). Placeholders use {name} syntax.
 */
const CATALOG = {
  'rule1.attempts': {
    en: '{n} blind-edit attempt(s) — blocked by the harness, tokens spent on retries',
    ko: '읽지 않고 수정 시도 {n}회 — 하네스가 차단, 재시도로 토큰 소모',
  },
  'rule1.unread': {
    en: '{n} edit(s) with no trace of reading — {files}',
    ko: '읽음 흔적 없는 수정 {n}개 — {files}',
  },
  'rule1.unread.estimated': {
    en: '{n} edit(s) with no trace of reading — {files} (est.)',
    ko: '읽음 흔적 없는 수정 {n}개 — {files} (추정)',
  },
  'rule1.pass': {
    en: 'every edited file was read first',
    ko: '수정한 파일 전부 읽은 뒤 수정함',
  },
  'annotation.bashUntracked': {
    en: 'reads via Bash output not tracked',
    ko: 'Bash 출력 경유 읽기 미추적',
  },
  'annotation.subagentUntracked': {
    en: 'reads by subagents not tracked',
    ko: '서브에이전트 읽기 미추적',
  },
  'annotation.priorSessionUnknown': {
    en: 'reads from a prior session not verifiable',
    ko: '이전 열람 미확인',
  },
  'list.more': {
    en: ' and {n} more',
    ko: ' 외 {n}개',
  },
} as const;

export type MessageKey = keyof typeof CATALOG;

export function detectLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const lang = env['TRAILIX_LANG'] ?? env['LANG'] ?? '';
  return lang.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function msg(key: MessageKey, params: Record<string, string | number> = {}, lang: Lang = detectLang()): string {
  let out: string = CATALOG[key][lang];
  for (const [k, v] of Object.entries(params)) {
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

/** "a.ts, b.ts 외 2개" — full width/truncation rules arrive with T14. */
export function fileList(files: string[], lang: Lang, max = 3): string {
  const shown = files.slice(0, max).join(', ');
  const rest = files.length - max;
  return rest > 0 ? shown + msg('list.more', { n: rest }, lang) : shown;
}
