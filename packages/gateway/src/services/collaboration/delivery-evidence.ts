import path from 'node:path';
import { realpathSync } from 'node:fs';
import { acquireOperation, releaseOperation } from './operation-fence.js';
import { CollaborationError, type DeliveryRun } from './types.js';
import type { DeliveryService } from './delivery-service.js';
import { inspectWorktree, integrateWorktree } from './git-workspaces.js';
import { assertVerificationProcessStopped, getVerificationProcessState } from './legacy-verification-recovery.js';
import { redactSensitiveContent } from '../../lib/redaction.js';

export class DeliveryEvidence {
 constructor(private readonly service:DeliveryService) {}
 private async ensureSourceStopped(source:string) {
  const under=(cwd:string)=>{try {const rel=path.relative(source,realpathSync(cwd));return !rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}catch{return false;}};
  const manager=this.service.options.sessionManager;
  if(manager?.listSessions().some(s=>under(s.launchPlan.cwd)&&['running','detached','pending'].includes(s.status))) throw new CollaborationError(409,'STOP_SOURCE_CLI_BEFORE_DELIVERY');
  const rows=this.service.options.db.prepare('SELECT id,user_id,status,runtime_session_name,working_dir FROM sessions').all() as Array<{id:string;user_id:string;status:string;runtime_session_name:string|null;working_dir:string}>;
  for(const row of rows) if(under(row.working_dir)&&(row.status==='running'||(manager?!await manager.isSessionExecutionStopped(row.user_id,row.id,row.runtime_session_name??undefined):!!row.runtime_session_name))) throw new CollaborationError(409,'STOP_SOURCE_CLI_BEFORE_DELIVERY');
 }
 async ensureStopped(run:DeliveryRun) {
  await assertVerificationProcessStopped({cwd:run.workspace_path});
  if(!run.session_id) return;
  const manager=this.service.options.sessionManager;
  const row=this.service.options.db.prepare('SELECT status,runtime_session_name FROM sessions WHERE id=? AND user_id=?').get(run.session_id,run.actor_id) as {status:string;runtime_session_name:string|null}|undefined;
  if(row?.status==='running' || (manager?!await manager.isSessionExecutionStopped(run.actor_id,run.session_id,row?.runtime_session_name??undefined):!!row?.runtime_session_name))
   throw new CollaborationError(409,'STOP_CLI_BEFORE_VERIFICATION_OR_DELIVERY');
 }
 async review(actorId:string,projectId:string,runId:string,input:{expectedCommit:string;verificationId:string;decision:'accepted'|'changes_requested';note:string}) {
  const {run}=this.service.context(actorId,projectId,runId);
  const work=async()=>{
   acquireOperation(this.service.options.db,run,'review',input.expectedCommit);
   try { return await this.reviewLocked(actorId,projectId,runId,input); }
   finally {
    const operation=this.service.options.db.prepare('SELECT kind,phase FROM delivery_operations WHERE run_id=?').get(run.id) as {kind:string;phase:string}|undefined;
    if(operation?.kind==='integrate'&&operation.phase==='applying') this.service.options.db.prepare("UPDATE delivery_operations SET phase='interrupted' WHERE run_id=?").run(run.id);
    else if((await getVerificationProcessState({cwd:run.workspace_path})).safeToProceed) releaseOperation(this.service.options.db,run);
    else this.service.options.db.prepare("UPDATE delivery_operations SET phase='interrupted' WHERE run_id=?").run(run.id);
   }
  };
  return run.session_id&&this.service.options.sessionManager?this.service.options.sessionManager.runExclusive(run.session_id,work):work();
 }
 private async reviewLocked(actorId:string,projectId:string,runId:string,input:{expectedCommit:string;verificationId:string;decision:'accepted'|'changes_requested';note:string}) {
  const {access,repo,run}=this.service.context(actorId,projectId,runId,'review');
  this.service.assertExecutor(run);await this.ensureStopped(run);
  const authority=this.service.authority(actorId),task=this.service.tasks(actorId).get(access,run.work_item_id);
  if(task.reviewerId && task.reviewerId!==actorId) throw new CollaborationError(403,'ASSIGNED_REVIEWER_REQUIRED');
  const team=Boolean(access.teamId)||authority.members(access).some(m=>m.role!=='owner'&&m.state==='active');
  if(team && actorId===run.actor_id) throw new CollaborationError(403,'INDEPENDENT_REVIEWER_REQUIRED');
  const receipt=repo.getReceipt(run,input.verificationId),git=await inspectWorktree({path:run.workspace_path,baseCommit:run.base_commit});
  authority.access(projectId,'review');this.service.assertExecutor(repo.get(projectId,runId));
  const currentTask=this.service.tasks(actorId).get(access,run.work_item_id);
  if(currentTask.reviewerId&&currentTask.reviewerId!==actorId) throw new CollaborationError(403,'ASSIGNED_REVIEWER_REQUIRED');
  if((Boolean(access.teamId)||authority.members(access).some(m=>m.role!=='owner'&&m.state==='active'))&&actorId===run.actor_id) throw new CollaborationError(403,'INDEPENDENT_REVIEWER_REQUIRED');
  if(git.dirty||git.commit!==input.expectedCommit||receipt.commit_sha!==input.expectedCommit || receipt.task_digest!==this.service.tasks(actorId).digest(access,run.work_item_id)
   || receipt.policy_revision!==authority.policy(access).verificationRevision) throw new CollaborationError(409,'STALE_VERIFICATION_OR_TASK');
  if(input.decision==='accepted'&&receipt.status!=='passed') throw new CollaborationError(409,'PASSING_VERIFICATION_REQUIRED');
  const review=repo.review(run,actorId,receipt,input.decision,input.note);
  if(input.decision==='changes_requested') this.service.tasks(actorId).progress(access,run.work_item_id,'in_progress');
  authority.event(access,run.work_item_id,'review_recorded',{runId,decision:input.decision,commit:input.expectedCommit});
  return {review};
 }
 async integrate(actorId:string,projectId:string,runId:string,expectedCommit:string) {
  const {run}=this.service.context(actorId,projectId,runId);
  const work=async()=>{
   acquireOperation(this.service.options.db,run,'integrate',expectedCommit);
   try { return await this.integrateLocked(actorId,projectId,runId,expectedCommit); }
   finally {
    const operation=this.service.options.db.prepare('SELECT kind,phase FROM delivery_operations WHERE run_id=?').get(run.id) as {kind:string;phase:string}|undefined;
    if(operation?.kind==='integrate'&&operation.phase==='applying') this.service.options.db.prepare("UPDATE delivery_operations SET phase='interrupted' WHERE run_id=?").run(run.id);
    else if((await getVerificationProcessState({cwd:run.workspace_path})).safeToProceed) releaseOperation(this.service.options.db,run);
    else this.service.options.db.prepare("UPDATE delivery_operations SET phase='interrupted' WHERE run_id=?").run(run.id);
   }
  };
  return run.session_id&&this.service.options.sessionManager?this.service.options.sessionManager.runExclusive(run.session_id,work):work();
 }
 private async integrateLocked(actorId:string,projectId:string,runId:string,expectedCommit:string) {
  const {access,repo,run}=this.service.context(actorId,projectId,runId,'manage');
  this.service.assertExecutor(run);await this.ensureStopped(run);
  await this.ensureSourceStopped(access.path);
  const review=repo.reviews(run)[0],authority=this.service.authority(actorId);
  if(!review||review.decision!=='accepted'||review.commit!==expectedCommit) throw new CollaborationError(409,'CURRENT_ACCEPTANCE_REQUIRED');
  {const reviewer=this.service.authority(review.actorId).access(projectId,'review');if(review.authorityEpoch!==JSON.stringify([reviewer.authorityEpoch,reviewer.membershipRevision]))throw new CollaborationError(409,'STALE_REVIEW_AUTHORITY');}
  const receipt=repo.getReceipt(run,review.verificationId),policy=authority.policy(access);
  if(receipt.status!=='passed'||receipt.commit_sha!==expectedCommit||review.taskDigest!==this.service.tasks(actorId).digest(access,run.work_item_id)||review.policyRevision!==policy.verificationRevision)
   throw new CollaborationError(409,'STALE_ACCEPTANCE');
  const git=await inspectWorktree({path:run.workspace_path,baseCommit:run.base_commit});
  if(git.dirty||git.commit!==expectedCommit) throw new CollaborationError(409,'STALE_ACCEPTANCE');
  const authorize=()=>{
   authority.access(projectId,'manage');this.service.assertExecutor(repo.get(projectId,runId));
   {const reviewer=this.service.authority(review.actorId).access(projectId,'review');if(review.authorityEpoch!==JSON.stringify([reviewer.authorityEpoch,reviewer.membershipRevision]))throw new CollaborationError(409,'STALE_REVIEW_AUTHORITY');}
   const task=this.service.tasks(actorId).get(access,run.work_item_id);
   if((task.reviewerId&&task.reviewerId!==review.actorId)||repo.reviews(run)[0]?.id!==review.id||review.taskDigest!==this.service.tasks(actorId).digest(access,run.work_item_id)||review.policyRevision!==authority.policy(access).verificationRevision)
    throw new CollaborationError(409,'STALE_ACCEPTANCE');
   if((Boolean(access.teamId)||authority.members(access).some(m=>m.role!=='owner'&&m.state==='active'))&&review.actorId===run.actor_id) throw new CollaborationError(409,'INDEPENDENT_REVIEWER_REQUIRED');
   this.service.options.db.prepare("UPDATE delivery_operations SET phase='applying' WHERE run_id=? AND user_id=?").run(run.id,run.user_id);
  };
  await integrateWorktree({sourcePath:access.path,path:run.workspace_path,baseCommit:run.base_commit,expectedCommit,targetBranch:run.target_branch,authorize});
  this.service.options.db.transaction(()=>{
   releaseOperation(this.service.options.db,run);
   repo.state(run,'integrated');
   this.service.tasks(actorId).progress(access,run.work_item_id,'done',{runId,commit:expectedCommit});
  })();
  if(run.session_id) this.service.options.invalidator?.invalidate({scope:'session',userId:run.actor_id,sessionId:run.session_id});
  authority.event(access,run.work_item_id,'delivery_integrated',{runId,commit:expectedCommit});
  return {run:repo.dto(repo.get(projectId,runId),actorId)};
 }
 handoff(actorId:string,projectId:string,runId:string) {
  const {access,repo,run}=this.service.context(actorId,projectId,runId),task=this.service.tasks(actorId).get(access,run.work_item_id);
  const checks=repo.receipts(run).map(r=>`- ${r.commit_sha}: ${r.status} (receipt ${r.id})`).join('\n');
  return {markdown:redactSensitiveContent(`# ${task.title}\n\nProject: ${access.name}\nTask: ${task.id}\nRun: ${run.id}\nState: ${run.state}\nBranch: ${run.branch}\nBase: ${run.base_commit}\n\n## Acceptance criteria\n${task.acceptanceCriteria.map(c=>'- '+c).join('\n')}\n\n## Verification\n${checks||'No verification recorded'}\n\n## Review\n${repo.reviews(run).map(r=>`- ${r.actorLabel}: ${r.decision} at ${r.commit}\n  ${r.note}`).join('\n')||'No review recorded'}\n\nPreview: ${run.preview_url??'Not supplied'}\nPR: ${run.pr_url??'Not supplied'}\n\nLinks are operator supplied. Terminal context and host credentials are not included.\n`)};
 }
}
