import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildCodexAccountOverview,
  observeCodexLogin,
  observeCodexQuota,
  resetCodexAccountProbeCache
} from "../src/services/cli-account/codex-account.js";

const accessToken = "codex-access-token-material";
const accountId = "account-uuid-1234";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeJwt(exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp })}.signature`;
}

async function makeHomeWithAuth(auth: unknown): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "forgebadger-codex-account-"));
  const root = path.join(home, ".codex");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "auth.json"), typeof auth === "string" ? auth : JSON.stringify(auth), { mode: 0o600 });
  return home;
}

describe("codex cli-account login probe (migrated from codex-native-auth-status)", () => {
  it("normalizes ChatGPT and API-key methods without returning command output", async () => {
    const chatgpt = await observeCodexLogin({ run: async () => ({ exitCode: 0, stdout: "Logged in using ChatGPT", stderr: "" }) });
    const api = await observeCodexLogin({ run: async () => ({ exitCode: 0, stdout: "Logged in with API key", stderr: "" }) });
    assert.deepEqual(chatgpt, { adapter: "codex", state: "ready", method: "chatgpt" });
    assert.deepEqual(api, { adapter: "codex", state: "ready", method: "api" });
    assert.equal("stdout" in chatgpt, false);
  });

  it("reads the not-logged-in copy from stderr before consulting the exit code", async () => {
    const status = await observeCodexLogin({
      run: async () => ({ exitCode: 0, stdout: "", stderr: "Not logged in" })
    });
    assert.deepEqual(status, { adapter: "codex", state: "not_authenticated", method: "unknown" });
  });

  it("normalizes missing, unauthenticated, malformed and timeout outcomes", async () => {
    assert.deepEqual(await observeCodexLogin({ run: async () => ({ exitCode: 1, stdout: "Not logged in", stderr: "" }) }), { adapter: "codex", state: "not_authenticated", method: "unknown" });
    assert.deepEqual(await observeCodexLogin({ run: async () => ({ exitCode: 1, stdout: "unexpected failure", stderr: "network error" }) }), { adapter: "codex", state: "unknown", method: "unknown" });
    assert.deepEqual(await observeCodexLogin({ run: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }) }), { adapter: "codex", state: "ready", method: "unknown" });
    assert.deepEqual(await observeCodexLogin({ run: async () => { const error = new Error("spawn codex ENOENT") as NodeJS.ErrnoException; error.code = "ENOENT"; throw error; } }), { adapter: "codex", state: "cli_missing", method: "unknown" });
    assert.deepEqual(await observeCodexLogin({ timeoutMs: 1, run: async (_command, _args, signal) => await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) }), { adapter: "codex", state: "unknown", method: "unknown" });
  });

  it("singleflights and briefly caches status probes per user", async () => {
    resetCodexAccountProbeCache();
    let calls = 0;
    const run = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { exitCode: 0, stdout: "Logged in using ChatGPT", stderr: "" };
    };
    const [first, second] = await Promise.all([
      buildCodexAccountOverview("user-codex", { run, homeDir: "/nonexistent-home" }),
      buildCodexAccountOverview("user-codex", { run, homeDir: "/nonexistent-home" })
    ]);
    assert.deepEqual(first.login, second.login);
    assert.equal(first.login.state, "ready");
    assert.equal(calls, 1);
    await buildCodexAccountOverview("user-codex", { run, homeDir: "/nonexistent-home" });
    assert.equal(calls, 1);
  });

  it("passes only an allowlisted environment to the native status process", async () => {
    const previous = {
      masterKey: process.env.FORGEBADGER_MASTER_KEY,
      jwtSecret: process.env.FORGEBADGER_JWT_SECRET,
      codexHome: process.env.CODEX_HOME
    };
    process.env.FORGEBADGER_MASTER_KEY = "must-not-reach-codex";
    process.env.FORGEBADGER_JWT_SECRET = "must-not-reach-codex";
    process.env.CODEX_HOME = "/tmp/codex-status-home";
    try {
      let observedEnv: NodeJS.ProcessEnv | undefined;
      const status = await observeCodexLogin({
        run: async (command, args, _signal, options) => {
          assert.equal(command, "codex");
          assert.deepEqual(args, ["login", "status"]);
          observedEnv = options.env;
          return { exitCode: 0, stdout: "Logged in using ChatGPT", stderr: "" };
        }
      });
      assert.deepEqual(status, { adapter: "codex", state: "ready", method: "chatgpt" });
      assert.ok(observedEnv);
      assert.equal(observedEnv.FORGEBADGER_MASTER_KEY, undefined);
      assert.equal(observedEnv.FORGEBADGER_JWT_SECRET, undefined);
      // Windows process.env exposes the PATH key with its native casing (Path),
      // so resolve it case-insensitively to stay portable across platforms.
      const observedPath = Object.entries(observedEnv).find(([key]) => key.toUpperCase() === "PATH")?.[1];
      assert.equal(observedPath, process.env.PATH);
      assert.equal(observedEnv.CODEX_HOME, "/tmp/codex-status-home");
    } finally {
      restoreEnv("FORGEBADGER_MASTER_KEY", previous.masterKey);
      restoreEnv("FORGEBADGER_JWT_SECRET", previous.jwtSecret);
      restoreEnv("CODEX_HOME", previous.codexHome);
    }
  });
});

describe("codex cli-account quota probe", () => {
  it("maps the wham usage response to quota entries and forwards the account id", async () => {
    const home = await makeHomeWithAuth({
      tokens: { access_token: accessToken, account_id: accountId }
    });
    try {
      const seen: Array<{ url: string; auth: string | null; account: string | null }> = [];
      const quota = await observeCodexQuota({
        homeDir: home,
        fetchImpl: async (url, init) => {
          const headers = new Headers(init?.headers);
          seen.push({
            url: String(url),
            auth: headers.get("authorization"),
            account: headers.get("ChatGPT-Account-Id")
          });
          return jsonResponse({
            plan_type: "plus",
            rate_limit: {
              primary_window: { used_percent: 25, limit_window_seconds: 10800, reset_at: "2026-09-25T12:00:00.000Z" },
              secondary_window: { used_percent: 60, limit_window_seconds: 43200, reset_at: "2026-09-26T00:00:00.000Z" }
            },
            credits: { used_percent: 10 },
            rate_limit_reset_credits: 1_756_224_000
          });
        }
      });
      assert.equal(quota.supported, true);
      assert.equal(quota.planLabel, "plus");
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.url, "https://chatgpt.com/backend-api/wham/usage");
      assert.equal(seen[0]?.auth, `Bearer ${accessToken}`);
      assert.equal(seen[0]?.account, accountId);
      assert.deepEqual(quota.entries, [
        { label: "3h window", unit: "percent", usedPercent: 25, resetsAt: "2026-09-25T12:00:00.000Z" },
        { label: "12h window", unit: "percent", usedPercent: 60, resetsAt: "2026-09-26T00:00:00.000Z" },
        { label: "Credits", unit: "percent", usedPercent: 10, resetsAt: new Date(1_756_224_000 * 1000).toISOString() }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("marks token_expired for an expired JWT without hitting the network", async () => {
    const home = await makeHomeWithAuth({
      tokens: { access_token: makeJwt(Math.floor(Date.now() / 1000) - 60), account_id: accountId }
    });
    try {
      let fetches = 0;
      const quota = await observeCodexQuota({
        homeDir: home,
        fetchImpl: async () => {
          fetches += 1;
          return jsonResponse({});
        }
      });
      assert.equal(fetches, 0);
      assert.equal(quota.supported, false);
      assert.equal(quota.unsupportedReason, "token_expired");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("marks token_expired when the usage endpoint returns 401", async () => {
    const home = await makeHomeWithAuth({
      tokens: { access_token: makeJwt(Math.floor(Date.now() / 1000) + 3600) }
    });
    try {
      const quota = await observeCodexQuota({
        homeDir: home,
        fetchImpl: async () => jsonResponse({ detail: "unauthorized" }, 401)
      });
      assert.equal(quota.supported, false);
      assert.equal(quota.unsupportedReason, "token_expired");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("degrades to api_key_mode for API-key auth.json and no_native_login without tokens", async () => {
    const apiKeyHome = await makeHomeWithAuth({ OPENAI_API_KEY: "sk-test-key" });
    try {
      const apiKeyQuota = await observeCodexQuota({ homeDir: apiKeyHome });
      assert.equal(apiKeyQuota.supported, false);
      assert.equal(apiKeyQuota.unsupportedReason, "api_key_mode");
    } finally {
      await rm(apiKeyHome, { recursive: true, force: true });
    }

    const emptyTokensHome = await makeHomeWithAuth({ tokens: {} });
    try {
      const emptyQuota = await observeCodexQuota({ homeDir: emptyTokensHome });
      assert.equal(emptyQuota.supported, false);
      assert.equal(emptyQuota.unsupportedReason, "no_native_login");
    } finally {
      await rm(emptyTokensHome, { recursive: true, force: true });
    }

    const missingHome = await mkdtemp(path.join(tmpdir(), "forgebadger-codex-account-"));
    try {
      const missingQuota = await observeCodexQuota({ homeDir: missingHome });
      assert.equal(missingQuota.supported, false);
      assert.equal(missingQuota.unsupportedReason, "no_native_login");
    } finally {
      await rm(missingHome, { recursive: true, force: true });
    }
  });

  it("tolerates a missing secondary window and string-encoded numbers", async () => {
    const home = await makeHomeWithAuth({ tokens: { access_token: accessToken } });
    try {
      const quota = await observeCodexQuota({
        homeDir: home,
        fetchImpl: async () => jsonResponse({
          rate_limit: {
            primary_window: { used_percent: "42.5", limit_window_seconds: "18000" }
          }
        })
      });
      assert.equal(quota.supported, true);
      assert.deepEqual(quota.entries, [
        { label: "5h window", unit: "percent", usedPercent: 42.5 }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
