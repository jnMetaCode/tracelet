# Wiring the Vercel AI SDK to tracelet

Two ways, depending on your AI SDK version. Both are verified against a live
tracelet.

## AI SDK v7+ — one line, zero extra packages

AI SDK 7 replaced "bring an OpenTelemetry tracer" with **telemetry
integrations** — plain objects with `onStart` / `onLanguageModelCallStart` /
`onToolExecutionStart` … callbacks that you register once. tracelet ships one.
It speaks OTLP over `fetch` directly, so there is nothing to install besides
tracelet itself, and no `@opentelemetry/*` packages in your app.

```bash
npm i -D @jnmetacode/tracelet
```

```js
// at the top of your entry file (or Next.js instrumentation.ts)
import '@jnmetacode/tracelet/ai-sdk/register';
```

That's it. Every `generateText` / `streamText` in the process now streams to
`http://localhost:4318` while tracelet is running:

```
ai.generateText              ← the run (agent)
├─ chat claude-sonnet-4.5    ← model round-trip 1: prompt, tool definitions, usage
├─ ai.toolCall get_weather   ← args, result (or the error)
└─ chat claude-sonnet-4.5    ← model round-trip 2: completion, usage
```

Prefer explicit registration, or want to configure it? Same thing, two lines:

```js
import { registerTelemetry } from 'ai';
import { tracelet } from '@jnmetacode/tracelet/ai-sdk';

registerTelemetry(
  tracelet({
    serviceName: 'weather-agent',           // default: 'ai-sdk'
    url: 'http://localhost:4318/v1/traces', // default; or set TRACELET_URL
  })
);
```

Per-call options still apply, and privacy flags are honored:

```js
await generateText({
  model,
  prompt,
  tools,
  experimental_telemetry: {
    functionId: 'weather-agent', // becomes the agent name in tracelet
    recordInputs: false,         // prompts/args never leave the process
    recordOutputs: false,        // completions/results neither
  },
});
```

> Already using the official `@ai-sdk/otel` integration with an OTel SDK? Keep
> it — just point the exporter at `http://localhost:4318` (see below). tracelet
> reads the `gen_ai.*` / `ai.*` attributes it emits.

## AI SDK v5 / v6 — via an OpenTelemetry exporter

These versions record spans into whatever OpenTelemetry tracer is active, so
you provide an exporter and point it at tracelet.

### Node / Express / Hono / standalone script

```bash
npm i @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

Create `instrumentation.js` and import it **before** anything that uses the AI SDK:

```js
// instrumentation.js
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
}).start();
```

```js
// app.js
import './instrumentation.js'; // must be first
import { generateText } from 'ai';

const { text } = await generateText({
  model: 'anthropic/claude-sonnet-4.5',
  prompt: 'What is the weather in SF? Use the get_weather tool.',
  experimental_telemetry: { isEnabled: true, functionId: 'weather-agent' },
});
```

### Next.js

`@vercel/otel` reads the standard env vars, so no exporter code is needed:

```bash
npm i @vercel/otel
```

```ts
// instrumentation.ts
import { registerOTel } from '@vercel/otel';
export function register() {
  registerOTel({ serviceName: 'my-agent' });
}
```

```bash
# .env.local
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Set `experimental_telemetry: { isEnabled: true }` on your `generateText` /
`streamText` calls and you'll see traces in tracelet.

> **Either encoding works.** tracelet ingests both OTLP/HTTP **protobuf** (the
> exporter default) and **JSON**, so you don't need to set
> `OTEL_EXPORTER_OTLP_PROTOCOL` at all.
