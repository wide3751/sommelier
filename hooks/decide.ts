// Pure routing logic: no mods API calls, so it can be unit tested and reused.
// Every sentence is judged on its own (ADR 0002): upgrades always go ahead,
// downgrades only on a new topic and only when the cache ledger says the
// switch pays for itself.

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

// 「平衡」profile (docs/spec.md「參數三層」): Jev thresholds, how many turns a
// downgrade has to pay itself back in, and the longest conversation haiku takes.
export const BALANCED = { tOpus: 0.35, tSonnet: 0.35, tNew: 0.7, tRisk: 0.5, payback: 3, haikuMaxCtx: 30000 }

const MODEL_ORDER = ['haiku', 'sonnet', 'opus']
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max']

// Rungs order by model, then effort: haiku·medium < sonnet·medium < opus·medium < opus·high.
export function compareRung(a, b) {
  const m = MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model)
  return m || EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort)
}

export function sameRung(a, b) {
  return !!a && !!b && a.model === b.model && a.effort === b.effort
}

// Short replies and continuation words carry on the current work, so they are
// not sent to Jev (docs/spec.md「由程式判斷、不送 Jev」).
export const SHORT_REPLY_CHARS = 8
export const CONTINUATION_WORDS = ['ok', '好', '嗯', '繼續', 'yes', 'go', 'continue', '對', '可以', '沒問題', '照這樣']

export function isShortReply(text) {
  const bare = text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
  return [...bare].length <= SHORT_REPLY_CHARS || CONTINUATION_WORDS.includes(bare)
}

// Asking for deep thought by name (docs/spec.md「由程式判斷、不送 Jev」): the
// whole word ultrathink, or 仔細想／深入想, outside code. Fenced blocks and
// inline code are dropped first, so a pasted snippet never triggers it.
export function asksDeepThought(text) {
  const prose = String(text).replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ')
  return /(^|[^\p{L}\p{N}_])ultrathink(?![\p{L}\p{N}_])/iu.test(prose) || /仔細想|深入想/.test(prose)
}

function rungAt(level, ladder, base) {
  return ladder[level] ?? base
}

function atLeast(rung, floor) {
  return MODEL_ORDER.indexOf(rung.model) >= MODEL_ORDER.indexOf(floor.model) ? rung : { ...floor }
}

// answers: the `answers` object of a Jev response.
// Returns the target rung, the depth level it came from, and whether
// high_risk raised it to at least base (route adds high effort for this turn only).
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
  if (risky) rung = atLeast(rung, base)
  return { rung, level, highRisk: risky, newTask: answers.new_task?.noul ?? null }
}

// Only the 5.5 family is routed (docs/spec.md「分派決策」2). Compared by full
// id with any date suffix dropped, never by alias; a `[1m]` variant is not one.
export function isSupportedModel(id) {
  const bare = String(id ?? '').replace(/-\d{8}$/, '')
  return Object.values(MODEL_IDS).includes(bare)
}

// A slash command as typed: "/name" or "/plugin:name", then a space or the end.
// A pasted path such as /Users/me/x is not one.
export function isSlashCommand(text) {
  return /^\/[A-Za-z][\w:.-]*(\s|$)/.test(text)
}

// Prompt origins (PromptOrigin.kind) that are the user's own words. Any other
// origin — a notification, a schedule, a peer, a plugin — carries on the
// current rung without a judgement.
export const USER_ORIGINS = ['composer', 'bridge', 'sdk', 'slack-ping']

export function modelId(model) {
  return MODEL_IDS[model] ?? model
}

export function shortModel(id) {
  for (const [name, full] of Object.entries(MODEL_IDS)) if (id === full || id === name) return name
  return id
}

// The model with its version for display: claude-haiku-5-5 (or one with a
// date suffix) reads as "haiku 5.5". An id of another shape falls back to shortModel.
export function modelLabel(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(String(id))
  if (!m) return shortModel(id)
  return m[1] + ' ' + m[2] + (m[3] ? '.' + m[3] : '')
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

// What a turn costs before this session has turns of its own to average.
export const DEFAULT_TURN = { output: 2000, fresh: 3000 }

// The cache ledger (docs/spec.md「cache 帳」): per model, when the main
// conversation last used it, how many tokens that request's cache covered and
// the message count then. Facts from the API's usage only.
// The system prompt and tool definitions stay cached across a conversation
// rewrite (ticket 01 measured about 22k); the API looks back at most 20 cache
// positions, approximated in messages.
export const STABLE_PREFIX = 22000
export const LOOKBACK_MESSAGES = 20
export const TTL_MS = { '5m': 5 * 60 * 1000, '1h': 60 * 60 * 1000 }

export function ledgerEntry(usage, at, messageCount) {
  const cachedTokens = (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.input_tokens ?? 0)
  return { lastUsedAt: at, cachedTokens, messageCountAt: messageCount, cold: false }
}

// /clear, compact and resume rewrite the conversation: every model's cache
// keeps the stable prefix only.
export function markCold(ledger) {
  const out = {}
  for (const [m, entry] of Object.entries(ledger)) out[m] = { ...entry, cold: true }
  return out
}

// Tokens a request on this model would have to write instead of read.
// Never used or expired → all of it; rewritten conversation or too many
// messages since → all but the stable prefix; otherwise only what is new.
export function coldTokens(entry, contextTokens, now, messageCount, ttl = '1h') {
  if (!entry || now - entry.lastUsedAt > (TTL_MS[ttl] ?? TTL_MS['1h'])) return contextTokens
  if (entry.cold || messageCount - entry.messageCountAt > LOOKBACK_MESSAGES) return Math.max(0, contextTokens - STABLE_PREFIX)
  return Math.max(0, contextTokens - entry.cachedTokens)
}

// Whether moving the conversation from one model to another pays for itself.
// The switch writes `cold` tokens into the new model's cache instead of reading
// them; it pays when that extra cost is no more than what the cheaper model
// saves over `turns` turns. Upgrades always go ahead: they are made for
// quality, not cost.
// turn: average output tokens and freshly cached tokens per turn.
export function switchCost(from, to, contextTokens, cold, turn = DEFAULT_TURN, ttl = '1h', turns = BALANCED.payback) {
  const a = PRICES[from]
  const b = PRICES[to]
  if (!a || !b || from === to || MODEL_ORDER.indexOf(to) > MODEL_ORDER.indexOf(from)) {
    return { pays: true, extra: 0, savings: 0 }
  }
  const M = 1e6
  const w = CACHE_WRITE_MULT[ttl] ?? CACHE_WRITE_MULT['1h']
  const extra = (cold * (b.input * w - b.cacheRead)) / M
  const perTurn =
    (turn.output * (a.output - b.output) +
      turn.fresh * (a.input - b.input) * w +
      contextTokens * (a.cacheRead - b.cacheRead)) / M
  const savings = perTurn * turns
  return { pays: extra <= savings, extra, savings }
}

// Haiku is kept to short conversations; a longer one moves to sonnet.
export function qualityGuard(rung, contextTokens, cfg = BALANCED) {
  return rung && rung.model === 'haiku' && (contextTokens ?? 0) > cfg.haikuMaxCtx ? { model: 'sonnet', effort: 'medium' } : null
}

// 覆寫 (docs/spec.md「分派決策」6): `somm:opus`, `somm:sonnet` or `somm:haiku`
// at the very start of a prompt. Returns the rung it names and the prompt
// without it, or null. effort stays medium; `:high` is not taken yet.
export function parseOverride(text) {
  const m = /^\s*somm:(opus|sonnet|haiku)(?![\w:])\s*/i.exec(String(text))
  if (!m) return null
  return { rung: { model: m[1].toLowerCase(), effort: 'medium' }, text: String(text).slice(m[0].length) }
}

// What writing `cold` tokens into a model's cache costs over reading them, in USD.
export function rewriteCost(model, cold, ttl = '1h') {
  const p = PRICES[model]
  if (!p) return 0
  return (cold * (p.input * (CACHE_WRITE_MULT[ttl] ?? CACHE_WRITE_MULT['1h']) - p.cacheRead)) / 1e6
}

// A turn that asked for deep thought goes to L3 without asking Jev. It can
// only move up, so there is nothing to weigh: an upgrade that sticks like any
// other, or the current rung when that is already as high.
export function routeDeepThought(s, ladder = DEFAULT_LADDER, base = DEFAULT_BASE) {
  const target = { ...rungAt(3, ladder, base) }
  const from = s.current ?? s.session
  const next = compareRung(target, from) > 0 ? target : s.current
  return { rung: next ?? from, current: next, reason: 'ultrathink', level: 3 }
}

// One sentence's routing (docs/spec.md「分派決策」8–11).
// s.current: the current rung, or null while the session model is in use;
// s.session: the session's own rung; s.firstTurn: no judgement yet in this
// conversation; s.ledger, s.contextTokens, s.now, s.messageCount, s.ttl,
// s.turn: what the switch cost is estimated from.
// Returns the rung for this turn (null: leave the request alone), the new
// current rung and why.
export function route(answers, s) {
  const d = targetRung(answers)
  const from = s.current ?? s.session
  const newTopic = s.firstTurn || (d.newTask ?? 0) >= BALANCED.tNew
  const ctx = s.contextTokens ?? 0
  let next = s.current
  let reason
  let cost = null
  let target = d.rung
  if (compareRung(target, from) > 0) {
    reason = 'upgrade'
    next = target
  } else if (sameRung(target, from) || !newTopic) {
    reason = 'hold'
  } else {
    if (qualityGuard(target, ctx)) target = qualityGuard(target, ctx)
    if (compareRung(target, from) >= 0) {
      reason = 'hold'
    } else {
      const cold = coldTokens(s.ledger[target.model], ctx, s.now, s.messageCount, s.ttl)
      cost = { cold, target: target.model, ...switchCost(from.model, target.model, ctx, cold, s.turn, s.ttl) }
      reason = cost.pays ? 'downgrade' : 'cost_blocked'
      if (cost.pays) next = target
    }
  }
  const guard = qualityGuard(next, ctx)
  if (guard) {
    reason = 'quality_guard'
    next = guard
  }
  const rung = d.highRisk ? { ...(next ?? from), effort: 'high' } : next
  return { rung, current: next, reason, newTopic, level: d.level, highRisk: d.highRisk, newTask: d.newTask, cost }
}
