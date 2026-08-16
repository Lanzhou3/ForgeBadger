/**
 * Model-visible context construction for the Copilot harness.
 *
 * The conversation log is the source of truth; this module projects a
 * budget-bounded view of it for the LLM. When the text history exceeds
 * MAX_CONTEXT_CHARS, the older messages are folded into a rolling summary
 * (persisted on copilot_conversations) and only the recent tail is sent in
 * full, so long conversations stay within the model window. Summarize failures
 * degrade to the raw history rather than failing the turn.
 */
import type { AgentLlmClient, AgentLlmMessage } from "./orchestrator-types.js";
import type { CopilotConversationLog } from "./conversation-log.js";
import type { AgentMessage } from "./types.js";

export const MAX_CONTEXT_CHARS = 96_000;

export interface CompressedContext {
  messages: AgentLlmMessage[];
  /** True when a summary was folded in (or an existing one reused). */
  compressed: boolean;
}

/** Map a logged message to the model-visible form (user vs assistant text only). */
export function toLlmMessage(message: AgentMessage): AgentLlmMessage {
  return { role: message.role === "user" ? "user" : "assistant", content: message.content };
}

/**
 * Project the conversation's text history within the context budget. Returns
 * the raw history when it fits, otherwise a `[会话摘要]` block + the recent tail,
 * persisting the rolling summary so later overflows only fold new messages.
 */
export async function buildCompressedContext(
  log: CopilotConversationLog,
  conversationId: string,
  llm: AgentLlmClient,
  modelId?: string
): Promise<CompressedContext> {
  const rows = log.listMessages(conversationId).filter((message) => message.kind === "text");
  if (estimateChars(rows) <= MAX_CONTEXT_CHARS) {
    return { messages: rows.map(toLlmMessage), compressed: false };
  }

  const split = splitAtBudget(rows, MAX_CONTEXT_CHARS);
  const head = rows.slice(0, split);
  const tail = rows.slice(split);
  const conversation = log.getConversation(conversationId);
  const covered = conversation?.summary_covered_sequence ?? 0;
  const headUncovered = head.filter((message) => message.sequence > covered);
  const existingSummary = conversation?.summary ?? null;

  let summary = existingSummary ?? "";
  if (headUncovered.length > 0) {
    const toFold: AgentLlmMessage[] = [];
    if (existingSummary) {
      toFold.push({ role: "user", content: `Previous summary:\n${existingSummary}` });
    } else if (headUncovered[0]?.role !== "user") {
      // Anthropic requires the first message to be a user message.
      toFold.push({ role: "user", content: "Conversation start." });
    }
    toFold.push(...headUncovered.map(toLlmMessage));
    try {
      summary = await llm.summarize({ messages: toFold, ...(modelId !== undefined ? { modelId } : {}) });
    } catch {
      // Non-fatal: degrade to the raw history; the main turn decides if it errors.
      return { messages: rows.map(toLlmMessage), compressed: false };
    }
    const lastHead = headUncovered[headUncovered.length - 1] ?? head[head.length - 1];
    if (lastHead) {
      log.updateConversationSummary(conversationId, { summary, coveredSequence: lastHead.sequence });
    }
  }

  return { messages: [{ role: "user", content: `[会话摘要]\n${summary}` }, ...tail.map(toLlmMessage)], compressed: true };
}

function estimateChars(messages: AgentMessage[]): number {
  let total = 0;
  for (const message of messages) total += message.content.length + 8;
  return total;
}

/** Index of the first message to keep in the tail; everything before it is the head. */
function splitAtBudget(messages: AgentMessage[], budget: number): number {
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const cost = message.content.length + 8;
    if (used + cost > budget) return index + 1;
    used += cost;
  }
  return 0;
}
