// Best-effort cost estimates per LLM span, from published list prices.
// Prices are USD per 1M tokens (input, output), checked 2026-06. They change —
// treat every figure as an estimate (the UI labels it "~"). Unknown models
// simply get no estimate; we never guess.

const USD_PER_MTOK = [
  // Anthropic (per platform.claude.com pricing)
  ['claude-fable-5', 10, 50],
  ['claude-opus-4-8', 5, 25],
  ['claude-opus-4-7', 5, 25],
  ['claude-opus-4-6', 5, 25],
  ['claude-opus-4-5', 5, 25],
  ['claude-opus', 15, 75], // older opus (4.1 and earlier)
  ['claude-sonnet', 3, 15],
  ['claude-3-7-sonnet', 3, 15],
  ['claude-3-5-sonnet', 3, 15],
  ['claude-haiku-4-5', 1, 5],
  ['claude-3-5-haiku', 0.8, 4],
  ['claude-3-haiku', 0.25, 1.25],
  // OpenAI
  ['gpt-5-mini', 0.25, 2],
  ['gpt-5', 1.25, 10],
  ['gpt-4.1-nano', 0.1, 0.4],
  ['gpt-4.1-mini', 0.4, 1.6],
  ['gpt-4.1', 2, 8],
  ['gpt-4o-mini', 0.15, 0.6],
  ['gpt-4o', 2.5, 10],
  ['o4-mini', 1.1, 4.4],
  ['o3', 2, 8],
  // Google
  ['gemini-2.5-pro', 1.25, 10],
  ['gemini-2.5-flash', 0.3, 2.5],
  ['gemini-2.0-flash', 0.1, 0.4],
];

// Longest-prefix wins, so 'claude-opus-4-8' beats 'claude-opus'.
const TABLE = [...USD_PER_MTOK].sort((a, b) => b[0].length - a[0].length);

function normalize(model) {
  let m = String(model || '').toLowerCase();
  // strip provider prefixes ("anthropic.claude-…", "openai/gpt-…", "models/gemini-…")
  m = m.replace(/^(anthropic|openai|google|models|publishers\/[a-z]+\/models)[./]/, '');
  // bedrock regional prefixes like "us.anthropic.claude-…"
  m = m.replace(/^[a-z]{2}\.(anthropic|amazon)\./, '');
  return m;
}

/** USD estimate for one call, or null when the model isn't in the table. */
export function estimateCost(model, inputTokens, outputTokens) {
  const m = normalize(model);
  if (!m) return null;
  for (const [prefix, inRate, outRate] of TABLE) {
    if (m.startsWith(prefix)) {
      return ((inputTokens || 0) * inRate + (outputTokens || 0) * outRate) / 1e6;
    }
  }
  return null;
}

/** Sum estimates across a trace's spans; null when nothing was estimable. */
export function estimateTraceCost(spans) {
  let total = null;
  for (const s of spans) {
    if (s.kind !== 'llm' || !s.tokens) continue;
    const c = estimateCost(s.io?.model, s.tokens.input, s.tokens.output);
    if (c != null) total = (total || 0) + c;
  }
  return total;
}

/** "~$0.0042" style display string. */
export function formatCost(usd) {
  if (usd == null) return '';
  if (usd >= 0.1) return `~$${usd.toFixed(2)}`;
  if (usd >= 0.001) return `~$${usd.toFixed(4)}`;
  return `~$${usd.toFixed(6)}`;
}
