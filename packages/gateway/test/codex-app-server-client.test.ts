import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CodexAppServerJsonRpcClient,
  type CodexAppServerTransport,
  createCodexAppServerInitializeRequest,
  createCodexAppServerNotificationEvent,
  createCodexAppServerRequestEnvelope,
  createCodexAppServerThreadStartRequest,
  createCodexAppServerTurnStartRequest,
  parseCodexAppServerFrame,
  normalizeCodexAppServerNotification
} from "../src/services/codex-app-server-client.js";

describe("Codex app-server client helpers", () => {
  it("builds typed JSON-RPC request envelopes", () => {
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
        jsonrpc: "2.0",
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
        jsonrpc: "2.0",
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
        sandbox: "workspaceWrite"
      }),
      {
        jsonrpc: "2.0",
        id: "req-1",
        method: "thread/start",
        params: {
          cwd: "/workspace/app",
          model: "gpt-5.4",
          approvalPolicy: "on-request",
          sandbox: "workspaceWrite",
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
        jsonrpc: "2.0",
        id: 9,
        method: "turn/start",
        params: {
          threadId: "thr_123",
          input: [{ type: "text", text: "Summarize this repo." }]
        }
      }
    );
  });

  it("parses responses and notifications with schema validation", () => {
    assert.deepEqual(
      parseCodexAppServerFrame(
        JSON.stringify({
          jsonrpc: "2.0",
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
          jsonrpc: "2.0",
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
        jsonrpc: "2.0",
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
        jsonrpc: "2.0",
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
        jsonrpc: "2.0",
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
});

class FakeTransport implements CodexAppServerTransport {
  sent: string[] = [];
  private messageHandler: ((raw: string | Buffer) => void) | undefined;
  private closeHandler: ((code?: number, reason?: string) => void) | undefined;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
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
