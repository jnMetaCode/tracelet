// In-memory trace store with a simple pub/sub for live UI updates.
// Everything stays in this process — nothing is ever written off-machine.

const MAX_TRACES = 500; // ring buffer; oldest traces are evicted

class Store {
  constructor() {
    /** @type {Map<string, {traceId:string, spans:Map<string,object>, start:number, end:number, name:string}>} */
    this.traces = new Map();
    this.order = []; // traceId insertion order for eviction
    this.subscribers = new Set(); // SSE response objects
  }

  addSpans(spans) {
    const touched = new Set();
    for (const span of spans) {
      let trace = this.traces.get(span.traceId);
      if (!trace) {
        trace = {
          traceId: span.traceId,
          spans: new Map(),
          start: span.start,
          end: span.end,
          name: span.name,
        };
        this.traces.set(span.traceId, trace);
        this.order.push(span.traceId);
        this._evict();
      }
      trace.spans.set(span.spanId, span);
      trace.start = Math.min(trace.start, span.start);
      trace.end = Math.max(trace.end, span.end);
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
    return {
      type: 'trace',
      traceId: t.traceId,
      name: t.name,
      start: t.start,
      end: t.end,
      durationMs: t.end - t.start,
      spanCount: spans.length,
      errorCount: spans.filter((s) => s.status === 'ERROR').length,
      llmCalls: spans.filter((s) => s.kind === 'llm').length,
      toolCalls: spans.filter((s) => s.kind === 'tool').length,
      tokens: spans.reduce((n, s) => n + (s.tokens?.total || 0), 0),
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
      spans: [...t.spans.values()].sort((a, b) => a.start - b.start),
    };
  }

  clear() {
    this.traces.clear();
    this.order = [];
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
