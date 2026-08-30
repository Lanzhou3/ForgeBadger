/**
 * Copilot orchestrator — the turn/step loop.
 *
 * A run is one user turn plus its tool steps. The loop:
 *   1. appends the user message to the conversation log
 *   2. projects model-visible history from the log and calls the LLM
 *   3. streams text deltas; collects tool calls
 *   4. executes read tools; gates operate tools behind a pending action
 *      (sets the run to awaiting_approval and stops — the approved action is
 *      executed by a follow-up step, not autonomously)
 *   5. loops until no tool is owed or the step budget is exhausted
 *   6. persists the run and emits copilot_run_updated events
 *
 * It is deliberately provider-agnostic: provider resolution lives in
 * llm-client, tool definitions in the registry, and all platform reads/writes
 * go through the registered tool seams.
 */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { ForgeBadgerEventBus } from "../event-bus.js";
import type { AgentToolRegistry, AgentToolContext } from "./tool-registry.js";
import { executeAgentTool } from "./tool-registry.js";
import type { AgentLlmClient, AgentToolCall } from "./orchestrator-types.js";
import { CopilotConversationLog } from "./conversation-log.js";
import { buildCompressedContext } from "./context.js";
import { resolveLocalCommandReply } from "./slash-commands.js";
import { redactAgentValue } from "./redaction.js";
import { createSecurityPolicy, logSecurityDecision } from "./security-policy.js";

export interface CopilotOrchestratorDependencies {
  db: import("../../db/types.js").Database;
  masterKey: string;
  toolRegistry: AgentToolRegistry;
  llm: AgentLlmClient;
  eventBus: ForgeBadgerEventBus;
  maxSteps?: number;
  /** User-scoping facade; each run gets the scoped api for its owner. */
  portfolioApi?: { forUser(userId: string): unknown };
  /**
   * Owner's per-tool switches (copilot_tool_preferences). Disabled tools are
   * hidden from the model, and a call that still arrives is refused with a
   * recoverable tool_result instead of executing.
   */
  isToolDisabled?: (toolName: string) => boolean;
  /** Live-session seam for tools that read terminal output or dispatch. */
  sessionManager?: import("../session-manager.js").InMemorySessionManager;
  /** Adapter CLI availability probing for launch preflight. */
  adapterCommandRunner?: import("../../lib/dependency-check.js").CommandRunner;
}

const DEFAULT_MAX_STEPS = 16;

export function createCopilotOrchestrator(deps: CopilotOrchestratorDependencies) {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const securityPolicy = createSecurityPolicy();

  function logFor(userId: string): CopilotConversationLog {
    return new CopilotConversationLog(deps.db, userId);
  }

  /** Run one user turn (or a proactive reactive-loop turn). Returns the run id. */
  async function runTurn(input: {
    userId: string;
    conversationId: string;
    userText: string;
    modelId?: string;
    source?: "user" | "reactive";
    /**
     * Skip the initial user-message append. Used by the edit-message flow,
     * which has already rewritten the target message in place — appending a
     * duplicate would split the conversation into two of the same prompt.
     */
    skipUserMessage?: boolean;
  }): Promise<string> {
    const userId = input.userId;
    const source = input.source ?? "user";
    const log = logFor(userId);
    if (!input.skipUserMessage) {
      log.appendMessage(input.conversationId, { role: "user", kind: "text", content: input.userText });
    }
    const run = log.createRun(input.conversationId, {});
    log.updateRun(run.id, { status: "running", startedAt: new Date() });

      const context: AgentToolContext = {
        userId,
        db: deps.db,
        masterKey: deps.masterKey,
        ...(deps.sessionManager !== undefined ? { sessionManager: deps.sessionManager } : {}),
        ...(deps.adapterCommandRunner !== undefined ? { adapterCommandRunner: deps.adapterCommandRunner } : {}),
        ...(deps.portfolioApi !== undefined ? { portfolioApi: deps.portfolioApi.forUser(userId) } : {})
      };

      try {
        // Local slash-command short-circuit (e.g. /skills): reply straight
        // from platform state — no context projection, no model call, no
        // auto-title. The reply is persisted as a normal assistant turn.
        const commandReply = resolveLocalCommandReply(input.userText);
        if (commandReply !== null) {
          log.appendMessage(input.conversationId, { role: "assistant", kind: "text", content: commandReply });
          log.updateRun(run.id, { status: "completed", completedAt: new Date(), steps: 0 });
          deps.eventBus.emitEvent({
            type: "copilot_run_updated",
            userId,
            source,
            runId: run.id,
            conversationId: input.conversationId,
            status: "completed",
            message: commandReply,
            occurredAt: new Date()
          });
          return run.id;
        }
        // Project model-visible history from the log, compressing older messages
        // into a rolling summary when the conversation overflows the budget.
      const { messages } = await buildCompressedContext(log, input.conversationId, deps.llm, input.modelId);
      let steps = 0;
      let finalText = "";

      while (steps < maxSteps) {
        steps += 1;
        const toolCalls: AgentToolCall[] = [];
        await deps.llm.stream({
          messages,
          tools: deps.toolRegistry.toModelSchemas().filter((schema) => !deps.isToolDisabled?.(schema.name)),
          ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
          onEvent: (event) => {
            if (event.type === "text_delta") {
              finalText += event.text ?? "";
              deps.eventBus.emitEvent({
                type: "copilot_run_updated",
                userId,
                source,
                runId: run.id,
                conversationId: input.conversationId,
                status: "running",
                textDelta: event.text ?? "",
                occurredAt: new Date()
              });
            } else if (event.type === "tool_call" && event.toolCall) {
              toolCalls.push({ id: event.toolCall.id, name: event.toolCall.name, input: safeParse(event.toolCall.arguments) });
            }
          }
        });

        if (toolCalls.length === 0) {
          // No tool owed — assistant finished.
          break;
        }

        log.appendMessage(input.conversationId, {
          role: "assistant",
          kind: "text",
          content: finalText
        });
        for (const tc of toolCalls) {
          log.appendMessage(input.conversationId, {
            role: "assistant",
            kind: "tool_call",
            content: tc.name,
            toolName: tc.name,
            toolInputJson: JSON.stringify(tc.input),
            toolCallId: tc.id
          });
        }

        // Handle tool calls in order; operate tools stop the loop pending approval.
        let operated = false;
        for (const tc of toolCalls) {
          const tool = deps.toolRegistry.tools.get(tc.name);
          if (!tool) {
            log.appendMessage(input.conversationId, { role: "tool", kind: "tool_result", content: `Unknown tool: ${tc.name}`, toolName: tc.name, toolCallId: tc.id });
            messages.push({ role: "tool", toolCallId: tc.id, content: `Unknown tool: ${tc.name}` });
            continue;
          }
          if (deps.isToolDisabled?.(tc.name)) {
            // Defense in depth: the schema was already filtered, so this only
            // triggers on a stale or hallucinated call. Recoverable result.
            const content = `Tool disabled by owner: ${tc.name}`;
            log.appendMessage(input.conversationId, { role: "tool", kind: "tool_result", content, toolName: tc.name, toolCallId: tc.id });
            messages.push({ role: "tool", toolCallId: tc.id, content });
            continue;
          }
          const decision = securityPolicy.evaluate({
            userId,
            toolName: tc.name,
            toolRisk: tool.risk,
            requiresApproval: tool.requiresApproval,
            input: tc.input
          });
          logSecurityDecision({
            db: deps.db,
            userId,
            operation: tc.name,
            input: tc.input,
            action: decision.action,
            reason: decision.reason
          });

          if (decision.action === "deny") {
            const content = `Denied by security policy: ${decision.reason}`;
            log.appendMessage(input.conversationId, { role: "tool", kind: "tool_result", content, toolName: tc.name, toolCallId: tc.id });
            messages.push({ role: "tool", toolCallId: tc.id, content });
            deps.eventBus.emitEvent({
              type: "copilot_run_updated",
              userId,
              source,
              runId: run.id,
              conversationId: input.conversationId,
              status: "running",
              toolName: tc.name,
              message: "denied",
              occurredAt: new Date()
            });
            continue;
          }

          if (decision.action === "require_approval") {
            const digest = createHash("sha256").update(JSON.stringify(tc.input)).digest("hex");
            const action = log.createPendingAction({
              runId: run.id,
              tool: tc.name,
              inputJson: JSON.stringify(tc.input),
              inputDigest: digest
            });
            log.updateRun(run.id, { status: "awaiting_approval" });
            deps.eventBus.emitEvent({
              type: "copilot_run_updated",
              userId,
              source,
              runId: run.id,
              conversationId: input.conversationId,
              status: "awaiting_approval",
              toolName: tc.name,
              pendingActionId: action.id,
              occurredAt: new Date()
            });
            operated = true;
            break;
          }

          const result = await executeAgentTool(tool, tc.input, context);
          const safeOutput = redactAgentValue(result.output);
          const content = result.ok ? JSON.stringify(safeOutput) : `Tool error: ${result.error ?? "unknown"}`;
          log.appendMessage(input.conversationId, { role: "tool", kind: "tool_result", content, toolName: tc.name, toolCallId: tc.id });
          messages.push({ role: "tool", toolCallId: tc.id, content });
          deps.eventBus.emitEvent({
            type: "copilot_run_updated",
            userId,
            source,
            runId: run.id,
            conversationId: input.conversationId,
            status: "running",
            toolName: tc.name,
            message: result.ok ? "ok" : "error",
            occurredAt: new Date()
          });
        }

        if (operated) {
          // Run is waiting for owner approval; do not continue autonomously.
          return run.id;
        }
      }

      log.appendMessage(input.conversationId, { role: "assistant", kind: "text", content: finalText });
      log.updateRun(run.id, { status: "completed", completedAt: new Date(), steps });
      // After the first completed user turn, the conversation still has a null
      // title — fire-and-forget an LLM-generated title so the sidebar / chat
      // header stop showing "未命名对话". Reactive-loop turns and subsequent
      // user turns are left alone: rename conversation only when the title is
      // still null, so we never overwrite a user-renamed title.
      maybeAutoTitle({
        log,
        userId,
        conversationId: input.conversationId,
        userText: input.userText,
        assistantText: finalText,
        source,
        runId: run.id,
        eventBus: deps.eventBus,
        llm: deps.llm,
        ...(input.modelId !== undefined ? { modelId: input.modelId } : {})
      }).catch(() => undefined);
      deps.eventBus.emitEvent({
        type: "copilot_run_updated",
        userId,
        source,
        runId: run.id,
        conversationId: input.conversationId,
        status: "completed",
        message: finalText,
        occurredAt: new Date()
      });
      return run.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Copilot run failed";
      log.updateRun(run.id, { status: "failed", error: message });
      deps.eventBus.emitEvent({
        type: "copilot_run_updated",
        userId,
        source,
        runId: run.id,
        conversationId: input.conversationId,
        status: "failed",
        message,
        occurredAt: new Date()
      });
      throw error;
    }
  }

  /** Resume a run that was awaiting_approval after the owner decides. */
  async function resumeAfterApproval(input: { userId: string; runId: string; actionId: string; approved: boolean }): Promise<{ resumed: boolean; runId: string }> {
    const log = logFor(input.userId);
    const run = log.getRun(input.runId);
    if (!run || run.status !== "awaiting_approval") return { resumed: false, runId: input.runId };
    const action = log.getPendingAction(input.actionId);
    if (!action || action.runId !== run.id || action.status !== "pending") return { resumed: false, runId: input.runId };
    log.decidePendingAction(action.id, input.approved ? "approved" : "rejected");

    if (input.approved) {
      const tool = deps.toolRegistry.tools.get(action.tool);
      // The owner may have disabled the tool between the approval request and
      // the decision — the switch wins over the earlier approval, and the run
      // completes without executing it.
      if (tool && !deps.isToolDisabled?.(action.tool)) {
        const context: AgentToolContext = {
          userId: input.userId,
          db: deps.db,
          masterKey: deps.masterKey,
          ...(deps.sessionManager !== undefined ? { sessionManager: deps.sessionManager } : {}),
          ...(deps.adapterCommandRunner !== undefined ? { adapterCommandRunner: deps.adapterCommandRunner } : {}),
          ...(deps.portfolioApi !== undefined ? { portfolioApi: deps.portfolioApi.forUser(input.userId) } : {})
        };
        const rawInput = safeParse(action.inputJson);
        const result = await executeAgentTool(tool, rawInput, context);
        const safeOutput = redactAgentValue(result.output);
        const content = result.ok ? JSON.stringify(safeOutput) : `Tool error: ${result.error ?? "unknown"}`;
        log.appendMessage(run.conversationId, { role: "tool", kind: "tool_result", content, toolName: action.tool });
        log.updateRun(run.id, { status: "completed", completedAt: new Date() });
        deps.eventBus.emitEvent({
          type: "copilot_run_updated",
          userId: input.userId,
          runId: run.id,
          conversationId: run.conversationId,
          status: "completed",
          toolName: action.tool,
          message: content,
          occurredAt: new Date()
        });
        return { resumed: true, runId: run.id };
      }
    }

    log.updateRun(run.id, { status: "completed", completedAt: new Date() });
    deps.eventBus.emitEvent({
      type: "copilot_run_updated",
      userId: input.userId,
      runId: run.id,
      conversationId: run.conversationId,
      status: "completed",
      message: input.approved ? "Action rejected" : "Action approved",
      occurredAt: new Date()
    });
    return { resumed: true, runId: run.id };
  }

  /** Cancel a non-terminal run; its pending actions are rejected. */
  async function cancelRun(input: { userId: string; runId: string }): Promise<{ cancelled: boolean; runId: string }> {
    const log = logFor(input.userId);
    const run = log.getRun(input.runId);
    if (!run || run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
      return { cancelled: false, runId: input.runId };
    }
    for (const action of log.listPendingActions(run.id)) {
      if (action.status === "pending") log.decidePendingAction(action.id, "rejected");
    }
    log.updateRun(run.id, { status: "cancelled", completedAt: new Date() });
    deps.eventBus.emitEvent({
      type: "copilot_run_updated",
      userId: input.userId,
      runId: run.id,
      conversationId: run.conversationId,
      status: "cancelled",
      message: "Run cancelled",
      occurredAt: new Date()
    });
    return { cancelled: true, runId: run.id };
  }

  return { runTurn, resumeAfterApproval, cancelRun };
}

function safeParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return {}; }
}

async function maybeAutoTitle(input: {
  log: CopilotConversationLog;
  userId: string;
  conversationId: string;
  userText: string;
  assistantText: string;
  source: "user" | "reactive";
  runId: string;
  eventBus: ForgeBadgerEventBus;
  llm: AgentLlmClient;
  modelId?: string;
}): Promise<void> {
  if (input.source !== "user") return;
  const conversation = input.log.getConversation(input.conversationId);
  if (!conversation || conversation.title !== null) return;
  try {
    const generated = await input.llm.generateTitle({
      userText: input.userText,
      assistantText: input.assistantText,
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {})
    });
    if (!generated) return;
    // Re-check the title right before writing — a parallel rename from the
    // owner (renameConversation endpoint) could have raced us between the
    // check above and now. Never overwrite an owner-set title.
    const fresh = input.log.getConversation(input.conversationId);
    if (!fresh || fresh.title !== null) return;
    input.log.renameConversation(input.conversationId, generated);
    input.eventBus.emitEvent({
      type: "copilot_run_updated",
      userId: input.userId,
      runId: input.runId,
      conversationId: input.conversationId,
      status: "completed",
      titleUpdated: generated,
      occurredAt: new Date()
    });
  } catch {
    // Auto-title is best-effort. A model failure must not surface as a Copilot
    // turn failure — the run already completed.
  }
}
