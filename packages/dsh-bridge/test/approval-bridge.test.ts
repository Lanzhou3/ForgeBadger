import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { Context } from "@deepseek-ai/cordis";
import type { JsonRpcTransportPeer } from "@deepseek-ai/dsh-sdk-protocol";
import type { ApprovalRequest } from "@deepseek-ai/dsh-user-approval";

import { registerApprovalBridge, setApprovalTransport } from "../src/approval-bridge.js";

type Handler = (...args: never[]) => unknown;

/** Capture the two event handlers the bridge registers. */
function captureCtx(): { ctx: Context; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const ctx = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
  } as unknown as Context;
  return { ctx, handlers };
}

function stubRequest(toolName: string, callId?: string): ApprovalRequest {
  return {
    agent: { session: { id: "dsh-sess-1" } },
    toolName,
    ...(callId !== undefined ? { callId } : {}),
  } as unknown as ApprovalRequest;
}

afterEach(() => {
  setApprovalTransport(undefined);
});

describe("registerApprovalBridge", () => {
  it("asks for approval on operate tools and passes read tools through", async () => {
    const { ctx, handlers } = captureCtx();
    registerApprovalBridge(ctx);
    const preExecute = handlers.get("tools/pre-execute");
    assert.ok(preExecute);

    for (const name of ["dispatch_task_to_session", "advance_work_item", "create_project", "write_memory"]) {
      const operate = await preExecute({ name, callId: `c-${name}`, arguments: { sessionId: "s" } }, async () => ({ kind: "allow" })) as { kind: string };
      assert.equal(operate.kind, "ask", `${name} must park on owner approval`);
    }
    for (const name of ["list_sessions", "list_projects", "search_memory", "portfolio_overview"]) {
      const read = await preExecute({ name, callId: `c-${name}`, arguments: {} }, async () => ({ kind: "allow" })) as { kind: string };
      assert.equal(read.kind, "allow", `${name} delegates to next()`);
    }
  });

  it("forwards the question with stashed args and maps the grant", async () => {
    const { ctx, handlers } = captureCtx();
    registerApprovalBridge(ctx);
    const seen: Array<{ method: string; params: Record<string, unknown> }> = [];
    setApprovalTransport({
      request: async (method: string, params: Record<string, unknown>) => {
        seen.push({ method, params });
        return { outcome: "allowed-once" };
      },
      notify: () => {},
    } as unknown as JsonRpcTransportPeer);

    await handlers.get("tools/pre-execute")!({ name: "advance_work_item", callId: "call-9", arguments: { id: "WI-1" } }, async () => ({ kind: "allow" }));
    const answerer = handlers.get("approval/request")!;
    const outcome = await answerer(stubRequest("advance_work_item", "call-9"), async () => "unavailable");

    assert.equal(outcome, "allowed-once");
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.method, "approval/decide");
    assert.deepEqual(seen[0]?.params.args, { id: "WI-1" });
    assert.equal(seen[0]?.params.sessionId, "dsh-sess-1");
    assert.equal(seen[0]?.params.toolName, "advance_work_item");
  });

  it("maps an explicit Gateway rejection to rejected", async () => {
    const { ctx, handlers } = captureCtx();
    registerApprovalBridge(ctx);
    setApprovalTransport({
      request: async () => ({ outcome: "rejected", reason: "Denied by security policy" }),
      notify: () => {},
    } as unknown as JsonRpcTransportPeer);
    const outcome = await handlers.get("approval/request")!(stubRequest("dispatch_task_to_session", "c1"), async () => "unavailable");
    assert.equal(outcome, "rejected");
  });

  it("fails closed without a transport or on transport errors", async () => {
    const { ctx, handlers } = captureCtx();
    registerApprovalBridge(ctx);
    const answerer = handlers.get("approval/request")!;

    // No transport at all.
    assert.equal(await answerer(stubRequest("dispatch_task_to_session", "c1"), async () => "unavailable"), "unavailable");

    // Transport whose request rejects.
    setApprovalTransport({
      request: async () => { throw new Error("peer gone"); },
      notify: () => {},
    } as unknown as JsonRpcTransportPeer);
    assert.equal(await answerer(stubRequest("dispatch_task_to_session", "c2"), async () => "unavailable"), "unavailable");

    // Rogue (non-vocabulary) response.
    setApprovalTransport({
      request: async () => ({ outcome: "sure-why-not" }),
      notify: () => {},
    } as unknown as JsonRpcTransportPeer);
    assert.equal(await answerer(stubRequest("dispatch_task_to_session", "c3"), async () => "unavailable"), "rejected");
  });

  it("delegates approval requests for non-operate tools to the next answerer", async () => {
    const { ctx, handlers } = captureCtx();
    registerApprovalBridge(ctx);
    setApprovalTransport({
      request: async () => ({ outcome: "allowed-once" }),
      notify: () => {},
    } as unknown as JsonRpcTransportPeer);
    const outcome = await handlers.get("approval/request")!(stubRequest("bash", "c1"), async () => "next-outcome");
    assert.equal(outcome, "next-outcome");
  });
});
