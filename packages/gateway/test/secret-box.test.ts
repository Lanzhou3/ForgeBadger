import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decryptSecret, encryptSecret } from "../src/crypto/secret-box.js";

const key = "0123456789abcdef0123456789abcdef";
const hexKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("secret-box", () => {
  it("encrypts and decrypts a secret with AES-256-GCM", () => {
    const encrypted = encryptSecret("sk-test", { key });

    assert.notEqual(encrypted.ciphertext, "sk-test");
    assert.equal(decryptSecret(encrypted, { key }), "sk-test");
  });

  it("uses a random IV so repeated encryptions differ", () => {
    const first = encryptSecret("sk-test", { key });
    const second = encryptSecret("sk-test", { key });

    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.ciphertext, second.ciphertext);
  });

  it("rejects tampered auth tags", () => {
    const encrypted = encryptSecret("sk-test", { key });

    assert.throws(
      () => decryptSecret({ ...encrypted, authTag: "00".repeat(16) }, { key }),
      /decrypt/i
    );
  });

  it("validates master key length", () => {
    assert.throws(() => encryptSecret("sk-test", { key: "short" }), /32 bytes/i);
  });

  it("accepts a 32-byte key encoded as 64 hex characters", () => {
    const encrypted = encryptSecret("sk-test", { key: hexKey });

    assert.equal(decryptSecret(encrypted, { key: hexKey }), "sk-test");
  });
});
