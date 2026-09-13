// Synthetic agent runs for first-run demos: the empty-state button, `--demo`,
// and examples/demo.js all use these. Two runs of the same weather agent —
// "before" (get_calendar fails, answer ignores it) and "after" (tool fixed,
// summariser moved to a cheaper model) — so Compare has something to show.

import { randomBytes } from 'node:crypto';

const hex = (bytes) => randomBytes(bytes).toString('hex');
const s = (v) => ({ stringValue: v });
const i = (v) => ({ intValue: String(v) });

/** One run as an OTLP/JSON ExportTraceServiceRequest. */
export function demoRun({ fixed = false, startMs = Date.now() } = {}) {
  const baseNs = BigInt(Math.round(startMs)) * 1000000n;
  const ns = (ms) => String(baseNs + BigInt(Math.round(ms * 1e6)));
  const traceId = hex(16);
  const span = ({ spanId, parentSpanId, name, startMs: at, durMs, attrs, status = 1 }) => ({
    traceId,
    spanId,
    parentSpanId: parentSpanId || '',
    name,
    kind: 1,
    startTimeUnixNano: ns(at),
    endTimeUnixNano: ns(at + durMs),
    status: { code: status },
    attributes: Object.entries(attrs).map(([key, value]) => ({ key, value })),
    events: [],
  });

  const root = hex(8), llm1 = hex(8), tool1 = hex(8), tool2 = hex(8), llm2 = hex(8);
  const question = 'What is the weather in San Francisco and should I bring a jacket?';
  const answer = fixed
    ? 'It is 14°C and foggy in San Francisco, and your 3pm meeting is outdoors — bring a light jacket.'
    : 'It is 14°C and foggy in San Francisco — yes, bring a light jacket.';

  const spans = [
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

  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: s('weather-agent') }] },
        scopeSpans: [{ scope: { name: 'demo', version: '0.1.0' }, spans }],
      },
    ],
  };
}

/** The before/after pair, 30 s apart, oldest first. */
export function demoPair(now = Date.now()) {
  return [demoRun({ fixed: false, startMs: now - 30_000 }), demoRun({ fixed: true, startMs: now })];
}
