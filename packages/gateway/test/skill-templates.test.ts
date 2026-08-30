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
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createSkillRoutes } from "../src/routes/skills.js";

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

describe("skill templates", () => {
  let app: express.Express;
  let token: string;

  beforeEach(() => {
    const db = createTestDb();
    const user = new UserRepository(db).create("skill-template@example.com", "hash");
    token = signJwt({ userId: user.id, email: user.email }, secret);
    app = express();
    app.use(express.json());
    app.use("/api/v1", createSkillRoutes(db));
  });

  it("lists built-in quick-create templates", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/skills/templates", undefined, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.templates.map((template: { id: string }) => template.id),
      ["plan", "review", "verify", "debug", "release"]
    );
    assert.ok(res.body.data.templates.every((template: { content: string }) => template.content.includes("name:")));
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
