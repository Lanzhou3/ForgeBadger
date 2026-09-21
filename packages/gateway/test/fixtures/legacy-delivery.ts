// Historical database fixtures, not a replacement verification executor.
import { randomUUID } from 'node:crypto';
import type { DeliveryService } from '../../src/services/collaboration/delivery-service.js';
import type { Database } from '../../src/db/types.js';
import { realpathSync } from 'node:fs';
export function seedLegacyPolicy(db: Database, userId: string, projectId: string, root: string) {
 db.prepare(`INSERT INTO collaboration_projects(user_id,project_id,protected_root,revision,execution_enabled,verification_json,verification_revision)
 VALUES(?,?,?,1,1,?,1) ON CONFLICT(project_id) DO UPDATE SET execution_enabled=1,verification_json=excluded.verification_json`)
 .run(userId,projectId,realpathSync(root),JSON.stringify({command:'node',args:['check.cjs'],timeoutSeconds:5}));
}
export function seedLegacyReceipt(service: DeliveryService, actorId: string, projectId: string, runId: string, commit: string) {
 const {access,run,repo}=service.context(actorId,projectId,runId),tasks=service.tasks(actorId),task=tasks.get(access,run.work_item_id),id=randomUUID();
 service.options.db.prepare(`INSERT INTO delivery_verifications(id,user_id,project_id,run_id,actor_id,commit_sha,task_digest,task_revision,policy_revision,command_json,status,exit_code,summary,created_at,finished_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,'passed',0,'Historical test receipt',?,?)`).run(id,run.user_id,projectId,runId,actorId,commit,tasks.digest(access,run.work_item_id),task.revision,service.authority(actorId).policy(access).verificationRevision,JSON.stringify({command:'node',args:['check.cjs'],timeoutSeconds:5}),Date.now(),Date.now());
 return {receipt:repo.receiptDto(repo.getReceipt(run,id))};
}
