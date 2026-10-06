// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { copySelectedTerminalText, getTerminalBufferText, shouldCopyTerminalSelection } from "./terminal-copy";

function keyboardEvent(options: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyboardEvent {
  return options as KeyboardEvent;
}

describe("terminal copy shortcuts", () => {
  it("copies selected terminal text for platform copy shortcuts", () => {
    expect(
      shouldCopyTerminalSelection(keyboardEvent({ key: "c", ctrlKey: true }), true)
    ).toBe(true);
    expect(
      shouldCopyTerminalSelection(keyboardEvent({ key: "C", metaKey: true }), true)
    ).toBe(true);
  });

  it("keeps terminal Ctrl+C input when no text is selected", () => {
    expect(
      shouldCopyTerminalSelection(keyboardEvent({ key: "c", ctrlKey: true }), false)
    ).toBe(false);
  });

  it("does not treat modified shortcuts as copy", () => {
    expect(
      shouldCopyTerminalSelection(
        keyboardEvent({ key: "c", ctrlKey: true, shiftKey: true }),
        true
      )
    ).toBe(false);
  });
});

describe("terminal clipboard boundaries", () => {
  it("handles denied clipboard access without rejecting or changing the selection", async () => {
    const selection = { getSelection: () => "selected", hasSelection: () => true };
    await expect(copySelectedTerminalText(selection, { writeText: vi.fn().mockRejectedValue(new Error("denied")) })).resolves.toBe(false);
    expect(selection.getSelection()).toBe("selected");
  });

  it("falls back to legacy copy and restores focus when the Clipboard API is unavailable", async () => {
    const input = document.createElement("input"); document.body.appendChild(input); input.focus();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    try {
      expect(await copySelectedTerminalText({ getSelection: () => "fallback", hasSelection: () => true }, undefined)).toBe(true);
      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(document.activeElement).toBe(input);
      expect(document.querySelector("textarea")).toBeNull();
    } finally { input.remove(); Reflect.deleteProperty(document, "execCommand"); }
  });

  it("copies a snapshot of text even when the user changes the selection while the write is pending", async () => {
    let selection = "original", complete!: () => void;
    const writeText = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const promise = copySelectedTerminalText({ getSelection: () => selection, hasSelection: () => true }, { writeText });
    selection = "new selection"; complete();
    expect(await promise).toBe(true);
    expect(writeText).toHaveBeenCalledWith("original");
    expect(selection).toBe("new selection");
  });

  it("reads all visible buffer text without altering a selection, joins soft wraps and preserves spaces", () => {
    const lines = [
      { text: "scrollback", isWrapped: false },
      { text: "abc   ", isWrapped: false },
      { text: "def", isWrapped: true },
      { text: "中文 🦡", isWrapped: false },
      { text: "", isWrapped: false },
      { text: "", isWrapped: false },
    ];
    const source = { cols: 80, buffer: { active: { length: lines.length, getLine: (index: number) => {
      const line = lines[index];
      return line && { isWrapped: line.isWrapped, translateToString: () => line.text };
    } } } };
    expect(getTerminalBufferText(source)).toBe("scrollback\nabc   def\n中文 🦡");
  });

  it("omits empty cell padding before a wide character that wraps onto the next row", () => {
    const lines = [
      { isWrapped: false, translateToString: (trim = false) => trim ? "abc" : "abc " },
      { isWrapped: true, translateToString: () => "中文" },
    ];
    expect(getTerminalBufferText({ cols: 4, buffer: { active: { length: 2, getLine: index => lines[index] } } })).toBe("abc中文");
  });
});
