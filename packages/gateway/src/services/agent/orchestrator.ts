import { CopilotModelResponseRepository } from "../../db/repositories/copilot-model-response-repository.js";
import type { LlmResult } from "./llm-response.js";
import { listAvailableCopilotSkillSummaries } from "./skills/copilot-skill-service.js";
import { visibleToolSchemas, toolUnavailableReason } from "./tool-availability.js";
import { projectActionReceipt } from "../platform-commands/receipt-projection.js";
import { agentActions, agentActionInput, TOOL_COMMANDS } from "../platform-commands/agent-actions.js";
import { checkAgentScope } from "../platform-commands/agent-scope.js";
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import { randomUUID } from "node:crypto";
import { ForgeBadgerEventBus } from "../event-bus.js";
import type { AgentToolRegistry, AgentToolContext } from "./tool-registry.js";
import { executeAgentTool } from "./tool-registry.js";
import type { AgentLlmClient, AgentToolCall } from "./orchestrator-types.js";
import { CopilotConversationLog } from "./conversation-log.js";
import { buildCompressedContext } from "./context.js";
import { AgentMemoryRepository } from "./memory.js";
import { resolveLocalCommandReply } from "./slash-commands.js";
import { listEnabledCopilotPlaybookSummaries } from "./skills/skill-queries.js";
import { containsSensitiveAgentValue, redactAgentValue, redactAgentText, redactAgentErrorMessage } from "./redaction.js";
import { createSecurityPolicy, logSecurityDecision } from "./security-policy.js";
import { AgentError } from "./types.js";
import { CopilotRunLedger, inputDigest, type TurnInput, type Claim, type RunStep } from "./run-ledger.js";
import { executionControl } from "./execution-control.js";
import { selectDiscoveredTools } from './tool-discovery.js';
export interface CopilotOrchestratorDependencies {
    db: import("../../db/types.js").Database;
    masterKey: string;
    toolRegistry: AgentToolRegistry;
    llm: AgentLlmClient;
    eventBus: ForgeBadgerEventBus;
    maxSteps?: number;
    leaseMs?: number;
    isToolDisabled?: (toolName: string) => boolean;
    sessionManager?: import("../session-manager.js").InMemorySessionManager;
    adapterCommandRunner?: import("../../lib/dependency-check.js").CommandRunner;
}
/** Durable loop. HTTP uses enqueue; automation uses the waiting runTurn API. */
export function createCopilotOrchestrator(deps: CopilotOrchestratorDependencies) {
    const control = executionControl(deps.db);
    const leaseMs = deps.leaseMs ?? 30000;
    const policy = createSecurityPolicy();
    const ledgerFor = (userId: string) => new CopilotRunLedger(deps.db, userId);
    function emit(ledger: CopilotRunLedger, runId: string, extra: {
        textDelta?: string;
        message?: string;
        toolName?: string;
        pendingActionId?: string;
    } = {}) {
        if (!deps.db.open || control.stopped)
            return;
        const r = ledger.get(runId);
        if (!r)
            return;
        deps.eventBus.emitEvent({ type: "copilot_run_updated", userId: ledger.userId, runId, conversationId: r.conversation_id, status: r.status, source: r.source, revision: r.revision,
            ...extra, ...(extra.textDelta !== undefined ? { textDelta: redactAgentText(extra.textDelta) } : {}),
            ...(extra.message !== undefined ? { message: redactAgentText(extra.message) } : {}),
            ...(extra.toolName !== undefined ? { toolName: redactAgentText(extra.toolName) } : {}), occurredAt: new Date() });
    }
    const allVisibleTools = (input: TurnInput) => visibleToolSchemas(deps.toolRegistry, {
        hasSessionManager: !!deps.sessionManager, isToolDisabled: deps.isToolDisabled,
        scheduled: input.source === "scheduled", reactive: input.source === "reactive"
    });
    const effect = (name: string) => deps.toolRegistry.tools.get(name)?.risk === "operate" || name === "write_memory" ? "write" as const : "read" as const;
    function enqueue(input: TurnInput): string {
        if (control.stopped)
            throw new AgentError("COPILOT_RUNTIME_STOPPED", "Copilot runtime is shutting down");
        const runId = ledgerFor(input.userId).admit(input, deps.maxSteps ?? 16);
        // Admission is synchronous and durable before the worker is queued.
        queueMicrotask(() => { void executeRun(input.userId, runId); });
        return runId;
    }
    async function runTurn(input: TurnInput): Promise<string> {
        if (control.stopped)
            throw new AgentError("COPILOT_RUNTIME_STOPPED", "Copilot runtime is shutting down");
        const runId = ledgerFor(input.userId).admit(input, deps.maxSteps ?? 16);
        await executeRun(input.userId, runId);
        if (!deps.db.open || control.stopped)
            return runId;
        const result = ledgerFor(input.userId).log.getRun(runId);
        if (result?.status === "failed")
            throw new AgentError(result.stopReason ?? "COPILOT_FAILED", result.error ?? "Copilot failed");
        return runId;
    }
    async function executeRun(userId: string, runId: string): Promise<void> {
        if (control.stopped || !deps.db.open)
            return;
        const existing = control.active.get(runId);
        if (existing)
            return existing.promise;
        const ledger = ledgerFor(userId);
        const claim = ledger.claim(runId, randomUUID(), leaseMs);
        if (!claim) {
            emit(ledger, runId);
            return;
        }
        const controller = new AbortController();
        const timer = setInterval(() => { if (control.stopped || !deps.db.open) {
            clearInterval(timer);
            controller.abort();
            return;
        } if (!ledger.renew(claim, leaseMs))
            controller.abort(); }, Math.max(10, Math.floor(leaseMs / 3)));
        timer.unref();
        const promise = Promise.resolve().then(() => drive(ledger, claim, controller.signal)).catch(error => {
            if (!deps.db.open || control.stopped)
                return;
            const interruptedWrite = ledger.steps(runId).find(s => s.status === "running" && s.effect === "write");
            if (interruptedWrite) {
                ledger.receipt(claim, interruptedWrite, "Tool outcome unknown after execution error", true);
                emit(ledger, runId);
                return;
            }
            if (error instanceof AgentError && error.code === 'AGENT_LLM_INVALID_RESPONSE') {
                ledger.commit(claim, () => new CopilotModelResponseRepository(deps.db, userId, deps.masterKey)
                    .recordInvalidResponse(runId, error.message));
            }
            ledger.commit(claim, () => deps.db.prepare("UPDATE copilot_run_steps SET status='failed',result_json=COALESCE(result_json,?),completed_at=? WHERE user_id=? AND run_id=? AND kind='model' AND status='running' AND fence=?")
                .run(error instanceof AgentError ? error.code : null, Date.now(), userId, runId, claim.fence));
            ledger.finish(claim, "failed", error instanceof AgentError ? error.code : redactAgentErrorMessage(error instanceof Error ? error.message : "Copilot failed"));
            emit(ledger, runId);
        }).finally(() => { clearInterval(timer); control.active.delete(runId); });
        control.active.set(runId, { controller, promise, stopLease: () => clearInterval(timer) });
        return promise;
    }
    async function drive(ledger: CopilotRunLedger, c: Claim, signal: AbortSignal): Promise<void> {
        const input = JSON.parse(ledger.get(c.runId)!.input_json) as TurnInput;
        ledger.validateScope(input);
        const live = () => {
            if (control.stopped || signal.aborted || !ledger.owns(c)) return false;
            ledger.validateScope(input);
            return true;
        };
        while (live()) {
            ledger.validateScope(input);
            const pending = ledger.steps(c.runId).find(s => s.kind === "tool" && s.status !== "completed");
            if (pending) {
                await toolStep(ledger, c, pending, input, live);
                continue;
            }
            const step = ledger.modelStep(c);
            if (!step || !live())
                break;
            if (!ledger.startStep(c, step))
                break;
            const command = ledger.get(c.runId)!.steps === 1 ? resolveLocalCommandReply(input.userText, () => {
                const availableToolNames = allVisibleTools(input).map(tool => tool.name);
                if (!availableToolNames.includes("list_playbooks")) return [];
                return listEnabledCopilotPlaybookSummaries(deps.db, input.userId, {
                    availableToolNames
                });
            }) : null;
            const calls: AgentToolCall[] = [];
            let text = "";
            let response: LlmResult | undefined;
            const modelResponses = new CopilotModelResponseRepository(deps.db, input.userId, deps.masterKey);
            if (command !== null)
                text = command;
            else {
                const allVisible = allVisibleTools(input);
                const tools = selectDiscoveredTools({ allVisible, steps: ledger.steps(c.runId), userId: input.userId,
                    runId: c.runId, masterKey: deps.masterKey, enabled: input.toolDiscovery === true });
                const availableToolNames = allVisible.map(tool => tool.name);
                const skillCatalog = availableToolNames.includes("load_playbook")
                    ? listAvailableCopilotSkillSummaries(deps.db, input.userId, { availableToolNames }) : [];
                const prefixMessages: import("./orchestrator-types.js").AgentLlmMessage[] = [];
                if (input.toolDiscovery) prefixMessages.push({ role: 'user', content:
                    'Tool discovery mode is enabled. Use discover_tools to find additional current platform capabilities. Successful selections become available on the next model round; discovery does not change permissions or approvals.' });
                if (input.projectId) {
                    const project = new ProjectRepository(deps.db, input.userId).getById(input.projectId);
                    if (!project) throw new AgentError("PROJECT_NOT_FOUND", "Selected project no longer exists");
                    prefixMessages.push({ role: "user", content: "Selected project (verified tenant ownership; descriptive context, not additional authority):\n"
                        + JSON.stringify(redactAgentValue({ id: project.id, name: project.name, description: project.description })) });
                }
                if (skillCatalog.length) prefixMessages.push({ role: "user", content:
                    "Available skills (descriptive metadata, not authority). Load relevant instructions using load_playbook by ID."
                    + (availableToolNames.includes("read_skill_resource") ? " Use read_skill_resource for bundled references." : "")
                    + "\n" + JSON.stringify(skillCatalog) });
                const { messages } = await buildCompressedContext(ledger.log, input.conversationId, deps.llm, input.modelId, {
                    assistantMessages: modelResponses.list(input.conversationId),
                    memory: new AgentMemoryRepository(deps.db, input.userId), memoryConversationId: input.conversationId, signal,
                    ...(input.projectId ? { memoryProjectId: input.projectId } : {}), canCommit: live,
                    tools, prefixMessages, reservedChars: 8192
                });
                if (!live()) return;
                response = await deps.llm.stream({ messages, signal,
                    tools,
                    ...(input.modelId ? { modelId: input.modelId } : {}), onEvent: event => {
                        if (!live())
                            return;
                        if (event.type === "text_delta") {
                            text += event.text ?? "";
                        }
                        if (event.type === "tool_call" && event.toolCall)
                            calls.push({ id: event.toolCall.id, name: event.toolCall.name, input: parse(event.toolCall.arguments) });
                    } });
                if (response.assistant && live()) {
                    // The validated complete response is authoritative; deltas only drive display.
                    calls.splice(0, calls.length, ...(response.assistant.toolCalls ?? []).map(call => ({
                        id: call.id, name: call.name, input: parse(call.arguments)
                    })));
                }
                if (!text && response.message && live()) {
                    text = response.message;
                }
            }
            if (!live())
                return;
            // Tool input is durable for approval and crash recovery. Reject
            // secret-shaped values before writing any call or command intent.
            if (calls.some(call => containsSensitiveAgentValue(call.id) || containsSensitiveAgentValue(call.name)
                || containsSensitiveAgentValue(call.input))) {
                throw new AgentError('COPILOT_SENSITIVE_TOOL_INPUT', 'Tool call contains credential-shaped content');
            }
            // A token can span arbitrary model deltas. Publish only after the
            // complete response has been scrubbed; a prior raw delta cannot be retracted.
            if (command === null && text) {
                const safeText = redactAgentText(text);
                for (let offset = 0; offset < safeText.length; offset += 4096)
                    emit(ledger, c.runId, { textDelta: safeText.slice(offset, offset + 4096) });
            }
            let completed = false;
            ledger.commit(c, () => {
                if (response?.assistant) modelResponses.complete(input.conversationId, c.runId, step.id, response);
                else ledger.completeStep(step.id, text);
                if (command !== null)
                    deps.db.prepare("UPDATE copilot_runs SET steps=0 WHERE user_id=? AND id=?").run(ledger.userId, c.runId);
                if (text || calls.length === 0)
                    ledger.append(c.runId, { role: "assistant", kind: "text", content: text }, step.id);
                for (const call of calls) {
                    const tool = ledger.addStep(c.runId, { kind: "tool", toolCallId: call.id, toolName: call.name, inputJson: JSON.stringify(call.input), effect: effect(call.name) });
                    ledger.append(c.runId, { role: "assistant", kind: "tool_call", content: call.name, toolName: call.name, toolInputJson: JSON.stringify(call.input), toolCallId: call.id }, tool.id);
                }
                if (calls.length === 0)
                    completed = ledger.finish(c, "completed");
            });
            if (calls.length === 0) {
                if (completed) {
                    emit(ledger, c.runId, { message: text });
                    // Await best-effort helpers so shutdown cannot close their database midway.
                    if (command === null && !control.stopped && ledger.get(c.runId)?.status === "completed") {
                        ledger.validateScope(input);
                        await maybeAutoTitle({ log: ledger.log, userId: input.userId, conversationId: input.conversationId, userText: input.userText, assistantText: text, source: input.source ?? "user", signal, canCommit: () => { if(control.stopped || !deps.db.open)return false; ledger.validateScope(input); return !!ledger.log.getConversation(input.conversationId) && ledger.log.listRuns(input.conversationId)[0]?.id === c.runId; }, runId: c.runId, eventBus: deps.eventBus, llm: deps.llm, ...(input.modelId ? { modelId: input.modelId } : {}) }).catch(() => undefined);
                        // Durable memory writes are platform commands; background curation
                        // cannot bypass the project autonomy switch or exact one-shot approval.
                    }
                }
                return;
            }
        }
        emit(ledger, c.runId);
    }
    async function toolStep(ledger: CopilotRunLedger, c: Claim, step: RunStep, input: TurnInput, live: () => boolean): Promise<void> {
        if (!live())
            return;
        const tool = deps.toolRegistry.tools.get(step.tool_name!);
        const raw = parse(step.input_json!);
        const action = ledger.log.listPendingActions(c.runId).find(a => a.stepId === step.id);
        let rejection: string | undefined;
        if (!tool)
            rejection = `Unknown tool: ${step.tool_name}`;
        else if (toolUnavailableReason(tool.name, !!deps.sessionManager))
            rejection = `Tool unavailable: ${toolUnavailableReason(tool.name, !!deps.sessionManager)}`;
        else if (deps.isToolDisabled?.(tool.name))
            rejection = `Tool disabled by owner: ${tool.name}`;
        else if (tool.name.startsWith("mcp_") && (input.source && input.source !== "user"))
            rejection = "External tools require direct owner authority";
        else if (input.source === "scheduled" && effect(tool.name) === "write")
            rejection = "Scheduled runs are read only";
        else if (inputDigest(step.input_json!) !== step.input_digest || (action && action.inputDigest !== step.input_digest))
            rejection = "Tool input digest mismatch";
        else if (!tool.inputSchema.safeParse(raw).success)
            rejection = "Invalid tool input";
        else if (action?.status === "rejected")
            rejection = "Action rejected by owner";
        const availableToolSchemas = allVisibleTools(input);
        const context: AgentToolContext = { source: input.source ?? "user", runId: c.runId, stepId: step.id, externalActionId: action?.id, checkExecutionAuthority: live, userId: input.userId, db: deps.db, masterKey: deps.masterKey, conversationId: input.conversationId,
            availableToolNames: availableToolSchemas.map(tool => tool.name), availableToolSchemas,
            ...(input.projectId ? { projectId: input.projectId } : {}), ...(deps.sessionManager ? { sessionManager: deps.sessionManager } : {}), ...(deps.adapterCommandRunner ? { adapterCommandRunner: deps.adapterCommandRunner } : {}) };
        if (!rejection && tool) {
            try { checkAgentScope(context, tool.name, raw); } catch (error) { rejection = error instanceof Error ? error.message : "Tool scope rejected"; }
            const decision = policy.evaluate({ userId: input.userId, toolName: tool.name, toolRisk: tool.risk, requiresApproval: tool.requiresApproval, input: raw });
            logSecurityDecision({ db: deps.db, userId: input.userId, operation: tool.name, input: raw, action: decision.action, reason: decision.reason });
            if (decision.action === "deny") rejection = `Denied by security policy: ${decision.reason}`;
            if (!rejection && tool.risk === "operate" && TOOL_COMMANDS[tool.name]) {
                try {
                    const actions = agentActions(context);
                    let intent = actions.intents.byKey(step.id);
                    if (!intent) intent = actions.preview({ commandId: TOOL_COMMANDS[tool.name], input: agentActionInput(tool.name, raw, context), idempotencyKey: step.id });
                    context.platformIntentId = intent.id;
                    if (intent.status === "pending" || action?.status !== "approved") {
                        ledger.waitApproval(c, step);
                        const pending = ledger.log.listPendingActions(c.runId).find(a => a.stepId === step.id);
                        emit(ledger, c.runId, { toolName: tool.name, ...(pending ? { pendingActionId: pending.id } : {}) });
                        return;
                    }
                    if (intent.status === "rejected") rejection = "Action rejected";
                } catch (error) { rejection = error instanceof Error ? error.message : "Platform action rejected"; }
            } else if (!rejection && tool.risk === "operate" && action?.status !== "approved") {
                ledger.waitApproval(c, step);
                return;
            }
        }
        if (!ledger.startStep(c, step)) return;
        if (rejection) { ledger.receipt(c, step, rejection.startsWith("Denied by security policy:") ? rejection : `Denied by security policy: ${rejection}`); return; }
        const result = await executeAgentTool(tool!, raw, context);
        const platformActions=typeof context.platformIntentId==="string"?agentActions(context):undefined;
        const platformReceipt=platformActions?.intents.receipt(context.platformIntentId as string);
        const content=platformReceipt?projectActionReceipt(platformReceipt):result.ok?JSON.stringify(redactAgentValue(result.output)):`Tool error: ${result.error??"unknown"}`;
        const intent=platformActions?.intents.get(context.platformIntentId as string);
        const unknownEffect=platformReceipt?platformReceipt.outcome==="unknown":!result.ok&&step.effect==="write"&&(!intent||["executing","indeterminate"].includes(intent.status));
        ledger.receipt(c,step,content,unknownEffect);
        if (live())
            emit(ledger, c.runId, { toolName: step.tool_name!, message: result.ok ? "ok" : "error" });
    }
    async function resumeAfterApproval(input: {
        userId: string;
        runId: string;
        actionId: string;
        approved: boolean;
        async?: boolean;
    }) {
        const resumed = deps.db.transaction(() => {
            const ledger = ledgerFor(input.userId);
            const pending = ledger.log.getPendingAction(input.actionId);
            if (input.approved && pending?.runId === input.runId && pending.status === "pending") {
                const tool = deps.toolRegistry.tools.get(pending.tool);
                if (!tool || toolUnavailableReason(tool.name, !!deps.sessionManager)) {
                    throw new AgentError("COPILOT_TOOL_UNAVAILABLE", "This tool is no longer available. Reject the old action and create a new request.");
                }
            }
            const changed = ledger.decide(input.runId,input.actionId,input.approved);
            if(!changed)return false;
            return true;
        }).immediate();
        if (resumed) {
            if (input.async)
                queueMicrotask(() => { void executeRun(input.userId, input.runId); });
            else
                await executeRun(input.userId, input.runId);
        }
        return { resumed, runId: input.runId };
    }
    async function cancelRun(input: {
        userId: string;
        runId: string;
    }) {
        const ledger = ledgerFor(input.userId);
        const cancelled = ledger.cancel(input.runId);
        if (cancelled) {
            control.active.get(input.runId)?.controller.abort();
            emit(ledger, input.runId, { message: "Run cancelled" });
        }
        return { cancelled, runId: input.runId };
    }
    return { enqueue, runTurn, executeRun, resumeAfterApproval, cancelRun };
}
function parse(value: string): unknown { try {
    return JSON.parse(value);
}
catch {
    return null;
} }
async function maybeAutoTitle(input: {
    log: CopilotConversationLog;
    userId: string;
    conversationId: string;
    userText: string;
    assistantText: string;
    source: "user" | "reactive" | "scheduled";
    runId: string;
    eventBus: ForgeBadgerEventBus;
    llm: AgentLlmClient;
    modelId?: string;
    signal?: AbortSignal;
    canCommit?: () => boolean;
}): Promise<void> {
    if (input.source !== "user")
        return;
    const conversation = input.log.getConversation(input.conversationId);
    if (!conversation || conversation.title !== null)
        return;
    try {
        const generated = await input.llm.generateTitle({
            userText: input.userText,
            assistantText: input.assistantText,
            ...(input.signal ? { signal: input.signal } : {}),
            ...(input.modelId !== undefined ? { modelId: input.modelId } : {})
        });
        if (!generated)
            return;
        // Re-check the title right before writing — a parallel rename from the
        // owner (renameConversation endpoint) could have raced us between the
        // check above and now. Never overwrite an owner-set title.
        if (!(input.canCommit?.() ?? true))
            return;
        const fresh = input.log.getConversation(input.conversationId);
        if (!fresh || fresh.title !== null)
            return;
        const safeTitle = redactAgentText(generated);
        input.log.renameConversation(input.conversationId, safeTitle);
        input.eventBus.emitEvent({
            type: "copilot_run_updated",
            userId: input.userId,
            runId: input.runId,
            conversationId: input.conversationId,
            status: "completed",
            titleUpdated: safeTitle,
            occurredAt: new Date()
        });
    }
    catch {
        // Auto-title is best-effort. A model failure must not surface as a Copilot
        // turn failure — the run already completed.
    }
}
