// Zero-dependency test suite (Node built-in test runner + assert).
//   node --test test/run.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { parseOtlp } from '../src/otlp.js';
import { decodeTraces } from '../src/otlp-protobuf.js';
import { store } from '../src/store.js';
import { startServer } from '../src/server.js';
import { diffTraces, stepKey } from '../src/diff.js';
import { tracelet as aiSdkTracelet } from '../src/ai-sdk.js';
import { tracelet as lcTracelet } from '../src/langchain.js';

// Golden OTLP/protobuf payload, encoded by protobufjs against the official
// opentelemetry-proto field numbers (see test/gen-fixture.mjs). Decoding this
// validates our zero-dep decoder against the real wire format, not our own.
const GOLDEN_PB_B64 =
  'CpwECiEKHwoMc2VydmljZS5uYW1lEg8KDXdlYXRoZXItYWdlbnQS9gMKDQoEZGVtbxIFMS4wLjASzwIKEFuO//eYA4ED0mm2M4E/xgwSCO7hm37DwbF0IgAqD2FpLmdlbmVyYXRlVGV4dDABOQAAH8zlj9cXQQCMpRPmj9cXShwKDWdlbl9haS5zeXN0ZW0SCwoJYW50aHJvcGljSisKFGdlbl9haS5yZXF1ZXN0Lm1vZGVsEhMKEWNsYXVkZS1zb25uZXQtNC41Sh8KGWdlbl9haS51c2FnZS5pbnB1dF90b2tlbnMSAhgqSiEKGmdlbl9haS51c2FnZS5vdXRwdXRfdG9rZW5zEgMYgAFKGgoJYWkucHJvbXB0Eg0KC2hlbGxvIHRoZXJlShkKEGFpLnJlc3BvbnNlLnRleHQSBQoDaGkhWkAJAGXs6eWP1xcSFWdlbl9haS5jb250ZW50LnByb21wdBoeCg1nZW5fYWkucHJvbXB0Eg0KC2hlbGxvIHRoZXJlegIYARKSAQoQW47/95gDgQPSabYzgT/GDBIIqqEjRWeJC80iCO7hm37DwbF0KgthaS50b29sQ2FsbDABOQBG4u/lj9cXQQDpwwHmj9cXShoKCXRvb2wubmFtZRINCgtnZXRfd2VhdGhlckojChBhaS50b29sQ2FsbC5hcmdzEg8KDXsiY2l0eSI6IlNGIn16CBIEYm9vbRgC';

const s = (v) => ({ stringValue: v });
const iv = (v) => ({ intValue: String(v) });

function envelope(spans, resAttrs = [{ key: 'service.name', value: s('t') }]) {
  return {
    resourceSpans: [
      { resource: { attributes: resAttrs }, scopeSpans: [{ scope: { name: 'x' }, spans }] },
    ],
  };
}

const baseSpan = (over = {}) => ({
  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  spanId: '1111111111111111',
  parentSpanId: '',
  name: 'span',
  kind: 1,
  startTimeUnixNano: '1718000000000000000',
  endTimeUnixNano: '1718000001500000000',
  status: { code: 1 },
  attributes: [],
  events: [],
  ...over,
});

// ---------------------------------------------------------------- parser ---
test('parses Vercel AI SDK ai.* + gen_ai.* span', () => {
  const [sp] = parseOtlp(
    envelope([
      baseSpan({
        name: 'ai.generateText',
        attributes: [
          { key: 'gen_ai.system', value: s('anthropic') },
          { key: 'gen_ai.request.model', value: s('claude-sonnet-4.5') },
          { key: 'gen_ai.usage.input_tokens', value: iv(42) },
          { key: 'gen_ai.usage.output_tokens', value: iv(128) },
          { key: 'ai.prompt', value: s('hello') },
          { key: 'ai.response.text', value: s('hi there') },
        ],
      }),
    ])
  );
  assert.equal(sp.kind, 'llm');
  assert.equal(sp.io.model, 'claude-sonnet-4.5');
  assert.equal(sp.io.system, 'anthropic');
  assert.equal(sp.io.input, 'hello');
  assert.equal(sp.io.output, 'hi there');
  assert.deepEqual(sp.tokens, { input: 42, output: 128, total: 170 });
  assert.equal(sp.durationMs, 1500);
});

test('reassembles OpenInference flattened messages + token_count', () => {
  const [sp] = parseOtlp(
    envelope([
      baseSpan({
        attributes: [
          { key: 'openinference.span.kind', value: s('LLM') },
          { key: 'llm.model_name', value: s('gpt-4o') },
          { key: 'llm.token_count.prompt', value: iv(10) },
          { key: 'llm.token_count.completion', value: iv(20) },
          { key: 'llm.input_messages.0.message.role', value: s('system') },
          { key: 'llm.input_messages.0.message.content', value: s('be nice') },
          { key: 'llm.input_messages.1.message.role', value: s('user') },
          { key: 'llm.input_messages.1.message.content', value: s('hi') },
          { key: 'llm.output_messages.0.message.role', value: s('assistant') },
          { key: 'llm.output_messages.0.message.content', value: s('hello!') },
        ],
      }),
    ])
  );
  assert.equal(sp.kind, 'llm');
  assert.equal(sp.io.model, 'gpt-4o');
  assert.deepEqual(sp.tokens, { input: 10, output: 20, total: 30 });
  assert.deepEqual(sp.io.input, [
    { role: 'system', content: 'be nice' },
    { role: 'user', content: 'hi' },
  ]);
  assert.deepEqual(sp.io.output, [{ role: 'assistant', content: 'hello!' }]);
});

test('falls back to span events for older gen_ai content style', () => {
  const [sp] = parseOtlp(
    envelope([
      baseSpan({
        attributes: [
          { key: 'gen_ai.system', value: s('openai') },
          { key: 'gen_ai.request.model', value: s('gpt-4o-mini') },
        ],
        events: [
          {
            timeUnixNano: '1718000000500000000',
            name: 'gen_ai.content.prompt',
            attributes: [{ key: 'gen_ai.prompt', value: s('event prompt') }],
          },
          {
            timeUnixNano: '1718000000900000000',
            name: 'gen_ai.content.completion',
            attributes: [{ key: 'gen_ai.completion', value: s('event completion') }],
          },
        ],
      }),
    ])
  );
  assert.equal(sp.io.input, 'event prompt');
  assert.equal(sp.io.output, 'event completion');
  assert.equal(sp.events.length, 2);
});

test('detects tool spans and extracts args/result', () => {
  const [sp] = parseOtlp(
    envelope([
      baseSpan({
        name: 'ai.toolCall',
        status: { code: 2 },
        attributes: [
          { key: 'tool.name', value: s('get_weather') },
          { key: 'ai.toolCall.args', value: s('{"city":"SF"}') },
          { key: 'output.value', value: s('{"tempC":14}') },
        ],
      }),
    ])
  );
  assert.equal(sp.kind, 'tool');
  assert.equal(sp.io.toolName, 'get_weather');
  assert.equal(sp.io.input, '{"city":"SF"}');
  assert.equal(sp.io.output, '{"tempC":14}');
  assert.equal(sp.status, 'ERROR');
});

test('nanosecond timestamps keep millisecond precision (no float overflow)', () => {
  const [sp] = parseOtlp(
    envelope([
      baseSpan({
        startTimeUnixNano: '1718000000000000000',
        endTimeUnixNano: '1718000000123000000',
      }),
    ])
  );
  assert.equal(sp.durationMs, 123);
});

test('plain non-LLM span still parses', () => {
  const [sp] = parseOtlp(envelope([baseSpan({ name: 'db.query', attributes: [] })]));
  assert.equal(sp.kind, 'span');
  assert.equal(sp.tokens, undefined);
});

// ----------------------------------------------------------------- store ---
test('store builds trace summary with counts', () => {
  store.clear();
  store.addSpans(parseOtlp(envelope([
    baseSpan({ spanId: 'root', name: 'agent', attributes: [{ key: 'openinference.span.kind', value: s('AGENT') }] }),
    baseSpan({ spanId: 'a', parentSpanId: 'root', name: 'ai.generateText', attributes: [
      { key: 'gen_ai.request.model', value: s('m') },
      { key: 'gen_ai.usage.input_tokens', value: iv(5) },
      { key: 'gen_ai.usage.output_tokens', value: iv(7) },
    ] }),
    baseSpan({ spanId: 'b', parentSpanId: 'root', name: 'ai.toolCall', status: { code: 2 }, attributes: [{ key: 'tool.name', value: s('t') }] }),
  ])));
  const list = store.list();
  assert.equal(list.length, 1);
  const t = list[0];
  assert.equal(t.spanCount, 3);
  assert.equal(t.llmCalls, 1);
  assert.equal(t.toolCalls, 1);
  assert.equal(t.errorCount, 1);
  assert.equal(t.tokens, 12);
});

// -------------------------------------------------------------- protobuf ---
test('protobuf OTLP decodes to the same span shape as JSON (golden fixture)', () => {
  const spans = parseOtlp(decodeTraces(Buffer.from(GOLDEN_PB_B64, 'base64')));
  assert.equal(spans.length, 2);

  const llm = spans.find((s) => s.name === 'ai.generateText');
  assert.equal(llm.kind, 'llm');
  assert.equal(llm.service, 'weather-agent');
  assert.equal(llm.traceId, '5b8efff798038103d269b633813fc60c');
  assert.equal(llm.spanId, 'eee19b7ec3c1b174');
  assert.equal(llm.io.model, 'claude-sonnet-4.5');
  assert.equal(llm.io.system, 'anthropic');
  assert.equal(llm.io.input, 'hello there');
  assert.equal(llm.io.output, 'hi!');
  assert.deepEqual(llm.tokens, { input: 42, output: 128, total: 170 });
  assert.equal(llm.durationMs, 1200); // fixed64 nanos decoded with full precision
  assert.equal(llm.events.length, 1);
  assert.equal(llm.events[0].name, 'gen_ai.content.prompt');

  const tool = spans.find((s) => s.name === 'ai.toolCall');
  assert.equal(tool.kind, 'tool');
  assert.equal(tool.parentSpanId, 'eee19b7ec3c1b174'); // child of the LLM span
  assert.equal(tool.io.toolName, 'get_weather');
  assert.equal(tool.io.input, '{"city":"SF"}');
  assert.equal(tool.status, 'ERROR');
  assert.equal(tool.statusMessage, 'boom');
});

test('spans without timestamps do not flatten the trace window', () => {
  store.clear();
  const tid = 'dddddddddddddddddddddddddddddddd';
  store.addSpans(
    parseOtlp(
      envelope([
        baseSpan({ traceId: tid, spanId: 't1', startTimeUnixNano: '1718000000000000000', endTimeUnixNano: '1718000001000000000' }),
        baseSpan({ traceId: tid, spanId: 't2', startTimeUnixNano: '', endTimeUnixNano: '' }), // no times
      ])
    )
  );
  const sum = store.list().find((t) => t.traceId === tid);
  assert.equal(sum.start, 1718000000000); // the finite span's start, NOT 0
  assert.equal(sum.durationMs, 1000);
  store.clear();
});

// ---------------------------------------------------------------- server ---
function req(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ port, host: '127.0.0.1', method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers })
      );
    });
    r.on('error', reject);
    if (body) r.write(Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

test('HTTP: ingest → list → detail → clear, plus error paths', async (t) => {
  const PORT = 4378;
  const UI = 4381;
  const { ingest, ui } = startServer({ port: PORT, uiPort: UI, open: false });
  await new Promise((r) => setTimeout(r, 150));
  t.after(() => {
    ingest.close();
    ui.close();
  });

  // start from a clean store (the parser/store unit tests share the singleton)
  await req(UI, 'POST', '/api/clear');

  // valid OTLP ingest (unique trace id so this test is self-contained)
  const tid = 'cccccccccccccccccccccccccccccccc';
  const payload = envelope([
    baseSpan({ traceId: tid, spanId: 'r1', name: 'agent.run', attributes: [{ key: 'input.value', value: s('q') }] }),
  ]);
  const ing = await req(PORT, 'POST', '/v1/traces', payload, { 'content-type': 'application/json' });
  assert.equal(ing.status, 200);
  assert.equal(ing.body, '{}'); // ExportTraceServiceResponse

  // list reflects it
  const list = JSON.parse((await req(UI, 'GET', '/api/traces')).body);
  assert.ok(list.some((t) => t.traceId === tid));

  // detail returns the span we sent, with extracted input
  const detail = JSON.parse((await req(UI, 'GET', `/api/traces/${tid}`)).body);
  const span = detail.spans.find((sp) => sp.spanId === 'r1');
  assert.equal(span.io.input, 'q');

  // protobuf OTLP ingests too (the exporter default encoding)
  const pb = await req(PORT, 'POST', '/v1/traces', Buffer.from(GOLDEN_PB_B64, 'base64'), {
    'content-type': 'application/x-protobuf',
  });
  assert.equal(pb.status, 200);
  const afterPb = JSON.parse((await req(UI, 'GET', '/api/traces')).body);
  assert.ok(afterPb.some((t) => t.traceId === '5b8efff798038103d269b633813fc60c'));

  // malformed JSON → 400, server stays up
  const bad = await req(PORT, 'POST', '/v1/traces', '{not json', { 'content-type': 'application/json' });
  assert.equal(bad.status, 400);

  // unknown ingest route 404
  const nf = await req(PORT, 'GET', '/nope');
  assert.equal(nf.status, 404);

  // UI serves index.html
  const idx = await req(UI, 'GET', '/');
  assert.equal(idx.status, 200);
  assert.match(idx.body, /tracelet/);

  // clear empties the store
  await req(UI, 'POST', '/api/clear');
  const after = JSON.parse((await req(UI, 'GET', '/api/traces')).body);
  assert.equal(after.length, 0);
});

test('HTTP: gzip-compressed OTLP ingests', async (t) => {
  const PORT = 4377;
  const UI = 4380;
  const { ingest, ui } = startServer({ port: PORT, uiPort: UI, open: false });
  await new Promise((r) => setTimeout(r, 150));
  t.after(() => {
    ingest.close();
    ui.close();
  });
  const tid = 'ee'.repeat(16);
  const body = gzipSync(Buffer.from(JSON.stringify(envelope([baseSpan({ traceId: tid, spanId: 'g1' })]))));
  const r = await req(PORT, 'POST', '/v1/traces', body, {
    'content-type': 'application/json',
    'content-encoding': 'gzip',
  });
  assert.equal(r.status, 200);
  const list = JSON.parse((await req(UI, 'GET', '/api/traces')).body);
  assert.ok(list.some((t) => t.traceId === tid));
});

test('HTTP: SSE pushes a live event on ingest', async (t) => {
  const PORT = 4379;
  const UI = 4382;
  const { ingest, ui } = startServer({ port: PORT, uiPort: UI, open: false });
  await new Promise((r) => setTimeout(r, 150));
  t.after(() => {
    ingest.close();
    ui.close();
  });

  const got = new Promise((resolve, reject) => {
    const r = http.request({ port: UI, host: '127.0.0.1', method: 'GET', path: '/api/events' }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c.toString();
        if (buf.includes('"type":"trace"')) {
          res.destroy();
          resolve(true);
        }
      });
    });
    r.on('error', reject);
    r.end();
    setTimeout(() => reject(new Error('timeout waiting for SSE')), 2000);
  });

  await new Promise((r) => setTimeout(r, 100));
  await req(PORT, 'POST', '/v1/traces', envelope([baseSpan({ spanId: 'sse1' })]), {
    'content-type': 'application/json',
  });
  assert.equal(await got, true);
});

// ---- cost estimates --------------------------------------------------------
test('estimateCost: longest-prefix model matching, provider prefixes, unknowns', async () => {
  const { estimateCost } = await import('../src/cost.js');
  // claude-sonnet-4-6: $3/MTok in, $15/MTok out
  assert.equal(estimateCost('claude-sonnet-4-6', 1_000_000, 0), 3);
  assert.equal(estimateCost('claude-sonnet-4-6', 0, 1_000_000), 15);
  // longest prefix wins: opus-4-8 is $5/$25, generic old opus is $15/$75
  assert.equal(estimateCost('claude-opus-4-8', 1_000_000, 0), 5);
  assert.equal(estimateCost('claude-opus-4-1-20250805', 1_000_000, 0), 15);
  // provider prefixes are stripped
  assert.equal(estimateCost('anthropic.claude-haiku-4-5', 1_000_000, 0), 1);
  assert.equal(estimateCost('us.anthropic.claude-sonnet-4-6', 1_000_000, 0), 3);
  // unknown models get no estimate, never a guess
  assert.equal(estimateCost('mystery-model-9000', 1_000_000, 0), null);
  assert.equal(estimateCost('', 10, 10), null);
});

test('trace summary carries a cost estimate for known models only', async () => {
  const fs = await import('node:fs');
  void fs;
  store.clear();
  store.addSpans(parseOtlp({
    resourceSpans: [{ scopeSpans: [{ spans: [{
      traceId: 'c0'.repeat(16), spanId: 'd0'.repeat(8), name: 'ai.generateText',
      startTimeUnixNano: '1781100000000000000', endTimeUnixNano: '1781100001000000000',
      attributes: [
        { key: 'gen_ai.request.model', value: { stringValue: 'claude-sonnet-4-6' } },
        { key: 'gen_ai.usage.input_tokens', value: { intValue: 1000 } },
        { key: 'gen_ai.usage.output_tokens', value: { intValue: 500 } },
      ],
    }] }] }],
  }));
  const s = store.summary('c0'.repeat(16));
  // 1000 * $3/M + 500 * $15/M = 0.003 + 0.0075 = 0.0105
  assert.ok(Math.abs(s.costUsd - 0.0105) < 1e-9, String(s.costUsd));
  const d = store.detail('c0'.repeat(16));
  assert.ok(Math.abs(d.spans[0].costUsd - 0.0105) < 1e-9);
  store.clear();
});

// ---- persistence -----------------------------------------------------------
test('--persist: spans survive a store restart via the JSONL file', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tracelet-')), 'traces.jsonl');

  store.clear();
  store.enablePersist(file);
  store.addSpans(parseOtlp({
    resourceSpans: [{ scopeSpans: [{ spans: [{
      traceId: 'e0'.repeat(16), spanId: 'f0'.repeat(8), name: 'persisted.run',
      startTimeUnixNano: '1781100000000000000', endTimeUnixNano: '1781100001000000000',
    }] }] }],
  }));
  assert.ok(fs.readFileSync(file, 'utf8').includes('persisted.run'));

  // simulate restart: wipe memory (not the file), then re-enable
  store.persistFile = null;
  store.traces.clear();
  store.order = [];
  store.enablePersist(file);
  const restored = store.list().find((t) => t.name === 'persisted.run');
  assert.ok(restored, 'trace restored from JSONL');

  // clear() forgets on disk too
  store.clear();
  assert.equal(fs.readFileSync(file, 'utf8'), '');
  store.persistFile = null;
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

// ---- review-pass regressions (0.2.1) ---------------------------------------
test('cost: regional/long provider prefixes strip; total-only spans price as unknown', async () => {
  const { estimateCost } = await import('../src/cost.js');
  assert.equal(estimateCost('apac.anthropic.claude-sonnet-4-6', 1_000_000, 0), 3);
  assert.equal(estimateCost('global.anthropic.claude-haiku-4-5', 1_000_000, 0), 1);
  assert.equal(estimateCost('us-gov.anthropic.claude-sonnet-4-6', 0, 1_000_000), 15);
  // string-typed counts coerce instead of concatenating
  assert.equal(estimateCost('claude-sonnet-4-6', '1000000', '0'), 3);
  // no usable in/out counts -> unknown, never a fake $0
  assert.equal(estimateCost('claude-sonnet-4-6', 0, 0), null);
  assert.equal(estimateCost('claude-sonnet-4-6', undefined, undefined), null);
});

test('string token attributes never corrupt the trace token sum', () => {
  store.clear();
  store.addSpans(parseOtlp({
    resourceSpans: [{ scopeSpans: [{ spans: [
      { traceId: 'aa'.repeat(16), spanId: '01'.repeat(8), name: 'ai.generateText',
        startTimeUnixNano: '1781100000000000000', endTimeUnixNano: '1781100001000000000',
        attributes: [{ key: 'gen_ai.usage.total_tokens', value: { stringValue: '812' } }] },
      { traceId: 'aa'.repeat(16), spanId: '02'.repeat(8), name: 'ai.generateText',
        startTimeUnixNano: '1781100001000000000', endTimeUnixNano: '1781100002000000000',
        attributes: [{ key: 'gen_ai.usage.total_tokens', value: { intValue: 150 } }] },
    ] }] }],
  }));
  assert.equal(store.summary('aa'.repeat(16)).tokens, 962); // not "0812150"
  store.clear();
});

test('--persist: unreadable history file degrades gracefully, server-side state intact', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tracelet-ro-')), 'traces.jsonl');
  fs.writeFileSync(file, '');
  fs.chmodSync(file, 0o000);
  store.clear();
  store.enablePersist(file); // must not throw
  assert.equal(store.persistFile, file);
  fs.chmodSync(file, 0o600);
  store.persistFile = null;
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
  store.clear();
});

// ------------------------------------------------------------------ diff ---
// Build a trace detail (the shape store.detail() returns) from a step list.
function fakeRun(traceId, steps) {
  const spans = steps.map((st, n) => ({
    traceId,
    spanId: `${traceId.slice(0, 2)}${n}`,
    parentSpanId: n === 0 ? null : `${traceId.slice(0, 2)}0`,
    name: st.name,
    kind: st.kind,
    start: 1000 + n * 100,
    end: 1000 + n * 100 + (st.dur ?? 50),
    durationMs: st.dur ?? 50,
    status: st.status || 'OK',
    statusMessage: '',
    tokens: st.tokens,
    io: st.io || {},
    attributes: {},
  }));
  return {
    traceId,
    name: steps[0].name,
    start: 1000,
    end: 1000 + steps.length * 100,
    durationMs: steps.length * 100,
    spanCount: spans.length,
    errorCount: spans.filter((s) => s.status === 'ERROR').length,
    llmCalls: spans.filter((s) => s.kind === 'llm').length,
    toolCalls: spans.filter((s) => s.kind === 'tool').length,
    tokens: spans.reduce((n, s) => n + (s.tokens?.total || 0), 0),
    costUsd: null,
    spans,
  };
}
const AGENT = { name: 'agent.run', kind: 'agent' };
const LLM = (model, extra = {}) => ({ name: 'ai.generateText', kind: 'llm', tokens: { input: 10, output: 5, total: 15 }, ...extra, io: { model, ...extra.io } });
const TOOL = (toolName, extra = {}) => ({ name: 'ai.toolCall', kind: 'tool', ...extra, io: { toolName, ...extra.io } });

test('diff: identical runs → every step "same", zero deltas', () => {
  const a = fakeRun('aa'.repeat(16), [AGENT, LLM('gpt-4o'), TOOL('search')]);
  const b = fakeRun('bb'.repeat(16), [AGENT, LLM('gpt-4o'), TOOL('search')]);
  const d = diffTraces(a, b);
  assert.deepEqual(d.counts, { same: 3, changed: 0, added: 0, removed: 0 });
  assert.equal(d.delta.durationMs, 0);
  assert.equal(d.delta.tokens, 0);
  assert.equal(d.rows.every((r) => r.type === 'same'), true);
});

test('diff: an inserted retry is one "added" row, later steps stay aligned', () => {
  const a = fakeRun('aa'.repeat(16), [AGENT, LLM('gpt-4o'), TOOL('search'), LLM('gpt-4o')]);
  const b = fakeRun('bb'.repeat(16), [AGENT, LLM('gpt-4o'), TOOL('search'), TOOL('search'), LLM('gpt-4o')]);
  const d = diffTraces(a, b);
  assert.deepEqual(d.rows.map((r) => r.type), ['same', 'same', 'same', 'added', 'same']);
  assert.equal(d.rows[3].a, null);
  assert.equal(d.rows[3].b.label, 'search');
  assert.equal(d.delta.spanCount, 1);
  assert.equal(d.delta.toolCalls, 1);
});

test('diff: a dropped tool call is "removed"; the diff is symmetric', () => {
  const a = fakeRun('aa'.repeat(16), [AGENT, TOOL('search'), TOOL('calendar'), LLM('gpt-4o')]);
  const b = fakeRun('bb'.repeat(16), [AGENT, TOOL('search'), LLM('gpt-4o')]);
  assert.deepEqual(diffTraces(a, b).rows.map((r) => r.type), ['same', 'same', 'removed', 'same']);
  assert.deepEqual(diffTraces(b, a).rows.map((r) => r.type), ['same', 'same', 'added', 'same']);
});

test('diff: same step with a different model/status/prompt is "changed" (not removed+added)', () => {
  const a = fakeRun('aa'.repeat(16), [
    AGENT,
    LLM('claude-sonnet-4.5', { io: { input: 'hello', output: 'hi' } }),
    TOOL('calendar', { status: 'ERROR' }),
  ]);
  const b = fakeRun('bb'.repeat(16), [
    AGENT,
    LLM('claude-haiku-4-5', { io: { input: 'hello there', output: 'hi' } }),
    TOOL('calendar', { status: 'OK', io: { output: '{"events":[]}' } }),
  ]);
  const d = diffTraces(a, b);
  assert.deepEqual(d.rows.map((r) => r.type), ['same', 'changed', 'changed']);
  assert.deepEqual(d.rows[1].changes, ['model', 'input']);
  assert.deepEqual(d.rows[2].changes, ['status', 'output']);
  assert.equal(d.delta.errorCount, -1);
  // model rides along in the compact step so the UI can render "A → B"
  assert.equal(d.rows[1].a.model, 'claude-sonnet-4.5');
  assert.equal(d.rows[1].b.model, 'claude-haiku-4-5');
  // priced per side from the model actually used
  assert.ok(d.rows[1].a.costUsd > d.rows[1].b.costUsd);
});

test('diff: JSON payloads compare by content, not by string/object encoding', () => {
  const a = fakeRun('aa'.repeat(16), [AGENT, TOOL('search', { io: { input: '{"q":"sf"}' } })]);
  const b = fakeRun('bb'.repeat(16), [AGENT, TOOL('search', { io: { input: { q: 'sf' } } })]);
  assert.equal(diffTraces(a, b).rows[1].type, 'same');
  assert.equal(stepKey(a.spans[1]), 'tool:search');
});

test('diff: cost delta is unknown unless both runs could be priced', () => {
  const a = fakeRun('aa'.repeat(16), [AGENT, LLM('gpt-4o')]);
  const b = fakeRun('bb'.repeat(16), [AGENT, LLM('gpt-4o')]);
  a.costUsd = 0.01;
  assert.equal(diffTraces(a, b).delta.costUsd, null);
  b.costUsd = 0.004;
  assert.ok(Math.abs(diffTraces(a, b).delta.costUsd - -0.006) < 1e-12);
});

test('HTTP: /api/diff compares two ingested runs; 404 when a side is unknown', async (t) => {
  const PORT = 4398;
  const UI = 4399;
  const { ingest, ui } = startServer({ port: PORT, uiPort: UI, open: false });
  await new Promise((r) => setTimeout(r, 150));
  t.after(() => { ingest.close(); ui.close(); });
  await req(UI, 'POST', '/api/clear');

  const run = (tid, calendarStatus) =>
    envelope([
      baseSpan({ traceId: tid, spanId: 'r0', name: 'agent.run', attributes: [{ key: 'openinference.span.kind', value: s('AGENT') }] }),
      baseSpan({
        traceId: tid, spanId: 'r1', parentSpanId: 'r0', name: 'ai.toolCall', status: { code: calendarStatus },
        attributes: [{ key: 'tool.name', value: s('get_calendar') }],
      }),
    ]);
  const A = 'a'.repeat(32), B = 'b'.repeat(32);
  await req(PORT, 'POST', '/v1/traces', run(A, 2), { 'content-type': 'application/json' });
  await req(PORT, 'POST', '/v1/traces', run(B, 1), { 'content-type': 'application/json' });

  const ok = await req(UI, 'GET', `/api/diff?a=${A}&b=${B}`);
  assert.equal(ok.status, 200);
  const d = JSON.parse(ok.body);
  assert.equal(d.a.traceId, A);
  assert.equal(d.delta.errorCount, -1);
  assert.deepEqual(d.rows.map((r) => r.type), ['same', 'changed']);
  assert.deepEqual(d.rows[1].changes, ['status']);

  const nf = await req(UI, 'GET', `/api/diff?a=${A}&b=nope`);
  assert.equal(nf.status, 404);
  await req(UI, 'POST', '/api/clear');
});

// ---------------------------------------------------------- ai-sdk wiring ---
// Drive the AI SDK v7 telemetry-integration callbacks with synthetic events
// (the shapes `ai` emits) and check the OTLP we POST parses into the spans the
// UI expects. No `ai` dependency needed for this.
function fakeFetch() {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true };
  };
  fn.calls = calls;
  return fn;
}
const V7_USAGE = { inputTokens: 310, outputTokens: 48, totalTokens: 358, inputTokenDetails: {}, outputTokenDetails: {} };

test('ai-sdk integration: root/agent + chat + tool spans with prompts, args, results, usage', async () => {
  const f = fakeFetch();
  const integ = aiSdkTracelet({ url: 'http://x/v1/traces', serviceName: 'svc', fetch: f, flushMs: 5 });
  const callId = 'c1';
  integ.onStart({ callId, operationId: 'ai.generateText', provider: 'anthropic', modelId: 'claude-sonnet-4.5',
    messages: [{ role: 'user', content: 'weather?' }], instructions: 'be brief', functionId: 'weather-agent' });
  integ.onLanguageModelCallStart({ callId, provider: 'anthropic', modelId: 'claude-sonnet-4.5', messages: [{ role: 'user', content: 'weather?' }], tools: [{ name: 'get_weather' }] });
  integ.onLanguageModelCallEnd({ callId, provider: 'anthropic', modelId: 'claude-sonnet-4.5', finishReason: 'tool-calls', usage: V7_USAGE,
    content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'get_weather', input: { city: 'SF' } }], responseId: 'r1' });
  integ.onToolExecutionStart({ callId, toolCall: { toolCallId: 'tc1', toolName: 'get_weather', input: { city: 'SF' } } });
  integ.onToolExecutionEnd({ callId, toolCall: { toolCallId: 'tc1', toolName: 'get_weather' }, toolOutput: { type: 'tool-result', output: { tempC: 14 } }, toolExecutionMs: 3 });
  integ.onEnd({ callId, text: 'foggy', finishReason: 'stop', totalUsage: { inputTokens: 310, outputTokens: 48 } });
  await integ.flush();

  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'http://x/v1/traces');
  const spans = parseOtlp(f.calls[0].body);
  assert.equal(spans.length, 3);
  assert.equal(spans[0].service, 'svc');
  const root = spans.find((s) => s.name === 'ai.generateText');
  const chat = spans.find((s) => s.name.startsWith('chat '));
  const tool = spans.find((s) => s.name === 'ai.toolCall');
  assert.equal(root.kind, 'agent'); // gen_ai.operation.name = invoke_agent
  assert.equal(root.parentSpanId, null);
  assert.equal(root.io.output, 'foggy');
  assert.match(root.io.input, /weather\?/);
  assert.equal(chat.kind, 'llm');
  assert.equal(chat.parentSpanId, root.spanId);
  assert.equal(chat.io.model, 'claude-sonnet-4.5');
  assert.equal(chat.io.system, 'anthropic');
  assert.deepEqual(chat.tokens, { input: 310, output: 48, total: 358 });
  assert.match(chat.io.output, /tool-call/);
  assert.equal(tool.kind, 'tool');
  assert.equal(tool.io.toolName, 'get_weather');
  assert.equal(JSON.parse(tool.io.input).city, 'SF');
  assert.equal(JSON.parse(tool.io.output).tempC, 14);
  assert.equal(tool.status, 'OK');
  // every span shares the trace and is time-bounded
  assert.ok(spans.every((s) => s.traceId === root.traceId && Number.isFinite(s.start) && Number.isFinite(s.end)));
});

test('ai-sdk integration: recordInputs/recordOutputs=false strip content; tool errors and run errors mark spans', async () => {
  const f = fakeFetch();
  const integ = aiSdkTracelet({ url: 'http://x', fetch: f, flushMs: 5 });
  const callId = 'c2';
  integ.onStart({ callId, operationId: 'ai.streamText', provider: 'openai', modelId: 'gpt-4o', messages: [{ role: 'user', content: 'secret' }], recordInputs: false, recordOutputs: false });
  integ.onLanguageModelCallStart({ callId, provider: 'openai', modelId: 'gpt-4o', messages: [{ role: 'user', content: 'secret' }], recordInputs: false, recordOutputs: false });
  integ.onLanguageModelCallEnd({ callId, provider: 'openai', modelId: 'gpt-4o', usage: V7_USAGE, content: [{ type: 'text', text: 'leak' }], recordInputs: false, recordOutputs: false });
  integ.onToolExecutionStart({ callId, toolCall: { toolCallId: 't', toolName: 'db', input: { q: 'x' } } });
  integ.onToolExecutionEnd({ callId, toolCall: { toolCallId: 't' }, toolOutput: { type: 'tool-error', error: new Error('boom') } });
  integ.onError({ callId, error: new Error('run failed') });
  await integ.flush();
  const spans = parseOtlp(f.calls[0].body);
  const raw = JSON.stringify(f.calls[0].body);
  assert.ok(!raw.includes('secret') && !raw.includes('leak'), 'content must not be exported');
  const tool = spans.find((s) => s.name === 'ai.toolCall');
  assert.equal(tool.status, 'ERROR');
  assert.equal(tool.statusMessage, 'boom');
  const root = spans.find((s) => s.name === 'ai.streamText');
  assert.equal(root.status, 'ERROR');
  assert.equal(root.statusMessage, 'run failed');
  assert.deepEqual(spans.find((s) => s.kind === 'llm').tokens, { input: 310, output: 48, total: 358 });
});

test('ai-sdk integration: a failed POST warns once and never throws', async () => {
  const integ = aiSdkTracelet({ url: 'http://x', fetch: async () => { throw new Error('ECONNREFUSED'); }, flushMs: 5 });
  const warn = console.warn; let warned = 0; console.warn = () => warned++;
  try {
    for (const id of ['a', 'b']) { integ.onStart({ callId: id, operationId: 'ai.generateText' }); integ.onEnd({ callId: id }); await integ.flush(); }
  } finally { console.warn = warn; }
  assert.equal(warned, 1);
});

test('store: token totals count only the innermost token-bearing spans (no wrapper double count)', () => {
  store.clear();
  const tid = 'dd'.repeat(16);
  const usage = [
    { key: 'gen_ai.usage.input_tokens', value: iv(100) },
    { key: 'gen_ai.usage.output_tokens', value: iv(10) },
    { key: 'gen_ai.request.model', value: s('gpt-4o') },
  ];
  store.addSpans(parseOtlp(envelope([
    baseSpan({ traceId: tid, spanId: 'root', name: 'ai.generateText', attributes: usage }), // wrapper reports the total…
    baseSpan({ traceId: tid, spanId: 'll1', parentSpanId: 'root', name: 'chat gpt-4o', attributes: usage }), // …and so does the real call
    baseSpan({ traceId: tid, spanId: 'll2', parentSpanId: 'root', name: 'chat gpt-4o', attributes: usage }),
  ])));
  const sum = store.summary(tid);
  assert.equal(sum.tokens, 220); // two model calls, wrapper excluded
  assert.ok(Math.abs(sum.costUsd - 2 * (100 * 2.5 + 10 * 10) / 1e6) < 1e-12);
  store.clear();
});

// -------------------------------------------------------- langchain wiring ---
// Drive the handler with the argument order @langchain/core's CallbackManager
// uses at runtime (parentRunId 4th for chains/tools/models).
const SER = (cls) => ({ lc: 1, type: 'constructor', id: ['langchain', 'x', cls], kwargs: {} });
const AIMsg = (content, extra = {}) => ({ _getType: () => 'ai', content, ...extra });

test('langchain handler: agent → node → chat/tool tree, hidden & anonymous runnables transparent, usage read', async () => {
  const f = fakeFetch();
  const h = lcTracelet({ url: 'http://x', serviceName: 'lc', fetch: f, flushMs: 5 });
  // root graph
  h.handleChainStart(SER('CompiledStateGraph'), { messages: ['hi'] }, 'root', undefined, [], {}, undefined, 'LangGraph');
  // hidden LangGraph plumbing under root → transparent
  h.handleChainStart(SER('RunnableSequence'), {}, 'hidden', 'root', ['graph:step:0', 'langsmith:hidden'], {}, undefined, '__start__');
  h.handleChainEnd({}, 'hidden', 'root');
  // visible node
  h.handleChainStart(SER('RunnableSequence'), { messages: ['hi'] }, 'node1', 'root', ['graph:step:1'], {}, undefined, 'model_request');
  // model call under the node; ls_* metadata is how real models report themselves
  h.handleChatModelStart(SER('ChatAnthropic'), [[{ _getType: () => 'human', content: 'hi' }]], 'llm1', 'node1',
    { invocation_params: { model: 'claude-sonnet-4.5', tools: [{ name: 'get_weather' }] } }, [], { ls_model_name: 'claude-sonnet-4.5', ls_provider: 'anthropic' });
  h.handleLLMEnd({ generations: [[{ text: '', message: AIMsg('', { tool_calls: [{ name: 'get_weather', args: { city: 'SF' }, id: 'tc1' }], usage_metadata: { input_tokens: 300, output_tokens: 40, total_tokens: 340 } }) }]], llmOutput: {} }, 'llm1', 'node1');
  // anonymous routing lambda under the node → transparent; its child attaches to the node
  h.handleChainStart(SER('RunnableLambda'), {}, 'lambda', 'node1', [], {}, undefined, 'RunnableLambda');
  h.handleChainEnd({ output: 'Send' }, 'lambda', 'node1');
  h.handleChainEnd({ output: [] }, 'node1', 'root');
  // tools node + tool run
  h.handleChainStart(SER('RunnableSequence'), {}, 'node2', 'root', ['graph:step:2'], {}, undefined, 'tools');
  h.handleToolStart(SER('DynamicStructuredTool'), '{"city":"SF"}', 'tool1', 'node2', [], {}, 'get_weather', 'tc1');
  h.handleToolEnd({ _getType: () => 'tool', content: '{"tempC":14}' }, 'tool1', 'node2');
  h.handleChainEnd({}, 'node2', 'root');
  h.handleChainEnd({ messages: ['done'] }, 'root', undefined);
  await h.flush();

  const spans = parseOtlp(f.calls[0].body);
  const by = (n) => spans.find((s) => s.name === n);
  assert.deepEqual(spans.map((s) => s.name).sort(), ['LangGraph', 'chat claude-sonnet-4.5', 'execute_tool get_weather', 'model_request', 'tools'].sort());
  assert.equal(by('LangGraph').kind, 'agent');
  assert.equal(by('LangGraph').parentSpanId, null);
  assert.equal(by('model_request').kind, 'chain');
  assert.equal(by('model_request').parentSpanId, by('LangGraph').spanId);
  const chat = by('chat claude-sonnet-4.5');
  assert.equal(chat.kind, 'llm');
  assert.equal(chat.parentSpanId, by('model_request').spanId);
  assert.equal(chat.io.model, 'claude-sonnet-4.5');
  assert.equal(chat.io.system, 'anthropic');
  assert.deepEqual(chat.tokens, { input: 300, output: 40, total: 340 });
  assert.match(chat.io.input, /"role":"human"/);
  assert.match(chat.io.output, /get_weather/);
  const tool = by('execute_tool get_weather');
  assert.equal(tool.kind, 'tool');
  assert.equal(tool.parentSpanId, by('tools').spanId);
  assert.equal(tool.io.toolName, 'get_weather');
  assert.equal(JSON.parse(tool.io.input).city, 'SF');
  assert.equal(JSON.parse(tool.io.output).tempC, 14);
  assert.ok(spans.every((s) => s.traceId === by('LangGraph').traceId));
});

test('langchain handler: errors mark spans; recordInputs/Outputs=false strip content; llmOutput.tokenUsage fallback', async () => {
  const f = fakeFetch();
  const h = lcTracelet({ url: 'http://x', fetch: f, flushMs: 5, recordInputs: false, recordOutputs: false });
  h.handleChainStart(SER('AgentExecutor'), { input: 'secret' }, 'r', undefined, [], {}, undefined, 'agent');
  h.handleLLMStart(SER('OpenAI'), ['secret prompt'], 'l', 'r', { invocation_params: { model: 'gpt-4o' } }, [], {});
  h.handleLLMEnd({ generations: [[{ text: 'leak' }]], llmOutput: { tokenUsage: { promptTokens: 7, completionTokens: 3 } } }, 'l', 'r');
  h.handleToolStart(SER('Tool'), 'secret args', 't', 'r', [], {}, 'db', 'tc');
  h.handleToolError(new Error('db down'), 't', 'r');
  h.handleChainError(new Error('agent failed'), 'r', undefined);
  await h.flush();
  const raw = JSON.stringify(f.calls[0].body);
  assert.ok(!raw.includes('secret') && !raw.includes('leak'));
  const spans = parseOtlp(f.calls[0].body);
  const llm = spans.find((s) => s.kind === 'llm');
  assert.equal(llm.io.model, 'gpt-4o');
  assert.deepEqual(llm.tokens, { input: 7, output: 3, total: 10 });
  assert.equal(spans.find((s) => s.kind === 'tool').status, 'ERROR');
  assert.equal(spans.find((s) => s.kind === 'tool').statusMessage, 'db down');
  assert.equal(spans.find((s) => s.kind === 'agent').statusMessage, 'agent failed');
});

test('search: matches prompts/outputs/tool payloads/models across traces, case-insensitive', async () => {
  store.clear();
  const mk = (tid, spanId, attrs) => baseSpan({ traceId: tid, spanId, attributes: attrs });
  const A = 'ab'.repeat(16), B = 'cd'.repeat(16);
  store.addSpans(parseOtlp(envelope([
    mk(A, 'a1', [{ key: 'gen_ai.request.model', value: s('claude-haiku-4-5') }, { key: 'ai.prompt', value: s('Weather in San Francisco?') }]),
    mk(A, 'a2', [{ key: 'tool.name', value: s('get_calendar') }, { key: 'ai.toolCall.args', value: s('{"date":"today"}') }]),
    mk(B, 'b1', [{ key: 'gen_ai.request.model', value: s('gpt-4o') }, { key: 'ai.response.text', value: s('Bring a JACKET.') }]),
  ])));
  assert.deepEqual(store.search('san francisco'), { [A]: ['a1'] });
  assert.deepEqual(store.search('jacket'), { [B]: ['b1'] });
  assert.deepEqual(store.search('get_calendar'), { [A]: ['a2'] });
  assert.deepEqual(store.search('haiku'), { [A]: ['a1'] });
  assert.deepEqual(store.search('   '), {});
  assert.deepEqual(store.summary(A).models, ['claude-haiku-4-5']);
  assert.deepEqual(store.summary(A).tools, ['get_calendar']);
  store.clear();
});
