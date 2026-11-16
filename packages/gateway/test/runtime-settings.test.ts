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
import { adapterIds } from "../src/lib/adapter-ids.js";
import { PROGRAMMATIC_SUBMIT_ADAPTERS } from "../src/services/programmatic-terminal-submit.js";
import { goalCheckSandboxCapability } from "../src/services/agent/command-sandbox.js";

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

  it("keeps goal check isolation off by default and settable only through the store", () => {
    // The retired environment variable is not part of the schema and is ignored.
    const store = createRuntimeSettingsStore(db, { env: baseEnv({ FORGEBADGER_GOAL_CHECK_SANDBOX: "on" }) });
    assert.equal(store.effective().goalCheckSandbox, false);
    const view = store.views().find((entry) => entry.key === "goal_check_sandbox");
    assert.deepEqual({ value: view?.value, hot: view?.hot }, { value: false, hot: true });
    store.update("tester", { goal_check_sandbox: true });
    assert.equal(createRuntimeSettingsStore(db, { env }).effective().goalCheckSandbox, true);
    assert.throws(() => store.update("tester", { goal_check_sandbox: "on" }), RuntimeSettingsError);
  });

  describe("copilot_team", () => {
    const member = (over: Record<string, unknown> = {}) => ({
      id: "claude-dev", name: "Ada", title: "Implementer", description: "Writes code", adapter: "claude",
      roles: ["writer"], enabled: true, ...over
    });
    const team = (members: unknown[] = [member()], maxParallelWriters = 3) => ({ maxParallelWriters, members });

    it("defaults to an empty roster sourced from env", () => {
      const store = createRuntimeSettingsStore(db, { env });
      assert.deepEqual(store.effective().copilotTeam, { maxParallelWriters: 3, members: [] });
      const view = store.views().find((entry) => entry.key === "copilot_team");
      assert.deepEqual({ value: view?.value, source: view?.source, hot: view?.hot },
        { value: { maxParallelWriters: 3, members: [] }, source: "env", hot: true });
    });

    it("persists a full replacement and reports settings provenance", () => {
      const applied: RuntimeSettingsEffective[] = [];
      const store = createRuntimeSettingsStore(db, { env, apply: (effective) => { applied.push(effective); } });
      const views = store.update("tester", { copilot_team: team([member(), member({ id: "rev", roles: ["reviewer", "writer"], adapter: "codex", name: "  Rex  " })], 2) });
      const view = views.find((entry) => entry.key === "copilot_team");
      assert.equal(view?.source, "settings");
      assert.equal(applied.at(-1)?.copilotTeam.maxParallelWriters, 2);
      assert.equal(applied.at(-1)?.copilotTeam.members[1]?.name, "Rex");
      assert.equal(createRuntimeSettingsStore(db, { env }).effective().copilotTeam.members.length, 2);
      store.update("tester", { copilot_team: team([]) });
      assert.deepEqual(store.effective().copilotTeam.members, []);
    });

    it("rejects invalid rosters", () => {
      const store = createRuntimeSettingsStore(db, { env });
      const bad: unknown[] = [
        team([member({ id: "Bad_Id" })]),
        team([member({ id: "-x" })]),
        team([member(), member()]),
        team([member({ roles: [] })]),
        team([member({ roles: ["writer", "writer"] })]),
        team([member({ roles: ["boss"] })]),
        team([member({ adapter: "emacs" })]),
        team([member({ name: "  " })]),
        team([member({ description: "x".repeat(501) })]),
        team(Array.from({ length: 13 }, (_, i) => member({ id: `m${i}` }))),
        team([member()], 0),
        team([member()], 7),
        team([member()], 1.5),
        { ...team(), extra: 1 },
        team([{ ...member(), extra: 1 }]),
        JSON.stringify(team())
      ];
      for (const value of bad) assert.throws(() => store.update("tester", { copilot_team: value }), RuntimeSettingsError);
      assert.deepEqual(store.effective().copilotTeam, { maxParallelWriters: 3, members: [] });
    });

    it("falls back to the default when the stored override is corrupt", () => {
      db.prepare("INSERT INTO runtime_settings(key,value,updated_at,updated_by) VALUES('copilot_team',?,?,?)")
        .run(JSON.stringify({ maxParallelWriters: 99, members: [] }), Date.now(), "tester");
      assert.deepEqual(createRuntimeSettingsStore(db, { env }).effective().copilotTeam, { maxParallelWriters: 3, members: [] });
    });

    it("is blocked in readonly mode", () => {
      const store = createRuntimeSettingsStore(db, { env: baseEnv({ FORGEBADGER_RUNTIME_SETTINGS_READONLY: "true" }) });
      assert.throws(() => store.update("tester", { copilot_team: team() }), /read-only/);
    });
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

  it("reports host isolation support and only enables goal check isolation where it works", async () => {
    const token = signJwt({ userId: admin.id, email: admin.email }, secretJwt);
    const capability = goalCheckSandboxCapability();
    const read = await makeRequest(app, "GET", "/api/v1/runtime-settings", undefined, {
      Authorization: `Bearer ${token}`
    });
    assert.deepEqual(read.body.data.capabilities.goalCheckSandbox, capability);
    const dispatch = read.body.data.capabilities.programmaticDispatch as Record<string, boolean>;
    assert.deepEqual(Object.keys(dispatch).sort(), [...adapterIds].sort());
    for (const id of adapterIds) assert.equal(dispatch[id], (PROGRAMMATIC_SUBMIT_ADAPTERS as readonly string[]).includes(id));

    const put = await makeRequest(app, "PUT", "/api/v1/runtime-settings", { goal_check_sandbox: true }, {
      Authorization: `Bearer ${token}`
    });
    if (capability.available) {
      assert.equal(put.status, 200);
      const view = put.body.data.settings.find((entry: { key: string }) => entry.key === "goal_check_sandbox");
      assert.equal(view.value, true);
    } else {
      assert.equal(put.status, 409);
      assert.equal(put.body.details.code, "GOAL_CHECK_SANDBOX_UNAVAILABLE");
    }
    // Turning it off is always allowed.
    const off = await makeRequest(app, "PUT", "/api/v1/runtime-settings", { goal_check_sandbox: false }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(off.status, 200);
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
