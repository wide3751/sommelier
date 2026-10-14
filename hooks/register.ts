// sommelier hooks module.
//
// Ticket 04 (walking skeleton): once `/somm on`, the first prompt you send in a
// session is judged by Jev and routed to a rung of the ladder; later turns reuse
// that rung. Jev failing or timing out leaves the request unchanged. Cache-ledger
// routing, guards, overrides and the full UI arrive in later tickets.
//
// Every mods API call stays in this file (validation forbids passing `$` to an
// imported function); the routing logic itself lives in decide.ts / jevState.ts.

import { JEV } from './questions.ts'
import { LONG_CONVERSATION_TOKENS, estimateTokens, modelId, shortModel, targetRung } from './decide.ts'
import { buildJevState } from './jevState.ts'

const COMMAND = 'somm'
const FALLBACK_COMMAND = 'sommelier'
const ENABLED_KEY = 'somm:enabled'
const REC_PREFIX = 'somm:rec:'
const REC_CAP = 500
const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_TIMEOUT_MS = 1500

const REASON_LABEL = { first_turn: '新話題', continuation: '沿用', no_judgement: '尚未判斷', long_conversation: '對話已長，不換模型' }

let configKey = ''
// Jev requests started at turn.start, keyed by turnId so a queued prompt never
// picks up another turn's judgement.
const pending = new Map()
// Per-turn decision and usage totals, filled by turn.step, written at turn.complete.
const turns = new Map()
// The first successful judgement of this session; reused by later turns until
// ticket 05 replaces it with per-sentence routing.
let sessionRung = null
let lastShown = ''
// The long-conversation toast is shown once per session.
let warnedLong = false

async function isEnabled($) {
  return (await $.store.get(ENABLED_KEY)) === true
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

async function decideTurn($, e) {
  if (!(await isEnabled($))) return { rung: null, reason: 'off' }
  const p = pending.get(e.turnId)
  if (p) {
    pending.delete(e.turnId)
    const j = await waitCapped($, p)
    if (j.skip) return { rung: null, reason: j.skip }
    if (j.error) return { rung: null, reason: 'jev_failed:' + j.error, jevMs: j.ms ?? null }
    const d = targetRung(j.answers)
    // A high-risk effort bump applies to this turn only.
    sessionRung = d.highRisk ? { model: d.rung.model, effort: 'medium' } : d.rung
    return {
      rung: d.rung, reason: 'first_turn', level: d.level, highRisk: d.highRisk, newTask: d.newTask,
      probs: j.answers.depth.probabilities, riskProb: j.answers.high_risk ? j.answers.high_risk.noul : null,
      jevMs: j.ms, servedModel: j.servedModel,
    }
  }
  if (sessionRung) return { rung: sessionRung, reason: 'continuation' }
  return { rung: null, reason: 'no_judgement' }
}

// The status line under the prompt: the model that actually answered the last
// main step, and the session's own model when sommelier replaced it.
function statusText(answered, effort, preset) {
  return '🍷 實際模型 ' + answered + (effort ? '·' + effort : '') + (answered !== preset ? '（預設 ' + preset + '）' : '')
}

function spinnerText(decision) {
  if (decision.reason === 'off') return ''
  if (!decision.rung) return 'session · ' + (decision.reason.startsWith('jev_failed') ? 'Jev 失敗' : REASON_LABEL[decision.reason] ?? decision.reason)
  const r = decision.rung
  return r.model + '·' + r.effort + (decision.level !== undefined ? ' L' + decision.level : '') + ' · ' + (REASON_LABEL[decision.reason] ?? decision.reason)
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
  return rung + ' · ' + r.reason + probs + (r.jevMs != null ? ' jev ' + Math.round(r.jevMs) + 'ms' : '') + cache
}

async function runCommand($, e) {
  const [sub, arg] = (e.args || '').trim().split(/\s+/)
  if (sub === 'on') {
    await $.store.set(ENABLED_KEY, true)
    return { text: 'sommelier 已開啟：接下來你送出的第一個請求會交給 Jev 判斷。' }
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
    const rung = sessionRung ? sessionRung.model + '·' + sessionRung.effort : '（尚未判斷）'
    return { text: 'sommelier ' + (on ? '開啟' : '關閉') + '｜API key ' + key + '｜本 session 檔位 ' + rung }
  }
  return { text: '用法：/somm on | off | status | log [n]' }
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

  on('command.run', { command: COMMAND }, async ($, e) => runCommand($, e))
  on('command.run', { command: FALLBACK_COMMAND }, async ($, e) => runCommand($, e))

  on('turn.start', async ($, e, next) => {
    if (e.text !== '' && !sessionRung && (await isEnabled($))) {
      const messages = await $.session.messages()
      if (estimateTokens(messages) > LONG_CONVERSATION_TOKENS) {
        pending.set(e.turnId, Promise.resolve({ skip: 'long_conversation' }))
        if (!warnedLong) {
          warnedLong = true
          $.ui.toast('sommelier：對話已長，換模型要重寫整段 cache，這個 session 先不換。開新 session 或 /clear 後再判斷')
        }
      } else {
        pending.set(e.turnId, judge($, e.text, messages))
      }
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
    }
    if (t.decision.reason === 'off') $.ui.status(undefined)
    else $.ui.status(statusText(shortModel(u && u.model ? u.model : out.model), out.effort, shortModel(e.model)))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    pending.delete(e.turnId)
    const t = turns.get(e.turnId)
    turns.delete(e.turnId)
    if (!e.agentId && t && t.decision.reason !== 'off') {
      const { decision, ...usage } = t
      await writeRecord($, { turnId: e.turnId, ...decision, ...usage })
    }
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!lastShown) return next(e)
    return next({ ...e, props: { ...e.props, suffix: ' · 🍷 ' + lastShown } })
  })
}
