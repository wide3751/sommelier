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
// the next new topic. #27: a skill hint (skill 提示) beside the prompt when
// Jev finds a skill that fits; the prompt then waits for Jev at submit.
//
// Every mods API call stays in this file (validation forbids passing `$` to an
// imported function); the routing logic itself lives in decide.ts / jevState.ts /
// redact.ts.

import { JEV, SKILL_QUESTIONS } from './questions.ts'
import { DEFAULT_SETTINGS, DEFAULT_TURN, TTL_MS, USER_ORIGINS, applySetting, asksDeepThought, cacheGauge, cacheTtl, coldTokens, describeSettings, isShortReply, isSlashCommand, isSupportedModel, ledgerEntry, markCold, modelId, modelLabel, parseOverride, pickSkill, promptSummary, qualityGuard, rewriteCost, route, routeDeepThought, routingConfig, shortModel, skillCandidates, skillHintText, skillLabel, skillQuestions } from './decide.ts'
import { buildJevState } from './jevState.ts'
import { redact } from './redact.ts'

const COMMAND = 'somm'
const FALLBACK_COMMAND = 'sommelier'
const ENABLED_KEY = 'somm:enabled'
const CONFIG_KEY = 'somm:config'
const CONSENT_KEY = 'somm:consent'
// Consent to send skill names and descriptions, asked apart from CONSENT_KEY
// so those who agreed before skill hints existed are asked about them once.
const SKILL_CONSENT_KEY = 'somm:consent:skills'
const PROJECT_OFF_PREFIX = 'somm:project-off:'
const PROMPT_SUMMARY_CHARS = 40
const CONSENT_QUESTION =
  'sommelier 會把你之後送出的每個請求（短回覆除外），以及最近 3 輪對話（不含工具輸出）送到 TypeSafe（常見密鑰格式已遮蔽），判斷要用哪個模型。要開始使用嗎？'
const CONSENT_AGREE = '同意，開始使用'
const CONSENT_DECLINE = '不同意，關閉 sommelier'
const SKILL_CONSENT_QUESTION =
  '開啟 skill 提示後，sommelier 會額外把你本機 skill 的名稱與描述（常見密鑰格式已遮蔽）送到 TypeSafe，判斷要不要提示 Claude 使用某個 skill。要開啟嗎？'
const SKILL_CONSENT_AGREE = '同意，開啟 skill 提示'
const SKILL_CONSENT_DECLINE = '不同意，關閉 skill 提示'
const REC_PREFIX = 'somm:rec:'
const MANUAL_PREFIX = 'somm:manual:'
const STATE_PREFIX = 'somm:state:'
// Sessions whose routing state the store keeps; older ones are dropped.
const STATE_CAP = 20
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
const NOTIFY_GAP_MS = 10000
// Jev failures in a row that call for a toast; no key is not one: it gets its own toast, once.
const JEV_FAILURE_TOAST = 3
let noKeyNotified = false
let lastToastAt = -Infinity
// A toast held back by the gap, shown once it ends.
let heldToast = null
const notifiedTurns = new Set()
let jevFailures = 0
// 日常設定 as last read from the store; every judged turn reads them again,
// so a change from /somm config (here or in another session) applies at once.
let settings = DEFAULT_SETTINGS
let cfg = routingConfig(settings)
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
// 候選 skill for this session, built once from the context's skill listing;
// /clear, compact and resume build it again.
let skillCache = null
// Skills hinted on the current topic; a new topic or /clear empties it.
let hinted = []
// Each turn's skill judgement ({ needs, top, topProb, hint }), keyed by turnId.
const skillByTurn = new Map()
// The main turn running now, for skill.prompt, which carries no turnId.
let activeTurn = null
// Whether this module has its session's routing state: true once a
// SessionStart is seen (a new process starts afresh, or resumes with only the
// manual pick), or once the store has been read. A plugin update reloads the
// module in a running session with no SessionStart, so the first event after
// it reads back what the store kept.
let restored = false

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

async function loadSettings($) {
  settings = { ...DEFAULT_SETTINGS, ...((await $.store.get(CONFIG_KEY)) ?? {}) }
  cfg = routingConfig(settings)
  return settings
}

// Toasts the notify setting governs (ticket 12): off silences them; otherwise
// one per turn, and at most one every NOTIFY_GAP_MS. One that comes sooner
// waits for the gap to end and is shown then, unless a newer one replaces it.
async function notify($, turnId, text) {
  if (settings.notify === 'off' || notifiedTurns.has(turnId)) return
  notifiedTurns.add(turnId)
  if (notifiedTurns.size > EVENT_CAP) notifiedTurns.delete(notifiedTurns.values().next().value)
  const now = await $.clock.now()
  if (now - lastToastAt >= NOTIFY_GAP_MS) {
    lastToastAt = now
    $.ui.toast(text)
    return
  }
  const waiting = heldToast !== null
  heldToast = text
  if (waiting) return
  try {
    await $.clock.sleep(lastToastAt + NOTIFY_GAP_MS - now)
  } catch {
    // The session ended first: nothing is left to show it on.
    heldToast = null
    return
  }
  lastToastAt = await $.clock.now()
  const latest = heldToast
  heldToast = null
  if (settings.notify !== 'off') $.ui.toast(latest)
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

// Asks once before skill descriptions first leave the machine: skill hints are
// off by default (beta), so the first question leaves them out. Declining turns
// skill hints off only.
async function askSkillConsent($) {
  if ((await $.store.get(SKILL_CONSENT_KEY)) === true) return 'agreed'
  let answer
  try {
    answer = await $.ui.ask(SKILL_CONSENT_QUESTION, { header: 'sommelier', options: [SKILL_CONSENT_AGREE, SKILL_CONSENT_DECLINE] })
  } catch {
    return 'unanswered'
  }
  if (answer === SKILL_CONSENT_AGREE) {
    await $.store.set(SKILL_CONSENT_KEY, true)
    return 'agreed'
  }
  if (answer !== SKILL_CONSENT_DECLINE) return 'unanswered'
  const r = applySetting(settings, 'skills', 'off')
  await $.store.set(CONFIG_KEY, r.settings)
  await loadSettings($)
  $.ui.toast('skill 提示已關閉，之後可用 /somm config skills on 重新開啟')
  return 'declined'
}

// 候選 skill: the listing the model reads, described by the command list.
// Either call failing leaves none, and so no skill questions.
async function loadSkillCandidates($) {
  if (skillCache) return skillCache
  let listed = []
  let commands = []
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const skills = usage.context.breakdown && usage.context.breakdown.skills
    listed = skills ? skills.skillFrontmatter.map((x) => x.name) : []
    commands = await $.command.list()
  } catch {
    return { listed: [], commands: [] }
  }
  // Built before the narrowing, which /somm config may change at any time.
  skillCache = { listed, commands: commands.map((c) => ({ name: c.name, description: redact(c.description ?? '') })) }
  return skillCache
}

// The skill questions for this sentence, or null: off, not agreed to, or too
// few candidates.
async function skillQuestionsFor($) {
  if (settings.skills !== 'on') return null
  const { listed, commands } = await loadSkillCandidates($)
  const { candidates, dropped } = skillCandidates(listed, commands, settings.skillsAllow, settings.skillsExclude)
  if (dropped) note('skills: ' + dropped + ' candidates past the choice limit left out')
  const questions = skillQuestions(SKILL_QUESTIONS, candidates)
  // Nothing to send, nothing to ask about.
  if (!questions || (await askSkillConsent($)) !== 'agreed') return null
  return questions
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
  const sid = await sessionId($)
  if (!sid) return
  const key = MANUAL_PREFIX + sid
  if (model) await $.store.set(key, model)
  else await $.store.delete(key)
}

// The session id, or null where the host has none to give.
async function sessionId($) {
  try {
    return await $.session.id()
  } catch {
    return null
  }
}

// The routing state that must outlive a module reload, kept per session:
// each entry reads its variable, and writes it back from what was kept.
const KEPT_STATE = {
  currentRung: [() => currentRung, (v) => (currentRung = v ?? null)],
  judgedTurns: [() => judgedTurns, (v) => (judgedTurns = v ?? 0)],
  ledger: [() => ledger, (v) => (ledger = v ?? {})],
  lastTtl: [() => lastTtl, (v) => (lastTtl = v ?? lastTtl)],
  seen: [() => ({ ...seen }), (v) => Object.assign(seen, v ?? {})],
  fallback: [() => fallback, (v) => (fallback = v ?? false)],
  launchModel: [() => launchModel, (v) => (launchModel = v ?? null)],
  locked: [() => locked, (v) => (locked = v ?? null)],
  hinted: [() => hinted, (v) => (hinted = v ?? [])],
  lastShown: [() => lastShown, (v) => (lastShown = v ?? '')],
}

// Drops the oldest entries under a prefix past the cap; `age` dates each key.
async function trimStore($, prefix, cap, age) {
  const keys = (await $.store.keys()).filter((k) => k.startsWith(prefix))
  if (keys.length <= cap) return
  const byAge = []
  for (const k of keys) byAge.push({ k, at: await age(k) })
  byAge.sort((a, b) => a.at - b.at)
  for (const { k } of byAge.slice(0, byAge.length - cap)) await $.store.delete(k)
}

async function saveState($) {
  const sid = await sessionId($)
  if (!sid) return
  const kept = { at: await $.clock.now() }
  for (const [name, [read]] of Object.entries(KEPT_STATE)) kept[name] = read()
  await $.store.set(STATE_PREFIX + sid, kept)
  await trimStore($, STATE_PREFIX, STATE_CAP, async (k) => ((await $.store.get(k)) ?? {}).at ?? 0)
}

// Reads back what saveState kept for this session, once per module: the
// manual pick from its own key, the rest from the state key.
async function restoreState($) {
  if (restored) return
  const sid = await sessionId($)
  if (!sid) return
  restored = true
  manual = (await $.store.get(MANUAL_PREFIX + sid)) ?? manual
  const kept = await $.store.get(STATE_PREFIX + sid)
  if (!kept) return
  for (const [name, [, write]] of Object.entries(KEPT_STATE)) write(kept[name])
  note('state restored for ' + sid.slice(0, 6) + ': ' + (currentRung ? currentRung.model + '·' + currentRung.effort : 'session') + ', ' + judgedTurns + ' judged')
}

async function apiKey($) {
  if (configKey) return configKey
  return (await $.env.get('TYPESAFE_API_KEY')) || ''
}

async function callJev($, key, state, extra = null) {
  try {
    const res = await $.http.fetch(JEV_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: JEV.model, state, questions: extra ? { ...JEV.questions, ...extra } : JEV.questions }),
    })
    // A request the skill questions made invalid is asked again without them,
    // so a bad skill listing never costs the routing.
    if (extra && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
      const plain = await callJev($, key, state)
      return { ...plain, skillError: 'http_' + res.status }
    }
    if (!res.ok) return { error: 'http_' + res.status }
    const body = JSON.parse(res.text)
    if (!body.answers || !body.answers.depth || !body.answers.depth.probabilities) return { error: 'bad_response' }
    return { answers: body.answers, servedModel: body.model }
  } catch {
    return { error: 'fetch_failed' }
  }
}

async function judge($, text, messages, extra = null) {
  const t0 = await $.clock.now()
  const key = await apiKey($)
  if (!key) return { error: 'no_key', ms: 0 }
  const state = buildJevState(messages, text)
  const result = await callJev($, key, state, extra)
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

// Whether a prompt is judged: { skip } keeps the current rung without asking
// Jev, { block } sends nothing for that reason, { judge: true } asks Jev, and
// {} leaves it to decideTurn (off, short reply, a guard).
async function screen($, text, origin, overridden, sessionModel) {
  if (overridden) return { skip: 'override' }
  if (origin && !USER_ORIGINS.includes(origin)) return { skip: 'continuation' }
  if (isSlashCommand(text)) return { skip: 'slash_command' }
  if (asksDeepThought(text)) return { skip: 'ultrathink' }
  // A full id outside the 5.5 family is not routed, so nothing is sent; an
  // alias waits for turn.step's full id.
  const unsupported = sessionModel && sessionModel.startsWith('claude-') && !isSupportedModel(sessionModel)
  if (text === '' || isShortReply(text) || manual || fallback || unsupported || !(await isEnabled($)) || (await projectOff($))) return {}
  // Without a key nothing would be sent, so there is nothing to consent to.
  const consent = (await apiKey($)) ? await askConsent($) : 'agreed'
  if (consent !== 'agreed') return { block: 'consent_' + consent }
  return { judge: true }
}

// Asks Jev about a prompt as it is submitted. With skill hints on, the prompt
// waits for the answer so a hint can go with it; otherwise turn.start's
// caller waits as before. Returns the judgement promise and the hint, if any.
async function judgeAtSubmit($, text) {
  await loadSettings($)
  const extra = await skillQuestionsFor($)
  const p = judge($, text, await $.session.messages(), extra)
  if (!extra) return { judgement: p, skill: null }
  const j = await waitCapped($, p)
  if (j.error || j.skillError || !j.answers.needs_skill) {
    if (j.skillError) note('skills: Jev refused the skill questions (' + j.skillError + ')')
    return { judgement: Promise.resolve(j), skill: null }
  }
  // A new topic starts the hinted list afresh, as it does the rung.
  const newTask = j.answers.new_task ? j.answers.new_task.noul : 0
  if (judgedTurns === 0 || newTask >= cfg.thresholds.tNew) hinted = []
  const skill = pickSkill(j.answers, hinted)
  if (skill && skill.hint) hinted.push(skill.hint)
  return { judgement: Promise.resolve(j), skill }
}

// What this turn keeps when it is not (or cannot be) judged: the current rung,
// moved to sonnet once haiku's conversation has grown too long.
function keep(reason, contextTokens, extra = {}) {
  // An override holds even past haiku's length (docs/spec.md「分派決策」11).
  const guard = locked ? null : qualityGuard(currentRung, contextTokens, cfg)
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
  await loadSettings($)
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
    const r = routeDeepThought({ current: currentRung, session: { model: shortModel(e.model), effort: e.effort ?? 'medium' } }, cfg)
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
  if (j.error) {
    if (j.error === 'no_key') {
      if (!noKeyNotified) {
        noKeyNotified = true
        void notify($, e.turnId, 'sommelier：沒有 TypeSafe API key，Jev 無法判斷，先沿用目前的模型。請在插件設定填入 typesafe_api_key，或讓 Claude Code 讀得到 TYPESAFE_API_KEY')
      }
    } else jevFailures += 1
    if (jevFailures === JEV_FAILURE_TOAST) {
      void notify($, e.turnId, 'sommelier：Jev 連續 ' + JEV_FAILURE_TOAST + ' 次判斷失敗（' + j.error + '），這幾句沿用目前的模型。/somm log 可看原因')
    }
    return keep('jev_failed:' + j.error, contextTokens, { jevMs: j.ms ?? null })
  }
  jevFailures = 0
  const jev = {
    probs: j.answers.depth.probabilities, riskProb: j.answers.high_risk ? j.answers.high_risk.noul : null,
    jevMs: j.ms, servedModel: j.servedModel,
  }
  if (locked) {
    // Held until a new topic; then it is judged like any other sentence.
    const newTask = j.answers.new_task ? j.answers.new_task.noul : null
    if ((newTask ?? 0) < cfg.thresholds.tNew) return { rung: locked, reason: 'override_locked', newTopic: false, newTask, contextTokens, ...jev }
    locked = null
  }
  const r = route(j.answers, {
    current: currentRung,
    session: { model: shortModel(e.model), effort: e.effort ?? 'medium' },
    firstTurn: judgedTurns === 0,
    ledger, contextTokens, now: await $.clock.now(), messageCount: e.messageCount, ttl: lastTtl,
    turn: seen.turns ? { output: seen.output / seen.turns, fresh: seen.fresh / seen.turns } : DEFAULT_TURN,
  }, cfg)
  judgedTurns += 1
  currentRung = r.current
  if (r.reason === 'cost_blocked') {
    void notify(
      $, e.turnId,
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
      void notify(
        $, e.turnId,
        'sommelier：覆寫為 ' + rung.model + '，要重寫 ' + Math.round(cold / 1000) + 'k tokens 的 cache（約 $' +
          rewriteCost(rung.model, cold, lastTtl).toFixed(2) + '）',
      )
    }
  }
  return { rung, reason: 'override', contextTokens, coldTokens: cold }
}

// The status line under the prompt: the model, with its version, and effort
// that actually answered the last main step. The session's own model is shown beside it.
// The cache gauge follows it (#35).
function statusText(answered, effort, gauge = '') {
  return '🍷 ' + answered + (effort ? '·' + effort : '') + (gauge ? ' ' + gauge : '')
}

// Bumped whenever the status line changes, so only the latest one is redrawn
// when its cache expires.
let statusShown = 0

// The status line after a main step. Once that model's cache expires the
// gauge is drawn again, with empty cells.
async function showStatus($, label, effort, model, messageCount) {
  const shown = ++statusShown
  const contextTokens = (await $.session.usage()).context.tokens ?? 0
  const turn = seen.turns ? { output: seen.output / seen.turns, fresh: seen.fresh / seen.turns } : DEFAULT_TURN
  // Read at draw time, so cache off also keeps a pending expiry redraw plain.
  const gauge = (now) => (settings.cache === 'off' ? '' : cacheGauge(ledger, model, contextTokens, now, messageCount, lastTtl, turn, cfg))
  $.ui.status(statusText(label, effort, gauge(await $.clock.now())))
  if (ledger[model]) void redrawOnExpiry($, shown, () => statusText(label, effort, gauge(Infinity)))
}

async function redrawOnExpiry($, shown, text) {
  try {
    await $.clock.sleep((TTL_MS[lastTtl] ?? TTL_MS['1h']) + 1)
  } catch {
    // The session ended first.
    return
  }
  if (shown === statusShown) $.ui.status(text())
}

function clearStatus($) {
  statusShown += 1
  $.ui.status(undefined)
}

function spinnerText(decision, skill = null) {
  if (decision.reason === 'off') return ''
  const hint = skill && skill.hint ? ' · 💡' + skillLabel(skill.hint) : ''
  return rungText(decision) + hint
}

function rungText(decision) {
  if (!decision.rung) return 'session · ' + (decision.reason.startsWith('jev_failed') ? 'Jev 失敗' : REASON_LABEL[decision.reason] ?? decision.reason)
  const r = decision.rung
  const label = decision.reason.startsWith('jev_failed') ? 'Jev 失敗，沿用' : REASON_LABEL[decision.reason] ?? decision.reason
  const risk = decision.highRisk ? ' · 高風險' : ''
  const jev = decision.jevMs != null ? ' · jev ' + decision.jevMs + 'ms' : ''
  return r.model + '·' + r.effort + (decision.level !== undefined ? ' L' + decision.level : '') + ' · ' + (decision.newTopic ? '新話題，' : '') + label + risk + jev
}

async function writeRecord($, rec) {
  const sid = await sessionId($)
  const at = await $.clock.now()
  await $.store.set(REC_PREFIX + String(at).padStart(14, '0') + ':' + sid, { ...rec, at, session: sid })
  await trimStore($, REC_PREFIX, REC_CAP, (k) => Number(k.slice(REC_PREFIX.length).split(':')[0]))
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
  const skill = r.skillTop
    ? ' · ' + (r.skillHint ? '💡' + r.skillHint + (r.skillAdopted ? '（採用）' : '（未採用）') : 'skill ' + r.skillTop) +
      ' P=' + r.needsSkill.toFixed(2) + '/' + r.skillTopProb.toFixed(2)
    : ''
  return rung + answered + ' · ' + r.reason + probs + (r.jevMs != null ? ' jev ' + Math.round(r.jevMs) + 'ms' : '') + skill + cache + session
}

async function runCommand($, e) {
  const words = (e.args || '').trim().split(/\s+/)
  const [sub, arg] = words
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
    clearStatus($)
    return { text: 'sommelier 已關閉：沿用 session 的模型與 effort。' }
  }
  if (sub === 'config') return configCommand($, arg, words.slice(2).join(' '))
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
  return { text: '用法：/somm on | off [--project] | status | log [n] | events | config [名稱 值]' }
}

// /somm config: no name lists the settings; a name and value changes one.
async function configCommand($, name, value) {
  await loadSettings($)
  if (!name) {
    const on = (await isEnabled($)) ? 'on' : 'off'
    return { text: ['enabled ' + on, ...describeSettings(settings)].join('\n') }
  }
  if (name === 'enabled') {
    if (value !== 'on' && value !== 'off') return { text: 'enabled 要是 on 或 off' }
    return runCommand($, { args: value })
  }
  const r = applySetting(settings, name, value)
  if (r.error) return { text: r.error }
  await $.store.set(CONFIG_KEY, r.settings)
  await loadSettings($)
  if (name === 'spinner') $.ui.invalidate('ui.render')
  return { text: '已設定：' + describeSettings(settings).find((line) => line.startsWith(name + ' ')) }
}

export function register(on, options) {
  configKey = (options && options.typesafe_api_key) || ''

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'sommelier：依任務挑模型與 effort（on | off | status | log | events | config）',
        argumentHint: '[on | off | status | log [n] | events | config [名稱 值]]',
        immediate: true,
      })
    } catch {
      // /somm is taken: register the long name instead and say so.
      await $.command.register({
        name: FALLBACK_COMMAND,
        description: 'sommelier：依任務挑模型與 effort（on | off | status | log | events | config）',
        argumentHint: '[on | off | status | log [n] | events | config [名稱 值]]',
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
    // A reload's first event can be a /compact or /clear: read back what the
    // store kept before acting on it. /clear already carries the new session
    // id, so only a manual pick saved under it comes back. startup and resume
    // begin afresh, as before (resume reads the manual pick below).
    if (e.source === 'startup' || e.source === 'resume') restored = true
    else await restoreState($)
    if (e.source === 'startup') launchModel = model
    if (e.source !== 'startup') {
      ledger = markCold(ledger)
      skillCache = null
    }
    if (e.source === 'resume') manual = (await $.store.get(MANUAL_PREFIX + (await sessionId($)))) ?? manual
    if (e.source === 'clear') {
      currentRung = null
      locked = null
      judgedTurns = 0
      hinted = []
      // /clear starts a new session id; the pick carries over to it. A session
      // model that is not the one it started with was picked by hand too.
      if (!manual && launchModel && model && model !== launchModel) manual = model
      if (manual) await setManual($, manual)
    }
    return next(e)
  })

  on('classic.PreModelSwitch', async ($, e, next) => {
    await restoreState($)
    note('PreModelSwitch ' + e.from_model + ' → ' + e.to_model + ' requested=' + e.requested_model + ' source=' + e.source)
    await userSwitch($, e)
    await saveState($)
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    await restoreState($)
    note('PostModelSwitch ' + e.from_model + ' → ' + e.to_model + ' requested=' + e.requested_model + ' source=' + e.source)
    if (e.source === 'auto') fallback = true
    else if (e.source !== 'resume') await userSwitch($, e)
    await saveState($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await restoreState($)
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
      await saveState($)
      return { drop: 'sommelier：接下來用 ' + asked.rung.model + '·' + asked.rung.effort + '，到下一個新話題為止' }
    }
    const text = asked ? asked.text : e.text
    // A prompt typed into a running turn joins it, so no turn.start follows.
    if (e.turnId) return next(asked ? { ...e, text } : e)
    let sessionModel = null
    try {
      sessionModel = await $.session.model()
    } catch {}
    const verdict = await screen($, text, kind, !!asked, sessionModel)
    let skill = null
    if (verdict.judge) {
      const r = await judgeAtSubmit($, text)
      verdict.judgement = r.judgement
      skill = r.skill
    }
    origins.push({ text, kind, override: asked ? asked.rung : null, verdict, skill })
    if (origins.length > EVENT_CAP) origins.shift()
    const out = asked ? { ...e, text } : e
    if (!skill || !skill.hint) return next(out)
    return next({ ...out, context: [...(e.context ?? []), skillHintText(skill.hint)] })
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    await restoreState($)
    return runCommand($, e)
  })
  on('command.run', { command: FALLBACK_COMMAND }, async ($, e) => {
    await restoreState($)
    return runCommand($, e)
  })

  on('turn.start', async ($, e, next) => {
    await restoreState($)
    prompts.set(e.turnId, e.text)
    const seenAt = takeOrigin(e.text)
    const origin = seenAt ? seenAt.kind : null
    if (seenAt && seenAt.override) overrides.set(e.turnId, seenAt.override)
    if (seenAt && seenAt.skill) skillByTurn.set(e.turnId, seenAt.skill)
    let sessionModel = null
    try {
      sessionModel = await $.session.model()
    } catch {}
    note('turn.start ' + e.turnId + ' origin=' + origin + ' session.model=' + sessionModel + (isSlashCommand(e.text) ? ' slash' : ''))
    // prompt.submit screened it already; a turn it never saw is screened now.
    const verdict = seenAt && seenAt.verdict ? seenAt.verdict : await screen($, e.text, origin, overrides.has(e.turnId), sessionModel)
    if (verdict.skip) skipped.set(e.turnId, verdict.skip)
    if (verdict.block) blocked.set(e.turnId, verdict.block)
    if (verdict.judgement) pending.set(e.turnId, verdict.judgement)
    else if (verdict.judge) pending.set(e.turnId, judge($, e.text, await $.session.messages()))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    let t = turns.get(e.turnId)
    if (!t) {
      t = { decision: await decideTurn($, e), steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, skill: skillByTurn.get(e.turnId) ?? null, skillsUsed: [] }
      turns.set(e.turnId, t)
      activeTurn = e.turnId
      note('turn.step ' + e.turnId + ' model=' + e.model + ' → ' + (t.decision.rung ? t.decision.rung.model : 'session') + ' (' + t.decision.reason + ')')
      lastShown = spinnerText(t.decision, t.skill)
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
    if (t.decision.reason === 'off') clearStatus($)
    else {
      const answered = u && u.model ? u.model : out.model
      await showStatus($, modelLabel(answered), out.effort, shortModel(answered), e.messageCount)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    pending.delete(e.turnId)
    blocked.delete(e.turnId)
    skipped.delete(e.turnId)
    overrides.delete(e.turnId)
    skillByTurn.delete(e.turnId)
    if (activeTurn === e.turnId) activeTurn = null
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
      const { decision, skill, skillsUsed, ...usage } = t
      // A stopped project keeps no trace of its prompts.
      const summary = prompt && decision.reason !== 'project_off' ? redact(promptSummary(prompt)).slice(0, PROMPT_SUMMARY_CHARS) || undefined : undefined
      const skillRec = skill
        ? { skillHint: skill.hint, needsSkill: skill.needs, skillTop: skill.top, skillTopProb: skill.topProb, skillAdopted: skill.hint ? skillsUsed.includes(skill.hint) : undefined }
        : {}
      await writeRecord($, { turnId: e.turnId, ...decision, ...usage, ...skillRec, skillsUsed: skillsUsed.length ? skillsUsed : undefined, prompt: summary })
    }
    if (!e.agentId && t) await saveState($)
    return next(e)
  })

  // Fires for /name, the Skill tool and a subagent's preload alike; one while
  // a main turn runs is that turn's, for 採用 (#27).
  on('skill.prompt', async ($, e, next) => {
    const t = activeTurn ? turns.get(activeTurn) : null
    if (t && !t.skillsUsed.includes(e.skill)) t.skillsUsed.push(e.skill)
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!lastShown || settings.spinner === 'off') return next(e)
    return next({ ...e, props: { ...e.props, suffix: ' · 🍷 ' + lastShown } })
  })
}
