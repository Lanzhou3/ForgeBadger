import {CollaborationRepository} from './collaboration-repository.js';
import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
import { CollaborationError, type DeliveryRun, type VerificationReceipt, type VerificationPolicy } from '../../services/collaboration/types.js';
export class DeliveryRepository {
 constructor(private readonly db:Database,private readonly userId:string) {}
 get(projectId:string,id:string):DeliveryRun {
  const row=this.db.prepare('SELECT * FROM delivery_runs WHERE user_id=? AND project_id=? AND id=?').get(this.userId,projectId,id) as DeliveryRun|undefined;
  if(!row) throw new CollaborationError(404,'DELIVERY_NOT_FOUND');return row;
 }
 list(projectId:string,taskId:string):DeliveryRun[] {
  return this.db.prepare('SELECT * FROM delivery_runs WHERE user_id=? AND project_id=? AND work_item_id=? ORDER BY created_at DESC,rowid DESC').all(this.userId,projectId,taskId) as DeliveryRun[];
 }
 byKey(actorId:string,key:string):DeliveryRun|undefined {
  return this.db.prepare('SELECT * FROM delivery_runs WHERE actor_id=? AND idempotency_key=?').get(actorId,key) as DeliveryRun|undefined;
 }
 insert(run:DeliveryRun) {
  this.db.prepare(`INSERT INTO delivery_runs(id,user_id,project_id,work_item_id,actor_id,idempotency_key,input_digest,adapter,membership_revision,authority_epoch,state,workspace_path,branch,base_commit,target_branch,created_at,updated_at)
   VALUES(@id,@user_id,@project_id,@work_item_id,@actor_id,@idempotency_key,@input_digest,@adapter,@membership_revision,@authority_epoch,@state,@workspace_path,@branch,@base_commit,@target_branch,@created_at,@updated_at)`).run(run);
 }
 ready(run:DeliveryRun,workspaceProjectId:string,sessionId:string,baseCommit:string,targetBranch:string) {
  const result=this.db.prepare(`UPDATE delivery_runs SET state='ready',workspace_project_id=?,session_id=?,base_commit=?,target_branch=?,updated_at=? WHERE user_id=? AND project_id=? AND id=? AND state='provisioning'`)
   .run(workspaceProjectId,sessionId,baseCommit,targetBranch,Date.now(),this.userId,run.project_id,run.id);
  if(!result.changes) throw new CollaborationError(409,'DELIVERY_AUTHORITY_CHANGED');
 }
 state(run:DeliveryRun,state:DeliveryRun['state'],error:string|null=null) {
  this.db.prepare('UPDATE delivery_runs SET state=?,error_code=?,updated_at=? WHERE user_id=? AND project_id=? AND id=?').run(state,error,Date.now(),this.userId,run.project_id,run.id);
 }
 links(run:DeliveryRun,previewUrl:string|null,prUrl:string|null) {
  this.db.prepare('UPDATE delivery_runs SET preview_url=?,pr_url=?,updated_at=? WHERE user_id=? AND project_id=? AND id=?').run(previewUrl,prUrl,Date.now(),this.userId,run.project_id,run.id);
 }
 getReceipt(run:DeliveryRun,id:string):VerificationReceipt {
  const row=this.db.prepare('SELECT * FROM delivery_verifications WHERE user_id=? AND project_id=? AND run_id=? AND id=?').get(this.userId,run.project_id,run.id,id) as VerificationReceipt|undefined;
  if(!row) throw new CollaborationError(404,'VERIFICATION_NOT_FOUND');return row;
 }
 receipts(run:DeliveryRun):VerificationReceipt[] {
  return this.db.prepare('SELECT * FROM delivery_verifications WHERE user_id=? AND project_id=? AND run_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50').all(this.userId,run.project_id,run.id) as VerificationReceipt[];
 }
 review(run:DeliveryRun,actorId:string,receipt:VerificationReceipt,decision:'accepted'|'changes_requested',note:string) {
  const id=randomUUID(),access=new CollaborationRepository(this.db,actorId).access(run.project_id,'review'),epoch=JSON.stringify([access.authorityEpoch,access.membershipRevision]);
  this.db.prepare(`INSERT INTO delivery_reviews(id,user_id,project_id,run_id,actor_id,verification_id,commit_sha,task_digest,task_revision,policy_revision,decision,note,created_at,authority_epoch)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,this.userId,run.project_id,run.id,actorId,receipt.id,receipt.commit_sha,receipt.task_digest,receipt.task_revision,receipt.policy_revision,decision,note,Date.now(),epoch);
  return this.reviews(run).find(r=>r.id===id)!;
 }
 reviews(run:DeliveryRun) {
  return this.db.prepare(`SELECT r.id,r.actor_id AS actorId,COALESCE(u.display_name,u.username) AS actorLabel,r.commit_sha AS "commit",r.verification_id AS verificationId,
   r.authority_epoch AS authorityEpoch,r.task_digest AS taskDigest,r.task_revision AS taskRevision,r.policy_revision AS policyRevision,r.decision,r.note,r.created_at AS createdAt
   FROM delivery_reviews r JOIN users u ON u.id=r.actor_id WHERE r.user_id=? AND r.project_id=? AND r.run_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 50`)
   .all(this.userId,run.project_id,run.id) as Array<{id:string;authorityEpoch:string;actorId:string;actorLabel:string;commit:string;verificationId:string;taskDigest:string;taskRevision:number;policyRevision:number;decision:'accepted'|'changes_requested';note:string;createdAt:number}>;
 }
 dto(run:DeliveryRun,actorId:string) {
  const operation=this.db.prepare('SELECT kind,phase FROM delivery_operations WHERE run_id=? AND user_id=?').get(run.id,this.userId) as {kind:string;phase:string}|undefined;
  const actor=this.db.prepare('SELECT COALESCE(display_name,username) AS label FROM users WHERE id=?').get(run.actor_id) as {label:string};
  return {id:run.id,taskId:run.work_item_id,actorId:run.actor_id,actorLabel:actor.label,state:run.state,branch:run.branch,baseCommit:run.base_commit,
   operation:operation??null,sessionId:actorId===run.actor_id&&run.state==='ready'&&!operation?run.session_id:null,previewUrl:run.preview_url,prUrl:run.pr_url,error:run.error_code,createdAt:run.created_at};
 }
 receiptDto(row:VerificationReceipt) {
  const policy=JSON.parse(row.command_json) as VerificationPolicy;
  return {id:row.id,taskRevision:row.task_revision,policyRevision:row.policy_revision,current:false,commit:row.commit_sha,status:row.status,command:policy.command,args:policy.args,exitCode:row.exit_code,summary:row.summary,createdAt:row.created_at,finishedAt:row.finished_at};
 }
}
