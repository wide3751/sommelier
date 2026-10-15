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

export const PROFILES = {
  saver: { tOpus: 0.5, tSonnet: 0.5, tNew: 0.6, tRisk: 0.5, payback: 5, haikuMaxCtx: 40000 },
  balanced: BALANCED,
  quality: { tOpus: 0.25, tSonnet: 0.2, tNew: 0.8, tRisk: 0.4, payback: 2, haikuMaxCtx: 15000 },
}
export const PROFILE_NAMES = { saver: '省額度', balanced: '平衡', quality: '品質優先' }

const MODEL_ORDER = ['haiku', 'sonnet', 'opus']
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max']

// 日常設定 (docs/spec.md「參數三層」), as stored under somm:config. On/off
// lives in its own key. spinner is on/off and notify important/off since
// ticket 12 dropped the finer modes. cache turns the status line's cache
// gauge on/off (#36).
export const DEFAULT_SETTINGS = {
  base: DEFAULT_BASE, profile: 'balanced', allowed: { min: 'haiku', max: 'opus' }, spinner: 'on', cache: 'on', notify: 'important',
  skills: 'off', skillsAllow: [], skillsExclude: [],
}

// What the routing functions read: thresholds, base, allowed range and ladder.
export function routingConfig(settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  return { thresholds: PROFILES[s.profile] ?? BALANCED, base: s.base, allowed: s.allowed, ladder: DEFAULT_LADDER }
}

const DEFAULT_CONFIG = routingConfig()

// Keeps a rung inside the allowed models; effort stays as it was.
export function clampRung(rung, allowed) {
  if (!rung || !allowed) return rung
  const i = MODEL_ORDER.indexOf(rung.model)
  if (i < MODEL_ORDER.indexOf(allowed.min)) return { model: allowed.min, effort: 'medium' }
  if (i > MODEL_ORDER.indexOf(allowed.max)) return { ...rung, model: allowed.max }
  return rung
}

function parseRung(value) {
  const m = /^(haiku|sonnet|opus)(?:[\s·:._-]+(medium|high))?$/i.exec(value.trim())
  return m ? { model: m[1].toLowerCase(), effort: (m[2] ?? 'medium').toLowerCase() } : null
}

function parseRange(value) {
  const m = /^(haiku|sonnet|opus)\s*[-~～]\s*(haiku|sonnet|opus)$/i.exec(value.trim())
  if (!m) return null
  const [min, max] = [m[1].toLowerCase(), m[2].toLowerCase()]
  return MODEL_ORDER.indexOf(min) <= MODEL_ORDER.indexOf(max) ? { min, max } : null
}

function inRange(model, allowed) {
  const i = MODEL_ORDER.indexOf(model)
  return i >= MODEL_ORDER.indexOf(allowed.min) && i <= MODEL_ORDER.indexOf(allowed.max)
}

// One /somm config change: the new settings, or why the value is refused.
export function applySetting(settings, name, value) {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  const v = String(value ?? '').trim()
  if (name === 'base') {
    const base = parseRung(v)
    if (!base) return { error: 'base 要是 haiku、sonnet 或 opus，可加 medium／high，例如 opus:high' }
    if (!inRange(base.model, s.allowed)) return { error: 'base 要在 allowed（' + s.allowed.min + '～' + s.allowed.max + '）範圍內' }
    return { settings: { ...s, base } }
  }
  if (name === 'profile') {
    const key = Object.keys(PROFILES).find((k) => k === v.toLowerCase() || PROFILE_NAMES[k] === v)
    if (!key) return { error: 'profile 要是 saver（省額度）、balanced（平衡）或 quality（品質優先）' }
    return { settings: { ...s, profile: key } }
  }
  if (name === 'allowed') {
    const allowed = parseRange(v)
    if (!allowed) return { error: 'allowed 要寫成「最低-最高」，例如 haiku-opus、sonnet-opus' }
    if (!inRange(s.base.model, allowed)) return { error: '目前的 base（' + s.base.model + '）不在這個範圍內，請先改 base' }
    return { settings: { ...s, allowed } }
  }
  if (name === 'spinner') {
    if (v !== 'on' && v !== 'off') return { error: 'spinner 要是 on 或 off' }
    return { settings: { ...s, spinner: v } }
  }
  if (name === 'cache') {
    if (v !== 'on' && v !== 'off') return { error: 'cache 要是 on 或 off' }
    return { settings: { ...s, cache: v } }
  }
  if (name === 'notify') {
    if (v !== 'important' && v !== 'off') return { error: 'notify 要是 important 或 off' }
    return { settings: { ...s, notify: v } }
  }
  if (name === 'skills') {
    if (v !== 'on' && v !== 'off') return { error: 'skills 要是 on 或 off' }
    return { settings: { ...s, skills: v } }
  }
  if (name === 'skills-allow') return { settings: { ...s, skillsAllow: parseNames(v) } }
  if (name === 'skills-exclude') return { settings: { ...s, skillsExclude: parseNames(v) } }
  return { error: '沒有這個設定：' + name + '。可用 enabled、base、profile、allowed、spinner、cache、notify、skills、skills-allow、skills-exclude' }
}

// A skill list as typed: names split by commas or spaces; empty, `-` or
// `none` clears it.
function parseNames(value) {
  if (value === '' || value === '-' || value.toLowerCase() === 'none') return []
  return [...new Set(value.split(/[\s,，、]+/).filter(Boolean))]
}

export function describeSettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  return [
    'base ' + s.base.model + '·' + s.base.effort,
    'profile ' + s.profile + '（' + PROFILE_NAMES[s.profile] + '）',
    'allowed ' + s.allowed.min + '-' + s.allowed.max,
    'spinner ' + s.spinner,
    'cache ' + s.cache,
    'notify ' + s.notify,
    'skills ' + s.skills,
    'skills-allow ' + (s.skillsAllow.length ? s.skillsAllow.join(',') : '（全部）'),
    'skills-exclude ' + (s.skillsExclude.length ? s.skillsExclude.join(',') : '（無）'),
  ]
}

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
export function targetRung(answers, cfg = DEFAULT_CONFIG) {
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
  rung = clampRung(rung, cfg.allowed)
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

// The prompt as the user wrote it, for the record: harness wrappers are
// dropped so the first characters say what was asked. A system-reminder is
// removed whole (an unclosed one runs to the end), an agent message keeps its
// text behind "[agent] ", a background task's notice keeps only its summary
// behind "[task] " (its ids and output path say nothing), and any other tag is
// stripped but its text is kept.
export function promptSummary(text) {
  const out = String(text)
    .replace(/<system-reminder>[\s\S]*?(?:<\/system-reminder>|$)/gi, ' ')
    .replace(/<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/gi, (_, body) => {
      const summary = /<summary>([\s\S]*?)(?:<\/summary>|$)/i.exec(body)
      return ' [task] ' + (summary ? summary[1] : '') + ' '
    })
    .replace(/<agent-message\b[^>]*>/gi, '[agent] ')
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return out
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

// How long a cache written with this TTL lives; unknown TTLs count as 1h.
export function ttlMs(ttl) {
  return TTL_MS[ttl] ?? TTL_MS['1h']
}

// Whether a ledger entry's cache has run out by `now`.
export function cacheExpired(entry, now, ttl) {
  return now - entry.lastUsedAt > ttlMs(ttl)
}

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
  if (!entry || cacheExpired(entry, now, ttl)) return contextTokens
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

// The cache gauge on the status line (#35): five cells for the switch cost of
// moving down to the next allowed model, as a share of what it would save
// back; full with ⚠ once the switch would be 成本擋下（cost_blocked）.
// Then the model's cached tokens in k. Empty cells at the lowest allowed
// model or once the cache has expired; '' while the ledger has nothing on
// the model, or for a model id of another shape, whose prices are unknown.
export const GAUGE_CELLS = 5

export function cacheGauge(ledger, model, contextTokens, now, messageCount, ttl = '1h', turn = DEFAULT_TURN, cfg = DEFAULT_CONFIG) {
  const entry = ledger[model]
  if (!entry || !MODEL_ORDER.includes(model)) return ''
  const allowed = cfg.allowed ?? DEFAULT_SETTINGS.allowed
  const lower = MODEL_ORDER.slice(0, MODEL_ORDER.indexOf(model)).filter((m) => inRange(m, allowed)).at(-1)
  let filled = 0
  let warn = false
  if (lower && !cacheExpired(entry, now, ttl)) {
    const ctx = contextTokens || entry.cachedTokens
    const cold = coldTokens(ledger[lower], ctx, now, messageCount, ttl)
    const c = switchCost(model, lower, ctx, cold, turn, ttl, cfg.thresholds?.payback ?? BALANCED.payback)
    const ratio = c.savings <= 0 ? Infinity : c.extra / c.savings
    filled = Math.min(GAUGE_CELLS, Math.ceil(ratio * GAUGE_CELLS))
    warn = ratio >= 1
  }
  return '▰'.repeat(filled) + '▱'.repeat(GAUGE_CELLS - filled) + (warn ? '⚠' : '') + ' ' + Math.round(entry.cachedTokens / 1000) + 'k'
}

// Haiku is kept to short conversations; a longer one moves to sonnet, unless
// sonnet is not allowed.
export function qualityGuard(rung, contextTokens, cfg = DEFAULT_CONFIG) {
  const max = cfg.thresholds?.haikuMaxCtx ?? BALANCED.haikuMaxCtx
  if (cfg.allowed && cfg.allowed.max === 'haiku') return null
  return rung && rung.model === 'haiku' && (contextTokens ?? 0) > max ? { model: 'sonnet', effort: 'medium' } : null
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
export function routeDeepThought(s, cfg = DEFAULT_CONFIG) {
  const target = clampRung({ ...rungAt(3, cfg.ladder ?? DEFAULT_LADDER, cfg.base ?? DEFAULT_BASE) }, cfg.allowed)
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
// cfg: routingConfig() of the user's settings.
export function route(answers, s, cfg = DEFAULT_CONFIG) {
  const t = { ...BALANCED, ...cfg.thresholds }
  const d = targetRung(answers, cfg)
  const from = s.current ?? s.session
  const newTopic = s.firstTurn || (d.newTask ?? 0) >= t.tNew
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
    if (qualityGuard(target, ctx, cfg)) target = qualityGuard(target, ctx, cfg)
    if (compareRung(target, from) >= 0) {
      reason = 'hold'
    } else {
      const cold = coldTokens(s.ledger[target.model], ctx, s.now, s.messageCount, s.ttl)
      cost = { cold, target: target.model, ...switchCost(from.model, target.model, ctx, cold, s.turn, s.ttl, t.payback) }
      reason = cost.pays ? 'downgrade' : 'cost_blocked'
      if (cost.pays) next = target
    }
  }
  const guard = qualityGuard(next, ctx, cfg)
  if (guard) {
    reason = 'quality_guard'
    next = guard
  }
  const rung = d.highRisk ? { ...(next ?? from), effort: 'high' } : next
  return { rung, current: next, reason, newTopic, level: d.level, highRisk: d.highRisk, newTask: d.newTask, cost }
}

// skill 提示 (#27): when a skill fits the sentence well enough, Claude is told
// so beside the prompt. Only a suggestion; it never touches the rung.
export const SKILL_THRESHOLDS = { needs: 0.3, top: 0.5 }
// A choice question takes at most 255 options.
export const SKILL_CHOICE_MAX = 255
export const SKILL_DESCRIPTION_CHARS = 300

// 候選 skill: the skills the model's listing carries (the context breakdown's
// names, so ones Claude cannot call are already left out) that have a
// description in the command list, narrowed by the allow list and then the
// exclude list. Sorted by name, so a cut past SKILL_CHOICE_MAX is stable.
export function skillCandidates(listed, commands, allow = [], exclude = []) {
  const described = new Map()
  for (const c of commands) {
    const text = (c.description ?? '').trim()
    if (text && !described.has(c.name)) described.set(c.name, text)
  }
  const names = [...new Set(listed)]
    .filter((n) => described.has(n) && (!allow.length || allow.includes(n)) && !exclude.includes(n))
    .sort()
  return {
    candidates: names.slice(0, SKILL_CHOICE_MAX).map((name) => ({ name, description: described.get(name).slice(0, SKILL_DESCRIPTION_CHARS) })),
    dropped: Math.max(0, names.length - SKILL_CHOICE_MAX),
  }
}

// The two skill questions for these candidates; null when there are too few
// to choose between.
export function skillQuestions(template, candidates) {
  if (candidates.length < 2) return null
  return {
    needs_skill: template.needs_skill,
    skill: { ...template.skill, criteria: Object.fromEntries(candidates.map((c) => [c.name, c.description])) },
  }
}

// What Jev's skill answers say: the likeliest skill and both probabilities,
// and the skill to hint, if any. A skill already hinted on this topic is not
// hinted again.
export function pickSkill(answers, hinted = [], t = SKILL_THRESHOLDS) {
  const needs = answers && answers.needs_skill ? answers.needs_skill.noul : null
  const probs = answers && answers.skill ? answers.skill.probabilities : null
  if (needs == null || !probs) return null
  const [top, topProb] = Object.entries(probs).sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  if (!top) return null
  const hint = needs >= t.needs && topProb >= t.top && !hinted.includes(top) ? top : null
  return { needs, top, topProb, hint }
}

// The text Claude reads beside the prompt.
export function skillHintText(name) {
  return '[sommelier] 自動判斷這個請求可能適合 skill「' + name + '」（可能有誤）。適用的話先用 Skill 工具載入；不適用就忽略這段，也不用提到它。'
}

// How the spinner names a skill: a plugin's prefix is dropped.
export function skillLabel(name) {
  return String(name).split(':').pop()
}
