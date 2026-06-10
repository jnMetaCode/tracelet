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
git clone https://github.com/USER/tracelet && cd tracelet
node src/cli.js              # start it
node examples/demo.js        # send a synthetic trace
npm test                     # run the suite
```

## What's most useful right now

- **More convention coverage.** If your framework emits OTel spans that don't
  render nicely, open an issue with a sample OTLP JSON payload — that's gold.
- **An OTLP relay** (`--forward <url>`) so tracelet can sit in front of a
  production backend.
- **Optional SQLite persistence** behind a `--db` flag (must stay opt-in).

## Adding a new attribute mapping

All semantic extraction lives in `src/otlp.js`. Add the new attribute key to the
relevant `first([...])` list (input/output/model/tokens) and add a test case in
`test/run.js` with a minimal span fixture. Please don't reach for regex-heavy
parsing — prefer explicit key lists so behavior stays obvious.

## Tests

`npm test` runs the Node built-in test runner against `test/`. Every parser
change needs a fixture-based test. Server changes should round-trip through the
HTTP layer like the existing tests do.
