import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildKimiAccountOverview,
  observeKimiLogin,
  observeKimiQuota,
  resetKimiAccountProbeCache
} from "../src/services/cli-account/kimi-account.js";

const accessToken = "kimi-oauth-token-material";
const apiKey = "kimi-subscription-api-key";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function makeKimiHome(input: {
  credentials?: Array<{ name: string; body: unknown }>;
  configToml?: string;
}): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "forgebadger-kimi-account-"));
  const root = path.join(home, ".kimi-code");
  const credentialsDir = path.join(root, "credentials");
  await mkdir(credentialsDir, { recursive: true });
  await mkdir(path.join(credentialsDir, "mcp"), { recursive: true });
  for (const credential of input.credentials ?? []) {
    await writeFile(path.join(credentialsDir, credential.name), JSON.stringify(credential.body), { mode: 0o600 });
  }
  if (input.configToml !== undefined) {
    await writeFile(path.join(root, "config.toml"), input.configToml, { mode: 0o600 });
  }
  return home;
}

function oauthBody(expiresAt: number): unknown {
  return { access_token: accessToken, refresh_token: "kimi-refresh-material", expires_at: expiresAt };
}

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 60;

describe("kimi cli-account login probe", () => {
  it("reports ready/oauth for an unexpired credential file (both filename generations)", async () => {
    // The `managed:kimi-code.json` generation carries a colon, which is not a
    // legal filename on Windows; the probe is filename-agnostic, so exercise
    // that generation only on POSIX and the plain generation everywhere.
    const credentials = process.platform === "win32"
      ? [{ name: "kimi-code.json", body: oauthBody(future) }]
      : [
          { name: "kimi-code.json", body: oauthBody(future) },
          { name: "managed:kimi-code.json", body: { access_token: "other-token" } }
        ];
    const home = await makeKimiHome({ credentials });
    try {
      const status = await observeKimiLogin({ homeDir: home });
      assert.deepEqual(status, { adapter: "kimi", state: "ready", method: "oauth" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("ignores credential files under the mcp/ subdirectory", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "forgebadger-kimi-account-"));
    const root = path.join(home, ".kimi-code");
    const mcpDir = path.join(root, "credentials", "mcp");
    await mkdir(mcpDir, { recursive: true });
    await writeFile(path.join(mcpDir, "tool.json"), JSON.stringify(oauthBody(future)), { mode: 0o600 });
    try {
      const status = await observeKimiLogin({ homeDir: home });
      assert.deepEqual(status, { adapter: "kimi", state: "not_authenticated", method: "unknown" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("marks expired credentials not_authenticated with a token_expired detail code", async () => {
    const home = await makeKimiHome({
      credentials: [{ name: "kimi-code.json", body: oauthBody(past) }]
    });
    try {
      const status = await observeKimiLogin({ homeDir: home });
      assert.deepEqual(status, {
        adapter: "kimi",
        state: "not_authenticated",
        method: "oauth",
        detailCode: "token_expired"
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("falls back to api_key when a config.toml provider carries a key and no credential files exist", async () => {
    const home = await makeKimiHome({
      configToml: `
[providers.moonshot]
type = "kimi"
base_url = "https://api.moonshot.cn"
api_key = "${apiKey}"
`
    });
    try {
      const status = await observeKimiLogin({ homeDir: home });
      assert.deepEqual(status, { adapter: "kimi", state: "ready", method: "api_key" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports not_authenticated when neither credentials nor provider keys exist", async () => {
    const home = await makeKimiHome({});
    try {
      const status = await observeKimiLogin({ homeDir: home });
      assert.deepEqual(status, { adapter: "kimi", state: "not_authenticated", method: "unknown" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("singleflights and briefly caches login probes per user", async () => {
    resetKimiAccountProbeCache();
    const fetchImpl = async () => jsonResponse({});
    const home = await makeKimiHome({ credentials: [{ name: "kimi-code.json", body: oauthBody(future) }] });
    try {
      const [first, second] = await Promise.all([
        buildKimiAccountOverview("user-kimi", { homeDir: home, fetchImpl }),
        buildKimiAccountOverview("user-kimi", { homeDir: home, fetchImpl })
      ]);
      // Same object reference proves the per-user singleflight/cache; quota
      // itself is cached for 60s at the route layer (routes test covers it).
      assert.equal(first.login, second.login);
      assert.equal(first.login.state, "ready");
      const third = await buildKimiAccountOverview("user-kimi", { homeDir: home, fetchImpl });
      assert.equal(third.login, first.login);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("kimi cli-account quota probe", () => {
  it("queries usages with the OAuth token and parses string-encoded numbers", async () => {
    const home = await makeKimiHome({ credentials: [{ name: "kimi-code.json", body: oauthBody(future) }] });
    try {
      const seen: Array<{ url: string; auth: string | null }> = [];
      const quota = await observeKimiQuota({
        homeDir: home,
        fetchImpl: async (url, init) => {
          const headers = new Headers(init?.headers);
          seen.push({ url: String(url), auth: headers.get("authorization") });
          return jsonResponse({
            user: { membership: { level: "premium" } },
            limits: [
              {
                name: "5h",
                detail: { limit: "100", remaining: "80", ratio: "0.2", resetTime: "2026-09-25T12:00:00.000Z" }
              }
            ],
            usage: { limit: "500", remaining: "300", ratio: "0.4", resetTime: "2026-09-29T00:00:00.000Z" }
          });
        }
      });
      assert.equal(quota.supported, true);
      assert.equal(quota.planLabel, "premium");
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.url, "https://api.kimi.com/coding/v1/usages");
      assert.equal(seen[0]?.auth, `Bearer ${accessToken}`);
      assert.deepEqual(quota.entries, [
        {
          label: "5h",
          unit: "count",
          remaining: 80,
          limit: 100,
          usedPercent: 20,
          resetsAt: "2026-09-25T12:00:00.000Z"
        },
        {
          label: "Weekly window",
          unit: "count",
          remaining: 300,
          limit: 500,
          usedPercent: 40,
          resetsAt: "2026-09-29T00:00:00.000Z"
        }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("uses the api.kimi.com/coding provider key when no OAuth token exists", async () => {
    const home = await makeKimiHome({
      configToml: `
[providers.kimi]
type = "kimi"
base_url = "https://api.kimi.com/coding"
api_key = "${apiKey}"
`
    });
    try {
      const seen: Array<string | null> = [];
      const quota = await observeKimiQuota({
        homeDir: home,
        fetchImpl: async (_url, init) => {
          seen.push(new Headers(init?.headers).get("authorization"));
          return jsonResponse({ usage: { limit: "100", remaining: "50" } });
        }
      });
      assert.equal(quota.supported, true);
      assert.deepEqual(seen, [`Bearer ${apiKey}`]);
      assert.deepEqual(quota.entries, [
        { label: "Weekly window", unit: "count", remaining: 50, limit: 100, usedPercent: 50 }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("supports the totalQuota generation when usage/limits are absent", async () => {
    const home = await makeKimiHome({ credentials: [{ name: "kimi-code.json", body: oauthBody(future) }] });
    try {
      const quota = await observeKimiQuota({
        homeDir: home,
        fetchImpl: async () => jsonResponse({ totalQuota: { total: "200", used: "50" } })
      });
      assert.equal(quota.supported, true);
      assert.deepEqual(quota.entries, [
        { label: "Total quota", unit: "count", remaining: 150, limit: 200, usedPercent: 25 }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("degrades to token_expired on 401 and upstream_error on unparseable bodies", async () => {
    const home = await makeKimiHome({ credentials: [{ name: "kimi-code.json", body: oauthBody(future) }] });
    try {
      const unauthorized = await observeKimiQuota({
        homeDir: home,
        fetchImpl: async () => jsonResponse({ error: "unauthorized" }, 401)
      });
      assert.equal(unauthorized.supported, false);
      assert.equal(unauthorized.unsupportedReason, "token_expired");

      const empty = await observeKimiQuota({
        homeDir: home,
        fetchImpl: async () => jsonResponse({ unexpected: "shape" })
      });
      assert.equal(empty.supported, false);
      assert.equal(empty.unsupportedReason, "upstream_error");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("marks non-coding API-key providers as api_key_mode", async () => {
    const home = await makeKimiHome({
      configToml: `
[providers.other]
type = "openai"
base_url = "https://api.moonshot.cn/v1"
api_key = "${apiKey}"
`
    });
    try {
      const quota = await observeKimiQuota({ homeDir: home });
      assert.equal(quota.supported, false);
      assert.equal(quota.unsupportedReason, "api_key_mode");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("marks no_native_login when no credential or key material exists", async () => {
    const home = await makeKimiHome({});
    try {
      const quota = await observeKimiQuota({ homeDir: home });
      assert.equal(quota.supported, false);
      assert.equal(quota.unsupportedReason, "no_native_login");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
