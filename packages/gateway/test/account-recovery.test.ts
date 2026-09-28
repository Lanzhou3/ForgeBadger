import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";

import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";
import { fileURLToPath } from "node:url";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createAuthRouter } from "../src/routes/auth.js";
import { createLocalAccountRecovery } from "../src/services/local-account-recovery.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local account recovery", () => {
  it("persists one owner-readable recovery key across Gateway restarts", () => {
    const stateDir = createTemporaryDirectory();
    const first = createLocalAccountRecovery(stateDir);
    const keyPath = path.join(stateDir, "account-recovery.key");
    const firstKey = readFileSync(keyPath, "utf8").trim();

    const second = createLocalAccountRecovery(stateDir);
    const secondKey = readFileSync(keyPath, "utf8").trim();

    assert.equal(first.keyPath, keyPath);
    assert.equal(second.keyPath, keyPath);
    assert.equal(secondKey, firstKey);
    assert.equal(firstKey.startsWith("fbr_"), true);
    if (process.platform !== "win32") {
      assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    }
  });

  it("requires the local recovery key for registration without rotating it", async () => {
    const stateDir = createTemporaryDirectory();
    const accountRecovery = createLocalAccountRecovery(stateDir);
    const keyPath = path.join(stateDir, "account-recovery.key");
    const recoveryKey = readFileSync(keyPath, "utf8").trim();
    const db = createTestDb();
    const users = new UserRepository(db);
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v1/auth",
      createAuthRouter(users, jwtSecret, { db, accountRecovery })
    );

    const missingKey = await makeRequest(app, "/api/v1/auth/register", {
      email: "missing-key@example.com",
      password: "password123"
    });
    const wrongKey = await makeRequest(app, "/api/v1/auth/register", {
      email: "wrong-key@example.com",
      password: "password123",
      recoveryKey: "fbr_invalid-recovery-key"
    });
    const registered = await makeRequest(app, "/api/v1/auth/register", {
      email: "owner@example.com",
      password: "password123",
      recoveryKey
    });

    assert.equal(missingKey.status, 401);
    assert.equal(wrongKey.status, 401);
    assert.deepEqual(missingKey.body, wrongKey.body);
    assert.equal(registered.status, 201);
    assert.equal(registered.body.data.user.role, "admin");
    assert.equal(readFileSync(keyPath, "utf8").trim(), recoveryKey);
    db.close();
  });

  it("rejects proxy-forwarded registration even with the valid recovery key", async () => {
    const stateDir = createTemporaryDirectory();
    const accountRecovery = createLocalAccountRecovery(stateDir);
    const recoveryKey = readFileSync(
      path.join(stateDir, "account-recovery.key"),
      "utf8"
    ).trim();
    const db = createTestDb();
    const users = new UserRepository(db);
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v1/auth",
      createAuthRouter(users, jwtSecret, { db, accountRecovery })
    );

    const forwarded = await makeRequest(app, "/api/v1/auth/register", {
      email: "forwarded@example.com",
      password: "password123",
      recoveryKey
    }, { forwarded: "for=127.0.0.1" });

    assert.equal(forwarded.status, 403);
    assert.equal(users.count(), 0);
    db.close();
  });

  it("resets an active account through the public auth API", async () => {
    const stateDir = createTemporaryDirectory();
    const accountRecovery = createLocalAccountRecovery(stateDir);
    const recoveryKey = readFileSync(
      path.join(stateDir, "account-recovery.key"),
      "utf8"
    ).trim();
    const db = createTestDb();
    const users = new UserRepository(db);
    users.create("owner@example.com", await bcrypt.hash("old-password", 10), {
      role: "admin"
    });
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v1/auth",
      createAuthRouter(users, jwtSecret, { db, accountRecovery })
    );

    const reset = await makeRequest(app, "/api/v1/auth/reset-password", {
      email: "owner@example.com",
      recoveryKey,
      newPassword: "new-password-123"
    });
    const login = await makeRequest(app, "/api/v1/auth/login", {
      email: "owner@example.com",
      password: "new-password-123"
    });

    assert.equal(reset.status, 200);
    assert.deepEqual(reset.body, {
      code: 0,
      data: { revokedSessions: true, recoveryKeyRotated: true },
      message: ""
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.code, 0);
    db.close();
  });

  it("revokes existing sessions and rotates the recovery key after use", async () => {
    const stateDir = createTemporaryDirectory();
    const accountRecovery = createLocalAccountRecovery(stateDir);
    const keyPath = path.join(stateDir, "account-recovery.key");
    const originalRecoveryKey = readFileSync(keyPath, "utf8").trim();
    const db = createTestDb();
    const users = new UserRepository(db);
    users.create("owner@example.com", await bcrypt.hash("old-password", 10), {
      role: "admin"
    });
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v1/auth",
      createAuthRouter(users, jwtSecret, { db, accountRecovery })
    );
    const signedIn = await makeRequest(app, "/api/v1/auth/login", {
      email: "owner@example.com",
      password: "old-password"
    });

    const reset = await makeRequest(app, "/api/v1/auth/reset-password", {
      email: "owner@example.com",
      recoveryKey: originalRecoveryKey,
      newPassword: "new-password-123"
    });
    const oldSession = await makeGetRequest(
      app,
      "/api/v1/auth/me",
      signedIn.body.data.token
    );
    const reusedKey = await makeRequest(app, "/api/v1/auth/reset-password", {
      email: "owner@example.com",
      recoveryKey: originalRecoveryKey,
      newPassword: "attacker-password-123"
    });
    const rotatedRecoveryKey = readFileSync(keyPath, "utf8").trim();

    assert.equal(reset.status, 200);
    assert.equal(oldSession.status, 401);
    assert.equal(reusedKey.status, 401);
    assert.notEqual(rotatedRecoveryKey, originalRecoveryKey);
    db.close();
  });

  it("rejects proxy-forwarded requests even when the socket is loopback", async () => {
    const stateDir = createTemporaryDirectory();
    const accountRecovery = createLocalAccountRecovery(stateDir);
    const recoveryKey = readFileSync(
      path.join(stateDir, "account-recovery.key"),
      "utf8"
    ).trim();
    const db = createTestDb();
    const users = new UserRepository(db);
    users.create("owner@example.com", await bcrypt.hash("old-password", 10), {
      role: "admin"
    });
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v1/auth",
      createAuthRouter(users, jwtSecret, { db, accountRecovery })
    );

    const resetBody = {
      email: "owner@example.com",
      recoveryKey,
      newPassword: "new-password-123"
    };
    const forwarded = [];
    for (const headers of [
      { forwarded: "for=127.0.0.1" },
      { "x-forwarded-for": "127.0.0.1" },
      { "x-real-ip": "127.0.0.1" }
    ]) {
      forwarded.push(await makeRequest(
        app,
        "/api/v1/auth/reset-password",
        resetBody,
        headers
      ));
    }
    const direct = await makeRequest(app, "/api/v1/auth/reset-password", {
      ...resetBody
    });

    assert.deepEqual(forwarded.map((response) => response.status), [403, 403, 403]);
    assert.equal(direct.status, 200);
    db.close();
  });

  it("uses one generic failure without consuming the key for an unknown or disabled account", async () => {
    const stateDir = createTemporaryDirectory();
    const accountRecovery = createLocalAccountRecovery(stateDir);
    const recoveryKey = readFileSync(
      path.join(stateDir, "account-recovery.key"),
      "utf8"
    ).trim();
    const db = createTestDb();
    const users = new UserRepository(db);
    const user = users.create(
      "owner@example.com",
      await bcrypt.hash("old-password", 10),
      { role: "admin" }
    );
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v1/auth",
      createAuthRouter(users, jwtSecret, { db, accountRecovery })
    );
    const resetBody = {
      recoveryKey,
      newPassword: "new-password-123"
    };

    const unknownAccount = await makeRequest(app, "/api/v1/auth/reset-password", {
      ...resetBody,
      email: "missing@example.com"
    });
    users.update(user.id, { status: "disabled" });
    const disabledAccount = await makeRequest(app, "/api/v1/auth/reset-password", {
      ...resetBody,
      email: "owner@example.com"
    });
    users.update(user.id, { status: "active" });
    const wrongKey = await makeRequest(app, "/api/v1/auth/reset-password", {
      ...resetBody,
      email: "owner@example.com",
      recoveryKey: "fbr_invalid-recovery-key"
    });
    const validReset = await makeRequest(app, "/api/v1/auth/reset-password", {
      ...resetBody,
      email: "owner@example.com"
    });

    assert.equal(unknownAccount.status, 401);
    assert.equal(disabledAccount.status, 401);
    assert.equal(wrongKey.status, 401);
    assert.deepEqual(unknownAccount.body, disabledAccount.body);
    assert.deepEqual(disabledAccount.body, wrongKey.body);
    assert.equal(validReset.status, 200);
    db.close();
  });

  it("rate-limits repeated recovery attempts", async () => {
    const stateDir = createTemporaryDirectory();
    const accountRecovery = createLocalAccountRecovery(stateDir);
    const db = createTestDb();
    const users = new UserRepository(db);
    users.create("owner@example.com", await bcrypt.hash("old-password", 10), {
      role: "admin"
    });
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v1/auth",
      createAuthRouter(users, jwtSecret, { db, accountRecovery })
    );

    const attempts = [];
    for (let index = 0; index < 6; index += 1) {
      attempts.push(await makeRequest(app, "/api/v1/auth/reset-password", {
        email: "owner@example.com",
        recoveryKey: `fbr_invalid-recovery-key-${index}`,
        newPassword: "new-password-123"
      }));
    }

    assert.deepEqual(attempts.slice(0, 5).map((attempt) => attempt.status), [401, 401, 401, 401, 401]);
    assert.equal(attempts[5]?.status, 429);
    db.close();
  });
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "forgebadger-account-recovery-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/db/migrations"
    )
  });
  return db;
}

async function makeRequest(
  app: express.Express,
  requestPath: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Test server did not expose a TCP port"));
        return;
      }
      const payload = JSON.stringify(body);
      const request = http.request({
        hostname: "127.0.0.1",
        port: address.port,
        path: requestPath,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...headers
        }
      }, (response) => {
        let raw = "";
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => {
          server.close();
          resolve({
            status: response.statusCode ?? 0,
            body: raw ? JSON.parse(raw) : undefined
          });
        });
      });
      request.on("error", (error) => {
        server.close();
        reject(error);
      });
      request.end(payload);
    });
  });
}

async function makeGetRequest(
  app: express.Express,
  requestPath: string,
  token: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Test server did not expose a TCP port"));
        return;
      }
      const request = http.request({
        hostname: "127.0.0.1",
        port: address.port,
        path: requestPath,
        method: "GET",
        headers: { authorization: `Bearer ${token}` }
      }, (response) => {
        let raw = "";
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => {
          server.close();
          resolve({
            status: response.statusCode ?? 0,
            body: raw ? JSON.parse(raw) : undefined
          });
        });
      });
      request.on("error", (error) => {
        server.close();
        reject(error);
      });
      request.end();
    });
  });
}
