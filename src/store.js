// In-memory trace store with a simple pub/sub for live UI updates.
// Everything stays in this process — nothing is ever written off-machine.
// Opt-in: --persist <file> additionally appends each ingested span batch to a
// local JSONL file and reloads it on start, so a restart keeps your history
// (still local-only; delete the file to forget everything).
import fs from 'node:fs';
import { estimateCost, estimateTraceCost } from './cost.js';

const MAX_TRACES = 500; // ring buffer; oldest traces are evicted

class Store {
  constructor() {
    /** @type {Map<string, {traceId:string, spans:Map<string,object>, start:number, end:number, name:string}>} */
    this.traces = new Map();
    this.order = []; // traceId insertion order for eviction
    this.subscribers = new Set(); // SSE response objects
  }

  /** Load history from a JSONL file (if present), then append future batches. */
  enablePersist(file) {
    this.persistFile = null; // don't re-append while loading
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      let loaded = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.addSpans(JSON.parse(line));
          loaded++;
        } catch {
          /* skip a torn/corrupt line rather than refusing to start */
        }
      }
      // Compact: rewrite with only the spans the ring buffer retained.
      const batches = this.order.map((id) => [...this.traces.get(id).spans.values()]);
      fs.writeFileSync(file, batches.map((b) => JSON.stringify(b)).join('\n') + (batches.length ? '\n' : ''));
      this.loadedBatches = loaded;
    }
    this.persistFile = file;
  }

  addSpans(spans) {
    if (this.persistFile && spans.length) {
      try {
        fs.appendFileSync(this.persistFile, JSON.stringify(spans) + '\n');
      } catch {
        /* persistence is best-effort; never block ingest */
      }
    }
    const touched = new Set();
    for (const span of spans) {
      let trace = this.traces.get(span.traceId);
      if (!trace) {
        trace = {
          traceId: span.traceId,
          spans: new Map(),
          start: Infinity,
          end: -Infinity,
          name: span.name,
        };
        this.traces.set(span.traceId, trace);
        this.order.push(span.traceId);
        this._evict();
      }
      trace.spans.set(span.spanId, span);
      // Only fold in finite timestamps — a span with no times must not pin the
      // trace window to epoch 0 and flatten the whole waterfall.
      if (Number.isFinite(span.start)) trace.start = Math.min(trace.start, span.start);
      if (Number.isFinite(span.end)) trace.end = Math.max(trace.end, span.end);
      // The root span (no parent) names the trace.
      if (!span.parentSpanId) trace.name = span.name;
      touched.add(span.traceId);
    }
    for (const traceId of touched) this._broadcast(this.summary(traceId));
  }

  _evict() {
    while (this.order.length > MAX_TRACES) {
      const id = this.order.shift();
      this.traces.delete(id);
    }
  }

  summary(traceId) {
    const t = this.traces.get(traceId);
    if (!t) return null;
    const spans = [...t.spans.values()];
    const bounded = Number.isFinite(t.start) && Number.isFinite(t.end);
    return {
      type: 'trace',
      traceId: t.traceId,
      name: t.name,
      start: bounded ? t.start : 0,
      end: bounded ? t.end : 0,
      durationMs: bounded ? t.end - t.start : 0,
      spanCount: spans.length,
      errorCount: spans.filter((s) => s.status === 'ERROR').length,
      llmCalls: spans.filter((s) => s.kind === 'llm').length,
      toolCalls: spans.filter((s) => s.kind === 'tool').length,
      tokens: spans.reduce((n, s) => n + (s.tokens?.total || 0), 0),
      costUsd: estimateTraceCost(spans),
    };
  }

  list() {
    return this.order
      .map((id) => this.summary(id))
      .filter(Boolean)
      .reverse();
  }

  detail(traceId) {
    const t = this.traces.get(traceId);
    if (!t) return null;
    return {
      ...this.summary(traceId),
      spans: [...t.spans.values()]
        .sort((a, b) => a.start - b.start)
        .map((s) =>
          s.kind === 'llm' && s.tokens
            ? { ...s, costUsd: estimateCost(s.io?.model, s.tokens.input, s.tokens.output) }
            : s
        ),
    };
  }

  clear() {
    this.traces.clear();
    this.order = [];
    if (this.persistFile) {
      try {
        fs.writeFileSync(this.persistFile, ''); // Clear means forget — on disk too
      } catch {}
    }
    this._broadcast({ type: 'clear' });
  }

  subscribe(res) {
    this.subscribers.add(res);
  }

  unsubscribe(res) {
    this.subscribers.delete(res);
  }

  _broadcast(payload) {
    if (!payload) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.subscribers) {
      try {
        res.write(data);
      } catch {
        this.subscribers.delete(res);
      }
    }
  }
}

export const store = new Store();
