export type CopilotProviderFormat = "openai" | "openai-compatible" | "anthropic";

export interface CopilotToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export type CopilotModelEvent =
  | { type: "assistant_message"; text: string }
  | { type: "tool_call_requested"; id: string; name: string; input: unknown }
  | { type: "run_failed"; code: string; message: string };

export interface CopilotModelRequest {
  model: string;
  instructions: string;
  input: string;
  tools?: CopilotToolDefinition[];
  maxOutputTokens?: number;
}

export interface CopilotModelRequestOptions {
  signal?: AbortSignal;
}

export interface CopilotModelClient {
  createResponse(request: CopilotModelRequest, options?: CopilotModelRequestOptions): Promise<CopilotModelEvent[]>;
}

export interface CopilotServiceError {
  code: string;
  message: string;
}
