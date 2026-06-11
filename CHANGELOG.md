# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com); versions follow semver.

## [Unreleased]

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

[Unreleased]: https://github.com/jnMetaCode/tracelet/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/jnMetaCode/tracelet/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/jnMetaCode/tracelet/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/jnMetaCode/tracelet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/jnMetaCode/tracelet/releases/tag/v0.1.0
