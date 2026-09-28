/**
 * Stolen-socket self-check (POSIX only).
 *
 * A daemon whose socket file was unlinked or replaced is "alive but
 * unreachable" — new clients land on someone else's endpoint (or nowhere)
 * while it keeps serving orphaned ptys. Following the gpg-agent self-test
 * model, the daemon periodically verifies that its IPC path still resolves
 * to the socket it listened on (same device + inode) and asks the host to
 * shut it down when the socket was stolen.
 *
 * Windows named pipes are kernel objects with no stale-file semantics, so
 * the check is a no-op there.
 */
import { lstatSync } from "node:fs";

export interface SocketSelfCheckOptions {
  ipcPath: string;
  intervalMs: number;
  onStolen: () => void;
}

/** Returns a teardown function that stops the periodic check. */
export function startSocketSelfCheck(options: SocketSelfCheckOptions): () => void {
  if (process.platform === "win32" || options.intervalMs <= 0) {
    return () => {};
  }

  let identity: { dev: number; ino: number };
  try {
    const stat = lstatSync(options.ipcPath);
    identity = { dev: stat.dev, ino: stat.ino };
  } catch {
    // No socket to watch (e.g. listen failed); nothing to guard.
    return () => {};
  }

  const timer = setInterval(() => {
    if (socketIdentityMatches(options.ipcPath, identity)) return;
    clearInterval(timer);
    options.onStolen();
  }, options.intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}

function socketIdentityMatches(
  ipcPath: string,
  identity: { dev: number; ino: number }
): boolean {
  try {
    const stat = lstatSync(ipcPath);
    return stat.isSocket() && stat.dev === identity.dev && stat.ino === identity.ino;
  } catch {
    // Path vanished — the socket was unlinked under us.
    return false;
  }
}
