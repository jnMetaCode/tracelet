<div align="center">

# 🔭 tracelet

### Local-first DevTools for AI agents

**See every tool call, prompt, and token — live, 100% on your machine.**
No account. No Docker. No Python. Just `npx @jnmetacode/tracelet`.

```bash
npx @jnmetacode/tracelet
```

<!-- TODO: replace with a real screen recording before launch -->
<!-- ![tracelet demo](docs/demo.gif) -->

</div>

---

Your agent is a black box. It calls an LLM, the LLM asks for a tool, the tool
returns something weird, the next LLM call does something dumb — and all you see
in your terminal is the final answer (or a stack trace).

**tracelet** is the missing inspector for that loop. Point any OpenTelemetry
exporter at `localhost:4318`, and watch your agent's execution tree stream in
live: every LLM call, every tool invocation, prompts in, completions out, token
counts, latency, and errors — in a clean local UI that opens instantly.

Nothing ever leaves your machine.

## Quick start

```bash
# 1. Start tracelet (opens http://localhost:4321)
npx @jnmetacode/tracelet

# 2. See it work with a synthetic agent trace
npx @jnmetacode/tracelet & sleep 1 && node examples/demo.js
```

Then point your real agent's OpenTelemetry exporter at the ingest endpoint:

```
http://localhost:4318/v1/traces
```

That's the standard OTLP/HTTP port — most setups need only:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Both OTLP/HTTP encodings work: **protobuf** (the exporter default) and **JSON**.
No `OTEL_EXPORTER_OTLP_PROTOCOL` needed.

## Works with what you already use

tracelet speaks the three common tracing vocabularies on the same spans, so it
"just works" no matter who emitted the trace:

| Source | How |
| --- | --- |
| **Vercel AI SDK** | `experimental_telemetry: { isEnabled: true }` → export OTLP to `localhost:4318`. See [`examples/vercel-ai-sdk`](examples/vercel-ai-sdk.md). |
| **OpenInference** (LangChain, LlamaIndex, CrewAI, Mastra…) | Any OpenInference instrumentor exporting OTLP. |
| **OpenTelemetry GenAI** semconv | Native `gen_ai.*` spans, content as attributes *or* events. |
| **Anything OTel** | Plain spans render too — you just get less semantic enrichment. |

No SDK lock-in: tracelet is just an OTLP endpoint + a viewer.

## Why another one?

There are great LLM observability tools. None of them own the **inner debug
loop** for a JS/TS agent developer:

| | local & offline | no account | no Docker stack | no Python | live dev-tail | `npx` one-liner |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| **tracelet** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Arize Phoenix | ✅ | ✅ | ✅ | ❌ (pip) | ~ | ❌ |
| Langfuse (self-host) | ✅ | ✅ | ❌ (PG+ClickHouse+Redis) | ~ | ❌ | ❌ |
| Laminar (self-host) | ✅ | ✅ | ❌ (PG+ClickHouse+RMQ) | ~ | ~ | ❌ |
| LangSmith | ❌ | ❌ | — | — | ✅ | ❌ |
| Helicone | ~ (proxy) | ❌ | ❌ | ~ | ~ | ❌ |

tracelet isn't trying to be your production analytics warehouse. It's the thing
you keep open in a second window while you're *building* the agent — like the
Network tab, but for agent runs.

> Outgrew local? tracelet emits/relays standard OTLP, so graduate to any of the
> tools above for production without re-instrumenting.

## How it works

```
your agent ──OTLP/HTTP (pb|json)──▶  :4318  ──▶  in-memory store  ──SSE──▶  UI :4321
                                          (ring buffer, never persisted off-box)
```

- **Zero dependencies.** Pure Node built-ins. The whole thing is a few hundred
  lines you can read.
- **Two ports.** `4318` ingests OTLP (the convention), `4321` serves the UI.
- **In-memory ring buffer.** Last 500 traces. Restart = clean slate. Your
  prompts and data are never written to disk or sent anywhere.

## CLI

```
npx @jnmetacode/tracelet [options]
  -p, --port <n>      OTLP/HTTP ingest port   (default 4318)
      --ui-port <n>   Web UI port             (default 4321)
      --no-open       don't auto-open browser
```

## Roadmap

- [ ] Persist option (`--db traces.sqlite`) for opt-in local history
- [ ] Diff two runs side by side
- [ ] Cost estimates per model
- [x] protobuf OTLP ingest (zero-dep decoder) — done
- [ ] Waterfall flamegraph zoom
- [ ] One-line wrappers: `tracelet/vercel`, `tracelet/langchain`

PRs welcome. This is early — issues and ideas are the most useful contribution
right now.

## Status

Early MVP. The ingest + live UI work today (`node examples/demo.js` to see it).
Star/watch to follow along.

## Sibling projects

Part of a small, local-first, zero-dependency toolkit for building AI agents — see the [toolkit overview & end-to-end recipe](https://github.com/jnMetaCode/local-agent-toolkit):

- 🔭 **tracelet** — local DevTools to debug agent runs *(this repo)*
- 🍳 **[skillet](https://github.com/jnMetaCode/skillet)** — a package manager for agent skills
- 🧠 **[engram](https://github.com/jnMetaCode/engram)** — a local, private memory layer for agents (and you)

## License

MIT — see [LICENSE](LICENSE).
