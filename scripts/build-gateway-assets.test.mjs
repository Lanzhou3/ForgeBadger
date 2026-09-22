import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { copyGatewayMigrations, removeRetiredVerificationArtifacts } from "./build-gateway-assets.mjs";

describe("Gateway build assets", () => {
  it("copies database migrations without platform shell commands", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-gateway-assets-"));
    const source = path.join(root, "src", "db", "migrations");
    const target = path.join(root, "dist", "src", "db", "migrations");
    await mkdir(path.join(source, "meta"), { recursive: true });
    await writeFile(path.join(source, "0001.sql"), "SELECT 1;\n");
    await writeFile(path.join(source, "meta", "_journal.json"), "{}\n");

    await copyGatewayMigrations({ source, target });

    assert.equal(await readFile(path.join(target, "0001.sql"), "utf8"), "SELECT 1;\n");
    assert.equal(await readFile(path.join(target, "meta", "_journal.json"), "utf8"), "{}\n");
  });
});

it("removes stale verification executor outputs while retaining history recovery", async () => {
 const root = await mkdtemp(path.join(tmpdir(), "fb-retired-output-"));
 const dir = path.join(root, "packages/gateway/dist/src/services/collaboration");
 await mkdir(dir, {recursive:true});
 for (const name of ["verification", "verification-process", "verification-runner-entry"]) {
  for (const ext of ["js", "js.map", "d.ts"]) await writeFile(path.join(dir, `${name}.${ext}`), "old");
 }
 await writeFile(path.join(dir, "legacy-verification-recovery.js"), "retained");
 await removeRetiredVerificationArtifacts(root);
 for (const name of ["verification", "verification-process", "verification-runner-entry"]) {
  for (const ext of ["js", "js.map", "d.ts"]) await assert.rejects(readFile(path.join(dir, `${name}.${ext}`)), {code:"ENOENT"});
 }
 assert.equal(await readFile(path.join(dir,"legacy-verification-recovery.js"),"utf8"), "retained");
});
