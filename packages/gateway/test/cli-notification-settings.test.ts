import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parse as parseToml } from "smol-toml";

import {
  ensureCodexNotificationSettings,
  ensureKimiNotificationSettings
} from "../src/services/cli-notification-settings.js";

describe("CLI lifecycle notification settings", () => {
  it("merges Codex permission, completion, and session-end hooks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-hooks-"));
    const hooksPath = path.join(root, ".codex", "hooks.json");
    await mkdir(path.dirname(hooksPath), { recursive: true });
    await writeFile(hooksPath, JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "echo existing" }] }] }
    }));

    const result = await ensureCodexNotificationSettings(root);
    const settings = JSON.parse(await readFile(hooksPath, "utf8"));

    assert.equal(result.changed, true);
    assert.equal(settings.hooks.Stop[0].hooks[0].command, "echo existing");
    assert.match(settings.hooks.PermissionRequest[0].hooks.at(-1).command, /openforge-notify\.mjs/);
    assert.match(settings.hooks.Stop[0].hooks.at(-1).command, /openforge-notify\.mjs/);
    assert.match(settings.hooks.SessionEnd[0].hooks.at(-1).command, /openforge-notify\.mjs/);
    assert.match(await readFile(path.join(root, ".codex", "hooks", "openforge-notify.mjs"), "utf8"), /adapter: "codex"/);
    assert.equal((await ensureCodexNotificationSettings(root)).changed, false);
  });

  it("installs Kimi hooks into the global config and cleans up legacy project blocks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-kimi-hooks-"));
    const kimiHome = path.join(root, "global-kimi");
    const stateDir = path.join(root, "of-state");
    const projectRoot = path.join(root, "project");
    const configPath = path.join(kimiHome, "config.toml");
    const projectConfigPath = path.join(projectRoot, ".kimi-code", "config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, "# Keep this user comment\ndefault_model = \"kimi\"\n");
    await mkdir(path.dirname(projectConfigPath), { recursive: true });
    await writeFile(
      projectConfigPath,
      "# OpenForge managed notification hooks: start\n[[hooks]]\nevent = \"Stop\"\ncommand = \"node old.mjs\"\n# OpenForge managed notification hooks: end\n"
    );

    const previousKimiHome = process.env.KIMI_CODE_HOME;
    const previousStateDir = process.env.OPENFORGE_STATE_DIR;
    process.env.KIMI_CODE_HOME = kimiHome;
    process.env.OPENFORGE_STATE_DIR = stateDir;
    try {
      const result = await ensureKimiNotificationSettings(projectRoot);
      const config = parseToml(await readFile(configPath, "utf8")) as {
        default_model?: string;
        hooks?: Array<{ event?: string; matcher?: string; command?: string }>;
      };

      assert.equal(result.changed, true);
      assert.equal(result.path, configPath);
      assert.equal(config.default_model, "kimi");
      assert.match(await readFile(configPath, "utf8"), /# Keep this user comment/);
      assert.deepEqual(
        config.hooks?.map((hook) => hook.event).sort(),
        ["Notification", "SessionEnd", "Stop", "StopFailure"].sort()
      );
      assert.ok(config.hooks?.every((hook) => hook.matcher === undefined));
      assert.ok(
        config.hooks?.every((hook) =>
          hook.command?.includes(path.join(stateDir, "hooks", "kimi-notify.mjs"))
        )
      );
      assert.match(await readFile(path.join(stateDir, "hooks", "kimi-notify.mjs"), "utf8"), /adapter: "kimi"/);
      // Legacy per-project block is removed because Kimi never reads it.
      assert.doesNotMatch(await readFile(projectConfigPath, "utf8"), /OpenForge managed notification hooks/);
      assert.equal((await ensureKimiNotificationSettings(projectRoot)).changed, false);
    } finally {
      if (previousKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = previousKimiHome;
      if (previousStateDir === undefined) delete process.env.OPENFORGE_STATE_DIR;
      else process.env.OPENFORGE_STATE_DIR = previousStateDir;
    }
  });
});
