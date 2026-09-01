import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { RuntimeAuthorizationInvalidator } from "../src/services/runtime-authorization-invalidation.js";
import {
  TerminalRuntimeAuthorizationRegistry,
  validateTerminalRuntimeAuthorization
} from "../src/websocket/terminal-runtime-authorization.js";

function createRuntimeFixture(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  const now = Date.now();
  db.prepare("INSERT INTO users (id, username, email, password_hash, role, status) VALUES ('u1','u1','u1@example.test','x','user','active')").run();
  db.prepare("INSERT INTO projects (id,user_id,name,path,ai_tool,status,created_at,updated_at) VALUES ('p1','u1','P1','/tmp/p1','codex','active',?,?)").run(now, now);
  db.prepare("INSERT INTO sessions (id,user_id,project_id,name,ai_tool,status,attach_token,working_dir,credential_mode) VALUES ('s1','u1','p1','S1','codex','running','token','/tmp/p1','host_environment')").run();
  return db;
}

describe("TerminalRuntimeAuthorizationRegistry", () => {
  it("keeps the hot path in memory and revalidates only a matching session", () => {
    const invalidator = new RuntimeAuthorizationInvalidator();
    const registry = new TerminalRuntimeAuthorizationRegistry(invalidator);
    let validationCount = 0;
    let valid = true;
    let invalidatedCount = 0;
    const lease = registry.open({
      userId: "u1",
      sessionId: "s1",
      projectId: "p1",
      revalidate() {
        validationCount += 1;
        return valid;
      },
      onInvalidated() {
        invalidatedCount += 1;
      }
    });

    assert.equal(lease.isAuthorized(), true);
    for (let index = 0; index < 1_000; index += 1) {
      assert.equal(lease.isAuthorized(), true);
    }
    assert.equal(validationCount, 1);

    invalidator.invalidate({ scope: "session", userId: "u1", sessionId: "other" });
    assert.equal(validationCount, 1);

    invalidator.invalidate({ scope: "session", userId: "u1", sessionId: "s1" });
    assert.equal(validationCount, 2);
    assert.equal(lease.isAuthorized(), true);

    valid = false;
    invalidator.invalidate({ scope: "session", userId: "u1", sessionId: "s1" });
    assert.equal(validationCount, 3);
    assert.equal(lease.isAuthorized(), false);
    assert.equal(invalidatedCount, 1);

    invalidator.invalidate({ scope: "session", userId: "u1", sessionId: "s1" });
    assert.equal(validationCount, 3);
    assert.equal(invalidatedCount, 1);
  });

  it("rejects a disabled user even for an unbound session", () => {
    const db = createRuntimeFixture();

    assert.equal(validateTerminalRuntimeAuthorization(db, "u1", "s1"), true);
    new UserRepository(db).update("u1", { status: "disabled" });
    assert.equal(validateTerminalRuntimeAuthorization(db, "u1", "s1"), false);
  });

  it("invalidates a live lease once after the authoritative user is disabled", () => {
    const db = createRuntimeFixture();
    const invalidator = new RuntimeAuthorizationInvalidator();
    const registry = new TerminalRuntimeAuthorizationRegistry(invalidator);
    let invalidatedCount = 0;
    const lease = registry.open({
      userId: "u1",
      sessionId: "s1",
      projectId: "p1",
      revalidate: () => validateTerminalRuntimeAuthorization(db, "u1", "s1"),
      onInvalidated: () => {
        invalidatedCount += 1;
      }
    });

    new UserRepository(db).update("u1", { status: "disabled" });
    invalidator.invalidate({ scope: "user", userId: "u1" });
    invalidator.invalidate({ scope: "user", userId: "u1" });

    assert.equal(lease.isAuthorized(), false);
    assert.equal(invalidatedCount, 1);
  });

  it("targets user, session, and project invalidations without leaking across tenants", () => {
    const invalidator = new RuntimeAuthorizationInvalidator();
    const registry = new TerminalRuntimeAuthorizationRegistry(invalidator);
    const checks = new Map<string, number>();
    const open = (userId: string, sessionId: string, projectId: string) => registry.open({
      userId,
      sessionId,
      projectId,
      revalidate() {
        checks.set(sessionId, (checks.get(sessionId) ?? 0) + 1);
        return true;
      },
      onInvalidated() {}
    });
    const first = open("u1", "s1", "p1");
    open("u1", "s2", "p2");
    open("u2", "s3", "p1");

    invalidator.invalidate({ scope: "session", userId: "u1", sessionId: "s1" });
    assert.deepEqual(Object.fromEntries(checks), { s1: 2, s2: 1, s3: 1 });

    invalidator.invalidate({ scope: "project", userId: "u1", projectId: "p1" });
    assert.deepEqual(Object.fromEntries(checks), { s1: 3, s2: 1, s3: 1 });

    invalidator.invalidate({ scope: "user", userId: "u1" });
    assert.deepEqual(Object.fromEntries(checks), { s1: 4, s2: 2, s3: 1 });

    first.dispose();
    invalidator.invalidate({ scope: "user", userId: "u1" });
    assert.deepEqual(Object.fromEntries(checks), { s1: 4, s2: 3, s3: 1 });
  });
});
