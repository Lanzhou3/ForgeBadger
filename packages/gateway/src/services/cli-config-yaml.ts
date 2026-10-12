/**
 * Comment-preserving YAML access for MiniMax Code's config.yaml.
 *
 * MiniMax Code itself round-trips config.yaml without losing comments or
 * unknown top-level keys (verified by writing a commented fixture through
 * `mcode provider add`). A plain `parse()` -> mutate -> `stringify()` cycle
 * would strip exactly what the CLI preserves, so this module keeps a `yaml`
 * Document alive and edits it in place.
 *
 * The JSON/TOML path in cli-config.ts keeps its existing behaviour; only the
 * mcode adapter routes through here.
 */
import { parseDocument, type Document } from "yaml";

export interface YamlConfigHandle {
  /** Live document — serialize with `saveYamlConfig` to keep comments. */
  readonly doc: Document.Parsed;
  /** Plain-object view of the same document, for reads and mutations. */
  readonly root: Record<string, unknown>;
}

export function loadYamlConfig(content: string | undefined): YamlConfigHandle {
  const doc = parseDocument(content !== undefined && content.trim() ? content : "{}");
  if (doc.errors.length > 0) {
    throw new Error(`Global config file is not valid YAML: ${doc.errors[0]!.message}`);
  }
  const parsed = doc.toJS();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Global config file is not valid YAML: config root must be an object");
  }
  return { doc, root: parsed as Record<string, unknown> };
}

/**
 * `lineWidth: 0` disables folding so a long baseURL or api key stays on one
 * line; mcode writes it that way and folding would make every apply produce a
 * spurious diff.
 */
export function saveYamlConfig(handle: YamlConfigHandle): string {
  return handle.doc.toString({ lineWidth: 0 });
}

/**
 * Replays a mutated plain-object root onto the original document, replacing
 * only the top-level keys whose value actually changed, and returns YAML text.
 *
 * MiniMax Code preserves comments and unknown top-level keys in its
 * config.yaml, so a blanket re-serialize would drop what the CLI deliberately
 * kept. Replacing a whole key does lose comments *inside* that key, which is
 * acceptable because the keys ForgeBadger owns (`custom_provider`,
 * `defaultModel`) are exactly the ones it rewrites.
 */
export function serializeYamlPreservingComments(
  originalContent: string,
  doc: Record<string, unknown>
): string {
  const handle = loadYamlConfig(originalContent);
  const original = isRecord(handle.doc.contents) ? handle.doc.contents : undefined;
  if (original) {
    for (const key of original.items.map((item) => (isScalarKey(item.key) ? item.key.value : undefined))) {
      if (key !== undefined && !Object.hasOwn(doc, key)) handle.doc.delete(key);
    }
  }
  for (const [key, value] of Object.entries(doc)) {
    if (isSameYamlValue(handle.doc.get(key), value)) continue;
    handle.doc.set(key, value);
  }
  return saveYamlConfig(handle);
}

function isRecord(value: unknown): value is { items: Array<{ key?: unknown }> } {
  return Boolean(value) && typeof value === "object" && Array.isArray((value as { items?: unknown }).items);
}

function isScalarKey(value: unknown): value is { value: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { value?: unknown }).value === "string";
}

function isSameYamlValue(current: unknown, next: unknown): boolean {
  if (current === next) return true;
  if (current === undefined) return next === undefined;
  try {
    return JSON.stringify(current ?? null) === JSON.stringify(next ?? null);
  } catch {
    return false;
  }
}
