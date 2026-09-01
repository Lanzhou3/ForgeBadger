import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
      { command: "codex", args: ["--version"] },
      { command: "kimi", args: ["--version"] }
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
        { name: "codex", available: false, required: false, version: undefined, error: "not found" },
        { name: "kimi", available: false, required: false, version: undefined, error: "not found" }
      ]
    );
  });

  it("checks psmux instead of tmux on native Windows", async () => {
    const seen: Array<{ command: string; args: string[] }> = [];

    await checkCliDependencies(async (command, args) => {
      seen.push({ command, args });
      return { exitCode: 0, stdout: `${command} ok\n`, stderr: "" };
    }, "win32");

    assert.deepEqual(seen[0], { command: "psmux", args: ["-V"] });
    assert.equal(seen.some(({ command }) => command === "tmux"), false);
  });
});

describe("describeCliTerminalRuntime", () => {
  it("reports native psmux support on Windows", () => {
    const runtime = describeCliTerminalRuntime([
      { name: "psmux", available: true, required: true, version: "psmux 3.3.8" }
    ], "win32");

    assert.deepEqual(runtime, {
      persistence: "psmux",
      mode: "native_psmux",
      supported: true,
      message: "psmux is available for persistent browser terminals."
    });
  });

  it("reports psmux_missing on Windows when psmux is absent", () => {
    const runtime = describeCliTerminalRuntime([
      { name: "psmux", available: false, required: true, error: "not found" }
    ], "win32");

    assert.deepEqual(runtime, {
      persistence: "psmux",
      mode: "psmux_missing",
      supported: false,
      message: "Install psmux to enable persistent browser terminals."
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

  it("checks only psmux for native Windows terminal runtime startup warnings", async () => {
    const seen: Array<{ command: string; args: string[] }> = [];

    const runtime = await checkCliTerminalRuntime({
      platform: "win32",
      runner: async (command, args) => {
        seen.push({ command, args });
        return { exitCode: 0, stdout: "psmux 3.3.8\n", stderr: "" };
      }
    });

    assert.deepEqual(seen, [{ command: "psmux", args: ["-V"] }]);
    assert.equal(runtime.mode, "native_psmux");
    assert.equal(runtime.supported, true);
  });

  it("rejects psmux 3.3.7 even when the executable reports itself as tmux", async () => {
    const runtime = await checkCliTerminalRuntime({
      platform: "win32",
      runner: async () => ({ exitCode: 0, stdout: "tmux 3.3.7\n", stderr: "" })
    });

    assert.deepEqual(runtime, {
      persistence: "psmux",
      mode: "psmux_outdated",
      supported: false,
      message: "Upgrade psmux to version 3.3.8 or newer for persistent browser terminals."
    });
  });

  it("accepts psmux 3.3.8 when the executable reports itself as tmux", async () => {
    const runtime = await checkCliTerminalRuntime({
      platform: "win32",
      runner: async () => ({ exitCode: 0, stdout: "tmux 3.3.8\n", stderr: "" })
    });

    assert.equal(runtime.mode, "native_psmux");
    assert.equal(runtime.supported, true);
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
  it("reports an uninitialized state directory without creating it or config.json", async () => {
    const parentDir = await mkdtemp(path.join(tmpdir(), "forgebadger-doctor-readonly-"));
    const stateDir = path.join(parentDir, "state-that-does-not-exist");
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runDoctor({
      env: { FORGEBADGER_STATE_DIR: stateDir },
      dependencyRunner: async (command) => ({
        exitCode: command === "tmux" ? 0 : 127,
        stdout: command === "tmux" ? "tmux 3.4\n" : "",
        stderr: command === "tmux" ? "" : "not found"
      }),
      stdout,
      stderr
    });

    assert.equal(code, 0);
    assert.match(stdout.text, new RegExp(`ForgeBadger state: ${escapeRegex(stateDir)} \\(not initialized\\)`));
    assert.match(stdout.text, /Diagnostic defaults: gateway=http:\/\/127\.0\.0\.1:48731 web=http:\/\/127\.0\.0\.1:48732/);
    assert.equal(existsSync(stateDir), false);
    assert.equal(existsSync(path.join(stateDir, "config.json")), false);
    assert.equal(stderr.text, "");
  });

  it("returns 0 and prints dependency status when required dependencies are available", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runDoctor({
      loadConfig: async () => createRuntimeConfig("/tmp/forgebadger-state"),
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
    assert.match(stdout.text, /ForgeBadger state: \/tmp\/forgebadger-state\n/);
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
      loadConfig: async () => createRuntimeConfig("/tmp/forgebadger-state"),
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

  it("checks and prints native Windows psmux terminal readiness", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runDoctor({
      loadConfig: async () => createRuntimeConfig("/tmp/forgebadger-state"),
      dependencyRunner: async (command) => ({
        exitCode: command === "psmux" || command !== "tmux" ? 0 : 127,
        stdout: command === "psmux" ? "psmux 3.3.8\n" : `${command} ok\n`,
        stderr: command === "tmux" ? "must not check tmux on Windows" : ""
      }),
      platform: "win32",
      stdout,
      stderr
    });

    assert.equal(code, 0);
    assert.match(stdout.text, /ok psmux psmux 3\.3\.8/);
    assert.match(stdout.text, /terminal native_psmux - psmux is available/);
    assert.doesNotMatch(stdout.text, /tmux/);
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
    const tempDir = await mkdtemp(path.join(tmpdir(), "forgebadger-main-"));
    const targetPath = path.join(tempDir, "index.js");
    const binPath = path.join(tempDir, "forgebadger");
    await writeFile(targetPath, "", "utf8");
    await symlink(targetPath, binPath);

    assert.equal(isMainModule(binPath, pathToFileURL(targetPath).href), true);
  });
});

function createRuntimeConfig(stateDir: string): RuntimeConfig {
  return {
    version: 1,
    stateDir,
    dbPath: `${stateDir}/forgebadger.db`,
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
