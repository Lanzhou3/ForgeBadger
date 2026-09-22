import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parse as parseToml } from "smol-toml";

import {
  ensureClaudeTerminalNotificationSettings,
  ensureKimiTerminalNotificationSettings,
  ensureOpenCodeTerminalNotificationSettings
} from "../src/services/terminal-notification-settings.js";

async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("terminal-native notification settings", () => {
  it("merges [notifications] into Kimi tui.toml, preserving other settings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-kimi-tui-"));
    const kimiHome = path.join(root, "kimi-home");
    const tuiPath = path.join(kimiHome, "tui.toml");

    await withEnv({ KIMI_CODE_HOME: kimiHome }, async () => {
      await mkdir(kimiHome, { recursive: true });
      await writeFile(tuiPath, 'theme = "dark"\n\n[editor]\nfont_size = 14\n');

      const result = await ensureKimiTerminalNotificationSettings();
      assert.equal(result.changed, true);
      assert.equal(result.path, tuiPath);

      const parsed = parseToml(await readFile(tuiPath, "utf8")) as Record<string, unknown>;
      assert.equal(parsed.theme, "dark");
      assert.deepEqual(parsed.editor, { font_size: 14 });
      assert.deepEqual(parsed.notifications, { enabled: true, notification_condition: "always" });

      // Idempotent: second run rewrites nothing.
      assert.equal((await ensureKimiTerminalNotificationSettings()).changed, false);
    });
  });

  it("keeps unrelated keys inside an existing Kimi [notifications] section", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-kimi-tui-"));
    const kimiHome = path.join(root, "kimi-home");
    const tuiPath = path.join(kimiHome, "tui.toml");

    await withEnv({ KIMI_CODE_HOME: kimiHome }, async () => {
      await mkdir(kimiHome, { recursive: true });
      await writeFile(tuiPath, '[notifications]\nenabled = false\nsound = "ping"\n');

      const result = await ensureKimiTerminalNotificationSettings();
      assert.equal(result.changed, true);

      const parsed = parseToml(await readFile(tuiPath, "utf8")) as Record<string, unknown>;
      assert.deepEqual(parsed.notifications, {
        enabled: true,
        notification_condition: "always",
        sound: "ping"
      });
    });
  });

  it("creates Kimi tui.toml from scratch when missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-kimi-tui-"));
    const kimiHome = path.join(root, "kimi-home");

    await withEnv({ KIMI_CODE_HOME: kimiHome }, async () => {
      const result = await ensureKimiTerminalNotificationSettings();
      assert.equal(result.changed, true);
      const parsed = parseToml(await readFile(result.path, "utf8")) as Record<string, unknown>;
      assert.deepEqual(parsed.notifications, { enabled: true, notification_condition: "always" });
    });
  });

  it("leaves an invalid Kimi tui.toml untouched (fail-open)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-kimi-tui-"));
    const kimiHome = path.join(root, "kimi-home");
    const tuiPath = path.join(kimiHome, "tui.toml");

    await withEnv({ KIMI_CODE_HOME: kimiHome }, async () => {
      await mkdir(kimiHome, { recursive: true });
      await writeFile(tuiPath, "this is [not = valid toml\n");

      const result = await ensureKimiTerminalNotificationSettings();
      assert.equal(result.changed, false);
      assert.equal(await readFile(tuiPath, "utf8"), "this is [not = valid toml\n");
    });
  });

  it("merges preferredNotifChannel into global Claude settings.json", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-settings-"));
    const claudeHome = path.join(root, "claude-home");
    const settingsPath = path.join(claudeHome, "settings.json");

    await withEnv({ CLAUDE_CONFIG_DIR: claudeHome }, async () => {
      await mkdir(claudeHome, { recursive: true });
      await writeFile(settingsPath, JSON.stringify({ model: "opus", env: { FOO: "bar" } }));

      const result = await ensureClaudeTerminalNotificationSettings();
      assert.equal(result.changed, true);
      assert.equal(result.path, settingsPath);

      const settings = JSON.parse(await readFile(settingsPath, "utf8"));
      assert.equal(settings.model, "opus");
      assert.deepEqual(settings.env, { FOO: "bar" });
      assert.equal(settings.preferredNotifChannel, "terminal_bell");

      assert.equal((await ensureClaudeTerminalNotificationSettings()).changed, false);
    });
  });

  it("merges attention.enabled into global OpenCode tui.json", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-opencode-tui-"));
    const opencodeDir = path.join(root, "opencode");
    const tuiPath = path.join(opencodeDir, "tui.json");

    await withEnv({ OPENCODE_CONFIG_DIR: opencodeDir }, async () => {
      await mkdir(opencodeDir, { recursive: true });
      await writeFile(tuiPath, JSON.stringify({ theme: "system", attention: { sound: true } }));

      const result = await ensureOpenCodeTerminalNotificationSettings();
      assert.equal(result.changed, true);
      assert.equal(result.path, tuiPath);

      const tui = JSON.parse(await readFile(tuiPath, "utf8"));
      assert.equal(tui.theme, "system");
      assert.deepEqual(tui.attention, { sound: true, enabled: true });

      assert.equal((await ensureOpenCodeTerminalNotificationSettings()).changed, false);
    });
  });

  it("resolves OpenCode tui.json under XDG_CONFIG_HOME when OPENCODE_CONFIG_DIR is unset", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-opencode-xdg-"));
    const xdgHome = path.join(root, "xdg");

    await withEnv({ OPENCODE_CONFIG_DIR: undefined, XDG_CONFIG_HOME: xdgHome }, async () => {
      const result = await ensureOpenCodeTerminalNotificationSettings();
      assert.equal(result.changed, true);
      assert.equal(result.path, path.join(xdgHome, "opencode", "tui.json"));
      const tui = JSON.parse(await readFile(result.path, "utf8"));
      assert.deepEqual(tui.attention, { enabled: true });
    });
  });
});
