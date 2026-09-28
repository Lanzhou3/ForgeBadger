import type { Database } from '../../db/types.js';
import type { InMemorySessionManager } from '../session-manager.js';
import type { RuntimeAuthorizationInvalidator } from '../runtime-authorization-invalidation.js';
export type CollaborationRole = 'owner' | 'admin' | 'developer' | 'reviewer' | 'viewer';
export type MemberRole = Exclude<CollaborationRole,'owner'|'admin'>;
export type Capability = 'read' | 'comment' | 'develop' | 'review' | 'manage';
export interface VerificationPolicy { command: string; args: string[]; timeoutSeconds: number }
export interface CollaborationAccess { userId: string; actorId: string; projectId: string; role: CollaborationRole; capabilities:Capability[]; teamId:string|null; logicalOwnerId:string; authorityEpoch:string; membershipRevision: number; path: string; name: string }
export interface CollaborationOptions { db: Database; workspacesRoot: string; sessionManager?: InMemorySessionManager | undefined; invalidator?: RuntimeAuthorizationInvalidator | undefined }
export interface DeliveryRun {
 id: string; user_id: string; project_id: string; work_item_id: string; actor_id: string; idempotency_key: string; input_digest:string; adapter:string; membership_revision: number; authority_epoch:string;
 state: 'provisioning'|'ready'|'failed'|'revoking'|'closed'|'integrated'; workspace_project_id: string|null; session_id: string|null;
 workspace_path: string; branch: string; base_commit: string; target_branch: string; preview_url: string|null; pr_url: string|null;
 error_code: string|null; created_at: number; updated_at: number;
}
export interface VerificationReceipt {
 id:string; user_id:string; project_id:string; run_id:string; actor_id:string; commit_sha:string; task_digest:string; task_revision:number; policy_revision:number;
 command_json:string; status:'running'|'passed'|'failed'|'unknown'; exit_code:number|null; summary:string; created_at:number; finished_at:number|null;
}
export class CollaborationError extends Error {
 constructor(public readonly status: number, public readonly code: string, message = code) { super(message); }
}
