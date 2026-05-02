import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildOpenForgeClaudeHookSettings,
  ensureClaudeNotificationSettings
} from "../src/services/claude-notification-settings.js";

describe("Claude notification settings", () => {
  it("builds HTTP forwarding hooks for permission and notification events", () => {
    const settings = buildOpenForgeClaudeHookSettings("http://127.0.0.1:48731", "openforge-session-id");

    const permissionHook = settings.hooks.PermissionRequest[0]?.hooks[0];
    assert.equal(permissionHook?.type, "http");
    assert.equal(permissionHook?.url, "http://127.0.0.1:48731/api/v1/session-hooks/claude-notification/openforge-session-id");
    assert.equal(permissionHook?.headers?.["x-openforge-session-id"], "$OPENFORGE_SESSION_ID");
    assert.equal(permissionHook?.headers?.["x-openforge-session-token"], "$OPENFORGE_ATTACH_TOKEN");
    assert.deepEqual(permissionHook?.allowedEnvVars, ["OPENFORGE_SESSION_ID", "OPENFORGE_ATTACH_TOKEN"]);
    assert.equal(settings.hooks.PermissionDenied[0]?.hooks[0]?.type, "http");
    assert.equal(settings.hooks.Notification[0]?.matcher, "permission_prompt");
    const notificationHook = settings.hooks.Notification[0]?.hooks[0];
    assert.equal(notificationHook?.type, "http");
    assert.equal(notificationHook?.url, "http://127.0.0.1:48731/api/v1/session-hooks/claude-notification/openforge-session-id");
    assert.doesNotMatch(String(notificationHook?.url), /session-token-value|attach-token-value/);
  });

  it("merges OpenForge hooks into project-local Claude settings without clobbering existing hooks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-claude-hooks-"));
    const settingsPath = path.join(root, ".claude", "settings.local.json");
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
        }
      }, null, 2)
    );

    const result = await ensureClaudeNotificationSettings(root, "http://127.0.0.1:48731", "session-for-settings");

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(result.changed, true);
    assert.equal(settings.hooks.Stop[0].hooks[0].command, "echo done");
    assert.equal(settings.hooks.PermissionRequest[0].hooks[0].type, "http");
    assert.match(settings.hooks.PermissionRequest[0].hooks[0].url, /claude-notification\/session-for-settings/);
    assert.equal(settings.hooks.Notification.some((group: { matcher?: string }) => group.matcher === "permission_prompt"), true);
  });

  it("replaces prior OpenForge session-scoped hooks when a new session starts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-claude-hooks-replace-"));
    const settingsPath = path.join(root, ".claude", "settings.local.json");

    await ensureClaudeNotificationSettings(root, "http://127.0.0.1:48731", "first-session");
    await ensureClaudeNotificationSettings(root, "http://127.0.0.1:48731", "second-session");

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const permissionHooks = settings.hooks.PermissionRequest[0].hooks.filter(
      (hook: { url?: string }) => hook.url?.includes("/api/v1/session-hooks/claude-notification")
    );
    assert.equal(permissionHooks.length, 1);
    assert.match(permissionHooks[0].url, /second-session/);
    assert.doesNotMatch(permissionHooks[0].url, /first-session/);
  });
});
