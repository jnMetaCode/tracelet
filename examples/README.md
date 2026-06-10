# tracelet — a worked example

`tracelet` is local DevTools for AI agents: point any OpenTelemetry exporter at
`localhost:4318` and watch your agent's execution tree stream in **live** — LLM
calls, tool calls, prompts, tokens, latency, errors — in a clean local UI.

## See it in 30 seconds (no real agent needed)

```bash
# terminal 1 — start tracelet (UI opens at http://localhost:4321)
npx @jnmetacode/tracelet

# terminal 2 — send a synthetic multi-span agent trace
node examples/demo.js
#   ✓ Sent a demo agent trace (5 spans) to http://localhost:4318/v1/traces
```

Now look at `http://localhost:4321`: a waterfall with an `agent.run` root, two
LLM calls, two tool calls (one errored), prompts/responses and token counts in the
inspector. `examples/demo.js` is ~80 lines of zero-dep OTLP JSON you can read.

## Wire up a real agent

tracelet is just an OTLP endpoint, so anything that emits OpenTelemetry works.
Point your exporter at the ingest URL — both protobuf (the default) and JSON are
accepted, so usually no config beyond:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

- **Vercel AI SDK** — set `experimental_telemetry: { isEnabled: true }` and export
  OTLP. Full walkthrough: [`vercel-ai-sdk.md`](vercel-ai-sdk.md).
- **Python** (LangChain, CrewAI, OpenAI Agents SDK, hand-rolled) — the standard
  OTel Python SDK works as-is, protobuf and all: [`python-opentelemetry.md`](python-opentelemetry.md).
- **OpenInference** (LangChain, LlamaIndex, CrewAI, Mastra…) — any OpenInference
  instrumentor exporting OTLP renders with full semantic enrichment.
- **Raw OpenTelemetry** — plain `gen_ai.*` spans render too.

## What you get

- Execution **tree / waterfall** with per-span latency bars
- Per-span **inspector**: model, prompt/input, completion/output, tokens, errors
- **Live tail** over Server-Sent Events — new traces appear as they arrive
- 100% local: an in-memory ring buffer (last 500 traces); nothing is persisted or
  sent anywhere

See the main [README](../README.md) for the full reference.
