// sommelier hooks module.
//
// While on (the default), every prompt you send is judged by Jev and routed to a
// rung of the ladder (ticket 05): upgrades always go ahead, downgrades only on a
// new topic when the cache ledger says the switch pays. Short replies and Jev
// failures keep the current rung. Ticket 09 (privacy): consent before the first
// send, redaction, per-project off. Guards, overrides and the full UI arrive in
// later tickets.
//
// Every mods API call stays in this file (validation forbids passing `$` to an
// imported function); the routing logic itself lives in decide.ts / jevState.ts /
// redact.ts.

import { JEV } from './questions.ts'
import { DEFAULT_TURN, cacheTtl, isShortReply, ledgerEntry, markCold, modelId, qualityGuard, route, shortModel } from './decide.ts'
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
const REC_CAP = 500
const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_TIMEOUT_MS = 1500

const REASON_LABEL = {
  upgrade: '升級', downgrade: '降級', hold: '沿用', continuation: '沿用', cost_blocked: '換模型不划算，沿用',
  quality_guard: '對話太長，改用 sonnet', project_off: '專案停用', consent_declined: '未同意送出', consent_unanswered: '尚未確認送出',
}

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
  const guard = qualityGuard(currentRung, contextTokens)
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
  // contextTokens is absent before the session's first response: nothing is
  // cached yet, so any switch is free.
  const contextTokens = (await $.session.usage()).context.tokens ?? 0
  const p = pending.get(e.turnId)
  if (!p) return keep('continuation', contextTokens)
  pending.delete(e.turnId)
  const j = await waitCapped($, p)
  // A failed judgement keeps the current rung: falling back to the session
  // model would itself be a switch, and rewrite the cache for nothing.
  if (j.error) return keep('jev_failed:' + j.error, contextTokens, { jevMs: j.ms ?? null })
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
    switchSavings: r.cost ? r.cost.savings : undefined,
    probs: j.answers.depth.probabilities, riskProb: j.answers.high_risk ? j.answers.high_risk.noul : null,
    jevMs: j.ms, servedModel: j.servedModel,
  }
}

// The status line under the prompt: the model and effort that actually
// answered the last main step. The session's own model is shown beside it.
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
    return { text: 'sommelier ' + (on ? '開啟' : '關閉') + project + '｜API key ' + key + '｜本 session 檔位 ' + rung }
  }
  return { text: '用法：/somm on | off [--project] | status | log [n]' }
}

export function register(on, options) {
  configKey = (options && options.typesafe_api_key) || ''

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'sommelier：依任務挑模型與 effort（on | off | status | log）',
        argumentHint: '[on | off | status | log [n]]',
        immediate: true,
      })
    } catch {
      // /somm is taken: register the long name instead and say so.
      await $.command.register({
        name: FALLBACK_COMMAND,
        description: 'sommelier：依任務挑模型與 effort（on | off | status | log）',
        argumentHint: '[on | off | status | log [n]]',
        immediate: true,
      })
      $.ui.toast('/somm 已被占用，請改用 /sommelier')
    }
    return next(e)
  })

  // /clear starts a new conversation; compact and resume rewrite it. Either
  // way the cached conversation is gone and only the stable prefix survives.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source !== 'startup') ledger = markCold(ledger)
    if (e.source === 'clear') {
      currentRung = null
      judgedTurns = 0
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => runCommand($, e))
  on('command.run', { command: FALLBACK_COMMAND }, async ($, e) => runCommand($, e))

  on('turn.start', async ($, e, next) => {
    prompts.set(e.turnId, e.text)
    if (e.text !== '' && !isShortReply(e.text) && (await isEnabled($)) && !(await projectOff($))) {
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
      lastShown = spinnerText(t.decision)
      $.ui.invalidate('ui.render')
    }
    const rung = t.decision.rung
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
    else $.ui.status(statusText(shortModel(u && u.model ? u.model : out.model), out.effort))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    pending.delete(e.turnId)
    blocked.delete(e.turnId)
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
