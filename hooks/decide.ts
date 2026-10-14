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

// Switching models mid-conversation rewrites the whole transcript into the new
// model's prompt cache. Until ticket 05's cache ledger weighs that cost, the
// first judgement is skipped once the transcript is this long.
export const LONG_CONVERSATION_TOKENS = 20000

// Rough token count of a transcript: CJK characters count one each, other
// text one per four characters. Tool inputs and results are included, since
// they are cached too.
export function estimateTokens(messages) {
  let cjk = 0
  let other = 0
  const add = (s) => {
    const n = (s.match(/[　-鿿豈-﫿＀-￯]/g) || []).length
    cjk += n
    other += s.length - n
  }
  for (const m of messages) {
    add(m.text || '')
    for (const u of m.toolUses || []) add(JSON.stringify(u.input ?? ''))
    for (const r of m.toolResults || []) add(r.text || '')
  }
  return cjk + Math.ceil(other / 4)
}
