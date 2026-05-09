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
import type { CodexAppServerTransport } from "../src/services/codex-app-server-client.js";
import { AppServerTurnRateLimiter, createCodexAppServerRoutes } from "../src/routes/codex-app-server.js";

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
  let projectRoot: string;

  beforeEach(async () => {
    db = createTestDb();
    const user = new UserRepository(db).create("codex-route@example.com", "hash");
    token = signJwt({ userId: user.id, email: user.email }, secret);
    projectRoot = await mkdtemp(path.join(tmpdir(), "openforge-codex-route-"));
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

  it("sends initialize, thread, and turn requests through the managed app-server client", async () => {
    const transport = new AutoResponseTransport();
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-rpc-"));
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      spawn: () => ({
        pid: 456,
        on() {
          return this;
        },
        kill() {
          return true;
        }
      }),
      transportFactory: () => transport
    });
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/codex/app-server", createCodexAppServerRoutes({
      db,
      manager
    }));

    const start = await makeRequest(app, "POST", "/api/v1/codex/app-server", {
      projectId,
      runtimeMode: "app-server-stdio"
    }, { Authorization: `Bearer ${token}` });
    const sessionId = start.body.data.session.id;

    const initialized = await makeRequest(
      app,
      "POST",
      `/api/v1/codex/app-server/${sessionId}/initialize`,
      undefined,
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(initialized.status, 200);
    assert.deepEqual(initialized.body.data.result, { accepted: true });

    const thread = await makeRequest(
      app,
      "POST",
      `/api/v1/codex/app-server/${sessionId}/thread`,
      {
        approvalPolicy: "never",
        sandbox: "read-only"
      },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(thread.status, 200);
    assert.deepEqual(thread.body.data.result, { accepted: true });

    const turn = await makeRequest(
      app,
      "POST",
      `/api/v1/codex/app-server/${sessionId}/turn`,
      {
        threadId: "thr_123",
        text: "Summarize the repo"
      },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(turn.status, 200);
    assert.deepEqual(turn.body.data.result, { accepted: true });

    const sentMethods = transport.sent.map((payload) => JSON.parse(payload).method);
    assert.deepEqual(sentMethods, ["initialize", "initialized", "thread/start", "turn/start"]);
    assert.equal(JSON.parse(transport.sent[2]).params.cwd, projectRoot);
    assert.equal(JSON.parse(transport.sent[2]).params.approvalPolicy, "never");
    assert.equal(JSON.parse(transport.sent[2]).params.sandbox, "read-only");
    assert.equal(JSON.parse(transport.sent[2]).params.experimentalRawEvents, undefined);
    assert.equal(JSON.parse(transport.sent[2]).params.persistExtendedHistory, undefined);
    assert.equal(JSON.parse(transport.sent[3]).params.input[0].text, "Summarize the repo");
    assert.deepEqual(JSON.parse(transport.sent[3]).params.input[0].text_elements, []);
  });

  it("rate limits repeated turn requests for the same app-server session", async () => {
    const transport = new AutoResponseTransport();
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-rate-"));
    const manager = new CodexAppServerManager({
      runtimeRoot: root,
      spawn: () => ({
        pid: 789,
        on() {
          return this;
        },
        kill() {
          return true;
        }
      }),
      transportFactory: () => transport
    });
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/codex/app-server", createCodexAppServerRoutes({
      db,
      manager,
      turnRateLimit: { maxRequests: 1, windowMs: 60_000 }
    }));

    const start = await makeRequest(app, "POST", "/api/v1/codex/app-server", {
      projectId,
      runtimeMode: "app-server-stdio"
    }, { Authorization: `Bearer ${token}` });
    const sessionId = start.body.data.session.id;

    const first = await makeRequest(
      app,
      "POST",
      `/api/v1/codex/app-server/${sessionId}/turn`,
      { threadId: "thr_123", text: "first" },
      { Authorization: `Bearer ${token}` }
    );
    const second = await makeRequest(
      app,
      "POST",
      `/api/v1/codex/app-server/${sessionId}/turn`,
      { threadId: "thr_123", text: "second" },
      { Authorization: `Bearer ${token}` }
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(second.body.code, 1);
    assert.match(second.body.message, /rate limit/i);
    assert.equal(transport.sent.length, 1);
  });
});

describe("AppServerTurnRateLimiter", () => {
  it("prunes expired buckets while consuming new turn requests", () => {
    const limiter = new AppServerTurnRateLimiter({ maxRequests: 1, windowMs: 100 });

    assert.equal(limiter.consume("user-1", "session-1", 1000), true);
    assert.equal(limiter.consume("user-1", "session-2", 1001), true);
    assert.equal(limiter.size(), 2);
    assert.equal(limiter.consume("user-1", "session-3", 1101), true);

    assert.equal(limiter.size(), 1);
  });
});

class AutoResponseTransport implements CodexAppServerTransport {
  sent: string[] = [];
  private messageHandler: ((raw: string | Buffer) => void) | undefined;
  private closeHandler: ((code?: number, reason?: string) => void) | undefined;

  send(data: string): void {
    this.sent.push(data);
    const parsed = JSON.parse(data) as { id: string | number };
    if (parsed.id === undefined) {
      return;
    }
    queueMicrotask(() => {
      this.messageHandler?.(JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        result: { accepted: true }
      }));
    });
  }

  close(code?: number, reason?: string): void {
    this.closeHandler?.(code, reason);
  }

  onMessage(handler: (raw: string | Buffer) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (code?: number, reason?: string) => void): void {
    this.closeHandler = handler;
  }
}

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
