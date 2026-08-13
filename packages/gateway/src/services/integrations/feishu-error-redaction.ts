const maxErrorLength = 500;
const secretPattern = /\b((?:app[_-]?secret|tenant[_-]?access[_-]?token|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\s*[:=]\s*)(?:Bearer\s+)?[^\s&;,]+/gi;
const bearerPattern = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const credentialUrlPattern = /:\/\/[^:@/\s]+:[^@/\s]+@/g;

export function redactFeishuError(error: unknown): string {
  const raw = error instanceof Error ? error.message || error.name : String(error);
  const singleLine = Array.from(raw, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  const redacted = singleLine
    .replace(credentialUrlPattern, "://[REDACTED]@")
    .replace(bearerPattern, "$1[REDACTED]")
    .replace(secretPattern, "$1[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (!redacted) return "unknown error";
  return redacted.length <= maxErrorLength ? redacted : `${redacted.slice(0, maxErrorLength)}...`;
}
