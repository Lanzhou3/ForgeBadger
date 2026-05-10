import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { assertSafeRuntimeWebDir, prepareWebRuntime, writeWebRuntimeConfig } from "../src/runtime/web-runtime.js";

describe("prepareWebRuntime", () => {
  it("rejects runtime Web directories outside a state-owned runtime/web path", () => {
    assert.throws(
      () => assertSafeRuntimeWebDir(path.join(path.parse(process.cwd()).root, "runtime", "web")),
      /unsafe runtime Web directory/
    );
  });

  it("copies the installed Web artifact into a safe runtime directory", async () => {
    // Arrange
    const root = await mkdtemp(path.join(tmpdir(), "openforge-web-runtime-"));
    const installedRoot = path.join(root, "installed");
    const runtimeWebDir = path.join(root, "state", "runtime", "web");
    await mkdir(path.join(installedRoot, "packages", "web"), { recursive: true });
    await writeFile(path.join(installedRoot, "packages", "web", "server.js"), "console.log('web');\n");

    // Act
    const prepared = await prepareWebRuntime({
      installedWebServerEntry: path.join(installedRoot, "packages", "web", "server.js"),
      runtimeWebDir
    });

    // Assert
    assert.equal(prepared.webRootDir, runtimeWebDir);
    assert.equal(await readFile(prepared.webServerEntry, "utf8"), "console.log('web');\n");
  });
});

describe("writeWebRuntimeConfig", () => {
  it("writes browser runtime gateway URL without exposing secrets", async () => {
    // Arrange
    const root = await mkdtemp(path.join(tmpdir(), "openforge-web-runtime-"));

    // Act
    const filePath = await writeWebRuntimeConfig({
      webPublicDir: path.join(root, "nested", "public"),
      gatewayBaseUrl: "http://127.0.0.1:48731"
    });

    // Assert
    assert.equal(filePath, path.join(root, "nested", "public", "openforge-runtime.js"));
    assert.equal(
      await readFile(filePath, "utf8"),
      'window.__OPENFORGE_RUNTIME__ = {"gatewayBaseUrl":"http://127.0.0.1:48731"};\n'
    );
    assert.doesNotMatch(await readFile(filePath, "utf8"), /MASTER_KEY|JWT|secret/i);
  });
});
