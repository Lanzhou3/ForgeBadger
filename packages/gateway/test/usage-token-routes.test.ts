import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { TokenUsageRepository } from "../src/db/repositories/token-usage-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createUsageRoutes } from "../src/routes/usage.js";
import type { TokenUsageRecord } from "../src/services/usage/usage-source.js";

const secret = "0123456789abcdef0123456789abcdef";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("usage token routes", () => {
  let app: express.Express;
  let db: Database.Database;
  let token: string;
  let userId: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("usage-routes@example.com", "hash");
    userId = user.id;
    token = signJwt({ userId: user.id, email: user.email }, secret);
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/usage", createUsageRoutes(db));
  });

  const seed = (records: TokenUsageRecord[]): void => {
    new TokenUsageRepository(db, userId).upsertRecords(records);
  };

  const fake = (overrides: Partial<TokenUsageRecord>): TokenUsageRecord => ({
    adapter: "claude",
    sessionId: "s1",
    projectPath: "/tmp/p",
    modelId: "m1",
    requestId: "r1",
    occurredAt: new Date("2026-08-01T10:00:00.000Z"),
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 300,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    sourceFile: "/tmp/opencode.db",
    ...overrides
  });

  it("returns token summary aggregates", async () => {
    seed([
      fake({ requestId: "r1", projectPath: "/tmp/a" }),
      fake({ requestId: "r2", projectPath: "/tmp/b", inputTokens: 500, outputTokens: 50 })
    ]);
    const res = await makeRequest(app, "GET", "/api/v1/usage/token-summary", undefined, headers(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.summary.totalInputTokens, 1500);
    assert.equal(res.body.data.summary.totalOutputTokens, 250);
    assert.equal(res.body.data.summary.requestCount, 2);
    assert.equal(res.body.data.summary.byProject.length, 2);
    assert.equal(res.body.data.summary.byAdapter[0]?.adapter ?? res.body.data.summary.byAdapter[0]?.key, "claude");
  });

  it("filters token summary by date range", async () => {
    seed([
      fake({ requestId: "old", occurredAt: new Date("2026-07-01T10:00:00.000Z") }),
      fake({ requestId: "new", occurredAt: new Date("2026-08-02T10:00:00.000Z") })
    ]);
    const res = await makeRequest(
      app,
      "GET",
      "/api/v1/usage/token-summary?from=2026-08-01T00:00:00.000Z&to=2026-09-01T00:00:00.000Z",
      undefined,
      headers(token)
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.summary.requestCount, 1);
    assert.equal(res.body.data.summary.byModel[0]?.key, "m1");
  });

  it("returns project activity daily series", async () => {
    seed([
      fake({ requestId: "r1", projectPath: "/tmp/a", occurredAt: new Date("2026-08-01T10:00:00.000Z") }),
      fake({ requestId: "r2", projectPath: "/tmp/a", occurredAt: new Date("2026-08-01T14:00:00.000Z") }),
      fake({ requestId: "r3", projectPath: "/tmp/b", occurredAt: new Date("2026-08-02T10:00:00.000Z") })
    ]);
    const res = await makeRequest(app, "GET", "/api/v1/usage/project-activity", undefined, headers(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.series.length, 2);
    const a = res.body.data.series.find((row: { group: string }) => row.group === "/tmp/a");
    assert.equal(a?.day, "2026-08-01");
    assert.equal(a?.totalTokens, 2 * (1000 + 200 + 300));
  });

  it("sync endpoint persists scanned records", async () => {
    const res = await makeRequest(app, "POST", "/api/v1/usage/sync", undefined, headers(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    // On an empty machine there is nothing to scan; the endpoint should still
    // return a well-formed result rather than error.
    assert.ok(Array.isArray(res.body.data.result.byAdapter));
    assert.equal(typeof res.body.data.result.totalInserted, "number");
  });
});

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function makeRequest(
  app: express.Express,
  method: string,
  pathName: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  try {
    const res = await fetch(`${baseUrl}${pathName}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const responseBody = await res.json().catch(() => ({}));
    return { status: res.status, body: responseBody };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function listen(server: http.Server): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}