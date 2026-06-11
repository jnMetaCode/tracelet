// Decode OTLP/HTTP JSON into flat span records, then enrich each span with
// semantic info (LLM model, tokens, prompt/response, tool calls).
//
// We deliberately read MULTIPLE conventions so Tracelet "just works" no matter
// which framework emitted the trace:
//   - OpenTelemetry GenAI semantic conventions  (gen_ai.*)
//   - OpenInference (Arize)                      (llm.*, openinference.span.kind, input.value/output.value)
//   - Vercel AI SDK experimental_telemetry       (ai.*)

const SPAN_KIND = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];

function anyValue(v) {
  if (v == null) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(anyValue);
  if (v.kvlistValue !== undefined) return attrsToObject(v.kvlistValue.values || []);
  return undefined;
}

function attrsToObject(attrs) {
  const out = {};
  for (const a of attrs || []) out[a.key] = anyValue(a.value);
  return out;
}

// Convert a nanosecond unix timestamp string to float milliseconds without
// losing precision through Number() (nanos overflow 2^53).
function nanoToMs(nanos) {
  if (nanos == null || nanos === '') return NaN; // absent timestamp — caller must not treat as 0
  try {
    return Number(BigInt(nanos) / 1000n) / 1000;
  } catch {
    return Number(nanos) / 1e6;
  }
}

const first = (obj, keys) => {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== '') return obj[k];
  return undefined;
};

function detectKind(name, attrs) {
  const oi = (attrs['openinference.span.kind'] || '').toString().toLowerCase();
  if (oi) return oi; // llm | tool | chain | retriever | agent | embedding | reranker
  const n = (name || '').toLowerCase();
  if (attrs['gen_ai.system'] || attrs['gen_ai.request.model'] || attrs['ai.model.id']) {
    if (attrs['tool.name'] || attrs['ai.toolCall.name'] || n.includes('toolcall')) return 'tool';
    return 'llm';
  }
  if (attrs['tool.name'] || attrs['ai.toolCall.name'] || attrs['gen_ai.tool.name']) return 'tool';
  if (n.includes('embedding')) return 'embedding';
  if (n.includes('retriev')) return 'retriever';
  if (n.startsWith('ai.generate') || n.startsWith('ai.stream')) return 'llm';
  return 'span';
}

function extractTokens(attrs) {
  const input = first(attrs, [
    'gen_ai.usage.input_tokens',
    'gen_ai.usage.prompt_tokens',
    'llm.token_count.prompt',
    'ai.usage.promptTokens',
    'ai.usage.inputTokens',
  ]);
  const output = first(attrs, [
    'gen_ai.usage.output_tokens',
    'gen_ai.usage.completion_tokens',
    'llm.token_count.completion',
    'ai.usage.completionTokens',
    'ai.usage.outputTokens',
  ]);
  const total = first(attrs, ['gen_ai.usage.total_tokens', 'llm.token_count.total']);
  if (input == null && output == null && total == null) return undefined;
  // Some exporters emit token counts as stringValue — coerce so downstream
  // sums never string-concatenate.
  const num = (v) => (v == null ? null : Number(v) || 0);
  const i = num(input), o = num(output), t = num(total);
  return { input: i ?? 0, output: o ?? 0, total: t ?? (i || 0) + (o || 0) };
}

// OpenInference flattens chat history into indexed keys:
//   llm.input_messages.0.message.role / llm.input_messages.0.message.content
// Reassemble those back into an array of {role, content}.
function reassembleMessages(attrs, prefix) {
  const idx = new Map();
  const re = new RegExp(`^${prefix.replace(/\./g, '\\.')}\\.(\\d+)\\.message\\.(\\w+)$`);
  for (const key of Object.keys(attrs)) {
    const m = key.match(re);
    if (!m) continue;
    const i = Number(m[1]);
    if (!idx.has(i)) idx.set(i, {});
    idx.get(i)[m[2]] = attrs[key];
  }
  if (!idx.size) return undefined;
  return [...idx.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function extractIO(kind, attrs, events) {
  const io = {};
  io.model = first(attrs, ['gen_ai.request.model', 'ai.model.id', 'llm.model_name', 'gen_ai.response.model']);
  io.system = first(attrs, ['gen_ai.system', 'ai.model.provider', 'llm.provider']);

  // Prompt / input — three overlapping vocabularies, plus OpenInference's
  // flattened indexed messages, plus a fallback to span events (older GenAI
  // puts content in events like gen_ai.content.prompt / *.user.message).
  io.input =
    first(attrs, [
      'gen_ai.input.messages', // newer GenAI structured attribute
      'gen_ai.prompt',
      'ai.prompt',
      'ai.prompt.messages',
      'input.value',
      'tool.arguments',
      'ai.toolCall.args',
    ]) ?? reassembleMessages(attrs, 'llm.input_messages');
  io.system_instructions = attrs['gen_ai.system_instructions'];
  io.output =
    first(attrs, [
      'gen_ai.output.messages', // newer GenAI structured attribute
      'gen_ai.completion',
      'ai.response.text',
      'ai.response.object',
      'ai.response.toolCalls',
      'output.value',
      'ai.toolCall.result',
      'tool.result',
    ]) ?? reassembleMessages(attrs, 'llm.output_messages');

  if (io.input === undefined || io.output === undefined) {
    for (const ev of events || []) {
      const en = (ev.name || '').toLowerCase();
      const ea = attrsToObject(ev.attributes);
      if (io.input === undefined && (en.includes('prompt') || en.includes('input') || en.includes('user.message') || en.includes('system.message'))) {
        io.input = ea['gen_ai.prompt'] ?? ea.content ?? ea.body ?? JSON.stringify(ea);
      }
      if (io.output === undefined && (en.includes('completion') || en.includes('choice') || en.includes('output') || en.includes('assistant.message'))) {
        io.output = ea['gen_ai.completion'] ?? ea.content ?? ea.body ?? JSON.stringify(ea);
      }
    }
  }

  if (kind === 'tool') {
    io.toolName = first(attrs, ['tool.name', 'ai.toolCall.name', 'gen_ai.tool.name']);
  }

  // Drop undefined keys for a clean payload.
  for (const k of Object.keys(io)) if (io[k] === undefined) delete io[k];
  return io;
}

/**
 * Parse an OTLP/HTTP JSON ExportTraceServiceRequest into flat span records.
 * @param {object} body parsed JSON with `resourceSpans`
 * @returns {Array<object>}
 */
export function parseOtlp(body) {
  const out = [];
  for (const rs of body.resourceSpans || []) {
    const resource = attrsToObject(rs.resource?.attributes);
    const service = resource['service.name'] || 'agent';
    for (const ss of rs.scopeSpans || rs.instrumentationLibrarySpans || []) {
      const scope = ss.scope?.name || ss.instrumentationLibrary?.name || '';
      for (const sp of ss.spans || []) {
        const attrs = attrsToObject(sp.attributes);
        const start = nanoToMs(sp.startTimeUnixNano);
        const end = nanoToMs(sp.endTimeUnixNano);
        const hasTimes = Number.isFinite(start) && Number.isFinite(end);
        const kind = detectKind(sp.name, attrs);
        const statusCode = sp.status?.code; // 0 UNSET, 1 OK, 2 ERROR
        out.push({
          traceId: sp.traceId,
          spanId: sp.spanId,
          parentSpanId: sp.parentSpanId || null,
          name: sp.name || '(unnamed)',
          service,
          scope,
          otelKind: SPAN_KIND[sp.kind] || 'INTERNAL',
          kind, // semantic: llm | tool | chain | retriever | agent | embedding | span
          start,
          end,
          durationMs: hasTimes ? Math.max(0, end - start) : 0,
          status: statusCode === 2 ? 'ERROR' : statusCode === 1 ? 'OK' : 'UNSET',
          statusMessage: sp.status?.message || '',
          tokens: extractTokens(attrs),
          io: extractIO(kind, attrs, sp.events),
          attributes: attrs,
          events: (sp.events || []).map((e) => ({
            name: e.name,
            time: nanoToMs(e.timeUnixNano),
            attributes: attrsToObject(e.attributes),
          })),
        });
      }
    }
  }
  return out;
}
