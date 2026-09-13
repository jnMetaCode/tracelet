// Tracelet UI — vanilla JS, no build step.
const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (txt != null) e.textContent = txt;
  return e;
};

const state = {
  traces: [],
  selected: null,
  detail: null,
  selectedSpan: null,
  filter: '',
  errorsOnly: false,
  picking: false, // "Compare" pressed, waiting for the second run
  compare: null, // { a, b, data, detailA, detailB, row }
  baseline: null, // traceId every new run is auto-compared against
  known: new Set(), // traceIds already seen, to spot brand-new runs
  hits: {}, // server content search: traceId → [spanId] for the current filter
  zoom: null, // waterfall time window { t0, t1 } (absolute ms), null = whole trace
};

const BASELINE_KEY = 'tracelet.baseline';
const loadBaseline = () => { try { return localStorage.getItem(BASELINE_KEY); } catch { return null; } };
const saveBaseline = (id) => { try { id ? localStorage.setItem(BASELINE_KEY, id) : localStorage.removeItem(BASELINE_KEY); } catch {} };

const fmtMs = (ms) => (ms < 1 ? '<1ms' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`);
const fmtNum = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour12: false }) : '');
// List-price estimate computed server-side (src/cost.js); "~" marks it as such.
const fmtCost = (usd) =>
  usd == null ? '' : usd >= 0.1 ? `~$${usd.toFixed(2)}` : usd >= 0.001 ? `~$${usd.toFixed(4)}` : `~$${usd.toFixed(6)}`;
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±');
const fmtDeltaMs = (d) => `${sign(d)}${fmtMs(Math.abs(d))}`;
const fmtDeltaNum = (d) => `${sign(d)}${fmtNum(Math.abs(d))}`;
const fmtDeltaCost = (d) => (d == null ? '' : `${sign(d)}${fmtCost(Math.abs(d)).slice(1)}`);

async function api(path, opts) {
  try {
    const r = await fetch(path, opts);
    return r.ok ? await r.json() : null;
  } catch {
    return null; // network blip / server restarting — callers treat null as "nothing"
  }
}

// ---- trace list ----------------------------------------------------------
// Name / model / tool matches are answered locally from the summaries; prompt
// and completion content comes from /api/search (see runSearch), merged in.
function visibleTraces() {
  const q = state.filter.trim().toLowerCase();
  const local = (t) =>
    (t.name || '').toLowerCase().includes(q) ||
    t.traceId.startsWith(q) ||
    (t.models || []).some((m) => m.toLowerCase().includes(q)) ||
    (t.tools || []).some((m) => m.toLowerCase().includes(q));
  return state.traces.filter((t) => (!state.errorsOnly || t.errorCount) && (!q || local(t) || state.hits[t.traceId]));
}

let searchTimer = null;
function runSearch() {
  clearTimeout(searchTimer);
  const q = state.filter.trim();
  if (!q) {
    state.hits = {};
    return renderList();
  }
  searchTimer = setTimeout(async () => {
    const hits = (await api(`/api/search?q=${encodeURIComponent(q)}`)) || {};
    if (state.filter.trim() !== q) return; // stale
    state.hits = hits;
    renderList();
    if (!state.compare) renderTree(); // highlight matching spans
  }, 120);
}

function renderList() {
  const list = $('#trace-list');
  list.innerHTML = '';
  const shown = visibleTraces();
  $('#trace-count').textContent = state.traces.length
    ? shown.length === state.traces.length ? `(${state.traces.length})` : `(${shown.length}/${state.traces.length})`
    : '';
  $('#empty').style.display = state.traces.length ? 'none' : 'block';
  $('#pick-hint').hidden = !state.picking;
  const cmp = $('#compare');
  cmp.textContent = state.compare ? 'Exit compare' : state.picking ? 'Cancel' : 'Compare';
  cmp.disabled = !state.compare && !state.picking && !state.selected;
  cmp.classList.toggle('primary', state.picking);

  for (const t of shown) {
    const li = el('li', 'trace-item' + (t.errorCount ? ' has-error' : ''));
    if (t.traceId === state.selected && !state.compare) li.classList.add('active');
    if (state.picking && t.traceId === state.selected) li.classList.add('pick-a');
    const head = el('div', 't-head');
    if (state.compare?.a === t.traceId) head.appendChild(el('span', 'ab a', 'A'));
    if (state.compare?.b === t.traceId) head.appendChild(el('span', 'ab b', 'B'));
    if (state.baseline === t.traceId) head.appendChild(el('span', 'ab base', '📌 base'));
    head.appendChild(el('div', 't-name', t.name || t.traceId.slice(0, 12)));
    head.appendChild(el('span', 't-time', fmtTime(t.start)));
    li.appendChild(head);
    const meta = el('div', 't-meta');
    meta.appendChild(el('span', null, fmtMs(t.durationMs)));
    if (t.llmCalls) meta.appendChild(el('span', null, `${t.llmCalls} LLM`));
    if (t.toolCalls) meta.appendChild(el('span', null, `${t.toolCalls} tool`));
    if (t.tokens) meta.appendChild(el('span', null, `${fmtNum(t.tokens)} tok`));
    if (t.costUsd != null) meta.appendChild(el('span', null, fmtCost(t.costUsd)));
    const n = state.hits[t.traceId]?.length;
    if (n) meta.appendChild(el('span', 'hit-tag', `${n} match${n === 1 ? '' : 'es'}`));
    li.appendChild(meta);
    li.onclick = () => {
      if (state.picking) {
        if (t.traceId !== state.selected) startCompare(state.selected, t.traceId);
        return;
      }
      selectTrace(t.traceId);
    };
    list.appendChild(li);
  }
}

// ---- waterfall tree ------------------------------------------------------
function buildTree(spans) {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const children = new Map();
  const roots = [];
  for (const s of spans) {
    if (s.parentSpanId && byId.has(s.parentSpanId)) {
      if (!children.has(s.parentSpanId)) children.set(s.parentSpanId, []);
      children.get(s.parentSpanId).push(s);
    } else {
      roots.push(s);
    }
  }
  const ordered = [];
  const walk = (s, depth) => {
    ordered.push({ span: s, depth });
    (children.get(s.spanId) || [])
      .sort((a, b) => a.start - b.start)
      .forEach((c) => walk(c, depth + 1));
  };
  roots.sort((a, b) => a.start - b.start).forEach((r) => walk(r, 0));
  return ordered;
}

function kindBadge(s) {
  return el('span', `kind ${s.kind}`, s.io?.toolName || s.kind === 'tool' ? 'tool' : s.kind);
}

function renderTree() {
  if (state.compare) return renderDiff();
  const tree = $('#tree');
  tree.innerHTML = '';
  const d = state.detail;
  const title = $('#trace-title');
  if (!d) {
    title.textContent = 'Select a trace';
    renderPin();
    return;
  }
  title.innerHTML = '';
  renderPin();
  title.appendChild(el('span', null, d.name || d.traceId.slice(0, 16)));
  const stats = el('span', 'muted small');
  stats.appendChild(
    el(
      'span',
      null,
      `${d.spanCount} spans · ${fmtMs(d.durationMs)} · ${fmtNum(d.tokens)} tok` +
        (d.costUsd != null ? ` · ${fmtCost(d.costUsd)}` : '')
    )
  );
  if (state.zoom) {
    const z = el('button', 'btn small zoom-chip', `🔍 ${fmtMs(state.zoom.t0 - d.start)} – ${fmtMs(state.zoom.t1 - d.start)} · reset`);
    z.title = 'Zoomed — click, double-click the waterfall, or press Esc to reset';
    z.onclick = () => setZoom(null);
    stats.appendChild(z);
  }
  title.appendChild(stats);

  const t0 = state.zoom ? state.zoom.t0 : d.start;
  const span = Math.max(1, (state.zoom ? state.zoom.t1 : d.end) - t0);
  for (const { span: s, depth } of buildTree(d.spans)) {
    const row = el('div', 'row' + (s.status === 'ERROR' ? ' err' : ''));
    if (s.spanId === state.selectedSpan) row.classList.add('active');
    if (state.hits[d.traceId]?.includes(s.spanId)) row.classList.add('hit');
    if (state.zoom && Number.isFinite(s.start) && (s.end < state.zoom.t0 || s.start > state.zoom.t1)) row.classList.add('off');

    const label = el('div', 'label');
    label.style.paddingLeft = `${depth * 14}px`;
    label.appendChild(kindBadge(s));
    const nm = s.kind === 'llm' && s.io?.model ? s.io.model : s.io?.toolName || s.name;
    label.appendChild(el('span', 'span-name', nm));
    row.appendChild(label);

    const right = el('div');
    const wrap = el('div', 'bar-wrap');
    const bar = el('div', `bar ${s.kind}` + (s.status === 'ERROR' ? ' err' : ''));
    // Clamp to the window so a zoomed-in bar never spills out of its track.
    const rawLeft = Number.isFinite(s.start) ? ((s.start - t0) / span) * 100 : 0;
    const rawRight = rawLeft + (s.durationMs / span) * 100;
    const lEdge = Math.min(100, Math.max(0, rawLeft));
    const rEdge = Math.min(100, Math.max(0, rawRight));
    bar.style.left = `${lEdge}%`;
    bar.style.width = `${Math.max(rEdge - lEdge, rEdge > 0 && lEdge < 100 ? 0.5 : 0)}%`;
    bar.title = fmtMs(s.durationMs) + (Number.isFinite(s.start) ? ` @ ${fmtMs(s.start - d.start)}` : '');
    wrap.appendChild(bar);
    right.appendChild(wrap);
    right.appendChild(el('div', 'dur', fmtMs(s.durationMs)));
    row.appendChild(right);

    row.onclick = () => {
      state.selectedSpan = s.spanId;
      renderTree();
      renderDetail(s);
    };
    tree.appendChild(row);
  }
}

// ---- waterfall zoom (drag a range on the bars; Esc / double-click resets) --
function setZoom(z) {
  state.zoom = z;
  renderTree();
}

function installZoomDrag() {
  const tree = $('#tree');
  let drag = null; // { x0, rect, box, moved }
  // The click that can follow a drag must not select a row. A drag that ends on
  // a different row than it started on produces no click at all, so use a
  // timestamp rather than a flag that would otherwise eat the next real click.
  let dragEndedAt = 0;
  const trackRect = () => tree.querySelector('.bar-wrap')?.getBoundingClientRect();
  tree.addEventListener('pointerdown', (e) => {
    if (state.compare || !state.detail || e.button !== 0) return;
    const rect = trackRect();
    if (!rect || e.clientX < rect.left || e.clientX > rect.right) return; // only over the bar column
    drag = { x0: e.clientX, rect, box: null, moved: false };
    tree.setPointerCapture?.(e.pointerId);
  });
  tree.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = Math.abs(e.clientX - drag.x0);
    if (!drag.moved && dx < 6) return; // a plain click still selects the row
    drag.moved = true;
    if (!drag.box) {
      drag.box = el('div', 'zoom-sel');
      tree.appendChild(drag.box);
    }
    const treeRect = tree.getBoundingClientRect();
    const a = Math.max(drag.rect.left, Math.min(drag.x0, e.clientX));
    const b = Math.min(drag.rect.right, Math.max(drag.x0, e.clientX));
    drag.box.style.left = `${a - treeRect.left}px`;
    drag.box.style.width = `${Math.max(1, b - a)}px`;
  });
  const finish = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.box?.remove();
    if (!d.moved) return;
    const det = state.detail;
    const t0 = state.zoom ? state.zoom.t0 : det.start;
    const t1 = state.zoom ? state.zoom.t1 : det.end;
    const toT = (x) => t0 + ((Math.max(d.rect.left, Math.min(d.rect.right, x)) - d.rect.left) / d.rect.width) * (t1 - t0);
    const [za, zb] = [toT(d.x0), toT(e.clientX)].sort((p, q) => p - q);
    if (zb - za >= 0.5) setZoom({ t0: za, t1: zb }); // ignore sub-ms slivers
    dragEndedAt = Date.now();
  };
  tree.addEventListener('pointerup', finish);
  tree.addEventListener('pointercancel', () => { drag?.box?.remove(); drag = null; });
  tree.addEventListener('click', (e) => {
    if (Date.now() - dragEndedAt > 300) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  tree.addEventListener('dblclick', () => { if (state.zoom) setZoom(null); });
}

// ---- span detail ---------------------------------------------------------
function ioToText(v) {
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

function chipRow(pairs) {
  const chips = el('div', 'chips');
  for (const [k, v] of pairs) {
    if (v == null || v === '') continue;
    const c = el('span', 'chip');
    c.appendChild(el('span', 'k', `${k} `));
    c.appendChild(el('b', null, String(v)));
    chips.appendChild(c);
  }
  return chips;
}

function renderDetail(s, banner) {
  const d = $('#detail');
  d.innerHTML = '';
  $('#detail-title').textContent = 'Span';
  if (banner) d.appendChild(el('div', 'side-banner', banner));
  d.appendChild(el('h3', null, s.io?.toolName || s.name));
  d.appendChild(el('div', 'sub', `${s.kind.toUpperCase()} · ${fmtMs(s.durationMs)} · ${s.service}`));

  if (s.status === 'ERROR') {
    d.appendChild(el('div', 'err-banner', `Error: ${s.statusMessage || 'span reported ERROR status'}`));
  }

  const chips = chipRow([
    ['model', s.io?.model],
    ['provider', s.io?.system],
    ['in', s.tokens && fmtNum(s.tokens.input)],
    ['out', s.tokens && fmtNum(s.tokens.output)],
    ['total', s.tokens && fmtNum(s.tokens.total)],
    ['cost', fmtCost(s.costUsd)],
  ]);
  if (chips.children.length) d.appendChild(chips);

  const section = (title, content, cls = 'block io') => {
    if (!content) return;
    const sec = el('div', 'section');
    sec.appendChild(el('div', 'h', title));
    sec.appendChild(el('div', cls, content));
    d.appendChild(sec);
  };
  section(s.kind === 'tool' ? 'Arguments' : 'Input / Prompt', ioToText(s.io?.input));
  section(s.kind === 'tool' ? 'Result' : 'Output / Completion', ioToText(s.io?.output));

  // Raw attributes (collapsed-ish kv grid)
  const keys = Object.keys(s.attributes || {});
  if (keys.length) {
    const sec = el('div', 'section');
    sec.appendChild(el('div', 'h', `Attributes (${keys.length})`));
    const kv = el('div', 'kv');
    for (const k of keys.sort()) {
      kv.appendChild(el('div', 'key', k));
      const v = s.attributes[k];
      kv.appendChild(el('div', 'val', typeof v === 'object' ? JSON.stringify(v) : String(v)));
    }
    sec.appendChild(kv);
    d.appendChild(sec);
  }
}

// ---- compare two runs ----------------------------------------------------
async function startCompare(a, b) {
  state.picking = false;
  const [detailA, detailB, data] = await Promise.all([
    api(`/api/traces/${encodeURIComponent(a)}`),
    api(`/api/traces/${encodeURIComponent(b)}`),
    api(`/api/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  ]);
  if (!data || !detailA || !detailB) return selectTrace(a); // a side vanished (evicted / cleared)
  state.compare = { a, b, data, detailA, detailB, row: null };
  location.hash = `compare=${a},${b}`;
  renderList();
  renderDiff();
  // Land on the first difference so the answer is on screen immediately.
  const first = data.rows.findIndex((r) => r.type !== 'same');
  if (first >= 0) selectDiffRow(first);
  else {
    $('#detail').innerHTML = '';
    $('#detail').appendChild(el('p', 'muted', 'The two runs took identical steps. Click a row to compare timings.'));
  }
}

function exitCompare() {
  const id = state.compare?.a || state.selected;
  state.compare = null;
  state.picking = false;
  if (id) return selectTrace(id); // reloads detail — state.detail may belong to another run
  location.hash = '';
  renderList();
  renderTree();
}

function deltaEl(text, good) {
  return el('span', 'delta ' + (good == null ? '' : good ? 'good' : 'bad'), text);
}

function renderPin() {
  const btn = $('#pin');
  btn.hidden = !state.selected || !!state.compare;
  const pinned = state.baseline && state.baseline === state.selected;
  btn.textContent = pinned ? '📌 Baseline · unpin' : 'Pin as baseline';
  btn.classList.toggle('primary', !!pinned);
}

function togglePin() {
  if (!state.selected) return;
  state.baseline = state.baseline === state.selected ? null : state.selected;
  saveBaseline(state.baseline);
  renderList();
  renderPin();
}

function renderDiff() {
  const { data, row: active } = state.compare;
  $('#pin').hidden = true;
  const { a, b, delta, counts, rows } = data;
  const title = $('#trace-title');
  title.innerHTML = '';
  const left = el('span', 'cmp-title');
  left.appendChild(el('span', 'ab a', 'A'));
  if (state.baseline === a.traceId) left.appendChild(el('span', 'ab base', '📌 base'));
  left.appendChild(el('span', null, `${a.name} ${fmtTime(a.start)}`));
  left.appendChild(el('span', 'muted', ' → '));
  left.appendChild(el('span', 'ab b', 'B'));
  left.appendChild(el('span', null, `${b.name} ${fmtTime(b.start)}`));
  title.appendChild(left);
  const exit = el('button', 'btn small', 'Exit');
  exit.onclick = exitCompare;
  title.appendChild(exit);

  const tree = $('#tree');
  tree.innerHTML = '';

  // Headline deltas: B relative to A. Less time / fewer tokens / fewer errors is "good".
  const sum = el('div', 'diff-summary');
  const stat = (label, valueEl) => {
    const s = el('div', 'stat');
    s.appendChild(el('div', 'k', label));
    s.appendChild(valueEl);
    sum.appendChild(s);
  };
  stat('latency', deltaEl(`${fmtMs(a.durationMs)} → ${fmtMs(b.durationMs)}  ${fmtDeltaMs(delta.durationMs)}`, delta.durationMs === 0 ? null : delta.durationMs < 0));
  stat('tokens', deltaEl(`${fmtNum(a.tokens)} → ${fmtNum(b.tokens)}  ${fmtDeltaNum(delta.tokens)}`, delta.tokens === 0 ? null : delta.tokens < 0));
  stat(
    'cost',
    delta.costUsd == null
      ? el('span', 'muted', 'unknown')
      : deltaEl(`${fmtCost(a.costUsd)} → ${fmtCost(b.costUsd)}  ${fmtDeltaCost(delta.costUsd)}`, delta.costUsd === 0 ? null : delta.costUsd < 0)
  );
  stat('errors', deltaEl(`${a.errorCount} → ${b.errorCount}`, delta.errorCount === 0 ? null : delta.errorCount < 0));
  const steps = el('span', 'steps');
  steps.appendChild(el('span', 'same', `${counts.same} same`));
  if (counts.changed) steps.appendChild(el('span', 'changed', `${counts.changed} changed`));
  if (counts.added) steps.appendChild(el('span', 'added', `+${counts.added} added`));
  if (counts.removed) steps.appendChild(el('span', 'removed', `−${counts.removed} removed`));
  stat('steps', steps);
  tree.appendChild(sum);

  const head = el('div', 'drow head');
  head.append(el('div', null, 'step'), el('div', 'c', 'A'), el('div', 'c', 'B'), el('div', 'c', 'Δ'));
  tree.appendChild(head);

  rows.forEach((r, i) => {
    const s = r.a || r.b;
    const row = el('div', `drow ${r.type}` + (i === active ? ' active' : ''));
    const label = el('div', 'label');
    label.style.paddingLeft = `${s.depth * 14}px`;
    label.appendChild(el('span', 'mark', { same: '', changed: '~', added: '+', removed: '−' }[r.type]));
    label.appendChild(el('span', `kind ${s.kind}`, s.kind === 'tool' ? 'tool' : s.kind));
    const nm = r.type === 'changed' && r.changes.includes('model') ? `${r.a.label} → ${r.b.label}` : s.label;
    const nameEl = el('span', 'span-name' + (s.status === 'ERROR' ? ' is-err' : ''), nm);
    nameEl.title = nm;
    label.appendChild(nameEl);
    // Short chip labels keep the step name readable in a narrow pane.
    const CHIP = { input: 'in', output: 'out', status: 'status' };
    for (const c of r.changes) if (c !== 'model') {
      const chip = el('span', 'chg', CHIP[c] || c);
      chip.title = `${c} changed`;
      label.appendChild(chip);
    }
    row.appendChild(label);

    const cell = (x) => {
      const c = el('div', 'c' + (x?.status === 'ERROR' ? ' is-err' : ''));
      if (!x) c.textContent = '—';
      else {
        c.appendChild(el('span', null, fmtMs(x.durationMs)));
        if (x.tokens?.total) c.appendChild(el('span', 'muted', ` ${fmtNum(x.tokens.total)}t`));
        if (x.status === 'ERROR') c.appendChild(el('span', 'is-err', ' ✗'));
      }
      return c;
    };
    row.appendChild(cell(r.a));
    row.appendChild(cell(r.b));
    const dcell = el('div', 'c');
    if (r.a && r.b) {
      const dd = r.b.durationMs - r.a.durationMs;
      dcell.appendChild(deltaEl(fmtDeltaMs(dd), dd === 0 ? null : dd < 0));
    }
    row.appendChild(dcell);
    row.onclick = () => selectDiffRow(i);
    tree.appendChild(row);
  });
}

function selectDiffRow(i) {
  state.compare.row = i;
  renderDiff();
  const r = state.compare.data.rows[i];
  const spanA = r.a && state.compare.detailA.spans.find((s) => s.spanId === r.a.spanId);
  const spanB = r.b && state.compare.detailB.spans.find((s) => s.spanId === r.b.spanId);
  if (!spanA || !spanB) {
    return renderDetail(spanA || spanB, spanA ? 'Only in run A — this step was removed in B' : 'Only in run B — this step was added');
  }
  const d = $('#detail');
  d.innerHTML = '';
  $('#detail-title').textContent = 'A → B';
  d.appendChild(el('h3', null, spanB.io?.toolName || spanB.name));
  d.appendChild(el('div', 'sub', `${spanB.kind.toUpperCase()} · ${r.changes.length ? r.changes.join(', ') + ' changed' : 'same step, compare timings'}`));
  if (spanA.status === 'ERROR' || spanB.status === 'ERROR') {
    d.appendChild(el('div', 'err-banner', `A: ${spanA.status}${spanA.statusMessage ? ' — ' + spanA.statusMessage : ''}\nB: ${spanB.status}${spanB.statusMessage ? ' — ' + spanB.statusMessage : ''}`));
  }
  const arrow = (fa, fb) => (fa === fb ? fa : `${fa ?? '—'} → ${fb ?? '—'}`);
  const chips = chipRow([
    ['model', spanA.io?.model || spanB.io?.model ? arrow(spanA.io?.model, spanB.io?.model) : null],
    ['latency', arrow(fmtMs(spanA.durationMs), fmtMs(spanB.durationMs))],
    ['tokens', spanA.tokens || spanB.tokens ? arrow(fmtNum(spanA.tokens?.total ?? 0), fmtNum(spanB.tokens?.total ?? 0)) : null],
    ['cost', r.a.costUsd != null || r.b.costUsd != null ? arrow(fmtCost(r.a.costUsd), fmtCost(r.b.costUsd)) : null],
  ]);
  d.appendChild(chips);

  const isTool = spanB.kind === 'tool';
  diffSection(d, isTool ? 'Arguments' : 'Input / Prompt', ioToText(spanA.io?.input), ioToText(spanB.io?.input));
  diffSection(d, isTool ? 'Result' : 'Output / Completion', ioToText(spanA.io?.output), ioToText(spanB.io?.output));
}

function diffSection(parent, title, ta, tb) {
  if (!ta && !tb) return;
  const sec = el('div', 'section');
  const h = el('div', 'h', title);
  sec.appendChild(h);
  if (ta === tb) {
    h.appendChild(el('span', 'muted', ' · identical'));
    sec.appendChild(el('div', 'block io dim', ta));
    parent.appendChild(sec);
    return;
  }
  const ops = lineDiff(ta.split('\n'), tb.split('\n'));
  const block = el('div', 'block diff');
  if (!ops) {
    // Too large for an in-browser diff — show both sides instead.
    block.appendChild(el('div', 'dl del', `— A (${ta.length} chars)\n${ta}`));
    block.appendChild(el('div', 'dl add', `+ B (${tb.length} chars)\n${tb}`));
  } else {
    for (const line of collapseContext(ops)) {
      block.appendChild(el('div', `dl ${line.t}`, line.s));
    }
  }
  sec.appendChild(block);
  parent.appendChild(sec);
}

// Line-level LCS diff → [{t:'ctx'|'add'|'del', s}]; null when too big to be quick.
function lineDiff(A, B) {
  const n = A.length, m = B.length;
  if (n * m > 1_500_000) return null;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) out.push({ t: 'ctx', s: A[i++] }), j++;
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) out.push({ t: 'add', s: B[j++] });
    else out.push({ t: 'del', s: A[i++] });
  }
  return out;
}

// Keep 2 lines of context around each change; fold the rest.
function collapseContext(ops, ctx = 2) {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, i) => {
    if (o.t === 'ctx') return;
    for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true;
  });
  const out = [];
  let skipped = 0;
  const flush = () => {
    if (skipped) out.push({ t: 'skip', s: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
    skipped = 0;
  };
  ops.forEach((o, i) => {
    if (keep[i]) flush(), out.push(o);
    else skipped++;
  });
  flush();
  return out;
}

// ---- selection / data ----------------------------------------------------
async function selectTrace(id) {
  if (state.compare) state.compare = null;
  state.selected = id;
  state.selectedSpan = null;
  state.zoom = null;
  location.hash = `trace=${id}`;
  renderList();
  const detail = await api(`/api/traces/${encodeURIComponent(id)}`);
  if (state.selected !== id || state.compare) return; // superseded while loading
  state.detail = detail;
  renderTree();
  $('#detail').innerHTML = '<p class="muted">Select a span to inspect it.</p>';
  $('#detail-title').textContent = 'Span';
}

async function refreshList({ autoSelect = true } = {}) {
  state.traces = (await api('/api/traces')) || [];
  for (const t of state.traces) state.known.add(t.traceId);
  if (state.baseline && !state.traces.some((t) => t.traceId === state.baseline)) {
    state.baseline = null; // evicted or cleared
    saveBaseline(null);
  }
  renderList();
  if (autoSelect && !state.selected && state.traces.length) selectTrace(state.traces[0].traceId);
}

// ---- live updates --------------------------------------------------------
function setLive(on, text) {
  const e = $('#live');
  e.className = 'live ' + (on ? 'on' : 'off');
  e.textContent = text;
}

function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => setLive(true, '● live');
  es.onerror = () => setLive(false, '● reconnecting');
  es.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'clear') {
      state.traces = []; state.selected = null; state.detail = null; state.compare = null; state.picking = false;
      state.known.clear(); state.baseline = null; saveBaseline(null); state.hits = {};
      renderList(); renderTree(); return;
    }
    const isNew = msg.traceId && !state.known.has(msg.traceId);
    await refreshList();
    if (isNew && state.baseline && msg.traceId !== state.baseline && state.traces.some((t) => t.traceId === state.baseline)) {
      // A pinned baseline turns every new run into a regression check.
      state.selected = state.baseline;
      await startCompare(state.baseline, msg.traceId);
      return;
    }
    if (state.compare && (msg.traceId === state.compare.a || msg.traceId === state.compare.b)) {
      // One side is still streaming — recompute the comparison.
      const { a, b, row } = state.compare;
      await startCompare(a, b);
      if (row != null && state.compare?.data.rows[row]) selectDiffRow(row);
      return;
    }
    // If the live trace is the one we're viewing, refresh its tree too.
    if (msg.traceId && msg.traceId === state.selected) {
      state.detail = await api(`/api/traces/${encodeURIComponent(msg.traceId)}`);
      renderTree();
    }
  };
}

// ---- controls ------------------------------------------------------------
$('#clear').onclick = () => api('/api/clear', { method: 'POST' });
$('#filter').oninput = (e) => { state.filter = e.target.value; renderList(); runSearch(); };
$('#errors-only').onchange = (e) => { state.errorsOnly = e.target.checked; renderList(); };
$('#compare').onclick = () => {
  if (state.compare) return exitCompare();
  state.picking = !state.picking;
  renderList();
};
$('#pin').onclick = togglePin;
installZoomDrag();
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  if (e.key === 'p' && !state.compare) togglePin();
  if (e.key === '/') { e.preventDefault(); $('#filter').focus(); }
  if (e.key === 'Escape' && state.picking) { state.picking = false; renderList(); }
  if (e.key === 'Escape' && state.zoom && !state.compare) setZoom(null);
  if (e.key === 'c' && !state.compare && state.selected) { state.picking = !state.picking; renderList(); }
});

// Deep links: #trace=<id> or #compare=<a>,<b> (handy for a second tab).
async function boot() {
  state.baseline = loadBaseline();
  // Read the deep link first: refreshList() auto-selects a trace, and
  // selectTrace() rewrites the hash.
  const h = new URLSearchParams(location.hash.slice(1));
  const has = (id) => state.traces.some((t) => t.traceId === id);
  try {
    await refreshList({ autoSelect: !h.get('compare') && !h.get('trace') });
    renderList();
    const [a, b] = (h.get('compare') || '').split(',');
    if (a && b && has(a) && has(b)) {
      state.selected = a;
      await startCompare(a, b);
    } else if (h.get('trace') && has(h.get('trace'))) {
      await selectTrace(h.get('trace'));
    } else if (!state.selected && state.traces.length) {
      await selectTrace(state.traces[0].traceId); // deep link pointed at a run that's gone
    }
  } finally {
    connect(); // whatever happened above, the live feed must open
  }
}
boot();
