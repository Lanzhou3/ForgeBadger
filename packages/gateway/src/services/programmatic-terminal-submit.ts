import type { AdapterId } from "./adapter-discovery.js";

const NEEDLE_LENGTH = 24;

export const PROGRAMMATIC_SUBMIT_NOT_READY = "PROGRAMMATIC_SUBMIT_NOT_READY";
export const PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH = "PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH";
export const PROGRAMMATIC_SUBMIT_STAGING_FAILED = "PROGRAMMATIC_SUBMIT_STAGING_FAILED";
export const PROGRAMMATIC_SUBMIT_UNSAFE_INPUT = "PROGRAMMATIC_SUBMIT_UNSAFE_INPUT";
export const PROGRAMMATIC_SUBMIT_INDETERMINATE = "PROGRAMMATIC_SUBMIT_INDETERMINATE";

const UNSAFE_PROGRAMMATIC_CONTROL = /[\u0000-\u0008\u000b\u000c\u000d-\u001f\u007f-\u009f]/u;

export function assertSafeProgrammaticMessage(message: string): void {
  if (UNSAFE_PROGRAMMATIC_CONTROL.test(message)) {
    throw new Error(PROGRAMMATIC_SUBMIT_UNSAFE_INPUT);
  }
}

export function stripTerminalControl(input: string): string {
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()#][0-9A-Za-z]/g, "")
    .replace(/\x1b[@-Z\\^_]/g, "")
    .replace(/\x1b/g, "")
    .replace(/\u00a0/g, " ");
}

function normalizeComparable(input: string): string {
  return stripTerminalControl(input).replace(/\s+/g, "");
}

export function programmaticDeliveryNeedle(message: string): string {
  return normalizeComparable(message).slice(0, NEEDLE_LENGTH);
}

function lastIndexMatching(lines: string[], pattern: RegExp): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (pattern.test(lines[index] ?? "")) return index;
  }
  return -1;
}

function codexComposer(lines: string[]): string {
  // While Codex is processing, the last `›` line is the submitted user turn,
  // not an editable composer. The busy footer proves there is no active
  // composer until Codex returns to its empty prompt (or opens queue input).
  if (lines.some((line) => /(?:tab to queue message|esc to interrupt)/i.test(line))) {
    return "";
  }
  const start = lastIndexMatching(lines, /^\s*›(?:\s|$)/);
  if (start < 0) return "";
  return lines.slice(start, Math.min(lines.length, start + 4)).join("\n");
}

function claudeComposer(lines: string[]): string {
  const start = lastIndexMatching(lines, /^\s*❯(?:\s|$)/);
  if (start < 0) return "";
  const selected: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (index > start && /^\s*─{4,}/.test(line)) break;
    selected.push(line);
  }
  return selected.join("\n");
}

function opencodeComposer(lines: string[]): string {
  const composerLines = lines
    .filter((line) => /^\s*┃/.test(line))
    .map((line) => line.replace(/^\s*┃\s?/, ""))
    .filter((line) => line.trim() !== "" && !/^Build\s+·/.test(line.trim()));
  if (composerLines.some((line) => line.includes("Ask anything..."))) return "";
  return composerLines.join("\n");
}

function kimiComposer(lines: string[]): string {
  const start = lastIndexMatching(lines, /^\s*│\s*>/);
  if (start < 0) return "";
  const selected: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/^\s*│/.test(line)) break;
    selected.push(line.replace(/^\s*│\s*>?\s?/, "").replace(/\s*│\s*$/, ""));
  }
  return selected.join("\n");
}

export function currentProgrammaticComposer(adapter: AdapterId, pane: string): string {
  const lines = stripTerminalControl(pane).split("\n");
  switch (adapter) {
    case "codex":
      return codexComposer(lines);
    case "claude":
      return claudeComposer(lines);
    case "opencode":
      return opencodeComposer(lines);
    case "kimi":
      return kimiComposer(lines);
  }
}

export function isProgrammaticComposerReady(adapter: AdapterId, pane: string): boolean {
  const plain = stripTerminalControl(pane);
  const composer = currentProgrammaticComposer(adapter, plain);
  switch (adapter) {
    case "codex":
      return /›\s+Ask Codex to do anything/.test(composer);
    case "claude":
      return /^\s*❯\s*$/m.test(composer) && /─{4,}/.test(plain);
    case "opencode":
      return /Ask anything\.\.\./.test(plain) && composer === "";
    case "kimi":
      return /^\s*│\s*>\s*.*│\s*$/m.test(plain) && normalizeComparable(composer) === "" && /context:\s*\d+%/i.test(plain);
  }
}

export function composerContainsNeedle(adapter: AdapterId, pane: string, needle: string): boolean {
  return needle !== "" && normalizeComparable(currentProgrammaticComposer(adapter, pane)).includes(needle);
}

export function composerContainsStagedTask(
  adapter: AdapterId,
  pane: string,
  message: string,
  needle: string
): boolean {
  if (composerContainsNeedle(adapter, pane, needle)) return true;
  if (adapter !== "codex") return false;

  // Codex collapses pastes over its large-paste threshold into a current-
  // composer element like `[Pasted Content 2032 chars]`, while retaining the
  // full payload internally for expansion on submit. Rust's `chars().count()`
  // counts Unicode scalar values, which matches Array.from rather than JS's
  // UTF-16 string length for astral characters.
  const charCount = Array.from(message).length;
  const expectedPlaceholder = `[PastedContent${charCount}chars]`;
  return normalizeComparable(currentProgrammaticComposer(adapter, pane))
    .includes(expectedPlaceholder);
}

export function isProgrammaticTaskConsumed(
  adapter: AdapterId,
  stagedPane: string,
  currentPane: string,
  needle: string
): boolean {
  if (normalizeComparable(currentPane) === normalizeComparable(stagedPane)) return false;
  return !composerContainsNeedle(adapter, currentPane, needle);
}
