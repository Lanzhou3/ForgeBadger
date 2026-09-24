import type { AdapterId } from "./adapter-discovery.js";

const NEEDLE_LENGTH = 24;

export const PROGRAMMATIC_SUBMIT_NOT_READY = "PROGRAMMATIC_SUBMIT_NOT_READY";
export const PROGRAMMATIC_SUBMIT_NATIVE_APPROVAL_REQUIRED = 'PROGRAMMATIC_SUBMIT_NATIVE_APPROVAL_REQUIRED';
export const PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH = "PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH";
export const PROGRAMMATIC_SUBMIT_STAGING_FAILED = "PROGRAMMATIC_SUBMIT_STAGING_FAILED";
export const PROGRAMMATIC_SUBMIT_UNSAFE_INPUT = "PROGRAMMATIC_SUBMIT_UNSAFE_INPUT";
export const PROGRAMMATIC_SUBMIT_INDETERMINATE = "PROGRAMMATIC_SUBMIT_INDETERMINATE";

/** Created only before the first terminal write; safe to wait and retry. */
export class ProgrammaticSubmitNoEffectError extends Error {
  readonly delivery = "not_sent";
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "PROGRAMMATIC_SUBMIT_PRECONDITION_FAILED", { cause });
    this.name = "ProgrammaticSubmitNoEffectError";
    if (cause instanceof Error && "code" in cause) Object.assign(this, { code: cause.code });
  }
}

export interface ProgrammaticConsumptionOptions {
  timeoutMs: number;
  intervalMs: number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_PROGRAMMATIC_CONSUMPTION: Readonly<ProgrammaticConsumptionOptions> = Object.freeze({
  timeoutMs: 4_000,
  intervalMs: 300
});

const UNSAFE_PROGRAMMATIC_CONTROL = /[\u0000-\u0008\u000b\u000c\u000d-\u001f\u007f-\u009f]/u;

export function assertSafeProgrammaticMessage(message: string): void {
  if (UNSAFE_PROGRAMMATIC_CONTROL.test(message)) {
    throw new ProgrammaticSubmitNoEffectError(new Error(PROGRAMMATIC_SUBMIT_UNSAFE_INPUT));
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
  // v0.155.1 also renders "tab to queue message" on an unsubmitted paste;
  // that hint alone is not proof that input was consumed.
  if (lines.some((line) => /esc to interrupt/i.test(line))) {
    return "";
  }
  const start = lastIndexMatching(lines, /^\s*›(?:\s|$)/);
  if (start < 0) return "";
  return lines.slice(start).join("\n");
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

// PI TUI footer (measured 2026-09-20 pi 0.86.0, re-measured 2026-09-21 pi
// 0.86.1, 120x40 production size, live-verified against a real model turn):
// a cwd line above the status line (`0.9%/262k (auto)  <model> • <thinking>`),
// which is the pane's bottom line. Staged composer input renders in one of
// two layouts depending on the pi version:
//   A (0.86.0): BELOW the status line at the very bottom of the screen;
//   B (0.86.1): INSIDE the bordered editor box above the cwd line (the box's
//     bottom border sits directly above the cwd line).
// While the agent runs, the box's top border slot becomes a ` ── ⠦ Working ─…`
// spinner bar (statusIndex-4 in layout B, statusIndex-3 in layout A — both
// inside the footer window below); folded multi-line input shows an
// `↑ N more` marker in the input block. Stale spinner frames from earlier
// turns remain in the scrollback (capturePane returns 500 lines of it), so
// busy/fold matching is restricted to a small window around the status line
// instead of scanning the whole pane.
const PI_STATUS_LINE = /\d+(\.\d+)?%\/\d+[kmKM]/u;
const PI_BUSY_BAR = /Working\s*─+/u;
const PI_FOLD_MARKER = /↑\s*\d+\s*more/u;
// A full-width horizontal rule (the editor box border lines).
const PI_BOX_BORDER = /^\s*─{20,}\s*$/u;
// pi folds a multi-line bracketed paste into a `[paste #N +M lines]` marker
// inside the editor box (observed on pi 0.87.1); the payload is retained
// internally and expanded on submit, so the staged text itself never renders.
// Matched against the whitespace-stripped composer.
const PI_PASTE_MARKER = /\[paste#\d+(?:\+\d+lines?)?\]/u;
// Box-bar/spacer slots above the status line that the busy spinner occupies.
const PI_FOOTER_WINDOW = 4;
// Max interior height when searching upward for the box's top border.
const PI_BOX_MAX_HEIGHT = 20;

function isPiComposerReady(lines: string[]): boolean {
  const statusIndex = lastIndexMatching(lines, PI_STATUS_LINE);
  if (statusIndex < 1) return false;
  const footer = lines.slice(Math.max(0, statusIndex - PI_FOOTER_WINDOW));
  if (footer.some((line) => PI_BUSY_BAR.test(line) || PI_FOLD_MARKER.test(line))) return false;
  return piComposer(lines) === "";
}

function piComposer(lines: string[]): string {
  const statusIndex = lastIndexMatching(lines, PI_STATUS_LINE);
  if (statusIndex < 0) return "";
  // Layout A (pi ≤ 0.86.0): input renders below the status line.
  const below: string[] = [];
  for (const line of lines.slice(statusIndex + 1)) {
    if (PI_FOLD_MARKER.test(line)) continue; // `↑ N more` fold line, not input
    if (PI_BUSY_BAR.test(line)) continue; // spinner bar, not input
    if (line.trim() === "") continue;
    below.push(line.trimStart());
  }
  if (below.length > 0) return below.join("\n");
  // Layout B (pi ≥ 0.86.1): input renders inside the bordered box whose bottom
  // border sits directly above the cwd line (statusIndex-1).
  const bottomBorder = statusIndex - 2;
  if (bottomBorder < 1 || !PI_BOX_BORDER.test(lines[bottomBorder] ?? "")) return "";
  for (let index = bottomBorder - 1; index >= 0; index -= 1) {
    if (PI_BOX_BORDER.test(lines[index] ?? "")) {
      const interior: string[] = [];
      for (let inner = index + 1; inner < bottomBorder; inner += 1) {
        const line = lines[inner] ?? "";
        if (line.trim() === "") continue;
        interior.push(line.trimStart());
      }
      return interior.join("\n");
    }
    if (bottomBorder - index > PI_BOX_MAX_HEIGHT) break;
  }
  return "";
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
    case "pi":
      return piComposer(lines);
  }
}

export function isProgrammaticComposerReady(adapter: AdapterId, pane: string): boolean {
  const plain = stripTerminalControl(pane);
  const composer = currentProgrammaticComposer(adapter, plain);
  switch (adapter) {
    case "codex":
      // Codex renders the empty composer while its model/config is still loading.
      // Input sent in that startup frame can be dropped before the editor is ready.
      return !/model:\s*loading\b/i.test(plain) && /›\s+Ask Codex to do anything/.test(composer);
    case "claude":
      return /^\s*❯\s*$/m.test(composer) && /─{4,}/.test(plain);
    case "opencode":
      return /Ask anything\.\.\./.test(plain) && composer === "";
    case "kimi":
      return /^\s*│\s*>\s*.*│\s*$/m.test(plain) && normalizeComparable(composer) === "" && /context:\s*\d+%/i.test(plain);
    case "pi":
      return isPiComposerReady(plain.split("\n"));
  }
}

export function isProgrammaticNativeApprovalRequired(adapter: AdapterId, pane: string): boolean {
  if (adapter !== 'codex') return false;
  const plain = stripTerminalControl(pane);
  return (/Do you trust the contents of this directory\?/.test(plain) && /Yes, continue/.test(plain))
    || (/^\s*Hooks need review\s*$/m.test(plain) && /Trust all and continue/.test(plain));
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
  const composer = normalizeComparable(currentProgrammaticComposer(adapter, pane));
  if (adapter === "pi") {
    // The ready gate requires an empty composer, so a paste marker found here
    // can only come from the write that was just staged.
    return PI_PASTE_MARKER.test(composer);
  }
  if (adapter !== "codex") return false;

  // Codex collapses pastes over its large-paste threshold into a current-
  // composer element like `[Pasted Content 2032 chars]`, while retaining the
  // full payload internally for expansion on submit. Rust's `chars().count()`
  // counts Unicode scalar values, which matches Array.from rather than JS's
  // UTF-16 string length for astral characters.
  const charCount = Array.from(message).length;
  const expectedPlaceholder = `[PastedContent${charCount}chars]`;
  return composer.includes(expectedPlaceholder);
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

/** Polls only the selected adapter's composer state; it owns no dispatch or terminal authority. */
export async function confirmProgrammaticTaskConsumed(
  capture: () => Promise<string>,
  adapter: AdapterId,
  stagedPane: string,
  needle: string,
  options: ProgrammaticConsumptionOptions
): Promise<boolean> {
  if (needle === "") return false;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (isProgrammaticTaskConsumed(adapter, stagedPane, await capture(), needle)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(options.intervalMs);
  }
}
