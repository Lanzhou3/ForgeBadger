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
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createModelProviderRoutes } from "../src/routes/model-providers.js";
import type { FetchProviderBalanceInput } from "../src/services/provider-balance.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const deepseekProviderInput = {
  name: "DeepSeek",
  providerKey: "deepseek",
  baseUrl: "https://api.deepseek.com",
  anthropicBaseUrl: "https://api.deepseek.com/anthropic",
  openaiBaseUrl: "https://api.deepseek.com",
  authType: "api_key",
  apiFormat: "openai-compatible",
  supportedAdapters: ["claude", "opencode"]
};

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

describe("model provider balance route", () => {
  let db: Database.Database;
  let token: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("provider-balance@example.com", "hash", { role: "admin" });
    token = signJwt({ userId: user.id, email: user.email }, secret);
  });

  function buildApp(
    fetchProviderBalance: (input: FetchProviderBalanceInput) => Promise<{
      supported: boolean;
      detectedProvider?: string;
      balances: Array<{ label: string; remaining: number; unit: string }>;
    }>
  ): express.Express {
    const app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      fetchProviderBalance
    }));
    return app;
  }

  async function createDeepSeekProvider(app: express.Express): Promise<string> {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    assert.equal(created.status, 201);
    return created.body.data.provider.id;
  }

  it("returns 404 when the provider does not exist", async () => {
    const app = buildApp(async () => ({ supported: false, balances: [] }));

    const res = await makeRequest(app, "POST", "/api/v1/model-providers/missing/balance", {}, authHeaders());

    assert.equal(res.status, 404);
    assert.equal(res.body.code, 1);
  });

  it("returns 400 when a credential-bearing provider has no active credential", async () => {
    let fetchCalled = false;
    const app = buildApp(async () => {
      fetchCalled = true;
      return { supported: false, balances: [] };
    });
    const providerId = await createDeepSeekProvider(app);

    const res = await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/balance`, {}, authHeaders());

    assert.equal(res.status, 400);
    assert.match(res.body.message, /credential/i);
    assert.equal(fetchCalled, false);
  });

  it("returns 502 with a redacted message when the upstream balance query fails", async () => {
    const app = buildApp(async () => {
      throw new Error("Balance query failed (HTTP 500): upstream echoed sk-route-leaked123");
    });
    const providerId = await createDeepSeekProvider(app);
    await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-route-leaked123"
    }, authHeaders());

    const res = await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/balance`, {}, authHeaders());

    assert.equal(res.status, 502);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.message.includes("sk-route-leaked123"), false);
    assert.match(res.body.message, /\[REDACTED\]/);
  });

  it("queries balance with the provider endpoints and decrypted credential", async () => {
    const balanceInputs: FetchProviderBalanceInput[] = [];
    const app = buildApp(async (input) => {
      balanceInputs.push(input);
      return {
        supported: true,
        detectedProvider: "deepseek",
        balances: [{ label: "CNY", remaining: 42.5, unit: "CNY" }]
      };
    });
    const providerId = await createDeepSeekProvider(app);
    await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-deepseek"
    }, authHeaders());

    const res = await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/balance`, {}, authHeaders());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.message, "");
    assert.equal(res.body.data.supported, true);
    assert.equal(res.body.data.detectedProvider, "deepseek");
    assert.deepEqual(res.body.data.balances, [{ label: "CNY", remaining: 42.5, unit: "CNY" }]);
    assert.equal(typeof res.body.data.checkedAt, "string");
    assert.equal(balanceInputs.length, 1);
    assert.equal(balanceInputs[0]?.baseUrls[0], "https://api.deepseek.com");
    assert.equal(balanceInputs[0]?.apiKey, "sk-deepseek");
    assert.equal(JSON.stringify(res.body).includes("sk-deepseek"), false);
  });

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
  }
});

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
