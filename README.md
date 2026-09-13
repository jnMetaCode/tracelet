<div align="center">

# 🔭 tracelet

### Local-first DevTools for AI agents

**Diff two runs of your agent step by step — and watch every LLM and tool call live.**
Any framework. No account, no Docker, zero dependencies. 100% on your machine.

```bash
npx @jnmetacode/tracelet --demo
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

And when you change a prompt, swap a model or fix a tool, **Compare** lines two
runs up step by step and shows exactly what changed — which step, which model,
the prompt diff, and the Δ in latency, tokens and cost.

Nothing ever leaves your machine.

## Quick start

```bash
# Start with two sample runs of an agent already loaded, then press Compare
npx @jnmetacode/tracelet --demo
```

Or start it plain (`npx @jnmetacode/tracelet`) and click **Load demo runs** on
the empty screen. From a clone, `node examples/demo.js --compare` sends the same
runs over real OTLP/HTTP.

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

The run list searches too (`/`): names, models, tool names, and the full text
of prompts, completions and tool payloads — matching spans light up in the
waterfall.

In the waterfall, drag across the bars to zoom into a time range (a 40 ms tool
call inside a 30 s run becomes readable); `Esc` or double-click resets.

`npx @jnmetacode/tracelet --demo` loads a before/after pair so you can try it
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

Local agent debuggers exist now — including good first-party ones. What
tracelet adds is **comparing two runs of an agent step by step, whatever
framework produced them.**

| | local, no account | works across frameworks | reads LLM spans (prompts · tokens · cost) | compare two runs | start |
| --- | :-: | :-: | :-: | :-: | --- |
| **tracelet** | ✅ | ✅ any OTLP + one-liners for AI SDK / LangChain.js | ✅ | ✅ steps aligned, prompt diffs, Δ latency/tokens/cost | `npx` |
| [AI SDK DevTools](https://ai-sdk.dev/docs/ai-sdk-core/devtools) | ✅ | ❌ AI SDK only | ✅ | — not in its docs | `npx @ai-sdk/devtools` |
| [Mastra Studio](https://mastra.ai/docs/evals/experiments) | ✅ | ❌ Mastra only | ✅ | ~ compares *experiment* scores over a dataset | `mastra dev` |
| [otel-front](https://github.com/mesaglio/otel-front) | ✅ | ✅ any OTLP | ❌ generic OpenTelemetry | ✅ side-by-side traces | Homebrew / Docker / binary |

If you only use the AI SDK and don't need to compare runs, its DevTools is a
fine choice. If your agent mixes frameworks, runs in Python too, or you keep
asking *"what changed since the last run?"*, that's the gap tracelet fills.

It isn't a production analytics platform either. Those — [Langfuse](https://langfuse.com/self-hosting)
(self-host: Postgres + ClickHouse + Redis + S3, or cloud), Arize Phoenix
(`pip install arize-phoenix` or Docker), LangSmith (cloud) — bring retention,
evals, dashboards and teams. tracelet is the window you keep open while
*building*, like the Network tab for agent runs.

> Outgrew local? Everything is standard OTLP, so you graduate to any of those
> for production without re-instrumenting.

## How it works

```
your agent ──OTLP/HTTP (pb|json)──▶  :4318  ──▶  in-memory store  ──SSE──▶  UI :4321
                                          (ring buffer, never persisted off-box)
```

- **Zero dependencies.** Pure Node built-ins, no build step. About 3 000
  lines all in — server, parser, UI and the framework integrations — readable
  in an afternoon.
- **Two ports.** `4318` ingests OTLP (the convention), `4321` serves the UI.
- **In-memory ring buffer.** Last 500 traces. Restart = clean slate — unless
  you opt in to `--persist <file>`, which keeps history in a local JSONL file
  (still your disk, still nothing sent anywhere; Clear wipes it too).
- **Cost estimates.** Traces and LLM spans show a `~$` figure computed from
  published list prices for common models (Claude/GPT/Gemini); unknown models
  simply show none — it never guesses.
- **Bounded.** 50 MB per request, 64 MB inflated, 10 000 spans per trace
  (extras are counted as dropped, not stored), 500 traces in memory. A
  runaway agent can't take the tool down with it.
- **Private by default.** Both ports bind to `127.0.0.1` (use `--host 0.0.0.0`
  to expose them deliberately). The UI API sends no CORS headers, so a web page
  open in the same browser cannot read your traces; only the OTLP ingest path
  accepts cross-origin POSTs, for browser-side exporters.

## CLI

```
npx @jnmetacode/tracelet [options]
  -p, --port <n>      OTLP/HTTP ingest port   (default 4318)
      --ui-port <n>   Web UI port             (default 4321)
      --persist <f>   opt-in local history (JSONL; reloaded on start)
      --demo          start with two sample agent runs loaded
      --host <addr>   bind address (default 127.0.0.1 — loopback only;
                      0.0.0.0 to expose, e.g. inside a container)
      --no-open       don't auto-open browser
```

### Keyboard

| Key | |
| --- | --- |
| `/` | focus search |
| `j` / `k` (or ↓ / ↑) | next / previous span — or diff row in Compare |
| `[` / `]` | previous / next run |
| `c` | compare the selected run with another |
| `p` | pin / unpin the selected run as baseline |
| `Esc` | cancel picking · reset zoom |
| double-click waterfall | reset zoom |

## Roadmap

- [x] Opt-in local history (`--persist traces.jsonl`) — done
- [x] Diff two runs side by side (Compare: aligned steps, prompt/output diffs, Δ latency/tokens/cost) — done
- [x] Cost estimates per model (list-price `~$` on traces and LLM spans) — done
- [x] protobuf OTLP ingest (zero-dep decoder) — done
- [x] Waterfall zoom (drag a time range on the bars; Esc / double-click resets) — done
- [x] Trace list: search inside prompts/outputs, filter by model/tool — done
- [x] One-line wrapper for the Vercel AI SDK (`@jnmetacode/tracelet/ai-sdk`, zero deps) — done
- [x] Mastra: config-only wiring via `@mastra/otel-exporter` (`examples/mastra.md`)
- [x] One-line wrapper for LangChain.js / LangGraph.js (`@jnmetacode/tracelet/langchain`, zero deps) — done

PRs welcome. This is early — issues and ideas are the most useful contribution
right now.

## Status

Usable daily: live ingest (protobuf + JSON), waterfall + inspector, Compare /
baseline, search, zoom, cost estimates, opt-in history, and verified one-line
integrations for the Vercel AI SDK, LangChain.js and Mastra. Still small (~3 000
lines, no build step, no dependencies) and still opinionated about staying local.
Issues with a sample OTLP payload are the most useful contribution.

## Sibling projects

Part of a small, local-first, zero-dependency toolkit for building AI agents — see the [toolkit overview & end-to-end recipe](https://github.com/jnMetaCode/local-agent-toolkit):

- 🔭 **tracelet** — local DevTools to debug agent runs *(this repo)*
- 🍳 **[skillet](https://github.com/jnMetaCode/skillet)** — a package manager for agent skills
- 🧠 **[engram](https://github.com/jnMetaCode/engram)** — a local, private memory layer for agents (and you)


Beyond the toolkit, the same author maintains the wider「AI不止语」ecosystem:
[agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) (277 AI expert personas) · [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) (20 skills that teach AI how to work) · [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator) (one prompt → 276 specialists collaborate) · [openshorts](https://github.com/jnMetaCode/openshorts) (topic in, finished short video out).

## License

MIT — see [LICENSE](LICENSE).
