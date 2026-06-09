# Ecosystem & prior art

tracelet is deliberately small and deliberately interoperable. It stands on a
stack of open standards and lives next to a bunch of excellent open-source
tools. This page is an honest map of that landscape — both so you can pick the
right tool, and so contributors understand exactly where tracelet's wedge is.

## Standards we build on

| Project | What | License |
| --- | --- | --- |
| [OpenTelemetry](https://opentelemetry.io) | The tracing wire format (OTLP) and SDKs tracelet ingests | Apache-2.0 |
| [OTel GenAI semconv](https://opentelemetry.io/docs/specs/semconv/gen-ai/) | `gen_ai.*` attribute conventions for LLM spans | Apache-2.0 |
| [OpenInference](https://github.com/Arize-ai/openinference) | Arize's LLM/agent span conventions (`llm.*`, `tool.*`, span kinds) | Apache-2.0 |
| [Vercel AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry) | `ai.*` span conventions for the JS agent ecosystem | Apache-2.0 |

Because tracelet reads all three vocabularies, anything that emits OTel traces
renders — there is no tracelet SDK to adopt.

## Neighboring open-source observability tools

These are real, good projects. Where tracelet differs is the **local, zero-setup,
JS-native, live dev-loop** niche — see the table in the README.

| Project | Shape | License | Best when |
| --- | --- | --- | --- |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix) | Local-capable, Python, eval + trace UI | Elastic-2.0 | You're in Python and want evals + tracing in a notebook. |
| [Langfuse](https://github.com/langfuse/langfuse) | Self-host (Postgres+ClickHouse+Redis) or cloud | MIT (core) | Team production analytics, prompt management, evals. |
| [Laminar (lmnr)](https://github.com/lmnr-ai/lmnr) | Self-host (Rust + PG + ClickHouse) or cloud | Apache-2.0 | "Datadog for agents" production analytics. |
| [Helicone](https://github.com/Helicone/helicone) | Proxy-based logging/caching | Apache-2.0 | One-line base-URL swap, gateway-level logging. |
| [OpenLLMetry](https://github.com/traceloop/openllmetry) | Instrumentation library (no bundled UI) | Apache-2.0 | You want to *emit* OTel and bring your own backend (like tracelet!). |
| [AgentOps](https://github.com/AgentOps-AI/agentops) | Cloud agent debugging | MIT (SDK) | Hosted multi-framework Python agent monitoring. |

> If you've outgrown tracelet, **OpenLLMetry + Langfuse/Laminar** is a natural
> graduation path — and since everyone speaks OTLP, you don't re-instrument.

## Where tracelet fits

```
            ┌─────────────────────────── production ──────────────────────────┐
  dev loop  │  Langfuse · Laminar · LangSmith · Phoenix (eval) · Logfire        │
 ┌────────┐ │  (dashboards, evals, retention, team, alerting)                   │
 │tracelet│ │                                                                   │
 └────────┘ └───────────────────────────────────────────────────────────────────┘
  npx, local, live-tail,            ← same OTLP wire format →
  inner build loop
```

Contributions that *increase interop* (new convention coverage, an OTLP relay so
tracelet can forward to a production backend) are especially welcome.
