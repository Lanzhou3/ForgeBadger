import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  applyModelProviderConfig,
  previewModelProviderConfig
} from "../src/services/model-config-apply.js";

type PreviewInput = Parameters<typeof previewModelProviderConfig>[0];

describe("model provider config apply", () => {
  it("applies Claude Code provider settings with secret placeholders", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-claude-apply-"));
    await mkdir(path.join(root, ".claude"));
    await writeFile(path.join(root, ".claude/settings.local.json"), JSON.stringify({
      permissions: { allow: ["Bash(pnpm test)"] },
      env: { EXISTING_FLAG: "1" }
    }, null, 2), "utf8");

    const preview = await previewModelProviderConfig({
      projectRoot: root,
      adapter: "claude",
      provider: {
        id: "provider-1",
        providerKey: "anthropic",
        baseUrl: "https://api.anthropic.com",
        authType: "api_key",
        apiFormat: "anthropic"
      },
      model: {
        id: "model-1",
        modelId: "claude-sonnet-4-5"
      },
      credential: {
        id: "credential-1",
        envName: "ANTHROPIC_AUTH_TOKEN"
      }
    });
    const settings = JSON.parse(preview.files[0]!.content);

    assert.equal(preview.adapter, "claude");
    assert.equal(preview.changedFiles[0]?.relativePath, ".claude/settings.local.json");
    assert.deepEqual(preview.env, { ANTHROPIC_AUTH_TOKEN: "{stored-provider-credential}" });
    assert.deepEqual(preview.secretEnvNames, ["ANTHROPIC_AUTH_TOKEN"]);
    assert.equal(settings.permissions.allow[0], "Bash(pnpm test)");
    assert.equal(settings.env.EXISTING_FLAG, "1");
    assert.equal(settings.env.ANTHROPIC_BASE_URL, "https://api.anthropic.com");
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, "{env:ANTHROPIC_AUTH_TOKEN}");
    assert.equal(settings.env.ANTHROPIC_MODEL, "claude-sonnet-4-5");
    assert.equal(settings.env.ANTHROPIC_SMALL_FAST_MODEL, "claude-sonnet-4-5");
    assert.equal(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-sonnet-4-5");
    assert.equal(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "claude-sonnet-4-5");
    assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, "claude-sonnet-4-5");
  });

  it("applies OpenCode provider fragments additively with backup metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-opencode-apply-"));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({
      provider: {
        existing: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://127.0.0.1:11434/v1"
          }
        }
      }
    }, null, 2), "utf8");

    const result = await applyModelProviderConfig({
      projectRoot: root,
      adapter: "opencode",
      provider: {
        id: "provider-1",
        providerKey: "deepseek",
        baseUrl: "https://api.deepseek.com",
        authType: "api_key",
        apiFormat: "openai-compatible"
      },
      model: {
        id: "model-1",
        modelId: "deepseek-chat"
      },
      credential: {
        id: "credential-1",
        envName: "DEEPSEEK_API_KEY"
      }
    });

    const config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));

    assert.equal(result.changedFiles[0]?.relativePath, "opencode.json");
    assert.match(result.backupPath, /\.openforge\/backups\/model-provider-apply\//);
    assert.ok(config.provider.existing);
    assert.equal(config.provider.deepseek.options.baseURL, "https://api.deepseek.com");
    assert.equal(config.provider.deepseek.options.apiKey, "{env:DEEPSEEK_API_KEY}");
    assert.equal(config.model, "deepseek/deepseek-chat");
  });

  it("uses adapter-specific OpenCode provider packages from api format", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-opencode-google-"));

    const preview = await previewModelProviderConfig({
      projectRoot: root,
      adapter: "opencode",
      provider: {
        id: "provider-google",
        providerKey: "google-gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        authType: "api_key",
        apiFormat: "google"
      },
      model: {
        id: "model-gemini",
        modelId: "gemini-pro"
      },
      credential: {
        id: "credential-google",
        envName: "GOOGLE_GEMINI_API_KEY"
      }
    });
    const plannedConfig = JSON.parse(preview.files[0]!.content);

    assert.equal(plannedConfig.provider["google-gemini"].npm, "@ai-sdk/google");
  });

  it("applies Claude settings for any provider format selected by a Claude-compatible preset", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-claude-openai-"));

    const preview = await previewModelProviderConfig({
        projectRoot: root,
        adapter: "claude",
        provider: {
          id: "provider-openai",
          providerKey: "openai",
          baseUrl: "https://api.openai.com/v1",
          authType: "api_key",
          apiFormat: "openai"
        },
        model: {
          id: "model-openai",
          modelId: "gpt-5.1"
        }
      });
    const plannedSettings = JSON.parse(preview.files[0]!.content);

    assert.equal(plannedSettings.env.ANTHROPIC_BASE_URL, "https://api.openai.com/v1");
    assert.equal(plannedSettings.env.ANTHROPIC_MODEL, "gpt-5.1");
    assert.equal(plannedSettings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "gpt-5.1");
    assert.equal(plannedSettings.env.API_TIMEOUT_MS, "600000");
  });

  it("rejects Codex provider apply because Codex is subscription-managed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-codex-apply-"));
    await mkdir(path.join(root, ".codex"));

    await assert.rejects(
      () => previewModelProviderConfig({
        projectRoot: root,
        adapter: "codex",
        provider: {
          id: "provider-1",
          providerKey: "openai",
          baseUrl: "https://api.openai.com/v1",
          authType: "api_key",
          apiFormat: "openai"
        },
        model: {
          id: "model-1",
          modelId: "gpt-5.1-codex"
        }
      } as unknown as PreviewInput),
      /Codex provider apply is disabled/
    );
  });

  it("applies Kimi provider settings to a project-scope config.toml", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-kimi-apply-"));
    await mkdir(path.join(root, ".kimi-code"));
    await writeFile(path.join(root, ".kimi-code/config.toml"), [
      "[providers.existing]",
      "type = \"openai\"",
      "base_url = \"http://127.0.0.1:11434/v1\"",
      "# keep a comment"
    ].join("\n") + "\n", "utf8");

    const result = await applyModelProviderConfig({
      projectRoot: root,
      adapter: "kimi",
      provider: {
        id: "provider-1",
        providerKey: "moonshot",
        baseUrl: "https://api.moonshot.cn/v1",
        authType: "api_key",
        apiFormat: "openai"
      },
      model: {
        id: "model-1",
        modelId: "kimi-k2.5"
      },
      credential: {
        id: "credential-1",
        envName: "MOONSHOT_API_KEY"
      }
    });

    const config = await readFile(path.join(root, ".kimi-code/config.toml"), "utf8");

    assert.equal(result.adapter, "kimi");
    assert.deepEqual(result.scope, "project");
    assert.equal(result.changedFiles[0]?.relativePath, ".kimi-code/config.toml");
    assert.deepEqual(result.env, { MOONSHOT_API_KEY: "{stored-provider-credential}" });
    assert.match(result.backupPath, /\.openforge\/backups\/model-provider-apply\//);
    assert.ok(config.includes("default_model = \"moonshot/kimi-k2.5\""));
    assert.ok(config.includes("base_url = \"https://api.moonshot.cn/v1\""));
    assert.ok(config.includes("api_key = \"{env:MOONSHOT_API_KEY}\""));
    assert.ok(config.includes("[providers.existing]"));
  });

  it("applies Claude provider settings to the user-global settings.json", async () => {
    const globalRoot = await mkdtemp(path.join(tmpdir(), "openforge-claude-global-"));
    await writeFile(path.join(globalRoot, "settings.json"), JSON.stringify({
      env: { GLOBAL_FLAG: "1" }
    }, null, 2), "utf8");

    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = globalRoot;
    try {
      const result = await applyModelProviderConfig({
        projectRoot: "/unused",
        adapter: "claude",
        scope: "user-global",
        provider: {
          id: "provider-1",
          providerKey: "anthropic",
          baseUrl: "https://api.anthropic.com",
          authType: "api_key",
          apiFormat: "anthropic"
        },
        model: {
          id: "model-1",
          modelId: "claude-sonnet-4-5"
        },
        credential: {
          id: "credential-1",
          envName: "ANTHROPIC_AUTH_TOKEN"
        }
      });

      const settings = JSON.parse(await readFile(path.join(globalRoot, "settings.json"), "utf8"));

      assert.equal(result.changedFiles[0]?.relativePath, "settings.json");
      assert.deepEqual(result.scope, "user-global");
      assert.equal(settings.env.GLOBAL_FLAG, "1");
      assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, "{env:ANTHROPIC_AUTH_TOKEN}");
      assert.equal(settings.env.ANTHROPIC_MODEL, "claude-sonnet-4-5");
      assert.match(result.backupPath, /\.openforge\/backups\/model-provider-apply\//);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
      await rm(globalRoot, { recursive: true, force: true });
    }
  });

  it("applies Kimi provider settings to the user-global config.toml", async () => {
    const globalRoot = await mkdtemp(path.join(tmpdir(), "openforge-kimi-global-"));
    await writeFile(path.join(globalRoot, "config.toml"), "[models]\n", "utf8");

    const previous = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = globalRoot;
    try {
      const result = await applyModelProviderConfig({
        projectRoot: "/unused",
        adapter: "kimi",
        scope: "user-global",
        provider: {
          id: "provider-1",
          providerKey: "volcengine",
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          authType: "api_key",
          apiFormat: "openai"
        },
        model: {
          id: "model-1",
          modelId: "deepseek-v3.1"
        },
        credential: {
          id: "credential-1",
          envName: "ARK_API_KEY"
        }
      });

      const config = await readFile(path.join(globalRoot, "config.toml"), "utf8");

      assert.equal(result.changedFiles[0]?.relativePath, "config.toml");
      assert.deepEqual(result.scope, "user-global");
      assert.ok(config.includes("default_model = \"volcengine/deepseek-v3.1\""));
      assert.ok(config.includes("api_key = \"{env:ARK_API_KEY}\""));
    } finally {
      if (previous === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = previous;
      await rm(globalRoot, { recursive: true, force: true });
    }
  });

  it("applies OpenCode provider settings to the user-global opencode.json", async () => {
    const globalRoot = await mkdtemp(path.join(tmpdir(), "openforge-opencode-global-"));
    await writeFile(path.join(globalRoot, "opencode.json"), JSON.stringify({}, null, 2), "utf8");

    const previous = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = globalRoot;
    try {
      const preview = await previewModelProviderConfig({
        projectRoot: "/unused",
        adapter: "opencode",
        scope: "user-global",
        provider: {
          id: "provider-1",
          providerKey: "deepseek",
          baseUrl: "https://api.deepseek.com",
          authType: "api_key",
          apiFormat: "openai-compatible"
        },
        model: {
          id: "model-1",
          modelId: "deepseek-chat"
        },
        credential: {
          id: "credential-1",
          envName: "DEEPSEEK_API_KEY"
        }
      });

      assert.equal(preview.changedFiles[0]?.relativePath, "opencode.json");
      assert.deepEqual(preview.scope, "user-global");
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR;
      else process.env.OPENCODE_CONFIG_DIR = previous;
      await rm(globalRoot, { recursive: true, force: true });
    }
  });
});
