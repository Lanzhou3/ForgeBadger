import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp, type GatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotDshConfigRepository } from "../src/db/repositories/copilot-dsh-config-repository.js";
import {
  DSH_AVAILABLE_PLUGINS,
  effectivePlugins,
  renderCordisConfig,
  unknownPluginKeys
} from "../src/services/dsh-copilot/dsh-config.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const bridgeToken = "dsh-config-test-bridge-token-0123456789abcdef";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

const FAKE_LAUNCHER = path.join(path.dirname(fileURLToPath(import.meta.url)), "helpers", "fake-dsh-runtime.mjs");
const REAL_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../dsh-bridge", "templates", "cordis.yml");

const mockTmuxClient = {
  async createSession() {},
  async killSession() {},
  async capturePane() { return ""; },
  async listSessions() { return []; }
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function seedUser(db: Database.Database, email: string): string {
  return new UserRepository(db).create(email, "hash").id;
}

describe("CopilotDshConfigRepository", () => {
  it("returns undefined when the user has no row", () => {
    const db = createTestDb();
    const userId = seedUser(db, "cfg-empty@test.com");
    assert.equal(new CopilotDshConfigRepository(db, userId).get(), undefined);
  });

  it("upserts, merges plugins key-by-key, and clears defaultModelId with null", () => {
    const db = createTestDb();
    const userId = seedUser(db, "cfg-upsert@test.com");
    const repo = new CopilotDshConfigRepository(db, userId);

    const created = repo.upsert({ defaultModelId: "model-1", plugins: { subagents: false } });
    assert.equal(created.defaultModelId, "model-1");
    assert.deepEqual(created.plugins, { subagents: false });

    // Partial update: plugins merge, defaultModelId untouched.
    const merged = repo.upsert({ plugins: { compaction: false } });
    assert.equal(merged.defaultModelId, "model-1");
    assert.deepEqual(merged.plugins, { subagents: false, compaction: false });

    // null clears the model override back to the system default.
    const cleared = repo.upsert({ defaultModelId: null });
    assert.equal(cleared.defaultModelId, null);
    assert.deepEqual(cleared.plugins, { subagents: false, compaction: false });
  });

  it("isolates rows per user", () => {
    const db = createTestDb();
    const a = seedUser(db, "cfg-a@test.com");
    const b = seedUser(db, "cfg-b@test.com");
    new CopilotDshConfigRepository(db, a).upsert({ plugins: { subagents: false } });
    assert.equal(new CopilotDshConfigRepository(db, b).get(), undefined);
  });
});

describe("dsh-config plugin registry and rendering", () => {
  it("whitelists only the available plugins", () => {
    assert.deepEqual(unknownPluginKeys({ compaction: true, subagents: false }), []);
    assert.deepEqual(unknownPluginKeys({ compaction: true, mcp: true }), ["mcp"]);
  });

  it("effectivePlugins overlays stored values on the defaults", () => {
    assert.deepEqual(effectivePlugins(undefined), { compaction: true, subagents: true });
    assert.deepEqual(effectivePlugins({ subagents: false }), { compaction: true, subagents: false });
  });

  it("renders the full composition when every plugin is on", () => {
    const template = readFileSync(REAL_TEMPLATE, "utf8");
    const rendered = renderCordisConfig(template, { compaction: true, subagents: true });
    assert.ok(rendered.includes("dsh-compaction-basic"));
    assert.ok(rendered.includes("dsh-subagent"));
    assert.ok(!rendered.includes("@forgebadger-feature"), "markers never leak into the rendered file");
  });

  it("drops the compaction block when compaction is off", () => {
    const template = readFileSync(REAL_TEMPLATE, "utf8");
    const rendered = renderCordisConfig(template, { compaction: false, subagents: true });
    assert.ok(!rendered.includes("dsh-compaction-basic"));
    assert.ok(rendered.includes("dsh-subagent"));
  });

  it("drops all three subagent blocks when subagents is off", () => {
    const template = readFileSync(REAL_TEMPLATE, "utf8");
    const rendered = renderCordisConfig(template, { compaction: true, subagents: false });
    assert.ok(!rendered.includes("dsh-subagent"));
    assert.ok(!rendered.includes("dsh-tool-subagent"));
    assert.ok(rendered.includes("dsh-compaction-basic"));
  });

  it("drops both features when both are off, keeping the rest of the composition", () => {
    const template = readFileSync(REAL_TEMPLATE, "utf8");
    const rendered = renderCordisConfig(template, { compaction: false, subagents: false });
    assert.ok(!rendered.includes("dsh-compaction-basic"));
    assert.ok(!rendered.includes("dsh-subagent"));
    assert.ok(rendered.includes("dsh-llm-pi-ai"), "unrelated plugins stay mounted");
    assert.ok(rendered.includes("@forgebadger/dsh-bridge/server"));
  });

  it("fails loud on unknown or unbalanced markers", () => {
    assert.throws(
      () => renderCordisConfig("# @forgebadger-feature: mcp\n- id: x\n# @forgebadger-feature-end: mcp\n", { compaction: true, subagents: true }),
      /unknown @forgebadger-feature marker: mcp/
    );
    assert.throws(
      () => renderCordisConfig("# @forgebadger-feature: compaction\n- id: x\n", { compaction: false, subagents: true }),
      /unclosed @forgebadger-feature marker/
    );
    assert.throws(
      () => renderCordisConfig("# @forgebadger-feature: compaction\n# @forgebadger-feature-end: subagents\n", { compaction: false, subagents: true }),
      /mismatched @forgebadger-feature-end/
    );
  });
});

interface Harness {
  app: GatewayApp;
  baseUrl: string;
  db: Database.Database;
  stateDir: string;
  logPath: string;
}

const cleanups: Array<() => Promise<void> | void> = [];
after(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function bootDshGateway(input: { withDsh: boolean; configTemplatePath?: string }): Promise<Harness> {
  const db = createTestDb();
  const stateDir = mkdtempSync(path.join(tmpdir(), "forgebadger-dsh-config-test-"));
  const logPath = path.join(stateDir, "fake-runtime.jsonl");
  const app = createGatewayApp({
    jwtSecret,
    masterKey,
    db,
    sessionManager: new InMemorySessionManager(mockTmuxClient as never),
    apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
    ...(input.withDsh
      ? {
        dshCopilot: {
          launcherPath: FAKE_LAUNCHER,
          gatewayUrl: "http://127.0.0.1:1",
          bridgeToken,
          stateDir,
          idleMs: 60_000,
          extraEnv: { DSH_FAKE_SCENARIO: "simple", DSH_FAKE_LOG: logPath },
          ...(input.configTemplatePath ? { configTemplatePath: input.configTemplatePath } : {})
        }
      }
      : {})
  });
  let baseUrl = "";
  await new Promise<void>((resolve) => {
    app.server.listen(0, "127.0.0.1", () => {
      const address = app.server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
  cleanups.push(async () => { await app.close(); rmSync(stateDir, { recursive: true, force: true }); });
  return { app, baseUrl, db, stateDir, logPath };
}

async function registerAndSeed(h: Harness, email: string): Promise<{ token: string; userId: string; defaultModelProfileId: string; altModelProfileId: string }> {
  const res = await fetch(`${h.baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" })
  });
  const body = (await res.json()) as { data: { token: string } };
  assert.equal(res.status, 201, JSON.stringify(body));
  const user = h.db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string };
  const repo = new ModelProviderRepository(h.db, user.id, masterKey);
  const provider = repo.createProviderProfile({
    name: "Stub",
    providerKey: "stub",
    anthropicBaseUrl: "https://stub.example",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["opencode"]
  });
  const defaultModel = repo.createModelProfile({
    providerProfileId: provider.id,
    name: "Stub model",
    modelId: "stub-model",
    capabilities: ["chat"],
    isDefault: true
  });
  const altModel = repo.createModelProfile({
    providerProfileId: provider.id,
    name: "Stub model alt",
    modelId: "stub-model-alt",
    capabilities: ["chat"]
  });
  repo.createCredential({ providerProfileId: provider.id, label: "key", plaintextSecret: "fake-llm-key" });
  return { token: body.data.token, userId: user.id, defaultModelProfileId: defaultModel.id, altModelProfileId: altModel.id };
}

function authHeaders(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function getConfig(h: Harness, token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${h.baseUrl}/api/v1/copilot/dsh-config`, { headers: authHeaders(token) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function putConfig(h: Harness, token: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${h.baseUrl}/api/v1/copilot/dsh-config`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload)
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function sendMessage(h: Harness, token: string, content: string): Promise<void> {
  const conv = await fetch(`${h.baseUrl}/api/v1/copilot/conversations`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({})
  });
  const convBody = (await conv.json()) as { data: { conversation: { id: string } } };
  const res = await fetch(`${h.baseUrl}/api/v1/copilot/conversations/${convBody.data.conversation.id}/messages`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ content })
  });
  assert.equal(res.status, 201, JSON.stringify(await res.json()));
}

function readFakeLog(logPath: string): Array<Record<string, unknown>> {
  return readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("copilot dsh-config API (M4, flag on)", () => {
  it("returns defaults, the plugin whitelist, and runtime status on GET", async () => {
    const h = await bootDshGateway({ withDsh: true });
    const { token } = await registerAndSeed(h, "dshcfg-get@test.com");
    const { status, body } = await getConfig(h, token);
    assert.equal(status, 200, JSON.stringify(body));
    const data = body.data as Record<string, unknown>;
    assert.equal(data.defaultModelId, null);
    assert.deepEqual(data.plugins, { compaction: true, subagents: true });
    const available = data.availablePlugins as Array<{ id: string }>;
    assert.deepEqual(available.map((p) => p.id), DSH_AVAILABLE_PLUGINS.map((p) => p.id));
    assert.deepEqual(data.runtime, { status: "idle" });
  });

  it("rejects unknown plugin keys with 400", async () => {
    const h = await bootDshGateway({ withDsh: true });
    const { token } = await registerAndSeed(h, "dshcfg-badplugin@test.com");
    const { status, body } = await putConfig(h, token, { plugins: { mcp: true } });
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal((body.details as { code?: string })?.code, "COPILOT_DSH_CONFIG_UNKNOWN_PLUGIN");
    assert.match(body.message as string, /mcp/);
  });

  it("rejects a defaultModelId that is missing, foreign, or inactive with 400", async () => {
    const h = await bootDshGateway({ withDsh: true });
    const owner = await registerAndSeed(h, "dshcfg-model-owner@test.com");
    const stranger = await registerAndSeed(h, "dshcfg-model-stranger@test.com");

    // Nonexistent profile.
    const missing = await putConfig(h, owner.token, { defaultModelId: "no-such-profile" });
    assert.equal(missing.status, 400);
    assert.equal((missing.body.details as { code?: string })?.code, "COPILOT_DSH_CONFIG_INVALID_MODEL");

    // Another user's profile id.
    const foreign = await putConfig(h, owner.token, { defaultModelId: stranger.defaultModelProfileId });
    assert.equal(foreign.status, 400);

    // Inactive profile.
    h.db.prepare("UPDATE model_profiles SET status = 'disabled' WHERE id = ?").run(owner.altModelProfileId);
    const inactive = await putConfig(h, owner.token, { defaultModelId: owner.altModelProfileId });
    assert.equal(inactive.status, 400);
  });

  it("persists a valid config and reflects it on GET, per user isolated", async () => {
    const h = await bootDshGateway({ withDsh: true });
    const owner = await registerAndSeed(h, "dshcfg-put@test.com");
    const stranger = await registerAndSeed(h, "dshcfg-put-stranger@test.com");

    const put = await putConfig(h, owner.token, { defaultModelId: owner.altModelProfileId, plugins: { subagents: false } });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const data = put.body.data as Record<string, unknown>;
    assert.equal(data.defaultModelId, owner.altModelProfileId);
    assert.deepEqual(data.plugins, { compaction: true, subagents: false });
    assert.equal(data.runtimeRestarted, false, "no runtime was live");

    const got = await getConfig(h, owner.token);
    assert.equal((got.body.data as Record<string, unknown>).defaultModelId, owner.altModelProfileId);

    // The stranger sees only defaults.
    const foreign = await getConfig(h, stranger.token);
    assert.deepEqual((foreign.body.data as Record<string, unknown>).plugins, { compaction: true, subagents: true });
    assert.equal((foreign.body.data as Record<string, unknown>).defaultModelId, null);
  });

  it("renders the per-user cordis.yml at spawn and restarts an idle runtime", async () => {
    const h = await bootDshGateway({ withDsh: true, configTemplatePath: REAL_TEMPLATE });
    const owner = await registerAndSeed(h, "dshcfg-spawn@test.com");

    // First spawn with defaults: no config row yet -> full composition.
    await sendMessage(h, owner.token, "你好");
    let boots = readFakeLog(h.logPath).filter((r) => r.kind === "boot");
    assert.equal(boots.length, 1);
    const firstConfigPath = (boots[0]?.env as Record<string, unknown>).bridgeConfig as string;
    assert.ok(firstConfigPath, "DSH_BRIDGE_CONFIG is injected");
    const firstRendered = readFileSync(firstConfigPath, "utf8");
    assert.ok(firstRendered.includes("dsh-subagent") && firstRendered.includes("dsh-compaction-basic"));

    // Runtime is live now; a config change restarts it (no active run).
    const status = await getConfig(h, owner.token);
    assert.deepEqual((status.body.data as Record<string, unknown>).runtime, { status: "running" });
    const put = await putConfig(h, owner.token, { plugins: { subagents: false, compaction: false } });
    assert.equal((put.body.data as Record<string, unknown>).runtimeRestarted, true);
    const afterRestart = await getConfig(h, owner.token);
    assert.deepEqual((afterRestart.body.data as Record<string, unknown>).runtime, { status: "idle" });

    // Next message respawns with the new composition.
    await sendMessage(h, owner.token, "再来一次");
    boots = readFakeLog(h.logPath).filter((r) => r.kind === "boot");
    assert.equal(boots.length, 2);
    const secondRendered = readFileSync((boots[1]?.env as Record<string, unknown>).bridgeConfig as string, "utf8");
    assert.ok(!secondRendered.includes("dsh-subagent"));
    assert.ok(!secondRendered.includes("dsh-compaction-basic"));
    assert.ok(secondRendered.includes("dsh-llm-pi-ai"));
  });

  it("resolves the configured default model when a message names none", async () => {
    const h = await bootDshGateway({ withDsh: true, configTemplatePath: REAL_TEMPLATE });
    const owner = await registerAndSeed(h, "dshcfg-model@test.com");

    // Baseline spawn resolves the system default profile.
    await sendMessage(h, owner.token, "第一句");
    const firstInit = readFakeLog(h.logPath).filter((r) => r.kind === "initialize").at(-1);
    assert.equal((firstInit?.params as Record<string, unknown>).model, "stub-model");

    // Configure the override; the runtime restarts; next spawn uses it.
    const put = await putConfig(h, owner.token, { defaultModelId: owner.altModelProfileId });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    await sendMessage(h, owner.token, "第二句");
    const secondInit = readFakeLog(h.logPath).filter((r) => r.kind === "initialize").at(-1);
    assert.equal((secondInit?.params as Record<string, unknown>).model, "stub-model-alt");
  });
});

describe("copilot dsh-config API (flag off)", () => {
  it("404s both endpoints when the dsh copilot is disabled", async () => {
    const h = await bootDshGateway({ withDsh: false });
    const res = await fetch(`${h.baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dshcfg-off@test.com", password: "password123" })
    });
    const token = ((await res.json()) as { data: { token: string } }).data.token;
    const got = await getConfig(h, token);
    assert.equal(got.status, 404);
    const put = await putConfig(h, token, { plugins: { subagents: false } });
    assert.equal(put.status, 404);
  });
});
