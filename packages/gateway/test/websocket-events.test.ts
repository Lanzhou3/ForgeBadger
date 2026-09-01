import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import WebSocket from "ws";

import { createGatewayApp, createServer } from "../src/server.js";
import { attachEventsWebSocket } from "../src/websocket/events.js";
import { signJwt } from "../src/auth/jwt.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { RuntimeAuthorizationInvalidator } from "../src/services/runtime-authorization-invalidation.js";
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

/** The events WS auth path re-checks that the JWT subject is an active user. */
function seedActiveUsers(db: Database): void {
  const insertUser = db.prepare(
    "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
  );
  insertUser.run("user_123", "ws-events-123", "test@example.com", "hash", "user", "active");
  insertUser.run("user_a", "ws-events-a", "a@example.com", "hash", "user", "active");
  insertUser.run("user_b", "ws-events-b", "b@example.com", "hash", "user", "active");
}

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout waiting for message"));
    }, timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(String(data));
    });
  });
}

function waitForClose(ws: WebSocket, timeoutMs = 2000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout waiting for close"));
    }, timeoutMs);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: String(reason) });
    });
  });
}

describe("events WebSocket", () => {
  let db: Database;
  let app: ReturnType<typeof createGatewayApp>;
  let serverUrl: string;

  beforeEach(async () => {
    db = createTestDb();
    // The events WS auth path re-checks that the JWT subject is an active user.
    seedActiveUsers(db);
    const eventBus = new ForgeBadgerEventBus();
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

    app = createGatewayApp({
      db,
      jwtSecret,
      masterKey,
      sessionManager,
      apiKeyStore,
      eventBus,
      runtimeAuthorizationInvalidator: new RuntimeAuthorizationInvalidator()
    });

    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => {
        const address = app.server.address();
        if (address && typeof address === "object") {
          serverUrl = `ws://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      app.server.close(() => {
        db.close();
        resolve();
      });
    });
  });

  it("connection with valid JWT succeeds", async () => {
    const token = signJwt({ userId: "user_123", email: "test@example.com" }, jwtSecret);
    const ws = new WebSocket(`${serverUrl}/ws/events`, ["forgebadger-events", token]);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Connection timeout")), 2000);
      ws.on("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const closePromise = waitForClose(ws);
    ws.close();
    await closePromise;
  });

  it("accepts token through Authorization header", async () => {
    const token = signJwt({ userId: "user_123", email: "test@example.com" }, jwtSecret);
    const ws = new WebSocket(`${serverUrl}/ws/events`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Connection timeout")), 2000);
      ws.on("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const closePromise = waitForClose(ws);
    ws.close();
    await closePromise;
  });

  it("connection without JWT fails", async () => {
    const ws = new WebSocket(`${serverUrl}/ws/events`);
    const result = await new Promise<{ code: number; error: boolean }>((resolve) => {
      ws.on("error", () => {
        resolve({ code: 1006, error: true });
      });
      ws.on("close", (code) => {
        resolve({ code, error: false });
      });
    });
    assert.equal(result.code, 1006);
  });

  it("events are received by the correct user only", async () => {
    const tokenA = signJwt({ userId: "user_a", email: "a@example.com" }, jwtSecret);
    const tokenB = signJwt({ userId: "user_b", email: "b@example.com" }, jwtSecret);

    const wsA = new WebSocket(`${serverUrl}/ws/events`, ["forgebadger-events", tokenA]);
    const wsB = new WebSocket(`${serverUrl}/ws/events`, ["forgebadger-events", tokenB]);

    await Promise.all([
      new Promise<void>((resolve) => wsA.once("open", resolve)),
      new Promise<void>((resolve) => wsB.once("open", resolve))
    ]);

    app.eventBus.emitEvent({
      type: "session_status_changed",
      userId: "user_a",
      sessionId: "session_1",
      oldStatus: "pending",
      newStatus: "running"
    });

    const messageA = await waitForMessage(wsA);
    const parsedA = JSON.parse(messageA);
    assert.equal(parsedA.type, "session_status_changed");
    assert.equal(parsedA.payload.session_id, "session_1");

    // User B should not receive the event; set up a short timeout to confirm
    let bReceived = false;
    wsB.once("message", () => {
      bReceived = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(bReceived, false);

    const closeA = waitForClose(wsA);
    const closeB = waitForClose(wsB);
    wsA.close();
    wsB.close();
    await Promise.all([closeA, closeB]);
  });


  it("does not authenticate from query token", async () => {
    const token = signJwt({ userId: "user_123", email: "test@example.com" }, jwtSecret);
    const ws = new WebSocket(`${serverUrl}/ws/events?token=${token}`);
    const result = await new Promise<{ code: number }>((resolve) => {
      ws.on("close", (code) => {
        resolve({ code });
      });
      ws.on("error", () => {
        resolve({ code: 1006 });
      });
    });

    assert.equal(result.code, 1006);
  });
});

describe("events websocket connection limits", () => {
  let db: Database;
  let server: ReturnType<typeof createHttpServer>;
  let serverUrl: string;

  beforeEach(async () => {
    db = createTestDb();
    seedActiveUsers(db);
    const eventBus = new ForgeBadgerEventBus();
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
    const app = createServer({
      db,
      jwtSecret,
      masterKey,
      sessionManager,
      apiKeyStore,
      eventBus
    });

    server = createHttpServer(app);
    attachEventsWebSocket({
      server,
      eventBus,
      jwtSecret,
      db,
      maxConnections: 1,
      maxConnectionsPerUser: 1
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") {
          serverUrl = `ws://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        db.close();
        resolve();
      });
    });
  });

  it("enforces per-user event websocket limits", async () => {
    const tokenA = signJwt({ userId: "user_a", email: "a@example.com" }, jwtSecret);

    const wsA = new WebSocket(`${serverUrl}/ws/events`, ["forgebadger-events", tokenA]);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Connection timeout")), 2000);
      wsA.on("open", () => {
        clearTimeout(timer);
        resolve();
      });
      wsA.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const wsB = new WebSocket(`${serverUrl}/ws/events`, ["forgebadger-events", tokenA]);
    const result = await new Promise<{ code: number }>((resolve) => {
      wsB.on("close", (code) => {
        resolve({ code });
      });
      wsB.on("error", () => {
        resolve({ code: 1006 });
      });
    });

    wsA.close();
    assert.equal(result.code, 1008);
  });
});
