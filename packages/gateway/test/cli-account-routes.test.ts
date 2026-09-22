import assert from "node:assert/strict";
import express from "express";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { createCliAccountRoutes } from "../src/routes/cli-accounts.js";

const secret = "0123456789abcdef0123456789abcdef";

const claudeToken = "claude-route-token-material";
const codexToken = "codex-route-token-material";
const kimiToken = "kimi-route-token-material";
const codexAccountId = "codex-account-uuid";
const kimiApiKey = "kimi-route-api-key";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function makePopulatedHome(): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "forgebadger-cli-account-routes-"));

  const claudeRoot = path.join(home, ".claude");
  await mkdir(claudeRoot, { recursive: true });
  await writeFile(
    path.join(claudeRoot, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: claudeToken } }),
    { mode: 0o600 }
  );

  const codexRoot = path.join(home, ".codex");
  await mkdir(codexRoot, { recursive: true });
  await writeFile(
    path.join(codexRoot, "auth.json"),
    JSON.stringify({ tokens: { access_token: codexToken, account_id: codexAccountId } }),
    { mode: 0o600 }
  );

  const kimiRoot = path.join(home, ".kimi-code");
  const kimiCredentials = path.join(kimiRoot, "credentials");
  await mkdir(kimiCredentials, { recursive: true });
  await writeFile(
    path.join(kimiCredentials, "kimi-code.json"),
    JSON.stringify({ access_token: kimiToken, expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    { mode: 0o600 }
  );

  return home;
}

function makeFetch(counts: Map<string, number>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const target = String(url);
    counts.set(target, (counts.get(target) ?? 0) + 1);
    if (target.includes("/api/oauth/usage")) {
      return jsonResponse({ five_hour: { utilization: 10 }, seven_day: { utilization: 30 } });
    }
    if (target.includes("/backend-api/wham/usage")) {
      return jsonResponse({
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: "2026-09-25T12:00:00.000Z" }
        }
      });
    }
    if (target.includes("/coding/v1/usages")) {
      return jsonResponse({ usage: { limit: "100", remaining: "70" }, user: { membership: { level: "premium" } } });
    }
    return jsonResponse({ error: "unexpected url" }, 404);
  }) as typeof fetch;
}

function makeRunner(): (command: string, args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return async (command, _args) => {
    if (command === "claude") {
      return { exitCode: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "user@example.com" }), stderr: "" };
    }
    return { exitCode: 0, stdout: "Logged in using ChatGPT", stderr: "" };
  };
}

describe("cli-account routes", () => {
  let app: express.Express;
  let home: string;
  let token: string;
  let fetchCounts: Map<string, number>;

  beforeEach(async () => {
    home = await makePopulatedHome();
    fetchCounts = new Map();
    token = signJwt({ userId: "cli-account-user", email: "cli-account@example.com" }, secret);
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/cli-accounts", createCliAccountRoutes({
      run: makeRunner(),
      fetchImpl: makeFetch(fetchCounts),
      homeDir: home
    }));
  });

  it("requires authentication on all endpoints", async () => {
    const list = await makeRequest(app, "GET", "/api/v1/cli-accounts");
    assert.equal(list.status, 401);
    const single = await makeRequest(app, "GET", "/api/v1/cli-accounts/claude");
    assert.equal(single.status, 401);
    const refresh = await makeRequest(app, "POST", "/api/v1/cli-accounts/claude/quota/refresh");
    assert.equal(refresh.status, 401);
  });

  it("aggregates the three adapters without leaking token material", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/cli-accounts", undefined, authHeaders());
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    const accounts = res.body.data.accounts;
    assert.equal(accounts.length, 3);
    const byAdapter = new Map(accounts.map((account: any) => [account.login.adapter, account]));
    assert.equal(byAdapter.get("claude").login.state, "ready");
    assert.equal(byAdapter.get("claude").login.method, "claude.ai");
    assert.equal(byAdapter.get("claude").quota.entries.length, 2);
    assert.equal(byAdapter.get("codex").login.state, "ready");
    assert.equal(byAdapter.get("codex").login.method, "chatgpt");
    assert.equal(byAdapter.get("codex").quota.planLabel, "plus");
    assert.equal(byAdapter.get("kimi").login.state, "ready");
    assert.equal(byAdapter.get("kimi").login.method, "oauth");
    assert.equal(byAdapter.get("kimi").quota.planLabel, "premium");

    const serialized = JSON.stringify(res.body);
    for (const material of [claudeToken, codexToken, kimiToken, codexAccountId]) {
      assert.equal(serialized.includes(material), false, `response leaked ${material}`);
    }
  });

  it("returns a single overview and rejects unknown adapters", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/cli-accounts/kimi", undefined, authHeaders());
    assert.equal(res.status, 200);
    assert.equal(res.body.data.overview.login.adapter, "kimi");
    assert.equal(res.body.data.overview.quota.supported, true);

    const bogus = await makeRequest(app, "GET", "/api/v1/cli-accounts/opencode", undefined, authHeaders());
    assert.equal(bogus.status, 400);
    const bogusRefresh = await makeRequest(app, "POST", "/api/v1/cli-accounts/opencode/quota/refresh", undefined, authHeaders());
    assert.equal(bogusRefresh.status, 400);
  });

  it("caches quota reads for 60s and refresh bypasses and repopulates the cache", async () => {
    const claudeUrl = "https://api.anthropic.com/api/oauth/usage";
    await makeRequest(app, "GET", "/api/v1/cli-accounts/claude", undefined, authHeaders());
    await makeRequest(app, "GET", "/api/v1/cli-accounts/claude", undefined, authHeaders());
    assert.equal(fetchCounts.get(claudeUrl), 1);

    const refresh = await makeRequest(app, "POST", "/api/v1/cli-accounts/claude/quota/refresh", undefined, authHeaders());
    assert.equal(refresh.status, 200);
    assert.equal(refresh.body.data.overview.quota.supported, true);
    assert.equal(fetchCounts.get(claudeUrl), 2);

    // The refresh doubles as the latest read for subsequent polling.
    await makeRequest(app, "GET", "/api/v1/cli-accounts/claude", undefined, authHeaders());
    assert.equal(fetchCounts.get(claudeUrl), 2);
  });

  it("rate-limits quota refresh to 30 requests per minute", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 31; i += 1) {
      const res = await makeRequest(app, "POST", "/api/v1/cli-accounts/codex/quota/refresh", undefined, authHeaders());
      lastStatus = res.status;
      if (i < 30) assert.equal(res.status, 200, `request ${i + 1} should succeed`);
    }
    assert.equal(lastStatus, 429);
  });

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
  }
});

async function makeRequest(
  app: express.Express,
  method: string,
  pathName: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  try {
    const res = await fetch(`${baseUrl}${pathName}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const responseBody = await res.json().catch(() => ({}));
    return { status: res.status, body: responseBody };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function listen(server: http.Server): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}
