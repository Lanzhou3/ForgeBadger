import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CodexAppServerJsonRpcClient,
  type CodexAppServerTransport,
  createCodexAppServerInitializeRequest,
  createCodexAppServerInitializedNotification,
  createCodexAppServerNotificationEvent,
  createCodexAppServerRequestEnvelope,
  createCodexAppServerThreadStartRequest,
  createCodexAppServerTurnStartRequest,
  parseCodexAppServerFrame,
  normalizeCodexAppServerNotification
} from "../src/services/codex-app-server-client.js";

describe("Codex app-server client helpers", () => {
  it("builds typed Codex app-server request envelopes", () => {
    assert.deepEqual(
      createCodexAppServerRequestEnvelope({
        id: 7,
        method: "initialize",
        params: {
          clientInfo: {
            name: "openforge",
            title: "OpenForge",
            version: "0.0.0"
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: ["item/agentMessage/delta"]
          }
        }
      }),
      {
        id: 7,
        method: "initialize",
        params: {
          clientInfo: {
            name: "openforge",
            title: "OpenForge",
            version: "0.0.0"
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: ["item/agentMessage/delta"]
          }
        }
      }
    );

    assert.deepEqual(
      createCodexAppServerInitializeRequest({
        id: 8,
        clientVersion: "0.0.0"
      }),
      {
        id: 8,
        method: "initialize",
        params: {
          clientInfo: {
            name: "openforge",
            title: "OpenForge",
            version: "0.0.0"
          },
          capabilities: {
            experimentalApi: false,
            optOutNotificationMethods: []
          }
        }
      }
    );
  });

  it("builds thread and turn request envelopes", () => {
    assert.deepEqual(
      createCodexAppServerThreadStartRequest({
        id: "req-1",
        cwd: "/workspace/app",
        model: "gpt-5.4",
        approvalPolicy: "on-request",
        sandbox: "workspace-write"
      }),
      {
        id: "req-1",
        method: "thread/start",
        params: {
          cwd: "/workspace/app",
          model: "gpt-5.4",
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          serviceName: "openforge"
        }
      }
    );

    assert.deepEqual(
      createCodexAppServerTurnStartRequest({
        id: 9,
        threadId: "thr_123",
        text: "Summarize this repo."
      }),
      {
        id: 9,
        method: "turn/start",
        params: {
          threadId: "thr_123",
          input: [{ type: "text", text: "Summarize this repo.", text_elements: [] }]
        }
      }
    );
  });

  it("parses Codex response and notification envelopes with schema validation", () => {
    assert.deepEqual(
      parseCodexAppServerFrame(
        JSON.stringify({
          id: 1,
          result: { accepted: true }
        })
      ),
      {
        kind: "response",
        id: 1,
        result: { accepted: true }
      }
    );

    assert.deepEqual(
      parseCodexAppServerFrame(
        JSON.stringify({
          method: "item/agentMessage/delta",
          params: {
            threadId: "thr_123",
            notification: {
              type: "agentMessage/delta",
              text: "Hello"
            }
          }
        })
      ),
      {
        kind: "notification",
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_123",
          notification: {
            type: "agentMessage/delta",
            text: "Hello"
          }
        }
      }
    );

    assert.throws(
      () => parseCodexAppServerFrame(JSON.stringify({ jsonrpc: "2.0" })),
      /Malformed Codex app-server frame/
    );
  });

  it("normalizes permission prompts into internal activity shapes", () => {
    assert.deepEqual(
      normalizeCodexAppServerNotification({
        kind: "notification",
        method: "notification/prompt",
        params: {
          threadId: "thr_123",
          notification: {
            type: "permission_prompt",
            message: "Claude needs approval"
          }
        }
      }),
      {
        type: "codex_app_server_notification",
        method: "notification/prompt",
        threadId: "thr_123",
        activityType: "permission_prompt",
        status: "warning",
        message: "Claude needs approval"
      }
    );

    assert.deepEqual(
      createCodexAppServerNotificationEvent({
        threadId: "thr_123",
        notificationType: "permission_prompt",
        message: "Claude needs approval"
      }),
      {
        kind: "notification",
        method: "notification/prompt",
        params: {
          threadId: "thr_123",
          notification: {
            type: "permission_prompt",
            message: "Claude needs approval"
          }
        }
      }
    );
  });

  it("sends requests, resolves responses, and normalizes notifications", async () => {
    const transport = new FakeTransport();
    const notifications: unknown[] = [];
    const client = new CodexAppServerJsonRpcClient({
      transport,
      clientVersion: "0.0.0",
      onNotification: (notification) => notifications.push(notification)
    });

    const pending = client.startTurn({
      threadId: "thr_123",
      text: "Summarize this repo."
    });
    const sent = JSON.parse(transport.sent[0] ?? "{}") as { id: number };
    transport.emitMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: sent.id,
        result: { accepted: true }
      })
    );
    await assert.doesNotReject(pending);

    transport.emitMessage(
      JSON.stringify(
        createCodexAppServerNotificationEvent({
          threadId: "thr_123",
          notificationType: "permission_prompt",
          message: "Claude needs approval"
        })
      )
    );

    assert.equal(notifications.length, 1);
    assert.deepEqual(notifications[0], {
      type: "codex_app_server_notification",
      method: "notification/prompt",
      threadId: "thr_123",
      activityType: "permission_prompt",
      status: "warning",
      message: "Claude needs approval"
    });
  });

  it("acknowledges initialize with an initialized notification", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerJsonRpcClient({
      transport,
      clientVersion: "0.0.0"
    });

    const pending = client.initialize();
    const sent = JSON.parse(transport.sent[0] ?? "{}") as { id: number; method: string };
    assert.equal(sent.method, "initialize");
    transport.emitMessage(
      JSON.stringify({
        id: sent.id,
        result: {
          userAgent: "openforge/0.130.0",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "linux"
        }
      })
    );

    await assert.doesNotReject(pending);
    assert.deepEqual(JSON.parse(transport.sent[1] ?? "{}"), createCodexAppServerInitializedNotification());
  });

  it("rejects pending requests when the transport closes", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerJsonRpcClient({
      transport,
      clientVersion: "0.0.0",
      timeoutMs: 5
    });

    const pending = client.initialize();
    transport.emitClose();
    await assert.rejects(pending, /closed/i);
    client.close();
  });

  it("removes AbortSignal listeners after a request resolves", async () => {
    const transport = new FakeTransport();
    const signal = new CountingAbortSignal();
    const client = new CodexAppServerJsonRpcClient({
      transport,
      clientVersion: "0.0.0"
    });

    const pending = client.request("test/method", {}, signal as unknown as AbortSignal);
    const sent = JSON.parse(transport.sent[0] ?? "{}") as { id: number };
    transport.emitMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: sent.id,
        result: { ok: true }
      })
    );

    await assert.doesNotReject(pending);
    assert.equal(signal.added, 1);
    assert.equal(signal.removed, 1);
    client.close();
  });

  it("emits an error and closes the transport for malformed inbound frames", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerJsonRpcClient({
      transport,
      clientVersion: "0.0.0"
    });
    const errors: Error[] = [];
    client.on("error", (error) => errors.push(error));

    transport.emitMessage("{not-json");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(errors.length, 1);
    assert.match(errors[0]?.message ?? "", /Malformed Codex app-server frame/);
    assert.equal(transport.closedCode, 1002);
  });
});

class FakeTransport implements CodexAppServerTransport {
  sent: string[] = [];
  closedCode: number | undefined;
  private messageHandler: ((raw: string | Buffer) => void) | undefined;
  private closeHandler: ((code?: number, reason?: string) => void) | undefined;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedCode = code;
    this.closeHandler?.(code, reason);
  }

  onMessage(handler: (raw: string | Buffer) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (code?: number, reason?: string) => void): void {
    this.closeHandler = handler;
  }

  emitMessage(raw: string): void {
    this.messageHandler?.(raw);
  }

  emitClose(code?: number, reason?: string): void {
    this.closeHandler?.(code, reason);
  }
}

class CountingAbortSignal {
  readonly aborted = false;
  added = 0;
  removed = 0;
  private listener: (() => void) | undefined;

  addEventListener(_type: "abort", listener: () => void): void {
    this.added += 1;
    this.listener = listener;
  }

  removeEventListener(_type: "abort", listener: () => void): void {
    if (this.listener === listener) {
      this.removed += 1;
      this.listener = undefined;
    }
  }
}
