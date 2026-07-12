import type { Lang } from './types.ts';
import { middleEllipsis } from './render/width.ts';

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
    en: '{n} source domains — cross-validation is thin',
    ko: '고유 소스 도메인 {n}개 — 교차검증 얇음',
  },
  'rule2.thin.one': {
    en: '1 source domain — cross-validation is thin',
    ko: '고유 소스 도메인 1개 — 교차검증 얇음',
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
    en: 'repeat reads waste ~{tok} tok of output (est.)',
    ko: '반복 읽기로 약 {tok} tok 낭비(추정)',
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
  'scope.session.one': { en: 'session · 1 turn', ko: '세션 누적 · 1턴' },
  'state.no_verdict': {
    en: 'no verdict — nothing yet meets a scoring rule',
    ko: '판정 불가 — 아직 채점 기준을 충족한 활동이 없어요',
  },
  'state.empty.title': {
    en: 'nothing to grade in this session yet',
    ko: '아직 이 세션엔 채점할 작업이 없어요',
  },
  'next.after_work': {
    en: 'do a bit more work (edits, sources, or delegation) and re-run',
    ko: '작업(수정·소스·위임)을 좀 더 하고 다시 실행하면 판정이 붙습니다',
  },
  'next.list_hint': {
    en: 'tip: `trailix list` shows recent sessions',
    ko: '팁: `trailix list`로 최근 세션을 볼 수 있어요',
  },
  'section.verdicts': { en: 'verdicts', ko: '판정' },
  'section.facts': { en: 'facts', ko: '사실' },
  'section.next': { en: 'next', ko: '다음' },

  // ── fact segments (label-first so no English pluralization is needed) ─────
  'fact.sources': { en: 'sources {n}', ko: '소스 {n}' },
  'fact.read': { en: 'read {n}', ko: '읽음 {n}' },
  'fact.edited': { en: 'edited {n}', ko: '수정 {n}' },
  'fact.searched': { en: 'searched {n}', ko: '검색 {n}' },
  'fact.searched.est': { en: 'searched ≥{n} (est.)', ko: '검색 ≥{n}(추정)' },
  'fact.subagents': { en: 'subagents {n}', ko: '서브에이전트 {n}' },
  'fact.tokens': { en: '~{n} tok', ko: '약 {n} tok' },
  'fact.duration': { en: '{n}m', ko: '{n}분' },
  'fact.duration.hour': { en: '~{n}h', ko: '약 {n}시간' },
  'fact.duration.day': { en: '~{n}d', ko: '약 {n}일' },

  // ── rule display names + not-applicable note ─────────────────────────────
  'rulename.rule1': { en: 'blind edits', ko: '읽지 않고 수정' },
  'rulename.rule2': { en: 'cross-check', ko: '소스 교차검증' },
  'rulename.rule3': { en: 'read depth', ko: '정독 vs 훑기' },
  'rulename.rule4': { en: 'delegation review', ko: '위임 후 대조' },
  'rulename.rule5': { en: 'repeat reads', ko: '토큰 반복 낭비' },
  // ── short viz labels (metric column; rule1 opts out of visualization) ──────
  'viz.rule2': { en: 'sources', ko: '교차검증' },
  'viz.rule3': { en: 'reads', ko: '정독' },
  'viz.rule4': { en: 'delegation', ko: '위임' },
  'viz.rule5': { en: 'rereads', ko: '반복' },
  'note.not_applicable': { en: '{rules} — no verdict', ko: '{rules} — 판정 불가' },
  'grade.pass': { en: 'pass', ko: '통과' },
  'grade.caution': { en: 'caution', ko: '주의' },
  'grade.poor': { en: 'poor', ko: '부실' },
  'grade.no_verdict': { en: 'no verdict', ko: '판정 불가' },

  // ── session map (trailix map HTML) ────────────────────────────────────────
  'map.title': { en: 'session map', ko: '작업 지도' },
  'map.untitled': { en: '(untitled session)', ko: '(제목 없는 세션)' },
  'map.chip.rules': { en: '{pass} of {scored} rules passed', ko: '{scored}규칙 중 {pass} 통과' },
  'map.chip.rules.none': { en: 'no rule applied yet', ko: '적용된 판정 규칙 없음' },
  'map.meta.turns': { en: '{n} exchanges', ko: '대화 {n}회 왕복' },
  'map.meta.tools': { en: '{n} tool calls', ko: '도구 {n}회' },
  'map.meta.tokens': { en: '{n} output tokens', ko: '출력 토큰 {n}' },

  // one-line summary fragments (clause assembly in the renderer)
  'map.sum.duration': { en: 'In {dur}, it ', ko: '{dur} 동안 ' },
  'map.sum.nodur': { en: 'This session ', ko: '이 세션에서 ' },
  'map.sum.readWeb': { en: 'read {r} files and searched the web {w} times', ko: '파일 {r}개를 읽고 웹을 {w}번 검색했으며' },
  'map.sum.read': { en: 'read {r} files', ko: '파일 {r}개를 읽었으며' },
  'map.sum.web': { en: 'searched the web {w} times', ko: '웹을 {w}번 검색했으며' },
  'map.sum.noResearch': { en: 'did no reading', ko: '읽기 없이' },
  'map.sum.work': { en: 'changed {e} files (+{a}/−{d} lines)', ko: '파일 {e}개를 고치고(+{a}줄/−{d}줄)' },
  'map.sum.workOnly': { en: 'changed {e} files (+{a}/−{d} lines).', ko: '파일 {e}개를 고쳤습니다(+{a}줄/−{d}줄).' },
  'map.sum.noWork': { en: 'changed no files (research only).', ko: '파일은 고치지 않았습니다 (조사만 수행).' },
  'map.sum.exec': { en: 'and ran {c} commands.', ko: '명령을 {c}번 실행했습니다.' },
  'map.sum.asked': { en: 'At {m} of {t} crossroads it asked you.', ko: '갈림길 {t}번 중 {m}번은 당신에게 물었습니다.' },
  'map.sum.allSelf': { en: 'All {t} crossroads were decided alone (est.).', ko: '갈림길 {t}번을 모두 스스로 결정했습니다 (추정).' },
  'map.sum.delegated': { en: 'Work was delegated to subagents {n} times.', ko: '서브에이전트에게 {n}번 일을 맡겼습니다.' },

  // summary cards
  'map.card.research': { en: 'research', ko: '리서치' },
  'map.card.decide': { en: 'decisions', ko: '판단' },
  'map.card.work': { en: 'work', ko: '작업' },
  'map.card.read.label': { en: 'files read', ko: '파일 읽음' },
  'map.card.read.depth': { en: 'deep {deep} · partial {partial} · skim {skim}', ko: '정독 {deep} · 부분 {partial} · 훑기 {skim}' },
  'map.card.read.nodepth': { en: 'no depth data in this log', ko: '읽은 깊이 기록 없음' },
  'map.card.read.web': { en: 'web {w} searches · {d} domains', ko: '웹 검색 {w}회 · 도메인 {d}곳' },
  'map.card.read.code': { en: 'code searches {s}', ko: '코드 검색 {s}회' },
  'map.card.decide.label': { en: 'crossroads', ko: '갈림길' },
  'map.card.decide.split': { en: 'asked {a} · alone {s} (est.)', ko: '물어봄 {a} · 스스로 {s} (추정)' },
  'map.card.decide.deleg': { en: 'delegations {n}', ko: '위임 {n}건' },
  'map.card.work.label': { en: 'files changed', ko: '파일 수정' },
  'map.card.work.lines': { en: '+{a} / −{d} lines', ko: '+{a}줄 / −{d}줄' },
  'map.card.work.sub': { en: 'new files {n} · commands {c}', ko: '새 파일 {n} · 명령 {c}회' },
  'map.card.detail': { en: 'details ↓', ko: '상세 ↓' },

  // timeline
  'map.timeline.title': { en: 'trail', ko: '발자취' },
  'map.timeline.idleGap': { en: '≈ {n}m idle', ko: '≈ {n}분 대기' },
  'map.timeline.noTs': {
    en: 'no timestamps in this log — shown in event order',
    ko: '시간 기록이 없어 순서 기준으로 표시합니다',
  },
  'map.timeline.events': { en: '{n} calls', ko: '{n}회' },
  'map.cat.research': { en: 'research', ko: '리서치' },
  'map.cat.decide': { en: 'decide', ko: '판단' },
  'map.cat.work': { en: 'edit', ko: '작업' },
  'map.cat.exec': { en: 'run', ko: '실행' },
  'map.cat.delegate': { en: 'delegate', ko: '위임' },
  'map.cat.other': { en: 'other', ko: '기타' },
  'map.legend.idle': { en: 'idle', ko: '대기' },
  'map.legend.asked': { en: '◇ asked you', ko: '◇ 물어봄' },
  'map.legend.self': { en: '◆ decided alone (est.)', ko: '◆ 스스로 결정(추정)' },
  'map.turn.one': { en: 'turn', ko: '턴' },
  'map.turn.reads': { en: 'read {n}', ko: '읽기 {n}' },
  'map.turn.searches': { en: 'search {n}', ko: '검색 {n}' },
  'map.turn.edits': { en: 'edit {n}', ko: '수정 {n}' },
  'map.turn.execs': { en: 'run {n}', ko: '실행 {n}' },
  'map.turn.spawns': { en: 'delegate {n}', ko: '위임 {n}' },
  'map.turn.decisions': { en: 'decision {nums}', ko: '판단 {nums}' },
  'map.turn.gap': { en: '{n}m without input', ko: '{n}분 공백 (사람 부재 구간)' },
  'map.turn.est': { en: '(est.)', ko: '(추정)' },
  'map.turn.fold': { en: '{n} quiet turns', ko: '조용한 턴 {n}개' },

  // research section
  'map.research.title': { en: 'research — what it read and looked up', ko: '리서치 — 무엇을 읽고 찾았나' },
  'map.research.files': { en: 'files read (by volume)', ko: '읽은 파일 (읽은 양 순)' },
  'map.research.none': { en: 'no files were read in this session', ko: '이 세션에서 읽은 파일이 없습니다' },
  'map.depth.deep': { en: 'deep', ko: '정독' },
  'map.depth.partial': { en: 'partial', ko: '부분' },
  'map.depth.skim': { en: 'skim', ko: '훑기' },
  'map.depth.unknown': { en: 'no data', ko: '기록 없음' },
  'map.research.lines': { en: '{read}/{total} lines', ko: '{read}/{total}줄' },
  'map.research.linesOnly': { en: '{read} lines', ko: '{read}줄' },
  'map.research.codeSearches': { en: 'code searches', ko: '코드 검색' },
  'map.research.web': { en: 'web', ko: '웹' },
  'map.research.webNone': { en: 'the web was not used in this session', ko: '이 세션에서는 웹을 사용하지 않았습니다' },
  'map.research.fetches': { en: 'pages fetched {n}', ko: '문서 열람 {n}건' },
  'map.more': { en: 'show {n} more', ko: '외 {n}개 더 보기' },

  // decisions section
  'map.decisions.title': { en: 'decisions — what it chose at the crossroads', ko: '판단 — 갈림길에서 무엇을 정했나' },
  'map.decisions.asked': { en: 'asked you', ko: '물어봄' },
  'map.decisions.plan': { en: 'plan approval', ko: '계획 승인' },
  'map.decisions.self': { en: 'decided alone (est.)', ko: '스스로 결정 (추정)' },
  'map.decisions.chosen': { en: '← your choice', ko: '← 당신의 선택' },
  'map.decisions.none': {
    en: 'no crossroads detected — it proceeded without asking',
    ko: '감지된 갈림길 없음 — 질문 없이 진행했어요',
  },
  'map.decisions.planNote': { en: 'presented a plan and got approval', ko: '계획을 제시하고 승인을 받았습니다' },
  'map.decisions.todoNote': {
    en: 'reshuffled the plan: {before}→{after} items ({removed} replaced)',
    ko: '할 일 재편: {before}→{after}개 (항목 {removed}개 교체)',
  },

  // work section
  'map.work.title': { en: 'work — what it built and changed', ko: '작업 — 무엇을 만들고 고쳤나' },
  'map.work.files': { en: 'file changes (by size)', ko: '파일 변경 (변경량 순)' },
  'map.work.none': { en: 'no files were changed (research only)', ko: '수정한 파일이 없습니다 (조사만 수행)' },
  'map.work.new': { en: 'new file', ko: '새 파일' },
  'map.work.edited': { en: 'edit ×{n}', ko: '수정 ×{n}' },
  'map.work.nocounts': { en: 'no line counts in this log', ko: '줄 수 기록 없음' },
  'map.work.commands': { en: 'commands run: {n}', ko: '실행 명령 {n}회' },
  'map.cmd.test': { en: 'test', ko: '테스트' },
  'map.cmd.build': { en: 'build', ko: '빌드' },
  'map.cmd.inspect': { en: 'inspect', ko: '조회' },
  'map.cmd.other': { en: 'other', ko: '기타' },
  'map.work.cmdList': { en: 'command list ({n} shown)', ko: '명령 원문 보기 ({n}개 수록)' },

  // delegation section
  'map.delegation.title': { en: 'delegation — what subagents did', ko: '위임 — 서브에이전트가 한 일' },
  'map.delegation.tools': { en: '{n} tool calls', ko: '도구 {n}회' },
  'map.delegation.breakdown': { en: 'read {r} · search {s} · edit {e} · run {x}', ko: '읽기 {r} · 검색 {s} · 수정 {e} · 실행 {x}' },
  'map.delegation.truncated': { en: 'showing the first {n} agents only', ko: '처음 {n}개까지만 수록' },
  'map.delegation.workflow': { en: 'workflow', ko: '워크플로우' },
  'map.delegation.agents': { en: '{n} agents', ko: '에이전트 {n}개' },
  'map.delegation.spawnsOnly': {
    en: '{n} spawns — transcripts not found, counts from the main log only',
    ko: '{n}회 스폰 — 트랜스크립트 미발견, 본 세션 기록 기준',
  },

  // scorecard + appendix
  'map.scorecard.title': { en: 'thoroughness scorecard', ko: '성실도 성적표' },
  'map.appendix.title': { en: 'appendix', ko: '부록' },
  'map.appendix.report': { en: "the AI's own final report", ko: 'AI 최종 보고 원문' },
  'map.appendix.reportNote': {
    en: 'verbatim, no interpretation — compare it with the measured facts above',
    ko: '해석 없이 그대로 실었습니다 — 위의 실측 수치와 직접 대조해 보세요',
  },
  'map.appendix.reportNone': { en: 'no final text message found in the log', ko: '기록에서 최종 보고 텍스트를 찾지 못했습니다' },
  'map.appendix.criteria': { en: 'how these numbers are made', ko: '판정·추정 기준' },
  'map.appendix.criteria.body': {
    en: 'Everything on this page is counted from the local session log by fixed rules — no LLM judging. Read depth: cumulative lines read ÷ file lines (≥70% deep, <30% skim, otherwise partial); logs without line data show "no data". "Decided alone" is an estimate: a plan reshuffle that replaced ≥2 todo items. Command kinds come from command-prefix rules. Token counts come from the log\'s own usage records. Estimates are always labelled (est.).',
    ko: '이 페이지의 모든 수치는 로컬 세션 기록에서 고정 규칙으로 집계한 것입니다 — LLM 채점 없음. 정독 판정: 누적 읽은 줄 ÷ 파일 전체 줄 (70% 이상 정독, 30% 미만 훑기, 그 사이 부분). 줄 수 기록이 없는 로그는 "기록 없음". "스스로 결정"은 추정으로, 할 일 항목 2개 이상이 교체된 계획 재편을 신호로 삼습니다. 명령 분류는 명령어 접두사 규칙, 토큰은 기록 자체의 usage 값입니다. 추정치에는 항상 (추정)이 붙습니다.',
  },
  'map.appendix.generated': {
    en: 'generated from {records} records · rule-based counting · estimates labelled (est.) · no LLM judging',
    ko: '레코드 {records}개에서 생성 · 규칙 기반 집계 · 추정치는 (추정) 표시 · LLM 채점 없음',
  },
  'map.appendix.source': { en: 'source', ko: '원본' },
  'map.est': { en: '(est.)', ko: '(추정)' },
  'map.dur.sec': { en: '{n}s', ko: '{n}초' },
  'map.cli.saved': { en: 'map saved: {path}', ko: '지도 저장: {path}' },
  'map.cli.opening': { en: 'opening in your browser…', ko: '브라우저에서 여는 중…' },
  'map.hint': { en: 'map: `npx trailix map --open`', ko: '작업 지도: `npx trailix map --open`' },
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

/** Per-path display cap: keep head+filename so the tail (filename) survives. */
const PATH_CAP = 30;

/** "a.ts, b.ts 외 2개" — long paths middle-elided so the filename is kept. */
export function fileList(files: string[], lang: Lang, max = 3): string {
  const shown = files.slice(0, max).map((f) => middleEllipsis(f, PATH_CAP)).join(', ');
  const rest = files.length - max;
  return rest > 0 ? shown + msg('list.more', { n: rest }, lang) : shown;
}
