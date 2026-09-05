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

  it("builds candidates for generic version-segment base URLs", () => {
    const paas = buildProviderModelsUrlCandidates("https://api.z.ai/api/paas/v4");
    const v1 = buildProviderModelsUrlCandidates("https://api.example.com/v1");
    const plain = buildProviderModelsUrlCandidates("https://api.example.com");

    assert.deepEqual(paas, [
      "https://api.z.ai/api/paas/v4/models",
      "https://api.z.ai/api/paas/v4/v1/models",
    ]);
    assert.deepEqual(v1, ["https://api.example.com/v1/models"]);
    assert.deepEqual(plain, ["https://api.example.com/v1/models"]);
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
      { id: "a-model", ownedBy: null, contextWindow: null },
      { id: "z-model", ownedBy: "vendor", contextWindow: null },
    ]);
  });

  it("captures context window fields reported by the provider", async () => {
    const models = await fetchProviderModels({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      fetchImpl: async () => new Response(JSON.stringify({
        data: [
          { id: "openrouter-style", context_length: 1048576 },
          { id: "string-number", context_window: "262144" },
          { id: "alt-field", max_context_length: 131072 },
          { id: "no-context" },
          { id: "bogus", context_length: "lots" },
        ],
      }), { status: 200 }),
      resolveHost: publicHostResolver,
    });

    assert.deepEqual(models, [
      { id: "alt-field", ownedBy: null, contextWindow: 131072 },
      { id: "bogus", ownedBy: null, contextWindow: null },
      { id: "no-context", ownedBy: null, contextWindow: null },
      { id: "openrouter-style", ownedBy: null, contextWindow: 1048576 },
      { id: "string-number", ownedBy: null, contextWindow: 262144 },
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

  it("uses x-api-key auth and follows has_more pagination for anthropic providers", async () => {
    const requested: Array<{ url: string; headers: Record<string, string | null> }> = [];
    const models = await fetchProviderModels({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant-test",
      apiFormat: "anthropic",
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        requested.push({
          url: String(url),
          headers: {
            authorization: headers.get("authorization"),
            "x-api-key": headers.get("x-api-key"),
            "anthropic-version": headers.get("anthropic-version"),
          },
        });
        const page = requested.length;
        const payload = page === 1
          ? { data: [{ id: "b-model" }, { id: "a-model" }], has_more: true, last_id: "b-model" }
          : { data: [{ id: "b-model" }, { id: "c-model" }], has_more: false };
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.equal(requested.length, 2);
    assert.equal(requested[0]?.url, "https://api.anthropic.com/v1/models?limit=1000");
    assert.equal(requested[1]?.url, "https://api.anthropic.com/v1/models?limit=1000&after_id=b-model");
    for (const request of requested) {
      assert.equal(request.headers.authorization, null);
      assert.equal(request.headers["x-api-key"], "sk-ant-test");
      assert.equal(request.headers["anthropic-version"], "2023-06-01");
    }
    assert.deepEqual(models, [
      { id: "a-model", ownedBy: null, contextWindow: null },
      { id: "b-model", ownedBy: null, contextWindow: null },
      { id: "c-model", ownedBy: null, contextWindow: null },
    ]);
  });

  it("uses x-goog-api-key auth for google providers", async () => {
    const requested: Array<{ authorization: string | null; googKey: string | null }> = [];
    const models = await fetchProviderModels({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "goog-key",
      apiFormat: "google",
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        requested.push({
          authorization: headers.get("authorization"),
          googKey: headers.get("x-goog-api-key"),
        });
        return new Response(JSON.stringify({ data: [{ id: "gemini-test" }] }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.deepEqual(requested, [{ authorization: null, googKey: "goog-key" }]);
    assert.deepEqual(models, [{ id: "gemini-test", ownedBy: null, contextWindow: null }]);
  });

  it("merges default headers but drops sensitive ones and keeps credential auth last", async () => {
    const requested: Array<Record<string, string | null>> = [];
    await fetchProviderModels({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-real",
      defaultHeaders: {
        "x-tenant": "tenant-a",
        Authorization: "Bearer injected",
        "X-Api-Key": "injected",
      },
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        requested.push({
          authorization: headers.get("authorization"),
          tenant: headers.get("x-tenant"),
          apiKey: headers.get("x-api-key"),
        });
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.deepEqual(requested, [{
      authorization: "Bearer sk-real",
      tenant: "tenant-a",
      apiKey: null,
    }]);
  });

  it("redacts credentials from HTTP and transport error messages", async () => {
    await assert.rejects(
      () => fetchProviderModels({
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-http-leaked123",
        fetchImpl: async () => new Response(
          "invalid key sk-http-leaked123 presented as Bearer sk-http-leaked123",
          { status: 401 }
        ),
        resolveHost: publicHostResolver,
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /HTTP 401/);
        assert.match(message, /\[REDACTED\]/);
        assert.equal(message.includes("sk-http-leaked123"), false);
        return true;
      }
    );

    await assert.rejects(
      () => fetchProviderModels({
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-transport-leaked123",
        fetchImpl: async () => {
          throw new Error("connect failed for sk-transport-leaked123");
        },
        resolveHost: publicHostResolver,
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.equal(message.includes("sk-transport-leaked123"), false);
        assert.match(message, /\[REDACTED\]/);
        return true;
      }
    );
  });
});
