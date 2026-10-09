import type { TaskReviewOrigin } from './task-review.js';
import { repairIdentity, type RepairOrigin } from './development-repair.js';
import { validateRepairJob } from '../development/repair-scope.js';
import { ProjectManagerRepository } from '../../db/repositories/project-manager-repository.js';
import { readTaskDispatchAttempt } from '../project-manager/task-execution.js';
import { verifiedDispatchEvidence } from '../project-manager/task-progress.js';
import { assertChannelRunScope, prepareChannelAdmission, type ChannelRunScope } from '../channels/channel-run-scope.js';
import { projectActionReceipt } from "../platform-commands/receipt-projection.js";
import { PlatformActionRepository } from "../../db/repositories/platform-action-repository.js";
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../db/types.js";
import { CopilotConversationLog } from "./conversation-log.js";
import { AgentError, type AgentRunStatus } from "./types.js";
import { redactAgentText } from "./redaction.js";
import { runDuration, settleApprovalWait } from './approval-clock.js';
import { traceRunEvent } from './run-trace.js';
import { PARENT_CHAIN_MAX_DEPTH, parseRunInput } from './run-authorization.js';
export interface TurnInput {
    /** Server-derived authority; never accepted from HTTP/model JSON. */
    channelScope?: ChannelRunScope;
    executionMode?: 'research' | 'review' | 'repair';
    repairOrigin?: RepairOrigin;
    repairFailedChecks?: boolean;
    reviewOrigin?: TaskReviewOrigin;
    parentRunId?: string;
    reviewTaskResults?: boolean;
    userId: string;
    conversationId: string;
    userText: string;
    modelId?: string;
    projectId?: string;
    source?: "user" | "reactive" | "scheduled";
    skipUserMessage?: boolean;
    clientRequestId?: string;
    editMessageId?: string;
    toolDiscovery?: boolean;
}
export interface RunRecord {
    id: string;
    user_id: string;
    conversation_id: string;
    status: AgentRunStatus;
    source: "user" | "reactive" | "scheduled";
    input_json: string;
    steps: number;
    max_steps: number;
    fence: number;
    revision: number;
    lease_owner: string | null;
    lease_expires_at: number | null;
    stop_reason: string | null;
    error: string | null;
    runtime_version: number;
}
export interface RunStep {
    id: string;
    user_id: string;
    run_id: string;
    ordinal: number;
    kind: "model" | "tool";
    status: "pending" | "running" | "awaiting_approval" | "completed" | "failed" | "indeterminate";
    tool_call_id: string | null;
    tool_name: string | null;
    input_json: string | null;
    input_digest: string | null;
    result_json: string | null;
    effect: "read" | "write";
    attempt: number;
    fence: number;
}
export interface Claim {
    runId: string;
    owner: string;
    fence: number;
}
export const ACTIVE_RUN_STATES = ["pending", "running", "awaiting_approval"];
export const inputDigest = (value: string) => createHash("sha256").update(value).digest("hex");
function requestDigest(input: TurnInput): string {
    return inputDigest(JSON.stringify({ content: input.userText, modelId: input.modelId ?? null,
        projectId: input.projectId ?? null,
        source: input.source ?? 'user', skipUserMessage: input.skipUserMessage ?? false,
        ...(input.toolDiscovery === true ? { toolDiscovery: true } : {}),
        ...(input.executionMode ? { executionMode: input.executionMode, parentRunId: input.parentRunId, reviewOrigin: input.reviewOrigin ?? null } : {}),
        ...(input.reviewTaskResults ? { reviewTaskResults: true } : {}),
        ...(input.repairFailedChecks ? { repairFailedChecks: true } : {}),
        ...(input.repairOrigin ? { repairOrigin: input.repairOrigin } : {}),
        ...(input.editMessageId ? { editMessageId: input.editMessageId } : {}) }));
}
/** All writes are tenant scoped; no transaction spans asynchronous work. */
export class CopilotRunLedger {
    readonly log: CopilotConversationLog;
    constructor(readonly db: Database, readonly userId: string) { this.log = new CopilotConversationLog(db, userId); }
    get(id: string): RunRecord | undefined {
        return this.db.prepare("SELECT * FROM copilot_runs WHERE user_id=? AND id=?").get(this.userId, id) as RunRecord | undefined;
    }
    steps(id: string): RunStep[] {
        return this.db.prepare("SELECT * FROM copilot_run_steps WHERE user_id=? AND run_id=? ORDER BY ordinal").all(this.userId, id) as RunStep[];
    }
    validateScope(input: TurnInput): void {
        // Descend the parent chain running each level's restricted-origin checks
        // (nested executionMode is forbidden, so valid chains are short; the
        // shared depth-8 cap fails closed regardless), then walk the collected
        // levels deepest-first — per level the repair/review checks then the
        // common checks, exactly like the former recursion.
        const levels: TurnInput[] = [];
        let current = input;
        for (let depth = 0; ; depth += 1) {
            if (!current.executionMode) { levels.push(current); break; }
            const parent = current.parentRunId ? this.get(current.parentRunId) : undefined;
            if (!current.projectId || !['research', 'review', 'repair'].includes(current.executionMode) || !parent
                || ['cancelled', 'failed', 'indeterminate'].includes(parent.status))
                throw new AgentError('COPILOT_RESTRICTED_ORIGIN', 'Read-only task origin is no longer valid');
            if (depth >= PARENT_CHAIN_MAX_DEPTH - 1)
                throw new AgentError('COPILOT_RESTRICTED_ORIGIN', 'Read-only task origin is no longer valid');
            const origin = parseRunInput(parent);
            if (origin.executionMode || (origin.projectId && origin.projectId !== current.projectId))
                throw new AgentError('COPILOT_RESTRICTED_ORIGIN', 'Nested or cross-project research is not allowed');
            levels.push(current);
            current = origin;
        }
        for (const level of levels.reverse()) {
            if (level.executionMode === 'repair') {
                const { root } = validateRepairJob(this.db, this.userId, repairIdentity(this.userId, level));
                if (root.project_id !== level.projectId) throw new AgentError('COPILOT_REPAIR_SCOPE', 'Repair project mismatch');
            }
            if (level.executionMode === 'review') {
                const parent = level.parentRunId ? this.get(level.parentRunId) : undefined;
                const origin = parent ? parseRunInput(parent) : undefined;
                const evidence = level.reviewOrigin;
                const item = evidence && new ProjectManagerRepository(this.db, this.userId).getWorkItem(evidence.projectId, evidence.workItemId);
                const attempt = item && readTaskDispatchAttempt(item);
                if (!evidence || evidence.projectId !== level.projectId || !attempt || attempt.id !== evidence.attemptId
                    || attempt.originIntentId !== evidence.intentId || attempt.consumedNotificationId !== evidence.notificationId
                    || !verifiedDispatchEvidence({ db: this.db, userId: this.userId }, evidence.projectId, evidence.workItemId, evidence.notificationId)?.notifications.some(row => row.id === evidence.notificationId))
                    throw new AgentError('COPILOT_REVIEW_ORIGIN', 'Task review evidence changed or was revoked');
                const action = new PlatformActionRepository(this.db, this.userId).get(evidence.intentId);
                if (!parent || action?.origin_run_id !== parent.id || !origin?.reviewTaskResults)
                    throw new AgentError('COPILOT_REVIEW_ORIGIN', 'Task review is not authorized by this origin');
            }
            this.validateScopeCommon(level);
        }
    }
    /** Conversation/user/channel/project invariants, per chain level, deepest first. */
    private validateScopeCommon(input: TurnInput): void {
        if (input.toolDiscovery !== undefined && typeof input.toolDiscovery !== 'boolean')
            throw new AgentError('COPILOT_TOOL_DISCOVERY_INVALID', 'Tool discovery must be a boolean');
        if (input.userId !== this.userId || !this.log.getConversation(input.conversationId))
            throw new AgentError("COPILOT_NOT_FOUND", "Conversation not found");
        const user = this.db.prepare("SELECT status FROM users WHERE id=?").get(this.userId) as {
            status: string;
        } | undefined;
        if (user?.status !== "active")
            throw new AgentError("COPILOT_USER_INACTIVE", "User is not active");
        assertChannelRunScope(this.db, this.userId, input);
        if (input.projectId && !this.db.prepare("SELECT id FROM projects WHERE user_id=? AND id=?").get(this.userId, input.projectId))
            throw new AgentError("COPILOT_PROJECT_NOT_FOUND", "Project not found");
    }
    findRequest(input: TurnInput): string | undefined {
        input = prepareChannelAdmission(this.db, this.userId, input);
        this.validateScope(input);
        if (input.clientRequestId === undefined) return;
        if (!input.clientRequestId.trim() || input.clientRequestId.length > 128)
            throw new AgentError('COPILOT_REQUEST_KEY_INVALID', 'Invalid client request key');
        const existing = this.db.prepare('SELECT id,request_digest FROM copilot_runs WHERE user_id=? AND conversation_id=? AND client_request_id=?')
            .get(this.userId, input.conversationId, input.clientRequestId) as { id: string; request_digest: string } | undefined;
        if (!existing) return;
        if (existing.request_digest !== requestDigest(input))
            throw new AgentError('COPILOT_REQUEST_CONFLICT', 'Client request key was used for a different payload');
        return existing.id;
    }
    admit(input: TurnInput, maxSteps: number): string {
        return this.db.transaction(() => {
            input = prepareChannelAdmission(this.db, this.userId, input);
            const existing = this.findRequest(input);
            if (existing) return existing;
            const digest = requestDigest(input);
            if (this.log.listRuns(input.conversationId).some(r => ACTIVE_RUN_STATES.includes(r.status)))
                throw new AgentError("COPILOT_CONVERSATION_BUSY", "Conversation already has an active run");
            const run = this.log.createRun(input.conversationId, input.modelId ? { model: input.modelId } : {});
            this.db.prepare("UPDATE copilot_runs SET runtime_version=1, input_json=?, source=?, max_steps=?,client_request_id=?,request_digest=? WHERE user_id=? AND id=?")
                .run(JSON.stringify({ ...input, userText: redactAgentText(input.userText) }), input.source ?? "user", maxSteps,
                    input.clientRequestId ?? null, input.clientRequestId ? digest : null, this.userId, run.id);
            if (!input.skipUserMessage)
                this.append(run.id, { role: "user", kind: "text", content: input.userText });
            if (input.executionMode) this.db.prepare('UPDATE copilot_runs SET token_budget=120000,max_duration_ms=300000 WHERE user_id=? AND id=?').run(this.userId, run.id);
            const created = this.get(run.id)!;
            traceRunEvent(this.db, this.userId, run.id, created.fence, 'admitted',
                { source: input.source ?? 'user', parentRunId: !!input.parentRunId, ...(input.executionMode ? { executionMode: input.executionMode } : {}) });
            if (input.executionMode && input.parentRunId)
                traceRunEvent(this.db, this.userId, input.parentRunId, this.get(input.parentRunId)?.fence ?? created.fence,
                    'subrun_admitted', { executionMode: input.executionMode, childRunId: run.id });
            return run.id;
        }).immediate();
    }
    claim(runId: string, owner: string, leaseMs: number): Claim | undefined {
        return this.db.transaction(() => {
            const row = this.get(runId);
            if (!row || row.runtime_version !== 1 || !["pending", "running"].includes(row.status))
                return;
            if (row.lease_owner && (row.lease_expires_at ?? 0) > Date.now())
                return;
            const actions=new PlatformActionRepository(this.db,this.userId);
            for(const unsafe of this.steps(runId).filter(s=>s.status==="running"&&s.effect==="write")) {
                const intent=actions.byKey(unsafe.id);
                const receipt=intent?actions.receipt(intent.id):undefined;
                if(receipt&&receipt.outcome!=="unknown") {
                    const content=projectActionReceipt(receipt);
                    this.completeStep(unsafe.id,content);
                    this.append(runId,{role:"tool",kind:"tool_result",content,toolName:unsafe.tool_name!,toolCallId:unsafe.tool_call_id!},unsafe.id);
                    continue;
                }
                this.db.prepare("UPDATE copilot_run_steps SET status='indeterminate',result_json=COALESCE(?,result_json) WHERE user_id=? AND id=?").run(receipt?projectActionReceipt(receipt):null,this.userId,unsafe.id);
                this.finishUnowned(runId,"indeterminate","interrupted_write_without_confirmed_receipt");
                return;
            }
            this.db.prepare("UPDATE copilot_run_steps SET status='pending' WHERE user_id=? AND run_id=? AND status='running' AND effect='read'").run(this.userId, runId);
            this.db.prepare("UPDATE copilot_runs SET status='running', lease_owner=?, lease_expires_at=?, fence=fence+1, revision=revision+1, started_at=COALESCE(started_at,?), updated_at=? WHERE user_id=? AND id=?")
                .run(owner, Date.now() + leaseMs, Date.now(), Date.now(), this.userId, runId);
            traceRunEvent(this.db, this.userId, runId, row.fence + 1, 'claimed');
            if (row.status === 'running')
                traceRunEvent(this.db, this.userId, runId, row.fence + 1, 'run_recovered', { reason: 'reclaim_after_interruption' });
            return { runId, owner, fence: row.fence + 1 };
        }).immediate();
    }
    owns(c: Claim): boolean {
        if (!this.db.open)
            return false;
        const r = this.get(c.runId);
        return r?.status === "running" && r.lease_owner === c.owner && r.fence === c.fence && (r.lease_expires_at ?? 0) > Date.now();
    }
    commit(c: Claim, fn: () => void): boolean {
        return this.db.transaction(() => {
            if (!this.owns(c))
                return false;
            fn();
            this.db.prepare("UPDATE copilot_runs SET revision=revision+1,updated_at=? WHERE user_id=? AND id=?").run(Date.now(), this.userId, c.runId);
            return true;
        }).immediate();
    }
    renew(c: Claim, leaseMs: number): boolean {
        return this.commit(c, () => { this.db.prepare("UPDATE copilot_runs SET lease_expires_at=? WHERE user_id=? AND id=?").run(Date.now() + leaseMs, this.userId, c.runId); });
    }
    append(runId: string, message: Parameters<CopilotConversationLog["appendMessage"]>[1], stepId?: string): void {
        const run = this.get(runId)!;
        const row = this.log.appendMessage(run.conversation_id, message);
        this.db.prepare("UPDATE copilot_messages SET run_id=?,step_id=? WHERE user_id=? AND id=?").run(runId, stepId ?? null, this.userId, row.id);
    }
    addStep(runId: string, input: {
        kind: "model" | "tool";
        toolCallId?: string;
        toolName?: string;
        inputJson?: string;
        effect?: "read" | "write";
    }): RunStep {
        const id = randomUUID();
        const ordinal = this.steps(runId).length;
        this.db.prepare("INSERT INTO copilot_run_steps(id,user_id,run_id,ordinal,kind,tool_call_id,tool_name,input_json,input_digest,effect) VALUES(?,?,?,?,?,?,?,?,?,?)")
            .run(id, this.userId, runId, ordinal, input.kind, input.toolCallId ?? null, input.toolName ?? null, input.inputJson ?? null, input.inputJson ? inputDigest(input.inputJson) : null, input.effect ?? "read");
        return this.steps(runId).find(s => s.id === id)!;
    }
    startStep(c: Claim, step: RunStep): boolean {
        return this.commit(c, () => {
            this.db.prepare("UPDATE copilot_run_steps SET status='running',attempt=attempt+1,fence=?,started_at=? WHERE user_id=? AND id=? AND status='pending'").run(c.fence, Date.now(), this.userId, step.id);
        });
    }
    /** Any crash retry consumes this allowance too. Occupy before summarization
     * or inference; an interrupted recovery is stopped, not replayed on restart. */
    claimContextRecovery(c: Claim, stepId: string, modelId: string | undefined, budget: number): boolean {
        let claimed = false;
        this.commit(c, () => {
            const result = this.db.prepare(`UPDATE copilot_run_steps SET attempt=attempt+1,result_json=?
                WHERE user_id=? AND run_id=? AND id=? AND kind='model' AND status='running'
                AND fence=? AND attempt=1 AND result_json IS NULL`)
                .run(JSON.stringify({contextRecovery:true,modelId:modelId??null,budget}),this.userId,c.runId,stepId,c.fence);
            claimed = result.changes === 1;
        });
        return claimed;
    }
    modelStep(c: Claim): RunStep | undefined {
        let step: RunStep | undefined;
        this.commit(c, () => {
            step = this.steps(c.runId).find(s => s.kind === "model" && s.status === "pending");
            if (!step || step.attempt > 0) {
                const r = this.get(c.runId)!;
                if (r.steps >= r.max_steps) {
                    this.finishUnowned(c.runId, "stopped", "step_budget_exhausted");
                    step = undefined;
                    return;
                }
                step ??= this.addStep(c.runId, { kind: "model" });
                this.db.prepare("UPDATE copilot_runs SET steps=steps+1 WHERE user_id=? AND id=?").run(this.userId, c.runId);
            }
        });
        return step;
    }
    completeStep(stepId: string, content: string): void {
        this.db.prepare("UPDATE copilot_run_steps SET status='completed',result_json=?,completed_at=? WHERE user_id=? AND id=?")
            .run(redactAgentText(content), Date.now(), this.userId, stepId);
    }
    receipt(c: Claim, step: RunStep, content: string, unknownEffect = false, publish?: (content: string) => string): void {
        if (!this.db.open)
            return;
        this.db.transaction(() => {
            // A late result is evidence only. It cannot publish transcript or advance a run.
            const current = this.steps(c.runId).find(s => s.id === step.id);
            if (!current || current.fence !== c.fence || !["running", "indeterminate"].includes(current.status))
                return;
            const owned = this.owns(c);
            if (owned && publish) content = publish(content);
            this.completeStep(step.id, content);
            if (unknownEffect)
                this.db.prepare("UPDATE copilot_run_steps SET status='indeterminate' WHERE user_id=? AND id=?").run(this.userId, step.id);
            if (!owned)
                return;
            this.append(c.runId, { role: "tool", kind: "tool_result", content, toolName: step.tool_name!, toolCallId: step.tool_call_id! }, step.id);
            if (unknownEffect)
                this.finishUnowned(c.runId, "indeterminate", "tool_effect_unconfirmed");
            else
                this.db.prepare("UPDATE copilot_runs SET revision=revision+1 WHERE user_id=? AND id=?").run(this.userId, c.runId);
        }).immediate();
    }
    waitApproval(c: Claim, step: RunStep): void {
        this.commit(c, () => {
            const stored = this.steps(c.runId).find(s => s.id === step.id);
            // A repeat wait on an already-parked step is an idempotent no-op.
            if (stored?.status === 'awaiting_approval') return;
            const current = stored?.status === 'pending' ? stored : undefined;
            if (!current || current.kind !== 'tool' || !current.input_json || current.input_digest !== inputDigest(current.input_json)
                || current.input_digest !== step.input_digest || current.input_json !== step.input_json
                || current.tool_name !== step.tool_name || current.tool_call_id !== step.tool_call_id) {
                // Stale claims never reach this commit (owns() gates it), so an
                // inconsistent stored step is terminal: settle the run loudly
                // instead of leaving the recovery pump to re-drive the identical
                // mismatch until the run's time budget exhausts. A step from
                // another run is never touched; only this run is settled.
                const reason = 'COPILOT_APPROVAL_CHECKPOINT_MISMATCH';
                if (current)
                    this.db.prepare("UPDATE copilot_run_steps SET status='failed',result_json=?,completed_at=? WHERE user_id=? AND id=?")
                        .run(JSON.stringify({ code: reason }), Date.now(), this.userId, step.id);
                this.finishUnowned(c.runId, 'failed', reason);
                return;
            }
            const now = Date.now();
            const action = this.log.createPendingAction({ runId: c.runId, tool: current.tool_name!, inputJson: current.input_json, inputDigest: current.input_digest! });
            this.db.prepare("UPDATE copilot_pending_actions SET step_id=?,tool_call_id=? WHERE user_id=? AND id=?").run(step.id, step.tool_call_id, this.userId, action.id);
            this.db.prepare("UPDATE copilot_run_steps SET status='awaiting_approval' WHERE user_id=? AND id=?").run(this.userId, step.id);
            this.db.prepare("UPDATE copilot_runs SET status='awaiting_approval',execution_phase='awaiting_approval',phase_started_at=?,approval_wait_started_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE user_id=? AND id=?").run(now, now, this.userId, c.runId);
            traceRunEvent(this.db, this.userId, c.runId, c.fence, 'approval_parked', { toolName: current.tool_name! }, step.id);
        });
    }
    decide(runId: string, actionId: string, approved: boolean): boolean {
        return this.db.transaction(() => {
            const r = this.get(runId);
            const a = this.log.getPendingAction(actionId);
            if (r?.status !== "awaiting_approval" || a?.runId !== runId || a.status !== "pending" || !a.stepId)
                return false;
            if (approved) assertChannelRunScope(this.db, this.userId, JSON.parse(r.input_json) as TurnInput);
            const s = this.steps(runId).find(s => s.id === a.stepId);
            if (!s || s.status !== "awaiting_approval" || s.input_digest !== a.inputDigest || s.tool_call_id !== a.toolCallId
                || s.tool_name !== a.tool || s.input_json !== a.inputJson || inputDigest(a.inputJson) !== a.inputDigest)
                return false;
            const now = Date.now();
            const { approvalWaitMs } = runDuration(this.db, this.userId, runId, now);
            const result = this.db.prepare("UPDATE copilot_pending_actions SET status=?,decided_at=?,updated_at=? WHERE user_id=? AND id=? AND status='pending'")
                .run(approved ? "approved" : "rejected", now, now, this.userId, actionId);
            if (!result.changes)
                return false;
            this.db.prepare("UPDATE copilot_run_steps SET status='pending' WHERE user_id=? AND id=?").run(this.userId, s.id);
            this.db.prepare("UPDATE copilot_runs SET status='pending',approval_wait_ms=?,approval_wait_started_at=NULL,revision=revision+1 WHERE user_id=? AND id=?").run(approvalWaitMs, this.userId, runId);
            traceRunEvent(this.db, this.userId, runId, r.fence, 'approval_decided', { decision: approved ? 'approved' : 'rejected', toolName: s.tool_name }, s.id);
            return true;
        }).immediate();
    }
    finish(c: Claim, status: AgentRunStatus, reason?: string): boolean { return this.commit(c, () => this.finishUnowned(c.runId, status, reason)); }
    private finishUnowned(runId: string, status: AgentRunStatus, reason?: string): void {
        settleApprovalWait(this.db, this.userId, runId);
        const fence = (this.db.prepare("SELECT fence FROM copilot_runs WHERE user_id=? AND id=?").get(this.userId, runId) as { fence: number } | undefined)?.fence ?? 0;
        this.db.prepare("UPDATE copilot_runs SET execution_phase='finished',status=?,stop_reason=?,error=?,completed_at=?,lease_owner=NULL,lease_expires_at=NULL,fence=fence+1,revision=revision+1,updated_at=? WHERE user_id=? AND id=?")
            .run(status, reason ?? null, status === "failed" ? reason ?? null : null, Date.now(), Date.now(), this.userId, runId);
        traceRunEvent(this.db, this.userId, runId, fence + 1, 'run_finished', { status, ...(reason ? { reason } : {}) });
    }
    cancel(runId: string, reason = "cancelled_by_owner"): boolean {
        return this.db.transaction(() => {
            const r = this.get(runId);
            if (!r || !ACTIVE_RUN_STATES.includes(r.status))
                return false;
            this.finishUnowned(runId, "cancelled", reason);
            new PlatformActionRepository(this.db,this.userId).rejectRun(runId);
            this.db.prepare("UPDATE copilot_run_steps SET status='indeterminate' WHERE user_id=? AND run_id=? AND effect='write' AND status='running'").run(this.userId, runId);
            this.db.prepare("UPDATE copilot_pending_actions SET status='expired',updated_at=? WHERE user_id=? AND run_id=? AND status='pending'").run(Date.now(), this.userId, runId);
            return true;
        }).immediate();
    }
}
