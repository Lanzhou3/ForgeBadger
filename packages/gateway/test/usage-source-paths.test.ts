import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  claudeProjectsRoot,
  decodeClaudeProjectDir,
  opencodeDbPath
} from "../src/services/usage/usage-source.js";

describe("usage source paths", () => {
  it("decodes Claude project directories created on native Windows", () => {
    assert.equal(
      decodeClaudeProjectDir("C--Users-alice-Project-ForgeBadger", "win32"),
      "C:\\Users\\alice\\Project\\ForgeBadger"
    );
  });

  it("uses the native Windows home path for OpenCode data", () => {
    assert.equal(
      opencodeDbPath({ platform: "win32", homeDir: "C:\\Users\\alice", env: {} }),
      path.win32.join("C:\\Users\\alice", ".local", "share", "opencode", "opencode.db")
    );
  });

  it("expands home-relative CLI data overrides", () => {
    assert.equal(
      claudeProjectsRoot({
        platform: "linux",
        homeDir: "/home/alice",
        env: { CLAUDE_CONFIG_DIR: "~/.claude-alt" }
      }),
      "/home/alice/.claude-alt/projects"
    );
  });
});
