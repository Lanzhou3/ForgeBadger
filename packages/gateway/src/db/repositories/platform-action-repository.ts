import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
export interface ActionIntent {
    id: string;
    user_id: string;
    actor_user_id: string;
    grant_id: string | null;
    grant_revision: number | null;
    authority: 'owner_action' | 'delegated_grant';
    command_id: string;
    input_json: string;
    digest: string;
    resources_json: string;
    policy_version: number;
    expires_at: number;
    idempotency_key: string;
    status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'indeterminate';
    created_at: number;
    execution_owner: string | null;
    execution_lease_expires_at: number | null;
}
export interface ActionReceipt {
    intentId: string;
    outcome: 'confirmed' | 'no_effect' | 'unknown';
    result: unknown;
    createdAt: number;
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
    create(input: Omit<ActionIntent, 'id' | 'user_id' | 'created_at' | 'execution_owner' | 'execution_lease_expires_at'>) {
        const id = randomUUID();
        this.db.prepare(`INSERT INTO platform_action_intents
 (id,user_id,actor_user_id,grant_id,grant_revision,authority,command_id,input_json,digest,resources_json,policy_version,expires_at,idempotency_key,status,created_at)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, this.userId, input.actor_user_id, input.grant_id, input.grant_revision, input.authority, input.command_id, input.input_json, input.digest, input.resources_json, input.policy_version, input.expires_at, input.idempotency_key, input.status, Date.now());
        return this.get(id)!;
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
    rejectRun(runId: string) {
        this.db.prepare("UPDATE platform_action_intents SET status='rejected' WHERE user_id=? AND status IN ('pending','approved') AND idempotency_key IN (SELECT id FROM copilot_run_steps WHERE user_id=? AND run_id=?)").run(this.userId,this.userId,runId);
    }
    assertOriginActive(key: string) {
        const row=this.db.prepare("SELECT r.status FROM copilot_run_steps s JOIN copilot_runs r ON r.user_id=s.user_id AND r.id=s.run_id WHERE s.user_id=? AND s.id=?").get(this.userId,key) as {status:string}|undefined;
        if(row&&!['pending','running','awaiting_approval'].includes(row.status))throw new Error('Originating Copilot run is no longer active');
    }
    activeForGrant(id: string) {
        return (this.db.prepare("SELECT COUNT(*) n FROM platform_action_intents WHERE user_id=? AND grant_id=? AND status IN ('executing','indeterminate')").get(this.userId, id) as {
            n: number;
        }).n;
    }
}
