import type { ActivityCat, MapModel, TimelinePoint } from '../scope.ts';

/**
 * The "발자취" ribbon — an inline SVG built from real record timestamps.
 * Design spec (2026-07-12 판): piecewise time axis with idle-gap compression,
 * run-segment mode up to 240 events then a fixed 240-bin fallback, decision
 * markers that are never dropped, a delegation track, and a <title> on every
 * shape so the whole thing reads without JavaScript.
 */

export const RIBBON_W = 1200;
const PAD_L = 8;
const PAD_R = 8;
const GAP_W = 24;
const MARKER_H = 18;
const RIBBON_H = 36;
const DELEG_H = 14;
const AXIS_H = 20;
const MIN_SPAN_W = 2;
const MAX_BINS = 240;

export const CAT_COLOR: Record<ActivityCat, string> = {
  research: '#58a6ff',
  decide: '#bc8cff',
  work: '#f0883e',
  exec: '#39c5cf',
  delegate: '#bc8cff',
  other: '#6e7681',
};

interface ActiveInterval {
  start: number;
  end: number;
  x: number; // left px of this interval on the ribbon
  w: number; // px width
}

export interface TimeAxis {
  intervals: ActiveInterval[];
  gaps: { afterX: number; ms: number }[];
  x(ts: number): number;
  start: number;
  end: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/**
 * Build the compressed time axis: real time inside "active" intervals, idle
 * gaps longer than max(10min, median-delta×5) collapsed to a hatched cut.
 */
export function buildAxis(moments: number[], width = RIBBON_W): TimeAxis | undefined {
  const ts = [...new Set(moments)].sort((a, b) => a - b);
  if (ts.length < 2) return undefined;
  const start = ts[0] as number;
  const end = ts[ts.length - 1] as number;
  if (end <= start) return undefined;

  const deltas: number[] = [];
  for (let i = 1; i < ts.length; i++) deltas.push((ts[i] as number) - (ts[i - 1] as number));
  const threshold = Math.max(10 * 60_000, median(deltas.filter((d) => d > 0)) * 5);

  // active intervals split on long gaps
  const intervals: ActiveInterval[] = [];
  let curStart = start;
  const gapsMs: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const prev = ts[i - 1] as number;
    const cur = ts[i] as number;
    if (cur - prev > threshold) {
      intervals.push({ start: curStart, end: prev, x: 0, w: 0 });
      gapsMs.push(cur - prev);
      curStart = cur;
    }
  }
  intervals.push({ start: curStart, end, x: 0, w: 0 });

  const usable = width - PAD_L - PAD_R - gapsMs.length * GAP_W;
  const activeMs = intervals.reduce((n, i) => n + Math.max(1, i.end - i.start), 0);
  let x = PAD_L;
  const gaps: { afterX: number; ms: number }[] = [];
  intervals.forEach((iv, i) => {
    iv.x = x;
    iv.w = Math.max(MIN_SPAN_W, (Math.max(1, iv.end - iv.start) / activeMs) * usable);
    x += iv.w;
    if (i < gapsMs.length) {
      gaps.push({ afterX: x, ms: gapsMs[i] as number });
      x += GAP_W;
    }
  });

  const xOf = (t: number): number => {
    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i] as ActiveInterval;
      if (t <= iv.end || i === intervals.length - 1) {
        const clamped = Math.min(Math.max(t, iv.start), iv.end);
        const span = Math.max(1, iv.end - iv.start);
        return iv.x + ((clamped - iv.start) / span) * iv.w;
      }
      const gap = gaps[i];
      if (gap !== undefined && t <= (intervals[i + 1] as ActiveInterval).start) {
        // inside a compressed gap — pin to its middle
        if (t > iv.end) return gap.afterX + GAP_W / 2;
      }
    }
    return PAD_L;
  };

  return { intervals, gaps, x: xOf, start, end };
}

/** Consecutive same-category runs; each spans to the next run's start. */
export interface RibbonSpan {
  cat: ActivityCat;
  startTs: number;
  endTs: number;
  count: number;
}

export function buildRuns(points: TimelinePoint[], sessionEnd: number): RibbonSpan[] {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const runs: RibbonSpan[] = [];
  for (const p of sorted) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.cat === p.cat) {
      last.endTs = p.ts;
      last.count += 1;
    } else {
      if (last !== undefined) last.endTs = p.ts;
      runs.push({ cat: p.cat, startTs: p.ts, endTs: p.ts, count: 1 });
    }
  }
  const last = runs[runs.length - 1];
  if (last !== undefined) last.endTs = Math.max(last.endTs, sessionEnd);
  return runs;
}

export interface RibbonBin {
  startTs: number;
  endTs: number;
  counts: Partial<Record<ActivityCat, number>>;
  dominant: ActivityCat;
  total: number;
}

export function buildBins(points: TimelinePoint[], axis: TimeAxis): RibbonBin[] {
  const bins: RibbonBin[] = [];
  // equal-width bins over active pixels — bin edges follow the axis mapping
  const totalW = axis.intervals.reduce((n, iv) => n + iv.w, 0);
  const binW = totalW / MAX_BINS;
  for (const iv of axis.intervals) {
    const n = Math.max(1, Math.round(iv.w / binW));
    const span = (iv.end - iv.start) / n;
    for (let i = 0; i < n; i++) {
      bins.push({
        startTs: iv.start + span * i,
        endTs: iv.start + span * (i + 1),
        counts: {},
        dominant: 'other',
        total: 0,
      });
    }
  }
  for (const p of points) {
    const bin = bins.find((b) => p.ts >= b.startTs && p.ts <= b.endTs);
    if (bin === undefined) continue;
    bin.counts[p.cat] = (bin.counts[p.cat] ?? 0) + 1;
    bin.total += 1;
  }
  for (const bin of bins) {
    let best: ActivityCat = 'other';
    let bestN = 0;
    for (const [cat, n] of Object.entries(bin.counts) as [ActivityCat, number][]) {
      if (n > bestN) {
        best = cat;
        bestN = n;
      }
    }
    bin.dominant = best;
  }
  return bins.filter((b) => b.total > 0);
}

/** Nice tick step (ms) so the axis lands on 8–12 readable ticks. */
export function tickStep(activeMs: number): number {
  const STEPS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000, 3_600_000, 2 * 3_600_000, 6 * 3_600_000, 24 * 3_600_000];
  for (const s of STEPS) {
    if (activeMs / s <= 12) return s;
  }
  return STEPS[STEPS.length - 1] as number;
}

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export interface TimelineStrings {
  idleGap: (min: number) => string;
  catLabel: (cat: ActivityCat) => string;
  marker: (kind: 'asked' | 'plan' | 'self', num: number) => string;
  delegation: string;
  events: (n: number) => string;
}

/** The full ribbon SVG. Returns undefined when there is no usable time data. */
export function renderTimelineSvg(model: MapModel, str: TimelineStrings): string | undefined {
  const { points } = model.timeline;
  if (points.length === 0) return undefined;

  const moments: number[] = points.map((p) => p.ts);
  for (const t of model.timeline.turns) if (t.ts !== undefined) moments.push(t.ts);
  for (const d of model.decisions) if (d.ts !== undefined) moments.push(d.ts);
  for (const a of model.delegation.agents) {
    if (a.startTs !== undefined) moments.push(a.startTs);
    if (a.endTs !== undefined) moments.push(a.endTs);
  }
  const axis = buildAxis(moments);
  if (axis === undefined) return undefined;

  const hasDeleg = model.delegation.agents.some((a) => a.startTs !== undefined && a.endTs !== undefined);
  const ribbonY = MARKER_H;
  const delegY = ribbonY + RIBBON_H + 4;
  const axisY = hasDeleg ? delegY + DELEG_H + 4 : ribbonY + RIBBON_H + 4;
  const height = axisY + AXIS_H;

  const parts: string[] = [];
  parts.push(`<svg viewBox="0 0 ${RIBBON_W} ${height}" width="100%" role="img" xmlns="http://www.w3.org/2000/svg" style="min-width:720px">`);
  parts.push(
    '<defs><pattern id="idle" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="6" height="6" fill="#161b22"/><line x1="0" y1="0" x2="0" y2="6" stroke="#30363d" stroke-width="2"/></pattern></defs>',
  );

  // ribbon base
  const ribbonRight = (axis.intervals[axis.intervals.length - 1] as { x: number; w: number });
  parts.push(`<rect x="${PAD_L}" y="${ribbonY}" width="${ribbonRight.x + ribbonRight.w - PAD_L}" height="${RIBBON_H}" fill="#21262d" rx="3"/>`);

  // activity spans
  if (points.length <= MAX_BINS) {
    for (const run of buildRuns(points, axis.end)) {
      const x0 = axis.x(run.startTs);
      const x1 = Math.max(axis.x(run.endTs), x0 + MIN_SPAN_W);
      const title = `${fmtClock(run.startTs)}–${fmtClock(run.endTs)} · ${str.catLabel(run.cat)} · ${str.events(run.count)}`;
      parts.push(`<rect x="${x0.toFixed(1)}" y="${ribbonY}" width="${(x1 - x0).toFixed(1)}" height="${RIBBON_H}" fill="${CAT_COLOR[run.cat]}" rx="2"><title>${esc(title)}</title></rect>`);
    }
  } else {
    for (const bin of buildBins(points, axis)) {
      const x0 = axis.x(bin.startTs);
      const x1 = Math.max(axis.x(bin.endTs), x0 + MIN_SPAN_W);
      const breakdown = (Object.entries(bin.counts) as [ActivityCat, number][])
        .sort((a, b) => b[1] - a[1])
        .map(([cat, n]) => `${str.catLabel(cat)} ${n}`)
        .join(' · ');
      const title = `${fmtClock(bin.startTs)}–${fmtClock(bin.endTs)} · ${breakdown}`;
      parts.push(`<rect x="${x0.toFixed(1)}" y="${ribbonY}" width="${(x1 - x0).toFixed(1)}" height="${RIBBON_H}" fill="${CAT_COLOR[bin.dominant]}"><title>${esc(title)}</title></rect>`);
    }
  }

  // idle-gap cuts
  for (const gap of axis.gaps) {
    const min = Math.round(gap.ms / 60_000);
    parts.push(
      `<rect x="${gap.afterX.toFixed(1)}" y="${ribbonY}" width="${GAP_W}" height="${RIBBON_H}" fill="url(#idle)"><title>${esc(str.idleGap(min))}</title></rect>`,
    );
  }

  // turn hairlines
  for (const t of model.timeline.turns) {
    if (t.ts === undefined) continue;
    const x = axis.x(t.ts);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${ribbonY - 4}" x2="${x.toFixed(1)}" y2="${ribbonY + RIBBON_H + 4}" stroke="#0d1117" stroke-width="1.5"/>`);
  }

  // decision markers — never dropped; nudged apart when overlapping. The
  // number label is skipped when the next marker crowds it (tooltip keeps it).
  const sortedDecisions = [...model.decisions].filter((d) => d.ts !== undefined).sort((a, b) => (a.ts as number) - (b.ts as number));
  const markerXs: number[] = [];
  let lastMarkerX = -Infinity;
  for (const d of sortedDecisions) {
    let x = axis.x(d.ts as number);
    if (x - lastMarkerX < 12) x = lastMarkerX + 12;
    lastMarkerX = x;
    markerXs.push(x);
  }
  sortedDecisions.forEach((d, i) => {
    const x = markerXs[i] as number;
    const next = markerXs[i + 1];
    const roomForLabel = next === undefined || next - x >= 22;
    const y = MARKER_H - 6;
    const label = str.marker(d.kind, d.num);
    const shape =
      d.kind === 'self'
        ? `<path d="M ${x} ${y - 5} L ${x + 5} ${y} L ${x} ${y + 5} L ${x - 5} ${y} Z" fill="#bc8cff"/>`
        : `<path d="M ${x} ${y - 5} L ${x + 5} ${y} L ${x} ${y + 5} L ${x - 5} ${y} Z" fill="none" stroke="#bc8cff" stroke-width="1.5"/>`;
    parts.push(`<g><title>${esc(label + (d.title !== '' ? ` — ${d.title}` : ''))}</title>${shape}` +
      (roomForLabel ? `<text x="${x + 8}" y="${y + 3.5}" font-size="10" fill="#bc8cff">${d.num}</text>` : ''));
  });

  // delegation track
  if (hasDeleg) {
    const lanes: number[] = [];
    for (const a of model.delegation.agents) {
      if (a.startTs === undefined || a.endTs === undefined) continue;
      const x0 = axis.x(a.startTs);
      const x1 = Math.max(axis.x(a.endTs), x0 + 3);
      let lane = lanes.findIndex((end) => end <= x0);
      if (lane === -1) {
        if (lanes.length < 2) {
          lanes.push(0);
          lane = lanes.length - 1;
        } else lane = lanes.length - 1;
      }
      lanes[lane] = x1 + 2;
      const y = delegY + lane * 5;
      const name = a.agentType ?? 'agent';
      const title = `${str.delegation}: ${name}${a.desc !== undefined ? ` — ${a.desc}` : ''} · ${fmtClock(a.startTs)}–${fmtClock(a.endTs)}`;
      parts.push(`<rect x="${x0.toFixed(1)}" y="${y}" width="${(x1 - x0).toFixed(1)}" height="4" rx="2" fill="#bc8cff" opacity="0.75"><title>${esc(title)}</title></rect>`);
    }
  }

  // axis ticks (within each active interval); endpoints are always labelled,
  // and generated ticks keep clear of them
  const activeMs = axis.intervals.reduce((n, iv) => n + (iv.end - iv.start), 0);
  const step = tickStep(activeMs);
  const endX = ribbonRight.x + ribbonRight.w;
  let lastTickX = PAD_L; // reserve space after the left endpoint label
  for (const iv of axis.intervals) {
    const first = Math.ceil(iv.start / step) * step;
    for (let t = first; t <= iv.end; t += step) {
      const x = axis.x(t);
      if (x - lastTickX < 56 || endX - x < 56) continue;
      lastTickX = x;
      parts.push(`<line x1="${x.toFixed(1)}" y1="${axisY}" x2="${x.toFixed(1)}" y2="${axisY + 4}" stroke="#30363d"/>`);
      parts.push(`<text x="${x.toFixed(1)}" y="${axisY + 15}" font-size="10" fill="#8b949e" text-anchor="middle">${fmtClock(t)}</text>`);
    }
  }
  parts.push(`<text x="${PAD_L}" y="${axisY + 15}" font-size="10" fill="#8b949e">${fmtClock(axis.start)}</text>`);
  parts.push(`<text x="${endX.toFixed(1)}" y="${axisY + 15}" font-size="10" fill="#8b949e" text-anchor="end">${fmtClock(axis.end)}</text>`);

  parts.push('</svg>');
  return parts.join('');
}
