import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express, { type Request } from "express";

import { signJwt } from "../src/auth/jwt.js";
import { loadEnv } from "../src/config/env.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { isDirectLoopbackRequest } from "../src/lib/request-origin.js";
import { createAuthRouter } from "../src/routes/auth.js";
import { createDeliveryActionsRoutes } from "../src/routes/collaboration-delivery-actions.js";
import { DeliveryService } from "../src/services/collaboration/delivery-service.js";

const baseEnv = { FORGEBADGER_MASTER_KEY: "a".repeat(64), FORGEBADGER_JWT_SECRET: "s".repeat(32) };
const PASSWORD = "valid-fixture-password";

async function fixture(trustProxy: boolean) {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
  const users = new UserRepository(db);
  const user = users.create("member@proxy.test", await bcrypt.hash(PASSWORD, 4));
  const secret = randomBytes(32).toString("hex");
  const app = express();
  // Mirrors createServer(): forwarding headers are trusted from loopback peers only.
  if (trustProxy) app.set("trust proxy", "loopback");
  app.locals.db = db;
  app.locals.jwtSecret = secret;
  app.use(express.json());
  app.get("/probe", (req: Request, res) => { res.json({ secure: req.secure, ip: req.ip, direct: isDirectLoopbackRequest(req) }); });
  app.use("/auth", createAuthRouter(users, secret, { db, registrationMode: "off", accountRecovery: { isValid: () => false } as never }));
  app.use("/collaboration", createDeliveryActionsRoutes(new DeliveryService({ db, workspacesRoot: "/unused-test-workspaces" })));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const forwarded = { "X-Forwarded-For": "192.168.1.50", "X-Forwarded-Proto": "https" };
  const login = (headers: Record<string, string>) => fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ email: user.email, password: PASSWORD })
  });
  return {
    base, forwarded, login,
    token: signJwt({ userId: user.id, email: user.email }, secret),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      db.close();
    }
  };
}

test("FORGEBADGER_TRUST_PROXY is a strict opt-in boolean", () => {
  assert.equal(loadEnv(baseEnv).FORGEBADGER_TRUST_PROXY, false);
  assert.equal(loadEnv({ ...baseEnv, FORGEBADGER_TRUST_PROXY: "true" }).FORGEBADGER_TRUST_PROXY, true);
  assert.throws(() => loadEnv({ ...baseEnv, FORGEBADGER_TRUST_PROXY: "1" }));
});

test("without proxy trust, forwarding headers cannot claim TLS or another client address", async () => {
  const f = await fixture(false);
  try {
    const probe = await (await fetch(`${f.base}/probe`, { headers: f.forwarded })).json() as { secure: boolean; ip: string; direct: boolean };
    assert.equal(probe.secure, false);
    assert.notEqual(probe.ip, "192.168.1.50");
    assert.equal(probe.direct, false, "a forwarded request is never a direct loopback request");

    const response = await f.login(f.forwarded);
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /;\s*Secure/i);
  } finally { await f.close(); }
});

test("with proxy trust, a request forwarded over HTTPS gets a Secure session cookie and the real client address", async () => {
  const f = await fixture(true);
  try {
    const probe = await (await fetch(`${f.base}/probe`, { headers: f.forwarded })).json() as { secure: boolean; ip: string; direct: boolean };
    assert.deepEqual(probe, { secure: true, ip: "192.168.1.50", direct: false });

    const proxied = await f.login(f.forwarded);
    assert.match(proxied.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(proxied.headers.get("set-cookie") ?? "", /;\s*Secure/i);
    assert.match(proxied.headers.get("set-cookie") ?? "", /SameSite=Strict/i);

    // Local plain-HTTP use keeps working: no Secure flag, still a direct loopback request.
    const local = await f.login({});
    assert.equal(local.status, 200);
    assert.doesNotMatch(local.headers.get("set-cookie") ?? "", /;\s*Secure/i);
    assert.equal((await (await fetch(`${f.base}/probe`)).json() as { direct: boolean }).direct, true);
  } finally { await f.close(); }
});

test("credential-bearing delivery calls through a proxy require TLS; the socket being loopback is not enough", async () => {
  const f = await fixture(true);
  try {
    const url = `${f.base}/collaboration/projects/${"1".repeat(8)}-1111-4111-8111-${"1".repeat(12)}/runs/${"2".repeat(8)}-2222-4222-8222-${"2".repeat(12)}/pull-request`;
    const call = async (headers: Record<string, string>) => {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${f.token}`, ...headers }, body: "{}" });
      return (await response.json() as { message: string }).message;
    };
    assert.equal(await call({ "X-Forwarded-For": "192.168.1.50", "X-Forwarded-Proto": "http" }), "SECURE_GITHUB_CREDENTIAL_TRANSPORT_REQUIRED");
    // Past the transport check the empty body is rejected as ordinary input.
    assert.equal(await call(f.forwarded), "INVALID_INPUT");
    assert.equal(await call({}), "INVALID_INPUT");
  } finally { await f.close(); }
});
