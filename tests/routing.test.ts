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
function setup(on, opts: { enabled?: boolean; key?: string | null; jev?: (body: any) => any } = {}) {
  const clock = mock.clock(on)
  const saved = new Map<string, unknown>()
  if (opts.enabled) saved.set('somm:enabled', true)
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
  on('session.messages', () => ({
    value: [
      { role: 'user', text: '登入偶爾 401，幫我查原因', toolUses: [] },
      { role: 'assistant', text: '我先看 middleware。', toolUses: [{ name: 'Read' }] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'x', text: 'FILE CONTENT SHOULD NOT BE SENT' }] },
      { role: 'assistant', text: '懷疑是 refresh 併發。要我加 log 嗎？', toolUses: [] },
      { role: 'user', text: 'CURRENT', toolUses: [] },
    ],
  }))
  const fetches: any[] = []
  on('http.fetch', async ($, e) => {
    const body = JSON.parse(e.init.body)
    fetches.push(body)
    return { value: opts.jev ? await opts.jev(body) : { status: 200, ok: true, headers: {}, text: jevBody([0.9, 0.08, 0.02, 0]) } }
  })
  const sent: any[] = []
  on('turn.step', async function* ($, e) {
    sent.push({ turnId: e.turnId, index: e.index, model: e.model, effort: e.effort, agentId: e.agentId })
    return {
      turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: { model: e.model, input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
    }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  return { clock, saved, fetches, sent, statuses }
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

test('off by default: requests are untouched and Jev is never called', async ($, on) => {
  const h = setup(on)
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.sent[0].model).toBe(OPUS)
  expect(h.fetches.length).toBe(0)
})

test('first turn is judged once and every main step gets the rung', async ($, on) => {
  const h = setup(on, { enabled: true })
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0)
  await step($, 't1', 1)
  await complete($, 't1')
  expect(h.fetches.length).toBe(1)
  expect(h.sent.map((s) => s.model + '/' + s.effort)).toEqual(['claude-haiku-5-5/medium', 'claude-haiku-5-5/medium'])
  const rec = records(h.saved)
  expect(rec.length).toBe(1)
  expect(rec[0].reason).toBe('first_turn')
  expect(rec[0].cacheRead).toBe(200)
  expect(rec[0].cacheWrite).toBe(40)
})

test('Jev state holds recent user/assistant text only, without tool output or the current prompt', async ($, on) => {
  const h = setup(on, { enabled: true })
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0)
  const state = h.fetches[0].state
  expect(state.current_request).toBe('CURRENT')
  expect(state.recent_turns.map((m) => m.text)).toEqual(['登入偶爾 401，幫我查原因', '我先看 middleware。', '懷疑是 refresh 併發。要我加 log 嗎？'])
  expect(JSON.stringify(state)).not.toContain('FILE CONTENT')
  expect(h.fetches[0].model).toBe('jev-1.13.0')
})

test('later turns reuse the first rung without calling Jev', async ($, on) => {
  const h = setup(on, { enabled: true, jev: () => ({ status: 200, ok: true, headers: {}, text: jevBody([0.05, 0.85, 0.1, 0]) }) })
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  await $.turn.start({ text: 'second', turnId: 't2' })
  await step($, 't2', 0)
  expect(h.fetches.length).toBe(1)
  expect(h.sent[1].model).toBe('claude-sonnet-5-5')
})

test('a deep request goes to opus with high effort', async ($, on) => {
  const h = setup(on, { enabled: true, jev: () => ({ status: 200, ok: true, headers: {}, text: jevBody([0, 0, 0.1, 0.9]) }) })
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.sent[0].model + '/' + h.sent[0].effort).toBe('claude-opus-5-5/high')
})

test('high risk raises this turn to base with high effort, and only this turn', async ($, on) => {
  const h = setup(on, { enabled: true, jev: () => ({ status: 200, ok: true, headers: {}, text: jevBody([0.9, 0.1, 0, 0], 0.9, 0.9) }) })
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
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
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  const done = step($, 't1', 0)
  await h.clock.advance(1500)
  await done
  await complete($, 't1')
  expect(h.sent[0].model).toBe(OPUS)
  expect(records(h.saved)[0].reason).toBe('jev_failed:timeout')
})

test('rate limiting leaves the request unchanged and records why', async ($, on) => {
  const h = setup(on, { enabled: true, jev: () => ({ status: 429, ok: false, headers: {}, text: '' }) })
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  expect(h.sent[0].model).toBe(OPUS)
  expect(records(h.saved)[0].reason).toBe('jev_failed:http_429')
})

test('without an API key Jev is not called', async ($, on) => {
  const h = setup(on, { enabled: true, key: null })
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0)
  await complete($, 't1')
  expect(h.fetches.length).toBe(0)
  expect(h.sent[0].model).toBe(OPUS)
  expect(records(h.saved)[0].reason).toBe('jev_failed:no_key')
})

test('subagent requests are never changed', async ($, on) => {
  const h = setup(on, { enabled: true })
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0, { agentId: 'a1' })
  expect(h.sent[0].model).toBe(OPUS)
})

test('/somm on and off toggle routing', async ($, on) => {
  const h = setup(on)
  const onReply = await $.command.run({ command: 'somm', args: 'on' })
  expect(onReply.text).toContain('已開啟')
  expect(h.saved.get('somm:enabled')).toBe(true)
  await $.command.run({ command: 'somm', args: 'off' })
  expect(h.saved.get('somm:enabled')).toBe(false)
})

test('the status line shows the model that answered and the session model it replaced', async ($, on) => {
  const h = setup(on, { enabled: true })
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.statuses.at(-1)).toBe('🍷 實際模型 haiku·medium（預設 opus）')
})

test('the status line has no preset note when Jev fails and the session model answers', async ($, on) => {
  const h = setup(on, { enabled: true, jev: () => ({ status: 429, ok: false, headers: {}, text: '' }) })
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.statuses.at(-1)).toBe('🍷 實際模型 opus·medium')
})

test('the status line stays empty while off and clears on /somm off', async ($, on) => {
  const h = setup(on)
  await $.turn.start({ text: 'CURRENT', turnId: 't1' })
  await step($, 't1', 0)
  expect(h.statuses.filter((s) => s !== undefined).length).toBe(0)
  await $.command.run({ command: 'somm', args: 'off' })
  expect(h.statuses.at(-1)).toBe(undefined)
})
