import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkModelEndpoint } from "../src/services/model-endpoint-health.js";

describe("checkModelEndpoint", () => {
  it("reports latency and status for reachable endpoints", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://api.example.com",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      now: (() => {
        const values = [10, 42];
        return () => values.shift() ?? 42;
      })(),
    });

    assert.equal(result.healthy, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.latencyMs, 32);
  });

  it("reports timeout failures without throwing", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://api.example.com",
      timeoutMs: 1,
      fetchImpl: async () => {
        throw new DOMException("timed out", "AbortError");
      },
      now: () => 10,
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Request timed out");
  });
});
