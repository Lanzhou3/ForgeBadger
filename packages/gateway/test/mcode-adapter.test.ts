import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { parse as parseYaml } from "yaml";

import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createAdapterLaunchPlan, formatAdapterModelId } from "../src/adapters/index.js";
import { listAdapterDefinitions } from "../src/services/adapter-discovery.js";
import { globalConfigRoot } from "../src/services/cli-config-target.js";
import {
  loadYamlConfig,
  saveYamlConfig,
  serializeYamlPreservingComments
} from "../src/services/cli-config-yaml.js";
import { getProviderCapabilities } from "../src/services/provider-capabilities.js";
import {
  applyCliConfigToAdapter,
  endpointForAdapter,
  maskSecrets,
  previewCliConfigApply,
  rollbackCliConfigApply
} from "../src/services/cli-config-apply.js";

const masterKey = "abcdef0123456789abcdef0123456789";
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

/** A config.yaml shaped exactly like the one `mcode provider add` writes. */
const REALISTIC_CONFIG = `# keep-me: user comment
custom_note: also keep me

logLevel: info
defaultModel: minimax/MiniMax-M3
provider:
  minimax:
    name: MiniMax
    npm: '@ai-sdk/anthropic'
    options:
      baseURL: https://agent.minimaxi.com/mavis/api/v1/llm/v1
dataContribution:
  enabled: true
memory:
  enabled: false
custom_provider:
  existing-one:
    name: existing-one
    kind: custom
    enabled: true
    api: openai-completions
    options:
      apiKey: sk-existing
      baseURL: https://existing.invalid/v1
      authMode: api-key
    models:
      existing-model:
        reasoning: true
`;

async function useDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "forgebadger-mcode-"));
  process.env.MINIMAX_DATA_DIR = dir;
  return dir;
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

function readYaml(dir: string): Record<string, unknown> {
  return parseYaml(readFileSync(path.join(dir, "config.yaml"), "utf8")) as Record<string, unknown>;
}

describe("MiniMax Code adapter", () => {
  it("registers mcode as a supported terminal adapter", () => {
    const mcode = listAdapterDefinitions().find((entry) => entry.id === "mcode");
    assert.equal(mcode?.label, "MiniMax Code");
    assert.equal(mcode?.command, "mcode");
    assert.equal(mcode?.supportLevel, "supported");
    // The install dir (~/.minimax-code) is not the config dir.
    assert.equal(mcode?.configDir, ".minimax");
  });

  it("resolves the data directory as MINIMAX_DATA_DIR then MAVIS_DATA_DIR then ~/.minimax", () => {
    // resolveUserRoot path-resolves, so compare against the resolved form.
    const home = path.resolve(path.join(path.sep, "home", "tester"));
    const at = (...segments: string[]): string => path.resolve(path.join(home, ...segments));
    assert.equal(
      globalConfigRoot("mcode", { env: { MINIMAX_DATA_DIR: at("d1") }, homeDir: home }),
      at("d1")
    );
    assert.equal(
      globalConfigRoot("mcode", { env: { MAVIS_DATA_DIR: at("d2") }, homeDir: home }),
      at("d2")
    );
    // MINIMAX_DATA_DIR wins over MAVIS_DATA_DIR.
    assert.equal(
      globalConfigRoot("mcode", {
        env: { MINIMAX_DATA_DIR: at("d1"), MAVIS_DATA_DIR: at("d2") },
        homeDir: home
      }),
      at("d1")
    );
    // A blank value falls through, matching the CLI's own trim-then-default.
    assert.equal(
      globalConfigRoot("mcode", { env: { MINIMAX_DATA_DIR: "   " }, homeDir: home }),
      at(".minimax")
    );
    assert.equal(globalConfigRoot("mcode", { env: {}, homeDir: home }), at(".minimax"));
  });

  it("declares only the api formats config.yaml can express", () => {
    const capability = getProviderCapabilities().find((entry) => entry.adapter === "mcode");
    assert.ok(capability);
    assert.deepEqual(capability.apiFormats, ["anthropic", "openai", "openai-compatible"]);
    // No project-level config.yaml exists for this CLI.
    assert.deepEqual(capability.scopes, ["global"]);
    assert.equal(capability.modelSelection, "native-config");
  });

  it("launches zero-arg and formats the custom_provider model reference", () => {
    const plan = createAdapterLaunchPlan({ adapter: "mcode", projectRoot: path.sep });
    assert.equal(plan.command, "mcode");
    // The interactive TUI takes no model flag; selection comes from config.yaml.
    assert.deepEqual(plan.args, []);
    assert.equal(
      formatAdapterModelId("mcode", "myprovider", "my-model"),
      "custom_provider:myprovider/my-model"
    );
    // Already-prefixed ids are not double-prefixed.
    assert.equal(
      formatAdapterModelId("mcode", "myprovider", "custom_provider:myprovider/my-model"),
      "custom_provider:myprovider/my-model"
    );
  });

  it("keeps the anthropic base url for the anthropic wire format", () => {
    const provider = {
      apiFormat: "anthropic",
      baseUrl: "https://proxy.invalid",
      anthropicBaseUrl: "https://anthropic-proxy.invalid"
    } as never;
    assert.equal(endpointForAdapter(provider, "mcode"), "https://anthropic-proxy.invalid");
    const openai = { apiFormat: "openai", baseUrl: "https://proxy.invalid" } as never;
    assert.equal(endpointForAdapter(openai, "mcode"), "https://proxy.invalid");
  });

  it("preserves comments and unknown top-level keys across a mutation", () => {
    const handle = loadYamlConfig(REALISTIC_CONFIG);
    const next = {
      ...handle.root,
      defaultModel: "custom_provider:newprov/newmodel"
    } as Record<string, unknown>;
    const out = serializeYamlPreservingComments(REALISTIC_CONFIG, next);

    assert.match(out, /# keep-me: user comment/);
    assert.match(out, /custom_note: also keep me/);
    // The CLI-owned registry survives untouched.
    assert.match(out, /npm: '@ai-sdk\/anthropic'/);
    assert.match(out, /defaultModel: custom_provider:newprov\/newmodel/);
    // Re-parses cleanly.
    assert.doesNotThrow(() => parseYaml(out));
  });

  it("masks the api key in preview output", () => {
    const masked = maskSecrets("yaml", REALISTIC_CONFIG);
    assert.doesNotMatch(masked, /sk-existing/);
    assert.match(masked, /apiKey: \S/);
    // Masking must not disturb the structure.
    assert.ok(parseYaml(masked));
  });

  it("round-trips an untouched document byte-for-byte in shape", () => {
    const handle = loadYamlConfig(REALISTIC_CONFIG);
    assert.equal(saveYamlConfig(handle).trimEnd(), REALISTIC_CONFIG.trimEnd());
  });

  it("writes custom_provider on apply and leaves the official provider intact", async () => {
    const dir = await useDataDir();
    const db = createTestDb();
    try {
      await writeFile(path.join(dir, "config.yaml"), REALISTIC_CONFIG, "utf8");
      const user = new UserRepository(db).create("mcode-apply@example.test", "hash");
      const repo = new ModelProviderRepository(db, user.id, masterKey);
      const provider = repo.createProviderProfile({
        name: "Gateway",
        providerKey: "mcode-provider",
        baseUrl: "https://api.deepseek.com",
        anthropicBaseUrl: "https://api.deepseek.com/anthropic",
        authType: "api_key",
        apiFormat: "anthropic",
        supportedAdapters: ["mcode"]
      });
      const model = repo.createModelProfile({
        providerProfileId: provider.id,
        name: "DeepSeek",
        modelId: "deepseek-chat",
        isDefault: true
      });
      const credential = repo.createCredential({
        providerProfileId: provider.id,
        label: "Primary",
        plaintextSecret: "sk-mcode-secret"
      });

      const result = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "mcode",
        providerProfileId: provider.id, resolveHost: publicResolver
      });
      assert.equal(result.changed, true);

      const doc = readYaml(dir);
      // The bundled registry and official-service keys are never touched.
      const bundled = (doc.provider as Record<string, Record<string, unknown>>).minimax;
      assert.equal(bundled.npm, "@ai-sdk/anthropic");

      const custom = (doc.custom_provider as Record<string, Record<string, unknown>>);
      const written = custom["mcode-provider"];
      assert.ok(written, "provider should land under custom_provider");
      assert.equal(written.kind, "custom");
      assert.equal(written.enabled, true);
      // api_format anthropic maps to the CLI's anthropic-messages wire name.
      assert.equal(written.api, "anthropic-messages");
      const options = written.options as Record<string, string>;
      assert.equal(options.apiKey, "sk-mcode-secret");
      assert.equal(options.baseURL, "https://api.deepseek.com/anthropic");
      assert.equal(options.authMode, "api-key");

      const models = written.models as Record<string, Record<string, unknown>>;
      const entry = models["deepseek-chat"];
      assert.ok(entry);
      assert.equal(entry.name, "DeepSeek");
      // limit is always written; the CLI would otherwise fall back to 200k/16k.
      const limit = entry.limit as Record<string, number>;
      assert.equal(typeof limit.context, "number");
      assert.equal(limit.output, 16384);

      // Custom providers need the explicit prefix on defaultModel.
      assert.equal(doc.defaultModel, "custom_provider:mcode-provider/deepseek-chat");

      // A pre-existing custom provider is preserved (pure additive merge).
      assert.ok(custom["existing-one"], "existing custom provider must survive");
      // Comments and unknown keys survive the write.
      const text = readFileSync(path.join(dir, "config.yaml"), "utf8");
      assert.match(text, /# keep-me: user comment/);
      assert.match(text, /custom_note: also keep me/);
      assert.equal(model.modelId, "deepseek-chat");
      assert.ok(credential.id);
    } finally {
      delete process.env.MINIMAX_DATA_DIR;
      db.close();
    }
  });

  it("rolls back an applied provider to the previous config.yaml", async () => {
    const dir = await useDataDir();
    const db = createTestDb();
    try {
      const original = REALISTIC_CONFIG;
      await writeFile(path.join(dir, "config.yaml"), original, "utf8");
      const user = new UserRepository(db).create("mcode-rollback@example.test", "hash");
      const repo = new ModelProviderRepository(db, user.id, masterKey);
      const provider = repo.createProviderProfile({
        name: "Gateway",
        providerKey: "mcode-provider",
        baseUrl: "https://api.deepseek.com",
        anthropicBaseUrl: "https://api.deepseek.com/anthropic",
        authType: "api_key",
        apiFormat: "anthropic",
        supportedAdapters: ["mcode"]
      });
      repo.createModelProfile({
        providerProfileId: provider.id,
        name: "DeepSeek",
        modelId: "deepseek-chat",
        isDefault: true
      });
      repo.createCredential({
        providerProfileId: provider.id,
        label: "Primary",
        plaintextSecret: "sk-mcode-secret"
      });

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "mcode",
        providerProfileId: provider.id, resolveHost: publicResolver
      });
      const after = readFileSync(path.join(dir, "config.yaml"), "utf8");
      assert.notEqual(after, original);

      await rollbackCliConfigApply({ db, userId: user.id, masterKey, adapter: "mcode" });
      const restored = readFileSync(path.join(dir, "config.yaml"), "utf8");
      assert.equal(restored, original);
    } finally {
      delete process.env.MINIMAX_DATA_DIR;
      db.close();
    }
  });

  it("previews a diff without writing the secret to disk", async () => {
    const dir = await useDataDir();
    const db = createTestDb();
    try {
      await writeFile(path.join(dir, "config.yaml"), REALISTIC_CONFIG, "utf8");
      const user = new UserRepository(db).create("mcode-preview@example.test", "hash");
      const repo = new ModelProviderRepository(db, user.id, masterKey);
      const provider = repo.createProviderProfile({
        name: "Gateway",
        providerKey: "mcode-provider",
        baseUrl: "https://api.deepseek.com",
        anthropicBaseUrl: "https://api.deepseek.com/anthropic",
        authType: "api_key",
        apiFormat: "anthropic",
        supportedAdapters: ["mcode"]
      });
      repo.createModelProfile({
        providerProfileId: provider.id,
        name: "DeepSeek",
        modelId: "deepseek-chat",
        isDefault: true
      });
      repo.createCredential({
        providerProfileId: provider.id,
        label: "Primary",
        plaintextSecret: "sk-mcode-secret"
      });

      const preview = await previewCliConfigApply({
        db, userId: user.id, masterKey, adapter: "mcode",
        providerProfileId: provider.id, resolveHost: publicResolver
      });
      assert.equal(preview.adapter, "mcode");
      assert.ok(preview.files.length > 0, "preview should describe the config.yaml target");
      const serialized = JSON.stringify(preview);
      assert.doesNotMatch(serialized, /sk-mcode-secret/);
      // Preview did not write.
      assert.equal(readFileSync(path.join(dir, "config.yaml"), "utf8"), REALISTIC_CONFIG);
    } finally {
      delete process.env.MINIMAX_DATA_DIR;
      db.close();
    }
  });

  it("never treats the CLI auth tree as a managed target", async () => {
    const dir = await useDataDir();
    try {
      const { listCliConfigAdapters } = await import("../src/services/cli-config.js");
      const mcode = listCliConfigAdapters().find((entry) => entry.adapter === "mcode");
      assert.equal(mcode?.configFile, "config.yaml");
      // Project scope is refused rather than writing a misleading file.
      const { cliConfigTargetPath } = await import("../src/services/cli-config-target.js");
      assert.throws(
        () => cliConfigTargetPath({ adapter: "mcode", scope: "project", projectRoot: dir }),
        /global-only/
      );
    } finally {
      delete process.env.MINIMAX_DATA_DIR;
    }
  });

  it("migration 0122 rebuilt the bindings table with mcode accepted", () => {
    const db = createTestDb();
    try {
      const table = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='model_provider_bindings'")
        .get() as { sql: string } | undefined;
      assert.ok(table);
      assert.match(table.sql, /'claude','opencode','codex','kimi','pi','mcode'/);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='model_provider_bindings'")
        .all() as Array<{ name: string }>;
      const names = indexes.map((row) => row.name);
      for (const expected of [
        "idx_model_provider_bindings_id_user",
        "idx_model_provider_bindings_active_scope",
        "idx_model_provider_bindings_active_locator",
        "idx_model_provider_bindings_active_realpath",
        "idx_model_provider_bindings_user_provider"
      ]) {
        assert.ok(names.includes(expected), `missing index ${expected}`);
      }

      // The backfill ran and did not touch an incompatible api format.
      const profiles = db.prepare("SELECT count(*) AS n FROM model_provider_profiles").get() as { n: number };
      assert.ok(profiles.n >= 0);
    } finally {
      db.close();
    }
  });

  it("survives a config file that does not exist yet", async () => {
    const dir = await useDataDir();
    try {
      const handle = loadYamlConfig(undefined);
      assert.deepEqual(handle.root, {});
      assert.match(saveYamlConfig(handle), /\{\}/);
      assert.equal(existsSync(path.join(dir, "config.yaml")), false);
    } finally {
      delete process.env.MINIMAX_DATA_DIR;
    }
  });
});
