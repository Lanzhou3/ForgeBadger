/**
 * Canonical adapter id list.
 *
 * Historically every call site declared its own `z.enum(["claude", ...])` or
 * string union, and adding an adapter meant finding all of them by hand. That
 * already drifted once: three sites shipped without `pi`, so pi sessions were
 * rejected by the project/template/config-render routes. Keep this as the only
 * place an id is spelled out, and derive the types and schemas from it.
 *
 * Deliberately a leaf module (no project imports) so both `config/` and
 * `services/` can depend on it without an import cycle.
 */

export const adapterIds = [
  "claude",
  "opencode",
  "codex",
  "kimi",
  "pi",
  "mcode"
] as const;

export type CanonicalAdapterId = (typeof adapterIds)[number];

export function isCanonicalAdapterId(value: string): value is CanonicalAdapterId {
  return (adapterIds as readonly string[]).includes(value);
}
