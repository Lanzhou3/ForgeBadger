import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkCommand,
  checkForgeBadgerDependencies,
  checkForgeBadgerRuntimeDependencies,
  runCommand
} from "../src/lib/dependency-check.js";
import type { CommandRunner } from "../src/lib/dependency-check.js";

describe("checkCommand", () => {
  it("reports an available command with version output", async () => {
    const result = await checkCommand("claude", ["--version"], async () => ({
      exitCode: 0,
      stdout: "claude 1.0\n",
      stderr: ""
    }));

    assert.deepEqual(result, {
      name: "claude",
      available: true,
      version: "claude 1.0"
    });
  });

  it("reports an unavailable command with stderr context", async () => {
    const result = await checkCommand("claude", ["--version"], async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "command not found"
    }));

    assert.equal(result.name, "claude");
    assert.equal(result.available, false);
    assert.equal(result.error, "command not found");
  });
});

describe("runCommand", () => {
  it("returns a timeout error when the child process exceeds the configured timeout", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000);"],
      { timeoutMs: 25 }
    );

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stderr, "Command timed out after 25ms");
  });

  it("kills a timed out child that ignores SIGTERM after the configured grace period", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      { timeoutMs: 25, killGraceMs: 50 }
    );

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stderr, "Command timed out after 25ms");
  });

  it("bounds stdout and stderr to the configured maximum output bytes", async () => {
    const stdoutText = "o".repeat(128);
    const stderrText = "e".repeat(128);
    const script = `process.stdout.write(${JSON.stringify(stdoutText)}); process.stderr.write(${JSON.stringify(stderrText)})`;
    const result = await runCommand(
      process.execPath,
      ["-e", script],
      { maxOutputBytes: 16 }
    );

    assert.equal(result.stdout, "o".repeat(16));
    assert.equal(result.stderr, "e".repeat(16));
  });
});

describe("Session Server runtime dependencies", () => {
  it("only probes optional AI CLI commands, never external multiplexers", async () => {
    const seen: string[] = [];
    const result = await checkForgeBadgerDependencies(async (command) => {
      seen.push(command);
      return { exitCode: 127, stdout: "", stderr: "not found" };
    });
    assert.deepEqual(seen, ["claude", "opencode", "codex", "kimi"]);
    assert.ok(result.every((item) => !item.required && !item.available));
  });
  it("reports daemon availability independently of optional adapter binaries", async () => {
    const runner = async () => ({ exitCode: 127, stdout: "", stderr: "not found" });
    const ready = await checkForgeBadgerRuntimeDependencies(runner, { available: true });
    assert.equal(ready.terminalRuntime.persistence, "session-server");
    assert.equal(ready.terminalRuntime.mode, "ready");
    const down = await checkForgeBadgerRuntimeDependencies(runner, { available: false, message: "IPC unavailable" });
    assert.deepEqual(down.terminalRuntime, { persistence: "session-server", mode: "unavailable", supported: false, message: "IPC unavailable" });
  });
});

describe("checkCommand failure classification", () => {
  it("marks timeouts as checkFailed instead of missing", async () => {
    const result = await checkCommand("kimi", ["--version"], async () => ({
      exitCode: 124,
      stdout: "",
      stderr: "Command timed out after 10000ms"
    }));

    assert.equal(result.available, false);
    assert.equal(result.checkFailed, true);
  });

  it("marks command-not-found exits as missing", async () => {
    for (const exitCode of [127, 9009]) {
      const result = await checkCommand("kimi", ["--version"], async () => ({
        exitCode,
        stdout: "",
        stderr: "not found"
      }));

      assert.equal(result.available, false);
      assert.equal(result.checkFailed, undefined);
    }
  });

  it("marks non-zero version exits as checkFailed", async () => {
    const result = await checkCommand("kimi", ["--version"], async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "boom"
    }));

    assert.equal(result.available, false);
    assert.equal(result.checkFailed, true);
  });
});

describe("per-adapter probe timeouts", () => {
  it("forwards the configured timeout to the runner", async () => {
    const calls = new Map<string, number | undefined>();
    const runner: CommandRunner = async (command, _args, options) => {
      calls.set(command, options?.timeoutMs);
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await checkForgeBadgerDependencies(runner);

    assert.equal(calls.get("kimi"), 10_000);
    assert.equal(calls.get("claude"), undefined);
    assert.equal(calls.get("opencode"), undefined);
    assert.equal(calls.get("codex"), undefined);
  });
});
