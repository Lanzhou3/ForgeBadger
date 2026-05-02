import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { writeWebRuntimeConfig } from "../src/runtime/web-runtime.js";

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
