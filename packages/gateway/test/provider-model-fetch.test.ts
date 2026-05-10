import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProviderModelsUrlCandidates,
  fetchProviderModels,
} from "../src/services/provider-model-fetch.js";

const publicHostResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("provider model fetch", () => {
  it("builds candidates for Anthropic-compatible coding plan endpoints", () => {
    const candidates = buildProviderModelsUrlCandidates(
      "https://coding.dashscope.aliyuncs.com/apps/anthropic"
    );

    assert.deepEqual(candidates, [
      "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1/models",
      "https://coding.dashscope.aliyuncs.com/v1/models",
      "https://coding.dashscope.aliyuncs.com/models",
    ]);
  });

  it("uses a configured models endpoint before derived candidates", () => {
    const candidates = buildProviderModelsUrlCandidates(
      "https://api.deepseek.com/anthropic",
      "https://api.deepseek.com/models"
    );

    assert.deepEqual(candidates, ["https://api.deepseek.com/models"]);
  });

  it("fetches OpenAI-compatible model lists with bearer auth and sorted ids", async () => {
    const requested: Array<{ url: string; authorization: string | undefined }> = [];
    const models = await fetchProviderModels({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        requested.push({ url: String(url), authorization: headers.get("authorization") ?? undefined });
        return new Response(JSON.stringify({
          data: [
            { id: "z-model", owned_by: "vendor" },
            { id: "a-model" },
          ],
        }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.deepEqual(requested, [
      { url: "https://api.example.com/v1/models", authorization: "Bearer sk-test" },
    ]);
    assert.deepEqual(models, [
      { id: "a-model", ownedBy: null },
      { id: "z-model", ownedBy: "vendor" },
    ]);
  });

  it("rejects private or non-https model endpoints before fetching", async () => {
    let fetchCalled = false;

    await assert.rejects(
      () => fetchProviderModels({
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "local",
        fetchImpl: async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        },
        resolveHost: publicHostResolver,
      }),
      /Only https protocol is allowed/
    );

    assert.equal(fetchCalled, false);
  });
});
