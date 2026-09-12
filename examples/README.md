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

# …or two runs of the same agent (before / after a fix) to try Compare
node examples/demo.js --compare
```

Now look at `http://localhost:4321`: a waterfall with an `agent.run` root, two
LLM calls, two tool calls (one errored), prompts/responses and token counts in the
inspector. With `--compare`, select run A, press **Compare**, click run B: the
steps line up side by side, the fixed tool, the model swap and the prompt diff
are flagged, with Δ latency / tokens / cost. `examples/demo.js` is ~170 lines
of zero-dep OTLP JSON you can read.

## Wire up a real agent

tracelet is just an OTLP endpoint, so anything that emits OpenTelemetry works.
Point your exporter at the ingest URL — both protobuf (the default) and JSON are
accepted, so usually no config beyond:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

- **Vercel AI SDK v7+** — one import, zero OpenTelemetry packages:
  `import '@jnmetacode/tracelet/ai-sdk/register'`. v5/v6 via an OTel exporter.
  Full walkthrough: [`vercel-ai-sdk.md`](vercel-ai-sdk.md).
- **LangChain.js / LangGraph.js** — `{ callbacks: [tracelet()] }` from
  `@jnmetacode/tracelet/langchain`, zero extra packages: [`langchain.md`](langchain.md).
- **Mastra** — `@mastra/otel-exporter` with a `custom` endpoint: [`mastra.md`](mastra.md).
- **Python** (LangChain, CrewAI, OpenAI Agents SDK, hand-rolled) — the standard
  OTel Python SDK works as-is, protobuf and all: [`python-opentelemetry.md`](python-opentelemetry.md).
- **OpenInference** (LangChain, LlamaIndex, CrewAI…) — any OpenInference
  instrumentor exporting OTLP renders with full semantic enrichment.
- **Raw OpenTelemetry** — plain `gen_ai.*` spans render too.

## What you get

- Execution **tree / waterfall** with per-span latency bars
- Per-span **inspector**: model, prompt/input, completion/output, tokens, errors
- **Compare two runs**: aligned steps, changed-step flags, prompt/completion
  diffs, Δ latency / tokens / cost; **pin a baseline** to auto-compare every new run
- **Search** across prompts, completions, tool payloads, models and tool names
- **Live tail** over Server-Sent Events — new traces appear as they arrive
- 100% local: an in-memory ring buffer (last 500 traces); nothing is sent
  anywhere (opt-in `--persist <file>` keeps history on your own disk)

See the main [README](../README.md) for the full reference.
