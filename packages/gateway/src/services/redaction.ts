const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gu;
const attachTokenPattern = /\bOPENFORGE_ATTACH_TOKEN=([^\s,;]+)/gu;
const secretKeyValuePattern = /\b(api[_-]?key|token|password|secret|private[_-]?key)\b(\s*[:=]\s*)([^\s,;]+)/giu;
const openAiSecretPattern = /\bsk-[A-Za-z0-9_-]{6,}\b/gu;
const privateKeyPattern = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/giu;
const sensitiveKeyPattern = /api[_-]?key|token|password|secret|private[_-]?key/iu;

/** Shared bounded redaction for integration, audit, and projection summaries. */
export function redactText(text: string): string {
  return text
    .replace(privateKeyPattern, "[REDACTED PRIVATE KEY]")
    .replace(attachTokenPattern, "OPENFORGE_ATTACH_TOKEN=[REDACTED]")
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(openAiSecretPattern, "sk-[REDACTED]")
    .replace(secretKeyValuePattern, "$1$2[REDACTED]");
}

/** Recursively redact secrets before a cross-boundary payload is persisted or logged. */
export function redactPayload(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactPayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactPayload(item)
  ]));
}
