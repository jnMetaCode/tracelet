# Wiring the Vercel AI SDK to tracelet

The AI SDK only *records* spans into whatever OpenTelemetry tracer is active —
you provide the exporter. Point it at tracelet's ingest endpoint and you're done.

## Node / Express / Hono / standalone script

Install the OTel bits (these are the only deps, and only in *your* app):

```bash
npm i @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

Create `instrumentation.js` and import it **before** anything that uses the AI SDK:

```js
// instrumentation.js
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces', // ← tracelet
  }),
});
sdk.start();
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

Run tracelet in one terminal (`npx @jnmetacode/tracelet`), your app in another, and the
`ai.generateText` / `ai.toolCall` spans stream into the UI live.

## Next.js

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
