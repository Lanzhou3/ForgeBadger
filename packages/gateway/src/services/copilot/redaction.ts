const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gu;
const OPENFORGE_ATTACH_TOKEN_PATTERN = /\bOPENFORGE_ATTACH_TOKEN=([^\s,;]+)/gu;
const SECRET_KEY_VALUE_PATTERN = /\b(api[_-]?key|token|password|secret|private[_-]?key)\b(\s*[:=]\s*)([^\s,;]+)/giu;
const OPENAI_SECRET_PATTERN = /\bsk-[A-Za-z0-9_-]{6,}\b/gu;
const PRIVATE_KEY_BLOCK_REDACTION_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/giu;
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu;
const UNREDACTED_BEARER_PATTERN = /\bBearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]+/iu;
const UNREDACTED_OPENFORGE_ATTACH_TOKEN_PATTERN = /\bOPENFORGE_ATTACH_TOKEN=(?!\[REDACTED\])([^\s,;]+)/iu;
const UNREDACTED_SECRET_KEY_VALUE_PATTERN = /\b(api[_-]?key|token|password|secret|private[_-]?key)\b(\s*[:=]\s*)(?!\[REDACTED\])([^\s,;]+)/iu;
const UNREDACTED_OPENAI_SECRET_PATTERN = /\bsk-(?!\[REDACTED\])[A-Za-z0-9_-]{6,}\b/iu;
const THINKING_BLOCK_PATTERN = /<think\b[^>]*>[\s\S]*?<\/think>/giu;
const UNFINISHED_THINKING_BLOCK_PATTERN = /<think\b[^>]*>[\s\S]*$/iu;

export function redactCopilotText(text: string): string {
  return text
    .replace(PRIVATE_KEY_BLOCK_REDACTION_PATTERN, "[REDACTED PRIVATE KEY]")
    .replace(OPENFORGE_ATTACH_TOKEN_PATTERN, "OPENFORGE_ATTACH_TOKEN=[REDACTED]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(OPENAI_SECRET_PATTERN, "sk-[REDACTED]")
    .replace(SECRET_KEY_VALUE_PATTERN, "$1$2[REDACTED]");
}

export function stripCopilotThinkingBlocks(text: string): string {
  return text
    .replace(THINKING_BLOCK_PATTERN, "")
    .replace(UNFINISHED_THINKING_BLOCK_PATTERN, "")
    .replace(/[ \t]*\n[ \t]*\n[ \t]*/gu, "\n")
    .trim();
}

export function sanitizeCopilotAssistantText(text: string): string {
  return redactCopilotText(stripCopilotThinkingBlocks(text)).trim();
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

export function hasBlockedCopilotSensitiveOutput(text: string): boolean {
  return [
    PRIVATE_KEY_BLOCK_PATTERN,
    UNREDACTED_BEARER_PATTERN,
    UNREDACTED_OPENFORGE_ATTACH_TOKEN_PATTERN,
    UNREDACTED_SECRET_KEY_VALUE_PATTERN,
    UNREDACTED_OPENAI_SECRET_PATTERN
  ].some((pattern) => pattern.test(text));
}

export function hasCopilotPrivateKeyMaterial(text: string): boolean {
  return PRIVATE_KEY_BLOCK_PATTERN.test(text);
}

function isSensitiveKey(key: string): boolean {
  return /api[_-]?key|token|password|secret|private[_-]?key/iu.test(key);
}
