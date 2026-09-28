import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
}

export interface SecretBoxOptions {
  key: string;
}

export function encryptSecret(plaintext: string, options: SecretBoxOptions): EncryptedSecret {
  const key = parseMasterKey(options.key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: authTag.toString("base64url")
  };
}

export function decryptSecret(secret: EncryptedSecret, options: SecretBoxOptions): string {
  const key = parseMasterKey(options.key);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(secret.iv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(secret.authTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("Failed to decrypt secret");
  }
}

function parseMasterKey(key: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, "hex");
  }

  const keyBuffer = Buffer.from(key, "utf8");
  if (keyBuffer.length !== 32) {
    throw new Error("Master key must be 32 bytes or 64 hex characters");
  }
  return keyBuffer;
}
