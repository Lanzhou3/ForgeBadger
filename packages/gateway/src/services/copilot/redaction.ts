const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gu;
const OPENFORGE_ATTACH_TOKEN_PATTERN = /\bOPENFORGE_ATTACH_TOKEN=([^\s,;]+)/gu;
const SECRET_KEY_VALUE_PATTERN = /\b(api[_-]?key|token|password|secret|private[_-]?key)\b(\s*[:=]\s*)([^\s,;]+)/giu;
const OPENAI_SECRET_PATTERN = /\bsk-[A-Za-z0-9_-]{6,}\b/gu;

export function redactCopilotText(text: string): string {
  return text
    .replace(OPENFORGE_ATTACH_TOKEN_PATTERN, "OPENFORGE_ATTACH_TOKEN=[REDACTED]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(OPENAI_SECRET_PATTERN, "sk-[REDACTED]")
    .replace(SECRET_KEY_VALUE_PATTERN, "$1$2[REDACTED]");
}

export function redactCopilotPayload(value: unknown): unknown {
  if (typeof value === "string") return redactCopilotText(value);
  if (Array.isArray(value)) return value.map((item) => redactCopilotPayload(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? "[REDACTED]" : redactCopilotPayload(item)
    ])
  );
}

function isSensitiveKey(key: string): boolean {
  return /api[_-]?key|token|password|secret|private[_-]?key/iu.test(key);
}
