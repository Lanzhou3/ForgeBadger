import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

interface AuthBody {
  data: { token: string };
}

interface SkillInstallBody {
  code: number;
  message?: string;
  data?: {
    skill: {
      id: string;
      name: string;
      source: string;
      isEnabled: boolean;
    };
  };
}

let baseUrl: string;

describe("Skill source installation API", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let db: Database;

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
        if (address && typeof address !== "string") {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    db.close();
  });

  it("installs direct source Skills disabled by default and owner-scoped", async () => {
    const ownerToken = await register("skill-install-owner@example.com");
    const otherToken = await register("skill-install-other@example.com");

    const installRes = await fetch(`${baseUrl}/api/v1/skills/install`, {
      method: "POST",
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({
        sourceId: "github",
        name: "review-workflow",
        content: "# Review Workflow\n"
      })
    });
    const installBody = (await installRes.json()) as SkillInstallBody;

    assert.equal(installRes.status, 201, JSON.stringify(installBody));
    assert.ok(installBody.data);
    assert.equal(installBody.data.skill.name, "review-workflow");
    assert.equal(installBody.data.skill.source, "github");
    assert.equal(installBody.data.skill.isEnabled, false);

    const otherRead = await fetch(`${baseUrl}/api/v1/skills/${installBody.data.skill.id}`, {
      headers: jsonHeaders(otherToken)
    });
    const otherReadBody = await otherRead.json() as { code: number; message?: string };

    assert.equal(otherRead.status, 404);
    assert.equal(otherReadBody.code, 1);
  });
});

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
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

async function register(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" })
  });
  const body = (await res.json()) as AuthBody;
  return body.data.token;
}

function jsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}
