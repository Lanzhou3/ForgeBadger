import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkCommand,
  checkGateADependencies,
  checkOpenForgeDependencies,
  runCommand
} from "../src/lib/dependency-check.js";

describe("checkCommand", () => {
  it("reports an available command with version output", async () => {
    const result = await checkCommand("tmux", ["-V"], async () => ({
      exitCode: 0,
      stdout: "tmux 3.4\n",
      stderr: ""
    }));

    assert.deepEqual(result, {
      name: "tmux",
      available: true,
      version: "tmux 3.4"
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
    const result = await runCommand("sleep", ["10"], { timeoutMs: 1 });

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stderr, "Command timed out after 1ms");
  });

  it("bounds stdout and stderr to the configured maximum output bytes", async () => {
    const stdoutText = "o".repeat(128);
    const stderrText = "e".repeat(128);
    const result = await runCommand(
      "sh",
      [
        "-c",
        `printf '%s' '${stdoutText}'; printf '%s' '${stderrText}' >&2`
      ],
      { maxOutputBytes: 16 }
    );

    assert.equal(result.stdout, "o".repeat(16));
    assert.equal(result.stderr, "e".repeat(16));
  });
});

describe("checkGateADependencies", () => {
  it("checks tmux and claude commands", async () => {
    const seen: string[] = [];

    const result = await checkGateADependencies(async (command) => {
      seen.push(command);
      return {
        exitCode: 0,
        stdout: `${command} ok\n`,
        stderr: ""
      };
    });

    assert.deepEqual(seen, ["tmux", "claude"]);
    assert.equal(result.every((item) => item.available), true);
  });
});

describe("checkOpenForgeDependencies", () => {
  it("marks tmux required and AI CLIs optional", async () => {
    const result = await checkOpenForgeDependencies(async (command) => ({
      exitCode: command === "tmux" ? 0 : 127,
      stdout: command === "tmux" ? "tmux 3.4\n" : "",
      stderr: command === "tmux" ? "" : "not found"
    }));

    const tmux = result.find((item) => item.name === "tmux");
    const claude = result.find((item) => item.name === "claude");
    const opencode = result.find((item) => item.name === "opencode");
    const codex = result.find((item) => item.name === "codex");

    assert.equal(tmux?.required, true);
    assert.equal(tmux?.available, true);
    assert.equal(claude?.required, false);
    assert.equal(claude?.available, false);
    assert.equal(opencode?.required, false);
    assert.equal(codex?.required, false);
  });

  it("checks the OpenForge runtime command list in order", async () => {
    const seen: Array<{ command: string; args: string[] }> = [];

    await checkOpenForgeDependencies(async (command, args) => {
      seen.push({ command, args });
      return {
        exitCode: 0,
        stdout: `${command} ok\n`,
        stderr: ""
      };
    });

    assert.deepEqual(seen, [
      { command: "tmux", args: ["-V"] },
      { command: "claude", args: ["--version"] },
      { command: "opencode", args: ["--version"] },
      { command: "codex", args: ["--version"] }
    ]);
  });
});
