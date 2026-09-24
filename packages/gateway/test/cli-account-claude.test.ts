import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildClaudeAccountOverview,
  observeClaudeLogin,
  observeClaudeQuota,
  resetClaudeAccountProbeCache
} from "../src/services/cli-account/claude-account.js";

const secretToken = "claude-oauth-token-material";
// Isolated config root for login-probe tests: the check for a routed
// endpoint reads <root>/settings.json, so the real user's ~/.claude (which on
// a dev machine may itself be routed) must not leak into the assertions.
const ISOLATED_HOME = "/nonexistent-claude-probe-home";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function makeHomeWithCredentials(credentials: unknown): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-account-"));
  const root = path.join(home, ".claude");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, ".credentials.json"), JSON.stringify(credentials), { mode: 0o600 });
  return home;
}

describe("claude cli-account login probe", () => {
  it("maps exit code 0 to ready with authMethod/email from the JSON payload", async () => {
    const status = await observeClaudeLogin({
      env: {},
      homeDir: ISOLATED_HOME,
      run: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "user@example.com", subscriptionType: "max" }),
        stderr: ""
      })
    });
    assert.deepEqual(status, {
      adapter: "claude",
      state: "ready",
      method: "claude.ai",
      accountLabel: "user@example.com"
    });
  });

  it("defaults the method and tolerates unknown JSON fields", async () => {
    const status = await observeClaudeLogin({
      env: {},
      homeDir: ISOLATED_HOME,
      run: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ loggedIn: true, futureField: { nested: true } }),
        stderr: ""
      })
    });
    assert.deepEqual(status, { adapter: "claude", state: "ready", method: "claude.ai" });
  });

  it("keeps ready on exit 0 with loggedIn:false and passes the raw value through (issue #84394)", async () => {
    const status = await observeClaudeLogin({
      env: {},
      homeDir: ISOLATED_HOME,
      run: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ loggedIn: false, authMethod: "claude.ai" }),
        stderr: ""
      })
    });
    assert.deepEqual(status, {
      adapter: "claude",
      state: "ready",
      method: "claude.ai",
      detailCode: "loggedIn:false"
    });
  });

  it("maps exit code 1 to not_authenticated per the CLI contract", async () => {
    const status = await observeClaudeLogin({
      env: {},
      homeDir: ISOLATED_HOME,
      run: async () => ({ exitCode: 1, stdout: "", stderr: "Not logged in" })
    });
    assert.deepEqual(status, { adapter: "claude", state: "not_authenticated", method: "unknown" });
  });

  it("maps other non-zero exits, missing binary and failures to unknown/cli_missing", async () => {
    const unknown = await observeClaudeLogin({
      env: {},
      homeDir: ISOLATED_HOME,
      run: async () => ({ exitCode: 2, stdout: "", stderr: "boom" })
    });
    assert.deepEqual(unknown, { adapter: "claude", state: "unknown", method: "unknown" });
    const missing = await observeClaudeLogin({
      env: {},
      homeDir: ISOLATED_HOME,
      run: async () => {
        const error = new Error("spawn claude ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
    });
    assert.deepEqual(missing, { adapter: "claude", state: "cli_missing", method: "unknown" });
  });

  it("reports custom_endpoint and skips the probe when the global config routes to a non-Anthropic base URL", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-account-"));
    const root = path.join(home, ".claude");
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "http://127.0.0.1:15721",
          ANTHROPIC_AUTH_TOKEN: "route-token-material"
        }
      })
    );
    try {
      let probed = false;
      const status = await observeClaudeLogin({
        env: {},
        homeDir: home,
        run: async () => {
          probed = true;
          return { exitCode: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "oauth_token" }), stderr: "" };
        }
      });
      assert.deepEqual(status, { adapter: "claude", state: "custom_endpoint" });
      assert.equal(probed, false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("still probes native login when the base URL stays on api.anthropic.com", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-account-"));
    const root = path.join(home, ".claude");
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" } })
    );
    try {
      const status = await observeClaudeLogin({
        env: {},
        homeDir: home,
        run: async () => ({
          exitCode: 0,
          stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
          stderr: ""
        })
      });
      assert.deepEqual(status, { adapter: "claude", state: "ready", method: "claude.ai" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("ignores a malformed settings.json and falls back to the probe", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-account-"));
    const root = path.join(home, ".claude");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "settings.json"), "{not json");
    try {
      const status = await observeClaudeLogin({
        env: {},
        homeDir: home,
        run: async () => ({
          exitCode: 0,
          stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
          stderr: ""
        })
      });
      assert.deepEqual(status, { adapter: "claude", state: "ready", method: "claude.ai" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("singleflights and briefly caches login probes per user", async () => {
    resetClaudeAccountProbeCache();
    let calls = 0;
    const run = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { exitCode: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: "" };
    };
    const [first, second] = await Promise.all([
      buildClaudeAccountOverview("user-claude", { run, env: {}, homeDir: "/nonexistent-home" }),
      buildClaudeAccountOverview("user-claude", { run, env: {}, homeDir: "/nonexistent-home" })
    ]);
    assert.equal(first.login.state, "ready");
    assert.deepEqual(first.login, second.login);
    assert.equal(calls, 1);
    await buildClaudeAccountOverview("user-claude", { run, env: {}, homeDir: "/nonexistent-home" });
    assert.equal(calls, 1);
  });

  it("passes only an allowlisted environment to the auth status process", async () => {
    const previous = {
      masterKey: process.env.FORGEBADGER_MASTER_KEY,
      jwtSecret: process.env.FORGEBADGER_JWT_SECRET,
      claudeConfigDir: process.env.CLAUDE_CONFIG_DIR
    };
    process.env.FORGEBADGER_MASTER_KEY = "must-not-reach-claude";
    process.env.FORGEBADGER_JWT_SECRET = "must-not-reach-claude";
    process.env.CLAUDE_CONFIG_DIR = "/tmp/claude-account-status-home";
    try {
      let observedEnv: NodeJS.ProcessEnv | undefined;
      const status = await observeClaudeLogin({
        env: {},
        homeDir: ISOLATED_HOME,
        run: async (command, args, _signal, options) => {
          assert.equal(command, "claude");
          assert.deepEqual(args, ["auth", "status"]);
          observedEnv = options.env;
          return { exitCode: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: "" };
        }
      });
      assert.equal(status.state, "ready");
      assert.ok(observedEnv);
      assert.equal(observedEnv.FORGEBADGER_MASTER_KEY, undefined);
      assert.equal(observedEnv.FORGEBADGER_JWT_SECRET, undefined);
      const observedPath = Object.entries(observedEnv).find(([key]) => key.toUpperCase() === "PATH")?.[1];
      assert.equal(observedPath, process.env.PATH);
      assert.equal(observedEnv.CLAUDE_CONFIG_DIR, "/tmp/claude-account-status-home");
    } finally {
      restoreEnv("FORGEBADGER_MASTER_KEY", previous.masterKey);
      restoreEnv("FORGEBADGER_JWT_SECRET", previous.jwtSecret);
      restoreEnv("CLAUDE_CONFIG_DIR", previous.claudeConfigDir);
    }
  });
});

describe("claude cli-account quota probe", () => {
  it("degrades to no_native_login when the credentials file is absent", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-account-"));
    try {
      const quota = await observeClaudeQuota({ homeDir: home });
      assert.equal(quota.supported, false);
      if (process.platform === "darwin") {
        assert.equal(quota.unsupportedReason, "keychain");
      } else {
        assert.equal(quota.unsupportedReason, "no_native_login");
      }
      assert.deepEqual(quota.entries, []);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("maps the legacy flat usage format to quota entries", async () => {
    const home = await makeHomeWithCredentials({
      claudeAiOauth: { accessToken: secretToken, expiresAt: Date.now() + 60_000 }
    });
    try {
      const seen: Array<{ url: string; auth: string | null; beta: string | null }> = [];
      const quota = await observeClaudeQuota({
        homeDir: home,
        fetchImpl: async (url, init) => {
          const headers = new Headers(init?.headers);
          seen.push({ url: String(url), auth: headers.get("authorization"), beta: headers.get("anthropic-beta") });
          return jsonResponse({
            five_hour: { utilization: 12, resets_at: "2026-09-25T12:00:00.000Z" },
            seven_day: { utilization: 34, resets_at: "2026-09-28T00:00:00.000Z" },
            seven_day_sonnet: { utilization: 40 },
            seven_day_opus: { utilization: 55 }
          });
        }
      });
      assert.equal(quota.supported, true);
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.url, "https://api.anthropic.com/api/oauth/usage");
      assert.equal(seen[0]?.auth, `Bearer ${secretToken}`);
      assert.equal(seen[0]?.beta, "oauth-2025-04-20");
      assert.deepEqual(quota.entries, [
        { label: "5h window", unit: "percent", usedPercent: 12, resetsAt: "2026-09-25T12:00:00.000Z" },
        { label: "Weekly window", unit: "percent", usedPercent: 34, resetsAt: "2026-09-28T00:00:00.000Z" },
        { label: "Weekly (Sonnet)", unit: "percent", usedPercent: 40 },
        { label: "Weekly (Opus)", unit: "percent", usedPercent: 55 }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("maps the newer limits[] usage format to quota entries", async () => {
    const home = await makeHomeWithCredentials({ claudeAiOauth: { accessToken: secretToken } });
    try {
      const quota = await observeClaudeQuota({
        homeDir: home,
        fetchImpl: async () => jsonResponse({
          planType: "max",
          limits: [
            { type: "five_hour", utilization: 20, resets_at: "2026-09-25T12:00:00.000Z" },
            { type: "seven_day_opus", used_percent: "41.5", reset_at: "2026-09-28T00:00:00.000Z" },
            { type: "mystery_future_window", utilization: 1 }
          ]
        })
      });
      assert.equal(quota.supported, true);
      assert.equal(quota.planLabel, "max");
      assert.deepEqual(quota.entries, [
        { label: "5h window", unit: "percent", usedPercent: 20, resetsAt: "2026-09-25T12:00:00.000Z" },
        { label: "Weekly (Opus)", unit: "percent", usedPercent: 41.5, resetsAt: "2026-09-28T00:00:00.000Z" },
        { label: "mystery_future_window", unit: "percent", usedPercent: 1 }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("marks token_expired on 401 and upstream_error on 5xx without throwing", async () => {
    const home = await makeHomeWithCredentials({ claudeAiOauth: { accessToken: secretToken } });
    try {
      const unauthorized = await observeClaudeQuota({
        homeDir: home,
        fetchImpl: async () => jsonResponse({ error: "unauthorized" }, 401)
      });
      assert.deepEqual(unauthorized, {
        supported: false,
        unsupportedReason: "token_expired",
        entries: [],
        fetchedAt: unauthorized.fetchedAt
      });
      const serverError = await observeClaudeQuota({
        homeDir: home,
        fetchImpl: async () => jsonResponse({ error: "boom" }, 500)
      });
      assert.equal(serverError.supported, false);
      assert.equal(serverError.unsupportedReason, "upstream_error");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("never leaks the access token into errors when the credentials file is malformed", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-account-"));
    const root = path.join(home, ".claude");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, ".credentials.json"), "{not json", { mode: 0o600 });
    try {
      const quota = await observeClaudeQuota({ homeDir: home });
      assert.equal(quota.supported, false);
      assert.equal(quota.unsupportedReason, process.platform === "darwin" ? "keychain" : "no_native_login");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
