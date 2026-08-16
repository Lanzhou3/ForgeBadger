import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import type { Database } from "../src/db/types.js";
import type { TmuxClient } from "../src/services/tmux.js";
import { createGatewayRuntime } from "../src/runtime/start-gateway.js";

describe("createGatewayRuntime", () => {
  it("returns 404 for removed API endpoints", async () => {
    // Arrange
    const root = await mkdtemp(path.join(tmpdir(), "openforge-gateway-cutover-"));
    const tmux = createMockTmuxClient();
    const restorePath = await installFailingTmuxShim(root);
    let runtime: Awaited<ReturnType<typeof createGatewayRuntime>> | undefined;

    try {
      runtime = await createGatewayRuntime(gatewayEnv(root), { tmuxClient: tmux.client });
      runtime.server.listen(0, "127.0.0.1");
      await once(runtime.server, "listening");
      const address = runtime.server.address() as AddressInfo;

      // The `/api/v1` skill router gates the whole namespace with `authenticate`,
      // so removed endpoints must be probed with a valid token to reach the
      // 404 handler rather than short-circuiting to 401.
      const db = runtime.app.locals.db as Database;
      const jwtSecret = runtime.app.locals.jwtSecret as string;
      const user = new UserRepository(db).create("cutover@example.com", "hash");
      const token = signJwt({ userId: user.id, email: user.email }, jwtSecret);
      const authHeader = { authorization: `Bearer ${token}` };

      // Act
      const removedEndpoints = await Promise.all([
        fetch(`http://127.0.0.1:${address.port}/api/v1/agents`, { headers: authHeader }),
        fetch(`http://127.0.0.1:${address.port}/api/v1/automations`, { headers: authHeader })
      ]);

      // Assert
      assert.deepEqual(removedEndpoints.map((response) => response.status), [404, 404]);
    } finally {
      restorePath();
      if (runtime) await runtime.close();
    }
  });

  it("creates an app without binding a port", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-gateway-runtime-"));
    const tmux = createMockTmuxClient();
    const restorePath = await installFailingTmuxShim(root);
    let runtime: Awaited<ReturnType<typeof createGatewayRuntime>> | undefined;

    try {
      runtime = await createGatewayRuntime(gatewayEnv(root), { tmuxClient: tmux.client });

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

function gatewayEnv(root: string) {
  return {
    OPENFORGE_HOST: "127.0.0.1",
    OPENFORGE_PORT: 3001,
    OPENFORGE_STATE_DIR: root,
    OPENFORGE_DB_PATH: path.join(root, "openforge.db"),
    OPENFORGE_MASTER_KEY: "a".repeat(64),
    OPENFORGE_JWT_SECRET: "jwt-secret-for-gateway-runtime-test-123"
  };
}

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
