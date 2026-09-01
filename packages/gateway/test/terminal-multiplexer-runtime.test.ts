import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSanitizedMultiplexerEnv,
  resolveTerminalMultiplexerRuntime
} from "../src/services/terminal-multiplexer-runtime.js";

describe("resolveTerminalMultiplexerRuntime", () => {
  it("builds a minimal runtime environment without inherited Gateway or application secrets", () => {
    // Arrange
    const inheritedEnv = {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/tester",
      SHELL: "/bin/zsh",
      TERM: "xterm-256color",
      LANG: "zh_CN.UTF-8",
      LC_CTYPE: "UTF-8",
      TMPDIR: "/tmp/tester",
      XDG_CONFIG_HOME: "/home/tester/.config",
      CODEX_HOME: "/home/tester/.codex-custom",
      CLAUDE_CONFIG_DIR: "/home/tester/.claude-custom",
      OPENCODE_CONFIG_DIR: "/home/tester/.config/opencode-custom",
      KIMI_CODE_HOME: "/home/tester/.kimi-code-custom",
      FORGEBADGER_MASTER_KEY: "gateway-master-secret",
      FORGEBADGER_JWT_SECRET: "gateway-jwt-secret",
      FORGEBADGER_COPILOT_BRIDGE_TOKEN: "gateway-bridge-secret",
      OPENFORGE_MASTER_KEY: "legacy-master-secret",
      JWT_SECRET: "generic-jwt-secret",
      APP_MASTER_KEY: "generic-master-secret",
      COPILOT_ACCESS_TOKEN: "generic-copilot-token",
      ORDINARY_BUT_UNNEEDED: "do-not-inherit"
    };

    // Act
    const env = buildSanitizedMultiplexerEnv(inheritedEnv);

    // Assert
    assert.deepEqual(env, {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/tester",
      SHELL: "/bin/zsh",
      TERM: "xterm-256color",
      LANG: "zh_CN.UTF-8",
      LC_CTYPE: "UTF-8",
      TMPDIR: "/tmp/tester",
      XDG_CONFIG_HOME: "/home/tester/.config",
      CODEX_HOME: "/home/tester/.codex-custom",
      CLAUDE_CONFIG_DIR: "/home/tester/.claude-custom",
      OPENCODE_CONFIG_DIR: "/home/tester/.config/opencode-custom",
      KIMI_CODE_HOME: "/home/tester/.kimi-code-custom",
      TMUX: "",
      TMUX_PANE: "",
      PSMUX_ACTIVE: "",
      PSMUX_ALLOW_NESTING: "",
      PSMUX_REMOTE_ATTACH: "",
      PSMUX_SESSION: "",
      PSMUX_SESSION_NAME: "",
      PSMUX_TARGET_SESSION: "",
      PSMUX_TARGET_FULL: "",
      PSMUX_SWITCH_TO: "",
      PSMUX_CLIENT_LAST_SESSION: "",
      PSMUX_SESSION_DISPLAY_NAME: "",
      PSMUX_POPUP: ""
    });
  });

  it("uses tmux commands and control-mode attach arguments on Unix-like hosts", () => {
    // Arrange / Act
    const runtime = resolveTerminalMultiplexerRuntime("linux");
    const controlPlan = runtime.buildControlPlan("of-safe-session", {
      PATH: "/usr/bin",
      TMUX: "/tmp/tmux/default,1,0",
      PSMUX_SESSION_NAME: "stale",
      PSMUX_CONFIG_FILE: "/home/tester/.psmux.conf",
      PSMUX_DATA_DIR: "/home/tester/.psmux",
      FORGEBADGER_JWT_SECRET: "must-not-reach-tmux-control"
    });

    // Assert
    assert.equal(runtime.kind, "tmux");
    assert.equal(runtime.command, "tmux");
    assert.deepEqual(runtime.versionArgs, ["-V"]);
    assert.deepEqual(runtime.buildAttachArgs("of-safe-session"), [
      "attach-session", "-E",
      "-t",
      "of-safe-session"
    ]);
    assert.equal(controlPlan.command, "tmux");
    assert.deepEqual(controlPlan.args, [
      "-C", "attach-session", "-E", "-f", "no-output,ignore-size", "-t", "of-safe-session"
    ]);
    assert.equal(controlPlan.env.PATH, "/usr/bin");
    assert.equal(controlPlan.env.TMUX, "");
    assert.equal(controlPlan.env.PSMUX_SESSION_NAME, "");
    assert.equal(controlPlan.env.PSMUX_CONFIG_FILE, "/home/tester/.psmux.conf");
    assert.equal(controlPlan.env.PSMUX_DATA_DIR, "/home/tester/.psmux");
    assert.equal(controlPlan.env.FORGEBADGER_JWT_SECRET, undefined);
    assert.deepEqual(runtime.buildGlobalEnvironmentCleanupArgs([
      "PATH=/usr/bin",
      "LC_ALL=en_US.UTF-8",
      "STALE_MULTIPLEXER_SECRET=stale-value",
      "FORGEBADGER_MASTER_KEY=gateway-secret",
      "-ODD_SECRET=odd-secret",
      "-ALREADY_UNSET"
    ].join("\n")), [
      ["set-environment", "-gu", "--", "STALE_MULTIPLEXER_SECRET"],
      ["set-environment", "-gu", "--", "FORGEBADGER_MASTER_KEY"],
      ["set-environment", "-gu", "--", "-ODD_SECRET"]
    ]);
  });

  it("uses native psmux and its environment-selected no-echo control mode on Windows", () => {
    // Arrange
    const inheritedEnv = {
      PATH: "C:\\Windows\\System32",
      PSMUX_ACTIVE: "1",
      PSMUX_SESSION_NAME: "stale-session",
      OPENFORGE_MASTER_KEY: "must-not-reach-psmux-control",
      COPILOT_BRIDGE_TOKEN: "must-not-reach-psmux-control"
    };

    // Act
    const runtime = resolveTerminalMultiplexerRuntime("win32");
    const controlPlan = runtime.buildControlPlan("of-safe-session", inheritedEnv);

    // Assert
    assert.equal(runtime.kind, "psmux");
    assert.equal(runtime.command, "psmux");
    assert.deepEqual(runtime.versionArgs, ["-V"]);
    assert.deepEqual(runtime.buildAttachArgs("of-safe-session"), [
      "attach-session", "-E",
      "-t",
      "of-safe-session"
    ]);
    assert.equal(controlPlan.command, "psmux");
    assert.deepEqual(controlPlan.args, ["-CC"]);
    assert.equal(controlPlan.env.PATH, "C:\\Windows\\System32");
    assert.equal(controlPlan.env.PSMUX_ACTIVE, "");
    assert.equal(controlPlan.env.PSMUX_SESSION_NAME, "of-safe-session");
    assert.equal(controlPlan.env.OPENFORGE_MASTER_KEY, undefined);
    assert.equal(controlPlan.env.COPILOT_BRIDGE_TOKEN, undefined);
    assert.deepEqual(runtime.buildGlobalEnvironmentCleanupArgs([
      "Path=C:\\Windows\\System32",
      "STALE_MULTIPLEXER_SECRET=stale-value",
      "OPENFORGE_JWT_SECRET=legacy-secret"
    ].join("\n")), [
      ["set-environment", "-gu", "--", "STALE_MULTIPLEXER_SECRET"],
      ["set-environment", "-gu", "--", "OPENFORGE_JWT_SECRET"]
    ]);
  });

  it("rejects unsafe session targets before constructing attach or control plans", () => {
    // Arrange
    const runtime = resolveTerminalMultiplexerRuntime("win32");

    // Act / Assert
    assert.throws(() => runtime.buildAttachArgs("safe; kill-server"), /invalid.*target/i);
    assert.throws(
      () => runtime.buildControlPlan("safe\nkill-server", {}),
      /invalid.*target/i
    );
  });
});
