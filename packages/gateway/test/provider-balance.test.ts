import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchProviderBalance } from "../src/services/provider-balance.js";

const publicHostResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const privateHostResolver = async () => [{ address: "127.0.0.1", family: 4 }];

describe("provider balance fetch", () => {
  it("parses DeepSeek balance infos including string numbers", async () => {
    const requested: Array<{ url: string; authorization: string | null }> = [];
    const result = await fetchProviderBalance({
      baseUrls: ["https://api.deepseek.com", "https://api.deepseek.com/anthropic"],
      apiKey: "sk-deepseek",
      fetchImpl: async (url, init) => {
        requested.push({
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return new Response(JSON.stringify({
          is_available: true,
          balance_infos: [
            { currency: "CNY", total_balance: "12.34" },
            { currency: "USD", total_balance: 5 },
          ],
        }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.deepEqual(requested, [{
      url: "https://api.deepseek.com/user/balance",
      authorization: "Bearer sk-deepseek",
    }]);
    assert.equal(result.supported, true);
    assert.equal(result.detectedProvider, "deepseek");
    assert.deepEqual(result.balances, [
      { label: "CNY", remaining: 12.34, unit: "CNY", isAvailable: true },
      { label: "USD", remaining: 5, unit: "USD", isAvailable: true },
    ]);
  });

  it("parses StepFun account balance in CNY", async () => {
    const requestedUrls: string[] = [];
    const result = await fetchProviderBalance({
      baseUrls: ["https://api.stepfun.com/v1"],
      apiKey: "sk-stepfun",
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({ balance: "8.5" }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.deepEqual(requestedUrls, ["https://api.stepfun.com/v1/accounts"]);
    assert.equal(result.supported, true);
    assert.equal(result.detectedProvider, "stepfun");
    assert.deepEqual(result.balances, [{ label: "StepFun", remaining: 8.5, unit: "CNY" }]);
  });

  it("parses SiliconFlow total balance and honors the currency field", async () => {
    const cnResult = await fetchProviderBalance({
      baseUrls: ["https://api.siliconflow.cn/v1"],
      apiKey: "sk-sf",
      fetchImpl: async (url) => {
        assert.equal(String(url), "https://api.siliconflow.cn/v1/user/info");
        return new Response(JSON.stringify({ code: 0, data: { totalBalance: "3.21" } }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });
    const enResult = await fetchProviderBalance({
      baseUrls: ["https://api.siliconflow.com/v1"],
      apiKey: "sk-sf",
      fetchImpl: async (url) => {
        assert.equal(String(url), "https://api.siliconflow.com/v1/user/info");
        return new Response(JSON.stringify({ code: 0, data: { totalBalance: 2, currency: "USD" } }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.equal(cnResult.detectedProvider, "siliconflow");
    assert.deepEqual(cnResult.balances, [{ label: "SiliconFlow", remaining: 3.21, unit: "CNY" }]);
    assert.deepEqual(enResult.balances, [{ label: "SiliconFlow", remaining: 2, unit: "USD" }]);
  });

  it("parses OpenRouter credits as total_credits minus total_usage", async () => {
    const requestedUrls: string[] = [];
    const result = await fetchProviderBalance({
      baseUrls: ["https://openrouter.ai/api/v1"],
      apiKey: "sk-or",
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({
          data: { total_credits: 10, total_usage: "2.5" },
        }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.deepEqual(requestedUrls, ["https://openrouter.ai/api/v1/credits"]);
    assert.equal(result.detectedProvider, "openrouter");
    assert.deepEqual(result.balances, [
      { label: "OpenRouter", remaining: 7.5, unit: "USD", isAvailable: true },
    ]);
  });

  it("parses Novita balance scaled from 0.0001 USD units", async () => {
    const requestedUrls: string[] = [];
    const result = await fetchProviderBalance({
      baseUrls: ["https://api.novita.ai/v3"],
      apiKey: "sk-novita",
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({ availableBalance: 123456 }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.deepEqual(requestedUrls, ["https://api.novita.ai/v3/user/balance"]);
    assert.equal(result.detectedProvider, "novita");
    assert.deepEqual(result.balances, [
      { label: "Novita AI", remaining: 12.3456, unit: "USD", isAvailable: true },
    ]);
  });

  it("detects providers from the openai base URL before the generic base URL", async () => {
    const result = await fetchProviderBalance({
      baseUrls: ["https://openrouter.ai/api/v1", "https://api.deepseek.com"],
      apiKey: "sk-or",
      fetchImpl: async (url) => {
        assert.equal(String(url), "https://openrouter.ai/api/v1/credits");
        return new Response(JSON.stringify({ data: { total_credits: 1, total_usage: 0 } }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.equal(result.detectedProvider, "openrouter");
  });

  it("returns supported:false for unknown providers without fetching", async () => {
    let fetchCalled = false;
    const result = await fetchProviderBalance({
      baseUrls: ["https://api.example.com/v1"],
      apiKey: "sk-x",
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("{}", { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.deepEqual(result, { supported: false, balances: [] });
    assert.equal(fetchCalled, false);
  });

  it("rejects endpoints that resolve to private addresses before fetching", async () => {
    let fetchCalled = false;
    await assert.rejects(
      () => fetchProviderBalance({
        baseUrls: ["https://api.deepseek.com"],
        apiKey: "sk-deepseek",
        fetchImpl: async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        },
        resolveHost: privateHostResolver,
      }),
      /not allowed/i
    );

    assert.equal(fetchCalled, false);
  });

  it("rejects non-https balance endpoints", async () => {
    await assert.rejects(
      () => fetchProviderBalance({
        baseUrls: ["http://api.deepseek.com"],
        apiKey: "sk-deepseek",
        fetchImpl: async () => new Response("{}", { status: 200 }),
        resolveHost: publicHostResolver,
      }),
      /Only https protocol is allowed/
    );
  });

  it("times out hung balance requests", async () => {
    await assert.rejects(
      () => fetchProviderBalance({
        baseUrls: ["https://api.deepseek.com"],
        apiKey: "sk-deepseek",
        timeoutMs: 50,
        fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
        resolveHost: publicHostResolver,
      }),
      /timed out/
    );
  });

  it("surfaces upstream 401 as a redacted error", async () => {
    await assert.rejects(
      () => fetchProviderBalance({
        baseUrls: ["https://api.deepseek.com"],
        apiKey: "sk-balance-leaked123",
        fetchImpl: async () => new Response(
          "unauthorized: sk-balance-leaked123",
          { status: 401 }
        ),
        resolveHost: publicHostResolver,
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /HTTP 401/);
        assert.equal(message.includes("sk-balance-leaked123"), false);
        assert.match(message, /\[REDACTED\]/);
        return true;
      }
    );
  });

  it("parses Kimi For Coding usage windows with string numbers", async () => {
    const requestedUrls: string[] = [];
    const result = await fetchProviderBalance({
      baseUrls: ["https://api.kimi.com/coding/v1", "https://api.kimi.com/coding/"],
      apiKey: "sk-kimi",
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({
          usage: { limit: "100", used: "18", remaining: "82", resetTime: "2026-09-08T07:43:24Z" },
          limits: [{
            window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
            detail: { limit: "100", used: "7", remaining: "93", resetTime: "2026-09-01T17:43:24Z" },
          }],
        }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.deepEqual(requestedUrls, ["https://api.kimi.com/coding/v1/usages"]);
    assert.equal(result.supported, true);
    assert.equal(result.detectedProvider, "kimi");
    assert.deepEqual(result.balances, [
      { label: "5h window", remaining: 93, unit: "requests", limit: 100, resetsAt: "2026-09-01T17:43:24Z" },
      { label: "Weekly window", remaining: 82, unit: "requests", limit: 100, resetsAt: "2026-09-08T07:43:24Z" },
    ]);
  });

  it("parses MiniMax coding plan remaining percentages for the general bucket only", async () => {
    const result = await fetchProviderBalance({
      baseUrls: ["https://api.minimaxi.com/v1"],
      apiKey: "sk-minimax",
      fetchImpl: async (url) => {
        assert.equal(String(url), "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains");
        return new Response(JSON.stringify({
          model_remains: [
            {
              model_name: "general",
              current_interval_remaining_percent: 85,
              end_time: 1788278400000,
              current_weekly_status: 1,
              current_weekly_remaining_percent: 79,
              weekly_end_time: 1788710400000,
            },
            { model_name: "video", current_interval_remaining_percent: 100, current_weekly_status: 3 },
          ],
          base_resp: { status_code: 0, status_msg: "success" },
        }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.equal(result.supported, true);
    assert.equal(result.detectedProvider, "minimax");
    assert.deepEqual(result.balances, [
      { label: "5h window", remaining: 85, unit: "%", resetsAt: new Date(1788278400000).toISOString() },
      { label: "Weekly window", remaining: 79, unit: "%", resetsAt: new Date(1788710400000).toISOString() },
    ]);
  });

  it("rejects MiniMax business errors carried in a 200 response", async () => {
    await assert.rejects(
      () => fetchProviderBalance({
        baseUrls: ["https://api.minimaxi.com/v1"],
        apiKey: "sk-minimax",
        fetchImpl: async () => new Response(JSON.stringify({
          base_resp: { status_code: 1004, status_msg: "login fail" },
        }), { status: 200 }),
        resolveHost: publicHostResolver,
      }),
      /code 1004/
    );
  });

  it("supports the MiniMax international host", async () => {
    const result = await fetchProviderBalance({
      baseUrls: ["https://api.minimax.io/v1"],
      apiKey: "sk-minimax",
      fetchImpl: async (url) => {
        assert.equal(String(url), "https://api.minimax.io/v1/api/openplatform/coding_plan/remains");
        return new Response(JSON.stringify({
          model_remains: [{ model_name: "general", current_interval_remaining_percent: 60, current_weekly_status: 3 }],
          base_resp: { status_code: 0, status_msg: "success" },
        }), { status: 200 });
      },
      resolveHost: publicHostResolver,
    });

    assert.equal(result.supported, true);
    assert.deepEqual(result.balances, [{ label: "5h window", remaining: 60, unit: "%" }]);
  });
});
