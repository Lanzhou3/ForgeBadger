import { connect } from 'node:net';
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export function isMissingEndpoint(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ECONNREFUSED';
}

/** Only a refused/missing transport proves that starting a daemon is safe. */
export function endpointIsAbsent(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('IPC endpoint probe timed out')); }, 1500);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
    socket.once('error', error => {
      clearTimeout(timer); socket.destroy();
      if (isMissingEndpoint(error)) resolve(true); else reject(error);
    });
  });
}

export function sameFile(path: string, identity: { ino: number; dev: number }): boolean {
  try { const stat = lstatSync(path); return stat.ino === identity.ino && stat.dev === identity.dev; }
  catch { return false; }
}

/** Cross-process startup lock covers probe, token rotation, spawn and handshake.
 * Unknown/partially written owners fail closed; only ESRCH permits recovery.
 */
export async function withDaemonStartupLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 20_000;
  while (true) {
    let fd: number;
    try { fd = openSync(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const identity = lstatSync(path);
        const pid = Number(readFileSync(path, 'utf8'));
        if (Number.isSafeInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); }
          catch (probeError) {
            if ((probeError as NodeJS.ErrnoException).code === 'ESRCH' && sameFile(path, identity)) unlinkSync(path);
          }
        }
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') throw readError;
      }
      if (Date.now() >= deadline) throw new Error('Session Server startup lock is held or its owner is unknown');
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    const identity = fstatSync(fd);
    try { writeFileSync(fd, String(process.pid)); return await action(); }
    finally { closeSync(fd); if (sameFile(path, identity)) unlinkSync(path); }
  }
}

/** Keep established short endpoints; Darwin sun_path permits only 103 bytes.
 * Hash deep state roots into a short owner-only directory beneath the system
 * sticky temporary directory. Never follow or chmod a pre-existing impostor.
 */
export function resolvePosixIpcPath(stateDir: string): string {
  const original = join(stateDir, 'session-server-v2.sock');
  if (Buffer.byteLength(original) <= 100) return original;
  const uid = process.getuid!();
  const digest = createHash('sha256').update(canonicalPath(stateDir)).digest('hex').slice(0, 24);
  const root = realpathSync('/tmp');
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || (rootStat.uid !== 0 && rootStat.uid !== uid)
    || ((rootStat.mode & 0o022) !== 0 && (rootStat.mode & 0o1000) === 0)) {
    throw new Error('Unsafe system temporary directory for Session Server IPC');
  }
  const directory = join(root, `fb-${uid}-${digest}`);
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o777) !== 0o700) {
    throw new Error('Unsafe Session Server IPC directory: owner, type or permissions mismatch');
  }
  // Use /tmp spelling (its canonical target above is checked) to keep the
  // socket path short even on macOS, where /tmp resolves to /private/tmp.
  return join('/tmp', basename(directory), 'session-server-v2.sock');
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try { return realpathSync(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(canonicalPath(parent), basename(absolute));
  }
}
