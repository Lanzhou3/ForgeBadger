import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

export const ACCOUNT_RECOVERY_KEY_FILENAME = "account-recovery.key";
const RECOVERY_KEY_PATTERN = /^fbr_[A-Za-z0-9_-]{43}$/;

export interface LocalAccountRecovery {
  readonly keyPath: string;
  isValid(candidate: string): boolean;
  consume(candidate: string): boolean;
}

export function createLocalAccountRecovery(stateDir: string): LocalAccountRecovery {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(stateDir, ACCOUNT_RECOVERY_KEY_FILENAME);
  let currentKey = loadOrCreateRecoveryKey(keyPath);

  return {
    keyPath,
    isValid(candidate) {
      return secretsMatch(currentKey, candidate);
    },
    consume(candidate) {
      if (!secretsMatch(currentKey, candidate)) return false;
      currentKey = rotateRecoveryKey(keyPath);
      return true;
    }
  };
}

function loadOrCreateRecoveryKey(keyPath: string): string {
  try {
    writeFileSync(keyPath, `${generateRecoveryKey()}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  const metadata = lstatSync(keyPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Account recovery key path must be a regular file: ${keyPath}`);
  }
  chmodSync(keyPath, 0o600);
  const key = readFileSync(keyPath, "utf8").trim();
  if (!RECOVERY_KEY_PATTERN.test(key)) {
    throw new Error(`Account recovery key file is invalid: ${keyPath}`);
  }
  return key;
}

function rotateRecoveryKey(keyPath: string): string {
  const nextKey = generateRecoveryKey();
  const temporaryPath = `${keyPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporaryPath, `${nextKey}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    renameSync(temporaryPath, keyPath);
    chmodSync(keyPath, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
  return nextKey;
}

function generateRecoveryKey(): string {
  return `fbr_${randomBytes(32).toString("base64url")}`;
}

function secretsMatch(expected: string, candidate: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const candidateBuffer = Buffer.from(candidate, "utf8");
  if (expectedBuffer.length !== candidateBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, candidateBuffer);
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
