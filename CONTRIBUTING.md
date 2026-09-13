# Contributing to tracelet

Thanks for helping! tracelet is intentionally tiny and dependency-free — please
keep it that way.

## Ground rules

- **No runtime dependencies.** The whole point is `npx @jnmetacode/tracelet` with nothing to
  install. Dev/test tooling that ships in `devDependencies` is fine; anything in
  `dependencies` will be rejected unless there's a very strong reason.
- **Node built-ins only** in `src/`. Target Node 18+.
- **Stay readable.** Someone should be able to read the whole codebase in 15
  minutes.

## Dev loop

```bash
git clone https://github.com/jnMetaCode/tracelet && cd tracelet
node src/cli.js --no-open        # start it (UI on :4321, ingest on :4318)
node examples/demo.js --compare  # send two synthetic runs; try Compare / pin a baseline
npm test                         # run the suite (Node's built-in runner, no deps)
```

## Layout

| Path | What |
| --- | --- |
| `src/cli.js`, `src/server.js` | CLI flags; the two HTTP servers (OTLP ingest, UI + `/api/*`) |
| `src/otlp.js`, `src/otlp-protobuf.js` | OTLP JSON/protobuf → flat spans, semantic extraction (three vocabularies) |
| `src/store.js`, `src/cost.js`, `src/diff.js` | ring buffer + search + `--persist`; list-price cost table; run comparison |
| `src/emit.js`, `src/ai-sdk.js`, `src/langchain.js` | framework integrations: build OTLP over `fetch`, no OTel packages |
| `public/` | the UI — vanilla JS, no build step |
| `examples/` | `demo.js` + verified walkthroughs per framework |
| `docs/demo-term.tape`, `docs/record-ui.mjs` | hero GIF pipeline (vhs + Playwright + ffmpeg) |

## What's most useful right now

- **More convention coverage.** If your framework emits OTel spans that don't
  render nicely, open an issue with a sample OTLP JSON payload — that's gold.
- **Framework integrations** in the style of `src/ai-sdk.js` / `src/langchain.js`:
  a plain object that turns the framework's own callbacks into spans via
  `src/emit.js`. Must be verified against the real package (see the examples
  for what "verified" means) and must not import the framework.
- **An OTLP relay** (`--forward <url>`) so tracelet can sit in front of a
  production backend.

## Adding a new attribute mapping

All semantic extraction lives in `src/otlp.js`. Add the new attribute key to the
relevant `first([...])` list (input/output/model/tokens) and add a test case in
`test/run.js` with a minimal span fixture. Please don't reach for regex-heavy
parsing — prefer explicit key lists so behavior stays obvious.

## Tests

`npm test` runs the Node built-in test runner against `test/`. Every parser
change needs a fixture-based test. Server changes should round-trip through the
HTTP layer like the existing tests do. Integration changes are tested by
driving the callbacks with synthetic events and parsing the OTLP they emit —
no framework package in the test suite.

## Re-recording the hero GIF

`docs/demo.gif` is generated, not hand-made. When the UI changes visibly:
`vhs docs/demo-term.tape` (needs `vhs` + `ttyd`) for the terminal opener, then
`node docs/record-ui.mjs <playwright-dir> <out>` against a running tracelet for
the UI segment, then concatenate with ffmpeg (`fps=12`, palettegen). Keep it
under 30 s and loop-friendly.
