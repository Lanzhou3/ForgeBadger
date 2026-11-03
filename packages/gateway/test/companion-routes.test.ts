import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';

import { createServer } from '../src/server.js';
import { signJwt } from '../src/auth/jwt.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { InMemoryApiKeyStore } from '../src/secrets/api-key-store.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { RuntimeAuthorizationInvalidator } from '../src/services/runtime-authorization-invalidation.js';
import { CompanionService } from '../src/services/companion/companion-service.js';
import { generateCompanionIdentity } from '../src/services/companion/keys.js';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

async function fixture(companionEnabled: boolean) {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder });
  const users = new UserRepository(db);
  const admin = users.create('companion-route-admin@test.dev', 'fixture', { role: 'admin' });
  const owner = users.create('companion-route-owner@test.dev', 'fixture');
  const other = users.create('companion-route-other@test.dev', 'fixture');
  const now = Date.now();
  db.prepare('INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('route-project', owner.id, 'Route project', '/private/tmp/companion-route', '', 'active', 0, now, now);
  const masterKey = randomBytes(32).toString('hex');
  const jwtSecret = randomBytes(32).toString('hex');
  const service = new CompanionService(db, masterKey, companionEnabled);
  if (companionEnabled) {
    service.configureHost(admin.id, { enabled: true, relayUrl: 'wss://relay.example.test', expectedRevision: 1 });
  }
  const app = createServer({
    db,
    masterKey,
    jwtSecret,
    companionEnabled,
    sessionManager: {} as InMemorySessionManager,
    apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
    eventBus: new ForgeBadgerEventBus(),
    runtimeAuthorizationInvalidator: new RuntimeAuthorizationInvalidator()
  });
  const server = httpServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/companion`;
  const request = (path: string, options: { method?: string; body?: unknown; userId?: string } = {}) => {
    const userId = options.userId ?? owner.id;
    return fetch(base + path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${signJwt({ userId, email: 'fixture@test.dev' }, jwtSecret)}`
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
  };
  const close = async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  };
  return { db, admin, owner, other, service, request, close };
}

it('serves owner pairing and device management without a public claim route', async () => {
  const f = await fixture(true);
  try {
    assert.equal((await fetch((await f.request('/host')).url)).status, 401);
    const host = await f.request('/host');
    assert.equal(host.status, 200);
    assert.equal(host.headers.get('cache-control'), 'no-store');
    assert.equal(JSON.stringify(await host.json()).includes('privateKey'), false);
    assert.equal((await f.request('/host', {
      method: 'PUT', body: { enabled: true, relayUrl: 'wss://relay.example.test', expectedRevision: 1 }
    })).status, 403);
    assert.equal((await f.request('/host', {
      method: 'PUT', userId: f.admin.id,
      body: { enabled: true, relayUrl: 'not a URL', expectedRevision: 1 }
    })).status, 400);

    const issuedResponse = await f.request('/pairings', {
      body: { projectIds: ['route-project'], capabilities: ['status.read', 'goals.read'] }
    });
    assert.equal(issuedResponse.status, 201);
    assert.equal(issuedResponse.headers.get('cache-control'), 'no-store');
    const issued = (await issuedResponse.json()).data;
    assert.equal((await f.request('/pairings/claim', { body: { secret: issued.qr.secret } })).status, 404);
    const ownerList = await (await f.request('/pairings')).text();
    assert.equal(ownerList.includes(issued.qr.secret), false);
    assert.deepEqual((await (await f.request('/pairings', { userId: f.other.id })).json()).data.pairings, []);

    const identity = generateCompanionIdentity();
    const claimed = f.service.claimPairing({
      pairingId: issued.qr.pairingId,
      secret: issued.qr.secret,
      deviceName: 'Route phone',
      signingPublicKey: identity.signingPublicKey,
      encryptionPublicKey: identity.encryptionPublicKey,
      claimNonce: randomBytes(32).toString('base64url')
    });
    assert.equal((await f.request(`/pairings/${issued.pairing.id}/confirm`, {
      userId: f.other.id,
      body: { revision: claimed.pairing.revision, sas: claimed.sas }
    })).status, 404);
    const confirmed = await f.request(`/pairings/${issued.pairing.id}/confirm`, {
      body: { revision: claimed.pairing.revision, sas: claimed.sas }
    });
    assert.equal(confirmed.status, 200);
    const device = (await confirmed.json()).data.device;
    assert.equal((await f.request(`/devices/${device.id}`, {
      method: 'PATCH',
      body: { expectedRevision: 99, name: 'Stale' }
    })).status, 409);
    const updated = await f.request(`/devices/${device.id}`, {
      method: 'PATCH',
      body: { expectedRevision: device.authorityRevision, capabilities: ['status.read'] }
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).data.device.authorityRevision, 2);
    assert.deepEqual((await (await f.request('/devices', { userId: f.other.id })).json()).data.devices, []);
    assert.equal((await f.request(`/devices/${device.id}/revoke`, { userId: f.other.id, body: {} })).status, 404);
    assert.equal((await f.request(`/devices/${device.id}/revoke`, { body: {} })).status, 200);
    assert.equal((await (await f.request('/devices')).json()).data.devices[0].status, 'revoked');
  } finally { await f.close(); }
});

it('keeps status inspectable but blocks new pairing while Companion is disabled', async () => {
  const f = await fixture(false);
  try {
    const status = await f.request('/host');
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.data.featureEnabled, false);
    assert.equal(body.data.host, null);
    assert.equal((await f.request('/pairings', {
      body: { projectIds: ['route-project'], capabilities: ['status.read'] }
    })).status, 403);
    assert.equal((await f.request('/host', {
      method: 'PUT',
      userId: f.admin.id,
      body: { enabled: true, relayUrl: 'wss://relay.example.test', expectedRevision: 1 }
    })).status, 403);
  } finally { await f.close(); }
});
