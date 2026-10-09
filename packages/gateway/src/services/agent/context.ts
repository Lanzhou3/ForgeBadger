/**
 * Model-visible context construction for the Copilot harness.
 *
 * The conversation log is the source of truth; this module projects a
 * budget-bounded view of it for the LLM. When the estimated token footprint
 * exceeds MAX_CONTEXT_TOKENS, the older messages are folded into a rolling
 * summary (persisted on copilot_conversations) and only the recent tail is
 * sent in full. The estimate includes tools and immutable context.
 * Summarize failures fall back to bounded projection.
 *
 * Memory recall: when a memory repository is provided, a `[相关记忆]` block
 * built from an FTS search over the recent user text is prepended as the first
 * user message. It is per-turn only (not part of persisted history) and never
 * fails the turn.
 */
import type { AgentLlmClient, AgentLlmMessage } from "./orchestrator-types.js";
import type { CopilotConversationLog } from "./conversation-log.js";
import type { AgentMessage } from "./types.js";
import { AgentError } from './types.js';
import type { AgentMemoryRepository } from "./memory.js";
import { estimateJsonTokens, estimateTextTokens, MAX_CONTEXT_TOKENS, messageWireTokens } from './token-estimate.js';

export { MAX_CONTEXT_TOKENS } from './token-estimate.js';
const MAX_RECALL_QUERY_CHARS = 512;
const DEFAULT_RECALL_LIMIT = 3;
const DEFAULT_RECALL_BUDGET_CHARS = 2_000;

export interface CompressedContext {
  messages: AgentLlmMessage[];
  /** True when a summary was folded in (or an existing one reused). */
  compressed: boolean;
}

export interface CompressedContextOptions {
  /** Optional live observations; never displace conversation evidence or trigger compression. */
  observations?: AgentLlmMessage[];
  /** Overflow recovery must stop if summarization cannot preserve the old head. */
  strictCompression?: boolean;
  /** Estimated-token bound, not a provider token guarantee. */
  maxContextTokens?: number;
  /** Internal complete assistant responses, keyed by their persisted transcript rows. */
  assistantMessages?: ReadonlyMap<string, AgentLlmMessage>;
  /** Reserved token allowance for immutable request overhead. */
  reservedTokens?: number;
  tools?: unknown[];
  /** Immutable system-adjacent Skills/project context; returned in messages. */
  prefixMessages?: AgentLlmMessage[];
  memory?: AgentMemoryRepository;
  memoryProjectId?: string;
  memoryConversationId?: string;
  /** Channel context recalls only its bound project/session, never owner-global memory. */
  memoryGlobalAllowed?: boolean;
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
  const result = await buildBaseContext(log, conversationId, llm, modelId, options);
  for (const observation of options.observations ?? []) {
    const messages = assemble([], result.messages, observation);
    if (fits(messages, options)) result.messages = messages;
  }
  return result;
}

async function buildBaseContext(
  log: CopilotConversationLog,
  conversationId: string,
  llm: AgentLlmClient,
  modelId?: string,
  options: CompressedContextOptions = {}
): Promise<CompressedContext> {
  const rows = log.listMessages(conversationId);
  const sourceFingerprint = JSON.stringify(rows);
  let recall: AgentLlmMessage | undefined;
  try { recall = buildRecallBlock(rows, options); } catch { /* Optional recall must not fail the turn. */ }

  const prefix = options.prefixMessages ?? [];
  const initial = projectTranscript(rows, options.assistantMessages);
  if (fits(assemble(prefix, initial, recall), options)) {
    return { messages: assemble(prefix, initial, recall), compressed: false };
  }
  // Fail before calling the summarizer if immutable instructions or the current
  // user goal cannot fit. No user instruction is silently cut.
  boundedProjection(rows, prefix, options);
  const split = splitAtBudget(rows, Math.max(0, (options.maxContextTokens ?? MAX_CONTEXT_TOKENS)
    - requestSize(prefix, options) - 1024), options.assistantMessages);
  if (split === 0) return { messages: boundedProjection(rows, prefix, options, recall), compressed: true };
  const head = rows.slice(0, split);
  const tail = rows.slice(split);
  const conversation = log.getConversation(conversationId);
  const covered = conversation?.summary_covered_sequence ?? 0;
  const headUncovered = head.filter((message) => message.sequence > covered);
  const existingSummary = conversation?.summary ?? null;

  let summary = existingSummary ?? "";
  if (headUncovered.length > 0) {
    try {
      // Fold contiguous complete turns in batches. Never mark discarded turns as covered.
      for (const batch of summaryBatches(headUncovered, options)) {
        options.signal?.throwIfAborted();
        assertContextAuthority(options);
        const prefix: AgentLlmMessage[] = summary
          ? [{ role: 'user', content: `Previous summary:\n${summary.slice(0, 4096)}` }]
          : batch[0]?.role !== 'user' ? [{ role: 'user', content: 'Conversation start.' }] : [];
        const messages = boundedProjection(batch, prefix, {
          maxContextTokens: options.maxContextTokens ?? MAX_CONTEXT_TOKENS,
          reservedTokens: Math.max(options.reservedTokens ?? 0, 1024)
        });
        const next = await llm.summarize({ messages, ...(modelId !== undefined ? { modelId } : {}),
          ...(options.signal ? { signal: options.signal } : {}) });
        assertContextAuthority(options);
        if (!next.trim()) throw new Error('COPILOT_EMPTY_SUMMARY');
        summary = next.slice(0, 4096);
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (error instanceof AgentError && error.code === 'COPILOT_LEASE_LOST') throw error;
      if (options.strictCompression) throw error;
      return { messages: boundedProjection(rows, prefix, options, recall), compressed: true };
    }
    summary = summary.slice(0, 4096);
    const lastHead = headUncovered[headUncovered.length - 1] ?? head[head.length - 1];
    if (lastHead) {
      log.updateConversationSummary(conversationId, { summary, coveredSequence: lastHead.sequence,
        expectedFingerprint: sourceFingerprint, ...(options.canCommit ? { canCommit: options.canCommit } : {}) });
    }
  }

  const summaryMessage: AgentLlmMessage = { role: "user", content: `[会话摘要]\n${summary.slice(0, 4096)}` };
  return { messages: boundedProjection(tail, prefix, options, recall, summaryMessage), compressed: true };
}

function assertContextAuthority(options: CompressedContextOptions): void {
  options.signal?.throwIfAborted();
  if (options.canCommit && !options.canCommit())
    throw new AgentError('COPILOT_LEASE_LOST','COPILOT_LEASE_LOST: context execution authority changed');
}

/** Batch only at user-turn boundaries, leaving room for the rolling summary. */
function summaryBatches(rows: AgentMessage[], options: CompressedContextOptions): AgentMessage[][] {
  const turns: AgentMessage[][] = [];
  for (const row of rows) {
    if (!turns.length || (row.role === 'user' && row.kind === 'text')) turns.push([]);
    turns[turns.length - 1]!.push(row);
  }
  const budget = Math.max(1, (options.maxContextTokens ?? MAX_CONTEXT_TOKENS)
    - Math.max(options.reservedTokens ?? 0, 1024) - 2048);
  const batches: AgentMessage[][] = [];
  let batch: AgentMessage[] = [];
  for (const turn of turns) {
    if (batch.length && estimateTextTokens(JSON.stringify(projectTranscript([...batch, ...turn]))) > budget) {
      batches.push(batch); batch = [];
    }
    batch.push(...turn);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Build the `[相关记忆]` recall block from the most recent user text, if any. */
function buildRecallBlock(rows: AgentMessage[], options: CompressedContextOptions): AgentLlmMessage | undefined {
  const memory = options.memory;
  if (!memory) return undefined;
  const query = recentUserText(rows);
  if (!query) return undefined;

  const limit = options.memoryRecallLimit ?? DEFAULT_RECALL_LIMIT;
  const budget = options.memoryRecallBudget ?? DEFAULT_RECALL_BUDGET_CHARS;
  const scopes: import("./memory.js").AgentMemoryScope[] = options.memoryProjectId
    ? [{ scope: "global" as const }, { scope: "project" as const, projectId: options.memoryProjectId }]
    : [{ scope: "global" as const }];
  if (options.memoryGlobalAllowed === false) scopes.splice(0, 1);
  if (options.memoryConversationId) scopes.push({ scope: "session", conversationId: options.memoryConversationId });
  const entries = memory.searchMulti(scopes, query, limit);
  if (entries.length === 0) return undefined;

  let content = '[相关记忆]\n';
  for (const entry of entries) {
    const line = `- (${entry.scope}/${entry.kind}; id=${entry.id}) ${entry.text}\n`;
    if (content.length + line.length <= budget) content += line;
  }
  if (content === '[相关记忆]\n') return undefined;
  return { role: "user", content };
}

/** Keep historical prefixes stable; never insert inside a tool call/result batch. */
function assemble(prefix: AgentLlmMessage[], history: AgentLlmMessage[], recall?: AgentLlmMessage): AgentLlmMessage[] {
  if (!recall) return [...prefix, ...history];
  let latest = -1;
  for (let i = history.length - 1; i >= 0; i--) if (history[i]!.role === 'user') { latest = i; break; }
  const index = history[0]?.role === 'assistant' ? 0 : Math.max(0, latest);
  return [...prefix, ...history.slice(0,index), recall, ...history.slice(index)];
}

function recentUserText(rows: AgentMessage[]): string | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = rows[index];
    if (message?.role !== "user") continue;
    return message.content.slice(0, MAX_RECALL_QUERY_CHARS);
  }
  return undefined;
}

/** Index of the first message to keep in the tail; everything before it is the head. */
function splitAtBudget(messages: AgentMessage[], budget: number, assistants?: ReadonlyMap<string, AgentLlmMessage>): number {
  const counted = new Set<AgentLlmMessage>();
  let used = 0;
  let split = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const original = assistants?.get(message.id);
    if (original) {
      if (!counted.has(original)) used += messageWireTokens(original);
      counted.add(original);
    } else used += messageWireTokens(toLlmMessage(message));
    // Only split at complete user turns. Keep the newest turn even when it
    // alone exceeds the budget; never sever a tool invocation from its result.
    // Compare in margin-adjusted token units so the tail fits under fits().
    if (message.role === "user" && message.kind === "text") {
      if (Math.ceil((used * 6) / 5) > budget && split < messages.length) return split;
      split = index;
    }
  }
  return 0;
}

/** Historical incomplete batches are observations, never executable calls. */
export function projectTranscript(rows: AgentMessage[], assistants?: ReadonlyMap<string, AgentLlmMessage>): AgentLlmMessage[] {
  const messages: AgentLlmMessage[] = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index]!;
    if (row.kind !== "tool_call") {
      if (row.kind === "text") {
        const original = assistants?.get(row.id);
        const followedByOwnCalls = original?.toolCalls?.length && rows[index + 1]?.kind === "tool_call"
          && assistants?.get(rows[index + 1]!.id) === original;
        if (!followedByOwnCalls) messages.push(original && !original.toolCalls?.length ? original : toLlmMessage(row));
      }
      else if (row.kind === "tool_result" || row.kind === "error") messages.push(historicalObservation(row));
      index += 1;
      continue;
    }
    const previous = rows[index - 1];
    const original = assistants?.get(row.id);
    const calls: AgentMessage[] = [];
    while (rows[index]?.kind === "tool_call") calls.push(rows[index++]!);
    const results: AgentMessage[] = [];
    while (rows[index]?.kind === "tool_result" || rows[index]?.kind === "pending_action") {
      if (rows[index]?.kind === "tool_result") results.push(rows[index]!);
      index += 1;
    }
    const ids = new Set(calls.map((call) => call.toolCallId));
    const complete = ids.size === calls.length && calls.every((call) => call.toolCallId && call.toolName
      && results.filter((result) => result.toolCallId === call.toolCallId
        && (!call.runId || (result.runId === call.runId && result.stepId === call.stepId))).length === 1)
      && results.length === calls.length;
    if (!complete) {
      if (original && previous?.kind === "text" && assistants?.get(previous.id) === original) messages.push(toLlmMessage(previous));
      messages.push(...calls.map(historicalObservation), ...results.map(historicalObservation));
      continue;
    }
    const replay = original && original.toolCalls?.length === calls.length
      && calls.every(call => assistants?.get(call.id) === original) ? original : undefined;
    messages.push(replay ?? { role: "assistant", content: "", toolCalls: calls.map((call) => ({
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

function requestSize(messages: AgentLlmMessage[], options: CompressedContextOptions): number {
  // Serialized-form estimate, matching the final wire guard's unit of measure.
  return estimateJsonTokens({ messages, tools: options.tools ?? [] }) + (options.reservedTokens ?? 0);
}
function fits(messages: AgentLlmMessage[], options: CompressedContextOptions): boolean {
  return requestSize(messages, options) <= (options.maxContextTokens ?? MAX_CONTEXT_TOKENS);
}
/** Drop only whole turns; compact content, never tool argument JSON or call IDs. */
function boundedProjection(rows: AgentMessage[], prefix: AgentLlmMessage[], options: CompressedContextOptions,
  recall?: AgentLlmMessage, summary?: AgentLlmMessage): AgentLlmMessage[] {
  const latest = [...rows].reverse().find(row => row.role === 'user' && row.kind === 'text');
  if (!fits([...prefix, ...(latest ? [toLlmMessage(latest)] : [])], options)) {
    throw new Error('COPILOT_CONTEXT_TOO_LARGE: immutable context or latest user goal exceeds budget');
  }
  let selected = rows;
  const adjuncts = [...(summary ? [summary] : [])];
  let projected = assemble([...prefix, ...adjuncts], projectTranscript(selected, options.assistantMessages), recall);
  if (fits(projected, options)) return projected;
  // Reduce optional recall before touching conversation evidence.
  for (let limit = 8192; limit >= 128; limit = Math.floor(limit / 2)) {
    projected = [...prefix, ...adjuncts, ...projectTranscript(selected.map(row => compactRow(row, latest?.id, limit, options.assistantMessages)), options.assistantMessages)];
    if (fits(projected, options)) return projected;
  }
  while (selected.length) {
    const next = selected.findIndex((row, index) => index > 0 && row.role === 'user' && row.kind === 'text');
    if (next < 0) break;
    selected = selected.slice(next);
    projected = [...prefix, ...adjuncts, ...projectTranscript(selected.map(row => compactRow(row, latest?.id, 128, options.assistantMessages)), options.assistantMessages)];
    if (fits(projected, options)) return projected;
  }
  // Optional summaries may themselves consume the remainder. Keep the latest
  // complete tool batch and latest goal rather than sending malformed fragments.
  projected = [...prefix, ...projectTranscript(selected.map(row => compactRow(row, latest?.id, 128, options.assistantMessages)), options.assistantMessages)];
  if (fits(projected, options)) return projected;
  throw new Error('COPILOT_CONTEXT_TOO_LARGE: correlated tool calls cannot fit request budget');
}
function compactRow(row: AgentMessage, latestId: string | undefined, limit: number, assistants?: ReadonlyMap<string, AgentLlmMessage>): AgentMessage {
  if (assistants?.has(row.id) || row.id === latestId || row.kind === 'tool_call' || row.content.length <= limit) return row;
  const content = row.kind === 'tool_result'
    ? JSON.stringify({ contextTruncated: true, preview: row.content.slice(0, limit),
      readback: { tool: 'read_tool_result', messageId: row.id },
      evidence: 'Persisted receipt only; original output may already be truncated. Access is revalidated.' })
    : `${row.content.slice(0, limit)}\n[Earlier context truncated]`;
  return {...row,content};
}
