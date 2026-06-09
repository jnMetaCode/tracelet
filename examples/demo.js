#!/usr/bin/env node
// Send a realistic synthetic agent trace to Tracelet so you can see the UI
// without wiring up a real agent. Zero dependencies (Node 18+ global fetch).
//
//   1. npx tracelet            # in one terminal
//   2. node examples/demo.js   # in another
//
// Then watch the trace stream into http://localhost:4321

const ENDPOINT = process.env.TRACELET_URL || 'http://localhost:4318/v1/traces';

// Tiny hex id helpers (deterministic-ish; randomness only needs to be unique).
let counter = 1;
const hex = (bytes) =>
  Array.from({ length: bytes }, (_, i) => (((counter++ * 2654435761) >>> (i % 24)) & 0xff))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const BASE = Date.now() * 1e6; // ns
let cursor = 0;
const ns = (ms) => String(BASE + Math.round(ms * 1e6));

const s = (v) => ({ stringValue: v });
const i = (v) => ({ intValue: String(v) });

const traceId = hex(16);

function span({ spanId, parentSpanId, name, startMs, durMs, attrs, status = 1, events }) {
  return {
    traceId,
    spanId,
    parentSpanId: parentSpanId || '',
    name,
    kind: 1,
    startTimeUnixNano: ns(startMs),
    endTimeUnixNano: ns(startMs + durMs),
    status: { code: status },
    attributes: Object.entries(attrs).map(([key, value]) => ({ key, value })),
    events: events || [],
  };
}

const root = hex(8);
const llm1 = hex(8);
const tool1 = hex(8);
const tool2 = hex(8);
const llm2 = hex(8);

const spans = [
  span({
    spanId: root,
    name: 'agent.run',
    startMs: 0,
    durMs: 4200,
    attrs: {
      'openinference.span.kind': s('AGENT'),
      'input.value': s('What is the weather in San Francisco and should I bring a jacket?'),
      'output.value': s('It is 14°C and foggy in San Francisco — yes, bring a light jacket.'),
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
      'gen_ai.usage.output_tokens': i(48),
      'ai.prompt': s('User: What is the weather in San Francisco and should I bring a jacket?\nDecide which tools to call.'),
      'ai.response.text': s('I should call get_weather(city="San Francisco").'),
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
    durMs: 480,
    status: 2,
    attrs: {
      'openinference.span.kind': s('TOOL'),
      'tool.name': s('get_calendar'),
      'ai.toolCall.name': s('get_calendar'),
      'ai.toolCall.args': s('{"date":"today"}'),
    },
  }),
  span({
    spanId: llm2,
    parentSpanId: root,
    name: 'ai.generateText',
    startMs: 2850,
    durMs: 1300,
    attrs: {
      'gen_ai.system': s('anthropic'),
      'gen_ai.request.model': s('claude-sonnet-4.5'),
      'gen_ai.usage.input_tokens': i(420),
      'gen_ai.usage.output_tokens': i(64),
      'ai.prompt': s('Weather: 14°C foggy. Summarize and advise on a jacket.'),
      'ai.response.text': s('It is 14°C and foggy in San Francisco — yes, bring a light jacket.'),
    },
  }),
];

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
  console.error(`  Is it running? Start it with:  npx tracelet\n`);
  console.error(`  (${e.message})`);
  process.exit(1);
});

if (res.ok) {
  console.log(`\n✓ Sent a demo agent trace (${spans.length} spans) to ${ENDPOINT}`);
  console.log(`  Open http://localhost:4321 to inspect it.\n`);
} else {
  console.error(`✖ Tracelet returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}
