// Shared OTLP/JSON emitter for the framework integrations (ai-sdk, langchain).
// Builds spans in the wire shape tracelet ingests and POSTs them in small
// batches over `fetch`. Node built-ins only.

import { randomBytes } from 'node:crypto';

export const DEFAULT_URL = 'http://localhost:4318/v1/traces';

export const hex = (bytes) => randomBytes(bytes).toString('hex');
const nowNs = () => (BigInt(Date.now()) * 1000000n).toString();

export function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// OTLP AnyValue encoding for the handful of types we emit.
function anyValue(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(anyValue) } };
  return { stringValue: safeJson(v) };
}

export function toAttributes(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([key, value]) => ({ key, value: anyValue(value) }));
}

// Every exporter created in the process, so one exit hook can flush them all —
// `{ callbacks: [tracelet()] }` written inline creates one per call and must
// not add a process listener each time.
const EXPORTERS = new Set();
let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled || !process.once) return;
  exitHookInstalled = true;
  process.once('beforeExit', () => {
    for (const x of EXPORTERS) void x.flush();
  });
}

export const errorMessage = (e) =>
  e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e ?? 'error');

/**
 * @param {object} opts
 * @param {string} opts.scope        instrumentation scope name (which integration)
 * @param {string} [opts.url]        OTLP/HTTP traces endpoint
 * @param {string} [opts.serviceName]
 * @param {number} [opts.flushMs]    batch window before POSTing
 * @param {Function} [opts.fetch]
 */
export function createExporter({
  scope,
  url = process.env.TRACELET_URL || DEFAULT_URL,
  serviceName = process.env.OTEL_SERVICE_NAME || scope,
  flushMs = 100,
  fetch: fetchImpl = globalThis.fetch,
}) {
  let pending = [];
  let timer = null;
  let warned = false;

  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending.length) return;
    const spans = pending;
    pending = [];
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: toAttributes({ 'service.name': serviceName }) },
          scopeSpans: [{ scope: { name: `@jnmetacode/tracelet/${scope}` }, spans }],
        },
      ],
    });
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (!warned) {
        warned = true;
        console.warn(`tracelet: could not send traces to ${url} (${errorMessage(e)}). Is it running? npx @jnmetacode/tracelet`);
      }
    }
  }

  const exporter = {
    /** Start a span. Not sent until `end`. */
    open({ traceId, parentSpanId, name, attrs = {}, kind = 1 }) {
      return {
        traceId,
        spanId: hex(8),
        parentSpanId: parentSpanId || '',
        name,
        kind,
        startTimeUnixNano: nowNs(),
        attributes: toAttributes(attrs),
        status: { code: 0 },
      };
    },
    /** Seal a span and queue it for the next batch. */
    end(span, { attrs = {}, error } = {}) {
      span.endTimeUnixNano = nowNs();
      span.attributes.push(...toAttributes(attrs));
      span.status = error !== undefined ? { code: 2, message: errorMessage(error) } : { code: 1 };
      pending.push(span);
      if (!timer) {
        timer = setTimeout(flush, flushMs);
        timer.unref?.();
      }
    },
    flush,
  };
  // Don't let a short script exit with the last batch still in the timer.
  EXPORTERS.add(exporter);
  installExitHook();
  return exporter;
}
