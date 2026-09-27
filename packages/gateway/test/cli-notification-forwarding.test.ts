import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ensureCodexNotificationSettings } from "../src/services/cli-notification-settings.js";

async function withForwarder(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (script: string, gatewayUrl: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "fb-notification-forwarding-"));
  const server = createServer(handler);
  try {
    await ensureCodexNotificationSettings(root);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await run(path.join(root, ".codex/hooks/forgebadger-notify.mjs"), `http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

async function forward(script: string, gatewayUrl: string, sessionId: string) {
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      FORGEBADGER_GATEWAY_URL: gatewayUrl,
      FORGEBADGER_SESSION_ID: sessionId,
      FORGEBADGER_ATTACH_TOKEN: `test-token-${sessionId}`
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  // Codex's own session_id differs from ForgeBadger's terminal session id.
  child.stdin.end(JSON.stringify({ hook_event_name: "Stop", session_id: "codex-thread-id" }));
  const [code] = await once(child, "close");
  return { code, output };
}

describe("generated CLI notification forwarding", () => {
  it("keeps concurrent sessions in one project independently authenticated", async () => {
    const requests: Array<{ url?: string; id: string | string[] | undefined; token: string | string[] | undefined }> = [];
    await withForwarder((req, res) => {
      requests.push({ url: req.url, id: req.headers["x-forgebadger-session-id"], token: req.headers["x-forgebadger-session-token"] });
      req.resume();
      res.writeHead(200).end('{"code":0}');
    }, async (script, url) => {
      const results = await Promise.all([forward(script, url, "a"), forward(script, url, "b")]);
      assert.deepEqual(results, [{ code: 0, output: "" }, { code: 0, output: "" }]);
      assert.deepEqual(requests.sort((a, b) => String(a.id).localeCompare(String(b.id))), [
        { url: "/api/v1/session-hooks/claude-notification/a", id: "a", token: "test-token-a" },
        { url: "/api/v1/session-hooks/claude-notification/b", id: "b", token: "test-token-b" }
      ]);
    });
  });

  it("reports rejected identities without failing the CLI or exposing credentials", async () => {
    await withForwarder((req, res) => {
      req.resume();
      res.writeHead(401).end("sensitive-response-body");
    }, async (script, url) => {
      const result = await forward(script, url, "deleted-session");
      assert.equal(result.code, 0);
      assert.match(result.output, /HTTP 401/);
      assert.match(result.output, /restart.*CLI session/i);
      assert.doesNotMatch(result.output, /test-token|sensitive-response-body|deleted-session/);
    });
  });

  it("reports server failures without exposing the response body", async () => {
    await withForwarder((req, res) => {
      req.resume();
      res.writeHead(503).end("sensitive-response-body");
    }, async (script, url) => {
      const result = await forward(script, url, "a");
      assert.equal(result.code, 0);
      assert.match(result.output, /HTTP 503/);
      assert.doesNotMatch(result.output, /test-token|sensitive-response-body/);
    });
  });

  it("reports transport errors safely and no-ops outside a ForgeBadger session", async () => {
    let requests = 0;
    await withForwarder((_req, res) => { requests++; res.end(); }, async (script, url) => {
      const result = await forward(script, "invalid-url-with-private-data", "a");
      assert.equal(result.code, 0);
      assert.match(result.output, /could not reach Gateway/);
      assert.doesNotMatch(result.output, /private-data|test-token/);
      assert.deepEqual(await forward(script, url, ""), { code: 0, output: "" });
      assert.equal(requests, 0);
    });
  });
});
