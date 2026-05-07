import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { CodexAppServerManager } from "../src/services/codex-app-server-manager.js";
import { createCodexAppServerRoutes } from "../src/routes/codex-app-server.js";

const secret = "0123456789abcdef0123456789abcdef";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("Codex app-server routes", () => {
  let app: express.Express;
  let db: Database.Database;
  let token: string;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb();
    const user = new UserRepository(db).create("codex-route@example.com", "hash");
    token = signJwt({ userId: user.id, email: user.email }, secret);
    const projectRoot = await mkdtemp(path.join(tmpdir(), "openforge-codex-route-"));
    const project = new ProjectRepository(db, user.id).create({
      name: "Codex Route",
      path: projectRoot,
      aiTool: "codex"
    });
    projectId = project.id;
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/codex/app-server", createCodexAppServerRoutes({
      db,
      manager: new CodexAppServerManager({
        runtimeRoot: projectRoot,
        spawn: () => ({
          pid: 123,
          on() {
            return this;
          },
          kill() {
            return true;
          }
        })
      })
    }));
  });

  it("starts, lists, and stops a tenant-owned Codex app-server session", async () => {
    const start = await makeRequest(app, "POST", "/api/v1/codex/app-server", {
      projectId,
      runtimeMode: "app-server-websocket"
    }, { Authorization: `Bearer ${token}` });

    assert.equal(start.status, 201);
    assert.equal(start.body.code, 0);
    assert.equal(start.body.data.session.projectId, projectId);
    assert.equal(start.body.data.session.runtimeMode, "app-server-websocket");
    assert.equal(start.body.data.session.status, "running");
    assert.equal(start.body.data.session.token, undefined);

    const list = await makeRequest(app, "GET", "/api/v1/codex/app-server", undefined, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.data.sessions.length, 1);

    const stop = await makeRequest(
      app,
      "POST",
      `/api/v1/codex/app-server/${start.body.data.session.id}/stop`,
      undefined,
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(stop.status, 200);
    assert.equal(stop.body.data.session.status, "stopped");
  });

  it("rejects non-Codex projects", async () => {
    const otherUser = new UserRepository(db).create("other-codex-route@example.com", "hash");
    const otherProject = new ProjectRepository(db, otherUser.id).create({
      name: "Other",
      path: "/tmp/other",
      aiTool: "claude"
    });

    const res = await makeRequest(app, "POST", "/api/v1/codex/app-server", {
      projectId: otherProject.id,
      runtimeMode: "app-server-stdio"
    }, { Authorization: `Bearer ${token}` });

    assert.equal(res.status, 404);
    assert.equal(res.body.code, 1);
  });
});

async function makeRequest(
  app: express.Express,
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: pathname,
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
          }
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode || 0,
              body: data ? JSON.parse(data) : undefined
            });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}
