import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

const mockTmuxClient = {
  async createSession() {},
  async killSession() {},
  async capturePane() {
    return "";
  },
  async listSessions() {
    return [];
  }
};

interface AuthBody {
  data: { token: string; user: { id: string } };
}

interface AutomationBody {
  code: number;
  data?: {
    automations?: Array<{ id: string; name: string; status: string }>;
    automation?: { id: string; name: string; status: string };
    suggestions?: Array<{ id: string; source: string; jobSpec: string }>;
    runs?: Array<{ id: string; status: string }>;
  };
}

describe("copilot automation routes", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let db: Database.Database;
  let baseUrl: string;

  before(async () => {
    db = createTestDb();
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager(mockTmuxClient as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey })
    });
    await new Promise<void>((resolve) => {
      server = app.server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  it("creates, lists, pauses, and deletes an automation", async () => {
    const token = await register("auto-crud@example.com");
    const headers = authenticated(token);

    const create = await fetch(`${baseUrl}/api/v1/copilot/automations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "每日简报",
        scopeType: "global",
        prompt: "汇总项目进展",
        scheduleKind: "cron",
        scheduleExpression: "0 9 * * *"
      })
    });
    const createBody = (await create.json()) as AutomationBody;
    assert.equal(create.status, 201, JSON.stringify(createBody));
    const created = createBody.data!.automation!;

    const list = await fetch(`${baseUrl}/api/v1/copilot/automations`, { headers });
    const listBody = (await list.json()) as AutomationBody;
    assert.equal(listBody.data!.automations!.length, 1);

    const pause = await fetch(`${baseUrl}/api/v1/copilot/automations/${created.id}/pause`, { method: "POST", headers });
    assert.equal(pause.status, 200);
    const paused = ((await pause.json()) as AutomationBody).data!.automation!;
    assert.equal(paused.status, "paused");

    const del = await fetch(`${baseUrl}/api/v1/copilot/automations/${created.id}`, { method: "DELETE", headers });
    assert.equal(del.status, 200);
  });

  it("rejects an invalid cron expression at create time", async () => {
    const token = await register("auto-bad-cron@example.com");
    const res = await fetch(`${baseUrl}/api/v1/copilot/automations`, {
      method: "POST",
      headers: authenticated(token),
      body: JSON.stringify({
        name: "坏表达式",
        scopeType: "global",
        prompt: "x",
        scheduleKind: "cron",
        scheduleExpression: "not a cron"
      })
    });
    assert.equal(res.status, 400);
  });

  it("serves catalog suggestions and accepts one to create an automation", async () => {
    const token = await register("auto-suggest@example.com");
    const headers = authenticated(token);

    const list = await fetch(`${baseUrl}/api/v1/copilot/automations/suggestions`, { headers });
    const listBody = (await list.json()) as AutomationBody;
    assert.ok((listBody.data!.suggestions!.length ?? 0) >= 1);
    const suggestion = listBody.data!.suggestions![0]!;

    const accept = await fetch(`${baseUrl}/api/v1/copilot/automations/suggestions/${suggestion.id}/accept`, { method: "POST", headers });
    const acceptBody = (await accept.json()) as AutomationBody;
    assert.equal(accept.status, 201, JSON.stringify(acceptBody));
    const accepted = acceptBody.data!.automation!;
    assert.equal(accepted.status, "draft");

    // Dismissed suggestions don't re-appear.
    const relist = await fetch(`${baseUrl}/api/v1/copilot/automations/suggestions`, { headers });
    const relistBody = (await relist.json()) as AutomationBody;
    assert.equal(relistBody.data!.suggestions!.some((s) => s.id === suggestion.id), false);
  });

  it("scopes an automation to its owner (foreign automation 404s)", async () => {
    const owner = await register("auto-owner@example.com");
    const stranger = await register("auto-stranger@example.com");
    const create = await fetch(`${baseUrl}/api/v1/copilot/automations`, {
      method: "POST",
      headers: authenticated(owner),
      body: JSON.stringify({
        name: "私有",
        scopeType: "global",
        prompt: "x",
        scheduleKind: "once",
        scheduleExpression: "2026-01-01T09:00:00.000Z"
      })
    });
    const created = ((await create.json()) as AutomationBody).data!.automation!;

    const get = await fetch(`${baseUrl}/api/v1/copilot/automations/${created.id}`, { headers: authenticated(stranger) });
    assert.equal(get.status, 404);
  });

  async function register(email: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    const body = (await res.json()) as AuthBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.token;
  }

  function authenticated(token: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }
});
