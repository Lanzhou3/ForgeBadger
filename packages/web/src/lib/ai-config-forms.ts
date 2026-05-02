import type { AiConfigFormField } from "./api";

export type AiConfigFormValue = string | number | boolean | string[];

export interface AiConfigDraftUpdate {
  content: string;
  error?: string;
}

type JsonObject = Record<string, unknown>;

export function readAiConfigFieldValue(
  content: string,
  fileType: string,
  field: AiConfigFormField
): AiConfigFormValue | undefined {
  if (field.path === "$content") {
    return content;
  }

  try {
    if (fileType === "json" || fileType === "jsonc") {
      const value = getByPath(parseJsonObject(content), field.path);
      return normalizeReadValue(value, field);
    }
    if (fileType === "toml") {
      return normalizeReadValue(readTomlValue(content, field.path), field);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function updateAiConfigDraft(
  content: string,
  fileType: string,
  field: AiConfigFormField,
  value: AiConfigFormValue
): AiConfigDraftUpdate {
  if (field.path === "$content") {
    return { content: String(value) };
  }

  try {
    const normalizedValue = normalizeWriteValue(value, field);
    if (fileType === "json" || fileType === "jsonc") {
      const object = parseJsonObject(content);
      setByPath(object, field.path, normalizedValue);
      return { content: `${JSON.stringify(object, null, 2)}\n` };
    }
    if (fileType === "toml") {
      return { content: writeTomlValue(content, field.path, normalizedValue, field) };
    }
    return { content, error: `Unsupported form file type: ${fileType}` };
  } catch (error) {
    return {
      content,
      error: error instanceof Error ? error.message : "Failed to update config draft",
    };
  }
}

export function formValueToText(value: AiConfigFormValue | undefined): string {
  if (Array.isArray(value)) return value.join("\n");
  if (value === undefined) return "";
  return String(value);
}

export function textToFormValue(text: string, field: AiConfigFormField): AiConfigFormValue {
  if (field.inputType === "list") {
    return text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (field.inputType === "number") {
    return Number(text);
  }
  if (field.inputType === "boolean") {
    return text === "true";
  }
  return text;
}

function parseJsonObject(content: string): JsonObject {
  const trimmed = stripJsonComments(content).trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error("Config JSON must be an object");
  }
  return parsed;
}

function stripJsonComments(content: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index]!;
    const next = content[index + 1];

    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      output += current;
      continue;
    }

    if (current === "/" && next === "/") {
      while (index < content.length && content[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (current === "/" && next === "*") {
      index += 2;
      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) {
        if (content[index] === "\n") output += "\n";
        index += 1;
      }
      index += 1;
      continue;
    }

    output += current;
  }

  return output;
}

function getByPath(root: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) return undefined;
    return current[segment];
  }, root);
}

function setByPath(root: JsonObject, dottedPath: string, value: unknown): void {
  const segments = dottedPath.split(".");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(current[segment])) {
      current[segment] = {};
    }
    current = current[segment] as JsonObject;
  }
  current[segments[segments.length - 1]!] = value;
}

function normalizeReadValue(value: unknown, field: AiConfigFormField): AiConfigFormValue | undefined {
  if (field.inputType === "list") {
    if (Array.isArray(value)) return value.map((item) => String(item));
    if (typeof value === "string" && value.length > 0) return [value];
    return [];
  }
  if (field.inputType === "boolean") {
    return typeof value === "boolean" ? value : undefined;
  }
  if (field.inputType === "number") {
    return typeof value === "number" ? value : undefined;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function normalizeWriteValue(value: AiConfigFormValue, field: AiConfigFormField): unknown {
  if (field.inputType === "boolean") return Boolean(value);
  if (field.inputType === "number") return typeof value === "number" ? value : Number(value);
  if (field.inputType === "list") return Array.isArray(value) ? value : [String(value)];
  return String(value);
}

function readTomlValue(content: string, dottedPath: string): unknown {
  const lines = content.split(/\r?\n/u);
  let section = "";
  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[([A-Za-z0-9_.-]+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1]!;
      continue;
    }

    const entryMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u);
    if (!entryMatch) continue;
    const key = entryMatch[1]!;
    const fullKey = section ? `${section}.${key}` : key;
    if (fullKey === dottedPath) {
      return parseTomlScalar(entryMatch[2]!.trim());
    }
  }
  return undefined;
}

function writeTomlValue(
  content: string,
  dottedPath: string,
  value: unknown,
  field: AiConfigFormField
): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/u);
  const replacement = formatTomlAssignment(tomlLeafKey(dottedPath), value, field);
  let section = "";

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    const sectionMatch = trimmed.match(/^\[([A-Za-z0-9_.-]+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1]!;
      continue;
    }

    const entryMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/u);
    if (!entryMatch) continue;
    const key = entryMatch[1]!;
    const fullKey = section ? `${section}.${key}` : key;
    if (fullKey === dottedPath) {
      lines[index] = replacement;
      return withTrailingNewline(lines.join(newline), newline);
    }
  }

  return insertTomlValue(lines, dottedPath, replacement, newline);
}

function insertTomlValue(
  lines: string[],
  dottedPath: string,
  replacement: string,
  newline: string
): string {
  const sectionName = tomlSectionName(dottedPath);
  if (!sectionName) {
    const firstSectionIndex = lines.findIndex((line) => /^\[[^\]]+\]$/u.test(line.trim()));
    const insertIndex = firstSectionIndex === -1 ? trimTrailingEmptyLines(lines).length : firstSectionIndex;
    const nextLines = [...lines];
    nextLines.splice(insertIndex, 0, replacement);
    return withTrailingNewline(trimTrailingEmptyLines(nextLines).join(newline), newline);
  }

  const sectionIndex = lines.findIndex((line) => line.trim() === `[${sectionName}]`);
  if (sectionIndex === -1) {
    const baseLines = trimTrailingEmptyLines(lines);
    const separator = baseLines.length > 0 ? [""] : [];
    return withTrailingNewline([...baseLines, ...separator, `[${sectionName}]`, replacement].join(newline), newline);
  }

  let insertIndex = lines.length;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (/^\[[^\]]+\]$/u.test(lines[index]!.trim())) {
      insertIndex = index;
      break;
    }
  }
  const nextLines = [...lines];
  nextLines.splice(insertIndex, 0, replacement);
  return withTrailingNewline(trimTrailingEmptyLines(nextLines).join(newline), newline);
}

function formatTomlAssignment(key: string, value: unknown, field: AiConfigFormField): string {
  return `${key} = ${formatTomlValue(value, field)}`;
}

function formatTomlValue(value: unknown, field: AiConfigFormField): string {
  if (field.inputType === "boolean") return value ? "true" : "false";
  if (field.inputType === "number") return String(value);
  if (field.inputType === "list") {
    const values = Array.isArray(value) ? value : [String(value)];
    return `[${values.map((item) => quoteTomlString(String(item))).join(", ")}]`;
  }
  return quoteTomlString(String(value));
}

function parseTomlScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => parseTomlScalar(item.trim()));
  }
  const quoted = value.match(/^"([\s\S]*)"$/u);
  if (quoted) {
    return quoted[1]!.replace(/\\"/gu, "\"").replace(/\\\\/gu, "\\");
  }
  return value;
}

function quoteTomlString(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"")}"`;
}

function tomlSectionName(dottedPath: string): string | undefined {
  const segments = dottedPath.split(".");
  if (segments.length <= 1) return undefined;
  return segments.slice(0, -1).join(".");
}

function tomlLeafKey(dottedPath: string): string {
  return dottedPath.split(".").at(-1) ?? dottedPath;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  const nextLines = [...lines];
  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }
  return nextLines;
}

function withTrailingNewline(content: string, newline: string): string {
  return content.endsWith(newline) ? content : `${content}${newline}`;
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
