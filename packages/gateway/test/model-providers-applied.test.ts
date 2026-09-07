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
import { createModelProviderRoutes, type ModelProviderRouteOptions } from "../src/routes/model-providers.js";
import type { AdapterId } from "../src/services/adapter-discovery.js";
import type { CliConfigSnapshot } from "../src/services/cli-config.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const ADAPTERS: AdapterId[] = ["claude", "opencode", "codex", "kimi"];

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

function snapshotWith(defaultModel: string): CliConfigSnapshot {
  return {
    adapter: "claude",
    configRoot: "/tmp/irrelevant",
    configFile: "settings.json",
    files: [],
    providers: [],
    models: [],
    defaultModel
  };
}

describe("model providers applied overview route", () => {
  let db: Database.Database;
  let userId: string;
  let token: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("applied-overview@example.com", "hash");
    userId = user.id;
    token = signJwt({ userId: user.id, email: user.email }, secret);
  });

  function buildApp(options: ModelProviderRouteOptions = {}): express.Express {
    const app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, options));
    return app;
  }

  async function getOverview(bearer: string = token, options: ModelProviderRouteOptions = {}): Promise<{ status: number; body: any }> {
    const server = http.createServer(buildApp(options));
    const baseUrl = await listen(server);
    try {
      const res = await fetch(`${baseUrl}/api/v1/model-providers/applied`, {
        headers: { Authorization: `Bearer ${bearer}` }
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  function createProviderAndModel(name: string, modelName: string, modelId: string): { providerId: string; modelProfileId: string } {
    const repo = new ModelProviderRepository(db, userId, masterKey);
    const provider = repo.createProviderProfile({
      name,
      providerKey: name.toLowerCase(),
      baseUrl: "https://api.deepseek.com",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: [...ADAPTERS]
    });
    const model = repo.createModelProfile({
      providerProfileId: provider.id,
      name: modelName,
      modelId
    });
    return { providerId: provider.id, modelProfileId: model.id };
  }

  function promoteToAdmin(id: string): void {
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run("admin", id);
  }

  it("returns all four adapters with null applied when no pointers exist", async () => {
    const res = await getOverview();

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    const adapters = res.body.data.adapters;
    assert.deepEqual(adapters.map((entry: any) => entry.adapter), ADAPTERS);
    for (const entry of adapters) {
      assert.equal(entry.applied, null);
      assert.equal(entry.configDefaultModel, null);
      assert.equal(entry.stale, false);
    }
  });

  it("joins provider and model names for an applied pointer", async () => {
    const { providerId, modelProfileId } = createProviderAndModel("DeepSeek", "DeepSeek Chat", "deepseek-chat");
    new CliConfigAppliedProviderRepository(db, userId).upsert("claude", providerId, modelProfileId);

    const res = await getOverview();

    assert.equal(res.status, 200);
    const claude = res.body.data.adapters.find((entry: any) => entry.adapter === "claude");
    assert.equal(claude.applied.providerProfileId, providerId);
    assert.equal(claude.applied.providerName, "DeepSeek");
    assert.equal(claude.applied.providerStatus, "active");
    assert.equal(claude.applied.modelProfileId, modelProfileId);
    assert.equal(claude.applied.modelId, "deepseek-chat");
    assert.equal(claude.applied.modelName, "DeepSeek Chat");
    assert.equal(typeof claude.applied.appliedAt, "string");
    assert.equal(claude.stale, false);
    const kimi = res.body.data.adapters.find((entry: any) => entry.adapter === "kimi");
    assert.equal(kimi.applied, null);
  });

  it("keeps the pointer with null fields and stale=true when the provider/model are gone", async () => {
    // Insert a dangling pointer with FK checks off: the real schema cascades
    // pointer rows on provider delete, but older databases may still hold one.
    db.pragma("foreign_keys = OFF");
    new CliConfigAppliedProviderRepository(db, userId).upsert("codex", "ghost-provider", "ghost-model");
    db.pragma("foreign_keys = ON");

    const res = await getOverview();

    assert.equal(res.status, 200);
    const codex = res.body.data.adapters.find((entry: any) => entry.adapter === "codex");
    assert.equal(codex.applied.providerProfileId, "ghost-provider");
    assert.equal(codex.applied.providerName, null);
    assert.equal(codex.applied.providerStatus, null);
    assert.equal(codex.applied.modelProfileId, "ghost-model");
    assert.equal(codex.applied.modelId, null);
    assert.equal(codex.applied.modelName, null);
    assert.equal(codex.stale, true);
  });

  it("marks stale=false for an admin when the config defaultModel matches", async () => {
    promoteToAdmin(userId);
    const { providerId, modelProfileId } = createProviderAndModel("DeepSeek", "DeepSeek Chat", "deepseek-chat");
    new CliConfigAppliedProviderRepository(db, userId).upsert("claude", providerId, modelProfileId);

    const res = await getOverview(token, {
      readCliConfigSnapshot: async () => snapshotWith("deepseek-chat")
    });

    assert.equal(res.status, 200);
    const claude = res.body.data.adapters.find((entry: any) => entry.adapter === "claude");
    assert.equal(claude.configDefaultModel, "deepseek-chat");
    assert.equal(claude.stale, false);
  });

  it("marks stale=true for an admin when the config defaultModel differs", async () => {
    promoteToAdmin(userId);
    const { providerId, modelProfileId } = createProviderAndModel("DeepSeek", "DeepSeek Chat", "deepseek-chat");
    new CliConfigAppliedProviderRepository(db, userId).upsert("claude", providerId, modelProfileId);

    const res = await getOverview(token, {
      readCliConfigSnapshot: async () => snapshotWith("someone-else-model")
    });

    assert.equal(res.status, 200);
    const claude = res.body.data.adapters.find((entry: any) => entry.adapter === "claude");
    assert.equal(claude.configDefaultModel, "someone-else-model");
    assert.equal(claude.stale, true);
  });

  it("parses the kimi <providerKey>/<modelId> defaultModel format for comparison", async () => {
    promoteToAdmin(userId);
    const { providerId, modelProfileId } = createProviderAndModel("Moonshot", "Kimi K2", "kimi-k2-0905");
    new CliConfigAppliedProviderRepository(db, userId).upsert("kimi", providerId, modelProfileId);

    const matching = await getOverview(token, {
      readCliConfigSnapshot: async (adapter) => snapshotWith(adapter === "kimi" ? "moonshot/kimi-k2-0905" : "")
    });
    const kimiMatch = matching.body.data.adapters.find((entry: any) => entry.adapter === "kimi");
    assert.equal(kimiMatch.configDefaultModel, "moonshot/kimi-k2-0905");
    assert.equal(kimiMatch.stale, false);

    const drifted = await getOverview(token, {
      readCliConfigSnapshot: async (adapter) => snapshotWith(adapter === "kimi" ? "moonshot/other-model" : "")
    });
    const kimiDrift = drifted.body.data.adapters.find((entry: any) => entry.adapter === "kimi");
    assert.equal(kimiDrift.stale, true);
  });

  it("keeps stale=false when the snapshot cannot be read", async () => {
    promoteToAdmin(userId);
    const { providerId, modelProfileId } = createProviderAndModel("DeepSeek", "DeepSeek Chat", "deepseek-chat");
    new CliConfigAppliedProviderRepository(db, userId).upsert("claude", providerId, modelProfileId);

    const res = await getOverview(token, {
      readCliConfigSnapshot: async () => { throw new Error("config unreadable"); }
    });

    assert.equal(res.status, 200);
    const claude = res.body.data.adapters.find((entry: any) => entry.adapter === "claude");
    assert.equal(claude.configDefaultModel, null);
    assert.equal(claude.stale, false);
  });

  it("hides configDefaultModel from non-admin users and never calls the snapshot reader", async () => {
    const { providerId, modelProfileId } = createProviderAndModel("DeepSeek", "DeepSeek Chat", "deepseek-chat");
    new CliConfigAppliedProviderRepository(db, userId).upsert("claude", providerId, modelProfileId);
    let snapshotReads = 0;

    const res = await getOverview(token, {
      readCliConfigSnapshot: async () => {
        snapshotReads += 1;
        return snapshotWith("different-model");
      }
    });

    assert.equal(res.status, 200);
    assert.equal(snapshotReads, 0);
    const claude = res.body.data.adapters.find((entry: any) => entry.adapter === "claude");
    assert.equal(claude.configDefaultModel, null);
    assert.equal(claude.stale, false);
  });

  it("does not expose another tenant's applied pointer", async () => {
    const { providerId, modelProfileId } = createProviderAndModel("DeepSeek", "DeepSeek Chat", "deepseek-chat");
    new CliConfigAppliedProviderRepository(db, userId).upsert("claude", providerId, modelProfileId);
    const other = new UserRepository(db).create("applied-overview-other@example.com", "hash");
    const otherToken = signJwt({ userId: other.id, email: other.email }, secret);

    const res = await getOverview(otherToken);

    assert.equal(res.status, 200);
    for (const entry of res.body.data.adapters) {
      assert.equal(entry.applied, null);
    }
  });

  it("requires authentication", async () => {
    const server = http.createServer(buildApp());
    const baseUrl = await listen(server);
    try {
      const res = await fetch(`${baseUrl}/api/v1/model-providers/applied`);
      assert.equal(res.status, 401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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
