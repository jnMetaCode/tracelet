// LangChain.js / LangGraph.js wiring for tracelet — zero dependencies.
//
//   import { tracelet } from '@jnmetacode/tracelet/langchain';
//
//   const agent = createAgent({ model, tools });
//   await agent.invoke({ messages }, { callbacks: [tracelet()] });
//   // or once, on any Runnable / model:  new ChatAnthropic({ callbacks: [tracelet()] })
//
// LangChain's callback system hands every run (chain, chat model, tool,
// retriever) a runId and its parentRunId, which is exactly a span tree. This
// handler is a plain `CallbackHandlerMethods` object — no class to extend, no
// @langchain import here — that turns those callbacks into OTLP spans and
// POSTs them to tracelet. Attributes follow OTel GenAI (`gen_ai.*`) for model
// and tool runs and OpenInference span kinds for chains/retrievers, both of
// which tracelet reads natively.

import { createExporter, hex, safeJson } from './emit.js';

const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : undefined);
const nameOf = (serialized, runName) => runName || last(serialized?.id) || serialized?.name || 'run';

// BaseMessage → {role, content, tool_calls?} without importing @langchain/core.
function toMessage(m) {
  if (!m || typeof m !== 'object') return m;
  const role = (typeof m._getType === 'function' && m._getType()) || m.type || m.role || 'unknown';
  const out = { role, content: m.content };
  if (m.tool_calls?.length) out.tool_calls = m.tool_calls;
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
  return out;
}

// Token usage from an LLMResult: per-message usage_metadata first, then the
// provider-level llmOutput.tokenUsage fallback.
function usageOf(output) {
  const msg = output?.generations?.[0]?.[0]?.message;
  const um = msg?.usage_metadata;
  if (um) return { input: um.input_tokens, output: um.output_tokens };
  const tu = output?.llmOutput?.tokenUsage || output?.llmOutput?.usage;
  if (tu) return { input: tu.promptTokens ?? tu.prompt_tokens ?? tu.input_tokens, output: tu.completionTokens ?? tu.completion_tokens ?? tu.output_tokens };
  return {};
}

/**
 * Create a LangChain callback handler that streams runs to tracelet.
 * @param {object} [opts]  { url, serviceName, flushMs, fetch, recordInputs, recordOutputs }
 */
export function tracelet({ recordInputs = true, recordOutputs = true, ...exporterOpts } = {}) {
  const x = createExporter({ scope: 'langchain', ...exporterOpts });
  const runs = new Map(); // runId → { span, traceId }
  const inputs = (v) => (recordInputs ? safeJson(v) : undefined);
  const outputs = (v) => (recordOutputs ? safeJson(v) : undefined);

  const start = (runId, parentRunId, { name, attrs, kind }) => {
    const parent = parentRunId && runs.get(parentRunId);
    const traceId = parent ? parent.traceId : hex(16);
    const span = x.open({ traceId, parentSpanId: parent?.span.spanId, name, attrs, kind });
    runs.set(runId, { span, traceId, root: !parent });
    return span;
  };
  const finish = (runId, extra) => {
    const r = runs.get(runId);
    if (!r) return;
    runs.delete(runId);
    if (r.passthrough) return; // hidden run: its span belongs to an ancestor
    x.end(r.span, extra);
    if (r.root) void x.flush();
  };

  return {
    name: 'tracelet',

    // ---- chains / graphs (the agent loop itself is one of these) ----------
    // NB: the argument order below is what CallbackManager actually passes at
    // runtime (@langchain/core 1.x manager.js): parentRunId is 4th, runType
    // 7th, runName 8th. The published .d.ts lists them differently.
    handleChainStart(chain, chainInputs, runId, parentRunId, tags, metadata, runType, runName) {
      // LangGraph's internal plumbing runs (tagged langsmith:hidden) are not
      // interesting steps; make them transparent so their children attach to
      // the nearest visible ancestor.
      // Same for generic Runnable plumbing (a RunnableLambda routing edge, an
      // unnamed RunnableSequence) — graph nodes carry their node name instead.
      const anonymousRunnable = /^Runnable/.test(runName || last(chain?.id) || '');
      const parent = parentRunId && runs.get(parentRunId);
      if (parent && (tags?.includes('langsmith:hidden') || anonymousRunnable)) {
        runs.set(runId, { ...parent, passthrough: true });
        return;
      }
      // (A hidden run at the top level still gets a span — otherwise its
      // children would each start a trace of their own.)
      const isRoot = !parentRunId || !runs.has(parentRunId);
      start(runId, parentRunId, {
        name: nameOf(chain, runName),
        kind: 1,
        attrs: {
          'openinference.span.kind': isRoot ? 'AGENT' : 'CHAIN',
          'gen_ai.operation.name': isRoot ? 'invoke_agent' : undefined,
          'langchain.run_type': runType,
          'input.value': inputs(chainInputs),
          'tags': tags?.length ? tags : undefined,
        },
      });
    },
    handleChainEnd(chainOutputs, runId) {
      finish(runId, { attrs: { 'output.value': outputs(chainOutputs) } });
    },
    handleChainError(err, runId) {
      finish(runId, { error: err });
    },

    // ---- model calls ------------------------------------------------------
    handleChatModelStart(llm, messages, runId, parentRunId, extraParams, tags, metadata, runName) {
      const model = metadata?.ls_model_name || extraParams?.invocation_params?.model || llm?.kwargs?.model || nameOf(llm, runName);
      start(runId, parentRunId, {
        name: `chat ${model}`,
        kind: 3,
        attrs: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.request.model': model,
          'gen_ai.provider.name': metadata?.ls_provider,
          'gen_ai.request.temperature': metadata?.ls_temperature,
          'gen_ai.input.messages': recordInputs ? safeJson((messages || []).flat().map(toMessage)) : undefined,
          'gen_ai.tool.definitions': extraParams?.invocation_params?.tools ? safeJson(extraParams.invocation_params.tools) : undefined,
        },
      });
    },
    handleLLMStart(llm, prompts, runId, parentRunId, extraParams, tags, metadata, runName) {
      const model = metadata?.ls_model_name || extraParams?.invocation_params?.model || nameOf(llm, runName);
      start(runId, parentRunId, {
        name: `text_completion ${model}`,
        kind: 3,
        attrs: {
          'gen_ai.operation.name': 'text_completion',
          'gen_ai.request.model': model,
          'gen_ai.provider.name': metadata?.ls_provider,
          'gen_ai.prompt': inputs(prompts?.length === 1 ? prompts[0] : prompts),
        },
      });
    },
    handleLLMEnd(output, runId) {
      const { input, output: out } = usageOf(output);
      const gens = (output?.generations || []).flat();
      const msgs = gens.map((g) => (g.message ? toMessage(g.message) : { role: 'assistant', content: g.text }));
      finish(runId, {
        attrs: {
          'gen_ai.usage.input_tokens': input,
          'gen_ai.usage.output_tokens': out,
          'gen_ai.response.model': output?.llmOutput?.model_name || output?.llmOutput?.model,
          'gen_ai.output.messages': outputs(msgs),
        },
      });
    },
    handleLLMError(err, runId) {
      finish(runId, { error: err });
    },

    // ---- tools -------------------------------------------------------------
    handleToolStart(tool, input, runId, parentRunId, tags, metadata, runName, toolCallId) {
      const name = nameOf(tool, runName);
      start(runId, parentRunId, {
        name: `execute_tool ${name}`,
        attrs: {
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': name,
          'gen_ai.tool.call.id': toolCallId,
          'gen_ai.tool.call.arguments': recordInputs ? (typeof input === 'string' ? input : safeJson(input)) : undefined,
        },
      });
    },
    handleToolEnd(output, runId) {
      // Tool runs usually end with a ToolMessage; unwrap to its content.
      const v = output && typeof output === 'object' && 'content' in output ? output.content : output;
      finish(runId, { attrs: { 'gen_ai.tool.call.result': recordOutputs ? (typeof v === 'string' ? v : safeJson(v)) : undefined } });
    },
    handleToolError(err, runId) {
      finish(runId, { error: err });
    },

    // ---- retrievers --------------------------------------------------------
    handleRetrieverStart(retriever, query, runId, parentRunId, tags, metadata, name) {
      start(runId, parentRunId, {
        name: nameOf(retriever, name),
        attrs: { 'openinference.span.kind': 'RETRIEVER', 'input.value': inputs(query) },
      });
    },
    handleRetrieverEnd(documents, runId) {
      finish(runId, {
        attrs: {
          'retrieval.documents.count': documents?.length,
          'output.value': outputs((documents || []).map((d) => ({ pageContent: d.pageContent, metadata: d.metadata }))),
        },
      });
    },
    handleRetrieverError(err, runId) {
      finish(runId, { error: err });
    },

    /** Send anything still batched. Called automatically when a root run ends. */
    flush: () => x.flush(),
  };
}
