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

// tsc does not delete outputs for removed sources. Retire old executable artifacts
// as part of every build so upgrades cannot accidentally ship the old supervisor.
export async function removeRetiredVerificationArtifacts(workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  for (const name of ["verification", "verification-process", "verification-runner-entry"]) {
    for (const extension of ["js", "js.map", "d.ts"]) {
      await rm(path.join(workspaceRoot, "packages/gateway/dist/src/services/collaboration", `${name}.${extension}`), { force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await removeRetiredVerificationArtifacts();
  await copyGatewayMigrations();
}
