/**
 * P3 WebSocket attach semantics on the session-server transport:
 *   - attach to a session the daemon does not have -> explicit terminal_error
 *     and a close code, never a silent black screen
 *   - successful attach -> the ack's rendered snapshot arrives as the first
 *     terminal_history frame, live output follows (no double history replay)
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

let testCounter = 0;
function uniqueIpcPath(): string {
  testCounter += 1;
  return isWin
    ? `\\\\.\\pipe\\fb-ss-attach-${process.pid}-${Date.now()}-${testCounter}`
    : join(mkdtempSync(join(tmpdir(), "fb-ss-attach-")), "server.sock");
}

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

interface WsHarness {
  url: string;
  close: () => Promise<void>;
}

async function startGateway(sessionManager: InMemorySessionManager, ipcPath: string): Promise<WsHarness> {
  const db = createTestDb();
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
  const url = await new Promise<string>((resolve) => {
    app.server.listen(0, "127.0.0.1", () => {
      const address = app.server.address();
      resolve(`ws://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`);
    });
  });
  return {
    url,
    close: () => new Promise<void>((resolve) => {
      app.server.closeAllConnections?.();
      app.server.close(() => {
        db.close();
        resolve();
      });
    })
  };
}

function connectTerminalWs(url: string): WebSocket {
  const jwt = signJwt({ userId: "u1", email: "u1@example.test" }, jwtSecret);
  return new WebSocket(`${url}/ws/terminal/s1`, ["forgebadger-terminal", jwt, "tok"]);
}

describe("terminal WS attach on session-server", () => {
  it("reports an explicit error when the daemon has no such session", async () => {
    const ipcPath = uniqueIpcPath();
    const sessionServer = new SessionServer();
    const ipcServer = new IpcServer({ ipcPath, sessionServer, token: TOKEN });
    await ipcServer.start();
    await new Promise((r) => setTimeout(r, 150));

    // The manager knows the session (fake backend), but the daemon registry
    // is empty — the attach must fail loudly.
    const sessionManager = new InMemorySessionManager({
      async createSession() {},
      async killSession() {},
      async capturePane() { return ""; },
      async listSessions() { return []; },
      async hasSession() { return true; }
    });
    await sessionManager.createSession({
      userId: "u1",
      sessionId: "s1",
      attachToken: "tok",
      launchPlan: {
        command: isWin ? "cmd.exe" : "bash",
        args: [],
        cwd: "/tmp",
        env: {},
        secretEnvNames: [],
        credentialMode: "host_environment"
      }
    });

    const gateway = await startGateway(sessionManager, ipcPath);
    try {
      const ws = connectTerminalWs(gateway.url);
      const messages: string[] = [];
      ws.on("message", (raw) => messages.push(raw.toString()));
      const closeCode = await new Promise<number>((resolve) => {
        ws.on("open", () => undefined);
        ws.on("close", (code) => resolve(code));
      });
      assert.equal(closeCode, 1011, "failed attach must close with 1011");
      assert.ok(
        messages.some((m) => m.includes("terminal_error") && m.includes("Session not found")),
        `expected an explicit attach error, got: ${messages.join(" | ")}`
      );
    } finally {
      await gateway.close();
      await ipcServer.stop();
      await sessionServer.destroy();
    }
  });

  it("sends the snapshot as the first frame, then streams live output", async () => {
    if (isWin) return; // bash-only orchestration
    const ipcPath = uniqueIpcPath();
    const cwd = mkdtempSync(join(tmpdir(), "fb-ss-attach-live-"));
    const sessionServer = new SessionServer();
    const ipcServer = new IpcServer({ ipcPath, sessionServer, token: TOKEN });
    await ipcServer.start();
    await new Promise((r) => setTimeout(r, 150));

    const backendClient = new SessionServerClient({ ipcPath, token: TOKEN });
    await backendClient.connect();
    const sessionManager = new InMemorySessionManager(backendClient as TerminalBackendClient);
    const created = await sessionManager.createSession({
      userId: "u1",
      sessionId: "s1",
      attachToken: "tok",
      launchPlan: {
        command: "bash",
        args: ["-c", "echo hist-marker; cat"],
        cwd,
        env: {},
        secretEnvNames: [],
        credentialMode: "host_environment"
      }
    });
    // Wait until the marker is rendered before attaching.
    const start = Date.now();
    while (!(await backendClient.capturePane(created.runtimeSessionName)).includes("hist-marker")) {
      if (Date.now() - start > 10_000) throw new Error("timed out waiting for hist-marker");
      await new Promise((r) => setTimeout(r, 50));
    }

    const gateway = await startGateway(sessionManager, ipcPath);
    const ws = connectTerminalWs(gateway.url);
    const frames: Array<{ type: string; data: string }> = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as { type: string; payload?: { data?: string } };
      frames.push({ type: msg.type, data: msg.payload?.data ?? "" });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      // First frame must be the snapshot replay; no separate captureHistory
      // round-trip may double it.
      await pollFrames(() => frames.length > 0);
      assert.equal(frames[0]?.type, "terminal_history", `first frame must be history, got ${frames[0]?.type}`);
      assert.ok(frames[0]?.data.includes("hist-marker"), "snapshot must contain pre-attach output");

      ws.send(JSON.stringify({ type: "terminal_input", payload: { data: "echo live-marker\n" } }));
      await pollFrames(() => frames.some((f) => f.type === "terminal_output" && f.data.includes("live-marker")));

      const historyCount = frames.filter((f) => f.type === "terminal_history").length;
      assert.equal(historyCount, 1, "history must be replayed exactly once");
      const liveHistEcho = frames
        .filter((f) => f.type === "terminal_output")
        .some((f) => f.data.includes("hist-marker"));
      assert.equal(liveHistEcho, false, "history must not re-appear in the live stream");
    } finally {
      ws.close();
      await gateway.close();
      await backendClient.disconnect().catch(() => {});
      await ipcServer.stop();
      await sessionServer.destroy();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

async function pollFrames(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("pollFrames timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}
