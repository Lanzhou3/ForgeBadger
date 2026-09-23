import { matchingReplay, replayIdentity, withoutPrivateReplay } from "./llm-replay.js";
import type { ProviderReplay } from "./llm-replay.js";
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
import type { ModelProviderRepository, ModelProfile, ProviderApiFormat } from "../../db/repositories/model-provider-repository.js";
import type { CopilotPreferences, ThinkingEffort } from "../../db/repositories/copilot-preferences-repository.js";
import { assertResolvedPublicHttpsEndpoint } from "../network-policy.js";
import { AgentError } from "./types.js";
import { redactAgentErrorMessage } from "./redaction.js";
import { createAgentPublicFetch } from "./llm-public-fetch.js";
import { readOpenAiCompletion } from "./llm-openai.js";
import { readAnthropicCompletion } from "./llm-anthropic.js";
import { withAbort, type LlmResult, type LlmUsage } from "./llm-response.js";
import { MAX_CONTEXT_CHARS } from "./context.js";

export interface AgentLlmMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  providerReplay?: ProviderReplay;
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
  type: "text_delta" | "thinking_delta" | "tool_call" | "done";
  text?: string;
  toolCall?: { id: string; name: string; arguments: string };
  message?: string;
  finishReason?: string;
  usage?: LlmUsage;
}

export interface AgentLlmRequest {
  messages: AgentLlmMessage[];
  tools: AgentToolSchema[];
  maxSteps?: number;
  modelId?: string;
  /** System prompt override; defaults to the Copilot agent prompt. */
  system?: string;
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
  allowPlaintextHttp?: boolean;
  allowPrivateNetworks?: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export type AgentFetch = typeof fetch;

export function createAgentLlmClient(input: {
  modelProviderRepository: ModelProviderRepository;
  fetchImpl?: AgentFetch;
  resolveHost?: (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>;
  timeoutMs?: number;
  /**
   * The user's Copilot preferences (model + thinking strength). When a
   * request carries no explicit modelId, the preferred model is the first
   * fallback before the system default.
   */
  preferences?: { get(): CopilotPreferences } | undefined;
}) {
  const resolveHost = input.resolveHost ?? lookup;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Per-client resolution cache. The client is constructed per user per stack,
  // so a cached resolution lives only for the current turn/stack — this avoids
  // re-decrypting credentials across the step loop and the summarize/title/
  // curation calls that each resolve independently.
  const resolutionCache = new Map<string, AgentLlmProviderResolution>();

  /** Resolve a model profile to a concrete provider resolution. */
  function resolveProvider(modelId?: string): AgentLlmProviderResolution {
    const repo = input.modelProviderRepository;
    let profile: ModelProfile | undefined;
    let fromPreference = false;
    if (modelId) {
      profile = repo.getModelProfile(modelId);
    } else {
      // Preference fallback: the user's chosen Copilot model, resolved fresh
      // on every call because it can change at any time (never cached).
      const preferredModelId = input.preferences?.get().modelId;
      if (preferredModelId) {
        const preferred = repo.getModelProfile(preferredModelId);
        if (preferred && preferred.status === "active") {
          profile = preferred;
          fromPreference = true;
        }
      }
      if (!profile) {
        const profiles = repo.listModelProfiles();
        profile = profiles.find((m) => m.isDefault) ?? profiles[0];
      }
    }
    const cacheKey = modelId ?? "__default__";
    if (profile && !fromPreference) {
      const cached = resolutionCache.get(cacheKey);
      if (cached) return cached;
    }
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
    const resolution: AgentLlmProviderResolution = {
      modelProfileId: profile.id,
      providerKey: provider.providerKey,
      modelId: profile.modelId,
      apiFormat: provider.apiFormat,
      baseUrl: baseUrl.replace(/\/+$/u, ""),
      apiKey,
      authType: provider.authType,
      defaultHeaders: provider.defaultHeaders,
      allowPlaintextHttp: provider.allowPlaintextHttp,
      allowPrivateNetworks: provider.allowPrivateNetworks
    };
    if (!fromPreference) resolutionCache.set(cacheKey, resolution);
    return resolution;
  }

  /** Stream one model request; emits text/tool deltas. Resolves on completion. */
  async function stream(request: AgentLlmRequest): Promise<LlmResult> {
    return streamInternal(request, true);
  }

  /**
   * Internal stream implementation. `applyPreferencesThinking` gates the
   * user's thinking-strength preference: the main conversational request
   * applies it, while the auxiliary calls (summarize / title / memory
   * proposal) keep their requests lean. The model fallback to the preference
   * applies on every path — only the thinking parameters are gated.
   */
  async function streamInternal(request: AgentLlmRequest, applyPreferencesThinking: boolean): Promise<LlmResult> {
    const resolution = resolveProvider(request.modelId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const outer = request.signal;
    if (outer?.aborted) controller.abort();
    const abort = () => controller.abort();
    outer?.addEventListener("abort", abort, { once: true });
    // Declared before the try so the 400-compatibility retry in the catch
    // below can see whether thinking parameters were applied to this request.
    const thinkingEffort = applyPreferencesThinking ? input.preferences?.get().thinkingEffort ?? null : null;
    try {
      controller.signal.throwIfAborted();
      if (input.fetchImpl) {
        try {
          await withAbort(assertResolvedPublicHttpsEndpoint(resolution.baseUrl, resolveHost, { allowPlaintextHttp: resolution.allowPlaintextHttp, allowPrivateNetworks: resolution.allowPrivateNetworks }), controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          throw new AgentError("AGENT_HOST_BLOCKED", "Provider endpoint failed public-network validation");
        }
      }
      const fetchImpl = input.fetchImpl ?? createAgentPublicFetch({ resolveHost, allowPlaintextHttp: resolution.allowPlaintextHttp ?? false, allowPrivateNetworks: resolution.allowPrivateNetworks ?? false });
      const result = resolution.apiFormat === "anthropic"
        ? await streamAnthropic(resolution, request, fetchImpl, controller.signal, thinkingEffort)
        : await streamOpenAi(resolution, request, fetchImpl, controller.signal, thinkingEffort);
      if (result.assistant) {
        result.assistant.providerReplay ??= { format: resolution.apiFormat === 'anthropic' ? 'anthropic' : 'openai' };
        result.assistant.providerReplay.identity = replayIdentity(resolution);
      }
      return result;
    } catch (error) {
      // Protocol-level compatibility fallback (COPILOT-MODEL-SELECTION-PLAN
      // §4.1): providers 400 on thinking parameters when the model does not
      // support them (non-reasoning OpenAI-compatible models, Anthropic
      // max_tokens caps, thinking+tools restrictions). A 400 arrives before
      // any streamed byte, so retrying once with thinking disabled degrades
      // the turn to plain mode instead of failing it. A user-visible notice
      // ships with the model-declared thinking levels; the retry is silent.
      if (
        thinkingEffort !== null && thinkingEffort !== "off"
        && error instanceof AgentError && error.code === "AGENT_HTTP_ERROR" && error.message.includes("HTTP 400")
      ) {
        return streamInternal(request, false);
      }
      if (error instanceof AgentError) throw error;
      throw new AgentError("AGENT_LLM_FAILED", redactAgentErrorMessage(error instanceof Error ? error.message : "LLM request failed"));
    } finally {
      clearTimeout(timeout);
      outer?.removeEventListener("abort", abort);
    }
  }

  /** Fold a message list into a concise summary (non-streaming; used for context compression). */
  async function summarize(input: { messages: AgentLlmMessage[]; modelId?: string; signal?: AbortSignal }): Promise<string> {
    let text = "";
    await streamInternal({
      messages: input.messages.map(withoutPrivateReplay),
      tools: [],
      system: SUMMARY_SYSTEM_PROMPT,
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      onEvent: (event) => {
        if (event.type === "text_delta") text += event.text ?? "";
      }
    }, false);
    return text.trim();
  }

  /**
   * Generate a short conversation title from the first user message. Used after
   * a conversation's first completed turn so the sidebar/header stop showing
   * "未命名对话". Returns a sanitized 4–24 char title (Chinese-aware), or "" if
   * the model returned nothing usable. Never throws — failures fall through to
   * the empty result and the conversation keeps its null title.
   */
  async function generateTitle(input: { userText: string; assistantText: string; modelId?: string; signal?: AbortSignal }): Promise<string> {
    let text = "";
    await streamInternal({
      messages: [
        { role: "user", content: input.userText },
        { role: "assistant", content: input.assistantText }
      ],
      tools: [],
      system: TITLE_SYSTEM_PROMPT,
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      onEvent: (event) => {
        if (event.type === "text_delta") text += event.text ?? "";
      }
    }, false);
    return sanitizeTitle(text);
  }

  /**
   * Propose durable memory entries from a completed turn. Returns an empty
   * array on parse failure or an unusable model response — curation is always
   * best-effort and never throws.
   */
  async function proposeMemory(input: { userText: string; assistantText: string; modelId?: string; signal?: AbortSignal }): Promise<Array<{
    kind: "fact" | "preference" | "decision" | "project_note";
    scope: "global" | "project" | "session";
    text: string;
    projectId?: string;
  }>> {
    let text = "";
    await streamInternal({
      messages: [
        { role: "user", content: input.userText },
        { role: "assistant", content: input.assistantText }
      ],
      tools: [],
      system: MEMORY_PROPOSAL_SYSTEM_PROMPT,
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      onEvent: (event) => {
        if (event.type === "text_delta") text += event.text ?? "";
      }
    }, false);
    return parseMemoryProposals(text);
  }

  return { resolveProvider, stream, summarize, generateTitle, proposeMemory };
}

const SUMMARY_SYSTEM_PROMPT = [
  "You are the conversation summarizer for Copilot, the ForgeBadger platform agent.",
  "Produce a concise but complete summary of the conversation so far, preserving:",
  "- key decisions and their reasons",
  "- project/session state facts and progress",
  "- open questions and pending actions",
  "- the user's goals and preferences",
  "If a previous summary is included in the messages, merge it with the new messages",
  "rather than repeating it. Keep the summary under 800 characters and use the",
  "same language as the conversation."
].join("\n");

function pickBaseUrl(format: ProviderApiFormat, anthropicUrl: string | null, openaiUrl: string | null): string | null {
  if (format === "anthropic") return anthropicUrl ?? openaiUrl;
  return openaiUrl ?? anthropicUrl;
}

// Anthropic thinking budgets per strength; "off" applies nothing.
const THINKING_BUDGET_TOKENS: Record<Exclude<ThinkingEffort, "off">, number> = {
  low: 2048,
  medium: 4096,
  high: 8192
};

/**
 * Map the user's thinking-strength preference onto the provider request body.
 * "off" (or no preference) leaves the body untouched. OpenAI-compatible
 * endpoints get `reasoning_effort`; Anthropic gets an enabled thinking budget
 * block plus a `max_tokens` large enough to cover the budget (thinking tokens
 * count against `max_tokens`).
 */
function applyThinkingPreference(body: Record<string, unknown>, format: "openai" | "anthropic", effort: ThinkingEffort | null): void {
  if (effort === null || effort === "off") return;
  if (format === "anthropic") {
    const budgetTokens = THINKING_BUDGET_TOKENS[effort];
    body.thinking = { type: "enabled", budget_tokens: budgetTokens };
    body.max_tokens = budgetTokens + 8192;
    return;
  }
  body.reasoning_effort = effort;
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
  fetchImpl: AgentFetch,
  signal: AbortSignal,
  thinkingEffort: ThinkingEffort | null
): Promise<LlmResult> {
  const system = request.system ?? SYSTEM_PROMPT;
  const apiMessages: Array<{ role: "user" | "assistant"; content: Array<Record<string, unknown>> }> = [];
  for (const original of request.messages) {
    const message = original.providerReplay && !matchingReplay(original, resolution) ? withoutPrivateReplay(original) : original;
    const role = message.role === "assistant" ? "assistant" : "user";
    const replay = matchingReplay(message, resolution);
    const content: Array<Record<string, unknown>> = message.role === "assistant" && replay?.blocks
      ? replay.blocks.map(block => ({ ...block }))
      : message.role === "tool"
      ? [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }]
      : [...(message.content ? [{ type: "text", text: message.content }] : []),
        ...(message.toolCalls ?? []).map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: safeJsonParse(call.arguments) }))];
    const previous = apiMessages.at(-1);
    if (previous?.role === role) previous.content.push(...content);
    else apiMessages.push({ role, content });
  }

  const body: Record<string, unknown> = {
    model: resolution.modelId,
    stream: true,
    max_tokens: 8192,
    system,
    messages: apiMessages,
    tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
  };
  applyThinkingPreference(body, "anthropic", thinkingEffort);

  const response = await withAbort(fetchImpl(`${resolution.baseUrl}/v1/messages`, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "x-api-key": resolution.apiKey,
      "anthropic-version": "2023-06-01",
      ...authHeaders(resolution),
      ...resolution.defaultHeaders
    },
    body: serializeProviderRequest(body),
    signal
  }), signal);
  if (!response.ok) throw new AgentError("AGENT_HTTP_ERROR", await readError(response));

  return readAnthropicCompletion(response, request.onEvent, signal);
}

async function streamOpenAi(
  resolution: AgentLlmProviderResolution,
  request: AgentLlmRequest,
  fetchImpl: AgentFetch,
  signal: AbortSignal,
  thinkingEffort: ThinkingEffort | null
): Promise<LlmResult> {
  const mapped = request.messages.map((original) => {
    const m = original.providerReplay && !matchingReplay(original, resolution) ? withoutPrivateReplay(original) : original;
    const replay = m.role === "assistant" ? matchingReplay(m, resolution) : undefined;
    const reasoning = replay ? {
      ...(replay.reasoningContent === undefined ? {} : { reasoning_content: replay.reasoningContent }),
      ...(replay.reasoningDetails === undefined ? {} : { reasoning_details: replay.reasoningDetails }),
    } : {};
    if (m.role === "tool") {
      return { role: "tool" as const, tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: m.content || null,
        ...reasoning,
        tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.arguments } }))
      };
    }
    return { role: m.role as "user" | "assistant", content: m.content, ...reasoning };
  });
  const apiMessages = [{ role: "system" as const, content: request.system ?? SYSTEM_PROMPT }, ...mapped];

  const body: Record<string, unknown> = {
    model: resolution.modelId,
    stream: true,
    messages: apiMessages,
    tools: request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
  };
  applyThinkingPreference(body, "openai", thinkingEffort);

  const endpoint = new URL(`${resolution.baseUrl}/chat/completions`);
  const response = await withAbort(fetchImpl(endpoint.href, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      ...authHeaders(resolution),
      ...resolution.defaultHeaders
    },
    body: serializeProviderRequest(body),
    signal
  }), signal);
  if (!response.ok) throw new AgentError("AGENT_HTTP_ERROR", await readError(response));

  const allowFinishReasonEof = endpoint.protocol === "https:"
    && ["api.minimaxi.com", "api.minimax.cn", "api.minimax.io"].includes(endpoint.hostname);
  return readOpenAiCompletion(response, request.onEvent, signal, { allowFinishReasonEof, toolNames: request.tools.map(tool => tool.name),
    ...(allowFinishReasonEof ? { reasoningDetailsMode: "snapshot" as const } : {}) });
}

const SYSTEM_PROMPT = [
  "You are Copilot, the platform agent for ForgeBadger.",
  "You can observe and operate the whole platform through the provided tools:",
  "- projects: list and inspect projects",
  "- sessions: list and inspect AI CLI sessions",
  "- memory: read/write scoped memory (global, project, session)",
  "",
  "Be concise. Use tools to complete authorized work. Routine scoped platform operations",
  "run automatically for direct owner requests; high-risk actions require exact approval.",
  "A scoped Grant remains a hard boundary and never falls back to owner authority.",
  "Use list_playbooks and load_playbook for Copilot operating guides. CLI Skills",
  "belong to CLI sessions and do not add tools to your runtime. Task preparation",
  "does not start a CLI or dispatch a prompt. Use pm_execute_task_packet to prepare,",
  "start and deliver work through an operator-enabled CLI adapter. Never bypass native CLI permissions.",
  "A native trust/permission prompt or PROGRAMMATIC_SUBMIT_NATIVE_APPROVAL_REQUIRED requires an owner terminal decision: stop dispatch attempts and report the blocker. Resume only after it is resolved.",
  "Choose the tools and next steps from the user's goal and current tool results; there is no fixed workflow.",
  "Project-management tools support work items, execution, progress and evidence-based reports.",
  "Use pm_get_task_progress or get_session_output when evidence about an existing attempt is needed.",
  "Do not redispatch a delivered or uncertain task. An incomplete/not_sent result means preparation",
  "may have succeeded but the prompt was NOT delivered; inspect readiness before a new authorized attempt.",
  "Use pm_close_task with the returned attempt and notification evidence IDs to record a completion report.",
  "A CLI completion hook is only a completion candidate. Report actual evidence, remaining checks,",
  "and whether acceptance is still pending; never equate it with tests passing, merge or deployment.",
  "Never claim a write happened until",
  "the tool result confirms it."
].join("\n");

/** Final wire guard: provider envelopes and JSON escaping can exceed projection estimates. */
function serializeProviderRequest(body: Record<string, unknown>): string {
  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_CONTEXT_CHARS) {
    throw new AgentError("COPILOT_CONTEXT_TOO_LARGE",
      `Final provider request exceeds ${MAX_CONTEXT_CHARS} application characters (${serialized.length})`);
  }
  return serialized;
}

function safeJsonParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return {}; }
}

async function readError(response: Response): Promise<string> {
  void response.body?.cancel().catch(() => undefined);
  return `Provider returned HTTP ${response.status}`;
}

export function toolSchemaToModelFormat(tool: { name: string; description: string; inputSchema: Record<string, unknown> }): AgentToolSchema {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

const TITLE_SYSTEM_PROMPT = [
  "You generate the sidebar title for a single Copilot conversation.",
  "Read the user message and the assistant's first reply, then return ONLY a",
  "title of 4-12 Chinese characters, or 3-7 English words. No quotes, no",
  "punctuation except the natural title style, no prefix, no explanation.",
  "Capture the user's concrete goal (what they asked / what the assistant",
  "helped with), not the topic. Examples:",
  "- 用户问 K8s pod 启动失败排查 → 'K8s pod 启动排查'",
  "- user asks for a haiku about autumn → 'Autumn haiku'",
  "- 用户让 Copilot 总结最近一周项目状态 → '本周项目状态回顾'"
].join("\n");

const MEMORY_PROPOSAL_SYSTEM_PROMPT = [
  "You extract durable memory entries from a single Copilot turn.",
  "From the user message and the assistant reply, identify facts, preferences,",
  "or decisions that will be useful in FUTURE turns, and return them as a JSON",
  "array. Each entry is {\"kind\": \"fact\"|\"preference\"|\"decision\"|\"project_note\",",
  "\"scope\": \"global\"|\"project\"|\"session\", \"text\": \"...\"}.",
  "Rules:",
  "- Write only concrete, non-transient information; skip trivial chatter.",
  "- Prefer 'global' scope unless the fact is clearly project-specific.",
  "- Return [] when nothing is worth remembering. Return ONLY the JSON array,",
  "no prose, no markdown fences."
].join("\n");

function parseMemoryProposals(raw: string): Array<{
  kind: "fact" | "preference" | "decision" | "project_note";
  scope: "global" | "project" | "session";
  text: string;
  projectId?: string;
}> {
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid: Array<{ kind: "fact" | "preference" | "decision" | "project_note"; scope: "global" | "project" | "session"; text: string; projectId?: string }> = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const kind = record.kind;
      const scope = record.scope;
      const text = record.text;
      if (
        (kind === "fact" || kind === "preference" || kind === "decision" || kind === "project_note")
        && (scope === "global" || scope === "project" || scope === "session")
        && typeof text === "string" && text.trim().length > 0
      ) {
        valid.push({ kind, scope, text: text.trim().slice(0, 8 * 1024) });
      }
    }
    return valid;
  } catch {
    return [];
  }
}

const TITLE_MAX_CHARS = 24;

function sanitizeTitle(raw: string): string {
  // Strip code fences, quotes, "Title:" prefixes, and trailing punctuation.
  const trimmed = raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[`*_~>#]/g, "")
    .replace(/^\s*(title[:：]?\s*|["'「『])|["'」』]\s*$/gi, "")
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!trimmed) return "";
  // Truncate to a sensible length while keeping whole word/char boundaries.
  if (trimmed.length <= TITLE_MAX_CHARS) return trimmed;
  const slice = trimmed.slice(0, TITLE_MAX_CHARS);
  // Drop a trailing half-character so we don't return "你帮我做一个 K8s pod".
  return slice.replace(/[\s\p{P}]$/u, "").trim() || trimmed.slice(0, TITLE_MAX_CHARS);
}
