/**
 * Model-visible context construction for the Copilot harness.
 *
 * The conversation log is the source of truth; this module projects a
 * budget-bounded view of it for the LLM. When the text history exceeds
 * MAX_CONTEXT_CHARS, the older messages are folded into a rolling summary
 * (persisted on copilot_conversations) and only the recent tail is sent in
 * full, so long conversations stay within the model window. Summarize failures
 * degrade to the raw history rather than failing the turn.
 *
 * Memory recall: when a memory repository is provided, a `[相关记忆]` block
 * built from an FTS search over the recent user text is prepended as the first
 * user message. It is per-turn only (not part of persisted history) and never
 * fails the turn.
 */
import type { AgentLlmClient, AgentLlmMessage } from "./orchestrator-types.js";
import type { CopilotConversationLog } from "./conversation-log.js";
import type { AgentMessage } from "./types.js";
import type { AgentMemoryRepository } from "./memory.js";

export const MAX_CONTEXT_CHARS = 96_000;
const MAX_RECALL_QUERY_CHARS = 512;
const DEFAULT_RECALL_LIMIT = 3;
const DEFAULT_RECALL_BUDGET_CHARS = 2_000;

export interface CompressedContext {
  messages: AgentLlmMessage[];
  /** True when a summary was folded in (or an existing one reused). */
  compressed: boolean;
}

export interface CompressedContextOptions {
  memory?: AgentMemoryRepository;
  memoryProjectId?: string;
  memoryProjectIds?: string[];
  excludeGlobalMemory?: boolean;
  memoryConversationId?: string;
  canCommit?: () => boolean;
  signal?: AbortSignal;
  memoryRecallLimit?: number;
  memoryRecallBudget?: number;
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
  modelId?: string,
  options: CompressedContextOptions = {}
): Promise<CompressedContext> {
  const rows = log.listMessages(conversationId);
  const sourceFingerprint = JSON.stringify(rows);
  const recall = buildRecallBlock(rows, options);

  if (estimateChars(rows) <= MAX_CONTEXT_CHARS) {
    const projected = projectTranscript(rows);
    return { messages: recall ? [recall, ...projected] : projected, compressed: false };
  }

  const split = splitAtBudget(rows, MAX_CONTEXT_CHARS);
  if (split === 0) {
    const projected = projectTranscript(rows);
    return { messages: recall ? [recall, ...projected] : projected, compressed: false };
  }
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
    toFold.push(...projectTranscript(headUncovered));
    try {
      summary = await llm.summarize({ messages: toFold, ...(modelId !== undefined ? { modelId } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    } catch {
      // Non-fatal: degrade to the raw history; the main turn decides if it errors.
      return { messages: recall ? [recall, ...projectTranscript(rows)] : projectTranscript(rows), compressed: false };
    }
    const lastHead = headUncovered[headUncovered.length - 1] ?? head[head.length - 1];
    if (lastHead) {
      log.updateConversationSummary(conversationId, { summary, coveredSequence: lastHead.sequence,
        expectedFingerprint: sourceFingerprint, ...(options.canCommit ? { canCommit: options.canCommit } : {}) });
    }
  }

  const summaryMessage: AgentLlmMessage = { role: "user", content: `[会话摘要]\n${summary}` };
  const tailProjected = projectTranscript(tail);
  return {
    messages: recall ? [recall, summaryMessage, ...tailProjected] : [summaryMessage, ...tailProjected],
    compressed: true
  };
}

/** Build the `[相关记忆]` recall block from the most recent user text, if any. */
function buildRecallBlock(rows: AgentMessage[], options: CompressedContextOptions): AgentLlmMessage | undefined {
  const memory = options.memory;
  if (!memory) return undefined;
  const query = recentUserText(rows);
  if (!query) return undefined;

  const limit = options.memoryRecallLimit ?? DEFAULT_RECALL_LIMIT;
  const budget = options.memoryRecallBudget ?? DEFAULT_RECALL_BUDGET_CHARS;
  const scopes = options.memoryProjectId
    ? [{ scope: "global" as const }, { scope: "project" as const, projectId: options.memoryProjectId }]
    : [{ scope: "global" as const }];
  const recallScopes: import("./memory.js").AgentMemoryScope[] = options.excludeGlobalMemory ? (options.memoryProjectIds ?? []).map(projectId => ({scope: "project" as const, projectId})) : scopes;
  if (options.memoryConversationId) recallScopes.push({ scope: "session", conversationId: options.memoryConversationId });
  const entries = memory.searchMulti(recallScopes, query, limit);
  if (entries.length === 0) return undefined;

  const lines = entries.map((entry) => `- (${entry.scope}/${entry.kind}) ${entry.text}`);
  let content = `[相关记忆]\n${lines.join("\n")}`;
  if (content.length > budget) content = `${content.slice(0, budget)}…`;
  return { role: "user", content };
}

function recentUserText(rows: AgentMessage[]): string | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = rows[index];
    if (message?.role !== "user") continue;
    return message.content.slice(0, MAX_RECALL_QUERY_CHARS);
  }
  return undefined;
}

function estimateChars(messages: AgentMessage[]): number {
  let total = 0;
  for (const message of messages) total += message.content.length + (message.toolInputJson?.length ?? 0) + 8;
  return total;
}

/** Index of the first message to keep in the tail; everything before it is the head. */
function splitAtBudget(messages: AgentMessage[], budget: number): number {
  let used = 0;
  let split = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    used += message.content.length + (message.toolInputJson?.length ?? 0) + 8;
    // Only split at complete user turns. Keep the newest turn even when it
    // alone exceeds the budget; never sever a tool invocation from its result.
    if (message.role === "user" && message.kind === "text") {
      if (used > budget && split < messages.length) return split;
      split = index;
    }
  }
  return 0;
}

/** Historical incomplete batches are observations, never executable calls. */
export function projectTranscript(rows: AgentMessage[]): AgentLlmMessage[] {
  const messages: AgentLlmMessage[] = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index]!;
    if (row.kind !== "tool_call") {
      if (row.kind === "text") messages.push(toLlmMessage(row));
      else if (row.kind === "tool_result" || row.kind === "error") messages.push(historicalObservation(row));
      index += 1;
      continue;
    }
    const calls: AgentMessage[] = [];
    while (rows[index]?.kind === "tool_call") calls.push(rows[index++]!);
    const results: AgentMessage[] = [];
    while (rows[index]?.kind === "tool_result" || rows[index]?.kind === "pending_action") {
      if (rows[index]?.kind === "tool_result") results.push(rows[index]!);
      index += 1;
    }
    const ids = new Set(calls.map((call) => call.toolCallId));
    const complete = ids.size === calls.length && calls.every((call) => call.toolCallId && call.toolName
      && results.filter((result) => result.toolCallId === call.toolCallId).length === 1)
      && results.length === calls.length;
    if (!complete) {
      messages.push(...calls.map(historicalObservation), ...results.map(historicalObservation));
      continue;
    }
    messages.push({ role: "assistant", content: "", toolCalls: calls.map((call) => ({
      id: call.toolCallId!, name: call.toolName!, arguments: call.toolInputJson ?? "{}"
    })) });
    messages.push(...calls.map((call): AgentLlmMessage => ({ role: "tool", toolCallId: call.toolCallId!,
      content: results.find((result) => result.toolCallId === call.toolCallId)!.content })));
  }
  return messages;
}

function historicalObservation(row: AgentMessage): AgentLlmMessage {
  return { role: "assistant", content: `[Historical ${row.kind}; observation only] ${row.toolName ?? ""} ${row.toolInputJson ?? ""} ${row.content}` };
}
