import { projectActionReceipt } from "../platform-commands/receipt-projection.js";
import { PlatformActionRepository } from "../../db/repositories/platform-action-repository.js";
import { CopilotGrantRepository } from "../../db/repositories/copilot-grant-repository.js";
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../db/types.js";
import { CopilotConversationLog } from "./conversation-log.js";
import { AgentError, type AgentRunStatus } from "./types.js";
import { redactAgentText } from "./redaction.js";
export interface TurnInput {
    userId: string;
    conversationId: string;
    userText: string;
    modelId?: string;
    projectId?: string;
    grantId?: string;
    source?: "user" | "reactive" | "scheduled";
    skipUserMessage?: boolean;
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
    runtime_version: number;
}
export interface RunStep {
    id: string;
    user_id: string;
    run_id: string;
    ordinal: number;
    kind: "model" | "tool";
    status: "pending" | "running" | "awaiting_approval" | "completed" | "indeterminate";
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
        if (input.userId !== this.userId || !this.log.getConversation(input.conversationId))
            throw new AgentError("COPILOT_NOT_FOUND", "Conversation not found");
        const user = this.db.prepare("SELECT status FROM users WHERE id=?").get(this.userId) as {
            status: string;
        } | undefined;
        if (user?.status !== "active")
            throw new AgentError("COPILOT_USER_INACTIVE", "User is not active");
        if (input.grantId) {
            const g = new CopilotGrantRepository(this.db, this.userId).get(input.grantId);
            if (!g || g.status !== "active" || g.expiresAt <= Date.now()) throw new Error("Grant unavailable, expired or revoked");
            if (input.projectId && !g.scope.projectIds.includes(input.projectId)) throw new Error("Project outside grant scope");
        }
        if (input.projectId && !this.db.prepare("SELECT id FROM projects WHERE user_id=? AND id=?").get(this.userId, input.projectId))
            throw new AgentError("COPILOT_PROJECT_NOT_FOUND", "Project not found");
    }
    admit(input: TurnInput, maxSteps: number): string {
        return this.db.transaction(() => {
            const grants = new CopilotGrantRepository(this.db, this.userId);
            const binding = grants.binding(input.conversationId);
            if (binding && input.grantId && binding !== input.grantId) throw new Error("Conversation grant cannot change");
            if (binding) input = { ...input, grantId: binding };
            if (!binding && input.grantId) {
                if (this.log.listMessages(input.conversationId).length || this.log.listRuns(input.conversationId).length) throw new Error("Grant requires a fresh empty conversation");
            }
            this.validateScope(input);
            if (!binding && input.grantId) grants.bind(input.conversationId, input.grantId);
            if (this.log.listRuns(input.conversationId).some(r => ACTIVE_RUN_STATES.includes(r.status)))
                throw new AgentError("COPILOT_CONVERSATION_BUSY", "Conversation already has an active run");
            const run = this.log.createRun(input.conversationId, input.modelId ? { model: input.modelId } : {});
            this.db.prepare("UPDATE copilot_runs SET runtime_version=1, input_json=?, source=?, max_steps=? WHERE user_id=? AND id=?")
                .run(JSON.stringify({ ...input, userText: redactAgentText(input.userText) }), input.source ?? "user", maxSteps, this.userId, run.id);
            if (!input.skipUserMessage)
                this.append(run.id, { role: "user", kind: "text", content: input.userText });
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
    receipt(c: Claim, step: RunStep, content: string, unknownEffect = false): void {
        if (!this.db.open)
            return;
        this.db.transaction(() => {
            // A late result is evidence only. It cannot publish transcript or advance a run.
            const current = this.steps(c.runId).find(s => s.id === step.id);
            if (!current || current.fence !== c.fence || !["running", "indeterminate"].includes(current.status))
                return;
            const owned = this.owns(c);
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
            const action = this.log.createPendingAction({ runId: c.runId, tool: step.tool_name!, inputJson: step.input_json!, inputDigest: step.input_digest! });
            this.db.prepare("UPDATE copilot_pending_actions SET step_id=?,tool_call_id=? WHERE user_id=? AND id=?").run(step.id, step.tool_call_id, this.userId, action.id);
            this.db.prepare("UPDATE copilot_run_steps SET status='awaiting_approval' WHERE user_id=? AND id=?").run(this.userId, step.id);
            this.db.prepare("UPDATE copilot_runs SET status='awaiting_approval',lease_owner=NULL,lease_expires_at=NULL WHERE user_id=? AND id=?").run(this.userId, c.runId);
        });
    }
    decide(runId: string, actionId: string, approved: boolean): boolean {
        return this.db.transaction(() => {
            const r = this.get(runId);
            const a = this.log.getPendingAction(actionId);
            if (r?.status !== "awaiting_approval" || a?.runId !== runId || a.status !== "pending" || !a.stepId)
                return false;
            const s = this.steps(runId).find(s => s.id === a.stepId);
            if (!s || s.status !== "awaiting_approval" || s.input_digest !== a.inputDigest || s.tool_call_id !== a.toolCallId)
                return false;
            const result = this.db.prepare("UPDATE copilot_pending_actions SET status=?,decided_at=?,updated_at=? WHERE user_id=? AND id=? AND status='pending'")
                .run(approved ? "approved" : "rejected", Date.now(), Date.now(), this.userId, actionId);
            if (!result.changes)
                return false;
            this.db.prepare("UPDATE copilot_run_steps SET status='pending' WHERE user_id=? AND id=?").run(this.userId, s.id);
            this.db.prepare("UPDATE copilot_runs SET status='pending',revision=revision+1 WHERE user_id=? AND id=?").run(this.userId, runId);
            return true;
        }).immediate();
    }
    finish(c: Claim, status: AgentRunStatus, reason?: string): boolean { return this.commit(c, () => this.finishUnowned(c.runId, status, reason)); }
    private finishUnowned(runId: string, status: AgentRunStatus, reason?: string): void {
        this.db.prepare("UPDATE copilot_runs SET status=?,stop_reason=?,error=?,completed_at=?,lease_owner=NULL,lease_expires_at=NULL,fence=fence+1,revision=revision+1,updated_at=? WHERE user_id=? AND id=?")
            .run(status, reason ?? null, status === "failed" ? reason ?? null : null, Date.now(), Date.now(), this.userId, runId);
    }
    cancel(runId: string): boolean {
        return this.db.transaction(() => {
            const r = this.get(runId);
            if (!r || !ACTIVE_RUN_STATES.includes(r.status))
                return false;
            this.finishUnowned(runId, "cancelled", "cancelled_by_owner");
            new PlatformActionRepository(this.db,this.userId).rejectRun(runId);
            this.db.prepare("UPDATE copilot_run_steps SET status='indeterminate' WHERE user_id=? AND run_id=? AND effect='write' AND status='running'").run(this.userId, runId);
            this.db.prepare("UPDATE copilot_pending_actions SET status='expired',updated_at=? WHERE user_id=? AND run_id=? AND status='pending'").run(Date.now(), this.userId, runId);
            return true;
        }).immediate();
    }
}
