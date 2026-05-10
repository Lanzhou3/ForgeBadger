import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { TmuxClient } from "../src/services/tmux.js";
import { createGatewayRuntime } from "../src/runtime/start-gateway.js";

describe("createGatewayRuntime", () => {
  it("creates an app without binding a port", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-gateway-runtime-"));
    const tmux = createMockTmuxClient();
    const restorePath = await installFailingTmuxShim(root);
    let runtime: Awaited<ReturnType<typeof createGatewayRuntime>> | undefined;

    try {
      runtime = await createGatewayRuntime(
        {
          OPENFORGE_HOST: "127.0.0.1",
          OPENFORGE_PORT: 3001,
          OPENFORGE_STATE_DIR: root,
          OPENFORGE_DB_PATH: path.join(root, "openforge.db"),
          OPENFORGE_MASTER_KEY: "a".repeat(64),
          OPENFORGE_JWT_SECRET: "jwt-secret-for-gateway-runtime-test-123"
        },
        { tmuxClient: tmux.client }
      );

      assert.ok(runtime.app);
      assert.ok(runtime.server);
      assert.equal(runtime.server.listening, false);
      assert.equal(tmux.listSessionsCalls, 1);
      assert.deepEqual(tmux.killedSessions, []);
    } finally {
      restorePath();
      if (runtime) {
        await runtime.close();
      }
    }
  });

  it("validates GatewayEnv-shaped input instead of trusting its shape", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-gateway-runtime-"));
    const tmux = createMockTmuxClient();
    const restorePath = await installFailingTmuxShim(root);
    let runtime: Awaited<ReturnType<typeof createGatewayRuntime>> | undefined;
    let rejected = false;

    try {
      runtime = await createGatewayRuntime(
        {
          OPENFORGE_HOST: "127.0.0.1",
          OPENFORGE_PORT: 0,
          OPENFORGE_STATE_DIR: root,
          OPENFORGE_DB_PATH: path.join(root, "openforge.db"),
          OPENFORGE_MASTER_KEY: "a".repeat(64),
          OPENFORGE_JWT_SECRET: "jwt-secret-for-gateway-runtime-test-456"
        },
        { tmuxClient: tmux.client }
      );
    } catch (error) {
      rejected = true;
      assert.match(String(error), /OPENFORGE_PORT|greater than 0|positive/i);
    } finally {
      restorePath();
      if (runtime && "close" in runtime) {
        await runtime.close();
      }
    }

    assert.equal(rejected, true);
    assert.equal(tmux.listSessionsCalls, 0);
  });
});

function createMockTmuxClient(): {
  client: TmuxClient;
  killedSessions: string[];
  listSessionsCalls: number;
} {
  const calls = {
    killedSessions: [] as string[],
    listSessionsCalls: 0
  };

  return {
    get killedSessions() {
      return calls.killedSessions;
    },
    get listSessionsCalls() {
      return calls.listSessionsCalls;
    },
    client: {
      async createSession() {
        throw new Error("createSession should not be called during startup recovery");
      },
      async killSession(name) {
        calls.killedSessions.push(name);
      },
      async capturePane() {
        throw new Error("capturePane should not be called during startup recovery");
      },
      async listSessions() {
        calls.listSessionsCalls += 1;
        return [];
      }
    }
  };
}

async function installFailingTmuxShim(root: string): Promise<() => void> {
  const tmuxPath = path.join(root, "tmux");
  await writeFile(
    tmuxPath,
    "#!/bin/sh\nprintf 'test tmux shim should not be invoked\\n' >&2\nexit 42\n"
  );
  await chmod(tmuxPath, 0o700);

  const originalPath = process.env.PATH;
  process.env.PATH = root;

  return () => {
    if (originalPath === undefined) {
      delete process.env.PATH;
      return;
    }
    process.env.PATH = originalPath;
  };
}
