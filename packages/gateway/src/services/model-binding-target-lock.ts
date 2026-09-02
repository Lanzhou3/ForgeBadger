import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, chmodSync, fsyncSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { expandUserPath } from "../lib/user-path.js";

export class ModelBindingTargetLockError extends Error {
  readonly code = "BINDING_TARGET_LOCKED";
}

export function acquireModelBindingTargetLock(hash: string): { release(): void } {
  const dir = path.join(stateDir(), "locks", "model-bindings");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const lockPath = path.join(dir, `${hash}.lock`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), "utf8");
      fsyncSync(fd);
      closeSync(fd);
      return { release: () => safeUnlink(lockPath) };
    } catch (error) {
      if (!isCode(error, "EEXIST") || !recoverStaleLock(lockPath)) throw new ModelBindingTargetLockError();
    }
  }
  throw new ModelBindingTargetLockError();
}

function recoverStaleLock(lockPath: string): boolean {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number; createdAt?: number };
    if (!Number.isSafeInteger(lock.pid) || !Number.isFinite(lock.createdAt)
      || Date.now() - Number(lock.createdAt) < 60_000) return false;
    try { process.kill(Number(lock.pid), 0); return false; } catch { safeUnlink(lockPath); return true; }
  } catch { return false; }
}

function stateDir(): string {
  if (process.env.NODE_TEST_CONTEXT) return path.join(tmpdir(), `forgebadger-test-${process.pid}`);
  return path.resolve(expandUserPath(
    process.env.FORGEBADGER_STATE_DIR ?? path.join(homedir(), ".forgebadger")
  ));
}

function safeUnlink(file: string): void {
  try { unlinkSync(file); } catch (error) { if (!isCode(error, "ENOENT")) throw error; }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
