import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ZodError } from "zod";

import { loadOrCreateRuntimeConfig } from "../src/runtime/config.js";

describe("loadOrCreateRuntimeConfig", () => {
  it("creates a config with version 1, defaults, secure secrets, and file permissions", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "openforge-runtime-"));

    // Act
    const config = await loadOrCreateRuntimeConfig({ stateDir });

    // Assert
    assert.equal(config.version, 1);
    assert.equal(config.stateDir, path.resolve(stateDir));
    assert.equal(config.dbPath, path.join(path.resolve(stateDir), "openforge.db"));
    assert.deepEqual(config.gateway, { host: "127.0.0.1", port: 48731 });
    assert.deepEqual(config.web, { host: "127.0.0.1", port: 48732 });
    assert.match(config.secrets.masterKey, /^[a-f0-9]{64}$/);
    assert.ok(config.secrets.jwtSecret.length >= 32);

    const file = path.join(stateDir, "config.json");
    const mode = (await stat(file)).mode & 0o777;
    assert.equal(mode, 0o600);

    const stored = JSON.parse(await readFile(file, "utf8")) as { secrets: { masterKey: string } };
    assert.equal(stored.secrets.masterKey, config.secrets.masterKey);
  });

  it("preserves existing secrets on repeated loads", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "openforge-runtime-"));

    // Act
    const first = await loadOrCreateRuntimeConfig({ stateDir });
    const second = await loadOrCreateRuntimeConfig({ stateDir });

    // Assert
    assert.equal(second.secrets.masterKey, first.secrets.masterKey);
    assert.equal(second.secrets.jwtSecret, first.secrets.jwtSecret);
  });

  it("converges existing config file permissions to 0600", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "openforge-runtime-"));
    const file = path.join(stateDir, "config.json");
    await writeFile(file, `${JSON.stringify(createStoredConfig(stateDir))}\n`, { mode: 0o644 });
    await chmod(file, 0o644);

    // Act
    await loadOrCreateRuntimeConfig({ stateDir });

    // Assert
    const mode = (await stat(file)).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it("rejects symlink config files", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "openforge-runtime-"));
    const target = path.join(stateDir, "target-config.json");
    await writeFile(target, `${JSON.stringify(createStoredConfig(stateDir))}\n`, { mode: 0o600 });
    await symlink(target, path.join(stateDir, "config.json"));

    // Act / Assert
    await assert.rejects(() => loadOrCreateRuntimeConfig({ stateDir }), /regular file/);
  });

  it("applies non-persistent runtime overrides", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "openforge-runtime-"));
    await loadOrCreateRuntimeConfig({ stateDir });

    // Act
    const overridden = await loadOrCreateRuntimeConfig({
      stateDir,
      gatewayPort: 49931,
      webPort: 49932,
      host: "0.0.0.0"
    });
    const reloaded = await loadOrCreateRuntimeConfig({ stateDir });

    // Assert
    assert.deepEqual(overridden.gateway, { host: "0.0.0.0", port: 49931 });
    assert.deepEqual(overridden.web, { host: "0.0.0.0", port: 49932 });
    assert.deepEqual(reloaded.gateway, { host: "127.0.0.1", port: 48731 });
    assert.deepEqual(reloaded.web, { host: "127.0.0.1", port: 48732 });
  });

  it("rejects invalid runtime override ports with a zod error", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "openforge-runtime-"));
    await loadOrCreateRuntimeConfig({ stateDir });

    // Act / Assert
    await assert.rejects(() => loadOrCreateRuntimeConfig({ stateDir, gatewayPort: 0 }), ZodError);
  });

  it("expands leading tilde state directories to the home directory", async (t) => {
    // Arrange
    const relativeHomePath = `.codex/memories/openforge-runtime-${process.pid}-${Date.now()}`;
    const expandedPath = path.join(homedir(), relativeHomePath);
    t.after(() => rm(expandedPath, { recursive: true, force: true }));

    // Act
    const config = await loadOrCreateRuntimeConfig({ stateDir: `~/${relativeHomePath}` });

    // Assert
    assert.equal(config.stateDir, expandedPath);
    assert.ok(config.stateDir.startsWith(homedir()));
  });

  it("rejects malformed existing config with a zod error", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "openforge-runtime-"));
    const file = path.join(stateDir, "config.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        stateDir,
        dbPath: path.join(stateDir, "openforge.db"),
        gateway: { host: "127.0.0.1", port: 48731 },
        web: { host: "127.0.0.1", port: 48732 },
        secrets: { masterKey: "not-hex", jwtSecret: "abcdefghijklmnopqrstuvwxyz123456" }
      }),
      { mode: 0o600 }
    );
    await chmod(file, 0o600);

    // Act / Assert
    await assert.rejects(() => loadOrCreateRuntimeConfig({ stateDir }), ZodError);
  });
});

function createStoredConfig(stateDir: string) {
  return {
    version: 1,
    stateDir,
    dbPath: path.join(stateDir, "openforge.db"),
    gateway: { host: "127.0.0.1", port: 48731 },
    web: { host: "127.0.0.1", port: 48732 },
    secrets: {
      masterKey: "a".repeat(64),
      jwtSecret: "abcdefghijklmnopqrstuvwxyz123456"
    }
  };
}
