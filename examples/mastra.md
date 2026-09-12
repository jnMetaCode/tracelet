# Wiring Mastra to tracelet

Mastra's tracing already speaks OTLP through `@mastra/otel-exporter`, so no
tracelet-specific code is needed — point the exporter's `custom` provider at
tracelet's ingest endpoint.

```bash
npm i @mastra/otel-exporter @opentelemetry/exporter-trace-otlp-proto
```

```ts
// src/mastra/index.ts
import { Mastra } from '@mastra/core';
import { Observability } from '@mastra/observability';
import { OtelExporter } from '@mastra/otel-exporter';

export const mastra = new Mastra({
  // …agents, workflows…
  observability: new Observability({
    configs: {
      otel: {
        serviceName: 'my-agent',
        exporters: [
          new OtelExporter({
            provider: {
              custom: {
                endpoint: 'http://localhost:4318/v1/traces', // ← tracelet
                protocol: 'http/protobuf', // 'http/json' works too
              },
            },
          }),
        ],
      },
    },
  }),
});
```

Run tracelet in one terminal (`npx @jnmetacode/tracelet`) and `mastra dev` in
another. Mastra emits OpenTelemetry GenAI (`gen_ai.*`) spans, which tracelet
renders as:

```
invoke_agent weather              ← the run (agent)
└─ chat claude-sonnet-4.5         ← prompt messages, completion, usage
   ├─ model_step weather
   │  ├─ model_inference weather
   │  └─ execute_tool getWeather  ← args, result
   └─ model_step weather
      └─ model_inference weather
```

> **Traces show up ~5 s after a run.** `@mastra/otel-exporter` uses a
> BatchSpanProcessor with a 5-second delay. In `mastra dev` that's invisible;
> in a short script, keep the process alive a few seconds (or call the
> exporter's `shutdown()`) before exiting.

> Mastra Studio shows a single run. tracelet's **Compare** shows what changed
> between two — pin a baseline and every `mastra dev` run is diffed against it.

Verified against `@mastra/core` 1.66 + `@mastra/observability` 1.17 +
`@mastra/otel-exporter` 1.3 (an `Agent` with a tool, invoked through
`mastra.getAgent()`). Config shape follows Mastra's
[OTel exporter docs](https://mastra.ai/en/docs/observability/tracing/exporters/otel);
if a release changes it, that page is the source of truth.
