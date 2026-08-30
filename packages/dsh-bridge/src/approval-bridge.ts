/**
 * Approval bridge (M3): routes dsh approval questions for the ForgeBadger
 * operate tools to the Gateway over the stdio JSON-RPC transport.
 *
 * Pipeline inside the runtime:
 *   1. `tools/pre-execute` — the operate tools (advance_work_item,
 *      dispatch_task_to_session, create_project, write_memory) answer
 *      `{ kind: "ask" }`, which the tools
 *      runtime resolves through the approval service (`@deepseek-ai/dsh-user-approval`,
 *      composed in cordis.yml). The service appends the durable
 *      `approval/asked` / `approval/decided` audit pair to the session log.
 *   2. `approval/request` — this module's answerer forwards the question to
 *      the Gateway as a server->client `approval/decide` JSON-RPC request and
 *      awaits the owner's decision (pending action in the web console / Feishu).
 *   3. The Gateway's outcome maps back to an ApprovalOutcome; only
 *      `allowed-once` lets the tool body run.
 *
 * Fail-closed everywhere: a missing transport, a Gateway error response, or a
 * non-vocabulary outcome all resolve `unavailable`, which the approval service
 * turns into a denial.
 *
 * @module
 */

import type { Context } from "@deepseek-ai/cordis";
import type { JsonRpcTransportPeer } from "@deepseek-ai/dsh-sdk-protocol";
import type { ApprovalOutcome, ApprovalRequest } from "@deepseek-ai/dsh-user-approval";
import type { CallId } from "@deepseek-ai/dsh-llm";

/** Wire method of the server->client approval request the Gateway answers. */
export const APPROVAL_DECIDE_METHOD = "approval/decide";

/** Tools whose execution is gated behind owner approval. Mirrors plugin.ts. */
const OPERATE_TOOL_NAMES = new Set([
  "advance_work_item",
  "dispatch_task_to_session",
  "create_project",
  "write_memory",
]);

/** Response vocabulary the Gateway may return for {@link APPROVAL_DECIDE_METHOD}. */
interface DecideResponse {
  outcome?: unknown;
  reason?: unknown;
}

/**
 * The transport the resume-aware SDK server serves on. Set once at server
 * apply time; the answerer reads it lazily per request, so plugin load order
 * does not matter. One runtime process serves exactly one transport.
 */
let approvalTransport: JsonRpcTransportPeer | undefined;

/** Publish the stdio transport for the approval answerer (called by server.ts). */
export function setApprovalTransport(transport: JsonRpcTransportPeer | undefined): void {
  approvalTransport = transport;
}

/**
 * Register the approval bridge on the plugin context: the pre-execute gate
 * that turns operate-tool calls into approval questions, and the answerer that
 * forwards those questions to the Gateway. Read tools are never gated here.
 * @param ctx - plugin context.
 */
export function registerApprovalBridge(ctx: Context): void {
  // Parsed arguments are not part of ApprovalRequest; stash them per call so
  // the answerer can hand the Gateway the exact pending-action input.
  const pendingArgs = new Map<string, unknown>();

  ctx.on("tools/pre-execute", async (exec, next) => {
    if (!OPERATE_TOOL_NAMES.has(exec.name)) return next();
    pendingArgs.set(String(exec.callId), exec.arguments);
    return {
      kind: "ask",
      reason: `ForgeBadger operate action "${exec.name}" requires owner approval`,
    };
  });

  ctx.on("approval/request", async (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => {
    if (!OPERATE_TOOL_NAMES.has(req.toolName)) return next();
    const callIdKey = req.callId === undefined ? undefined : String(req.callId);
    const args = callIdKey === undefined ? undefined : pendingArgs.get(callIdKey);
    if (callIdKey !== undefined) pendingArgs.delete(callIdKey);
    const transport = approvalTransport;
    if (transport === undefined) return "unavailable";
    try {
      const response = await transport.request(APPROVAL_DECIDE_METHOD, {
        sessionId: String(req.agent.session.id),
        toolName: req.toolName,
        ...(req.callId !== undefined ? { callId: String(req.callId as CallId) } : {}),
        args: args ?? {},
        ...(req.reason !== undefined ? { reason: req.reason } : {}),
      }) as DecideResponse;
      // Only the exact grant string allows; anything else fails closed.
      return response?.outcome === "allowed-once" ? "allowed-once" : "rejected";
    } catch {
      // Transport failure / Gateway error response: deny the action.
      return "unavailable";
    }
  });
}
