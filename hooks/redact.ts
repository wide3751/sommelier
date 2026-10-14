// Masks common secret formats before any text leaves the machine (pure).
// The list follows the spec's built-in patterns; it can only grow.

export const REDACTED = '[REDACTED]'

const PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*KEY-----|$)/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bpassword\s*[=:]\s*\S+/gi,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bxox[bp]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b[0-9a-fA-F]{32,}\b/g,
]

export function redact(text) {
  let out = text
  for (const p of PATTERNS) out = out.replace(p, REDACTED)
  return out
}
