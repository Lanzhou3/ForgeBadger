import { describe, expect, it } from "vitest";

import {
  eventsWebSocketUrl,
  eventsWebSocketProtocols,
  terminalWebSocketProtocols,
  terminalWebSocketUrl,
} from "./ws";

describe("terminalWebSocketUrl", () => {
  it("puts attachToken in query params and omits authToken from URL", () => {
    const url = terminalWebSocketUrl(
      "session-1",
      { authToken: "jwt-token", attachToken: "attach-token" },
      "http://127.0.0.1:3000"
    );

    expect(url).toBe(
      "ws://127.0.0.1:3000/ws/terminal/session-1?attachToken=attach-token"
    );
  });
});

describe("terminalWebSocketProtocols", () => {
  it("returns openforge-terminal protocol with auth token", () => {
    const protocols = terminalWebSocketProtocols("jwt-token");
    expect(protocols).toEqual(["openforge-terminal", "jwt-token"]);
  });
});

describe("eventsWebSocketUrl", () => {
  it("does not put token in query params for events", () => {
    const url = eventsWebSocketUrl("https://openforge.example");

    expect(url).toBe("wss://openforge.example/ws/events");
  });
});

describe("eventsWebSocketProtocols", () => {
  it("returns openforge-events protocol with auth token", () => {
    const protocols = eventsWebSocketProtocols("jwt-token");
    expect(protocols).toEqual(["openforge-events", "jwt-token"]);
  });
});
