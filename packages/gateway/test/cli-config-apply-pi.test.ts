import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { CliConfigAppliedProviderRepository } from "../src/db/repositories/cli-config-applied-provider-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import {
  applyCliConfigToAdapter,
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

async function useConfigRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  process.env.PI_CODING_AGENT_DIR = dir;
  return dir;
}

interface Fixture {
  repo: ModelProviderRepository;
  providerId: string;
  modelId: string;
  credentialId: string;
}

/** Default PI fixture: an OpenAI-compatible relay under the key "pi-provider". */
function createFixture(db: Database.Database, userId: string): Fixture {
  const repo = new ModelProviderRepository(db, userId, masterKey);
  const provider = repo.createProviderProfile({
    name: "pi provider",
    providerKey: "pi-provider",
    baseUrl: "https://api.deepseek.com",
    anthropicBaseUrl: "https://api.deepseek.com/anthropic",
    openaiBaseUrl: "https://api.deepseek.com/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["pi"]
  });
  const model = repo.createModelProfile({
    providerProfileId: provider.id,
    name: "Default Model",
    modelId: "pi-model-1",
    isDefault: true
  });
  const credential = repo.createCredential({
    providerProfileId: provider.id,
    label: "Primary",
    plaintextSecret: "sk-pi-secret"
  });
  return { repo, providerId: provider.id, modelId: model.id, credentialId: credential.id };
}

function backupList(): string[] {
  const dir = path.join(tmpdir(), `forgebadger-test-${process.pid}`, "backups", "cli-config", "pi");
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function assertPrivateMode(targetPath: string): void {
  if (process.platform !== "win32") {
    assert.equal(statSync(targetPath).mode & 0o777, 0o600);
  }
}

describe("cli-config apply: PI", () => {
  it("applies a provider into models.json and the startup selection into settings.json", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-");
    const fixture = createFixture(db, user.id);
    // User-owned settings must survive the apply.
    await writeFile(path.join(root, "settings.json"), JSON.stringify({ theme: "dark" }), "utf8");

    const backupsBefore = backupList().length;
    const result = await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });

    assert.equal(result.changed, true);
    assert.equal(result.files.length, 2);
    assert.equal(backupList().length, backupsBefore + 1, "encrypted backup recorded");
    assert.equal(result.files.length, 2);

    const models = JSON.parse(await readFile(path.join(root, "models.json"), "utf8")) as {
      providers: Record<string, {
        baseUrl: string;
        api: string;
        apiKey: string;
        models: Array<Record<string, unknown>>;
      }>;
    };
    const entry = models.providers["pi-provider"];
    assert.ok(entry, "provider entry written to models.json");
    assert.equal(entry.baseUrl, "https://api.deepseek.com/v1");
    assert.equal(entry.api, "openai-completions");
    assert.equal(entry.apiKey, "sk-pi-secret");
    assert.deepEqual(entry.models, [
      { id: "pi-model-1", name: "Default Model", contextWindow: 262144, reasoning: false }
    ]);
    assertPrivateMode(path.join(root, "models.json"));

    const settings = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as Record<string, unknown>;
    assert.equal(settings.theme, "dark", "user settings preserved");
    assert.equal(settings.defaultProvider, "pi-provider");
    // PI pairs a bare model id with the provider key (settings.md).
    assert.equal(settings.defaultModel, "pi-model-1");
    assertPrivateMode(path.join(root, "settings.json"));

    // auth.json is self-managed by `pi /login`; the apply never creates it.
    assert.equal(existsSync(path.join(root, "auth.json")), false);

    const pointer = new CliConfigAppliedProviderRepository(db, user.id).get("pi");
    assert.equal(pointer?.providerProfileId, fixture.providerId);
    assert.equal(pointer?.modelProfileId, fixture.modelId);
  });

  it("writes every active model into the models.json array; the selection only pins the startup default", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi-multi@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-multi-");
    const fixture = createFixture(db, user.id);
    fixture.repo.createModelProfile({ providerProfileId: fixture.providerId, name: "Second Model", modelId: "pi-model-2" });
    fixture.repo.createModelProfile({ providerProfileId: fixture.providerId, name: "Third Model", modelId: "pi-model-3" });

    const result = await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });
    assert.equal(result.changed, true);

    const models = JSON.parse(await readFile(path.join(root, "models.json"), "utf8")) as {
      providers: Record<string, { models: Array<{ id: string; name: string }> }>;
    };
    const entry = models.providers["pi-provider"];
    // All active models land in models.json so `pi /model` can switch between
    // them; the single UI selection only chooses the startup default.
    assert.deepEqual(
      entry.models.map((model) => model.id),
      ["pi-model-1", "pi-model-2", "pi-model-3"]
    );

    const settings = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as Record<string, unknown>;
    assert.equal(settings.defaultProvider, "pi-provider");
    assert.equal(settings.defaultModel, "pi-model-1", "isDefault model pins the startup selection");
  });

  it("writes reasoning: true from the profile capability so PI thinking is enabled and adjustable", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi-reasoning@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-reasoning-");
    const fixture = createFixture(db, user.id);
    fixture.repo.updateModelProfile(fixture.modelId, { capabilities: ["chat", "reasoning"] });

    await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });

    const models = JSON.parse(await readFile(path.join(root, "models.json"), "utf8")) as {
      providers: Record<string, { models: Array<Record<string, unknown>> }>;
    };
    const model = models.providers["pi-provider"].models[0];
    // reasoning: true makes pi expose the /thinking controls; with no
    // defaultThinkingLevel configured the built-in "medium" default means
    // thinking starts ON for this model.
    assert.equal(model.reasoning, true, "reasoning capability enables PI extended thinking");
    // First apply: a reasoning model on openai-completions gains the additive
    // xhigh entry — PI's TUI hides xhigh/max unless thinkingLevelMap defines
    // them, and generic openai-completions relays receive
    // reasoning_effort: "xhigh" verbatim when the level is picked.
    assert.deepEqual(model.thinkingLevelMap, { xhigh: "xhigh" }, "additive xhigh exposure for openai-completions reasoning models");

    // A hand-written map without xhigh gets xhigh added on the next apply.
    await writeFile(
      path.join(root, "models.json"),
      JSON.stringify({
        providers: {
          "pi-provider": {
            baseUrl: "https://api.deepseek.com/v1",
            api: "openai-completions",
            apiKey: "sk-pi-secret",
            models: [{ id: "pi-model-1", name: "Default Model", contextWindow: 262144, reasoning: true, thinkingLevelMap: { low: "low", medium: "medium", high: "high" } }]
          }
        }
      }, null, 2) + "\n",
      "utf8"
    );
    await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });
    let remodeled = (JSON.parse(await readFile(path.join(root, "models.json"), "utf8")) as {
      providers: Record<string, { models: Array<Record<string, unknown>> }>;
    }).providers["pi-provider"].models[0];
    assert.equal(remodeled.reasoning, true);
    assert.deepEqual(remodeled.thinkingLevelMap, { low: "low", medium: "medium", high: "high", xhigh: "xhigh" }, "xhigh added additively to a user map");

    // A user-defined xhigh mapping (e.g. emulated with the provider's "high")
    // wins and re-apply becomes idempotent.
    await writeFile(
      path.join(root, "models.json"),
      JSON.stringify({
        providers: {
          "pi-provider": {
            baseUrl: "https://api.deepseek.com/v1",
            api: "openai-completions",
            apiKey: "sk-pi-secret",
            models: [{ id: "pi-model-1", name: "Default Model", contextWindow: 262144, reasoning: true, thinkingLevelMap: { xhigh: "high" } }]
          }
        }
      }, null, 2) + "\n",
      "utf8"
    );
    const reapply = await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });
    assert.equal(reapply.changed, false, "idempotent with a user-defined xhigh mapping");
    remodeled = (JSON.parse(await readFile(path.join(root, "models.json"), "utf8")) as {
      providers: Record<string, { models: Array<Record<string, unknown>> }>;
    }).providers["pi-provider"].models[0];
    assert.deepEqual(remodeled.thinkingLevelMap, { xhigh: "high" }, "user-defined xhigh mapping preserved");

    // Without the capability a hand-set reasoning: true still survives (monotonic).
    fixture.repo.updateModelProfile(fixture.modelId, { capabilities: ["chat"] });
    await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });
    const stripped = (JSON.parse(await readFile(path.join(root, "models.json"), "utf8")) as {
      providers: Record<string, { models: Array<Record<string, unknown>> }>;
    }).providers["pi-provider"].models[0];
    assert.equal(stripped.reasoning, true, "manual reasoning: true is not stripped when the capability is removed");
  });

  it("does not expose xhigh for non openai-completions APIs", async () => {
    // anthropic-messages maps levels to effort via a different scheme and
    // google-generative-ai only knows minimal/low/medium/high, so the
    // additive xhigh entry is scoped to openai-completions relays.
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi-xhigh-api@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-xhigh-api-");
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    const provider = repo.createProviderProfile({
      name: "anthropic provider",
      providerKey: "anthropic-relay",
      baseUrl: "https://api.deepseek.com",
      anthropicBaseUrl: "https://api.deepseek.com/anthropic",
      openaiBaseUrl: "https://api.deepseek.com/v1",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["pi"]
    });
    const createdModel = repo.createModelProfile({
      providerProfileId: provider.id, name: "M", modelId: "claude-x",
      isDefault: true, capabilities: ["chat", "reasoning"]
    });
    repo.createCredential({ providerProfileId: provider.id, label: "c", plaintextSecret: "sk-x" });

    await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: provider.id, resolveHost: publicResolver
    });

    const models = JSON.parse(await readFile(path.join(root, "models.json"), "utf8")) as {
      providers: Record<string, { api: string; models: Array<Record<string, unknown>> }>;
    };
    const entry = models.providers["anthropic-relay"];
    assert.equal(entry.api, "anthropic-messages");
    assert.equal(entry.models[0].id, createdModel.modelId);
    assert.equal(entry.models[0].reasoning, true);
    assert.equal(entry.models[0].thinkingLevelMap, undefined, "no thinkingLevelMap written for anthropic-messages");
  });

  it("uses the model profile context window and preserves user-tuned model fields", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi-ctx@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-ctx-");
    const fixture = createFixture(db, user.id);
    fixture.repo.updateModelProfile(fixture.modelId, { contextWindow: 123456 });
    // A previous apply (or the user) tuned this model entry by hand.
    await writeFile(path.join(root, "models.json"), JSON.stringify({
      providers: {
        "pi-provider": {
          baseUrl: "https://old.example.com/v1",
          api: "openai-completions",
          apiKey: "sk-old",
          models: [{ id: "pi-model-1", name: "Old Name", reasoning: true, maxTokens: 999, input: ["text"] }]
        }
      }
    }), "utf8");

    await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });

    const models = JSON.parse(await readFile(path.join(root, "models.json"), "utf8"));
    const model = models.providers["pi-provider"].models[0];
    assert.equal(model.id, "pi-model-1");
    assert.equal(model.name, "Default Model");
    assert.equal(model.contextWindow, 123456, "profile context window wins");
    assert.equal(model.reasoning, true, "user-tuned reasoning preserved");
    assert.equal(model.maxTokens, 999, "user-tuned maxTokens preserved");
    assert.deepEqual(model.input, ["text"], "user-tuned input preserved");
  });

  it("maps provider api formats to PI api names and endpoints", async () => {
    const cases = [
      { name: "anthropic", apiFormat: "anthropic", providerKey: "relay", expectedApi: "anthropic-messages", expectedUrl: "https://api.deepseek.com/anthropic" },
      { name: "openai-native", apiFormat: "openai", providerKey: "openai", expectedApi: "openai-responses", expectedUrl: "https://api.deepseek.com/v1" },
      { name: "google", apiFormat: "google", providerKey: "gemini-relay", expectedApi: "google-generative-ai", expectedUrl: "https://api.deepseek.com/v1" },
      { name: "local", apiFormat: "local", providerKey: "ollama", expectedApi: "openai-completions", expectedUrl: "https://api.deepseek.com/v1" }
    ] as const;
    for (const testCase of cases) {
      const db = createTestDb();
      const user = new UserRepository(db).create(`apply-pi-${testCase.name}@example.com`, "hash");
      const root = await useConfigRoot(`forgebadger-apply-pi-${testCase.name}-`);
      const repo = new ModelProviderRepository(db, user.id, masterKey);
      const provider = repo.createProviderProfile({
        name: `${testCase.name} provider`,
        providerKey: testCase.providerKey,
        baseUrl: "https://api.deepseek.com",
        anthropicBaseUrl: "https://api.deepseek.com/anthropic",
        openaiBaseUrl: "https://api.deepseek.com/v1",
        authType: "api_key",
        apiFormat: testCase.apiFormat,
        supportedAdapters: ["pi"]
      });
      repo.createModelProfile({ providerProfileId: provider.id, name: "M", modelId: "m-1", isDefault: true });
      repo.createCredential({ providerProfileId: provider.id, label: "c", plaintextSecret: "sk-x" });

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "pi",
        providerProfileId: provider.id, resolveHost: publicResolver
      });

      const models = JSON.parse(await readFile(path.join(root, "models.json"), "utf8"));
      assert.equal(models.providers[testCase.providerKey].api, testCase.expectedApi, testCase.name);
      assert.equal(models.providers[testCase.providerKey].baseUrl, testCase.expectedUrl, testCase.name);
    }
  });

  it("rejects bedrock providers without touching the config files", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi-bedrock@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-bedrock-");
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    const provider = repo.createProviderProfile({
      name: "bedrock provider",
      providerKey: "bedrock",
      baseUrl: "https://bedrock.example.com",
      authType: "api_key",
      apiFormat: "bedrock",
      supportedAdapters: ["pi"]
    });
    repo.createModelProfile({ providerProfileId: provider.id, name: "M", modelId: "m-1", isDefault: true });
    repo.createCredential({ providerProfileId: provider.id, label: "c", plaintextSecret: "sk-x" });

    const error = await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: provider.id, resolveHost: publicResolver
    }).catch((caught: unknown) => caught);

    assert.ok(error instanceof Error);
    assert.equal((error as { code?: string }).code, "CLI_CONFIG_APPLY_ADAPTER_UNSUPPORTED");
    assert.equal(existsSync(path.join(root, "models.json")), false);
    assert.equal(existsSync(path.join(root, "settings.json")), false);
  });

  it("never writes auth.json and warns when it shadows the applied key", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi-shadow@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-shadow-");
    const fixture = createFixture(db, user.id);
    const authContent = JSON.stringify({ "pi-provider": { access: "oauth-access", refresh: "oauth-refresh" } });
    await writeFile(path.join(root, "auth.json"), authContent, "utf8");

    const preview = await previewCliConfigApply({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });
    assert.ok(
      preview.warnings.includes("PI_CREDENTIAL_SHADOWED_BY_AUTH"),
      "shadowed credential warning present"
    );

    await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });
    assert.equal(await readFile(path.join(root, "auth.json"), "utf8"), authContent, "auth.json untouched");
  });

  it("reports no shadow warning when auth.json is absent or unrelated", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi-noshadow@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-noshadow-");
    const fixture = createFixture(db, user.id);

    const emptyPreview = await previewCliConfigApply({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });
    assert.ok(!emptyPreview.warnings.includes("PI_CREDENTIAL_SHADOWED_BY_AUTH"));

    await writeFile(path.join(root, "auth.json"), JSON.stringify({ other: { access: "x" } }), "utf8");
    const otherPreview = await previewCliConfigApply({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });
    assert.ok(!otherPreview.warnings.includes("PI_CREDENTIAL_SHADOWED_BY_AUTH"));
  });

  it("refuses a symlinked settings.json before writing anything", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi-symlink@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-symlink-");
    const fixture = createFixture(db, user.id);
    const outside = path.join(await mkdtemp(path.join(tmpdir(), "forgebadger-apply-pi-outside-")), "settings.json");
    await writeFile(outside, "{}", "utf8");
    await symlink(outside, path.join(root, "settings.json"));

    const error = await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    }).catch((caught: unknown) => caught);

    assert.ok(error instanceof Error);
    assert.equal((error as { code?: string }).code, "CLI_CONFIG_TARGET_UNSAFE");
    assert.equal(existsSync(path.join(root, "models.json")), false, "models.json not written");
  });

  it("masks the api key in previews and diffs without touching disk", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi-preview@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-preview-");
    const fixture = createFixture(db, user.id);

    const previewsBefore = backupList().length;
    const preview = await previewCliConfigApply({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });

    const modelsFile = preview.files.find((file) => file.targetPath.endsWith("models.json"));
    const settingsFile = preview.files.find((file) => file.targetPath.endsWith("settings.json"));
    assert.ok(modelsFile && settingsFile, "both targets planned");
    assert.equal(modelsFile.operation, "create");
    assert.equal(modelsFile.proposed.includes("sk-pi-secret"), false, "plaintext key never in preview");
    assert.ok(modelsFile.proposed.includes("[redacted]"), "key masked in preview");
    assert.equal(settingsFile.proposed.includes("pi-model-1"), true);
    assert.equal(existsSync(path.join(root, "models.json")), false, "preview never writes");
    assert.equal(existsSync(path.join(root, "settings.json")), false, "preview never writes");
    assert.equal(backupList().length, previewsBefore, "preview never backs up");
  });

  it("applies idempotently and rolls back to the previous apply", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-pi-rollback@example.com", "hash");
    const root = await useConfigRoot("forgebadger-apply-pi-rollback-");
    const fixture = createFixture(db, user.id);
    const secondModel = fixture.repo.createModelProfile({
      providerProfileId: fixture.providerId,
      name: "Second Model",
      modelId: "pi-model-2"
    });

    await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, resolveHost: publicResolver
    });
    const afterFirst = {
      models: await readFile(path.join(root, "models.json"), "utf8"),
      settings: await readFile(path.join(root, "settings.json"), "utf8")
    };

    // A second apply that switches the default model.
    await applyCliConfigToAdapter({
      db, userId: user.id, masterKey, adapter: "pi",
      providerProfileId: fixture.providerId, modelProfileId: secondModel.id, resolveHost: publicResolver
    });
    const settingsAfterSecond = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8"));
    assert.equal(settingsAfterSecond.defaultModel, "pi-model-2");

    // Roll back the latest apply: the backup taken before it restores the
    // first apply's state.
    const rollback = await rollbackCliConfigApply({ masterKey, adapter: "pi" });
    assert.ok(rollback.restoredFiles.length >= 1);
    assert.equal(await readFile(path.join(root, "models.json"), "utf8"), afterFirst.models);
    assert.equal(await readFile(path.join(root, "settings.json"), "utf8"), afterFirst.settings);

    // Re-applying the same state twice is a no-op (idempotent).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "pi",
        providerProfileId: fixture.providerId, modelProfileId: secondModel.id, resolveHost: publicResolver
      });
      assert.equal(result.changed, attempt === 0);
    }
    assert.equal(
      await readFile(path.join(root, "settings.json"), "utf8"),
      JSON.stringify({ defaultProvider: "pi-provider", defaultModel: "pi-model-2" }, null, 2) + "\n"
    );
  });
});
