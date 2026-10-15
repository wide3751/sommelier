import { expect, mock, test } from 'claude-code/testing'

// #27 skill 提示: Jev picks a skill beside the rung, and a hint goes with the prompt.

const OPUS = 'claude-opus-5-5'
const HINT_TDD = '[sommelier] 自動判斷這個請求可能適合 skill「mattpocock-skills:tdd」（可能有誤）。適用的話先用 Skill 工具載入；不適用就忽略這段，也不用提到它。'

const LISTED = ['mattpocock-skills:tdd', 'grilling', 'pptx', 'no-description']
const COMMANDS = [
  { name: 'mattpocock-skills:tdd', description: 'Test-driven development. Use when the user wants to build test-first.', source: 'plugin' },
  { name: 'grilling', description: 'Grill the user about a plan. token sk-abcdefghijklmnopqrstuvwx', source: 'user' },
  { name: 'pptx', description: 'Create slide decks.', source: 'plugin' },
  { name: 'no-description', description: '', source: 'user' },
  { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
]

function jevBody(opts: { depth?: number[]; newTask?: number; needs?: number; skills?: Record<string, number> } = {}) {
  const d = opts.depth ?? [0.05, 0.9, 0.05, 0]
  const answers: any = {
    depth: { type: 'score', probabilities: { 0: d[0], 1: d[1], 2: d[2], 3: d[3] } },
    new_task: { type: 'noul', noul: opts.newTask ?? 0.9 },
    high_risk: { type: 'noul', noul: 0.05 },
  }
  if (opts.needs !== undefined) {
    answers.needs_skill = { type: 'noul', noul: opts.needs }
    answers.skill = { type: 'choice', probabilities: opts.skills ?? {} }
  }
  return JSON.stringify({ model: 'jev-1.13.0', answers })
}

const ok = (o = {}) => ({ status: 200, ok: true, headers: {}, text: jevBody(o) })
const TDD = { needs: 0.8, skills: { 'mattpocock-skills:tdd': 0.9, grilling: 0.05, pptx: 0.05 } }

function setup(
  on,
  opts: {
    jev?: (body: any, i: number) => any; config?: any | null; skillConsent?: boolean | null; consent?: boolean
    answer?: string | null; listed?: string[]; enabled?: boolean
  } = {},
) {
  const clock = mock.clock(on)
  const saved = new Map<string, unknown>()
  if (opts.enabled !== undefined) saved.set('somm:enabled', opts.enabled)
  if (opts.consent !== false) saved.set('somm:consent', true)
  if (opts.skillConsent !== null) saved.set('somm:consent:skills', opts.skillConsent ?? true)
  // Skill hints are off by default; most tests here are about them being on.
  if (opts.config !== null) saved.set('somm:config', { skills: 'on', ...opts.config })
  const asked: string[] = []
  on('tool.call', ($, e) => {
    const q = e.questions[0]
    asked.push(q.question)
    if (opts.answer === null) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q.question]: opts.answer ?? q.options[0].label } } }
  })
  on('session.root', () => ({ value: '/work/repo' }))
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
  mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
  on('session.id', () => ({ value: 'sess1' }))
  on('session.model', () => ({ value: OPUS }))
  on('session.messages', () => ({ value: [] }))
  on('session.usage', ($, e) => {
    const breakdown = e && e.breakdown
      ? { skills: { totalSkills: 4, includedSkills: 4, tokens: 100, skillFrontmatter: (opts.listed ?? LISTED).map((name) => ({ name, source: 'plugin', tokens: 10 })) } }
      : undefined
    return { value: { startedAt: 0, context: { tokens: 0, window: 1000000, breakdown }, rateLimits: [] } }
  })
  on('command.list', () => ({ value: COMMANDS }))
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', ($, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  on('classic.SessionStart', () => ({}))
  on('classic.PreModelSwitch', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  const fetches: any[] = []
  on('http.fetch', async ($, e) => {
    const body = JSON.parse(e.init.body)
    fetches.push(body)
    return { value: opts.jev ? await opts.jev(body, fetches.length - 1) : ok(TDD) }
  })
  const sent: any[] = []
  on('turn.step', async function* ($, e) {
    sent.push({ model: e.model, effort: e.effort })
    return {
      turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: { model: e.model, input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
    }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const suffixes: (string | undefined)[] = []
  on('ui.render', ($, e) => {
    suffixes.push(e.props.suffix)
    const { Text } = $.ui.resolve(e)
    return Text({ children: e.props.message })
  })
  return { clock, saved, fetches, contexts, sent, asked, toasts, suffixes }
}

async function drain(stream) {
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  return step.value
}

// A prompt as the user types it, then its turn; `during` runs inside the turn.
async function typed($, turnId: string, text: string, during: (() => Promise<void>) | null = null) {
  const entered = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  if (entered.drop) return entered
  await $.turn.start({ text: entered.text, turnId })
  await drain($.turn.step({ turnId, index: 0, model: OPUS, effort: 'medium', messageCount: 5 }))
  if (during) await during()
  await $.turn.complete({ turnId, answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', usage: null })
  return entered
}

function records(saved: Map<string, unknown>) {
  return [...saved.entries()].filter(([k]) => k.startsWith('somm:rec:')).sort().map(([, v]) => v as any)
}

// The suffix sommelier adds to the spinner, or undefined when it adds none.
async function spinner($, h) {
  await $.ui.render({ surface: 'terminal', component: 'Spinner', requestId: 'a1', props: { message: 'Thinking' } })
  return h.suffixes.at(-1)
}

test('the skill questions go in the same Jev request, one option per described candidate', async ($, on) => {
  const h = setup(on)
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(h.fetches.length).toBe(1)
  const q = h.fetches[0].questions
  expect(Object.keys(q)).toEqual(['depth', 'new_task', 'high_risk', 'needs_skill', 'skill'])
  expect(q.skill.type).toBe('choice')
  // Listed but undescribed is out; a command that is not in the listing is too.
  expect(Object.keys(q.skill.criteria)).toEqual(['grilling', 'mattpocock-skills:tdd', 'pptx'])
})

test('a skill that clears both thresholds is hinted beside the prompt', async ($, on) => {
  const h = setup(on)
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(h.contexts).toEqual([[HINT_TDD]])
})

test('only one threshold cleared gives no hint', async ($, on) => {
  const h = setup(on, {
    jev: (b, i) => ok(i === 0 ? { needs: 0.2, skills: { 'mattpocock-skills:tdd': 0.9, grilling: 0.1 } } : { needs: 0.9, skills: { 'mattpocock-skills:tdd': 0.45, grilling: 0.4, pptx: 0.15 } }),
  })
  await typed($, 't1', '幫 parseDate 加上時區參數')
  await typed($, 't2', '另外把 README 的標題改一下')
  expect(h.contexts).toEqual([undefined, undefined])
})

test('the same skill is hinted once per topic, and again on a new topic', async ($, on) => {
  const h = setup(on, {
    jev: (b, i) => ok({ ...TDD, newTask: [0.9, 0.1, 0.95][i] }),
  })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  await typed($, 't2', '再補一個跨日的測試案例吧')
  await typed($, 't3', '另外幫 formatMoney 加上幣別，也先寫測試')
  expect(h.contexts).toEqual([[HINT_TDD], undefined, [HINT_TDD]])
})

test('/clear lets a hinted skill be hinted again', async ($, on) => {
  const h = setup(on, { jev: () => ok({ ...TDD, newTask: 0.1 }) })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  await $.classic.SessionStart({ source: 'clear' })
  await typed($, 't2', '幫 parseDate 加上時區參數，先寫測試')
  expect(h.contexts).toEqual([[HINT_TDD], [HINT_TDD]])
})

test('a hint never changes the rung', async ($, on) => {
  const h = setup(on, { jev: () => ok({ depth: [0.9, 0.08, 0.02, 0], ...TDD }) })
  await typed($, 't1', '看一下 package.json 的 version')
  expect(h.contexts).toEqual([[HINT_TDD]])
  expect(h.sent[0].model).toBe('claude-haiku-5-5')
})

test('skill hints are off by default: no skill questions, no consent asked, routing goes on', async ($, on) => {
  const h = setup(on, { config: null, skillConsent: null })
  expect((await $.command.run({ command: 'somm', args: 'config' })).text).toContain('skills off')
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(Object.keys(h.fetches[0].questions)).toEqual(['depth', 'new_task', 'high_risk'])
  expect(h.contexts).toEqual([undefined])
  expect(h.asked).toEqual([])
  expect((await $.command.run({ command: 'somm', args: 'config skills on' })).text).toContain('skills on')
})

test('skills off asks no skill questions and gives no hint, routing goes on', async ($, on) => {
  const h = setup(on)
  expect((await $.command.run({ command: 'somm', args: 'config skills off' })).text).toContain('skills off')
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(Object.keys(h.fetches[0].questions)).toEqual(['depth', 'new_task', 'high_risk'])
  expect(h.contexts).toEqual([undefined])
  expect(h.sent[0].model).toBe('claude-sonnet-5-5')
})

test('turns that are not sent to Jev get no hint', async ($, on) => {
  const h = setup(on)
  await typed($, 't1', '好')
  await typed($, 't2', '/review 這個分支')
  await typed($, 't3', 'ultrathink 這個 bug 怎麼修')
  await typed($, 't4', 'somm:opus 幫 parseDate 加上時區參數')
  expect(h.fetches.length).toBe(0)
  expect(h.contexts).toEqual([undefined, undefined, undefined, undefined])
})

test('/somm off and a stopped project give no hint', async ($, on) => {
  const h = setup(on, { enabled: false })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  await $.command.run({ command: 'somm', args: 'on' })
  await $.command.run({ command: 'somm', args: 'off --project' })
  await typed($, 't2', '幫 parseDate 加上時區參數，先寫測試')
  expect(h.fetches.length).toBe(0)
  expect(h.contexts).toEqual([undefined, undefined])
})

test('a Jev failure gives no hint and keeps routing as before', async ($, on) => {
  const h = setup(on, { jev: () => ({ status: 500, ok: false, headers: {}, text: '' }) })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(h.contexts).toEqual([undefined])
  expect(records(h.saved)[0].reason).toBe('jev_failed:http_500')
})

test('Jev refusing the skill questions is asked again without them', async ($, on) => {
  const h = setup(on, { jev: (b) => (b.questions.skill ? { status: 422, ok: false, headers: {}, text: '' } : ok()) })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(h.fetches.length).toBe(2)
  expect(h.contexts).toEqual([undefined])
  expect(records(h.saved)[0].reason).toBe('downgrade')
})

test('the allow list narrows the candidates, and the exclude list wins over it', async ($, on) => {
  const h = setup(on)
  await $.command.run({ command: 'somm', args: 'config skills-allow mattpocock-skills:tdd,grilling,pptx' })
  await $.command.run({ command: 'somm', args: 'config skills-exclude pptx' })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(Object.keys(h.fetches[0].questions.skill.criteria)).toEqual(['grilling', 'mattpocock-skills:tdd'])
  const list = (await $.command.run({ command: 'somm', args: 'config' })).text
  expect(list).toContain('skills on')
  expect(list).toContain('skills-allow mattpocock-skills:tdd,grilling,pptx')
  expect(list).toContain('skills-exclude pptx')
  await $.command.run({ command: 'somm', args: 'config skills-allow none' })
  expect((await $.command.run({ command: 'somm', args: 'config' })).text).toContain('skills-allow （全部）')
})

test('fewer than two candidates sends no skill questions, and asks nothing about them', async ($, on) => {
  const h = setup(on, { config: { skillsAllow: ['grilling'] }, skillConsent: null })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(Object.keys(h.fetches[0].questions)).toEqual(['depth', 'new_task', 'high_risk'])
  expect(h.asked.length).toBe(0)
})

test('secrets in skill descriptions are redacted before they are sent', async ($, on) => {
  const h = setup(on)
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  const grilling = h.fetches[0].questions.skill.criteria.grilling
  expect(grilling).toContain('[REDACTED]')
  expect(grilling).not.toContain('sk-abc')
})

test('a new install is asked once, and the question leaves skills out', async ($, on) => {
  const h = setup(on, { consent: false, skillConsent: null, config: null })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(h.asked.length).toBe(1)
  expect(h.asked[0]).not.toContain('skill')
  expect(h.saved.get('somm:consent:skills')).toBe(undefined)
})

test('turning skill hints on asks about skill descriptions once, apart from the first question', async ($, on) => {
  const h = setup(on, { consent: false, skillConsent: null })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  await typed($, 't2', '另外幫 formatMoney 加上幣別，也先寫測試')
  expect(h.asked.length).toBe(2)
  expect(h.asked[0]).not.toContain('skill')
  expect(h.asked[1]).toContain('skill 的名稱與描述')
  expect(h.contexts[0]).toEqual([HINT_TDD])
})

test('those who agreed before are asked about skill hints once', async ($, on) => {
  const h = setup(on, { skillConsent: null })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  await typed($, 't2', '另外幫 formatMoney 加上幣別，也先寫測試')
  expect(h.asked.length).toBe(1)
  expect(h.asked[0]).toContain('skill 提示')
  expect(h.saved.get('somm:consent:skills')).toBe(true)
})

test('declining skill hints turns skills off only', async ($, on) => {
  const h = setup(on, { skillConsent: null, answer: '不同意，關閉 skill 提示' })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(Object.keys(h.fetches[0].questions)).toEqual(['depth', 'new_task', 'high_risk'])
  expect(h.contexts).toEqual([undefined])
  expect(h.sent[0].model).toBe('claude-sonnet-5-5')
  expect((h.saved.get('somm:config') as any).skills).toBe('off')
  expect(h.saved.get('somm:enabled')).not.toBe(false)
})

test('dismissing the skill question sends no skill data and asks again next time', async ($, on) => {
  const h = setup(on, { skillConsent: null, answer: null })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  await typed($, 't2', '另外幫 formatMoney 加上幣別，也先寫測試')
  expect(h.asked.length).toBe(2)
  expect(h.fetches.map((f) => Object.keys(f.questions).length)).toEqual([3, 3])
})

test('the spinner names the hinted skill, unless the spinner is off', async ($, on) => {
  const h = setup(on)
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試')
  expect(await spinner($, h)).toContain('💡tdd')
  await $.command.run({ command: 'somm', args: 'config spinner off' })
  expect(await spinner($, h)).toBeUndefined()
})

test('the log records the hint, both probabilities and whether Claude took it up', async ($, on) => {
  const h = setup(on, { jev: (b, i) => ok({ ...TDD, newTask: 0.95 }) })
  await typed($, 't1', '幫 parseDate 加上時區參數，先寫測試', async () => {
    await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'skill body' })
  })
  await h.clock.advance(1000)
  await typed($, 't2', '另外幫 formatMoney 加上幣別，也先寫測試')
  const [r1, r2] = records(h.saved)
  expect(r1.skillHint).toBe('mattpocock-skills:tdd')
  expect(r1.needsSkill).toBe(0.8)
  expect(r1.skillTopProb).toBe(0.9)
  expect(r1.skillAdopted).toBe(true)
  expect(r2.skillAdopted).toBe(false)
  const log = (await $.command.run({ command: 'somm', args: 'log 2' })).text
  expect(log).toContain('💡mattpocock-skills:tdd（採用）')
  expect(log).toContain('💡mattpocock-skills:tdd（未採用）')
  expect(log).toContain('P=0.80/0.90')
})
