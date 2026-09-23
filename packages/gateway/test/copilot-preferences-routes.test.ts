import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createCopilotRoutes } from "../src/routes/copilot.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { signJwt } from "../src/auth/jwt.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";

const jwtSecret = "fixture-secret-".repeat(3);

it("persists and validates the copilot model + thinking preference", async () => {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  const user = new UserRepository(db).create("pref-routes@example.com", "hash");
  const providerRepo = new ModelProviderRepository(db, user.id, "test");
  const provider = providerRepo.createProviderProfile({
    name: "Stub",
    providerKey: "stub",
    baseUrl: "https://stub.example",
    authType: "api_key",
    apiFormat: "openai",
    supportedAdapters: ["opencode"],
  });
  const profile = providerRepo.createModelProfile({
    providerProfileId: provider.id,
    name: "Stub model",
    modelId: "stub-model",
    capabilities: ["chat"],
    isDefault: true,
  });
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.locals.jwtSecret = jwtSecret;
  app.use("/api/v1/copilot", createCopilotRoutes({ db, masterKey: "test", eventBus: new ForgeBadgerEventBus() }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing test server port");
  const base = `http://127.0.0.1:${address.port}/api/v1/copilot/preferences`;
  const headers = {
    Authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, jwtSecret)}`,
    "Content-Type": "application/json",
  };

  try {
    // Fresh default: no model, effort "off".
    let res = await fetch(base, { headers });
    let body = (await res.json()) as { code: number; data: { modelId: string | null; thinkingEffort: string }; message: string };
    assert.equal(res.status, 200);
    assert.equal(body.code, 0);
    assert.deepEqual(body.data, { modelId: null, thinkingEffort: "off" });

    // Partial update: effort only, model untouched.
    res = await fetch(base, { method: "PUT", headers, body: JSON.stringify({ thinkingEffort: "high" }) });
    body = (await res.json()) as typeof body;
    assert.equal(res.status, 200);
    assert.equal(body.data.modelId, null);
    assert.equal(body.data.thinkingEffort, "high");

    // Follow-up GET proves persistence.
    res = await fetch(base, { headers });
    body = (await res.json()) as typeof body;
    assert.equal(res.status, 200);
    assert.equal(body.data.thinkingEffort, "high");

    // Set a model, then clear it with an explicit null.
    res = await fetch(base, { method: "PUT", headers, body: JSON.stringify({ modelId: profile.id }) });
    body = (await res.json()) as typeof body;
    assert.equal(res.status, 200);
    assert.equal(body.data.modelId, profile.id);
    assert.equal(body.data.thinkingEffort, "high");

    res = await fetch(base, { method: "PUT", headers, body: JSON.stringify({ modelId: null }) });
    body = (await res.json()) as typeof body;
    assert.equal(res.status, 200);
    assert.equal(body.data.modelId, null);
    assert.equal(body.data.thinkingEffort, "high");

    // Unknown model profile: domain rejection (400, details.code carries the reason).
    res = await fetch(base, { method: "PUT", headers, body: JSON.stringify({ modelId: "no-such-profile" }) });
    const rejected = (await res.json()) as { code: number; message: string; details: { code: string } };
    assert.equal(res.status, 400);
    assert.equal(rejected.code, 1);
    assert.equal(rejected.message, "Copilot operation rejected");
    assert.equal(rejected.details.code, "Model profile is not available for the Copilot preference");

    // Invalid effort: schema rejection.
    res = await fetch(base, { method: "PUT", headers, body: JSON.stringify({ thinkingEffort: "ultra" }) });
    const invalid = (await res.json()) as { code: number; message: string; details: { code: string } };
    assert.equal(res.status, 400);
    assert.equal(invalid.code, 1);
    assert.equal(invalid.message, "Invalid input");
    assert.equal(invalid.details.code, "COPILOT_INVALID_INPUT");
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
