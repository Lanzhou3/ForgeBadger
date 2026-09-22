import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runUninstall } from "../src/commands/uninstall.js";
import { runCli } from "../src/index.js";
import type { RuntimeConfigInspection } from "../src/runtime/config.js";

function collectOutput(): { writer: { write(chunk: string): boolean }; text: () => string } {
  let buffer = "";
  return {
    writer: {
      write(chunk: string) {
        buffer += chunk;
        return true;
      }
    },
    text: () => buffer
  };
}

function initializedInspection(stateDir: string): RuntimeConfigInspection {
  return {
    stateDir,
    initialized: true,
    gateway: { host: "127.0.0.1", port: 48731 },
    web: { host: "127.0.0.1", port: 48732 }
  };
}

async function makeStateDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "forgebadger-uninstall-"));
  const stateDir = path.join(root, ".forgebadger");
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, "config.json"),
    JSON.stringify({
      version: 1,
      stateDir,
      dbPath: path.join(stateDir, "forgebadger.db"),
      gateway: { host: "127.0.0.1", port: 48731 },
      web: { host: "127.0.0.1", port: 48732 },
      secrets: { masterKey: "0".repeat(64), jwtSecret: "x".repeat(48) }
    })
  );
  return stateDir;
}

describe("runUninstall", () => {
  it("reports nothing to uninstall when state is absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-uninstall-"));
    const stateDir = path.join(root, ".forgebadger");
    const stdout = collectOutput();
    let removed = false;

    const code = await runUninstall({
      stateDir,
      env: {},
      inspectConfig: async () => ({ stateDir, initialized: false, gateway: { host: "127.0.0.1", port: 48731 }, web: { host: "127.0.0.1", port: 48732 } }),
      removeDir: async () => {
        removed = true;
      },
      stdout: stdout.writer
    });

    assert.equal(code, 0);
    assert.equal(removed, false);
    assert.match(stdout.text(), /nothing to uninstall/);
    assert.match(stdout.text(), /npm uninstall -g forgebadger/);
  });

  it("cancels without deleting when the user declines confirmation", async () => {
    const stateDir = await makeStateDir();
    const stdout = collectOutput();

    const code = await runUninstall({
      stateDir,
      env: {},
      isTTY: true,
      inspectConfig: async () => initializedInspection(stateDir),
      checkPort: async () => {},
      confirm: async () => false,
      stdout: stdout.writer
    });

    assert.equal(code, 0);
    assert.equal(existsSync(stateDir), true);
    assert.match(stdout.text(), /Uninstall cancelled/);
  });

  it("removes the state directory after confirmation", async () => {
    const stateDir = await makeStateDir();
    const stdout = collectOutput();

    const code = await runUninstall({
      stateDir,
      env: {},
      isTTY: true,
      inspectConfig: async () => initializedInspection(stateDir),
      checkPort: async () => {},
      confirm: async () => true,
      stdout: stdout.writer
    });

    assert.equal(code, 0);
    assert.equal(existsSync(stateDir), false);
    assert.match(stdout.text(), new RegExp(`State removed: ${stateDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(stdout.text(), /npm uninstall -g forgebadger/);
  });

  it("requires --yes in non-interactive mode", async () => {
    const stateDir = await makeStateDir();
    const stderr = collectOutput();

    const code = await runUninstall({
      stateDir,
      env: {},
      isTTY: false,
      inspectConfig: async () => initializedInspection(stateDir),
      checkPort: async () => {},
      stderr: stderr.writer
    });

    assert.equal(code, 1);
    assert.equal(existsSync(stateDir), true);
    assert.match(stderr.text(), /--yes/);
  });

  it("skips confirmation with --yes", async () => {
    const stateDir = await makeStateDir();

    const code = await runUninstall({
      stateDir,
      env: {},
      yes: true,
      isTTY: false,
      inspectConfig: async () => initializedInspection(stateDir),
      checkPort: async () => {},
      stdout: collectOutput().writer
    });

    assert.equal(code, 0);
    assert.equal(existsSync(stateDir), false);
  });

  it("refuses to uninstall while services appear to be running", async () => {
    const stateDir = await makeStateDir();
    const stderr = collectOutput();

    const code = await runUninstall({
      stateDir,
      env: {},
      yes: true,
      inspectConfig: async () => initializedInspection(stateDir),
      checkPort: async () => {
        throw new Error("Port 127.0.0.1:48731 is not available");
      },
      stderr: stderr.writer
    });

    assert.equal(code, 1);
    assert.equal(existsSync(stateDir), true);
    assert.match(stderr.text(), /appears to be running/);
  });

  it("--force skips the running-services and marker checks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-uninstall-"));
    const stateDir = path.join(root, ".forgebadger");
    await mkdir(stateDir, { recursive: true });
    let portChecked = false;

    const code = await runUninstall({
      stateDir,
      env: {},
      yes: true,
      force: true,
      inspectConfig: async () => ({ stateDir, initialized: false, gateway: { host: "127.0.0.1", port: 48731 }, web: { host: "127.0.0.1", port: 48732 } }),
      checkPort: async () => {
        portChecked = true;
      },
      stdout: collectOutput().writer
    });

    assert.equal(code, 0);
    assert.equal(portChecked, false);
    assert.equal(existsSync(stateDir), false);
  });

  it("refuses to remove the home directory", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "forgebadger-uninstall-home-"));
    const stderr = collectOutput();

    const code = await runUninstall({
      stateDir: homeDir,
      env: {},
      homeDir,
      yes: true,
      force: true,
      inspectConfig: async () => initializedInspection(homeDir),
      stderr: stderr.writer
    });

    assert.equal(code, 1);
    assert.equal(existsSync(homeDir), true);
    assert.match(stderr.text(), /Refusing to remove the home directory/);
  });

  it("refuses to remove a directory without ForgeBadger state markers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-uninstall-"));
    const stateDir = path.join(root, "unrelated");
    await mkdir(stateDir);
    const stderr = collectOutput();

    const code = await runUninstall({
      stateDir,
      env: {},
      yes: true,
      inspectConfig: async () => ({ stateDir, initialized: false, gateway: { host: "127.0.0.1", port: 48731 }, web: { host: "127.0.0.1", port: 48732 } }),
      checkPort: async () => {},
      stderr: stderr.writer
    });

    assert.equal(code, 1);
    assert.equal(existsSync(stateDir), true);
    assert.match(stderr.text(), /no config\.json or forgebadger\.db/);
  });

  it("runs the backup before removing state when --backup is set", async () => {
    const stateDir = await makeStateDir();
    const order: string[] = [];

    const code = await runUninstall({
      stateDir,
      env: {},
      yes: true,
      backup: path.join(tmpdir(), "forgebadger-uninstall-backup"),
      inspectConfig: async () => initializedInspection(stateDir),
      checkPort: async () => {},
      backupRunner: async () => {
        order.push("backup");
        return { output: "unused" };
      },
      removeDir: async () => {
        order.push("remove");
      },
      stdout: collectOutput().writer
    });

    assert.equal(code, 0);
    assert.deepEqual(order, ["backup", "remove"]);
  });

  it("reports a friendly error when files are in use", async () => {
    const stateDir = await makeStateDir();
    const stderr = collectOutput();

    const code = await runUninstall({
      stateDir,
      env: {},
      yes: true,
      inspectConfig: async () => initializedInspection(stateDir),
      checkPort: async () => {},
      removeDir: async () => {
        const error = new Error("busy") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      },
      stderr: stderr.writer
    });

    assert.equal(code, 1);
    assert.match(stderr.text(), /files are in use/);
  });
});

describe("runCli uninstall routing", () => {
  it("routes uninstall to the injected runner", async () => {
    const seen: unknown[] = [];
    const code = await runCli(["uninstall", "--yes"], {
      uninstallRunner: async (command) => {
        seen.push(command);
        return 0;
      }
    });
    assert.equal(code, 0);
    assert.deepEqual(seen, [{ command: "uninstall", yes: true, force: false, backup: undefined }]);
  });
});
