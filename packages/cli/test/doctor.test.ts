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
  collectEnvironmentInfo,
  commandSpawnOptions,
  checkBetterSqlite3Loadable,
  checkCliDependencies,
  checkNodePtyLoadable,
  isSupportedNodeVersion,
  runCommand
} from "../src/runtime/dependency-check.js";
import type { RuntimeConfig } from "../src/runtime/config.js";

describe("checkCliDependencies", () => {
  it("reports the native module self-checks and optional dependency statuses", async () => {
    const seen: Array<{ command: string; args: string[] }> = [];

    const result = await checkCliDependencies(
      async (command, args) => {
        seen.push({ command, args });
        return { exitCode: 127, stdout: "", stderr: "not found" };
      },
      async () => ({}),
      async () => ({})
    );

    assert.deepEqual(seen, [
      { command: "claude", args: ["--version"] },
      { command: "opencode", args: ["--version"] },
      { command: "codex", args: ["--version"] },
      { command: "kimi", args: ["--version"] },
      { command: "codegraph", args: ["--version"] },
      { command: "git", args: ["--version"] }
    ]);
    assert.deepEqual(
      result.map((item) => ({
        name: item.name,
        available: item.available,
        required: item.required,
        group: item.group,
        version: item.version,
        error: item.error
      })),
      [
        { name: "node-pty", available: true, required: true, group: "runtime", version: undefined, error: undefined },
        { name: "better-sqlite3", available: true, required: true, group: "runtime", version: undefined, error: undefined },
        { name: "claude", available: false, required: false, group: "ai-cli", version: undefined, error: "not found" },
        { name: "opencode", available: false, required: false, group: "ai-cli", version: undefined, error: "not found" },
        { name: "codex", available: false, required: false, group: "ai-cli", version: undefined, error: "not found" },
        { name: "kimi", available: false, required: false, group: "ai-cli", version: undefined, error: "not found" },
        { name: "codegraph", available: false, required: false, group: "tooling", version: undefined, error: "not found" },
        { name: "git", available: false, required: false, group: "tooling", version: undefined, error: "not found" }
      ]
    );
  });

  it("attaches the official install hint to missing optional dependencies", async () => {
    const result = await checkCliDependencies(
      async (command) => {
        if (command === "codegraph") {
          return { exitCode: 0, stdout: "codegraph 1.6.0\n", stderr: "" };
        }
        return { exitCode: 127, stdout: "", stderr: "not found" };
      },
      async () => ({}),
      async () => ({})
    );

    const claude = result.find((item) => item.name === "claude");
    const codegraph = result.find((item) => item.name === "codegraph");
    assert.equal(claude?.installHint, "npm install -g @anthropic-ai/claude-code");
    assert.equal(codegraph?.available, true);
    assert.equal(codegraph?.installHint, undefined);
  });
});

describe("checkBetterSqlite3Loadable", () => {
  it("reports better-sqlite3 as available when the binding opens an in-memory database", async () => {
    const status = await checkBetterSqlite3Loadable(async () => ({}));

    assert.deepEqual(status, { name: "better-sqlite3", available: true, required: true, group: "runtime" });
  });

  it("reports better-sqlite3 as missing with reinstall guidance when the binding is absent", async () => {
    const status = await checkBetterSqlite3Loadable(async () => {
      throw new Error("Could not locate the bindings file");
    });

    assert.equal(status.name, "better-sqlite3");
    assert.equal(status.available, false);
    assert.equal(status.required, true);
    assert.match(status.error ?? "", /better-sqlite3 failed to load/);
    assert.match(status.error ?? "", /Could not locate the bindings file/);
    assert.match(status.error ?? "", /npm install -g forgebadger/);
  });
});

describe("collectEnvironmentInfo", () => {
  it("reports the current platform, arch, and Node version", () => {
    const info = collectEnvironmentInfo({ platform: "darwin", arch: "arm64", nodeVersion: "v22.14.0" });

    assert.deepEqual(info, {
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "v22.14.0",
      supportedNode: true,
      notes: []
    });
  });

  it("flags unsupported Node versions", () => {
    const info = collectEnvironmentInfo({ platform: "linux", arch: "x64", nodeVersion: "v20.11.0" });

    assert.equal(info.supportedNode, false);
    assert.equal(info.notes.length, 1);
    assert.match(info.notes[0] ?? "", /outside the supported range \(>=20\.12 <25\)/);
  });

  it("adds a ConPTY note on Windows", () => {
    const info = collectEnvironmentInfo({ platform: "win32", arch: "x64", nodeVersion: "v22.14.0" });

    assert.equal(info.supportedNode, true);
    assert.equal(info.notes.length, 1);
    assert.match(info.notes[0] ?? "", /ConPTY/);
  });
});

describe("isSupportedNodeVersion", () => {
  it("accepts Node 20.12 through 24", () => {
    assert.equal(isSupportedNodeVersion("v20.12.0"), true);
    assert.equal(isSupportedNodeVersion("v24.14.1"), true);
  });

  it("rejects versions outside the supported range", () => {
    assert.equal(isSupportedNodeVersion("v20.11.0"), false);
    assert.equal(isSupportedNodeVersion("v19.9.0"), false);
    assert.equal(isSupportedNodeVersion("v25.0.0"), false);
    assert.equal(isSupportedNodeVersion("not-a-version"), false);
  });
});

describe("checkNodePtyLoadable", () => {
  it("reports node-pty as available when the module loads", async () => {
    const status = await checkNodePtyLoadable(async () => ({}));

    assert.deepEqual(status, { name: "node-pty", available: true, required: true, group: "runtime" });
  });

  it("reports node-pty as missing with reinstall guidance when loading fails", async () => {
    const status = await checkNodePtyLoadable(async () => {
      throw new Error("Cannot find module 'node-pty'");
    });

    assert.equal(status.name, "node-pty");
    assert.equal(status.available, false);
    assert.equal(status.required, true);
    assert.match(status.error ?? "", /node-pty failed to load/);
    assert.match(status.error ?? "", /Cannot find module 'node-pty'/);
    assert.match(status.error ?? "", /npm install -g forgebadger/);
  });
});

describe("runCommand", () => {
  it("uses the Windows command shell for npm-installed CLI shims", () => {
    assert.equal(commandSpawnOptions("win32").shell, true);
    assert.equal(commandSpawnOptions("darwin").shell, undefined);
  });

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
      dependencyRunner: async () => ({ exitCode: 127, stdout: "", stderr: "not found" }),
      loadNodePty: async () => ({}),
      loadBetterSqlite3: async () => ({}),
      stdout,
      stderr
    });

    assert.equal(code, 0);
    assert.match(stdout.text, /^Environment: \w+ \w+, Node v\d+\.\d+\.\d+\n/);
    assert.match(stdout.text, new RegExp(`ForgeBadger state: ${escapeRegex(stateDir)} \\(not initialized\\)`));
    assert.match(stdout.text, /Diagnostic defaults: gateway=http:\/\/127\.0\.0\.1:48731 web=http:\/\/127\.0\.0\.1:48732/);
    assert.match(stdout.text, /No supported AI CLI found on PATH; install at least one to create sessions:\n/);
    assert.match(stdout.text, / {2}claude: npm install -g @anthropic-ai\/claude-code\n/);
    assert.match(stdout.text, / {2}kimi: npm install -g @moonshot-ai\/kimi-code\n/);
    assert.equal(existsSync(stateDir), false);
    assert.equal(existsSync(path.join(stateDir, "config.json")), false);
    assert.equal(stderr.text, "");
  });

  it("returns 0 and prints dependency status when required dependencies are available", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runDoctor({
      loadConfig: async () => createRuntimeConfig("/tmp/forgebadger-state"),
      loadNodePty: async () => ({}),
      loadBetterSqlite3: async () => ({}),
      dependencyRunner: async (command) => {
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
    assert.match(stdout.text, /ok node-pty\n/);
    assert.match(stdout.text, /ok better-sqlite3\n/);
    assert.match(stdout.text, /ok claude claude 1\.2\.3\n/);
    assert.match(stdout.text, /optional-missing opencode - not found\n/);
    assert.match(stdout.text, / {2}install: npm install -g opencode-ai\n/);
    assert.match(stdout.text, /optional-missing codegraph - not found\n/);
    assert.match(stdout.text, / {2}install: npm install -g @colbymchenry\/codegraph\n/);
    assert.doesNotMatch(stdout.text, /No supported AI CLI found/);
    assert.equal(stderr.text, "");
  });

  it("returns 1 and prints stderr when node-pty cannot be loaded", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runDoctor({
      loadConfig: async () => createRuntimeConfig("/tmp/forgebadger-state"),
      loadNodePty: async () => {
        throw new Error("native binding missing");
      },
      loadBetterSqlite3: async () => ({}),
      dependencyRunner: async (command) => ({
        exitCode: 0,
        stdout: `${command} ok\n`,
        stderr: ""
      }),
      stdout,
      stderr
    });

    assert.equal(code, 1);
    assert.match(stdout.text, /missing node-pty - node-pty failed to load \(native binding missing\)/);
    assert.match(stdout.text, /npm install -g forgebadger/);
    assert.match(stderr.text, /Required dependencies are missing/);
  });

  it("returns 1 and prints stderr when the better-sqlite3 binding is missing", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runDoctor({
      loadConfig: async () => createRuntimeConfig("/tmp/forgebadger-state"),
      loadNodePty: async () => ({}),
      loadBetterSqlite3: async () => {
        throw new Error("Could not locate the bindings file");
      },
      dependencyRunner: async (command) => ({
        exitCode: 0,
        stdout: `${command} ok\n`,
        stderr: ""
      }),
      stdout,
      stderr
    });

    assert.equal(code, 1);
    assert.match(stdout.text, /missing better-sqlite3 - better-sqlite3 failed to load \(Could not locate the bindings file\)/);
    assert.match(stdout.text, /npm install -g forgebadger/);
    assert.match(stderr.text, /Required dependencies are missing/);
  });

  it("prints environment notes from the injected environment collector", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runDoctor({
      loadConfig: async () => createRuntimeConfig("/tmp/forgebadger-state"),
      loadNodePty: async () => ({}),
      loadBetterSqlite3: async () => ({}),
      collectEnvironment: () => ({
        platform: "win32",
        arch: "x64",
        nodeVersion: "v25.0.0",
        supportedNode: false,
        notes: [
          "Node v25.0.0 is outside the supported range (>=20.12 <25); upgrade Node.js before running ForgeBadger.",
          "Windows terminal sessions use ConPTY; WSL sessions are not managed by ForgeBadger."
        ]
      }),
      dependencyRunner: async (command) => ({
        exitCode: 0,
        stdout: `${command} ok\n`,
        stderr: ""
      }),
      stdout,
      stderr
    });

    assert.equal(code, 0);
    assert.match(stdout.text, /^Environment: win32 x64, Node v25\.0\.0\n/);
    assert.match(stdout.text, /note: Node v25\.0\.0 is outside the supported range/);
    assert.match(stdout.text, /note: Windows terminal sessions use ConPTY/);
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
