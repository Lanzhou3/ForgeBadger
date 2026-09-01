import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ensureForgeBadgerOpenCodePlugin } from "../src/services/opencode-notification-settings.js";

const PLUGIN_RELATIVE = path.join(".opencode", "plugins", "forgebadger-permission-notify.js");

function expectedPluginPath(root: string): string {
  return path.join(realpathSync(root), ".opencode", "plugins", "forgebadger-permission-notify.js");
}

describe("OpenCode notification settings", () => {
  let originalWarn: typeof console.warn;
  let warnings: unknown[][];

  beforeEach(() => {
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it("creates the ForgeBadger permission-notify plugin on first call", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-opencode-plugin-"));

    const result = await ensureForgeBadgerOpenCodePlugin(root);

    assert.equal(result.path, expectedPluginPath(root));
    assert.equal(result.changed, true);
    const content = await readFile(result.path, "utf8");
    assert.match(content, /\/api\/v1\/session-hooks\/claude-notification/);
    assert.match(content, /FORGEBADGER_ATTACH_TOKEN/);
    assert.match(content, /FORGEBADGER_GATEWAY_URL/);
    assert.match(content, /FORGEBADGER_SESSION_ID/);
    assert.match(content, /permission\.asked/);
    assert.match(content, /session\.idle/);
    assert.match(content, /session\.error/);
    assert.match(content, /task_completed/);
    assert.match(content, /task_failed/);
    assert.match(content, /export const ForgeBadgerPermissionNotify/);
    assert.match(content, /adapter: "opencode"/);
    assert.match(content, /"x-forgebadger-session-token"/);
    assert.match(content, /signal: AbortSignal\.timeout\(4500\)/);
  });

  it("is idempotent when the plugin content is unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-opencode-plugin-idem-"));

    const first = await ensureForgeBadgerOpenCodePlugin(root);
    const contentAfterFirst = await readFile(first.path, "utf8");

    const second = await ensureForgeBadgerOpenCodePlugin(root);
    const contentAfterSecond = await readFile(first.path, "utf8");

    assert.equal(second.path, first.path);
    assert.equal(second.changed, false);
    assert.equal(contentAfterSecond, contentAfterFirst);
  });

  it("rejects denied project roots via safeResolve", async () => {
    await assert.rejects(() => ensureForgeBadgerOpenCodePlugin("/etc"), /denied root/);
  });

  it("rejects plugin paths that escape the project root via symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-opencode-symlink-"));
    const outside = await mkdtemp(path.join(tmpdir(), "forgebadger-opencode-outside-"));
    await mkdir(path.join(root, ".opencode"), { recursive: true });
    await symlink(outside, path.join(root, ".opencode", "plugins"));

    await assert.rejects(
      () => ensureForgeBadgerOpenCodePlugin(root),
      /escapes approved project root/
    );
  });

  it("degrades gracefully without throwing when the plugin cannot be written", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-opencode-readonly-"));
    const pluginsDir = path.join(root, ".opencode", "plugins");
    await mkdir(pluginsDir, { recursive: true });
    await chmod(pluginsDir, 0o555);

    try {
      const result = await ensureForgeBadgerOpenCodePlugin(root);

      assert.equal(result.path, expectedPluginPath(root));
      assert.equal(result.changed, false);
      assert.equal(warnings.length, 1);
    } finally {
      await chmod(pluginsDir, 0o755);
    }
  });

  it("does not touch other plugins in .opencode/plugins", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-opencode-others-"));
    const pluginsDir = path.join(root, ".opencode", "plugins");
    await mkdir(pluginsDir, { recursive: true });
    const thirdParty = path.join(pluginsDir, "my-plugin.js");
    const thirdPartyContent = "// third-party plugin\nexport const x = 1;\n";
    await writeFile(thirdParty, thirdPartyContent);

    await ensureForgeBadgerOpenCodePlugin(root);

    assert.equal(await readFile(thirdParty, "utf8"), thirdPartyContent);
    const entries = await readdir(pluginsDir);
    assert.ok(entries.includes("forgebadger-permission-notify.js"));
    assert.ok(entries.includes("my-plugin.js"));
    assert.equal(entries.length, 2);
  });
});
