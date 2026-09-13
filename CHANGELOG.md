# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com); versions follow semver.

## [Unreleased]

## [0.3.0] - 2026-09-12
### Added
- **Compare two runs** — select a run, press *Compare* (or `c`), pick another.
  Steps are aligned with an LCS over (kind, tool/span name) so retries and
  dropped calls show as added/removed rows instead of shifting everything;
  matched steps are flagged for `status` / `model` / `input` / `output`
  changes with per-step Δ latency, tokens and cost; the inspector shows
  line-level prompt and completion diffs. Headline deltas for latency,
  tokens, cost and errors. `GET /api/diff?a=&b=`; deep link `#compare=a,b`.
- Trace list: text filter, "⚠ only" toggle, and start time on every run.
- `examples/demo.js --compare` sends a before/after pair of runs to try it.
- **`@jnmetacode/tracelet/ai-sdk`** — a zero-dependency telemetry integration
  for the Vercel AI SDK v7+. `import '@jnmetacode/tracelet/ai-sdk/register'`
  (or `registerTelemetry(tracelet())`) and every `generateText` / `streamText`
  streams an agent → chat → tool span tree to tracelet with prompts, tool
  args/results, usage and errors. Honors `recordInputs` / `recordOutputs`.
  No `@opentelemetry/*` packages needed. Verified against `ai@7.0.99`.
- Parser: `gen_ai.operation.name` (`invoke_agent` / `chat` / `execute_tool` /
  `embeddings`) now drives span kinds; `gen_ai.provider.name` and
  `gen_ai.tool.call.arguments` / `.result` are read — the attribute set the
  official `@ai-sdk/otel` integration emits.
- **Pin a baseline** — pin a run (`p` or the header button) and every new run
  that arrives is compared against it automatically. Survives reloads (and
  restarts with `--persist`).
- `examples/mastra.md` — wiring Mastra's `@mastra/otel-exporter` to tracelet
  (verified against @mastra/core 1.66).
- **`@jnmetacode/tracelet/langchain`** — a zero-dependency LangChain.js /
  LangGraph.js callback handler: `{ callbacks: [tracelet()] }` streams the run
  tree (agent → graph node → chat / tool) with prompts, tool args/results,
  usage and errors. LangGraph's hidden plumbing runs are folded away. Honors
  `recordInputs` / `recordOutputs`. Verified against `langchain@1.x`
  `createAgent`. (Integrations share one OTLP emitter, `src/emit.js`.)
- **Search** — the run list filter now also matches models, tool names and
  the full text of prompts, completions and tool payloads (`GET /api/search?q=`);
  matching spans are highlighted in the waterfall. `/` focuses the box.
  Summaries carry `models` and `tools`.
- **First run without a clone**: `--demo` starts with two sample runs loaded,
  and the empty screen has a *Load demo runs* button plus the one-line wiring
  for the AI SDK, LangChain.js and plain OTLP — with the ingest URL the server
  actually listens on (`GET /api/config`). (The previous quick start ran
  `node examples/demo.js`, which only exists in a git clone — not for `npx`.)
- README "Why another one?" rewritten against verified facts: it now lists
  the local tools people actually compare tracelet with (AI SDK DevTools,
  Mastra Studio, otel-front), says plainly when those are enough, and states
  the real difference — step-aligned comparison of runs that understands LLM
  spans, across frameworks. (The old table implied tracelet was the only
  local, no-account `npx` option; AI SDK DevTools is one too.)
- The startup banner groups every `▸` line (ingest, UI, demo, history,
  exposure warning) before the instructions. The hero GIF was re-recorded
  around the quick start exactly as typed (`npx @jnmetacode/tracelet --demo`).
- A busy port now prints advice instead of a Node stack trace: it detects an
  already-running tracelet ("use that one"), or suggests free `--port` /
  `--ui-port` values (4318 is often held by an OTel Collector or Jaeger).
  Also clear messages for `EACCES` and a `--host` that isn't on this machine.
- `startServer()` (the package's main export) no longer installs SIGINT /
  SIGTERM handlers — the CLI does. Embedding tracelet in another process no
  longer hijacks Ctrl+C, and repeated calls no longer leak listeners. It now
  returns a `ready` promise that resolves once both ports are listening.
- CI covers Node 24; the publish workflow refuses a tag that doesn't match
  `package.json`'s version.
- Accessibility: runs, waterfall rows and compare rows are reachable with
  Tab and activate with Enter / Space (keyboard focus stays on the row after
  it re-renders); the run list is a labelled listbox; the three panes are
  named landmarks; the inspector is focusable so long prompts scroll by
  keyboard; visible `:focus-visible` rings. axe-core 4.13 reports no
  violations on the empty, run and compare views (was 3 rules, one serious).
- Keyboard navigation: `j` / `k` (or arrows) step through spans — or diff
  rows in Compare — and `[` / `]` step through runs.
- **Waterfall zoom** — drag a range across the bars to zoom the time axis;
  spans outside the window dim; `Esc`, double-click or the header chip resets.

### Security
- Both servers bind to `127.0.0.1` by default; `--host <addr>` opts into
  other interfaces. Previously they listened on all interfaces, so anyone on
  the LAN could read the UI/API.
- The UI API no longer sends CORS headers — a web page open in the same
  browser could previously `fetch` `/api/traces` and read every prompt.
  `POST /api/clear` requires an `x-tracelet-ui: 1` header (forces a preflight,
  which cross-origin pages fail). OTLP ingest keeps `Access-Control-Allow-Origin: *`
  for browser-side exporters.

- Ingest limits: request bodies over 50 MB and gzip/deflate payloads that
  inflate past 64 MB get a `413` (a 4 MB gzip of zeros previously inflated to
  gigabytes in memory). A trace stores at most 10 000 spans; further spans are
  counted as `dropped` (shown in the run list and header) instead of growing
  without bound. Search queries are capped at 500 characters.

### Fixed
- `--persist` history is compacted during the run (every 1000 appended
  batches), not only at startup, so a long session can't grow the file past
  what the 500-trace ring retains.
- The UI coalesces bursts of span batches into one list refresh per ~80 ms.
- Responsive layout: side panes shrink below 1180 px, the inspector moves
  under the waterfall below 960 px, everything stacks below 640 px — the
  waterfall stays readable in a half-screen window next to an editor.
- Test suite verified on a real Node 18.20 binary (the `engines` floor), not
  only on 22.
- Trace token and cost totals no longer double-count when a wrapper span
  reports the same usage as the model call beneath it (AI SDK root + `chat`
  child, legacy `ai.generateText` + `.doGenerate`). Only the innermost
  token-bearing spans are summed.
- `examples/demo.js` generated identical trace ids in every process, so running
  it twice merged both runs into one 30-second trace. Ids are random now.

## [0.2.1] - 2026-06-11
### Fixed
Findings from an adversarial review of the 0.2.0 feature code:
- Cost estimates now recognize long Bedrock regional prefixes
  (`apac.`/`global.`/`us-gov.` etc.), coerce string-typed token counts, and
  report "unknown" instead of a fake `~$0` when a span only carries a total.
- String-typed token attributes can no longer corrupt a trace's token sum.
- An unreadable `--persist` history file degrades gracefully instead of
  preventing the server from starting.

## [0.2.0] - 2026-06-11
### Added
- **Cost estimates** — traces and LLM spans show a `~$` figure computed from
  published list prices (Claude/GPT/Gemini families); unknown models show
  nothing rather than a guess.
- **Opt-in local history** — `--persist <file>` appends traces to a local
  JSONL file and restores them on start; `Clear` wipes the file too. The
  default remains pure in-memory.

## [0.1.1] - 2026-06-11
### Fixed
- The demo GIF and the 中文 README link now render on the npm package page
  (absolute URLs instead of repo-relative ones).

## [0.1.0] - 2026-06-11

First public release.

### Added
- Local OTLP/HTTP ingest on `:4318` — **protobuf** (the exporter default,
  zero-dep decoder) and JSON, gzip included.
- Live web UI on `:4321`: trace list, waterfall, span inspector with prompts,
  completions, token counts, tool args and error banners, streaming in over
  SSE as spans arrive.
- Understands three span vocabularies on the same trace: OpenTelemetry
  `gen_ai.*`, Vercel AI SDK `ai.*`, and OpenInference.
- Privacy by construction: in-memory ring buffer (last 500 traces), nothing
  written to disk or sent anywhere; hostile span/attribute values render
  escaped (XSS-probed).
- Verified walkthroughs for the Vercel AI SDK and the Python OpenTelemetry
  SDK (`examples/`).

[Unreleased]: https://github.com/jnMetaCode/tracelet/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/jnMetaCode/tracelet/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/jnMetaCode/tracelet/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/jnMetaCode/tracelet/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/jnMetaCode/tracelet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/jnMetaCode/tracelet/releases/tag/v0.1.0
