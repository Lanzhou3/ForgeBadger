import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parse as parseToml } from "smol-toml";

import type { Database } from "../src/db/types.js";
import {
  createLaunchPlan,
  disabledCliHookAdapters,
  prepareAdapterLaunchExtras
} from "../src/services/session-launch-plan.js";

const db = null as unknown as Database;

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

describe("createLaunchPlan TERM_PROGRAM", () => {
  it("sets TERM_PROGRAM=WezTerm for kimi sessions when the host has none", async () => {
    await withEnv({ TERM_PROGRAM: undefined }, async () => {
      const plan = createLaunchPlan({ adapter: "kimi", projectRoot: "/workspace/app", sessionId: "s1" });
      assert.equal(plan.env.TERM_PROGRAM, "WezTerm");
    });
  });

  it("keeps a user-set TERM_PROGRAM for kimi sessions", async () => {
    await withEnv({ TERM_PROGRAM: "iTerm.app" }, async () => {
      const plan = createLaunchPlan({ adapter: "kimi", projectRoot: "/workspace/app", sessionId: "s1" });
      assert.equal(plan.env.TERM_PROGRAM, "iTerm.app");
    });
  });

  it("does not set TERM_PROGRAM for other adapters", async () => {
    await withEnv({ TERM_PROGRAM: undefined }, async () => {
      for (const adapter of ["claude", "opencode", "codex", "pi"] as const) {
        const plan = createLaunchPlan({ adapter, projectRoot: "/workspace/app", sessionId: "s1" });
        assert.equal("TERM_PROGRAM" in plan.env, false, `adapter ${adapter} must not get TERM_PROGRAM`);
      }
    });
  });
});

describe("disabledCliHookAdapters", () => {
  it("parses comma-separated adapter names and ignores codex/pi/unknown values", () => {
    assert.deepEqual([...disabledCliHookAdapters("claude,kimi,opencode")].sort(), ["claude", "kimi", "opencode"]);
    assert.deepEqual([...disabledCliHookAdapters(" claude , kimi ")].sort(), ["claude", "kimi"]);
    assert.deepEqual([...disabledCliHookAdapters("codex,pi,bogus")], []);
    assert.deepEqual([...disabledCliHookAdapters("")], []);
    assert.deepEqual([...disabledCliHookAdapters(undefined)], []);
  });
});

describe("prepareAdapterLaunchExtras hook kill-switch", () => {
  it("skips Kimi hook injection but still writes the native tui.toml when kimi is disabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-disable-hooks-"));
    const kimiHome = path.join(root, "kimi-home");
    const stateDir = path.join(root, "state");
    const projectRoot = path.join(root, "project");

    await withEnv({
      KIMI_CODE_HOME: kimiHome,
      FORGEBADGER_STATE_DIR: stateDir,
      FORGEBADGER_DISABLE_CLI_HOOKS: "kimi"
    }, async () => {
      await prepareAdapterLaunchExtras(db, "user-1", "kimi", projectRoot);

      // Hook injection skipped: no [[hooks]] in config.toml, no forwarding script.
      const configText = await readFile(path.join(kimiHome, "config.toml"), "utf8").catch(() => "");
      assert.doesNotMatch(configText, /ForgeBadger managed notification hooks/);

      // Native terminal notification config still runs (plain config, not a hook).
      const tui = parseToml(await readFile(path.join(kimiHome, "tui.toml"), "utf8")) as Record<string, unknown>;
      assert.deepEqual(tui.notifications, { enabled: true, notification_condition: "always" });
    });
  });

  it("injects Kimi hooks normally when kimi is not listed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-disable-hooks-"));
    const kimiHome = path.join(root, "kimi-home");
    const stateDir = path.join(root, "state");
    const projectRoot = path.join(root, "project");

    await withEnv({
      KIMI_CODE_HOME: kimiHome,
      FORGEBADGER_STATE_DIR: stateDir,
      FORGEBADGER_DISABLE_CLI_HOOKS: "claude"
    }, async () => {
      await prepareAdapterLaunchExtras(db, "user-1", "kimi", projectRoot);
      const configText = await readFile(path.join(kimiHome, "config.toml"), "utf8");
      assert.match(configText, /ForgeBadger managed notification hooks/);
      const tui = parseToml(await readFile(path.join(kimiHome, "tui.toml"), "utf8")) as Record<string, unknown>;
      assert.deepEqual(tui.notifications, { enabled: true, notification_condition: "always" });
    });
  });

  it("skips Claude hook injection but still writes global settings.json when claude is disabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-disable-hooks-"));
    const claudeHome = path.join(root, "claude-home");
    const projectRoot = path.join(root, "project");

    await withEnv({
      CLAUDE_CONFIG_DIR: claudeHome,
      FORGEBADGER_DISABLE_CLI_HOOKS: "claude"
    }, async () => {
      await prepareAdapterLaunchExtras(db, "user-1", "claude", projectRoot);

      // Project-local hook settings must NOT be written.
      const hookText = await readFile(path.join(projectRoot, ".claude", "settings.local.json"), "utf8").catch(() => "");
      assert.doesNotMatch(hookText, /claude-notification/);

      const settings = JSON.parse(await readFile(path.join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.preferredNotifChannel, "terminal_bell");
    });
  });

  it("skips the OpenCode plugin but still writes global tui.json when opencode is disabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-disable-hooks-"));
    const opencodeDir = path.join(root, "opencode");
    const projectRoot = path.join(root, "project");

    await withEnv({
      OPENCODE_CONFIG_DIR: opencodeDir,
      FORGEBADGER_DISABLE_CLI_HOOKS: "opencode"
    }, async () => {
      await prepareAdapterLaunchExtras(db, "user-1", "opencode", projectRoot);

      const plugin = await readFile(
        path.join(projectRoot, ".opencode", "plugins", "forgebadger-permission-notify.js"),
        "utf8"
      ).catch(() => "");
      assert.equal(plugin, "");

      const tui = JSON.parse(await readFile(path.join(opencodeDir, "tui.json"), "utf8"));
      assert.deepEqual(tui.attention, { enabled: true });
    });
  });

  it("never skips Codex hooks even when codex is listed (no terminal channel)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-disable-hooks-"));
    const projectRoot = path.join(root, "project");
    await mkdir(projectRoot, { recursive: true });

    await withEnv({
      FORGEBADGER_STATE_DIR: path.join(root, "state"),
      FORGEBADGER_DISABLE_CLI_HOOKS: "codex"
    }, async () => {
      await prepareAdapterLaunchExtras(db, "user-1", "codex", projectRoot);
      const hooks = JSON.parse(await readFile(path.join(projectRoot, ".codex", "hooks.json"), "utf8"));
      assert.ok(hooks.hooks.PermissionRequest);
    });
  });
});
