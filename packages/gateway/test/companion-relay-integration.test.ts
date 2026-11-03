import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import WebSocket from 'ws';

import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CompanionService } from '../src/services/companion/companion-service.js';
import { CompanionHostRuntime } from '../src/services/companion/host-runtime.js';
import { generateCompanionIdentity } from '../src/services/companion/keys.js';
import { openCompanionMessage, sealCompanionMessage, signCompanionPayload } from '../src/services/companion/transport-crypto.js';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
const relayEntry = fileURLToPath(new URL('../../relay/src/index.ts', import.meta.url));

class DeviceSocket {
  private readonly messages: any[] = [];
  private readonly waiters: Array<(message: any) => void> = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.messages.push(message);
    });
  }
  send(value: unknown): void { this.ws.send(JSON.stringify(value)); }
  async next(type: string, timeoutMs = 5000): Promise<any> {
    const index = this.messages.findIndex(message => message.type === type);
    if (index >= 0) return this.messages.splice(index, 1)[0];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push(message => {
        clearTimeout(timer);
        if (message.type === type) resolve(message);
        else {
          this.messages.push(message);
          this.waiters.push(() => {});
        }
      });
    });
  }
}

async function startRelay(requestedPort = 0) {
  const child = spawn(process.execPath, ['--import', 'tsx', relayEntry], {
    env: { ...process.env, FORGEBADGER_RELAY_HOST: '127.0.0.1', FORGEBADGER_RELAY_PORT: String(requestedPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Relay startup timed out')), 5000);
    child.stdout.on('data', data => {
      const match = /\[relay\] listening (\{.*\})/.exec(data.toString());
      if (match) {
        clearTimeout(timer);
        resolve(JSON.parse(match[1]).port);
      }
    });
    child.once('error', reject);
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) reject(new Error(`Relay exited ${code}`));
    });
  });
  return { child, port };
}

async function stopRelay(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exited;
}

async function deviceSocket(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/companion/v1`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return new DeviceSocket(ws);
}

async function waitUntil(check: () => boolean, message: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

it('pairs and serves encrypted read-only device traffic through a real Relay', { timeout: 20000 }, async () => {
  const relay = await startRelay();
  const db = new Sqlite(':memory:');
  let runtime: CompanionHostRuntime | undefined;
  let device: DeviceSocket | undefined;
  try {
    migrate(drizzle(db), { migrationsFolder });
    const users = new UserRepository(db);
    const admin = users.create('relay-admin@test.dev', 'fixture', { role: 'admin' });
    const owner = users.create('relay-owner@test.dev', 'fixture');
    db.prepare('INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('relay-project', owner.id, 'Relay project', '/private/tmp/relay-project', '', 'active', 0, Date.now(), Date.now());
    const masterKey = randomBytes(32).toString('hex');
    const service = new CompanionService(db, masterKey, true);
    const configured = service.configureHost(admin.id, {
      enabled: true,
      relayUrl: `wss://127.0.0.1:${relay.port}/companion/v1`,
      expectedRevision: 1
    });
    runtime = new CompanionHostRuntime(db, masterKey, true, {
      pollIntervalMs: 20,
      heartbeatIntervalMs: 100,
      allowPrivateNetworks: true,
      relayUrlTransform: url => url.replace('wss:', 'ws:')
    });
    await runtime.start();

    const issued = service.createPairing(owner.id, {
      projectIds: ['relay-project'], capabilities: ['status.read', 'goals.read']
    });
    const identity = generateCompanionIdentity();
    device = await deviceSocket(relay.port);
    const claim = {
      pairingId: issued.qr.pairingId,
      secret: issued.qr.secret,
      deviceName: 'Integration phone',
      signingPublicKey: identity.signingPublicKey,
      encryptionPublicKey: identity.encryptionPublicKey,
      claimNonce: randomBytes(32).toString('base64url')
    };
    device.send({
      type: 'pairing.claim', protocolVersion: 1, hostId: issued.qr.hostId, pairingId: issued.qr.pairingId,
      sealed: sealCompanionMessage({
        payload: claim,
        signingPrivateKey: identity.signingPrivateKey,
        encryptionPrivateKey: identity.encryptionPrivateKey,
        recipientEncryptionPublicKey: configured.host.encryptionPublicKey,
        context: `pairing.claim:${issued.qr.hostId}:${issued.qr.pairingId}`
      })
    });
    await waitUntil(() => service.listPairings(owner.id)[0]?.status === 'claimed', 'Pairing was not claimed');
    const claimed = service.listPairings(owner.id)[0]!;
    const claimNotice = await device.next('pairing.claimed');
    const claimNoticePayload = openCompanionMessage({
      sealed: claimNotice.sealed,
      encryptionPrivateKey: identity.encryptionPrivateKey,
      context: `pairing.claimed:${issued.qr.hostId}:${issued.qr.pairingId}`,
      expectedSigningPublicKey: configured.host.signingPublicKey
    });
    assert.equal(claimNoticePayload.payload.sas, claimed.sas);
    const confirmed = service.confirmPairing(owner.id, issued.pairing.id, {
      revision: claimed.revision,
      sas: claimed.sas!
    });
    const ready = await device.next('device.ready');
    assert.equal(ready.deviceId, confirmed.device.id);
    const confirmation = await device.next('envelope');
    const confirmedEvent = openCompanionMessage({
      sealed: confirmation.sealed,
      encryptionPrivateKey: identity.encryptionPrivateKey,
      context: `event:${issued.qr.hostId}:${confirmed.device.id}:${confirmation.messageId}`,
      expectedSigningPublicKey: configured.host.signingPublicKey
    });
    assert.equal(confirmedEvent.payload.type, 'device.confirmed');

    const messageId = randomUUID();
    device.send({
      type: 'envelope', hostId: issued.qr.hostId, deviceId: confirmed.device.id,
      messageId, kind: 'query',
      sealed: sealCompanionMessage({
        payload: { type: 'snapshot', authorityRevision: 1 },
        signingPrivateKey: identity.signingPrivateKey,
        encryptionPrivateKey: identity.encryptionPrivateKey,
        recipientEncryptionPublicKey: configured.host.encryptionPublicKey,
        context: `query:${issued.qr.hostId}:${confirmed.device.id}:${messageId}`
      })
    });
    const result = await device.next('envelope');
    const snapshotResult = openCompanionMessage({
      sealed: result.sealed,
      encryptionPrivateKey: identity.encryptionPrivateKey,
      context: `query_result:${issued.qr.hostId}:${confirmed.device.id}:${messageId}`,
      expectedSigningPublicKey: configured.host.signingPublicKey
    });
    assert.equal(snapshotResult.payload.ok, true);
    assert.equal(snapshotResult.payload.snapshot.projects[0].id, 'relay-project');

    device.send({ type: 'presence.get' });
    assert.equal((await device.next('presence')).online, true);

    const syncId = randomUUID();
    device.send({
      type: 'envelope', hostId: issued.qr.hostId, deviceId: confirmed.device.id,
      messageId: syncId, kind: 'query',
      sealed: sealCompanionMessage({
        payload: { type: 'sync', authorityRevision: 1, afterSequence: 0 },
        signingPrivateKey: identity.signingPrivateKey,
        encryptionPrivateKey: identity.encryptionPrivateKey,
        recipientEncryptionPublicKey: configured.host.encryptionPublicKey,
        context: `query:${issued.qr.hostId}:${confirmed.device.id}:${syncId}`
      })
    });
    const syncEnvelope = await device.next('envelope');
    const syncResult = openCompanionMessage({
      sealed: syncEnvelope.sealed,
      encryptionPrivateKey: identity.encryptionPrivateKey,
      context: `query_result:${issued.qr.hostId}:${confirmed.device.id}:${syncId}`,
      expectedSigningPublicKey: configured.host.signingPublicKey
    });
    assert.equal(syncResult.payload.sync.events[0].type, 'device.confirmed');

    await stopRelay(relay.child);
    const restarted = await startRelay(relay.port);
    relay.child = restarted.child;
    await new Promise(resolve => setTimeout(resolve, 500));
    device = await deviceSocket(relay.port);
    const connection = {
      type: 'device.connect', protocolVersion: 1, hostId: issued.qr.hostId,
      deviceId: confirmed.device.id, nonce: randomUUID(), timestamp: Date.now()
    };
    device.send({ ...connection, signature: signCompanionPayload(connection, identity.signingPrivateKey) });
    assert.equal((await device.next('device.ready')).deviceId, confirmed.device.id);

    service.revokeDevice(owner.id, confirmed.device.id);
    let revokedEvent: any;
    for (let attempt = 0; attempt < 10 && !revokedEvent; attempt += 1) {
      const envelope = await device.next('envelope');
      const event = openCompanionMessage({
        sealed: envelope.sealed,
        encryptionPrivateKey: identity.encryptionPrivateKey,
        context: `event:${issued.qr.hostId}:${confirmed.device.id}:${envelope.messageId}`,
        expectedSigningPublicKey: configured.host.signingPublicKey
      });
      if (event.payload.type === 'device.revoked') revokedEvent = event;
    }
    assert.equal(revokedEvent?.payload.type, 'device.revoked');

    await runtime.stop();
    runtime = undefined;
    device.send({ type: 'presence.get' });
    assert.equal((await device.next('presence')).online, false);
  } finally {
    device?.ws.close();
    await runtime?.stop();
    await stopRelay(relay.child);
    db.close();
  }
});
