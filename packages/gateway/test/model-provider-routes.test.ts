import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createModelProviderRoutes } from "../src/routes/model-providers.js";
import { createCodexSubscriptionRoutes } from "../src/routes/codex-subscription.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("model provider routes", () => {
  let app: express.Express;
  let db: Database.Database;
  let token: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("provider-routes@example.com", "hash");
    token = signJwt({ userId: user.id, email: user.email }, secret);
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey));
    app.use("/api/v1/codex/subscription", createCodexSubscriptionRoutes());
  });

  it("creates a provider from catalog and applies an OpenCode preview with envelope responses", async () => {
    const catalog = await makeRequest(app, "GET", "/api/v1/model-providers/catalog", undefined, authHeaders());
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.code, 0);
    assert.ok(catalog.body.data.providers.some((provider: { id: string }) => provider.id === "deepseek"));

    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    assert.equal(created.status, 201);
    const provider = created.body.data.provider;
    assert.equal(provider.providerKey, "deepseek");
    assert.equal(created.body.data.models.length > 0, true);

    const root = await mkdtemp(path.join(tmpdir(), "openforge-provider-route-"));
    const preview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: root,
      modelProfileId: created.body.data.models[0].id
    }, authHeaders());

    assert.equal(preview.status, 200);
    assert.equal(preview.body.code, 0);
    assert.equal(preview.body.data.preview.adapter, "opencode");
    assert.equal(preview.body.data.preview.changedFiles[0].relativePath, "opencode.json");
  });

  it("rejects apply requests that reference another provider's model or credential", async () => {
    const deepseek = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    const openai = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "openai"
    }, authHeaders());
    const credential = await makeRequest(app, "POST", `/api/v1/model-providers/${openai.body.data.provider.id}/credentials`, {
      plaintextSecret: "sk-openai"
    }, authHeaders());
    const root = await mkdtemp(path.join(tmpdir(), "openforge-provider-route-"));

    const mismatchedModel = await makeRequest(app, "POST", `/api/v1/model-providers/${deepseek.body.data.provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: root,
      modelProfileId: openai.body.data.models[0].id
    }, authHeaders());
    const mismatchedCredential = await makeRequest(app, "POST", `/api/v1/model-providers/${deepseek.body.data.provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: root,
      modelProfileId: deepseek.body.data.models[0].id,
      credentialId: credential.body.data.credential.id
    }, authHeaders());

    assert.equal(mismatchedModel.status, 400);
    assert.equal(mismatchedModel.body.code, 1);
    assert.match(mismatchedModel.body.message, /provider/i);
    assert.equal(mismatchedCredential.status, 400);
    assert.equal(mismatchedCredential.body.code, 1);
    assert.match(mismatchedCredential.body.message, /provider/i);
  });

  it("deletes an added provider profile with its models and credentials", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    const providerId = created.body.data.provider.id;
    await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-deepseek"
    }, authHeaders());

    const deleted = await makeRequest(app, "DELETE", `/api/v1/model-providers/${providerId}`, undefined, authHeaders());
    const listed = await makeRequest(app, "GET", "/api/v1/model-providers", undefined, authHeaders());

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.code, 0);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.providers.some((provider: { id: string }) => provider.id === providerId), false);
    assert.equal(listed.body.data.models.some((model: { providerProfileId: string }) => model.providerProfileId === providerId), false);
    assert.equal(listed.body.data.credentials.some((credential: { providerProfileId: string }) => credential.providerProfileId === providerId), false);
  });

  it("returns envelope errors for invalid custom provider payloads and denied apply roots", async () => {
    const invalidCustom = await makeRequest(app, "POST", "/api/v1/model-providers", {
      name: "Missing fields"
    }, authHeaders());
    assert.equal(invalidCustom.status, 400);
    assert.equal(invalidCustom.body.code, 1);

    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    const preview = await makeRequest(app, "POST", `/api/v1/model-providers/${created.body.data.provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: "/",
      modelProfileId: created.body.data.models[0].id
    }, authHeaders());

    assert.equal(preview.status, 400);
    assert.equal(preview.body.code, 1);
    assert.match(preview.body.message, /Project root/);
  });

  it("exposes Codex subscription status without provider apply wiring", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/codex/subscription/status", undefined, authHeaders());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.status.providerApplyEnabled, false);
    assert.equal(res.body.data.status.identitySource, "chatgpt_subscription_sdk");
    assert.equal(res.body.data.status.sdk.packageName, "@openai/codex-sdk");
    assert.equal(res.body.data.status.sdk.docsUrl, "https://developers.openai.com/codex/sdk");
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
