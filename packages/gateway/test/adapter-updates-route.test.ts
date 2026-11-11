import assert from "node:assert/strict";
import { describe, it } from "node:test";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createAdapterRoutes } from "../src/routes/adapters.js";
import type { CommandRunner } from "../src/lib/dependency-check.js";

const secret = "0123456789abcdef0123456789abcdef";

function createTestDb(): Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function request(
  app: express.Express,
  method: string,
  route: string,
  token?: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      const req = http.request({
        hostname: "127.0.0.1",
        port: address.port,
        path: route,
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders }
      }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) });
        });
      });
      req.on("error", (error) => { server.close(); reject(error); });
      req.end();
    });
  });
}

async function waitForOperation(
  app: express.Express,
  operationId: string,
  token: string
): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request(app, "GET", `/api/v1/adapters/operations/${operationId}`, token);
    assert.equal(response.status, 200);
    if (response.body.data.operation.state !== "running") return response;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("CLI operation did not settle");
}

describe("adapter update routes", () => {
  it("checks updates for authenticated users but only lets instance admins run them", async () => {
    const db = createTestDb();
    try {
      const users = new UserRepository(db);
      const admin = users.create("adapter-admin@test.dev", "hash", { role: "admin" });
      const regular = users.create("adapter-user@test.dev", "hash", { role: "user" });
      let installed = "1.0.0";
      let updatesRun = 0;
      let registryChecks = 0;
      const runner: CommandRunner = async (command, args) => {
        if (args[0] !== "--version") {
          updatesRun += 1;
          installed = "2.0.0";
        }
        return { exitCode: 0, stdout: `${command} ${installed}`, stderr: "" };
      };
      const app = express();
      app.locals.jwtSecret = secret;
      app.locals.db = db;
      app.use("/api/v1/adapters", createAdapterRoutes(undefined, {
        runner,
        fetcher: async () => {
          registryChecks += 1;
          return new Response(JSON.stringify({ version: "2.0.0" }));
        },
        resolveHost: async () => [{ address: "8.8.8.8", family: 4 }]
      }));
      const userToken = signJwt({ userId: regular.id, email: regular.email }, secret);
      const adminToken = signJwt({ userId: admin.id, email: admin.email }, secret);

      assert.equal((await request(app, "GET", "/api/v1/adapters/updates")).status, 401);
      const list = await request(app, "GET", "/api/v1/adapters/updates", userToken);
      assert.equal(list.status, 200);
      assert.equal(list.body.data.canUpdate, false);
      assert.equal(list.body.data.updates.length, 7);
      assert.equal(registryChecks, 7);
      await request(app, "GET", "/api/v1/adapters/updates?refresh=true", userToken);
      assert.equal(registryChecks, 7);
      await request(app, "GET", "/api/v1/adapters/updates?refresh=true", adminToken);
      assert.equal(registryChecks, 14);
      assert.equal((await request(app, "POST", "/api/v1/adapters/codex/update", userToken)).status, 403);
      assert.equal((await request(app, "POST", "/api/v1/adapters/codex/update", undefined, {
        Cookie: `forgebadger_session=${adminToken}`
      })).status, 403);
      assert.equal((await request(app, "POST", "/api/v1/adapters/codex/update", undefined, {
        Authorization: "Bearer  ",
        Cookie: `forgebadger_session=${adminToken}`
      })).status, 403);
      assert.equal(updatesRun, 0);
      assert.equal((await request(app, "POST", "/api/v1/adapters/other/update", adminToken)).status, 400);

      const updated = await request(app, "POST", "/api/v1/adapters/codex/update", adminToken);
      assert.equal(updated.status, 202);
      assert.equal(updated.body.data.operation.state, "running");
      assert.equal(updated.body.data.operation.kind, "update");
      const completed = await waitForOperation(app, updated.body.data.operation.id, userToken);
      assert.equal(completed.body.data.operation.state, "succeeded");
      assert.equal(completed.body.data.operation.result.command, "codex update");
      assert.equal(completed.body.data.operation.result.installedVersion, "2.0.0");
      assert.equal(updatesRun, 1);
      const operations = await request(app, "GET", "/api/v1/adapters/operations", userToken);
      assert.equal(operations.body.data.operations[0].id, updated.body.data.operation.id);
      assert.equal((await request(app, "GET", "/api/v1/adapters/operations/missing", userToken)).status, 404);
    } finally {
      db.close();
    }
  });

  it("allows only Bearer-authenticated admins to install a missing CLI and refreshes cached status", async () => {
    const db = createTestDb();
    try {
      const users = new UserRepository(db);
      const admin = users.create("adapter-install-admin@test.dev", "hash", { role: "admin" });
      const regular = users.create("adapter-install-user@test.dev", "hash", { role: "user" });
      const adminToken = signJwt({ userId: admin.id, email: admin.email }, secret);
      const userToken = signJwt({ userId: regular.id, email: regular.email }, secret);
      let installed = false;
      const installs: string[][] = [];
      const runner: CommandRunner = async (command, args) => {
        if (command === "npm" && args[0] === "install") {
          installs.push(args);
          installed = true;
          return { exitCode: 0, stdout: "installed", stderr: "" };
        }
        if (command === "npm") return { exitCode: 0, stdout: "10.0.0", stderr: "" };
        return {
          exitCode: command === "codex" && installed ? 0 : 127,
          stdout: command === "codex" && installed ? "codex 1.0.0" : "",
          stderr: ""
        };
      };
      const app = express();
      app.locals.jwtSecret = secret;
      app.locals.db = db;
      app.use("/api/v1/adapters", createAdapterRoutes(undefined, {
        runner,
        fetcher: async () => new Response(JSON.stringify({ version: "1.0.0" })),
        resolveHost: async () => [{ address: "8.8.8.8", family: 4 }]
      }));

      const before = await request(app, "GET", "/api/v1/adapters/updates", userToken);
      assert.equal(before.body.data.canInstall, false);
      assert.equal(before.body.data.updates.find((entry: { id: string }) => entry.id === "codex").installCommand,
        "npm install -g @openai/codex");
      assert.equal((await request(app, "POST", "/api/v1/adapters/codex/install", userToken)).status, 403);
      assert.equal((await request(app, "POST", "/api/v1/adapters/codex/install", undefined, {
        Cookie: `forgebadger_session=${adminToken}`
      })).status, 403);
      assert.equal((await request(app, "POST", "/api/v1/adapters/other/install", adminToken)).status, 400);
      assert.equal(installs.length, 0);

      const result = await request(app, "POST", "/api/v1/adapters/codex/install", adminToken);
      assert.equal(result.status, 202);
      assert.equal(result.body.data.operation.state, "running");
      const completed = await waitForOperation(app, result.body.data.operation.id, adminToken);
      assert.equal(completed.body.data.operation.state, "succeeded");
      assert.equal(completed.body.data.operation.result.command, "npm install -g @openai/codex");
      assert.equal(completed.body.data.operation.result.commandAvailable, true);
      assert.deepEqual(installs, [["install", "-g", "@openai/codex"]]);
      const duplicate = await request(app, "POST", "/api/v1/adapters/codex/install", adminToken);
      assert.equal(duplicate.status, 202);
      const failed = await waitForOperation(app, duplicate.body.data.operation.id, adminToken);
      assert.equal(failed.body.data.operation.state, "failed");
      assert.equal(failed.body.data.operation.error, "CLI is already installed");
      const after = await request(app, "GET", "/api/v1/adapters/updates", adminToken);
      assert.equal(after.body.data.updates.find((entry: { id: string }) => entry.id === "codex").state,
        "up_to_date");
    } finally {
      db.close();
    }
  });

  it("returns before the command finishes and reuses an active operation on retry", async () => {
    const db = createTestDb();
    let releaseUpdate!: () => void;
    const updateBlocked = new Promise<void>((resolve) => { releaseUpdate = resolve; });
    try {
      const admin = new UserRepository(db).create("adapter-background-admin@test.dev", "hash", { role: "admin" });
      const adminToken = signJwt({ userId: admin.id, email: admin.email }, secret);
      let installed = "1.0.0";
      let updatesRun = 0;
      const runner: CommandRunner = async (_command, args) => {
        if (args[0] === "--version") return { exitCode: 0, stdout: installed, stderr: "" };
        updatesRun += 1;
        await updateBlocked;
        installed = "2.0.0";
        return { exitCode: 0, stdout: "updated", stderr: "" };
      };
      const app = express();
      app.locals.jwtSecret = secret;
      app.locals.db = db;
      app.use("/api/v1/adapters", createAdapterRoutes(undefined, {
        runner,
        fetcher: async () => new Response(JSON.stringify({ version: "2.0.0" })),
        resolveHost: async () => [{ address: "8.8.8.8", family: 4 }]
      }));

      const first = await request(app, "POST", "/api/v1/adapters/codex/update", adminToken);
      assert.equal(first.status, 202);
      assert.equal(first.body.data.operation.state, "running");
      assert.equal(updatesRun, 1);
      const retry = await request(app, "POST", "/api/v1/adapters/codex/update", adminToken);
      assert.equal(retry.status, 202);
      assert.equal(retry.body.data.operation.id, first.body.data.operation.id);
      assert.equal(updatesRun, 1);

      releaseUpdate();
      const completed = await waitForOperation(app, first.body.data.operation.id, adminToken);
      assert.equal(completed.body.data.operation.state, "succeeded");
      assert.equal(completed.body.data.operation.result.installedVersion, "2.0.0");
    } finally {
      releaseUpdate();
      db.close();
    }
  });
});
