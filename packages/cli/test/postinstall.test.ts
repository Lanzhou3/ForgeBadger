import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { repairNodePtyHelper } from "../postinstall.mjs";

it("repairs only the resolved dependency's current Darwin architecture helper", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "fb-postinstall-"));
  const dependency = join(root, "node-pty");
  const target = join(dependency, "prebuilds", "darwin-arm64", "spawn-helper");
  const other = join(dependency, "prebuilds", "darwin-x64", "spawn-helper");
  try {
    for (const file of [target, other]) {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "fixture"); chmodSync(file, 0o644);
    }
    repairNodePtyHelper({ platform: "darwin", arch: "arm64", resolvePackage: () => join(dependency, "package.json") });
    assert.equal(statSync(target).mode & 0o777, 0o755);
    assert.equal(statSync(other).mode & 0o777, 0o644);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { copyFileSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

it("is a no-op outside Darwin and never resolves other dependencies", () => {
  assert.equal(repairNodePtyHelper({ platform: "linux", resolvePackage: () => { throw new Error("must not resolve"); } }), "skipped");
  assert.equal(repairNodePtyHelper({ platform: "win32", resolvePackage: () => { throw new Error("must not resolve"); } }), "skipped");
});

it("accepts source-built layouts without a prebuild helper and surfaces resolution errors", () => {
  const root = mkdtempSync(join(tmpdir(), "fb-postinstall-"));
  try {
    assert.equal(repairNodePtyHelper({ platform: "darwin", arch: "x64", resolvePackage: () => join(root, "package.json") }), "missing");
    assert.throws(() => repairNodePtyHelper({ platform: "darwin", resolvePackage: () => { throw new Error("dependency missing"); } }), /dependency missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("does not follow a helper symlink or change an outside target", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "fb-postinstall-"));
  const dependency = join(root, "node-pty");
  const helper = join(dependency, "prebuilds", "darwin-arm64", "spawn-helper");
  const outside = join(root, "outside");
  try {
    mkdirSync(join(helper, ".."), { recursive: true });
    writeFileSync(outside, "fixture"); chmodSync(outside, 0o644);
    symlinkSync(outside, helper);
    assert.throws(() => repairNodePtyHelper({ platform: "darwin", arch: "arm64", resolvePackage: () => join(dependency, "package.json") }), /unsafe/);
    assert.equal(statSync(outside).mode & 0o777, 0o644);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("installed postinstall runs without dist and resolves relative to its own package", { skip: process.platform !== "darwin" }, () => {
  const root = mkdtempSync(join(tmpdir(), "fb-postinstall-main-"));
  const cli = join(root, "cli");
  const dependency = join(cli, "node_modules", "node-pty");
  const helper = join(dependency, "prebuilds", `darwin-${process.arch}`, "spawn-helper");
  try {
    mkdirSync(join(helper, ".."), { recursive: true });
    writeFileSync(join(dependency, "package.json"), JSON.stringify({ name: "node-pty" }));
    writeFileSync(helper, "fixture"); chmodSync(helper, 0o644);
    copyFileSync(fileURLToPath(new URL("../postinstall.mjs", import.meta.url)), join(cli, "postinstall.mjs"));
    execFileSync(process.execPath, [join(cli, "postinstall.mjs")], { cwd: root });
    assert.equal(statSync(helper).mode & 0o777, 0o755);
    chmodSync(helper, 0o644);
    const alias = join(root, "cli-alias");
    symlinkSync(cli, alias, "dir");
    execFileSync(process.execPath, [join(alias, "postinstall.mjs")], { cwd: root });
    assert.equal(statSync(helper).mode & 0o777, 0o755);
    const modified = statSync(helper).ctimeMs;
    execFileSync(process.execPath, [join(cli, "postinstall.mjs")], { cwd: root });
    assert.equal(statSync(helper).mode & 0o777, 0o755);
    assert.equal(statSync(helper).ctimeMs, modified);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
