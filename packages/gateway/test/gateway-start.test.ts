import { PROTOCOL_VERSION } from "../src/services/session-server/ipc-protocol.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";

import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import type { Database } from "../src/db/types.js";
import type { TerminalBackendClient } from "../src/services/terminal-backend.js";
import { createGatewayRuntime } from "../src/runtime/start-gateway.js";

describe("createGatewayRuntime", () => {
  it("mounts local account recovery in the production runtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-account-recovery-runtime-"));
    const backend = createMockBackendClient();

    let runtime: Awaited<ReturnType<typeof createGatewayRuntime>> | undefined;

    try {
      runtime = await createGatewayRuntime(gatewayEnv(root), { backendClient: backend.client });
      runtime.server.listen(0, "127.0.0.1");
      await once(runtime.server, "listening");
      const address = runtime.server.address() as AddressInfo;
      const db = runtime.app.locals.db as Database;
      new UserRepository(db).create(
        "runtime-owner@example.com",
        await bcrypt.hash("old-password", 10),
        { role: "admin" }
      );
      const recoveryKey = (await readFile(
        path.join(root, "account-recovery.key"),
        "utf8"
      )).trim();

      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/auth/reset-password`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "runtime-owner@example.com",
            recoveryKey,
            newPassword: "new-password-123"
          })
        }
      );

      assert.equal(response.status, 200);
    } finally {

      if (runtime) await runtime.close();
    }
  });

  it("returns 404 for removed API endpoints", async () => {
    // Arrange
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-gateway-cutover-"));
    const backend = createMockBackendClient();

    let runtime: Awaited<ReturnType<typeof createGatewayRuntime>> | undefined;

    try {
      runtime = await createGatewayRuntime(gatewayEnv(root), { backendClient: backend.client });
      runtime.server.listen(0, "127.0.0.1");
      await once(runtime.server, "listening");
      const address = runtime.server.address() as AddressInfo;

      // The `/api/v1` skill router gates the whole namespace with `authenticate`,
      // so removed endpoints must be probed with a valid token to reach the
      // 404 handler rather than short-circuiting to 401.
      const db = runtime.app.locals.db as Database;
      const jwtSecret = runtime.app.locals.jwtSecret as string;
      const user = new UserRepository(db).create("cutover@example.com", "hash");
      const token = signJwt({ userId: user.id, email: user.email }, jwtSecret);
      const authHeader = { authorization: `Bearer ${token}` };

      // Act
      const removedEndpoints = await Promise.all([
        fetch(`http://127.0.0.1:${address.port}/api/v1/agents`, { headers: authHeader }),
        fetch(`http://127.0.0.1:${address.port}/api/v1/automations`, { headers: authHeader })
      ]);

      // Assert
      assert.deepEqual(removedEndpoints.map((response) => response.status), [404, 404]);
    } finally {

      if (runtime) await runtime.close();
    }
  });

  it("creates an app without binding a port", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-gateway-runtime-"));
    const backend = createMockBackendClient();

    let runtime: Awaited<ReturnType<typeof createGatewayRuntime>> | undefined;

    try {
      runtime = await createGatewayRuntime(gatewayEnv(root), { backendClient: backend.client });

      assert.ok(runtime.app);
      assert.ok(runtime.server);
      assert.equal(runtime.server.listening, false);
      assert.equal(backend.listSessionsCalls, 1);
      assert.deepEqual(backend.killedSessions, []);
    } finally {

      if (runtime) {
        await runtime.close();
      }
    }
  });

  it("validates GatewayEnv-shaped input instead of trusting its shape", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-gateway-runtime-"));
    const backend = createMockBackendClient();

    let runtime: Awaited<ReturnType<typeof createGatewayRuntime>> | undefined;
    let rejected = false;

    try {
      runtime = await createGatewayRuntime(
        {
          FORGEBADGER_HOST: "127.0.0.1",
          FORGEBADGER_PORT: 0,
          FORGEBADGER_STATE_DIR: root,
          FORGEBADGER_DB_PATH: path.join(root, "forgebadger.db"),
          FORGEBADGER_MASTER_KEY: "a".repeat(64),
          FORGEBADGER_JWT_SECRET: "jwt-secret-for-gateway-runtime-test-456"
        },
        { backendClient: backend.client }
      );
    } catch (error) {
      rejected = true;
      assert.match(String(error), /FORGEBADGER_PORT|greater than 0|positive/i);
    } finally {

      if (runtime && "close" in runtime) {
        await runtime.close();
      }
    }

    assert.equal(rejected, true);
    assert.equal(backend.listSessionsCalls, 0);
  });

  it("rejects an invalid recovery key before starting runtime resources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-invalid-recovery-key-"));
    const backend = createMockBackendClient();


    try {
      await writeFile(path.join(root, "account-recovery.key"), "invalid\n", "utf8");

      await assert.rejects(
        createGatewayRuntime(gatewayEnv(root), { backendClient: backend.client }),
        /account recovery key file is invalid/i
      );
    } finally {

    }

    assert.equal(backend.listSessionsCalls, 0);
  });
});

function gatewayEnv(root: string) {
  return {
    FORGEBADGER_HOST: "127.0.0.1",
    FORGEBADGER_PORT: 3001,
    FORGEBADGER_STATE_DIR: root,
    FORGEBADGER_DB_PATH: path.join(root, "forgebadger.db"),
    FORGEBADGER_MASTER_KEY: "a".repeat(64),
    FORGEBADGER_JWT_SECRET: "jwt-secret-for-gateway-runtime-test-123"
  };
}

function createMockBackendClient(): {
  client: TerminalBackendClient;
  killedSessions: string[];
  listSessionsCalls: number;
} {
  const calls = {
    killedSessions: [] as string[],
    listSessionsCalls: 0
  };

  return {
    get killedSessions() {
      return calls.killedSessions;
    },
    get listSessionsCalls() {
      return calls.listSessionsCalls;
    },
    client: {
      async createSession() {
        throw new Error("createSession should not be called during startup recovery");
      },
      async killSession(name) {
        calls.killedSessions.push(name);
      },
      async capturePane() {
        throw new Error("capturePane should not be called during startup recovery");
      },
      async hasSession() { return false; },
      async listSessions() {
        calls.listSessionsCalls += 1;
        return [];
      }
    }
  };
}

import { createServer, type Socket } from "node:net";
import { mkdir, rm } from "node:fs/promises";
import { createPlatformAdapter } from "../src/services/session-server/platform-adapter.js";
import { resolveSessionServerTokenPath, writeSessionServerTokenFile } from "../src/services/session-server/auth-token.js";

async function daemonFixture(root: string, protocolVersion = PROTOCOL_VERSION) {
  const token = "a".repeat(64);
  const ipcPath = createPlatformAdapter().getIpcPath(root);
  writeSessionServerTokenFile(resolveSessionServerTokenPath(root), token);
  const connections = new Set<Socket>();
  let shutdowns = 0;
  const server = createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const message = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (message.type === "shutdown_server") shutdowns++;
        socket.write(`${JSON.stringify(message.type === "hello"
          ? { type: "hello_ok", protocolVersion, pid: process.pid, startedAt: "2026-09-10T00:00:00.000Z" }
          : { type: "ok", id: message.id, data: [] })}\n`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(ipcPath, resolve));
  return {
    ipcPath,
    get shutdowns() { return shutdowns; },
    get connections() { return connections.size; },
    async close() {
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

async function assertManagementDisconnected(daemon: Awaited<ReturnType<typeof daemonFixture>>) {
  const deadline = Date.now() + 300;
  while (daemon.connections > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(daemon.connections, 0, "Gateway must release its management connection");
  assert.equal(daemon.shutdowns, 0, "Gateway must preserve the daemon");
}

describe("owned daemon connection lifecycle", () => {
  it("disconnects when database startup fails without shutting down the daemon", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fb-runtime-fail-"));
    const daemon = await daemonFixture(root);
    const dbDirectory = path.join(root, "database-directory");
    await mkdir(dbDirectory);
    try {
      await assert.rejects(createGatewayRuntime({ ...gatewayEnv(root), FORGEBADGER_DB_PATH: dbDirectory }));
      await assertManagementDisconnected(daemon);
    } finally {
      await daemon.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("disconnects the daemon even when runtime close fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fb-runtime-close-"));
  const daemon = await daemonFixture(root);
  let runtime: Awaited<ReturnType<typeof createGatewayRuntime>> | undefined;
  let iterator: IterableIterator<unknown> | undefined;
  let db: Database | undefined;
  try {
    runtime = await createGatewayRuntime(gatewayEnv(root));
    db = runtime.app.locals.db as Database;
    // An active native SQLite iterator prevents database close. Exercise the
    // real shutdown aggregation without replacing Gateway implementation.
    iterator = db.prepare("SELECT 1 AS value UNION ALL SELECT 2 AS value").iterate();
    iterator.next();
    await assert.rejects(runtime.close(), /GATEWAY_SHUTDOWN_FAILED/);
    await assertManagementDisconnected(daemon);
  } finally {
    iterator?.return?.();
    await runtime?.close();
    if (db?.open) db.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
});


it("rejects an old daemon before opening or reconciling the database", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fb-runtime-old-daemon-"));
  const daemon = await daemonFixture(root, 1);
  const dbPath = path.join(root, "untouched.db");
  const original = "database must not be opened before protocol acceptance";
  await writeFile(dbPath, original);
  try {
    await assert.rejects(createGatewayRuntime({ ...gatewayEnv(root), FORGEBADGER_DB_PATH: dbPath }), /Incompatible Session Server/);
    assert.equal(await readFile(dbPath, "utf8"), original);
    await assertManagementDisconnected(daemon);
  } finally {
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
});
