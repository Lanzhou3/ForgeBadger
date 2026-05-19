import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createProviderCatalogFromModelsDev,
  getModelPresets,
  getProviderCatalog,
  groupModelsByProvider,
  loadProviderCatalog
} from "../src/services/model-catalog.js";

describe("model catalog", () => {
  it("does not expose built-in model presets", () => {
    const presets = getModelPresets();

    assert.deepEqual(presets, []);
  });

  it("exposes verified provider products with dual protocol endpoints at runtime", () => {
    const catalog = getProviderCatalog();

    const kimiCode = catalog.find((provider) => provider.id === "kimi-code");
    const qwenCodingCn = catalog.find((provider) => provider.id === "qwen-coding-plan-cn");
    const minimaxGlobal = catalog.find((provider) => provider.id === "minimax-global");

    assert.ok(kimiCode);
    assert.ok(qwenCodingCn);
    assert.ok(minimaxGlobal);
    assert.equal(catalog.some((provider) => /\((?:Claude Code|OpenCode)\)|for (?:Claude Code|OpenCode)/iu.test(provider.name)), false);
    assert.ok(catalog.every((provider) => provider.source === "verified"));
    assert.deepEqual(kimiCode.supportedAdapters, ["claude", "opencode"]);
    assert.equal(kimiCode.region, "global");
    assert.equal(kimiCode.productType, "coding_plan");
    assert.equal(kimiCode.endpoints.anthropic?.baseUrl, "https://api.kimi.com/coding/");
    assert.equal(kimiCode.endpoints.openai?.baseUrl, "https://api.kimi.com/coding/v1");
    assert.equal(qwenCodingCn.region, "cn");
    assert.equal(qwenCodingCn.productType, "coding_plan");
    assert.equal(minimaxGlobal.endpoints.anthropic?.baseUrl, "https://api.minimax.io/anthropic");
    assert.equal(minimaxGlobal.endpoints.openai?.baseUrl, "https://api.minimax.io/v1");
  });

  it("loads verified providers before models.dev providers", async () => {
    const catalog = await loadProviderCatalog({
      fetchImpl: async () => new Response(JSON.stringify({
        openrouter: {
          id: "openrouter",
          name: "OpenRouter",
          env: ["OPENROUTER_API_KEY"],
          npm: "@openrouter/ai-sdk-provider",
          api: "https://openrouter.ai/api/v1",
          models: {
            "openrouter/auto": {
              id: "openrouter/auto",
              name: "OpenRouter Auto",
              release_date: "2026-01-01",
              attachment: false,
              reasoning: false,
              temperature: true,
              tool_call: true,
              limit: { context: 128000, output: 4096 }
            }
          }
        }
      }), { status: 200 })
    });

    assert.equal(catalog[0]?.source, "verified");
    assert.ok(catalog.some((provider) => provider.id === "openrouter" && provider.source === "models.dev"));
  });

  it("does not duplicate verified providers returned again by models.dev", async () => {
    const catalog = await loadProviderCatalog({
      fetchImpl: async () => new Response(JSON.stringify({
        "qwen-coding-plan-cn": {
          id: "qwen-coding-plan-cn",
          name: "Qwen Coding Plan 中国大陆",
          env: ["DASHSCOPE_API_KEY"],
          npm: "@ai-sdk/openai-compatible",
          api: "https://coding.dashscope.aliyuncs.com/v1",
          models: {
            "qwen3.5-coder": {
              id: "qwen3.5-coder",
              name: "Qwen3.5 Coder",
              release_date: "2026-01-01",
              attachment: false,
              reasoning: true,
              temperature: true,
              tool_call: true,
              limit: { context: 256000, output: 8192 }
            }
          }
        }
      }), { status: 200 })
    });

    assert.equal(catalog.filter((provider) => provider.id === "qwen-coding-plan-cn").length, 1);
    assert.equal(catalog.filter((provider) => provider.name === "Qwen Coding Plan 中国大陆").length, 1);
  });

  it("keeps the verified catalog when models.dev cannot be loaded", async () => {
    const catalog = await loadProviderCatalog({
      fetchImpl: async () => new Response("unavailable", { status: 503 })
    });

    assert.ok(catalog.length > 0);
    assert.ok(catalog.every((provider) => provider.source === "verified"));
  });

  it("normalizes models.dev providers into OpenCode-ready catalog presets", () => {
    const catalog = createProviderCatalogFromModelsDev({
      openai: {
        id: "openai",
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        npm: "@ai-sdk/openai",
        api: "https://api.openai.com/v1",
        models: {
          "gpt-5.1": {
            id: "gpt-5.1",
            name: "GPT-5.1",
            release_date: "2026-01-01",
            attachment: true,
            reasoning: true,
            temperature: true,
            tool_call: true,
            limit: { context: 400000, output: 128000 },
            modalities: { input: ["text", "image"], output: ["text"] }
          },
          "gpt-4o-deprecated": {
            id: "gpt-4o-deprecated",
            name: "GPT-4o Deprecated",
            release_date: "2024-05-13",
            attachment: true,
            reasoning: false,
            temperature: true,
            tool_call: true,
            status: "deprecated",
            limit: { context: 128000, output: 4096 }
          }
        }
      }
    });

    const openai = catalog.find((provider) => provider.id === "openai");
    assert.equal(openai?.source, "models.dev");
    assert.equal(openai?.apiFormat, "openai");
    assert.equal(openai?.baseUrl, "https://api.openai.com/v1");
    assert.deepEqual(openai?.supportedAdapters, ["opencode"]);
    assert.deepEqual(openai?.env, { OPENAI_API_KEY: "OpenAI API key" });
    assert.equal(openai?.opencode?.npm, "@ai-sdk/openai");
    assert.equal(openai?.defaultModels.length, 1);
    assert.deepEqual(openai?.defaultModels[0], {
      id: "gpt-5.1",
      name: "GPT-5.1",
      modelId: "gpt-5.1",
      capabilities: ["chat", "code", "reasoning", "toolcall", "attachment", "image"],
      contextWindow: 400000
    });
  });

  it("does not expose unsafe OpenCode npm package names from models.dev", () => {
    const catalog = createProviderCatalogFromModelsDev({
      unsafe: {
        id: "unsafe",
        name: "Unsafe",
        env: ["UNSAFE_API_KEY"],
        npm: "@ai-sdk/openai-compatible; touch /tmp/owned",
        api: "https://unsafe.example.com/v1",
        models: {
          "unsafe-model": {
            id: "unsafe-model",
            name: "Unsafe Model",
            release_date: "2026-01-01",
            attachment: false,
            reasoning: false,
            temperature: true,
            tool_call: true,
            provider: {
              npm: "../../bad-package"
            },
            limit: { context: 32000, output: 4096 }
          }
        }
      }
    });

    assert.equal(catalog[0]?.opencode?.npm, "@ai-sdk/openai-compatible");
  });

  it("groups models by provider with counts", () => {
    const groups = groupModelsByProvider([
      { id: "m1", name: "Claude Sonnet", provider: "anthropic" },
      { id: "m2", name: "GPT", provider: "openai" },
      { id: "m3", name: "Claude Opus", provider: "anthropic" },
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.provider, "anthropic");
    assert.equal(groups[0]!.count, 2);
    assert.equal(groups[1]!.provider, "openai");
  });
});
