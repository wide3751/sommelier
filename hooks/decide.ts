// Pure routing logic: no mods API calls, so it can be unit tested and reused.
// Ticket 04 covers the ladder and the cumulative-probability rule only;
// cache-ledger rules arrive in ticket 05.

// turn.step rejects aliases ("sonnet" → unrecognized_model), so send full IDs.
export const MODEL_IDS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }

export const DEFAULT_BASE = { model: 'opus', effort: 'medium' }

// L0..L3; null means "use base".
export const DEFAULT_LADDER = [
  { model: 'haiku', effort: 'medium' },
  { model: 'sonnet', effort: 'medium' },
  null,
  { model: 'opus', effort: 'high' },
]

// 「平衡」profile (docs/spec.md「參數三層」).
export const BALANCED = { tOpus: 0.35, tSonnet: 0.35, tNew: 0.7, tRisk: 0.5 }

const MODEL_ORDER = ['haiku', 'sonnet', 'opus']

function rungAt(level, ladder, base) {
  return ladder[level] ?? base
}

function atLeast(rung, floor) {
  return MODEL_ORDER.indexOf(rung.model) >= MODEL_ORDER.indexOf(floor.model) ? rung : { ...floor }
}

// answers: the `answers` object of a Jev response.
// Returns the rung for this turn, the depth level it came from, and whether
// high_risk raised it (effort high for this turn only).
export function targetRung(answers, cfg = {}) {
  const t = { ...BALANCED, ...cfg.thresholds }
  const ladder = cfg.ladder ?? DEFAULT_LADDER
  const base = cfg.base ?? DEFAULT_BASE
  const p = answers.depth.probabilities
  const p1 = p['1'] ?? 0
  const p2 = p['2'] ?? 0
  const p3 = p['3'] ?? 0
  const p0 = p['0'] ?? 0

  let level
  if (p2 + p3 >= t.tOpus) level = p3 >= Math.max(p0, p1, p2) ? 3 : 2
  else if (p1 + p2 + p3 >= t.tSonnet) level = 1
  else level = 0

  let rung = { ...rungAt(level, ladder, base) }
  const risky = (answers.high_risk?.noul ?? 0) >= t.tRisk
  if (risky) rung = { ...atLeast(rung, base), effort: 'high' }
  return { rung, level, highRisk: risky, newTask: answers.new_task?.noul ?? null }
}

export function modelId(model) {
  return MODEL_IDS[model] ?? model
}

export function shortModel(id) {
  for (const [name, full] of Object.entries(MODEL_IDS)) if (id === full || id === name) return name
  return id
}

// List prices in USD per million tokens; the mods API exposes no price table.
// Reads are billed per model (Opus 5.5 at 0.05x input, others 0.1x). Haiku's
// prices are for prompts up to 100K tokens.
export const PRICES = {
  opus: { input: 4, output: 20, cacheRead: 0.2 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2 },
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01 },
}

// Cache writes cost 1.25x input on the 5-minute TTL and 2x on the 1-hour TTL.
// The TTL is read off each response's usage.cache_creation; Claude Code writes
// 1-hour entries, so that is the default before a response has shown one.
export const CACHE_WRITE_MULT = { '5m': 1.25, '1h': 2 }

// The TTL a response's usage shows it wrote, or undefined when it wrote none.
export function cacheTtl(usage) {
  const c = usage && usage.cache_creation
  if (!c) return undefined
  if (c.ephemeral_1h_input_tokens > 0) return '1h'
  if (c.ephemeral_5m_input_tokens > 0) return '5m'
  return undefined
}

// How many more turns a switch has to pay itself back in, and what a turn
// costs before this session has turns of its own to average.
export const EXPECTED_TURNS = 5
export const DEFAULT_TURN = { output: 2000, fresh: 3000 }

// Whether moving the session from one model to another pays for itself.
// Caches are model-scoped, so the switch rewrites the whole prompt
// (contextTokens) into the new model's cache instead of reading it from the
// old one's. Upgrades always go ahead: they are made for quality, not cost.
// turn: average output tokens and freshly cached tokens per turn.
export function switchCost(from, to, contextTokens, turn = DEFAULT_TURN, ttl = '1h', turns = EXPECTED_TURNS) {
  const a = PRICES[from]
  const b = PRICES[to]
  if (!a || !b || from === to || MODEL_ORDER.indexOf(to) > MODEL_ORDER.indexOf(from)) {
    return { pays: true, extra: 0, savings: 0 }
  }
  const M = 1e6
  const w = CACHE_WRITE_MULT[ttl] ?? CACHE_WRITE_MULT['1h']
  const extra = (contextTokens * (b.input * w - a.cacheRead)) / M
  const perTurn =
    (turn.output * (a.output - b.output) +
      turn.fresh * (a.input - b.input) * w +
      contextTokens * (a.cacheRead - b.cacheRead)) / M
  const savings = perTurn * turns
  return { pays: extra <= savings, extra, savings }
}
