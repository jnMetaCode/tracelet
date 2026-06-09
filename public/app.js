// Tracelet UI — vanilla JS, no build step.
const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (txt != null) e.textContent = txt;
  return e;
};

const state = { traces: [], selected: null, detail: null, selectedSpan: null };

const fmtMs = (ms) => (ms < 1 ? '<1ms' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`);
const fmtNum = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

async function api(path, opts) {
  const r = await fetch(path, opts);
  return r.ok ? r.json() : null;
}

// ---- trace list ----------------------------------------------------------
function renderList() {
  const list = $('#trace-list');
  list.innerHTML = '';
  $('#trace-count').textContent = state.traces.length ? `(${state.traces.length})` : '';
  $('#empty').style.display = state.traces.length ? 'none' : 'block';

  for (const t of state.traces) {
    const li = el('li', 'trace-item' + (t.errorCount ? ' has-error' : ''));
    if (t.traceId === state.selected) li.classList.add('active');
    li.appendChild(el('div', 't-name', t.name || t.traceId.slice(0, 12)));
    const meta = el('div', 't-meta');
    meta.appendChild(el('span', null, fmtMs(t.durationMs)));
    if (t.llmCalls) meta.appendChild(el('span', null, `${t.llmCalls} LLM`));
    if (t.toolCalls) meta.appendChild(el('span', null, `${t.toolCalls} tool`));
    if (t.tokens) meta.appendChild(el('span', null, `${fmtNum(t.tokens)} tok`));
    li.appendChild(meta);
    li.onclick = () => selectTrace(t.traceId);
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

function renderTree() {
  const tree = $('#tree');
  tree.innerHTML = '';
  const d = state.detail;
  if (!d) {
    $('#trace-title').textContent = 'Select a trace';
    return;
  }
  const title = $('#trace-title');
  title.innerHTML = '';
  title.appendChild(el('span', null, d.name || d.traceId.slice(0, 16)));
  title.appendChild(
    el('span', 'muted small', `${d.spanCount} spans · ${fmtMs(d.durationMs)} · ${fmtNum(d.tokens)} tok`)
  );

  const t0 = d.start;
  const span = Math.max(1, d.end - d.start);
  for (const { span: s, depth } of buildTree(d.spans)) {
    const row = el('div', 'row' + (s.status === 'ERROR' ? ' err' : ''));
    if (s.spanId === state.selectedSpan) row.classList.add('active');

    const label = el('div', 'label');
    label.style.paddingLeft = `${depth * 14}px`;
    label.appendChild(el('span', `kind ${s.kind}`, s.io?.toolName ? 'tool' : s.kind));
    const nm = s.kind === 'llm' && s.io?.model ? s.io.model : s.io?.toolName || s.name;
    label.appendChild(el('span', 'span-name', nm));
    row.appendChild(label);

    const right = el('div');
    const wrap = el('div', 'bar-wrap');
    const bar = el('div', `bar ${s.kind}` + (s.status === 'ERROR' ? ' err' : ''));
    bar.style.left = `${((s.start - t0) / span) * 100}%`;
    bar.style.width = `${Math.max(1, (s.durationMs / span) * 100)}%`;
    bar.title = fmtMs(s.durationMs);
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

function renderDetail(s) {
  const d = $('#detail');
  d.innerHTML = '';
  d.appendChild(el('h3', null, s.io?.toolName || s.name));
  d.appendChild(el('div', 'sub', `${s.kind.toUpperCase()} · ${fmtMs(s.durationMs)} · ${s.service}`));

  if (s.status === 'ERROR') {
    d.appendChild(el('div', 'err-banner', `Error: ${s.statusMessage || 'span reported ERROR status'}`));
  }

  const chips = el('div', 'chips');
  const chip = (k, v) => {
    const c = el('span', 'chip');
    c.appendChild(el('span', 'k', `${k} `));
    c.appendChild(el('b', null, String(v)));
    chips.appendChild(c);
  };
  if (s.io?.model) chip('model', s.io.model);
  if (s.io?.system) chip('provider', s.io.system);
  if (s.tokens) {
    chip('in', fmtNum(s.tokens.input));
    chip('out', fmtNum(s.tokens.output));
    chip('total', fmtNum(s.tokens.total));
  }
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

// ---- selection / data ----------------------------------------------------
async function selectTrace(id) {
  state.selected = id;
  state.selectedSpan = null;
  renderList();
  state.detail = await api(`/api/traces/${encodeURIComponent(id)}`);
  renderTree();
  $('#detail').innerHTML = '<p class="muted">Select a span to inspect it.</p>';
}

async function refreshList() {
  state.traces = (await api('/api/traces')) || [];
  renderList();
  if (!state.selected && state.traces.length) selectTrace(state.traces[0].traceId);
}

// ---- live updates --------------------------------------------------------
function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => $('#live').className = 'live on', ($('#live').textContent = '● live');
  es.onerror = () => ($('#live').className = 'live off') && ($('#live').textContent = '● reconnecting');
  es.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'clear') {
      state.traces = []; state.selected = null; state.detail = null;
      renderList(); renderTree(); return;
    }
    await refreshList();
    // If the live trace is the one we're viewing, refresh its tree too.
    if (msg.traceId && msg.traceId === state.selected) {
      state.detail = await api(`/api/traces/${encodeURIComponent(msg.traceId)}`);
      renderTree();
    }
  };
}

$('#clear').onclick = () => api('/api/clear', { method: 'POST' });

refreshList();
connect();
