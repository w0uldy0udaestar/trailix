import type { Lang } from '../types.ts';
import type { ActivityCat, DecisionScope, MapModel, TurnRow } from '../scope.ts';
import { msg } from '../messages.ts';
import { middleEllipsis } from './width.ts';
import { renderMetric } from './metric.ts';
import { glyphFor } from './palette.ts';
import { formatDuration } from '../facts.ts';
import { fmtClock, renderTimelineSvg, type TimelineStrings } from './map-timeline.ts';

/**
 * The session map — a self-contained single-file HTML surface. Design spec
 * (2026-07-12 판): verdict chip → one-line summary → three evidence cards →
 * the trail ribbon → detail sections → the terminal scorecard → appendix.
 * Zero external resources, readable without JavaScript, printable.
 *
 * Honesty contract carried over from the card: every figure is counted, every
 * estimate is labelled, missing data renders as "—" (never 0), and arbitrary
 * session strings are HTML-escaped everywhere.
 */

const FILES_SHOWN = 15;
const SEARCH_SHOWN = 8;
const PATH_CAP = 60;

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmtInt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Token display: ko "128.4만" / en "1.28M" — exact value in the title attr. */
function fmtTokens(n: number, lang: Lang): string {
  if (lang === 'ko') {
    if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1)}만`;
    return fmtInt(n);
  }
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return fmtInt(n);
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDurMs(ms: number, lang: Lang): string {
  if (ms < 90_000) return msg('map.dur.sec', { n: Math.max(1, Math.round(ms / 1000)) }, lang);
  return formatDuration(Math.round(ms / 60_000), lang);
}

/** 10-cell text gauge in the terminal card's own idiom. */
function gauge(ratio: number, color: string): string {
  const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  return `<code class="g" style="color:${color}">${'█'.repeat(filled)}${'░'.repeat(10 - filled)}</code>`;
}

const CAT_CLASS: Record<ActivityCat, string> = {
  research: 'c-res',
  decide: 'c-dec',
  work: 'c-work',
  exec: 'c-exec',
  delegate: 'c-dec',
  other: 'c-dim',
};

// ── S1: the one-line summary (rule-based clause assembly, no LLM) ──────────

function buildSummary(m: MapModel, lang: Lang): string {
  const f = m.research;
  const w = m.work;
  const b = (s: string | number): string => `<b>${s}</b>`;
  const dur = m.card.durationLabel;

  const lead = dur !== undefined ? msg('map.sum.duration', { dur }, lang) : msg('map.sum.nodur', {}, lang);

  let research: string;
  const reads = f.files.length;
  const webs = f.webSearches.length > 0 ? f.webSearches.length : f.webFetches > 0 ? 0 : 0;
  const webCount = m.research.webSearches.length;
  if (reads > 0 && webCount > 0) research = msg('map.sum.readWeb', { r: b(reads), w: b(webCount) }, lang);
  else if (reads > 0) research = msg('map.sum.read', { r: b(reads) }, lang);
  else if (webCount > 0) research = msg('map.sum.web', { w: b(webCount) }, lang);
  else research = msg('map.sum.noResearch', {}, lang);
  void webs;

  const parts: string[] = [lead + research];
  if (w.files.length > 0) {
    if (w.commands.total > 0) {
      parts.push(', ' + msg('map.sum.work', { e: b(w.files.length), a: b(fmtInt(w.totalAdds)), d: b(fmtInt(w.totalDels)) }, lang));
      parts.push(' ' + msg('map.sum.exec', { c: b(w.commands.total) }, lang));
    } else {
      parts.push(', ' + msg('map.sum.workOnly', { e: b(w.files.length), a: b(fmtInt(w.totalAdds)), d: b(fmtInt(w.totalDels)) }, lang));
    }
  } else {
    parts.push(lang === 'ko' ? ' ' : ', ');
    parts.push(msg('map.sum.noWork', {}, lang));
    if (w.commands.total > 0) parts.push(' ' + msg('map.sum.exec', { c: b(w.commands.total) }, lang));
  }

  const asked = m.decisions.filter((d) => d.kind === 'asked' || d.kind === 'plan').length;
  const total = m.decisions.length;
  if (total > 0) {
    parts.push(' ');
    parts.push(asked > 0 ? msg('map.sum.asked', { t: b(total), m: b(asked) }, lang) : msg('map.sum.allSelf', { t: b(total) }, lang));
  }
  if (m.delegation.spawns > 0) {
    parts.push(' ' + msg('map.sum.delegated', { n: b(m.delegation.spawns) }, lang));
  }
  return parts.join('');
}

// ── S2: evidence cards ─────────────────────────────────────────────────────

function buildCards(m: MapModel, lang: Lang): string {
  const f = m.research;
  const hasDepth = f.deep + f.partial + f.skim > 0;
  const researchSub1 = hasDepth
    ? msg('map.card.read.depth', { deep: f.deep, partial: f.partial, skim: f.skim }, lang)
    : f.files.length > 0
      ? msg('map.card.read.nodepth', {}, lang)
      : '';
  const researchSub2 =
    f.webSearches.length > 0 || f.domains.length > 0
      ? msg('map.card.read.web', { w: f.webSearches.length, d: f.domains.length }, lang)
      : f.codeSearches.length > 0
        ? msg('map.card.read.code', { s: f.codeSearches.reduce((n, s) => n + s.count, 0) }, lang)
        : msg('map.research.webNone', {}, lang);

  const asked = m.decisions.filter((d) => d.kind === 'asked' || d.kind === 'plan').length;
  const self = m.decisions.length - asked;
  const decideSub1 = m.decisions.length > 0 ? msg('map.card.decide.split', { a: asked, s: self }, lang) : msg('map.decisions.none', {}, lang);
  const decideSub2 = m.delegation.spawns > 0 ? msg('map.card.decide.deleg', { n: m.delegation.spawns }, lang) : '';

  const w = m.work;
  const workSub1 = w.files.length > 0 ? msg('map.card.work.lines', { a: fmtInt(w.totalAdds), d: fmtInt(w.totalDels) }, lang) : msg('map.work.none', {}, lang);
  const workSub2 = msg('map.card.work.sub', { n: w.newFiles, c: w.commands.total }, lang);

  const card = (cls: string, title: string, big: number, label: string, sub1: string, sub2: string, anchor: string): string => `
  <a class="kpi ${cls}" href="#${anchor}">
    <div class="kpi-t">${esc(title)}</div>
    <div class="big">${fmtInt(big)}<span class="big-l">${esc(label)}</span></div>
    <div class="sub">${esc(sub1)}</div>
    <div class="sub">${esc(sub2)}</div>
    <div class="kpi-go">${esc(msg('map.card.detail', {}, lang))}</div>
  </a>`;

  return `<nav class="cards">
${card('k-res', msg('map.card.research', {}, lang), f.files.length, msg('map.card.read.label', {}, lang), researchSub1, researchSub2, 'research')}
${card('k-dec', msg('map.card.decide', {}, lang), m.decisions.length, msg('map.card.decide.label', {}, lang), decideSub1, decideSub2, 'decisions')}
${card('k-work', msg('map.card.work', {}, lang), w.files.length, msg('map.card.work.label', {}, lang), workSub1, workSub2, 'work')}
</nav>`;
}

// ── S3: trail (SVG + legend + turn list) ───────────────────────────────────

function turnRowHtml(t: TurnRow, lang: Lang): string {
  const bits: string[] = [];
  if (t.reads > 0 || t.searches > 0) {
    if (t.reads > 0) bits.push(`<span class="c-res">${esc(msg('map.turn.reads', { n: t.reads }, lang))}</span>`);
    if (t.searches > 0) bits.push(`<span class="c-res">${esc(msg('map.turn.searches', { n: t.searches }, lang))}</span>`);
  }
  if (t.edits > 0) {
    const diff = t.adds > 0 || t.dels > 0 ? `(+${fmtInt(t.adds)}/−${fmtInt(t.dels)})` : '';
    bits.push(`<span class="c-work">${esc(msg('map.turn.edits', { n: t.edits }, lang))}${diff}</span>`);
  }
  if (t.execs > 0) bits.push(`<span class="c-exec">${esc(msg('map.turn.execs', { n: t.execs }, lang))}</span>`);
  if (t.spawns > 0) bits.push(`<span class="c-dec">${esc(msg('map.turn.spawns', { n: t.spawns }, lang))}</span>`);
  if (t.decisionNums.length > 0) {
    bits.push(`<span class="c-dec">◇${t.decisionNums.join(' ◇')}</span>`);
  }
  const clock = t.ts !== undefined ? fmtClock(t.ts) : '—';
  const dur = t.durationMs !== undefined ? fmtDurMs(t.durationMs, lang) : '';
  return `<div class="turn">
    <span class="turn-id mono">#${t.index}</span>
    <span class="turn-ts mono">${clock}${dur !== '' ? ` · ${esc(dur)}` : ''}</span>
    <span class="turn-p">${esc(t.promptPreview === '' ? '·' : t.promptPreview)}</span>
    <span class="turn-n">${bits.join(' ')}</span>
  </div>`;
}

function buildTimeline(m: MapModel, lang: Lang): string {
  const str: TimelineStrings = {
    idleGap: (min) => msg('map.timeline.idleGap', { n: min }, lang),
    catLabel: (cat) => msg(`map.cat.${cat}` as 'map.cat.research', {}, lang),
    marker: (kind, num) => `${kind === 'self' ? '◆' : '◇'}${num} ${msg(kind === 'self' ? 'map.decisions.self' : kind === 'plan' ? 'map.decisions.plan' : 'map.decisions.asked', {}, lang)}`,
    delegation: msg('map.cat.delegate', {}, lang),
    events: (n) => msg('map.timeline.events', { n }, lang),
  };
  const svg = renderTimelineSvg(m, str);

  const legend = `<div class="legend">
    <span><i class="sw" style="background:#58a6ff"></i>${esc(msg('map.cat.research', {}, lang))}</span>
    <span><i class="sw" style="background:#bc8cff"></i>${esc(msg('map.cat.decide', {}, lang))}</span>
    <span><i class="sw" style="background:#f0883e"></i>${esc(msg('map.cat.work', {}, lang))}</span>
    <span><i class="sw" style="background:#39c5cf"></i>${esc(msg('map.cat.exec', {}, lang))}</span>
    <span><i class="sw sw-idle"></i>${esc(msg('map.legend.idle', {}, lang))}</span>
    <span class="c-dec">${esc(msg('map.legend.asked', {}, lang))}</span>
    <span class="c-dec">${esc(msg('map.legend.self', {}, lang))}</span>
  </div>`;

  // turn list — the JS/SVG-free layer 0
  const rows: string[] = [];
  const turns = m.timeline.turnRows.filter((t) => !(t.index === 0 && t.toolTotal === 0));
  const fold = turns.length > 30;
  let quiet: TurnRow[] = [];
  const flushQuiet = (): void => {
    if (quiet.length === 0) return;
    if (quiet.length <= 2) {
      for (const q of quiet) rows.push(turnRowHtml(q, lang));
    } else {
      rows.push(
        `<details class="turn-fold"><summary>▸ ${esc(msg('map.turn.fold', { n: quiet.length }, lang))}</summary>${quiet
          .map((q) => turnRowHtml(q, lang))
          .join('')}</details>`,
      );
    }
    quiet = [];
  };
  let prev: TurnRow | undefined;
  for (const t of turns) {
    if (prev?.ts !== undefined && t.ts !== undefined && t.ts - prev.ts > 30 * 60_000) {
      flushQuiet();
      const gapMin = Math.round((t.ts - prev.ts) / 60_000);
      rows.push(`<div class="turn-gap">── ${esc(msg('map.turn.gap', { n: fmtInt(gapMin) }, lang))} ──</div>`);
    }
    if (fold && t.toolTotal < 5 && t.decisionNums.length === 0) quiet.push(t);
    else {
      flushQuiet();
      rows.push(turnRowHtml(t, lang));
    }
    prev = t;
  }
  flushQuiet();

  const durLabel = m.card.durationLabel !== undefined ? ` — ${m.card.durationLabel}` : '';
  const turnsLabel = ` · ${msg('scope.session', { n: m.meta.turns }, lang).replace(/^[^·]*· /, '')}`;
  return `<section id="timeline">
  <h2>${esc(msg('map.timeline.title', {}, lang))}${esc(durLabel)}${esc(turnsLabel)}</h2>
  ${svg !== undefined ? `<div class="ribbon-wrap">${svg}</div>${legend}` : `<p class="dim">${esc(msg('map.timeline.noTs', {}, lang))}</p>`}
  <div class="turns">${rows.join('')}</div>
</section>`;
}

// ── S4: research detail ────────────────────────────────────────────────────

function buildResearch(m: MapModel, lang: Lang): string {
  const f = m.research;
  const fileRow = (file: (typeof f.files)[number]): string => {
    const ratio = file.totalLines !== undefined && file.totalLines > 0 ? Math.min(1, file.linesRead / file.totalLines) : undefined;
    const lines =
      file.totalLines !== undefined
        ? msg('map.research.lines', { read: fmtInt(file.linesRead), total: fmtInt(file.totalLines) }, lang)
        : file.linesRead > 0
          ? msg('map.research.linesOnly', { read: fmtInt(file.linesRead) }, lang)
          : '—';
    const depth = msg(`map.depth.${file.depth}` as 'map.depth.deep', {}, lang);
    return `<div class="frow">
      <code class="path">${esc(middleEllipsis(file.path, PATH_CAP))}</code>
      ${ratio !== undefined ? gauge(ratio, '#58a6ff') : '<code class="g dim">··········</code>'}
      <span class="fmeta">${esc(lines)} · ${esc(depth)}${file.count > 1 ? ` ×${file.count}` : ''}</span>
    </div>`;
  };
  const shown = f.files.slice(0, FILES_SHOWN).map(fileRow).join('');
  const rest = f.files.slice(FILES_SHOWN);
  const restHtml =
    rest.length > 0
      ? `<details><summary>▸ ${esc(msg('map.more', { n: rest.length }, lang))}</summary>${rest.map(fileRow).join('')}</details>`
      : '';

  const searches =
    f.codeSearches.length > 0
      ? `<h3>${esc(msg('map.research.codeSearches', {}, lang))}</h3><p class="wrap">${f.codeSearches
          .slice(0, SEARCH_SHOWN)
          .map((s) => `<code class="path">${esc(s.label)}</code>${s.count > 1 ? ` ×${s.count}` : ''}`)
          .join(' · ')}${f.codeSearches.length > SEARCH_SHOWN ? ` <span class="dim">+${f.codeSearches.length - SEARCH_SHOWN}</span>` : ''}</p>`
      : '';

  let web: string;
  if (f.webSearches.length === 0 && f.domains.length === 0) {
    web = `<p class="dim">${esc(msg('map.research.webNone', {}, lang))}</p>`;
  } else {
    const queries = f.webSearches.map((q) => `<li>“<code class="path">${esc(q)}</code>”</li>`).join('');
    const domains = f.domains.map((d) => `<code class="path">${esc(d.domain)}</code>${d.count > 1 ? ` ×${d.count}` : ''}`).join(' · ');
    web = `<h3>${esc(msg('map.research.web', {}, lang))}</h3>${queries !== '' ? `<ul class="qlist">${queries}</ul>` : ''}${
      domains !== '' ? `<p class="wrap">→ ${domains} <span class="dim">(${esc(msg('map.research.fetches', { n: f.webFetches }, lang))})</span></p>` : ''
    }`;
  }

  const body =
    f.files.length === 0 && searches === '' && f.webSearches.length === 0 && f.domains.length === 0
      ? `<p class="dim">${esc(msg('map.research.none', {}, lang))}</p>`
      : `<h3>${esc(msg('map.research.files', {}, lang))}</h3>${shown}${restHtml}${searches}${web}`;

  return `<section id="research"><h2 class="h-res">${esc(msg('map.research.title', {}, lang))}</h2>${body}</section>`;
}

// ── S5: decisions detail (never truncated) ─────────────────────────────────

function decisionHtml(d: DecisionScope, lang: Lang): string {
  const glyphChar = d.kind === 'self' ? '◆' : '◇';
  const badge = msg(d.kind === 'self' ? 'map.decisions.self' : d.kind === 'plan' ? 'map.decisions.plan' : 'map.decisions.asked', {}, lang);
  const when = d.ts !== undefined ? `<span class="mono dim">${fmtClock(d.ts)}</span>` : '';
  let body = '';
  if (d.kind === 'asked') {
    const options = d.options
      .map((o) => {
        const isChosen = d.chosen.includes(o);
        return isChosen
          ? `<li class="opt chosen">● ${esc(o)} <span class="pick">${esc(msg('map.decisions.chosen', {}, lang))}</span></li>`
          : `<li class="opt">○ ${esc(o)}</li>`;
      })
      .join('');
    body = `<div class="q">${esc(d.title)}</div>${options !== '' ? `<ul class="opts">${options}</ul>` : ''}`;
  } else if (d.kind === 'plan') {
    body = `<div class="q dim">${esc(msg('map.decisions.planNote', {}, lang))}</div>`;
  } else {
    const parts = (d.note ?? '').split('·');
    const beforeAfter = (parts[0] ?? '').split('→');
    body = `<div class="q dim">${esc(
      msg('map.decisions.todoNote', { before: beforeAfter[0] ?? '?', after: beforeAfter[1] ?? '?', removed: parts[1] ?? '?' }, lang),
    )}</div>`;
  }
  return `<div class="dec"><span class="dec-m c-dec">${glyphChar}${d.num}</span> ${when} <span class="badge">${esc(badge)}</span>${body}</div>`;
}

function buildDecisions(m: MapModel, lang: Lang): string {
  const body =
    m.decisions.length === 0
      ? `<p class="dim">${esc(msg('map.decisions.none', {}, lang))}</p>`
      : m.decisions.map((d) => decisionHtml(d, lang)).join('');
  return `<section id="decisions"><h2 class="h-dec">${esc(msg('map.decisions.title', {}, lang))}</h2>${body}</section>`;
}

// ── S6: work detail ────────────────────────────────────────────────────────

function buildWork(m: MapModel, lang: Lang): string {
  const w = m.work;
  const maxChange = Math.max(1, ...w.files.map((f) => f.adds + f.dels));
  const fileRow = (f: (typeof w.files)[number]): string => {
    const negW = ((f.dels / maxChange) * 100).toFixed(1);
    const posW = ((f.adds / maxChange) * 100).toFixed(1);
    const badge = f.created
      ? `<span class="badge b-new">${esc(msg('map.work.new', {}, lang))}</span>`
      : `<span class="badge">${esc(msg('map.work.edited', { n: f.editCount }, lang))}</span>`;
    const counts = f.countsKnown
      ? `<span class="del">−${fmtInt(f.dels)}</span><span class="dbar"><i class="dneg" style="width:${negW}%"></i><i class="dpos" style="width:${posW}%"></i></span><span class="add">+${fmtInt(f.adds)}</span>`
      : `<span class="dim">${esc(msg('map.work.nocounts', {}, lang))}</span>`;
    return `<div class="frow wrow"><code class="path">${esc(middleEllipsis(f.path, PATH_CAP))}</code>${counts}${badge}</div>`;
  };
  const shown = w.files.slice(0, FILES_SHOWN).map(fileRow).join('');
  const rest = w.files.slice(FILES_SHOWN);
  const restHtml =
    rest.length > 0
      ? `<details><summary>▸ ${esc(msg('map.more', { n: rest.length }, lang))}</summary>${rest.map(fileRow).join('')}</details>`
      : '';

  const cmd = w.commands;
  const cmdBits = (['test', 'build', 'inspect', 'other'] as const)
    .filter((k) => cmd[k] > 0)
    .map((k) => `${msg(`map.cmd.${k}` as 'map.cmd.test', {}, lang)} ${cmd[k]}`)
    .join(' · ');
  const cmdList =
    w.commandSamples.length > 0
      ? `<details><summary>▸ ${esc(msg('map.work.cmdList', { n: w.commandSamples.length }, lang))}</summary><ul class="cmds">${w.commandSamples
          .map((c) => `<li><code class="path">${esc(c)}</code></li>`)
          .join('')}</ul></details>`
      : '';
  const commands =
    cmd.total > 0 ? `<h3>${esc(msg('map.work.commands', { n: cmd.total }, lang))}${cmdBits !== '' ? ` — ${esc(cmdBits)}` : ''}</h3>${cmdList}` : '';

  const body =
    w.files.length === 0
      ? `<p class="dim">${esc(msg('map.work.none', {}, lang))}</p>${commands}`
      : `<h3>${esc(msg('map.work.files', {}, lang))}</h3>${shown}${restHtml}${commands}`;
  return `<section id="work"><h2 class="h-work">${esc(msg('map.work.title', {}, lang))}</h2>${body}</section>`;
}

// ── S7: delegation (rendered only when subagents exist) ────────────────────

function buildDelegation(m: MapModel, lang: Lang): string {
  const d = m.delegation;
  if (d.spawns === 0 && d.agents.length === 0) return '';
  let body: string;
  if (d.agents.length === 0) {
    body = `<p class="dim">${esc(msg('map.delegation.spawnsOnly', { n: d.spawns }, lang))}</p>`;
  } else {
    interface AgentRow {
      name: string;
      desc?: string;
      agents: number;
      startTs?: number;
      endTs?: number;
      toolTotal: number;
      reads: number;
      searches: number;
      edits: number;
      execs: number;
    }
    // one row per standalone agent; a workflow's whole fleet folds into one row
    const rows: AgentRow[] = [];
    const byGroup = new Map<string, AgentRow>();
    for (const a of d.agents) {
      if (a.groupId !== undefined) {
        let g = byGroup.get(a.groupId);
        if (g === undefined) {
          g = { name: `${msg('map.delegation.workflow', {}, lang)} ${a.groupId.slice(0, 11)}`, agents: 0, toolTotal: 0, reads: 0, searches: 0, edits: 0, execs: 0 };
          byGroup.set(a.groupId, g);
          rows.push(g);
        }
        g.agents += 1;
        g.toolTotal += a.toolTotal;
        g.reads += a.reads;
        g.searches += a.searches;
        g.edits += a.edits;
        g.execs += a.execs;
        if (a.startTs !== undefined && (g.startTs === undefined || a.startTs < g.startTs)) g.startTs = a.startTs;
        if (a.endTs !== undefined && (g.endTs === undefined || a.endTs > g.endTs)) g.endTs = a.endTs;
      } else {
        rows.push({
          name: a.agentType ?? 'agent',
          desc: a.desc,
          agents: 1,
          startTs: a.startTs,
          endTs: a.endTs,
          toolTotal: a.toolTotal,
          reads: a.reads,
          searches: a.searches,
          edits: a.edits,
          execs: a.execs,
        });
      }
    }
    body = rows
      .map((a) => {
        const dur = a.startTs !== undefined && a.endTs !== undefined && a.endTs > a.startTs ? fmtDurMs(a.endTs - a.startTs, lang) : undefined;
        const fleet = a.agents > 1 ? ` · ${msg('map.delegation.agents', { n: a.agents }, lang)}` : '';
        return `<div class="agent">
        <div><span class="c-dec">▸</span> <b>${esc(a.name)}</b>${a.desc !== undefined ? ` — ${esc(a.desc)}` : ''}${esc(fleet)}</div>
        <div class="sub">${dur !== undefined ? `${esc(dur)} · ` : ''}${esc(msg('map.delegation.tools', { n: a.toolTotal }, lang))} · ${esc(
          msg('map.delegation.breakdown', { r: a.reads, s: a.searches, e: a.edits, x: a.execs }, lang),
        )}</div>
      </div>`;
      })
      .join('');
    if (d.truncated) body += `<p class="dim">${esc(msg('map.delegation.truncated', { n: d.agents.length }, lang))}</p>`;
  }
  return `<section id="delegation"><h2 class="h-dec">${esc(msg('map.delegation.title', {}, lang))}</h2>${body}</section>`;
}

// ── S8: the terminal scorecard, transplanted ───────────────────────────────

function buildScorecard(m: MapModel, lang: Lang): string {
  const card = m.card;
  const rows: string[] = [];
  for (const v of card.verdicts) {
    const glyphChar = glyphFor(v.verdict, {});
    let metricHtml = '';
    if (v.metric !== undefined && v.label !== undefined) {
      const { bar, value } = renderMetric(v.metric, v.verdict, {});
      metricHtml = ` <code class="g v-${v.verdict}">${esc(bar)}</code>${value !== '' ? ` <span class="mono">${esc(value)}</span>` : ''}`;
    }
    rows.push(`<div class="vrow"><span class="v-${v.verdict} vg">${glyphChar}</span>${metricHtml} <span>${esc(v.text)}</span></div>`);
  }
  const notes = card.notes.map((n) => `<div class="vnote">◌ ${esc(n)}</div>`).join('');
  const empty = card.verdicts.length === 0 ? `<p class="dim">${esc(card.headline)}</p>` : '';
  return `<section id="scorecard"><h2>${esc(msg('map.scorecard.title', {}, lang))}</h2>${rows.join('')}${empty}${notes}</section>`;
}

// ── S9: appendix ───────────────────────────────────────────────────────────

function buildAppendix(m: MapModel, lang: Lang): string {
  const report =
    m.lastReport !== undefined
      ? `<details><summary>▸ ${esc(msg('map.appendix.report', {}, lang))} <span class="dim">— ${esc(
          msg('map.appendix.reportNote', {}, lang),
        )}</span></summary><pre class="report">${esc(m.lastReport)}</pre></details>`
      : `<p class="dim">${esc(msg('map.appendix.reportNone', {}, lang))}</p>`;
  const criteria = `<details><summary>▸ ${esc(msg('map.appendix.criteria', {}, lang))}</summary><p class="crit">${esc(
    msg('map.appendix.criteria.body', {}, lang),
  )}</p></details>`;
  const generated = `<p class="dim foot">${esc(msg('map.appendix.generated', { records: fmtInt(m.meta.records) }, lang))}<br>${esc(
    msg('map.appendix.source', {}, lang),
  )}: <code class="path">${esc(m.sourcePath)}</code></p>`;
  return `<section id="appendix"><h2>${esc(msg('map.appendix.title', {}, lang))}</h2>${report}${criteria}${generated}</section>`;
}

// ── page assembly ──────────────────────────────────────────────────────────

const CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#e6edf3;font:14px/1.55 system-ui,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",sans-serif;font-variant-numeric:tabular-nums;padding:24px 16px 64px}
main{max-width:1040px;margin:0 auto;display:grid;gap:14px}
code,.mono{font-family:ui-monospace,"Cascadia Mono","D2Coding",Consolas,monospace;font-size:.93em}
section,.hero{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px 20px}
a{color:inherit;text-decoration:none}
h1{font-size:20px;line-height:1.35}
h2{font-size:15px;margin-bottom:10px;padding-left:8px;border-left:3px solid #30363d}
h2.h-res{border-left-color:#58a6ff}h2.h-dec{border-left-color:#bc8cff}h2.h-work{border-left-color:#f0883e}
h3{font-size:13px;color:#8b949e;margin:14px 0 6px;font-weight:600}
h3:first-of-type{margin-top:0}
.dim{color:#6e7681}.sub{color:#8b949e;font-size:13px}
.hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
.hero .meta{color:#8b949e;font-size:13px;margin-top:6px}
.brand{font-size:12px;color:#8b949e;margin-bottom:4px}
.chip{white-space:nowrap;text-align:right;border:1px solid #30363d;border-radius:20px;padding:8px 14px}
.chip .cw{font-weight:600}
.chip .cs{display:block;font-size:11px;color:#8b949e;margin-top:2px}
.v-pass{color:#3fb950}.v-caution{color:#d29922}.v-poor{color:#f85149}.v-no_verdict{color:#8b949e}
.lede{font-size:17px;line-height:1.65;color:#8b949e;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px 20px}
.lede b{color:#e6edf3;font-weight:600}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.kpi{display:block;background:#161b22;border:1px solid #30363d;border-top-width:2px;border-radius:6px;padding:14px 16px}
.kpi:hover{border-color:#8b949e}
.k-res{border-top-color:#58a6ff}.k-dec{border-top-color:#bc8cff}.k-work{border-top-color:#f0883e}
.kpi-t{font-size:12px;color:#8b949e}
.big{font-size:28px;font-weight:600;margin:2px 0}
.big-l{font-size:12px;font-weight:400;color:#8b949e;margin-left:6px}
.kpi-go{font-size:11px;color:#6e7681;margin-top:6px}
.c-res{color:#58a6ff}.c-dec{color:#bc8cff}.c-work{color:#f0883e}.c-exec{color:#39c5cf}.c-dim{color:#6e7681}
.path{color:#56d4dd;word-break:break-all}
.ribbon-wrap{overflow-x:auto}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:#8b949e;margin-top:6px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.sw-idle{background:repeating-linear-gradient(45deg,#161b22 0 2px,#30363d 2px 4px)}
.turns{margin-top:12px;display:grid;gap:2px}
.turn{display:flex;gap:10px;align-items:baseline;padding:3px 6px;border-radius:4px;font-size:13px}
.turn:nth-child(odd){background:#1c2129}
.turn-id{color:#8b949e;min-width:2.5em}
.turn-ts{color:#6e7681;white-space:nowrap}
.turn-p{flex:1;min-width:8em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e6edf3}
.turn-n{white-space:nowrap;font-size:12px;display:flex;gap:8px}
.turn-gap{text-align:center;color:#6e7681;font-size:11px;padding:4px 0}
.turn-fold summary{cursor:pointer;color:#8b949e;font-size:12px;padding:3px 6px}
.frow{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:baseline;padding:2px 0}
.frow .path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;word-break:normal}
.frow .g{letter-spacing:1px}
.fmeta{color:#8b949e;font-size:12px;white-space:nowrap}
.wrow{grid-template-columns:minmax(0,1fr) auto auto auto auto}
.wrow .del{color:#8b949e;min-width:4em;text-align:right}
.wrow .add{color:#f0883e;min-width:4em}
.dbar{display:inline-flex;width:140px;height:8px;background:#21262d;border-radius:2px;overflow:hidden;align-self:center}
.dbar .dneg{background:#8b949e;margin-left:auto}
.dbar{justify-content:center;position:relative}
.dbar .dneg,.dbar .dpos{display:block;height:100%}
.dbar .dpos{background:#f0883e}
.badge{font-size:11px;border:1px solid #30363d;border-radius:10px;padding:0 8px;color:#8b949e;white-space:nowrap}
.b-new{color:#f0883e;border-color:#f0883e}
.qlist{list-style:none;margin:4px 0}
.qlist li{padding:1px 0}
.wrap{overflow-wrap:anywhere}
.dec{padding:8px 0;border-bottom:1px solid #21262d}
.dec:last-child{border-bottom:none}
.dec-m{font-weight:600}
.q{margin-top:4px}
.opts{list-style:none;margin:6px 0 0 16px}
.opt{color:#6e7681;padding:1px 0}
.opt.chosen{color:#e6edf3}
.pick{color:#bc8cff;font-size:12px}
.agent{padding:6px 0;border-bottom:1px solid #21262d}
.agent:last-child{border-bottom:none}
.cmds{list-style:none;margin:6px 0}
.cmds li{padding:1px 0}
.vrow{display:flex;gap:8px;align-items:baseline;padding:3px 0}
.vg{font-weight:700}
.vnote{color:#6e7681;font-size:12px;padding:2px 0}
.report{white-space:pre-wrap;overflow-wrap:anywhere;background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:12px;margin-top:8px;font-size:12px;max-height:400px;overflow-y:auto}
.crit{color:#8b949e;font-size:13px;margin-top:8px;max-width:70ch}
.foot{font-size:11px;margin-top:12px}
details summary{cursor:pointer;color:#8b949e;padding:4px 0;list-style:none}
details summary::-webkit-details-marker{display:none}
details summary:hover{color:#e6edf3}
@media(max-width:719px){.cards{grid-template-columns:1fr}.hero{flex-direction:column}.chip{text-align:left}.turn{flex-wrap:wrap}}
@media print{
 :root{color-scheme:light}
 body{background:#fff;color:#1f2328}
 section,.hero,.lede,.kpi{background:#fff;border-color:#d0d7de}
 .lede b,.turn-p,.opt.chosen{color:#1f2328}
 .turn:nth-child(odd){background:#f6f8fa}
 .report{background:#f6f8fa}
 section{break-inside:avoid}
}
`;

const PRINT_JS = `<script>
addEventListener('beforeprint',()=>{for(const d of document.querySelectorAll('details')){if(!d.open){d.dataset.autoprint='1';d.open=true}}});
addEventListener('afterprint',()=>{for(const d of document.querySelectorAll('details[data-autoprint]')){d.open=false;delete d.dataset.autoprint}});
</script>`;

export function renderMapHtml(m: MapModel): string {
  const lang = m.lang;
  const title = m.meta.title ?? m.timeline.turns.find((t) => t.promptPreview !== '')?.promptPreview ?? msg('map.untitled', {}, lang);

  const metaBits: string[] = [];
  if (m.meta.startTs !== undefined) {
    const range = m.meta.endTs !== undefined ? `${fmtClock(m.meta.startTs)}→${fmtClock(m.meta.endTs)}` : fmtClock(m.meta.startTs);
    metaBits.push(`${fmtDate(m.meta.startTs)} ${range}`);
  }
  if (m.card.durationLabel !== undefined) metaBits.push(m.card.durationLabel);
  if (m.meta.projectLabel !== undefined) metaBits.push(m.meta.projectLabel);
  if (m.meta.gitBranch !== undefined) metaBits.push(m.meta.gitBranch);
  metaBits.push(msg('map.meta.turns', { n: m.meta.turns }, lang));
  metaBits.push(msg('map.meta.tools', { n: fmtInt(m.meta.toolCalls) }, lang));
  if (m.usage !== undefined && m.usage.outputTokens > 0) {
    metaBits.push(msg('map.meta.tokens', { n: fmtTokens(m.usage.outputTokens, lang) }, lang));
  }

  const chipGlyph = glyphFor(m.card.overall, {});
  const chipWord = m.card.state === 'normal' ? m.card.headline : msg(`grade.${m.card.overall}` as 'grade.pass', {}, lang);
  const chipSub =
    m.assessment.scoredCount > 0
      ? msg('map.chip.rules', { pass: m.assessment.passCount, scored: m.assessment.scoredCount }, lang)
      : msg('map.chip.rules.none', {}, lang);

  const hero = `<header class="hero">
  <div>
    <div class="brand">trailix ▸ ${esc(msg('map.title', {}, lang))}</div>
    <h1>${esc(title)}</h1>
    <div class="meta">${metaBits.map(esc).join(' · ')}</div>
  </div>
  <div class="chip"><span class="cw v-${m.card.overall}">${chipGlyph} ${esc(chipWord)}</span><span class="cs">${esc(chipSub)}</span></div>
</header>`;

  const summary = `<p class="lede">${buildSummary(m, lang)}</p>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — trailix ${esc(msg('map.title', {}, lang))}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${hero}
${summary}
${buildCards(m, lang)}
${buildTimeline(m, lang)}
${buildResearch(m, lang)}
${buildDecisions(m, lang)}
${buildWork(m, lang)}
${buildDelegation(m, lang)}
${buildScorecard(m, lang)}
${buildAppendix(m, lang)}
</main>
${PRINT_JS}
</body>
</html>`;
}
