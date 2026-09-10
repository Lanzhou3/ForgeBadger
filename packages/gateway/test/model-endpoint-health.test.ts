import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkModelEndpoint } from "../src/services/model-endpoint-health.js";

const publicHostResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("checkModelEndpoint", () => {
  it("reports latency and status for reachable endpoints", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://api.example.com",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: publicHostResolver,
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
      resolveHost: publicHostResolver,
      now: () => 10,
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Request timed out");
  });

  it("blocks non-https protocols", async () => {
    const result = await checkModelEndpoint({
      endpoint: "ftp://example.com",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 })
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Only https protocol is allowed");
  });

  it("blocks malformed URLs without fetching", async () => {
    let fetchCalled = false;
    const result = await checkModelEndpoint({
      endpoint: "://bad-url",
      timeoutMs: 100,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("ok", { status: 200 });
      }
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Invalid endpoint URL");
    assert.equal(fetchCalled, false);
  });

  it("blocks localhost-style hosts", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://localhost",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: publicHostResolver
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Loopback addresses are not allowed");
  });

  it("does not fetch for http scheme endpoints", async () => {
    let fetchCalled = false;
    const result = await checkModelEndpoint({
      endpoint: "http://api.example.com",
      timeoutMs: 100,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("ok", { status: 200 });
      },
      resolveHost: publicHostResolver
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Only https protocol is allowed");
    assert.equal(fetchCalled, false);
  });

  it("allows an http endpoint when allowPlaintextHttp is set and the host is public", async () => {
    let fetchCalled = false;
    const result = await checkModelEndpoint({
      endpoint: "http://api.example.com",
      timeoutMs: 100,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("ok", { status: 200 });
      },
      resolveHost: publicHostResolver,
      allowPlaintextHttp: true
    });

    assert.equal(result.healthy, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.error, undefined);
    assert.equal(fetchCalled, true);
  });

  it("still blocks private IPv4 endpoints even when allowPlaintextHttp is set", async () => {
    let fetchCalled = false;
    const result = await checkModelEndpoint({
      endpoint: "http://192.168.1.10",
      timeoutMs: 100,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("ok", { status: 200 });
      },
      resolveHost: publicHostResolver,
      allowPlaintextHttp: true
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Private or loopback network addresses are not allowed");
    assert.equal(fetchCalled, false);
  });

  it("still blocks metadata hosts even when allowPlaintextHttp is set", async () => {
    let fetchCalled = false;
    const result = await checkModelEndpoint({
      endpoint: "http://metadata.google.internal",
      timeoutMs: 100,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("ok", { status: 200 });
      },
      resolveHost: publicHostResolver,
      allowPlaintextHttp: true
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Metadata hostnames are not allowed");
    assert.equal(fetchCalled, false);
  });

  it("still blocks DNS-resolved private targets even when allowPlaintextHttp is set", async () => {
    let fetchCalled = false;
    const result = await checkModelEndpoint({
      endpoint: "http://example.internal",
      timeoutMs: 100,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("ok", { status: 200 });
      },
      resolveHost: async () => [{ address: "10.0.0.12", family: 4 }],
      allowPlaintextHttp: true
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Private or loopback network addresses are not allowed");
    assert.equal(fetchCalled, false);
  });

  it("still blocks non-http(s) protocols even when allowPlaintextHttp is set", async () => {
    let fetchCalled = false;
    const result = await checkModelEndpoint({
      endpoint: "ftp://example.com",
      timeoutMs: 100,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("ok", { status: 200 });
      },
      resolveHost: publicHostResolver,
      allowPlaintextHttp: true
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Only https protocol is allowed");
    assert.equal(fetchCalled, false);
  });

  it("blocks private IPv4 network endpoints", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://192.168.1.10",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: publicHostResolver
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Private or loopback network addresses are not allowed");
  });

  it("blocks metadata hosts", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://metadata.google.internal",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: publicHostResolver
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Metadata hostnames are not allowed");
  });

  it("uses DNS resolution results to block private IP targets", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://example.internal",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: async (hostname) => {
        assert.equal(hostname, "example.internal");
        return [{ address: "10.0.0.12", family: 4 }];
      }
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Private or loopback network addresses are not allowed");
  });

  it("allows proxy fake-ip addresses (198.18.0.0/15) so Surge/Clash-style proxies keep working", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://api.provider.test/v1/models",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: async (hostname) => {
        assert.equal(hostname, "api.provider.test");
        return [{ address: "198.18.0.123", family: 4 }];
      }
    });

    assert.equal(result.healthy, true);
    assert.equal(result.error, undefined);
  });

  it("returns a helpful error when host cannot be resolved", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://unknown.local",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: async () => {
        throw new Error("DNS lookup failed");
      }
    });

    assert.equal(result.healthy, false);
    assert.equal(result.error, "Unable to resolve endpoint host");
  });

  it("blocks IPv4-mapped IPv6 (::ffff:7f00:1 => 127.0.0.1)", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://[::ffff:7f00:1]/",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: publicHostResolver
    });
    assert.equal(result.healthy, false);
    assert.equal(result.error, "Private or loopback network addresses are not allowed");
  });

  it("blocks NAT64 prefix (64:ff9b::7f00:1 => 127.0.0.1)", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://[64:ff9b::7f00:1]/",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: publicHostResolver
    });
    assert.equal(result.healthy, false);
    assert.equal(result.error, "Private or loopback network addresses are not allowed");
  });

  it("blocks IPv4-mapped cloud metadata (::ffff:a9fe:a9fe => 169.254.169.254)", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://[::ffff:a9fe:a9fe]/",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: publicHostResolver
    });
    assert.equal(result.healthy, false);
    assert.equal(result.error, "Private or loopback network addresses are not allowed");
  });

  it("allows a public IPv6 address", async () => {
    const result = await checkModelEndpoint({
      endpoint: "https://[2606:4700:4700::1111]/",
      timeoutMs: 100,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      resolveHost: publicHostResolver
    });
    assert.equal(result.healthy, true);
    assert.equal(result.statusCode, 200);
  });
});
