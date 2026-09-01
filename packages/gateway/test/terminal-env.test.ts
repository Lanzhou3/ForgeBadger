import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTmuxAttachEnv } from "../src/websocket/terminal.js";

describe("buildTmuxAttachEnv", () => {
  it("clears TMUX before attaching to avoid nested tmux detection", () => {
    const env = buildTmuxAttachEnv({
      PATH: "/usr/bin",
      TMUX: "/tmp/tmux-1000/default,123,0"
    });

    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.TMUX, "");
  });

  it("clears inherited psmux session identity while preserving user configuration", () => {
    const env = buildTmuxAttachEnv({
      PATH: "C:\\Windows\\System32",
      TMUX: "stale-tmux",
      TMUX_PANE: "%9",
      PSMUX_ACTIVE: "1",
      PSMUX_ALLOW_NESTING: "1",
      PSMUX_REMOTE_ATTACH: "1",
      PSMUX_SESSION: "stale-session",
      PSMUX_SESSION_NAME: "stale-session-name",
      PSMUX_TARGET_SESSION: "stale-target",
      PSMUX_TARGET_FULL: "stale-target:0.0",
      PSMUX_SWITCH_TO: "stale-next",
      PSMUX_CLIENT_LAST_SESSION: "stale-last",
      PSMUX_SESSION_DISPLAY_NAME: "stale-display",
      PSMUX_POPUP: "1",
      PSMUX_CONFIG_FILE: "C:\\Users\\tester\\.psmux.conf",
      PSMUX_DATA_DIR: "C:\\Users\\tester\\.psmux"
    });

    assert.equal(env.PATH, "C:\\Windows\\System32");
    for (const key of [
      "TMUX",
      "TMUX_PANE",
      "PSMUX_ACTIVE",
      "PSMUX_ALLOW_NESTING",
      "PSMUX_REMOTE_ATTACH",
      "PSMUX_SESSION",
      "PSMUX_SESSION_NAME",
      "PSMUX_TARGET_SESSION",
      "PSMUX_TARGET_FULL",
      "PSMUX_SWITCH_TO",
      "PSMUX_CLIENT_LAST_SESSION",
      "PSMUX_SESSION_DISPLAY_NAME",
      "PSMUX_POPUP"
    ]) {
      assert.equal(env[key], "", `${key} should not leak into a fresh attach client`);
    }
    assert.equal(env.PSMUX_CONFIG_FILE, "C:\\Users\\tester\\.psmux.conf");
    assert.equal(env.PSMUX_DATA_DIR, "C:\\Users\\tester\\.psmux");
  });
});
