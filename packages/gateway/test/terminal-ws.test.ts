import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import WebSocket from "ws";

import {
  authenticateTerminalRequest,
  TerminalHeartbeat,
  TerminalInputRateLimiter,
  TerminalResizeBuffer,
  parseTerminalMessage,
  TerminalConnectionRegistry,
  validateTerminalAccess
} from "../src/websocket/terminal.js";
import { createGatewayApp } from "../src/server.js";
import { WebSocketConnectionLimits } from "../src/websocket/connection-limits.js";
import { extractWsAuthToken } from "../src/websocket/auth.js";
import { signJwt } from "../src/auth/index.js";
import { OpenForgeEventBus } from "../src/services/event-bus.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "0123456789abcdef0123456789abcdef";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

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
    assert.equal(
      authenticateTerminalRequest(
        {
          userId: "user_123",
          attachToken: "attach_123"
        },
        {
          authTokenUserId: "user_123",
          attachToken: "attach_123"
        }
      ),
      true
    );
  });

  it("rejects terminal access when JWT user does not own the session", () => {
    assert.equal(
      authenticateTerminalRequest(
        {
          userId: "user_123",
          attachToken: "attach_123"
        },
        {
          authTokenUserId: "user_other",
          attachToken: "attach_123"
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

describe("TerminalResizeBuffer", () => {
  it("applies the latest resize received before pty attach", () => {
    const calls: Array<{ cols: number; rows: number }> = [];
    const resizeBuffer = new TerminalResizeBuffer();

    resizeBuffer.applyOrStore(undefined, 140, 42);
    resizeBuffer.applyOrStore(undefined, 180, 50);
    resizeBuffer.flush({
      resize(cols, rows) {
        calls.push({ cols, rows });
      }
    });

    assert.deepEqual(calls, [{ cols: 180, rows: 50 }]);
  });

  it("applies resize immediately after pty attach", () => {
    const calls: Array<{ cols: number; rows: number }> = [];
    const resizeBuffer = new TerminalResizeBuffer();

    resizeBuffer.applyOrStore(
      {
        resize(cols, rows) {
          calls.push({ cols, rows });
        }
      },
      160,
      44
    );

    assert.deepEqual(calls, [{ cols: 160, rows: 44 }]);
  });
});

describe("extractWsAuthToken", () => {
  it("prefers Authorization header over protocol token", () => {
    const token = extractWsAuthToken(
      {
        authorization: "Bearer header-token",
        "sec-websocket-protocol": "openforge-terminal, protocol-token"
      },
      "openforge-terminal"
    );
    assert.equal(token, "header-token");
  });

  it("extracts token from protocol list when header is absent", () => {
    const token = extractWsAuthToken(
      {
        "sec-websocket-protocol": "openforge-terminal, protocol-token"
      },
      "openforge-terminal"
    );
    assert.equal(token, "protocol-token");
  });

  it("returns undefined when protocol token is missing", () => {
    const token = extractWsAuthToken(
      {
        "sec-websocket-protocol": "openforge-terminal"
      },
      "openforge-terminal"
    );
    assert.equal(token, undefined);
  });
});

describe("WebSocket connection limits", () => {
  it("enforces per-user limit", () => {
    const limiter = new WebSocketConnectionLimits<WebSocket>({
      maxGlobalConnections: 10,
      maxConnectionsPerUser: 1
    });

    assert.equal(limiter.tryAcquire({ close() {} } as WebSocket, "user-a").accepted, true);
    assert.equal(limiter.tryAcquire({ close() {} } as WebSocket, "user-a").accepted, false);
  });

  it("enforces global limit", () => {
    const limiter = new WebSocketConnectionLimits<WebSocket>({
      maxGlobalConnections: 1,
      maxConnectionsPerUser: 10
    });

    assert.equal(limiter.tryAcquire({ close() {} } as WebSocket, "user-a").accepted, true);
    assert.equal(limiter.tryAcquire({ close() {} } as WebSocket, "user-b").accepted, false);
  });
});

describe("terminal websocket authentication", () => {
  it("does not read auth token from query params", async () => {
    const db = createTestDb();
    const eventBus = new OpenForgeEventBus();
    const sessionManager = new InMemorySessionManager({
      async createSession() {},
      async killSession() {},
      async capturePane() {
        return "";
      },
      async listSessions() {
        return [];
      }
    });
    const apiKeyStore = new InMemoryApiKeyStore({ masterKey });
    const app = createGatewayApp({
      db,
      jwtSecret,
      masterKey,
      sessionManager,
      apiKeyStore,
      eventBus
    });

    let serverUrl: string;
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => {
        const address = app.server.address();
        if (address && typeof address === "object") {
          serverUrl = `ws://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });

    const token = signJwt({ userId: "user_123", email: "test@example.com" }, jwtSecret);
    const ws = new WebSocket(
      `${serverUrl}/ws/terminal/session-123?attachToken=attach-123&authToken=${token}`
    );

    const result = await new Promise<{ code: number }>((resolve) => {
      ws.on("close", (code) => resolve({ code }));
      ws.on("error", () => resolve({ code: 1006 }));
    });

    assert.equal(result.code, 1006);
    await new Promise<void>((resolve) => app.server.close(resolve));
    db.close();
  });

  it("accepts secure header auth and rejects missing terminal session with not found", async () => {
    const db = createTestDb();
    const eventBus = new OpenForgeEventBus();
    const sessionManager = new InMemorySessionManager({
      async createSession() {},
      async killSession() {},
      async capturePane() {
        return "";
      },
      async listSessions() {
        return [];
      }
    });
    const apiKeyStore = new InMemoryApiKeyStore({ masterKey });
    const app = createGatewayApp({
      db,
      jwtSecret,
      masterKey,
      sessionManager,
      apiKeyStore,
      eventBus
    });

    let serverUrl: string;
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => {
        const address = app.server.address();
        if (address && typeof address === "object") {
          serverUrl = `ws://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });

    const token = signJwt({ userId: "user_123", email: "test@example.com" }, jwtSecret);
    const ws = new WebSocket(`${serverUrl}/ws/terminal/session-123?attachToken=attach-123`, {
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    const result = await new Promise<{ code: number }>((resolve) => {
      ws.on("close", (code) => resolve({ code }));
      ws.on("error", () => resolve({ code: 1006 }));
    });

    assert.equal(result.code, 4404);
    await new Promise<void>((resolve) => app.server.close(resolve));
    db.close();
  });
});
