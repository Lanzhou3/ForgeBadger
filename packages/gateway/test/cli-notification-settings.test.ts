import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parse as parseToml } from "smol-toml";

import {
  ensureCodexNotificationSettings,
  ensureKimiNotificationSettings,
  ensurePiNotificationSettings
} from "../src/services/cli-notification-settings.js";

describe("CLI lifecycle notification settings", () => {
  it("merges Codex permission, completion, and session-end hooks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-codex-hooks-"));
    const hooksPath = path.join(root, ".codex", "hooks.json");
    await mkdir(path.dirname(hooksPath), { recursive: true });
    await writeFile(hooksPath, JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "echo existing" }] }] }
    }));

    const result = await ensureCodexNotificationSettings(root);
    const settings = JSON.parse(await readFile(hooksPath, "utf8"));

    assert.equal(result.changed, true);
    assert.equal(settings.hooks.Stop[0].hooks[0].command, "echo existing");
    assert.match(settings.hooks.PermissionRequest[0].hooks.at(-1).command, /forgebadger-notify\.mjs/);
    assert.match(settings.hooks.Stop[0].hooks.at(-1).command, /forgebadger-notify\.mjs/);
    assert.match(settings.hooks.SessionEnd[0].hooks.at(-1).command, /forgebadger-notify\.mjs/);
    assert.equal(settings.hooks.PermissionRequest[0].hooks.at(-1).timeout, 5);
    assert.equal(settings.hooks.Stop[0].hooks.at(-1).timeout, 5);
    assert.equal(settings.hooks.SessionEnd[0].hooks.at(-1).timeout, 3);

    const forwardingScript = await readFile(
      path.join(root, ".codex", "hooks", "forgebadger-notify.mjs"),
      "utf8"
    );
    assert.match(forwardingScript, /adapter: "codex"/);
    assert.match(
      forwardingScript,
      /const requestTimeoutMs = payload\.hook_event_name === "SessionEnd" \? 2500 : 4500;/
    );
    assert.match(forwardingScript, /AbortSignal\.timeout\(requestTimeoutMs\)/);
    assert.equal((await ensureCodexNotificationSettings(root)).changed, false);
  });

  it("installs Kimi hooks into the global config and cleans up legacy project blocks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-kimi-hooks-"));
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
      "# ForgeBadger managed notification hooks: start\n[[hooks]]\nevent = \"Stop\"\ncommand = \"node old.mjs\"\n# ForgeBadger managed notification hooks: end\n"
    );

    const previousKimiHome = process.env.KIMI_CODE_HOME;
    const previousStateDir = process.env.FORGEBADGER_STATE_DIR;
    process.env.KIMI_CODE_HOME = kimiHome;
    process.env.FORGEBADGER_STATE_DIR = stateDir;
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
        ["Interrupt", "Notification", "PermissionRequest", "SessionEnd", "Stop", "StopFailure"].sort()
      );
      assert.ok(config.hooks?.every((hook) => hook.matcher === undefined));
      assert.ok(
        config.hooks?.every((hook) =>
          hook.command?.includes(path.join(stateDir, "hooks", "kimi-notify.mjs"))
        )
      );
      const forwardingScript = await readFile(
        path.join(stateDir, "hooks", "kimi-notify.mjs"),
        "utf8"
      );
      assert.match(forwardingScript, /adapter: "kimi"/);
      assert.match(forwardingScript, /const requestTimeoutMs = 4500;/);
      // Legacy per-project block is removed because Kimi never reads it.
      assert.doesNotMatch(await readFile(projectConfigPath, "utf8"), /ForgeBadger managed notification hooks/);
      assert.equal((await ensureKimiNotificationSettings(projectRoot)).changed, false);
    } finally {
      if (previousKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = previousKimiHome;
      if (previousStateDir === undefined) delete process.env.FORGEBADGER_STATE_DIR;
      else process.env.FORGEBADGER_STATE_DIR = previousStateDir;
    }
  });

  it("installs the PI notification extension into the global extensions dir", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-pi-notify-"));
    const piAgentDir = path.join(root, "pi-agent");
    const extensionPath = path.join(piAgentDir, "extensions", "forgebadger-notify.ts");

    const previousPiDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = piAgentDir;
    try {
      const result = await ensurePiNotificationSettings();
      assert.equal(result.changed, true);
      assert.equal(result.path, extensionPath);

      const source = await readFile(extensionPath, "utf8");
      assert.match(source, /do not edit by hand/);
      // Session identity comes from the environment, never baked into the file.
      assert.match(source, /FORGEBADGER_SESSION_ID/);
      assert.match(source, /FORGEBADGER_GATEWAY_URL/);
      assert.match(source, /FORGEBADGER_ATTACH_TOKEN/);
      assert.doesNotMatch(source, /\bsk-[A-Za-z0-9]/);
      // Event mapping: settled turn, blocking user prompt, shutdown.
      assert.match(source, /pi\.on\("agent_settled"/);
      assert.match(source, /pi\.on\("ui_prompt_start"/);
      assert.match(source, /pi\.on\("session_shutdown"/);
      assert.match(source, /post\("Stop"\)/);
      assert.match(source, /"PermissionRequest"/);
      assert.match(source, /await post\("SessionEnd"\)/);
      assert.match(source, /adapter: "pi"/);
      // Idempotent: second call rewrites nothing.
      assert.equal((await ensurePiNotificationSettings()).changed, false);
    } finally {
      if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousPiDir;
    }
  });

  it("keeps the generated PI extension syntax-valid and fail-open", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-pi-notify-"));
    const piAgentDir = path.join(root, "pi-agent");

    const previousPiDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = piAgentDir;
    try {
      await ensurePiNotificationSettings();
      const source = await readFile(
        path.join(piAgentDir, "extensions", "forgebadger-notify.ts"),
        "utf8"
      );
      // The extension is JS-compatible TS loaded by pi's jiti; it must not use
      // type annotations or imports, and must no-op without ForgeBadger env.
      assert.doesNotMatch(source, /:\s*(string|void|unknown|any)\b/u);
      assert.doesNotMatch(source, /^import /mu);
      assert.match(source, /if \(!sessionId \|\| !gatewayUrl \|\| !attachToken\) return;/);

      // Syntax check as an ES module.
      const { execFileSync } = await import("node:child_process");
      const checkFile = path.join(root, "check.mjs");
      await writeFile(checkFile, source, "utf8");
      execFileSync(process.execPath, ["--check", checkFile], { stdio: "pipe" });
    } finally {
      if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousPiDir;
    }
  });
});
