/**
 * Card builders for the Copilot Feishu channel (P0 native-experience pass).
 *
 * Two card shapes, both Feishu Card JSON 2.0:
 *   - Run card: one per Copilot turn; created as "running", updated in place
 *     while text deltas stream in, finalized as done/failed/awaiting_approval.
 *   - Approval card: separate interactive message with 批准/拒绝 buttons whose
 *     value payload routes the decision back through the copilot channel.
 *
 * Keep the JSON shape conservative (schema 2.0: header/div markdown/buttons).
 */
import { redactAgentText } from "../agent/redaction.js";

export type CopilotRunCardState = "running" | "done" | "failed" | "awaiting_approval";

const STATE_HEADER: Record<CopilotRunCardState, { title: string; template: string }> = {
  running: { title: "Copilot 正在处理…", template: "blue" },
  done: { title: "Copilot 已完成", template: "green" },
  failed: { title: "Copilot 运行失败", template: "red" },
  awaiting_approval: { title: "Copilot 等待审批", template: "orange" }
};

/** Keep the streamed body inside a safe size budget. */
const MAX_BODY_CHARS = 6_000;
const TRUNCATION_SUFFIX = "\n…（已截断）";
const REASONING_TAG_PATTERN = "(?:analysis|think(?:ing)?|reasoning(?:_scratchpad)?|thought)";
const SENSITIVE_TAG_NAMES = [
  "analysis",
  "think",
  "thinking",
  "reasoning",
  "reasoning_scratchpad",
  "thought",
  "at"
] as const;
const SENSITIVE_JSON_KEYS = new Set([
  "password",
  "passwd",
  "token",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "appsecret",
  "clientsecret",
  "apikey",
  "authorization",
  "proxyauthorization",
  "privatekey"
]);
const MAX_SENSITIVE_ALIAS_CHARS = Math.max(...[...SENSITIVE_JSON_KEYS].map((key) => key.length));
const COMMON_CONFUSABLE_ASCII: Readonly<Record<string, string>> = {
  // Bounded high-frequency Cyrillic/Greek homoglyph skeleton, not full UTS39.
  "а": "a", "в": "b", "с": "c", "ԁ": "d", "е": "e", "н": "h",
  "і": "i", "ј": "j", "к": "k", "м": "m", "о": "o", "р": "p",
  "ѕ": "s", "т": "t", "у": "y", "х": "x", "ԝ": "w",
  "α": "a", "β": "b", "ϲ": "c", "ε": "e", "η": "h", "ι": "i",
  "κ": "k", "μ": "m", "ο": "o", "ρ": "p", "σ": "s", "ς": "s",
  "τ": "t", "υ": "y", "χ": "x", "ω": "w", "ζ": "z"
};
const DECODED_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  colon: ":",
  equals: "="
};
const DECODED_NAMED_ENTITY_PATTERN = Object.keys(DECODED_NAMED_ENTITIES).join("|");
const MAX_NESTED_JSON_DEPTH = 16;
const MAX_SENSITIVE_KEY_CANDIDATE_CHARS = 256;
const MAX_SENSITIVE_DECODE_PASSES = 4;
const MAX_SENSITIVE_DETECTION_DECODE_PASSES = 64;
const MAX_SENSITIVE_DETECTION_LINE_CHARS = 64 * 1_024;
const REDACTED_VALUE = "[REDACTED]";
const REDACTED_SENSITIVE_LINE = "[REDACTED SENSITIVE LINE]";
const SENSITIVE_ASSIGNMENT_KEY_PATTERN =
  "(?:access[\\s_-]*token|refresh[\\s_-]*token|auth[\\s_-]*token|app[\\s_-]*secret|client[\\s_-]*secret|api[\\s_-]*key|private[\\s_-]*key|proxy[\\s_-]*authorization|password|passwd|authorization|token)";

const EMPTY_BODY: Record<CopilotRunCardState, string> = {
  running: "正在生成回复，请稍候…",
  done: "已完成，但没有可展示的回复。",
  failed: "运行失败，但没有可展示的错误详情。",
  awaiting_approval: "等待你审批后继续。"
};

export interface CopilotRunCardInput {
  state: CopilotRunCardState;
  text: string;
  /** Optional trailing note rendered under the body (e.g. approval hint). */
  note?: string;
}

export function buildCopilotRunCard(input: CopilotRunCardInput): unknown {
  const header = STATE_HEADER[input.state];
  const raw = prepareFeishuCopilotText(input.text).trim();
  const bodyText = raw.length > MAX_BODY_CHARS
    ? `${raw.slice(0, MAX_BODY_CHARS - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`
    : raw;
  const elements: unknown[] = [
    {
      tag: "div",
      text: { tag: "lark_md", content: bodyText || EMPTY_BODY[input.state] }
    }
  ];
  if (input.note) {
    const note = prepareFeishuCopilotText(input.note).trim();
    if (!note) return buildCard(header, elements);
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: note }
    });
  }
  return buildCard(header, elements);
}

function buildCard(header: { title: string; template: string }, elements: unknown[]): unknown {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      title: { tag: "plain_text", content: header.title },
      template: header.template
    },
    body: { elements }
  };
}

/**
 * Remove model-internal reasoning from every Feishu-visible reply. The input
 * remains untouched in the conversation log; this is an outbound-only view.
 * The parser is cumulative-stream safe: an unfinished opening tag or thinking
 * block is withheld until a later full buffer proves it contains visible text.
 */
export function sanitizeFeishuCopilotText(value: string): string {
  const normalized = decodeSensitiveTagEntities(value);
  const parts: string[] = [];
  const tagPattern = new RegExp(
    `<${REASONING_TAG_PATTERN}(?:\\s[^>]*)?>|<\\/${REASONING_TAG_PATTERN}\\s*>`,
    "giu"
  );
  let depth = 0;
  let cursor = 0;
  for (const match of normalized.matchAll(tagPattern)) {
    const index = match.index;
    if (index === undefined) continue;
    if (depth === 0) parts.push(normalized.slice(cursor, index));
    const closing = /^<\//u.test(match[0]);
    if (closing) depth = Math.max(0, depth - 1);
    else depth += 1;
    cursor = index + match[0].length;
  }
  if (depth === 0) parts.push(normalized.slice(cursor));
  return stripTrailingSensitiveTag(stripFeishuMentionTags(parts.join("")));
}

/** Redact credentials first, then remove reasoning and Feishu mention tags. */
export function prepareFeishuCopilotText(value: string): string {
  return sanitizeFeishuCopilotText(redactFeishuOutboundSecrets(redactAgentText(value)));
}

/** Extra-strict Feishu-only view redaction; persistence and Web projections stay unchanged. */
function redactFeishuOutboundSecrets(value: string): string {
  const structured = redactStructuredJson(value);
  if (structured !== undefined) return structured;
  return redactFeishuPlainTextSecrets(value);
}

function redactStructuredJson(value: string, depth = 0): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  if (depth >= MAX_NESTED_JSON_DEPTH) return "[REDACTED NESTED JSON]";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const original = JSON.stringify(parsed);
    const redacted = JSON.stringify(redactJsonValue(parsed, depth));
    return redacted === original ? value : redacted;
  } catch {
    return undefined;
  }
}

function redactJsonValue(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) return value.map((child) => redactJsonValue(child, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      isSensitiveJsonKey(key) ? "[REDACTED]" : redactJsonValue(child, depth + 1)
    ]));
  }
  if (typeof value !== "string") return value;
  return redactStructuredJson(value, depth + 1) ?? redactFeishuPlainTextSecrets(value);
}

function isSensitiveJsonKey(key: string): boolean {
  const canonical = canonicalizeSensitiveKey(key);
  return canonical.unresolved
    || SENSITIVE_JSON_KEYS.has(canonical.value)
    || matchesMixedScriptSensitiveAlias(canonical, false);
}

interface CanonicalSensitiveKey {
  value: string;
  unresolved: boolean;
  mixedPattern: string;
  asciiExactCount: number;
  hasNonAsciiLetter: boolean;
}

function canonicalizeSensitiveKey(key: string): CanonicalSensitiveKey {
  if (key.length > MAX_SENSITIVE_KEY_CANDIDATE_CHARS) {
    return {
      value: "",
      unresolved: true,
      mixedPattern: "",
      asciiExactCount: 0,
      hasNonAsciiLetter: false
    };
  }
  const decoded = decodeSensitiveEscapeView(key);
  const skeleton: string[] = [];
  const mixedPattern: string[] = [];
  let asciiExactCount = 0;
  let hasNonAsciiLetter = false;
  const normalizedKey = replaceUnknownNamedEntityNames(
    decoded.value.normalize("NFKD").toLowerCase()
  );
  for (const character of normalizedKey) {
    if (/[a-z0-9]/u.test(character)) {
      skeleton.push(character);
      mixedPattern.push(character);
      asciiExactCount += 1;
      continue;
    }
    const mapped = COMMON_CONFUSABLE_ASCII[character];
    if (mapped) {
      skeleton.push(mapped);
      mixedPattern.push(mapped);
      hasNonAsciiLetter = true;
      continue;
    }
    if (/\p{L}/u.test(character)) {
      skeleton.push("?");
      mixedPattern.push("?");
      hasNonAsciiLetter = true;
      continue;
    }
    if (/\p{N}/u.test(character)) {
      skeleton.push("#");
      mixedPattern.push("#");
    }
  }
  return {
    value: skeleton.join(""),
    unresolved: decoded.unresolved,
    mixedPattern: mixedPattern.join(""),
    asciiExactCount,
    hasNonAsciiLetter
  };
}

function matchesMixedScriptSensitiveAlias(
  canonical: CanonicalSensitiveKey,
  prefixOnly: boolean
): boolean {
  if (!canonical.hasNonAsciiLetter || canonical.mixedPattern.length === 0) return false;
  const minimumAscii = Math.max(3, canonical.mixedPattern.length - 2);
  if (canonical.asciiExactCount < minimumAscii) return false;
  return [...SENSITIVE_JSON_KEYS].some((alias) => {
    if (prefixOnly) {
      if (canonical.mixedPattern.length > alias.length) return false;
    } else if (canonical.mixedPattern.length !== alias.length) {
      return false;
    }
    for (let index = 0; index < canonical.mixedPattern.length; index += 1) {
      const character = canonical.mixedPattern[index];
      if (character !== "?" && character !== alias[index]) return false;
    }
    return true;
  });
}

function redactFeishuPlainTextSecrets(value: string): string {
  const withoutPrivateKeys = value
    .replace(
      /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?(?:-----END(?: [A-Z0-9]+)* PRIVATE KEY-----|$)/giu,
      "[REDACTED PRIVATE KEY]"
    );
  const withoutEmbeddedJsonSecrets = redactEmbeddedJsonStringLiterals(withoutPrivateKeys);
  const withoutAuthorizationHeaders = redactAuthorizationHeaders(withoutEmbeddedJsonSecrets);
  const redacted = redactStandaloneBearer(redactSensitiveAssignments(withoutAuthorizationHeaders));
  return enforceSensitiveLineInvariant(redacted);
}

function enforceSensitiveLineInvariant(value: string): string {
  return value.replace(/[^\r\n]+/gu, (line) => {
    const detection = normalizeSensitiveDetectionView(
      maskSafeStructuredJsonStringLiterals(line)
    );
    return hasUnsafeSensitiveAssignment(detection)
      ? REDACTED_SENSITIVE_LINE
      : line;
  });
}

function maskSafeStructuredJsonStringLiterals(value: string): string {
  let cursor = 0;
  let output = "";
  while (cursor < value.length) {
    const start = value.indexOf('"', cursor);
    if (start < 0) break;
    const end = findJsonStringLiteralEnd(value, start);
    if (end === undefined) break;
    const literal = value.slice(start, end);
    let safeStructured = false;
    try {
      const decoded = JSON.parse(literal) as unknown;
      if (typeof decoded === "string") {
        const checked = redactStructuredJson(decoded, 1);
        safeStructured = checked !== undefined && checked === decoded;
      }
    } catch {
      // Detection masking is opt-in: malformed literals stay fully visible to
      // the line invariant and therefore cannot bypass its tail guard.
    }
    output += value.slice(cursor, start)
      + (safeStructured ? '"[SAFE STRUCTURED JSON]"' : literal);
    cursor = end;
  }
  return output + value.slice(cursor);
}

interface SensitiveDetectionView {
  value: string;
  unresolved: boolean;
  oversized: boolean;
}

function normalizeSensitiveDetectionView(value: string): SensitiveDetectionView {
  const oversized = value.length > MAX_SENSITIVE_DETECTION_LINE_CHARS;
  const bounded = oversized ? value.slice(0, MAX_SENSITIVE_DETECTION_LINE_CHARS) : value;
  const decoded = decodeSensitiveEscapeView(bounded, MAX_SENSITIVE_DETECTION_DECODE_PASSES);
  const normalized = decoded.value.normalize("NFKD");
  return {
    value: normalized.slice(0, MAX_SENSITIVE_DETECTION_LINE_CHARS),
    unresolved: decoded.unresolved,
    oversized: oversized || normalized.length > MAX_SENSITIVE_DETECTION_LINE_CHARS
  };
}

function decodeSensitiveEscapeView(
  value: string,
  maxPasses = MAX_SENSITIVE_DECODE_PASSES
): { value: string; unresolved: boolean } {
  return decodeSensitiveFixedPoint(value, maxPasses, decodeSensitiveEscapePass);
}

function decodeSensitiveEntityView(
  value: string,
  maxPasses: number
): { value: string; unresolved: boolean } {
  return decodeSensitiveFixedPoint(value, maxPasses, decodeSensitiveEntityPass);
}

function decodeSensitiveFixedPoint(
  value: string,
  maxPasses: number,
  decodePass: (input: string) => string
): { value: string; unresolved: boolean } {
  let normalized = value;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const next = decodePass(normalized);
    if (next === normalized) return { value: normalized, unresolved: false };
    normalized = next;
  }
  return {
    value: normalized,
    unresolved: decodePass(normalized) !== normalized
  };
}

function decodeSensitiveEscapePass(value: string): string {
  return decodeSensitiveEntityPass(value)
    .replace(/\\+u\{([0-9a-f]{1,6})\}/giu, (escape, hex) =>
      decodeDetectionCodePoint(Number.parseInt(hex, 16), escape)
    )
    .replace(/\\+u([0-9a-f]{4})/giu, (escape, hex) =>
      decodeDetectionCodePoint(Number.parseInt(hex, 16), escape)
    )
    .replace(/\\+x([0-9a-f]{2})/giu, (escape, hex) =>
      decodeDetectionCodePoint(Number.parseInt(hex, 16), escape)
    )
    .replace(/\\+(["'\\])/gu, "$1");
}

function decodeSensitiveEntityPass(value: string): string {
  return value
    .replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/giu, (entity, hex, decimal) =>
      decodeDetectionCodePoint(hex ? Number.parseInt(hex, 16) : Number.parseInt(decimal, 10), entity)
    )
    .replace(/&(amp|lt|gt|quot|apos|colon|equals);/giu, (entity, name: string) =>
      DECODED_NAMED_ENTITIES[name.toLowerCase()] ?? entity
    );
}

function decodeDetectionCodePoint(codePoint: number, fallback: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return fallback;
  return String.fromCodePoint(codePoint);
}

function replaceUnknownNamedEntityNames(value: string): string {
  return value.replace(/&([a-z][a-z0-9]{1,63});/giu, (entity, name: string) => {
    if (Object.hasOwn(DECODED_NAMED_ENTITIES, name.toLowerCase())) return entity;
    const mathLetter = /^([a-z])(?:scr|fr|opf)$/iu.exec(name);
    return mathLetter?.[1]?.toLowerCase() ?? "\u0000";
  });
}

function hasUnsafeSensitiveAssignment(detection: SensitiveDetectionView): boolean {
  if (detection.oversized) return true;
  for (const delimiter of detection.value.matchAll(/[:=]/gu)) {
    if (delimiter.index === undefined) continue;
    const extracted = extractSensitiveKeyCandidates(detection.value, delimiter.index);
    if (!extracted.oversized && !extracted.values.some(isSensitiveJsonKey)) continue;
    let start = delimiter.index + delimiter[0].length;
    while (detection.value[start] === " " || detection.value[start] === "\t") start += 1;
    const checked = checkRedactedSensitiveValue(detection.value, start);
    if (!checked.valid) return true;
    if (detection.value.slice(checked.end).trim() !== "") return true;
  }
  return detection.unresolved && hasSensitivePrefixBeforeUnresolvedEscape(detection.value);
}

function hasSensitivePrefixBeforeUnresolvedEscape(value: string): boolean {
  const residualEscape = new RegExp(
    `&(?:${DECODED_NAMED_ENTITY_PATTERN});|&#(?:x[0-9a-f]{1,6}|[0-9]{1,7});?|\\\\+(?:u\\{[0-9a-f]{1,6}\\}|u[0-9a-f]{4}|x[0-9a-f]{2}|["'\\\\])`,
    "giu"
  );
  for (const match of value.matchAll(residualEscape)) {
    if (match.index === undefined) continue;
    const extracted = extractSensitiveKeyCandidates(value, match.index);
    if (extracted.oversized || extracted.values.some(isSensitiveKeyPrefix)) return true;
  }
  return false;
}

function isSensitiveKeyPrefix(value: string): boolean {
  const canonical = canonicalizeSensitiveKey(value);
  if (canonical.unresolved) return true;
  if (canonical.value.length >= 2
    && [...SENSITIVE_JSON_KEYS].some((key) => key.startsWith(canonical.value))) {
    return true;
  }
  return matchesMixedScriptSensitiveAlias(canonical, true);
}

function extractSensitiveKeyCandidates(
  value: string,
  delimiterIndex: number
): { values: string[]; oversized: boolean } {
  const left = value.slice(0, delimiterIndex).trimEnd();
  if (!left) return { values: [], oversized: false };
  const windowStart = Math.max(0, left.length - MAX_SENSITIVE_KEY_CANDIDATE_CHARS);
  const bounded = left.slice(windowStart);
  const words = replaceUnknownNamedEntityNames(bounded.normalize("NFKD"))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const candidates = new Set<string>([bounded]);
  let suffix = "";
  for (let index = words.length - 1; index >= 0; index -= 1) {
    suffix = `${words[index]}${suffix}`;
    const canonical = canonicalizeSensitiveKey(suffix);
    const canonicalLength = canonical.mixedPattern.length || canonical.value.length;
    if (canonicalLength > MAX_SENSITIVE_ALIAS_CHARS) break;
    candidates.add(suffix);
  }
  return {
    values: [...candidates],
    oversized: windowStart > 0 && !/\s/u.test(bounded)
  };
}

function checkRedactedSensitiveValue(
  value: string,
  start: number
): { valid: boolean; end: number } {
  const quote = value[start] === '"' || value[start] === "'" ? value[start] : undefined;
  if (!quote) {
    const end = start + REDACTED_VALUE.length;
    return {
      valid: value.startsWith(REDACTED_VALUE, start) && isSensitiveValueTerminator(value[end]),
      end
    };
  }
  let end = start + 1;
  while (end < value.length) {
    if (value[end] === "\\") {
      end += 2;
      continue;
    }
    if (value[end] === quote) {
      return {
        valid: value.slice(start + 1, end) === REDACTED_VALUE
          && isSensitiveValueTerminator(value[end + 1]),
        end: end + 1
      };
    }
    end += 1;
  }
  return { valid: false, end: value.length };
}

function isSensitiveValueTerminator(value: string | undefined): boolean {
  return value === undefined || /[\s,;}\])]/u.test(value);
}

function redactEmbeddedJsonStringLiterals(value: string): string {
  let cursor = 0;
  let output = "";
  while (cursor < value.length) {
    const start = value.indexOf('"', cursor);
    if (start < 0) break;
    const end = findJsonStringLiteralEnd(value, start);
    if (end === undefined) {
      const lineEnd = findLineEnd(value, start);
      const malformed = value.slice(start, lineEnd);
      output += value.slice(cursor, start)
        + (hasEscapedSensitiveJsonKey(malformed) ? "[REDACTED JSON]" : malformed);
      cursor = lineEnd;
      continue;
    }
    const literal = value.slice(start, end);
    let replacement = literal;
    try {
      const decoded = JSON.parse(literal) as unknown;
      if (typeof decoded === "string") {
        const redacted = redactStructuredJson(decoded, 1);
        if (redacted !== undefined && redacted !== decoded) replacement = JSON.stringify(redacted);
        else if (redacted === undefined && hasEscapedSensitiveJsonKey(literal)) {
          replacement = "[REDACTED JSON]";
        }
      }
    } catch {
      if (hasEscapedSensitiveJsonKey(literal)) replacement = "[REDACTED JSON]";
    }
    output += value.slice(cursor, start) + replacement;
    cursor = end;
  }
  return output + value.slice(cursor);
}

function findJsonStringLiteralEnd(value: string, start: number): number | undefined {
  let cursor = start + 1;
  while (cursor < value.length) {
    if (value[cursor] === "\n" || value[cursor] === "\r") return undefined;
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (value[cursor] === '"') return cursor + 1;
    cursor += 1;
  }
  return undefined;
}

function findLineEnd(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length && value[cursor] !== "\n" && value[cursor] !== "\r") cursor += 1;
  return cursor;
}

function hasEscapedSensitiveJsonKey(value: string): boolean {
  for (const match of value.matchAll(/\\"([^"\\]{1,80})\\"[ \t]*:/gu)) {
    if (match[1] && isSensitiveJsonKey(match[1])) return true;
  }
  return false;
}

function redactAuthorizationHeaders(value: string): string {
  return value.replace(
    /(^|[^A-Za-z0-9_-])(proxy[ \t_-]*authorization|authorization)([ \t]*[:=][ \t]*)[^\r\n]*/giu,
    "$1$2$3[REDACTED]"
  );
}

function redactSensitiveAssignments(value: string): string {
  const pattern = new RegExp(
    `["']?\\b${SENSITIVE_ASSIGNMENT_KEY_PATTERN}\\b["']?[ \\t]*[:=][ \\t]*`,
    "giu"
  );
  return redactMatchedValues(value, pattern, true);
}

function redactStandaloneBearer(value: string): string {
  return redactMatchedValues(value, /\bbearer\b[ \t]+/giu, false);
}

function redactMatchedValues(value: string, pattern: RegExp, preserveQuote: boolean): string {
  let cursor = 0;
  let output = "";
  while (cursor < value.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(value);
    if (!match || match.index === undefined) break;
    const assigned = consumeAssignedValue(value, pattern.lastIndex, preserveQuote);
    output += value.slice(cursor, match.index) + match[0] + assigned.replacement;
    cursor = assigned.end;
  }
  return output + value.slice(cursor);
}

function consumeAssignedValue(
  value: string,
  start: number,
  preserveQuote: boolean
): { end: number; replacement: string } {
  const quote = value[start] === '"' || value[start] === "'" ? value[start] : undefined;
  if (!quote) {
    let end = start;
    while (end < value.length && !/[\s,;}]/u.test(value[end]!)) end += 1;
    return { end, replacement: "[REDACTED]" };
  }
  let end = start + 1;
  while (end < value.length && value[end] !== "\n" && value[end] !== "\r") {
    if (value[end] === "\\") {
      if (value[end + 1] === "\n" || value[end + 1] === "\r") {
        end += 1;
        continue;
      }
      end = Math.min(value.length, end + 2);
      continue;
    }
    if (value[end] === quote) {
      return {
        end: end + 1,
        replacement: preserveQuote ? `${quote}[REDACTED]${quote}` : "[REDACTED]"
      };
    }
    end += 1;
  }
  return {
    end,
    replacement: preserveQuote ? `${quote}[REDACTED]${quote}` : "[REDACTED]"
  };
}

/** Stateful cumulative view for split streaming deltas; raw source never leaves this closure. */
export function createFeishuOutboundTextScrubber(): {
  append(delta: string): string;
  replace(value: string): string;
  visible(): string;
} {
  let source = "";
  const visible = (): string => prepareFeishuCopilotText(source);
  return {
    append(delta: string): string {
      source += delta;
      return visible();
    },
    replace(value: string): string {
      source = value;
      return visible();
    },
    visible
  };
}

function decodeSensitiveTagEntities(value: string): string {
  const decoded = decodeSensitiveEntityViewWithSourceMap(
    value,
    MAX_SENSITIVE_DETECTION_DECODE_PASSES
  );
  const spans = findSensitiveDecodedTagSpans(decoded.value).map((span) => ({
    ...span,
    sourceStart: decoded.characters[span.start]?.sourceStart ?? value.length,
    sourceEnd: decoded.characters[span.end - 1]?.sourceEnd ?? value.length
  }));
  const residualSourceStart = decoded.unresolvedSourceStart;
  if (spans.length > 0 || residualSourceStart !== undefined) {
    let cursor = 0;
    let output = "";
    for (const span of spans) {
      if (residualSourceStart !== undefined && span.sourceStart >= residualSourceStart) break;
      output += value.slice(cursor, span.sourceStart) + decoded.value.slice(span.start, span.end);
      cursor = span.sourceEnd;
    }
    const end = residualSourceStart ?? value.length;
    return output + value.slice(cursor, end) + (residualSourceStart === undefined ? "" : "<analysis>");
  }
  return value;
}

interface SourceMappedCharacter {
  value: string;
  sourceStart: number;
  sourceEnd: number;
}

function decodeSensitiveEntityViewWithSourceMap(
  value: string,
  maxPasses: number
): {
  value: string;
  unresolved: boolean;
  unresolvedSourceStart: number | undefined;
  characters: SourceMappedCharacter[];
} {
  let characters = value.split("").map((character, index) => ({
    value: character,
    sourceStart: index,
    sourceEnd: index + 1
  }));
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const decoded = decodeSensitiveEntityMappedPass(characters);
    if (!decoded.changed) {
      return {
        value: characters.map((character) => character.value).join(""),
        unresolved: false,
        unresolvedSourceStart: undefined,
        characters
      };
    }
    characters = decoded.characters;
  }
  const overflow = decodeSensitiveEntityMappedPass(characters);
  return {
    value: characters.map((character) => character.value).join(""),
    unresolved: overflow.changed,
    unresolvedSourceStart: overflow.firstChangedSourceStart,
    characters
  };
}

function decodeSensitiveEntityMappedPass(
  characters: SourceMappedCharacter[]
): {
  characters: SourceMappedCharacter[];
  changed: boolean;
  firstChangedSourceStart: number | undefined;
} {
  const value = characters.map((character) => character.value).join("");
  const entityPattern = new RegExp(
    `&#(?:x[0-9a-f]{1,6}|[0-9]{1,7});?|&(?:${DECODED_NAMED_ENTITY_PATTERN});`,
    "giu"
  );
  const output: SourceMappedCharacter[] = [];
  let cursor = 0;
  let changed = false;
  let firstChangedSourceStart: number | undefined;
  for (const match of value.matchAll(entityPattern)) {
    if (match.index === undefined) continue;
    output.push(...characters.slice(cursor, match.index));
    const replacement = decodeSensitiveEntityPass(match[0]);
    if (replacement === match[0]) {
      output.push(...characters.slice(match.index, match.index + match[0].length));
    } else {
      changed = true;
      const sourceStart = characters[match.index]?.sourceStart ?? 0;
      const sourceEnd = characters[match.index + match[0].length - 1]?.sourceEnd ?? sourceStart;
      firstChangedSourceStart ??= sourceStart;
      output.push(...replacement.split("").map((character) => ({
        value: character,
        sourceStart,
        sourceEnd
      })));
    }
    cursor = match.index + match[0].length;
  }
  output.push(...characters.slice(cursor));
  return { characters: output, changed, firstChangedSourceStart };
}

function findSensitiveDecodedTagSpans(value: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const tagNames = [...SENSITIVE_TAG_NAMES].sort((left, right) => right.length - left.length).join("|");
  const completeTag = new RegExp(`<\\/?(?:${tagNames})(?:\\s[^>]*)?>`, "giu");
  for (const match of value.matchAll(completeTag)) {
    if (match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  let marker = value.indexOf("<");
  while (marker >= 0) {
    const alreadyComplete = spans.some((span) => marker >= span.start && marker < span.end);
    if (!alreadyComplete) {
      const remainder = value.slice(marker + 1);
      const candidate = remainder.startsWith("/") ? remainder.slice(1) : remainder;
      const prefix = /^[a-z_]+/iu.exec(candidate)?.[0] ?? "";
      if (isSensitiveTagNameCandidate(prefix, candidate.slice(prefix.length))) {
        spans.push({ start: marker, end: value.length });
        break;
      }
    }
    marker = value.indexOf("<", marker + 1);
  }
  return spans.sort((left, right) => left.start - right.start);
}

function isSensitiveTagNameCandidate(name: string, remainder: string): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase();
  const complete = /^[\s/>]/u.test(remainder)
    || /^&(?:amp;)*(?:gt;|#(?:x0*3e|0*62);?)/iu.test(remainder);
  if (complete) return SENSITIVE_TAG_NAMES.some((tag) => tag === normalized);
  if (remainder.length > 0) return false;
  return SENSITIVE_TAG_NAMES.some((tag) => tag.startsWith(normalized));
}

function isSensitiveTagPrefix(value: string): boolean {
  const candidate = value.startsWith("/") ? value.slice(1) : value;
  const prefix = /^[a-z_]*/iu.exec(candidate)?.[0].toLowerCase() ?? "";
  return SENSITIVE_TAG_NAMES.some((name) => name.startsWith(prefix));
}

function stripFeishuMentionTags(value: string): string {
  return value
    .replace(/<at\b[^>]*>/giu, "")
    .replace(/<\/at\s*>/giu, "");
}

function stripTrailingSensitiveTag(value: string): string {
  const marker = value.lastIndexOf("<");
  if (marker < 0) return value;
  const suffix = value.slice(marker).toLowerCase();
  if (!suffix.includes(">") && isSensitiveTagPrefix(suffix.replace(/^<\/?/u, ""))) {
    return value.slice(0, marker);
  }
  return value;
}

export interface CopilotApprovalCardInput {
  tool: string;
  inputJson: string;
  conversationId: string;
  runId: string;
  actionId: string;
}

export type CopilotApprovalResolutionState =
  | "rejected"
  | "approved_running"
  | "completed"
  | "failed"
  | "cancelled"
  | "still_running";

export function buildCopilotApprovalCard(input: CopilotApprovalCardInput): unknown {
  const tool = prepareFeishuCopilotText(input.tool);
  const detail = truncateLines(prepareFeishuCopilotText(input.inputJson), 900);
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      title: { tag: "plain_text", content: "Copilot 请求审批" },
      template: "orange"
    },
    body: {
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: [`**工具**：${tool}`, `**输入**：\n${detail}`].join("\n")
          }
        },
        buildDecisionButton("✅ 批准", "approve", input),
        buildDecisionButton("❌ 拒绝", "reject", input),
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: "也可以直接回复 /approve 或 /reject。"
          }
        }
      ]
    }
  };
}

/** Resolved-state replacement for an approval card after a decision. */
export function buildCopilotApprovalResolvedCard(input: {
  tool: string;
  state: CopilotApprovalResolutionState;
  detail?: string;
}): unknown {
  const tool = prepareFeishuCopilotText(input.tool);
  const presentation = approvalResolutionPresentation(input.state, tool);
  const detail = input.detail ? prepareFeishuCopilotText(input.detail).trim() : "";
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      title: {
        tag: "plain_text",
        content: presentation.title
      },
      template: presentation.template
    },
    body: {
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: detail ? truncateLines(detail, 4_000) : presentation.body
          }
        }
      ]
    }
  };
}

function approvalResolutionPresentation(
  state: CopilotApprovalResolutionState,
  tool: string
): { title: string; template: string; body: string } {
  if (state === "rejected") {
    return { title: `已拒绝：${tool}`, template: "grey", body: "该操作已被拒绝。" };
  }
  if (state === "approved_running") {
    return { title: `已批准，正在执行：${tool}`, template: "blue", body: "操作已批准，正在等待执行结果。" };
  }
  if (state === "completed") {
    return { title: `执行完成：${tool}`, template: "green", body: "操作已完成，但没有返回可展示的工具输出。" };
  }
  if (state === "failed") {
    return { title: `执行失败：${tool}`, template: "red", body: "操作执行失败。" };
  }
  if (state === "cancelled") {
    return { title: `执行已取消：${tool}`, template: "grey", body: "操作已取消。" };
  }
  return { title: `仍在执行：${tool}`, template: "blue", body: "操作已批准，但尚未完成，请稍后查看。" };
}

function buildDecisionButton(
  text: string,
  decision: "approve" | "reject",
  input: CopilotApprovalCardInput
): unknown {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type: decision === "approve" ? "primary" : "default",
    value: {
      copilot_decision: decision,
      conversation_id: input.conversationId,
      run_id: input.runId,
      action_id: input.actionId
    }
  };
}

function truncateLines(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n…（已截断）`;
}
