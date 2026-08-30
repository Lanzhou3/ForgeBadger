import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildNpmInstallArgs, runCommand } from "./smoke-npm-package-runner.mjs";

describe("npm package smoke command runner", () => {
  it("omits peer dependency resolution during tarball install", () => {
    const args = buildNpmInstallArgs({
      npmPrefix: "/tmp/forgebadger-prefix",
      npmCache: "/tmp/forgebadger-cache",
      tarball: "/tmp/forgebadger-0.1.0.tgz"
    });

    assert.deepEqual(args, [
      "install",
      "--prefix",
      "/tmp/forgebadger-prefix",
      "--cache",
      "/tmp/forgebadger-cache",
      "--ignore-scripts=false",
      "--omit=peer",
      "--legacy-peer-deps",
      "--fetch-retries=5",
      "--fetch-retry-factor=2",
      "--fetch-retry-mintimeout=2000",
      "--fetch-retry-maxtimeout=60000",
      "--fetch-timeout=120000",
      "--no-audit",
      "--no-fund",
      "/tmp/forgebadger-0.1.0.tgz"
    ]);
  });

  it("fails bounded commands with timeout diagnostics", () => {
    assert.throws(
      () => runCommand(
        process.execPath,
        ["-e", "setTimeout(() => {}, 10_000)"],
        {
          label: "install packed tarball",
          timeoutMs: 50,
          stderrWriter: () => {}
        }
      ),
      (error) => {
        assert.match(error.message, /install packed tarball/);
        assert.match(error.message, /timed out after 50ms/);
        assert.match(error.message, /Command failed:/);
        return true;
      }
    );
  });
});
