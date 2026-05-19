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
import { ApiKeyRepository } from "../src/db/repositories/api-key-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createDiagnosticsRoutes } from "../src/routes/diagnostics.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "a".repeat(64);

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

describe("diagnostics routes", () => {
  let db: Database.Database;
  let app: express.Express;
  let token: string;
  let userId: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("diagnostics-route@example.com", "hash");
    userId = user.id;
    token = signJwt({ userId: user.id, email: user.email }, secret);
    new ApiKeyRepository(db, user.id, masterKey).create({
      provider: "openai",
      plaintextKey: "sk-route-secret"
    });
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/diagnostics", createDiagnosticsRoutes({
      db,
      masterKey,
      appVersion: "0.0.0-test"
    }));
  });

  it("exports authenticated local diagnostics without plaintext secrets", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/diagnostics/export", undefined, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.report.app.version, "0.0.0-test");
    assert.equal(res.body.data.report.counts.apiKeys, 1);
    assert.equal(res.body.data.report.copilot.capabilities.enabled, true);
    assert.equal(res.body.data.report.copilot.capabilities.approvalRequiredForWrites, true);
    assert.equal(res.body.data.report.copilot.capabilities.memoryEnabled, true);
    assert.equal(res.body.data.report.copilot.providerReadiness.providerConfigured, false);
    assert.deepEqual(res.body.data.report.copilot.providerReadiness.supportedProviderFormats, [
      "openai",
      "openai-compatible",
      "anthropic"
    ]);
    assert.equal(res.body.data.report.copilot.providerReadiness.counts.activeProviders, 0);
    assert.equal(res.body.data.report.copilot.providerReadiness.counts.activeModels, 0);
    assert.equal(res.body.data.report.copilot.providerReadiness.counts.activeCredentials, 0);
    assert.equal(JSON.stringify(res.body).includes("sk-route-secret"), false);
  });

  it("marks Copilot provider readiness from Provider SSOT", async () => {
    const providers = new ModelProviderRepository(db, userId, masterKey);
    const provider = providers.createProviderProfile({
      name: "OpenAI",
      providerKey: "openai",
      baseUrl: "https://api.openai.com/v1",
      authType: "api_key",
      apiFormat: "openai",
      supportedAdapters: ["opencode"]
    });
    providers.createModelProfile({
      providerProfileId: provider.id,
      name: "GPT 5.1",
      modelId: "gpt-5.1",
      isDefault: true
    });
    providers.createCredential({
      providerProfileId: provider.id,
      label: "Disposable key",
      plaintextSecret: "sk-provider-secret"
    });

    const res = await makeRequest(app, "GET", "/api/v1/diagnostics/export", undefined, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.report.copilot.providerReadiness.providerConfigured, true);
    assert.equal(res.body.data.report.copilot.providerReadiness.counts.activeProviders, 1);
    assert.equal(res.body.data.report.copilot.providerReadiness.counts.activeModels, 1);
    assert.equal(res.body.data.report.copilot.providerReadiness.counts.activeCredentials, 1);
    assert.equal(res.body.data.report.copilot.providerReadiness.counts.readyProviders, 1);
    assert.equal(JSON.stringify(res.body).includes("sk-provider-secret"), false);
  });
});

async function makeRequest(
  app: express.Express,
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: pathname,
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
          }
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode || 0,
              body: data ? JSON.parse(data) : undefined
            });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}
