import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { runStart } from "../src/commands/start.js";
import { runCli } from "../src/index.js";
import type { RuntimeConfig } from "../src/runtime/config.js";
import { resolveInstalledPaths } from "../src/runtime/paths.js";
import { assertPortAvailable } from "../src/runtime/ports.js";

describe("resolveInstalledPaths", () => {
  it("resolves shipped artifacts relative to the compiled CLI dist directory", () => {
    // Arrange
    const metaUrl = pathToFileURL(path.join("/tmp", "openforge", "packages", "cli", "dist", "runtime", "paths.js")).href;

    // Act
    const paths = resolveInstalledPaths(metaUrl);

    // Assert
    assert.equal(paths.packageRoot, path.join("/tmp", "openforge", "packages", "cli", "dist"));
    assert.equal(paths.gatewayEntry, path.join(paths.packageRoot, "gateway", "src", "index.js"));
    assert.equal(paths.gatewayInitEntry, path.join(paths.packageRoot, "gateway", "src", "cli", "init.js"));
    assert.equal(paths.webServerEntry, path.join(paths.packageRoot, "web", "standalone", "packages", "web", "server.js"));
    assert.equal(paths.webPublicDir, path.join(paths.packageRoot, "web", "standalone", "packages", "web", "public"));
  });

  it("maps source runtime module paths to the CLI dist artifact root", () => {
    // Arrange
    const metaUrl = pathToFileURL(path.join("/tmp", "openforge", "packages", "cli", "src", "runtime", "paths.ts")).href;

    // Act
    const paths = resolveInstalledPaths(metaUrl);

    // Assert
    assert.equal(paths.packageRoot, path.join("/tmp", "openforge", "packages", "cli", "dist"));
    assert.equal(paths.gatewayEntry, path.join(paths.packageRoot, "gateway", "src", "index.js"));
  });
});

describe("assertPortAvailable", () => {
  it("resolves when a host port is free", async () => {
    // Arrange
    const server = await listenOnAvailablePort("127.0.0.1");
    const port = server.address().port;
    await closeServer(server);

    // Act / Assert
    await assert.doesNotReject(() => assertPortAvailable("127.0.0.1", port));
  });

  it("rejects with host and port details when a port is already bound", async () => {
    // Arrange
    const server = await listenOnAvailablePort("127.0.0.1");
    const port = server.address().port;

    try {
      // Act / Assert
      await assert.rejects(() => assertPortAvailable("127.0.0.1", port), new RegExp(`127\\.0\\.0\\.1:${port}`));
    } finally {
      await closeServer(server);
    }
  });
});

describe("runStart", () => {
  it("writes web runtime config, spawns gateway and web, installs shutdown handlers, and returns first exit code", async () => {
    // Arrange
    const stdout = createMemoryWriter();
    const config = createRuntimeConfig("/tmp/openforge-state");
    const paths = {
      packageRoot: "/tmp/openforge-package",
      gatewayEntry: "/tmp/openforge-package/gateway/src/index.js",
      gatewayInitEntry: "/tmp/openforge-package/gateway/src/cli/init.js",
      webServerEntry: "/tmp/openforge-package/web/standalone/packages/web/server.js",
      webPublicDir: "/tmp/openforge-package/web/standalone/packages/web/public"
    };
    const loadCalls: unknown[] = [];
    const portChecks: Array<{ host: string; port: number }> = [];
    const runtimeWrites: Array<{ webPublicDir: string; gatewayBaseUrl: string }> = [];
    const spawns: Array<{ entry: string; env: NodeJS.ProcessEnv }> = [];
    const spawnedChildren: FakeChild[] = [];
    let shutdownChildren: FakeChild[] = [];
    const parentEnvName = "OPENFORGE_START_TEST_PARENT";
    const originalParentEnv = process.env[parentEnvName];
    const originalMasterKey = process.env.OPENFORGE_MASTER_KEY;
    const originalJwtSecret = process.env.OPENFORGE_JWT_SECRET;
    process.env[parentEnvName] = "from-parent-env";
    delete process.env.OPENFORGE_MASTER_KEY;
    delete process.env.OPENFORGE_JWT_SECRET;

    try {
      const codePromise = runStart({
        gatewayPort: 49931,
        webPort: 49932,
        host: "127.0.0.1",
        openBrowser: true,
        loadConfig: async (options) => {
          loadCalls.push(options);
          return config;
        },
        resolvePaths: () => paths,
        checkPort: async (host, port) => {
          portChecks.push({ host, port });
        },
        writeRuntimeConfig: async (options) => {
          runtimeWrites.push(options);
          return path.join(options.webPublicDir, "openforge-runtime.js");
        },
        spawn: (entry, env) => {
          const child = new FakeChild();
          spawns.push({ entry, env });
          spawnedChildren.push(child);
          return child;
        },
        installShutdown: (children) => {
          shutdownChildren = [...children];
          setImmediate(() => children[1]?.emit("exit", 12, null));
        },
        stdout
      });

      // Act
      const code = await codePromise;

      // Assert
      assert.equal(code, 12);
      assert.deepEqual(loadCalls, [{ gatewayPort: 49931, webPort: 49932, host: "127.0.0.1" }]);
      assert.deepEqual(portChecks, [
        { host: "127.0.0.1", port: 48731 },
        { host: "127.0.0.1", port: 48732 }
      ]);
      assert.deepEqual(runtimeWrites, [
        {
          webPublicDir: paths.webPublicDir,
          gatewayBaseUrl: "http://127.0.0.1:48731"
        }
      ]);
      assert.equal(spawns[0]?.entry, paths.gatewayEntry);
      assert.equal(spawns[0]?.env[parentEnvName], "from-parent-env");
      assert.equal(spawns[0]?.env.OPENFORGE_HOST, "127.0.0.1");
      assert.equal(spawns[0]?.env.OPENFORGE_PORT, "48731");
      assert.equal(spawns[0]?.env.OPENFORGE_STATE_DIR, "/tmp/openforge-state");
      assert.equal(spawns[0]?.env.OPENFORGE_DB_PATH, "/tmp/openforge-state/openforge.db");
      assert.equal(spawns[0]?.env.OPENFORGE_MASTER_KEY, config.secrets.masterKey);
      assert.equal(spawns[0]?.env.OPENFORGE_JWT_SECRET, config.secrets.jwtSecret);
      assert.equal(spawns[0]?.env.OPENFORGE_GATEWAY_URL, "http://127.0.0.1:48731");
      assert.equal(spawns[1]?.entry, paths.webServerEntry);
      assert.equal(spawns[1]?.env[parentEnvName], "from-parent-env");
      assert.equal(spawns[1]?.env.HOSTNAME, "127.0.0.1");
      assert.equal(spawns[1]?.env.PORT, "48732");
      assert.equal(spawns[1]?.env.OPENFORGE_GATEWAY_URL, "http://127.0.0.1:48731");
      assert.notEqual(spawns[1]?.env.OPENFORGE_MASTER_KEY, config.secrets.masterKey);
      assert.notEqual(spawns[1]?.env.OPENFORGE_JWT_SECRET, config.secrets.jwtSecret);
      assert.deepEqual(shutdownChildren, spawnedChildren);
      assert.equal(shutdownChildren.length, 2);
      assert.match(stdout.text, /OpenForge Web Console: http:\/\/127\.0\.0\.1:48732\n/);
      assert.match(stdout.text, /OpenForge Gateway: http:\/\/127\.0\.0\.1:48731\n/);
    } finally {
      if (originalParentEnv === undefined) {
        delete process.env[parentEnvName];
      } else {
        process.env[parentEnvName] = originalParentEnv;
      }
      if (originalMasterKey === undefined) {
        delete process.env.OPENFORGE_MASTER_KEY;
      } else {
        process.env.OPENFORGE_MASTER_KEY = originalMasterKey;
      }
      if (originalJwtSecret === undefined) {
        delete process.env.OPENFORGE_JWT_SECRET;
      } else {
        process.env.OPENFORGE_JWT_SECRET = originalJwtSecret;
      }
    }
  });
});

describe("runCli", () => {
  it("dispatches start through an injectable runner", async () => {
    // Arrange
    const seen: unknown[] = [];

    // Act
    const code = await runCli(["start", "--gateway-port", "49931"], {
      startRunner: async (command) => {
        seen.push(command);
        return 9;
      }
    });

    // Assert
    assert.equal(code, 9);
    assert.deepEqual(seen, [
      {
        command: "start",
        gatewayPort: 49931,
        webPort: undefined,
        host: undefined,
        openBrowser: false
      }
    ]);
  });
});

class FakeChild extends EventEmitter {}

interface BoundServer extends net.Server {
  address(): net.AddressInfo;
}

async function listenOnAvailablePort(host: string): Promise<BoundServer> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  return server as BoundServer;
}

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createRuntimeConfig(stateDir: string): RuntimeConfig {
  return {
    version: 1,
    stateDir,
    dbPath: `${stateDir}/openforge.db`,
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
