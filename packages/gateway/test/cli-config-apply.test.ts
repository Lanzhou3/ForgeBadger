import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import type { AdapterId } from "../src/services/adapter-discovery.js";
import {
  applyCliConfigToAdapter,
  CliConfigApplyError,
  previewCliConfigApply,
  rollbackCliConfigApply
} from "../src/services/cli-config-apply.js";

const masterKey = "abcdef0123456789abcdef0123456789";
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

async function useConfigRoot(envVar: string, prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  process.env[envVar] = dir;
  return dir;
}

function backupRoot(adapter: AdapterId): string {
  return path.join(tmpdir(), `forgebadger-test-${process.pid}`, "backups", "cli-config", adapter);
}

function modeOf(targetPath: string): number {
  return statSync(targetPath).mode & 0o777;
}

// Windows has no POSIX permission bits (chmod maps to the read-only attribute,
// so a 0600 write reports 0o666). Assert the exact mode only on POSIX hosts.
function assertPrivateMode(targetPath: string, expected: number): void {
  if (process.platform !== "win32") {
    assert.equal(modeOf(targetPath), expected);
  }
}

async function settle(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface Fixture {
  repo: ModelProviderRepository;
  providerId: string;
  modelId: string;
  credentialId: string;
}

function createFixture(db: Database.Database, userId: string, adapter: AdapterId): Fixture {
  const repo = new ModelProviderRepository(db, userId, masterKey);
  const provider = repo.createProviderProfile({
    name: `${adapter} provider`,
    providerKey: `${adapter}-provider`,
    baseUrl: "https://api.deepseek.com",
    anthropicBaseUrl: "https://api.deepseek.com/anthropic",
    openaiBaseUrl: "https://api.deepseek.com/v1",
    authType: "api_key",
    apiFormat: adapter === "claude" || adapter === "kimi" ? "anthropic" : "openai-compatible",
    supportedAdapters: [adapter]
  });
  const model = repo.createModelProfile({
    providerProfileId: provider.id,
    name: "Default Model",
    modelId: `${adapter}-model-1`,
    isDefault: true
  });
  const credential = repo.createCredential({
    providerProfileId: provider.id,
    label: "Primary",
    plaintextSecret: `sk-${adapter}-secret`
  });
  return { repo, providerId: provider.id, modelId: model.id, credentialId: credential.id };
}

describe("cli-config apply service", () => {
  describe("applyCliConfigToAdapter", () => {
    it("applies a Claude provider with plaintext token, 0600 file, backup, and rollback", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-claude@example.com", "hash");
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-apply-claude-");
      const fixture = createFixture(db, user.id, "claude");

      const result = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });

      const target = path.join(root, "settings.json");
      const doc = JSON.parse(await readFile(target, "utf8")) as { env: Record<string, string> };
      assert.equal(doc.env.ANTHROPIC_BASE_URL, "https://api.deepseek.com/anthropic");
      assert.equal(doc.env.ANTHROPIC_AUTH_TOKEN, "sk-claude-secret");
      assert.equal(doc.env.ANTHROPIC_MODEL, "claude-model-1");
      assert.equal(doc.env.ANTHROPIC_SMALL_FAST_MODEL, "claude-model-1");
      assert.equal(doc.env.API_TIMEOUT_MS, "600000");
      assertPrivateMode(target, 0o600);
      assert.equal(result.changed, true);
      assert.equal(result.files.length, 1);
      assert.equal(result.files[0]?.operation, "create");
      // No temp files left behind by the atomic write.
      assert.equal((await readdir(root)).some((name) => name.endsWith(".tmp")), false);

      const backupPath = path.join(backupRoot("claude"), result.backupId);
      assertPrivateMode(backupPath, 0o600);
      assertPrivateMode(backupRoot("claude"), 0o700);
      const backupContent = await readFile(backupPath, "utf8");
      assert.equal(backupContent.includes("sk-claude-secret"), false);

      const rolledBack = rollbackCliConfigApply({ masterKey, adapter: "claude", backupId: result.backupId });
      assert.deepEqual(rolledBack.restoredFiles, [target]);
      assert.equal(existsSync(target), false);
    });

    it("applies Codex config.toml with a bearer token and strips the legacy auth.json key", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-codex@example.com", "hash");
      const root = await useConfigRoot("CODEX_HOME", "forgebadger-apply-codex-");
      const fixture = createFixture(db, user.id, "codex");
      await writeFile(
        path.join(root, "auth.json"),
        JSON.stringify({ OPENAI_API_KEY: "sk-stale", OTHER_FIELD: "keep-me" }),
        "utf8"
      );

      const result = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "codex",
        providerProfileId: fixture.providerId,
        modelProfileId: fixture.modelId,
        credentialId: fixture.credentialId,
        resolveHost: publicResolver
      });

      const configToml = await readFile(path.join(root, "config.toml"), "utf8");
      assert.match(configToml, /model = "codex-model-1"/u);
      assert.match(configToml, /model_provider = "codex-provider"/u);
      assert.match(configToml, /\[model_providers\.codex-provider\]/u);
      assert.match(configToml, /base_url = "https:\/\/api\.deepseek\.com\/v1"/u);
      assert.match(configToml, /wire_api = "responses"/u);
      // cc-switch semantics (Codex 0.149+): third-party keys live in the
      // provider table, not in auth.json.
      assert.match(configToml, /experimental_bearer_token = "sk-codex-secret"/u);
      const auth = JSON.parse(await readFile(path.join(root, "auth.json"), "utf8")) as Record<string, string>;
      assert.equal(auth.OPENAI_API_KEY, undefined);
      assert.equal(auth.OTHER_FIELD, "keep-me");
      assertPrivateMode(path.join(root, "config.toml"), 0o600);
      assertPrivateMode(path.join(root, "auth.json"), 0o600);
      assert.equal(result.files.length, 2);
      assert.equal(result.files[1]?.operation, "update");
    });

    it("deletes a Codex auth.json that only carried the managed key", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-codex-delete@example.com", "hash");
      const root = await useConfigRoot("CODEX_HOME", "forgebadger-apply-codex-delete-");
      const fixture = createFixture(db, user.id, "codex");
      await writeFile(path.join(root, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-stale" }), "utf8");

      const result = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "codex",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });

      // Codex errors on an empty auth.json but shows the login screen when the
      // file is missing, so an emptied file is deleted outright.
      assert.equal(existsSync(path.join(root, "auth.json")), false);
      assert.equal(result.files[1]?.operation, "delete");

      const rolledBack = rollbackCliConfigApply({ masterKey, adapter: "codex", backupId: result.backupId });
      assert.ok(rolledBack.restoredFiles.includes(path.join(root, "auth.json")));
      const restored = JSON.parse(await readFile(path.join(root, "auth.json"), "utf8")) as Record<string, string>;
      assert.equal(restored.OPENAI_API_KEY, "sk-stale");
    });

    it("refuses a symlinked Codex auth.json without writing config.toml", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-codex-symlink@example.com", "hash");
      const root = await useConfigRoot("CODEX_HOME", "forgebadger-apply-codex-symlink-");
      const fixture = createFixture(db, user.id, "codex");
      const outside = path.join(await mkdtemp(path.join(tmpdir(), "forgebadger-apply-outside-")), "auth.json");
      await writeFile(outside, "{}", "utf8");
      await symlink(outside, path.join(root, "auth.json"));

      const error = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "codex",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      }).catch((caught: unknown) => caught);

      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, "CLI_CONFIG_TARGET_UNSAFE");
      assert.equal(existsSync(path.join(root, "config.toml")), false);
    });

    it("applies an OpenCode provider with plaintext apiKey and provider/model selection", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-opencode@example.com", "hash");
      const root = await useConfigRoot("OPENCODE_CONFIG_DIR", "forgebadger-apply-opencode-");
      const fixture = createFixture(db, user.id, "opencode");

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "opencode",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });

      const doc = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8")) as {
        provider: Record<string, {
          npm: string;
          name: string;
          options: Record<string, string>;
          models: Record<string, { name: string }>;
        }>;
        model: string;
      };
      assert.equal(doc.provider["opencode-provider"]?.npm, "@ai-sdk/openai-compatible");
      assert.equal(doc.provider["opencode-provider"]?.name, "opencode provider");
      assert.equal(doc.provider["opencode-provider"]?.options.baseURL, "https://api.deepseek.com/v1");
      assert.equal(doc.provider["opencode-provider"]?.options.apiKey, "sk-opencode-secret");
      assert.equal(doc.provider["opencode-provider"]?.models["opencode-model-1"]?.name, "Default Model");
      assert.equal(doc.model, "opencode-provider/opencode-model-1");
    });

    it("applies a Kimi provider into providers/models/default_model", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-kimi@example.com", "hash");
      const root = await useConfigRoot("KIMI_CODE_HOME", "forgebadger-apply-kimi-");
      const fixture = createFixture(db, user.id, "kimi");

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "kimi",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });

      const configToml = await readFile(path.join(root, "config.toml"), "utf8");
      assert.match(configToml, /default_model = "kimi-provider\/kimi-model-1"/u);
      assert.match(configToml, /\[providers\.kimi-provider\]/u);
      assert.match(configToml, /type = "anthropic"/u);
      assert.match(configToml, /api_key = "sk-kimi-secret"/u);
      assert.match(configToml, /base_url = "https:\/\/api\.deepseek\.com\/v1"/u);
    });

    it("removes a stale ANTHROPIC_API_KEY when applying a token-based provider", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-claude-stale@example.com", "hash");
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-apply-claude-stale-");
      await writeFile(path.join(root, "settings.json"), JSON.stringify({
        env: { ANTHROPIC_API_KEY: "sk-ant-stale", ANTHROPIC_BASE_URL: "https://old.example.com" }
      }), "utf8");
      const fixture = createFixture(db, user.id, "claude");

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });

      const doc = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as {
        env: Record<string, string>;
      };
      assert.equal(doc.env.ANTHROPIC_API_KEY, undefined);
      assert.equal(doc.env.ANTHROPIC_AUTH_TOKEN, "sk-claude-secret");
      assert.equal(doc.env.ANTHROPIC_BASE_URL, "https://api.deepseek.com/anthropic");
    });

    it("injects the 256k context window for the Kimi For Coding endpoint", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-kimi-coding@example.com", "hash");
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-apply-kimi-coding-");
      const repo = new ModelProviderRepository(db, user.id, masterKey);
      const provider = repo.createProviderProfile({
        name: "Kimi For Coding",
        providerKey: "kimi-code",
        anthropicBaseUrl: "https://api.kimi.com/coding/",
        authType: "api_key",
        apiFormat: "anthropic",
        supportedAdapters: ["claude"]
      });
      repo.createModelProfile({ providerProfileId: provider.id, name: "K3", modelId: "k3", isDefault: true });
      repo.createCredential({ providerProfileId: provider.id, plaintextSecret: "sk-kimi-coding" });

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: provider.id, resolveHost: publicResolver
      });

      const doc = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as {
        env: Record<string, string>;
      };
      assert.equal(doc.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, "262144");
      assert.equal(doc.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "262144");

      // Switching to a non-Kimi provider strips only the injected defaults.
      const fixture = createFixture(db, user.id, "claude");
      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });
      const switched = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as {
        env: Record<string, string>;
      };
      assert.equal(switched.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, undefined);
      assert.equal(switched.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, undefined);
    });

    it("never overwrites an explicit user context window setting", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-kimi-explicit@example.com", "hash");
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-apply-kimi-explicit-");
      await writeFile(path.join(root, "settings.json"), JSON.stringify({
        env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: "100000" }
      }), "utf8");
      const repo = new ModelProviderRepository(db, user.id, masterKey);
      const provider = repo.createProviderProfile({
        name: "Kimi For Coding",
        providerKey: "kimi-code",
        anthropicBaseUrl: "https://api.kimi.com/coding/",
        authType: "api_key",
        apiFormat: "anthropic",
        supportedAdapters: ["claude"]
      });
      repo.createModelProfile({ providerProfileId: provider.id, name: "K3", modelId: "k3", isDefault: true });
      repo.createCredential({ providerProfileId: provider.id, plaintextSecret: "sk-kimi-coding" });

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: provider.id, resolveHost: publicResolver
      });

      const doc = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as {
        env: Record<string, string>;
      };
      assert.equal(doc.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, "100000");
      assert.equal(doc.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "262144");

      // Switching away keeps the explicit value but strips the injected one.
      const fixture = createFixture(db, user.id, "claude");
      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });
      const switched = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as {
        env: Record<string, string>;
      };
      assert.equal(switched.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, "100000");
      assert.equal(switched.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, undefined);
    });

    it("falls back to the default model and oldest active credential when ids are omitted", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-defaults@example.com", "hash");
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-apply-defaults-");
      const fixture = createFixture(db, user.id, "claude");
      fixture.repo.createModelProfile({
        providerProfileId: fixture.providerId,
        name: "Secondary",
        modelId: "claude-model-2"
      });
      const secondaryCredential = fixture.repo.createCredential({
        providerProfileId: fixture.providerId,
        plaintextSecret: "sk-secondary"
      });
      db.prepare("UPDATE provider_credentials SET created_at = 1 WHERE id = ?")
        .run(fixture.credentialId);
      db.prepare("UPDATE provider_credentials SET created_at = 2 WHERE id = ?")
        .run(secondaryCredential.id);

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });

      const doc = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as {
        env: Record<string, string>;
      };
      assert.equal(doc.env.ANTHROPIC_MODEL, "claude-model-1");
      assert.equal(doc.env.ANTHROPIC_AUTH_TOKEN, "sk-claude-secret");
    });

    it("reports changed=false when the target already matches", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-idem@example.com", "hash");
      await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-apply-idem-");
      const fixture = createFixture(db, user.id, "claude");
      const input = {
        db, userId: user.id, masterKey, adapter: "claude" as const,
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      };
      await applyCliConfigToAdapter(input);
      await settle(15);
      const second = await applyCliConfigToAdapter(input);

      assert.equal(second.changed, false);
      assert.equal(second.files[0]?.operation, "none");
    });

    it("rejects endpoints that resolve to private addresses", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-ssrf@example.com", "hash");
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-apply-ssrf-");
      const fixture = createFixture(db, user.id, "claude");

      const error = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: fixture.providerId,
        resolveHost: async () => [{ address: "10.0.0.8", family: 4 }]
      }).catch((caught: unknown) => caught);

      assert.ok(error instanceof CliConfigApplyError);
      assert.equal(error.code, "CLI_CONFIG_APPLY_ENDPOINT_UNSAFE");
      assert.equal(existsSync(path.join(root, "settings.json")), false);
    });

    it("applies a provider over http when allowPlaintextHttp is trusted", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-http@example.com", "hash");
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-apply-http-");
      const repo = new ModelProviderRepository(db, user.id, masterKey);
      const provider = repo.createProviderProfile({
        name: "Local Lingsoul",
        providerKey: "lingsoul-dlife",
        anthropicBaseUrl: "http://lingsoul-dlife.cn",
        authType: "api_key",
        apiFormat: "anthropic",
        supportedAdapters: ["claude"],
        allowPlaintextHttp: true
      });
      repo.createModelProfile({ providerProfileId: provider.id, name: "Default", modelId: "claude-model-1", isDefault: true });
      repo.createCredential({ providerProfileId: provider.id, plaintextSecret: "sk-claude-secret" });

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: provider.id, resolveHost: publicResolver
      });

      const doc = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as {
        env: Record<string, string>;
      };
      assert.equal(doc.env.ANTHROPIC_BASE_URL, "http://lingsoul-dlife.cn");
    });

    it("rejects private endpoints at apply time even when allowPlaintextHttp is trusted", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-http-ssrf@example.com", "hash");
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-apply-http-ssrf-");
      const providerId = "p-http-ssrf";
      // Seed the row directly so the row exists with the trust flag on and a
      // private http:// base URL — the create guard would refuse this, but the
      // apply boundary must still reject the resolved private target.
      db.prepare(`
        INSERT INTO model_provider_profiles (
          id, user_id, provider_key, name, base_url, anthropic_base_url, openai_base_url,
          auth_type, api_format, supported_adapters, default_headers, status, allow_plaintext_http,
          created_at, updated_at
        ) VALUES (?, ?, 'private-http', 'Local Private', 'http://private.internal', NULL, NULL,
          'api_key', 'anthropic', '["claude"]', '{}', 'active', 1, 0, 0)
      `).run(providerId, user.id);
      db.prepare(`
        INSERT INTO model_profiles (
          id, user_id, provider_profile_id, name, model_id, capabilities, status, is_default, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, 'Default', 'claude-model-1', '["chat"]', 'active', 1, 0, 0, 0)
      `).run("m-http-ssrf", user.id, providerId);
      const credentialId = "c-http-ssrf";
      // Secret content is irrelevant here: the endpoint guard rejects the
      // private target before any decryption happens.
      db.prepare(`
        INSERT INTO provider_credentials (
          id, user_id, provider_profile_id, label, secret_encrypted, generation, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'Primary', '{}', 1, 'active', 0, 0)
      `).run(credentialId, user.id, providerId);

      const error = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: providerId,
        resolveHost: async () => [{ address: "192.168.1.10", family: 4 }]
      }).catch((caught: unknown) => caught);

      assert.ok(error instanceof CliConfigApplyError);
      assert.equal(error.code, "CLI_CONFIG_APPLY_ENDPOINT_UNSAFE");
      assert.equal(existsSync(path.join(root, "settings.json")), false);
    });

    it("rejects unknown providers, unsupported adapters, and cross-tenant profiles", async () => {
      const db = createTestDb();
      const users = new UserRepository(db);
      const user = users.create("apply-errors@example.com", "hash");
      const other = users.create("apply-errors-other@example.com", "hash");
      const fixture = createFixture(db, user.id, "claude");

      const missing = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: "does-not-exist", resolveHost: publicResolver
      }).catch((caught: unknown) => caught);
      assert.ok(missing instanceof CliConfigApplyError);
      assert.equal(missing.code, "CLI_CONFIG_APPLY_PROVIDER_NOT_FOUND");

      const unsupported = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "codex",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      }).catch((caught: unknown) => caught);
      assert.ok(unsupported instanceof CliConfigApplyError);
      assert.equal(unsupported.code, "CLI_CONFIG_APPLY_ADAPTER_UNSUPPORTED");

      const crossTenant = await applyCliConfigToAdapter({
        db, userId: other.id, masterKey, adapter: "claude",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      }).catch((caught: unknown) => caught);
      assert.ok(crossTenant instanceof CliConfigApplyError);
      assert.equal(crossTenant.code, "CLI_CONFIG_APPLY_PROVIDER_NOT_FOUND");
    });
  });

  describe("previewCliConfigApply", () => {
    it("diffs without touching disk and never exposes the plaintext secret", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("preview-opencode@example.com", "hash");
      const root = await useConfigRoot("OPENCODE_CONFIG_DIR", "forgebadger-preview-opencode-");
      const fixture = createFixture(db, user.id, "opencode");

      const preview = await previewCliConfigApply({
        db, userId: user.id, masterKey, adapter: "opencode",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });

      assert.equal(existsSync(path.join(root, "opencode.json")), false);
      assert.equal(preview.files.length, 1);
      const file = preview.files[0];
      assert.ok(file);
      assert.equal(file.operation, "create");
      assert.equal(file.current, null);
      assert.equal(file.proposed.includes("sk-opencode-secret"), false);
      assert.ok(file.proposed.includes("[redacted]"));
      assert.ok(file.changedFields.includes("provider.opencode-provider.options.apiKey"));
      assert.equal(preview.providerProfileId, fixture.providerId);
      assert.equal(preview.modelProfileId, fixture.modelId);
      assert.equal(preview.credentialId, fixture.credentialId);
    });

    it("shows the masked current content for existing files", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("preview-claude@example.com", "hash");
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-preview-claude-");
      await writeFile(path.join(root, "settings.json"), JSON.stringify({
        env: { ANTHROPIC_AUTH_TOKEN: "sk-old-secret", ANTHROPIC_BASE_URL: "https://old.example.com" }
      }), "utf8");
      const fixture = createFixture(db, user.id, "claude");

      const preview = await previewCliConfigApply({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });

      const file = preview.files[0];
      assert.ok(file);
      assert.equal(file.operation, "update");
      assert.ok(file.current !== null);
      assert.equal(file.current?.includes("sk-old-secret"), false);
      assert.ok(file.changedFields.includes("env.ANTHROPIC_BASE_URL"));
    });
    it("masks the Codex bearer token and marks an emptied auth.json for deletion", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("preview-codex@example.com", "hash");
      const root = await useConfigRoot("CODEX_HOME", "forgebadger-preview-codex-");
      await writeFile(path.join(root, "auth.json"), JSON.stringify({
        OPENAI_API_KEY: "sk-old-secret",
        tokens: { access_token: "at-secret", refresh_token: "rt-secret" }
      }), "utf8");
      const fixture = createFixture(db, user.id, "codex");

      const preview = await previewCliConfigApply({
        db, userId: user.id, masterKey, adapter: "codex",
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      });

      assert.equal(preview.files.length, 2);
      const config = preview.files[0];
      const auth = preview.files[1];
      assert.ok(config && auth);
      assert.equal(config.fileType, "toml");
      // The placeholder secret and the stored key must never appear in previews.
      assert.equal(config.proposed.includes("__FORGEBADGER_APPLY_PREVIEW__"), false);
      assert.ok(config.changedFields.includes("model_providers.codex-provider.experimental_bearer_token"));
      // ChatGPT tokens in the current auth.json are masked as well.
      assert.equal(auth.current?.includes("at-secret"), false);
      assert.equal(auth.current?.includes("rt-secret"), false);
      // tokens remain, so the file is updated (not deleted).
      assert.equal(auth.operation, "update");
    });
  });

  describe("rollbackCliConfigApply", () => {
    it("restores the latest backup when no backupId is given", async () => {
      const db = createTestDb();
      const user = new UserRepository(db).create("rollback-latest@example.com", "hash");
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "forgebadger-rollback-latest-");
      const fixture = createFixture(db, user.id, "claude");
      const input = {
        db, userId: user.id, masterKey, adapter: "claude" as const,
        providerProfileId: fixture.providerId, resolveHost: publicResolver
      };

      await applyCliConfigToAdapter(input);
      await settle(15);
      fixture.repo.updateProviderProfile(fixture.providerId, { name: "Renamed provider" });
      const second = await applyCliConfigToAdapter(input);
      assert.ok(second.backupId);
      await settle(15);

      const rolledBack = rollbackCliConfigApply({ masterKey, adapter: "claude" });
      assert.equal(rolledBack.backupId, second.backupId);
      const doc = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as {
        env: Record<string, string>;
      };
      assert.equal(doc.env.ANTHROPIC_AUTH_TOKEN, "sk-claude-secret");
    });

    it("rejects unknown or malformed backup ids", () => {
      const missing = (() => {
        try {
          rollbackCliConfigApply({ masterKey, adapter: "kimi", backupId: "1999-01-01T00-00-00-000Z.json.enc" });
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      assert.ok(missing instanceof CliConfigApplyError);
      assert.equal(missing.code, "CLI_CONFIG_BACKUP_NOT_FOUND");

      const malformed = (() => {
        try {
          rollbackCliConfigApply({ masterKey, adapter: "kimi", backupId: "../escape.json.enc" });
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      assert.ok(malformed instanceof CliConfigApplyError);
      assert.equal(malformed.code, "CLI_CONFIG_BACKUP_NOT_FOUND");
    });
  });
});
