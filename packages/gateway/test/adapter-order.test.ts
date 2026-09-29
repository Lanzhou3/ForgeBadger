import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { AdapterOrderRepository } from "../src/db/repositories/adapter-order-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createAdapterRoutes } from "../src/routes/adapters.js";
import { signJwt } from "../src/auth/jwt.js";

const jwtSecret = "fixture-secret-".repeat(3);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  return db;
}

describe("adapter order repository", () => {
  it("defaults to an empty order", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("order-default@example.com", "hash");
      assert.deepEqual(new AdapterOrderRepository(db, user.id).get(), []);
    } finally {
      db.close();
    }
  });

  it("persists the order and normalizes unknown ids and duplicates", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("order-roundtrip@example.com", "hash");
      const repo = new AdapterOrderRepository(db, user.id);
      const saved = repo.set(["kimi", "claude", "not-a-cli", "kimi", "codex"]);
      assert.deepEqual(saved, ["kimi", "claude", "codex"]);
      assert.deepEqual(repo.get(), ["kimi", "claude", "codex"]);
    } finally {
      db.close();
    }
  });

  it("treats corrupted stored JSON as no preference", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("order-corrupt@example.com", "hash");
      const repo = new AdapterOrderRepository(db, user.id);
      repo.set(["pi"]);
      db.prepare("UPDATE user_settings SET adapter_order = 'not json' WHERE user_id = ?").run(user.id);
      assert.deepEqual(repo.get(), []);
      db.prepare("UPDATE user_settings SET adapter_order = '{\"a\":1}' WHERE user_id = ?").run(user.id);
      assert.deepEqual(repo.get(), []);
    } finally {
      db.close();
    }
  });

  it("does not clobber unrelated user_settings columns", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("order-clobber@example.com", "hash");
      db.prepare("INSERT INTO user_settings (user_id, theme, language, created_at, updated_at) VALUES (?, 'dark', 'en', 1, 1)").run(user.id);
      new AdapterOrderRepository(db, user.id).set(["mcode"]);
      const row = db.prepare("SELECT theme, language FROM user_settings WHERE user_id = ?").get(user.id) as { theme: string; language: string };
      assert.deepEqual(row, { theme: "dark", language: "en" });
    } finally {
      db.close();
    }
  });

  it("keeps the preference isolated per user", () => {
    const db = createTestDb();
    try {
      const userA = new UserRepository(db).create("order-user-a@example.com", "hash");
      const userB = new UserRepository(db).create("order-user-b@example.com", "hash");
      new AdapterOrderRepository(db, userA.id).set(["opencode"]);
      assert.deepEqual(new AdapterOrderRepository(db, userB.id).get(), []);
      assert.deepEqual(new AdapterOrderRepository(db, userA.id).get(), ["opencode"]);
    } finally {
      db.close();
    }
  });
});

describe("adapter order routes", () => {
  it("round-trips and validates the per-user CLI order", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("order-routes@example.com", "hash");
    const app = express();
    app.use(express.json());
    app.locals.db = db;
    app.locals.jwtSecret = jwtSecret;
    app.use("/api/v1/adapters", createAdapterRoutes());
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test server port");
    const base = `http://127.0.0.1:${address.port}/api/v1/adapters/order`;
    const headers = {
      Authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, jwtSecret)}`,
      "Content-Type": "application/json",
    };

    try {
      let res = await fetch(base, { headers });
      let body = (await res.json()) as { code: number; data: { order: string[] }; message: string };
      assert.equal(res.status, 200);
      assert.equal(body.code, 0);
      assert.deepEqual(body.data.order, []);

      res = await fetch(base, { method: "PUT", headers, body: JSON.stringify({ order: ["kimi", "claude", "bogus", "kimi"] }) });
      body = (await res.json()) as typeof body;
      assert.equal(res.status, 200);
      assert.deepEqual(body.data.order, ["kimi", "claude"]);

      res = await fetch(base, { headers });
      body = (await res.json()) as typeof body;
      assert.equal(res.status, 200);
      assert.deepEqual(body.data.order, ["kimi", "claude"]);

      res = await fetch(base, { method: "PUT", headers, body: JSON.stringify({ order: "claude" }) });
      assert.equal(res.status, 400);

      res = await fetch(base, { method: "PUT", headers, body: JSON.stringify({}) });
      assert.equal(res.status, 400);
    } finally {
      server.close();
      await once(server, "close");
      db.close();
    }
  });
});
