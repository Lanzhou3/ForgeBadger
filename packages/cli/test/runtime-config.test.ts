import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ZodError } from "zod";

import { loadOrCreateRuntimeConfig, resolveStateDir } from "../src/runtime/config.js";

describe("loadOrCreateRuntimeConfig", () => {
  it("creates a config with version 1, defaults, secure secrets, and file permissions", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));

    // Act
    const config = await loadOrCreateRuntimeConfig({ stateDir, env: {} });

    // Assert
    assert.equal(config.version, 1);
    assert.equal(config.stateDir, path.resolve(stateDir));
    assert.equal(config.dbPath, path.join(path.resolve(stateDir), "forgebadger.db"));
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
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));

    // Act
    const first = await loadOrCreateRuntimeConfig({ stateDir, env: {} });
    const second = await loadOrCreateRuntimeConfig({ stateDir, env: {} });

    // Assert
    assert.equal(second.secrets.masterKey, first.secrets.masterKey);
    assert.equal(second.secrets.jwtSecret, first.secrets.jwtSecret);
  });

  it("converges existing config file permissions to 0600", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));
    const file = path.join(stateDir, "config.json");
    await writeFile(file, `${JSON.stringify(createStoredConfig(stateDir))}\n`, { mode: 0o644 });
    await chmod(file, 0o644);

    // Act
    await loadOrCreateRuntimeConfig({ stateDir, env: {} });

    // Assert
    const mode = (await stat(file)).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it("rejects symlink config files", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));
    const target = path.join(stateDir, "target-config.json");
    await writeFile(target, `${JSON.stringify(createStoredConfig(stateDir))}\n`, { mode: 0o600 });
    await symlink(target, path.join(stateDir, "config.json"));

    // Act / Assert
    await assert.rejects(() => loadOrCreateRuntimeConfig({ stateDir, env: {} }), /regular file/);
  });

  it("applies non-persistent runtime overrides", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));
    await loadOrCreateRuntimeConfig({ stateDir, env: {} });

    // Act
    const overridden = await loadOrCreateRuntimeConfig({
      stateDir,
      gatewayPort: 49931,
      webPort: 49932,
      host: "0.0.0.0",
      env: {}
    });
    const reloaded = await loadOrCreateRuntimeConfig({ stateDir, env: {} });

    // Assert
    assert.deepEqual(overridden.gateway, { host: "0.0.0.0", port: 49931 });
    assert.deepEqual(overridden.web, { host: "0.0.0.0", port: 49932 });
    assert.deepEqual(reloaded.gateway, { host: "127.0.0.1", port: 48731 });
    assert.deepEqual(reloaded.web, { host: "127.0.0.1", port: 48732 });
  });

  it("applies ForgeBadger environment overrides without persisting them", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));
    await loadOrCreateRuntimeConfig({ stateDir, env: {} });

    const overridden = await loadOrCreateRuntimeConfig({
      stateDir,
      env: {
        FORGEBADGER_HOST: "0.0.0.0",
        FORGEBADGER_PORT: "49931",
        FORGEBADGER_WEB_HOST: "127.0.0.2",
        FORGEBADGER_WEB_PORT: "49932",
        FORGEBADGER_DB_PATH: "~/forgebadger-env/override.db"
      },
      homeDir: stateDir
    });
    const reloaded = await loadOrCreateRuntimeConfig({ stateDir, env: {} });

    assert.deepEqual(overridden.gateway, { host: "0.0.0.0", port: 49931 });
    assert.deepEqual(overridden.web, { host: "127.0.0.2", port: 49932 });
    assert.equal(overridden.dbPath, path.join(stateDir, "forgebadger-env", "override.db"));
    assert.deepEqual(reloaded.gateway, { host: "127.0.0.1", port: 48731 });
    assert.deepEqual(reloaded.web, { host: "127.0.0.1", port: 48732 });
    assert.equal(reloaded.dbPath, path.join(path.resolve(stateDir), "forgebadger.db"));
  });

  it("lets explicit CLI options take precedence over environment overrides", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));

    const config = await loadOrCreateRuntimeConfig({
      stateDir,
      gatewayPort: 50931,
      webPort: 50932,
      host: "::1",
      env: {
        FORGEBADGER_HOST: "0.0.0.0",
        FORGEBADGER_PORT: "49931",
        FORGEBADGER_WEB_HOST: "127.0.0.2",
        FORGEBADGER_WEB_PORT: "49932"
      }
    });

    assert.deepEqual(config.gateway, { host: "::1", port: 50931 });
    assert.deepEqual(config.web, { host: "::1", port: 50932 });
  });

  it("rejects invalid environment ports", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));

    await assert.rejects(
      () => loadOrCreateRuntimeConfig({ stateDir, env: { FORGEBADGER_PORT: "not-a-port" } }),
      /FORGEBADGER_PORT/
    );
  });

  it("rejects invalid runtime override ports with a zod error", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));
    await loadOrCreateRuntimeConfig({ stateDir, env: {} });

    // Act / Assert
    await assert.rejects(
      () => loadOrCreateRuntimeConfig({ stateDir, gatewayPort: 0, env: {} }),
      ZodError
    );
  });

  it("rejects malformed existing config with a zod error", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));
    const file = path.join(stateDir, "config.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        stateDir,
        dbPath: path.join(stateDir, "forgebadger.db"),
        gateway: { host: "127.0.0.1", port: 48731 },
        web: { host: "127.0.0.1", port: 48732 },
        secrets: { masterKey: "not-hex", jwtSecret: "abcdefghijklmnopqrstuvwxyz123456" }
      }),
      { mode: 0o600 }
    );
    await chmod(file, 0o600);

    // Act / Assert
    await assert.rejects(() => loadOrCreateRuntimeConfig({ stateDir, env: {} }), ZodError);
  });

  it("reports invalid JSON in an existing config with a readable error", async () => {
    // Arrange
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-runtime-"));
    const file = path.join(stateDir, "config.json");
    await writeFile(file, "{not-json", { mode: 0o600 });
    await chmod(file, 0o600);

    // Act / Assert
    await assert.rejects(
      () => loadOrCreateRuntimeConfig({ stateDir, env: {} }),
      /Invalid ForgeBadger runtime config JSON/
    );
  });
});

describe("resolveStateDir", () => {
  it("uses the ForgeBadger state directory even when an old directory exists", async () => {
    const fakeHome = await mkdtemp(path.join(tmpdir(), "forgebadger-home-"));
    const currentDir = path.join(fakeHome, ".forgebadger");
    await mkdir(path.join(fakeHome, ".old-product-state"));

    assert.equal(resolveStateDir(undefined, fakeHome, {}), currentDir);
  });

  it("expands leading tilde state directories with a supplied home directory", () => {
    // Arrange
    const fakeHome = path.join(tmpdir(), "forgebadger-fake-home");

    // Act
    const stateDir = resolveStateDir("~/forgebadger-test", fakeHome);

    // Assert
    assert.equal(stateDir, path.join(fakeHome, "forgebadger-test"));
  });

  it("expands Windows-style leading tilde state directories", () => {
    const fakeHome = path.join(tmpdir(), "forgebadger-fake-home");

    const stateDir = resolveStateDir("~\\forgebadger-test", fakeHome);

    assert.equal(stateDir, path.join(fakeHome, "forgebadger-test"));
  });
});

function createStoredConfig(stateDir: string) {
  return {
    version: 1,
    stateDir,
    dbPath: path.join(stateDir, "forgebadger.db"),
    gateway: { host: "127.0.0.1", port: 48731 },
    web: { host: "127.0.0.1", port: 48732 },
    secrets: {
      masterKey: "a".repeat(64),
      jwtSecret: "abcdefghijklmnopqrstuvwxyz123456"
    }
  };
}
