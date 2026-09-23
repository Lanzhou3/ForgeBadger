/**
 * Redaction helpers for the Copilot agent harness.
 *
 * We never surface provider secrets, credential material, or token-shaped
 * strings into the model context, the conversation log, logs, or the public
 * API. Reuses the shared secret-shape redactor from lib/redaction and extends
 * it with provider-specific credential coverage.
 */
import { redactSensitiveContent, redactSensitiveErrorMessage } from "../../lib/redaction.js";

/** Redact a provider error message before it reaches the public envelope. */
export function redactAgentErrorMessage(message: string): string {
  return redactSensitiveErrorMessage(message);
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
  return JSON.parse(redactSensitiveContent(json)) as unknown;
}

/** Redact a single text payload (model context, summaries). */
export function redactAgentText(text: string): string {
  return redactSensitiveContent(text);
}

const credentialAssignment = /["']([A-Za-z][A-Za-z0-9_-]*)["']\s*:\s*["'][^"']+["']/g;

function isCredentialField(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return /(?:^|[_-])(?:api[_-]?key|private[_-]?key|token|secret|credential|password|authorization)$/.test(normalized)
    || /^(?:forgebadger|openforge|openai|anthropic|deepseek)_[a-z_]*(?:key|token|secret)$/.test(normalized);
}

function hasCredentialAssignment(text: string): boolean {
  return [...text.matchAll(credentialAssignment)].some(match => isCredentialField(match[1]!));
}

/** Reject model-produced credentials before tool arguments become durable. */
export function containsSensitiveAgentValue(value: unknown, depth = 0): boolean {
  if (depth >= 16) return true;
  if (typeof value === "string") {
    if (redactAgentText(value) !== value || hasCredentialAssignment(value)) return true;
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
