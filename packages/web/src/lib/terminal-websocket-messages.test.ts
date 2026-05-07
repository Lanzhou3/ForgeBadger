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

  it("returns null for malformed frames instead of throwing", () => {
    expect(parseTerminalWebSocketMessage("not json")).toBeNull();
    expect(parseTerminalWebSocketMessage(JSON.stringify({ type: "terminal_output" }))).toBeNull();
    expect(parseTerminalWebSocketMessage(JSON.stringify({ type: "unknown", payload: {} }))).toBeNull();
  });
});
