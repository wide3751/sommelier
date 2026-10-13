// sommelier hooks module.
//
// Ticket 01 spike: `/somm proto` forces a fixed model and/or effort on every
// main-conversation request and records what was sent and what the API
// reported, so the platform assumptions in docs/spec.md can be measured in a
// real session. Routing logic replaces this from ticket 04 on.

const COMMAND = 'somm'
const FALLBACK_COMMAND = 'sommelier'
const PROTO_KEY = 'somm:proto'
const LOG_KEY = 'somm:proto:log'
const LOG_CAP = 300
const WAIT_CAP_MS = 3000
const DUMP_FILE = 'somm-proto-log.jsonl'
// turn.step rejects aliases ("sonnet" → unrecognized_model), so send full IDs.
const MODEL_IDS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// Per-turn judgement started at turn.start, keyed by turnId so a queued
// prompt never picks up another turn's result.
const pending = new Map()
// The rung already applied to a turn, so every step of the turn matches.
const applied = new Map()
let lastShown = ''

async function readProto($) {
  return (await $.store.get(PROTO_KEY)) ?? null
}

async function appendLog($, entry) {
  const log = (await $.store.get(LOG_KEY)) ?? []
  log.push(entry)
  await $.store.set(LOG_KEY, log.slice(-LOG_CAP))
}

// Stands in for the Jev call: optionally waits, then answers with the proto rung.
async function fakeJudge($, proto) {
  try {
    if (proto.delayMs > 0) await $.clock.sleep(proto.delayMs)
    return { model: proto.model, effort: proto.effort, decidedAt: await $.clock.now() }
  } catch (err) {
    return { error: String(err) }
  }
}

// Resolves to the judgement, or null once WAIT_CAP_MS has passed.
async function waitCapped($, promise) {
  const ac = new AbortController()
  const cap = $.clock.sleep(WAIT_CAP_MS, { signal: ac.signal }).then(() => null, () => null)
  const result = await Promise.race([promise, cap])
  ac.abort()
  return result
}

function describe(proto) {
  if (!proto) return 'off'
  return (proto.model ?? 'keep model') + ' · ' + (proto.effort ?? 'keep effort') + (proto.delayMs ? ' · delay ' + proto.delayMs + 'ms' : '')
}

function parseProto(args) {
  // proto <model|keep> [effort|keep] [delayMs] | proto off
  const [model, effort, delay] = args
  if (!model) return { error: 'usage: /somm proto <haiku|sonnet|opus|keep> [effort|keep] [delayMs] | off | log [n] | dump | clear' }
  if (model !== 'keep' && !MODEL_IDS[model] && !model.startsWith('claude-')) return { error: 'unknown model: ' + model }
  if (effort && effort !== 'keep' && !EFFORTS.includes(effort)) return { error: 'unknown effort: ' + effort }
  const delayMs = delay ? Number(delay) : 0
  if (!Number.isFinite(delayMs) || delayMs < 0) return { error: 'bad delay: ' + delay }
  return {
    proto: {
      model: model === 'keep' ? null : MODEL_IDS[model] ?? model,
      effort: !effort || effort === 'keep' ? null : effort,
      delayMs,
    },
  }
}

function formatLog(entries) {
  return entries
    .map((x) =>
      x.kind === 'step'
        ? [x.turnId.slice(0, 6), '#' + x.index, x.agentId ? 'sub' : 'main', 'req ' + x.reqModel + '/' + (x.reqEffort ?? '-'),
            'sent ' + x.sentModel + '/' + (x.sentEffort ?? '-'), 'ans ' + (x.answeredModel ?? '-'),
            'in ' + x.input, 'read ' + x.cacheRead, 'write ' + x.cacheWrite, 'wait ' + x.waitedMs + 'ms',
            x.judgeError ? 'ERR ' + x.judgeError : ''].join(' ')
        : [x.turnId.slice(0, 6), x.kind, x.note ?? ''].join(' '),
    )
    .join('\n')
}

async function runCommand($, e) {
  const args = (e.args || '').trim().split(/\s+/).filter(Boolean)
  if (args[0] !== 'proto') return { text: 'sommelier is not implemented yet (args: ' + (e.args || '-') + ')' }
  const sub = args[1]
  if (sub === 'off') {
    await $.store.set(PROTO_KEY, null)
    lastShown = ''
    $.ui.invalidate('ui.render')
    return { text: 'proto off' }
  }
  if (sub === 'log') {
    const n = Number(args[2] ?? 20)
    const log = (await $.store.get(LOG_KEY)) ?? []
    return { text: formatLog(log.slice(-n)) || '(empty)' }
  }
  if (sub === 'dump') {
    const log = (await $.store.get(LOG_KEY)) ?? []
    await $.fs.write(DUMP_FILE, log.map((x) => JSON.stringify(x)).join('\n') + '\n')
    return { text: 'wrote ' + log.length + ' entries to ' + DUMP_FILE }
  }
  if (sub === 'clear') {
    await $.store.set(LOG_KEY, [])
    return { text: 'log cleared' }
  }
  if (sub === undefined || sub === 'status') return { text: 'proto: ' + describe(await readProto($)) }
  const parsed = parseProto(args.slice(1))
  if (parsed.error) return { text: parsed.error }
  await $.store.set(PROTO_KEY, parsed.proto)
  return { text: 'proto: ' + describe(parsed.proto) }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'sommelier: on|off|status|export|config (proto: spike controls)',
        argumentHint: '[proto <model|keep> [effort|keep] [delayMs] | proto off|log|dump|clear]',
        immediate: true,
      })
    } catch {
      // /somm is taken: register the long name instead and say so.
      await $.command.register({
        name: FALLBACK_COMMAND,
        description: 'sommelier: on|off|status|export|config (proto: spike controls)',
        argumentHint: '[proto <model|keep> [effort|keep] [delayMs] | proto off|log|dump|clear]',
        immediate: true,
      })
      $.ui.toast('/somm is taken; use /sommelier instead')
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => runCommand($, e))
  on('command.run', { command: FALLBACK_COMMAND }, async ($, e) => runCommand($, e))

  on('turn.start', async ($, e, next) => {
    const proto = await readProto($)
    if (proto && e.text !== '') {
      pending.set(e.turnId, { promise: fakeJudge($, proto), startedAt: await $.clock.now() })
    }
    await appendLog($, { kind: 'start', turnId: e.turnId, at: await $.clock.now(), note: 'textLen=' + e.text.length + ' proto=' + describe(proto) })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    let rung = null
    let waitedMs = 0
    let judgeError = null
    if (!e.agentId) {
      if (applied.has(e.turnId)) {
        rung = applied.get(e.turnId)
      } else {
        const p = pending.get(e.turnId)
        if (p) {
          const t0 = await $.clock.now()
          const judged = await waitCapped($, p.promise)
          waitedMs = (await $.clock.now()) - t0
          if (judged && judged.error) judgeError = judged.error
          rung = judged && !judged.error ? judged : null
        } else {
          // A turn without typed text (continuation) or started before proto was set.
          const proto = await readProto($)
          rung = proto ? { model: proto.model, effort: proto.effort } : null
        }
        applied.set(e.turnId, rung)
      }
    }
    const out = rung ? { ...e, ...(rung.model ? { model: rung.model } : {}), ...(rung.effort ? { effort: rung.effort } : {}) } : e
    if (!e.agentId && rung) {
      lastShown = out.model + '·' + (out.effort ?? '-')
      $.ui.invalidate('ui.render')
    }
    const result = yield* next(out)
    const u = result.usage
    await appendLog($, {
      kind: 'step', turnId: e.turnId, index: e.index, agentId: e.agentId ?? null,
      reqModel: e.model, reqEffort: e.effort ?? null, sentModel: out.model, sentEffort: out.effort ?? null,
      answeredModel: u ? u.model : null, input: u ? u.input_tokens : null, output: u ? u.output_tokens : null,
      cacheRead: u ? u.cache_read_input_tokens : null, cacheWrite: u ? u.cache_creation_input_tokens : null,
      stopReason: result.stopReason, waitedMs, judgeError, at: await $.clock.now(),
    })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    pending.delete(e.turnId)
    applied.delete(e.turnId)
    if (!e.agentId) {
      await appendLog($, { kind: 'complete', turnId: e.turnId, at: await $.clock.now(), note: 'reason=' + e.reason + ' ms=' + e.durationMs })
    }
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!lastShown) return next(e)
    return next({ ...e, props: { ...e.props, suffix: ' · 🍷 ' + lastShown } })
  })
}
