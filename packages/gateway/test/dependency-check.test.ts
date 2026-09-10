import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkCommand,
  checkForgeBadgerDependencies,
  checkForgeBadgerRuntimeDependencies,
  runCommand
} from "../src/lib/dependency-check.js";

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
