import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { createAdapterLaunchPlan } from "../src/adapters/index.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import type { ProviderApiFormat } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { listAdapterDefinitions } from "../src/services/adapter-discovery.js";
import { cliConfigTargetPath, globalConfigRoot } from "../src/services/cli-config-target.js";
import { listCliConfigAdapters, readCliConfig, readCliConfigFile } from "../src/services/cli-config.js";
import {
  applyCliConfigToAdapter,
  CliConfigApplyError,
  endpointForAdapter,
  previewCliConfigApply,
  rollbackCliConfigApply
} from "../src/services/cli-config-apply.js";
import { listCliConfigFields } from "../src/services/cli-config-fields.js";
import { ensureGrokNotificationSettings } from "../src/services/grok-notification-settings.js";
import { buildProjectConfigFiles } from "../src/services/project-config-files.js";
import { getProviderCapabilities } from "../src/services/provider-capabilities.js";
import { buildAppliedProvidersOverview } from "../src/services/model-provider-applied.js";
import {
  currentProgrammaticComposer,
  isProgrammaticComposerReady
} from "../src/services/programmatic-terminal-submit.js";
import { createLaunchPlan, prepareAdapterLaunchExtras } from "../src/services/session-launch-plan.js";

const masterKey = "abcdef0123456789abcdef0123456789";
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const secret = "sk-grok-apply-secret";
const userSecret = "sk-user-keep";

type TomlDoc = Record<string, unknown>;

async function useGrokHome(): Promise<{ dir: string; restore: () => void }> {
  const previous = process.env.GROK_HOME;
  const dir = await mkdtemp(path.join(tmpdir(), "forgebadger-grok-"));
  process.env.GROK_HOME = dir;
  return {
    dir,
    restore() {
      if (previous === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = previous;
    }
  };
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function readToml(dir: string): TomlDoc {
  return parseToml(readFileSync(path.join(dir, "config.toml"), "utf8")) as TomlDoc;
}

function modelBlock(doc: TomlDoc, key: string): Record<string, unknown> | undefined {
  const table = doc.model;
  if (!table || typeof table !== "object" || Array.isArray(table)) return undefined;
  const entry = (table as Record<string, unknown>)[key];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  return entry as Record<string, unknown>;
}

function headersOf(entry: Record<string, unknown>): Record<string, unknown> {
  const headers = entry.extra_headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  return headers as Record<string, unknown>;
}

function seedDocument(): string {
  return stringifyToml({
    ui: { theme: "dark" },
    model: {
      custom: {
        model: "user-model",
        base_url: "https://user.example/v1",
        name: "User",
        api_backend: "chat_completions",
        api_key: userSecret
      },
      "fb-9grok": {
        model: "old",
        base_url: "https://old.example/v1",
        name: "Old",
        api_backend: "chat_completions",
        api_key: "stale-bearer",
        extra_headers: { "x-user-header": "keep-me" }
      }
    },
    models: { default: "custom", web_search: "off" },
    mcp_servers: { local: { command: "noop" } }
  });
}

function seedUser(
  db: Database.Database,
  email: string,
  input: {
    providerKey: string;
    apiFormat: ProviderApiFormat;
    baseUrl?: string | null;
    anthropicBaseUrl?: string | null;
    authType?: "api_key" | "none";
    contextWindow?: number | null;
    supportedAdapters?: Array<"claude" | "grok">;
  }
) {
  const user = new UserRepository(db).create(email, "hash");
  const repo = new ModelProviderRepository(db, user.id, masterKey);
  const provider = repo.createProviderProfile({
    name: "Gateway",
    providerKey: input.providerKey,
    baseUrl: input.baseUrl,
    anthropicBaseUrl: input.anthropicBaseUrl,
    authType: input.authType ?? "api_key",
    apiFormat: input.apiFormat,
    supportedAdapters: input.supportedAdapters ?? ["grok"]
  });
  const model = repo.createModelProfile({
    providerProfileId: provider.id,
    name: "DeepSeek",
    modelId: "deepseek-chat",
    isDefault: true,
    ...(input.contextWindow !== undefined ? { contextWindow: input.contextWindow } : {})
  });
  repo.createCredential({
    providerProfileId: provider.id,
    label: "Primary",
    plaintextSecret: secret
  });
  return { user, repo, provider, model };
}

describe("Grok adapter", () => {
  it("registers grok as a supported zero-arg terminal adapter", () => {
    const grok = listAdapterDefinitions().find((entry) => entry.id === "grok");
    assert.equal(grok?.label, "Grok");
    assert.equal(grok?.command, "grok");
    assert.deepEqual(grok?.versionArgs, ["--version"]);
    assert.equal(grok?.supportLevel, "supported");
    assert.equal(grok?.launchEnabled, true);
    assert.equal(grok?.configDir, ".grok");
    assert.deepEqual(grok?.runtimeModes, ["terminal"]);

    const plan = createLaunchPlan({
      adapter: "grok",
      projectRoot: path.join(path.sep, "work"),
      sessionId: "sess-grok"
    });
    assert.equal(plan.command, "grok");
    assert.deepEqual(plan.args, []);
    assert.equal(plan.cwd, path.join(path.sep, "work"));
    assert.equal(plan.credentialMode, "host_environment");
    assert.deepEqual(plan.secretEnvNames, []);
    assert.deepEqual(Object.keys(plan.env).sort(), ["FORGEBADGER_GATEWAY_URL", "FORGEBADGER_SESSION_ID", "GROK_HOME"]);
    assert.equal(plan.env.GROK_HOME, globalConfigRoot("grok"));
    assert.equal(plan.env.FORGEBADGER_SESSION_ID, "sess-grok");
    assert.equal(plan.env.FORGEBADGER_ATTACH_TOKEN, undefined);

    const direct = createAdapterLaunchPlan({
      adapter: "grok",
      projectRoot: path.join(path.sep, "work"),
      credentialMode: "host_environment"
    });
    assert.deepEqual(direct.args, []);
    assert.deepEqual(direct.secretEnvNames, []);
    assert.equal(currentProgrammaticComposer("grok", "› ask anything"), "");
    assert.equal(isProgrammaticComposerReady("grok", "› ask anything"), false);
  });

  it("resolves GROK_HOME and refuses project scope", () => {
    const home = path.resolve(path.join(path.sep, "home", "tester"));
    const at = (...segments: string[]): string => path.resolve(path.join(home, ...segments));
    assert.equal(
      globalConfigRoot("grok", { env: { GROK_HOME: at("custom") }, homeDir: home }),
      at("custom")
    );
    assert.equal(globalConfigRoot("grok", { env: { GROK_HOME: "   " }, homeDir: home }), at(".grok"));
    assert.equal(globalConfigRoot("grok", { env: {}, homeDir: home }), at(".grok"));

    const capability = getProviderCapabilities().find((entry) => entry.adapter === "grok");
    assert.ok(capability);
    assert.deepEqual(capability.apiFormats, ["anthropic", "openai-responses", "openai-compatible"]);
    assert.deepEqual(capability.scopes, ["global"]);
    assert.equal(capability.modelSelection, "native-config");
    assert.equal(capability.projectionScope, "user-global");

    const listed = listCliConfigAdapters().find((entry) => entry.adapter === "grok");
    assert.equal(listed?.configFile, "config.toml");
    const fields = listCliConfigFields("grok");
    assert.deepEqual(fields.map((field) => field.path), ["models.default"]);
    assert.equal(fields.some((field) => /api_key|extra_headers/.test(field.path)), false);

    assert.throws(
      () => cliConfigTargetPath({ adapter: "grok", scope: "project", projectRoot: home }),
      /global-only/
    );
    const anthropic = {
      apiFormat: "anthropic",
      baseUrl: "https://proxy.invalid",
      anthropicBaseUrl: "https://anthropic-proxy.invalid"
    } as never;
    assert.equal(endpointForAdapter(anthropic, "grok"), "https://anthropic-proxy.invalid");
  });

  it("writes one managed model block and preserves unrelated tables", async () => {
    const home = await useGrokHome();
    const db = createTestDb();
    try {
      const original = seedDocument();
      await writeFile(path.join(home.dir, "config.toml"), original, "utf8");
      const { user, repo, provider, model } = seedUser(db, "grok-apply@example.test", {
        providerKey: "9grok",
        apiFormat: "anthropic",
        baseUrl: "https://api.example.com",
        anthropicBaseUrl: "https://anthropic.example.com",
        contextWindow: 128000
      });

      const applied = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "grok",
        providerProfileId: provider.id, resolveHost: publicResolver
      });
      assert.equal(applied.changed, true);
      const statuses = await buildAppliedProvidersOverview(db, user.id, masterKey, { isAdmin: true });
      const status = statuses.find((entry) => entry.adapter === "grok");
      assert.equal(status?.configDefaultModel, "fb-9grok");
      assert.equal(status?.stale, false);
      let doc = readToml(home.dir);
      assert.equal((doc.ui as Record<string, unknown>).theme, "dark");
      assert.equal((doc.models as Record<string, unknown>).default, "fb-9grok");
      assert.equal((doc.models as Record<string, unknown>).web_search, "off");
      assert.equal((doc.mcp_servers as Record<string, Record<string, unknown>>).local.command, "noop");
      assert.equal(modelBlock(doc, "custom")?.api_key, userSecret);

      const messages = modelBlock(doc, "fb-9grok");
      assert.ok(messages);
      assert.equal(messages.model, "deepseek-chat");
      assert.equal(messages.name, "DeepSeek");
      assert.equal(messages.base_url, "https://anthropic.example.com");
      assert.equal(messages.api_backend, "messages");
      assert.equal(messages.api_key, undefined);
      assert.equal(messages.context_window, 128000);
      assert.equal(headersOf(messages)["x-api-key"], secret);
      assert.equal(headersOf(messages)["anthropic-version"], "2023-06-01");
      assert.equal(headersOf(messages)["x-user-header"], "keep-me");
      assert.equal(existsSync(path.join(home.dir, "auth.json")), false);

      repo.updateModelProfile(model.id, { contextWindow: null });
      repo.updateProviderProfile(provider.id, { apiFormat: "openai-compatible" });
      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "grok",
        providerProfileId: provider.id, resolveHost: publicResolver
      });
      doc = readToml(home.dir);
      const chat = modelBlock(doc, "fb-9grok");
      assert.ok(chat);
      assert.equal(chat.api_backend, "chat_completions");
      assert.equal(chat.base_url, "https://api.example.com");
      assert.equal(chat.api_key, secret);
      assert.equal(chat.context_window, 128000);
      assert.equal(headersOf(chat)["x-api-key"], undefined);
      assert.equal(headersOf(chat)["anthropic-version"], undefined);
      assert.equal(headersOf(chat)["x-user-header"], "keep-me");

      repo.updateProviderProfile(provider.id, { apiFormat: "openai-responses" });
      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "grok",
        providerProfileId: provider.id, resolveHost: publicResolver
      });
      doc = readToml(home.dir);
      const responses = modelBlock(doc, "fb-9grok");
      assert.ok(responses);
      assert.equal(responses.api_backend, "responses");
      assert.equal(responses.api_key, secret);
      assert.equal(headersOf(responses)["x-user-header"], "keep-me");
      assert.equal(modelBlock(doc, "custom")?.name, "User");

      const other = repo.createProviderProfile({
        name: "Other",
        providerKey: "other-prov",
        baseUrl: "https://other.example.com",
        authType: "api_key",
        apiFormat: "openai-compatible",
        supportedAdapters: ["grok"]
      });
      repo.createModelProfile({
        providerProfileId: other.id,
        name: "Other model",
        modelId: "other-model",
        isDefault: true
      });
      repo.createCredential({
        providerProfileId: other.id,
        label: "Other",
        plaintextSecret: "sk-other-secret"
      });
      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "grok",
        providerProfileId: other.id, resolveHost: publicResolver
      });
      doc = readToml(home.dir);
      assert.equal(modelBlock(doc, "fb-9grok"), undefined);
      assert.equal(modelBlock(doc, "custom")?.api_key, userSecret);
      const switched = modelBlock(doc, "other-prov");
      assert.ok(switched);
      assert.equal(switched.model, "other-model");
      assert.equal(switched.api_key, "sk-other-secret");
      assert.equal("context_window" in switched, false);
      assert.equal((doc.models as Record<string, unknown>).default, "other-prov");
      assert.equal((doc.models as Record<string, unknown>).web_search, "off");
    } finally {
      home.restore();
      db.close();
    }
  });

  it("rejects google and a missing base URL before writing", async () => {
    const home = await useGrokHome();
    const db = createTestDb();
    try {
      const original = "untouched = true\n";
      await writeFile(path.join(home.dir, "config.toml"), original, "utf8");
      const google = seedUser(db, "grok-google@example.test", {
        providerKey: "google-prov",
        apiFormat: "google",
        baseUrl: "https://generativelanguage.googleapis.com"
      });
      await assert.rejects(
        () => applyCliConfigToAdapter({
          db, userId: google.user.id, masterKey, adapter: "grok",
          providerProfileId: google.provider.id, resolveHost: publicResolver
        }),
        (error: unknown) => error instanceof CliConfigApplyError && error.code === "CLI_CONFIG_APPLY_FIELD_UNSUPPORTED"
      );

      const missing = seedUser(db, "grok-nourl@example.test", {
        providerKey: "nourl",
        apiFormat: "openai-compatible",
        authType: "none",
        baseUrl: null
      });
      await assert.rejects(
        () => applyCliConfigToAdapter({
          db, userId: missing.user.id, masterKey, adapter: "grok",
          providerProfileId: missing.provider.id, resolveHost: publicResolver
        }),
        (error: unknown) => error instanceof CliConfigApplyError && error.code === "CLI_CONFIG_APPLY_ENDPOINT_UNSAFE"
      );
      assert.equal(readFileSync(path.join(home.dir, "config.toml"), "utf8"), original);
    } finally {
      home.restore();
      db.close();
    }
  });

  it("masks secrets in preview and file reads, and rolls back the whole file", async () => {
    const home = await useGrokHome();
    const db = createTestDb();
    try {
      const original = seedDocument();
      await writeFile(path.join(home.dir, "config.toml"), original, "utf8");
      const { user, provider } = seedUser(db, "grok-preview@example.test", {
        providerKey: "preview-prov",
        apiFormat: "openai-compatible",
        baseUrl: "https://api.example.com",
        contextWindow: 32000
      });
      const preview = await previewCliConfigApply({
        db, userId: user.id, masterKey, adapter: "grok",
        providerProfileId: provider.id, resolveHost: publicResolver
      });
      const serialized = JSON.stringify(preview);
      assert.doesNotMatch(serialized, new RegExp(secret));
      assert.doesNotMatch(serialized, new RegExp(userSecret));
      assert.match(serialized, /\[redacted\]/);
      assert.equal(readFileSync(path.join(home.dir, "config.toml"), "utf8"), original);

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "grok",
        providerProfileId: provider.id, resolveHost: publicResolver
      });
      const file = await readCliConfigFile("grok", "config.toml");
      assert.doesNotMatch(file.content ?? "", new RegExp(secret));
      assert.doesNotMatch(file.content ?? "", new RegExp(userSecret));
      assert.match(file.content ?? "", /\[redacted\]/);
      assert.match(file.content ?? "", /anthropic-version|chat_completions/);
      const snapshot = await readCliConfig("grok");
      assert.equal(JSON.stringify(snapshot).includes(secret), false);
      assert.equal(snapshot.defaultModel, "preview-prov");
      assert.equal(snapshot.providers.find((entry) => entry.id === "preview-prov")?.hasApiKey, true);

      await rollbackCliConfigApply({ db, userId: user.id, masterKey, adapter: "grok" });
      assert.equal(readFileSync(path.join(home.dir, "config.toml"), "utf8"), original);
    } finally {
      home.restore();
      db.close();
    }
  });

  it("places project skills under .grok and keeps instructions at the repo root", () => {
    const files = buildProjectConfigFiles({
      adapter: "grok",
      templateFiles: [{
        id: "memory",
        relativePath: ".claude/CLAUDE.md",
        content: "Use Claude Code today.",
        renderVariables: false
      }],
      skills: [{
        skillId: "skill-1",
        name: "Review Notes",
        description: "notes",
        source: "local",
        content: "do the thing",
        version: "1",
        isEnabled: true,
        selectionState: "project_enabled"
      }]
    });
    const paths = files.map((file) => file.relativePath);
    assert.ok(paths.includes("AGENTS.md"));
    assert.equal(paths.includes(".grok/AGENTS.md"), false);
    assert.equal(files.find((file) => file.relativePath === "AGENTS.md")?.content, "Use Grok today.");
    assert.ok(paths.includes(".grok/skills/review-notes/SKILL.md"));
  });

  it("installs one global hook and does not embed a session id", async () => {
    const home = await useGrokHome();
    const db = createTestDb();
    const previousDisable = process.env.FORGEBADGER_DISABLE_CLI_HOOKS;
    const previousSession = process.env.FORGEBADGER_SESSION_ID;
    const previousToken = process.env.FORGEBADGER_ATTACH_TOKEN;
    try {
      process.env.FORGEBADGER_DISABLE_CLI_HOOKS = "grok";
      process.env.FORGEBADGER_SESSION_ID = "fb-session-leak-check";
      process.env.FORGEBADGER_ATTACH_TOKEN = "attach-leak-check";
      await prepareAdapterLaunchExtras(db, "user-1", "grok", home.dir);
      assert.equal(existsSync(path.join(home.dir, "hooks", "forgebadger.json")), false);

      delete process.env.FORGEBADGER_DISABLE_CLI_HOOKS;
      await mkdir(path.join(home.dir, "hooks"), { recursive: true });
      await writeFile(path.join(home.dir, "hooks", "forgebadger.json"), JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "echo user-hook", timeout: 2 }] }],
          StopFailure: [{ hooks: [{ type: "command", command: "node /tmp/forgebadger-notify.mjs" }] }]
        }
      }), "utf8");
      const first = await ensureGrokNotificationSettings();
      assert.equal(first.changed, true);
      const second = await ensureGrokNotificationSettings();
      assert.equal(second.changed, false);

      const hookText = await readFile(path.join(home.dir, "hooks", "forgebadger.json"), "utf8");
      const scriptText = await readFile(path.join(home.dir, "hooks", "forgebadger-notify.mjs"), "utf8");
      assert.equal(hookText.includes("fb-session-leak-check"), false);
      assert.equal(hookText.includes("attach-leak-check"), false);
      assert.equal(scriptText.includes("fb-session-leak-check"), false);
      const hook = JSON.parse(hookText) as { hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout?: number }> }>> };
      for (const event of ["Stop", "StopFailure", "Notification", "PermissionDenied"]) {
        const commands = hook.hooks[event].flatMap((group) => group.hooks.map((item) => item.command));
        const managed = commands.filter((command) => command.includes("forgebadger-notify.mjs"));
        assert.equal(managed.length, 1, event);
        assert.match(managed[0] ?? "", /^node '/);
        assert.equal(hook.hooks[event].at(-1)?.hooks[0]?.timeout, 5);
      }
      const stopCommands = hook.hooks.Stop.flatMap((group) => group.hooks.map((item) => item.command));
      assert.ok(stopCommands.includes("echo user-hook"));
    } finally {
      home.restore();
      db.close();
      if (previousDisable === undefined) delete process.env.FORGEBADGER_DISABLE_CLI_HOOKS;
      else process.env.FORGEBADGER_DISABLE_CLI_HOOKS = previousDisable;
      if (previousSession === undefined) delete process.env.FORGEBADGER_SESSION_ID;
      else process.env.FORGEBADGER_SESSION_ID = previousSession;
      if (previousToken === undefined) delete process.env.FORGEBADGER_ATTACH_TOKEN;
      else process.env.FORGEBADGER_ATTACH_TOKEN = previousToken;
    }
  });

  it("leaves an invalid hook file untouched", async () => {
    const home = await useGrokHome();
    try {
      await mkdir(path.join(home.dir, "hooks"), { recursive: true });
      const hookPath = path.join(home.dir, "hooks", "forgebadger.json");
      await writeFile(hookPath, "{", "utf8");
      const result = await ensureGrokNotificationSettings();
      assert.equal(result.changed, true);
      assert.equal(await readFile(hookPath, "utf8"), "{");
      assert.equal(existsSync(path.join(home.dir, "hooks", "forgebadger-notify.mjs")), true);
    } finally {
      home.restore();
    }
  });

  it("posts a notification only when session env and JSON stdin are present", async () => {
    const home = await useGrokHome();
    const requests: Array<{ url: string | undefined; sessionId: string | undefined; token: string | undefined; body: string }> = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requests.push({
          url: req.url,
          sessionId: headerValue(req, "x-forgebadger-session-id"),
          token: headerValue(req, "x-forgebadger-session-token"),
          body: Buffer.concat(chunks).toString("utf8")
        });
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    try {
      await ensureGrokNotificationSettings();
      const script = path.join(home.dir, "hooks", "forgebadger-notify.mjs");
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      const gatewayUrl = `http://127.0.0.1:${port}/`;

      await runNotify(script, {}, "");
      await delay(1200);
      assert.equal(requests.length, 0);

      await runNotify(script, {
        FORGEBADGER_GATEWAY_URL: gatewayUrl,
        FORGEBADGER_SESSION_ID: "sess-1",
        FORGEBADGER_ATTACH_TOKEN: "token-1"
      }, "not-json");
      await delay(1200);
      assert.equal(requests.length, 0);

      await runNotify(script, {
        FORGEBADGER_GATEWAY_URL: gatewayUrl,
        FORGEBADGER_SESSION_ID: "sess-1",
        FORGEBADGER_ATTACH_TOKEN: "token-1"
      }, JSON.stringify({ hook_event_name: "Stop" }));
      await waitFor(() => requests.length === 1);
      await delay(200);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.url, "/api/v1/session-hooks/cli-notification");
      assert.equal(requests[0]?.sessionId, "sess-1");
      assert.equal(requests[0]?.token, "token-1");
      assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), { hook_event_name: "Stop", adapter: "grok" });
    } finally {
      home.restore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("migration 0135 accepts grok and 0136 backfills supported adapters", () => {
    const db = createTestDb();
    try {
      const table = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='model_provider_bindings'")
        .get() as { sql: string } | undefined;
      assert.ok(table);
      assert.match(table.sql, /'claude','opencode','codex','kimi','pi','mcode','grok'/);
      const migrationSql = readFileSync(path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../src/db/migrations/0135_grok_adapter.sql"
      ), "utf8");
      assert.match(migrationSql, /_grok_binding_copy_guard/);
      assert.match(migrationSql, /CHECK \(`ok` = 0\)/);

      const user = new UserRepository(db).create("grok-backfill@example.test", "hash");
      const repo = new ModelProviderRepository(db, user.id, masterKey);
      const anthropic = repo.createProviderProfile({
        name: "Anthropic",
        providerKey: "anth",
        baseUrl: "https://api.anthropic.com",
        authType: "api_key",
        apiFormat: "anthropic",
        supportedAdapters: ["claude"]
      });
      const google = repo.createProviderProfile({
        name: "Google",
        providerKey: "gem",
        baseUrl: "https://generativelanguage.googleapis.com",
        authType: "api_key",
        apiFormat: "google",
        supportedAdapters: ["claude"]
      });
      const already = repo.createProviderProfile({
        name: "Already",
        providerKey: "already",
        baseUrl: "https://already.example.com",
        authType: "api_key",
        apiFormat: "openai-responses",
        supportedAdapters: ["claude", "grok"]
      });
      const backfill = readFileSync(path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../src/db/migrations/0136_grok_supported_adapters_backfill.sql"
      ), "utf8");
      db.exec(backfill);
      assert.deepEqual(repo.getProviderProfile(anthropic.id)?.supportedAdapters, ["claude", "grok"]);
      assert.deepEqual(repo.getProviderProfile(google.id)?.supportedAdapters, ["claude"]);
      assert.deepEqual(repo.getProviderProfile(already.id)?.supportedAdapters, ["claude", "grok"]);
    } finally {
      db.close();
    }
  });
});

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 3000) throw new Error("timed out waiting for the hook request");
    await delay(50);
  }
}

function runNotify(script: string, env: Record<string, string>, stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`notify script exited ${code}: ${stderr}`));
    });
    child.stdin.end(stdin);
  });
}
