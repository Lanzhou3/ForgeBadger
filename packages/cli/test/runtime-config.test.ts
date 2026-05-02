import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
