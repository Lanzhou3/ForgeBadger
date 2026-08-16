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
