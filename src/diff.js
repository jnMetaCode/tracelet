// Compare two agent runs step by step.
//
// A "step" is a span in tree order (parents before children, siblings by start
// time) — the same order the waterfall draws. Steps are matched across runs by
// a stable key (kind + tool name / span name) using an LCS alignment, so an
// inserted retry or a dropped tool call shows up as one added/removed row
// instead of shifting every row after it. Matched pairs are then compared
// field by field (status, model, prompt, output, tokens, cost, latency).
//
// Pure functions, no I/O — used by the /api/diff endpoint and the tests.

import { estimateCost } from './cost.js';

/** Spans in waterfall order, each tagged with its depth. */
export function treeOrder(spans) {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const children = new Map();
  const roots = [];
  for (const s of spans) {
    if (s.parentSpanId && byId.has(s.parentSpanId)) {
      if (!children.has(s.parentSpanId)) children.set(s.parentSpanId, []);
      children.get(s.parentSpanId).push(s);
    } else roots.push(s);
  }
  const byStart = (a, b) => (a.start || 0) - (b.start || 0);
  const out = [];
  const walk = (s, depth) => {
    out.push({ span: s, depth });
    (children.get(s.spanId) || []).sort(byStart).forEach((c) => walk(c, depth + 1));
  };
  roots.sort(byStart).forEach((r) => walk(r, 0));
  return out;
}

/** Identity of a step across runs. The model is deliberately NOT part of the
 *  key: swapping models should read as "changed", not "removed + added". */
export function stepKey(span) {
  const name = span.kind === 'tool' ? span.io?.toolName || span.name : span.name;
  return `${span.kind}:${name}`;
}

// Normalise prompt/tool payloads to a string so two runs compare by content,
// not by whether one exporter sent JSON as a string and the other as a value.
export function ioText(v) {
  if (v == null) return '';
  if (typeof v === 'string') {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  return JSON.stringify(v, null, 2);
}

function compact(span, depth) {
  const tokens = span.tokens || null;
  return {
    spanId: span.spanId,
    depth,
    kind: span.kind,
    name: span.name,
    label: span.kind === 'llm' && span.io?.model ? span.io.model : span.io?.toolName || span.name,
    model: span.io?.model || null,
    status: span.status,
    statusMessage: span.statusMessage || '',
    durationMs: span.durationMs || 0,
    tokens,
    costUsd:
      span.kind === 'llm' && tokens ? estimateCost(span.io?.model, tokens.input, tokens.output) : null,
  };
}

/** Classic LCS over step keys → list of [i, j] matched index pairs. */
function lcsPairs(ka, kb) {
  const n = ka.length, m = kb.length;
  // dp[i][j] = LCS length of ka[i..] and kb[j..]
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) {
      pairs.push([i, j]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** What differs between two matched spans. */
function fieldChanges(a, b) {
  const ch = [];
  if (a.status !== b.status) ch.push('status');
  if ((a.io?.model || '') !== (b.io?.model || '')) ch.push('model');
  if (ioText(a.io?.input) !== ioText(b.io?.input)) ch.push('input');
  if (ioText(a.io?.output) !== ioText(b.io?.output)) ch.push('output');
  return ch;
}

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Diff two trace details (as returned by store.detail()).
 * @returns {{a:object,b:object,delta:object,counts:object,rows:Array<object>}}
 */
export function diffTraces(a, b) {
  const oa = treeOrder(a.spans || []);
  const ob = treeOrder(b.spans || []);
  const ka = oa.map(({ span }) => stepKey(span));
  const kb = ob.map(({ span }) => stepKey(span));

  const rows = [];
  const counts = { same: 0, changed: 0, added: 0, removed: 0 };
  let i = 0, j = 0;
  const emit = (type, sa, sb, changes = []) => {
    counts[type]++;
    rows.push({
      type,
      key: sa ? stepKey(sa.span) : stepKey(sb.span),
      a: sa ? compact(sa.span, sa.depth) : null,
      b: sb ? compact(sb.span, sb.depth) : null,
      changes,
    });
  };
  for (const [pi, pj] of lcsPairs(ka, kb)) {
    while (i < pi) emit('removed', oa[i++], null);
    while (j < pj) emit('added', null, ob[j++]);
    const ch = fieldChanges(oa[pi].span, ob[pj].span);
    emit(ch.length ? 'changed' : 'same', oa[pi], ob[pj], ch);
    i = pi + 1;
    j = pj + 1;
  }
  while (i < oa.length) emit('removed', oa[i++], null);
  while (j < ob.length) emit('added', null, ob[j++]);

  const side = (t) => ({
    traceId: t.traceId,
    name: t.name,
    start: t.start,
    durationMs: num(t.durationMs),
    spanCount: num(t.spanCount),
    errorCount: num(t.errorCount),
    llmCalls: num(t.llmCalls),
    toolCalls: num(t.toolCalls),
    tokens: num(t.tokens),
    costUsd: t.costUsd ?? null,
  });
  const A = side(a), B = side(b);
  const delta = {
    durationMs: B.durationMs - A.durationMs,
    spanCount: B.spanCount - A.spanCount,
    errorCount: B.errorCount - A.errorCount,
    llmCalls: B.llmCalls - A.llmCalls,
    toolCalls: B.toolCalls - A.toolCalls,
    tokens: B.tokens - A.tokens,
    // Cost delta only when both sides could be priced; otherwise "unknown".
    costUsd: A.costUsd != null && B.costUsd != null ? B.costUsd - A.costUsd : null,
  };
  return { a: A, b: B, delta, counts, rows };
}
