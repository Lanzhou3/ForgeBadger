import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkCommand,
  checkGateADependencies,
  checkForgeBadgerDependencies,
  checkForgeBadgerRuntimeDependencies,
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

describe("checkForgeBadgerDependencies", () => {
  it("marks tmux required and AI CLIs optional", async () => {
    const result = await checkForgeBadgerDependencies(async (command) => ({
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

  it("checks the ForgeBadger runtime command list in order", async () => {
    const seen: Array<{ command: string; args: string[] }> = [];

    await checkForgeBadgerDependencies(async (command, args) => {
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

  it("checks psmux instead of tmux on native Windows", async () => {
    const seen: Array<{ command: string; args: string[] }> = [];

    await checkForgeBadgerDependencies(async (command, args) => {
      seen.push({ command, args });
      return { exitCode: 0, stdout: `${command} ok\n`, stderr: "" };
    }, "win32");

    assert.deepEqual(seen[0], { command: "psmux", args: ["-V"] });
    assert.equal(seen.some(({ command }) => command === "tmux"), false);
  });
});

describe("checkForgeBadgerRuntimeDependencies", () => {
  it("reports native tmux terminal support on Unix-like systems when tmux is available", async () => {
    const result = await checkForgeBadgerRuntimeDependencies(
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

  it("reports native psmux terminal support on Windows when psmux is available", async () => {
    const result = await checkForgeBadgerRuntimeDependencies(
      async (command) => ({
        exitCode: command === "psmux" ? 0 : 127,
        stdout: command === "psmux" ? "psmux 3.3.8\n" : "",
        stderr: command === "psmux" ? "" : "not found"
      }),
      "win32"
    );

    assert.deepEqual(result.terminalRuntime, {
      persistence: "psmux",
      mode: "native_psmux",
      supported: true,
      message: "psmux is available for persistent browser terminals."
    });
  });

  for (const versionOutput of ["psmux 3.3.7\n", "tmux 3.3.7\n"]) {
    it(`rejects vulnerable psmux output ${versionOutput.trim()}`, async () => {
      const result = await checkForgeBadgerRuntimeDependencies(
        async (command) => ({
          exitCode: command === "psmux" ? 0 : 127,
          stdout: command === "psmux" ? versionOutput : "",
          stderr: command === "psmux" ? "" : "not found"
        }),
        "win32"
      );

      assert.deepEqual(result.terminalRuntime, {
        persistence: "psmux",
        mode: "psmux_outdated",
        supported: false,
        message: "Upgrade psmux to version 3.3.8 or newer for persistent browser terminals."
      });
    });
  }

  it("accepts the fixed psmux version when its real version string uses the tmux product name", async () => {
    const result = await checkForgeBadgerRuntimeDependencies(
      async (command) => ({
        exitCode: command === "psmux" ? 0 : 127,
        stdout: command === "psmux" ? "tmux 3.3.8\n" : "",
        stderr: command === "psmux" ? "" : "not found"
      }),
      "win32"
    );

    assert.equal(result.terminalRuntime.mode, "native_psmux");
    assert.equal(result.terminalRuntime.supported, true);
  });

  it("reports psmux_missing on Windows when psmux is absent", async () => {
    const result = await checkForgeBadgerRuntimeDependencies(
      async () => ({ exitCode: 127, stdout: "", stderr: "not found" }),
      "win32"
    );

    assert.deepEqual(result.terminalRuntime, {
      persistence: "psmux",
      mode: "psmux_missing",
      supported: false,
      message: "Install psmux to enable persistent browser terminals."
    });
  });

  it("reports missing tmux when the host platform supports native terminal sessions but tmux is absent", async () => {
    const result = await checkForgeBadgerRuntimeDependencies(
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
