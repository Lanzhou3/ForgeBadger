import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { runStart } from "../src/commands/start.js";
import { runCli } from "../src/index.js";
import type { RuntimeConfig } from "../src/runtime/config.js";
import { resolveInstalledPaths } from "../src/runtime/paths.js";
import { assertPortAvailable } from "../src/runtime/ports.js";
import { prepareWebRuntime } from "../src/runtime/web-runtime.js";

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
    const prepareCalls: Array<{ installedWebServerEntry: string; runtimeWebDir: string }> = [];
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
        prepareWebRuntime: async (options) => {
          prepareCalls.push(options);
          return createPreparedWebPaths(options.runtimeWebDir);
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
      assert.deepEqual(prepareCalls, [
        {
          installedWebServerEntry: paths.webServerEntry,
          runtimeWebDir: path.join(config.stateDir, "runtime", "web")
        }
      ]);
      assert.deepEqual(runtimeWrites, [
        {
          webPublicDir: path.join(config.stateDir, "runtime", "web", "packages", "web", "public"),
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
      assert.equal(spawns[1]?.entry, path.join(config.stateDir, "runtime", "web", "packages", "web", "server.js"));
      assert.equal(spawns[1]?.env[parentEnvName], undefined);
      assert.equal(spawns[1]?.env.HOSTNAME, "127.0.0.1");
      assert.equal(spawns[1]?.env.PORT, "48732");
      assert.equal(spawns[1]?.env.OPENFORGE_GATEWAY_URL, "http://127.0.0.1:48731");
      assert.equal(spawns[1]?.env.OPENFORGE_MASTER_KEY, undefined);
      assert.equal(spawns[1]?.env.OPENFORGE_JWT_SECRET, undefined);
      assert.deepEqual(shutdownChildren, spawnedChildren);
      assert.equal(shutdownChildren.length, 2);
      assert.match(stdout.text, /OpenForge Web Console: http:\/\/127\.0\.0\.1:48732\n/);
      assert.match(stdout.text, /OpenForge Gateway: http:\/\/127\.0\.0\.1:48731\n/);
      assert.match(stdout.text, /--open is not supported yet; open the URL manually\.\n/);
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

  it("passes only allowlisted parent environment variables to the web child", async () => {
    // Arrange
    const originalEnv = captureEnv([
      "PATH",
      "OPENFORGE_MASTER_KEY",
      "OPENFORGE_JWT_SECRET",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "DATABASE_URL",
      "OPENFORGE_EXTRA_SECRET"
    ]);
    const spawns: Array<{ entry: string; env: NodeJS.ProcessEnv }> = [];
    process.env.PATH = "/tmp/openforge-bin";
    process.env.OPENFORGE_MASTER_KEY = "parent-master-key";
    process.env.OPENFORGE_JWT_SECRET = "parent-jwt-secret";
    process.env.ANTHROPIC_API_KEY = "parent-anthropic";
    process.env.OPENAI_API_KEY = "parent-openai";
    process.env.DATABASE_URL = "postgres://example";
    process.env.OPENFORGE_EXTRA_SECRET = "parent-openforge-extra";

    try {
      const codePromise = runStart({
        loadConfig: async () => createRuntimeConfig("/tmp/openforge-state"),
        resolvePaths: () => createInstalledPaths(),
        checkPort: async () => undefined,
        prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
        writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
        spawn: (entry, env) => {
          const child = new FakeChild();
          spawns.push({ entry, env });
          return child;
        },
        installShutdown: (children) => {
          setImmediate(() => children[1]?.emit("exit", 0, null));
        },
        stdout: createMemoryWriter()
      });

      await codePromise;

      // Assert
      assert.equal(spawns[0]?.env.OPENFORGE_MASTER_KEY, "a".repeat(64));
      assert.equal(spawns[0]?.env.OPENFORGE_JWT_SECRET, "abcdefghijklmnopqrstuvwxyz123456");
      assert.equal(spawns[1]?.env.PATH, "/tmp/openforge-bin");
      assert.equal(Object.hasOwn(spawns[1]?.env ?? {}, "OPENFORGE_MASTER_KEY"), false);
      assert.equal(Object.hasOwn(spawns[1]?.env ?? {}, "OPENFORGE_JWT_SECRET"), false);
      assert.equal(Object.hasOwn(spawns[1]?.env ?? {}, "ANTHROPIC_API_KEY"), false);
      assert.equal(Object.hasOwn(spawns[1]?.env ?? {}, "OPENAI_API_KEY"), false);
      assert.equal(Object.hasOwn(spawns[1]?.env ?? {}, "DATABASE_URL"), false);
      assert.equal(Object.hasOwn(spawns[1]?.env ?? {}, "OPENFORGE_EXTRA_SECRET"), false);
    } finally {
      restoreEnvSnapshot(originalEnv);
    }
  });

  it("uses localhost browser URLs for wildcard bind hosts while preserving bind env", async () => {
    // Arrange
    const stdout = createMemoryWriter();
    const spawns: Array<{ entry: string; env: NodeJS.ProcessEnv }> = [];

    const codePromise = runStart({
      loadConfig: async () =>
        createRuntimeConfig("/tmp/openforge-state", {
          gateway: { host: "0.0.0.0", port: 48731 },
          web: { host: "0.0.0.0", port: 48732 }
        }),
      resolvePaths: () => createInstalledPaths(),
      checkPort: async () => undefined,
      prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
      writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
      spawn: (entry, env) => {
        const child = new FakeChild();
        spawns.push({ entry, env });
        return child;
      },
      installShutdown: (children) => {
        setImmediate(() => children[1]?.emit("exit", 0, null));
      },
      stdout
    });

    await codePromise;

    // Assert
    assert.equal(spawns[0]?.env.OPENFORGE_HOST, "0.0.0.0");
    assert.equal(spawns[0]?.env.OPENFORGE_GATEWAY_URL, "http://127.0.0.1:48731");
    assert.equal(spawns[1]?.env.HOSTNAME, "0.0.0.0");
    assert.equal(spawns[1]?.env.OPENFORGE_GATEWAY_URL, "http://127.0.0.1:48731");
    assert.match(stdout.text, /OpenForge Web Console: http:\/\/127\.0\.0\.1:48732\n/);
    assert.match(stdout.text, /OpenForge Gateway: http:\/\/127\.0\.0\.1:48731\n/);
  });

  it("warns native Windows users to run terminal sessions inside WSL while starting management services", async () => {
    const stderr = createMemoryWriter();
    const children: FakeChild[] = [];
    let dependencyChecks = 0;

    const codePromise = runStart({
      loadConfig: async () => createRuntimeConfig("/tmp/openforge-state"),
      resolvePaths: () => createInstalledPaths(),
      checkPort: async () => undefined,
      prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
      writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
      dependencyRunner: async () => {
        dependencyChecks += 1;
        return { exitCode: 0, stdout: "tmux 3.4\n", stderr: "" };
      },
      platform: "win32",
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      installShutdown: (spawnedChildren) => {
        setImmediate(() => spawnedChildren[1]?.emit("exit", 0, null));
      },
      stdout: createMemoryWriter(),
      stderr
    });

    const code = await codePromise;

    assert.equal(code, 0);
    assert.equal(children.length, 2);
    assert.equal(dependencyChecks, 0);
    assert.match(stderr.text, /Native Windows terminals require WSL/);
    assert.match(stderr.text, /openforge doctor/);
  });

  it("checks only tmux before warning about missing Unix terminal persistence", async () => {
    const stderr = createMemoryWriter();
    const seen: Array<{ command: string; args: string[] }> = [];

    const codePromise = runStart({
      loadConfig: async () => createRuntimeConfig("/tmp/openforge-state"),
      resolvePaths: () => createInstalledPaths(),
      checkPort: async () => undefined,
      prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
      writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
      dependencyRunner: async (command, args) => {
        seen.push({ command, args });
        return { exitCode: 127, stdout: "", stderr: "tmux not found" };
      },
      platform: "linux",
      spawn: () => new FakeChild(),
      installShutdown: (spawnedChildren) => {
        setImmediate(() => spawnedChildren[1]?.emit("exit", 0, null));
      },
      stdout: createMemoryWriter(),
      stderr
    });

    const code = await codePromise;

    assert.equal(code, 0);
    assert.deepEqual(seen, [{ command: "tmux", args: ["-V"] }]);
    assert.match(stderr.text, /Install tmux to enable persistent browser terminals/);
    assert.match(stderr.text, /openforge doctor/);
  });

  it("formats IPv6 browser URLs with brackets", async () => {
    // Arrange
    const stdout = createMemoryWriter();
    const spawns: Array<{ entry: string; env: NodeJS.ProcessEnv }> = [];

    const codePromise = runStart({
      loadConfig: async () =>
        createRuntimeConfig("/tmp/openforge-state", {
          gateway: { host: "::1", port: 48731 },
          web: { host: "::1", port: 48732 }
        }),
      resolvePaths: () => createInstalledPaths(),
      checkPort: async () => undefined,
      prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
      writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
      spawn: (entry, env) => {
        const child = new FakeChild();
        spawns.push({ entry, env });
        return child;
      },
      installShutdown: (children) => {
        setImmediate(() => children[1]?.emit("exit", 0, null));
      },
      stdout
    });

    await codePromise;

    // Assert
    assert.equal(spawns[0]?.env.OPENFORGE_HOST, "::1");
    assert.equal(spawns[0]?.env.OPENFORGE_GATEWAY_URL, "http://[::1]:48731");
    assert.equal(spawns[1]?.env.HOSTNAME, "::1");
    assert.equal(spawns[1]?.env.OPENFORGE_GATEWAY_URL, "http://[::1]:48731");
    assert.match(stdout.text, /OpenForge Web Console: http:\/\/\[::1\]:48732\n/);
    assert.match(stdout.text, /OpenForge Gateway: http:\/\/\[::1\]:48731\n/);
  });

  it("rejects matching gateway and web bind endpoints before checking ports", async () => {
    // Arrange
    const portChecks: Array<{ host: string; port: number }> = [];

    // Act / Assert
    await assert.rejects(
      () =>
        runStart({
          loadConfig: async () =>
            createRuntimeConfig("/tmp/openforge-state", {
              gateway: { host: "127.0.0.1", port: 48731 },
              web: { host: "127.0.0.1", port: 48731 }
            }),
          resolvePaths: () => createInstalledPaths(),
          checkPort: async (host, port) => {
            portChecks.push({ host, port });
          },
          prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
          writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
          spawn: () => new FakeChild(),
          installShutdown: (children) => {
            setImmediate(() => children[1]?.emit("exit", 0, null));
          },
          stdout: createMemoryWriter()
        }),
      /Gateway and Web cannot use the same bind endpoint: 127\.0\.0\.1:48731/
    );
    assert.deepEqual(portChecks, []);
  });

  it("rejects wildcard and loopback bind endpoint overlap before checking ports", async () => {
    // Arrange
    const portChecks: Array<{ host: string; port: number }> = [];

    // Act / Assert
    await assert.rejects(
      () =>
        runStart({
          loadConfig: async () =>
            createRuntimeConfig("/tmp/openforge-state", {
              gateway: { host: "0.0.0.0", port: 48731 },
              web: { host: "127.0.0.1", port: 48731 }
            }),
          resolvePaths: () => createInstalledPaths(),
          checkPort: async (host, port) => {
            portChecks.push({ host, port });
          },
          prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
          writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
          spawn: () => new FakeChild(),
          installShutdown: (children) => {
            setImmediate(() => children[1]?.emit("exit", 0, null));
          },
          stdout: createMemoryWriter()
        }),
      /Gateway and Web cannot use overlapping bind endpoints: 0\.0\.0\.0:48731 and 127\.0\.0\.1:48731/
    );
    assert.deepEqual(portChecks, []);
  });

  it("rejects localhost and IPv4 loopback bind endpoint overlap before checking ports", async () => {
    // Arrange
    const portChecks: Array<{ host: string; port: number }> = [];

    // Act / Assert
    await assert.rejects(
      () =>
        runStart({
          loadConfig: async () =>
            createRuntimeConfig("/tmp/openforge-state", {
              gateway: { host: "localhost", port: 48731 },
              web: { host: "127.0.0.1", port: 48731 }
            }),
          resolvePaths: () => createInstalledPaths(),
          checkPort: async (host, port) => {
            portChecks.push({ host, port });
          },
          prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
          writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
          spawn: () => new FakeChild(),
          installShutdown: (children) => {
            setImmediate(() => children[1]?.emit("exit", 0, null));
          },
          stdout: createMemoryWriter()
        }),
      /Gateway and Web cannot use overlapping bind endpoints: localhost:48731 and 127\.0\.0\.1:48731/
    );
    assert.deepEqual(portChecks, []);
  });

  it("rejects localhost and IPv6 loopback bind endpoint overlap before checking ports", async () => {
    // Arrange
    const portChecks: Array<{ host: string; port: number }> = [];

    // Act / Assert
    await assert.rejects(
      () =>
        runStart({
          loadConfig: async () =>
            createRuntimeConfig("/tmp/openforge-state", {
              gateway: { host: "localhost", port: 48731 },
              web: { host: "::1", port: 48731 }
            }),
          resolvePaths: () => createInstalledPaths(),
          checkPort: async (host, port) => {
            portChecks.push({ host, port });
          },
          prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
          writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
          spawn: () => new FakeChild(),
          installShutdown: (children) => {
            setImmediate(() => children[1]?.emit("exit", 0, null));
          },
          stdout: createMemoryWriter()
        }),
      /Gateway and Web cannot use overlapping bind endpoints: localhost:48731 and \[::1\]:48731/
    );
    assert.deepEqual(portChecks, []);
  });

  it("kills the sibling child, cleans listeners, and rejects when a child emits an error", async () => {
    // Arrange
    const originalSigintCount = process.listenerCount("SIGINT");
    const originalSigtermCount = process.listenerCount("SIGTERM");
    const children: FakeChild[] = [];
    const spawnError = new Error("gateway spawn failed");

    const codePromise = runStart({
      loadConfig: async () => createRuntimeConfig("/tmp/openforge-state"),
      resolvePaths: () => createInstalledPaths(),
      checkPort: async () => undefined,
      prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
      writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      stdout: createMemoryWriter()
    });

    await waitForChildren(children, 2);

    // Act
    assert.doesNotThrow(() => children[0]?.emit("error", spawnError));

    // Assert
    await assert.rejects(() => withTimeout(codePromise), /gateway spawn failed/);
    assert.deepEqual(children[1]?.killSignals, ["SIGTERM"]);
    assert.equal(process.listenerCount("SIGINT"), originalSigintCount);
    assert.equal(process.listenerCount("SIGTERM"), originalSigtermCount);
    assert.equal(children[0]?.listenerCount("error"), 0);
    assert.equal(children[1]?.listenerCount("exit"), 0);
    assert.equal(children[1]?.listenerCount("close"), 0);
  });

  it("kills the sibling child, cleans listeners, and returns the first child exit code", async () => {
    // Arrange
    const originalSigintCount = process.listenerCount("SIGINT");
    const originalSigtermCount = process.listenerCount("SIGTERM");
    const children: FakeChild[] = [];

    const codePromise = runStart({
      loadConfig: async () => createRuntimeConfig("/tmp/openforge-state"),
      resolvePaths: () => createInstalledPaths(),
      checkPort: async () => undefined,
      prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
      writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      stdout: createMemoryWriter()
    });

    await waitForChildren(children, 2);

    // Act
    children[1]?.emit("close", 7, null);
    const code = await withTimeout(codePromise);

    // Assert
    assert.equal(code, 7);
    assert.deepEqual(children[0]?.killSignals, ["SIGTERM"]);
    assert.equal(process.listenerCount("SIGINT"), originalSigintCount);
    assert.equal(process.listenerCount("SIGTERM"), originalSigtermCount);
    assert.equal(children[0]?.listenerCount("error"), 0);
    assert.equal(children[0]?.listenerCount("exit"), 0);
    assert.equal(children[1]?.listenerCount("close"), 0);
  });

  it("kills the sibling child, cleans listeners, and returns zero when a child exits normally", async () => {
    // Arrange
    const originalSigintCount = process.listenerCount("SIGINT");
    const originalSigtermCount = process.listenerCount("SIGTERM");
    const children: FakeChild[] = [];

    const codePromise = runStart({
      loadConfig: async () => createRuntimeConfig("/tmp/openforge-state"),
      resolvePaths: () => createInstalledPaths(),
      checkPort: async () => undefined,
      prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
      writeRuntimeConfig: async (options) => path.join(options.webPublicDir, "openforge-runtime.js"),
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      stdout: createMemoryWriter()
    });

    await waitForChildren(children, 2);

    // Act
    children[0]?.emit("exit", 0, null);
    const code = await withTimeout(codePromise);

    // Assert
    assert.equal(code, 0);
    assert.deepEqual(children[1]?.killSignals, ["SIGTERM"]);
    assert.equal(process.listenerCount("SIGINT"), originalSigintCount);
    assert.equal(process.listenerCount("SIGTERM"), originalSigtermCount);
    assert.equal(children[0]?.listenerCount("error"), 0);
    assert.equal(children[1]?.listenerCount("exit"), 0);
    assert.equal(children[1]?.listenerCount("close"), 0);
  });

  it("wraps web runtime config write failures with a diagnostic path", async () => {
    // Arrange
    const paths = createInstalledPaths();
    const writeError = new Error("EACCES: permission denied");
    const spawns: Array<{ entry: string; env: NodeJS.ProcessEnv }> = [];
    const runtimePublicDir = path.join("/tmp", "openforge-state", "runtime", "web", "packages", "web", "public");

    // Act / Assert
    await assert.rejects(
      () =>
        runStart({
          loadConfig: async () => createRuntimeConfig("/tmp/openforge-state"),
          resolvePaths: () => paths,
          checkPort: async () => undefined,
          prepareWebRuntime: async (options) => createPreparedWebPaths(options.runtimeWebDir),
          writeRuntimeConfig: async () => {
            throw writeError;
          },
          spawn: (entry, env) => {
            spawns.push({ entry, env });
            return new FakeChild();
          },
          stdout: createMemoryWriter()
        }),
      new RegExp(`Unable to write Web runtime config to ${escapeRegExp(runtimePublicDir)}.*EACCES`)
    );
    assert.deepEqual(spawns, []);
  });
});

describe("prepareWebRuntime", () => {
  it("copies the installed Web standalone artifact into a writable runtime directory", async () => {
    // Arrange
    const root = await mkdtemp(path.join(tmpdir(), "openforge-web-prepare-"));
    const installedRoot = path.join(root, "installed", "standalone");
    const installedServer = path.join(installedRoot, "packages", "web", "server.js");
    const installedPublicFile = path.join(installedRoot, "packages", "web", "public", "asset.txt");
    const runtimeWebDir = path.join(root, "state", "runtime", "web");
    await mkdir(path.dirname(installedServer), { recursive: true });
    await mkdir(path.dirname(installedPublicFile), { recursive: true });
    await writeFile(installedServer, "server");
    await writeFile(installedPublicFile, "asset");

    // Act
    const prepared = await prepareWebRuntime({
      installedWebServerEntry: installedServer,
      runtimeWebDir
    });

    // Assert
    assert.equal(prepared.webServerEntry, path.join(runtimeWebDir, "packages", "web", "server.js"));
    assert.equal(prepared.webPublicDir, path.join(runtimeWebDir, "packages", "web", "public"));
    assert.equal(await readFile(prepared.webServerEntry, "utf8"), "server");
    assert.equal(await readFile(path.join(prepared.webPublicDir, "asset.txt"), "utf8"), "asset");
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

class FakeChild extends EventEmitter {
  killed = false;
  readonly killSignals: string[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed = true;
    this.killSignals.push(signal);
    return true;
  }
}

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

function createRuntimeConfig(
  stateDir: string,
  overrides: Partial<Pick<RuntimeConfig, "gateway" | "web">> = {}
): RuntimeConfig {
  return {
    version: 1,
    stateDir,
    dbPath: `${stateDir}/openforge.db`,
    gateway: overrides.gateway ?? { host: "127.0.0.1", port: 48731 },
    web: overrides.web ?? { host: "127.0.0.1", port: 48732 },
    secrets: {
      masterKey: "a".repeat(64),
      jwtSecret: "abcdefghijklmnopqrstuvwxyz123456"
    }
  };
}

function createInstalledPaths() {
  return {
    packageRoot: "/tmp/openforge-package",
    gatewayEntry: "/tmp/openforge-package/gateway/src/index.js",
    gatewayInitEntry: "/tmp/openforge-package/gateway/src/cli/init.js",
    webServerEntry: "/tmp/openforge-package/web/standalone/packages/web/server.js",
    webPublicDir: "/tmp/openforge-package/web/standalone/packages/web/public"
  };
}

function createPreparedWebPaths(runtimeWebDir: string) {
  return {
    webRootDir: runtimeWebDir,
    webServerEntry: path.join(runtimeWebDir, "packages", "web", "server.js"),
    webPublicDir: path.join(runtimeWebDir, "packages", "web", "public")
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

function captureEnv(names: string[]): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvSnapshot(snapshot: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(snapshot)) {
    restoreEnv(name, value);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForChildren(children: FakeChild[], count: number): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (children.length >= count) {
      return;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error(`Timed out waiting for ${count} children`);
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for runStart"));
        }, 50);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
