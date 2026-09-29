import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  observeMcodeLogin,
  observeMcodeQuota,
  resetMcodeAccountProbeCache
} from "../src/services/cli-account/mcode-account.js";
import { cliAccountAdapters, isCliAccountAdapter } from "../src/services/cli-account/index.js";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "fb-mcode-account-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Writes the real on-disk shape:
 *   auth/<buildEnv>/<region>/<clientId>/{auth.json,auth-state.json}
 */
async function writeAuthFixture(
  dataDir: string,
  options: {
    accessToken?: string;
    expiresAtMs?: number;
    status?: string;
    region?: string;
    buildEnv?: string;
    clientId?: string;
  } = {}
): Promise<void> {
  const region = options.region ?? "cn";
  const buildEnv = options.buildEnv ?? "prod";
  const clientId = options.clientId ?? "mcode-public";
  const dir = path.join(dataDir, "auth", buildEnv, region, clientId);
  await mkdir(dir, { recursive: true });
  const expiresAtMs = options.expiresAtMs ?? Date.now() + 3_600_000;
  await writeFile(
    path.join(dir, "auth.json"),
    JSON.stringify({
      schemaVersion: 1,
      records: {
        [`com.minimax.mcode.oauth.${buildEnv}.${region}`]: {
          schemaVersion: 1,
          accessToken: options.accessToken ?? "access-token",
          refreshToken: "refresh-token",
          tokenType: "Bearer",
          clientId,
          scopes: ["agent.default"],
          audience: "agent-backend",
          expiresAtMs,
          generation: 1,
          loginEpoch: "epoch"
        }
      }
    }),
    "utf8"
  );
  await writeFile(
    path.join(dir, "auth-state.json"),
    JSON.stringify({
      schemaVersion: 1,
      status: options.status ?? "authenticated",
      storeKind: "file",
      clientId,
      scopes: ["agent.default"],
      audience: "agent-backend",
      buildEnv,
      region,
      generation: 1,
      expiresAtMs
    }),
    "utf8"
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

/** Upstream shape, built from the `current_*` fields the shipped CLI reads. */
function quotaBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    base_resp: { status_code: 0 },
    model_remains: [
      {
        model_name: "MiniMax-M3",
        current_interval_status: 1,
        current_interval_remaining_percent: 40,
        current_interval_total_count: 1000,
        current_interval_usage_count: 600,
        end_time: 1_800_000_000_000,
        current_weekly_status: 1,
        current_weekly_remaining_percent: 75,
        current_weekly_total_count: 5000,
        current_weekly_usage_count: 1250,
        weekly_end_time: 1_800_500_000_000,
        ...overrides
      }
    ]
  };
}

function probeOptions(dataDir: string, fetchImpl?: typeof fetch) {
  return {
    env: { MINIMAX_DATA_DIR: dataDir },
    homeDir: dataDir,
    ...(fetchImpl ? { fetchImpl } : {})
  };
}

describe("mcode account adapter", () => {
  it("is registered for gateway account probing", () => {
    assert.ok(cliAccountAdapters.includes("mcode"));
    assert.equal(isCliAccountAdapter("mcode"), true);
    // Adapters without a native account surface stay excluded.
    assert.equal(isCliAccountAdapter("opencode"), false);
    assert.equal(isCliAccountAdapter("pi"), false);
  });

  it("reports a ready login for a valid credential directory", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir);

    const login = await observeMcodeLogin(probeOptions(dir));

    assert.equal(login.state, "ready");
    assert.equal(login.method, "oauth");
    assert.equal(login.accountLabel, "mcode-public");
  });

  it("reports an expired session token without refreshing it", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir, { expiresAtMs: Date.now() - 1_000 });

    const login = await observeMcodeLogin(probeOptions(dir));

    // Never refreshed on the user's behalf; the detail code drives the hint.
    assert.equal(login.state, "not_authenticated");
    assert.equal(login.detailCode, "token_expired");
  });

  it("reports not authenticated when no credential directory exists", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();

    const login = await observeMcodeLogin(probeOptions(dir));
    assert.equal(login.state, "not_authenticated");

    const quota = await observeMcodeQuota(probeOptions(dir));
    assert.equal(quota.supported, false);
    assert.equal(quota.unsupportedReason, "no_native_login");
  });

  it("reports not authenticated when the CLI is signed out", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir, { status: "signed-out" });

    const login = await observeMcodeLogin(probeOptions(dir));
    assert.equal(login.state, "not_authenticated");
  });

  it("reports token_expired for quota when the session token is stale", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir, { expiresAtMs: Date.now() - 1_000 });
    let called = false;

    const quota = await observeMcodeQuota(
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

  it("inverts remaining percentage into the used percentage ForgeBadger reports", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir);
    const seen: Array<{ url: string; auth: string | null }> = [];

    const quota = await observeMcodeQuota(
      probeOptions(dir, async (input, init) => {
        const headers = new Headers(init?.headers);
        seen.push({ url: String(input), auth: headers.get("authorization") });
        return jsonResponse(quotaBody());
      })
    );

    assert.equal(quota.supported, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.url, "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains");
    assert.equal(seen[0]!.auth, "Bearer access-token");

    const [fiveHour, weekly] = quota.entries;
    // Upstream says 40% *remaining*; the UI contract is *used*.
    assert.equal(fiveHour!.label, "Five-hour window");
    assert.equal(fiveHour!.usedPercent, 60);
    assert.equal(fiveHour!.limit, 1000);
    assert.equal(fiveHour!.resetsAt, new Date(1_800_000_000_000).toISOString());

    assert.equal(weekly!.label, "Weekly window");
    assert.equal(weekly!.usedPercent, 25);
    assert.equal(weekly!.limit, 5000);
  });

  it("derives used percentage from usage/total when only counts are reported", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir);

    const quota = await observeMcodeQuota(
      probeOptions(dir, async () =>
        jsonResponse(
          quotaBody({
            current_interval_remaining_percent: undefined,
            current_weekly_remaining_percent: undefined
          })
        )
      )
    );

    // 600/1000 and 1250/5000.
    assert.deepEqual(quota.entries.map((entry) => entry.usedPercent), [60, 25]);
  });

  it("treats status 3 as unlimited and reports no usage", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir);

    const quota = await observeMcodeQuota(
      probeOptions(dir, async () =>
        jsonResponse(
          quotaBody({
            current_interval_status: 3,
            current_interval_remaining_percent: undefined,
            current_weekly_status: 3,
            current_weekly_remaining_percent: undefined
          })
        )
      )
    );

    assert.equal(quota.supported, true);
    for (const entry of quota.entries) {
      // The CLI hides the meter when unlimited; so do we.
      assert.equal(entry.usedPercent, 0);
    }
  });

  it("rejects a non-zero base_resp status code", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir);

    const quota = await observeMcodeQuota(
      probeOptions(dir, async () => jsonResponse({ base_resp: { status_code: 1004 } }))
    );

    assert.equal(quota.supported, false);
    assert.equal(quota.unsupportedReason, "upstream_error");
  });

  it("maps a 401 to token_expired and never leaks the token", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir, { accessToken: "super-secret-value" });

    const quota = await observeMcodeQuota(
      probeOptions(dir, async () => jsonResponse({ error: "unauthorized" }, 401))
    );

    assert.equal(quota.unsupportedReason, "token_expired");
    assert.doesNotMatch(JSON.stringify(quota), /super-secret-value/);
  });

  it("uses the international host for a non-cn region", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir, { region: "en" });
    let seenUrl = "";

    await observeMcodeQuota(
      probeOptions(dir, async (input) => {
        seenUrl = String(input);
        return jsonResponse(quotaBody());
      })
    );

    assert.equal(seenUrl, "https://platform.minimax.io/v1/api/openplatform/coding_plan/remains");
  });

  it("does not probe an unrecognised region", async () => {
    const dir = await tempDir();
    resetMcodeAccountProbeCache();
    await writeAuthFixture(dir, { region: "xx" });
    let called = false;

    const quota = await observeMcodeQuota(
      probeOptions(dir, async () => {
        called = true;
        return jsonResponse(quotaBody());
      })
    );

    assert.equal(quota.supported, false);
    assert.equal(called, false);
  });
});

process.on("exit", () => {
  for (const dir of tempDirs.splice(0)) {
    void rm(dir, { recursive: true, force: true });
  }
});
