import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRegistrationPayload,
  buildNpmInstallArgs,
  resolveTerminalMultiplexerCommand,
  runCommand
} from "./smoke-npm-package-runner.mjs";

describe("npm package smoke command runner", () => {
  it("includes the local recovery key in first-account registration", () => {
    assert.deepEqual(
      buildRegistrationPayload("smoke@example.com", "secret", "fbr_recovery"),
      { email: "smoke@example.com", password: "secret", recoveryKey: "fbr_recovery" }
    );
  });

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

  it("runs command shims through the Windows command shell", () => {
    let observedOptions;
    runCommand("pnpm", ["--version"], {
      platform: "win32",
      printOutput: false,
      spawnSyncImpl: (_command, _args, options) => {
        observedOptions = options;
        return { status: 0, signal: null, error: undefined, stdout: "10.33.2\n", stderr: "" };
      }
    });

    assert.equal(observedOptions.shell, true);
    assert.equal(resolveTerminalMultiplexerCommand("win32"), "psmux");
    assert.equal(resolveTerminalMultiplexerCommand("darwin"), "tmux");
  });
});
