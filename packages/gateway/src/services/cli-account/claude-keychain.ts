import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { userInfo } from "node:os";

import { buildCliProbeEnv } from "./probe-runner.js";

/**
 * Read-only access to Claude Code's macOS Keychain credential item. The
 * service/account naming mirrors Claude Code's own secure-storage lookup
 * (verified against 2.1.302): `Claude Code-credentials`, suffixed with the
 * first 8 hex chars of sha256(config dir) when CLAUDE_CONFIG_DIR (or
 * CLAUDE_SECURESTORAGE_CONFIG_DIR) relocates the config root. The secret is
 * password-equivalent: it is held in memory only, never logged or returned.
 */

export type ClaudeKeychainRead =
  | { status: "found"; secret: string }
  | { status: "missing" }
  | { status: "error" };

export type ClaudeKeychainReader = (service: string, account: string) => Promise<ClaudeKeychainRead>;

/** security(1) exit status for errSecItemNotFound. */
const itemNotFoundExitCode = 44;
const keychainAccountPattern = /^[a-zA-Z0-9._-]+$/;
const fallbackKeychainAccount = "claude-code-user";

export function claudeKeychainServiceName(env: NodeJS.ProcessEnv): string {
  const storageDir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  const hashedDir = storageDir !== undefined ? storageDir : env.CLAUDE_CONFIG_DIR;
  const suffix = hashedDir
    ? `-${createHash("sha256").update(hashedDir.normalize("NFC")).digest("hex").slice(0, 8)}`
    : "";
  return `Claude Code-credentials${suffix}`;
}

export function claudeKeychainAccount(env: NodeJS.ProcessEnv): string {
  let account: string;
  try {
    account = env.USER || userInfo().username;
  } catch {
    return fallbackKeychainAccount;
  }
  return keychainAccountPattern.test(account) ? account : fallbackKeychainAccount;
}

export const readMacosKeychainSecret: ClaudeKeychainReader = (service, account) =>
  new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-a", account, "-w", "-s", service],
      { timeout: 2_000, maxBuffer: 64 * 1024, env: buildCliProbeEnv() },
      (error, stdout) => {
        if (!error) {
          resolve({ status: "found", secret: stdout.trim() });
          return;
        }
        const code = (error as { code?: unknown }).code;
        resolve(code === itemNotFoundExitCode ? { status: "missing" } : { status: "error" });
      }
    );
  });
