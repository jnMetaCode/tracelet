# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com); versions follow semver.

## [Unreleased]

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

[Unreleased]: https://github.com/jnMetaCode/tracelet/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/jnMetaCode/tracelet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/jnMetaCode/tracelet/releases/tag/v0.1.0
