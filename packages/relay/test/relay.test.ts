import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { it } from 'node:test';
import WebSocket from 'ws';
import { createCompanionRelayServer } from '../src/server.js';
import { canonicalCompanionJson } from '../src/crypto.js';

function identity() {
  const signing = generateKeyPairSync('ed25519');
  return {
    publicKey: signing.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    privateKey: signing.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url')
  };
}

function signature(value: unknown, privateKey: string) {
  return sign(null, Buffer.from(canonicalCompanionJson(value)), {
    key: Buffer.from(privateKey, 'base64url'), format: 'der', type: 'pkcs8'
  }).toString('base64url');
}

async function socket(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/companion/v1`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

function nextMessage(ws: WebSocket) {
  return new Promise<any>(resolve => ws.once('message', data => resolve(JSON.parse(data.toString()))));
}

it('authenticates hosts, routes opaque pairing claims and registers confirmed devices', async () => {
  const relay = await createCompanionRelayServer({ host: '127.0.0.1', port: 0 });
  const hostIdentity = identity();
  const deviceIdentity = identity();
  const hostId = createHash('sha256').update(Buffer.from(hostIdentity.publicKey, 'base64url')).digest('hex');
  const deviceId = randomUUID();
  const pairingId = randomUUID();
  let host: WebSocket | undefined;
  let device: WebSocket | undefined;
  try {
    host = await socket(relay.port);
    const registration = {
      type: 'host.register', protocolVersion: 1, hostId,
      signingPublicKey: hostIdentity.publicKey,
      encryptionPublicKey: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'), timestamp: Date.now()
    };
    const accepted = nextMessage(host);
    host.send(JSON.stringify({ ...registration, signature: signature(registration, hostIdentity.privateKey) }));
    assert.equal((await accepted).type, 'host.ready');

    const presenceRequest = nextMessage(host);
    host.send(JSON.stringify({ type: 'host.heartbeat', timestamp: Date.now() }));
    assert.equal((await presenceRequest).type, 'host.heartbeat.ack');

    device = await socket(relay.port);
    const claimForwarded = nextMessage(host);
    const claim = {
      type: 'pairing.claim', protocolVersion: 1, hostId, pairingId,
      sealed: { senderEncryptionPublicKey: 'opaque', nonce: 'opaque', ciphertext: 'secret-claim', authTag: 'opaque' }
    };
    device.send(JSON.stringify(claim));
    assert.deepEqual((await claimForwarded).sealed, claim.sealed);

    const ready = nextMessage(device);
    const deviceRegistration = {
      type: 'device.register', protocolVersion: 1, hostId, pairingId, deviceId,
      signingPublicKey: deviceIdentity.publicKey,
      encryptionPublicKey: randomBytes(32).toString('base64url'),
      registeredAt: Date.now()
    };
    host.send(JSON.stringify({ ...deviceRegistration, signature: signature(deviceRegistration, hostIdentity.privateKey) }));
    assert.equal((await ready).type, 'device.ready');
    assert.equal((await ready).deviceId, deviceId);

    const envelope = { type: 'envelope', hostId, deviceId, messageId: randomUUID(), kind: 'query', sealed: claim.sealed };
    const queryAtHost = nextMessage(host);
    device.send(JSON.stringify(envelope));
    assert.deepEqual((await queryAtHost).sealed, claim.sealed);

    const presenceAtDevice = nextMessage(device);
    device.send(JSON.stringify({ type: 'presence.get' }));
    const presence = await presenceAtDevice;
    assert.equal(presence.type, 'presence');
    assert.equal(presence.online, true);

    const reconnected = await socket(relay.port);
    const connected = nextMessage(reconnected);
    const connection = {
      type: 'device.connect', protocolVersion: 1, hostId, deviceId,
      nonce: randomBytes(32).toString('base64url'), timestamp: Date.now()
    };
    reconnected.send(JSON.stringify({ ...connection, signature: signature(connection, deviceIdentity.privateKey) }));
    assert.equal((await connected).type, 'device.ready');
    reconnected.close();
  } finally {
    host?.close();
    device?.close();
    await relay.close();
  }
});

it('rejects forged host registration and unauthenticated device envelopes', async () => {
  const relay = await createCompanionRelayServer({ host: '127.0.0.1', port: 0 });
  const ws = await socket(relay.port);
  try {
    const failure = nextMessage(ws);
    ws.send(JSON.stringify({
      type: 'host.register', protocolVersion: 1, hostId: randomBytes(32).toString('hex'),
      signingPublicKey: identity().publicKey, encryptionPublicKey: 'opaque',
      nonce: randomBytes(32).toString('base64url'), timestamp: Date.now(), signature: 'invalid'
    }));
    assert.equal((await failure).type, 'error');

    const secondFailure = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'envelope', hostId: randomUUID(), deviceId: randomUUID(), sealed: {} }));
    assert.equal((await secondFailure).type, 'error');
  } finally {
    ws.close();
    await relay.close();
  }
});
