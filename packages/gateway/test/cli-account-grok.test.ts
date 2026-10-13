import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  observeGrokLogin,
  observeGrokQuota,
  resetGrokAccountProbeCache
} from "../src/services/cli-account/grok-account.js";
import { cliAccountAdapters, isCliAccountAdapter } from "../src/services/cli-account/index.js";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "fb-grok-account-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Writes the real on-disk shape:
 *   <grokHome>/auth.json  { "<oidcIssuer>::<installationId>": { key, ... } }
 */
async function writeAuthFixture(
  grokHome: string,
  options: {
    accessToken?: string;
    expiresAt?: string;
    authMode?: string;
    email?: string;
  } = {}
): Promise<void> {
  await writeFile(
    path.join(grokHome, "auth.json"),
    JSON.stringify({
      "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": {
        key: options.accessToken ?? "access-token",
        auth_mode: options.authMode ?? "oidc",
        create_time: "2026-10-11T15:48:58.988101Z",
        user_id: "user-1",
        ...(options.email === undefined ? { email: "dev@example.com" } : options.email ? { email: options.email } : {}),
        first_name: "Dev",
        principal_type: "User",
        principal_id: "principal-1",
        team_id: null,
        refresh_token: "refresh-token",
        expires_at: options.expiresAt ?? new Date(Date.now() + 6 * 3_600_000).toISOString(),
        oidc_issuer: "https://auth.x.ai",
        oidc_client_id: "client-1"
      }
    }),
    { mode: 0o600 }
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

/** Upstream BillingConfigResponse shape, from the shipped binary's serde structs. */
function quotaBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    config: {
      creditUsagePercent: 42.4,
      currentPeriod: { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" },
      monthlyLimit: 100,
      onDemandCap: 50,
      onDemandUsed: 5,
      prepaidBalance: 0,
      isUnifiedBillingUser: true,
      billingPeriodStart: "2026-10-01T00:00:00Z",
      history: [],
      ...overrides
    },
    on_demand_enabled: true,
    subscription_tier: "supergrok"
  };
}

function probeOptions(grokHome: string, fetchImpl?: typeof fetch) {
  return {
    env: { GROK_HOME: grokHome },
    homeDir: grokHome,
    ...(fetchImpl ? { fetchImpl } : {})
  };
}

describe("grok account adapter", () => {
  it("is registered for gateway account probing", () => {
    assert.ok(cliAccountAdapters.includes("grok"));
    assert.equal(isCliAccountAdapter("grok"), true);
    // Adapters without a native account surface stay excluded.
    assert.equal(isCliAccountAdapter("opencode"), false);
    assert.equal(isCliAccountAdapter("pi"), false);
  });

  it("reports a ready login for a valid auth record, labeled by email", async () => {
    const dir = await tempDir();
    resetGrokAccountProbeCache();
    await writeAuthFixture(dir);

    const login = await observeGrokLogin(probeOptions(dir));

    assert.equal(login.state, "ready");
    assert.equal(login.method, "oauth");
    assert.equal(login.accountLabel, "dev@example.com");
  });

  it("reports an expired access token without refreshing it", async () => {
    const dir = await tempDir();
    resetGrokAccountProbeCache();
    await writeAuthFixture(dir, { expiresAt: new Date(Date.now() - 1_000).toISOString() });

    const login = await observeGrokLogin(probeOptions(dir));

    // Never refreshed on the user's behalf; the detail code drives the hint.
    assert.equal(login.state, "not_authenticated");
    assert.equal(login.method, "oauth");
    assert.equal(login.detailCode, "token_expired");
  });

  it("reports not authenticated when no auth.json exists", async () => {
    const dir = await tempDir();
    resetGrokAccountProbeCache();

    const login = await observeGrokLogin(probeOptions(dir));
    assert.equal(login.state, "not_authenticated");

    const quota = await observeGrokQuota(probeOptions(dir));
    assert.equal(quota.supported, false);
    assert.equal(quota.unsupportedReason, "no_native_login");
  });

  it("skips records without an access token instead of assembling the record key", async () => {
    const dir = await tempDir();
    resetGrokAccountProbeCache();
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::no-token-here": { auth_mode: "oidc", refresh_token: "refresh-token" }
      }),
      { mode: 0o600 }
    );

    const login = await observeGrokLogin(probeOptions(dir));
    assert.equal(login.state, "not_authenticated");
  });

  it("reports token_expired for quota when the access token is stale", async () => {
    const dir = await tempDir();
    resetGrokAccountProbeCache();
    await writeAuthFixture(dir, { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    let called = false;

    const quota = await observeGrokQuota(
      probeOptions(dir, async () => {
        called = true;
        return jsonResponse(quotaBody());
      })
    );

    assert.equal(quota.supported, false);
    assert.equal(quota.unsupportedReason, "token_expired");
    // The endpoint must not be hit at all with a stale token.
    assert.equal(called, false);
  });

  it("maps the billing response onto used-percentage quota entries", async () => {
    const dir = await tempDir();
    resetGrokAccountProbeCache();
    await writeAuthFixture(dir);
    const seen: Array<{ url: string; auth: string | null }> = [];

    const quota = await observeGrokQuota(
      probeOptions(dir, async (input, init) => {
        const headers = new Headers(init?.headers);
        seen.push({ url: String(input), auth: headers.get("authorization") });
        return jsonResponse(quotaBody());
      })
    );

    assert.equal(quota.supported, true);
    assert.equal(quota.planLabel, "SuperGrok");
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.url, "https://cli-chat-proxy.grok.com/v1/billing?format=credits");
    assert.equal(seen[0]!.auth, "Bearer access-token");

    const [credits, onDemand] = quota.entries;
    // creditUsagePercent is already a *used* percentage; nothing is inverted.
    assert.equal(credits!.label, "Billing period credits");
    assert.equal(credits!.usedPercent, 42);
    assert.equal(credits!.resetsAt, "2026-11-01T00:00:00Z");
    // Raw limits are unit-ambiguous (credits vs billing ticks) and stay hidden.
    assert.equal(credits!.limit, undefined);

    assert.equal(onDemand!.label, "On-demand credits");
    assert.equal(onDemand!.usedPercent, 10);
  });

  it("omits the on-demand entry when on-demand is capped at zero", async () => {
    const dir = await tempDir();
    resetGrokAccountProbeCache();
    await writeAuthFixture(dir);

    const quota = await observeGrokQuota(
      probeOptions(dir, async () => jsonResponse(quotaBody({ onDemandCap: 0, onDemandUsed: 0 })))
    );

    assert.equal(quota.supported, true);
    assert.equal(quota.entries.length, 1);
    assert.equal(quota.entries[0]!.label, "Billing period credits");
  });

  it("tolerates snake_case billing fields and unknown subscription tiers", async () => {
    const dir = await tempDir();
    resetGrokAccountProbeCache();
    await writeAuthFixture(dir);

    const quota = await observeGrokQuota(
      probeOptions(dir, async () => jsonResponse({
        config: { credit_usage_percent: 7, current_period: { end: "2026-11-01T00:00:00Z" } },
        subscription_tier: "enterprise_beta"
      }))
    );

    assert.equal(quota.supported, true);
    assert.equal(quota.planLabel, "enterprise_beta");
    assert.equal(quota.entries[0]!.usedPercent, 7);
    assert.equal(quota.entries[0]!.resetsAt, "2026-11-01T00:00:00Z");
  });

  it("classifies upstream 401/403 as token_expired and other failures as upstream errors", async () => {
    const dir = await tempDir();
    resetGrokAccountProbeCache();
    await writeAuthFixture(dir);

    const unauthorized = await observeGrokQuota(
      probeOptions(dir, async () => jsonResponse({ error: "nope" }, 401))
    );
    assert.equal(unauthorized.supported, false);
    assert.equal(unauthorized.unsupportedReason, "token_expired");

    const broken = await observeGrokQuota(
      probeOptions(dir, async () => jsonResponse({ error: "boom" }, 500))
    );
    assert.equal(broken.supported, false);
    assert.equal(broken.unsupportedReason, "upstream_error");

    const empty = await observeGrokQuota(
      probeOptions(dir, async () => jsonResponse({ config: {} }))
    );
    assert.equal(empty.supported, false);
    assert.equal(empty.unsupportedReason, "upstream_error");
  });
});

process.on("exit", () => {
  for (const dir of tempDirs.splice(0)) {
    void rm(dir, { recursive: true, force: true });
  }
});
