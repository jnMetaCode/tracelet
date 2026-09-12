<div align="center">

# 🔭 tracelet

### Local-first DevTools for AI agents

**See every tool call, prompt, and token — live, 100% on your machine.**
No account. No Docker. No Python. Just `npx @jnmetacode/tracelet`.

```bash
npx @jnmetacode/tracelet
```

English | [简体中文](https://github.com/jnMetaCode/tracelet/blob/main/README.zh-CN.md)

![tracelet demo — two agent runs stream in live; Compare aligns their steps and shows what changed: the fixed tool, the model swap, the prompt diff, Δ latency/tokens/cost](https://raw.githubusercontent.com/jnMetaCode/tracelet/main/docs/demo.gif)

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

# 3. Send two runs of the same agent and diff them (Compare button)
node examples/demo.js --compare
```

Using the **Vercel AI SDK (v7+)** or **LangChain.js**? One line, no OpenTelemetry packages:

```js
import '@jnmetacode/tracelet/ai-sdk/register';                       // AI SDK: top of your entry file
await agent.invoke(input, { callbacks: [tracelet()] });               // LangChain: from '@jnmetacode/tracelet/langchain'
```

Anything else: point your agent's OpenTelemetry exporter at the ingest endpoint:

```
http://localhost:4318/v1/traces
```

That's the standard OTLP/HTTP port — most setups need only:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Both OTLP/HTTP encodings work: **protobuf** (the exporter default) and **JSON**.
No `OTEL_EXPORTER_OTLP_PROTOCOL` needed.

## Compare two runs

Change a prompt, swap a model, fix a tool — then answer the question that
actually matters: *what changed in the agent's behaviour?* Select a run, press
**Compare** (or `c`), pick a second run:

- **Steps aligned side by side.** Retries, dropped tool calls and new steps
  show as `+ added` / `− removed`; the rest stays lined up instead of shifting.
- **Every changed step flagged** — `status`, `model`, `input`, `output` — with
  per-step latency, tokens and cost for A, B and Δ.
- **Prompt and completion diffs** in the inspector, line by line.
- **Headline deltas**: latency, tokens, cost, errors — B relative to A.
- **Pin a baseline** (`p`): every new run that streams in is compared against
  it automatically — a regression check that runs while you iterate.

`node examples/demo.js --compare` sends a before/after pair so you can try it
without wiring an agent. Deep-link a comparison with `#compare=<a>,<b>`.

## Works with what you already use

tracelet speaks the three common tracing vocabularies on the same spans, so it
"just works" no matter who emitted the trace:

| Source | How |
| --- | --- |
| **Vercel AI SDK v7+** | **One line, zero extra packages:** `import '@jnmetacode/tracelet/ai-sdk/register'`. See [`examples/vercel-ai-sdk`](examples/vercel-ai-sdk.md). |
| **Vercel AI SDK v5/v6** | `experimental_telemetry: { isEnabled: true }` → export OTLP to `localhost:4318`. Same doc. |
| **Python OTel SDK** (LangChain, CrewAI, OpenAI Agents SDK…) | The standard exporter works as-is (protobuf included). See [`examples/python-opentelemetry`](examples/python-opentelemetry.md). |
| **LangChain.js / LangGraph.js** | **One line, zero extra packages:** `{ callbacks: [tracelet()] }` from `@jnmetacode/tracelet/langchain`. See [`examples/langchain`](examples/langchain.md). |
| **Mastra** | `@mastra/otel-exporter` with a `custom` endpoint of `localhost:4318`. See [`examples/mastra`](examples/mastra.md). |
| **OpenInference** (LangChain, LlamaIndex, CrewAI…) | Any OpenInference instrumentor exporting OTLP. |
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
- **In-memory ring buffer.** Last 500 traces. Restart = clean slate — unless
  you opt in to `--persist <file>`, which keeps history in a local JSONL file
  (still your disk, still nothing sent anywhere; Clear wipes it too).
- **Cost estimates.** Traces and LLM spans show a `~$` figure computed from
  published list prices for common models (Claude/GPT/Gemini); unknown models
  simply show none — it never guesses.

## CLI

```
npx @jnmetacode/tracelet [options]
  -p, --port <n>      OTLP/HTTP ingest port   (default 4318)
      --ui-port <n>   Web UI port             (default 4321)
      --persist <f>   opt-in local history (JSONL; reloaded on start)
      --no-open       don't auto-open browser
```

## Roadmap

- [x] Opt-in local history (`--persist traces.jsonl`) — done
- [x] Diff two runs side by side (Compare: aligned steps, prompt/output diffs, Δ latency/tokens/cost) — done
- [x] Cost estimates per model (list-price `~$` on traces and LLM spans) — done
- [x] protobuf OTLP ingest (zero-dep decoder) — done
- [ ] Waterfall flamegraph zoom
- [ ] Trace list: search inside prompts/outputs, filter by model/tool
- [x] One-line wrapper for the Vercel AI SDK (`@jnmetacode/tracelet/ai-sdk`, zero deps) — done
- [x] Mastra: config-only wiring via `@mastra/otel-exporter` (`examples/mastra.md`)
- [x] One-line wrapper for LangChain.js / LangGraph.js (`@jnmetacode/tracelet/langchain`, zero deps) — done

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


Beyond the toolkit, the same author maintains the wider「AI不止语」ecosystem:
[agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) (277 AI expert personas) · [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) (20 skills that teach AI how to work) · [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator) (one prompt → 276 specialists collaborate) · [openshorts](https://github.com/jnMetaCode/openshorts) (topic in, finished short video out).

## License

MIT — see [LICENSE](LICENSE).
