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
import { createAdminUserRoutes } from "../src/routes/admin-users.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

const secret = "0123456789abcdef0123456789abcdef";

process.env.FORGEBADGER_JWT_SECRET = secret;
process.env.FORGEBADGER_MASTER_KEY = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("admin user routes", () => {
  let db: Database;
  let userRepo: UserRepository;
  let app: express.Express;

  beforeEach(() => {
    db = createTestDb();
    userRepo = new UserRepository(db);
    app = express();
    app.use(express.json());
    app.use("/api/v1/admin/users", createAdminUserRoutes(db));
  });

  it("requires admin role to list users", async () => {
    const regular = userRepo.create("regular@example.com", "hash", { role: "user" });
    const token = signJwt({ userId: regular.id, email: regular.email }, secret);

    const res = await makeRequest(app, "GET", "/api/v1/admin/users", undefined, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.code, 1);
  });

  it("allows an admin to list users and update another user's role and status", async () => {
    const admin = userRepo.create("admin@example.com", "hash", { role: "admin" });
    const regular = userRepo.create("member@example.com", "hash", { role: "user" });
    const token = signJwt({ userId: admin.id, email: admin.email }, secret);

    const listRes = await makeRequest(app, "GET", "/api/v1/admin/users", undefined, {
      Authorization: `Bearer ${token}`
    });
    const updateRes = await makeRequest(
      app,
      "PATCH",
      `/api/v1/admin/users/${regular.id}`,
      { role: "admin", status: "disabled" },
      { Authorization: `Bearer ${token}` }
    );

    assert.equal(listRes.status, 200);
    assert.deepEqual(
      listRes.body.data.users.map((user: { email: string }) => user.email).sort(),
      ["admin@example.com", "member@example.com"]
    );
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.user.role, "admin");
    assert.equal(updateRes.body.data.user.status, "disabled");
  });

  it("prevents an admin from demoting or disabling themselves", async () => {
    const admin = userRepo.create("self-admin@example.com", "hash", { role: "admin" });
    const token = signJwt({ userId: admin.id, email: admin.email }, secret);

    const demoteRes = await makeRequest(
      app,
      "PATCH",
      `/api/v1/admin/users/${admin.id}`,
      { role: "user" },
      { Authorization: `Bearer ${token}` }
    );
    const disableRes = await makeRequest(
      app,
      "PATCH",
      `/api/v1/admin/users/${admin.id}`,
      { status: "disabled" },
      { Authorization: `Bearer ${token}` }
    );

    assert.equal(demoteRes.status, 409);
    assert.equal(disableRes.status, 409);
    assert.equal(userRepo.findById(admin.id)?.role, "admin");
    assert.equal(userRepo.findById(admin.id)?.status, "active");
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
