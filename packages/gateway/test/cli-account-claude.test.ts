import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";

import {
  buildClaudeAccountOverview,
  observeClaudeLogin,
  observeClaudeQuota,
  resetClaudeAccountProbeCache
} from "../src/services/cli-account/claude-account.js";
import { claudeKeychainAccount, claudeKeychainServiceName } from "../src/services/cli-account/claude-keychain.js";

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
      buildClaudeAccountOverview("user-claude", { run, env: {}, homeDir: "/nonexistent-home", readKeychain: async () => ({ status: "missing" }) }),
      buildClaudeAccountOverview("user-claude", { run, env: {}, homeDir: "/nonexistent-home", readKeychain: async () => ({ status: "missing" }) })
    ]);
    assert.equal(first.login.state, "ready");
    assert.deepEqual(first.login, second.login);
    assert.equal(calls, 1);
    await buildClaudeAccountOverview("user-claude", { run, env: {}, homeDir: "/nonexistent-home", readKeychain: async () => ({ status: "missing" }) });
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
  it("degrades to no_native_login off macOS when no token source exists", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-account-"));
    try {
      let keychainCalls = 0;
      const quota = await observeClaudeQuota({
        env: {},
        homeDir: home,
        platform: "linux",
        readKeychain: async () => {
          keychainCalls += 1;
          return { status: "missing" };
        }
      });
      assert.equal(quota.supported, false);
      assert.equal(quota.unsupportedReason, "no_native_login");
      assert.deepEqual(quota.entries, []);
      assert.equal(keychainCalls, 0);
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
        env: {},
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
        env: {},
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
        env: {},
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
        env: {},
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
      const quota = await observeClaudeQuota({
        env: {},
        homeDir: home,
        platform: "darwin",
        readKeychain: async () => ({ status: "missing" })
      });
      assert.equal(quota.supported, false);
      assert.equal(quota.unsupportedReason, "no_native_login");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("claude cli-account quota token sources", () => {
  async function makeHome(settings?: unknown): Promise<string> {
    const home = await mkdtemp(path.join(tmpdir(), "forgebadger-claude-account-"));
    const root = path.join(home, ".claude");
    await mkdir(root, { recursive: true });
    if (settings !== undefined) await writeFile(path.join(root, "settings.json"), JSON.stringify(settings));
    return home;
  }

  function recordingFetch(response: () => Response): { fetchImpl: typeof fetch; auths: Array<string | null> } {
    const auths: Array<string | null> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      auths.push(new Headers(init?.headers).get("authorization"));
      return response();
    };
    return { fetchImpl, auths };
  }

  const usageBody = { five_hour: { utilization: 7 } };

  it("uses CLAUDE_CODE_OAUTH_TOKEN from the settings env block before the process env and stored login", async () => {
    const home = await makeHome({ env: { CLAUDE_CODE_OAUTH_TOKEN: "settings-setup-token" } });
    await writeFile(
      path.join(home, ".claude", ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: secretToken } }),
      { mode: 0o600 }
    );
    try {
      const { fetchImpl, auths } = recordingFetch(() => jsonResponse(usageBody));
      const quota = await observeClaudeQuota({
        env: { CLAUDE_CODE_OAUTH_TOKEN: "process-setup-token" },
        homeDir: home,
        fetchImpl
      });
      assert.equal(quota.supported, true);
      assert.deepEqual(auths, ["Bearer settings-setup-token"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("falls back to CLAUDE_CODE_OAUTH_TOKEN from the process env", async () => {
    const home = await makeHome();
    try {
      const { fetchImpl, auths } = recordingFetch(() => jsonResponse(usageBody));
      const quota = await observeClaudeQuota({
        env: { CLAUDE_CODE_OAUTH_TOKEN: "process-setup-token" },
        homeDir: home,
        platform: "darwin",
        readKeychain: async () => assert.fail("keychain must not be read when a setup token exists"),
        fetchImpl
      });
      assert.deepEqual(quota.entries, [{ label: "5h window", unit: "percent", usedPercent: 7 }]);
      assert.deepEqual(auths, ["Bearer process-setup-token"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports setup_token_scope on 403 for a setup token and token_expired on 401", async () => {
    const home = await makeHome({ env: { CLAUDE_CODE_OAUTH_TOKEN: "settings-setup-token" } });
    try {
      const forbidden = await observeClaudeQuota({
        env: {},
        homeDir: home,
        fetchImpl: async () => jsonResponse({ error: "insufficient scope" }, 403)
      });
      assert.equal(forbidden.supported, false);
      assert.equal(forbidden.unsupportedReason, "setup_token_scope");
      const unauthorized = await observeClaudeQuota({
        env: {},
        homeDir: home,
        fetchImpl: async () => jsonResponse({ error: "unauthorized" }, 401)
      });
      assert.equal(unauthorized.unsupportedReason, "token_expired");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("keeps 403 as token_expired for a stored login", async () => {
    const home = await makeHomeWithCredentials({ claudeAiOauth: { accessToken: secretToken } });
    try {
      const quota = await observeClaudeQuota({
        env: {},
        homeDir: home,
        fetchImpl: async () => jsonResponse({ error: "forbidden" }, 403)
      });
      assert.equal(quota.unsupportedReason, "token_expired");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reads the stored login from the macOS Keychain when the credentials file is absent", async () => {
    const home = await makeHome();
    try {
      const lookups: Array<{ service: string; account: string }> = [];
      const { fetchImpl, auths } = recordingFetch(() => jsonResponse(usageBody));
      const quota = await observeClaudeQuota({
        env: { USER: "dev-user" },
        homeDir: home,
        platform: "darwin",
        readKeychain: async (service, account) => {
          lookups.push({ service, account });
          return { status: "found", secret: JSON.stringify({ claudeAiOauth: { accessToken: secretToken } }) };
        },
        fetchImpl
      });
      assert.equal(quota.supported, true);
      assert.deepEqual(lookups, [{ service: "Claude Code-credentials", account: "dev-user" }]);
      assert.deepEqual(auths, [`Bearer ${secretToken}`]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("decodes hex-encoded macOS Keychain credentials", async () => {
    const home = await makeHome();
    try {
      const { fetchImpl, auths } = recordingFetch(() => jsonResponse(usageBody));
      const secret = Buffer.from(JSON.stringify({ claudeAiOauth: { accessToken: secretToken } }), "utf8")
        .toString("hex").toUpperCase();
      const quota = await observeClaudeQuota({
        env: {},
        homeDir: home,
        platform: "darwin",
        readKeychain: async () => ({ status: "found", secret }),
        fetchImpl
      });
      assert.equal(quota.supported, true);
      assert.deepEqual(auths, [`Bearer ${secretToken}`]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("treats malformed Keychain payloads as no native login", async () => {
    const home = await makeHome();
    try {
      for (const secret of ["abc", "not-hex", Buffer.from("{broken", "utf8").toString("hex")]) {
        const quota = await observeClaudeQuota({
          env: {},
          homeDir: home,
          platform: "darwin",
          readKeychain: async () => ({ status: "found", secret }),
          fetchImpl: async () => assert.fail("no token means no usage request")
        });
        assert.equal(quota.unsupportedReason, "no_native_login");
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("treats a Keychain item without claudeAiOauth as no native login", async () => {
    const home = await makeHome();
    try {
      const quota = await observeClaudeQuota({
        env: {},
        homeDir: home,
        platform: "darwin",
        readKeychain: async () => ({ status: "found", secret: JSON.stringify({ mcpOAuth: {} }) }),
        fetchImpl: async () => assert.fail("no token means no usage request")
      });
      assert.equal(quota.unsupportedReason, "no_native_login");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports keychain when the Keychain read fails", async () => {
    const home = await makeHome();
    try {
      const quota = await observeClaudeQuota({
        env: {},
        homeDir: home,
        platform: "darwin",
        readKeychain: async () => ({ status: "error" })
      });
      assert.equal(quota.unsupportedReason, "keychain");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("claude keychain naming", () => {
  it("matches Claude Code's default and config-dir-hashed service names", () => {
    assert.equal(claudeKeychainServiceName({}), "Claude Code-credentials");
    const hash = createHash("sha256").update("/tmp/claude-alt").digest("hex").slice(0, 8);
    assert.equal(claudeKeychainServiceName({ CLAUDE_CONFIG_DIR: "/tmp/claude-alt" }), `Claude Code-credentials-${hash}`);
    assert.equal(
      claudeKeychainServiceName({ CLAUDE_CONFIG_DIR: "/tmp/claude-alt", CLAUDE_SECURESTORAGE_CONFIG_DIR: "" }),
      "Claude Code-credentials"
    );
  });

  it("falls back to a safe account name for unexpected USER values", () => {
    assert.equal(claudeKeychainAccount({ USER: "dev.user-1" }), "dev.user-1");
    assert.equal(claudeKeychainAccount({ USER: "bad user;rm" }), "claude-code-user");
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
