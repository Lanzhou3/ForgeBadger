import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authenticateTerminalRequest,
  TerminalHeartbeat,
  TerminalInputRateLimiter,
  parseTerminalMessage,
  TerminalConnectionRegistry,
  validateTerminalAccess
} from "../src/websocket/terminal.js";
import { signJwt } from "../src/auth/index.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";

describe("parseTerminalMessage", () => {
  it("accepts terminal input messages", () => {
    const message = parseTerminalMessage(
      JSON.stringify({ type: "terminal_input", payload: { data: "ls\n" } })
    );

    assert.deepEqual(message, {
      type: "terminal_input",
      payload: { data: "ls\n" }
    });
  });

  it("accepts terminal resize messages", () => {
    const message = parseTerminalMessage(
      JSON.stringify({
        type: "terminal_resize",
        payload: { cols: 120, rows: 40 }
      })
    );

    assert.deepEqual(message, {
      type: "terminal_resize",
      payload: { cols: 120, rows: 40 }
    });
  });

  it("rejects invalid terminal resize dimensions", () => {
    assert.throws(
      () =>
        parseTerminalMessage(
          JSON.stringify({
            type: "terminal_resize",
            payload: { cols: -1, rows: 9999 }
          })
        ),
      /malformed/i
    );
  });

  it("rejects malformed messages", () => {
    assert.throws(() => parseTerminalMessage("{"), /malformed/i);
  });

  it("rejects messages over the size limit", () => {
    assert.throws(() => parseTerminalMessage("x".repeat(20), 10), /too large/i);
  });
});

describe("TerminalConnectionRegistry", () => {
  it("closes the previous socket for the same session", () => {
    const closed: string[] = [];
    const registry = new TerminalConnectionRegistry();

    registry.register("session-1", {
      close(code, reason) {
        closed.push(`${code}:${reason}`);
      }
    });
    registry.register("session-1", {
      close() {
        closed.push("new closed");
      }
    });

    assert.deepEqual(closed, ["4000:terminal connection replaced"]);
  });
});

describe("validateTerminalAccess", () => {
  it("requires the per-session attach token in addition to user ownership", () => {
    assert.equal(
      validateTerminalAccess(
        { userId: "gate-a-user", attachToken: "token_a" },
        { userId: "gate-a-user", attachToken: "wrong" }
      ),
      false
    );
    assert.equal(
      validateTerminalAccess(
        { userId: "gate-a-user", attachToken: "token_a" },
        { userId: "gate-a-user", attachToken: "token_a" }
      ),
      true
    );
  });
});

describe("authenticateTerminalRequest", () => {
  it("authenticates terminal access from a valid JWT and attach token", () => {
    const authToken = signJwt(
      { userId: "user_123", email: "test@example.com" },
      jwtSecret
    );

    assert.equal(
      authenticateTerminalRequest(
        {
          userId: "user_123",
          attachToken: "attach_123"
        },
        {
          authToken,
          attachToken: "attach_123",
          jwtSecret
        }
      ),
      true
    );
  });

  it("rejects terminal access when JWT user does not own the session", () => {
    const authToken = signJwt(
      { userId: "user_other", email: "other@example.com" },
      jwtSecret
    );

    assert.equal(
      authenticateTerminalRequest(
        {
          userId: "user_123",
          attachToken: "attach_123"
        },
        {
          authToken,
          attachToken: "attach_123",
          jwtSecret
        }
      ),
      false
    );
  });
});

describe("TerminalInputRateLimiter", () => {
  it("allows up to the configured messages per second", () => {
    const limiter = new TerminalInputRateLimiter({ maxMessages: 2, windowMs: 1000 });

    assert.equal(limiter.consume(1000), true);
    assert.equal(limiter.consume(1000), true);
    assert.equal(limiter.consume(1000), false);
    assert.equal(limiter.consume(2001), true);
  });
});

describe("TerminalHeartbeat", () => {
  it("reports timeout when no pong is received within the timeout window", () => {
    const heartbeat = new TerminalHeartbeat({ timeoutMs: 90_000, now: 1000 });

    assert.equal(heartbeat.isTimedOut(90_999), false);
    assert.equal(heartbeat.isTimedOut(91_001), true);
    heartbeat.recordPong(91_500);
    assert.equal(heartbeat.isTimedOut(100_000), false);
  });
});
