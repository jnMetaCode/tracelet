# Launch playbook (internal)

Everything below is the go-to-market checklist for tracelet. Delete this file
(or move it out of the repo) before/after launch as you prefer.

## Pre-flight checklist

- [ ] Replace `USER` in `package.json` + docs with the real GitHub org/user.
- [ ] Confirm the npm name `tracelet` is available (`npm view tracelet`); pick a
      fallback if not (`tracelet-dev`, `agent-tracelet`, `lookglass`).
- [ ] Record the hero GIF (script below) → `docs/demo.gif`, uncomment it in README.
- [ ] Add `NPM_TOKEN` repo secret; `git tag v0.1.0 && git push --tags` to publish.
- [ ] Verify `npx tracelet` works from a clean machine (no global install).

## Hero GIF script (15–25s) — this is the single highest-leverage asset

1. Split screen: terminal (left), browser (right).
2. Terminal: type `npx tracelet` → UI opens, "Waiting for traces…".
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
> Tracelet is the opposite: `npx tracelet`, point any OpenTelemetry exporter at
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
> Repo: <link>. It's an early MVP — `node examples/demo.js` shows it without
> wiring a real agent. Would love feedback on the convention coverage.

Post Tue/Wed ~8:00am PT. Reply to every comment for the first 3 hours.

## Other channels

- **r/LocalLLaMA**, **r/LangChain** — lead with the GIF, not the pitch.
- **X/Twitter** — short thread; tag the Vercel AI SDK + OpenTelemetry communities.
- **dev.to / Hashnode** — "I built a zero-dependency local tracer for AI agents"
  walkthrough that doubles as SEO.
- **GitHub topics**: `ai-agents`, `observability`, `opentelemetry`, `llm`,
  `devtools`, `local-first`.

## After traction

- Turn on **GitHub Sponsors** once you have stars/issues (the stated goal).
- Watch for the most-requested framework in issues → ship a one-line wrapper.
- Consider an optional hosted "team share a trace" link as the eventual
  open-core seam — but only after the local tool has a following.
