import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import { runInit } from "../src/commands/init.js";
import { runStart } from "../src/commands/start.js";
import {
  FORGEBADGER_TEXT_LOGO,
  renderForgeBadgerInstallBanner
} from "../src/ui/install-banner.js";

describe("ForgeBadger install banner", () => {
  it("renders a portable plain-text logo without ANSI escapes", () => {
    const output = renderForgeBadgerInstallBanner({ isTTY: false, env: {} });

    assert.match(output, /ForgeBadger/);
    assert.match(output, /Local-first control plane for AI coding CLIs/);
    assert.equal(output.includes(FORGEBADGER_TEXT_LOGO), true);
    assert.doesNotMatch(output, /\[/);
  });

  it("uses the ForgeBadger cyan accent only on a color-capable TTY", () => {
    const colorOutput = renderForgeBadgerInstallBanner({
      isTTY: true,
      env: { TERM: "xterm-256color" }
    });
    const noColorOutput = renderForgeBadgerInstallBanner({
      isTTY: true,
      env: { TERM: "xterm-256color", NO_COLOR: "1" }
    });

    assert.match(colorOutput, /\[38;2;34;211;238m/);
    assert.doesNotMatch(noColorOutput, /\[/);
  });

  it("prints the logo before start spawns the gateway and web processes", async () => {
    const stdout = createMemoryWriter();
    let outputSeenAtSpawn = "";

    const codePromise = runStart({
      isTTY: false,
      env: {},
      stdout,
      loadConfig: async () => ({
        version: 1,
        stateDir: "/tmp/forgebadger-state",
        dbPath: "/tmp/forgebadger-state/forgebadger.db",
        gateway: { host: "127.0.0.1", port: 48731 },
        web: { host: "127.0.0.1", port: 48732 },
        secrets: { masterKey: "a".repeat(64), jwtSecret: "abcdefghijklmnopqrstuvwxyz123456" }
      }),
      resolvePaths: () => ({
        packageRoot: "/tmp/forgebadger-package",
        gatewayEntry: "/tmp/forgebadger-package/gateway/src/index.js",
        gatewayInitEntry: "/tmp/forgebadger-package/gateway/src/cli/init.js",
        webServerEntry: "/tmp/forgebadger-package/web/standalone/packages/web/server.js",
        webPublicDir: "/tmp/forgebadger-package/web/standalone/packages/web/public"
      }),
      checkPort: async () => undefined,
      prepareWebRuntime: async (options) => ({
        webRootDir: options.runtimeWebDir,
        webServerEntry: `${options.runtimeWebDir}/packages/web/server.js`,
        webPublicDir: `${options.runtimeWebDir}/packages/web/public`
      }),
      writeRuntimeConfig: async () => "/tmp/forgebadger-runtime.js",
      spawn: () => {
        if (outputSeenAtSpawn === "") {
          outputSeenAtSpawn = stdout.text;
        }
        return new FakeChild();
      },
      installShutdown: (children) => {
        setImmediate(() => children[1]?.emit("exit", 0, null));
      }
    });

    const code = await codePromise;

    assert.equal(code, 0);
    assert.equal(outputSeenAtSpawn.includes(FORGEBADGER_TEXT_LOGO), true);
  });

  it("prints the logo before init delegates to the gateway init module", async () => {
    const stdout = createMemoryWriter();
    let outputSeenAtDelegation = "";

    const code = await runInit(["init"], {
      isTTY: false,
      env: {},
      stdout,
      resolvePaths: () => ({
        packageRoot: "/tmp/forgebadger-package",
        gatewayEntry: "/tmp/forgebadger-package/gateway/src/index.js",
        gatewayInitEntry: "/tmp/forgebadger-package/gateway/src/cli/init.js",
        webServerEntry: "/tmp/forgebadger-package/web/standalone/packages/web/server.js",
        webPublicDir: "/tmp/forgebadger-package/web/standalone/packages/web/public"
      }),
      importModule: async () => {
        outputSeenAtDelegation = stdout.text;
        return { runForgeBadgerCli: async () => 0 };
      }
    });

    assert.equal(code, 0);
    assert.equal(outputSeenAtDelegation.includes(FORGEBADGER_TEXT_LOGO), true);
  });
});

class FakeChild extends EventEmitter {
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function createMemoryWriter() {
  return {
    text: "",
    write(chunk: string) {
      this.text += chunk;
    }
  };
}
