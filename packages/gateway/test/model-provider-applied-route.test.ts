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
import { CliConfigAppliedProviderRepository } from "../src/db/repositories/cli-config-applied-provider-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createModelProviderRoutes } from "../src/routes/model-providers.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

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

describe("model provider applied route", () => {
  let db: Database.Database;
  let userId: string;
  let token: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("applied-route@example.com", "hash");
    userId = user.id;
    token = signJwt({ userId: user.id, email: user.email }, secret);
  });

  function buildApp(): express.Express {
    const app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey));
    return app;
  }

  function createProvider(name: string, providerKey: string): string {
    return new ModelProviderRepository(db, userId, masterKey).createProviderProfile({
      name,
      providerKey,
      baseUrl: "https://api.deepseek.com",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["claude", "codex"]
    }).id;
  }

  async function get(adapter: string, bearer: string = token): Promise<{ status: number; body: any }> {
    const server = http.createServer(buildApp());
    const baseUrl = await listen(server);
    try {
      const res = await fetch(`${baseUrl}/api/v1/model-providers/applied/${adapter}`, {
        headers: { Authorization: `Bearer ${bearer}` }
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("returns null when no provider was applied to the adapter", async () => {
    const res = await get("claude");

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.appliedProvider, null);
  });

  it("returns the applied provider with its profile name", async () => {
    const providerId = createProvider("DeepSeek", "deepseek");
    new CliConfigAppliedProviderRepository(db, userId).upsert("claude", providerId, "model-1");

    const res = await get("claude");

    assert.equal(res.status, 200);
    const applied = res.body.data.appliedProvider;
    assert.equal(applied.providerProfileId, providerId);
    assert.equal(applied.providerName, "DeepSeek");
    assert.equal(applied.providerStatus, "active");
    assert.equal(applied.modelProfileId, "model-1");
    assert.equal(typeof applied.appliedAt, "string");
  });

  it("returns null after the applied provider is deleted", async () => {
    const providerId = createProvider("DeepSeek", "deepseek");
    new CliConfigAppliedProviderRepository(db, userId).upsert("claude", providerId, null);
    new ModelProviderRepository(db, userId, masterKey).deleteProviderProfile(providerId);

    const res = await get("claude");

    assert.equal(res.status, 200);
    assert.equal(res.body.data.appliedProvider, null);
  });

  it("does not leak another tenant's applied provider", async () => {
    const providerId = createProvider("DeepSeek", "deepseek");
    new CliConfigAppliedProviderRepository(db, userId).upsert("claude", providerId, null);
    const other = new UserRepository(db).create("applied-route-other@example.com", "hash");
    const otherToken = signJwt({ userId: other.id, email: other.email }, secret);

    const res = await get("claude", otherToken);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.appliedProvider, null);
  });

  it("rejects an unknown adapter with a 400 envelope", async () => {
    const res = await get("not-an-adapter");

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
  });
});

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
