const maxErrorLength = 500;
const credentialUrlPattern = /:\/\/[^:@/\s]+:[^@/\s]+@/g;
const botTokenPattern = /\d{6,}:[A-Za-z0-9_-]{30,}/g;

export function redactTelegramError(error: unknown): string {
  const raw = error instanceof Error ? error.message || error.name : String(error);
  const singleLine = Array.from(raw, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  const redacted = singleLine
    .replace(credentialUrlPattern, "://[REDACTED]@")
    .replace(botTokenPattern, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (!redacted) return "unknown error";
  return redacted.length <= maxErrorLength ? redacted : `${redacted.slice(0, maxErrorLength)}...`;
}
