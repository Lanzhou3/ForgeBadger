/**
 * Shared secret-shape redaction used when surfacing upstream error messages to
 * API clients. We never echo `sk-...` keys, `Bearer` tokens, env-injected
 * secrets, or API-key assignments into public error envelopes.
 */
export function redactSensitiveErrorMessage(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{6,}/gi, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b((?:FORGEBADGER|OPENFORGE)_(?:MASTER_KEY|JWT_SECRET|ATTACH_TOKEN|API_KEY|TOKEN))\s*=\s*[^\s]+/gi, "$1=[REDACTED]")
    .replace(/FORGEBADGER_ATTACH_TOKEN=[^\s]+/gi, "FORGEBADGER_ATTACH_TOKEN=[REDACTED]")
    .replace(/OPENFORGE_ATTACH_TOKEN=[^\s]+/gi, "OPENFORGE_ATTACH_TOKEN=[REDACTED]")
    .replace(/api[_-]?key[=:]\s*[^\s]+/gi, "api_key=[REDACTED]")
    .replace(/\bANTHROPIC_API_KEY\b[=:][^\s]+/gi, "ANTHROPIC_API_KEY=[REDACTED]")
    .replace(/\bOPENAI_API_KEY\b[=:][^\s]+/gi, "OPENAI_API_KEY=[REDACTED]");
}

/** Redact arbitrary sensitive-shaped content (config file bodies, previews). */
export function redactSensitiveContent(content: string): string {
  return content
    .replace(/sk-[A-Za-z0-9_-]{6,}/gi, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b((?:FORGEBADGER|OPENFORGE)_(?:MASTER_KEY|JWT_SECRET|ATTACH_TOKEN|API_KEY|TOKEN))\s*=\s*["']?[^"'\s,}]+/gi, "$1=[REDACTED]")
    .replace(/api[_-]?key\s*[:=]\s*["']?[^"'\s,}]+/gi, "api_key=[REDACTED]")
    .replace(/\b(?:ANTHROPIC|OPENAI|DEEPSEEK)_API_KEY\b\s*[:=]\s*["']?[^"'\s,}]+/gi, "$1=[REDACTED]");
}
