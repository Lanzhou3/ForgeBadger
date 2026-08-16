import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  applyCliConfigFieldPatch,
  readCliConfig,
  readCliConfigFieldValues,
  readCliConfigFile,
  removeCliModel,
  removeCliProvider,
  setCliDefaultModel,
  upsertCliModel,
  upsertCliProvider,
  writeCliConfigFile
} from "../src/services/cli-config.js";
import { cliConfigFieldCatalog, listCliConfigFields } from "../src/services/cli-config-fields.js";

type EnvKey = "KIMI_CODE_HOME" | "CODEX_HOME" | "CLAUDE_CONFIG_DIR" | "OPENCODE_CONFIG_DIR";

const managedEnvKeys: EnvKey[] = ["KIMI_CODE_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "OPENCODE_CONFIG_DIR"];
const savedEnv = new Map<EnvKey, string | undefined>();

before(() => {
  for (const key of managedEnvKeys) {
    savedEnv.set(key, process.env[key]);
  }
});

after(() => {
  for (const key of managedEnvKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

async function useConfigRoot(key: EnvKey, prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  process.env[key] = root;
  return root;
}

describe("cli-config service", () => {
  describe("kimi", () => {
    it("manages providers, models, and the default model in config.toml", async () => {
      const root = await useConfigRoot("KIMI_CODE_HOME", "openforge-cli-config-kimi-");

      let snapshot = await upsertCliProvider("kimi", "moonshot", {
        protocol: "kimi",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "sk-secret-value"
      });
      assert.equal(snapshot.configFile, "config.toml");
      assert.equal(snapshot.providers.length, 1);
      assert.deepEqual(snapshot.providers[0], {
        id: "moonshot",
        name: "moonshot",
        protocol: "kimi",
        baseUrl: "https://api.moonshot.cn/v1",
        hasApiKey: true,
        isActive: false
      });

      snapshot = await upsertCliModel("kimi", "moonshot/kimi-k2.5", {
        provider: "moonshot",
        modelId: "kimi-k2.5"
      });
      assert.deepEqual(snapshot.models, [
        { alias: "moonshot/kimi-k2.5", provider: "moonshot", modelId: "kimi-k2.5" }
      ]);

      snapshot = await setCliDefaultModel("kimi", "moonshot/kimi-k2.5");
      assert.equal(snapshot.defaultModel, "moonshot/kimi-k2.5");
      assert.equal(snapshot.providers[0]?.isActive, true);

      const raw = await readFile(path.join(root, "config.toml"), "utf8");
      assert.match(raw, /\[providers\.moonshot\]/);
      assert.match(raw, /api_key = "sk-secret-value"/);
      assert.match(raw, /default_model = "moonshot\/kimi-k2\.5"/);

      const configFile = snapshot.files.find((file) => file.relativePath === "config.toml");
      assert.ok(configFile);
      assert.equal(configFile.redacted, true);
      assert.doesNotMatch(configFile.content, /sk-secret-value/);

      const revealed = await readCliConfigFile("kimi", "config.toml", true);
      assert.equal(revealed.redacted, false);
      assert.match(revealed.content, /sk-secret-value/);
    });

    it("keeps the existing api key when updating a provider without one", async () => {
      await useConfigRoot("KIMI_CODE_HOME", "openforge-cli-config-kimi-keep-");
      await upsertCliProvider("kimi", "moonshot", { apiKey: "sk-secret-value" });

      const snapshot = await upsertCliProvider("kimi", "moonshot", { baseUrl: "https://api.moonshot.ai/v1" });

      assert.equal(snapshot.providers[0]?.hasApiKey, true);
      assert.equal(snapshot.providers[0]?.baseUrl, "https://api.moonshot.ai/v1");
    });

    it("removes a provider together with its models and default model", async () => {
      await useConfigRoot("KIMI_CODE_HOME", "openforge-cli-config-kimi-remove-");
      await upsertCliProvider("kimi", "moonshot", { protocol: "kimi" });
      await upsertCliModel("kimi", "moonshot/kimi-k2.5", { provider: "moonshot", modelId: "kimi-k2.5" });
      await setCliDefaultModel("kimi", "moonshot/kimi-k2.5");

      let snapshot = await removeCliModel("kimi", "moonshot/kimi-k2.5");
      assert.equal(snapshot.models.length, 0);
      assert.equal(snapshot.defaultModel, "");

      await upsertCliModel("kimi", "moonshot/kimi-k2.5", { provider: "moonshot", modelId: "kimi-k2.5" });
      await setCliDefaultModel("kimi", "moonshot/kimi-k2.5");
      snapshot = await removeCliProvider("kimi", "moonshot");
      assert.equal(snapshot.providers.length, 0);
      assert.equal(snapshot.models.length, 0);
      assert.equal(snapshot.defaultModel, "");
    });

    it("rejects model entry operations for non-kimi adapters", async () => {
      await useConfigRoot("CODEX_HOME", "openforge-cli-config-codex-models-");
      await assert.rejects(
        upsertCliModel("codex", "openai/gpt-5", { provider: "openai", modelId: "gpt-5" }),
        /only supported for the Kimi Code config/
      );
    });
  });

  describe("codex", () => {
    it("manages model_providers and the active model in config.toml", async () => {
      const root = await useConfigRoot("CODEX_HOME", "openforge-cli-config-codex-");

      let snapshot = await upsertCliProvider("codex", "gateway", {
        name: "OpenAI-compatible gateway",
        baseUrl: "https://api.example.com/v1",
        envKey: "EXAMPLE_API_KEY",
        protocol: "chat"
      });
      assert.deepEqual(snapshot.providers[0], {
        id: "gateway",
        name: "OpenAI-compatible gateway",
        protocol: "chat",
        baseUrl: "https://api.example.com/v1",
        hasApiKey: false,
        envKey: "EXAMPLE_API_KEY",
        isActive: false
      });

      snapshot = await setCliDefaultModel("codex", "kimi-k2.5", "gateway");
      assert.equal(snapshot.defaultModel, "kimi-k2.5");
      assert.equal(snapshot.providers[0]?.isActive, true);

      const raw = await readFile(path.join(root, "config.toml"), "utf8");
      assert.match(raw, /model = "kimi-k2\.5"/);
      assert.match(raw, /model_provider = "gateway"/);
      assert.match(raw, /\[model_providers\.gateway\]/);

      snapshot = await removeCliProvider("codex", "gateway");
      assert.equal(snapshot.providers.length, 0);
      assert.doesNotMatch(await readFile(path.join(root, "config.toml"), "utf8"), /model_provider = "gateway"/);
    });
  });

  describe("opencode", () => {
    it("manages providers and the active model in opencode.json", async () => {
      const root = await useConfigRoot("OPENCODE_CONFIG_DIR", "openforge-cli-config-opencode-");

      let snapshot = await upsertCliProvider("opencode", "deepseek", {
        name: "DeepSeek",
        protocol: "@ai-sdk/openai-compatible",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-secret-value"
      });
      assert.equal(snapshot.providers[0]?.protocol, "@ai-sdk/openai-compatible");
      assert.equal(snapshot.providers[0]?.hasApiKey, true);

      snapshot = await setCliDefaultModel("opencode", "deepseek/deepseek-chat");
      assert.equal(snapshot.defaultModel, "deepseek/deepseek-chat");
      assert.equal(snapshot.providers[0]?.isActive, true);

      const raw = await readFile(path.join(root, "opencode.json"), "utf8");
      const doc = JSON.parse(raw) as { provider: Record<string, { options: { apiKey: string } }> };
      assert.equal(doc.provider.deepseek?.options.apiKey, "sk-secret-value");

      snapshot = await removeCliProvider("opencode", "deepseek");
      assert.equal(snapshot.providers.length, 0);
      assert.equal(snapshot.defaultModel, "");
    });
  });

  describe("claude", () => {
    it("manages the Anthropic endpoint and model in settings.json", async () => {
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "openforge-cli-config-claude-");

      let snapshot = await upsertCliProvider("claude", "anthropic", {
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-secret"
      });
      assert.equal(snapshot.providers.length, 1);
      assert.equal(snapshot.providers[0]?.hasApiKey, true);

      snapshot = await setCliDefaultModel("claude", "claude-sonnet-4-5");
      assert.equal(snapshot.defaultModel, "claude-sonnet-4-5");

      const raw = await readFile(path.join(root, "settings.json"), "utf8");
      const doc = JSON.parse(raw) as { env: Record<string, string> };
      assert.equal(doc.env.ANTHROPIC_BASE_URL, "https://api.anthropic.com");
      assert.equal(doc.env.ANTHROPIC_AUTH_TOKEN, "sk-ant-secret");
      assert.equal(doc.env.ANTHROPIC_MODEL, "claude-sonnet-4-5");

      snapshot = await removeCliProvider("claude", "anthropic");
      assert.equal(snapshot.providers.length, 0);
      assert.equal(snapshot.defaultModel, "claude-sonnet-4-5");
    });

    it("rejects non-Anthropic provider ids", async () => {
      await useConfigRoot("CLAUDE_CONFIG_DIR", "openforge-cli-config-claude-single-");
      await assert.rejects(
        upsertCliProvider("claude", "openai", { baseUrl: "https://api.openai.com" }),
        /single Anthropic endpoint/
      );
    });
  });

  describe("raw file editing", () => {
    it("writes whitelisted config files and rejects unsupported paths", async () => {
      const root = await useConfigRoot("KIMI_CODE_HOME", "openforge-cli-config-raw-");

      const snapshot = await writeCliConfigFile("kimi", "AGENTS.md", "# Global Kimi\n");
      const agentsFile = snapshot.files.find((file) => file.relativePath === "AGENTS.md");
      assert.equal(agentsFile?.exists, true);
      assert.equal(agentsFile?.content, "# Global Kimi\n");
      assert.equal(await readFile(path.join(root, "AGENTS.md"), "utf8"), "# Global Kimi\n");

      await assert.rejects(
        writeCliConfigFile("kimi", "../escape.toml", "x"),
        /Unsupported config file path/
      );
      await assert.rejects(
        writeCliConfigFile("kimi", "tui.toml", "x"),
        /Unsupported kimi config file/
      );
      await assert.rejects(
        writeCliConfigFile("kimi", "config.toml", "x".repeat(129 * 1024)),
        /exceeds maximum size/
      );
    });
  });

  describe("field catalog", () => {
    const adapters = ["claude", "opencode", "codex", "kimi"] as const;

    it("keeps unique keys and enum values per adapter", () => {
      for (const adapter of adapters) {
        const fields = listCliConfigFields(adapter);
        assert.ok(fields.length > 0, `${adapter} has no curated fields`);
        const keys = fields.map((field) => field.key);
        assert.equal(new Set(keys).size, keys.length, `${adapter} has duplicate field keys`);
        for (const field of fields) {
          assert.ok(field.path.length > 0);
          assert.ok(field.label.length > 0);
          if (field.type === "enum") {
            assert.ok((field.values?.length ?? 0) > 0, `${adapter}.${field.key} enum has no values`);
          }
        }
        assert.equal(listCliConfigFields(adapter), cliConfigFieldCatalog[adapter]);
      }
    });

    it("reads current field values from codex config.toml", async () => {
      await useConfigRoot("CODEX_HOME", "openforge-fields-codex-read-");
      await writeCliConfigFile("codex", "config.toml", [
        'model = "kimi-k2.5"',
        'model_provider = "gateway"',
        'approval_policy = "on-request"',
        "",
        "[model_providers.gateway]",
        'name = "Gateway"',
        'base_url = "https://api.example.com/v1"',
        'wire_api = "chat"',
        ""
      ].join("\n"));

      const values = await readCliConfigFieldValues("codex");
      assert.equal(values.model, "kimi-k2.5");
      assert.equal(values.modelProvider, "gateway");
      assert.equal(values.approvalPolicy, "on-request");
    });

    it("reports claude secret fields as a presence flag only", async () => {
      await useConfigRoot("CLAUDE_CONFIG_DIR", "openforge-fields-claude-secret-");
      await writeCliConfigFile("claude", "settings.json", JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: "sk-ant-secret",
          ANTHROPIC_BASE_URL: "https://api.anthropic.com"
        }
      }, null, 2));

      const values = await readCliConfigFieldValues("claude");
      assert.equal(values.anthropicAuthToken, true);
      assert.equal(values.anthropicBaseUrl, "https://api.anthropic.com");
    });

    it("patches curated codex fields and preserves unknown TOML sections", async () => {
      const root = await useConfigRoot("CODEX_HOME", "openforge-fields-codex-patch-");
      await writeCliConfigFile("codex", "config.toml", '[unknown_section]\nkeep = "me"\n');

      const snapshot = await applyCliConfigFieldPatch("codex", {
        model: "kimi-k2.5",
        modelProvider: "gateway",
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write"
      });
      assert.equal(snapshot.defaultModel, "kimi-k2.5");

      const raw = await readFile(path.join(root, "config.toml"), "utf8");
      assert.match(raw, /approval_policy = "on-request"/);
      assert.match(raw, /sandbox_mode = "workspace-write"/);
      assert.match(raw, /\[unknown_section\]/);
      assert.match(raw, /keep = "me"/);
    });

    it("patches nested claude fields including numbers and enums", async () => {
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "openforge-fields-claude-patch-");
      await applyCliConfigFieldPatch("claude", {
        apiTimeoutMs: 600000,
        permissionsDefaultMode: "acceptEdits",
        anthropicBaseUrl: "https://api.anthropic.com"
      });

      const doc = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as {
        env: Record<string, unknown>;
        permissions: Record<string, unknown>;
      };
      assert.equal(doc.env.API_TIMEOUT_MS, 600000);
      assert.equal(doc.permissions.defaultMode, "acceptEdits");
      assert.equal(doc.env.ANTHROPIC_BASE_URL, "https://api.anthropic.com");
    });

    it("patches opencode boolean fields", async () => {
      const root = await useConfigRoot("OPENCODE_CONFIG_DIR", "openforge-fields-opencode-patch-");
      await applyCliConfigFieldPatch("opencode", { autoupdate: false, theme: "dark" });

      const doc = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8")) as Record<string, unknown>;
      assert.equal(doc.autoupdate, false);
      assert.equal(doc.theme, "dark");
    });

    it("patches kimi default_model", async () => {
      const root = await useConfigRoot("KIMI_CODE_HOME", "openforge-fields-kimi-patch-");
      const snapshot = await applyCliConfigFieldPatch("kimi", { defaultModel: "moonshot/kimi-k2.5" });

      assert.equal(snapshot.defaultModel, "moonshot/kimi-k2.5");
      assert.match(await readFile(path.join(root, "config.toml"), "utf8"), /default_model = /);
    });

    it("writes secret field values but never reads them back", async () => {
      await useConfigRoot("CLAUDE_CONFIG_DIR", "openforge-fields-claude-write-secret-");
      await applyCliConfigFieldPatch("claude", { anthropicAuthToken: "sk-new-secret" });

      const values = await readCliConfigFieldValues("claude");
      assert.equal(values.anthropicAuthToken, true);
    });

    it("deletes field keys with null", async () => {
      const root = await useConfigRoot("CLAUDE_CONFIG_DIR", "openforge-fields-claude-delete-");
      await applyCliConfigFieldPatch("claude", { apiTimeoutMs: 600000 });
      await applyCliConfigFieldPatch("claude", { apiTimeoutMs: null });

      const doc = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")) as {
        env: Record<string, unknown>;
      };
      assert.equal(doc.env.API_TIMEOUT_MS, undefined);
    });

    it("rejects invalid patches without touching the file", async () => {
      const root = await useConfigRoot("CODEX_HOME", "openforge-fields-codex-invalid-");
      const original = 'model = "kimi-k2.5"\n';
      await writeCliConfigFile("codex", "config.toml", original);

      await assert.rejects(
        applyCliConfigFieldPatch("codex", { nope: "x" }),
        /Unknown codex config field/
      );
      await assert.rejects(
        applyCliConfigFieldPatch("codex", { approvalPolicy: "always" }),
        /approvalPolicy/
      );
      await assert.rejects(
        applyCliConfigFieldPatch("codex", { model: 42 }),
        /model/
      );
      await assert.rejects(
        applyCliConfigFieldPatch("codex", { sandboxMode: null, model: true }),
        /model/
      );
      assert.equal(await readFile(path.join(root, "config.toml"), "utf8"), original);
    });

    it("does not rewrite the file for an empty patch", async () => {
      const root = await useConfigRoot("CODEX_HOME", "openforge-fields-codex-empty-");
      const original = [
        "# hand-written comment that must survive",
        'model = "kimi-k2.5"',
        ""
      ].join("\n");
      await writeCliConfigFile("codex", "config.toml", original);

      const snapshot = await applyCliConfigFieldPatch("codex", {});
      assert.equal(snapshot.defaultModel, "kimi-k2.5");
      assert.equal(await readFile(path.join(root, "config.toml"), "utf8"), original);
    });
  });

  describe("error handling", () => {
    it("rejects invalid provider ids", async () => {
      await useConfigRoot("KIMI_CODE_HOME", "openforge-cli-config-ids-");
      await assert.rejects(
        upsertCliProvider("kimi", "bad id!", {}),
        /Invalid provider id/
      );
    });

    it("surfaces invalid TOML instead of silently dropping it", async () => {
      const root = await useConfigRoot("KIMI_CODE_HOME", "openforge-cli-config-bad-toml-");
      await assert.rejects(
        writeCliConfigFile("kimi", "config.toml", "[providers\nbroken"),
        /not valid TOML/
      );

      assert.match(await readFile(path.join(root, "config.toml"), "utf8"), /broken/);
      await assert.rejects(readCliConfig("kimi"), /not valid TOML/);
    });
  });
});
