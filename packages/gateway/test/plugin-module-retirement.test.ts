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
import { CatalogRepository } from "../src/db/repositories/catalog-repository.js";
import { UserRepository } from "../src/db/repositories/index.js";
import { builtinSkillSeeds } from "../src/services/builtin-skills.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.OPENFORGE_JWT_SECRET = jwtSecret;
process.env.OPENFORGE_MASTER_KEY = masterKey;

interface AuthBody {
  data: { token: string };
}

interface SkillBody {
  code: number;
  message?: string;
  data?: { skills: Array<{ id: string; name: string; source: string; isEnabled: boolean }> };
}

let baseUrl: string;

describe("plugin module retirement", () => {
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

  it("returns 404 for the retired plugins REST API", async () => {
    const token = await register("retire-404@example.com");
    const headers = jsonHeaders(token);

    const res = await fetch(`${baseUrl}/api/v1/plugins`, { headers });
    assert.equal(res.status, 404);

    const toggle = await fetch(`${baseUrl}/api/v1/plugins/claude-safe-edits/toggle`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true })
    });
    assert.equal(toggle.status, 404);

    const list = await fetch(`${baseUrl}/api/v1/plugins/enabled`, { headers });
    assert.equal(list.status, 404);
  });

  it("serves plugin catalog items filtered out and rejects their installation", async () => {
    const email = "retire-catalog@example.com";
    const token = await register(email);
    const headers = jsonHeaders(token);
    const user = new UserRepository(db).findByEmail(email);
    assert.ok(user, "user must exist after register");
    const userId = user.id;

    const item = new CatalogRepository(db, userId).replaceItems("clawhub", [
      {
        sourceId: "clawhub",
        itemType: "plugin",
        externalId: "legacy-plugin",
        name: "Legacy Plugin",
        description: "Legacy catalog plugin",
        version: "1.0.0",
        metadata: {
          pluginPackage: {
            id: "legacy-plugin",
            name: "Legacy Plugin",
            adapter: "claude",
            category: "workflow",
            configPath: ".claude/plugins/legacy/plugin.json"
          }
        }
      }
    ])[0];

    const itemsRes = await fetch(`${baseUrl}/api/v1/catalog/items`, { headers });
    const itemsBody = (await itemsRes.json()) as { code: number; data: { items: Array<{ externalId: string }> } };
    assert.equal(itemsRes.status, 200);
    assert.equal(itemsBody.data.items.some((i) => i.externalId === "legacy-plugin"), false);

    const installRes = await fetch(`${baseUrl}/api/v1/catalog/items/${item.id}/install`, {
      method: "POST",
      headers
    });
    const installBody = (await installRes.json()) as { code: number; message?: string };
    assert.equal(installRes.status, 409);
    assert.equal(installBody.code, 1);
    assert.match(installBody.message ?? "", /Unsupported catalog item type/);
  });

  it("seeds three builtin skills on first skill list read, idempotently, without overwriting user edits", async () => {
    const token = await register("retire-builtin@example.com");
    const headers = jsonHeaders(token);

    const firstRes = await fetch(`${baseUrl}/api/v1/skills`, { headers });
    const firstBody = (await firstRes.json()) as SkillBody;
    assert.equal(firstRes.status, 200);
    assert.ok(firstBody.data);
    const builtins = firstBody.data.skills.filter((s) => s.source === "builtin");
    assert.equal(builtins.length, 3);
    assert.deepEqual(
      builtins.map((s) => s.name).sort(),
      builtinSkillSeeds.map((s) => s.name).sort()
    );
    assert.equal(builtins.every((s) => s.isEnabled === true), true);

    // Second read does not duplicate them.
    const secondRes = await fetch(`${baseUrl}/api/v1/skills`, { headers });
    const secondBody = (await secondRes.json()) as SkillBody;
    assert.ok(secondBody.data);
    assert.equal(secondBody.data.skills.filter((s) => s.source === "builtin").length, 3);

    // Editing a builtin skill is preserved across a later seed.
    const edited = builtins[0];
    const updateRes = await fetch(`${baseUrl}/api/v1/skills/${edited.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        name: edited.name,
        content: "# User customized builtin\n"
      })
    });
    assert.equal(updateRes.status, 200, JSON.stringify(await updateRes.json()));

    const toggleRes = await fetch(`${baseUrl}/api/v1/skills/${edited.id}/toggle`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(toggleRes.status, 200, JSON.stringify(await toggleRes.json()));

    const thirdRes = await fetch(`${baseUrl}/api/v1/skills`, { headers });
    const thirdBody = (await thirdRes.json()) as SkillBody;
    assert.ok(thirdBody.data);
    const reRead = thirdBody.data.skills.find((s) => s.id === edited.id);
    assert.equal(reRead?.content, "# User customized builtin\n");
    assert.equal(reRead?.isEnabled, false);
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