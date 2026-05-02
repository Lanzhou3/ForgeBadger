import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createGatewayRuntime } from "../src/runtime/start-gateway.js";

describe("createGatewayRuntime", () => {
  it("creates an app without binding a port", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-gateway-runtime-"));
    const runtime = await createGatewayRuntime({
      OPENFORGE_HOST: "127.0.0.1",
      OPENFORGE_PORT: 0,
      OPENFORGE_STATE_DIR: root,
      OPENFORGE_DB_PATH: path.join(root, "openforge.db"),
      OPENFORGE_MASTER_KEY: "a".repeat(64),
      OPENFORGE_JWT_SECRET: "jwt-secret-for-gateway-runtime-test-123"
    });

    try {
      assert.ok(runtime.app);
      assert.ok(runtime.server);
      assert.equal(runtime.server.listening, false);
    } finally {
      await closeServerIfListening(runtime.server);
    }
  });
});

async function closeServerIfListening(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
