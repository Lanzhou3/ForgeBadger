import assert from 'node:assert/strict';
import { it } from 'node:test';
import { generateCompanionIdentity } from '../src/services/companion/keys.js';
import {
  openCompanionMessage,
  sealCompanionMessage,
  signCompanionPayload,
  verifyCompanionPayload
} from '../src/services/companion/transport-crypto.js';

it('signs canonical payloads and rejects tampering', () => {
  const identity = generateCompanionIdentity();
  const signature = signCompanionPayload({ b: 2, a: 1 }, identity.signingPrivateKey);
  assert.equal(verifyCompanionPayload({ a: 1, b: 2 }, identity.signingPublicKey, signature), true);
  assert.equal(verifyCompanionPayload({ a: 1, b: 3 }, identity.signingPublicKey, signature), false);
});

it('encrypts signed messages end to end with context and device binding', () => {
  const host = generateCompanionIdentity();
  const device = generateCompanionIdentity();
  const other = generateCompanionIdentity();
  const context = 'pairing.claim:host-1:pairing-1';
  const sealed = sealCompanionMessage({
    payload: { secret: 'one-time-secret', deviceName: 'Phone' },
    signingPrivateKey: device.signingPrivateKey,
    encryptionPrivateKey: device.encryptionPrivateKey,
    recipientEncryptionPublicKey: host.encryptionPublicKey,
    context
  });
  assert.equal(JSON.stringify(sealed).includes('one-time-secret'), false);
  const opened = openCompanionMessage({
    sealed,
    encryptionPrivateKey: host.encryptionPrivateKey,
    context,
    expectedSigningPublicKey: device.signingPublicKey
  });
  assert.deepEqual(opened.payload, { secret: 'one-time-secret', deviceName: 'Phone' });
  assert.throws(() => openCompanionMessage({
    sealed,
    encryptionPrivateKey: host.encryptionPrivateKey,
    context: 'pairing.claim:host-1:another-pairing',
    expectedSigningPublicKey: device.signingPublicKey
  }));
  assert.throws(() => openCompanionMessage({
    sealed,
    encryptionPrivateKey: other.encryptionPrivateKey,
    context,
    expectedSigningPublicKey: device.signingPublicKey
  }));
  assert.throws(() => openCompanionMessage({
    sealed,
    encryptionPrivateKey: host.encryptionPrivateKey,
    context,
    expectedSigningPublicKey: other.signingPublicKey
  }));
});
