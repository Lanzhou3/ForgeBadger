import {
  DEFAULT_COPILOT_MAX_STEPS,
  CopilotRepository,
  type CopilotPendingAction,
  type CopilotRun,
  type CopilotRunEvent
} from "../../db/repositories/copilot-repository.js";
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../../db/repositories/session-repository.js";
import type { Database } from "../../db/types.js";
import type { CommandRunner } from "../../lib/dependency-check.js";
import { AnthropicMessagesClient } from "./anthropic-messages-client.js";
import { runCopilotActiveRecall } from "./active-recall.js";
import { CopilotSseParseError } from "./model-client.js";
import type { CopilotModelClient, CopilotModelEvent, CopilotModelRequest, CopilotServiceError } from "./types.js";
import { OpenAiChatCompletionsClient } from "./openai-chat-completions-client.js";
import { OpenAiResponsesClient } from "./openai-responses-client.js";
import {
  selectCopilotProvider,
  type CopilotProviderSelection
} from "./provider-selection.js";
import { createCopilotReadTools } from "./read-tools.js";
import { redactCopilotPayload, redactCopilotText, sanitizeCopilotAssistantText } from "./redaction.js";
import {
  createCopilotToolRegistry,
  executeCopilotTool,
  toModelToolDefinitions,
  type CopilotToolContext,
  type CopilotToolRegistry
} from "./tool-registry.js";

export interface CopilotOrchestratorOptions {
  db: Database;
  masterKey: string;
  modelClientFactory?: (selection: CopilotProviderSelection) => CopilotModelClient;
  modelRequestTimeoutMs?: number;
  runControls?: CopilotRunControlRegistry;
  onRunStarted?: (run: CopilotRun) => void;
  onRunEvent?: (run: CopilotRun, event: CopilotRunEvent) => void;
  onTextDelta?: (run: CopilotRun, delta: string) => void;
  adapterCommandRunner?: CommandRunner;
  sessionManager?: {
    captureHistory(sessionId: string): Promise<string>;
    listSessions?(): Array<{
      id: string;
      status: string;
      tmuxName: string;
    }>;
  };
}

export interface RunCopilotTextInput {
  userId: string;
  prompt: string;
  conversationContext?: string;
  providerProfileId?: string;
  modelProfileId?: string;
  source: "dashboard" | "project" | "session" | "settings" | "copilot" | "models" | "feishu";
  sourceRefId?: string;
  maxSteps?: number;
}

export type RunCopilotTextResult =
  | { ok: true; run: CopilotRun; events: CopilotRunEvent[] }
  | { ok: false; status: number; error: CopilotServiceError; run: CopilotRun; events: CopilotRunEvent[] };

export interface ContinueCopilotAfterApprovalInput {
  userId: string;
  runId: string;
  action: CopilotPendingAction;
  result: Record<string, unknown>;
}

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
    const redactedPrompt = redactCopilotText(input.prompt);
    const redactedConversationContext = input.conversationContext
      ? redactCopilotText(input.conversationContext)
      : null;
    let run = repo.createRun(toCreateRunInput({ ...input, prompt: redactedPrompt }));
    const control = this.runControls.start(run.id);
    try {
      this.options.onRunStarted?.(run);
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
        prompt: redactedPrompt,
        toolRegistry: this.toolRegistry,
        ...(input.sourceRefId ? { sourceRefId: input.sourceRefId } : {})
      });
      const recallEvent = recall.event ? repo.addEvent(run.id, recall.event) : null;
      const recalledRun = repo.getRun(run.id) ?? run;
      const previousEvents = recallEvent ? [recallEvent] : [];
      const sourceContext = buildSourceContext(
        this.options.db,
        input.userId,
        input.source,
        input.sourceRefId,
        this.options.sessionManager
      );
      const cancelled = this.cancelledResultIfNeeded(repo, recalledRun, previousEvents, control.signal);
      if (cancelled) return cancelled;
      return await this.callModel(
        repo,
        recalledRun,
        selected.selection,
        redactedPrompt,
        redactedConversationContext,
        recall.context,
        sourceContext,
        previousEvents,
        control.signal
      );
    } finally {
      control.finish();
    }
  }

  async continueAfterApprovedAction(
    input: ContinueCopilotAfterApprovalInput
  ): Promise<RunCopilotTextResult | null> {
    const repo = new CopilotRepository(this.options.db, input.userId);
    const current = repo.getRun(input.runId);
    if (!current || !current.providerProfileId || !current.modelProfileId) return null;
    const selected = selectCopilotProvider({
      db: this.options.db,
      userId: input.userId,
      masterKey: this.options.masterKey,
      allowOpenAiCompatible: true,
      providerProfileId: current.providerProfileId,
      modelProfileId: current.modelProfileId
    });
    const running = repo.updateRun(current.id, {
      status: "running",
      completedAt: null
    }) ?? current;
    const previousEvents = repo.listEvents(running.id);
    if (!selected.ok) return this.failWithRunEvent(repo, running, selected.error, previousEvents, 400);
    const control = this.runControls.start(running.id);
    try {
      return await this.answerFromToolResults(
        repo,
        running,
        selected.selection,
        [{
          toolCall: {
            type: "tool_call_requested",
            id: input.action.id,
            name: input.action.type,
            input: input.action.input
          },
          output: input.result
        }],
        null,
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
    conversationContext: string | null,
    recallContext: string | null,
    sourceContext: string | null,
    previousEvents: CopilotRunEvent[],
    runSignal: AbortSignal
  ): Promise<RunCopilotTextResult> {
    const response = await this.requestModel(
      repo,
      run,
      selection,
      toModelRequest(selection, prompt, this.toolRegistry, recallContext, sourceContext, conversationContext),
      previousEvents,
      runSignal
    );
    if (!response.ok) return response.result;
    const events = stripPrematureAssistantMessagesForSessionEvidence(
      run.goal,
      previousEvents,
      response.events
    );
    const forcedSessionEvidence = await this.forceSessionEvidenceIfNeeded(
      repo,
      run,
      selection,
      previousEvents,
      events,
      conversationContext,
      runSignal
    );
    if (forcedSessionEvidence) return forcedSessionEvidence;
    const stored = events.map((event) => this.storeModelEvent(repo, run, event));
    const allEvents = [...previousEvents, ...stored];
    const failed = events.find((event) => event.type === "run_failed");
    if (failed) return this.failAfterEvents(repo, run, failed, allEvents, 502);
    const toolCalls = events.filter((event) => event.type === "tool_call_requested");
    if (toolCalls.length > 0) {
      return await this.executeTools(
        repo,
        run,
        selection,
        toolCalls,
        allEvents,
        conversationContext,
        runSignal
      );
    }
    const completed = repo.updateRun(run.id, { status: "completed", completedAt: Date.now() }) ?? run;
    return { ok: true, run: completed, events: allEvents };
  }

  private async executeTools(
    repo: CopilotRepository,
    run: CopilotRun,
    selection: CopilotProviderSelection,
    toolCalls: Array<Extract<CopilotModelEvent, { type: "tool_call_requested" }>>,
    events: CopilotRunEvent[],
    conversationContext: string | null,
    runSignal: AbortSignal
  ): Promise<RunCopilotTextResult> {
    const context: CopilotToolContext = {
      db: this.options.db,
      userId: run.userId,
      masterKey: this.options.masterKey,
      runId: run.id
    };
    if (this.options.adapterCommandRunner) context.adapterCommandRunner = this.options.adapterCommandRunner;
    if (this.options.sessionManager) context.sessionManager = this.options.sessionManager;
    const toolResults: Array<{
      toolCall: Extract<CopilotModelEvent, { type: "tool_call_requested" }>;
      output: unknown;
      requiresApproval: boolean;
    }> = [];
    let currentEvents = events;
    for (const toolCall of toolCalls) {
      const cancelledBeforeTool = this.cancelledResultIfNeeded(repo, run, currentEvents, runSignal);
      if (cancelledBeforeTool) return cancelledBeforeTool;
      const result = await executeCopilotTool(this.toolRegistry, toolCall.name, toolCall.input, context);
      const cancelledAfterTool = this.cancelledResultIfNeeded(repo, run, currentEvents, runSignal);
      if (cancelledAfterTool) return cancelledAfterTool;
      if (!result.ok) return this.failWithRunEvent(repo, run, result.error, currentEvents, 400);
      const toolResult = repo.addEvent(run.id, {
        type: "tool_result",
        message: toolCall.name,
        payload: { toolCallId: toolCall.id, output: result.output }
      });
      this.notifyRunEvent(repo.getRun(run.id) ?? run, toolResult);
      currentEvents = [...currentEvents, toolResult];
      toolResults.push({
        toolCall,
        output: result.output,
        requiresApproval: result.requiresApproval
      });
    }
    if (toolResults.some((result) => result.requiresApproval)) {
      const waiting = repo.updateRun(run.id, { status: "waiting_for_approval" }) ?? run;
      return { ok: true, run: waiting, events: currentEvents };
    }
    return await this.answerFromToolResults(
      repo,
      run,
      selection,
      toolResults,
      conversationContext,
      currentEvents,
      runSignal
    );
  }

  private async answerFromToolResults(
    repo: CopilotRepository,
    run: CopilotRun,
    selection: CopilotProviderSelection,
    toolResults: Array<{
      toolCall: Extract<CopilotModelEvent, { type: "tool_call_requested" }>;
      output: unknown;
    }>,
    conversationContext: string | null,
    events: CopilotRunEvent[],
    runSignal: AbortSignal
  ): Promise<RunCopilotTextResult> {
    const response = await this.requestModel(
      repo,
      run,
      selection,
      toToolResultModelRequest(selection, run.goal, conversationContext, toolResults, this.toolRegistry),
      events,
      runSignal
    );
    if (!response.ok) return response.result;
    const safeResponseEvents = stripPrematureAssistantMessagesForSessionEvidence(
      run.goal,
      events,
      response.events
    );
    const followUp = applyDeterministicSessionStatusAnswerIfNeeded(run.goal, events, safeResponseEvents);
    const forcedSessionEvidence = await this.forceSessionEvidenceIfNeeded(
      repo,
      run,
      selection,
      events,
      followUp,
      conversationContext,
      runSignal
    );
    if (forcedSessionEvidence) return forcedSessionEvidence;
    const stored = followUp.map((event) => this.storeModelEvent(repo, run, event));
    const allEvents = [...events, ...stored];
    const failed = followUp.find((event) => event.type === "run_failed");
    if (failed) return this.failAfterEvents(repo, run, failed, allEvents, 502);
    const toolCalls = followUp.filter((event) => event.type === "tool_call_requested");
    if (toolCalls.length > 0) {
      return await this.executeTools(
        repo,
        repo.getRun(run.id) ?? run,
        selection,
        toolCalls,
        allEvents,
        conversationContext,
        runSignal
      );
    }
    const completed = repo.updateRun(run.id, { status: "completed", completedAt: Date.now() }) ?? run;
    return { ok: true, run: completed, events: allEvents };
  }

  private async forceSessionEvidenceIfNeeded(
    repo: CopilotRepository,
    run: CopilotRun,
    selection: CopilotProviderSelection,
    previousEvents: CopilotRunEvent[],
    candidateEvents: CopilotModelEvent[],
    conversationContext: string | null,
    runSignal: AbortSignal
  ): Promise<RunCopilotTextResult | null> {
    if (!requiresSessionStatusEvidence(run.goal)) return null;
    if (hasSessionStatusEvidence(previousEvents)) return null;
    if (!candidateEvents.some((event) => event.type === "assistant_message")) return null;
    if (candidateEvents.some((event) => event.type === "tool_call_requested")) return null;
    const toolCall: Extract<CopilotModelEvent, { type: "tool_call_requested" }> = {
      type: "tool_call_requested",
      id: "forced-session-status-evidence",
      name: "openforge.list_sessions",
      input: { limit: 50 }
    };
    const stored = this.storeModelEvent(repo, run, toolCall);
    return await this.executeTools(
      repo,
      run,
      selection,
      [toolCall],
      [...previousEvents, stored],
      conversationContext,
      runSignal
    );
  }

  private storeModelEvent(repo: CopilotRepository, run: CopilotRun, event: CopilotModelEvent): CopilotRunEvent {
    const stored = storeModelEvent(repo, run.id, event);
    this.notifyRunEvent(repo.getRun(run.id) ?? run, stored);
    return stored;
  }

  private notifyRunEvent(run: CopilotRun, event: CopilotRunEvent): void {
    this.options.onRunEvent?.(run, event);
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
      const events = await this.modelClientFor(selection).createResponse(request, {
        signal: requestController.signal,
        onTextDelta: (delta) => this.options.onTextDelta?.(repo.getRun(run.id) ?? run, delta)
      });
      const cancelled = this.cancelledResultIfNeeded(repo, run, previousEvents, runSignal);
      if (cancelled) return { ok: false, result: cancelled };
      if (timedOut) {
        return {
          ok: false,
          result: this.failWithRunEvent(repo, run, modelRequestTimeoutError(this.modelRequestTimeoutMs), previousEvents, 504)
        };
      }
      return { ok: true, events };
    } catch (error) {
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
        result: this.failWithRunEvent(repo, run, modelRequestError(error), previousEvents, 502)
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
    return this.failWithRunEvent(repo, run, error, [], status);
  }

  private failAfterEvents(
    repo: CopilotRepository,
    run: CopilotRun,
    error: CopilotServiceError,
    events: CopilotRunEvent[],
    status: number
  ): RunCopilotTextResult {
    const redactedError = redactCopilotServiceError(error);
    const failed = repo.updateRun(run.id, {
      status: "failed",
      errorCode: redactedError.code,
      errorMessage: redactedError.message,
      completedAt: Date.now()
    }) ?? run;
    return { ok: false, status, error: redactedError, run: failed, events };
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
        baseUrl: selection.provider.anthropicBaseUrl ?? selection.provider.baseUrl,
        apiKey: selection.apiKey ?? ""
      });
    }
    if (selection.clientKind === "openai-chat-completions") {
      return new OpenAiChatCompletionsClient({
        baseUrl: selection.provider.openaiBaseUrl ?? selection.provider.baseUrl,
        apiKey: selection.apiKey ?? ""
      });
    }
    return new OpenAiResponsesClient({
      baseUrl: selection.provider.openaiBaseUrl ?? selection.provider.baseUrl,
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
    maxSteps: input.maxSteps ?? DEFAULT_COPILOT_MAX_STEPS
  };
}

function toModelRequest(
  selection: CopilotProviderSelection,
  prompt: string,
  toolRegistry: CopilotToolRegistry,
  recallContext: string | null,
  sourceContext: string | null,
  conversationContext: string | null
): CopilotModelRequest {
  const contextBlocks = [sourceContext, recallContext].filter((block): block is string => Boolean(block));
  const requestBlock = buildConversationAwareRequestBlock(prompt, conversationContext, "Current user request");
  return {
    model: selection.model.modelId,
    instructions: buildCopilotInstructions(),
    input: contextBlocks.length > 0
      ? [...contextBlocks, "", conversationContext ? requestBlock : ["User request:", prompt].join("\n")].join("\n")
      : requestBlock,
    tools: toModelToolDefinitions(toolRegistry),
    maxOutputTokens: 1024
  };
}

function buildCopilotInstructions(extra: string[] = []): string {
  return [
    "You are OpenForge Copilot.",
    "Answer operational questions about the OpenForge control plane.",
    "Request at most one OpenForge tool in each model response. After receiving a tool result, decide the next tool or answer.",
    "Project status and session status are different: a project with status active is not evidence of a running or active AI CLI session.",
    "For session questions, treat tool fields named sessionStatus, runtimeStatus, isLive, and runningSessionCount as the source of truth.",
    "If a project has sessionStatus no_running_sessions or no_live_sessions_stale_records, say it has no live running session.",
    "When the user asks whether a project has active/running sessions or asks about project session state, inspect OpenForge session tools such as openforge.list_sessions or openforge.get_session_detail before answering.",
    "When the user asks what happened inside a running AI CLI session, inspect openforge.get_session_terminal_snapshot before answering.",
    "You can inspect projects, sessions, agents, skills, templates, plugins, notifications, usage, diagnostics, and model provider configuration with read tools.",
    "For platform changes, create user-approval proposals instead of claiming completion: use project proposal tools for project create/import/delete/config sync, session proposal tools for session create/start/stop/delete/input, management proposal tools for agents/skills/templates/plugins, model-provider proposal tools for sync/apply/default Copilot model selection, and memory proposal tools for durable memory writes.",
    "Before sending input to Claude Code, Codex, or OpenCode sessions, inspect the session and recent terminal snapshot, explain the exact input, and create an approval-required openforge.propose_session_input action.",
    "Do not directly execute terminal input, shell execution, file writes, or autonomous project changes; use approval-required proposal tools for those actions.",
    ...extra
  ].join("\n");
}

function buildSourceContext(
  db: Database,
  userId: string,
  source: RunCopilotTextInput["source"],
  sourceRefId: string | undefined,
  sessionManager?: CopilotOrchestratorOptions["sessionManager"]
): string | null {
  if (!sourceRefId) return null;
  if (source === "project") {
    const project = new ProjectRepository(db, userId).getById(sourceRefId);
    if (!project) return unavailableSourceContext("project", sourceRefId);
    const sessions = new SessionRepository(db, userId).listByProject(project.id);
    const sessionCounts = getProjectSourceSessionCounts(sessions, sessionManager);
    return [
      "OpenForge source context:",
      "Type: project",
      `ID: ${safeContextValue(project.id)}`,
      `Name: ${safeContextValue(project.name)}`,
      `Project record status: ${safeContextValue(project.status)}`,
      `Total sessions: ${sessions.length}`,
      `Database running session records: ${sessionCounts.databaseRunning}`,
      `Live runtime sessions: ${sessionCounts.liveRuntime ?? "unknown"}`,
      ...(sessionCounts.staleRunning > 0 ? [`Stale running session records: ${sessionCounts.staleRunning}`] : []),
      `AI tool: ${safeContextValue(project.aiTool)}`,
      ...(project.techStack ? [`Tech stack: ${safeContextValue(project.techStack)}`] : []),
      ...(project.description ? [`Description: ${safeContextValue(project.description)}`] : [])
    ].join("\n");
  }
  if (source === "session") {
    const session = new SessionRepository(db, userId).getById(sourceRefId);
    if (!session) return unavailableSourceContext("session", sourceRefId);
    return [
      "OpenForge source context:",
      "Type: session",
      `ID: ${safeContextValue(session.id)}`,
      `Name: ${safeContextValue(session.name)}`,
      `Status: ${safeContextValue(session.status)}`,
      `AI tool: ${safeContextValue(session.aiTool)}`,
      `Project ID: ${safeContextValue(session.projectId)}`,
      ...(session.modelId ? [`Model ID: ${safeContextValue(session.modelId)}`] : [])
    ].join("\n");
  }
  if (source === "feishu") {
    const project = new ProjectRepository(db, userId).getById(sourceRefId);
    if (!project) return unavailableSourceContext("project", sourceRefId);
    return [
      "OpenForge source context:",
      "Type: feishu",
      `Project ID: ${safeContextValue(project.id)}`,
      `Project name: ${safeContextValue(project.name)}`,
      `Project record status: ${safeContextValue(project.status)}`,
      `AI tool: ${safeContextValue(project.aiTool)}`,
      ...(project.techStack ? [`Tech stack: ${safeContextValue(project.techStack)}`] : []),
      ...(project.description ? [`Description: ${safeContextValue(project.description)}`] : [])
    ].join("\n");
  }
  return null;
}

function getProjectSourceSessionCounts(
  sessions: Session[],
  sessionManager?: CopilotOrchestratorOptions["sessionManager"]
): { databaseRunning: number; liveRuntime: number | null; staleRunning: number } {
  const runningRecords = sessions.filter((session) => session.status === "running" || session.status === "detached");
  const runtimeSessions = readRuntimeSessionIndex(sessionManager);
  if (!runtimeSessions) {
    return {
      databaseRunning: runningRecords.length,
      liveRuntime: null,
      staleRunning: 0
    };
  }
  const liveRuntime = runningRecords.filter((session) => {
    const runtime = runtimeSessions.get(session.id);
    if (!runtime) return false;
    const tmuxMatches = !session.tmuxSession || !runtime.tmuxName || runtime.tmuxName === session.tmuxSession;
    return tmuxMatches && (runtime.status === "running" || runtime.status === "detached");
  }).length;
  return {
    databaseRunning: runningRecords.length,
    liveRuntime,
    staleRunning: runningRecords.length - liveRuntime
  };
}

function readRuntimeSessionIndex(
  sessionManager?: CopilotOrchestratorOptions["sessionManager"]
): Map<string, { status: string; tmuxName: string }> | null {
  try {
    const runtimeSessions = sessionManager?.listSessions?.();
    if (!runtimeSessions) return null;
    return new Map(runtimeSessions.map((session) => [session.id, {
      status: session.status,
      tmuxName: session.tmuxName
    }]));
  } catch {
    return null;
  }
}

function unavailableSourceContext(type: "project" | "session", sourceRefId: string): string {
  return [
    "OpenForge source context unavailable:",
    `Type: ${type}`,
    `ID: ${safeContextValue(sourceRefId)}`,
    "Reason: not visible to the current user"
  ].join("\n");
}

function safeContextValue(value: string): string {
  const redacted = redactCopilotText(value).replace(/\s+/g, " ").trim();
  return redacted.length > 200 ? `${redacted.slice(0, 197)}...` : redacted;
}

function requiresSessionStatusEvidence(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const asksAboutSession = /会话|session/u.test(normalized);
  const asksAboutProjectRuntime = /项目|project/u.test(normalized) &&
    /正在运行|运行中|运行状态|是否.*运行|有没有.*运行|有无.*运行|active|running|live/u.test(normalized);
  return (asksAboutSession || asksAboutProjectRuntime) &&
    /正在运行|运行中|活跃|active|running|live|状态|情况|有没有|是否|有无|存在|查看|看看|check|show|list/u.test(normalized);
}

function hasSessionStatusEvidence(events: CopilotRunEvent[]): boolean {
  return events.some((event) =>
    event.type === "tool_result" &&
    (
      event.message === "openforge.list_sessions" ||
      event.message === "openforge.get_session_detail" ||
      event.message === "openforge.get_session_terminal_snapshot"
    )
  );
}

function applyDeterministicSessionStatusAnswerIfNeeded(
  prompt: string,
  evidenceEvents: CopilotRunEvent[],
  candidateEvents: CopilotModelEvent[]
): CopilotModelEvent[] {
  if (!requiresSessionStatusEvidence(prompt)) return candidateEvents;
  if (candidateEvents.some((event) => event.type === "tool_call_requested" || event.type === "run_failed")) {
    return candidateEvents;
  }
  if (!candidateEvents.some((event) => event.type === "assistant_message")) return candidateEvents;
  const answer = deriveDeterministicSessionStatusAnswer(prompt, evidenceEvents);
  if (!answer) return candidateEvents;
  return isNoLiveSessionAnswer(answer) ? [{ type: "assistant_message", text: answer }] : candidateEvents;
}

function stripPrematureAssistantMessagesForSessionEvidence(
  prompt: string,
  previousEvents: CopilotRunEvent[],
  candidateEvents: CopilotModelEvent[]
): CopilotModelEvent[] {
  if (!requiresSessionStatusEvidence(prompt)) return candidateEvents;
  if (hasSessionStatusEvidence(previousEvents)) return candidateEvents;
  if (!candidateEvents.some((event) => event.type === "tool_call_requested")) return candidateEvents;
  return candidateEvents.filter((event) => event.type !== "assistant_message");
}

function deriveDeterministicSessionStatusAnswer(prompt: string, events: CopilotRunEvent[]): string | null {
  const projectSummaries = readToolOutputArrays(events, "openforge.list_projects", "projects")
    .map(toRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const sessionSummaries = readToolOutputArrays(events, "openforge.list_sessions", "sessions")
    .map(toRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const projectDetails = readToolOutputs(events, "openforge.get_project_detail")
    .map((output) => toRecord(output)?.project)
    .map(toRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const projects = [...projectSummaries, ...projectDetails];
  const matchedProjects = projects.filter((project) => promptMentionsValue(prompt, readStringField(project, "name")));
  const relevantProjects = matchedProjects.length > 0 ? matchedProjects : projects.length === 1 ? projects : [];
  if (relevantProjects.length === 0 && sessionSummaries.length === 0) return null;

  const projectNames = relevantProjects.map((project) => readStringField(project, "name")).filter(Boolean);
  const relevantSessions = sessionSummaries.filter((session) => {
    if (projectNames.length === 0) return true;
    const projectName = readStringField(session, "projectName");
    return projectNames.some((name) => projectName === name);
  });
  const liveSessions = relevantSessions.filter(isLiveSessionSummary);
  if (liveSessions.length > 0) {
    const label = projectNames[0] ?? "当前查询范围";
    const names = liveSessions
      .map((session) => readStringField(session, "name") ?? readStringField(session, "id"))
      .filter(Boolean)
      .slice(0, 3)
      .join("、");
    return `${label} 有 ${liveSessions.length} 个正在运行的会话${names ? `：${names}` : ""}。`;
  }

  const projectWithLiveSessions = relevantProjects.find((project) =>
    readNumberField(project, "runningSessionCount") > 0 ||
    readBooleanField(project, "hasRunningSession") === true ||
    readStringField(project, "sessionStatus") === "has_running_sessions"
  );
  if (projectWithLiveSessions) {
    const name = readStringField(projectWithLiveSessions, "name") ?? "当前项目";
    const count = readNumberField(projectWithLiveSessions, "runningSessionCount");
    return `${name} 有 ${count > 0 ? count : 1} 个正在运行的会话。`;
  }

  const noLiveProject = relevantProjects.find((project) =>
    readStringField(project, "sessionStatus") === "no_running_sessions" ||
    readStringField(project, "sessionStatus") === "no_live_sessions_stale_records" ||
    readNumberField(project, "runningSessionCount") === 0 ||
    readBooleanField(project, "hasRunningSession") === false
  );
  if (noLiveProject || relevantSessions.length === 0) {
    const name = noLiveProject ? readStringField(noLiveProject, "name") ?? "当前项目" : projectNames[0] ?? "当前查询范围";
    const staleCount = noLiveProject ? readNumberField(noLiveProject, "staleRunningSessionCount") : 0;
    const staleText = staleCount > 0 ? `检测到 ${staleCount} 条陈旧的运行记录，但 Gateway 当前没有对应的实时会话。` : "";
    return `${name} 没有正在运行的会话。项目状态 active 只表示项目记录可用，不是会话运行状态。${staleText}`.trim();
  }

  return null;
}

function isNoLiveSessionAnswer(answer: string): boolean {
  return /没有正在运行的会话|no running sessions|no live running session/iu.test(answer);
}

function readToolOutputs(events: CopilotRunEvent[], toolName: string): unknown[] {
  return events
    .filter((event) => event.type === "tool_result" && event.message === toolName)
    .map((event) => toRecord(event.payload)?.output);
}

function readToolOutputArrays(events: CopilotRunEvent[], toolName: string, key: string): unknown[] {
  return readToolOutputs(events, toolName).flatMap((output) => {
    const value = toRecord(output)?.[key];
    return Array.isArray(value) ? value : [];
  });
}

function isLiveSessionSummary(session: Record<string, unknown>): boolean {
  const status = readStringField(session, "status");
  const runtimeStatus = readStringField(session, "runtimeStatus");
  return readBooleanField(session, "isLive") === true ||
    ((status === "running" || status === "detached") && runtimeStatus !== "stale");
}

function promptMentionsValue(prompt: string, value: string | null): boolean {
  if (!value) return false;
  return prompt.toLowerCase().includes(value.toLowerCase());
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readBooleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function toToolResultModelRequest(
  selection: Pick<CopilotProviderSelection, "model">,
  originalPrompt: string,
  conversationContext: string | null,
  toolResults: Array<{
    toolCall: Extract<CopilotModelEvent, { type: "tool_call_requested" }>;
    output: unknown;
  }>,
  toolRegistry: CopilotToolRegistry
): CopilotModelRequest {
  const requestBlock = buildConversationAwareRequestBlock(originalPrompt, conversationContext, "Original user request");
  return {
    model: selection.model.modelId,
    instructions: buildCopilotInstructions([
      "Use the provided OpenForge tool results to answer the user's original request.",
      "When more OpenForge context is required, request another available OpenForge tool instead of guessing.",
      "Only say a session is active or running when a session tool result shows a session with that status.",
      "If an approved terminal input result has terminal.tracking.status changed_timeout or unchanged_timeout, summarize the latest captured output, say the terminal work may still be running, and do not claim the terminal work is complete unless the captured terminal text itself proves completion.",
    ]),
    input: [
      requestBlock,
      "",
      toolResults.length === 1 ? "Tool result:" : "Tool results:",
      ...toolResults.flatMap(({ toolCall, output }, index) => [
        `${index + 1}. ${toolCall.name} returned:`,
        JSON.stringify(redactCopilotPayload(output), null, 2)
      ]),
      "",
      "Write a concise, actionable answer for the user."
    ].join("\n"),
    tools: toModelToolDefinitions(toolRegistry),
    maxOutputTokens: 1024
  };
}

function buildConversationAwareRequestBlock(
  prompt: string,
  conversationContext: string | null,
  promptLabel: "Current user request" | "Original user request"
): string {
  if (!conversationContext) return promptLabel === "Original user request"
    ? [promptLabel, prompt].join(":\n")
    : prompt;
  return [
    "Conversation context:",
    conversationContext,
    "",
    `${promptLabel}:`,
    prompt
  ].join("\n");
}

function storeModelEvent(
  repo: CopilotRepository,
  runId: string,
  event: CopilotModelEvent
): CopilotRunEvent {
  if (event.type === "assistant_message") {
    const text = sanitizeCopilotAssistantText(event.text);
    return repo.addEvent(runId, {
      type: event.type,
      message: text,
      payload: { text }
    });
  }
  if (event.type === "tool_call_requested") {
    return repo.addEvent(runId, {
      type: event.type,
      message: redactCopilotText(event.name),
      payload: redactCopilotPayload({ id: event.id, name: event.name, input: event.input }) as Record<string, unknown>
    });
  }
  return repo.addEvent(runId, {
    type: event.type,
    message: redactCopilotText(event.message),
    payload: { code: normalizeCopilotErrorCode(event.code), message: redactCopilotText(event.message) }
  });
}

function redactCopilotServiceError(error: CopilotServiceError): CopilotServiceError {
  return {
    code: normalizeCopilotErrorCode(error.code),
    message: redactCopilotText(error.message)
  };
}

function normalizeCopilotErrorCode(code: string): string {
  return /^copilot_[a-z0-9_]{1,120}$/u.test(code) ? code : "copilot_model_request_failed";
}

function modelRequestError(error?: unknown): CopilotServiceError {
  if (error instanceof CopilotSseParseError) {
    return {
      code: "copilot_provider_stream_parse_failed",
      message: "Model provider stream response could not be parsed"
    };
  }
  if (error instanceof TypeError) {
    return {
      code: "copilot_provider_network_failed",
      message: "Model provider network request failed"
    };
  }
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
