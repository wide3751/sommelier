// Builds the `state` sent to Jev from the session transcript (pure).
// Only user and assistant text: tool calls and tool results are dropped,
// because unrelated content lowers Jev's accuracy (context rot).
// Every text is redacted before it is cut, so a secret is never half kept.

import { redact } from './redact.ts'

export const RECENT_TURNS = 3
export const MAX_CHARS = 500

// Keep the ending: an assistant reply usually ends with its question or plan.
export function keepEnd(text, max = MAX_CHARS) {
  return text.length <= max ? text : '…' + text.slice(text.length - max)
}

// messages: $.session.messages() — oldest first, possibly including the
// prompt being judged as the last user message.
export function buildJevState(messages, currentText, opts = {}) {
  const turns = opts.turns ?? RECENT_TURNS
  const max = opts.maxChars ?? MAX_CHARS
  const texts = messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && m.text && !(m.toolResults && m.toolResults.length),
  )
  const last = texts[texts.length - 1]
  const history = last && last.role === 'user' && last.text.trim() === currentText.trim() ? texts.slice(0, -1) : texts
  const recent = history.slice(-turns * 2).map((m) => ({ role: m.role, text: keepEnd(redact(m.text), max) }))
  return { current_request: keepEnd(redact(currentText), max * 4), recent_turns: recent }
}
