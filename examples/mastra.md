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
another. Agent runs, model calls and tool executions stream into tracelet as
they happen; Mastra emits OpenTelemetry GenAI (`gen_ai.*`) attributes, which
tracelet renders as LLM / tool spans with prompts, completions and usage.

> Mastra Studio shows a single run. tracelet's **Compare** shows what changed
> between two — pin a baseline and every `mastra dev` run is diffed against it.

Snippet follows Mastra's [OTel exporter docs](https://mastra.ai/en/docs/observability/tracing/exporters/otel);
if a Mastra release changes the config shape, that page is the source of truth.
