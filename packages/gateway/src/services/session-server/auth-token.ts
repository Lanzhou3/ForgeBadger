/**
 * Session Server handshake token management.
 *
 * The Gateway generates a random token each time it spawns a Session Server
 * and writes it to `<stateDir>/session-server-v2.token` (0600, atomic
 * write-then-rename). The token is passed to the server via a `--token-file`
 * argument — never on the command line or through an environment variable —
 * and Gateway-side clients read it back from the same path when connecting.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SESSION_SERVER_TOKEN_FILE_NAME = "session-server-v2.token";

export function resolveSessionServerTokenPath(stateDir?: string): string {
  const dir = stateDir ?? process.env.FORGEBADGER_STATE_DIR ?? join(homedir(), ".forgebadger");
  return join(dir, SESSION_SERVER_TOKEN_FILE_NAME);
}

export function generateSessionServerToken(): string {
  return randomBytes(32).toString("hex");
}

export function writeSessionServerTokenFile(tokenPath: string, token: string): void {
  mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${tokenPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, token, { mode: 0o600 });
  renameSync(tmpPath, tokenPath);
  chmodSync(tokenPath, 0o600);
}

export function readSessionServerTokenFile(tokenPath: string): string {
  const token = readFileSync(tokenPath, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new Error(`Invalid Session Server token file: ${tokenPath}`);
  }
  return token;
}
