import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveNodeTestArgs } from "../scripts/run-tests.mjs";

describe("resolveNodeTestArgs", () => {
  it("rewrites test file basenames to the test directory", async () => {
    // Arrange
    const cwd = await mkdtemp(path.join(tmpdir(), "openforge-cli-tests-"));
    await mkdir(path.join(cwd, "test"));
    await writeFile(path.join(cwd, "test", "runtime-config.test.ts"), "");

    // Act
    const args = await resolveNodeTestArgs(["runtime-config.test.ts"], cwd);

    // Assert
    assert.deepEqual(args, ["test/runtime-config.test.ts"]);
  });

  it("preserves existing paths and other node:test arguments", async () => {
    // Arrange
    const cwd = await mkdtemp(path.join(tmpdir(), "openforge-cli-tests-"));
    await mkdir(path.join(cwd, "test"));
    await writeFile(path.join(cwd, "test", "runtime-config.test.ts"), "");

    // Act
    const args = await resolveNodeTestArgs(["--test-reporter", "spec", "test/runtime-config.test.ts"], cwd);

    // Assert
    assert.deepEqual(args, ["--test-reporter", "spec", "test/runtime-config.test.ts"]);
  });

  it("does not rewrite values for node:test options", async () => {
    // Arrange
    const cwd = await mkdtemp(path.join(tmpdir(), "openforge-cli-tests-"));
    await mkdir(path.join(cwd, "test"));
    await writeFile(path.join(cwd, "test", "runtime-config.test.ts"), "");

    // Act
    const args = await resolveNodeTestArgs(["--test-reporter-destination", "runtime-config.test.ts"], cwd);

    // Assert
    assert.deepEqual(args, ["--test-reporter-destination", "runtime-config.test.ts"]);
  });
});
