# Launch playbook (internal)

Everything below is the go-to-market checklist for tracelet. Delete this file
(or move it out of the repo) before/after launch as you prefer.

## Pre-flight checklist

- [x] Replace `USER` in `package.json` + docs with the real GitHub org/user
      → **jnMetaCode**. *(done)*
- [x] **npm name decided → `@jnmetacode/tracelet`** (unscoped `tracelet` is taken;
      scoped keeps the brand, bin stays `tracelet`). Claim the `jnmetacode` npm
      username/org before publishing — see engram's `docs/LAUNCH.md` for the
      scope-claim steps. *(name set in package.json + docs)*
- [x] Record the hero GIF (script below) → `docs/demo.gif`, linked in README.
      *(done — terminal opener via vhs `docs/demo-term.tape`, UI segment via
      Playwright `docs/record-ui.mjs`, concatenated with ffmpeg)*
- [x] **Published**: `@jnmetacode/tracelet` live on npm (v0.1.0, tag + release).
      Clean-cache `npx @jnmetacode/tracelet` verified. *(done; `NPM_TOKEN` secret
      still optional, for future CI publishes)*
- [x] Verified from a clean npm cache: `npx @jnmetacode/tracelet` runs. *(done)*

## Hero GIF script (15–25s) — this is the single highest-leverage asset

1. Split screen: terminal (left), browser (right).
2. Terminal: type `npx @jnmetacode/tracelet` → UI opens, "Waiting for traces…".
3. Terminal: `node examples/demo.js` → trace **streams in live**.
4. Click the LLM span → prompt + completion + tokens appear in the inspector.
5. Click the red (errored) tool span → error banner + args.
6. End on the three-pane view with the waterfall.

Keep it under 25s, no narration, loop-friendly. Tools: Kap / QuickTime + Gifski.

## Show HN post

**Title:**
> Show HN: Tracelet – Local-first DevTools for AI agents (npx, no account)

**Body:**
> Hi HN. I kept debugging AI agents by `console.log`-ing prompts and squinting at
> which tool call went wrong. Hosted tracing tools felt like overkill for the
> inner dev loop — sign up, install an SDK, ship my prompts to someone's cloud.
>
> Tracelet is the opposite: `npx @jnmetacode/tracelet`, point any OpenTelemetry exporter at
> `localhost:4318`, and watch your agent's execution tree stream in live — LLM
> calls, tool calls, prompts in, completions out, tokens, latency, errors. Zero
> dependencies (pure Node built-ins), no account, no Docker, no Python. Nothing
> leaves your machine; it's an in-memory ring buffer.
>
> It reads the three common span vocabularies on the same traces (OTel `gen_ai.*`,
> Vercel AI SDK `ai.*`, and Arize OpenInference), so it works with LangChain,
> LlamaIndex, the Vercel AI SDK, etc. without a tracelet SDK to adopt.
>
> It's deliberately not a production analytics warehouse — it's the thing you keep
> open in a second window while building, like the Network tab for agent runs.
> When you outgrow it, everything is standard OTLP so you graduate to Langfuse /
> Phoenix / Laminar without re-instrumenting.
>
> Repo: https://github.com/jnMetaCode/tracelet. It's an early MVP —
> `node examples/demo.js` shows it without wiring a real agent (Python users:
> `examples/python-opentelemetry.md` is a verified walkthrough). Would love
> feedback on the convention coverage.

Post Tue/Wed ~8:00am PT. Reply to every comment for the first 3 hours.

## Other channels — ready-to-paste drafts

**r/LocalLLaMA / r/LangChain** (lead with the GIF, 1–2 days after HN):

> **Title:** tracelet: a local OTLP viewer for AI agents — see every LLM/tool call live, zero deps, no account, `npx` one-liner
>
> Debugging agents by console.log-ing prompts got old. tracelet is the Network
> tab for agent runs: `npx @jnmetacode/tracelet`, point any OpenTelemetry exporter at
> localhost:4318, and the execution tree streams in live — prompts, completions,
> token counts, latency, the tool call that errored. Both OTLP protobuf (the
> SDK default) and JSON work; it reads OTel gen_ai.*, Vercel AI SDK ai.*, and
> OpenInference conventions, so LangChain / LlamaIndex / Vercel AI SDK work
> without a tracelet SDK. In-memory ring buffer, nothing written or sent
> anywhere. Repo: https://github.com/jnMetaCode/tracelet
> (Python: there's a verified OTel-SDK walkthrough in examples/.)

**X thread**: 1/ "your agent is a black box; here's the Network tab for it"
[GIF] · 2/ any OTel exporter → localhost:4318, protobuf included, no SDK to
adopt · 3/ prompts/tokens/errors in the inspector, 100% local ring buffer ·
4/ outgrow it → it's standard OTLP, graduate to Langfuse/Phoenix without
re-instrumenting. Tag the Vercel AI SDK + OpenTelemetry communities.

**dev.to / Hashnode** — "I built a zero-dependency local tracer for AI agents"
walkthrough that doubles as SEO.
**GitHub topics** (already set): `ai-agents`, `observability`, `opentelemetry`,
`llm`, `devtools`, `local-first`.

## After traction

- Turn on **GitHub Sponsors** once you have stars/issues (the stated goal).
- Watch for the most-requested framework in issues → ship a one-line wrapper.
- Consider an optional hosted "team share a trace" link as the eventual
  open-core seam — but only after the local tool has a following.
