import { describe, expect, it } from "vitest";

import { parseTerminalWebSocketMessage } from "./terminal-websocket-messages";

describe("parseTerminalWebSocketMessage", () => {
  it("returns terminal output messages", () => {
    expect(
      parseTerminalWebSocketMessage(
        JSON.stringify({
          type: "terminal_output",
          payload: { data: "hello" }
        })
      )
    ).toEqual({
      type: "terminal_output",
      payload: { data: "hello" }
    });
  });

  it("returns terminal history messages", () => {
    expect(
      parseTerminalWebSocketMessage(
        JSON.stringify({
          type: "terminal_history",
          payload: { data: "scrolled-off lines" }
        })
      )
    ).toEqual({
      type: "terminal_history",
      payload: { data: "scrolled-off lines" }
    });
  });

  it("returns null for malformed frames instead of throwing", () => {
    expect(parseTerminalWebSocketMessage("not json")).toBeNull();
    expect(parseTerminalWebSocketMessage(JSON.stringify({ type: "terminal_output" }))).toBeNull();
    expect(parseTerminalWebSocketMessage(JSON.stringify({ type: "terminal_history" }))).toBeNull();
    expect(parseTerminalWebSocketMessage(JSON.stringify({ type: "unknown", payload: {} }))).toBeNull();
  });
});

it("preserves valid output sequence numbers and rejects malformed sequences", () => {
  for (const type of ["terminal_output", "terminal_history"]) {
    expect(parseTerminalWebSocketMessage(JSON.stringify({ type, payload: { data: "x", sequence: 1 } })))
      .toEqual({ type, payload: { data: "x", sequence: 1 } });
    for (const sequence of [-1, 0, 1.5, "1"]) {
      expect(parseTerminalWebSocketMessage(JSON.stringify({ type, payload: { data: "x", sequence } }))).toBeNull();
    }
  }
});
it("recognizes process exit messages", () => {
  expect(parseTerminalWebSocketMessage(JSON.stringify({ type: "terminal_exit", payload: { exitCode: 0 } })))
    .toEqual({ type: "terminal_exit", payload: { exitCode: 0 } });
});
