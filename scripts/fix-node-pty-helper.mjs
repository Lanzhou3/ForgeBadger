#!/usr/bin/env node
/**
 * Ensures node-pty's darwin prebuild `spawn-helper` has the execute bit.
 *
 * node-pty 1.1.0 publishes darwin prebuilds with 644 permissions. pnpm's
 * content-addressable store preserves tarball permissions, so every
 * node-pty spawn fails with `posix_spawnp failed` on macOS (microsoft/node-pty#850).
 * Fixed upstream in the 1.2.0-beta line; this script is the 1.1.0 backport.
 * Remove this script once node-pty is upgraded past the fixed release.
 *
 * Idempotent: chmod +x is a no-op when the bit is already set.
 */
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pnpmDir = join(repoRoot, "node_modules", ".pnpm");

let fixedCount = 0;
let missing = [];

if (existsSync(pnpmDir)) {
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith("node-pty@")) continue;
    const prebuilds = join(pnpmDir, entry, "node_modules", "node-pty", "prebuilds");
    if (!existsSync(prebuilds)) {
      missing.push(entry);
      continue;
    }
    for (const arch of readdirSync(prebuilds)) {
      if (!arch.startsWith("darwin")) continue;
      const helper = join(prebuilds, arch, "spawn-helper");
      if (existsSync(helper)) {
        chmodSync(helper, 0o755);
        fixedCount += 1;
      }
    }
  }
}

const summary = `[fix-node-pty-helper] chmod +x applied to ${fixedCount} spawn-helper(s)`;
if (missing.length > 0) {
  console.warn(`${summary}; prebuilds not found in ${missing.join(", ")}`);
} else {
  console.log(summary);
}