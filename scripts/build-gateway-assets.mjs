#!/usr/bin/env node
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function copyGatewayMigrations(options = {}) {
  const workspaceRoot = options.workspaceRoot
    ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = options.source
    ?? path.join(workspaceRoot, "packages", "gateway", "src", "db", "migrations");
  const target = options.target
    ?? path.join(workspaceRoot, "packages", "gateway", "dist", "src", "db", "migrations");

  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await copyGatewayMigrations();
}
