import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runCli } from "../src/index.js";
import { resolveCliVersion } from "../src/runtime/version.js";

const virtualModuleUrl = pathToFileURL(path.resolve("/virtual/dist/runtime/version.js")).href;
const virtualPackageJson = path.resolve("/virtual/package.json");

describe("resolveCliVersion", () => {
  it("reads the version from the adjacent package.json", async () => {
    const version = await resolveCliVersion(virtualModuleUrl, {
      readFileImpl: async (filePath) => {
        assert.equal(filePath, virtualPackageJson);
        return JSON.stringify({ version: "0.0.0-test" });
      }
    });
    assert.equal(version, "0.0.0-test");
  });

  it("matches the real packages/cli package.json", async () => {
    const version = await resolveCliVersion();
    const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const expected = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version: string };
    assert.equal(version, expected.version);
  });

  it("fails with a clear error when package.json is unreadable", async () => {
    await assert.rejects(
      resolveCliVersion(virtualModuleUrl, {
        readFileImpl: async () => {
          throw new Error("ENOENT");
        }
      }),
      /Unable to read CLI package version/
    );
  });

  it("fails when the version field is missing", async () => {
    await assert.rejects(
      resolveCliVersion(virtualModuleUrl, {
        readFileImpl: async () => JSON.stringify({ name: "forgebadger" })
      }),
      /Missing version field/
    );
  });
});

describe("runCli version routing", () => {
  it("routes --version to the injected runner", async () => {
    let called = false;
    const code = await runCli(["--version"], {
      versionRunner: async () => {
        called = true;
        return 0;
      }
    });
    assert.equal(code, 0);
    assert.equal(called, true);
  });
});
