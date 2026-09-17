import { createHmac } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { ProviderAdapter } from "../db/repositories/model-provider-repository.js";
import { expandUserPath } from "../lib/user-path.js";

export type CliConfigScope = "global" | "project";

const mainFiles: Record<ProviderAdapter, string> = {
  claude: "settings.json",
  opencode: "opencode.json",
  codex: "config.toml",
  kimi: "config.toml"
};

export function cliConfigMainFile(adapter: ProviderAdapter): string {
  return mainFiles[adapter];
}

export function cliConfigTargetPath(input: {
  adapter: ProviderAdapter;
  scope: CliConfigScope;
  projectRoot?: string | null;
}): string {
  if (input.scope === "project") {
    if (!input.projectRoot) throw new Error("Project root is required");
    const root = path.resolve(input.projectRoot);
    if (input.adapter === "claude") return path.join(root, ".claude", "settings.local.json");
    if (input.adapter === "kimi") return path.join(root, ".kimi-code", "config.toml");
    return path.join(root, mainFiles[input.adapter]);
  }
  return path.join(globalConfigRoot(input.adapter), mainFiles[input.adapter]);
}

export function globalConfigRoot(
  adapter: ProviderAdapter,
  options: { env?: NodeJS.ProcessEnv; homeDir?: string } = {}
): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  if (adapter === "claude") return resolveUserRoot(env.CLAUDE_CONFIG_DIR, path.join(homeDir, ".claude"), homeDir);
  if (adapter === "codex") return resolveUserRoot(env.CODEX_HOME, path.join(homeDir, ".codex"), homeDir);
  if (adapter === "kimi") return resolveUserRoot(env.KIMI_CODE_HOME, path.join(homeDir, ".kimi-code"), homeDir);
  const xdgRoot = resolveUserRoot(env.XDG_CONFIG_HOME, path.join(homeDir, ".config"), homeDir);
  return resolveUserRoot(env.OPENCODE_CONFIG_DIR, path.join(xdgRoot, "opencode"), homeDir);
}

function resolveUserRoot(value: string | undefined, fallback: string, homeDir: string): string {
  return path.resolve(expandUserPath(value?.trim() || fallback, homeDir));
}

/** Canonicalizes the nearest existing ancestor without creating or opening the target file. */
export function canonicalizeConfigTarget(targetPath: string): string {
  const normalized = path.resolve(targetPath);
  let cursor = normalized;
  const suffix: string[] = [];
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error("CLI_CONFIG_TARGET_UNAVAILABLE");
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.join(realpathSync.native(cursor), ...suffix);
}

/** Keyed (HMAC) locator hash used for cross-process target locks. */
export function hashTargetLocator(masterKey: string, targetPath: string): string {
  return createHmac("sha256", masterKey).update(targetPath.normalize("NFC")).digest("hex");
}
