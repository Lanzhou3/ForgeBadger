import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";

import { BridgeApiError, BridgeClient } from "../src/bridge-client.js";

/** One recorded stub-server request. */
interface RecordedRequest {
  method: string;
  url: string;
  authorization?: string;
  userId?: string;
  body: string;
}

/** Scripted stub response. */
interface StubReply {
  status?: number;
  /** Raw body text; defaults to a success envelope echoing `echo`. */
  raw?: string;
  /** Payload placed under envelope `data`. */
  data?: unknown;
  /** Error envelope fields; forces `code: 1`. */
  error?: { message: string; details?: unknown };
  /** Never respond (timeout testing). */
  hang?: boolean;
}

const servers: Server[] = [];

/** Start a stub Gateway on an ephemeral port; returns its base URL and the request log. */
async function startStub(reply: StubReply): Promise<{ url: string; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        ...(req.headers.authorization !== undefined ? { authorization: req.headers.authorization } : {}),
        ...(req.headers["x-forgebadger-user-id"] !== undefined
          ? { userId: String(req.headers["x-forgebadger-user-id"]) } : {}),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (reply.hang === true) return;
      const body = reply.raw ?? JSON.stringify(reply.error !== undefined
        ? { code: 1, message: reply.error.message, details: reply.error.details ?? {} }
        : { code: 0, data: reply.data ?? null, message: "" });
      res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      res.end(body);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests };
}

afterEach(() => {
  while (servers.length > 0) servers.pop()?.close();
});

function clientFor(url: string, timeoutMs = 2000): BridgeClient {
  return new BridgeClient({ gatewayUrl: url, token: "token-x", userId: "user-x", timeoutMs });
}

describe("BridgeClient", () => {
  it("carries auth and tenant headers plus query mapping on listWorkItems", async () => {
    const stub = await startStub({ data: { workItems: [{ id: "WI-1" }], count: 1 } });
    const client = clientFor(stub.url);
    const data = await client.listWorkItems({ projectId: "proj/1", status: "pending" });
    assert.deepEqual(data, [{ id: "WI-1" }]);
    const req = stub.requests[0];
    assert.ok(req);
    assert.equal(req.method, "GET");
    assert.equal(req.authorization, "Bearer token-x");
    assert.equal(req.userId, "user-x");
    const url = new URL(req.url, stub.url);
    assert.equal(url.pathname, "/api/internal/v1/copilot-bridge/work-items");
    assert.equal(url.searchParams.get("projectId"), "proj/1");
    assert.equal(url.searchParams.get("status"), "pending");
  });

  it("omits empty query values", async () => {
    const stub = await startStub({ data: { workItems: [], count: 0 } });
    await clientFor(stub.url).listWorkItems({});
    const url = new URL(stub.requests[0]?.url ?? "", stub.url);
    assert.equal([...url.searchParams.keys()].length, 0);
  });

  it("maps advanceWorkItem to POST /work-items/:id/advance with a note body and encodes the id", async () => {
    const stub = await startStub({ data: { ok: true } });
    const data = await clientFor(stub.url).advanceWorkItem("WI/1001", "开工");
    assert.deepEqual(data, { ok: true });
    const req = stub.requests[0];
    assert.equal(req?.method, "POST");
    const url = new URL(req?.url ?? "", stub.url);
    assert.equal(url.pathname, "/api/internal/v1/copilot-bridge/work-items/WI%2F1001/advance");
    assert.deepEqual(JSON.parse(req?.body ?? ""), { note: "开工" });
  });

  it("sends an empty JSON object when advanceWorkItem has no note", async () => {
    const stub = await startStub({ data: {} });
    await clientFor(stub.url).advanceWorkItem("WI-1");
    assert.deepEqual(JSON.parse(stub.requests[0]?.body ?? ""), {});
  });

  it("maps dispatchToSession to POST /sessions/:id/dispatch with a message body", async () => {
    const stub = await startStub({ data: { dispatchId: "d-1" } });
    await clientFor(stub.url).dispatchToSession("sess-1", "处理 WI-1001");
    const req = stub.requests[0];
    assert.equal(req?.method, "POST");
    const url = new URL(req?.url ?? "", stub.url);
    assert.equal(url.pathname, "/api/internal/v1/copilot-bridge/sessions/sess-1/dispatch");
    assert.deepEqual(JSON.parse(req?.body ?? ""), { message: "处理 WI-1001" });
  });

  it("propagates the envelope error message and details", async () => {
    const stub = await startStub({ error: { message: "work item not found", details: { id: "WI-x" } } });
    await assert.rejects(
      clientFor(stub.url).advanceWorkItem("WI-x"),
      (error: unknown) => {
        assert.ok(error instanceof BridgeApiError);
        assert.equal(error.message, "work item not found");
        assert.deepEqual(error.details, { id: "WI-x" });
        return true;
      },
    );
  });

  it("rejects non-JSON responses with the HTTP status", async () => {
    const stub = await startStub({ status: 502, raw: "<html>bad gateway</html>" });
    await assert.rejects(clientFor(stub.url).listSessions(), /non-JSON response \(HTTP 502\)/);
  });

  it("times out a hung request with a clear message", async () => {
    const stub = await startStub({ hang: true });
    await assert.rejects(
      clientFor(stub.url, 100).listSessions(),
      /timed out after 100ms/,
    );
  });
});
