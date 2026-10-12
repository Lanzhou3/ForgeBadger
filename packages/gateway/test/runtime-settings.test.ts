import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

import { signJwt } from "../src/auth/jwt.js";
import { loadEnv, type GatewayEnv } from "../src/config/env.js";
import { createRuntimeSettingsRoutes } from "../src/routes/runtime-settings.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { AuditLogRepository } from "../src/db/repositories/audit-log-repository.js";
import {
  createRuntimeSettingsStore,
  RuntimeSettingsError,
  type RuntimeSettingsEffective
} from "../src/services/runtime-settings.js";

const secret = "0123456789abcdef0123456789abcdef";

function baseEnv(extra: Record<string, string> = {}): GatewayEnv {
  return loadEnv({
    FORGEBADGER_JWT_SECRET: secret,
    FORGEBADGER_MASTER_KEY: "abcdef0123456789abcdef0123456789",
    ...extra
  });
}

function createTestDb(): Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

describe("runtime settings store", () => {
  let db: Database;
  let env: GatewayEnv;

  beforeEach(() => {
    db = createTestDb();
    env = baseEnv();
  });

  it("falls back to env defaults and reports per-key provenance", () => {
    const store = createRuntimeSettingsStore(db, { env });
    const views = store.views();
    const byKey = new Map(views.map((view) => [view.key, view]));
    assert.equal(byKey.get("registration")?.value, "open");
    assert.equal(byKey.get("mcp_enabled")?.hot, false);
    assert.equal(byKey.get("pm_auto_dispatch")?.value, false);
    assert.equal(byKey.get("pm_auto_dispatch")?.source, "env");
  });

  it("persists DB overrides on top of env and hot-applies the dispatch behavior flag", () => {
    const applied: RuntimeSettingsEffective[] = [];
    const store = createRuntimeSettingsStore(db, {
      env,
      // Mirrors the production wiring in createGatewayApp.
      apply: (effective) => {
        applied.push(effective);
      }
    });

    // Initial wiring apply reconciles env state.
    assert.equal(applied.length, 1);
    assert.equal(applied[0]?.pmAutoDispatch, false);

    const views = store.update("tester", { pm_auto_dispatch: true });
    const flag = views.find((view) => view.key === "pm_auto_dispatch");
    assert.equal(flag?.value, true);
    assert.equal(flag?.source, "settings");

    // Hot apply: the applier observes the refreshed value.
    assert.equal(applied.at(-1)?.pmAutoDispatch, true);

    // A second process reading the same DB sees the override.
    const reopened = createRuntimeSettingsStore(db, { env });
    assert.equal(reopened.effective().pmAutoDispatch, true);
  });

  it("rejects invalid input, unknown keys, and empty patches", () => {
    const store = createRuntimeSettingsStore(db, { env });
    assert.throws(() => store.update("tester", { pm_auto_dispatch: "maybe" }), RuntimeSettingsError);
    assert.throws(() => store.update("tester", { registration: "wide-open" }), RuntimeSettingsError);
    assert.throws(() => store.update("tester", { session_prefix: "bad prefix!" }), RuntimeSettingsError);
    assert.throws(() => store.update("tester", { bogus: true }), RuntimeSettingsError);
    assert.throws(() => store.update("tester", {}), RuntimeSettingsError);
  });

  it("records an audit entry per update", () => {
    const admin = new UserRepository(db).create("admin@test.dev", "hash", { role: "admin" });
    const store = createRuntimeSettingsStore(db, { env });
    store.update(admin.id, { pm_auto_dispatch: true }, "127.0.0.1");
    const entries = new AuditLogRepository(db, admin.id).list({ action: "runtime_settings.update" });
    assert.equal(entries.length, 1);
    assert.match(entries[0]!.resourceId ?? "", /pm_auto_dispatch/);
  });

  it("honours FORGEBADGER_RUNTIME_SETTINGS_READONLY", () => {
    const readonlyEnv = baseEnv({ FORGEBADGER_RUNTIME_SETTINGS_READONLY: "true" });
    const store = createRuntimeSettingsStore(db, { env: readonlyEnv });
    assert.equal(store.effective().readonly, true);
    assert.throws(() => store.update("tester", { registration: "off" }), /read-only/);
  });
});

describe("runtime settings routes", () => {
  const secretJwt = "0123456789abcdef0123456789abcdef";
  let db: Database;
  let app: express.Express;
  let admin: ReturnType<UserRepository["create"]>;
  let regular: ReturnType<UserRepository["create"]>;

  beforeEach(() => {
    db = createTestDb();
    const userRepo = new UserRepository(db);
    admin = userRepo.create("admin@test.dev", "hash", { role: "admin" });
    regular = userRepo.create("user@test.dev", "hash", { role: "user" });
    const env = baseEnv();
    const store = createRuntimeSettingsStore(db, { env });
    app = express();
    app.locals.jwtSecret = secretJwt;
    app.locals.db = db;
    app.use(express.json());
    app.use("/api/v1/runtime-settings", createRuntimeSettingsRoutes(db, store));
  });

  it("requires the admin role", async () => {
    const token = signJwt({ userId: regular.id, email: regular.email }, secretJwt);
    const res = await makeRequest(app, "GET", "/api/v1/runtime-settings", undefined, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 403);
  });

  it("lets an admin read and update settings", async () => {
    const token = signJwt({ userId: admin.id, email: admin.email }, secretJwt);
    const read = await makeRequest(app, "GET", "/api/v1/runtime-settings", undefined, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(read.status, 200);
    assert.equal(read.body.code, 0);
    assert.equal(read.body.data.readonly, false);
    assert.ok(Array.isArray(read.body.data.settings));

    const put = await makeRequest(
      app,
      "PUT",
      "/api/v1/runtime-settings",
      { registration: "invite", session_prefix: "fb-local" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(put.status, 200);
    const byKey = new Map(put.body.data.settings.map((view: any) => [view.key, view]));
    assert.equal(byKey.get("registration")?.value, "invite");
    assert.equal(byKey.get("registration")?.source, "settings");
    assert.equal(byKey.get("session_prefix")?.value, "fb-local");
    assert.equal(byKey.get("mcp_enabled")?.value, false);
  });

  it("surfaces validation errors as 400", async () => {
    const token = signJwt({ userId: admin.id, email: admin.email }, secretJwt);
    const res = await makeRequest(app, "PUT", "/api/v1/runtime-settings", {
      registration: "anything"
    }, { Authorization: `Bearer ${token}` });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
  });

  it("returns 503 when the store is not wired", async () => {
    const bare = express();
    bare.locals.jwtSecret = secretJwt;
    bare.locals.db = db;
    bare.use(express.json());
    bare.use("/api/v1/runtime-settings", createRuntimeSettingsRoutes(db));
    const token = signJwt({ userId: admin.id, email: admin.email }, secretJwt);
    const res = await makeRequest(bare, "GET", "/api/v1/runtime-settings", undefined, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 503);
  });
});

function makeRequest(
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
              status: res.statusCode,
              body: data ? JSON.parse(data) : undefined
            });
          });
        }
      );
      req.on("error", (error) => {
        server.close();
        reject(error);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}
