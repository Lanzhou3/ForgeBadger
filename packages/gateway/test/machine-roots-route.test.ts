import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createGatewayApp } from "../src/server.js";
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { signJwt } from "../src/auth/jwt.js";

function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const masterKey = 'a'.repeat(32), jwtSecret = 'b'.repeat(32);
  const user = new UserRepository(db).create('machine-root@test.dev', 'hash');
  const auth = { Authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, jwtSecret)}` };
  const app = createGatewayApp({ db, masterKey, jwtSecret,
    sessionServerIpcPath: '/tmp/forgebadger-machine-roots.sock',
    sessionManager: new InMemorySessionManager({ async listSessions() { return []; }, async createSession() {}, async killSession() {}, async capturePane() { return ''; } } as never),
    apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
    llmFetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] })) });
  return { db, masterKey, jwtSecret, user, auth, app, dir: mkdtempSync(path.join(tmpdir(), 'fb-machine-roots-')) };
}

it('registers, lists and revokes machine roots over HTTP, with 409/404/401 semantics', async () => {
  const f = fixture();
  await new Promise<void>(resolve => f.app.server.listen(0, '127.0.0.1', resolve));
  const address = f.app.server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/v1/copilot/machine-roots`;
  try {
    // Unauthenticated is refused.
    assert.equal((await fetch(base)).status, 401);
    // Start empty.
    let list = await (await fetch(base, { headers: f.auth })).json() as { code: number; data: { roots: Array<{ id: string; label: string; path: string }> } };
    assert.equal(list.data.roots.length, 0);
    // Register a local root.
    const created = await fetch(base, { method: 'POST', headers: { ...f.auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'docs', path: f.dir }) });
    assert.equal(created.status, 201);
    const { data } = await created.json() as { data: { root: { id: string; label: string; path: string } } };
    assert.equal(data.root.label, 'docs');
    // Duplicate canonical path -> 409.
    const dup = await fetch(base, { method: 'POST', headers: { ...f.auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'again', path: f.dir }) });
    assert.equal(dup.status, 409);
    // Non-directory path -> 400.
    const bad = await fetch(base, { method: 'POST', headers: { ...f.auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'x', path: f.dir + '/nope-file' }) });
    assert.equal(bad.status, 400);
    // Listed.
    list = await (await fetch(base, { headers: f.auth })).json() as { data: { roots: Array<{ id: string }> } };
    assert.deepEqual(list.data.roots.map(r => r.id), [data.root.id]);
    // Revoke -> gone; a second revoke 404s.
    assert.equal((await fetch(`${base}/${data.root.id}`, { method: 'DELETE', headers: f.auth })).status, 200);
    list = await (await fetch(base, { headers: f.auth })).json() as { data: { roots: unknown[] } };
    assert.equal(list.data.roots.length, 0);
    assert.equal((await fetch(`${base}/${data.root.id}`, { method: 'DELETE', headers: f.auth })).status, 404);
  } finally { await f.app.close(); f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
