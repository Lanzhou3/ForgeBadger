import { describe, expect, it } from "vitest";

import {
  eventsWebSocketUrl,
  eventsWebSocketProtocols,
  terminalWebSocketProtocols,
  terminalWebSocketUrl,
} from "./ws";

describe("terminalWebSocketUrl", () => {
  it("omits both tokens from the URL query string", () => {
    const url = terminalWebSocketUrl("session-1", "http://127.0.0.1:3000");

    expect(url).toBe("ws://127.0.0.1:3000/ws/terminal/session-1");
  });
});

describe("terminalWebSocketProtocols", () => {
  it("carries the attach token in the subprotocol header alongside the auth token", () => {
    const protocols = terminalWebSocketProtocols("jwt-token", "attach-token");
    expect(protocols).toEqual(["forgebadger-terminal", "jwt-token", "attach-token"]);
  });
});

describe("eventsWebSocketUrl", () => {
  it("does not put token in query params for events", () => {
    const url = eventsWebSocketUrl("https://forgebadger.example");

    expect(url).toBe("wss://forgebadger.example/ws/events");
  });
});

describe("eventsWebSocketProtocols", () => {
  it("returns forgebadger-events protocol with auth token", () => {
    const protocols = eventsWebSocketProtocols("jwt-token");
    expect(protocols).toEqual(["forgebadger-events", "jwt-token"]);
  });
});
