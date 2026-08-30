import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import jwt from "jsonwebtoken";

import { signJwt, verifyJwt, decodeJwt } from "../src/auth/jwt.js";
import { authenticate } from "../src/auth/middleware.js";
import { createAuthRouter } from "../src/routes/auth.js";
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

function fakeResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };
}

describe("signJwt", () => {
  it("creates a valid token", () => {
    const token = signJwt({ userId: "u1", email: "a@b.com" }, secret);
    assert.ok(typeof token === "string");
    assert.ok(token.split(".").length === 3);
  });
});

describe("verifyJwt", () => {
  it("validates a signed token", () => {
    const token = signJwt({ userId: "u1", email: "a@b.com" }, secret);
    const payload = verifyJwt(token, secret);
    assert.deepEqual(payload, { userId: "u1", email: "a@b.com" });
  });

  it("rejects tampered tokens", () => {
    const token = signJwt({ userId: "u1", email: "a@b.com" }, secret);
    const tampered = token.slice(0, -1) + "x";
    assert.throws(() => verifyJwt(tampered, secret), /invalid|signature/i);
  });

  it("rejects expired tokens", () => {
    const expiredToken = jwt.sign(
      { userId: "u1", email: "a@b.com", exp: Math.floor(Date.now() / 1000) - 10 },
      secret,
      { algorithm: "HS256" }
    );
    assert.throws(() => verifyJwt(expiredToken, secret), /expired/i);
  });

  it("rejects alg:none tokens", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ userId: "u1", email: "a@b.com" })).toString("base64url");
    const noneToken = `${header}.${payload}.`;
    assert.throws(() => verifyJwt(noneToken, secret), /signature|algorithm|alg/i);
  });
});

describe("decodeJwt", () => {
  it("decodes without verifying", () => {
    const token = signJwt({ userId: "u1", email: "a@b.com" }, secret);
    assert.deepEqual(decodeJwt(token), { userId: "u1", email: "a@b.com" });
    assert.equal(decodeJwt("invalid"), null);
  });
});

describe("authenticate middleware", () => {
  it("injects userId on valid token", () => {
    const token = signJwt({ userId: "u1", email: "a@b.com" }, secret);
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const res = fakeResponse();
    let nextCalled = false;
    authenticate(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.userId, "u1");
  });

  it("rejects missing token", () => {
    const req = { headers: {} } as any;
    const res = fakeResponse();
    authenticate(req, res, () => {
      throw new Error("next should not be called");
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { code: 1, message: "Unauthorized" });
  });

  it("rejects invalid token", () => {
    const req = { headers: { authorization: "Bearer badtoken" } } as any;
    const res = fakeResponse();
    authenticate(req, res, () => {
      throw new Error("next should not be called");
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { code: 1, message: "Unauthorized" });
  });
});

describe("auth routes", () => {
  let db: Database;
  let userRepo: UserRepository;
  let app: express.Express;

  beforeEach(() => {
    db = createTestDb();
    userRepo = new UserRepository(db);
    app = express();
    app.locals.db = db;
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/auth", createAuthRouter(userRepo, secret, { db }));
  });

  describe("POST /register", () => {
    it("registers a new user", async () => {
      const res = await makeRequest(
        app,
        "POST",
        "/api/v1/auth/register",
        { email: "new@example.com", password: "password123" }
      );
      assert.equal(res.status, 201);
      assert.equal(res.body.code, 0);
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.user.email, "new@example.com");
    });

    it("bootstraps the first registered user as admin and later users as regular users", async () => {
      const first = await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "first@example.com",
        password: "password123"
      });
      const second = await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "second@example.com",
        password: "password123"
      });

      assert.equal(first.status, 201);
      assert.equal(first.body.data.user.role, "admin");
      assert.equal(first.body.data.user.status, "active");
      assert.equal(second.status, 201);
      assert.equal(second.body.data.user.role, "user");
      assert.equal(second.body.data.user.status, "active");
    });

    it("rejects duplicate email", async () => {
      await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "dup@example.com",
        password: "password123"
      });
      const res = await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "dup@example.com",
        password: "password123"
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 1);
      assert.match(res.body.message, /already registered/i);
    });

    it("rejects weak password", async () => {
      const res = await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "weak@example.com",
        password: "short"
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 1);
    });
  });

  describe("POST /login", () => {
    it("logs in with correct credentials", async () => {
      await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "login@example.com",
        password: "password123"
      });
      const res = await makeRequest(app, "POST", "/api/v1/auth/login", {
        email: "login@example.com",
        password: "password123"
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.code, 0);
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.user.email, "login@example.com");
      assert.equal(res.body.data.user.role, "admin");
      assert.equal(res.body.data.user.status, "active");
    });

    it("rejects wrong password", async () => {
      await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "wrong@example.com",
        password: "password123"
      });
      const res = await makeRequest(app, "POST", "/api/v1/auth/login", {
        email: "wrong@example.com",
        password: "badpass"
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 1);
      assert.equal(res.body.message, "Invalid credentials");
    });

    it("rejects nonexistent email", async () => {
      const res = await makeRequest(app, "POST", "/api/v1/auth/login", {
        email: "nope@example.com",
        password: "password123"
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 1);
      assert.equal(res.body.message, "Invalid credentials");
    });

    it("uses the same error for nonexistent accounts and wrong passwords", async () => {
      await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "enumeration@example.com",
        password: "password123"
      });

      const missing = await makeRequest(app, "POST", "/api/v1/auth/login", {
        email: "missing@example.com",
        password: "password123"
      });
      const wrongPassword = await makeRequest(app, "POST", "/api/v1/auth/login", {
        email: "enumeration@example.com",
        password: "badpass"
      });

      assert.equal(missing.status, 401);
      assert.equal(wrongPassword.status, 401);
      assert.deepEqual(missing.body, wrongPassword.body);
    });

    it("rejects disabled users", async () => {
      await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "disabled@example.com",
        password: "password123"
      });
      const user = userRepo.findByEmail("disabled@example.com");
      assert.ok(user);
      userRepo.update(user.id, { status: "disabled" });

      const res = await makeRequest(app, "POST", "/api/v1/auth/login", {
        email: "disabled@example.com",
        password: "password123"
      });

      assert.equal(res.status, 403);
      assert.equal(res.body.code, 1);
      assert.match(res.body.message, /disabled/i);
    });
  });

  describe("legacy cookie cleanup", () => {
    it("clears both ForgeBadger and legacy OpenForge cookies on logout", async () => {
      const registered = await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "logout-cookies@example.com",
        password: "password123"
      });
      const token = registered.body.data.token as string;

      const response = await makeRequest(
        app,
        "POST",
        "/api/v1/auth/logout",
        undefined,
        { cookie: `forgebadger_session=${token}; openforge_session=${token}` }
      );

      assert.equal(response.status, 200);
      assert.equal(response.setCookie.some((value) => value.startsWith("forgebadger_session=")), true);
      assert.equal(response.setCookie.some((value) => value.startsWith("openforge_session=")), true);
    });

    it("clears both ForgeBadger and legacy OpenForge cookies after changing password", async () => {
      const registered = await makeRequest(app, "POST", "/api/v1/auth/register", {
        email: "password-cookies@example.com",
        password: "password123"
      });
      const token = registered.body.data.token as string;

      const response = await makeRequest(
        app,
        "POST",
        "/api/v1/auth/change-password",
        { currentPassword: "password123", newPassword: "new-password-123" },
        { cookie: `forgebadger_session=${token}; openforge_session=${token}` }
      );

      assert.equal(response.status, 200);
      assert.equal(response.setCookie.some((value) => value.startsWith("forgebadger_session=")), true);
      assert.equal(response.setCookie.some((value) => value.startsWith("openforge_session=")), true);
    });
  });
});

async function makeRequest(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
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
              body: data ? JSON.parse(data) : undefined,
              setCookie: res.headers["set-cookie"] ?? []
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
