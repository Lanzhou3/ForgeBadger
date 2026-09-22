import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { it } from "node:test";
import { createAgentPublicFetch } from "../src/services/agent/llm-public-fetch.js";

function transport(status = 200) {
  const calls: Array<{ url: URL; options: RequestOptions }> = [];
  const requestImpl = ((url: URL, options: RequestOptions) => {
    calls.push({ url, options });
    const req = new EventEmitter() as ClientRequest;
    req.end = (() => {
      queueMicrotask(() => {
        const res = Readable.from([Buffer.from("data: [DONE]\n\n")]) as IncomingMessage;
        res.statusCode = status; res.headers = { "content-type": "text/event-stream" };
        req.emit("response", res);
      });
      return req;
    }) as ClientRequest["end"];
    req.destroy = (() => req) as ClientRequest["destroy"];
    return req;
  }) as typeof import("node:https").request;
  return { calls, requestImpl };
}

it("pins the actual request lookup to the one validated DNS answer", async () => {
  let lookups = 0;
  const { requestImpl, calls } = transport();
  const fetchImpl = createAgentPublicFetch({ requestImpl,
    resolveHost: async () => { lookups++; return [{ address: lookups === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }]; } });
  const response = await fetchImpl("https://api.example.com/chat/completions", { method: "POST", body: "{}" });
  assert.equal(await response.text(), "data: [DONE]\n\n");
  assert.equal(lookups, 1);
  assert.equal(calls[0]!.options.agent, false);
  const address = await new Promise<string>((resolve, reject) => {
    calls[0]!.options.lookup!("api.example.com", { all: false }, (error, addresses) => error ? reject(error) : resolve(addresses as unknown as string));
  });
  assert.equal(address, "8.8.8.8");
});

it("rejects private DNS answers before sending any credential-bearing request", async () => {
  const { requestImpl, calls } = transport();
  const fetchImpl = createAgentPublicFetch({ requestImpl, resolveHost: async () => [{ address: "127.0.0.1", family: 4 }] });
  await assert.rejects(fetchImpl("https://api.example.com/chat/completions"), { code: "AGENT_HOST_BLOCKED" });
  assert.equal(calls.length, 0);
});

it("rejects redirects instead of forwarding authorization", async () => {
  const { requestImpl, calls } = transport(302);
  const fetchImpl = createAgentPublicFetch({ requestImpl, resolveHost: async () => [{ address: "8.8.8.8", family: 4 }] });
  await assert.rejects(fetchImpl("https://api.example.com/chat/completions"), /redirect/i);
  assert.equal(calls.length, 1);
});

it("allows HTTP only with the saved provider trust setting", async () => {
  const { requestImpl, calls } = transport();
  const resolveHost = async () => [{ address: "8.8.8.8", family: 4 }];
  await assert.rejects(createAgentPublicFetch({ requestImpl, resolveHost })("http://api.example.com/chat/completions"), { code: "AGENT_HOST_BLOCKED" });
  assert.equal(calls.length, 0);
  const response = await createAgentPublicFetch({ requestImpl, resolveHost, allowPlaintextHttp: true })("http://api.example.com/chat/completions");
  await response.text();
  assert.equal(calls.length, 1);
});
