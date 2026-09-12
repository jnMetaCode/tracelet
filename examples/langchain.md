# Wiring LangChain.js / LangGraph.js to tracelet

tracelet ships a LangChain **callback handler** — a plain object, no class to
extend, no `@opentelemetry/*` or `@langchain/*` packages required by tracelet.
LangChain already gives every run (chain, chat model, tool, retriever) a
`runId` and `parentRunId`; the handler turns that into a span tree and streams
it to `http://localhost:4318`.

```bash
npm i -D @jnmetacode/tracelet
```

## `createAgent` (LangChain 1.x) / LangGraph

```js
import { createAgent, tool, HumanMessage } from 'langchain';
import { ChatAnthropic } from '@langchain/anthropic';
import { tracelet } from '@jnmetacode/tracelet/langchain';

const agent = createAgent({ model: new ChatAnthropic({ model: 'claude-sonnet-4.5' }), tools: [getWeather] });

await agent.invoke(
  { messages: [new HumanMessage('Weather in SF?')] },
  { callbacks: [tracelet()] }   // ← this line
);
```

What lands in tracelet (LangGraph's internal plumbing runs are folded away):

```
LangGraph                       ← the run (agent)
├─ model_request                ← graph node
│  └─ chat claude-sonnet-4.5    ← prompt messages, tool definitions, usage
├─ tools
│  └─ execute_tool get_weather  ← args, result (or the error)
└─ model_request
   └─ chat claude-sonnet-4.5
```

## Any Runnable, chain or model

The same handler works anywhere LangChain accepts `callbacks`:

```js
const model = new ChatOpenAI({ model: 'gpt-4o', callbacks: [tracelet()] }); // every call
await chain.invoke(input, { callbacks: [tracelet()] });                    // this call
```

Create the handler once and reuse it — it batches spans per run.

## Options

```js
tracelet({
  serviceName: 'weather-agent',           // default: 'langchain'
  url: 'http://localhost:4318/v1/traces', // default; or set TRACELET_URL
  recordInputs: false,                    // prompts / tool args never leave the process
  recordOutputs: false,                   // completions / tool results neither
});
```

Verified against `@langchain/core` 1.2.x + `langchain` 1.x (`createAgent` with
a tool-calling model). Model name and provider come from the `ls_model_name` /
`ls_provider` metadata every LangChain chat model reports; token usage from
`usage_metadata` on the response message (or `llmOutput.tokenUsage`).

> Prefer OpenTelemetry? LangChain's own OTel/OpenInference instrumentation
> exporting OTLP to `localhost:4318` works too — tracelet reads OpenInference
> and `gen_ai.*` spans natively.
