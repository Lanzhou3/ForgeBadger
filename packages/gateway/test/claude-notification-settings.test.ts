import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildForgeBadgerClaudeHookSettings,
  ensureClaudeNotificationSettings
} from "../src/services/claude-notification-settings.js";

describe("Claude notification settings", () => {
  it("builds HTTP forwarding hooks for permission and lifecycle events", () => {
    const settings = buildForgeBadgerClaudeHookSettings("http://127.0.0.1:48731");

    const permissionHook = settings.hooks.PermissionRequest[0]?.hooks[0];
    assert.equal(permissionHook?.type, "http");
    assert.equal(permissionHook?.url, "http://127.0.0.1:48731/api/v1/session-hooks/claude-notification");
    assert.equal(permissionHook?.headers?.["x-forgebadger-session-id"], "$FORGEBADGER_SESSION_ID");
    assert.equal(permissionHook?.headers?.["x-forgebadger-session-token"], "$FORGEBADGER_ATTACH_TOKEN");
    assert.deepEqual(permissionHook?.allowedEnvVars, ["FORGEBADGER_SESSION_ID", "FORGEBADGER_ATTACH_TOKEN"]);
    assert.deepEqual(settings.allowedHttpHookUrls, [
      "http://127.0.0.1:48731/api/v1/session-hooks/claude-notification*"
    ]);
    assert.deepEqual(settings.httpHookAllowedEnvVars, [
      "FORGEBADGER_SESSION_ID",
      "FORGEBADGER_ATTACH_TOKEN"
    ]);
    assert.equal(settings.hooks.PermissionDenied[0]?.hooks[0]?.type, "http");
    assert.equal(settings.hooks.Stop[0]?.hooks[0]?.type, "http");
    assert.equal(settings.hooks.SessionEnd[0]?.hooks[0]?.type, "http");
    assert.equal(settings.hooks.Notification[0]?.matcher, "permission_prompt");
    const notificationHook = settings.hooks.Notification[0]?.hooks[0];
    assert.equal(notificationHook?.type, "http");
    assert.equal(notificationHook?.url, "http://127.0.0.1:48731/api/v1/session-hooks/claude-notification");
    assert.doesNotMatch(String(notificationHook?.url), /session-token-value|attach-token-value/);
    assert.equal(settings.hooks.SessionStart, undefined);
    assert.equal(settings.httpHookAllowedEnvVars.includes("FORGEBADGER_PORTFOLIO_WORKER_ACK_CAPABILITY"), false);
  });

  it("merges ForgeBadger hooks into project-local Claude settings without clobbering existing hooks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-hooks-"));
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

    const result = await ensureClaudeNotificationSettings(root, "http://127.0.0.1:48731");

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(result.changed, true);
    assert.equal(settings.hooks.Stop[0].hooks[0].command, "echo done");
    assert.equal(settings.hooks.PermissionRequest[0].hooks[0].type, "http");
    assert.equal(
      settings.hooks.PermissionRequest[0].hooks[0].url,
      "http://127.0.0.1:48731/api/v1/session-hooks/claude-notification"
    );
    assert.equal(settings.hooks.Notification.some((group: { matcher?: string }) => group.matcher === "permission_prompt"), true);
  });

  it("writes a single session-agnostic hook that never changes across sessions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-hooks-stable-"));
    const settingsPath = path.join(root, ".claude", "settings.local.json");

    const first = await ensureClaudeNotificationSettings(root, "http://127.0.0.1:48731");
    const second = await ensureClaudeNotificationSettings(root, "http://127.0.0.1:48731");

    assert.equal(first.changed, true);
    // The hook is session-agnostic, so a second session must not rewrite the
    // shared file — that rewrite was what let one session's stale URL clobber
    // another's and cause 401s.
    assert.equal(second.changed, false);

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const permissionHooks = settings.hooks.PermissionRequest[0].hooks.filter(
      (hook: { url?: string }) => hook.url?.includes("/api/v1/session-hooks/claude-notification")
    );
    assert.equal(permissionHooks.length, 1);
    assert.doesNotMatch(permissionHooks[0].url, /session-for|first-session|second-session/);
  });

  it("preserves existing HTTP hook allowlists while adding ForgeBadger entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-hooks-allowlist-"));
    const settingsPath = path.join(root, ".claude", "settings.local.json");
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          allowedHttpHookUrls: ["https://hooks.example.com/*"],
          httpHookAllowedEnvVars: ["EXISTING_TOKEN"]
        },
        null,
        2
      )
    );

    await ensureClaudeNotificationSettings(root, "http://127.0.0.1:48731");

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(settings.allowedHttpHookUrls, [
      "https://hooks.example.com/*",
      "http://127.0.0.1:48731/api/v1/session-hooks/claude-notification*"
    ]);
    assert.deepEqual(settings.httpHookAllowedEnvVars, [
      "EXISTING_TOKEN",
      "FORGEBADGER_SESSION_ID",
      "FORGEBADGER_ATTACH_TOKEN"
    ]);
  });
});
