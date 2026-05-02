import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { getClaudePlugin } from "../src/services/plugin-catalog.js";
import {
  materializeClaudePluginPackages,
  validateClaudePluginPackage
} from "../src/services/claude-plugin-packages.js";

describe("Claude plugin package materialization", () => {
  it("writes a Claude Code plugin package with manifest, skill, and checksum metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-plugin-package-"));
    const plugin = getClaudePlugin("claude-safe-edits");
    assert.ok(plugin);

    const packages = await materializeClaudePluginPackages(root, [plugin]);

    assert.equal(packages.length, 1);
    assert.equal(packages[0]?.pluginId, "claude-safe-edits");
    assert.equal(packages[0]?.version, "1.0.0");
    assert.match(packages[0]?.checksum ?? "", /^[a-f0-9]{64}$/);

    const manifest = JSON.parse(
      await readFile(path.join(packages[0]!.directory, ".claude-plugin", "plugin.json"), "utf8")
    );
    assert.equal(manifest.name, "claude-safe-edits");
    assert.equal(manifest.version, "1.0.0");

    const skill = await readFile(
      path.join(packages[0]!.directory, "skills", "safe-edits", "SKILL.md"),
      "utf8"
    );
    assert.match(skill, /Review file edits and shell commands/i);

    const metadata = JSON.parse(
      await readFile(path.join(packages[0]!.directory, ".openforge", "metadata.json"), "utf8")
    );
    assert.equal(metadata.pluginId, "claude-safe-edits");
    assert.equal(metadata.version, "1.0.0");
    assert.equal(metadata.checksum, packages[0]?.checksum);
  });

  it("validates manifest and checksum before a materialized package can be launched", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-plugin-validate-"));
    const plugin = getClaudePlugin("claude-code-review");
    assert.ok(plugin);
    const [materialized] = await materializeClaudePluginPackages(root, [plugin]);
    assert.ok(materialized);

    const valid = await validateClaudePluginPackage(materialized.directory, plugin);
    assert.equal(valid?.directory, materialized.directory);

    await writeFile(
      path.join(materialized.directory, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "wrong-plugin", version: "1.0.0" }, null, 2)
    );

    const invalid = await validateClaudePluginPackage(materialized.directory, plugin);
    assert.equal(invalid, undefined);
  });
});
