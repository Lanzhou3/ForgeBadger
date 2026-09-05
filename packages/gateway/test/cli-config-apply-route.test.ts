import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { CliConfigAppliedProviderRepository } from "../src/db/repositories/cli-config-applied-provider-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createCliConfigRoutes } from "../src/routes/cli-config.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

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

describe("cli-config apply-provider route", () => {
  let db: Database.Database;
  let token: string;
  let server: http.Server | undefined;
  let baseUrl: string;
  let configRoot: string;

  beforeEach(async () => {
    db = createTestDb();
    const user = new UserRepository(db).create("apply-route@example.com", "hash", { role: "admin" });
    token = signJwt({ userId: user.id, email: user.email }, secret);
    configRoot = await mkdtemp(path.join(tmpdir(), "forgebadger-apply-route-"));
    process.env.CLAUDE_CONFIG_DIR = configRoot;

    const app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/cli-config", createCliConfigRoutes(db, masterKey, { resolveHost: publicResolver }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  function createProvider() {
    const repo = new ModelProviderRepository(db, userIdFromToken(), masterKey);
    const provider = repo.createProviderProfile({
      name: "DeepSeek",
      providerKey: "deepseek",
      baseUrl: "https://api.deepseek.com",
      anthropicBaseUrl: "https://api.deepseek.com/anthropic",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["claude", "codex"]
    });
    const model = repo.createModelProfile({
      providerProfileId: provider.id,
      name: "Default Model",
      modelId: "deepseek-chat",
      isDefault: true
    });
    repo.createCredential({ providerProfileId: provider.id, plaintextSecret: "sk-route-secret" });
    return { provider, model };
  }

  function userIdFromToken(): string {
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as { sub?: string; userId?: string };
    return payload.userId ?? payload.sub ?? "";
  }

  async function post(pathname: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  }

  it("applies a Claude provider with a role mapping over HTTP", async () => {
    const { provider, model } = createProvider();
    const repo = new ModelProviderRepository(db, userIdFromToken(), masterKey);
    const fast = repo.createModelProfile({
      providerProfileId: provider.id, name: "Fast", modelId: "deepseek-flash"
    });

    const applied = await post("/api/v1/cli-config/claude/apply-provider", {
      providerProfileId: provider.id,
      modelProfileId: model.id,
      modelMapping: { haiku: fast.id }
    });

    assert.equal(applied.status, 200, JSON.stringify(applied.json));
    assert.equal(applied.json.code, 0);
    const doc = JSON.parse(await readFile(path.join(configRoot, "settings.json"), "utf8")) as {
      env: Record<string, string>;
    };
    assert.equal(doc.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "deepseek-flash");
    assert.equal(doc.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "deepseek-chat");
  });

  it("records the applied-provider pointer on apply and clears it on rollback", async () => {
    const { provider, model } = createProvider();
    const pointers = new CliConfigAppliedProviderRepository(db, userIdFromToken());

    const applied = await post("/api/v1/cli-config/claude/apply-provider", {
      providerProfileId: provider.id,
      modelProfileId: model.id
    });

    assert.equal(applied.status, 200, JSON.stringify(applied.json));
    assert.equal(pointers.get("claude")?.providerProfileId, provider.id);
    assert.equal(pointers.get("claude")?.modelProfileId, model.id);

    const rolledBack = await post("/api/v1/cli-config/claude/rollback", {});

    assert.equal(rolledBack.status, 200, JSON.stringify(rolledBack.json));
    assert.equal(pointers.get("claude"), undefined);
  });

  it("serves concurrent previews without lock contention (dry-run is lock-free)", async () => {
    const { provider, model } = createProvider();
    const [first, second] = await Promise.all([
      post("/api/v1/cli-config/claude/apply-provider/preview", { providerProfileId: provider.id }),
      post("/api/v1/cli-config/claude/apply-provider/preview", {
        providerProfileId: provider.id,
        modelProfileId: model.id
      })
    ]);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(first.json.code, 0);
    assert.equal(second.json.code, 0);
  });

  it("rejects unknown modelMapping keys with a 400 envelope", async () => {
    const { provider } = createProvider();
    const applied = await post("/api/v1/cli-config/claude/apply-provider", {
      providerProfileId: provider.id,
      modelMapping: { unknown_slot: "x" }
    });
    assert.equal(applied.status, 400);
    assert.equal(applied.json.code, 1);
    assert.ok(applied.json.message);
  });

  it("rejects modelMapping on the Codex adapter with a 400 envelope", async () => {
    const { provider, model } = createProvider();
    const applied = await post("/api/v1/cli-config/codex/apply-provider", {
      providerProfileId: provider.id,
      modelProfileId: model.id,
      modelMapping: { opus: model.id }
    });
    assert.equal(applied.status, 400);
    assert.equal(applied.json.code, 1);
    const details = applied.json.details as { code?: string } | undefined;
    assert.equal(details?.code, "CLI_CONFIG_APPLY_FIELD_UNSUPPORTED");
  });
});
