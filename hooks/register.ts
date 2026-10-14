// sommelier hooks module.
//
// While on (the default), every prompt you send is judged by Jev and routed to a
// rung of the ladder (ticket 05): upgrades always go ahead, downgrades only on a
// new topic when the cache ledger says the switch pays. Short replies and Jev
// failures keep the current rung. Ticket 09 (privacy): consent before the first
// send, redaction, per-project off. Ticket 06 (guards): a model the user picked,
// an automatic fallback or an unsupported session model is left alone; turns the
// user did not start and slash commands keep the current rung. Ticket 07: asking
// for deep thought (ultrathink, 仔細想, 深入想) goes to opus · high without
// asking Jev. Ticket 08: a `somm:<model>` prefix sets the rung by hand until
// the next new topic. The full UI arrives in later tickets.
//
// Every mods API call stays in this file (validation forbids passing `$` to an
// imported function); the routing logic itself lives in decide.ts / jevState.ts /
// redact.ts.

import { JEV } from './questions.ts'
import { BALANCED, DEFAULT_TURN, USER_ORIGINS, asksDeepThought, cacheTtl, coldTokens, isShortReply, isSlashCommand, isSupportedModel, ledgerEntry, markCold, modelId, modelLabel, parseOverride, qualityGuard, rewriteCost, route, routeDeepThought, shortModel } from './decide.ts'
import { buildJevState } from './jevState.ts'
import { redact } from './redact.ts'

const COMMAND = 'somm'
const FALLBACK_COMMAND = 'sommelier'
const ENABLED_KEY = 'somm:enabled'
const CONSENT_KEY = 'somm:consent'
const PROJECT_OFF_PREFIX = 'somm:project-off:'
const PROMPT_SUMMARY_CHARS = 40
const CONSENT_QUESTION =
  'sommelier 會把你之後送出的每個請求（短回覆除外）與最近 3 輪對話（不含工具輸出，常見密鑰格式已遮蔽）送到 TypeSafe，判斷要用哪個模型。要開始使用嗎？'
const CONSENT_AGREE = '同意，開始使用'
const CONSENT_DECLINE = '不同意，關閉 sommelier'
const REC_PREFIX = 'somm:rec:'
const MANUAL_PREFIX = 'somm:manual:'
const REC_CAP = 500
const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_TIMEOUT_MS = 1500

const REASON_LABEL = {
  upgrade: '升級', downgrade: '降級', hold: '沿用', continuation: '沿用', cost_blocked: '換模型不划算，沿用',
  quality_guard: '對話太長，改用 sonnet', project_off: '專案停用', consent_declined: '未同意送出', consent_unanswered: '尚未確認送出',
  manual: '手動指定', fallback: '自動 fallback', unsupported_session_model: '不支援的模型', slash_command: '沿用',
  ultrathink: '要求深入思考', override: '覆寫', override_locked: '覆寫鎖定中',
}
const EVENT_CAP = 20

let configKey = ''
// Jev requests started at turn.start, keyed by turnId so a queued prompt never
// picks up another turn's judgement.
const pending = new Map()
// Turns whose prompt was never sent, keyed by turnId, with the reason why.
const blocked = new Map()
// Each turn's prompt, for the record's redacted summary.
const prompts = new Map()
// Per-turn decision and usage totals, filled by turn.step, written at turn.complete.
const turns = new Map()
// The current rung (目前檔位): what the last main turn ran on, without a
// one-turn high-risk bump; null while the session model is in use.
let currentRung = null
// Main turns judged in this conversation; /clear starts a new one.
let judgedTurns = 0
// The cache ledger: per model, the last main request's cache coverage.
let ledger = {}
let lastShown = ''
// Main-turn totals, used to average what a turn costs in this session.
const seen = { turns: 0, output: 0, fresh: 0 }
// The cache TTL the last main response wrote, as its usage reported it.
let lastTtl = '1h'
// 手動指定: the model the user switched the session to, until they pick
// Default again. Kept across /clear, and in the store per session so a resume
// in a new process still knows.
let manual = null
// Set by an automatic fallback; only the user's own /model clears it.
let fallback = false
// The session model at startup, to tell a manual pick that /clear forgot.
let launchModel = null
// 覆寫鎖定: the rung a `somm:` prefix set, held until Jev sees a new topic.
let locked = null
// A cache rewrite smaller than this is not worth a toast.
const OVERRIDE_TOAST_TOKENS = 1000
// Origins of submitted prompts not yet started, oldest first: { text, kind, override }.
const origins = []
// Rungs a `somm:` prefix asked for, keyed by turnId.
const overrides = new Map()
// Turns that keep the current rung without a judgement, keyed by turnId, with why.
const skipped = new Map()
// The last few state events seen, for /somm events (ticket 02).
const events = []

function note(text) {
  events.push(text)
  if (events.length > EVENT_CAP) events.shift()
}

// What prompt.submit saw of a prompt, matched by its text: its origin and any
// override; null when the turn was not seen there.
function takeOrigin(text) {
  const i = origins.findIndex((o) => o.text === text)
  if (i < 0) return null
  return origins.splice(i, 1)[0]
}

// Guards that leave the request to the session (docs/spec.md「分派決策」2–4).
function passReason(model) {
  if (model && !isSupportedModel(model)) return 'unsupported_session_model'
  if (manual) return 'manual'
  if (fallback) return 'fallback'
  return null
}

async function isEnabled($) {
  // Unset means a fresh install: on until the user runs /somm off.
  return (await $.store.get(ENABLED_KEY)) !== false
}

async function projectOff($) {
  return (await $.store.get(PROJECT_OFF_PREFIX + (await $.session.root()))) === true
}

// Asks once before the first prompt ever leaves the machine: 'agreed',
// 'declined' (turns sommelier off) or 'unanswered' (dismissed or headless;
// only skips this turn, so the next one asks again).
async function askConsent($) {
  if ((await $.store.get(CONSENT_KEY)) === true) return 'agreed'
  let answer
  try {
    answer = await $.ui.ask(CONSENT_QUESTION, { header: 'sommelier', options: [CONSENT_AGREE, CONSENT_DECLINE] })
  } catch {
    return 'unanswered'
  }
  if (answer === CONSENT_AGREE) {
    await $.store.set(CONSENT_KEY, true)
    return 'agreed'
  }
  if (answer !== CONSENT_DECLINE) return 'unanswered'
  await $.store.set(ENABLED_KEY, false)
  $.ui.toast('sommelier 已關閉，之後可用 /somm on 重新開啟')
  return 'declined'
}

// The user's own switch (/model, the picker, /config, the SDK). Default
// (requested_model null) hands the session back to sommelier. Either way
// the user has chosen, so a fallback no longer holds.
async function userSwitch($, e) {
  fallback = false
  locked = null
  await setManual($, e.requested_model === null ? null : e.to_model)
}

async function setManual($, model) {
  manual = model
  const key = MANUAL_PREFIX + (await $.session.id())
  if (model) await $.store.set(key, model)
  else await $.store.delete(key)
}

async function apiKey($) {
  if (configKey) return configKey
  return (await $.env.get('TYPESAFE_API_KEY')) || ''
}

async function callJev($, key, state) {
  try {
    const res = await $.http.fetch(JEV_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: JEV.model, state, questions: JEV.questions }),
    })
    if (!res.ok) return { error: 'http_' + res.status }
    const body = JSON.parse(res.text)
    if (!body.answers || !body.answers.depth || !body.answers.depth.probabilities) return { error: 'bad_response' }
    return { answers: body.answers, servedModel: body.model }
  } catch {
    return { error: 'fetch_failed' }
  }
}

async function judge($, text, messages) {
  const t0 = await $.clock.now()
  const key = await apiKey($)
  if (!key) return { error: 'no_key', ms: 0 }
  const state = buildJevState(messages, text)
  const result = await callJev($, key, state)
  return { ...result, ms: (await $.clock.now()) - t0 }
}

// Resolves to the judgement, or a timeout error once JEV_TIMEOUT_MS has passed.
// A late answer is simply never read.
async function waitCapped($, promise) {
  const ac = new AbortController()
  const cap = $.clock.sleep(JEV_TIMEOUT_MS, { signal: ac.signal }).then(
    () => ({ error: 'timeout' }),
    () => ({ error: 'timeout' }),
  )
  const result = await Promise.race([promise, cap])
  ac.abort()
  return result
}

// What this turn keeps when it is not (or cannot be) judged: the current rung,
// moved to sonnet once haiku's conversation has grown too long.
function keep(reason, contextTokens, extra = {}) {
  // An override holds even past haiku's length (docs/spec.md「分派決策」11).
  const guard = locked ? null : qualityGuard(currentRung, contextTokens)
  if (guard) {
    currentRung = guard
    return { rung: guard, reason: 'quality_guard', ...extra }
  }
  return { rung: currentRung, reason, ...extra }
}

async function decideTurn($, e) {
  const why = blocked.get(e.turnId)
  if (why) return { rung: null, reason: why }
  if (!(await isEnabled($))) return { rung: null, reason: 'off' }
  if (await projectOff($)) return { rung: null, reason: 'project_off' }
  const pass = passReason(e.model)
  if (pass) {
    // The session model answers now, so that is where the cache is.
    currentRung = null
    pending.delete(e.turnId)
    return { rung: null, reason: pass }
  }
  // contextTokens is absent before the session's first response: nothing is
  // cached yet, so any switch is free.
  const contextTokens = (await $.session.usage()).context.tokens ?? 0
  const asked = overrides.get(e.turnId)
  if (asked) {
    overrides.delete(e.turnId)
    return override($, e, asked, contextTokens)
  }
  if (skipped.get(e.turnId) === 'ultrathink') {
    const r = routeDeepThought({ current: currentRung, session: { model: shortModel(e.model), effort: e.effort ?? 'medium' } })
    // It stands for a judgement: the next sentence is not a session's first.
    judgedTurns += 1
    currentRung = r.current
    // Asking by name is the user's word too, and the newer one.
    locked = null
    return { rung: r.rung, reason: r.reason, level: r.level, contextTokens }
  }
  const p = pending.get(e.turnId)
  if (!p) return keep(skipped.get(e.turnId) ?? 'continuation', contextTokens)
  pending.delete(e.turnId)
  const j = await waitCapped($, p)
  // A failed judgement keeps the current rung: falling back to the session
  // model would itself be a switch, and rewrite the cache for nothing.
  if (j.error) return keep('jev_failed:' + j.error, contextTokens, { jevMs: j.ms ?? null })
  const jev = {
    probs: j.answers.depth.probabilities, riskProb: j.answers.high_risk ? j.answers.high_risk.noul : null,
    jevMs: j.ms, servedModel: j.servedModel,
  }
  if (locked) {
    // Held until a new topic; then it is judged like any other sentence.
    const newTask = j.answers.new_task ? j.answers.new_task.noul : null
    if ((newTask ?? 0) < BALANCED.tNew) return { rung: locked, reason: 'override_locked', newTopic: false, newTask, contextTokens, ...jev }
    locked = null
  }
  const r = route(j.answers, {
    current: currentRung,
    session: { model: shortModel(e.model), effort: e.effort ?? 'medium' },
    firstTurn: judgedTurns === 0,
    ledger, contextTokens, now: await $.clock.now(), messageCount: e.messageCount, ttl: lastTtl,
    turn: seen.turns ? { output: seen.output / seen.turns, fresh: seen.fresh / seen.turns } : DEFAULT_TURN,
  })
  judgedTurns += 1
  currentRung = r.current
  if (r.reason === 'cost_blocked') {
    $.ui.toast(
      'sommelier：換到 ' + r.cost.target + ' 要重寫 ' + Math.round(r.cost.cold / 1000) + 'k tokens 的 cache（約 $' +
        r.cost.extra.toFixed(2) + '），預估省回 $' + r.cost.savings.toFixed(2) + '，這一句沿用 ' + (currentRung ? currentRung.model : shortModel(e.model)),
    )
  }
  return {
    rung: r.rung, reason: r.reason, level: r.level, newTopic: r.newTopic, highRisk: r.highRisk, newTask: r.newTask,
    contextTokens, coldTokens: r.cost ? r.cost.cold : undefined, switchCost: r.cost ? r.cost.extra : undefined,
    switchSavings: r.cost ? r.cost.savings : undefined, ...jev,
  }
}

// A `somm:` prefix: the named rung, now and until the next new topic, cost
// rules aside. A switch that rewrites the cache says what it costs.
async function override($, e, rung, contextTokens) {
  const from = currentRung ?? { model: shortModel(e.model), effort: e.effort ?? 'medium' }
  judgedTurns += 1
  currentRung = rung
  locked = rung
  let cold
  if (rung.model !== from.model) {
    cold = coldTokens(ledger[rung.model], contextTokens, await $.clock.now(), e.messageCount, lastTtl)
    if (cold >= OVERRIDE_TOAST_TOKENS) {
      $.ui.toast(
        'sommelier：覆寫為 ' + rung.model + '，要重寫 ' + Math.round(cold / 1000) + 'k tokens 的 cache（約 $' +
          rewriteCost(rung.model, cold, lastTtl).toFixed(2) + '）',
      )
    }
  }
  return { rung, reason: 'override', contextTokens, coldTokens: cold }
}

// The status line under the prompt: the model, with its version, and effort
// that actually answered the last main step. The session's own model is shown beside it.
function statusText(answered, effort) {
  return '🍷 ' + answered + (effort ? '·' + effort : '')
}

function spinnerText(decision) {
  if (decision.reason === 'off') return ''
  if (!decision.rung) return 'session · ' + (decision.reason.startsWith('jev_failed') ? 'Jev 失敗' : REASON_LABEL[decision.reason] ?? decision.reason)
  const r = decision.rung
  const label = decision.reason.startsWith('jev_failed') ? 'Jev 失敗，沿用' : REASON_LABEL[decision.reason] ?? decision.reason
  const risk = decision.highRisk ? ' · 高風險' : ''
  const jev = decision.jevMs != null ? ' · jev ' + decision.jevMs + 'ms' : ''
  return r.model + '·' + r.effort + (decision.level !== undefined ? ' L' + decision.level : '') + ' · ' + (decision.newTopic ? '新話題，' : '') + label + risk + jev
}

async function writeRecord($, rec) {
  const sid = await $.session.id()
  const at = await $.clock.now()
  await $.store.set(REC_PREFIX + String(at).padStart(14, '0') + ':' + sid, { ...rec, at, session: sid })
  const keys = (await $.store.keys()).filter((k) => k.startsWith(REC_PREFIX)).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - REC_CAP))) await $.store.delete(k)
}

async function recentRecords($, n) {
  const keys = (await $.store.keys()).filter((k) => k.startsWith(REC_PREFIX)).sort().slice(-n)
  const out = []
  for (const k of keys) out.push(await $.store.get(k))
  return out
}

function formatRecord(r) {
  const rung = r.rung ? r.rung.model + '·' + r.rung.effort : 'session'
  const probs = r.probs ? ' P=' + [0, 1, 2, 3].map((i) => (r.probs[String(i)] ?? 0).toFixed(2)).join('/') : ''
  const cache = ' cache read ' + r.cacheRead + ' write ' + r.cacheWrite
  const answered = r.answeredModel ? ' · 回答 ' + r.answeredModel : ''
  const session = r.session ? ' [' + String(r.session).slice(0, 6) + ']' : ''
  return rung + answered + ' · ' + r.reason + probs + (r.jevMs != null ? ' jev ' + Math.round(r.jevMs) + 'ms' : '') + cache + session
}

async function runCommand($, e) {
  const [sub, arg] = (e.args || '').trim().split(/\s+/)
  if (arg === '--project' && (sub === 'on' || sub === 'off')) {
    const root = await $.session.root()
    if (sub === 'off') await $.store.set(PROJECT_OFF_PREFIX + root, true)
    else await $.store.delete(PROJECT_OFF_PREFIX + root)
    return { text: sub === 'off' ? 'sommelier 在 ' + root + ' 停用：這個專案的內容不會送給 Jev。' : 'sommelier 在 ' + root + ' 重新啟用。' }
  }
  if (sub === 'on') {
    await $.store.set(ENABLED_KEY, true)
    return { text: 'sommelier 已開啟：接下來你送出的每個請求都會交給 Jev 判斷（短回覆除外）。' }
  }
  if (sub === 'off') {
    await $.store.set(ENABLED_KEY, false)
    lastShown = ''
    $.ui.invalidate('ui.render')
    $.ui.status(undefined)
    return { text: 'sommelier 已關閉：沿用 session 的模型與 effort。' }
  }
  if (sub === 'log') {
    const recs = await recentRecords($, Number(arg) || 10)
    return { text: recs.length ? recs.map(formatRecord).join('\n') : '（還沒有分派紀錄）' }
  }
  if (!sub || sub === 'status') {
    const on = await isEnabled($)
    const key = (await apiKey($)) ? '已設定' : '未設定'
    const rung = currentRung ? currentRung.model + '·' + currentRung.effort : judgedTurns ? 'session 模型' : '（尚未判斷）'
    const project = (await projectOff($)) ? '｜此專案停用' : ''
    const guard = manual ? '｜手動指定 ' + modelLabel(manual) + '（選回 Default 恢復）' : fallback ? '｜自動 fallback 中（手動 /model 後恢復）' :
      locked ? '｜覆寫鎖定 ' + locked.model + '·' + locked.effort + '（到下一個新話題）' : ''
    return { text: 'sommelier ' + (on ? '開啟' : '關閉') + project + guard + '｜API key ' + key + '｜本 session 檔位 ' + rung }
  }
  if (sub === 'events') {
    return { text: events.length ? events.join('\n') : '（還沒有觀察到事件）' }
  }
  return { text: '用法：/somm on | off [--project] | status | log [n] | events' }
}

export function register(on, options) {
  configKey = (options && options.typesafe_api_key) || ''

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'sommelier：依任務挑模型與 effort（on | off | status | log | events）',
        argumentHint: '[on | off | status | log [n] | events]',
        immediate: true,
      })
    } catch {
      // /somm is taken: register the long name instead and say so.
      await $.command.register({
        name: FALLBACK_COMMAND,
        description: 'sommelier：依任務挑模型與 effort（on | off | status | log | events）',
        argumentHint: '[on | off | status | log [n] | events]',
        immediate: true,
      })
      $.ui.toast('/somm 已被占用，請改用 /sommelier')
    }
    return next(e)
  })

  // /clear starts a new conversation; compact and resume rewrite it. Either
  // way the cached conversation is gone and only the stable prefix survives.
  on('classic.SessionStart', async ($, e, next) => {
    // e.model is absent on startup and /clear (ticket 02), so ask the session.
    let model = e.model ?? null
    try {
      model = model ?? (await $.session.model())
    } catch {}
    note('SessionStart source=' + e.source + ' model=' + model)
    if (e.source === 'startup') launchModel = model
    if (e.source !== 'startup') ledger = markCold(ledger)
    if (e.source === 'resume') manual = (await $.store.get(MANUAL_PREFIX + (await $.session.id()))) ?? manual
    if (e.source === 'clear') {
      currentRung = null
      locked = null
      judgedTurns = 0
      // /clear starts a new session id; the pick carries over to it. A session
      // model that is not the one it started with was picked by hand too.
      if (!manual && launchModel && model && model !== launchModel) manual = model
      if (manual) await setManual($, manual)
    }
    return next(e)
  })

  on('classic.PreModelSwitch', async ($, e, next) => {
    note('PreModelSwitch ' + e.from_model + ' → ' + e.to_model + ' requested=' + e.requested_model + ' source=' + e.source)
    await userSwitch($, e)
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    note('PostModelSwitch ' + e.from_model + ' → ' + e.to_model + ' requested=' + e.requested_model + ' source=' + e.source)
    if (e.source === 'auto') fallback = true
    else if (e.source !== 'resume') await userSwitch($, e)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin ? e.origin.kind : 'none'
    // Only the user's own prompt can carry an override; it is stripped before
    // the model sees it.
    const asked = USER_ORIGINS.includes(kind) || kind === 'none' ? parseOverride(e.text) : null
    note('prompt.submit origin=' + kind + (e.turnId ? ' into ' + e.turnId : '') + (asked ? ' somm:' + asked.rung.model : ''))
    if (asked && asked.text.trim() === '') {
      // A bare prefix sends nothing: it sets the rung for the prompts that follow.
      currentRung = asked.rung
      locked = asked.rung
      judgedTurns += 1
      return { drop: 'sommelier：接下來用 ' + asked.rung.model + '·' + asked.rung.effort + '，到下一個新話題為止' }
    }
    const text = asked ? asked.text : e.text
    // A prompt typed into a running turn joins it, so no turn.start follows.
    if (!e.turnId) {
      origins.push({ text, kind, override: asked ? asked.rung : null })
      if (origins.length > EVENT_CAP) origins.shift()
    }
    return next(asked ? { ...e, text } : e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => runCommand($, e))
  on('command.run', { command: FALLBACK_COMMAND }, async ($, e) => runCommand($, e))

  on('turn.start', async ($, e, next) => {
    prompts.set(e.turnId, e.text)
    const seenAt = takeOrigin(e.text)
    const origin = seenAt ? seenAt.kind : null
    if (seenAt && seenAt.override) overrides.set(e.turnId, seenAt.override)
    let sessionModel = null
    try {
      sessionModel = await $.session.model()
    } catch {}
    note('turn.start ' + e.turnId + ' origin=' + origin + ' session.model=' + sessionModel + (isSlashCommand(e.text) ? ' slash' : ''))
    if (overrides.has(e.turnId)) skipped.set(e.turnId, 'override')
    else if (origin && !USER_ORIGINS.includes(origin)) skipped.set(e.turnId, 'continuation')
    else if (isSlashCommand(e.text)) skipped.set(e.turnId, 'slash_command')
    else if (asksDeepThought(e.text)) skipped.set(e.turnId, 'ultrathink')
    // A full id outside the 5.5 family is not routed, so nothing is sent; an
    // alias waits for turn.step's full id.
    const unsupported = sessionModel && sessionModel.startsWith('claude-') && !isSupportedModel(sessionModel)
    if (
      e.text !== '' && !isShortReply(e.text) && !skipped.has(e.turnId) && !manual && !fallback && !unsupported &&
      (await isEnabled($)) && !(await projectOff($))
    ) {
      // Without a key nothing would be sent, so there is nothing to consent to.
      const consent = (await apiKey($)) ? await askConsent($) : 'agreed'
      if (consent === 'agreed') pending.set(e.turnId, judge($, e.text, await $.session.messages()))
      else blocked.set(e.turnId, 'consent_' + consent)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    let t = turns.get(e.turnId)
    if (!t) {
      t = { decision: await decideTurn($, e), steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      turns.set(e.turnId, t)
      note('turn.step ' + e.turnId + ' model=' + e.model + ' → ' + (t.decision.rung ? t.decision.rung.model : 'session') + ' (' + t.decision.reason + ')')
      lastShown = spinnerText(t.decision)
      $.ui.invalidate('ui.render')
    }
    // A fallback mid-turn: the engine's choice stands for the rest of it.
    const rung = fallback ? null : t.decision.rung
    const out = rung ? { ...e, model: modelId(rung.model), effort: rung.effort } : e
    const result = yield* next(out)
    const u = result.usage
    if (u) {
      t.steps += 1
      t.input += u.input_tokens ?? 0
      t.output += u.output_tokens ?? 0
      t.cacheRead += u.cache_read_input_tokens ?? 0
      t.cacheWrite += u.cache_creation_input_tokens ?? 0
      t.answeredModel = shortModel(u.model)
      lastTtl = cacheTtl(u) ?? lastTtl
      if (u.model) ledger = { ...ledger, [t.answeredModel]: ledgerEntry(u, await $.clock.now(), e.messageCount) }
    }
    if (t.decision.reason === 'off') $.ui.status(undefined)
    else $.ui.status(statusText(modelLabel(u && u.model ? u.model : out.model), out.effort))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    pending.delete(e.turnId)
    blocked.delete(e.turnId)
    skipped.delete(e.turnId)
    overrides.delete(e.turnId)
    const prompt = prompts.get(e.turnId)
    prompts.delete(e.turnId)
    const t = turns.get(e.turnId)
    turns.delete(e.turnId)
    if (!e.agentId && t) {
      seen.turns += 1
      seen.output += t.output
      seen.fresh += t.input + t.cacheWrite
    }
    if (!e.agentId && t && t.decision.reason !== 'off') {
      const { decision, ...usage } = t
      // A stopped project keeps no trace of its prompts.
      const summary = prompt && decision.reason !== 'project_off' ? redact(prompt).slice(0, PROMPT_SUMMARY_CHARS) : undefined
      await writeRecord($, { turnId: e.turnId, ...decision, ...usage, prompt: summary })
    }
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!lastShown) return next(e)
    return next({ ...e, props: { ...e.props, suffix: ' · 🍷 ' + lastShown } })
  })
}
