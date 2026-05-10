import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { runDoctor } from "../src/commands/doctor.js";
import { isMainModule, runCli } from "../src/index.js";
import {
  checkCliDependencies,
  checkCliTerminalRuntime,
  describeCliTerminalRuntime,
  runCommand
} from "../src/runtime/dependency-check.js";
import type { RuntimeConfig } from "../src/runtime/config.js";

describe("checkCliDependencies", () => {
  it("reports required and optional dependency statuses from the command list", async () => {
    const seen: Array<{ command: string; args: string[] }> = [];

    const result = await checkCliDependencies(async (command, args) => {
      seen.push({ command, args });
      return {
        exitCode: command === "tmux" ? 0 : 127,
        stdout: command === "tmux" ? "tmux 3.4\n" : "",
        stderr: command === "tmux" ? "" : "not found"
      };
    });

    assert.deepEqual(seen, [
      { command: "tmux", args: ["-V"] },
      { command: "claude", args: ["--version"] },
      { command: "opencode", args: ["--version"] },
      { command: "codex", args: ["--version"] }
    ]);
    assert.deepEqual(
      result.map((item) => ({
        name: item.name,
        available: item.available,
        required: item.required,
        version: item.version,
        error: item.error
      })),
      [
        { name: "tmux", available: true, required: true, version: "tmux 3.4", error: undefined },
        { name: "claude", available: false, required: false, version: undefined, error: "not found" },
        { name: "opencode", available: false, required: false, version: undefined, error: "not found" },
        { name: "codex", available: false, required: false, version: undefined, error: "not found" }
      ]
    );
  });
});

describe("describeCliTerminalRuntime", () => {
  it("explains that native Windows needs WSL for tmux-backed terminals", () => {
    const runtime = describeCliTerminalRuntime([
      { name: "tmux", available: true, required: true, version: "tmux 3.4" }
    ], "win32");

    assert.deepEqual(runtime, {
      persistence: "tmux",
      mode: "wsl_required",
      supported: false,
      message: "Native Windows terminals require WSL because OpenForge persists sessions with tmux."
    });
  });

  it("reports tmux_missing when Unix-like hosts do not have tmux", () => {
    const runtime = describeCliTerminalRuntime([
      { name: "tmux", available: false, required: true, error: "not found" }
    ], "linux");

    assert.deepEqual(runtime, {
      persistence: "tmux",
      mode: "tmux_missing",
      supported: false,
      message: "Install tmux to enable persistent browser terminals."
    });
  });
});

describe("checkCliTerminalRuntime", () => {
  it("checks only tmux for Unix-like terminal runtime startup warnings", async () => {
    const seen: Array<{ command: string; args: string[] }> = [];

    const runtime = await checkCliTerminalRuntime({
      platform: "linux",
      runner: async (command, args) => {
        seen.push({ command, args });
        return { exitCode: 0, stdout: "tmux 3.4\n", stderr: "" };
      }
    });

    assert.deepEqual(seen, [{ command: "tmux", args: ["-V"] }]);
    assert.equal(runtime.mode, "native_tmux");
    assert.equal(runtime.supported, true);
  });

  it("does not shell out before reporting native Windows WSL guidance", async () => {
    let called = false;

    const runtime = await checkCliTerminalRuntime({
      platform: "win32",
      runner: async () => {
        called = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });

    assert.equal(called, false);
    assert.equal(runtime.mode, "wsl_required");
    assert.equal(runtime.supported, false);
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

describe("runDoctor", () => {
  it("returns 0 and prints dependency status when required dependencies are available", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runDoctor({
      loadConfig: async () => createRuntimeConfig("/tmp/openforge-state"),
      dependencyRunner: async (command) => {
        if (command === "tmux") {
          return { exitCode: 0, stdout: "tmux 3.4\n", stderr: "" };
        }
        if (command === "claude") {
          return { exitCode: 0, stdout: "claude 1.2.3\n", stderr: "" };
        }
        return { exitCode: 127, stdout: "", stderr: "not found" };
      },
      stdout,
      stderr
    });

    assert.equal(code, 0);
    assert.match(stdout.text, /OpenForge state: \/tmp\/openforge-state\n/);
    assert.match(stdout.text, /ok tmux tmux 3\.4\n/);
    assert.match(stdout.text, /ok claude claude 1\.2\.3\n/);
    assert.match(stdout.text, /optional-missing opencode - not found\n/);
    assert.match(stdout.text, /terminal native_tmux - tmux is available for persistent browser terminals\.\n/);
    assert.equal(stderr.text, "");
  });

  it("returns 1 and prints stderr when a required dependency is missing", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runDoctor({
      loadConfig: async () => createRuntimeConfig("/tmp/openforge-state"),
      dependencyRunner: async (command) => ({
        exitCode: command === "tmux" ? 127 : 0,
        stdout: command === "tmux" ? "" : `${command} ok\n`,
        stderr: command === "tmux" ? "tmux not found" : ""
      }),
      stdout,
      stderr
    });

    assert.equal(code, 1);
    assert.match(stdout.text, /missing tmux - tmux not found\n/);
    assert.match(stdout.text, /terminal tmux_missing - Install tmux to enable persistent browser terminals\.\n/);
    assert.match(stderr.text, /Required dependencies are missing/);
  });

  it("prints native Windows WSL terminal guidance", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runDoctor({
      loadConfig: async () => createRuntimeConfig("/tmp/openforge-state"),
      dependencyRunner: async (command) => ({
        exitCode: 0,
        stdout: `${command} ok\n`,
        stderr: ""
      }),
      platform: "win32",
      stdout,
      stderr
    });

    assert.equal(code, 0);
    assert.match(stdout.text, /terminal wsl_required - Native Windows terminals require WSL/);
    assert.equal(stderr.text, "");
  });
});

describe("runCli", () => {
  it("dispatches doctor through an injectable runner", async () => {
    const code = await runCli(["doctor"], {
      doctorRunner: async () => 7
    });

    assert.equal(code, 7);
  });
});

describe("isMainModule", () => {
  it("treats a symlinked npm bin path as the main module", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openforge-main-"));
    const targetPath = path.join(tempDir, "index.js");
    const binPath = path.join(tempDir, "openforge");
    await writeFile(targetPath, "", "utf8");
    await symlink(targetPath, binPath);

    assert.equal(isMainModule(binPath, pathToFileURL(targetPath).href), true);
  });
});

function createRuntimeConfig(stateDir: string): RuntimeConfig {
  return {
    version: 1,
    stateDir,
    dbPath: `${stateDir}/openforge.db`,
    gateway: { host: "127.0.0.1", port: 48731 },
    web: { host: "127.0.0.1", port: 48732 },
    secrets: {
      masterKey: "a".repeat(64),
      jwtSecret: "abcdefghijklmnopqrstuvwxyz123456"
    }
  };
}

function createMemoryWriter() {
  return {
    text: "",
    write(chunk: string) {
      this.text += chunk;
    }
  };
}
