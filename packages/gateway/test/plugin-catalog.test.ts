import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getClaudePlugin,
  listClaudePlugins,
  mergePluginStates
} from "../src/services/plugin-catalog.js";

describe("plugin catalog", () => {
  it("lists Claude Code plugins", () => {
    const plugins = listClaudePlugins();
    assert.equal(plugins.length >= 3, true);
    assert.ok(plugins.every((plugin) => plugin.adapter === "claude"));
    const safeEdits = getClaudePlugin("claude-safe-edits");
    assert.ok(safeEdits);
    assert.equal(safeEdits.version, "1.0.0");
    assert.ok(safeEdits.skills.some((skill) => skill.name === "safe-edits"));
  });

  it("merges per-user enabled state into plugin summaries", () => {
    const plugins = mergePluginStates(new Set(["claude-safe-edits"]));
    const safeEdits = plugins.find((plugin) => plugin.id === "claude-safe-edits");
    const review = plugins.find((plugin) => plugin.id === "claude-code-review");

    assert.equal(safeEdits?.enabled, true);
    assert.equal(safeEdits?.status, "enabled");
    assert.equal(review?.enabled, false);
    assert.equal(review?.status, "disabled");
  });
});
