import { CopilotRepository, type CopilotRun, type CopilotRunEvent } from "../../db/repositories/copilot-repository.js";
import type { Database } from "../../db/types.js";
import { AnthropicMessagesClient } from "./anthropic-messages-client.js";
import type { CopilotModelClient, CopilotModelEvent, CopilotModelRequest, CopilotServiceError } from "./types.js";
import { OpenAiResponsesClient } from "./openai-responses-client.js";
import {
  selectCopilotProvider,
  type CopilotProviderSelection
} from "./provider-selection.js";
import { createCopilotReadTools } from "./read-tools.js";
import { redactCopilotPayload, redactCopilotText } from "./redaction.js";
import {
  createCopilotToolRegistry,
  executeCopilotTool,
  toModelToolDefinitions,
  type CopilotToolRegistry
} from "./tool-registry.js";

export interface CopilotOrchestratorOptions {
  db: Database;
  masterKey: string;
  modelClientFactory?: (selection: CopilotProviderSelection) => CopilotModelClient;
}

export interface RunCopilotTextInput {
  userId: string;
  prompt: string;
  providerProfileId?: string;
  modelProfileId?: string;
  source: "dashboard" | "project" | "session" | "settings" | "copilot";
  sourceRefId?: string;
  maxSteps?: number;
}

export type RunCopilotTextResult =
  | { ok: true; run: CopilotRun; events: CopilotRunEvent[] }
  | { ok: false; status: number; error: CopilotServiceError; run: CopilotRun; events: CopilotRunEvent[] };

export class CopilotOrchestrator {
  private readonly modelClientFactory: ((selection: CopilotProviderSelection) => CopilotModelClient) | undefined;
  private readonly toolRegistry: CopilotToolRegistry;

  constructor(private readonly options: CopilotOrchestratorOptions) {
    this.modelClientFactory = options.modelClientFactory;
    this.toolRegistry = createCopilotToolRegistry(createCopilotReadTools());
  }

  async runText(input: RunCopilotTextInput): Promise<RunCopilotTextResult> {
    const repo = new CopilotRepository(this.options.db, input.userId);
    let run = repo.createRun(toCreateRunInput(input));
    const selectionInput = {
      db: this.options.db,
      userId: input.userId,
      masterKey: this.options.masterKey,
      allowOpenAiCompatible: true
    };
    const selected = selectCopilotProvider({
      ...selectionInput,
      ...(input.providerProfileId ? { providerProfileId: input.providerProfileId } : {}),
      ...(input.modelProfileId ? { modelProfileId: input.modelProfileId } : {})
    });
    if (!selected.ok) return this.failBeforeModel(repo, run, selected.error, 400);
    run = repo.updateRun(run.id, {
      providerProfileId: selected.selection.provider.id,
      modelProfileId: selected.selection.model.id
    }) ?? run;
    return await this.callModel(repo, run, selected.selection, input.prompt);
  }

  private async callModel(
    repo: CopilotRepository,
    run: CopilotRun,
    selection: CopilotProviderSelection,
    prompt: string
  ): Promise<RunCopilotTextResult> {
    const events = await this.modelClientFor(selection).createResponse(
      toModelRequest(selection, prompt, this.toolRegistry)
    );
    const overflow = events.length > run.maxSteps;
    if (overflow) return this.failBeforeModel(repo, run, maxStepsError(run.maxSteps), 400);
    const stored = events.map((event) => storeModelEvent(repo, run.id, event));
    const failed = events.find((event) => event.type === "run_failed");
    if (failed) return this.failAfterEvents(repo, run, failed, stored, 502);
    const toolCall = events.find((event) => event.type === "tool_call_requested");
    if (toolCall) return await this.executeReadTool(repo, run, toolCall, stored);
    const completed = repo.updateRun(run.id, { status: "completed", completedAt: Date.now() }) ?? run;
    return { ok: true, run: completed, events: stored };
  }

  private async executeReadTool(
    repo: CopilotRepository,
    run: CopilotRun,
    toolCall: Extract<CopilotModelEvent, { type: "tool_call_requested" }>,
    events: CopilotRunEvent[]
  ): Promise<RunCopilotTextResult> {
    const result = await executeCopilotTool(this.toolRegistry, toolCall.name, toolCall.input, {
      db: this.options.db,
      userId: run.userId,
      masterKey: this.options.masterKey,
      runId: run.id
    });
    if (!result.ok) return this.failAfterEvents(repo, run, result.error, events, 400);
    const toolResult = repo.addEvent(run.id, {
      type: "tool_result",
      message: toolCall.name,
      payload: { toolCallId: toolCall.id, output: result.output }
    });
    if (result.requiresApproval) {
      const waiting = repo.updateRun(run.id, { status: "waiting_for_approval" }) ?? run;
      return { ok: true, run: waiting, events: [...events, toolResult] };
    }
    const completed = repo.updateRun(run.id, { status: "completed", completedAt: Date.now() }) ?? run;
    return { ok: true, run: completed, events: [...events, toolResult] };
  }

  private failBeforeModel(
    repo: CopilotRepository,
    run: CopilotRun,
    error: CopilotServiceError,
    status: number
  ): RunCopilotTextResult {
    const failed = repo.updateRun(run.id, {
      status: "failed",
      errorCode: error.code,
      errorMessage: error.message,
      completedAt: Date.now()
    }) ?? run;
    return { ok: false, status, error, run: failed, events: repo.listEvents(run.id) };
  }

  private failAfterEvents(
    repo: CopilotRepository,
    run: CopilotRun,
    error: CopilotServiceError,
    events: CopilotRunEvent[],
    status: number
  ): RunCopilotTextResult {
    const failed = repo.updateRun(run.id, {
      status: "failed",
      errorCode: error.code,
      errorMessage: error.message,
      completedAt: Date.now()
    }) ?? run;
    return { ok: false, status, error, run: failed, events };
  }

  private modelClientFor(selection: CopilotProviderSelection): CopilotModelClient {
    if (this.modelClientFactory) return this.modelClientFactory(selection);
    if (selection.clientKind === "anthropic-messages") {
      return new AnthropicMessagesClient({
        baseUrl: selection.provider.baseUrl,
        apiKey: selection.apiKey ?? ""
      });
    }
    return new OpenAiResponsesClient({
      baseUrl: selection.provider.baseUrl,
      apiKey: selection.apiKey ?? ""
    });
  }
}

function toCreateRunInput(input: RunCopilotTextInput) {
  return {
    status: "running",
    providerProfileId: input.providerProfileId ?? null,
    modelProfileId: input.modelProfileId ?? null,
    source: input.source,
    sourceRefId: input.sourceRefId ?? null,
    goal: input.prompt,
    maxSteps: input.maxSteps ?? 8
  };
}

function toModelRequest(
  selection: CopilotProviderSelection,
  prompt: string,
  toolRegistry: CopilotToolRegistry
): CopilotModelRequest {
  return {
    model: selection.model.modelId,
    instructions: [
      "You are OpenForge Copilot.",
      "Answer operational questions about the OpenForge control plane.",
      "Do not request terminal input, shell execution, file writes, or autonomous project changes."
    ].join("\n"),
    input: prompt,
    tools: toModelToolDefinitions(toolRegistry),
    maxOutputTokens: 1024
  };
}

function storeModelEvent(
  repo: CopilotRepository,
  runId: string,
  event: CopilotModelEvent
): CopilotRunEvent {
  if (event.type === "assistant_message") {
    const text = redactCopilotText(event.text);
    return repo.addEvent(runId, {
      type: event.type,
      message: text,
      payload: { text }
    });
  }
  if (event.type === "tool_call_requested") {
    return repo.addEvent(runId, {
      type: event.type,
      message: event.name,
      payload: redactCopilotPayload({ id: event.id, name: event.name, input: event.input }) as Record<string, unknown>
    });
  }
  return repo.addEvent(runId, {
    type: event.type,
    message: event.message,
    payload: { code: event.code, message: redactCopilotText(event.message) }
  });
}

function maxStepsError(maxSteps: number): CopilotServiceError {
  return {
    code: "copilot_max_steps_exceeded",
    message: `Copilot run exceeded max step count ${maxSteps}`
  };
}
