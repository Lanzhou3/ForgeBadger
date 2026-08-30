import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { CatalogRepository } from "../src/db/repositories/catalog-repository.js";
import { createGatewayApp } from "../src/server.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

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

interface AuthBody {
  data: {
    token: string;
    user: {
      id: string;
    };
  };
}

interface TemplateInstallBody {
  code: number;
  message: string;
  data?: {
    template: {
      id: string;
      name: string;
      version: string;
    };
    catalogItem: {
      id: string;
      externalId: string;
    };
  };
}

interface CatalogInstallBody {
  code: number;
  message: string;
  data?: {
    skill?: {
      id: string;
      name: string;
      source: string;
      version: string;
      isEnabled: boolean;
    };
    catalogItem: {
      id: string;
      externalId: string;
    };
  };
}

interface TemplateBody {
  data: {
    template: {
      id: string;
      name: string;
      files?: Array<{ filePath: string; content: string; fileType: string }>;
    };
  };
}

describe("catalog template install", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let baseUrl: string;
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

  after(() => {
    server.close();
    db.close();
  });

  it("imports a template package from a tenant-owned catalog item", async () => {
    const auth = await register("catalog-template-install@example.com");
    const item = new CatalogRepository(db, auth.userId).replaceItems("clawhub", [
      {
        sourceId: "clawhub",
        itemType: "template",
        externalId: "starter-template",
        name: "Starter Template",
        description: "Template from catalog",
        version: "2.0.0",
        metadata: {
          templatePackage: {
            name: "Starter Template",
            description: "Template from catalog",
            version: "2.0.0",
            files: [
              {
                filePath: ".claude/CLAUDE.md",
                content: "# {{projectName}}\n",
                fileType: "markdown"
              }
            ],
            exportedAt: "2026-05-02T00:00:00.000Z"
          }
        }
      }
    ])[0];

    const installRes = await fetch(`${baseUrl}/api/v1/catalog/items/${item.id}/install`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` }
    });
    const installBody = (await installRes.json()) as TemplateInstallBody;

    assert.equal(installRes.status, 201, JSON.stringify(installBody));
    assert.equal(installBody.data?.template.name, "Starter Template");
    assert.equal(installBody.data?.catalogItem.externalId, "starter-template");

    const templateRes = await fetch(`${baseUrl}/api/v1/templates/${installBody.data?.template.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` }
    });
    const templateBody = (await templateRes.json()) as TemplateBody;
    assert.equal(templateRes.status, 200);
    assert.equal(templateBody.data.template.files?.[0]?.filePath, ".claude/CLAUDE.md");
    assert.equal(templateBody.data.template.files?.[0]?.content, "# {{projectName}}\n");
  });

  it("does not expose catalog items across users", async () => {
    const owner = await register("catalog-template-owner@example.com");
    const other = await register("catalog-template-other@example.com");
    const item = new CatalogRepository(db, owner.userId).replaceItems("clawhub", [
      {
        sourceId: "clawhub",
        itemType: "template",
        externalId: "private-template",
        name: "Private Template",
        metadata: {
          templatePackage: {
            name: "Private Template",
            version: "1.0.0",
            files: [{ filePath: ".claude/CLAUDE.md", content: "private", fileType: "markdown" }]
          }
        }
      }
    ])[0];

    const installRes = await fetch(`${baseUrl}/api/v1/catalog/items/${item.id}/install`, {
      method: "POST",
      headers: { Authorization: `Bearer ${other.token}` }
    });
    const body = (await installRes.json()) as TemplateInstallBody;

    assert.equal(installRes.status, 404);
    assert.equal(body.code, 1);
  });

  it("installs a Skill package from a tenant-owned catalog item", async () => {
    const auth = await register("catalog-skill-install@example.com");
    const item = new CatalogRepository(db, auth.userId).replaceItems("clawhub", [
      {
        sourceId: "clawhub",
        itemType: "skill",
        externalId: "review-skill",
        name: "Review Skill",
        description: "Catalog Skill",
        version: "1.2.3",
        metadata: {
          skillPackage: {
            name: "review-skill",
            description: "Catalog Skill",
            version: "1.2.3",
            content: "# Review Skill\n"
          }
        }
      }
    ])[0];

    const installRes = await fetch(`${baseUrl}/api/v1/catalog/items/${item.id}/install`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` }
    });
    const body = (await installRes.json()) as CatalogInstallBody;

    assert.equal(installRes.status, 201, JSON.stringify(body));
    assert.equal(body.data?.skill?.name, "review-skill");
    assert.equal(body.data?.skill?.source, "catalog:clawhub");
    assert.equal(body.data?.skill?.isEnabled, false);
    assert.equal(body.data?.catalogItem.externalId, "review-skill");
  });



  async function register(email: string): Promise<{ token: string; userId: string }> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    const body = (await res.json()) as AuthBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return {
      token: body.data.token,
      userId: body.data.user.id
    };
  }
});
