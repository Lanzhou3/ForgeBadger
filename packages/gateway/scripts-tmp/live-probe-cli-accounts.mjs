// Phase 3 live probe: read-only token usage, prints ONLY sanitized quota fields.
import { readFileSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const home = homedir();
const results = {};

async function probe(name, fn) {
  try {
    results[name] = await fn();
  } catch (error) {
    results[name] = { error: String(error && error.message ? error.message : error) };
  }
}

await probe("claude", async () => {
  const credPath = join(home, ".claude", ".credentials.json");
  let raw;
  try { raw = readFileSync(credPath, "utf8"); } catch {
    return { skipped: `no .credentials.json (platform=${platform()})` };
  }
  const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
  if (!token) return { skipped: "no claudeAiOauth.accessToken" };
  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { httpStatus: res.status };
  const body = await res.json();
  const pick = (w) => (w && typeof w === "object" ? { utilization: w.utilization, resets_at: w.resets_at } : w ?? null);
  return {
    httpStatus: res.status,
    five_hour: pick(body.five_hour),
    seven_day: pick(body.seven_day),
    seven_day_sonnet: pick(body.seven_day_sonnet),
    limitsArray: Array.isArray(body.limits) ? body.limits.length : undefined,
  };
});

await probe("codex", async () => {
  const authPath = process.env.CODEX_HOME ? join(process.env.CODEX_HOME, "auth.json") : join(home, ".codex", "auth.json");
  const auth = JSON.parse(readFileSync(authPath, "utf8"));
  const token = auth?.tokens?.access_token;
  const accountId = auth?.tokens?.account_id;
  if (!token) return { skipped: "no tokens.access_token (api key mode?)" };
  const headers = { Authorization: `Bearer ${token}` };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers, signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { httpStatus: res.status };
  const body = await res.json();
  const win = (w) => (w && typeof w === "object" ? { used_percent: w.used_percent, limit_window_seconds: w.limit_window_seconds, reset_at: w.reset_at } : w ?? null);
  return {
    httpStatus: res.status,
    plan_type: body.plan_type ?? null,
    primary_window: win(body.rate_limit?.primary_window),
    secondary_window: win(body.rate_limit?.secondary_window),
  };
});

await probe("kimi", async () => {
  const credDir = join(home, ".kimi-code", "credentials");
  let token;
  let file;
  for (const name of readdirSync(credDir)) {
    if (!name.endsWith(".json")) continue;
    const data = JSON.parse(readFileSync(join(credDir, name), "utf8"));
    if (data?.access_token) { token = data.access_token; file = name; break; }
  }
  if (!token) return { skipped: "no credentials/*.json with access_token" };
  const res = await fetch("https://api.kimi.com/coding/v1/usages", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { httpStatus: res.status, credentialFile: file };
  const body = await res.json();
  return {
    httpStatus: res.status,
    credentialFile: file,
    usage: body.usage ?? null,
    limits: Array.isArray(body.limits) ? body.limits.map((l) => l?.detail ?? null) : undefined,
    membership: body.user?.membership?.level ?? null,
    topLevelKeys: Object.keys(body),
  };
});

console.log(JSON.stringify(results, null, 2));
