/**
 * dsh-backed Copilot BFF (M2/M3). Drop-in replacement for the in-process
 * orchestrator behind POST /conversations/:id/messages, POST /runs/:id/cancel
 * and POST /runs/:id/pending-actions/:actionId/decide when
 * FORGEBADGER_DSH_COPILOT_ENABLED=1.
 *
 * Mirrors orchestrator request semantics: sendMessage blocks until the turn
 * reaches a terminal state OR parks on an approval, then returns the run id
 * (or throws on failure, so the route's domainError mapping is identical).
 * Streaming deltas meanwhile flow over the event bus as copilot_run_updated,
 * unchanged.
 *
 * The dsh session log (per-user runtime, persisted under the state dir) is the
 * source of truth; `copilot_messages` / `copilot_runs` remain the projection
 * the frontend reads, fed by the event translator. One active run per user;
 * a concurrent message is rejected with COPILOT_RUN_BUSY (HTTP 409). A run
 * parked in awaiting_approval still holds the slot: the kernel turn is
 * suspended mid-tool-call, so injecting another prompt would interleave.
 *
 * M3 approval bridging: the runtime's operate tools (advance_work_item,
 * dispatch_task_to_session, create_project, write_memory) answer the dsh
 * pre-execute gate with `ask`, the
 * runtime's answerer forwards the question here as an `approval/decide`
 * server->client JSON-RPC request. This service maps it onto the existing
 * pending-action flow: security policy first (deny -> immediate rejection the
 * model sees as a tool error), then pending action + run awaiting_approval +
 * WS event; the decide endpoint resolves the waiter and the runtime's tool
 * call continues (approved) or is denied (rejected). If the runtime died while
 * the approval was pending (crash / idle reap / gateway restart), decide takes
 * the documented fallback: execute the action gateway-side through the same
 * bridge-service functions, complete the run like the orchestrator's
 * resumeAfterApproval, and inject the decision into the resumed dsh session
 * (best-effort, no turn woken) so the kernel log learns the outcome.
 */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import type { Database } from "../../db/types.js";
import { ModelProviderRepository } from "../../db/repositories/model-provider-repository.js";
import { SessionRepository } from "../../db/repositories/session-repository.js";
import type { ForgeBadgerEventBus } from "../event-bus.js";
import { CopilotConversationLog } from "../agent/conversation-log.js";
import { createAgentLlmClient, type AgentLlmProviderResolution } from "../agent/llm-client.js";
import { createSecurityPolicy, logSecurityDecision } from "../agent/security-policy.js";
import { AgentError } from "../agent/types.js";
import { advanceWorkItem, createProjectRecord, dispatchSessionInput, writeMemoryEntry } from "../copilot-bridge/bridge-service.js";
import { DISPATCH_DELIVERY_UNCONFIRMED, type DispatchConfirmOptions } from "../copilot-bridge/delivery-confirm.js";
import type { InMemorySessionManager } from "../session-manager.js";
import { isAdapterId } from "../adapter-discovery.js";
import type { PortfolioApiFacade } from "../portfolio/portfolio-api-service.js";
import { createEventTranslator, type TranslatorEffect } from "./event-translator.js";
import { resolveDshModelOverride } from "./dsh-config.js";
import type { DshModelRoute, DshProcessManager } from "./process-manager.js";
import type { DshRpcClient, DshNotification } from "./rpc-client.js";

export interface DshCopilotBffDeps {
  db: Database;
  masterKey: string;
  eventBus: ForgeBadgerEventBus;
  processManager: DshProcessManager;
  /** Gateway-side execution of approved actions whose runtime died mid-approval. */
  sessionManager: InMemorySessionManager;
  portfolioApi: PortfolioApiFacade;
  /** Test-only fetch override, forwarded to the LLM client used for model resolution. */
  llmFetch?: typeof fetch;
  /** Delivery read-back budget for the gateway-side dispatch fallback (defaults apply when absent). */
  dispatchConfirm?: DispatchConfirmOptions | undefined;
}

type TurnOutcome = "completed" | "cancelled" | "failed";
/** sendMessage-level outcome: the turn may also park on an owner approval. */
type DriveOutcome = TurnOutcome | "awaiting_approval";

interface ActiveRun {
  runId: string;
  conversationId: string;
  dshSessionId: string;
  source: "user" | "reactive";
  route: DshModelRoute;
  /** Signals the awaiting_approval drive outcome; installed by trackTurn. */
  notifyAwaiting: () => void;
}

/** One in-flight `approval/decide` question waiting on the owner's decision. */
interface ApprovalWaiter {
    userId: string;
    runId: string;
    resolve: (outcome: "allowed-once" | "rejected") => void;
}

export interface DshCopilotBff {
  sendMessage(input: {
    userId: string;
    conversationId: string;
    content: string;
    modelId?: string;
    source?: "user" | "reactive";
  }): Promise<string>;
  cancelRun(input: { userId: string; runId: string }): Promise<{ cancelled: boolean; runId: string }>;
  decidePendingAction(input: {
    userId: string;
    runId: string;
    actionId: string;
    approved: boolean;
  }): Promise<{ resumed: boolean; runId: string }>;
  /** M4 dsh-config API: whether the user's runtime process is currently live. */
  getRuntimeStatus(input: { userId: string }): "running" | "idle";
  /**
   * M4: a dsh-config change applies on the NEXT spawn. When no run is active
   * the live runtime is killed immediately so the next message respawns with
   * the new config (a parked/active run is never hot-killed).
   */
  applyConfigChanged(input: { userId: string }): Promise<{ runtimeRestarted: boolean }>;
}

export function createDshCopilotBff(deps: DshCopilotBffDeps): DshCopilotBff {
  const activeRuns = new Map<string, ActiveRun>();
  const approvalWaiters = new Map<string, ApprovalWaiter>();
  const securityPolicy = createSecurityPolicy();

  // A runtime crash mid-turn fails the active run and surfaces it on the bus;
  // the next message respawns the runtime and resumes the session from its log.
  // A run parked in awaiting_approval instead SURVIVES the runtime: the pending
  // action stays decidable and takes the gateway-side execution fallback.
  deps.processManager.addExitListener((userId, info) => {
    const active = activeRuns.get(userId);
    if (!active) return;
    const run = new CopilotConversationLog(deps.db, userId).getRun(active.runId);
    if (run?.status === "awaiting_approval") {
      // The dead runtime can never consume the answer; later decides take the
      // fallback path. The pending action rows stay 'pending' by design.
      for (const [actionId, waiter] of approvalWaiters) {
        if (waiter.userId === userId) approvalWaiters.delete(actionId);
      }
      return;
    }
    if (info.expected) return;
    activeRuns.delete(userId);
    finalizeRun(userId, active.runId, active.conversationId, active.source, "failed", "dsh runtime exited unexpectedly");
  });

  async function sendMessage(input: {
    userId: string;
    conversationId: string;
    content: string;
    modelId?: string;
    source?: "user" | "reactive";
  }): Promise<string> {
    const source = input.source ?? "user";
    const log = new CopilotConversationLog(deps.db, input.userId);
    const conversation = log.getConversation(input.conversationId);
    if (!conversation) throw new AgentError("COPILOT_NOT_FOUND", "Copilot record not found");
    if (activeRuns.has(input.userId)) throw new AgentError("COPILOT_RUN_BUSY", "A copilot run is already active");

    const resolution = resolveModel(input.userId, input.modelId);
    const dshSessionId = ensureDshSession(log, input.conversationId, conversation.dsh_session_id);

    log.appendMessage(input.conversationId, { role: "user", kind: "text", content: input.content });
    const run = log.createRun(input.conversationId, { provider: resolution.providerKey, model: resolution.modelId });
    log.updateRun(run.id, { status: "running", startedAt: new Date() });
    const route = toRoute(resolution);

    let active!: ActiveRun;
    const awaiting = new Promise<"awaiting_approval">((resolve) => {
      active = {
        runId: run.id,
        conversationId: input.conversationId,
        dshSessionId,
        source,
        route,
        notifyAwaiting: () => resolve("awaiting_approval")
      };
    });
    // Settled by the first approval park; an unhandled rejection must never
    // escape if the caller already moved on.
    awaiting.catch(() => undefined);
    activeRuns.set(input.userId, active);

    try {
      const { outcome, finalText } = await driveTurn(input.userId, dshSessionId, input.content, route, run.id, input.conversationId, source, awaiting);
      if (outcome === "awaiting_approval") {
        // The run parks; the tracker stays live and finalizes when the turn
        // resumes after the owner's decide and reaches turn/end.
        return run.id;
      }
      if (activeRuns.get(input.userId) === active) activeRuns.delete(input.userId);
      finalizeRun(input.userId, run.id, input.conversationId, source, outcome, finalText);
      if (outcome === "failed") throw new AgentError("DSH_TURN_FAILED", "dsh turn ended with an error");
      return run.id;
    } catch (error) {
      if (activeRuns.get(input.userId) === active) activeRuns.delete(input.userId);
      failRun(input.userId, run.id, input.conversationId, source, error);
      // A user cancel kills the runtime mid-turn, which rejects the pending
      // prompt — the cancel endpoint already owns the terminal state and the
      // original POST must still succeed, exactly like the orchestrator path.
      if (log.getRun(run.id)?.status === "cancelled") return run.id;
      throw error;
    }
  }

  async function cancelRun(input: { userId: string; runId: string }): Promise<{ cancelled: boolean; runId: string }> {
    const log = new CopilotConversationLog(deps.db, input.userId);
    const run = log.getRun(input.runId);
    if (!run || run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
      return { cancelled: false, runId: input.runId };
    }
    // Orchestrator parity: a cancelled run rejects its still-pending actions.
    for (const action of log.listPendingActions(run.id)) {
      if (action.status === "pending") log.decidePendingAction(action.id, "rejected");
    }
    // Resolve waiters before the kill so nothing outlives the runtime; the
    // response write to a dying peer is a harmless no-op.
    for (const [actionId, waiter] of approvalWaiters) {
      if (waiter.runId === input.runId) {
        approvalWaiters.delete(actionId);
        waiter.resolve("rejected");
      }
    }
    // Kill semantics (spike-verified SDK substitute for mid-turn cancel): the
    // runtime process dies, the session log keeps the partial turn. Mark the
    // run cancelled BEFORE the kill: the process exit rejects the in-flight
    // turn, and the blocked sendMessage must observe the cancelled row.
    const source = activeRuns.get(input.userId)?.source ?? "user";
    finalizeRun(input.userId, run.id, run.conversationId, source, "cancelled", "Run cancelled");
    if (activeRuns.get(input.userId)?.runId === input.runId) {
      activeRuns.delete(input.userId);
      await deps.processManager.killUser(input.userId);
    }
    return { cancelled: true, runId: input.runId };
  }

  /**
   * Owner decision on a pending action. Live runtime: answer the suspended
   * `approval/decide` RPC and the kernel's tool call continues. Dead runtime
   * (crash/idle/restart while pending): execute gateway-side through the same
   * bridge-service functions, complete the run like the orchestrator's
   * resumeAfterApproval, and inject the decision into the dsh session log.
   */
  async function decidePendingAction(input: {
    userId: string;
    runId: string;
    actionId: string;
    approved: boolean;
  }): Promise<{ resumed: boolean; runId: string }> {
    const log = new CopilotConversationLog(deps.db, input.userId);
    const run = log.getRun(input.runId);
    if (!run || run.status !== "awaiting_approval") return { resumed: false, runId: input.runId };
    const action = log.getPendingAction(input.actionId);
    // Context binding + idempotency: an action can only resume the persisted
    // run that created it, and an already-decided action never re-executes.
    if (!action || action.runId !== run.id || action.status !== "pending") {
      return { resumed: false, runId: input.runId };
    }
    log.decidePendingAction(action.id, input.approved ? "approved" : "rejected");

    const waiter = approvalWaiters.get(action.id);
    if (waiter) {
      approvalWaiters.delete(action.id);
      waiter.resolve(input.approved ? "allowed-once" : "rejected");
      // The kernel turn resumes; the run goes back to running until turn/end.
      log.updateRun(run.id, { status: "running" });
      deps.eventBus.emitEvent({
        type: "copilot_run_updated",
        userId: input.userId,
        runId: run.id,
        conversationId: run.conversationId,
        status: "running",
        toolName: action.tool,
        message: input.approved ? "approved" : "rejected",
        occurredAt: new Date()
      });
      return { resumed: true, runId: run.id };
    }

    // Dead-runtime fallback: the run closes here, so the user's run slot frees.
    const parkedRoute = activeRuns.get(input.userId)?.route;
    if (activeRuns.get(input.userId)?.runId === run.id) activeRuns.delete(input.userId);
    return decideWithDeadRuntime(log, input.userId, run.id, run.conversationId, action.tool, action.inputJson, input.approved, parkedRoute);
  }

  /** Fallback decide path: the runtime that asked is gone (crash/idle/restart). */
  async function decideWithDeadRuntime(
    log: CopilotConversationLog,
    userId: string,
    runId: string,
    conversationId: string,
    tool: string,
    inputJson: string,
    approved: boolean,
    parkedRoute: DshModelRoute | undefined
  ): Promise<{ resumed: boolean; runId: string }> {
    let content: string;
    if (approved) {
      const result = await executeApprovedAction(userId, tool, inputJson);
      content = result.content;
      log.appendMessage(conversationId, { role: "tool", kind: "tool_result", content, toolName: tool });
    } else {
      content = "Action rejected by the owner";
      log.appendMessage(conversationId, { role: "tool", kind: "tool_result", content, toolName: tool });
    }
    finalizeRun(userId, runId, conversationId, "user", "completed", content);
    injectDecisionBestEffort(userId, log, conversationId, tool, approved, content, parkedRoute);
    return { resumed: true, runId };
  }

  /** Gateway-side execution of an approved operate action (dead-runtime path). */
  async function executeApprovedAction(userId: string, tool: string, inputJson: string): Promise<{ content: string }> {
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(inputJson) as Record<string, unknown>;
    } catch {
      return { content: "Tool error: stored pending-action input is not valid JSON" };
    }
    try {
      if (tool === "advance_work_item") {
        const result = advanceWorkItem(
          deps.db,
          userId,
          deps.portfolioApi.forUser(userId),
          String(input.id ?? ""),
          typeof input.note === "string" ? input.note : undefined
        );
        return { content: JSON.stringify(result) };
      }
      if (tool === "dispatch_task_to_session") {
        const sessionId = String(input.sessionId ?? "");
        // Tenant check against the durable record before any runtime write
        // (mirrors the internal bridge route).
        const session = new SessionRepository(deps.db, userId).getById(sessionId);
        if (!session) {
          return { content: "Tool error: session not found" };
        }
        if (!isAdapterId(session.aiTool)) {
          return { content: "Tool error: session adapter is unsupported" };
        }
        const receipt = await dispatchSessionInput(
          deps.sessionManager,
          sessionId,
          session.aiTool,
          String(input.message ?? ""),
          deps.dispatchConfirm
        );
        return { content: JSON.stringify(receipt) };
      }
      if (tool === "create_project") {
        // The dead-runtime fallback bypasses the bridge route's zod schema, so
        // the tool-input constraints are re-checked here before any write.
        const name = String(input.name ?? "");
        const path = String(input.path ?? "");
        const description = typeof input.description === "string" ? input.description : undefined;
        if (name.length < 1 || name.length > 200 || path.length < 1 || path.length > 1024 || (description !== undefined && description.length > 2000)) {
          return { content: "Tool error: invalid create_project input" };
        }
        const created = createProjectRecord(deps.db, userId, {
          name,
          path,
          ...(description !== undefined ? { description } : {})
        });
        return { content: JSON.stringify({ created: true, ...created }) };
      }
      if (tool === "write_memory") {
        const MEMORY_KINDS = new Set(["fact", "preference", "decision", "project_note"]);
        const MEMORY_SCOPES = new Set(["global", "project", "session"]);
        const text = String(input.text ?? "");
        if (typeof input.kind !== "string" || !MEMORY_KINDS.has(input.kind)
          || typeof input.scope !== "string" || !MEMORY_SCOPES.has(input.scope)
          || text.length < 1 || text.length > 8 * 1024) {
          return { content: "Tool error: invalid write_memory input" };
        }
        const result = writeMemoryEntry(deps.db, userId, {
          kind: input.kind as "fact" | "preference" | "decision" | "project_note",
          scope: input.scope as "global" | "project" | "session",
          text,
          ...(typeof input.projectId === "string" ? { projectId: input.projectId } : {}),
          ...(input.metadata !== null && typeof input.metadata === "object" && !Array.isArray(input.metadata)
            ? { metadata: input.metadata as Record<string, unknown> }
            : {})
        });
        return { content: JSON.stringify(result) };
      }
      return { content: `Tool error: unknown operate tool ${tool}` };
    } catch (error) {
      // Model-facing wording for the delivery read-back failure (the runtime
      // shows this text as the tool result, like the bridge route's envelope).
      if (error instanceof Error && error.message === DISPATCH_DELIVERY_UNCONFIRMED) {
        return { content: "Tool error: dispatch may have reached the target CLI, but consumption could not be confirmed. Ask the user to check the session terminal; do not retry automatically because that could run the task twice." };
      }
      return { content: `Tool error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * Best-effort convergence of the kernel log with the projection: respawn the
   * runtime, resume the session, and queue the decision as plugin context for
   * the next turn (no turn is woken). Failures only lose the hint; the
   * projection is already authoritative for the user.
   */
  function injectDecisionBestEffort(
    userId: string,
    log: CopilotConversationLog,
    conversationId: string,
    tool: string,
    approved: boolean,
    content: string,
    parkedRoute: DshModelRoute | undefined
  ): void {
    void (async () => {
      const conversation = log.getConversation(conversationId);
      if (!conversation?.dsh_session_id) return;
      const route = parkedRoute ?? toRoute(resolveModel(userId, undefined));
      const client = await deps.processManager.ensureClient(userId, route);
      const text = approved
        ? `The owner approved the pending action "${tool}". The platform already executed it; the result was: ${content}`
        : `The owner rejected the pending action "${tool}". Do not retry it unless the user explicitly asks again.`;
      await client.request("session/inject", { sessionId: conversation.dsh_session_id, text });
    })().catch(() => undefined);
  }

  /** Inbound runtime request dispatch (currently only the approval question). */
  async function handleRuntimeRequest(userId: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method !== "approval/decide") {
      throw new AgentError("DSH_UNKNOWN_METHOD", `unknown runtime request method: ${method}`);
    }
    return handleApprovalRequest(userId, params);
  }

  /**
   * Map one runtime approval question onto the pending-action flow. Security
   * policy runs BEFORE any pending action is created; a deny answers the tool
   * immediately (the model sees a denied tool result, no owner prompt).
   */
  async function handleApprovalRequest(userId: string, params: Record<string, unknown>): Promise<{ outcome: string; reason?: string }> {
    const toolName = typeof params.toolName === "string" ? params.toolName : "";
    const args = params.args ?? {};
    const active = activeRuns.get(userId);
    // Fail closed: an approval question without a matching active run (e.g. a
    // stale runtime, or an inject-driven turn) can never be granted.
    if (!active || typeof params.sessionId !== "string" || params.sessionId !== active.dshSessionId) {
      return { outcome: "rejected", reason: "no active run owns this approval request" };
    }
    const log = new CopilotConversationLog(deps.db, userId);
    const run = log.getRun(active.runId);
    if (!run) return { outcome: "rejected", reason: "run not found" };

    // Both operate tools are approval-required writes; an unexpected tool name
    // gets the same conservative treatment instead of trust.
    const decision = securityPolicy.evaluate({
      userId,
      toolName,
      toolRisk: "operate",
      requiresApproval: true,
      input: args
    });
    logSecurityDecision({ db: deps.db, userId, operation: toolName, input: args, action: decision.action, reason: decision.reason });
    if (decision.action === "deny") {
      deps.eventBus.emitEvent({
        type: "copilot_run_updated",
        userId,
        source: active.source,
        runId: active.runId,
        conversationId: active.conversationId,
        status: "running",
        toolName,
        message: "denied",
        occurredAt: new Date()
      });
      return { outcome: "rejected", reason: `Denied by security policy: ${decision.reason}` };
    }
    if (decision.action === "auto_approve") {
      return { outcome: "allowed-once" };
    }

    const inputJson = JSON.stringify(args);
    const action = log.createPendingAction({
      runId: active.runId,
      tool: toolName,
      inputJson,
      inputDigest: createHash("sha256").update(inputJson).digest("hex")
    });
    log.updateRun(active.runId, { status: "awaiting_approval" });
    deps.eventBus.emitEvent({
      type: "copilot_run_updated",
      userId,
      source: active.source,
      runId: active.runId,
      conversationId: active.conversationId,
      status: "awaiting_approval",
      toolName,
      pendingActionId: action.id,
      occurredAt: new Date()
    });
    active.notifyAwaiting();
    deps.processManager.touchUser(userId);

    // Suspend until the owner decides (or cancel/exit settles the waiter).
    return new Promise<{ outcome: string; reason?: string }>((resolve) => {
      approvalWaiters.set(action.id, {
        userId,
        runId: active.runId,
        resolve: (outcome) => resolve({
          outcome,
          ...(outcome === "rejected" ? { reason: "Rejected by the owner" } : {})
        })
      });
    });
  }

  function resolveModel(userId: string, modelId: string | undefined): AgentLlmProviderResolution {
    // M4 resolution order: message-level modelId > the user's dsh-config
    // defaultModelId > the system isDefault profile (resolveProvider's
    // undefined path).
    const effectiveModelId = modelId ?? resolveDshModelOverride(deps.db, userId);
    const modelRepo = new ModelProviderRepository(deps.db, userId, deps.masterKey);
    const llm = createAgentLlmClient({
      modelProviderRepository: modelRepo,
      ...(deps.llmFetch !== undefined ? { fetchImpl: deps.llmFetch } : {})
    });
    return llm.resolveProvider(effectiveModelId);
  }

  /** Spawn/attach the runtime, prompt the session, and await the turn end or an approval park. */
  async function driveTurn(
    userId: string,
    dshSessionId: string,
    content: string,
    route: DshModelRoute,
    runId: string,
    conversationId: string,
    source: "user" | "reactive",
    awaiting: Promise<"awaiting_approval">
  ): Promise<{ outcome: DriveOutcome; finalText: string }> {
    const client = await deps.processManager.ensureClient(userId, route);
    client.onRequest((method, params) => handleRuntimeRequest(userId, method, params));
    const turn = trackTurn(client, userId, dshSessionId, runId, conversationId, source);
    try {
      await client.request("session/prompt", {
        sessionId: dshSessionId,
        contentBlocks: [{ type: "text", text: content }]
      });
    } catch (error) {
      turn.stop();
      throw error;
    }
    const outcome = await Promise.race([turn.done, awaiting]);
    if (outcome === "awaiting_approval") {
      // Keep tracking: the turn resumes after decide and still ends here.
      void turn.done.then(
        (finalOutcome) => {
          if (activeRuns.get(userId)?.runId !== runId) return;
          activeRuns.delete(userId);
          finalizeRun(userId, runId, conversationId, source, finalOutcome, turn.finalText);
        },
        () => {
          // Runtime exited while parked (cancel owns the row; crash/idle keeps
          // the awaiting_approval state for the fallback decide path).
        }
      );
      return { outcome: "awaiting_approval", finalText: turn.finalText };
    }
    turn.stop();
    return { outcome, finalText: turn.finalText };
  }

  /** Subscribe one turn's events to translation/projection until turn/end. */
  function trackTurn(
    client: DshRpcClient,
    userId: string,
    dshSessionId: string,
    runId: string,
    conversationId: string,
    source: "user" | "reactive"
  ) {
    const log = new CopilotConversationLog(deps.db, userId);
    const translator = createEventTranslator({ userId, runId, conversationId, source });
    const state = { finalText: "" };

    let resolveDone!: (outcome: TurnOutcome) => void;
    let rejectDone!: (reason: Error) => void;
    const done = new Promise<TurnOutcome>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    // The promise settles via event flow; an unhandled rejection must never
    // escape if the caller already moved on (cancel path resolves it first).
    done.catch(() => undefined);

    client.onNotification((notification: DshNotification) => {
      if (notification.method !== "session.event") return;
      const params = notification.params as { sessionId?: string; event?: { type: string; data?: Record<string, unknown> } } | undefined;
      if (params?.sessionId !== dshSessionId || !params.event) return;
      deps.processManager.touchUser(userId);
      for (const effect of translator.translate(params.event)) {
        applyEffect(log, userId, runId, conversationId, effect, state, resolveDone);
      }
    });
    const offExit = deps.processManager.addExitListener((exitedUserId) => {
      if (exitedUserId === userId) rejectDone(new AgentError("DSH_RUNTIME_EXIT", "dsh runtime exited mid-turn"));
    });

    return {
      done,
      get finalText() { return state.finalText; },
      stop() {
        client.onNotification(undefined);
        offExit();
      }
    };
  }

  function applyEffect(
    log: CopilotConversationLog,
    userId: string,
    runId: string,
    conversationId: string,
    effect: TranslatorEffect,
    state: { finalText: string },
    resolveTurn: (outcome: TurnOutcome) => void
  ): void {
    if (effect.kind === "append") {
      log.appendMessage(conversationId, effect.message);
      return;
    }
    if (effect.kind === "emit") {
      if (effect.event.textDelta) state.finalText += effect.event.textDelta;
      deps.eventBus.emitEvent({ type: "copilot_run_updated", ...effect.event, occurredAt: new Date() });
      return;
    }
    if (effect.kind === "title") {
      // Mirrors maybeAutoTitle: never overwrite an owner-set title.
      const conversation = log.getConversation(conversationId);
      if (conversation && conversation.title === null) {
        log.renameConversation(conversationId, effect.title);
        deps.eventBus.emitEvent({
          type: "copilot_run_updated",
          userId, runId, conversationId,
          status: "running",
          titleUpdated: effect.title,
          occurredAt: new Date()
        });
      }
      return;
    }
    resolveTurn(effect.status);
  }

  function finalizeRun(
    userId: string,
    runId: string,
    conversationId: string,
    source: "user" | "reactive",
    outcome: TurnOutcome,
    message: string
  ): void {
    const log = new CopilotConversationLog(deps.db, userId);
    // A cancel that raced the turn end already wrote the terminal state.
    const current = log.getRun(runId);
    if (!current || current.status === "cancelled" || current.status === "completed" || current.status === "failed") return;
    log.updateRun(runId, {
      status: outcome,
      ...(outcome === "failed" ? { error: message } : {}),
      completedAt: new Date()
    });
    deps.eventBus.emitEvent({
      type: "copilot_run_updated",
      userId,
      source,
      runId,
      conversationId,
      status: outcome,
      message,
      occurredAt: new Date()
    });
  }

  function failRun(userId: string, runId: string, conversationId: string, source: "user" | "reactive", error: unknown): void {
    const message = error instanceof Error ? error.message : "Copilot run failed";
    finalizeRun(userId, runId, conversationId, source, "failed", message);
  }

  return {
    sendMessage,
    cancelRun,
    decidePendingAction,
    getRuntimeStatus(input: { userId: string }): "running" | "idle" {
      return deps.processManager.isRunning(input.userId) ? "running" : "idle";
    },
    async applyConfigChanged(input: { userId: string }): Promise<{ runtimeRestarted: boolean }> {
      if (activeRuns.has(input.userId)) return { runtimeRestarted: false };
      const killed = await deps.processManager.killUser(input.userId);
      return { runtimeRestarted: killed };
    }
  };
}

function ensureDshSession(log: CopilotConversationLog, conversationId: string, existing: string | null): string {
  if (existing !== null) return existing;
  const dshSessionId = `dsh-${randomUUID()}`;
  if (!log.bindDshSession(conversationId, dshSessionId)) {
    throw new AgentError("DSH_SESSION_BIND_FAILED", "Failed to bind a dsh session to the conversation");
  }
  return dshSessionId;
}

/** Map a resolved provider to the runtime's single "copilot" LLM route. */
function toRoute(resolution: AgentLlmProviderResolution): DshModelRoute {
  return {
    api: mapApiFormat(resolution.apiFormat),
    baseUrl: resolution.baseUrl,
    apiKey: resolution.apiKey,
    model: resolution.modelId,
    modelName: resolution.modelId
  };
}

function mapApiFormat(format: AgentLlmProviderResolution["apiFormat"]): string {
  if (format === "anthropic") return "anthropic-messages";
  if (format === "openai" || format === "openai-compatible") return "openai-completions";
  throw new AgentError("AGENT_MODEL_UNSUPPORTED", `Provider api format is not supported by the dsh copilot: ${format}`);
}
