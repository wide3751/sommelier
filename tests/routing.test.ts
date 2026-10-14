import { expect, mock, test } from 'claude-code/testing'

const OPUS = 'claude-opus-5-5'

function jevBody(probs: number[], newTask = 0.9, highRisk = 0.05) {
  return JSON.stringify({
    model: 'jev-1.13.0',
    answers: {
      depth: { type: 'score', probabilities: { 0: probs[0], 1: probs[1], 2: probs[2], 3: probs[3] } },
      new_task: { type: 'noul', noul: newTask },
      high_risk: { type: 'noul', noul: highRisk },
    },
  })
}

// Common stubs. Returns handles the tests read.
function setup(
  on,
  opts: {
    enabled?: boolean; consent?: boolean; answer?: string | null; root?: string
    key?: string | null; jev?: (body: any) => any; messages?: any[]; contextTokens?: number | (() => number)
    usage?: Record<string, number>
  } = {},
) {
  const clock = mock.clock(on)
  const saved = new Map<string, unknown>()
  if (opts.enabled !== undefined) saved.set('somm:enabled', opts.enabled)
  if (opts.consent !== false) saved.set('somm:consent', true)
  const asked: string[] = []
  // What reached the outside, in order: 'ask' for a question, 'fetch' for Jev.
  const order: string[] = []
  on('tool.call', ($, e) => {
    const q = e.questions[0]
    asked.push(q.question)
    order.push('ask')
    if (opts.answer === null) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q.question]: opts.answer ?? q.options[0].label } } }
  })
  on('session.root', () => ({ value: opts.root ?? '/work/repo' }))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  mock.env(on, opts.key === null ? {} : { TYPESAFE_API_KEY: opts.key ?? 'test-key' })
  on('session.id', () => ({ value: 'sess1' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: typeof opts.contextTokens === 'function' ? opts.contextTokens() : opts.contextTokens, window: 1000000 }, rateLimits: [] } }))
  on('session.messages', () => ({
    value: opts.messages ?? [
      { role: 'user', text: '登入偶爾 401，幫我查原因', toolUses: [] },
      { role: 'assistant', text: '我先看 middleware。', toolUses: [{ name: 'Read' }] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'x', text: 'FILE CONTENT SHOULD NOT BE SENT' }] },
      { role: 'assistant', text: '懷疑是 refresh 併發。要我加 log 嗎？', toolUses: [] },
      { role: 'user', text: 'CURRENT REQUEST', toolUses: [] },
    ],
  }))
  const fetches: any[] = []
  on('http.fetch', async ($, e) => {
    const body = JSON.parse(e.init.body)
    fetches.push(body)
    order.push('fetch')
    return { value: opts.jev ? await opts.jev(body) : { status: 200, ok: true, headers: {}, text: jevBody([0.9, 0.08, 0.02, 0]) } }
  })
  const sent: any[] = []
  on('turn.step', async function* ($, e) {
    sent.push({ turnId: e.turnId, index: e.index, model: e.model, effort: e.effort, agentId: e.agentId })
    return {
      turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: { model: e.model, input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, ...opts.usage },
    }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('classic.SessionStart', () => ({}))
  on('turn.complete', () => ({ text: '' }))
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { clock, saved, fetches, sent, statuses, toasts, asked, order }
}

async function drain(stream) {
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  return step.value
}

const step = ($, turnId, index, extra = {}) =>
  drain($.turn.step({ turnId, index, model: OPUS, effort: 'medium', messageCount: 5, ...extra }))
const complete = ($, turnId) => $.turn.complete({ turnId, answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', usage: null })

function records(saved: Map<string, unknown>) {
  return [...saved.entries()].filter(([k]) => k.startsWith('somm:rec:')).map(([, v]) => v as any)
}

test('on by default: a fresh install judges the first turn', async ($, on) => {
  const h = setup(on)
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.fetches.length).toBe(1)
})

test('after /somm off requests are untouched and Jev is never called', async ($, on) => {
  const h = setup(on, { enabled: false })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.sent[0].model).toBe(OPUS)
  expect(h.fetches.length).toBe(0)
})

test('first turn is judged once and every main step gets the rung', async ($, on) => {
  const h = setup(on, { enabled: true })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  await step($, 't1', 1)
  await complete($, 't1')
  expect(h.fetches.length).toBe(1)
  expect(h.sent.map((s) => s.model + '/' + s.effort)).toEqual(['claude-haiku-5-5/medium', 'claude-haiku-5-5/medium'])
  const rec = records(h.saved)
  expect(rec.length).toBe(1)
  expect(rec[0].reason).toBe('downgrade')
  expect(rec[0].newTopic).toBe(true)
  expect(rec[0].cacheRead).toBe(200)
  expect(rec[0].cacheWrite).toBe(40)
})

test('Jev state holds recent user/assistant text only, without tool output or the current prompt', async ($, on) => {
  const h = setup(on, { enabled: true })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  const state = h.fetches[0].state
  expect(state.current_request).toBe('CURRENT REQUEST')
  expect(state.recent_turns.map((m) => m.text)).toEqual(['登入偶爾 401，幫我查原因', '我先看 middleware。', '懷疑是 refresh 併發。要我加 log 嗎？'])
  expect(JSON.stringify(state)).not.toContain('FILE CONTENT')
  expect(h.fetches[0].model).toBe('jev-1.13.0')
})

test('a short reply keeps the current rung without calling Jev', async ($, on) => {
  const h = setup(on, { enabled: true, jev: () => ({ status: 200, ok: true, headers: {}, text: jevBody([0.05, 0.85, 0.1, 0]) }) })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  await $.turn.start({ text: 'second', turnId: 't2' })
  await step($, 't2', 0)
  expect(h.fetches.length).toBe(1)
  expect(h.sent[1].model).toBe('claude-sonnet-5-5')
})

test('a deep request goes to opus with high effort', async ($, on) => {
  const h = setup(on, { enabled: true, jev: () => ({ status: 200, ok: true, headers: {}, text: jevBody([0, 0, 0.1, 0.9]) }) })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.sent[0].model + '/' + h.sent[0].effort).toBe('claude-opus-5-5/high')
})

test('high risk raises this turn to base with high effort, and only this turn', async ($, on) => {
  const h = setup(on, { enabled: true, jev: () => ({ status: 200, ok: true, headers: {}, text: jevBody([0.9, 0.1, 0, 0], 0.9, 0.9) }) })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  await $.turn.start({ text: 'next', turnId: 't2' })
  await step($, 't2', 0)
  expect(h.sent.map((s) => s.model + '/' + s.effort)).toEqual(['claude-opus-5-5/high', 'claude-opus-5-5/medium'])
})

test('a Jev answer slower than 1.5 s leaves the request unchanged', async ($, on) => {
  let clockRef
  const h = setup(on, {
    enabled: true,
    jev: async () => {
      await clockRef.sleep(5000)
      return { status: 200, ok: true, headers: {}, text: jevBody([0.9, 0.1, 0, 0]) }
    },
  })
  clockRef = h.clock
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  const done = step($, 't1', 0)
  await h.clock.advance(1500)
  await done
  await complete($, 't1')
  expect(h.sent[0].model).toBe(OPUS)
  expect(records(h.saved)[0].reason).toBe('jev_failed:timeout')
})

test('rate limiting leaves the request unchanged and records why', async ($, on) => {
  const h = setup(on, { enabled: true, jev: () => ({ status: 429, ok: false, headers: {}, text: '' }) })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  expect(h.sent[0].model).toBe(OPUS)
  expect(records(h.saved)[0].reason).toBe('jev_failed:http_429')
})

test('without an API key Jev is not called', async ($, on) => {
  const h = setup(on, { enabled: true, key: null })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  expect(h.fetches.length).toBe(0)
  expect(h.sent[0].model).toBe(OPUS)
  expect(records(h.saved)[0].reason).toBe('jev_failed:no_key')
})

test('subagent requests are never changed', async ($, on) => {
  const h = setup(on, { enabled: true })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0, { agentId: 'a1' })
  expect(h.sent[0].model).toBe(OPUS)
})

test('/somm on and off toggle routing', async ($, on) => {
  const h = setup(on, { enabled: false })
  const onReply = await $.command.run({ command: 'somm', args: 'on' })
  expect(onReply.text).toContain('已開啟')
  expect(h.saved.get('somm:enabled')).toBe(true)
  await $.command.run({ command: 'somm', args: 'off' })
  expect(h.saved.get('somm:enabled')).toBe(false)
})

test('the status line shows the model that answered and the session model it replaced', async ($, on) => {
  const h = setup(on, { enabled: true })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.statuses.at(-1)).toBe('🍷 實際模型 haiku·medium（預設 opus）')
})

test('the status line has no preset note when Jev fails and the session model answers', async ($, on) => {
  const h = setup(on, { enabled: true, jev: () => ({ status: 429, ok: false, headers: {}, text: '' }) })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.statuses.at(-1)).toBe('🍷 實際模型 opus·medium')
})

test('the status line stays empty while off and clears on /somm off', async ($, on) => {
  const h = setup(on, { enabled: false })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.statuses.filter((s) => s !== undefined).length).toBe(0)
  await $.command.run({ command: 'somm', args: 'off' })
  expect(h.statuses.at(-1)).toBe(undefined)
})

const deep = () => ({ status: 200, ok: true, headers: {}, text: jevBody([0.02, 0.08, 0.2, 0.7]) })
const clear = () => ({ status: 200, ok: true, headers: {}, text: jevBody([0.05, 0.85, 0.1, 0]) })

const ok = (probs: number[], newTask = 0.9, highRisk = 0.05) => ({ status: 200, ok: true, headers: {}, text: jevBody(probs, newTask, highRisk) })
const L0 = [0.9, 0.08, 0.02, 0]
const L1 = [0.05, 0.85, 0.1, 0]
const L3 = [0.02, 0.08, 0.2, 0.7]

// Answers Jev with each of `answers` in turn.
function sequence(...answers: any[]) {
  let i = 0
  return () => answers[Math.min(i++, answers.length - 1)]
}

async function turn($, turnId, text) {
  await $.turn.start({ text, turnId })
  await step($, turnId, 0)
  await complete($, turnId)
}

// A turn the size DEFAULT_TURN assumes, so averages do not shrink the savings.
const TYPICAL = { output_tokens: 2000, cache_creation_input_tokens: 3000 }

const rungs = (h) => h.sent.map((s) => s.model.replace('claude-', '').replace('-5-5', '') + '/' + s.effort)

test('a downgrade that cannot pay back its cache rewrite is blocked for that sentence only', async ($, on) => {
  const h = setup(on, { enabled: true, contextTokens: 120000, jev: clear })
  await turn($, 't1', '幫 parseDate 加上時區參數')
  const first = records(h.saved)[0]
  expect(first.reason).toBe('cost_blocked')
  expect(first.switchCost).toBeGreaterThan(first.switchSavings)
  expect(first.coldTokens).toBe(120000)
  await turn($, 't2', '另一件事：幫 formatDate 補測試')
  expect(h.fetches.length).toBe(2)
  expect(h.sent.map((s) => s.model)).toEqual([OPUS, OPUS])
  expect(h.toasts.length).toBe(2)
  expect(h.statuses.at(-1)).toBe('🍷 實際模型 opus·medium')
})

test('the same downgrade goes ahead while the conversation is short', async ($, on) => {
  const h = setup(on, { enabled: true, contextTokens: 20000, jev: clear })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.sent[0].model).toBe('claude-sonnet-5-5')
})

test('haiku is kept to short conversations: a long one is weighed as sonnet', async ($, on) => {
  const h = setup(on, { enabled: true, contextTokens: 300000 })
  await turn($, 't1', '看一下 package.json 的 version')
  expect(h.sent[0].model).toBe(OPUS)
  expect(records(h.saved)[0].reason).toBe('cost_blocked')
  expect(h.toasts[0]).toContain('換到 sonnet')
})

test('every new request is judged again', async ($, on) => {
  const h = setup(on, { enabled: true, jev: sequence(ok(L1), ok(L3, 0.1)) })
  await turn($, 't1', '幫 parseDate 加上時區參數')
  await turn($, 't2', '登入偶爾 401，幫我找出原因')
  expect(h.fetches.length).toBe(2)
  expect(rungs(h)).toEqual(['sonnet/medium', 'opus/high'])
  expect(records(h.saved).at(-1).reason).toBe('upgrade')
})

test('a lower judgement on the same topic keeps the current rung', async ($, on) => {
  const h = setup(on, { enabled: true, jev: sequence(ok(L3), ok(L1, 0.1)) })
  await turn($, 't1', '設計多租戶權限架構')
  await turn($, 't2', '那 tenant 表要加哪些欄位')
  expect(rungs(h)).toEqual(['opus/high', 'opus/high'])
  expect(records(h.saved).at(-1).reason).toBe('hold')
})

test('a new topic may come back down once the switch pays', async ($, on) => {
  const h = setup(on, { enabled: true, contextTokens: 20000, usage: TYPICAL, jev: sequence(ok(L3), ok(L1, 0.9)) })
  await turn($, 't1', '設計多租戶權限架構')
  await turn($, 't2', '另外幫 parseDate 加上時區參數')
  expect(rungs(h)).toEqual(['opus/high', 'sonnet/medium'])
  expect(records(h.saved).at(-1).reason).toBe('downgrade')
})

test('going back to a model used moments ago only costs what is new', async ($, on) => {
  let ctx = 0
  const h = setup(on, {
    enabled: true, contextTokens: () => ctx, usage: { ...TYPICAL, cache_read_input_tokens: 115000 },
    jev: sequence(ok(L1), ok(L3, 0.1), ok(L1, 0.9)),
  })
  await turn($, 't1', '幫 parseDate 加上時區參數')
  ctx = 120000
  await turn($, 't2', '順便查一下為什麼偶爾 401')
  await turn($, 't3', '回到 parseDate，補上測試')
  expect(rungs(h)).toEqual(['sonnet/medium', 'opus/high', 'sonnet/medium'])
  const last = records(h.saved).at(-1)
  expect(last.reason).toBe('downgrade')
  expect(last.coldTokens).toBeLessThan(5000)
})

test('after compact the conversation is rewritten, so the same switch back is blocked', async ($, on) => {
  let ctx = 0
  const h = setup(on, {
    enabled: true, contextTokens: () => ctx, usage: { ...TYPICAL, cache_read_input_tokens: 115000 },
    jev: sequence(ok(L1), ok(L3, 0.1), ok(L1, 0.9)),
  })
  await turn($, 't1', '幫 parseDate 加上時區參數')
  ctx = 120000
  await turn($, 't2', '順便查一下為什麼偶爾 401')
  await $.classic.SessionStart({ source: 'compact' })
  await turn($, 't3', '回到 parseDate，補上測試')
  expect(rungs(h)).toEqual(['sonnet/medium', 'opus/high', 'opus/high'])
  const last = records(h.saved).at(-1)
  expect(last.reason).toBe('cost_blocked')
  expect(last.coldTokens).toBe(120000 - 22000)
})

test('after /clear the next request starts a new topic', async ($, on) => {
  const h = setup(on, { enabled: true, jev: sequence(ok(L3), ok(L1, 0.1)) })
  await turn($, 't1', '設計多租戶權限架構')
  await $.classic.SessionStart({ source: 'clear' })
  await turn($, 't2', '幫 parseDate 加上時區參數')
  expect(rungs(h)).toEqual(['opus/high', 'sonnet/medium'])
  expect(records(h.saved).at(-1).newTopic).toBe(true)
})

test('a Jev failure mid-session keeps the current rung', async ($, on) => {
  const h = setup(on, { enabled: true, jev: sequence(ok(L0), { status: 429, ok: false, headers: {}, text: '' }) })
  await turn($, 't1', '看一下 package.json 的 version')
  await turn($, 't2', '幫 parseDate 加上時區參數')
  expect(rungs(h)).toEqual(['haiku/medium', 'haiku/medium'])
  expect(records(h.saved).at(-1).reason).toBe('jev_failed:http_429')
})

test('short replies and continuation words are not sent to Jev', async ($, on) => {
  const h = setup(on, { enabled: true })
  await turn($, 't1', '看一下 package.json 的 version')
  for (const [i, text] of ['好', 'ok!', '繼續', '好，照這樣改'].entries()) await turn($, 'r' + i, text)
  expect(h.fetches.length).toBe(1)
  expect(new Set(rungs(h))).toEqual(new Set(['haiku/medium']))
  expect(records(h.saved).at(-1).reason).toBe('continuation')
})

test('haiku moves to sonnet once the conversation outgrows it', async ($, on) => {
  let ctx = 0
  const h = setup(on, { enabled: true, contextTokens: () => ctx })
  await turn($, 't1', '看一下 package.json 的 version')
  ctx = 40000
  await turn($, 't2', '好')
  expect(rungs(h)).toEqual(['haiku/medium', 'sonnet/medium'])
  expect(records(h.saved).at(-1).reason).toBe('quality_guard')
})

test('an upgrade goes ahead however long the conversation is', async ($, on) => {
  const h = setup(on, { enabled: true, contextTokens: 300000, jev: deep })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0, { model: 'claude-haiku-5-5' })
  expect(h.sent[0].model).toBe(OPUS)
  expect(h.toasts.length).toBe(0)
})

test('secrets are redacted before anything is sent to Jev', async ($, on) => {
  const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'
  const h = setup(on, {
    enabled: true,
    messages: [
      { role: 'user', text: 'my token is ghp_abcdefghijklmnopqrstuvwxyz0123', toolUses: [] },
      { role: 'assistant', text: 'got it', toolUses: [] },
    ],
  })
  await $.turn.start({ text: 'use ' + secret + ' and password=hunter2 here', turnId: 't1' })
  await step($, 't1', 0)
  const sent = JSON.stringify(h.fetches[0])
  expect(sent).not.toContain(secret)
  expect(sent).not.toContain('hunter2')
  expect(sent).not.toContain('ghp_')
  expect(sent).toContain('[REDACTED]')
})

// Every built-in format, plus the shapes that slipped through before:
// prefixed keys (DB_PASSWORD), quoted values, PGP key blocks and 0x-prefixed hex.
const SECRETS: [string, string, string][] = [
  ['sk-', 'sk-proj-abcdefghijklmnop1234', 'abcdefghijklmnop1234'],
  ['AKIA', 'AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'],
  ['private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIEpQIBAAKC\n-----END RSA PRIVATE KEY-----', 'MIIEpQIBAAKC'],
  ['PGP key block', '-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBGXyz\n-----END PGP PRIVATE KEY BLOCK-----', 'lQOYBGXyz'],
  ['password=', 'password=hunter2', 'hunter2'],
  ['prefixed password', 'DB_PASSWORD=hunter3', 'hunter3'],
  ['quoted password', 'password: "correct horse"', 'horse'],
  ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'c2lnbmF0dXJl'],
  ['Bearer', 'Authorization: Bearer tok.en-value', 'tok.en-value'],
  ['ghp_', 'ghp_abcdefghijklmnopqrstuvwxyz0123', 'abcdefghijklmnopqrstuvwxyz0123'],
  ['xoxb-', 'xoxb-1234567890-abcdefghij', '1234567890-abcdefghij'],
  ['xoxp-', 'xoxp-1234567890-abcdefghij', '1234567890-abcdefghij'],
  ['AIza', 'AIza' + 'Sy0123456789abcdefghijklmnopqrstu', 'Sy0123456789abcdefghijklmnopqrstu'],
  ['long hex', 'a1b2c3d4'.repeat(5), 'a1b2c3d4'.repeat(5)],
  ['0x hex', '0x' + 'deadbeef'.repeat(8), 'deadbeef'.repeat(8)],
]

for (const [name, secret, leak] of SECRETS) {
  test(`${name} is redacted in what is sent to Jev`, async ($, on) => {
    const h = setup(on, {
      enabled: true,
      messages: [
        { role: 'user', text: 'earlier: ' + secret, toolUses: [] },
        { role: 'assistant', text: 'ok', toolUses: [] },
      ],
    })
    await $.turn.start({ text: 'now: ' + secret, turnId: 't1' })
    await step($, 't1', 0)
    const sent = JSON.stringify(h.fetches[0])
    expect(sent).not.toContain(leak)
    expect(sent).toContain('[REDACTED]')
  })
}

test('ordinary text without secrets is sent unchanged', async ($, on) => {
  const h = setup(on, { enabled: true })
  const text = 'reset my password from the settings page'
  await $.turn.start({ text, turnId: 't1' })
  await step($, 't1', 0)
  const sent = JSON.stringify(h.fetches[0])
  expect(sent).toContain(text)
  expect(sent).not.toContain('[REDACTED]')
})

test('the first send asks for consent and agreeing remembers it', async ($, on) => {
  const h = setup(on, { consent: false })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.asked.length).toBe(1)
  expect(h.asked[0]).toContain('TypeSafe')
  expect(h.fetches.length).toBe(1)
  expect(h.saved.get('somm:consent')).toBe(true)
})

test('nothing is sent to Jev until consent is given', async ($, on) => {
  const h = setup(on, { consent: false })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.order).toEqual(['ask', 'fetch'])
})

test('after agreeing, later sends are not asked about again', async ($, on) => {
  // A failed first judgement makes the next turn ask Jev again.
  let calls = 0
  const h = setup(on, {
    consent: false,
    jev: () => (++calls === 1 ? { status: 500, ok: false, headers: {}, text: '' } : { status: 200, ok: true, headers: {}, text: jevBody([0.9, 0.08, 0.02, 0]) }),
  })
  await $.turn.start({ text: 'FIRST REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  await $.turn.start({ text: 'SECOND REQUEST', turnId: 't2' })
  await step($, 't2', 0)
  expect(h.fetches.length).toBe(2)
  expect(h.asked.length).toBe(1)
  expect(h.order).toEqual(['ask', 'fetch', 'fetch'])
})

test('declining consent sends nothing, keeps the session model and turns sommelier off', async ($, on) => {
  const h = setup(on, { consent: false, answer: '不同意，關閉 sommelier' })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  expect(h.fetches.length).toBe(0)
  expect(h.sent[0].model).toBe(OPUS)
  expect(h.saved.get('somm:enabled')).toBe(false)
  expect(records(h.saved)[0].reason).toBe('consent_declined')
})

test('dismissing the consent question sends nothing and asks again next time', async ($, on) => {
  const h = setup(on, { consent: false, answer: null })
  await $.turn.start({ text: 'FIRST REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  expect(h.fetches.length).toBe(0)
  expect(h.saved.get('somm:enabled')).not.toBe(false)
  expect(h.saved.get('somm:consent')).not.toBe(true)
  expect(records(h.saved)[0].reason).toBe('consent_unanswered')
  await $.turn.start({ text: 'SECOND REQUEST', turnId: 't2' })
  await step($, 't2', 0)
  expect(h.asked.length).toBe(2)
  expect(h.fetches.length).toBe(0)
})

test('an answer other than the two options is not taken as declining', async ($, on) => {
  const h = setup(on, { consent: false, answer: '等等，我想先看隱私說明' })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  expect(h.fetches.length).toBe(0)
  expect(h.saved.get('somm:enabled')).not.toBe(false)
  expect(records(h.saved)[0].reason).toBe('consent_unanswered')
})

test('without an API key nobody is asked for consent', async ($, on) => {
  const h = setup(on, { consent: false, key: null })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.asked.length).toBe(0)
})

test('/somm off --project stops sending from this repo only', async ($, on) => {
  const h = setup(on, { enabled: true })
  const reply = await $.command.run({ command: 'somm', args: 'off --project' })
  expect(reply.text).toContain('/work/repo')
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  expect(h.fetches.length).toBe(0)
  expect(h.sent[0].model).toBe(OPUS)
  expect(records(h.saved)[0].reason).toBe('project_off')
  expect(records(h.saved)[0].prompt).toBe(undefined)
  await $.command.run({ command: 'somm', args: 'on --project' })
  await $.turn.start({ text: 'CURRENT REQUEST', turnId: 't2' })
  await step($, 't2', 0)
  expect(h.fetches.length).toBe(1)
})

test('a record keeps at most 40 characters of the prompt, redacted', async ($, on) => {
  const h = setup(on, { enabled: true })
  const prompt = 'AKIAABCDEFGHIJKLMNOP ' + '這是一段很長的請求'.repeat(10)
  await $.turn.start({ text: prompt, turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  const rec = records(h.saved)[0]
  expect(rec.prompt.length).toBeLessThanOrEqual(40)
  expect(rec.prompt).not.toContain('AKIA')
  expect(rec.prompt).toContain('[REDACTED]')
})
