import { describe, expect, it } from "vitest";

import { isTerminalWheelInput } from "./terminal-wheel-input";

describe("terminal wheel input detection", () => {
  it("accepts plain and modifier wheel reports", () => {
    expect(isTerminalWheelInput("\x1b[<64;10;5M")).toBe(true); // wheel up
    expect(isTerminalWheelInput("\x1b[<65;10;5m")).toBe(true); // wheel down, release form
    expect(isTerminalWheelInput("\x1b[<68;10;5M")).toBe(true); // shift + up
    expect(isTerminalWheelInput("\x1b[<81;10;5M")).toBe(true); // ctrl + alt + down
  });

  it("accepts multi-report bursts from the codex amplification path", () => {
    expect(isTerminalWheelInput("\x1b[<64;41;13M".repeat(9))).toBe(true);
  });

  it("rejects clicks, drags, moves and keystrokes", () => {
    expect(isTerminalWheelInput("\x1b[<0;10;5M")).toBe(false); // left button press
    expect(isTerminalWheelInput("\x1b[<64;10;5;1006M")).toBe(false); // trailing param
    expect(isTerminalWheelInput("\x1b[M")).toBe(false); // X10 encoding
    expect(isTerminalWheelInput("abc")).toBe(false); // plain text
    expect(isTerminalWheelInput("")).toBe(false); // empty chunk
    expect(isTerminalWheelInput("a\x1b[<64;10;5M")).toBe(false); // wheel mixed with a key
  });
});
