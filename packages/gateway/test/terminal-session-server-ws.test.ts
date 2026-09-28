/**
 * P2 WebSocket semantics for session-server transport loss:
 * when the Session Server drops the I/O stream (daemon crash), the terminal
 * WebSocket closes with 1011 ("session server unreachable") — it must not
 * send terminal_exit and must not reconcile the session to exited.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import WebSocket from "ws";

import { createGatewayApp } from "../src/server.js";
import { signJwt } from "../src/auth/index.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { SessionServer } from "../src/services/session-server/session-server.js";
import { IpcServer } from "../src/services/session-server/ipc-server.js";
import { SessionServerClient } from "../src/services/session-server-client.js";
import type { TerminalBackendClient } from "../src/services/terminal-backend.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "0123456789abcdef0123456789abcdef";
const TOKEN = "0123456789abcdef".repeat(4);
const isWin = process.platform === "win32";

const longSession = isWin
  ? { command: "cmd.exe", args: ["/c", "ping -n 60 127.0.0.1"] }
  : { command: "bash", args: ["-c", "sleep 60"] };

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  const now = Date.now();
  db.prepare("INSERT INTO users (id, username, email, password_hash, role, status) VALUES ('u1','u1','u1@example.test','x','user','active')").run();
  db.prepare("INSERT INTO projects (id,user_id,name,path,ai_tool,status,created_at,updated_at) VALUES ('p1','u1','P1','/tmp/p1','codex','active',?,?)").run(now, now);
  db.prepare("INSERT INTO sessions (id,user_id,project_id,name,ai_tool,status,attach_token,working_dir,credential_mode) VALUES ('s1','u1','p1','S1','codex','running','tok','/tmp/p1','host_environment')").run();
  return db;
}

describe("terminal WS on session-server transport loss", () => {
  it("closes with 1011 and never sends terminal_exit", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "fb-ss-ws-"));
    const ipcPath = isWin
      ? `\\\\.\\pipe\\fb-ss-ws-${process.pid}-${Date.now()}`
      : join(cwd, "server.sock");

    // In-process daemon: a real session the WS handler can attach to.
    const sessionServer = new SessionServer();
    const ipcServer = new IpcServer({ ipcPath, sessionServer, token: TOKEN });
    await ipcServer.start();
    await new Promise((r) => setTimeout(r, 150));

    const backendClient = new SessionServerClient({ ipcPath, token: TOKEN });
    await backendClient.connect();

    const db = createTestDb();
    const sessionManager = new InMemorySessionManager(backendClient as TerminalBackendClient);
    const created = await sessionManager.createSession({
      userId: "u1",
      sessionId: "s1",
      attachToken: "tok",
      launchPlan: {
        ...longSession,
        cwd,
        env: {},
        secretEnvNames: [],
        credentialMode: "host_environment"
      }
    });

    const app = createGatewayApp({
      db,
      jwtSecret,
      masterKey,
      sessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      eventBus: new ForgeBadgerEventBus(),
      sessionServerIpcPath: ipcPath,
      sessionServerToken: TOKEN
    });

    let serverUrl = "";
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => {
        const address = app.server.address();
        if (address && typeof address === "object") {
          serverUrl = `ws://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });

    try {
      const jwt = signJwt({ userId: "u1", email: "u1@example.test" }, jwtSecret);
      const ws = new WebSocket(`${serverUrl}/ws/terminal/s1`, ["forgebadger-terminal", jwt, "tok"]);

      const messages: string[] = [];
      ws.on("message", (raw) => messages.push(raw.toString()));

      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
        ws.once("close", () => reject(new Error("closed before open")));
      });

      // Wait until the WS handler has actually attached its I/O stream —
      // stopping the server earlier would test the attach-failure path, not
      // the transport-loss path.
      const attachStart = Date.now();
      while (sessionServer.getSession(created.runtimeSessionName)?.clientCount !== 1) {
        if (Date.now() - attachStart > 5000) {
          throw new Error("timed out waiting for the WS attach");
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      const closePromise = new Promise<number>((resolve) => {
        ws.on("close", (code) => resolve(code));
      });

      // Simulate a daemon crash: drop all IPC connections without session_exit.
      await ipcServer.stop();

      const closeCode = await closePromise;

      assert.equal(closeCode, 1011, "transport loss must close the WS with 1011");
      const sentTerminalExit = messages.some((m) => m.includes("\"terminal_exit\""));
      assert.equal(sentTerminalExit, false, "transport loss must never send terminal_exit");
      // The crash must not have been reconciled to a fake exit.
      assert.equal(sessionManager.getSession("s1")?.status, created.status);
    } finally {
      await new Promise<void>((resolve) => {
        app.server.closeAllConnections?.();
        app.server.close(() => resolve());
      });
      await backendClient.disconnect().catch(() => {});
      await sessionServer.destroy();
      db.close();
      try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
