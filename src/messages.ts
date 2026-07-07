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
  'annotation.editUnresolved': {
    en: '{n} edit outcome(s) unrecorded — live/aborted session',
    ko: '편집 결과 미기록 {n}건 — 라이브/중단 세션',
  },
  'list.more': {
    en: ' and {n} more',
    ko: ' 외 {n}개',
  },

  // rule ② source cross-check
  'rule2.thin': {
    en: '{n} unique source domain(s) — cross-validation is thin',
    ko: '고유 소스 도메인 {n}개 — 교차검증 얇음',
  },
  'rule2.pass': {
    en: '{n} unique source domains consulted',
    ko: '고유 소스 도메인 {n}개 — 교차검증됨',
  },
  // rule ③ deep vs skim
  'rule3.skim': {
    en: 'deep {deep} · skim {skim} (partial reads before edit)',
    ko: '정독 {deep} · 훑기 {skim} (수정 전 부분 읽기 기준)',
  },
  'rule3.pass': {
    en: 'deep {deep} · skim {skim} — read before editing',
    ko: '정독 {deep} · 훑기 {skim} — 대체로 정독',
  },
  // rule ④ post-delegation cross-check
  'rule4.unchecked': {
    en: '{n} subagents — results not cross-checked',
    ko: '서브에이전트 {n}개 결과 무대조',
  },
  'rule4.pass': {
    en: '{n} subagents — results cross-checked',
    ko: '서브에이전트 {n}개 — 결과 대조함',
  },
  // rule ⑤ repeat-read waste
  'rule5.waste': {
    en: 'repeat reads are {pct}% of tool output — ~{tok} tok (est.)',
    ko: '반복 읽기가 도구 출력의 {pct}% — 약 {tok} tok 상당(추정)',
  },
  'rule5.pass': {
    en: 'no wasteful repeat reads',
    ko: '반복 읽기 낭비 없음',
  },
  // no-verdict dim notes
  'noverdict.rule': {
    en: '{rule}: no verdict — {reason}',
    ko: '{rule}: 판정 불가 — {reason}',
  },

  // ── card chrome ──────────────────────────────────────────────────────────
  'headline.pass': { en: 'thorough', ko: '충실합니다' },
  'headline.caution': { en: 'some gaps worth a look', ko: '살펴볼 부분이 있어요' },
  'headline.poor': { en: 'shortcuts taken', ko: '건너뛴 흔적이 있어요' },
  'headline.no_verdict': { en: 'not enough to grade yet', ko: '아직 채점할 게 부족해요' },
  'scope.session': { en: 'session · {n} turns', ko: '세션 누적 · {n}턴' },
  'state.no_verdict': {
    en: 'no verdict — not enough delegated activity to grade yet',
    ko: '판정 불가 — 채점할 위임 활동이 아직 부족해요',
  },
  'state.empty.title': {
    en: 'nothing to grade in this session yet',
    ko: '아직 이 세션엔 채점할 작업이 없어요',
  },
  'next.after_work': {
    en: 'run trailix again after some delegated work and a verdict will appear',
    ko: '위임 작업 후 다시 실행하면 판정이 붙습니다',
  },
  'next.list_hint': {
    en: 'tip: `trailix list` shows recent sessions',
    ko: '팁: `trailix list`로 최근 세션을 볼 수 있어요',
  },
  'section.verdicts': { en: 'verdicts', ko: '판정' },
  'section.facts': { en: 'facts', ko: '사실' },
  'section.next': { en: 'next', ko: '다음' },

  // ── fact segments ────────────────────────────────────────────────────────
  'fact.sources': { en: '{n} sources', ko: '소스 {n}' },
  'fact.read': { en: 'read {n}', ko: '읽음 {n}' },
  'fact.edited': { en: 'edited {n}', ko: '수정 {n}' },
  'fact.searched': { en: 'searched {n}', ko: '검색 {n}' },
  'fact.searched.est': { en: 'searched ≥{n} (est.)', ko: '검색 ≥{n}(추정)' },
  'fact.subagents': { en: '{n} subagents', ko: '서브에이전트 {n}' },
  'fact.tokens': { en: '~{n} tok', ko: '약 {n} tok' },
  'fact.duration': { en: '{n}m', ko: '{n}분' },

  // ── rule display names + not-applicable note ─────────────────────────────
  'rulename.rule1': { en: 'blind edits', ko: '읽지 않고 수정' },
  'rulename.rule2': { en: 'cross-check', ko: '소스 교차검증' },
  'rulename.rule3': { en: 'read depth', ko: '정독 vs 훑기' },
  'rulename.rule4': { en: 'delegation review', ko: '위임 후 대조' },
  'rulename.rule5': { en: 'repeat reads', ko: '토큰 반복 낭비' },
  'note.not_applicable': { en: '{rules} — no verdict', ko: '{rules} — 판정 불가' },
  'grade.pass': { en: 'pass', ko: '통과' },
  'grade.caution': { en: 'caution', ko: '주의' },
  'grade.poor': { en: 'poor', ko: '부실' },
  'grade.no_verdict': { en: 'no verdict', ko: '판정 불가' },
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
