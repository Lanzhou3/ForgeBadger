import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { buildForgeBadgerClaudeHookSettings, ensureClaudeNotificationSettings } from "../src/services/claude-notification-settings.js";
import { ensurePiNotificationSettings } from "../src/services/cli-notification-settings.js";
import { FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE } from "../src/services/opencode-notification-settings.js";

type Handler = (event?: Record<string, unknown>) => void | Promise<void>;
interface NotificationModule {
  ForgeBadgerPermissionNotify: (input?: unknown) => Promise<{ event: (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void> }>;
  default: (api: { on: (event: string, handler: Handler) => void }) => void;
}

describe("adapter notification regressions", () => {
  it("registers Claude API failures and preserves custom hooks when merging", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fb-claude-failure-"));
    try {
      const settings = buildForgeBadgerClaudeHookSettings("http://127.0.0.1:48731");
      assert.deepEqual(settings.hooks.StopFailure, settings.hooks.Stop);
      const result = await ensureClaudeNotificationSettings(root, "http://127.0.0.1:48731");
      const saved = JSON.parse(await readFile(result.path, "utf8"));
      saved.hooks.StopFailure.push({ matcher: "rate_limit", hooks: [{ type: "command", command: "echo custom" }] });
      await writeFile(result.path, JSON.stringify(saved));
      await ensureClaudeNotificationSettings(root, "http://127.0.0.1:48731");
      const merged = JSON.parse(await readFile(result.path, "utf8"));
      assert.deepEqual(merged.hooks.StopFailure, saved.hooks.StopFailure);
      assert.equal((await ensureClaudeNotificationSettings(root, "http://127.0.0.1:48731")).changed, false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  for (const adapter of ["opencode", "pi"] as const) {
    it(`${adapter} reports failed deliveries safely, preserving successful lifecycle delivery`, async () => {
      const root = await mkdtemp(path.join(tmpdir(), "fb-plugin-delivery-"));
      const env = { ...process.env };
      const originalFetch = globalThis.fetch;
      const originalWarn = console.warn;
      try {
        Object.assign(process.env, { PI_CODING_AGENT_DIR: root, FORGEBADGER_SESSION_ID: "session-1",
          FORGEBADGER_ATTACH_TOKEN: "private-test-token", FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:48731" });
        let source = FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE;
        if (adapter === "pi") source = await readFile((await ensurePiNotificationSettings()).path, "utf8");
        const file = path.join(root, "notify.mjs");
        await writeFile(file, source);
        const module = await import(pathToFileURL(file).href) as NotificationModule;
        const handlers = new Map<string, Handler>();
        const plugin = adapter === "opencode" ? await module.ForgeBadgerPermissionNotify({client:{session:{get:async()=>({data:{id:"root"}})}}}) : undefined;
        if (adapter === "pi") module.default({ on: (event: string, handler: Handler) => handlers.set(event, handler) });
        const deliver = async () => {
          if (plugin) { await plugin.event({event:{type:"session.status",properties:{sessionID:"root",status:{type:"busy"}}}}); await plugin.event({ event: { type: "session.idle",properties:{sessionID:"root"} } }); }
          else await handlers.get("session_shutdown")!();
        };
        const warnings: string[] = [];
        console.warn = (...values: unknown[]) => { warnings.push(values.join(" ")); };
        for (const status of [200, 401, 503]) {
          warnings.length = 0;
          globalThis.fetch = async (_url, options) => {
            const headers = new Headers(options?.headers);
            assert.equal(headers.get("x-forgebadger-session-id"), "session-1");
            assert.equal(headers.get("x-forgebadger-session-token"), "private-test-token");
            assert.equal(JSON.parse(String(options?.body)).adapter, adapter);
            return new Response("private-response", { status });
          };
          await deliver();
          if (status === 200) assert.deepEqual(warnings, []);
          else assert.match(warnings.join("\n"), new RegExp(`HTTP ${status}`));
          if (status === 401) assert.match(warnings.join("\n"), /restart.*CLI session/i);
          assert.doesNotMatch(warnings.join("\n"), /private-|session-1|127\.0\.0\.1/);
        }
        warnings.length = 0;
        globalThis.fetch = async () => { throw new Error("private-test-token"); };
        await deliver();
        assert.match(warnings.join("\n"), /could not reach Gateway/);
        assert.doesNotMatch(warnings.join("\n"), /private-test-token/);
      } finally {
        globalThis.fetch = originalFetch; console.warn = originalWarn;
        for (const key of ["PI_CODING_AGENT_DIR", "FORGEBADGER_SESSION_ID", "FORGEBADGER_ATTACH_TOKEN", "FORGEBADGER_GATEWAY_URL"]) {
          if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
        }
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
