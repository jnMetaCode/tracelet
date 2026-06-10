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
