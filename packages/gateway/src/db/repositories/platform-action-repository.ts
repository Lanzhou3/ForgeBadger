import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
export type ActionOrigin = {kind:'owner_api'} | {kind:'copilot';runId:string;stepId:string};
export interface ActionIntent {
    id: string;
    user_id: string;
    actor_user_id: string;
    authority: 'owner_action' ;
    command_id: string;
    input_json: string;
    digest: string;
    resources_json: string;
    policy_version: number;
    expires_at: number;
    idempotency_key: string;
    status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'indeterminate';
    created_at: number;
    channel_conversation_id: string | null;
    origin_kind:'legacy'|'copilot'|'owner_api';
    origin_run_id:string|null;
    origin_step_id:string|null;
    execution_owner: string | null;
    execution_lease_expires_at: number | null;
}
export interface ActionReceipt {
    intentId: string;
    outcome: 'confirmed' | 'no_effect' | 'unknown';
    result: unknown;
    createdAt: number;
}
export interface DispatchHistory {
  intentId: string;
  status: ActionIntent['status'];
  receiptOutcome: ActionReceipt['outcome'] | null;
}

export class PlatformActionRepository {
    constructor(private db: Database, private userId: string) {
    }
    get(id: string) {
        return this.db.prepare('SELECT * FROM platform_action_intents WHERE user_id=? AND id=?').get(this.userId, id) as ActionIntent | undefined;
    }
    byKey(key: string) {
        return this.db.prepare('SELECT * FROM platform_action_intents WHERE user_id=? AND idempotency_key=?').get(this.userId, key) as ActionIntent | undefined;
    }
    create(input: Omit<ActionIntent, 'id' | 'user_id' | 'created_at' | 'execution_owner' | 'execution_lease_expires_at' | 'channel_conversation_id' | 'origin_kind' | 'origin_run_id' | 'origin_step_id'>, originSource?:ActionOrigin) {
        return this.db.transaction(() => {
        const id = randomUUID();
        this.db.prepare(`INSERT INTO platform_action_intents
 (id,user_id,actor_user_id,authority,command_id,input_json,digest,resources_json,policy_version,expires_at,idempotency_key,status,created_at)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, this.userId, input.actor_user_id, input.authority, input.command_id, input.input_json, input.digest, input.resources_json, input.policy_version, input.expires_at, input.idempotency_key, input.status, Date.now());
        let step:{id:string;run_id:string}|undefined;
        if(originSource?.kind==='copilot') {
            if(originSource.stepId!==input.idempotency_key)throw new Error('Copilot action origin key mismatch');
            step=this.db.prepare('SELECT s.id,s.run_id FROM copilot_run_steps s JOIN copilot_runs r ON r.id=s.run_id AND r.user_id=s.user_id WHERE s.user_id=? AND s.id=? AND r.id=?').get(this.userId,originSource.stepId,originSource.runId) as {id:string;run_id:string}|undefined;
            if(!step)throw new Error('Copilot action origin missing');
        }
        this.db.prepare('UPDATE platform_action_intents SET origin_kind=?,origin_run_id=?,origin_step_id=? WHERE user_id=? AND id=?').run(originSource?.kind??'legacy',step?.run_id??null,step?.id??null,this.userId,id);
        const origin=this.originConversation(input.idempotency_key);
        if(origin && this.db.prepare('SELECT 1 FROM copilot_conversations WHERE user_id=? AND id=? AND channel_owned=1').get(this.userId,origin)) {
            this.db.prepare('UPDATE platform_action_intents SET channel_conversation_id=? WHERE user_id=? AND id=?').run(origin,this.userId,id);
        }
        return this.get(id)!;
        }).immediate();
    }
    transition(id: string, from: string, to: ActionIntent['status']) {
        return this.db.prepare('UPDATE platform_action_intents SET status=? WHERE user_id=? AND id=? AND status=?').run(to, this.userId, id, from).changes === 1;
    }
    start(id:string,owner:string,expiresAt:number) {
        return this.db.prepare("UPDATE platform_action_intents SET status='executing',execution_owner=?,execution_lease_expires_at=? WHERE user_id=? AND id=? AND status='approved'").run(owner,expiresAt,this.userId,id).changes===1;
    }
    renewExecution(id:string,owner:string,expiresAt:number) {
        return this.db.prepare("UPDATE platform_action_intents SET execution_lease_expires_at=? WHERE user_id=? AND id=? AND execution_owner=? AND status='executing' AND execution_lease_expires_at>?").run(expiresAt,this.userId,id,owner,Date.now()).changes===1;
    }
    assertExecutionOwner(id:string,owner:string) {
        const row=this.get(id);if(row?.status!=='executing'||row.execution_owner!==owner||(row.execution_lease_expires_at??0)<=Date.now())throw new Error('Action execution lease expired');
    }
    recoverExpired(now=Date.now()) {
        return this.db.prepare("UPDATE platform_action_intents SET status='indeterminate' WHERE user_id=? AND status='executing' AND execution_lease_expires_at<=? AND NOT EXISTS (SELECT 1 FROM platform_action_receipts WHERE platform_action_receipts.user_id=platform_action_intents.user_id AND platform_action_receipts.intent_id=platform_action_intents.id)").run(this.userId,now).changes;
    }
    receipt(id: string): ActionReceipt | undefined {
        const row = this.db.prepare('SELECT * FROM platform_action_receipts WHERE user_id=? AND intent_id=?').get(this.userId, id) as {
            intent_id: string;
            outcome: ActionReceipt['outcome'];
            result_json: string;
            created_at: number;
        } | undefined;
        return row ? { intentId: row.intent_id, outcome: row.outcome, result: JSON.parse(row.result_json), createdAt: row.created_at } : undefined;
    }
    finish(id: string, outcome: ActionReceipt['outcome'], result: unknown) {
        return this.db.transaction(()=>{
            this.db.prepare('INSERT INTO platform_action_receipts(intent_id,user_id,outcome,result_json,created_at) VALUES (?,?,?,?,?)').run(id,this.userId,outcome,JSON.stringify(result??null),Date.now());
            if(!this.db.prepare("UPDATE platform_action_intents SET status=? WHERE user_id=? AND id=? AND status IN ('executing','indeterminate')").run(outcome==='unknown'?'indeterminate':'completed',this.userId,id).changes)throw new Error('Action receipt state conflict');
            return this.receipt(id)!;
        }).immediate();
    }
/** Missing task details do not erase historical dispatch uncertainty. Return references, never prompt/results. */
    findDispatchHistory(projectId: string, workItemId: string, sessionId?: string): DispatchHistory | null {
  return this.db.prepare(`
    SELECT i.id AS intentId, i.status, r.outcome AS receiptOutcome
    FROM platform_action_intents i
    LEFT JOIN platform_action_receipts r ON r.user_id = i.user_id AND r.intent_id = i.id
    WHERE i.user_id = ? AND json_valid(i.input_json) AND (
      (i.command_id = 'pm.task.execute' AND json_extract(i.input_json, '$.projectId') = ?
        AND json_extract(i.input_json, '$.workItemId') = ?)
      OR (i.command_id = 'session.dispatch' AND json_extract(i.input_json, '$.sessionId') = ?))
    ORDER BY CASE WHEN i.status = 'indeterminate' OR r.outcome = 'unknown' THEN 0
      WHEN i.status = 'executing' THEN 1 ELSE 2 END, i.created_at DESC, i.id DESC
    LIMIT 1
  `).get(this.userId, projectId, workItemId, sessionId ?? null) as DispatchHistory | undefined ?? null;
}

    rejectRun(runId: string) {
        this.db.prepare("UPDATE platform_action_intents SET status='rejected' WHERE user_id=? AND status IN ('pending','approved') AND idempotency_key IN (SELECT id FROM copilot_run_steps WHERE user_id=? AND run_id=?)").run(this.userId,this.userId,runId);
    }
    originConversation(key:string): string|undefined {
        const row=this.db.prepare('SELECT r.conversation_id FROM copilot_run_steps s JOIN copilot_runs r ON r.user_id=s.user_id AND r.id=s.run_id WHERE s.user_id=? AND s.id=?').get(this.userId,key) as {conversation_id:string}|undefined;
        const persisted=this.byKey(key)?.channel_conversation_id;
        if(persisted && row?.conversation_id!==persisted) throw new Error('Channel action origin missing or mismatched');
        return persisted ?? row?.conversation_id;
    }
    assertOriginActive(key: string) {
        const row=this.db.prepare("SELECT r.status FROM copilot_run_steps s JOIN copilot_runs r ON r.user_id=s.user_id AND r.id=s.run_id WHERE s.user_id=? AND s.id=?").get(this.userId,key) as {status:string}|undefined;
        if(row&&!['pending','running','awaiting_approval'].includes(row.status))throw new Error('Originating Copilot run is no longer active');
    }
}
