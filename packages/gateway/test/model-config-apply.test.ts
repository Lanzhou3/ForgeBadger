import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  applyModelProviderConfig,
  previewModelProviderConfig
} from "../src/services/model-config-apply.js";

describe("model provider config apply", () => {
  it("previews Claude env without exposing plaintext credentials", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-claude-apply-"));
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
        envName: "ANTHROPIC_API_KEY"
      }
    });

    assert.equal(preview.adapter, "claude");
    assert.equal(preview.env.ANTHROPIC_BASE_URL, "https://api.anthropic.com");
    assert.equal(preview.env.ANTHROPIC_MODEL, "claude-sonnet-4-5");
    assert.equal(preview.secretEnvNames.includes("ANTHROPIC_API_KEY"), true);
    assert.equal(JSON.stringify(preview).includes("secret-value"), false);
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

  it("rejects Claude apply for unsupported provider api formats", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-claude-openai-"));

    await assert.rejects(
      () => previewModelProviderConfig({
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
      }),
      /Claude provider apply only supports Anthropic/
    );
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
      }),
      /Codex provider apply is disabled/
    );
  });
});
