import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { describe, it } from "node:test";

import { safeResolve, validateProjectRoot } from "../src/lib/safe-resolve.js";

describe("safeResolve", () => {
  it("resolves a relative path inside an approved project root", () => {
    const root = mkdtempSync(join(tmpdir(), "forgebadger-root-"));

    const resolved = safeResolve(root, ".claude/CLAUDE.md");

    assert.equal(resolved, join(realpathSync(root), ".claude/CLAUDE.md"));
  });

  it("rejects parent traversal outside the project root", () => {
    const root = mkdtempSync(join(tmpdir(), "forgebadger-root-"));

    assert.throws(
      () => safeResolve(root, "../outside.md"),
      /escapes approved project root/
    );
  });

  it("rejects absolute output paths", () => {
    const root = mkdtempSync(join(tmpdir(), "forgebadger-root-"));

    assert.throws(() => safeResolve(root, "/tmp/outside.md"), /absolute paths/);
  });

  it("rejects denied roots as project roots", () => {
    const deniedRoot = process.platform === "win32" ? parse(process.cwd()).root : "/etc";
    assert.throws(() => validateProjectRoot(deniedRoot), /denied root/);
  });

  it("rejects symlink escapes", () => {
    const root = mkdtempSync(join(tmpdir(), "forgebadger-root-"));
    const outside = mkdtempSync(join(tmpdir(), "forgebadger-outside-"));
    const outsideFile = join(outside, "secret.txt");
    writeFileSync(outsideFile, "secret");
    symlinkSync(outsideFile, join(root, "leak.txt"));

    assert.throws(
      () => safeResolve(root, "leak.txt"),
      /escapes approved project root/
    );
  });
});
