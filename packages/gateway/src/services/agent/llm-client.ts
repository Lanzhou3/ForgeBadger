/**
 * Provider-agnostic LLM client for the Copilot harness.
 *
 * Resolves a provider + model from the platform's model system
 * (ModelProviderRepository / model_profiles / provider_credentials — the single
 * source of truth), validates the outbound host against the SSRF policy, and
 * streams Anthropic Messages or OpenAI-compatible Chat Completions responses
 * with tool calling. Secrets are decrypted in memory and never logged.
 */
import { lookup } from "node:dns/promises";
import type { ModelProviderRepository, ProviderApiFormat } from "../../db/repositories/model-provider-repository.js";
import { validateOutboundHost } from "../network-policy.js";
import { AgentError } from "./types.js";
import { redactAgentErrorMessage } from "./redaction.js";

export interface AgentLlmMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Tool call id, when role === "tool". */
  toolCallId?: string;
  /** Tool calls emitted by the assistant, when role === "assistant". */
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface AgentToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentLlmStreamEvent {
  type: "text_delta" | "tool_call" | "done";
  text?: string;
  toolCall?: { id: string; name: string; arguments: string };
  message?: string;
}

export interface AgentLlmRequest {
  messages: AgentLlmMessage[];
  tools: AgentToolSchema[];
  maxSteps?: number;
  modelId?: string;
  signal?: AbortSignal;
  onEvent: (event: AgentLlmStreamEvent) => void;
}

export interface AgentLlmProviderResolution {
  modelProfileId: string;
  providerKey: string;
  modelId: string;
  apiFormat: ProviderApiFormat;
  baseUrl: string;
  apiKey: string;
  authType: "api_key" | "bearer_token" | "oauth" | "none";
  defaultHeaders: Record<string, string>;
}

const DEFAULT_MAX_STEPS = 24;
const DEFAULT_TIMEOUT_MS = 60_000;

export type AgentFetch = typeof fetch;

export function createAgentLlmClient(input: {
  modelProviderRepository: ModelProviderRepository;
  fetchImpl?: AgentFetch;
  resolveHost?: (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>;
  timeoutMs?: number;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const resolveHost = input.resolveHost ?? lookup;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Resolve a model profile to a concrete provider resolution. */
  function resolveProvider(modelId?: string): AgentLlmProviderResolution {
    const repo = input.modelProviderRepository;
    const profile = modelId ? repo.getModelProfile(modelId) : repo.listModelProfiles().find((m) => m.isDefault) ?? repo.listModelProfiles()[0];
    if (!profile) throw new AgentError("AGENT_NO_MODEL", "No model provider configured");
    if (profile.status !== "active") throw new AgentError("AGENT_MODEL_INACTIVE", "Model is not active");
    const provider = repo.getProviderProfile(profile.providerProfileId);
    if (!provider || provider.status !== "active") throw new AgentError("AGENT_PROVIDER_INACTIVE", "Provider is not active");
    const credentials = repo.listCredentials(profile.providerProfileId);
    const credential = credentials[0];
    if (!credential || credential.status !== "active") throw new AgentError("AGENT_NO_CREDENTIAL", "No active provider credential");
    const apiKey = repo.decryptCredential(credential.id);
    const baseUrl = pickBaseUrl(provider.apiFormat, provider.anthropicBaseUrl ?? profile.baseUrl, provider.openaiBaseUrl ?? profile.baseUrl);
    if (!baseUrl) throw new AgentError("AGENT_NO_BASE_URL", "Provider has no base URL");
    return {
      modelProfileId: profile.id,
      providerKey: provider.providerKey,
      modelId: profile.modelId,
      apiFormat: provider.apiFormat,
      baseUrl: baseUrl.replace(/\/+$/u, ""),
      apiKey,
      authType: provider.authType,
      defaultHeaders: provider.defaultHeaders
    };
  }

  /** Stream one model request; emits text/tool deltas. Resolves on completion. */
  async function stream(request: AgentLlmRequest): Promise<{ message: string }> {
    const resolution = resolveProvider(request.modelId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const outer = request.signal;
    if (outer?.aborted) controller.abort();
    outer?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const host = new URL(resolution.baseUrl).hostname;
      const blocked = await validateOutboundHost(host, resolveHost);
      if (blocked) throw new AgentError("AGENT_HOST_BLOCKED", `Outbound host blocked: ${blocked}`);

      const maxSteps = request.maxSteps ?? DEFAULT_MAX_STEPS;
      if (resolution.apiFormat === "anthropic") {
        return await streamAnthropic(resolution, request, maxSteps, fetchImpl, controller.signal, input.timeoutMs);
      }
      return await streamOpenAi(resolution, request, maxSteps, fetchImpl, controller.signal, input.timeoutMs);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError("AGENT_LLM_FAILED", redactAgentErrorMessage(error instanceof Error ? error.message : "LLM request failed"));
    } finally {
      clearTimeout(timeout);
      outer?.removeEventListener("abort", () => controller.abort());
    }
  }

  return { resolveProvider, stream };
}

function pickBaseUrl(format: ProviderApiFormat, anthropicUrl: string | null, openaiUrl: string | null): string | null {
  if (format === "anthropic") return anthropicUrl ?? openaiUrl;
  return openaiUrl ?? anthropicUrl;
}

function authHeaders(resolution: AgentLlmProviderResolution): Record<string, string> {
  const headers: Record<string, string> = {};
  if (resolution.authType === "none") return headers;
  const scheme = resolution.authType === "bearer_token" ? "Bearer" : "Bearer";
  headers.Authorization = `${scheme} ${resolution.apiKey}`;
  return headers;
}

async function streamAnthropic(
  resolution: AgentLlmProviderResolution,
  request: AgentLlmRequest,
  maxSteps: number,
  fetchImpl: AgentFetch,
  signal: AbortSignal,
  timeoutMs: number | undefined
): Promise<{ message: string }> {
  const system = buildSystemPrompt();
  const apiMessages = request.messages
    .filter((m) => m.role !== "tool")
    .map((m) => (m.role === "assistant"
      ? { role: "assistant" as const, content: m.content, ...(m.toolCalls?.length ? { tool_use: m.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, input: safeJsonParse(tc.arguments) })) } : {}) }
      : { role: "user" as const, content: m.content }));

  const body: Record<string, unknown> = {
    model: resolution.modelId,
    max_tokens: 8192,
    system,
    messages: apiMessages,
    tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
  };
  if (maxSteps) body.max_steps = maxSteps;

  const response = await fetchImpl(`${resolution.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": resolution.apiKey,
      "anthropic-version": "2023-06-01",
      ...authHeaders(resolution),
      ...resolution.defaultHeaders
    },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) throw new AgentError("AGENT_HTTP_ERROR", await readError(response));

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string; name?: string; id?: string; input?: unknown }>;
    stop_reason?: string;
  };
  let message = "";
  for (const block of data.content ?? []) {
    if (block.type === "text" && block.text) {
      message += block.text;
      request.onEvent({ type: "text_delta", text: block.text });
    } else if (block.type === "tool_use" && block.name) {
      const tc = { id: block.id ?? crypto.randomUUID(), name: block.name, arguments: JSON.stringify(block.input ?? {}) };
      request.onEvent({ type: "tool_call", toolCall: tc });
    }
  }
  request.onEvent({ type: "done", message });
  return { message };
}

async function streamOpenAi(
  resolution: AgentLlmProviderResolution,
  request: AgentLlmRequest,
  maxSteps: number,
  fetchImpl: AgentFetch,
  signal: AbortSignal,
  timeoutMs: number | undefined
): Promise<{ message: string }> {
  const apiMessages = request.messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool" as const, tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.arguments } }))
      };
    }
    return { role: m.role as "user" | "assistant", content: m.content };
  });

  const body: Record<string, unknown> = {
    model: resolution.modelId,
    messages: apiMessages,
    tools: request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
  };
  if (maxSteps) body.max_steps = maxSteps;

  const response = await fetchImpl(`${resolution.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(resolution),
      ...resolution.defaultHeaders
    },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) throw new AgentError("AGENT_HTTP_ERROR", await readError(response));

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
  };
  const choice = data.choices?.[0];
  let message = choice?.message?.content ?? "";
  for (const tc of choice?.message?.tool_calls ?? []) {
    request.onEvent({ type: "tool_call", toolCall: { id: tc.id, name: tc.function.name, arguments: tc.function.arguments } });
  }
  if (message) request.onEvent({ type: "text_delta", text: message });
  request.onEvent({ type: "done", message });
  return { message };
}

function buildSystemPrompt(): string {
  return [
    "You are Copilot, the platform agent for OpenForge.",
    "You can observe and operate the whole platform through the provided tools:",
    "- projects: list and inspect projects",
    "- sessions: list and inspect AI CLI sessions",
    "- portfolio: read portfolio progress (requests, work items, dossiers)",
    "- memory: read/write scoped memory (global, project, session)",
    "",
    "Be concise. When you need to take an operate action, request it and it will be",
    "approved by the owner before it executes. Never claim a write happened until",
    "the tool result confirms it."
  ].join("\n");
}

function safeJsonParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return {}; }
}

async function readError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return `Provider returned ${response.status}: ${text.slice(0, 500)}`;
  } catch {
    return `Provider returned ${response.status}`;
  }
}

export function toolSchemaToModelFormat(tool: { name: string; description: string; inputSchema: Record<string, unknown> }): AgentToolSchema {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}
