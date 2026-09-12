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

### Fixed
- Trace token and cost totals no longer double-count when a wrapper span
  reports the same usage as the model call beneath it (AI SDK root + `chat`
  child, legacy `ai.generateText` + `.doGenerate`). Only the innermost
  token-bearing spans are summed.

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
