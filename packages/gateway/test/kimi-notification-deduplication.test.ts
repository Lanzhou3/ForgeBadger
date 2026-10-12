import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { parse, stringify } from "smol-toml";
import { ensureKimiNotificationSettings } from "../src/services/cli-notification-settings.js";

it("replaces duplicate managed Kimi hooks while retaining custom hooks and config comments", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fb-kimi-dedupe-"));
  const previousHome = process.env.KIMI_CODE_HOME;
  const previousState = process.env.FORGEBADGER_STATE_DIR;
  const home = path.join(root, "kimi");
  const state = path.join(root, "state");
  const project = path.join(root, "project");
  try {
    process.env.KIMI_CODE_HOME = home;
    process.env.FORGEBADGER_STATE_DIR = state;
    await mkdir(home); await mkdir(project);
    const command = `node '${path.join(state, "hooks/kimi-notify.mjs")}'`;
    const userHooks = [
      { event: "Stop", command: "echo user-hook", timeout: 5 },
      { event: "Stop", command, matcher: "custom", timeout: 5 },
      { event: "Stop", command, timeout: 9 }
    ];
    const config = "# Keep my config comment\ndefault_model = 'custom'\n\n" + stringify({ hooks: [
      ...userHooks, { event: "Stop", command, timeout: 5 }, { event: "Stop", command, timeout: 5 }
    ] });
    const file = path.join(home, "config.toml");
    await writeFile(file, config);
    await ensureKimiNotificationSettings(project);
    const text = await readFile(file, "utf8");
    const next = parse(text);
    assert.match(text, /# Keep my config comment/);
    assert.equal(next.default_model, "custom");
    assert.ok(Array.isArray(next.hooks));
    assert.deepEqual(next.hooks.slice(0, 3), userHooks);
    assert.equal(next.hooks.length, userHooks.length + 9);
    assert.equal((await ensureKimiNotificationSettings(project)).changed, false);
  } finally {
    if (previousHome === undefined) delete process.env.KIMI_CODE_HOME; else process.env.KIMI_CODE_HOME = previousHome;
    if (previousState === undefined) delete process.env.FORGEBADGER_STATE_DIR; else process.env.FORGEBADGER_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

it("leaves invalid Kimi config untouched without logging its contents", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fb-kimi-invalid-"));
  const previousHome = process.env.KIMI_CODE_HOME;
  const previousState = process.env.FORGEBADGER_STATE_DIR;
  const originalWarn = console.warn;
  try {
    process.env.KIMI_CODE_HOME = root;
    process.env.FORGEBADGER_STATE_DIR = path.join(root, "state");
    const file = path.join(root, "config.toml");
    const invalid = 'api_key = "private-config-value"\nbroken = [\n';
    await writeFile(file, invalid);
    const warnings: string[] = [];
    console.warn = (...values: unknown[]) => { warnings.push(values.join(" ")); };
    assert.equal((await ensureKimiNotificationSettings(root)).changed, false);
    assert.equal(await readFile(file, "utf8"), invalid);
    assert.match(warnings.join("\n"), /Invalid Kimi configuration/);
    assert.doesNotMatch(warnings.join("\n"), /private-config-value|api_key/);
    await assert.rejects(access(path.join(root, "state/hooks/kimi-notify.mjs")), { code: "ENOENT" });
  } finally {
    console.warn = originalWarn;
    if (previousHome === undefined) delete process.env.KIMI_CODE_HOME; else process.env.KIMI_CODE_HOME = previousHome;
    if (previousState === undefined) delete process.env.FORGEBADGER_STATE_DIR; else process.env.FORGEBADGER_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
