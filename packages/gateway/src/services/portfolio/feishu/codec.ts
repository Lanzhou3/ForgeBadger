import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function hmac(secret: string, value: string): string { return createHmac("sha256", secret).update(value).digest("hex"); }
export function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8"); const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function redactSummary(value: string, maximum = 1_024): string {
  return value.replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[REDACTED]").slice(0, maximum).trim();
}
