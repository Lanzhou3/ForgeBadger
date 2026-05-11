import { CopilotRepository, type CopilotRun, type CopilotRunEvent } from "../../db/repositories/copilot-repository.js";
import type { Database } from "../../db/types.js";
import { AnthropicMessagesClient } from "./anthropic-messages-client.js";
import { runCopilotActiveRecall } from "./active-recall.js";
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
  modelRequestTimeoutMs?: number;
  runControls?: CopilotRunControlRegistry;
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
  private readonly runControls: CopilotRunControlRegistry;
  private readonly modelRequestTimeoutMs: number;

  constructor(private readonly options: CopilotOrchestratorOptions) {
    this.modelClientFactory = options.modelClientFactory;
    this.toolRegistry = createCopilotToolRegistry(createCopilotReadTools());
    this.runControls = options.runControls ?? new CopilotRunControlRegistry();
    this.modelRequestTimeoutMs = options.modelRequestTimeoutMs ?? 60_000;
  }

  async runText(input: RunCopilotTextInput): Promise<RunCopilotTextResult> {
    const repo = new CopilotRepository(this.options.db, input.userId);
    let run = repo.createRun(toCreateRunInput(input));
    const control = this.runControls.start(run.id);
    try {
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
      const recall = await runCopilotActiveRecall({
        db: this.options.db,
        userId: input.userId,
        masterKey: this.options.masterKey,
        source: input.source,
        prompt: input.prompt,
        toolRegistry: this.toolRegistry
      });
      const recallEvent = recall.event ? repo.addEvent(run.id, recall.event) : null;
      const recalledRun = repo.getRun(run.id) ?? run;
      const previousEvents = recallEvent ? [recallEvent] : [];
      const cancelled = this.cancelledResultIfNeeded(repo, recalledRun, previousEvents, control.signal);
      if (cancelled) return cancelled;
      if (recalledRun.stepCount >= recalledRun.maxSteps) {
        return this.failAfterEvents(
          repo,
          recalledRun,
          maxStepsError(recalledRun.maxSteps),
          previousEvents,
          400
        );
      }
      return await this.callModel(
        repo,
        recalledRun,
        selected.selection,
        input.prompt,
        recall.context,
        previousEvents,
        control.signal
      );
    } finally {
      control.finish();
    }
  }

  private async callModel(
    repo: CopilotRepository,
    run: CopilotRun,
    selection: CopilotProviderSelection,
    prompt: string,
    recallContext: string | null,
    previousEvents: CopilotRunEvent[],
    runSignal: AbortSignal
  ): Promise<RunCopilotTextResult> {
    const response = await this.requestModel(
      repo,
      run,
      selection,
      toModelRequest(selection, prompt, this.toolRegistry, recallContext),
      previousEvents,
      runSignal
    );
    if (!response.ok) return response.result;
    const events = response.events;
    const overflow = previousEvents.length + events.length > run.maxSteps;
    if (overflow) return this.failAfterEvents(repo, run, maxStepsError(run.maxSteps), previousEvents, 400);
    const stored = events.map((event) => storeModelEvent(repo, run.id, event));
    const allEvents = [...previousEvents, ...stored];
    const failed = events.find((event) => event.type === "run_failed");
    if (failed) return this.failAfterEvents(repo, run, failed, allEvents, 502);
    const toolCall = events.find((event) => event.type === "tool_call_requested");
    if (toolCall) return await this.executeReadTool(repo, run, selection, toolCall, allEvents, runSignal);
    const completed = repo.updateRun(run.id, { status: "completed", completedAt: Date.now() }) ?? run;
    return { ok: true, run: completed, events: allEvents };
  }

  private async executeReadTool(
    repo: CopilotRepository,
    run: CopilotRun,
    selection: CopilotProviderSelection,
    toolCall: Extract<CopilotModelEvent, { type: "tool_call_requested" }>,
    events: CopilotRunEvent[],
    runSignal: AbortSignal
  ): Promise<RunCopilotTextResult> {
    const cancelledBeforeTool = this.cancelledResultIfNeeded(repo, run, events, runSignal);
    if (cancelledBeforeTool) return cancelledBeforeTool;
    const result = await executeCopilotTool(this.toolRegistry, toolCall.name, toolCall.input, {
      db: this.options.db,
      userId: run.userId,
      masterKey: this.options.masterKey,
      runId: run.id
    });
    const cancelledAfterTool = this.cancelledResultIfNeeded(repo, run, events, runSignal);
    if (cancelledAfterTool) return cancelledAfterTool;
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
    return await this.answerFromToolResult(
      repo,
      run,
      selection,
      toolCall,
      result.output,
      [...events, toolResult],
      runSignal
    );
  }

  private async answerFromToolResult(
    repo: CopilotRepository,
    run: CopilotRun,
    selection: CopilotProviderSelection,
    toolCall: Extract<CopilotModelEvent, { type: "tool_call_requested" }>,
    output: unknown,
    events: CopilotRunEvent[],
    runSignal: AbortSignal
  ): Promise<RunCopilotTextResult> {
    const response = await this.requestModel(
      repo,
      run,
      selection,
      toToolResultModelRequest(selection, run.goal, toolCall.name, output),
      events,
      runSignal
    );
    if (!response.ok) return response.result;
    const followUp = response.events;
    if (events.length + followUp.length > run.maxSteps) {
      return this.failAfterEvents(repo, run, maxStepsError(run.maxSteps), events, 400);
    }
    const stored = followUp.map((event) => storeModelEvent(repo, run.id, event));
    const allEvents = [...events, ...stored];
    const failed = followUp.find((event) => event.type === "run_failed");
    if (failed) return this.failAfterEvents(repo, run, failed, allEvents, 502);
    const unexpectedToolCall = followUp.find((event) => event.type === "tool_call_requested");
    if (unexpectedToolCall) {
      return this.failAfterEvents(repo, run, {
        code: "copilot_unexpected_tool_call",
        message: "Copilot requested another tool after tool results were submitted"
      }, allEvents, 400);
    }
    const completed = repo.updateRun(run.id, { status: "completed", completedAt: Date.now() }) ?? run;
    return { ok: true, run: completed, events: allEvents };
  }

  private async requestModel(
    repo: CopilotRepository,
    run: CopilotRun,
    selection: CopilotProviderSelection,
    request: CopilotModelRequest,
    previousEvents: CopilotRunEvent[],
    runSignal: AbortSignal
  ): Promise<
    | { ok: true; events: CopilotModelEvent[] }
    | { ok: false; result: RunCopilotTextResult }
  > {
    const cancelledBeforeRequest = this.cancelledResultIfNeeded(repo, run, previousEvents, runSignal);
    if (cancelledBeforeRequest) return { ok: false, result: cancelledBeforeRequest };
    const requestController = new AbortController();
    let timedOut = false;
    const abortFromRun = () => requestController.abort();
    if (runSignal.aborted) abortFromRun();
    else runSignal.addEventListener("abort", abortFromRun, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, this.modelRequestTimeoutMs);
    try {
      const events = await this.modelClientFor(selection).createResponse(request, { signal: requestController.signal });
      const cancelled = this.cancelledResultIfNeeded(repo, run, previousEvents, runSignal);
      if (cancelled) return { ok: false, result: cancelled };
      if (timedOut) {
        return {
          ok: false,
          result: this.failWithRunEvent(repo, run, modelRequestTimeoutError(this.modelRequestTimeoutMs), previousEvents, 504)
        };
      }
      return { ok: true, events };
    } catch {
      const cancelled = this.cancelledResultIfNeeded(repo, run, previousEvents, runSignal);
      if (cancelled) return { ok: false, result: cancelled };
      if (timedOut) {
        return {
          ok: false,
          result: this.failWithRunEvent(repo, run, modelRequestTimeoutError(this.modelRequestTimeoutMs), previousEvents, 504)
        };
      }
      return {
        ok: false,
        result: this.failWithRunEvent(repo, run, modelRequestError(), previousEvents, 502)
      };
    } finally {
      clearTimeout(timeout);
      runSignal.removeEventListener("abort", abortFromRun);
    }
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

  private failWithRunEvent(
    repo: CopilotRepository,
    run: CopilotRun,
    error: CopilotServiceError,
    events: CopilotRunEvent[],
    status: number
  ): RunCopilotTextResult {
    const failedEvent = storeModelEvent(repo, run.id, {
      type: "run_failed",
      code: error.code,
      message: error.message
    });
    return this.failAfterEvents(repo, run, error, [...events, failedEvent], status);
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

  private cancelledResultIfNeeded(
    repo: CopilotRepository,
    run: CopilotRun,
    events: CopilotRunEvent[],
    runSignal: AbortSignal
  ): RunCopilotTextResult | null {
    const current = repo.getRun(run.id) ?? run;
    if (current.status !== "cancelled" && !runSignal.aborted) return null;
    const cancelled = current.status === "cancelled"
      ? current
      : repo.updateRun(run.id, { status: "cancelled", completedAt: Date.now() }) ?? current;
    return {
      ok: false,
      status: 409,
      error: runCancelledError(),
      run: cancelled,
      events
    };
  }
}

interface CopilotRunControlHandle {
  signal: AbortSignal;
  finish: () => void;
}

export class CopilotRunControlRegistry {
  private readonly controllers = new Map<string, AbortController>();

  start(runId: string): CopilotRunControlHandle {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return {
      signal: controller.signal,
      finish: () => {
        if (this.controllers.get(runId) === controller) this.controllers.delete(runId);
      }
    };
  }

  cancel(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
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
  toolRegistry: CopilotToolRegistry,
  recallContext: string | null
): CopilotModelRequest {
  return {
    model: selection.model.modelId,
    instructions: [
      "You are OpenForge Copilot.",
      "Answer operational questions about the OpenForge control plane.",
      "Do not request terminal input, shell execution, file writes, or autonomous project changes."
    ].join("\n"),
    input: recallContext ? [recallContext, "", "User request:", prompt].join("\n") : prompt,
    tools: toModelToolDefinitions(toolRegistry),
    maxOutputTokens: 1024
  };
}

function toToolResultModelRequest(
  selection: Pick<CopilotProviderSelection, "model">,
  originalPrompt: string,
  toolName: string,
  output: unknown
): CopilotModelRequest {
  return {
    model: selection.model.modelId,
    instructions: [
      "You are OpenForge Copilot.",
      "Answer operational questions about the OpenForge control plane.",
      "Use the provided OpenForge tool result to answer the user's original request.",
      "Do not request terminal input, shell execution, file writes, or autonomous project changes."
    ].join("\n"),
    input: [
      "Original user request:",
      originalPrompt,
      "",
      `Tool ${toolName} returned:`,
      JSON.stringify(redactCopilotPayload(output), null, 2),
      "",
      "Write a concise, actionable answer for the user."
    ].join("\n"),
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

function modelRequestError(): CopilotServiceError {
  return {
    code: "copilot_model_request_failed",
    message: "Copilot model request failed"
  };
}

function modelRequestTimeoutError(timeoutMs: number): CopilotServiceError {
  return {
    code: "copilot_model_request_timeout",
    message: `Copilot model request timed out after ${timeoutMs}ms`
  };
}

function runCancelledError(): CopilotServiceError {
  return {
    code: "copilot_run_cancelled",
    message: "Copilot run was cancelled"
  };
}
