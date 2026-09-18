// Shared between the Node server and the browser (plain ESM, no deps).
// Encodes the Jev wire format (https://docs.typesafe.ai/api) and the
// guidance from the primitives, state, and jev-1.13 jaggedness pages.

export const PROVIDERS = {
  openrouter: {
    label: "OpenRouter",
    url: "https://openrouter.ai/api/alpha/decisions",
    envKey: "OPENROUTER_API_KEY",
    models: ["typesafe/jev-1.13", "~typesafe/jev-latest"],
  },
  typesafe: {
    label: "TypeSafe direct",
    url: "https://api.typesafe.ai/v1/systemone",
    envKey: "TYPESAFE_API_KEY",
    models: ["jev-1.13.0", "jev-latest", "jev-preview"],
  },
  mock: {
    label: "Mock (no network)",
    url: null,
    envKey: null,
    models: ["mock-jev"],
  },
};

// Fallback price when a provider's usage block has no cost field.
export const PRICE_PER_MTOK = 0.042;

function estimateTokens(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.ceil((s?.length ?? 0) / 4);
}

// ---------- mock answers (for offline use and tests) ----------
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

export function mockAnswers(body) {
  const answers = {};
  const stateStr = typeof body.state === "string" ? body.state : JSON.stringify(body.state);
  for (const [id, q] of Object.entries(body.questions)) {
    const seed = hash(stateStr + id + JSON.stringify(q.instructions));
    if (q.type === "noul") {
      answers[id] = { type: "noul", noul: round(seed) };
    } else if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const raw = keys.map((k, i) => Math.pow(hash(seed + k + i), 3) + 0.01);
      const sum = raw.reduce((a, b) => a + b, 0);
      const probabilities = Object.fromEntries(keys.map((k, i) => [k, round(raw[i] / sum)]));
      const choice = keys.reduce((a, b) => (probabilities[a] >= probabilities[b] ? a : b));
      answers[id] = { type: "choice", choice, probabilities, confidence: round(confidenceOf(Object.values(probabilities))) };
    } else if (q.type === "score") {
      const n = q.criteria.length;
      const center = seed * (n - 1);
      const raw = q.criteria.map((_, i) => Math.exp(-Math.pow(i - center, 2) / 0.6));
      const sum = raw.reduce((a, b) => a + b, 0);
      const probabilities = Object.fromEntries(raw.map((r, i) => [String(i), round(r / sum)]));
      const legend = Object.fromEntries(q.criteria.map((c, i) => [String(i), typeof c === "string" ? c : JSON.stringify(c)]));
      const score = round(raw.reduce((acc, r, i) => acc + (r / sum) * i, 0));
      answers[id] = { type: "score", score, legend, probabilities, confidence: round(confidenceOf(Object.values(probabilities))) };
    }
  }
  const input_tokens = estimateTokens(body);
  return { model: "mock-jev", answers, usage: { input_tokens, output_tokens: Object.keys(answers).length * 12 } };
}

function confidenceOf(ps) {
  const sorted = [...ps].sort((a, b) => b - a);
  return sorted.length < 2 ? 1 : sorted[0] - sorted[1];
}
const round = (x) => Math.round(x * 100) / 100;

