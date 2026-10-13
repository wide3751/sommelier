import { expect, mock, test } from 'claude-code/testing'

// Records the model/effort each turn.step request was sent with.
function stubSteps(on, sent: Array<{ turnId: string; index: number; model: string; effort?: string; agentId?: string }>) {
  on('turn.step', async function* ($, e) {
    sent.push({ turnId: e.turnId, index: e.index, model: e.model, effort: e.effort, agentId: e.agentId })
    return {
      turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: { model: e.model, input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
    }
  })
}

function stubStore(on) {
  const saved = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  return saved
}

async function drain(stream) {
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  return step.value
}

test('proto applies the same rung to every main step of a turn and leaves subagents alone', async ($, on) => {
  mock.clock(on)
  stubStore(on)
  const sent = []
  stubSteps(on, sent)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.command.run({ command: 'somm', args: 'proto sonnet high' })
  await $.turn.start({ text: 'list files', turnId: 't1' })
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 }))
  await drain($.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', effort: 'medium', messageCount: 3 }))
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, agentId: 'a1' }))

  expect(sent).toEqual([
    { turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'high', agentId: undefined },
    { turnId: 't1', index: 1, model: 'claude-sonnet-5-5', effort: 'high', agentId: undefined },
    { turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', agentId: 'a1' },
  ])
})

test('effort-only proto keeps the requested model', async ($, on) => {
  mock.clock(on)
  stubStore(on)
  const sent = []
  stubSteps(on, sent)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))

  await $.command.run({ command: 'somm', args: 'proto keep high' })
  await $.turn.start({ text: 'think hard', turnId: 't1' })
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 }))

  expect(sent[0].model).toBe('claude-opus-5-5')
  expect(sent[0].effort).toBe('high')
})

test('each turn keeps the judgement made at its own turn.start', async ($, on) => {
  mock.clock(on)
  stubStore(on)
  const sent = []
  stubSteps(on, sent)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))

  await $.command.run({ command: 'somm', args: 'proto sonnet' })
  await $.turn.start({ text: 'first', turnId: 'A' })
  await $.command.run({ command: 'somm', args: 'proto haiku' })
  await $.turn.start({ text: 'queued', turnId: 'B' })
  await drain($.turn.step({ turnId: 'A', index: 0, model: 'claude-opus-5-5', messageCount: 1 }))
  await drain($.turn.step({ turnId: 'B', index: 0, model: 'claude-opus-5-5', messageCount: 1 }))

  expect(sent.map((s) => s.turnId + ':' + s.model)).toEqual(['A:claude-sonnet-5-5', 'B:claude-haiku-5-5'])
})

test('a judgement slower than the 3 s cap leaves the request unchanged', async ($, on) => {
  const clock = mock.clock(on)
  stubStore(on)
  const sent = []
  stubSteps(on, sent)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))

  await $.command.run({ command: 'somm', args: 'proto sonnet keep 5000' })
  await $.turn.start({ text: 'slow', turnId: 't1' })
  const done = drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }))
  await clock.advance(3000)
  await done

  expect(sent[0].model).toBe('claude-opus-5-5')
})

test('a judgement within the cap is applied to the first request', async ($, on) => {
  const clock = mock.clock(on)
  stubStore(on)
  const sent = []
  stubSteps(on, sent)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))

  await $.command.run({ command: 'somm', args: 'proto sonnet keep 2000' })
  await $.turn.start({ text: 'judged', turnId: 't1' })
  const done = drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }))
  await clock.advance(2000)
  await done

  expect(sent[0].model).toBe('claude-sonnet-5-5')
})
