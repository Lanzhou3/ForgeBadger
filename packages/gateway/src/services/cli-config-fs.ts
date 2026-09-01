import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export class CliConfigFsError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
  }
}

/**
 * Reads a CLI config target without following symlinks. A missing file is not
 * an error: callers treat it as an empty document.
 */
export function readObservedConfig(targetPath: string): { existed: boolean; content: string } {
  if (!existsSync(targetPath)) return { existed: false, content: "" };
  if (lstatSync(targetPath).isSymbolicLink()) {
    throw new CliConfigFsError("CLI_CONFIG_TARGET_UNSAFE", "CLI config target must not be a symbolic link");
  }
  const fd = openSync(targetPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    return { existed: true, content: readFileSync(fd, "utf8") };
  } finally {
    closeSync(fd);
  }
}

/**
 * Atomic 0600 write: temp file in the target directory (O_EXCL), fsync,
 * rename over the target, then a directory fsync. Symlink targets are
 * rejected before and after the rename window.
 */
export function atomicWriteConfig(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) {
    throw new CliConfigFsError("CLI_CONFIG_TARGET_UNSAFE", "CLI config target must not be a symbolic link");
  }
  const temp = path.join(dir, `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(temp, 0o600);
  renameSync(temp, targetPath);
  chmodSync(targetPath, 0o600);
  fsyncDirectory(dir);
}

/** Restores a previously observed file state (delete when it did not exist). */
export function restoreObservedConfig(
  targetPath: string,
  observed: { existed: boolean; content: string }
): void {
  if (!observed.existed) {
    safeUnlink(targetPath);
    return;
  }
  atomicWriteConfig(targetPath, observed.content);
}

export function safeUnlink(file: string): void {
  try {
    unlinkSync(file);
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }
}

export function fsyncFile(file: string): void {
  const fd = openSync(file, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function fsyncDirectory(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch { /* unsupported filesystem */ }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
