/**
 * Redaction helpers for the Copilot agent harness.
 *
 * We never surface provider secrets, credential material, or token-shaped
 * strings into the model context, the conversation log, logs, or the public
 * API. Covers provider credential assignments, token shapes, and JSON fields.
 */
/** Redact a provider error message before it reaches the public envelope. */
export function redactAgentErrorMessage(message: string): string {
  return redactAgentText(message);
}

/**
 * Redact an arbitrary value's stringified form before it is written to the
 * conversation log, returned to the model as tool output, or persisted. JSON
 * is re-encoded so structure survives while secret-shaped substrings are
 * scrubbed.
 */
export function redactAgentValue(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json === undefined) return value;
  return redactStructuredValue(JSON.parse(json) as unknown);
}

/** Redact a single text payload (model context, summaries). */
export function redactAgentText(text: string): string {
  return redactAgentTextInternal(text, false);
}

function redactAgentTextInternal(text: string, preserveCodeReferences: boolean): string {
  const quotedKeys = text.replace(
    /(["'])([A-Za-z][A-Za-z0-9_-]*)\1(\s*:\s*)(["'])(?:\\.|(?!\4)[^\\\r\n])*\4/g,
    (match, keyQuote: string, key: string, separator: string, valueQuote: string) =>
      isCredentialField(key) ? `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[REDACTED]${valueQuote}` : match
  ).replace(
    /\b([A-Za-z][A-Za-z0-9_-]*)(\s*[:=]\s*)(["'])(?:\\.|(?!\3)[^\\\r\n])*\3/g,
    (match, key: string, separator: string, quote: string) =>
      isCredentialField(key) && (!preserveCodeReferences || key === key.toUpperCase() || separator.includes(":"))
        ? `${key}${separator}${quote}[REDACTED]${quote}` : match
  );
  const openQuote = /(["']?)(?<![A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_-]*)\1(\s*[:=]\s*)(["'])([^\r\n"']*)$/gm;
  let boundedText = quotedKeys;
  for (const match of quotedKeys.matchAll(openQuote)) {
    if (isCredentialField(match[2]!)) {
      boundedText = `${quotedKeys.slice(0, match.index)}${match[1]}${match[2]}${match[1]}${match[3]}${match[4]}[REDACTED]`;
      break;
    }
  }
  const lineAssignments = boundedText.replace(
    /\b([A-Za-z][A-Za-z0-9_-]*)(\s*[:=]\s*)([^"'\r\n]+)$/gm,
    (match, key: string, separator: string, value: string) =>
      isCredentialField(key) && /\S\s+\S/.test(value)
        && (!preserveCodeReferences || !/[{},;()[\].]/.test(value))
        ? `${key}${separator}[REDACTED]` : match
  );
  const envAssignments = lineAssignments.replace(
    /\b([A-Z][A-Z0-9_]*)(\s*=\s*)([^\s"',}()]+)(?=$|[\s,;}\]])/g,
    (match, key: string, separator: string) =>
      isCredentialField(key) ? `${key}${separator}[REDACTED]` : match
  );
  const plainAssignments = envAssignments.replace(
    /\b([A-Za-z][A-Za-z0-9_-]*)(\s*[:=]\s*)([^\s"',}()]+)(?=$|[\s,;}\]])/g,
    (match, key: string, separator: string, value: string) =>
      isCredentialField(key) && !(preserveCodeReferences && isCodeReference(value))
        ? `${key}${separator}[REDACTED]` : match
  );
  return plainAssignments
    .replace(/sk-[A-Za-z0-9_-]{6,}/gi, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/ChatGPT-Account-Id\s*[:=]\s*[^\s,;]+/gi, "ChatGPT-Account-Id=[REDACTED]");
}

const credentialAssignment = /["']([A-Za-z][A-Za-z0-9_-]*)["']\s*:\s*["'][^"']+["']/g;

function isCodeReference(value: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value);
}

export function isCredentialField(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return /(?:^|[_-])(?:api[_-]?key|private[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|token|secret|credential|password|authorization)$/.test(normalized)
    || /^(?:forgebadger|openforge|openai|anthropic|deepseek)_[a-z_]*(?:key|token|secret)$/.test(normalized);
}

function redactStructuredValue(value: unknown): unknown {
  if (typeof value === "string") return redactAgentText(value);
  if (Array.isArray(value)) return value.map(redactStructuredValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    isCredentialField(key) && child !== null && child !== "" ? "[REDACTED]" : redactStructuredValue(child)
  ]));
}

function hasCredentialAssignment(text: string): boolean {
  return [...text.matchAll(credentialAssignment)].some(match => isCredentialField(match[1]!));
}

/** Reject model-produced credentials before tool arguments become durable. */
export function containsSensitiveAgentValue(value: unknown, depth = 0): boolean {
  if (depth >= 16) return true;
  if (typeof value === "string") {
    if (redactAgentTextInternal(value, true) !== value || hasCredentialAssignment(value)) return true;
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed === value ? false : containsSensitiveAgentValue(parsed, depth + 1);
    } catch { return false; }
  }
  if (Array.isArray(value)) return value.some(child => containsSensitiveAgentValue(child, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    redactAgentText(key) !== key
      || (isCredentialField(key) && child !== null && child !== "")
      || containsSensitiveAgentValue(child, depth + 1));
}
