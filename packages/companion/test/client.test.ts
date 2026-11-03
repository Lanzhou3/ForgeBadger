import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { isSnapshotStale, parseCompanionQr } from '../src/client/protocol.js';

it('parses a pinned pairing QR and rejects unsafe or unknown fields', () => {
  const qr = {
    protocolVersion: 1,
    pairingId: randomUUID(),
    secret: randomBytes(32).toString('base64url'),
    relayUrl: 'wss://relay.example.test/companion/v1',
    hostId: randomBytes(32).toString('hex'),
    hostSigningPublicKey: randomBytes(32).toString('base64url'),
    hostEncryptionPublicKey: randomBytes(32).toString('base64url')
  };
  assert.equal(parseCompanionQr(JSON.stringify(qr)).pairingId, qr.pairingId);
  assert.throws(() => parseCompanionQr(JSON.stringify({ ...qr, ownerJwt: 'must-not-exist' })));
  assert.throws(() => parseCompanionQr(JSON.stringify({ ...qr, relayUrl: 'http://relay.example.test' })));
});

it('marks cached snapshots stale without changing their evidence timestamps', () => {
  const now = Date.now();
  assert.equal(isSnapshotStale(now - 119_000, now), false);
  assert.equal(isSnapshotStale(now - 121_000, now), true);
});
