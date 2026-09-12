#!/usr/bin/env node
// Send a realistic synthetic agent trace to Tracelet so you can see the UI
// without wiring up a real agent. Zero dependencies (Node 18+ global fetch).
//
//   1. npx @jnmetacode/tracelet             # in one terminal
//   2. node examples/demo.js                # in another
//
// Then watch the trace stream into http://localhost:4321
//
//   node examples/demo.js --compare
//
// sends TWO runs of the same agent — "before" (a tool call fails, the model
// answers without it) and "after" (the tool is fixed, the summariser moved to
// a cheaper model) — so you can try Compare in the UI straight away.

import { randomBytes } from 'node:crypto';

const ENDPOINT = process.env.TRACELET_URL || 'http://localhost:4318/v1/traces';
const COMPARE = process.argv.includes('--compare');

// Random trace/span ids. (An earlier deterministic counter produced the same
// ids in every process, so two demo runs merged into one 30-second trace.)
const hex = (bytes) => randomBytes(bytes).toString('hex');

const s = (v) => ({ stringValue: v });
const i = (v) => ({ intValue: String(v) });

/** Build one agent run. `fixed` = the calendar tool works and the summariser is cheaper. */
function buildRun({ fixed, baseNs }) {
  const ns = (ms) => String(baseNs + Math.round(ms * 1e6));
  const traceId = hex(16);
  const span = ({ spanId, parentSpanId, name, startMs, durMs, attrs, status = 1 }) => ({
    traceId,
    spanId,
    parentSpanId: parentSpanId || '',
    name,
    kind: 1,
    startTimeUnixNano: ns(startMs),
    endTimeUnixNano: ns(startMs + durMs),
    status: { code: status },
    attributes: Object.entries(attrs).map(([key, value]) => ({ key, value })),
    events: [],
  });

  const root = hex(8), llm1 = hex(8), tool1 = hex(8), tool2 = hex(8), llm2 = hex(8);
  const question = 'What is the weather in San Francisco and should I bring a jacket?';
  const answer = fixed
    ? 'It is 14°C and foggy in San Francisco, and your 3pm meeting is outdoors — bring a light jacket.'
    : 'It is 14°C and foggy in San Francisco — yes, bring a light jacket.';

  return [
    span({
      spanId: root,
      name: 'agent.run',
      startMs: 0,
      durMs: fixed ? 3650 : 4200,
      attrs: {
        'openinference.span.kind': s('AGENT'),
        'input.value': s(question),
        'output.value': s(answer),
      },
    }),
    span({
      spanId: llm1,
      parentSpanId: root,
      name: 'ai.generateText',
      startMs: 120,
      durMs: 1400,
      attrs: {
        'gen_ai.system': s('anthropic'),
        'gen_ai.request.model': s('claude-sonnet-4.5'),
        'gen_ai.usage.input_tokens': i(310),
        'gen_ai.usage.output_tokens': i(fixed ? 62 : 48),
        'ai.prompt': s(`User: ${question}\nDecide which tools to call.`),
        'ai.response.text': s(
          fixed
            ? 'I should call get_weather(city="San Francisco") and get_calendar(date="today").'
            : 'I should call get_weather(city="San Francisco").'
        ),
      },
    }),
    span({
      spanId: tool1,
      parentSpanId: root,
      name: 'ai.toolCall',
      startMs: 1600,
      durMs: 650,
      attrs: {
        'openinference.span.kind': s('TOOL'),
        'tool.name': s('get_weather'),
        'ai.toolCall.name': s('get_weather'),
        'ai.toolCall.args': s('{"city":"San Francisco"}'),
        'output.value': s('{"tempC":14,"conditions":"foggy","wind":"12mph"}'),
      },
    }),
    span({
      spanId: tool2,
      parentSpanId: root,
      name: 'ai.toolCall',
      startMs: 2300,
      durMs: fixed ? 210 : 480,
      status: fixed ? 1 : 2,
      attrs: {
        'openinference.span.kind': s('TOOL'),
        'tool.name': s('get_calendar'),
        'ai.toolCall.name': s('get_calendar'),
        'ai.toolCall.args': s(fixed ? '{"date":"2026-06-11"}' : '{"date":"today"}'),
        ...(fixed
          ? { 'output.value': s('{"events":[{"time":"15:00","title":"Design review","location":"Dolores Park"}]}') }
          : {}),
      },
    }),
    span({
      spanId: llm2,
      parentSpanId: root,
      name: 'ai.generateText',
      startMs: fixed ? 2560 : 2850,
      durMs: fixed ? 1000 : 1300,
      attrs: {
        'gen_ai.system': s('anthropic'),
        'gen_ai.request.model': s(fixed ? 'claude-haiku-4-5' : 'claude-sonnet-4.5'),
        'gen_ai.usage.input_tokens': i(fixed ? 470 : 420),
        'gen_ai.usage.output_tokens': i(fixed ? 71 : 64),
        'ai.prompt': s(
          fixed
            ? 'Weather: 14°C foggy.\nCalendar: 15:00 Design review @ Dolores Park (outdoors).\nSummarize and advise on a jacket.'
            : 'Weather: 14°C foggy. Summarize and advise on a jacket.'
        ),
        'ai.response.text': s(answer),
      },
    }),
  ];
}

async function send(spans, label) {
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: s('weather-agent') }] },
        scopeSpans: [{ scope: { name: 'demo', version: '0.1.0' }, spans }],
      },
    ],
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => {
    console.error(`\n✖ Could not reach Tracelet at ${ENDPOINT}`);
    console.error(`  Is it running? Start it with:  npx @jnmetacode/tracelet\n`);
    console.error(`  (${e.message})`);
    process.exit(1);
  });
  if (!res.ok) {
    console.error(`✖ Tracelet returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  console.log(`✓ Sent ${label} (${spans.length} spans) to ${ENDPOINT}`);
}

const now = Date.now() * 1e6; // ns
if (COMPARE) {
  console.log();
  await send(buildRun({ fixed: false, baseNs: now - 30_000 * 1e6 }), 'run A — before (get_calendar fails)');
  await send(buildRun({ fixed: true, baseNs: now }), 'run B — after (tool fixed, summariser on haiku)');
  console.log(`\n  Open http://localhost:4321, select run A, press Compare, then click run B.\n`);
} else {
  console.log();
  await send(buildRun({ fixed: false, baseNs: now }), 'a demo agent trace');
  console.log(`  Open http://localhost:4321 to inspect it.  (--compare sends two runs to diff)\n`);
}
