// One-line Vercel AI SDK (v7+) wiring for tracelet — zero dependencies.
//
//   import { registerTelemetry } from 'ai';
//   import { tracelet } from '@jnmetacode/tracelet/ai-sdk';
//   registerTelemetry(tracelet());
//
// or, as a pure side-effect import that does the same:
//
//   import '@jnmetacode/tracelet/ai-sdk/register';
//
// The AI SDK v7 replaced the old "bring an OpenTelemetry tracer" model with
// telemetry *integrations*: plain objects with onStart / onLanguageModelCallStart
// / onToolExecutionStart … callbacks. This module is such an integration. It
// turns those callbacks into OTLP/JSON spans — the same shape the official
// `@ai-sdk/otel` integration emits (gen_ai.* + ai.* attributes) — and POSTs
// them to tracelet's ingest endpoint. No @opentelemetry/* packages needed.
//
// Spans per generateText / streamText call:
//   ai.generateText            (root; gen_ai.operation.name = invoke_agent)
//   └─ chat <model>            one per model round-trip (gen_ai.operation.name = chat)
//   └─ ai.toolCall             one per tool execution   (gen_ai.operation.name = execute_tool)
//
// Honors `experimental_telemetry: { recordInputs: false }` / `recordOutputs: false`.

import { createExporter, hex, safeJson } from './emit.js';

/**
 * Create an AI SDK telemetry integration that streams spans to tracelet.
 * @param {object} [opts]
 * @param {string} [opts.url]          OTLP/HTTP traces endpoint (default: $TRACELET_URL or http://localhost:4318/v1/traces)
 * @param {string} [opts.serviceName]  `service.name` shown in tracelet (default: 'ai-sdk')
 * @param {number} [opts.flushMs]      batch window before POSTing (default: 100)
 * @param {Function} [opts.fetch]      fetch implementation (tests)
 */
export function tracelet(opts = {}) {
  const x = createExporter({ scope: 'ai-sdk', ...opts });
  const flush = () => x.flush();
  const calls = new Map(); // callId → per-run state
  const state = (callId) => calls.get(callId);

  // A span is "open" while it has a start but no end; `finish` seals and queues it.
  const open = (st, { name, parentSpanId, attrs, kind }) =>
    x.open({ traceId: st.traceId, parentSpanId, name, attrs, kind });
  const finish = (span, extra) => x.end(span, extra);

  const integration = {
    onStart(e) {
      const st = {
        traceId: hex(16),
        operationId: e.operationId || 'ai.generateText',
        inputs: e.recordInputs !== false,
        outputs: e.recordOutputs !== false,
        llm: [], // open inference spans (FIFO — steps run sequentially)
        tools: new Map(), // toolCallId → open tool span
      };
      st.root = open(st, {
        name: st.operationId,
        attrs: {
          'operation.name': st.operationId,
          'gen_ai.operation.name': 'invoke_agent',
          'gen_ai.provider.name': e.provider,
          'gen_ai.request.model': e.modelId,
          'ai.model.provider': e.provider,
          'ai.model.id': e.modelId,
          'ai.telemetry.functionId': e.functionId,
          'gen_ai.agent.name': e.functionId,
          'gen_ai.system_instructions': st.inputs && e.instructions != null ? safeJson(e.instructions) : undefined,
          'ai.prompt.messages': st.inputs && e.messages ? safeJson(e.messages) : undefined,
        },
      });
      calls.set(e.callId, st);
    },

    onLanguageModelCallStart(e) {
      const st = state(e.callId);
      if (!st) return;
      st.llm.push(
        open(st, {
          name: `chat ${e.modelId}`,
          parentSpanId: st.root.spanId,
          kind: 3, // CLIENT
          attrs: {
            'gen_ai.operation.name': 'chat',
            'gen_ai.provider.name': e.provider,
            'gen_ai.request.model': e.modelId,
            'gen_ai.system_instructions': st.inputs && e.instructions != null ? safeJson(e.instructions) : undefined,
            'gen_ai.input.messages': st.inputs && e.messages ? safeJson(e.messages) : undefined,
            'gen_ai.tool.definitions': e.tools?.length ? safeJson(e.tools) : undefined,
          },
        })
      );
    },

    onLanguageModelCallEnd(e) {
      const st = state(e.callId);
      const span = st?.llm.shift();
      if (!span) return;
      const u = e.usage || {};
      finish(span, {
        attrs: {
          'gen_ai.response.model': e.modelId,
          'gen_ai.response.id': e.responseId,
          'gen_ai.response.finish_reasons': e.finishReason ? [e.finishReason] : undefined,
          'gen_ai.usage.input_tokens': u.inputTokens,
          'gen_ai.usage.output_tokens': u.outputTokens,
          'gen_ai.usage.cache_read.input_tokens': u.inputTokenDetails?.cacheReadTokens,
          'gen_ai.output.messages': st.outputs && e.content ? safeJson([{ role: 'assistant', parts: e.content }]) : undefined,
        },
      });
    },

    onToolExecutionStart(e) {
      const st = state(e.callId);
      const tc = e.toolCall;
      if (!st || !tc) return;
      st.tools.set(
        tc.toolCallId,
        open(st, {
          name: 'ai.toolCall',
          parentSpanId: st.root.spanId,
          attrs: {
            'gen_ai.operation.name': 'execute_tool',
            'gen_ai.tool.name': tc.toolName,
            'gen_ai.tool.call.id': tc.toolCallId,
            'ai.toolCall.name': tc.toolName,
            'ai.toolCall.id': tc.toolCallId,
            'ai.toolCall.args': st.inputs ? safeJson(tc.input) : undefined,
          },
        })
      );
    },

    onToolExecutionEnd(e) {
      const st = state(e.callId);
      const id = e.toolCall?.toolCallId;
      const span = st?.tools.get(id);
      if (!span) return;
      st.tools.delete(id);
      const out = e.toolOutput || {};
      const failed = out.type && out.type !== 'tool-result';
      finish(span, {
        attrs: { 'ai.toolCall.result': st.outputs && !failed ? safeJson(out.output) : undefined },
        error: failed ? out.error ?? out.type : undefined,
      });
    },

    onEnd(e) {
      const st = state(e.callId);
      if (!st) return;
      const u = e.totalUsage || e.usage || {};
      // Anything still open when the run ends (e.g. a stream cut short) is
      // sealed now rather than lost.
      for (const s of st.llm) finish(s);
      for (const s of st.tools.values()) finish(s);
      finish(st.root, {
        attrs: {
          'ai.response.text': st.outputs ? e.text : undefined,
          'ai.response.object': st.outputs && e.object !== undefined ? safeJson(e.object) : undefined,
          'ai.response.finishReason': e.finishReason,
          'gen_ai.usage.input_tokens': u.inputTokens,
          'gen_ai.usage.output_tokens': u.outputTokens,
        },
      });
      calls.delete(e.callId);
      void flush();
    },

    onError(e) {
      const st = state(e.callId);
      if (!st) return;
      for (const s of st.llm) finish(s, { error: e.error });
      for (const s of st.tools.values()) finish(s, { error: e.error });
      finish(st.root, { error: e.error });
      calls.delete(e.callId);
      void flush();
    },

    onAbort(e) {
      integration.onError({ callId: e.callId, error: 'aborted' });
    },

    /** Send anything still batched. Called automatically at the end of each run. */
    flush,
  };

  return integration;
}

/**
 * Register a tracelet integration globally — the same as
 * `registerTelemetry(tracelet(opts))` from 'ai', without importing 'ai' here.
 */
export function register(opts) {
  const integration = tracelet(opts);
  (globalThis.AI_SDK_TELEMETRY_INTEGRATIONS ||= []).push(integration);
  return integration;
}
