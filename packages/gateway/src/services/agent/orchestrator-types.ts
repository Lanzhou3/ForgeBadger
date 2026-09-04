/**
 * The LLM client seam the orchestrator depends on. Defined as an interface so
 * the orchestrator is decoupled from any concrete provider client; the
 * provider-agnostic implementation lives in llm-client.ts.
 */
export interface AgentLlmMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface AgentLlmToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentLlmStreamEvent {
  type: "text_delta" | "thinking_delta" | "tool_call" | "done";
  text?: string;
  toolCall?: { id: string; name: string; arguments: string };
  message?: string;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AgentLlmClient {
  stream(request: {
    messages: AgentLlmMessage[];
    tools: AgentLlmToolSchema[];
    modelId?: string;
    system?: string;
    onEvent: (event: AgentLlmStreamEvent) => void;
  }): Promise<{ message: string }>;
  /** Fold a message list into a concise summary (context compression). */
  summarize(input: { messages: AgentLlmMessage[]; modelId?: string }): Promise<string>;
  /** Generate a short conversation title from the first user/assistant exchange. */
  generateTitle(input: { userText: string; assistantText: string; modelId?: string }): Promise<string>;
  /** Propose durable memory entries from a completed turn (memory curation). */
  proposeMemory(input: { userText: string; assistantText: string; modelId?: string }): Promise<Array<{
    kind: "fact" | "preference" | "decision" | "project_note";
    scope: "global" | "project" | "session";
    text: string;
    projectId?: string;
  }>>;
}
