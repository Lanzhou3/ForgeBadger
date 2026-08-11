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
    const xiaomiMimoTokenCn = catalog.find((provider) => provider.id === "xiaomi-mimo-token-plan-cn");

    assert.ok(kimiCode);
    assert.ok(qwenCodingCn);
    assert.ok(minimaxGlobal);
    assert.ok(xiaomiMimoTokenCn);
    assert.equal(catalog.some((provider) => /\((?:Claude Code|OpenCode)\)|for (?:Claude Code|OpenCode)/iu.test(provider.name)), false);
    assert.ok(catalog.every((provider) => provider.source === "verified"));
    assert.deepEqual(kimiCode.supportedAdapters, ["claude", "opencode"]);
    assert.equal(kimiCode.region, "global");
    assert.equal(kimiCode.productType, "coding_plan");
    assert.equal(kimiCode.endpoints.anthropic?.baseUrl, "https://api.kimi.com/coding/");
    assert.equal(kimiCode.endpoints.openai?.baseUrl, "https://api.kimi.com/coding/v1");
    assert.equal(qwenCodingCn.region, "cn");
    assert.equal(qwenCodingCn.productType, "coding_plan");
    assert.deepEqual(
      qwenCodingCn.defaultModels.map((model) => model.modelId),
      [
        "qwen3.6-plus",
        "qwen3-coder-plus",
        "qwen3-coder-next",
        "qwen3.5-plus",
        "qwen3-max-2026-01-23",
        "kimi-k2.5",
        "glm-5",
        "MiniMax-M2.5",
        "glm-4.7"
      ]
    );
    assert.equal(qwenCodingCn.claude?.defaultSmallFastModel, "qwen3-coder-plus");
    assert.equal(minimaxGlobal.endpoints.anthropic?.baseUrl, "https://api.minimax.io/anthropic");
    assert.equal(minimaxGlobal.endpoints.openai?.baseUrl, "https://api.minimax.io/v1");
    assert.equal(xiaomiMimoTokenCn.region, "cn");
    assert.equal(xiaomiMimoTokenCn.productType, "token_plan");
    assert.equal(xiaomiMimoTokenCn.endpoints.anthropic?.baseUrl, "https://token-plan-cn.xiaomimimo.com/anthropic");
    assert.equal(xiaomiMimoTokenCn.endpoints.openai?.baseUrl, "https://token-plan-cn.xiaomimimo.com/v1");
    assert.ok(xiaomiMimoTokenCn.defaultModels.some((model) => model.modelId === "mimo-v2.5-pro"));
    assert.ok(xiaomiMimoTokenCn.defaultModels.every((model) => !model.capabilities.includes("toolcall")));
  });

  it("exposes provider products aligned with the cc-switch official preset list", () => {
    const catalog = getProviderCatalog();

    const kimiApi = catalog.find((provider) => provider.id === "kimi-api");
    const zaiGlmApi = catalog.find((provider) => provider.id === "zai-glm-api");
    const qianfan = catalog.find((provider) => provider.id === "baidu-qianfan-coding-plan");
    const stepfunCn = catalog.find((provider) => provider.id === "stepfun-coding-plan-cn");
    const stepfunIntl = catalog.find((provider) => provider.id === "stepfun-coding-plan-intl");
    const modelscope = catalog.find((provider) => provider.id === "modelscope-api");
    const siliconflow = catalog.find((provider) => provider.id === "siliconflow-api");
    const siliconflowIntl = catalog.find((provider) => provider.id === "siliconflow-intl");
    const volcCn = catalog.find((provider) => provider.id === "volcengine-agent-plan-cn");
    const volcIntl = catalog.find((provider) => provider.id === "volcengine-agent-plan-intl");
    const volcArk = catalog.find((provider) => provider.id === "volcengine-ark-api-cn");
    const openrouter = catalog.find((provider) => provider.id === "openrouter-api");
    const novita = catalog.find((provider) => provider.id === "novita-api");

    assert.ok(kimiApi);
    assert.ok(zaiGlmApi);
    assert.ok(qianfan);
    assert.ok(stepfunCn);
    assert.ok(stepfunIntl);
    assert.ok(modelscope);
    assert.ok(siliconflow);
    assert.ok(siliconflowIntl);
    assert.ok(volcCn);
    assert.ok(volcIntl);
    assert.ok(volcArk);
    assert.ok(openrouter);
    assert.ok(novita);

    assert.equal(kimiApi?.endpoints.anthropic?.baseUrl, "https://api.moonshot.cn/anthropic");
    assert.equal(kimiApi?.endpoints.openai?.baseUrl, "https://api.moonshot.cn/v1");
    assert.equal(qianfan?.endpoints.anthropic?.baseUrl, "https://qianfan.baidubce.com/anthropic/coding");
    assert.equal(stepfunCn?.endpoints.anthropic?.baseUrl, "https://api.stepfun.com/step_plan");
    assert.equal(stepfunIntl?.endpoints.anthropic?.baseUrl, "https://api.stepfun.ai/step_plan");
    assert.equal(modelscope?.endpoints.anthropic?.baseUrl, "https://api-inference.modelscope.cn");
    assert.equal(siliconflow?.endpoints.anthropic?.baseUrl, "https://api.siliconflow.cn");
    assert.equal(siliconflowIntl?.endpoints.anthropic?.baseUrl, "https://api.siliconflow.com");
    assert.equal(volcCn?.endpoints.anthropic?.baseUrl, "https://ark.cn-beijing.volces.com/api/coding");
    assert.equal(volcIntl?.endpoints.anthropic?.baseUrl, "https://ark.ap-southeast.bytepluses.com/api/coding");
    assert.equal(volcCn?.productType, "coding_plan");
    assert.equal(volcArk?.endpoints.anthropic, undefined);
    assert.equal(volcArk?.endpoints.openai?.baseUrl, "https://ark.cn-beijing.volces.com/api/v3");
    assert.equal(openrouter?.endpoints.anthropic?.baseUrl, "https://openrouter.ai/api");
    assert.equal(novita?.endpoints.anthropic?.baseUrl, "https://api.novita.ai/anthropic");
    assert.ok(catalog.every((provider) => provider.source === "verified"));
  });

  it("marks API presets as dynamic with a live models endpoint and keeps static-only presets static", () => {
    const catalog = getProviderCatalog();
    const dynamicModelsUrl = new Map<string, string>([
      ["kimi-api", "https://api.moonshot.cn/v1/models"],
      ["zai-glm-api", "https://api.z.ai/api/paas/v4/models"],
      ["baidu-qianfan-coding-plan", "https://qianfan.baidubce.com/v2/models"],
      ["stepfun-coding-plan-cn", "https://api.stepfun.com/v1/models"],
      ["stepfun-coding-plan-intl", "https://api.stepfun.ai/v1/models"],
      ["modelscope-api", "https://api-inference.modelscope.cn/v1/models"],
      ["siliconflow-api", "https://api.siliconflow.cn/v1/models"],
      ["siliconflow-intl", "https://api.siliconflow.com/v1/models"],
      ["volcengine-agent-plan-cn", "https://ark.cn-beijing.volces.com/api/coding/v1/models"],
      ["volcengine-agent-plan-intl", "https://ark.ap-southeast.bytepluses.com/api/coding/v1/models"],
      ["volcengine-ark-api-cn", "https://ark.cn-beijing.volces.com/api/v3/models"],
      ["openrouter-api", "https://openrouter.ai/api/v1/models"]
    ]);

    for (const [id, modelsUrl] of dynamicModelsUrl) {
      const preset = catalog.find((provider) => provider.id === id);
      assert.ok(preset, `missing verified preset ${id}`);
      assert.equal(preset.modelSource, "dynamic", `${id} must use the live models endpoint`);
      assert.equal(preset.modelFetch?.strategy, "openai-compatible");
      assert.equal(preset.modelFetch?.modelsUrl, modelsUrl);
      assert.ok(
        preset.baseUrl.length > 0 || preset.endpoints.anthropic?.baseUrl || preset.endpoints.openai?.baseUrl,
        `${id} needs at least one endpoint`
      );
    }

    const novita = catalog.find((provider) => provider.id === "novita-api");
    assert.ok(novita);
    assert.equal(novita.modelSource, "static", "novita has no /models endpoint; keep static");
    assert.equal(novita.modelFetch, undefined);
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

  it("keeps distinct models.dev providers that share an endpoint with a verified provider", async () => {
    const catalog = await loadProviderCatalog({
      fetchImpl: async () => new Response(JSON.stringify({
        deepseek: {
          id: "deepseek",
          name: "DeepSeek",
          env: ["DEEPSEEK_API_KEY"],
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.deepseek.com",
          models: {
            "deepseek-chat": {
              id: "deepseek-chat",
              name: "DeepSeek Chat",
              release_date: "2026-01-01",
              attachment: false,
              reasoning: false,
              temperature: true,
              tool_call: true,
              limit: { context: 64000, output: 8192 }
            }
          }
        }
      }), { status: 200 })
    });

    assert.ok(catalog.some((provider) => provider.id === "deepseek-api" && provider.source === "verified"));
    assert.ok(catalog.some((provider) => provider.id === "deepseek" && provider.source === "models.dev"));
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
