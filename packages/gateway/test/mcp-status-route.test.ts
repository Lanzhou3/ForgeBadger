import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import http from "node:http";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createMcpStatusRoutes } from "../src/routes/mcp-status.js";

const secret = "0123456789abcdef0123456789abcdef";

process.env.FORGEBADGER_JWT_SECRET = secret;
process.env.FORGEBADGER_MASTER_KEY = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("mcp status route", () => {
  let db: Database;
  let users: UserRepository;
  let app: express.Express;

  beforeEach(() => {
    db = createTestDb();
    users = new UserRepository(db);
    app = express();
    app.locals.jwtSecret = secret;
    app.locals.db = db;
    app.use(express.json());
    app.use("/api/v1/mcp", createMcpStatusRoutes({
      mcpEnabled: false,
      endpoint: "http://127.0.0.1:48731/mcp"
    }));
  });

  function bearer(userId: string, email: string): Record<string, string> {
    return { Authorization: `Bearer ${signJwt({ userId, email }, secret)}` };
  }

  it("reports enabled=false with the endpoint for an authenticated user", async () => {
    const user = users.create("owner@example.com", "hash", { role: "admin" });
    const res = await makeRequest(app, "GET", "/api/v1/mcp", undefined, bearer(user.id, user.email));
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.enabled, false);
    assert.equal(res.body.data.endpoint, "http://127.0.0.1:48731/mcp");
  });

  it("reports enabled=true when the feature flag is set", async () => {
    const user = users.create("owner@example.com", "hash", { role: "admin" });
    const enabledApp = express();
    enabledApp.locals.jwtSecret = secret;
    enabledApp.locals.db = db;
    enabledApp.use("/api/v1/mcp", createMcpStatusRoutes({
      mcpEnabled: true,
      endpoint: "http://127.0.0.1:48731/mcp"
    }));
    const res = await makeRequest(enabledApp, "GET", "/api/v1/mcp", undefined, bearer(user.id, user.email));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.enabled, true);
  });

  it("requires authentication", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/mcp");
    assert.equal(res.status, 401);
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
            resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : undefined });
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
