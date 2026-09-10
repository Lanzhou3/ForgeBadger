/**
 * Automation runner — executes one scheduled automation run as a read-only
 * Copilot turn and persists the generated content.
 *
 * Scheduled turns reuse the same orchestrator as user/reactive turns, so they
 * get the same security policy, audit log, and event stream. The only
 * difference is the tool surface: operate tools are stripped, so an unattended
 * turn can never park on an approval that no one will answer.
 */
import { CopilotConversationLog } from "../agent/conversation-log.js";
import { createAgentToolRegistry } from "../agent/tool-registry.js";
import { createPlatformTools } from "../agent/tools/index.js";
import type { AgentStackDeps } from "../agent/agent-stack.js";
import { buildAgentStack } from "../agent/agent-stack.js";
import type { Automation, AutomationRun } from "./automation-repository.js";
import { AutomationRepository } from "./automation-repository.js";
import { classifyAutomationFailure } from "./failure-classifier.js";
import { deliverAutomationResult, parseDeliveryPlan } from "./delivery.js";

export const AUTOMATION_CONVERSATION_TITLE = "Copilot 自动化";
export const AUTOMATION_CONVERSATION_ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A tool registry limited to read tools (operate tools are removed). */
export function createReadOnlyRegistry() {
  return createAgentToolRegistry(createPlatformTools().filter((tool) => tool.risk === "read" && tool.name !== "write_memory"));
}

export async function runAutomationTurn(deps: AgentStackDeps, automation: Automation, run: AutomationRun): Promise<void> {
  const repo = new AutomationRepository(deps.db, automation.userId, deps.masterKey);
  repo.markRunRunning(run.id);

  try {
    const stack = buildAgentStack(deps, automation.userId, { toolRegistry: createReadOnlyRegistry() });
    const conversationId = resolveAutomationConversation(stack.log, automation.userId);
    const prompt = buildAutomationPrompt(automation);

    const copilotRunId = await stack.orchestrator.runTurn({
      userId: automation.userId,
      conversationId,
      userText: prompt,
      source: "scheduled"
    });

    if (stack.log.getRun(copilotRunId)?.status !== "completed") throw new Error("COPILOT_AUTOMATION_NOT_COMPLETED");
    const content = lastAssistantText(stack.log, copilotRunId) ?? "";
    repo.completeRun(run.id, content);

    const delivery = parseDeliveryPlan(automation.deliveryPlan);
    deliverAutomationResult(deps.db, automation.userId, {
      automationId: automation.id,
      automationName: automation.name,
      content,
      notify: delivery.notify
    });
  } catch (error) {
    const failure = classifyAutomationFailure(error);
    repo.failRun(run.id, failure.code, failure.message);
  }
}

function resolveAutomationConversation(log: CopilotConversationLog, userId: string): string {
  const now = Date.now();
  const reusable = log.listConversations().find((row) =>
    row.title === AUTOMATION_CONVERSATION_TITLE && now - row.updated_at < AUTOMATION_CONVERSATION_ROLLING_WINDOW_MS
  );
  return reusable?.id ?? log.createConversation(AUTOMATION_CONVERSATION_TITLE).id;
}

function buildAutomationPrompt(automation: Automation): string {
  const lines = [
    automation.prompt,
    "",
    "请用只读工具查看平台当前状态，产出一段简洁的中文报告（2-4 段）：",
    "发生了什么、当前状态、以及任何需要我关注的事项。",
    "不要执行任何写操作；如果确实需要写操作，请明确列出并说明原因，我不会自动批准。"
  ];
  return lines.join("\n");
}

function lastAssistantText(log: CopilotConversationLog, runId: string): string | undefined {
  const messages = log.listRunMessages(runId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.kind === "text") return message.content;
  }
  return undefined;
}
