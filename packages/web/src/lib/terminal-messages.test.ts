import { describe, expect, it } from "vitest";

import { createTerminalInputMessage, createTerminalResizeMessage } from "./terminal-messages";

describe("terminal websocket messages", () => {
  it("serializes terminal input messages", () => {
    expect(createTerminalInputMessage("ls\n")).toBe(
      JSON.stringify({ type: "terminal_input", payload: { data: "ls\n" } })
    );
  });

  it("serializes valid terminal resize messages", () => {
    expect(createTerminalResizeMessage({ cols: 120, rows: 40 })).toBe(
      JSON.stringify({ type: "terminal_resize", payload: { cols: 120, rows: 40 } })
    );
  });

  it("does not serialize terminal resize messages with invalid dimensions", () => {
    expect(createTerminalResizeMessage({ cols: 0, rows: 40 })).toBeNull();
    expect(createTerminalResizeMessage({ cols: 120, rows: 0 })).toBeNull();
    expect(createTerminalResizeMessage({ cols: Number.NaN, rows: 40 })).toBeNull();
    expect(createTerminalResizeMessage({ cols: 120, rows: Number.POSITIVE_INFINITY })).toBeNull();
    expect(createTerminalResizeMessage({ cols: 120.5, rows: 40 })).toBeNull();
    expect(createTerminalResizeMessage({ cols: 501, rows: 40 })).toBeNull();
    expect(createTerminalResizeMessage({ cols: 120, rows: 201 })).toBeNull();
  });
});
