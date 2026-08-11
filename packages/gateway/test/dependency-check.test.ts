import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkCommand,
  checkGateADependencies,
  checkOpenForgeDependencies,
  checkOpenForgeRuntimeDependencies,
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
    const result = await runCommand(
      "awk",
      [
        "-v",
        `stdoutText=${stdoutText}`,
        "-v",
        `stderrText=${stderrText}`,
        "BEGIN { printf \"%s\", stdoutText; printf \"%s\", stderrText > \"/dev/stderr\" }",
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
    const kimi = result.find((item) => item.name === "kimi");
    assert.equal(kimi?.required, false);
    assert.equal(kimi?.available, false);
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
      { command: "codex", args: ["--version"] },
      { command: "kimi", args: ["--version"] }
    ]);
  });
});

describe("checkOpenForgeRuntimeDependencies", () => {
  it("reports native tmux terminal support on Unix-like systems when tmux is available", async () => {
    const result = await checkOpenForgeRuntimeDependencies(
      async (command) => ({
        exitCode: command === "tmux" ? 0 : 127,
        stdout: command === "tmux" ? "tmux 3.4\n" : "",
        stderr: command === "tmux" ? "" : "not found"
      }),
      "linux"
    );

    assert.deepEqual(result.terminalRuntime, {
      persistence: "tmux",
      mode: "native_tmux",
      supported: true,
      message: "tmux is available for persistent browser terminals."
    });
  });

  it("reports WSL guidance instead of native tmux support on Windows", async () => {
    const result = await checkOpenForgeRuntimeDependencies(
      async () => ({
        exitCode: 127,
        stdout: "",
        stderr: "not found"
      }),
      "win32"
    );

    assert.deepEqual(result.terminalRuntime, {
      persistence: "tmux",
      mode: "wsl_required",
      supported: false,
      message: "Native Windows terminals require WSL because OpenForge persists sessions with tmux."
    });
  });

  it("reports missing tmux when the host platform supports native terminal sessions but tmux is absent", async () => {
    const result = await checkOpenForgeRuntimeDependencies(
      async () => ({
        exitCode: 127,
        stdout: "",
        stderr: "not found"
      }),
      "darwin"
    );

    assert.deepEqual(result.terminalRuntime, {
      persistence: "tmux",
      mode: "tmux_missing",
      supported: false,
      message: "Install tmux to enable persistent browser terminals."
    });
  });
});
