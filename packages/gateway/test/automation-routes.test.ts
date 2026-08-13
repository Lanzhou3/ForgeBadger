import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";
import http from "node:http";

import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createAutomationRoutes } from "../src/routes/automations.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "ef".repeat(32);

describe("automation routes", () => {
  let db: Database.Database;
  let app: express.Express;
  let ownerToken: string;
  let otherToken: string;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
    const users = new UserRepository(db);
    const owner = users.create("automation-route-owner@example.com", "hash");
    const other = users.create("automation-route-other@example.com", "hash");
    ownerToken = signJwt({ userId: owner.id, email: owner.email }, jwtSecret);
    otherToken = signJwt({ userId: other.id, email: other.email }, jwtSecret);
    app = express();
    app.locals.jwtSecret = jwtSecret;
    app.use(express.json());
    app.use("/api/v1/automations", createAutomationRoutes(db, masterKey));
  });

  it("supports CRUD, run history, cancellation, and canonical envelopes", async () => {
    const created = await request("POST", "/api/v1/automations", createInput());
    assert.equal(created.status, 201);
    assert.equal(created.body.code, 0);
    const automation = created.body.data.automation as { id: string; revision: number };

    const updated = await request("PATCH", `/api/v1/automations/${automation.id}`, {
      expectedRevision: automation.revision, name: "Updated weekly report"
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.automation.revision, 2);

    const stale = await request("PATCH", `/api/v1/automations/${automation.id}`, {
      expectedRevision: 1, name: "stale"
    });
    assert.equal(stale.status, 409);

    const queued = await request("POST", `/api/v1/automations/${automation.id}/run`, {});
    assert.equal(queued.status, 202);
    assert.equal("claimToken" in queued.body.data.run, false);
    const runId = queued.body.data.run.id as string;
    const history = await request("GET", `/api/v1/automations/${automation.id}/runs`);
    assert.equal(history.body.data.runs.length, 1);
    const cancelled = await request("POST", `/api/v1/automations/${automation.id}/runs/${runId}/cancel`, {});
    assert.equal(cancelled.body.data.run.status, "cancelled");

    const paused = await request("POST", `/api/v1/automations/${automation.id}/pause`, { expectedRevision: 2 });
    assert.equal(paused.body.data.automation.status, "paused");
    const resumed = await request("POST", `/api/v1/automations/${automation.id}/resume`, { expectedRevision: 3 });
    assert.equal(resumed.body.data.automation.status, "active");
    const removed = await request("DELETE", `/api/v1/automations/${automation.id}`, { expectedRevision: 4 });
    assert.equal(removed.body.data.automation.status, "deleted");
  });

  it("enforces tenant isolation and rejects ambiguous cron requests", async () => {
    const invalid = await request("POST", "/api/v1/automations", {
      ...createInput(), schedule: { kind: "cron", expression: "0 9 * * 1" }
    });
    assert.equal(invalid.status, 400);

    const created = await request("POST", "/api/v1/automations", createInput());
    const id = created.body.data.automation.id as string;
    const hidden = await request("GET", `/api/v1/automations/${id}`, undefined, otherToken);
    assert.equal(hidden.status, 404);
  });

  async function request(method: string, pathname: string, body?: unknown, token = ownerToken) {
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

function createInput() {
  return {
    name: "Workspace weekly report", prompt: "Summarize all project progress.",
    scope: { type: "workspace" },
    schedule: { kind: "cron", expression: "0 9 * * 1", timezone: "Asia/Shanghai" },
    delivery: { channel: "feishu", accountId: "default", chatId: "oc_weekly" },
    toolAuthority: ["project.read"]
  };
}
