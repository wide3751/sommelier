// Masks common secret formats before any text leaves the machine (pure).
// The list follows the spec's built-in patterns; it can only grow.

export const REDACTED = '[REDACTED]'

const PATTERNS = [
  // PEM keys and PGP "PRIVATE KEY BLOCK"s; an unterminated block is masked to the end.
  /-----BEGIN [A-Z0-9 ]*KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*KEY(?: BLOCK)?-----|$)/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  // Any key ending in "password" (DB_PASSWORD, "password"), with a quoted or bare value.
  /[\w-]*password["']?\s*[=:]\s*(?:"[^"\n]*"|'[^'\n]*'|\S+)/gi,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bxox[bp]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b(?:0x)?[0-9a-fA-F]{32,}\b/g,
]

export function redact(text) {
  let out = text
  for (const p of PATTERNS) out = out.replace(p, REDACTED)
  return out
}
