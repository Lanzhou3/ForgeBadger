import { describe, expect, it } from "vitest";
import { terminalAltArrowInput } from "./terminal-alt-arrows";

const optionUp = {
  type: "keydown", key: "ArrowUp", altKey: true, ctrlKey: false,
  metaKey: false, shiftKey: false, isComposing: false,
};

describe("macOS terminal Option arrows", () => {
  it.each([["ArrowUp", "\x1b[1;3A"], ["ArrowDown", "\x1b[1;3B"]])(
    "preserves the Alt modifier for %s", (key, expected) => {
      expect(terminalAltArrowInput({ ...optionUp, key }, "MacIntel")).toBe(expected);
    },
  );
  it.each([
    { type: "keyup" }, { type: "keypress" }, { key: "ArrowLeft" },
    { key: "a" }, { altKey: false }, { ctrlKey: true },
    { metaKey: true }, { shiftKey: true }, { isComposing: true },
  ])("leaves other input to xterm: %j", (change) => {
    expect(terminalAltArrowInput({ ...optionUp, ...change }, "MacIntel")).toBeNull();
  });
  it.each(["Win32", "Linux x86_64", "iPhone"])("preserves %s behavior", (platform) => {
    expect(terminalAltArrowInput(optionUp, platform)).toBeNull();
  });
});
